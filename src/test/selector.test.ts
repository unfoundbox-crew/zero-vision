import assert from "node:assert/strict";
import test from "node:test";
import { extractSelector } from "../cdp/extract.js";

function stubClient(value: string | null) {
  const calls: string[] = [];
  const client = {
    calls,
    async send(method: string, params: Record<string, unknown>) {
      calls.push(method);
      if (method === "Runtime.evaluate") {
        assert.match(String((params as { expression: string }).expression), /querySelector/);
        return { result: { value } };
      }
      return {};
    },
  };
  return { client: client as unknown as Parameters<typeof extractSelector>[0], calls };
}

test("extractSelector returns text when matched", async () => {
  const { client, calls } = stubClient("Hello world");
  const r = await extractSelector(client, "sess", "main article");
  assert.equal(r.found, true);
  assert.equal(r.text, "Hello world");
  assert.ok(calls.includes("Runtime.enable"));
});

test("extractSelector reports miss", async () => {
  const { client } = stubClient(null);
  const r = await extractSelector(client, "sess", ".nope");
  assert.equal(r.found, false);
  assert.equal(r.text, "");
});
