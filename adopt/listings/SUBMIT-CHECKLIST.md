# zero-vision — SUBMIT CHECKLIST (human clicks submit; agent drafts only)

> DRAFT ONLY — nothing here has been submitted. Work top to bottom; each
> directory takes minutes. Boston: drafts only, never submit from this lane.

## Pre-flight (do once)

- [ ] `npm run build` passes; `dist/` contains `cli.js`, `mcp.js`, `snap.js` (verified 2026-09-11 — all present)
- [ ] Fix or accept the version skew: `package.json` = `0.1.2`, README table still says `0.1.0`
- [ ] Repo is public at `https://github.com/unfoundbox-crew/zero-vision` (confirm visibility before linking directories to it)
- [ ] llms.txt submission is BLOCKED until an `llms.txt` or docs site exists (see `llmstxt-hub.md`) — skip section 3 until then

## 1. Skills directory (skills.sh / ClawHub-style)

Source file: `openclaw-skills.md`

1. Go to the skills directory submit page (skills.sh submit / ClawHub publish — confirm exact URL at submit time, not verified from this lane).
2. Click **Submit / Publish skill**.
3. Fields:
   - Name → `zero-vision`
   - Repo URL → `https://github.com/unfoundbox-crew/zero-vision`
   - Install command → `npx skills add unfoundbox-crew/zero-vision -g`
   - Description → paste the "Description for the directory form" block from `openclaw-skills.md`
   - Tags → `ocr, vision, mcp, accessibility, pdf, video, privacy, macos, cli`
4. Submit, keep the listing URL for the README badge.

## 2. Awesome MCP list (awesome-mcp-servers style, PR-based)

Source file: `awesome-mcp.md`

1. Go to `https://github.com/punkpeye/awesome-mcp-servers` (or successor fork — confirm canonical repo at submit time, not verified from this lane).
2. Click **Fork**, then edit the servers data file (`data/servers.json` or `README.md` — follow that repo's `CONTRIBUTING.md`).
3. Paste the entry from `awesome-mcp.md`: name `zero-vision`, the ≤100-char
   description, link `https://github.com/unfoundbox-crew/zero-vision`, category Vision/OCR.
4. Run their README generator if instructed (`npm run generate-readme` or equivalent).
5. Open the PR, paste the comparison note from `awesome-mcp.md` into the PR body, submit.

## 3. llms.txt hub — BLOCKED (see above)

Source file: `llmstxt-hub.md`

1. FIRST publish `llms.txt` (Option A or B in `llmstxt-hub.md`).
2. THEN go to `https://llmstxthub.com` → click **Submit llms.txt** (or `directory.llmstxt.cloud` → Submit).
3. Fields: docs/`llms.txt` URL → the new URL; description → the 5-line block from `llmstxt-hub.md`.
4. Submit.

## Post-submit

- [ ] Record listing URLs back into this folder (append to each file).
- [ ] Optional: add badges (skills directory, awesome list) to `README.md`.
