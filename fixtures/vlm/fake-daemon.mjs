// Hermetic stand-in for src/engines/local_vlm_daemon.py. Speaks the same Unix
// socket protocol so local-vlm-warm.ts can be tested without MLX or weights.
// FAKE_DAEMON_MODE: ok (default) | die (exit before binding) | slow (sleep per call)
import { createServer } from "node:net";
import { chmodSync, rmSync } from "node:fs";
import { argv, env, exit, pid } from "node:process";

const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i > 0 && i + 1 < argv.length ? argv[i + 1] : dflt;
};
const sock = arg("socket");
const model = arg("model", "");
const idleMs = Number(arg("idle-ms", "600000"));
const queueMax = Number(arg("queue-max", "2"));
const mode = env.FAKE_DAEMON_MODE ?? "ok";
const slowMs = Number(env.FAKE_DAEMON_SLOW_MS ?? 400);
const protocol = Number(env.FAKE_DAEMON_PROTOCOL ?? 1);

if (mode === "die") {
  process.stderr.write("fake daemon refusing to start\n");
  exit(9);
}

const started = Date.now();
let lastActive = Date.now();
let requests = 0;
let inFlight = 0;
let waiting = 0;
let stopping = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = () => ({
  ok: true,
  op: "health",
  protocol,
  pid,
  model,
  loaded: requests > 0,
  loadMs: requests > 0 ? 5 : null,
  requests,
  inFlight,
  waiting,
  uptimeS: (Date.now() - started) / 1000,
  idleS: (Date.now() - lastActive) / 1000,
  idleMs,
  queueMax,
});

const server = createServer((conn) => {
  let buf = "";
  conn.on("data", async (chunk) => {
    buf += chunk.toString("utf8");
    const nl = buf.indexOf("\n");
    if (nl < 0) return;
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      conn.end(JSON.stringify({ ok: false, error: "local_vlm_bad_request: bad json" }) + "\n");
      return;
    }
    const reply = (o) => conn.end(JSON.stringify(o) + "\n");
    const op = req.op ?? "perceive";
    if (op === "health") return reply(health());
    if (op === "stop") {
      stopping = true;
      reply({ ok: true, op: "stop", pid });
      shutdown(0);
      return;
    }
    if (op !== "perceive") return reply({ ok: false, error: `local_vlm_bad_request: unknown op ${op}` });
    if (req.model && req.model !== model) {
      return reply({
        ok: false,
        error: `local_vlm_daemon_model_mismatch: this daemon holds '${model}', request asked for '${req.model}'`,
      });
    }
    if (waiting >= queueMax) {
      return reply({
        ok: false,
        error: `local_vlm_busy: ${waiting} call(s) already waiting for this daemon (queue max ${queueMax})`,
      });
    }
    waiting++;
    while (inFlight > 0) await sleep(10);
    waiting--;
    inFlight++;
    lastActive = Date.now();
    if (mode === "slow") await sleep(slowMs);
    requests++;
    inFlight--;
    lastActive = Date.now();
    reply({
      ok: true,
      // Echo the request so the test can assert what the engine sent, and the
      // count so it can prove the second call hit the same process.
      text: `fake warm ${req.task} of ${req.image} using ${model} call ${requests} pid ${pid}`,
      model,
      ms: 3,
      warm: true,
      loadMs: 5,
      tokens: { input: 11, output: 5 },
    });
  });
});

function shutdown(code) {
  try {
    server.close();
  } catch {
    /* already closed */
  }
  rmSync(sock, { force: true });
  setTimeout(() => exit(code), 30);
}

server.listen(sock, () => {
  chmodSync(sock, 0o600);
  process.stderr.write(`fake_daemon_ready pid=${pid} model=${model}\n`);
});
server.on("error", (err) => {
  process.stderr.write(`fake daemon bind failed: ${err.message}\n`);
  exit(8);
});

setInterval(() => {
  if (stopping) return;
  if (inFlight === 0 && waiting === 0 && Date.now() - lastActive >= idleMs) shutdown(0);
}, 50);
