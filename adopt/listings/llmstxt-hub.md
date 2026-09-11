# zero-vision — llms.txt hub submission notes (DRAFT, do not submit yet)

> Notes for submitting zero-vision docs to an llms.txt directory
> (llmstxthub.com / directory.llmstxt.cloud style). Human reviews, then clicks
> submit. DRAFT ONLY.

## ⚑ Prerequisite — no submittable docs URL exists yet

Verified 2026-09-11: the repo has **no `llms.txt` file** (glob for
`**/llms.txt*` found nothing) and **no docs site** — only `docs/spec.md` in
the repo plus `README.md` / `SKILL.md`. llms.txt hubs require a live URL
serving an `llms.txt` file. **Do not submit until one of these exists:**

- Option A (cheapest): commit an `llms.txt` at the repo root, served raw via
  GitHub, e.g. `https://raw.githubusercontent.com/unfoundbox-crew/zero-vision/main/llms.txt`
  (renders as text; some hubs accept this, some require HTML docs).
- Option B (proper): publish docs (GitHub Pages / Mintlify / docs site) with
  `/llms.txt` at root, then submit that docs URL.

## What the docs URL would be

- Today: `https://github.com/unfoundbox-crew/zero-vision` (repo only — NOT an
  llms.txt URL; hubs will reject it as a docs submission).
- After Option A: `https://raw.githubusercontent.com/unfoundbox-crew/zero-vision/main/llms.txt`
- After Option B: `<docs-site>/llms.txt` (docs site does not exist yet).

## 5-line description (paste into the hub form once the URL exists)

```text
zero-vision (zrv): read a page, screenshot, or video as text.
Local-first perception rank: Chrome AX text, Apple Vision OCR, on-device
Foundation Model, local VLM — cloud VLM only on explicit opt-in.
MCP: peek_tabs, peek_page, peek_a11y, ocr_image, ocr_video via `zrv mcp`.
CLI: zrv, zrv-mcp, snap. npm: zero-vision v0.1.2, Apache-2.0.
Not a browser driver — it reads, never clicks.
```

## Suggested llms.txt skeleton (for whoever writes Option A)

```text
# zero-vision
> Read a page, a screenshot, or a video as text. Default path never sends pixels off the machine.
- [README](https://github.com/unfoundbox-crew/zero-vision#readme): install, commands, perception rank
- [Spec](https://github.com/unfoundbox-crew/zero-vision/blob/main/docs/spec.md): behavior contract
- [Skill](https://github.com/unfoundbox-crew/zero-vision/blob/main/SKILL.md): when agents should use this
```
