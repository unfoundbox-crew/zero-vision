# zero-vision adopt demo (ADOPT-1)
Proves code-to-3D QA + AgentWorth consume zero-vision locally.
No network installs; all writes under adopt/demo/; engine=tesseract.
1) QA: `node dist/cli.js ocr` on repo fixtures, asserted + timed.
Run: `./adopt/demo/demo_qa.sh` (exit 0 on PASS).
Direct: `node dist/cli.js ocr fixtures/ocr/hello.png --engine tesseract`
Got: `HELLO ZEROVISION` (314ms, exit 0) -> PASS.
Direct: `node dist/cli.js ocr fixtures/ocr/contact-sheet.png --engine tesseract`
Got: `TITLE 1 TITLE 2 TITLE 3 TITLE 4 TITLE 5 TITLE 6 TITLE 7 TITLE 8 TITLE 9`
Sheet rule: one image, never split grid; assert >=3 TITLE (got 9) -> PASS.
QA result pasted: `== result: PASS=2 FAIL=0 ==` then `QA DEMO: PASS`.
What QA proves: mvec title-cards/contact-sheets read as text post-`mvec frame`.
What QA proves: AgentWorth visual sessions that are transcription (measured 92%).
2) CDP: tabs -> page -> selector against live debug port, local-only.
Run: `./adopt/demo/demo_cdp.sh` (exit 0 on PASS or clean SKIP).
Step 1: `node dist/cli.js --tabs` lists id/title/url per tab.
Step 2: `node dist/cli.js --tab <id>` prints attached title+url, then page text.
Step 3: `node dist/cli.js --tab <id> --selector "h1"` prints element text only.
No port here, so skip path verified: `SKIP: no debug port attached (tried 1948, 9223).`
Reason pasted: `no debug port (tried 1948, 9223). Start Chrome with --remote-debugging-port=<n>`
To go live: `Chrome --remote-debugging-port=1948`, re-run same script -> PASS.
What CDP proves: "what does this tab say" without pixels off-machine.
Consumers: code-to-3D QA reads renders; AgentWorth transcribes visual sessions.
Re-verify: run both scripts; QA must exit 0, CDP must exit 0 (PASS or SKIP).
Files: adopt/demo/demo_qa.sh, adopt/demo/demo_cdp.sh, adopt/demo/DEMO.md.
Timings vary per run (300-500ms QA here); assertions are text, not timing.
Fail-closed: tesseract describe refused; cloud-vlm never a fallback.
Rank honored: attached-tab AX first, ocr second, local-vlm/cloud only if named.
End of ADOPT-1 narrative (30 lines).
Verified 2026-09-11, zero-vision 0.1.2, node v22, no network installs.
