import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { perceive } from "../engines/index.js";
import { DEFAULT_CLOUD_MODEL } from "../engines/cloud/index.js";
import { withEnv } from "./env.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const IMAGE = join(root, "fixtures", "ocr", "hello.png");

interface Seen {
  path: string;
  auth: string | undefined;
  body: Record<string, any>;
}

/**
 * A local OpenAI-compatible endpoint. `handler` decides the reply, so every
 * cloud-vlm test is hermetic: no provider, no key, no network beyond loopback.
 */
async function stubProvider(
  handler: (seen: Seen, res: http.ServerResponse) => void,
): Promise<{ baseUrl: string; seen: Seen[]; close: () => Promise<void> }> {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
    });
    req.on("end", () => {
      let body: Record<string, any> = {};
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        /* leave empty */
      }
      const entry = { path: req.url ?? "", auth: req.headers.authorization, body };
      seen.push(entry);
      handler(entry, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return {
    baseUrl: `http://127.0.0.1:${addr.port}/v1`,
    seen,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function ok(text: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: "stub",
    model: "stub-vision-1",
    choices: [{ message: { role: "assistant", content: text } }],
    usage: { prompt_tokens: 42, completion_tokens: 7, ...(extra.usage as object | undefined) },
    ...extra,
  });
}

/** No real key env is ever consulted: an empty HOME plus an explicit literal key. */
function hermetic(baseUrl: string, extra: Record<string, string | undefined> = {}) {
  return {
    HOME: mkdtempSync(join(tmpdir(), "zrv-home-")),
    ZRV_CLOUD_VLM_BASE_URL: baseUrl,
    ZRV_CLOUD_VLM_API_KEY: "stub-key-not-real",
    ZRV_CLOUD_VLM_KEY_ENV: undefined,
    ZRV_CLOUD_VLM_MODEL: undefined,
    ZRV_CLOUD_VLM_TIMEOUT_MS: "5000",
    LITELLM_BASE_URL: undefined,
    LLM_BASE_URL: undefined,
    ...extra,
  };
}

test("cloud-vlm refuses without a key, naming both variables", async () => {
  await withEnv(
    {
      HOME: mkdtempSync(join(tmpdir(), "zrv-home-")),
      ZRV_CLOUD_VLM_API_KEY: undefined,
      ZRV_CLOUD_VLM_KEY_ENV: "ZRV_TEST_ABSENT_KEY",
    },
    async () => {
      const r = await perceive("cloud-vlm", { kind: "image", path: IMAGE, task: "describe" });
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /^cloud_vlm_no_key:/);
      assert.match(r.error ?? "", /ZRV_CLOUD_VLM_API_KEY/);
      assert.match(r.error ?? "", /ZRV_TEST_ABSENT_KEY/);
    },
  );
});

