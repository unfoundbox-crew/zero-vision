import assert from "node:assert/strict";
import test from "node:test";
import { parseArgv } from "../cli.js";

test("zrv --tabs is a boolean, not a value flag", () => {
  const p = parseArgv(["--tabs"]);
  assert.equal(p.cmd, "page");
  assert.equal(p.flags.tabs, true);
});

test("ocr file plus repeated --lang", () => {
  const p = parseArgv(["ocr", "shot.png", "--lang", "en-US", "--lang", "ja-JP", "--json"]);
  assert.equal(p.cmd, "ocr");
  assert.deepEqual(p.pos, ["shot.png"]);
  assert.deepEqual(p.langs, ["en-US", "ja-JP"]);
  assert.equal(p.flags.json, true);
});

test("snap --ocr --save path", () => {
  const p = parseArgv(["snap", "--ocr", "--save", "out.png"]);
  assert.equal(p.cmd, "snap");
  assert.equal(p.flags.ocr, true);
  assert.equal(p.flags.save, "out.png");
});
