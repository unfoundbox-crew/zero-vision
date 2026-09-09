import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { perceive, resolveEngine } from "../engines/index.js";

async function withEnv<T>(kv: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(kv)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("default engine is apple-vision", async () => {
  const home = mkdtempSync(join(tmpdir(), "zrv-home-"));
  await withEnv({ ZEROVISION_ENGINE: undefined, HOME: home }, () => {
    assert.equal(resolveEngine(), "apple-vision");
  });
});

test("ZEROVISION_ENGINE selects", async () => {
  await withEnv({ ZEROVISION_ENGINE: "apple-fm" }, () => {
    assert.equal(resolveEngine(), "apple-fm");
  });
});

test("cli flag beats env", async () => {
  await withEnv({ ZEROVISION_ENGINE: "apple-fm" }, () => {
    assert.equal(resolveEngine("local-vlm"), "local-vlm");
  });
});

test("unknown engine throws", () => {
  assert.throws(() => resolveEngine("claude"), /unknown engine/);
});

test("apple-vision refuses describe", async () => {
  const r = await perceive("apple-vision", { kind: "image", path: "/tmp/x.png", task: "describe" });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /cannot describe/);
});

test("cloud-vlm refuses without a key", async () => {
  await withEnv({ GEMINI_API_KEY: undefined }, async () => {
    const r = await perceive("cloud-vlm", { kind: "image", path: "/tmp/x.png", task: "describe" });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /unset/);
  });
});

test("cloud-vlm with a key still does not POST in v1", async () => {
  await withEnv({ GEMINI_API_KEY: "test-not-a-real-key" }, async () => {
    const r = await perceive("cloud-vlm", { kind: "image", path: "/tmp/x.png", task: "describe" });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /not a silent fallback|not called in v1/i);
  });
});

test("local-vlm never spawns a model in v1", async () => {
  const r = await perceive("local-vlm", { kind: "image", path: "/tmp/x.png", task: "describe" });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /weights missing|presence-check only/);
});

test("apple-vision missing file is input missing", async () => {
  const r = await perceive("apple-vision", {
    kind: "image",
    path: "/tmp/zero-vision-does-not-exist.png",
    task: "transcribe",
  });
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /input missing|native unavailable/);
});