test("cloud-vlm posts a base64 data URL and returns the apple-vision result shape", async () => {
  const stub = await stubProvider((_seen, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(ok("HELLO ZEROVISION"));
  });
  try {
    await withEnv(hermetic(stub.baseUrl), async () => {
      const r = await perceive("cloud-vlm", { kind: "image", path: IMAGE, task: "transcribe" });
      assert.equal(r.ok, true, r.error);
      assert.equal(r.engine, "cloud-vlm");
      assert.equal(r.task, "transcribe");
      assert.equal(r.text, "HELLO ZEROVISION");
      assert.equal(r.model, "stub-vision-1");
      assert.deepEqual(r.tokens, { input: 42, output: 7 });
      assert.equal(typeof r.ms, "number");
      assert.equal(r.error, undefined);
    });

    const [req] = stub.seen;
    assert.equal(req.path, "/v1/chat/completions");
    assert.equal(req.auth, "Bearer stub-key-not-real");
    assert.equal(req.body.model, DEFAULT_CLOUD_MODEL);
    assert.equal(req.body.temperature, 0);
    const content = req.body.messages[0].content;
    assert.equal(content[0].type, "text");
    assert.match(content[0].text, /verbatim/i);
    assert.equal(content[1].type, "image_url");
    assert.match(content[1].image_url.url, /^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
  } finally {
    await stub.close();
  }
});

test("describe sends the describe prompt; transcribe sends the verbatim one", async () => {
  const stub = await stubProvider((_seen, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(ok("a white card"));
  });
  try {
    await withEnv(hermetic(stub.baseUrl), async () => {
      const r = await perceive("cloud-vlm", { kind: "image", path: IMAGE, task: "describe" });
      assert.equal(r.ok, true, r.error);
      assert.equal(r.task, "describe");
    });
    assert.match(stub.seen[0].body.messages[0].content[0].text, /Describe this image/);
  } finally {
    await stub.close();
  }
});

test("ZRV_CLOUD_VLM_MODEL overrides the default model", async () => {
  const stub = await stubProvider((_seen, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(ok("x"));
  });
  try {
    await withEnv(hermetic(stub.baseUrl, { ZRV_CLOUD_VLM_MODEL: "some-other-vlm" }), async () => {
      const r = await perceive("cloud-vlm", { kind: "image", path: IMAGE, task: "transcribe" });
      assert.equal(r.ok, true, r.error);
    });
    assert.equal(stub.seen[0].body.model, "some-other-vlm");
  } finally {
    await stub.close();
  }
});

test("an HTTP error becomes cloud_vlm_http_<status> and never leaks the key", async () => {
  const stub = await stubProvider((_seen, res) => {
    res.writeHead(503, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "upstream is down" } }));
  });
  try {
    await withEnv(hermetic(stub.baseUrl), async () => {
      const r = await perceive("cloud-vlm", { kind: "image", path: IMAGE, task: "describe" });
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /^cloud_vlm_http_503:/);
      assert.match(r.error ?? "", /upstream is down/);
      assert.ok(!r.error?.includes("stub-key-not-real"), "error must not echo the key");
    });
  } finally {
    await stub.close();
  }
});

test("a slow endpoint becomes cloud_vlm_timeout", async () => {
  const stub = await stubProvider((_seen, res) => {
    // Never answer; the engine's AbortController must fire.
    setTimeout(() => res.end(ok("too late")), 5_000).unref();
  });
  try {
    await withEnv(hermetic(stub.baseUrl, { ZRV_CLOUD_VLM_TIMEOUT_MS: "300" }), async () => {
      const r = await perceive("cloud-vlm", { kind: "image", path: IMAGE, task: "describe" });
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /^cloud_vlm_timeout: no response in 300ms$/);
    });
  } finally {
    await stub.close();
  }
});

test("a 200 carrying a provider error object is not treated as success", async () => {
  const stub = await stubProvider((_seen, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: { message: "content filtered", code: 400 } }));
  });
  try {
    await withEnv(hermetic(stub.baseUrl), async () => {
      const r = await perceive("cloud-vlm", { kind: "image", path: IMAGE, task: "describe" });
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /^cloud_vlm_provider_error: content filtered$/);
    });
  } finally {
    await stub.close();
  }
});

test("an empty completion is cloud_vlm_empty, never ok:true with no text", async () => {
  const stub = await stubProvider((_seen, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content: "" } }] }));
  });
  try {
    await withEnv(hermetic(stub.baseUrl), async () => {
      const r = await perceive("cloud-vlm", { kind: "image", path: IMAGE, task: "describe" });
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /^cloud_vlm_empty:/);
    });
  } finally {
    await stub.close();
  }
});

test("non-JSON from the endpoint is cloud_vlm_bad_response", async () => {
  const stub = await stubProvider((_seen, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<html>a proxy login page</html>");
  });
  try {
    await withEnv(hermetic(stub.baseUrl), async () => {
      const r = await perceive("cloud-vlm", { kind: "image", path: IMAGE, task: "describe" });
      assert.equal(r.ok, false);
      assert.match(r.error ?? "", /^cloud_vlm_bad_response:/);
    });
  } finally {
    await stub.close();
  }
});

