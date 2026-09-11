#!/usr/bin/env bash
# ADOPT-4 contact-sheet demo capture — log-first, video-optional, headless-safe.
# Runs the storyboard's OCR commands with timestamps, captures all terminal
# output to demo.log (same dir), and prints exact manual filming steps.
# No network installs. Writes only under adopt/gif/.
set -u

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUTDIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$OUTDIR/demo.log"
REPO="unfoundbox-crew/zero-vision"

ts() { date '+%Y-%m-%dT%H:%M:%S%z'; }
say()  { echo "[$(ts)] $*" | tee -a "$LOG"; }
run()  {
  # run <label> <cmd...>: echo the command, run it, capture output + exit code.
  local label="$1"; shift
  say "### $label"
  say "\$ $*"
  # shellcheck disable=SC2068
  "$@" 2>&1 | tee -a "$LOG"
  local code="${PIPESTATUS[0]}"
  say "(exit $code)"
  return 0  # never abort the demo on an expected non-zero (e.g. --tabs with no Chrome)
}

: > "$LOG"
say "ADOPT-4 demo capture — $REPO"
say "root=$ROOT outdir=$OUTDIR"
say "node=$(node --version 2>&1) ffmpeg=$(command -v ffmpeg || echo MISSING) screencapture=$(command -v screencapture || echo MISSING)"

# --- Shot 1: single-image OCR ---
run "SHOT-1 hello.png" node "$ROOT/dist/cli.js" ocr "$ROOT/fixtures/ocr/hello.png"

# --- Shot 2: contact sheet = one image, never split ---
run "SHOT-2 contact-sheet.png" node "$ROOT/dist/cli.js" ocr "$ROOT/fixtures/ocr/contact-sheet.png"

# --- Shot 3: fail-closed with no debug Chrome (expected exit 2) ---
run "SHOT-3 tabs (no Chrome, expect fail-closed)" node "$ROOT/dist/cli.js" --tabs

# --- Shot 4: PASS line (diff against checked-in expected text) ---
say "### SHOT-4 PASS check"
GOT="$(node "$ROOT/dist/cli.js" ocr "$ROOT/fixtures/ocr/hello.png" 2>/dev/null | tr -d '\r')"
WANT="$(tr -d '\r' < "$ROOT/fixtures/ocr/hello.expected.txt")"
say "got:  $GOT"
say "want: $WANT"
if [ "$GOT" = "$WANT" ]; then
  say "PASS hello.png"
else
  say "FAIL hello.png (mismatch — see got/want above)"
fi

# --- Shot 5/6 are cards, not commands (see STORYBOARD.md) ---
say "### SHOTS 5-6 are tagline + install cards (no command; filmed from STORYBOARD.md)"

# --- Video-optional: exact manual steps or SKIP reason ---
say "### capture"
if command -v ffmpeg >/dev/null 2>&1 && command -v screencapture >/dev/null 2>&1; then
  cat <<'STEPS' | tee -a "$LOG"
MANUAL CAPTURE STEPS (macOS, ~30s):
  1. Terminal 110x28, font 16pt monospace, run this script: bash adopt/gif/record.sh
  2. screencapture -v -T0 demo.mov   # full-screen video of the terminal run
     (or record terminal region only with QuickTime / Screen Studio)
  3. ffmpeg -i demo.mov -vf "fps=10,scale=880:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse" -loop 0 demo.gif
  4. Keep gif <= 6 shots per STORYBOARD.md; trim silence at head/tail.
STEPS
else
  say "SKIP video: $(command -v ffmpeg >/dev/null 2>&1 || echo 'no ffmpeg') $(command -v screencapture >/dev/null 2>&1 || echo 'no screencapture') — log-first deliverable stands alone (demo.log)."
fi

say "DONE — log: $LOG"
