---
title: zero-vision architecture
product: zero-vision
version: 1.1.0
status: living
updated: 2026-09-12
verified_against: feat/real-vlm-engines
owners: [unfoundbox-crew]
supersedes: []
---

## Purpose

zero-vision reads a Chrome tab, an image, a PDF page, or a local video as
text, ranking cheap local engines first and never falling back to cloud
silently. It is consumed as a CLI (`zrv`) and an MCP server (`zrv mcp`) by
pet-talk, realengine, and MotionVector. It is not a browser driver: it never
clicks, types, or navigates without an explicit flag.

## System diagram

```mermaid
flowchart LR
    subgraph Callers
        PT[pet-talk server/eyes.py]
        RE[realengine qa/asserts.py]
        AG[any MCP client]
        HU[human, TTY]
    end
    CLI[zrv CLI]
    MCP[zrv mcp / stdio]
    PT -->|subprocess: zrv ocr file --task T --json| CLI
    RE -->|subprocess: zrv ocr file --engine E| CLI
    HU --> CLI
    AG -->|stdio JSON-RPC| MCP
    CLI --> PERCEIVE[perceive dispatcher]
    MCP --> PERCEIVE
    CLI --> CDP[CDP reader]
    CDP -->|ws :1948 or :9223, never :9222 by default| CHROME[(debug Chrome)]
    PERCEIVE --> AV[apple-vision: spawn zrv-native]
    PERCEIVE --> FM[apple-fm: spawn /usr/bin/fm]
    PERCEIVE --> LV[local-vlm: spawn python runner]
    PERCEIVE --> CV[cloud-vlm: POST chat/completions]
    PERCEIVE --> TS[tesseract: tesseract.js or system binary]
    AV --> NATIVE[(zrv-native Swift binary)]
    LV --> MLX[(mlx-vlm + weights on disk)]
    CV -->|OpenAI-compatible HTTPS| PROXY[(LiteLLM proxy / OpenRouter / Gemini)]
```

```text
zrv/zrv-mcp --+-- CDP reader --ws--> debug Chrome (:1948, :9223)
              |
              +-- perceive() --+-- apple-vision --spawn--> zrv-native (Swift)
                                +-- apple-fm     --spawn--> /usr/bin/fm
                                +-- local-vlm    --spawn--> python local_vlm_runner.py -> mlx-vlm
                                +-- cloud-vlm    --POST--> OpenAI-compatible /chat/completions
                                +-- tesseract    --spawn--> tesseract binary
                                                  --or--> tesseract.js (wasm)
Callers: pet-talk (server/eyes.py), realengine (qa/asserts.py), any MCP client
```

## Components

| Component | File/dir | Job | Interface it exposes |
| --- | --- | --- | --- |
| CLI entry | `src/cli.ts` | Parse argv, dispatch to CDP or `perceive()`, print text/JSON | `zrv`, `zrv ocr`, `zrv snap`, `zrv mcp` (argv) |
| MCP server | `src/mcp.ts` | stdio JSON-RPC wrapper over the same CDP + perceive calls | 5 tools, see Interfaces |
| Engine registry | `src/engines/index.ts` | `EngineId` type, `resolveEngine()`, `perceive()` dispatcher, config load | `perceive(engine, input): Promise<PerceptionResult>` |
| apple-vision engine | `src/engines/apple-vision.ts` | Spawns `zrv-native`, maps stdout JSON to `PerceptionResult` | in-process function |
| apple-fm engine | `src/engines/apple-fm.ts` | Spawns `/usr/bin/fm respond --image ... --tool ocr` | in-process function |
| local-vlm engine | `src/engines/local-vlm.ts` | Resolves weights (HF cache id or dir), spawns the Python runner, maps its JSON to `PerceptionResult` | in-process function; `resolveModel()`, `runnerPath()`, `pythonBin()` exported for tests |
| local-vlm runner | `src/engines/local_vlm_runner.py` | One mlx-vlm inference. JSON on stdin, one JSON object on stdout. Sets `HF_HUB_OFFLINE=1` before importing anything | stdin/stdout JSON contract, documented in its own docstring |
| cloud-vlm engine | `src/engines/cloud/index.ts` | One OpenAI-compatible `POST /chat/completions` with a base64 data-URL `image_url`; maps the reply to `PerceptionResult` | in-process function; `DEFAULT_CLOUD_MODEL`/`_BASE_URL`/`_KEY_ENV` exported |
| tesseract engine | `src/engines/tesseract.ts` | System `tesseract` binary or `tesseract.js` wasm; ffmpeg for video | in-process function |
| Native binary resolver | `src/native.ts` | Locates `zrv-native`: `ZEROVISION_NATIVE`, installed package, dev build dirs | `nativeBin()`, `spawnNative()` |
| CDP client | `src/cdp/client.ts` | Raw WebSocket JSON-RPC to a Chrome debug target | `CdpClient` |
| CDP attach | `src/cdp/attach.ts` | Port probing, tab listing/picking, `Target.attachToTarget` | `attach()`, `findOpenPort()`, `listTabs()`, `pickTab()`, `probePorts()` |
| CDP extract | `src/cdp/extract.ts` | AX-tree walk to text/markdown/YAML, selector reads, opaque-region detection, screenshot capture, plain fetch | `extractPage()`, `extractSelector()`, `captureScreenshot()`, `fetchUrl()` |
| Snap | `src/snap.ts` | Wraps `/usr/sbin/screencapture` for interactive capture | `interactiveCapture()`, `runScreencapture()` |
| Build asset copy | `scripts/copy-assets.mjs` | `tsc` emits no `.py`; copies the runner into `dist/engines/` so the published package is self-contained | `npm run build` |
| Native OCR binary | `native/Sources/zrv-native/main.swift` | Swift executable: Vision OCR on images/clipboard/video via AVFoundation | subcommands `ocr-image`, `ocr-clipboard`, `ocr-video` (JSON on stdout) |

