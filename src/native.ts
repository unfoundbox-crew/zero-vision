import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));

export function nativeBin(): string | null {
  const env = process.env.ZEROVISION_NATIVE;
  if (env && existsSync(env)) return env;
  const pkg = join(here, "..", "node_modules", "@zero-vision", "darwin-arm64", "bin", "zrv-native");
  if (existsSync(pkg)) return pkg;
  const devRelease = join(here, "..", "native", ".build", "release", "zrv-native");
  if (existsSync(devRelease)) return devRelease;
  const devDebug = join(here, "..", "native", ".build", "debug", "zrv-native");
  if (existsSync(devDebug)) return devDebug;
  return null;
}

export function spawnNative(argv: string[], opts?: { stdin?: Buffer; timeoutMs?: number }): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const bin = nativeBin();
  if (!bin) {
    return Promise.resolve({
      code: 3,
      stdout: JSON.stringify({
        ok: false,
        engine: "apple-vision",
        task: "transcribe",
        text: "",
        ms: 0,
        error: "native unavailable (macOS arm64 binary not installed)",
      }),
      stderr: "",
    });
  }
  return new Promise((resolve, reject) => {
    const child = spawn(bin, argv, { stdio: ["pipe", "pipe", "pipe"] });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("zrv-native timed out"));
    }, opts?.timeoutMs ?? 120_000);
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      stdout += c;
    });
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (opts?.stdin) child.stdin.write(opts.stdin);
    child.stdin.end();
  });
}
