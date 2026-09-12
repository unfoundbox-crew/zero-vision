import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { Engine, PerceiveInput, PerceptionResult, Task } from "../index.js";
import { loadConfig } from "../index.js";

// One OpenAI-compatible `POST /chat/completions` with `image_url` content. Any
// endpoint that speaks that wire format works; the default target is the
// self-hosted LiteLLM proxy, which fronts every subscription behind one key.
//
// Default model `gemini-3.7-flash` — verified 2026-09-12 to be listed by the
// proxy's `/v1/models` and to accept `image_url` content (live transcribe +
// describe on fixtures/ocr, see CHANGELOG 0.2.0). Cost is whatever the
// subscription behind the proxy costs, so this engine reports `costUsd` only
// when the endpoint returns `usage.cost`.
//
// Alternate configs, both just a different base URL + key:
//   OpenRouter     ZRV_CLOUD_VLM_BASE_URL=https://openrouter.ai/api/v1
//                  ZRV_CLOUD_VLM_KEY_ENV=OPENROUTER_API_KEY
//                  models checked 2026-09-12: qwen/qwen3.7-flash ($0.03/$0.13
//                  per 1M, cheapest image-capable), inclusionai/ling-3.0-flash-vl
//                  ($0.06/$0.18), google/gemini-3.1-flash-lite ($0.25/$1.50)
//   Gemini direct  ZRV_CLOUD_VLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
//                  ZRV_CLOUD_VLM_KEY_ENV=GEMINI_PRIMARY_API_KEY
export const DEFAULT_CLOUD_MODEL = "gemini-3.7-flash";
// Localhost, never a hardcoded tailnet address — same convention as pet-talk's
// `server/settings.py`. Point LITELLM_BASE_URL (or ZRV_CLOUD_VLM_BASE_URL) at
// the proxy when it is not on this machine.
export const DEFAULT_CLOUD_BASE_URL = "http://127.0.0.1:8000/v1";
export const DEFAULT_CLOUD_KEY_ENV = "LITELLM_MASTER_KEY";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BYTES = 10 * 1024 * 1024;

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

