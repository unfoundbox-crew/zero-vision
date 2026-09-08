import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Engine, PerceiveInput, PerceptionResult } from "./index.js";
import { loadConfig } from "./index.js";

const DEFAULT_MODEL = join(
  homedir(),
  ".cache/huggingface/hub/models--mlx-community--Qwen3-VL-8B-Instruct-4bit",
);

export const localVlm: Engine = {
  id: "local-vlm",
  capabilities: ["transcribe", "describe"],
  async perceive(input: PerceiveInput): Promise<PerceptionResult> {
    const task = input.task ?? "describe";
    const cfg = loadConfig().engines?.["local-vlm"]?.modelPath ?? DEFAULT_MODEL;
    const modelPath = cfg.startsWith("~") ? join(homedir(), cfg.slice(1)) : cfg;
    if (!existsSync(modelPath)) {
      return {
        ok: false,
        engine: "local-vlm",
        task,
        text: "",
        ms: 0,
        error: `local-vlm weights missing at ${modelPath}`,
      };
    }
    if (input.kind === "video") {
      return {
        ok: false,
        engine: "local-vlm",
        task,
        text: "",
        ms: 0,
        error: "local-vlm does not take video in v1; extract a frame first",
      };
    }
    // Runner is opt-in and unflown. Fail closed rather than shelling a 5 GB model
    // from a test or an accidental default.
    return {
      ok: false,
      engine: "local-vlm",
      task,
      text: "",
      ms: 0,
      model: "Qwen3-VL-8B-Instruct-4bit",
      error:
        "local-vlm is wired for presence-check only in v1. Weights are on disk. Set ZEROVISION_LIVE_VLM=1 in a later release to spawn the MLX runner. Use apple-vision to transcribe.",
    };
  },
};
