import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { axToText, type AxNode } from "../cdp/extract.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

test("ax walk of tiny tree", () => {
  const nodes = JSON.parse(readFileSync(join(root, "fixtures/ax/tiny.json"), "utf8")) as AxNode[];
  const out = axToText(nodes);
  assert.equal(out.text, "Hello\nDocs");
  assert.equal(out.markdown, "# Hello\n[Docs](https://example.com)");
  assert.match(out.a11y, /heading "Hello".*uid=e1/s);
  assert.match(out.a11y, /link "Docs".*uid=e2/s);
});

test("ignored and presentation roles drop", () => {
  const out = axToText([
    {
      nodeId: "1",
      role: { value: "RootWebArea" },
      childIds: ["2", "3"],
    },
    { nodeId: "2", ignored: true, role: { value: "generic" }, name: { value: "skip" }, childIds: [] },
    { nodeId: "3", role: { value: "presentation" }, childIds: [] },
  ]);
  assert.equal(out.text, "");
});
