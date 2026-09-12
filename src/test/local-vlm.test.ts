import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { perceive } from "../engines/index.js";
import { resolveModel } from "../engines/local-vlm.js";
import { withEnv } from "./env.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FAKE_RUNNER = join(root, "fixtures", "vlm", "fake-runner.mjs");
const IMAGE = join(root, "fixtures", "ocr", "hello.png");

/** A directory that passes the weights check (config.json present) but holds no model. */
function fakeWeights(): string {
  const dir = mkdtempSync(join(tmpdir(), "zrv-weights-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify({ model_type: "qwen2_vl" }));
  return dir;
}

/** Every run in this file goes through the fake runner: no MLX, no weights, no network. */
function hermetic(extra: Record<string, string | undefined> = {}) {
  return {
    // An empty HOME keeps a real ~/.config/zero-vision/config.json out of the test.
    HOME: mkdtempSync(join(tmpdir(), "zrv-home-")),
    ZRV_PYTHON: process.execPath,
    ZRV_LOCAL_VLM_RUNNER: FAKE_RUNNER,
    // This file is the cold path's own suite; the warm daemon has its own.
    ZRV_LOCAL_VLM_WARM: "0",
    ZRV_LOCAL_VLM_TIMEOUT_MS: "10000",
    FAKE_RUNNER_MODE: undefined,
    ...extra,
  };
}

test("local-vlm fails closed when weights are absent, naming the path and the fix", async () => {
  const missing = join(tmpdir(), "zrv-no-such-model-dir");
  await withEnv(hermetic({ ZRV_LOCAL_VLM_MODEL: missing }), async () => {
    const r = await perceive("local-vlm", { kind: "image", path: IMAGE, task: "describe" });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /^local_vlm_no_weights:/);
    assert.ok(r.error?.includes(missing), `error should name the path: ${r.error}`);
    assert.match(r.error ?? "", /mlx_vlm\.convert|huggingface-cli download/);
  });
});

test("an uncached HF id reports the hub path and the download command", async () => {
  await withEnv(
    hermetic({ ZRV_LOCAL_VLM_MODEL: "mlx-community/Not-A-Real-Model-4bit", HF_HUB_CACHE: mkdtempSync(join(tmpdir(), "zrv-hf-")) }),
    async () => {
      const r = await perceive("local-vlm", { kind: "image", path: IMAGE, task: "describe" });
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /^local_vlm_no_weights:/);
      assert.match(r.error ?? "", /models--mlx-community--Not-A-Real-Model-4bit/);
      assert.match(r.error ?? "", /huggingface-cli download mlx-community\/Not-A-Real-Model-4bit/);
    },
  );
});

test("resolveModel treats a slash id as an HF repo and an absolute path as a directory", () => {
  const byId = resolveModel("mlx-community/Qwen2-VL-2B-Instruct-4bit");
  assert.match(byId.looked, /models--mlx-community--Qwen2-VL-2B-Instruct-4bit/);
  assert.match(byId.downloadCmd, /huggingface-cli download/);
  const dir = fakeWeights();
  const byPath = resolveModel(dir);
  assert.equal(byPath.dir, dir);
  assert.equal(byPath.looked, dir);
});

test("local-vlm transcribes through the runner and reports tokens", async () => {
  const dir = fakeWeights();
  await withEnv(hermetic({ ZRV_LOCAL_VLM_MODEL: dir }), async () => {
    const r = await perceive("local-vlm", { kind: "image", path: IMAGE, task: "transcribe" });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.engine, "local-vlm");
    assert.equal(r.task, "transcribe");
    assert.equal(r.model, dir);
    assert.deepEqual(r.tokens, { input: 11, output: 5 });
    // The engine must hand the runner the resolved weights dir and the real image.
    assert.match(r.text, /^fake transcribe of .*hello\.png using /);
    assert.ok(r.text.includes(dir));
    assert.ok(r.ms >= 0);
  });
});

