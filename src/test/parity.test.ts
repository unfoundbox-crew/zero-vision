import assert from "node:assert/strict";
import test from "node:test";
import { parseArgv } from "../cli.js";
import { listMcpTools } from "../mcp.js";

test("ocr video flags parse", () => {
  const p = parseArgv(["ocr", "clip.mp4", "--mode", "interval", "--interval", "2", "--max-frames", "30"]);
  assert.equal(p.cmd, "ocr");
  assert.deepEqual(p.pos, ["clip.mp4"]);
  assert.equal(p.flags.mode, "interval");
  assert.equal(p.flags.interval, "2");
  assert.equal(p.flags["max-frames"], "30");
});

test("ocr image keeps lang and level", () => {
  const p = parseArgv(["ocr", "shot.png", "--lang", "en-US", "--level", "fast"]);
  assert.deepEqual(p.langs, ["en-US"]);
  assert.equal(p.flags.level, "fast");
});

test("--selector takes a css value", () => {
  const p = parseArgv(["--selector", "main article", "--tab", "abc"]);
  assert.equal(p.cmd, "page");
  assert.equal(p.flags.selector, "main article");
  assert.equal(p.flags.tab, "abc");
});

test("mcp tools cover cli parity params", () => {
  const tools = listMcpTools();
  const byName = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema.properties as Record<string, unknown>]));
  assert.ok(byName.peek_tabs.port, "peek_tabs needs port");
  assert.ok(byName.peek_page.port, "peek_page needs port");
  assert.ok(byName.peek_page.scroll, "peek_page needs scroll");
  assert.ok(byName.peek_page.waitText, "peek_page needs waitText");
  assert.ok(byName.peek_page.selector, "peek_page needs selector");
  assert.ok(byName.peek_a11y.port, "peek_a11y needs port");
  assert.ok(byName.peek_a11y.navigate, "peek_a11y needs navigate");
  assert.ok(byName.ocr_image.lang, "ocr_image needs lang");
  assert.ok(byName.ocr_image.level, "ocr_image needs level");
  assert.ok(byName.ocr_video.task, "ocr_video needs task");
  assert.ok(byName.ocr_video.level, "ocr_video needs level");
  assert.ok(byName.ocr_video.lang, "ocr_video needs lang");
});
