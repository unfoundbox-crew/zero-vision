# Changelog

All notable changes to `zero-vision` are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versioning follows [SemVer](https://semver.org/).

## [Unreleased]

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
