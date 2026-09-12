---
name: zero-vision
description: >-
  Read a page, a screenshot, or a video as text without sending pixels off the
  machine. Use when the job is OCR, contact-sheet text, title cards, clipped
  headlines, or "what does this tab say". Prefer this over attaching a PNG to a
  frontier vision model. NOT a browser driver — does not click.
---

# zero-vision (`zrv`)

Cheap and local first. Frontier only when the user names an engine.

## When to use

- Read text off a screenshot, contact sheet, PDF page, or local video
- Read an already-open debug-Chrome tab as text / markdown / AX
- The user said "what's on screen" and the answer is words, not taste

Do not use this to click, type, or drive a browser. Chrome DevTools MCP and Playwright MCP already do that.

## Rank

1. `zrv` / `zrv --md` / `zrv --a11y` — attached tab, AX text, no pixels
2. `zrv ocr <file>` — Apple Vision, default
3. `zrv ocr --engine apple-fm --task describe` — on-device sentence of judgment
4. `--engine local-vlm` — mlx-vlm, only if weights are already on disk (~13 s per image)
5. `--engine cloud-vlm` — only if the user named it. Never a fallback

## Commands

```bash
zrv                         # chosen debug-Chrome tab as text
zrv --tabs
zrv --selector <css>              # element text only (the canary-text port)
zrv ocr shot.png [--lang en-US] [--level fast]
zrv ocr sheet.png           # contact sheet: one image, do not split the grid
zrv ocr clip.mp4 [--mode scene|interval|all-idr] [--interval 2] [--max-frames 60]
zrv ocr --clipboard
zrv snap --ocr
```

Install: `npm install -g zero-vision` then `npm run native` from a checkout for OCR. Package name is `zero-vision`; `npx zrv` hits a zombie. Use `npx zero-vision`.

MCP: `zrv mcp` — tools `peek_tabs` `peek_page` `peek_a11y` `ocr_image` `ocr_video`.

## The two opt-in describe engines

Both run real inference and both fail closed with a named error. Neither is
ever reached unless the user named it with `--engine`.

```bash
# local: mlx-vlm on Apple silicon. Weights must already be on disk.
ZRV_PYTHON=<python-with-mlx-vlm> \
ZRV_LOCAL_VLM_MODEL=mlx-community/Qwen2-VL-2B-Instruct-4bit \
  zrv ocr shot.png --engine local-vlm --task describe

# cloud: one OpenAI-compatible /chat/completions call. Set the base URL.
LITELLM_BASE_URL=http://<proxy>:8000/v1 LITELLM_MASTER_KEY=... \
  zrv ocr shot.png --engine cloud-vlm --task describe --json
```

Measured 2026-09-12 on one 1280x800 screenshot: `local-vlm` (Qwen2-VL-2B-4bit)
13.1 s transcribe, 12.6 s describe — roughly 8x faster than `apple-fm`'s ~102 s
describe, and the reason to prefer it when a caller needs a describe under a
short timeout. `cloud-vlm` was ~6 s on the same image.

Failures name themselves: `local_vlm_no_weights` (says the path and the download
command), `local_vlm_no_python`, `cloud_vlm_no_key`, `cloud_vlm_http_<status>`,
`cloud_vlm_timeout`. Never retry a fail-closed engine with cloud unless the user
asked for cloud.

## Who consumes this

| Project | Job |
| --- | --- |
| MotionVector / `mvec` | Contact sheets and title cards after `mvec frame` |
| AgentWorth | Visual sessions that are actually transcription (measured 92%) |
| SpacePilot | Optional `local-vlm` backend when the user names it |

Room reconstruction (OpenCV / depth / SDF) is MotionVector, not this tool.