## Interfaces

### CLI (`zrv`, verified against `zrv --help` on the installed binary at `~/.local/bin/zrv`)

| Command / flag | Shape | Consumer |
| --- | --- | --- |
| `zrv [--md\|--a11y] [--tab id] [--url u] [--engine e] [--json]` | Reads the attached/default Chrome tab. `--md` markdown, `--a11y` AX YAML, default cleaned text | humans, agents |
| `zrv --selector <css> [--tab id] [--url u]` | Text of one CSS-matched element only | humans, agents |
| `zrv --tabs [--port n]` | Lists attachable tabs, `id\ttitle\turl` per line | humans, agents |
| `zrv --url <u> [--navigate\|--fetch]` | `--navigate` opens/creates a tab and reads it; `--fetch` does a plain HTTP GET, no JS | humans, agents |
| `zrv --wait-ms N`, `zrv --wait-text GLOB`, `zrv --scroll` | Extraction timing/behavior flags, passed to `extractPage()` | humans, agents |
| `zrv --ocr-opaque` | If canvas/video coverage ≥30% of viewport, screenshots those regions and OCRs them with the current engine, appended under `--- opaque ocr ---` | humans, agents |
| `zrv ocr <file> [--engine e] [--task transcribe\|describe] [--lang L] [--level fast\|accurate]` | OCR/describe a local image or video file. Video detected by extension (`mp4`, `mov`, `m4v`, `webm`) | pet-talk, realengine, humans |
| `zrv ocr <file> [--mode scene\|interval\|all-idr] [--interval s] [--max-frames n]` | Video keyframe tuning, only meaningful when `file` is a video | pet-talk, realengine, humans |
| `zrv ocr --clipboard` | OCRs the current image clipboard | humans |
| `zrv ocr ... --json` | Emits one `PerceptionResult` JSON object on stdout instead of plain text | pet-talk, realengine |
| `zrv snap [--ocr] [--save path]` | Interactive `screencapture -i`; `--ocr` also OCRs and copies text to clipboard | humans only (needs TTY + GUI session) |
| `zrv mcp` | Starts the stdio MCP server (same process as `zrv-mcp` bin) | MCP clients |

Exit codes (from `src/cli.ts` `failCode()`): 0 ok; 1 usage or `cannot describe`; 2 input/path missing; 3 engine unavailable (weights/key/binary missing); 4 other engine failure. `zrv ocr --clipboard` without a following positional file does **not** call `usage()` — it runs and returns, unlike the spec's implied uniform usage() path; verified by reading `cli.ts`, not run live.

Note: `zrv --help` and `zrv ocr --help` print the identical generic usage block (verified live) — there is no per-subcommand help text.

