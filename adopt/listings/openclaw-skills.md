# zero-vision — skill listing draft (DRAFT, do not submit yet)

> Submission-ready draft for a skills directory (skills.sh / ClawHub-style).
> Human reviews, then pastes into the directory's submit form. DRAFT ONLY.

## Skill name

`zero-vision`

## One-line pitch

Read a page, a screenshot, or a video as text — local-first, pixels never leave the machine unless you name a cloud engine.

## Install

```bash
npx skills add unfoundbox-crew/zero-vision -g
```

Verified against repo: this exact command appears in `README.md` line 140
("Agent skill: `npx skills add unfoundbox-crew/zero-vision -g`").

## Source

- GitHub: `https://github.com/unfoundbox-crew/zero-vision`
- npm package: `zero-vision` (v0.1.2 per `package.json`)
- License: Apache-2.0
- Bins: `zrv`, `zrv-mcp`, `snap` (per `package.json` `bin` field)
- Skill file: `SKILL.md` at repo root

## Triggers (when the agent should reach for this skill)

- "What's on screen / what does this tab say" where the answer is words, not taste
- OCR off a screenshot, contact sheet, PDF page, or local video clip
- Read an already-open debug-Chrome tab as text / markdown / AX tree
- Contact-sheet text, title cards, clipped headlines
- Any "read this image" task where attaching a PNG to a frontier vision model would cost tokens and leak pixels

## Explicit non-triggers

- Clicking, typing, or driving a browser (use Chrome DevTools MCP / Playwright MCP)
- Room reconstruction / CV depth / SDF block-out (that's MotionVector, not this tool)

## Description for the directory form (paste)

> zero-vision (`zrv`): read a page, a screenshot, or a video as text. Cheap
> and local first — Chrome AX text, Apple Vision OCR, on-device Foundation
> Model, local VLM — with cloud VLM only on explicit opt-in. MCP tools:
> `peek_tabs`, `peek_page`, `peek_a11y`, `ocr_image`, `ocr_video`. macOS +
> Apple silicon for pixel engines; CDP text works anywhere Node 22 runs.
> NOT a browser driver — does not click.

## Metadata / tags suggestion

`ocr`, `vision`, `mcp`, `accessibility`, `pdf`, `video`, `privacy`, `macos`, `cli`

## Version note

`package.json` says `0.1.2`. `README.md` comparison table still says "0.1.0,
unproven at scale" — update README before submitting, or expect reviewers to ask.
