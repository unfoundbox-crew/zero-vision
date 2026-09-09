import type { Engine, PerceiveInput, PerceptionResult } from "../index.js";
import { loadConfig } from "../index.js";

export const cloudVlm: Engine = {
  id: "cloud-vlm",
  capabilities: ["transcribe", "describe"],
  async perceive(input: PerceiveInput): Promise<PerceptionResult> {
    const task = input.task ?? "describe";
    const cfg = loadConfig().engines?.["cloud-vlm"] ?? {};
    const keyEnv = cfg.apiKeyEnv ?? "GEMINI_API_KEY";
    if (!process.env[keyEnv]) {
      return {
        ok: false,
        engine: "cloud-vlm",
        task,
        text: "",
        ms: 0,
        error: `cloud-vlm refused: ${keyEnv} is unset`,
      };
    }
    if (input.bytes && input.bytes.length > 10 * 1024 * 1024) {
      return {
        ok: false,
        engine: "cloud-vlm",
        task,
        text: "",
        ms: 0,
        error: "cloud-vlm refuses inputs over 10 MB",
      };
    }
    process.stderr.write(
      `engine=cloud-vlm model=${cfg.model ?? "unset"} bytes=${input.bytes?.length ?? "path"}\n`,
    );
    return {
      ok: false,
      engine: "cloud-vlm",
      task,
      text: "",
      ms: 0,
      model: cfg.model,
      error:
        "cloud-vlm is opt-in and not a silent fallback. Provider HTTP is not called in v1 until a provider SDK is an optional peerDependency. Key is present; wire the POST in a follow-up.",
    };
  },
};
