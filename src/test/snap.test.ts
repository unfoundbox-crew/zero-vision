import assert from "node:assert/strict";
import test from "node:test";
import { snapArgv } from "../snap.js";

test("snap default copies to clipboard", () => {
  assert.deepEqual(snapArgv({}), ["-i", "-x", "-t", "png", "-c"]);
});

test("snap --ocr does not pass -c (file capture)", () => {
  assert.deepEqual(snapArgv({ ocr: true }), ["-i", "-x", "-t", "png"]);
});

test("snap --save does not pass -c", () => {
  assert.deepEqual(snapArgv({ save: "out.png" }), ["-i", "-x", "-t", "png"]);
});
