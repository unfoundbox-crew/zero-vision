import type { CdpClient } from "./client.js";

const SKIP_ROLES = new Set(["none", "presentation", "InlineTextBox", "generic"]);

export interface AxNode {
  nodeId: string;
  ignored?: boolean;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: string };
  childIds?: string[];
  properties?: { name: string; value?: { value?: unknown } }[];
}

export interface ExtractResult {
  text: string;
  markdown: string;
  a11y: string;
  opaque: { fraction: number; reasons: string[] };
}

function prop(node: AxNode, name: string): unknown {
  return node.properties?.find((p) => p.name === name)?.value?.value;
}

function interesting(n: AxNode): boolean {
  if (n.ignored) return false;
  const role = String(n.role?.value ?? "");
  if (SKIP_ROLES.has(role) && !n.name?.value) return false;
  return true;
}

export function axToText(nodes: AxNode[]): { text: string; markdown: string; a11y: string } {
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const childOf = new Set<string>();
  for (const n of nodes) for (const c of n.childIds ?? []) childOf.add(c);
  const roots = nodes.filter((n) => !childOf.has(n.nodeId));
  let uid = 0;
  const textLines: string[] = [];
  const mdLines: string[] = [];
  const yamlLines: string[] = [];

  const walk = (id: string, depth: number) => {
    const n = byId.get(id);
    if (!n) return;
    const role = String(n.role?.value ?? "generic");
    const name = String(n.name?.value ?? "").trim();
    const value = n.value?.value != null ? String(n.value.value) : "";
    const url = prop(n, "url");
    const keep = interesting(n);
    if (
      keep &&
      role !== "RootWebArea" &&
      role !== "WebArea" &&
      (name || value || ["heading", "link", "button", "textbox", "checkbox"].includes(role))
    ) {
      const idn = `e${++uid}`;
      const level = Number(prop(n, "level") ?? 0);
      if (role === "heading") {
        const hashes = "#".repeat(Math.min(Math.max(level || 1, 1), 6));
        textLines.push(name);
        mdLines.push(`${hashes} ${name}`);
        yamlLines.push(`${"  ".repeat(depth)}- heading ${JSON.stringify(name)} [level=${level || 1}] [uid=${idn}]`);
      } else if (role === "link") {
        textLines.push(name);
        mdLines.push(typeof url === "string" && url ? `[${name}](${url})` : name);
        yamlLines.push(`${"  ".repeat(depth)}- link ${JSON.stringify(name)} [uid=${idn}]`);
      } else if (role === "textbox") {
        textLines.push(value ? `${name}: ${value}` : name);
        mdLines.push(`**${name}:** ${value}`);
        yamlLines.push(
          `${"  ".repeat(depth)}- textbox ${JSON.stringify(name)} [uid=${idn}] [value=${JSON.stringify(value)}]`,
        );
      } else if (role === "checkbox") {
        const checked = Boolean(prop(n, "checked"));
        textLines.push(`${checked ? "[x]" : "[ ]"} ${name}`);
        mdLines.push(`- [${checked ? "x" : " "}] ${name}`);
        yamlLines.push(`${"  ".repeat(depth)}- checkbox ${JSON.stringify(name)} [uid=${idn}]`);
      } else if (role === "button") {
        textLines.push(name);
        mdLines.push(name);
        yamlLines.push(`${"  ".repeat(depth)}- button ${JSON.stringify(name)} [uid=${idn}]`);
      } else if (name) {
        textLines.push(name);
        mdLines.push(name);
        yamlLines.push(`${"  ".repeat(depth)}- ${role} ${JSON.stringify(name)} [uid=${idn}]`);
      }
    }
    for (const c of n.childIds ?? []) walk(c, depth + (keep ? 1 : 0));
  };
  for (const r of roots) walk(r.nodeId, 0);
  const cap = (s: string) => (s.length > 24000 ? s.slice(0, 24000) + "\n…[truncated]" : s);
  return {
    text: cap(textLines.join("\n")),
    markdown: cap(mdLines.join("\n")),
    a11y: cap(yamlLines.join("\n")),
  };
}

const OPAQUE_JS = `() => {
  const area = (el) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, r.width) * Math.max(0, r.height);
  };
  const vp = innerWidth * innerHeight || 1;
  const nodes = [...document.querySelectorAll('canvas, video')];
  let px = 0;
  const reasons = [];
  for (const el of nodes) {
    const a = area(el);
    if (a / vp >= 0.05) {
      px += a;
      reasons.push(el.tagName.toLowerCase());
    }
  }
  return { fraction: px / vp, reasons: [...new Set(reasons)] };
}`;

