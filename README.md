# zero-vision

**Read a page, a screenshot, or a video as text. Default path never sends pixels off the machine.**

Public. Apache-2.0. Crew: [unfoundbox-crew](https://github.com/unfoundbox-crew).

| Surface | Name |
| --- | --- |
| GitHub | `unfoundbox-crew/zero-vision` |
| npm package | `zero-vision` |
| CLI / bin | `zrv` |

`zrv` as an unscoped npm name is taken. Install `zero-vision`; that puts `zrv` on `PATH`. Use `npx zero-vision`, never `npx zrv`.

## Perception rank

Cheap and local first. Frontier only when you name it.

1. Chrome AX / cleaned text (attach-only CDP — no click)
2. Apple Vision OCR (`apple-vision`, default for files)
3. On-device Foundation Model (`apple-fm`)
4. Local VLM (`local-vlm`) — mlx-vlm, weights must already be on disk
5. Cloud VLM (`cloud-vlm`) — opt-in, never a fallback

Not a browser driver. Chrome DevTools MCP and Playwright MCP already click.

## Install

macOS, Node 22+, Apple silicon for pixel engines.

```bash
npm install -g zero-vision
# or from a checkout:
npm install && npm run build && npm run native
```

`npm run native` builds `zrv-native` (Vision OCR). Without it, CDP still works; `zrv ocr` exits 3.

## Design

```
                    ┌──────────────┐          ┌───────────────┐
                    │  CLI  (zrv)  │          │ MCP (zrv mcp) │
                    │ page · ocr   │          │ peek_* · ocr_*│
                    │ tabs · snap  │          │   5 tools     │
                    └──────┬───────┘          └───────┬───────┘
                           │                        │
                           ▼                        ▼
                ┌──────────────────────────────────────────┐
                │               perceive()                 │
                │        task: transcribe | describe       │
                └───────┬──────────────────────┬───────────┘
                        │                      │
           ┌────────────▼────────┐  ┌──────────▼──────────────┐
           │  CDP (attach-only)  │  │  pixel engines (ranked, │
           │  text · md · AX     │  │  fail-closed)           │
           │  never launch       │  │                         │
           │  never 9222         │  │  1 apple-vision  (OCR)  │
           │  opaque ≥30% ──► OCR│  │  2 apple-fm   (judge)   │
           └─────────────────────┘  │  3 local-vlm (weights   │
                                    │    must be on disk)     │
                                    │  4 cloud-vlm (named     │
                                    │    opt-in only)         │
                                    └──────────┬──────────────┘
                                               │
                                  ┌────────────▼────────────┐
                                  │  zrv-native (Swift)     │
                                  │  Vision · AVFoundation  │
                                  │  video keyframes        │
                                  └─────────────────────────┘

  Invariants: no silent cloud fallback · contact sheet = one image,
  never split · snap stays CLI-only · not a browser driver.
```

## How it compares

```
┌───────────────────┬──────────┬────────┬────────┬────────┬────────────────────────────┐
│ Tool              │ No-pixel │ Local  │ Video  │ Drives │ Catch                      │
│                   │ text     │ OCR    │ text   │ browser│                            │
├───────────────────┼──────────┼────────┼────────┼────────┼────────────────────────────┤
│ zero-vision (own) │ yes      │ yes    │ yes    │ no     │ macOS + Apple silicon      │
│ Playwright MCP    │ AX tree  │ no     │ no     │ yes    │ pays vision for pixels     │
│ Chrome DevTools   │ AX tree  │ no     │ no     │ yes    │ same; traces cost extra    │
│ Stagehand         │ AX + LLM │ no     │ no     │ yes    │ LLM call per extract       │
│ Crawl4AI          │ HTML     │ no     │ no     │ crawl  │ rendered HTML, no OCR      │
│ Browser-Use       │ hybrid   │ no     │ no     │ yes    │ still pays vision often    │
│ ocrtool-mcp       │ n/a      │ yes    │ no     │ no     │ images only, no tab read   │
│ Frontier VLM shot │ no       │ no     │ frames │ no     │ $$$ per image, off-machine │
│ agy Flash         │ n/a      │ no     │ no     │ no     │ cheap but cloud + ~20s lag │
└───────────────────┴──────────┴────────┴────────┴────────┴────────────────────────────┘
```

zero-vision is free per call, private by default, and deterministic —
but pixels need macOS + Apple silicon (see Linux below), it never clicks
by design, and it is 0.1.2, unproven at scale.

## Linux

CDP text works anywhere Node 22 runs. The pixel side swaps backends:

| Need              | macOS               | Linux                                  |
| ----------------- | ------------------- | -------------------------------------- |
| OCR               | Apple Vision        | `tesseract` engine (tesseract.js, pure npm) |
| OCR speed path    | ANE                 | system `tesseract` binary when present |
| Describe / judge  | apple-fm            | `local-vlm` at Ollama / llama.cpp      |
| Video keyframes   | AVFoundation        | ffmpeg (optional, fail-closed)         |
| `snap` capture    | `screencapture`     | grim (Wayland) / scrot (X11)           |
| Clipboard         | pbcopy              | xclip / wl-copy                        |

Same `perceive()` interface, same rank order, same fail-closed rules.

## Commands

```text
zrv                  text of the chosen debug-Chrome tab
zrv --md             markdown
zrv --a11y           interesting AX tree
zrv --tabs
zrv --selector <css>              # element text only (the canary-text port)
zrv --url <url> [--navigate|--fetch]
zrv ocr <file.png|jpg|heic|pdf|mp4|mov> [--task transcribe|describe] [--lang en-US] [--level fast|accurate]
zrv ocr <clip.mp4> [--mode scene|interval|all-idr] [--interval 2] [--max-frames 60]
zrv ocr --clipboard
zrv ocr --task describe --engine apple-fm
zrv snap             interactive capture → clipboard
zrv snap --ocr       capture, OCR, print text, pbcopy
zrv mcp              stdio MCP server
```

Default debug ports: `1948`, then `9223`. Never `9222` unless `--port 9222` or `ZEROVISION_ALLOW_USER_CHROME=1`.

## MCP tools

`peek_tabs` `peek_page` `peek_a11y` `ocr_image` `ocr_video`

Prefer these over a screenshot when the goal is to read text. Use `apple-vision` unless the user asked to describe.

Agent skill: `npx skills add unfoundbox-crew/zero-vision -g`

Agent docs: [`docs-agent/llms.txt`](docs-agent/llms.txt) (index) and
[`docs-agent/llms-full.txt`](docs-agent/llms-full.txt) (full text).

## Who consumes this

Standalone repo. Other crew products call it; they do not own it.

| Project | Job |
| --- | --- |
| MotionVector / `mvec` | Contact sheets, title cards, "what does this frame say" after `mvec frame` |
| AgentWorth | The 92% of visual sessions that are transcription, not taste |
| SpacePilot | Optional `--engine local-vlm` when weights are already on disk |

Photos of a room → classical CV → SDF block-out is MotionVector. This tool stops at text (and, if named, a local/cloud VLM).

## Opt-in engines

`local-vlm` and `cloud-vlm` run real inference since 0.2.0. Both are opt-in:
they happen only when you pass `--engine`, never as a fallback from a failed
local engine. Both fail closed with a named error rather than guessing.

### `local-vlm` — mlx-vlm on Apple silicon

```bash
pip install mlx-vlm                                   # once, into your Python
huggingface-cli download mlx-community/Qwen2-VL-2B-Instruct-4bit   # ~1.2 GB

export ZRV_PYTHON=/path/to/python                     # the one with mlx-vlm
export ZRV_LOCAL_VLM_MODEL=mlx-community/Qwen2-VL-2B-Instruct-4bit
zrv ocr shot.png --engine local-vlm --task describe
```

Weights are never downloaded for you. `ZRV_LOCAL_VLM_MODEL` takes an
`mlx-community` HF id (resolved in the local HF cache) or a directory of
converted weights; if nothing is there you get `local_vlm_no_weights` naming
the path it checked and the command that would fill it.

| Env | Default | What |
| --- | --- | --- |
| `ZRV_LOCAL_VLM_MODEL` | `mlx-community/Qwen3-VL-8B-Instruct-4bit` | HF id or weights directory |
| `ZRV_PYTHON` | `~/miniconda3/envs/local-ml-py311/bin/python`, else `python3` | interpreter with `mlx-vlm` |
| `ZRV_LOCAL_VLM_TIMEOUT_MS` | `180000` | runner is SIGKILLed past this |
| `ZRV_LOCAL_VLM_MAX_TOKENS` | `512` | generation cap |
| `ZRV_LOCAL_VLM_RUNNER` | the bundled `local_vlm_runner.py` | your own JSON-in/JSON-out runner |

Measured 2026-09-12, M-series MacBook Pro at `nice 19`, one 1280x800 screenshot,
`mlx-community/Qwen2-VL-2B-Instruct-4bit` (4-bit, 1.2 GB), cold process each run —
model load included:

| Task | Wall clock |
| --- | --- |
| `transcribe` | 13.1 s |
| `describe` | 12.6 s |

Errors: `local_vlm_no_weights`, `local_vlm_no_python`, `local_vlm_no_runner`,
`local_vlm_timeout`, `local_vlm_inference_failed`, `local_vlm_runner_failed`,
`local_vlm_bad_input`, `local_vlm_too_large`, `local_vlm_empty`.
No video, no clipboard — extract a frame or snap to a file first.

### `cloud-vlm` — one OpenAI-compatible call

Any endpoint that speaks `POST /chat/completions` with `image_url` content
works. The default target is a self-hosted LiteLLM proxy fronting your own
subscriptions; **set `LITELLM_BASE_URL`** (the built-in default is
`http://127.0.0.1:8000/v1` — localhost, never a hardcoded remote address).

```bash
export LITELLM_BASE_URL=http://<your-proxy>:8000/v1
export LITELLM_MASTER_KEY=...                         # or ZRV_CLOUD_VLM_API_KEY
zrv ocr shot.png --engine cloud-vlm --task describe --json
```

| Env | Default | What |
| --- | --- | --- |
| `ZRV_CLOUD_VLM_BASE_URL` | `LITELLM_BASE_URL`, `LLM_BASE_URL`, then `http://127.0.0.1:8000/v1` | endpoint base |
| `ZRV_CLOUD_VLM_API_KEY` | — | literal key; wins over the env-name form |
| `ZRV_CLOUD_VLM_KEY_ENV` | `LITELLM_MASTER_KEY` | name of the variable holding the key |
| `ZRV_CLOUD_VLM_MODEL` | `claude-sonnet-4-6` (2026-09-12: `gemini-3.7-flash` hit the proxy's daily quota; set this var to `gemini-3.7-flash` once it resets) | any vision model the endpoint serves |
| `ZRV_CLOUD_VLM_TIMEOUT_MS` | `60000` | request is aborted past this |
| `ZRV_CLOUD_VLM_MAX_TOKENS` | `1024` | generation cap |

Alternate endpoints are just a different base URL and key — OpenRouter
(`https://openrouter.ai/api/v1`, `ZRV_CLOUD_VLM_KEY_ENV=OPENROUTER_API_KEY`,
e.g. `qwen/qwen3.7-flash` at $0.03/$0.13 per 1M tokens as of 2026-09-12) or
Gemini direct (`https://generativelanguage.googleapis.com/v1beta/openai`).

Errors: `cloud_vlm_no_key`, `cloud_vlm_http_<status>`, `cloud_vlm_timeout`,
`cloud_vlm_network`, `cloud_vlm_provider_error`, `cloud_vlm_bad_response`,
`cloud_vlm_bad_input`, `cloud_vlm_too_large`, `cloud_vlm_empty`.
Images only, 10 MB cap, no video, no clipboard. `costUsd` is reported only
when the endpoint returns a cost; `tokens` whenever it returns usage.

## v1 limits

Contact sheets are one image, not a split grid. Video OCR needs the native
binary, and only `apple-vision` and `tesseract` do video at all.

## Spec

[`docs/spec.md`](docs/spec.md)

## License

Apache License 2.0. See [LICENSE](LICENSE).

## Living docs

Architecture and roadmap: `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`. Rendered page: https://claude.ai/code/artifact/11bfcf28-118b-46ec-b6a7-50db50f7cd5b
Rebuild: `python3 docs/site/build.py --arch docs/ARCHITECTURE.md --roadmap docs/ROADMAP.md --out docs/site/index.html --product-name zero-vision --repo-url https://github.com/unfoundbox-crew/zero-vision`
