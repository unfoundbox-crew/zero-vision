---
title: zero-vision roadmap
product: zero-vision
version: 1.0.0
status: living
updated: 2026-09-12
horizon: 2026-Q4
---

## Now (this week)

- [ ] Wire `cloud-vlm` to an actual provider POST (Gemini first, per default `apiKeyEnv`) — why it matters: right now the engine always refuses even with a key set, so the 8% "describe" path has no working cloud option — done when: `zrv ocr --engine cloud-vlm --task describe` on a real image returns `ok:true` with `text` and, when the provider reports it, `costUsd`
- [ ] Fix `package.json` `files[]` to ship `docs-agent/` (llms.txt, llms-full.txt, AGENT-MANIFEST.md) and `SKILL.md` in the npm tarball — why it matters: agent-readiness audit (D4, `adopt/agent-readiness-report.md` on `adopt/review-pile`) found registry installs currently have zero agent docs — done when: `npm pack` (or the published tarball) contains `docs-agent/llms.txt`
- [ ] Add a README link to `docs-agent/llms.txt` — why it matters: same audit finding, agents landing on the README have no path to the agent-facing docs — done when: README has a working relative link to `docs-agent/llms.txt`
- [ ] Add markdown links to `docs-agent/llms-full.txt`'s source list — why it matters: audit D2, the file names sources as plain text an agent cannot follow — done when: every named source in that file is a clickable relative link

## Next (this month)

- [ ] Decide and document whether `local-vlm` ships a real MLX runner call or stays a permanent stub — why it matters: it currently always returns `ok:false` even with weights on disk, which the README does not disclose — done when: either `ZEROVISION_LIVE_VLM=1` spawns the MLX runner and returns real text, or the README/SKILL/llms.txt say plainly that `local-vlm` is not wired yet
- [ ] Reconcile pet-talk's `EYES_TIMEOUT_S` default (8s) against measured `apple-fm describe` latency (~102s on one 2280×600 PNG) — why it matters: a describe call through pet-talk's default config is expected to always time out — done when: pet-talk raises the timeout for `apple-fm`, or zero-vision's docs warn callers that `apple-fm describe` needs a timeout over 100s
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
- Downloading VLM weights automatically — spec §14; `local-vlm` requires weights already on disk.

## Shipped

| Date | Item | Commit/PR |
| --- | --- | --- |
| 2026-09-10 | First release: CLI, MCP server, apple-vision/apple-fm/local-vlm/cloud-vlm/tesseract engines | 0.1.0, see CHANGELOG.md |
| 2026-09-10 | Corrected release notes attribution | 0.1.1, see CHANGELOG.md |
| 2026-09-11 | `--selector` reads, CLI/MCP flag parity, examples, bin-path fix, release workflow pipefail fix | 0.1.2, see CHANGELOG.md |

## Decision log

| Date | Decision | Alternatives rejected | Link |
| --- | --- | --- | --- |
| 2026-09-07 | Engine adapter with one shared `PerceptionResult` schema, not one hardcoded OCR binary | Hardcoded single engine | `docs/spec.md` §2 |
| 2026-09-07 | Default engine is `apple-vision` (or `tesseract` off Apple silicon), never cloud | Auto-route tree → OCR → cloud on failure | `docs/spec.md` §2, §15 |
| 2026-09-07 | Read-only tool, no click/type/navigate | `click(uid)` in v1 | `docs/spec.md` §2, §14 |
| 2026-09-07 | Compiled Swift binary for Vision, spawned per call | dylib / N-API / in-process Vision | `docs/spec.md` §6 |
| 2026-09-07 | 9222 is opt-in only, never probed by default | Probe 9222 first | `docs/spec.md` §2, §8 |
