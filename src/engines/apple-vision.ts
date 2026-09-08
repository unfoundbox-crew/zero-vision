import { writeFileSync, mkdtempSync, rmSync, realpathSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnNative } from "../native.js";
import type { Engine, PerceiveInput, PerceptionResult } from "./index.js";

function parseJson(stdout: string): PerceptionResult {
  const line = stdout.trim().split("\n").filter(Boolean).at(-1) ?? "{}";
  try {
    const raw = JSON.parse(line) as PerceptionResult;
    return { ...raw, engine: "apple-vision", task: raw.task ?? "transcribe" };
  } catch {
    return {
      ok: false,
      engine: "apple-vision",
      task: "transcribe",
      text: "",
      ms: 0,
      error: `native json parse failed: ${line.slice(0, 200)}`,
    };
  }
}

export const appleVision: Engine = {
  id: "apple-vision",
  capabilities: ["transcribe"],
  async perceive(input: PerceiveInput): Promise<PerceptionResult> {
    const task = input.task ?? "transcribe";
    const level = input.level ?? "accurate";
    const langs = input.lang ?? ["en-US"];
    const langArgs = langs.flatMap((l) => ["--lang", l]);

    if (input.kind === "clipboard") {
      const { stdout, stderr } = await spawnNative(["ocr-clipboard", "--level", level, ...langArgs, "--json"]);
      return parseJson(stdout || stderr);
    }

    let path = input.path;
    let tmp: string | undefined;
    if (input.bytes) {
      if (input.bytes.length > 30 * 1024 * 1024) {
        return { ok: false, engine: "apple-vision", task, text: "", ms: 0, error: "input exceeds 30 MB" };
      }
      tmp = mkdtempSync(join(tmpdir(), "zrv-"));
      path = join(tmp, "in.bin");
      writeFileSync(path, input.bytes);
    }
    if (!path) {
      return { ok: false, engine: "apple-vision", task, text: "", ms: 0, error: "path required" };
    }
    if (!tmp) {
      try {
        path = realpathSync(path);
        if (!statSync(path).isFile()) {
          return { ok: false, engine: "apple-vision", task, text: "", ms: 0, error: "path required" };
        }
      } catch {
        return { ok: false, engine: "apple-vision", task, text: "", ms: 0, error: "input missing" };
      }
    }
    try {
      if (input.kind === "video") {
        const mode = input.video?.mode ?? "scene";
        const interval = String(input.video?.interval ?? 2);
        const maxFrames = String(input.video?.maxFrames ?? 60);
        const { stdout, stderr } = await spawnNative(
          [
            "ocr-video",
            "--input",
            path,
            "--mode",
            mode,
            "--interval",
            interval,
            "--max-frames",
            maxFrames,
            "--level",
            level,
            ...langArgs,
            "--json",
          ],
          { timeoutMs: 180_000 },
        );
        return parseJson(stdout || stderr);
      }
      const { stdout, stderr } = await spawnNative(["ocr-image", "--input", path, "--level", level, ...langArgs, "--json"]);
      return parseJson(stdout || stderr);
    } finally {
      if (tmp) rmSync(tmp, { recursive: true, force: true });
    }
  },
};