export async function extractPage(
  client: CdpClient,
  sessionId: string,
  opts: { waitMs?: number; waitText?: string; scroll?: boolean; verbose?: boolean } = {},
): Promise<ExtractResult> {
  await client.send("Runtime.enable", {}, sessionId);
  await client.send("Page.enable", {}, sessionId);
  await client.send("Accessibility.enable", {}, sessionId);

  const ready = (await client.send(
    "Runtime.evaluate",
    { expression: "document.readyState", returnByValue: true },
    sessionId,
  )) as { result?: { value?: string } };
  if (ready.result?.value !== "complete") {
    await Promise.race([
      new Promise<void>((resolve) => {
        const onLoad = () => {
          client.off("Page.loadEventFired", onLoad);
          resolve();
        };
        client.on("Page.loadEventFired", onLoad);
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 8000)),
    ]);
  }

  await Promise.race([
    new Promise<void>((resolve) => {
      const onAx = () => {
        client.off("Accessibility.loadComplete", onAx);
        resolve();
      };
      client.on("Accessibility.loadComplete", onAx);
    }),
    new Promise<void>((resolve) => setTimeout(resolve, 2000)),
  ]);

  if (opts.waitMs) await new Promise((r) => setTimeout(r, opts.waitMs));
  if (opts.waitText) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const ev = (await client.send(
        "Runtime.evaluate",
        { expression: "document.body && document.body.innerText || ''", returnByValue: true },
        sessionId,
      )) as { result?: { value?: string } };
      if ((ev.result?.value ?? "").includes(opts.waitText)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  if (opts.scroll) {
    await client.send(
      "Runtime.evaluate",
      {
        expression:
          "(async () => { const h = document.body.scrollHeight; for (let y=0; y<h; y+=800) { scrollTo(0,y); await new Promise(r=>setTimeout(r,150)); } })()",
        awaitPromise: true,
      },
      sessionId,
    );
  }

  await new Promise((r) => setTimeout(r, 250));

  const { nodes } = (await client.send("Accessibility.getFullAXTree", {}, sessionId)) as { nodes: AxNode[] };
  const walked = axToText(nodes);

  let opaque = { fraction: 0, reasons: [] as string[] };
  try {
    const ev = (await client.send(
      "Runtime.evaluate",
      { expression: `(${OPAQUE_JS})()`, returnByValue: true },
      sessionId,
    )) as { result?: { value?: { fraction: number; reasons: string[] } } };
    if (ev.result?.value) opaque = ev.result.value;
  } catch {
    /* page may deny */
  }

  try {
    await client.send("Accessibility.disable", {}, sessionId);
  } catch {
    /* ignore */
  }

  let a11y = walked.a11y;
  if (opaque.fraction >= 0.3) {
    a11y += `\nopaque: ${opaque.reasons[0] ?? "canvas"} ${opaque.fraction.toFixed(2)} viewport`;
  }
  if (opts.verbose) {
    a11y += "\n--- raw ---\n" + JSON.stringify(nodes).slice(0, 8000);
  }
  return { text: walked.text, markdown: walked.markdown, a11y, opaque };
}

export async function extractSelector(
  client: CdpClient,
  sessionId: string,
  selector: string,
): Promise<{ text: string; found: boolean }> {
  await client.send("Runtime.enable", {}, sessionId);
  const ev = (await client.send(
    "Runtime.evaluate",
    {
      expression: `(s => { const el = document.querySelector(s); return el ? el.innerText : null; })(${JSON.stringify(selector)})`,
      returnByValue: true,
    },
    sessionId,
  )) as { result?: { value?: string | null } };
  const text = ev.result?.value ?? "";
  return { text, found: ev.result?.value != null };
}

export async function captureScreenshot(client: CdpClient, sessionId: string): Promise<Buffer> {
  const result = (await client.send("Page.captureScreenshot", { format: "png" }, sessionId)) as { data: string };
  if (!result?.data) throw new Error("Page.captureScreenshot returned no data");
  return Buffer.from(result.data, "base64");
}

export async function fetchUrl(url: string): Promise<{ text: string; markdown: string }> {
  const res = await fetch(url, { redirect: "follow" });
  const html = await res.text();
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  if (stripped.length < 200 && /id=["']root["']/.test(html)) {
    throw Object.assign(
      new Error("page looks like a client render; open it in a debug Chrome and retry without --fetch"),
      { code: 1 },
    );
  }
  return { text: stripped.slice(0, 24000), markdown: stripped.slice(0, 24000) };
}
