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
4. Local VLM (`local-vlm`) — weights must already be on disk
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

## Commands

```text
zrv                  text of the chosen debug-Chrome tab
zrv --md             markdown
zrv --a11y           interesting AX tree
zrv --tabs
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

## Who consumes this

Standalone repo. Other crew products call it; they do not own it.

| Project | Job |
| --- | --- |
| MotionVector / `mvec` | Contact sheets, title cards, "what does this frame say" after `mvec frame` |
| AgentWorth | The 92% of visual sessions that are transcription, not taste |
| SpacePilot | Optional `--engine local-vlm` when weights are already on disk |

Photos of a room → classical CV → SDF block-out is MotionVector. This tool stops at text (and, if named, a local/cloud VLM).

## v1 limits

`local-vlm` and `cloud-vlm` are fail-closed: they check weights/key and refuse to spawn or POST. Contact sheets are one image, not a split grid. Video OCR needs the native binary.

## Spec

[`docs/spec.md`](docs/spec.md)

## License

Apache License 2.0. See [LICENSE](LICENSE).
