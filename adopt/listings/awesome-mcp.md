# zero-vision — awesome-list entry draft (DRAFT, do not submit yet)

> Submission-ready draft for an awesome MCP servers list (e.g. punkpeye /
> appcypher `awesome-mcp-servers` or equivalent). Human reviews, then opens
> the PR. DRAFT ONLY.

## Entry (paste into the list / PR)

- **Name:** `zero-vision`
- **Description (97 chars):**
  `Read tabs, screenshots and video as text — local OCR first, cloud opt-in only`
- **Link:** `https://github.com/unfoundbox-crew/zero-vision`
- **npm:** `zero-vision` (v0.1.2, Apache-2.0, bins `zrv` / `zrv-mcp` / `snap`)
- **MCP transport:** stdio via `zrv mcp` — tools `peek_tabs`, `peek_page`,
  `peek_a11y`, `ocr_image`, `ocr_video`

Character count check: the description above is 97 chars including spaces
(limit ≤100). Counted by hand — recount in the PR form if the form enforces it.

## Category suggestion

**Vision / OCR** (or `Media` / `Utilities` if the list has no Vision section).

Why it fits:

1. Its MCP surface is read-only perception (`peek_*`, `ocr_*`) — closest
   neighbors in these lists are OCR / image-read servers (e.g. `ocrtool-mcp`),
   not browser drivers.
2. It explicitly is NOT a browser driver (README: "Chrome DevTools MCP and
   Playwright MCP already click"), so it does not belong under
   Browser Automation — filing it there would mislead.
3. Fallback if the list has neither: `Developer Tools` / `Utilities`, with a
   note that pixel engines need macOS + Apple silicon (CDP text works on Linux).

## One-line comparison note (optional, for PR body)

> Local-first alternative to screenshotting into a frontier VLM: free per
> call, private by default, deterministic; fail-closed cloud (`local-vlm` /
> `cloud-vlm` refuse rather than silently fall back).
