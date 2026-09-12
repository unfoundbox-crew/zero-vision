import { spawn } from "node:child_process";
import { connect, type Socket } from "node:net";
import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The warm path. `zrv` is a fresh process per call, so keeping a child alive
// inside one CLI run warms nothing — the model has to outlive the CLI. This
// module talks to a per-user daemon over a 0600 Unix socket in the user's own
// state directory; nothing listens on the network. The cold one-shot path in
// local-vlm.ts stays the fallback and the reason is surfaced, never swallowed.

/** Bumped when the socket wire protocol changes; mismatched daemons are replaced. */
export const WARM_PROTOCOL = 1;
const DEFAULT_IDLE_S = 600;
const DEFAULT_QUEUE_MAX = 2;
const DEFAULT_SPAWN_TIMEOUT_MS = 20_000;
const CONNECT_TIMEOUT_MS = 2_000;

export interface DaemonHealth {
  ok: true;
  op: "health";
  protocol: number;
  pid: number;
  model: string;
  loaded: boolean;
  loadMs: number | null;
  requests: number;
  inFlight: number;
  waiting: number;
  uptimeS: number;
  idleS: number;
  idleMs: number;
  queueMax: number;
}

/** `~/Library/Application Support/zero-vision` on macOS, XDG state dir elsewhere. */
export function stateDir(): string {
  if (process.env.ZRV_STATE_DIR) return process.env.ZRV_STATE_DIR;
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "zero-vision");
  }
  const xdg = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(xdg, "zero-vision");
}

/** Unix socket the daemon owns. `ZRV_LOCAL_VLM_SOCK` overrides it whole. */
export function socketPath(): string {
  return process.env.ZRV_LOCAL_VLM_SOCK || join(stateDir(), "local-vlm.sock");
}

/** Warm is the default; `ZRV_LOCAL_VLM_WARM=0` pins the old one-shot spawn. */
export function warmEnabled(): boolean {
  const v = process.env.ZRV_LOCAL_VLM_WARM;
  return v !== "0" && v !== "false";
}

/** `ZRV_LOCAL_VLM_IDLE_MS` wins; else `ZRV_LOCAL_VLM_IDLE_S`; else 600 s. */
export function idleMs(): number {
  const ms = Number(process.env.ZRV_LOCAL_VLM_IDLE_MS);
  if (Number.isFinite(ms) && ms > 0) return Math.floor(ms);
  const s = Number(process.env.ZRV_LOCAL_VLM_IDLE_S);
  if (Number.isFinite(s) && s > 0) return Math.floor(s * 1000);
  return DEFAULT_IDLE_S * 1000;
}

export function queueMax(): number {
  const n = Number(process.env.ZRV_LOCAL_VLM_QUEUE_MAX);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_QUEUE_MAX;
}

/** `local_vlm_daemon.py` next to the compiled JS, else the source-tree copy. */
export function daemonPath(): string {
  // Same seam as runnerPath(): a script speaking the protocol in the daemon's docstring.
  if (process.env.ZRV_LOCAL_VLM_DAEMON) return process.env.ZRV_LOCAL_VLM_DAEMON;
  const here = dirname(fileURLToPath(import.meta.url));
  const beside = join(here, "local_vlm_daemon.py");
  if (existsSync(beside)) return beside;
  return resolve(here, "..", "..", "src", "engines", "local_vlm_daemon.py");
}

type Reply = Record<string, unknown>;
export type Sent = { ok: true; reply: Reply } | { ok: false; reason: string };

/** One request, one connection, one JSON line each way. */
export function ask(sock: string, payload: unknown, timeoutMs: number): Promise<Sent> {
  return new Promise((done) => {
    let settled = false;
    let buf = "";
    const finish = (r: Sent) => {
      if (settled) return;
      settled = true;
      try {
        client.destroy();
      } catch {
        /* already gone */
      }
      done(r);
    };
    const client: Socket = connect(sock);
    client.setTimeout(timeoutMs);
    client.on("timeout", () =>
      finish({ ok: false, reason: `local_vlm_timeout: daemon silent for ${timeoutMs}ms` }),
    );
    client.on("error", (err: NodeJS.ErrnoException) =>
      finish({ ok: false, reason: `local_vlm_daemon_unreachable: ${err.code ?? err.message} on ${sock}` }),
    );
    client.on("connect", () => client.write(JSON.stringify(payload) + "\n"));
    client.on("data", (chunk) => {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      try {
        finish({ ok: true, reply: JSON.parse(line) as Reply });
      } catch {
        finish({ ok: false, reason: `local_vlm_daemon_protocol: unparseable reply ${line.slice(0, 200)}` });
      }
    });
    client.on("end", () =>
      finish({ ok: false, reason: "local_vlm_daemon_protocol: daemon closed without a reply" }),
    );
  });
}

export async function daemonHealth(sock = socketPath()): Promise<DaemonHealth | null> {
  if (!existsSync(sock)) return null;
  const r = await ask(sock, { op: "health" }, CONNECT_TIMEOUT_MS);
  if (!r.ok) return null;
  const h = r.reply as unknown as DaemonHealth;
  return h && h.ok === true && typeof h.pid === "number" ? h : null;
}