### MCP (`zrv mcp`, stdio, SDK `@modelcontextprotocol/sdk`) — verified against `src/mcp.ts`

| Tool | Input shape | Output |
| --- | --- | --- |
| `peek_tabs` | `{ port?: number }` | `{ port, tabs: TabInfo[] }` as JSON text |
| `peek_page` | `{ targetId?, url?, format?: "text"\|"markdown", navigate?, fetch?, ocrOpaque?, waitMs?, waitText?, scroll?, selector?, port?, engine? }` | `{ title, url, text, opaque }` (or `{title,url,text}` when `selector` given) |
| `peek_a11y` | `{ targetId?, url?, navigate?, port?, verbose?, engine? }` | Raw AX YAML text |
| `ocr_image` | exactly one of `path` \| `base64` \| `clipboard`, plus `engine?, task?, level?, lang?` | Full `PerceptionResult` JSON |
| `ocr_video` | `path` (required), `mode?, interval?, maxFrames?, engine?, task?, level?, lang?` | Full `PerceptionResult` JSON |

`engine` enum accepted by tool schemas: `apple-vision`, `apple-fm`, `local-vlm`, `cloud-vlm`, `tesseract` (`peek_a11y`'s schema loosely types `engine` as any string, verified by reading `src/mcp.ts`).

### `PerceptionResult` JSON shape (`src/engines/index.ts`, shared by CLI `--json` and every MCP tool)

```ts
{
  ok: boolean;
  engine: "apple-vision" | "apple-fm" | "local-vlm" | "cloud-vlm" | "tesseract";
  task: "transcribe" | "describe";
  text: string;
  blocks?: { text, confidence?, bbox? }[];
  transcript?: { t: number, text: string }[];  // video only
  ms: number;
  tokens?: { input, output };
  costUsd?: number;
  model?: string;
  error?: string;
}
```

### Engine ids and selection

Not an engine: **Chrome AX / CDP text** is the default producer for tab reads (`zrv` with no `ocr`/`snap`/`mcp` subcommand). It is always local, never routed through `perceive()`, and has no `EngineId` value — README and `docs-agent/llms.txt` list it first in the "rank" alongside the five real engine ids, which reads as one list of six choices but is actually one producer (CDP) plus five pixel engines.

`resolveEngine()` order: `--engine` flag → `ZEROVISION_ENGINE` env → `~/.config/zero-vision/config.json` `engine` field → platform default (`tesseract` on Linux and on Intel/x64 Mac, else `apple-vision`).

| Engine id | Chosen when | Verified behavior |
| --- | --- | --- |
| `apple-vision` | Default on Apple-silicon macOS | Spawns `zrv-native ocr-image\|ocr-clipboard\|ocr-video`. `capabilities: ["transcribe"]` only — rejects `task: describe` with `engine apple-vision cannot describe; use apple-fm, local-vlm, or cloud-vlm` |
| `apple-fm` | Named explicitly (`--engine apple-fm`) | Shells to `/usr/bin/fm respond --image <path> --text <prompt> --tool ocr --no-stream`. Refuses video and clipboard inputs. Measured 2026-09-12: ~102s for `describe` on one 2280×600 PNG (pet-talk `EyesConfig` docstring) |
| `local-vlm` | Named explicitly | Real mlx-vlm inference. Spawns `pythonBin() local_vlm_runner.py` with JSON on stdin. `capabilities: ["transcribe","describe"]`. Weights are never downloaded: `resolveModel()` looks up an `mlx-community` HF id in the local HF cache (or takes a directory) and returns `local_vlm_no_weights` naming the path and the download command when nothing is there. Refuses video and clipboard. 30 MB cap. Measured 2026-09-12, one 1280x800 PNG, `mlx-community/Qwen2-VL-2B-Instruct-4bit` (1.2 GB, 4-bit) at `nice 19`, cold process: **13.1 s transcribe, 12.6 s describe** |
| `cloud-vlm` | Named explicitly | Real HTTP. One `POST {baseUrl}/chat/completions`, OpenAI-compatible, image as a base64 data URL, `temperature: 0`, bounded `max_tokens`. No SDK — plain `fetch`. Endpoint: `ZRV_CLOUD_VLM_BASE_URL` → config `baseUrl` → `LITELLM_BASE_URL` → `LLM_BASE_URL` → `http://127.0.0.1:8000/v1`. Key: `ZRV_CLOUD_VLM_API_KEY` → the variable named by `ZRV_CLOUD_VLM_KEY_ENV` / config `apiKeyEnv` (default `LITELLM_MASTER_KEY`). Model: `ZRV_CLOUD_VLM_MODEL`, default `claude-sonnet-4-6` (set 2026-09-12: the prior default `gemini-3.7-flash` is out of daily quota on the proxy; swap back with the env var once it resets). Verified live 2026-09-12 through the self-hosted LiteLLM proxy: `gemini-3.7-flash` `transcribe` on `fixtures/ocr/hello.png` returned "HELLO ZEROVISION" in 4.2 s; its `describe` hit Gemini's own daily quota 429, so both `transcribe` and `describe` were proved on the same proxy with `claude-sonnet-4-6` (5.8 s / 6.0 s on a 1280x800 PNG). Refuses video and clipboard. 10 MB cap. Fail-closed on a silent proxy reroute (found 2026-09-12 live, same proxy: a `claude-sonnet-4-6` request came back served by `openai/gpt-oss-20b`, text-only, which returned `ok:true` with a refusal sentence): the response's `model` is compared against the requested one (provider prefixes and version/date suffixes normalized away) and any mismatch fails `cloud_vlm_model_mismatch` naming both ids, unless `ZRV_CLOUD_VLM_ALLOW_REROUTE=1`; independently, the reply text is scanned for a non-vision refusal and fails `cloud_vlm_no_vision` if found, even when the model id matches |
| `tesseract` | Default on Linux and Intel/x64 macOS | System `tesseract` binary (TSV output, word-level blocks) if on PATH, else `tesseract.js` wasm. Video via `ffmpeg` keyframe extraction, both fail-closed if missing. `capabilities: ["transcribe"]` only |

### Cross-product edges (see below), MCP tools, engine ids above are the full external contract surface as of this commit.

## Data & state

- No database, no persistent daemon. Every CLI/MCP call is stateless per invocation.
- Config file `~/.config/zero-vision/config.json` (optional): `engine` default, `engines["local-vlm"].modelPath`, `engines["cloud-vlm"].{provider,model,apiKeyEnv,baseUrl}`. Never holds API key values — those are env-only (`apiKeyEnv` names the variable; `loadConfig()`/`cloud-vlm` never read a key value from this file). Env wins over config for both engines.
- `cloud-vlm` env: `ZRV_CLOUD_VLM_BASE_URL`, `ZRV_CLOUD_VLM_API_KEY`, `ZRV_CLOUD_VLM_KEY_ENV`, `ZRV_CLOUD_VLM_MODEL`, `ZRV_CLOUD_VLM_TIMEOUT_MS` (60000), `ZRV_CLOUD_VLM_MAX_TOKENS` (1024); falls back to `LITELLM_BASE_URL` / `LITELLM_MASTER_KEY`.
- `local-vlm` env: `ZRV_LOCAL_VLM_MODEL`, `ZRV_PYTHON`, `ZRV_LOCAL_VLM_TIMEOUT_MS` (180000), `ZRV_LOCAL_VLM_MAX_TOKENS` (512), `ZRV_LOCAL_VLM_RUNNER` (runner-script seam). HF cache location honours `HF_HUB_CACHE` / `HF_HOME`.
- `local-vlm` byte input is written to an `mkdtempSync` temp file (mlx-vlm reads a path) and removed in a `finally`. `cloud-vlm` never writes a file — bytes go straight into the data URL.
- The API key is put in one place only: the `authorization` request header. It is never logged, never written to a file, and error strings truncate provider bodies to 300 chars and are asserted not to contain it.
- Temp files: `mkdtempSync` under the OS tmp dir for byte inputs (image bytes, clipboard grabs, video frame extraction), removed in a `finally`/at the end of the call. `apple-vision`, `tesseract`, and MCP `ocr_image` base64 all follow this pattern.
- Nothing is cached between calls. `local-vlm`'s weights path and `cloud-vlm`'s key are re-checked every call.
- Never persisted or logged: image bytes, page text to files (per spec §13; verified only for the base64/clipboard temp-file lifecycle, not for an exhaustive absence of any stderr echo).

## Cross-product edges

| Other product | Direction | Mechanism | Contract file |
| --- | --- | --- | --- |
| pet-talk | pet-talk → zero-vision | Subprocess: `zrv ocr <path> --task <transcribe\|describe> [--engine <pin>] --json`, parses the `PerceptionResult` JSON from stdout | `pet-talk/server/eyes.py` (class doc names verified flags "2026-09-12"); `EYES_TIMEOUT_S` defaults to 8.0s, far below the ~102s measured `apple-fm describe` latency, so a describe call through pet-talk with the default timeout is expected to time out — unverified whether pet-talk raises this timeout for `apple-fm` specifically |
| realengine | realengine → zero-vision | Subprocess: `zrv ocr <png> --engine <ZERO_VISION_ENGINE, default "tesseract">`, plain-text stdout (no `--json`), used by `labels_present()` in its QA gate | `realengine/qa/asserts.py` |
| MotionVector | none confirmed in this pass | README lists MotionVector/`mvec` as a consumer for contact sheets and title cards after `mvec frame` | not verified — no grep run against the motionvector repo in this pass |

## Invariants

1. Never attach to Chrome debug port 9222 by default — enforced in `src/cdp/attach.ts` `probePorts()`, only added when `ZEROVISION_ALLOW_USER_CHROME=1`.
2. Never navigate an existing tab — `--url` without `--navigate` only reads; `--navigate` opens a new tab or reuses an exact match, never redirects one. Enforced in `attach()`.
3. `cloud-vlm` never runs without a key, and never sends bytes over 10MB. Enforced in `src/engines/cloud/index.ts`; covered by `src/test/cloud-vlm.test.ts`, which also asserts no request is sent at all on a refusal.
3b. `cloud-vlm` is reached only when the caller names `--engine cloud-vlm`. `resolveEngine()` can never return it from a platform default, and no engine failure routes to it. Covered by `src/test/engines.test.ts`.
3c. `local-vlm` never downloads weights. Two locks: the engine returns `local_vlm_no_weights` before spawning, and the runner sets `HF_HUB_OFFLINE=1`/`TRANSFORMERS_OFFLINE=1` before importing `mlx_vlm`.
3d. `cloud-vlm` never treats a proxy's silent model reroute, or a text-only refusal dressed as `ok:true`, as success. Two independent checks in `src/engines/cloud/index.ts`: served-vs-requested `model` id (`cloud_vlm_model_mismatch`, opt-out via `ZRV_CLOUD_VLM_ALLOW_REROUTE=1`) and a refusal-pattern scan of the reply text (`cloud_vlm_no_vision`), either of which fails closed regardless of the other. Covered by `src/test/cloud-vlm.test.ts`; found live 2026-09-12 when the proxy served `openai/gpt-oss-20b` for a `claude-sonnet-4-6` request.
4. `apple-vision` and `tesseract` refuse `task: describe` rather than guessing. Enforced in `perceive()` (apple-vision) and `tesseract.ts` (self-check).
5. Byte inputs are capped at 30MB (`apple-vision`, `tesseract`, `local-vlm`) and 10MB (`cloud-vlm`). Enforced per-engine, not centrally — a new engine must repeat this check itself; no shared guard in `perceive()`.
6. Contact sheets are one image, never split into a grid. Unenforced in code — there is no grid-splitting code path to disable; this is a design absence, not a runtime check.

## Known gaps

- **Closed 2026-09-12** (was: `local-vlm` and `cloud-vlm` never run inference): both now run real inference and the docs carry env tables, error names, and measured latencies. See `CHANGELOG.md` 0.2.0.
- **Closed 2026-09-12** (was: the LiteLLM proxy could silently reroute `cloud-vlm`'s requested model to a text-only one, which then returned `ok:true` with a refusal — a fake green): `cloud-vlm` now fails closed with `cloud_vlm_model_mismatch` or `cloud_vlm_no_vision`. See `CHANGELOG.md` Unreleased.
- 2026-09-12, new: on this machine's proxy, the *default* model `claude-sonnet-4-6` is itself currently rerouted to `openai/gpt-oss-20b` — the live smoke run for this fix hit `cloud_vlm_model_mismatch` on the default, unmodified config (see `CHANGELOG.md` Unreleased for the raw JSON). `cloud-vlm` is doing its job — failing closed instead of returning a refusal as text — but the proxy's routing table needs fixing, or a working model needs naming via `ZRV_CLOUD_VLM_MODEL`, before `cloud-vlm` actually returns a description end to end on this machine. `gemini-3.7-flash` was already known out of quota as of this same date, so it is not a confirmed fallback either — no model is verified working through this proxy right now.
- 2026-09-12, new: `cloud-vlm`'s `describe` path has not been proved live on the *default* model. `gemini-3.7-flash` transcribe succeeded (4.2 s); its describe call hit Gemini's own daily-quota 429, so describe was proved on the same proxy with `claude-sonnet-4-6`. Nothing suggests the default model rejects the describe prompt — it is simply unverified until the quota resets.
- 2026-09-12, new: the `local-vlm` latency numbers are for `Qwen2-VL-2B-Instruct-4bit`, not the documented default `Qwen3-VL-8B-Instruct-4bit`, whose weights are not on this machine. The 8B will be materially slower; the number is unmeasured.
- 2026-09-12, new: `local-vlm`'s ~13 s per image is dominated by cold model load — each call spawns a fresh Python process and reloads the weights. A persistent runner would cut it, and nothing in the current design does that.
- 2026-09-12: pet-talk's default 8s OCR timeout (`EYES_TIMEOUT_S`) is far shorter than the measured ~102s `apple-fm describe` latency on one 2280×600 PNG — a describe call is expected to time out unless a caller raises the timeout. Not verified whether pet-talk does this per-engine.
- 2026-09-11 (from the adoption audit on `adopt/review-pile`, `adopt/agent-readiness-report.md`) — status re-checked 2026-09-12 against `main` @ bee068a: the `files[]`-excludes-`docs-agent/` and missing-README-link findings (D4) are now fixed — `package.json` `files[]` includes `docs-agent/llms.txt`, `docs-agent/llms-full.txt`, `SKILL.md`, and README links to `docs-agent/llms.txt`. D2 (`docs-agent/llms-full.txt` had zero markdown links) is now fixed — its source list is relative links. GitHub repo topics/`homepage` (D5) not re-checked here — that lives in GitHub repo settings, not this checkout.
- 2026-09-12: `apple-fm` refuses clipboard and video input; only `apple-vision` and `tesseract` support video OCR.
- 2026-09-12: README's engine-rank list and `docs-agent/llms.txt`'s engine-rank list both present "Chrome AX / cleaned text" as item 1 of the same numbered list as the five real `EngineId` values, which is not how the code models it (CDP is a separate producer, not selectable via `--engine`).
- 2026-09-11 (spec §17, "Not confirmed", still true by inspection): end-to-end `apple-vision` latency, `local-vlm` tok/s, whether `fm respond --tool ocr` returns structured blocks, `/json/list` ordering under Chrome 144+, and current cloud pricing are all unverified in this pass too.

## Changelog

| Version | Date | Change | Commit |
| --- | --- | --- | --- |
| 0.1.2 | 2026-09-11 | `--selector` reads, CLI/MCP flag parity (lang/level/port/scroll/waitText/navigate/video tuning), examples, bin-path fix, release workflow fix | (see `CHANGELOG.md`) |
| 0.1.1 | 2026-09-10 | Corrected release notes attribution | (see `CHANGELOG.md`) |
| 0.1.0 | 2026-09-10 | First release: CLI, MCP server, 5 engines (`apple-vision` default, `apple-fm`, `local-vlm`, `cloud-vlm` fail-closed, `tesseract` for Linux/Intel) | (see `CHANGELOG.md`) |
| 1.0.0 (this doc) | 2026-09-12 | `docs/ARCHITECTURE.md` and `docs/ROADMAP.md` authored, first living-docs pass | `docs/living-architecture` |
| 0.2.0 | 2026-09-12 | `local-vlm` (mlx-vlm via a Python runner) and `cloud-vlm` (one OpenAI-compatible POST) run real inference, opt-in and fail-closed; hermetic tests for both; audit D2 fixed | `2fdea07`, `feat/real-vlm-engines` |
| 0.2.1 | 2026-09-12 | `cloud-vlm` fails closed on a silent proxy model reroute (`cloud_vlm_model_mismatch`) and on a non-vision refusal returned as `ok:true` (`cloud_vlm_no_vision`); both exit code 3, both opt-out/independent, both hermetically tested; live-verified against the reroute that motivated the fix | `feat/real-vlm-engines` |
