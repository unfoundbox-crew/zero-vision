# Changelog

All notable changes to `zero-vision` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [SemVer](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-09-12

### Added
- `local-vlm` runs real inference: mlx-vlm on Apple silicon via a bundled
  Python runner (`src/engines/local_vlm_runner.py`, JSON in / JSON out).
  `ZRV_LOCAL_VLM_MODEL` takes an `mlx-community` HF id or a directory of
  converted weights; `ZRV_PYTHON` names the interpreter that has `mlx-vlm`.
  Weights are still never downloaded for you — absent weights give
  `local_vlm_no_weights` naming the path checked and the download command.
  Measured on one 1280x800 screenshot, `mlx-community/Qwen2-VL-2B-Instruct-4bit`
  at `nice 19`, cold process: 13.1 s transcribe, 12.6 s describe. For contrast,
  `apple-fm` describe measured ~102 s.
- `cloud-vlm` runs real inference: one OpenAI-compatible
  `POST /chat/completions` carrying the image as a base64 data URL.
  Endpoint from `ZRV_CLOUD_VLM_BASE_URL`, else `LITELLM_BASE_URL` /
  `LLM_BASE_URL`, else `http://127.0.0.1:8000/v1`; key from
  `ZRV_CLOUD_VLM_API_KEY` or the variable `ZRV_CLOUD_VLM_KEY_ENV` names
  (default `LITELLM_MASTER_KEY`); model from `ZRV_CLOUD_VLM_MODEL`
  (default `gemini-3.7-flash`). Reports `tokens` always and `costUsd` when
  the endpoint returns one. OpenRouter and Gemini-direct are alternate
  base-URL/key configs, never the default. No address is hardcoded.
- Named errors on both engines, so a caller can branch without string-matching
  prose: `local_vlm_no_weights`, `local_vlm_no_python`, `local_vlm_no_runner`,
  `local_vlm_timeout`, `local_vlm_inference_failed`, `local_vlm_runner_failed`,
  `local_vlm_bad_input`, `local_vlm_too_large`, `local_vlm_empty`;
  `cloud_vlm_no_key`, `cloud_vlm_http_<status>`, `cloud_vlm_timeout`,
  `cloud_vlm_network`, `cloud_vlm_provider_error`, `cloud_vlm_bad_response`,
  `cloud_vlm_bad_input`, `cloud_vlm_too_large`, `cloud_vlm_empty`.
- Hermetic tests for both engines: a loopback OpenAI-compatible stub server
  and a fake runner script. No key, no weights, no provider, no network.
- `fixtures/ocr/screenshot-1280x800.png`, the latency fixture.
- `ZRV_LOCAL_VLM_RUNNER` seam for shipping your own runner.

### Changed
- `npm run build` now also copies `local_vlm_runner.py` into `dist/engines/`,
  so the published package is self-contained (`scripts/copy-assets.mjs`).
- `cloud-vlm`'s default key variable is `LITELLM_MASTER_KEY`, not
  `GEMINI_API_KEY`. The config file still never holds a key value.
- `npm test` builds first (it needs the copied runner asset).

### Fixed
- README, SKILL.md, `docs-agent/llms.txt`, and `docs-agent/llms-full.txt`
  described `local-vlm` and `cloud-vlm` as working opt-in engines while both
  were permanent `ok:false` stubs. They are now real, and the docs carry the
  env tables, error names, and measured latencies.
- Audit finding D2: `docs-agent/llms-full.txt` had zero markdown links in its
  source list. Every named source is now a relative link.

### Unchanged, deliberately
- Cloud is never a silent fallback. `cloud-vlm` runs only when
  `--engine cloud-vlm` is named; no local failure routes to it.
- Weights are never downloaded automatically. The runner sets
  `HF_HUB_OFFLINE=1` and the engine fails closed before spawning.

Engine commit: `2fdea07`.

## [0.1.2] - 2026-09-11

### Added
- Element-scoped reads: `zrv --selector <css>` and `peek_page(selector)`,
  porting the one thing `canary-text` had that `zrv` lacked.
- CLI/MCP parity: `lang` + `level` on image/video OCR, `port` on all tab
  tools, `scroll` + `waitText` on page reads, `navigate` on AX reads,
  video tuning flags on CLI `ocr`.
- `examples/`: runnable OCR + CDP walkthroughs with expected outputs.

### Fixed
- `bin` paths (`dist/...` not `./dist/...`) — npm was stripping all bins.
- Release workflow builds before publishing; pipefail so failures fail.
- Global-install docs; README design diagram, comparison table, Linux section.

## [0.1.1] - 2026-09-10

### Fixed
- Correct release notes: the `tesseract` engine and Intel-Mac default
  shipped in 0.1.0; notes said Unreleased.

## [0.1.0] - 2026-09-10

First release. Read a page, a screenshot, or a video as text —
default path never sends pixels off the machine.

### Added
- `tesseract` engine: pure-npm OCR (tesseract.js) with system-binary
  fast path, clipboard via wl-paste/xclip, ffmpeg video keyframes.
  Default pixel engine on Linux and Intel Macs.

### Added
- CLI (`zrv`): attached-tab text / markdown / AX, `--tabs`, `--url`
  with `--navigate` / `--fetch`, `ocr` for images / video / clipboard,
  `snap` interactive capture, `zrv mcp` subcommand.
- MCP server (`zrv-mcp`): `peek_tabs`, `peek_page`, `peek_a11y`,
  `ocr_image`, `ocr_video`.
- Engines: `apple-vision` OCR default, `apple-fm` describe, `local-vlm`
  and `cloud-vlm` fail-closed (weights / key required, never silent fallback).
- CLI/MCP parity: `lang` + `level` on image and video OCR, `port` on all
  tab tools, `scroll` + `waitText` on page reads, `navigate` on AX reads,
  video tuning (`--mode`, `--interval`, `--max-frames`) on the CLI.
- OIDC trusted-publishing release workflow — no npm token.
- Docs: README, `docs/spec.md`, agent skill, OCR fixtures.

### Rank (cheap and local first)
1. Chrome AX / cleaned text (attach-only CDP — no click)
2. Apple Vision OCR (`apple-vision`, default for files)
3. On-device Foundation Model (`apple-fm`)
4. Local VLM (`local-vlm`) — weights must already be on disk
5. Cloud VLM (`cloud-vlm`) — opt-in, never a fallback
