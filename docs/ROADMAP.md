---
title: zero-vision roadmap
product: zero-vision
version: 1.1.0
status: living
updated: 2026-09-12
horizon: 2026-Q4
---

## Now (this week)

- [ ] Prove `cloud-vlm` `describe` live on the default model (`gemini-3.7-flash`) — why it matters: transcribe is proven (4.2 s) but describe hit Gemini's daily-quota 429 on 2026-09-12 and was proved on `claude-sonnet-4-6` instead, so the default's describe path is unverified — done when: one `--engine cloud-vlm --task describe` run on `gemini-3.7-flash` returns `ok:true`, recorded with its latency
- [ ] Measure `local-vlm` on the documented default `mlx-community/Qwen3-VL-8B-Instruct-4bit` — why it matters: the shipped numbers (13.1 s / 12.6 s) are for the 2B model that was downloaded for verification; the 8B default is unmeasured and will be slower — done when: both tasks are timed on the 8B and the README table names which model each row is

## Next (this month)

- [ ] Keep a `local-vlm` process warm between calls — why it matters: ~13 s per image is almost all cold model load, since every call spawns a fresh Python process and reloads the weights; a warm runner is the difference between "usable in a loop" and "one-shot only" — done when: a second call in the same session is measurably faster than the first, with the number recorded
- [ ] Tell pet-talk that `local-vlm` is now the fast describe engine — why it matters: pet-talk's `EYES_TIMEOUT_S` default is 8 s against `apple-fm describe`'s ~102 s, so describe always times out; `local-vlm` at ~13 s makes a modest timeout raise sufficient instead of impossible — done when: pet-talk either pins `local-vlm` for describe or raises the timeout to fit a named engine, and zero-vision's docs state the per-engine describe latencies (docs half done, 0.2.0)
- [ ] Set GitHub repo topics and `homepage` — why it matters: audit D5, empty topics/homepage hurt discovery — done when: `gh repo view unfoundbox-crew/zero-vision --json topics,homepage` shows non-empty values
- [ ] Clarify the README/llms.txt engine-rank list so "Chrome AX" reads as a separate producer, not a sixth `--engine` choice — why it matters: current phrasing implies `--engine` accepts a CDP option that does not exist in `EngineId` — done when: the rank section visually separates "the CDP reader (default for tab reads)" from "the five `--engine` values"

## Later (this quarter)

- [ ] `local-vlm` on-machine benchmark: tok/s and TTFT for the cached Qwen3-VL-8B-4bit on the actual dev machine — why it matters: spec calls this "unflown," several docs still avoid quoting a number — done when: one measured run is logged with machine name, model, and elapsed time, and the number appears in `docs/spec.md` §17 replacing "Not confirmed"
- [ ] Contact-sheet grid split (`--grid 3x3`) as a later engine option — why it matters: spec names it explicitly as v2, not v1 — done when: a flag exists and a fixture test confirms per-cell text extraction
- [ ] Windows support investigation — why it matters: currently explicit non-goal (spec §14), revisit only if a consumer asks — done when: either a decision to stay macOS/Linux-only is written down, or a Windows backend plan exists

## Not doing (and why)

- Splitting contact sheets into a grid in v1 — spec §14 non-goal; one image, one OCR call keeps the 27% audited use case simple.
- Any form of click/type/navigate-by-default browser driving — spec §14, explicit non-goal; Chrome DevTools MCP and Playwright MCP already own that.
- Silent cloud fallback when a local engine fails — the whole reason this tool exists (spec §1); `cloud-vlm` stays opt-in and named, even once it's wired to a real provider.
- Downloading VLM weights automatically — spec §14; `local-vlm` requires weights already on disk. Enforced twice as of 0.2.0: the engine fails closed before spawning, and the runner sets `HF_HUB_OFFLINE=1`.
- Bundling a provider SDK for `cloud-vlm` — it is one `fetch` to an OpenAI-compatible endpoint, so a dependency would buy nothing. Provider choice is a base URL and a key.

## Shipped

| Date | Item | Commit/PR |
| --- | --- | --- |
| 2026-09-10 | First release: CLI, MCP server, apple-vision/apple-fm/local-vlm/cloud-vlm/tesseract engines | 0.1.0, see CHANGELOG.md |
| 2026-09-10 | Corrected release notes attribution | 0.1.1, see CHANGELOG.md |
| 2026-09-11 | `--selector` reads, CLI/MCP flag parity, examples, bin-path fix, release workflow pipefail fix | 0.1.2, see CHANGELOG.md |
| 2026-09-12 | `docs-agent/` (llms.txt, llms-full.txt) and `SKILL.md` added to `package.json` `files[]`; README linked to `docs-agent/llms.txt` (fixes audit finding D4) | bee068a, "Agent pack: llms.txt, full text, manifest, README links, ship in tarball (#12)" |
| 2026-09-12 | `cloud-vlm` wired to a real OpenAI-compatible `POST /chat/completions` with a base64 data-URL image; LiteLLM proxy is the default target, OpenRouter and Gemini-direct are alternate base-URL/key configs; still opt-in, still never a fallback | 2fdea07, `feat/real-vlm-engines` |
| 2026-09-12 | `local-vlm` wired to mlx-vlm through `src/engines/local_vlm_runner.py`; `ZRV_LOCAL_VLM_MODEL` takes an HF id or a weights dir; fails closed with `local_vlm_no_weights` naming the path and the download command | 2fdea07, `feat/real-vlm-engines` |
| 2026-09-12 | Markdown links in `docs-agent/llms-full.txt`'s source list (fixes audit finding D2) | this branch |
| 2026-09-12 | Hermetic tests for both opt-in engines: loopback OpenAI-compatible stub server, fake runner script | 2fdea07, `feat/real-vlm-engines` |

## Decision log

| Date | Decision | Alternatives rejected | Link |
| --- | --- | --- | --- |
| 2026-09-07 | Engine adapter with one shared `PerceptionResult` schema, not one hardcoded OCR binary | Hardcoded single engine | `docs/spec.md` §2 |
| 2026-09-07 | Default engine is `apple-vision` (or `tesseract` off Apple silicon), never cloud | Auto-route tree → OCR → cloud on failure | `docs/spec.md` §2, §15 |
| 2026-09-07 | Read-only tool, no click/type/navigate | `click(uid)` in v1 | `docs/spec.md` §2, §14 |
| 2026-09-07 | Compiled Swift binary for Vision, spawned per call | dylib / N-API / in-process Vision | `docs/spec.md` §6 |
| 2026-09-07 | 9222 is opt-in only, never probed by default | Probe 9222 first | `docs/spec.md` §2, §8 |
| 2026-09-12 | `cloud-vlm` is a plain `fetch` to an OpenAI-compatible endpoint, not a provider SDK | A provider SDK as an optional peerDependency; one hardcoded provider | `src/engines/cloud/index.ts` |
| 2026-09-12 | Default `cloud-vlm` target is the self-hosted LiteLLM proxy at a base URL the operator sets, defaulting to localhost | Hardcoding the proxy's tailnet address; defaulting to OpenRouter or a direct Gemini key | `src/engines/cloud/index.ts`, mirrors pet-talk `server/settings.py` |
| 2026-09-12 | `local-vlm` shells out to a Python runner per call | A long-lived runner daemon (see Next); Node-side MLX bindings | `src/engines/local_vlm_runner.py` |
