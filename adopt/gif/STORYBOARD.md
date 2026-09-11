# ADOPT-4 — 30-second contact-sheet demo gif: storyboard

Source of truth for filming: `record.sh` (run it: `bash adopt/gif/record.sh`).
The gif is 6 shots max, ~30s total, 880px wide, 10fps. Terminal 110x28,
16pt monospace, light-on-dark. Pixels stay local — say so on camera.

| # | Time | What the viewer sees | Command / card | Notes |
| - | ---- | -------------------- | -------------- | ----- |
| 1 | 0–4s | Command typed, output streams one line | `$ node dist/cli.js ocr fixtures/ocr/hello.png` → `HELLO ZEROVISION` | Type at human speed; hold output 1s. Log: SHOT-1. |
| 2 | 4–12s | Contact sheet OCR streams 9 lines | `$ node dist/cli.js ocr fixtures/ocr/contact-sheet.png` → `TITLE 1 … TITLE 9` | The point: one image in, text out — never split the grid. Hold full grid 2s. Log: SHOT-2. |
| 3 | 12–17s | Fail-closed beat, no Chrome running | `$ node dist/cli.js --tabs` → `no debug port (tried 1948, 9223)…` | Shows no silent fallback, no 9222. Expected non-zero exit is the demo. Log: SHOT-3. |
| 4 | 17–21s | PASS line | `PASS hello.png` (diff vs `fixtures/ocr/hello.expected.txt`) | Green check or bold PASS; hold 2s. Log: SHOT-4. |
| 5 | 21–26s | Tagline card (static, no typing) | `zero-vision — read it as text. No pixels leave the machine.` | Full-screen card, large type. Silence is fine here. |
| 6 | 26–30s | Install card (static) | `npm install -g zero-vision` + `github.com/unfoundbox-crew/zero-vision` | End frame holds 3s for gif loop point. |

## Filming

- Headless-safe: shots 1–4 come straight from `demo.log` (record.sh output).
  Shots 5–6 are static cards — any editor can set them, no screen needed.
- macOS capture: `screencapture -v demo.mov`, then
  `ffmpeg -i demo.mov -vf "fps=10,scale=880:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse" -loop 0 demo.gif`
- If no ffmpeg/screencapture: SKIP video (record.sh prints the reason);
  the storyboard + demo.log is the complete deliverable.
- Never `npx zrv` on camera (zombie name). Use `node dist/cli.js` from a
  checkout or an installed `zrv`.