test("local-vlm describes, and byte input becomes a temp file for the runner", async () => {
  const dir = fakeWeights();
  await withEnv(hermetic({ ZRV_LOCAL_VLM_MODEL: dir }), async () => {
    const r = await perceive("local-vlm", {
      kind: "image",
      bytes: Buffer.from("89504e470d0a1a0a", "hex"),
      task: "describe",
    });
    assert.equal(r.ok, true, r.error);
    assert.equal(r.task, "describe");
    assert.match(r.text, /^fake describe of .*zrv-lvlm-.*in\.png using /);
  });
});

test("local-vlm surfaces the runner's own named error", async () => {
  const dir = fakeWeights();
  await withEnv(hermetic({ ZRV_LOCAL_VLM_MODEL: dir, FAKE_RUNNER_MODE: "error" }), async () => {
    const r = await perceive("local-vlm", { kind: "image", path: IMAGE, task: "describe" });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /^local_vlm_inference_failed: ValueError: boom$/);
  });
});

test("unparseable runner output is local_vlm_runner_failed", async () => {
  const dir = fakeWeights();
  await withEnv(hermetic({ ZRV_LOCAL_VLM_MODEL: dir, FAKE_RUNNER_MODE: "bad-json" }), async () => {
    const r = await perceive("local-vlm", { kind: "image", path: IMAGE, task: "describe" });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /^local_vlm_runner_failed:/);
  });
});

test("a runner that exits without output is local_vlm_runner_failed", async () => {
  const dir = fakeWeights();
  await withEnv(hermetic({ ZRV_LOCAL_VLM_MODEL: dir, FAKE_RUNNER_MODE: "crash" }), async () => {
    const r = await perceive("local-vlm", { kind: "image", path: IMAGE, task: "describe" });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /^local_vlm_runner_failed:/);
  });
});

test("blank runner text is local_vlm_empty, never ok:true with no text", async () => {
  const dir = fakeWeights();
  await withEnv(hermetic({ ZRV_LOCAL_VLM_MODEL: dir, FAKE_RUNNER_MODE: "empty" }), async () => {
    const r = await perceive("local-vlm", { kind: "image", path: IMAGE, task: "describe" });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /^local_vlm_empty:/);
  });
});

test("a hung runner is killed and reported as local_vlm_timeout", async () => {
  const dir = fakeWeights();
  await withEnv(
    hermetic({ ZRV_LOCAL_VLM_MODEL: dir, FAKE_RUNNER_MODE: "hang", ZRV_LOCAL_VLM_TIMEOUT_MS: "400" }),
    async () => {
      const r = await perceive("local-vlm", { kind: "image", path: IMAGE, task: "describe" });
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /^local_vlm_timeout: runner exceeded 400ms$/);
    },
  );
});

test("local-vlm refuses video and missing input before spawning anything", async () => {
  const dir = fakeWeights();
  await withEnv(hermetic({ ZRV_LOCAL_VLM_MODEL: dir }), async () => {
    const video = await perceive("local-vlm", { kind: "video", path: IMAGE, task: "describe" });
    assert.equal(video.ok, false);
    assert.match(video.error ?? "", /^local_vlm_bad_input:.*video/);

    const gone = await perceive("local-vlm", { kind: "image", path: join(tmpdir(), "nope.png"), task: "describe" });
    assert.equal(gone.ok, false);
    assert.match(gone.error ?? "", /^local_vlm_bad_input: input missing$/);
  });
});

test("local-vlm refuses inputs over 30 MB", async () => {
  const dir = fakeWeights();
  await withEnv(hermetic({ ZRV_LOCAL_VLM_MODEL: dir }), async () => {
    const r = await perceive("local-vlm", {
      kind: "image",
      bytes: Buffer.alloc(31 * 1024 * 1024),
      task: "describe",
    });
    assert.equal(r.ok, false);
    assert.match(r.error ?? "", /^local_vlm_too_large:/);
  });
});

test("an unspawnable interpreter is local_vlm_no_python, not a crash", async () => {
  const dir = fakeWeights();
  await withEnv(
    hermetic({ ZRV_LOCAL_VLM_MODEL: dir, ZRV_PYTHON: join(tmpdir(), "zrv-no-such-python") }),
    async () => {
      const r = await perceive("local-vlm", { kind: "image", path: IMAGE, task: "describe" });
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /^local_vlm_no_python:/);
      assert.match(r.error ?? "", /ZRV_PYTHON/);
    },
  );
});
