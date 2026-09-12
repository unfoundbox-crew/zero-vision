# Changelog

All notable changes to `zero-vision` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [SemVer](https://semver.org/).

## [Unreleased]

### Added
- `local-vlm` stays warm. The first call starts a small per-user daemon
  (`src/engines/local_vlm_daemon.py`) that loads the weights once and answers
  over a `0600` Unix socket at
  `~/Library/Application Support/zero-vision/local-vlm.sock` (XDG state dir off
  macOS, `ZRV_LOCAL_VLM_SOCK` overrides). Later calls skip the model load, which
  was most of the wall clock. JSON in and out is byte-identical to the cold
  path — the daemon imports `load_model()`/`infer()` from
  `local_vlm_runner.py`, so warm and cold cannot drift apart.
  - Measured 2026-09-12, `mlx-community/Qwen2-VL-2B-Instruct-4bit` at
    `nice 19`, one 1280x800 PNG, machine busy (load average 24-45, other
    builds running), p50 of five warm calls:

    | Task | Warm p50 (n=5) | Warm range | Cold one-shot, same session | First call |
    | --- | --- | --- | --- | --- |
    | `transcribe` | **5.7 s** | 5.0-7.3 s | 10.8-17.4 s | 9.1 s |
    | `describe` | **6.7 s** | 6.2-8.0 s | 11.0-14.1 s | 13.0 s |

    Model load alone was 9.4 s of that first call. Warm `describe` clears
    pet-talk's "under 10 s" bar but not the 5 s stretch target on this machine's
    load — reported as measured, not hidden; an earlier pass at load 14 gave
    4.7-5.9 s, so the 5 s target looks reachable on an idle machine and the
    model choice is the next thing to revisit. The documented 8B default
    remains unmeasured — those weights are not on this machine.
  - New env: `ZRV_LOCAL_VLM_WARM` (`1`; `0` pins the old one-shot spawn),
    `ZRV_LOCAL_VLM_IDLE_S` (`600`, or `ZRV_LOCAL_VLM_IDLE_MS`),
    `ZRV_LOCAL_VLM_QUEUE_MAX` (`2`), `ZRV_LOCAL_VLM_SOCK`, `ZRV_STATE_DIR`,
    `ZRV_LOCAL_VLM_NICE` (`19`), `ZRV_LOCAL_VLM_SPAWN_TIMEOUT_MS` (`20000`),
    `ZRV_LOCAL_VLM_DAEMON` (daemon-script seam, mirrors
    `ZRV_LOCAL_VLM_RUNNER`).
  - New CLI: `zrv local-vlm status [--json]` (pid, pinned model, protocol, load
    ms, request and queue counters, idle vs budget; exit 0 running, 3 none) and
    `zrv local-vlm stop [--json]`.
  - `PerceptionResult` gains two optional `local-vlm` fields: `warm: true` when
    the daemon served the call, and `warmError` naming why the cold path ran
    instead. Nothing else changed shape.
  - Fail-closed by design, four ways: the daemon is a cache, never a
    requirement, so any start or transport failure falls back to the one-shot
    spawn and reports the reason instead of erroring; the model is pinned at
    spawn and a request for a different one replaces the daemon rather than
    reloading in place (`local_vlm_daemon_model_mismatch`); one inference at a
    time, with callers past the queue cap answered `local_vlm_busy` rather than
    piling onto the GPU; and an exclusive `flock` beside the socket means
    exactly one daemon owns it. Weights are still never downloaded — the daemon
    imports the runner, which sets `HF_HUB_OFFLINE=1` first. Idle exit releases
    the RAM.
  - Hermetic tests in `src/test/local-vlm-warm.test.ts` against a fake daemon
    (`fixtures/vlm/fake-daemon.mjs`): spawn, process reuse across calls, idle
    exit and transparent restart, queue cap, cold fallback with the reason,
    missing daemon script, model swap, protocol mismatch, warm off. No MLX, no
    weights, no network.

## [0.2.1] - 2026-09-12

### Fixed
- `cloud-vlm` no longer returns a fake `ok:true` when the LiteLLM proxy
  silently reroutes the requested model to a different one. Found live
  2026-09-12: a request for `claude-sonnet-4-6` came back served by
  `openai/gpt-oss-20b`, a text-only model, which answered with a refusal
  sentence instead of an error — exactly the shape `ok:true` was meant to
  rule out. Two independent, fail-closed checks now run on every response:
  the served `model` field is compared against the requested one (provider
  prefixes like `openai/`/`anthropic/` and version/date suffixes normalized
  away first) and a mismatch fails `cloud_vlm_model_mismatch` naming both
  ids, unless `ZRV_CLOUD_VLM_ALLOW_REROUTE=1`; separately, the reply text is
  scanned for a non-vision refusal ("can't see the image", "no ability to
  view images", etc.) and fails `cloud_vlm_no_vision` if found — this one
  fires even when the served model id matches, since a reroute could land on
  another vision-capable model that still declines to look. Both map to exit
  code 3 (engine unavailable), same as `cloud_vlm_no_key`. Hermetic tests for
  both paths in `src/test/cloud-vlm.test.ts`. Re-run live against the exact
  bug, same proxy, unmodified default config:
  ```json
  {"ok":false,"engine":"cloud-vlm","task":"describe","text":"","ms":27335,"model":"openai/gpt-oss-20b","error":"cloud_vlm_model_mismatch: requested \"claude-sonnet-4-6\" but the proxy served \"openai/gpt-oss-20b\"; set ZRV_CLOUD_VLM_ALLOW_REROUTE=1 to accept a rerouted model"}
  ```
  Confirms the proxy is still rerouting the default model as of this fix —
  no model is currently verified working through it end to end; see
  `docs/ARCHITECTURE.md` Known gaps.

### Changed
- `cloud-vlm`'s default model is now `claude-sonnet-4-6`, not `gemini-3.7-flash`.
  2026-09-12: `gemini-3.7-flash` is out of daily quota (429) on Saurabh's proxy,
  while `claude-sonnet-4-6` works for both `transcribe` and `describe` (5.8 s /
  6.0 s measured on a 1280x800 screenshot). Switch back with
  `ZRV_CLOUD_VLM_MODEL=gemini-3.7-flash` once the quota resets.

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
