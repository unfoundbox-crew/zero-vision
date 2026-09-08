import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { Engine, PerceiveInput, PerceptionResult } from "./index.js";

function runFm(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("fm", argv, { stdio: ["ignore", "pipe", "pipe"] });
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
    child.on("error", (err) => reject(err));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export const appleFm: Engine = {
  id: "apple-fm",
  capabilities: ["transcribe", "describe"],
  async perceive(input: PerceiveInput): Promise<PerceptionResult> {
    const t0 = Date.now();
    const task = input.task ?? "transcribe";
    if (!existsSync("/usr/bin/fm")) {
      return {
        ok: false,
        engine: "apple-fm",
        task,
        text: "",
        ms: 0,
        error: "apple-fm unavailable",
      };
    }
    if (input.kind === "video") {
      return {
        ok: false,
        engine: "apple-fm",
        task,
        text: "",
        ms: 0,
        error: "apple-fm does not OCR video; use apple-vision",
      };
    }
    if (input.kind === "clipboard" || !input.path) {
      return {
        ok: false,
        engine: "apple-fm",
        task,
        text: "",
        ms: 0,
        error: "apple-fm needs --image path (clipboard: snap to a file first)",
      };
    }
    const prompt =
      task === "describe"
        ? "Describe this image. If it contains text, quote the text."
        : "Transcribe all text verbatim. Do not paraphrase.";
    try {
      const { code, stdout, stderr } = await runFm([
        "respond",
        "--image",
        input.path,
        "--text",
        prompt,
        "--tool",
        "ocr",
        "--no-stream",
      ]);
      const text = stdout.trim();
      if (code !== 0 || !text) {
        return {
          ok: false,
          engine: "apple-fm",
          task,
          text: "",
          ms: Date.now() - t0,
          model: "system",
          error: stderr.trim() || `fm exit ${code}`,
        };
      }
      return {
        ok: true,
        engine: "apple-fm",
        task,
        text,
        ms: Date.now() - t0,
        model: "system",
      };
    } catch (err) {
      return {
        ok: false,
        engine: "apple-fm",
        task,
        text: "",
        ms: Date.now() - t0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
