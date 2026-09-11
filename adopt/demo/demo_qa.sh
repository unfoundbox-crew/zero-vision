#!/usr/bin/env bash
# demo_qa.sh — code-to-3D QA proof: zero-vision OCR on repo fixtures via tesseract.
# Consumed by: MotionVector/mvec (title cards, contact sheets) + AgentWorth (92% transcription).
# Usage: ./demo_qa.sh  (exit 0 on PASS, 1 on FAIL)
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="node $ROOT/dist/cli.js"
HELLO="$ROOT/fixtures/ocr/hello.png"
SHEET="$ROOT/fixtures/ocr/contact-sheet.png"
PASS=0; FAIL=0
now_ms() { python3 -c 'import time;print(int(time.time()*1000))'; }

run_ocr() {
  f="$1"; t0=$(now_ms)
  out=$($CLI ocr "$f" --engine tesseract 2>&1); code=$?
  t1=$(now_ms); ms=$((t1 - t0))
  printf '%s' "$out"; printf ' [exit=%s ms=%s]\n' "$code" "$ms" >&2
  return $code
}

echo "== zero-vision QA demo (engine=tesseract, local-only) =="
echo "--- 1/2 hello.png: expect HELLO + ZEROVISION ---"
t0=$(now_ms)
H_OUT=$($CLI ocr "$HELLO" --engine tesseract 2>&1); H_CODE=$?
t1=$(now_ms); H_MS=$((t1 - t0))
echo "output: $H_OUT"
echo "timing: ${H_MS}ms exit=$H_CODE"
if [ $H_CODE -eq 0 ] && printf '%s' "$H_OUT" | grep -qi HELLO && printf '%s' "$H_OUT" | grep -qi ZEROVISION; then
  echo "PASS hello.png (${H_MS}ms)"; PASS=$((PASS+1))
else echo "FAIL hello.png (${H_MS}ms)"; FAIL=$((FAIL+1)); fi

echo "--- 2/2 contact-sheet.png: expect >=3 TITLE cards, no grid split ---"
t0=$(now_ms)
C_OUT=$($CLI ocr "$SHEET" --engine tesseract 2>&1); C_CODE=$?
t1=$(now_ms); C_MS=$((t1 - t0))
echo "output: $C_OUT"
echo "timing: ${C_MS}ms exit=$C_CODE"
C_N=$(printf '%s' "$C_OUT" | grep -oi TITLE | wc -l | tr -d ' ')
if [ $C_CODE -eq 0 ] && [ "$C_N" -ge 3 ]; then
  echo "PASS contact-sheet.png (titles=$C_N ${C_MS}ms)"; PASS=$((PASS+1))
else echo "FAIL contact-sheet.png (titles=$C_N ${C_MS}ms)"; FAIL=$((FAIL+1)); fi

echo "== result: PASS=$PASS FAIL=$FAIL =="
[ "$FAIL" -eq 0 ] && echo "QA DEMO: PASS" && exit 0 || { echo "QA DEMO: FAIL"; exit 1; }
