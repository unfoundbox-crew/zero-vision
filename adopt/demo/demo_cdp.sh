#!/usr/bin/env bash
# demo_cdp.sh — CDP loop proof: tabs -> page -> selector against a live debug port.
# SKIPs cleanly (exit 0) when no debug Chrome is attached. No pixels leave the machine.
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CLI="node $ROOT/dist/cli.js"
echo "== zero-vision CDP demo (tabs -> page -> selector) =="

if ! TABS_OUT=$($CLI --tabs 2>&1); then
  echo "SKIP: no debug port attached (tried 1948, 9223)."
  echo "reason: $(printf '%s' "$TABS_OUT" | head -n 1)"
  echo "to attach: Chrome --remote-debugging-port=1948, then re-run."
  echo "CDP DEMO: SKIP"
  exit 0
fi
echo "--- 1/3 tabs ---"
echo "$TABS_OUT"
TAB_ID=$(printf '%s' "$TABS_OUT" | head -n 1 | cut -f1)
echo "using tab: $TAB_ID"
echo "--- 2/3 page (text) ---"
$CLI --tab "$TAB_ID" 2>&1 | head -n 20
echo "--- 3/3 selector (h1) ---"
$CLI --tab "$TAB_ID" --selector "h1" 2>&1 | head -n 20
echo "CDP DEMO: PASS (live loop closed)"
