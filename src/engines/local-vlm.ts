import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Engine, PerceiveInput, PerceptionResult, Task } from "./index.js";
import { loadConfig } from "./index.js";
import { ask, ensureDaemon, socketPath, warmEnabled } from "./local-vlm-warm.js";

// mlx-vlm on Apple silicon. Weights are never downloaded by this engine —
// the runner sets HF_HUB_OFFLINE=1 and we fail closed here first.
// Verified 2026-09-12 with mlx-vlm 0.7.0 and
// mlx-community/Qwen2-VL-2B-Instruct-4bit (1.2 GB on disk).
export const DEFAULT_LOCAL_MODEL = "mlx-community/Qwen3-VL-8B-Instruct-4bit";
const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_BYTES = 30 * 1024 * 1024;

function fail(task: Task, error: string, ms = 0, model?: string): PerceptionResult {
  return { ok: false, engine: "local-vlm", task, text: "", ms, model, error };
}

/** Extension mlx-vlm's image loader will accept, sniffed from the magic bytes. */
function extFromBytes(bytes: Buffer): string {
  if (bytes.length >= 8 && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return ".png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ".jpg";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return ".webp";
  return ".png";
}

/** `~/x` -> `$HOME/x`; everything else untouched. */
function expandHome(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

function hfCacheRoot(): string {
  if (process.env.HF_HUB_CACHE) return process.env.HF_HUB_CACHE;
  if (process.env.HF_HOME) return join(process.env.HF_HOME, "hub");
  return join(homedir(), ".cache", "huggingface", "hub");
}

function looksLikeWeights(dir: string): boolean {
  try {
    if (!statSync(dir).isDirectory()) return false;
  } catch {
    return false;
  }
  return existsSync(join(dir, "config.json"));
}

/** Newest snapshot dir of a cached HF repo, or null. */
function hfSnapshot(repoId: string): string | null {
  const repoDir = join(hfCacheRoot(), `models--${repoId.replace(/\//g, "--")}`);
  const snaps = join(repoDir, "snapshots");
  let entries: string[];
  try {
    entries = readdirSync(snaps);
  } catch {
    return null;
  }
  const candidates = entries
    .map((e) => join(snaps, e))
    .filter(looksLikeWeights)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

export interface ResolvedModel {
  /** What the user asked for (HF id or path). */
  spec: string;
  /** Local directory mlx-vlm should load, or null when nothing is on disk. */
  dir: string | null;
  /** Shell command that would put the weights there. */
  downloadCmd: string;
  /** Path we looked at, for the error message. */
  looked: string;
}

export function resolveModel(spec: string): ResolvedModel {
  const expanded = expandHome(spec);
  const isPath = isAbsolute(expanded) || spec.startsWith(".") || spec.startsWith("~");
  if (isPath) {
    const dir = resolve(expanded);
    return {
      spec,
      dir: looksLikeWeights(dir) ? dir : null,
      looked: dir,
      downloadCmd: `mlx_vlm.convert --hf-path <hf-repo> --mlx-path ${dir} -q   # or copy converted weights there`,
    };
  }
  const snap = hfSnapshot(spec);
  return {
    spec,
    dir: snap,
    looked: join(hfCacheRoot(), `models--${spec.replace(/\//g, "--")}`),
    downloadCmd: `huggingface-cli download ${spec}`,
  };
}

/** `local_vlm_runner.py` next to the compiled JS, else the source-tree copy. */
export function runnerPath(): string {
  // Seam for tests and for anyone shipping their own runner: a script that speaks
  // the JSON-in/JSON-out contract at the top of local_vlm_runner.py.
  if (process.env.ZRV_LOCAL_VLM_RUNNER) return process.env.ZRV_LOCAL_VLM_RUNNER;
  const here = dirname(fileURLToPath(import.meta.url));
  const beside = join(here, "local_vlm_runner.py");
  if (existsSync(beside)) return beside;
  // dist/ without the build's copy step, or running the TS directly.
  return resolve(here, "..", "..", "src", "engines", "local_vlm_runner.py");
}

/** Interpreter with mlx-vlm installed. ZRV_PYTHON wins; the conda env is the documented default. */
export function pythonBin(): string {
  if (process.env.ZRV_PYTHON) return process.env.ZRV_PYTHON;
  const conda = join(homedir(), "miniconda3", "envs", "local-ml-py311", "bin", "python");
  if (existsSync(conda)) return conda;
  return "python3";
}

interface RunnerOut {
  ok?: boolean;
  text?: string;
  model?: string;
  ms?: number;
  tokens?: { input: number; output: number };
  error?: string;
}

export function runRunner(
  bin: string,
  script: string,
  payload: unknown,
  timeoutMs: number,
): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(bin, [script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      stdout += c;
    });
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({ code: code ?? 1, stdout, stderr, timedOut });
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

export const localVlm: Engine = {
  id: "local-vlm",
  capabilities: ["transcribe", "describe"],
  async perceive(input: PerceiveInput): Promise<PerceptionResult> {
    const t0 = Date.now();
    const task = input.task ?? "describe";

    if (input.kind === "video") {
      return fail(task, "local_vlm_bad_input: local-vlm does not take video; extract a frame first");
    }
    if (input.kind === "clipboard" && !input.path) {
      return fail(task, "local_vlm_bad_input: clipboard is not supported; snap to a file first");
    }
    if (input.bytes && input.bytes.length > MAX_BYTES) {
      return fail(task, `local_vlm_too_large: input exceeds 30 MB (got ${input.bytes.length} bytes)`);
    }
    // mlx-vlm reads a file, so byte inputs land in a temp file we delete below.
    let imagePath = input.path;
    let tmpDir: string | undefined;
    if (!imagePath) {
      if (!input.bytes) return fail(task, "local_vlm_bad_input: path required");
      tmpDir = mkdtempSync(join(tmpdir(), "zrv-lvlm-"));
      imagePath = join(tmpDir, `in${extFromBytes(input.bytes)}`);
      writeFileSync(imagePath, input.bytes);
    } else if (!existsSync(imagePath)) {
      return fail(task, "local_vlm_bad_input: input missing");
    }
    try {
      return await run1(task, t0, imagePath);
    } finally {
      if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    }
  },
};

/** One inference, given a real file on disk. Split out so the temp file is always cleaned up. */
async function run1(task: Task, t0: number, imagePath: string): Promise<PerceptionResult> {
  const spec =
    process.env.ZRV_LOCAL_VLM_MODEL || loadConfig().engines?.["local-vlm"]?.modelPath || DEFAULT_LOCAL_MODEL;
  const model = resolveModel(spec);
  if (!model.dir) {
    // Fail closed. This engine never downloads weights (README: "weights must
    // already be on disk"), so name where we looked and how to fix it.
    return fail(
      task,
      `local_vlm_no_weights: no mlx weights for "${spec}" at ${model.looked}. ` +
        `Download them first: ${model.downloadCmd}`,
      Date.now() - t0,
      spec,
    );
  }

  const bin = pythonBin();
  const timeoutMs = Number(process.env.ZRV_LOCAL_VLM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const payload = {
    model: model.dir,
    image: imagePath,
    task,
    maxTokens: Number(process.env.ZRV_LOCAL_VLM_MAX_TOKENS || 512) || 512,
    temperature: 0,
  };

  // Warm first: a daemon that already holds the weights answers in inference
  // time instead of load-plus-inference time. Every reason we could not use it
  // is carried into the cold result as `warmError` rather than swallowed.
  let warmError: string | undefined;
  if (warmEnabled()) {
    const ensured = await ensureDaemon(model.dir, bin);
    if (ensured.ok) {
      const sent = await ask(socketPath(), { op: "perceive", ...payload }, timeoutMs);
      if (sent.ok) {
        const out = sent.reply as RunnerOut & { warm?: boolean };
        return mapOut(out, task, t0, spec, true);
      }
      // The daemon was there and then was not: say so, then pay the cold load.
      warmError = sent.reason;
    } else {
      warmError = ensured.reason;
    }
  }

  const script = runnerPath();
  if (!existsSync(script)) {
    return {
      ...fail(task, `local_vlm_no_runner: runner script missing at ${script}`, Date.now() - t0, spec),
      ...(warmError ? { warmError } : {}),
    };
  }

  let run: { code: number; stdout: string; stderr: string; timedOut: boolean };
  try {
    run = await runRunner(bin, script, payload, timeoutMs);
  } catch (err) {
    return {
      ...fail(
        task,
        `local_vlm_no_python: cannot spawn ${bin} (${err instanceof Error ? err.message : String(err)}). ` +
          "Set ZRV_PYTHON to an interpreter with mlx-vlm installed.",
        Date.now() - t0,
        spec,
      ),
      ...(warmError ? { warmError } : {}),
    };
  }

  if (run.timedOut) {
    return {
      ...fail(task, `local_vlm_timeout: runner exceeded ${timeoutMs}ms`, Date.now() - t0, spec),
      ...(warmError ? { warmError } : {}),
    };
  }

  const line = run.stdout.trim().split("\n").filter(Boolean).at(-1);
  let out: RunnerOut | null = null;
  if (line) {
    try {
      out = JSON.parse(line) as RunnerOut;
    } catch {
      out = null;
    }
  }
  if (!out) {
    const detail = (run.stderr.trim() || run.stdout.trim() || `exit ${run.code}`).slice(-300);
    return {
      ...fail(task, `local_vlm_runner_failed: ${detail}`, Date.now() - t0, spec),
      ...(warmError ? { warmError } : {}),
    };
  }
  return mapOut(out, task, t0, spec, false, warmError);
}

/** One runner reply — warm socket or cold stdout, the shape is identical — to a PerceptionResult. */
function mapOut(
  out: RunnerOut,
  task: Task,
  t0: number,
  spec: string,
  warm: boolean,
  warmError?: string,
): PerceptionResult {
  const extra = { ...(warm ? { warm: true } : {}), ...(warmError ? { warmError } : {}) };
  if (!out.ok) {
    return { ...fail(task, out.error ?? "local_vlm_runner_failed: no error given", Date.now() - t0, spec), ...extra };
  }
  const text = (out.text ?? "").trim();
  if (!text) {
    return { ...fail(task, "local_vlm_empty: runner returned no text", Date.now() - t0, spec), ...extra };
  }
  return {
    ok: true,
    engine: "local-vlm",
    task,
    text,
    ms: Date.now() - t0,
    model: spec,
    ...(out.tokens ? { tokens: out.tokens } : {}),
    ...extra,
  };
}
