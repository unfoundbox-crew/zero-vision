import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchUrl } from "../cdp/extract.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function serve(html: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  return {
    url: `http://127.0.0.1:${addr.port}/`,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

test("fetchUrl strips tags", async () => {
  const html = readFileSync(join(root, "fixtures/pages/tiny.html"), "utf8");
  const { url, close } = await serve(html);
  try {
    const { text } = await fetchUrl(url);
    assert.match(text, /Hello/);
    assert.match(text, /Docs/);
    assert.doesNotMatch(text, /<h1>/);
  } finally {
    await close();
  }
});

test("fetchUrl refuses an SPA shell", async () => {
  const html = readFileSync(join(root, "fixtures/pages/spa-shell.html"), "utf8");
  const { url, close } = await serve(html);
  try {
    await assert.rejects(() => fetchUrl(url), /client render/);
  } finally {
    await close();
  }
});
