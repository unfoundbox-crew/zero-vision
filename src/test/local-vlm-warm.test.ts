import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { perceive } from "../engines/index.js";
import { daemonHealth, idleMs, socketPath, stopDaemon, warmEnabled } from "../engines/local-vlm-warm.js";
import { withEnv } from "./env.js";

// Every test here goes through fixtures/vlm/fake-daemon.mjs and, for the cold
// fallback, fixtures/vlm/fake-runner.mjs: no MLX, no weights, no network.
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FAKE_DAEMON = join(root, "fixtures", "vlm", "fake-daemon.mjs");
const FAKE_RUNNER = join(root, "fixtures", "vlm", "fake-runner.mjs");
const IMAGE = join(root, "fixtures", "ocr", "hello.png");

function fakeWeights(): string {
  const dir = mkdtempSync(join(tmpdir(), "zrv-w-"));
  writeFileSync(join(dir, "config.json"), JSON.stringify({ model_type: "qwen2_vl" }));
  return dir;
}

/**
 * A short socket path: macOS caps AF_UNIX paths at 104 bytes, and the default
 * `~/Library/Application Support/...` under a temp HOME blows through that.
 */
function shortSock(): string {
  return join(mkdtempSync("/tmp/zrv-s-"), "d.sock");
}

function warm(extra: Record<string, string | undefined> = {}) {
  return {
    HOME: mkdtempSync(join(tmpdir(), "zrv-home-")),
    ZRV_PYTHON: process.execPath,
    ZRV_LOCAL_VLM_DAEMON: FAKE_DAEMON,
    ZRV_LOCAL_VLM_RUNNER: FAKE_RUNNER,
    ZRV_LOCAL_VLM_SOCK: shortSock(),
    ZRV_LOCAL_VLM_TIMEOUT_MS: "10000",
    ZRV_LOCAL_VLM_SPAWN_TIMEOUT_MS: "10000",
    ZRV_LOCAL_VLM_WARM: undefined,
    ZRV_LOCAL_VLM_IDLE_MS: undefined,
    ZRV_LOCAL_VLM_IDLE_S: undefined,
    ZRV_LOCAL_VLM_QUEUE_MAX: undefined,
    FAKE_DAEMON_MODE: undefined,
    FAKE_RUNNER_MODE: undefined,
    ...extra,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const call = (task: "transcribe" | "describe" = "transcribe") =>
  perceive("local-vlm", { kind: "image", path: IMAGE, task });

test("warm is the default, and ZRV_LOCAL_VLM_WARM=0 pins the cold path", async () => {
  await withEnv(warm(), async () => assert.equal(warmEnabled(), true));
  await withEnv(warm({ ZRV_LOCAL_VLM_WARM: "0" }), async () => assert.equal(warmEnabled(), false));
  await withEnv(warm({ ZRV_LOCAL_VLM_IDLE_S: "42" }), async () => assert.equal(idleMs(), 42_000));
  await withEnv(warm({ ZRV_LOCAL_VLM_IDLE_MS: "1500" }), async () => assert.equal(idleMs(), 1500));
});

test("the second call reuses the same daemon process and loads no model", async () => {
  const dir = fakeWeights();
  await withEnv(warm({ ZRV_LOCAL_VLM_MODEL: dir }), async () => {
    try {
      const first = await call();
      assert.equal(first.ok, true, first.error);
      assert.equal(first.warm, true);
      assert.equal(first.warmError, undefined);
      assert.match(first.text, /fake warm transcribe of .*hello\.png using /);
      assert.ok(first.text.includes(dir));

      const h1 = await daemonHealth();
      assert.ok(h1, "a daemon should be running after the first call");
      assert.equal(h1.model, dir);
      assert.equal(h1.requests, 1);

      const second = await call("describe");
      assert.equal(second.ok, true, second.error);
      assert.equal(second.warm, true);
      const h2 = await daemonHealth();
      assert.ok(h2);
      assert.equal(h2.pid, h1.pid, "the second call must hit the same process");
      assert.equal(h2.requests, 2, "the daemon, not a fresh spawn, served both");
      assert.equal(h2.loaded, true);
    } finally {
      await stopDaemon();
    }
  });
});

test("the daemon exits after the idle timeout and the next call starts a new one", async () => {
  const dir = fakeWeights();
  await withEnv(warm({ ZRV_LOCAL_VLM_MODEL: dir, ZRV_LOCAL_VLM_IDLE_MS: "250" }), async () => {
    try {
      const first = await call();
      assert.equal(first.ok, true, first.error);
      const h1 = await daemonHealth();
      assert.ok(h1);

      let gone = false;
      for (let i = 0; i < 40; i++) {
        await sleep(100);
        if (!(await daemonHealth())) {
          gone = true;
          break;
        }
      }
      assert.ok(gone, "the daemon should exit on its own after 250ms idle");
      assert.equal(existsSync(socketPath()), false, "and clean up its socket");

      const second = await call();
      assert.equal(second.ok, true, second.error);
      assert.equal(second.warm, true, "a fresh daemon is still the warm path");
      const h2 = await daemonHealth();
      assert.ok(h2);
      assert.notEqual(h2.pid, h1.pid, "a new process, transparently");
    } finally {
      await stopDaemon();
    }
  });
});

test("calls beyond the queue cap fail closed with local_vlm_busy, not a pile-up", async () => {
  const dir = fakeWeights();
  await withEnv(
    warm({
      ZRV_LOCAL_VLM_MODEL: dir,
      ZRV_LOCAL_VLM_QUEUE_MAX: "1",
      FAKE_DAEMON_MODE: "slow",
      FAKE_DAEMON_SLOW_MS: "500",
    }),
    async () => {
      try {
        // Warm the daemon up first so the spawn does not serialize the three below.
        assert.equal((await call()).ok, true);
        const results = await Promise.all([call(), call(), call()]);
        const busy = results.filter((r) => (r.error ?? "").startsWith("local_vlm_busy"));
        assert.ok(busy.length >= 1, `expected at least one local_vlm_busy, got ${JSON.stringify(results.map((r) => r.error))}`);
        assert.ok(
          results.some((r) => r.ok),
          "the cap refuses the overflow, it does not refuse everyone",
        );
        for (const b of busy) assert.match(b.error ?? "", /queue max 1/);
      } finally {
        await stopDaemon();
      }
    },
  );
});

test("a daemon that cannot start falls back to the cold path and names the reason", async () => {
  const dir = fakeWeights();
  await withEnv(warm({ ZRV_LOCAL_VLM_MODEL: dir, FAKE_DAEMON_MODE: "die" }), async () => {
    const r = await call();
    assert.equal(r.ok, true, r.error);
    assert.equal(r.warm, undefined, "this was the cold one-shot runner");
    assert.match(r.text, /^fake transcribe of /, "cold runner output, not the daemon's");
    assert.match(r.warmError ?? "", /^local_vlm_daemon_start_failed:/);
    assert.match(r.warmError ?? "", /refusing to start/);
  });
});

test("a missing daemon script falls back and names the path", async () => {
  const dir = fakeWeights();
  const missing = join(tmpdir(), "zrv-no-such-daemon.mjs");
  await withEnv(warm({ ZRV_LOCAL_VLM_MODEL: dir, ZRV_LOCAL_VLM_DAEMON: missing }), async () => {
    const r = await call();
    assert.equal(r.ok, true, r.error);
    assert.match(r.warmError ?? "", /^local_vlm_no_daemon:/);
    assert.ok(r.warmError?.includes(missing));
  });
});

test("a daemon holding another model is replaced, never reloaded in place", async () => {
  const a = fakeWeights();
  const b = fakeWeights();
  const sock = shortSock();
  await withEnv(warm({ ZRV_LOCAL_VLM_MODEL: a, ZRV_LOCAL_VLM_SOCK: sock }), async () => {
    assert.equal((await call()).ok, true);
    const h1 = await daemonHealth();
    assert.ok(h1);
    assert.equal(h1.model, a);
  });
  await withEnv(warm({ ZRV_LOCAL_VLM_MODEL: b, ZRV_LOCAL_VLM_SOCK: sock }), async () => {
    try {
      const r = await call();
      assert.equal(r.ok, true, r.error);
      assert.equal(r.warm, true);
      const h2 = await daemonHealth();
      assert.ok(h2);
      assert.equal(h2.model, b, "the socket now belongs to a daemon holding the new model");
      assert.ok(r.text.includes(b));
    } finally {
      await stopDaemon();
    }
  });
});

test("a protocol the client does not speak is reported, not talked to", async () => {
  const dir = fakeWeights();
  await withEnv(warm({ ZRV_LOCAL_VLM_MODEL: dir, FAKE_DAEMON_PROTOCOL: "99" }), async () => {
    try {
      const r = await call();
      assert.equal(r.ok, true, r.error);
      assert.match(r.warmError ?? "", /^local_vlm_daemon_protocol:/);
      assert.match(r.warmError ?? "", /protocol 99/);
      assert.match(r.text, /^fake transcribe of /, "cold path served it");
    } finally {
      await stopDaemon();
    }
  });
});

test("warm off never starts a daemon at all", async () => {
  const dir = fakeWeights();
  await withEnv(warm({ ZRV_LOCAL_VLM_MODEL: dir, ZRV_LOCAL_VLM_WARM: "0" }), async () => {
    const r = await call();
    assert.equal(r.ok, true, r.error);
    assert.equal(r.warm, undefined);
    assert.equal(r.warmError, undefined);
    assert.equal(existsSync(socketPath()), false);
  });
});

test("stopDaemon reports honestly when there is nothing to stop", async () => {
  await withEnv(warm(), async () => {
    const r = await stopDaemon();
    assert.equal(r.stopped, false);
    assert.match(r.detail, /no local-vlm daemon at /);
  });
});