/** Ask a daemon to exit. Returns a human line; never throws. */
export async function stopDaemon(sock = socketPath()): Promise<{ stopped: boolean; detail: string }> {
  const h = await daemonHealth(sock);
  if (!h) {
    rmSync(sock, { force: true });
    return { stopped: false, detail: `no local-vlm daemon at ${sock}` };
  }
  const r = await ask(sock, { op: "stop" }, CONNECT_TIMEOUT_MS);
  if (!r.ok) return { stopped: false, detail: r.reason };
  for (let i = 0; i < 40; i++) {
    if (!(await daemonHealth(sock))) return { stopped: true, detail: `stopped pid ${h.pid}` };
    await sleep(50);
  }
  return { stopped: false, detail: `daemon pid ${h.pid} did not exit within 2s` };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type Ensured = { ok: true; health: DaemonHealth } | { ok: false; reason: string };

/**
 * A daemon holding exactly `modelDir`, started if needed. Any reason we could
 * not get one is returned, not thrown — the caller falls back to the cold path
 * and reports it.
 */
export async function ensureDaemon(modelDir: string, bin: string): Promise<Ensured> {
  const sock = socketPath();
  const existing = await daemonHealth(sock);
  if (existing) {
    if (existing.protocol === WARM_PROTOCOL && existing.model === modelDir) {
      return { ok: true, health: existing };
    }
    // Wrong model or wrong protocol: replace it rather than reload in place.
    const bye = await stopDaemon(sock);
    if (!bye.stopped) {
      return {
        ok: false,
        reason:
          `local_vlm_daemon_busy_other_model: daemon pid ${existing.pid} holds ` +
          `${existing.model} (protocol ${existing.protocol}) and would not stop: ${bye.detail}`,
      };
    }
  }

  const script = daemonPath();
  if (!existsSync(script)) {
    return { ok: false, reason: `local_vlm_no_daemon: daemon script missing at ${script}` };
  }
  try {
    mkdirSync(dirname(sock), { recursive: true, mode: 0o700 });
    chmodSync(dirname(sock), 0o700);
  } catch (err) {
    return {
      ok: false,
      reason: `local_vlm_daemon_state_dir: cannot prepare ${dirname(sock)} (${
        err instanceof Error ? err.message : String(err)
      })`,
    };
  }

  const args = [
    script,
    "--socket",
    sock,
    "--model",
    modelDir,
    "--idle-ms",
    String(idleMs()),
    "--queue-max",
    String(queueMax()),
  ];
  // Inference runs at nice 19: this is a background helper on a laptop someone
  // is working on. ZRV_LOCAL_VLM_NICE=0 turns it off.
  const nice = Number(process.env.ZRV_LOCAL_VLM_NICE ?? 19);
  const useNice = Number.isFinite(nice) && nice > 0 && existsSync("/usr/bin/nice");
  const cmd = useNice ? "/usr/bin/nice" : bin;
  const argv = useNice ? ["-n", String(Math.floor(nice)), bin, ...args] : args;

  let stderr = "";
  // An object, not a `let`: TS narrows a `let` initialised to null and would
  // treat the callback assignments below as unreachable.
  const status: { exited: string | null } = { exited: null };
  let child;
  try {
    child = spawn(cmd, argv, { detached: true, stdio: ["ignore", "ignore", "pipe"] });
  } catch (err) {
    return {
      ok: false,
      reason: `local_vlm_no_python: cannot spawn ${cmd} (${err instanceof Error ? err.message : String(err)})`,
    };
  }
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (c: string) => {
    stderr += c;
  });
  child.on("error", (err: Error) => {
    status.exited = `spawn failed: ${err.message}`;
  });
  child.on("exit", (code, signal) => {
    status.exited = `daemon exited ${signal ? `on ${signal}` : `with code ${code}`}`;
  });

  const budget = Number(process.env.ZRV_LOCAL_VLM_SPAWN_TIMEOUT_MS) || DEFAULT_SPAWN_TIMEOUT_MS;
  const deadline = Date.now() + budget;
  try {
    while (Date.now() < deadline) {
      const h = await daemonHealth(sock);
      if (h && h.protocol === WARM_PROTOCOL && h.model === modelDir) return { ok: true, health: h };
      if (h) {
        return {
          ok: false,
          reason:
            `local_vlm_daemon_protocol: daemon at ${sock} reports protocol ${h.protocol} ` +
            `for model ${h.model}, expected ${WARM_PROTOCOL} / ${modelDir}`,
        };
      }
      if (status.exited) {
        return {
          ok: false,
          reason: `local_vlm_daemon_start_failed: ${status.exited}${stderr.trim() ? `: ${stderr.trim().slice(-300)}` : ""}`,
        };
      }
      await sleep(60);
    }
    return {
      ok: false,
      reason:
        `local_vlm_daemon_start_timeout: no daemon answered on ${sock} within ${budget}ms` +
        (stderr.trim() ? `: ${stderr.trim().slice(-300)}` : ""),
    };
  } finally {
    // Let the daemon outlive this CLI process.
    child.stderr?.removeAllListeners("data");
    child.stderr?.destroy();
    child.unref();
  }
}
