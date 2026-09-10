import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import { perceive } from "../engines/index.js";

const FIXTURES = new URL("../../fixtures/ocr/", import.meta.url).pathname;

test("tesseract reads hello.png", { timeout: 180_000 }, async () => {
  const r = await perceive("tesseract", { kind: "image", path: join(FIXTURES, "hello.png"), task: "transcribe" });
  assert.equal(r.ok, true, r.error);
  assert.match(r.text.toUpperCase().replace(/\s+/g, " "), /HELLO/);
  assert.match(r.text.toUpperCase().replace(/\s+/g, " "), /ZEROVISION/);
});

test("tesseract refuses describe", async () => {
  const r = await perceive("tesseract", { kind: "image", path: join(FIXTURES, "hello.png"), task: "describe" });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /cannot describe/);
});
