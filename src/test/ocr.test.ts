import assert from "node:assert/strict";
import test from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeBin } from "../native.js";
import { perceive } from "../engines/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const darwin = process.platform === "darwin";
const bin = nativeBin();

test("hello.png transcribes HELLO ZEROVISION", { skip: !darwin || !bin }, async () => {
  const r = await perceive("apple-vision", {
    kind: "image",
    path: join(root, "fixtures/ocr/hello.png"),
    task: "transcribe",
  });
  assert.equal(r.ok, true, r.error);
  assert.match(r.text.toUpperCase(), /HELLO/);
  assert.match(r.text.toUpperCase(), /ZEROVISION/);
});

test("contact-sheet.png yields at least three title cards", { skip: !darwin || !bin }, async () => {
  const r = await perceive("apple-vision", {
    kind: "image",
    path: join(root, "fixtures/ocr/contact-sheet.png"),
    task: "transcribe",
  });
  assert.equal(r.ok, true, r.error);
  const lines = r.text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const titles = new Set(lines.filter((s) => /TITLE/i.test(s)));
  assert.ok(titles.size >= 3, `got ${titles.size} title lines: ${r.text}`);
});
