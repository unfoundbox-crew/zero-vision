import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type EngineId = "apple-vision" | "apple-fm" | "local-vlm" | "cloud-vlm" | "tesseract";
export type Task = "transcribe" | "describe";

export interface PerceiveInput {
  kind: "image" | "video" | "clipboard";
  path?: string;
  bytes?: Buffer;
  task?: Task;
  lang?: string[];
  level?: "accurate" | "fast";
  video?: { mode: "scene" | "interval" | "all-idr"; interval?: number; maxFrames?: number };
}

export interface TextBlock {
  text: string;
  confidence?: number;
  bbox?: { x: number; y: number; w: number; h: number };
}

export interface PerceptionResult {
  ok: boolean;
  engine: EngineId;
  task: Task;
  text: string;
  blocks?: TextBlock[];
  transcript?: { t: number; text: string }[];
  ms: number;
  tokens?: { input: number; output: number };
  costUsd?: number;
  model?: string;
  error?: string;
  /** local-vlm only: this call was served by the warm daemon, no model load. */
  warm?: boolean;
  /** local-vlm only: why the warm daemon was not used, when the cold path ran instead. */
  warmError?: string;
}

export interface Engine {
  id: EngineId;
  capabilities: Task[];
  perceive(input: PerceiveInput): Promise<PerceptionResult>;
}

export interface ZeroVisionConfig {
  engine?: EngineId;
  engines?: {
    "local-vlm"?: { modelPath?: string };
    "cloud-vlm"?: { provider?: string; model?: string; apiKeyEnv?: string; baseUrl?: string };
  };
}

const ENGINES: EngineId[] = ["apple-vision", "apple-fm", "local-vlm", "cloud-vlm", "tesseract"];

export function isEngineId(s: string): s is EngineId {
  return (ENGINES as string[]).includes(s);
}

export function loadConfig(): ZeroVisionConfig {
  const path = join(homedir(), ".config", "zero-vision", "config.json");
  try {
    return JSON.parse(readFileSync(path, "utf8")) as ZeroVisionConfig;
  } catch {
    return {};
  }
}

export function resolveEngine(cli?: string): EngineId {
  if (cli && isEngineId(cli)) return cli;
  if (cli) throw new Error(`unknown engine: ${cli}`);
  const env = process.env.ZEROVISION_ENGINE;
  if (env && isEngineId(env)) return env;
  const cfg = loadConfig().engine;
  if (cfg && isEngineId(cfg)) return cfg;
  // Linux has no Apple frameworks: tesseract is the local default there.
  // Same on Intel Macs, where the arm64 native binary cannot run.
  if (process.platform === "linux") return "tesseract";
  if (process.platform === "darwin" && process.arch === "x64") return "tesseract";
  return "apple-vision";
}

export async function perceive(engine: EngineId, input: PerceiveInput): Promise<PerceptionResult> {
  const task: Task = input.task ?? "transcribe";
  if (engine === "apple-vision" && task === "describe") {
    return {
      ok: false,
      engine,
      task,
      text: "",
      ms: 0,
      error: "engine apple-vision cannot describe; use apple-fm, local-vlm, or cloud-vlm",
    };
  }
  switch (engine) {
    case "apple-vision": {
      const { appleVision } = await import("./apple-vision.js");
      return appleVision.perceive(input);
    }
    case "apple-fm": {
      const { appleFm } = await import("./apple-fm.js");
      return appleFm.perceive(input);
    }
    case "local-vlm": {
      const { localVlm } = await import("./local-vlm.js");
      return localVlm.perceive(input);
    }
    case "cloud-vlm": {
      const { cloudVlm } = await import("./cloud/index.js");
      return cloudVlm.perceive(input);
    }
    case "tesseract": {
      const { tesseract } = await import("./tesseract.js");
      return tesseract.perceive(input);
    }
  }
}
