# zero-vision

Status: accepted for implementation
Date: 2026-09-07
Audience: the engineer who builds this in TypeScript and Swift

**A local CLI and MCP server that reads a page, a screenshot, or a video as text. Default path never sends pixels off the machine.**

GitHub: `unfoundbox-crew/zero-vision`. npm package: `zero-vision` (unscoped `zrv` is taken — a 2020 React leftover). CLI / bin: `zrv`. Native helper: `zrv-native`. MCP stdio: `zrv mcp`.

v1 is macOS. Pixel engines need Apple silicon or a configured cloud key. CDP read works anywhere Node 22 can reach a Chrome debug port.

---

## 1. What this is, and what it is not

Agents today screenshot a tab, ship a 1080p or 1440p PNG to a frontier model, and pay visual tokens plus seconds of latency to read text that the browser or the OS already knows.

Claude bills images as 28×28 patches: `ceil(w/28) * ceil(h/28)` visual tokens, capped at 1,568 on standard models and 4,784 on Claude 4.7+ ([Vision docs](https://platform.claude.com/docs/en/build-with-claude/vision)). A 1920×1080 screenshot is 1,560 tokens on the standard tier and 2,691 on the high-res tier, before any reasoning.

A 30-day forensic audit of 168 visual sessions in this fleet (`~/.agentworth/agentworth.db`, 2026-09-07) measured what those screenshots were *for*:

| Share | Sessions | Job |
| --- | --- | --- |
| 65% | 110 | Pure OCR / verbatim text (error traces, tweets, "is this headline clipped") |
| 27% | 46 | MotionVector contact sheets and cut verification (3×3 sheets, slide text, title cards) |
| 8% | 12 | Genuine aesthetic / spatial reasoning |
| 0% | 0 | Porn |

Ninety-two percent of visual sessions were transcription. Eight percent needed a model that can see. The default engine is therefore a transcriber, not a VLM. The 8% gets an explicit `--engine`.

It is not a browser driver. It does not click, type, hover, or fill. Chrome DevTools MCP and Playwright MCP already do that with `uid` / `ref`.

It does not silently upload pixels. Cloud vision is an opt-in engine (`cloud-vlm`), never the default, never an automatic fallback.

---

## 2. Rejected approaches

| Rejected | Do this instead | Why |
| --- | --- | --- |
| One hardcoded OCR binary | Engine adapter. Four named engines, one result schema | The 8% will change engines. The 65% must not |
| Silent cloud fallback | `--engine cloud-vlm` or config. Default stays `apple-vision` | A router that uploads is the bug this tool exists to stop |
| `click(uid)` in v1 | Read only | chrome-devtools-mcp and Playwright MCP already click |
| Probe 9222 by default | Probe env, then 1948, then 9223. **9222 only with `--port` or `ZEROVISION_ALLOW_USER_CHROME=1`** | 9222 is often the human's daily Chrome |
| Puppeteer / Playwright | Raw `fetch` + `WebSocket` (Node 22) | Those libraries *are* the drivers we refuse to clone |
| ffmpeg required for video | AVFoundation in the Swift binary. ffmpeg optional | ffmpeg is a 50MB+ dep |
| Quote 15ms / 20ms OCR as a measured SLA | Warm-path **target**. Measure on `hello.png` before the README quotes a number | Apple does not publish 20ms. ANE concurrency is ~2 |
| Auto-route tree → OCR → cloud | Commands pick the producer. Engines pick the pixel backend | Silent fallback hides "the tree was empty" |

---

## 3. Prior art

Compared 2026-09-07 against current docs. Chrome DevTools MCP tools checked against v1.8.0 `snapshot.ts`.

| Tool | What it is | Perception | Drive the browser? | Local OCR | Video text |
| --- | --- | --- | --- | --- | --- |
| [Playwright MCP](https://playwright.dev/mcp/introduction) | Microsoft MCP. Accessibility snapshot + `ref=eN` | AX tree, optional screenshot | Yes | No | No |
| [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) v1.8.0 | Google MCP. `take_snapshot`, `take_screenshot` | AX tree, screenshot, traces | Yes | No | No |
| [Stagehand](https://docs.stagehand.dev) v3/v4 | Browserbase SDK. `act` / `extract` / `observe` | AX + LLM | Yes | No | No |
| [Crawl4AI](https://docs.crawl4ai.com/core/simple-crawling/) | Self-hosted crawler | Rendered HTML | Crawl, not UI | No | No |
| [Browser-Use](https://github.com/browser-use/browser-use) | Python agent loop | Hybrid, still pays vision often | Yes | No | No |
| [ocrtool-mcp](https://github.com/ihugang/ocrtool-mcp) | Swift + Vision, MCP only | Image OCR | No | Yes | No |

**The hole:** none of these is attach-only Chrome text plus on-device OCR plus video/contact-sheet text plus a swappable VLM, behind one CLI. The 27% contact-sheet sessions are a still PNG (one image, many frames of text). That is `apple-vision` on a file, not a video pipeline and not a cloud VLM.

---

## 4. Architecture

```text
                         zrv / zero-vision MCP
                                    |
                 +------------------+------------------+
                 |                                     |
           CDP reader                            Pixel perceiver
           (TypeScript)                          (engine adapter)
                 |                                     |
        localhost debug port              +------------+------------+
        attach, never launch              |            |            |
                                          v            v            v
                                   apple-vision   apple-fm    local-vlm
                                   (default)      (fm+OCRTool) (MLX Qwen3-VL)
                                                       |
                                                  cloud-vlm (opt-in)
```

Two producers:

1. **CDP reader** — web pages already open (or a static URL fetched without a browser). Not an engine. Always local.
2. **Pixel perceiver** — screenshots, clipboard, local files, video keyframes, contact sheets. Speaks one interface. Four engines implement it.

A third outcome, not a producer: **`opaque`**. If a canvas or video covers ≥30% of the viewport, the reader sets `opaque: true`. It does not upload. `zrv --ocr-opaque` captures those rectangles and runs the **current pixel engine**.

Default path for a tab: CDP text. Default path for a file: `apple-vision`. No implicit cloud.

---

## 5. Engine adapter

### 5.1 Interface

TypeScript owns routing. Each engine is a process or a function that accepts the same input and returns the same JSON. Adding a fifth engine is a new file that implements this, plus a name in the registry. No other package changes.

```ts
type EngineId = "apple-vision" | "apple-fm" | "local-vlm" | "cloud-vlm";
type Task = "transcribe" | "describe";

interface PerceiveInput {
  kind: "image" | "video" | "clipboard";
  path?: string;          // absolute file
  bytes?: Buffer;         // stdin / base64 decoded, cap 30 MB
  task: Task;             // default transcribe
  lang?: string[];
  level?: "accurate" | "fast";   // apple-vision only
  video?: { mode: "scene" | "interval" | "all-idr"; interval?: number; maxFrames?: number };
}

interface TextBlock {
  text: string;
  confidence?: number;            // 0..1 when the engine has it
  bbox?: { x: number; y: number; w: number; h: number }; // Vision-normalized, origin bottom-left
}

interface PerceptionResult {
  ok: boolean;
  engine: EngineId;
  task: Task;
  text: string;                   // always present on ok. Verbatim for transcribe, prose for describe
  blocks?: TextBlock[];           // apple-vision. Others may omit
  transcript?: { t: number; text: string }[];  // video only
  ms: number;
  tokens?: { input: number; output: number };
  costUsd?: number;
  model?: string;                 // fm / vlm / cloud model id
  error?: string;
}
```

`transcribe` is the 65%+27% path. `describe` is the 8% path. Engines that cannot describe (`apple-vision`) reject `task: describe` with exit 1: `engine apple-vision cannot describe; use apple-fm, local-vlm, or cloud-vlm`.

Selection, first match wins:

1. `--engine <id>`
2. `ZEROVISION_ENGINE`
3. `~/.config/zero-vision/config.json` → `engine`
4. `apple-vision`

Config shape:

```json
{
  "engine": "apple-vision",
  "engines": {
    "local-vlm": {
      "modelPath": "~/.cache/huggingface/hub/models--mlx-community--Qwen3-VL-8B-Instruct-4bit"
    },
    "cloud-vlm": {
      "provider": "gemini",
      "model": "gemini-3.1-flash-lite",
      "apiKeyEnv": "GEMINI_API_KEY"
    }
  }
}
```

Do not read API keys from the config file. Env only.

### 5.2 `apple-vision` (default)

Compiled Swift CLI, spawned, JSON on stdout. Same packaging as before: optionalDependency `@zero-vision/darwin-arm64`.

```bash
zrv-native ocr-image --input <path> --level accurate|fast --json
zrv-native ocr-clipboard --level accurate --json
zrv-native ocr-video --input <path> --mode scene --interval 2 --max-frames 60 --json
```

- macOS 15+: `RecognizeTextRequest`. macOS 14: `VNRecognizeTextRequest` revision 3. Pin the revision.
- `.accurate` default, `.fast` for `--level fast`. Language correction on. `--lang` repeatable.
- Serialize requests. ANE stalls above ~2 concurrent (Apple DTS 2025). Process-wide lock of 1.
- `bbox` is Vision-normalized (origin bottom-left). `--bbox css` flips origin if a caller asks.
- Exit codes: 0 ok, 1 usage, 2 input missing, 3 Vision unavailable, 4 recognize failed, 5 unsupported video container.

**Latency:** warm-path **target** after process start is under 200ms `.accurate` on a 1280×800 printed-English screenshot. A 20ms figure is a target for `.fast` on a cropped region, not a measurement. Do not print either number in the README until `hello.png` is timed on a named machine.

Video: AVFoundation `AVAssetImageGenerator`, in-memory `CGImage`. Scene mode = 2 fps sample, keep if 64-bit dHash Hamming > 10, always first and last. Caps: 60 frames default, 200 hard, 180 seconds. Dedup by casefolded whitespace-collapsed text.

Contact sheets (27% of sessions): they are PNGs. `ocr-image` on the sheet is the path. Do not split a 3×3 grid in v1. The whole sheet is one transcription. `--grid 3x3` is a later engine option, not a new engine.

ffmpeg: only if AVFoundation cannot decode. Temp `.mp4`, OCR, delete. Guaranteed containers: `mp4`, `mov`, `m4v`.

### 5.3 `apple-fm`

On-device Foundation Model plus Vision `OCRTool`. Verified 2026-09-07: `/usr/bin/fm` is licensed, `fm available` reports `System model available`, and the CLI takes images:

```bash
fm respond --image shot.png --text 'Transcribe all text verbatim.' --tool ocr --no-stream
```

The adapter shells out to `fm`. It does not embed FoundationModels in the Swift OCR binary in v1 (two crash domains). Map stdout to `PerceptionResult.text`. `engine: "apple-fm"`, `model: "system"`. `blocks` omitted unless a later `fm` schema lands.

Requires macOS 27. If `fm` is missing or the license is unsigned, exit 3: `apple-fm unavailable`.

Use this when the user wants a sentence of understanding on top of OCR (clipped headline: "yes, the last two letters are cut") without leaving the machine. Still not Claude.

### 5.4 `local-vlm`

Opt-in. Default weights: the already-cached MLX 4-bit Qwen3-VL-8B at

```text
~/.cache/huggingface/hub/models--mlx-community--Qwen3-VL-8B-Instruct-4bit
```

(5.4 GB on disk, verified 2026-09-07). Do not download weights in v1. If the path is missing, exit 3 with the path we looked at.

Spawn via the SpacePilot / MLX runtime already on the machine (`llama-cpp` serves vision; `mlx-lm` is text-only — use a vision-capable runner). Timeout 60s. `task: describe` is the point of this engine. `task: transcribe` is allowed but the README must say `apple-vision` is the transcriber.

**Unflown on M1 Max.** SpacePilot lists `qwen2-5-vl-7b-instruct` as `runs_well` on paper and **unflown**. Do not quote tok/s. A local VLM is a privacy/latency play against a cloud round trip, not a quality play against Fable.

Fan rule: never load this model from a test suite on a laptop. One optional `ZEROVISION_LIVE_VLM=1` test, off by default.

### 5.5 `cloud-vlm`

Opt-in. Never probed, never default, never chosen because another engine failed.

```json
{
  "provider": "gemini" | "anthropic" | "openai" | "custom",
  "model": "gemini-3.1-flash-lite",
  "baseUrl": "https://…",          // custom only
  "apiKeyEnv": "GEMINI_API_KEY"
}
```

OpenAI-compatible POST for `custom`. Provider SDKs otherwise, lazy-loaded so the default install still has one runtime dependency (`@modelcontextprotocol/sdk`). Cloud adapters live in `src/engines/cloud/` and pull their SDK only when that engine is selected.

Prices move. Do not hardcode "$0.05/Mtok". Print `costUsd` from the provider's usage field when present; otherwise omit.

Refuse to run if `apiKeyEnv` is unset. Refuse to run if the input is larger than 10 MB. Log `engine=cloud-vlm model=… bytes=…` to stderr, never the image bytes.

This is the 8% aesthetic path when the user wants frontier quality. Creative direction, layout judgment, humor. Not transcription.

---

## 6. Native packaging (`apple-vision` binary)

Ship a **compiled executable**, not a dylib, not a `.node` addon, not `swift-sh`.

Node calls it with `spawn`, argv, and a timeout. JSON on stdout. Logs on stderr. One-shot per invocation.

```text
npm package zero-vision
  optionalDependency @zero-vision/darwin-arm64
```

Resolve, in order: `ZEROVISION_NATIVE`, that package's `bin/zrv-native`, `./native/.build/release/zrv-native` (dev).

If the binary is missing, CDP commands still run. `apple-vision` commands exit 3.

Rejected: dylib / N-API, swift-sh, in-process Vision (a crash must not kill MCP).

v1 ships `darwin-arm64` only.

---

## 7. Snap (human CLI only)

`snap` is not an MCP tool. Interactive capture needs a TTY and a GUI session.

```bash
zrv snap                 # screencapture -i -c -x   image → clipboard
zrv snap --ocr           # capture, run current engine, print text, pbcopy the text
zrv snap --save out.png
zrv snap --ocr --engine apple-fm
```

`/usr/sbin/screencapture`: `-i` interactive, `-c` clipboard, `-x` silent, `-t png`. Temp files deleted unless `--save`. Escape → exit 130, print nothing.

---

## 8. Browser CDP

Unchanged in spirit. Node 22 `fetch` + `WebSocket`. No puppeteer, no playwright.

1. `GET http://127.0.0.1:<port>/json/version` → `webSocketDebuggerUrl`
2. WebSocket to the browser target
3. `Target.setDiscoverTargets { discover: true }`
4. `Target.getTargets`
5. `Target.attachToTarget { targetId, flatten: true }`
6. Detach on exit

Do not launch Chrome. Nothing listening → exit 2.

Port probe: `--port` / `ZEROVISION_PORT`, then `AGENT_CHROME_PORT`, then `1948`, then `9223`. First `/json/version` 200 in 150ms wins. **Never 9222** unless `--port 9222` or `ZEROVISION_ALLOW_USER_CHROME=1`. Loopback only unless `--host`.

Tab pick: `type=page` (or tab whose child is a page). Drop `chrome://`, `devtools://`, `chrome-extension://`, `edge://`. Default = first non-internal page, title+URL on stderr. `--tab` is id or unique substring. `--url` matches prefix. `--url --navigate` creates a **new** tab, never navigates an existing one. Two matches → exit 1 with the list.

Wait: `readyState` / `Page.loadEventFired` (8s), `Accessibility.enable` + `loadComplete` (2s, proceed anyway), quiet 250ms / 5s wall. `--wait-ms`, `--wait-text`. Then `Accessibility.disable` if we enabled it.

Shadow DOM: AX flattens it. Default `zrv` text is AX-derived, not `innerText`. Same-origin iframes: `getFullAXTree` per `frameId`. OOPIF: `setAutoAttach`, skip on attach failure.

**Text / markdown / a11y YAML:** interesting-only walk. Skip `ignored`, roles `none`/`presentation`. Fold `InlineTextBox`. Cap 24,000 characters. YAML is Playwright-shaped with `uid=eN`. `--a11y --verbose` dumps raw CDP nodes.

Opaque probe: `canvas, video` coverage. Do **not** call `canvas.getContext('webgl')`. `--ocr-opaque` screenshots qualifying clips (CSS viewport `getBoundingClientRect`, scroll into view first) and runs the current pixel engine.

`--url --fetch`: HTTP GET, no JS. SPA shell (<200 chars of text, `div#root`) → exit 1 telling them to open it in debug Chrome.

WebMCP: if the page has tools, the user already has chrome-devtools-mcp `list_webmcp_tools` behind `--categoryExperimentalWebmcp`. zero-vision does not clone that. A skill, not this server, should try page tools before a screenshot.

---

## 9. CLI

One bin: `zrv`. `snap` is an argv[0] alias.

```text
zrv                          text of the chosen tab
zrv --md                     markdown
zrv --a11y                   interesting AX tree
zrv --url <url>
zrv --url <url> --navigate
zrv --url <url> --fetch
zrv --tab <id|substr>
zrv --tabs
zrv --ocr-opaque
zrv --engine apple-vision|apple-fm|local-vlm|cloud-vlm
zrv --wait-ms N
zrv --wait-text GLOB
zrv --scroll
zrv --json
zrv --port N

zrv ocr <file.png|jpg|heic|pdf|mp4|mov>
zrv ocr --clipboard
zrv ocr --task transcribe|describe
zrv ocr --engine local-vlm
zrv ocr --level fast
zrv ocr --lang en-US --lang ja-JP

zrv snap
zrv snap --ocr
zrv snap --save <path>

zrv mcp
```

PDF: v1 OCRs page 1.

`--json` for tab reads includes `engine` only when a pixel engine ran (`--ocr-opaque`). CDP reads use `"source": "cdp"`.

stderr is for humans. stdout is the payload. MCP must not print banners on stdout.

---

## 10. MCP server

Bin `zrv-mcp` = `zrv mcp`. Transport: stdio. SDK: `@modelcontextprotocol/sdk`.

Five tools. No click. No screenshot-as-image.

`peek_tabs` — list attachable pages.

`peek_page` — `targetId` XOR `url` XOR default tab. `format: text|markdown`. `navigate`, `fetch`, `ocrOpaque`, `waitMs`, `engine`.

`peek_a11y` — same targeting, plus `verbose`.

`ocr_image` — exactly one of `path`, `base64`, `clipboard`. `engine`, `task` (default `transcribe`). Path absolute. Base64 cap 30 MB, temp file, unlink.

`ocr_video` — `path` absolute. `mode`, `interval`, `maxFrames`, `engine` (pixel engines that support video: `apple-vision` required in v1; others may refuse video).

Tool descriptions must say **prefer this over a screenshot when the goal is to read text**, and **use `apple-vision` unless the user asked to describe**.

---

## 11. Repository and build

Standalone repo, MIT. This spec stays the design of record until that repo's README points here.

```text
zero-vision/
  package.json
  tsconfig.json
  src/
    cli.ts
    mcp.ts
    cdp/client.ts
    cdp/attach.ts
    cdp/extract.ts
    engines/
      index.ts          registry, PerceiveInput / PerceptionResult
      apple-vision.ts   spawn zrv-native
      apple-fm.ts       spawn fm respond --image --tool ocr
      local-vlm.ts      spawn MLX / llama-cpp vision
      cloud/
        index.ts
        gemini.ts
        anthropic.ts
        openai.ts
        custom.ts
    snap.ts
  native/
    Package.swift
    Sources/zrv-native/
      main.swift
      ImageOCR.swift
      VideoOCR.swift
      Clipboard.swift
    Tests/zrv-nativeTests/
  test/
    cdp/
    engines/            mock each adapter against the unified schema
    extract/
    cli/
  fixtures/
    pages/tiny.html
    pages/spa-shell.html
    ax/tiny.json
    ocr/hello.png
    ocr/hello.expected.txt
    ocr/contact-sheet.png   # 3×3 title cards, the 27% case
    video/slides.mp4
  .github/workflows/ci.yml
```

`package.json` dependencies: `@modelcontextprotocol/sdk` only at install. Cloud SDKs are optional peerDependencies, imported only when `cloud-vlm` is selected.

Engines: `"node": ">=22"`.

CI: Ubuntu = TS + mock CDP + mock engines. macOS = plus `swift test` + `hello.png` contains `HELLO ZEROVISION` + contact-sheet fixture yields more than one title card. Skip `local-vlm` and `cloud-vlm` in CI.

Release: GitHub Actions builds the arm64 native binary, publishes `@zero-vision/darwin-arm64` then `zero-vision`. Restore the executable bit after `upload-artifact`.

---

## 12. Testing

| Layer | How |
| --- | --- |
| AX walk | Golden files from recorded `getFullAXTree` JSON |
| Port probe | Mock HTTP. Assert 9222 skipped |
| Engine schema | Each adapter, including mocks, round-trips `PerceptionResult` |
| apple-vision | `hello.png`. Skip if not darwin |
| Contact sheet | `contact-sheet.png` produces ≥3 distinct lines |
| Video | `slides.mp4`. Two timestamps, deduped |
| apple-fm | Mock `fm` stdout. Live `ZEROVISION_LIVE_FM=1` off by default |
| local-vlm / cloud-vlm | Mocks only in CI |
| Snap | Unit-test argv to screencapture, not interactive `-i` |

---

## 13. Security

- CDP is unauthenticated. Loopback only.
- Never default-attach to 9222.
- Never navigate unless `--navigate`.
- Never `Runtime.evaluate` user-supplied JS.
- OCR `path`: realpath, must be a file.
- MCP `base64`: size cap, `mkdtemp`, unlink in `finally`.
- `cloud-vlm` never runs without an env key. Never log image bytes.
- `snap` is CLI-only.
- Do not log page text to files.

---

## 14. Non-goals (v1)

- Click, type, hover, fill
- Launching or killing Chrome
- Silent cloud fallback
- Downloading VLM weights
- Splitting contact-sheet grids
- Windows / Linux OCR
- Browser extension, stealth, crawl
- Shipping UIDs as a click API

---

## 15. Key decisions

1. **Read tool, not a driver.**
2. **Engine adapter, one schema.** The 65% and the 8% do not share a backend. They share an interface.
3. **Default is `apple-vision`.** Matches 92% of audited visual sessions (transcription + contact sheets).
4. **Cloud is an engine, not a fallback.** Opt-in, keyed, logged.
5. **`fm` is the on-device understander.** Licensed and available on macOS 27. OCRTool is the transcriber inside that session.
6. **Local VLM is cached-weights-or-fail.** No surprise 15 GB download.
7. **Compiled Swift for Vision only.** `fm` and MLX stay out of that process.
8. **9222 is opt-in. AX-derived text, not `innerText`.**
9. **Contact sheets are images.** The 27% case is `ocr-image`, not `ocr-video`.

---

## 16. Implementation order

1. Engine interface + `apple-vision` + `hello.png`
2. CDP attach + `zrv --tabs` + AX text
3. Extract: markdown, a11y YAML, opaque probe
4. Contact-sheet fixture
5. CLI snap
6. MCP, `engine` on pixel tools
7. Video scene mode
8. `apple-fm` adapter (`fm respond --image --tool ocr`)
9. `local-vlm` adapter against the cached 4-bit Qwen3-VL
10. `cloud-vlm` adapter, last, behind config
11. Packaging

Do not start at MCP. Do not add click. Do not wire cloud before the default transcriber is boring.

---

## 17. Not confirmed

- End-to-end `apple-vision` latency on this M1 Max. Target ≠ measurement.
- Qwen3-VL-8B-4bit tok/s or TTFT on this machine. Cached, unflown.
- Whether `fm respond --tool ocr` returns structured blocks or only prose. Adapter treats stdout as `text` until a schema is verified.
- Whether `/json/list` order tracks focus in Chrome 144+.
- Current $ / MTok of any cloud Flash-class model. Read the provider on the day you wire `cloud-vlm`.

---

## 18. Sources

- Fleet audit, 168 visual sessions, `~/.agentworth/agentworth.db`, 2026-09-07 (65 / 27 / 8 / 0)
- `fm respond --help`, `fm available` → System model available, 2026-09-07
- Claude Vision patch tokens: https://platform.claude.com/docs/en/build-with-claude/vision
- Chrome CDP Accessibility / Target domains
- Playwright MCP snapshots: https://playwright.dev/mcp/snapshots
- Apple `VNRecognizeTextRequest`; WWDC26 Foundation Models `OCRTool` (session 241)
- Apple DTS ANE concurrency: https://developer.apple.com/forums/thread/784672
- SpacePilot `check` / `models` on this M1 Max, 2026-09-07: Qwen3-VL-8B-4bit 5.4 GB cached, Qwen2.5-VL-7B recipe unflown
- Node 22: global `fetch`, global `WebSocket`
- `screencapture(1)`
