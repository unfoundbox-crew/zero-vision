import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { perceive, resolveEngine } from "../engines/index.js";
import { withEnv } from "./env.js";


test("default engine follows platform (apple-vision, tesseract on linux/intel)", async () => {
  const home = mkdtempSync(join(tmpdir(), "zrv-home-"));
  await withEnv({ ZEROVISION_ENGINE: undefined, HOME: home }, () => {
    const expectTess = process.platform === "linux" || (process.platform === "darwin" && process.arch === "x64");
    assert.equal(resolveEngine(), expectTess ? "tesseract" : "apple-vision");
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
  const home = mkdtempSync(join(tmpdir(), "zrv-home-"));
  await withEnv(
    { HOME: home, ZRV_CLOUD_VLM_API_KEY: undefined, ZRV_CLOUD_VLM_KEY_ENV: "ZRV_TEST_ABSENT_KEY" },
    async () => {
      const r = await perceive("cloud-vlm", { kind: "image", path: "/tmp/x.png", task: "describe" });
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /cloud_vlm_no_key/);
    },
  );
});

test("cloud-vlm is never a silent fallback: no engine but cloud-vlm reaches it", async () => {
  const home = mkdtempSync(join(tmpdir(), "zrv-home-"));
  await withEnv({ HOME: home, ZEROVISION_ENGINE: undefined }, () => {
    assert.notEqual(resolveEngine(), "cloud-vlm");
    assert.equal(resolveEngine("cloud-vlm"), "cloud-vlm");
  });
});

test("local-vlm fails closed when weights are not on disk", async () => {
  const home = mkdtempSync(join(tmpdir(), "zrv-home-"));
  await withEnv(
    { HOME: home, ZRV_LOCAL_VLM_MODEL: "/tmp/zero-vision-no-such-weights", ZRV_LOCAL_VLM_RUNNER: undefined },
    async () => {
      // A real file, so the weights check is what fails — not the path check.
      const image = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "ocr", "hello.png");
      const r = await perceive("local-vlm", { kind: "image", path: image, task: "describe" });
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /local_vlm_no_weights/);
    },
  );
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