function sniffMime(bytes: Buffer, path?: string): string {
  if (bytes.length >= 8 && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp";
  if (path) {
    const m = MIME[extname(path).toLowerCase()];
    if (m) return m;
  }
  return "image/png";
}

function fail(task: Task, error: string, ms = 0, model?: string): PerceptionResult {
  return { ok: false, engine: "cloud-vlm", task, text: "", ms, model, error };
}

const PROMPT: Record<Task, string> = {
  transcribe:
    "Transcribe every piece of text in this image verbatim, in reading order. Output only the text. Do not paraphrase, summarize, translate, or add commentary.",
  describe:
    "Describe this image concisely and concretely: layout, notable elements, and any state a reader would need. If it contains text, quote the text. No preamble.",
};

interface ChatResponse {
  choices?: { message?: { content?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  model?: string;
  error?: { message?: string; code?: number | string };
}

export const cloudVlm: Engine = {
  id: "cloud-vlm",
  capabilities: ["transcribe", "describe"],
  async perceive(input: PerceiveInput): Promise<PerceptionResult> {
    const t0 = Date.now();
    const task = input.task ?? "describe";
    const cfg = loadConfig().engines?.["cloud-vlm"] ?? {};

    // Opt-in only. perceive() reaches here solely because the caller named
    // --engine cloud-vlm; nothing in the engine rank falls through to it.
    // A literal key in ZRV_CLOUD_VLM_API_KEY wins; otherwise ZRV_CLOUD_VLM_KEY_ENV
    // (or the config file's apiKeyEnv) names the variable to read, defaulting to
    // the LiteLLM proxy's key. The config file never holds a key value.
    const keyEnv = process.env.ZRV_CLOUD_VLM_KEY_ENV || cfg.apiKeyEnv || DEFAULT_CLOUD_KEY_ENV;
    const key = process.env.ZRV_CLOUD_VLM_API_KEY || process.env[keyEnv];
    if (!key) {
      return fail(
        task,
        `cloud_vlm_no_key: neither ZRV_CLOUD_VLM_API_KEY nor ${keyEnv} is set; cloud-vlm never runs without an explicit key`,
      );
    }

    if (input.kind === "video") {
      return fail(task, "cloud_vlm_bad_input: cloud-vlm does not take video; extract a frame first");
    }
    if (input.kind === "clipboard" && !input.bytes && !input.path) {
      return fail(task, "cloud_vlm_bad_input: clipboard is not supported; snap to a file first");
    }

    let bytes = input.bytes;
    if (!bytes) {
      if (!input.path) return fail(task, "cloud_vlm_bad_input: path required");
      try {
        bytes = await readFile(input.path);
      } catch {
        return fail(task, "cloud_vlm_bad_input: input missing");
      }
    }
    if (bytes.length > MAX_BYTES) {
      return fail(task, `cloud_vlm_too_large: cloud-vlm refuses inputs over 10 MB (got ${bytes.length} bytes)`);
    }

    const model = process.env.ZRV_CLOUD_VLM_MODEL || cfg.model || DEFAULT_CLOUD_MODEL;
    const baseUrl = (
      process.env.ZRV_CLOUD_VLM_BASE_URL ||
      cfg.baseUrl ||
      process.env.LITELLM_BASE_URL ||
      process.env.LLM_BASE_URL ||
      DEFAULT_CLOUD_BASE_URL
    ).replace(/\/+$/, "");
    const isOpenRouter = baseUrl.includes("openrouter.ai");
    const timeoutMs = Number(process.env.ZRV_CLOUD_VLM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    const dataUrl = `data:${sniffMime(bytes, input.path)};base64,${bytes.toString("base64")}`;

    const body = {
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT[task] },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      // OCR is not a creative task.
      temperature: 0,
      // Bounded, and not only for cost: OpenRouter prices the reservation, so an
      // unbounded request 402s on a low-credit key even when the answer is tiny.
      max_tokens: Number(process.env.ZRV_CLOUD_VLM_MAX_TOKENS || 1024) || 1024,
      // OpenRouter-only knob that returns usage.cost. Gemini's own
      // OpenAI-compatible endpoint 400s on an unknown field (measured 2026-09-12),
      // so only send it where it exists.
      ...(isOpenRouter ? { usage: { include: true } } : {}),
    };

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: ac.signal,
        headers: {
          // Never logged, never written to a file, never echoed in an error.
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
          // Attribution headers OpenRouter reads; meaningless elsewhere.
          ...(isOpenRouter
            ? { "http-referer": "https://github.com/unfoundbox-crew/zero-vision", "x-title": "zero-vision" }
            : {}),
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const aborted = ac.signal.aborted || (err instanceof Error && err.name === "AbortError");
      return fail(
        task,
        aborted
          ? `cloud_vlm_timeout: no response in ${timeoutMs}ms`
          : `cloud_vlm_network: ${err instanceof Error ? err.message : String(err)}`,
        Date.now() - t0,
        model,
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await res.text().catch(() => "");
    if (!res.ok) {
      // A provider body can echo the request; keep it short, never include the key.
      const detail = raw.slice(0, 300).replace(/\s+/g, " ").trim();
      return fail(task, `cloud_vlm_http_${res.status}: ${detail || res.statusText}`, Date.now() - t0, model);
    }

    let parsed: ChatResponse;
    try {
      parsed = JSON.parse(raw) as ChatResponse;
    } catch {
      return fail(task, `cloud_vlm_bad_response: not JSON (${raw.slice(0, 120)})`, Date.now() - t0, model);
    }
    if (parsed.error?.message) {
      return fail(task, `cloud_vlm_provider_error: ${parsed.error.message}`, Date.now() - t0, model);
    }

    const text = (parsed.choices?.[0]?.message?.content ?? "").trim();
    if (!text) {
      return fail(task, "cloud_vlm_empty: provider returned no text", Date.now() - t0, parsed.model ?? model);
    }

    const usage = parsed.usage;
    return {
      ok: true,
      engine: "cloud-vlm",
      task,
      text,
      ms: Date.now() - t0,
      model: parsed.model ?? model,
      ...(usage && (usage.prompt_tokens != null || usage.completion_tokens != null)
        ? { tokens: { input: usage.prompt_tokens ?? 0, output: usage.completion_tokens ?? 0 } }
        : {}),
      ...(typeof usage?.cost === "number" ? { costUsd: usage.cost } : {}),
    };
  },
};