test("cloud-vlm reports costUsd only when the endpoint returns one", async () => {
  const stub = await stubProvider((seen, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    const withCost = seen.body.model === "priced";
    res.end(
      JSON.stringify({
        model: seen.body.model,
        choices: [{ message: { content: "ok" } }],
        usage: { prompt_tokens: 1, completion_tokens: 2, ...(withCost ? { cost: 0.000123 } : {}) },
      }),
    );
  });
  try {
    await withEnv(hermetic(stub.baseUrl, { ZRV_CLOUD_VLM_MODEL: "priced" }), async () => {
      const r = await perceive("cloud-vlm", { kind: "image", path: IMAGE, task: "describe" });
      assert.equal(r.costUsd, 0.000123);
    });
    await withEnv(hermetic(stub.baseUrl, { ZRV_CLOUD_VLM_MODEL: "unpriced" }), async () => {
      const r = await perceive("cloud-vlm", { kind: "image", path: IMAGE, task: "describe" });
      assert.equal(r.costUsd, undefined);
    });
  } finally {
    await stub.close();
  }
});

test("cloud-vlm refuses video, a missing file, and inputs over 10 MB without calling out", async () => {
  const stub = await stubProvider((_seen, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(ok("should never be reached"));
  });
  try {
    await withEnv(hermetic(stub.baseUrl), async () => {
      const video = await perceive("cloud-vlm", { kind: "video", path: IMAGE, task: "describe" });
      assert.equal(video.ok, false);
      assert.match(video.error ?? "", /^cloud_vlm_bad_input:.*video/);

      const gone = await perceive("cloud-vlm", { kind: "image", path: join(tmpdir(), "nope.png"), task: "describe" });
      assert.equal(gone.ok, false);
      assert.match(gone.error ?? "", /^cloud_vlm_bad_input: input missing$/);

      const big = await perceive("cloud-vlm", {
        kind: "image",
        bytes: Buffer.alloc(11 * 1024 * 1024),
        task: "describe",
      });
      assert.equal(big.ok, false);
      assert.match(big.error ?? "", /^cloud_vlm_too_large:/);
    });
    assert.equal(stub.seen.length, 0, "no request should have been sent");
  } finally {
    await stub.close();
  }
});

test("LITELLM_BASE_URL is the fallback base URL when ZRV_CLOUD_VLM_BASE_URL is unset", async () => {
  const stub = await stubProvider((_seen, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(ok("via the proxy"));
  });
  try {
    await withEnv(
      {
        HOME: mkdtempSync(join(tmpdir(), "zrv-home-")),
        ZRV_CLOUD_VLM_BASE_URL: undefined,
        ZRV_CLOUD_VLM_API_KEY: "stub-key-not-real",
        ZRV_CLOUD_VLM_KEY_ENV: undefined,
        ZRV_CLOUD_VLM_MODEL: undefined,
        LITELLM_BASE_URL: stub.baseUrl,
      },
      async () => {
        const r = await perceive("cloud-vlm", { kind: "image", path: IMAGE, task: "transcribe" });
        assert.equal(r.ok, true, r.error);
        assert.equal(r.text, "via the proxy");
      },
    );
    assert.equal(stub.seen[0].path, "/v1/chat/completions");
  } finally {
    await stub.close();
  }
});

test("exit-code mapping: no key is 3 (engine unavailable), not 4", async () => {
  const { execFile } = await import("node:child_process");
  const cli = join(root, "dist", "cli.js");
  const code = await new Promise<number>((resolve) => {
    const child = execFile(
      process.execPath,
      [cli, "ocr", IMAGE, "--engine", "cloud-vlm", "--task", "describe", "--json"],
      { env: { ...process.env, HOME: mkdtempSync(join(tmpdir(), "zrv-home-")), ZRV_CLOUD_VLM_API_KEY: "", LITELLM_MASTER_KEY: "" } },
      () => {},
    );
    child.on("close", (c) => resolve(c ?? -1));
  });
  assert.equal(code, 3);
});
