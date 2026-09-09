import assert from "node:assert/strict";
import test from "node:test";
import { probePorts, pickTab, type TabInfo } from "../cdp/attach.js";

function withEnv(kv: Record<string, string | undefined>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(kv)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("default probe skips 9222", () => {
  withEnv(
    { ZEROVISION_PORT: undefined, AGENT_CHROME_PORT: undefined, ZEROVISION_ALLOW_USER_CHROME: undefined },
    () => {
      assert.deepEqual(probePorts(), [1948, 9223]);
      assert.ok(!probePorts().includes(9222));
    },
  );
});

test("9222 only with explicit port or allow-user-chrome", () => {
  withEnv(
    { ZEROVISION_PORT: undefined, AGENT_CHROME_PORT: undefined, ZEROVISION_ALLOW_USER_CHROME: "1" },
    () => {
      assert.deepEqual(probePorts(), [1948, 9223, 9222]);
    },
  );
  assert.deepEqual(probePorts(9222), [9222]);
});

test("ZEROVISION_PORT wins over the default list", () => {
  withEnv({ ZEROVISION_PORT: "1948", AGENT_CHROME_PORT: "9" }, () => {
    assert.deepEqual(probePorts(), [1948]);
  });
});

const tabs: TabInfo[] = [
  { id: "aaa", title: "Docs", url: "https://example.com/docs", type: "page" },
  { id: "bbb", title: "App", url: "https://app.example.com/", type: "page" },
];

test("pickTab default is first page", () => {
  assert.equal(pickTab(tabs, {}).id, "aaa");
});

test("pickTab unique substring", () => {
  assert.equal(pickTab(tabs, { tab: "app" }).id, "bbb");
});

test("pickTab two matches throws", () => {
  assert.throws(() => pickTab(tabs, { tab: "example.com" }), /multiple matches/);
});
