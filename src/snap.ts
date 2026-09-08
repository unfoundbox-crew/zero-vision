import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function snapArgv(opts: { ocr?: boolean; save?: string }): string[] {
  const args = ["-i", "-x", "-t", "png"];
  if (!opts.ocr && !opts.save) args.push("-c");
  return args;
}

export async function runScreencapture(file?: string): Promise<number> {
  const args = file ? ["-i", "-x", "-t", "png", file] : ["-i", "-c", "-x", "-t", "png"];
  return new Promise((resolve) => {
    const child = spawn("/usr/sbin/screencapture", args, { stdio: "inherit" });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

export async function interactiveCapture(opts: { save?: string }): Promise<string | null> {
  const dir = mkdtempSync(join(tmpdir(), "zrv-snap-"));
  const file = join(dir, "snap.png");
  const code = await runScreencapture(file);
  if (code !== 0) {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }
  if (opts.save) copyFileSync(file, opts.save);
  return file;
}
