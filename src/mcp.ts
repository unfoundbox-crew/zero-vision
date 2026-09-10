#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { perceive, resolveEngine, isEngineId, type EngineId } from "./engines/index.js";
import { attach, findOpenPort, listTabs } from "./cdp/attach.js";
import { captureScreenshot, extractPage, extractSelector, fetchUrl } from "./cdp/extract.js";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

function engineOf(args: Record<string, unknown> | undefined): EngineId {
  const e = args?.engine;
  if (typeof e === "string") {
    if (!isEngineId(e)) throw new Error(`unknown engine: ${e}`);
    return e;
  }
  return resolveEngine();
}

function langOf(args: Record<string, unknown> | undefined): string[] | undefined {
  const l = args?.lang;
  if (Array.isArray(l)) return l.filter((x): x is string => typeof x === "string");
  if (typeof l === "string") return [l];
  return undefined;
}

function levelOf(args: Record<string, unknown> | undefined): "accurate" | "fast" | undefined {
  return args?.level === "fast" ? "fast" : args?.level === "accurate" ? "accurate" : undefined;
}

function portOf(args: Record<string, unknown> | undefined): number | undefined {
  return typeof args?.port === "number" && Number.isFinite(args.port) ? args.port : undefined;
}

export function listMcpTools() {
  return [
      {
        name: "peek_tabs",
        description: "List open debug-Chrome tabs. Prefer this over a screenshot when the goal is to read a page.",
        inputSchema: { type: "object", properties: { port: { type: "number" } } },
      },
      {
        name: "peek_page",
        description:
          "Read cleaned text or markdown from an attached Chrome tab or URL. Prefer this over a screenshot when the goal is to read text. Use apple-vision unless the user asked to describe.",
        inputSchema: {
          type: "object",
          properties: {
            targetId: { type: "string" },
            url: { type: "string" },
            format: { type: "string", enum: ["text", "markdown"], default: "text" },
            navigate: { type: "boolean", default: false },
            fetch: { type: "boolean", default: false },
            ocrOpaque: { type: "boolean", default: false },
            waitMs: { type: "number" },
            waitText: { type: "string" },
            scroll: { type: "boolean", default: false },
            selector: { type: "string", description: "CSS selector: return only that element's text" },
            port: { type: "number" },
            engine: { type: "string", enum: ["apple-vision", "apple-fm", "local-vlm", "cloud-vlm", "tesseract"] },
          },
        },
      },
      {
        name: "peek_a11y",
        description: "Accessibility tree (interesting-only YAML with uids) of an attached tab. Prefer over a screenshot.",
        inputSchema: {
          type: "object",
          properties: {
            targetId: { type: "string" },
            url: { type: "string" },
            navigate: { type: "boolean", default: false },
            port: { type: "number" },
            verbose: { type: "boolean" },
            engine: { type: "string" },
          },
        },
      },
      {
        name: "ocr_image",
        description:
          "On-device OCR of a local image, clipboard, or base64. Prefer this over a screenshot when the goal is to read text. Default engine apple-vision.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            base64: { type: "string" },
            clipboard: { type: "boolean" },
            engine: { type: "string", enum: ["apple-vision", "apple-fm", "local-vlm", "cloud-vlm", "tesseract"] },
            task: { type: "string", enum: ["transcribe", "describe"], default: "transcribe" },
            level: { type: "string", enum: ["accurate", "fast"] },
            lang: { type: "array", items: { type: "string" } },
          },
        },
      },
      {
        name: "ocr_video",
        description: "Keyframe text transcript of a local video via apple-vision. Prefer over sending frames to a vision model.",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" },
            mode: { type: "string", enum: ["scene", "interval", "all-idr"] },
            interval: { type: "number" },
            maxFrames: { type: "number" },
            engine: { type: "string" },
            task: { type: "string", enum: ["transcribe", "describe"], default: "transcribe" },
            level: { type: "string", enum: ["accurate", "fast"] },
            lang: { type: "array", items: { type: "string" } },
          },
        },
      },
    ];
}

export async function startMcp(): Promise<void> {
  const server = new Server({ name: "zero-vision", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listMcpTools(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    switch (req.params.name) {
      case "peek_tabs": {
        const { port } = await findOpenPort(portOf(args));
        const tabs = await listTabs(port);
        return text(JSON.stringify({ port, tabs }, null, 2));
      }
      case "peek_page": {
        if (args.fetch && typeof args.url === "string") {
          const { text: t, markdown } = await fetchUrl(args.url);
          return text(args.format === "markdown" ? markdown : t);
        }
        const attached = await attach({
          port: portOf(args),
          tab: typeof args.targetId === "string" ? args.targetId : undefined,
          url: typeof args.url === "string" ? args.url : undefined,
          navigate: Boolean(args.navigate),
        });
        try {
          if (typeof args.selector === "string") {
            const sel = await extractSelector(attached.client, attached.sessionId, args.selector);
            if (!sel.found) throw new Error(`no match for selector: ${args.selector}`);
            return text(JSON.stringify({ title: attached.title, url: attached.url, text: sel.text }));
          }
          const extracted = await extractPage(attached.client, attached.sessionId, {
            waitMs: typeof args.waitMs === "number" ? args.waitMs : undefined,
            waitText: typeof args.waitText === "string" ? args.waitText : undefined,
            scroll: Boolean(args.scroll),
          });
          let body = args.format === "markdown" ? extracted.markdown : extracted.text;
          if (args.ocrOpaque && extracted.opaque.fraction >= 0.3) {
            const png = await captureScreenshot(attached.client, attached.sessionId);
            const ocr = await perceive(engineOf(args), { kind: "image", bytes: png, task: "transcribe" });
            if (ocr.ok && ocr.text) body += "\n--- opaque ocr ---\n" + ocr.text;
          }
          return text(
            JSON.stringify({
              title: attached.title,
              url: attached.url,
              text: body,
              opaque: extracted.opaque,
            }),
          );
        } finally {
          attached.client.close();
        }
      }
      case "peek_a11y": {
        const attached = await attach({
          port: portOf(args),
          tab: typeof args.targetId === "string" ? args.targetId : undefined,
          url: typeof args.url === "string" ? args.url : undefined,
          navigate: Boolean(args.navigate),
        });
        try {
          const extracted = await extractPage(attached.client, attached.sessionId, {
            verbose: Boolean(args.verbose),
          });
          return text(extracted.a11y);
        } finally {
          attached.client.close();
        }
      }
      case "ocr_image": {
        const engine = engineOf(args);
        const task = args.task === "describe" ? "describe" : "transcribe";
        const level = levelOf(args);
        const lang = langOf(args);
        if (args.clipboard) {
          const r = await perceive(engine, { kind: "clipboard", task, level, lang });
          return text(JSON.stringify(r));
        }
        if (typeof args.base64 === "string") {
          const buf = Buffer.from(args.base64, "base64");
          const r = await perceive(engine, { kind: "image", bytes: buf, task, level, lang });
          return text(JSON.stringify(r));
        }
        if (typeof args.path !== "string") throw new Error("path, base64, or clipboard required");
        const r = await perceive(engine, { kind: "image", path: args.path, task, level, lang });
        return text(JSON.stringify(r));
      }
      case "ocr_video": {
        if (typeof args.path !== "string") throw new Error("path required");
        const engine = engineOf(args);
        const r = await perceive(engine, {
          kind: "video",
          path: args.path,
          task: args.task === "describe" ? "describe" : "transcribe",
          level: levelOf(args),
          lang: langOf(args),
          video: {
            mode: (args.mode as "scene" | "interval" | "all-idr") ?? "scene",
            interval: typeof args.interval === "number" ? args.interval : 2,
            maxFrames: typeof args.maxFrames === "number" ? args.maxFrames : 60,
          },
        });
        return text(JSON.stringify(r));
      }
      default:
        throw new Error(`unknown tool ${req.params.name}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMain = process.argv[1]?.endsWith("mcp.js") || process.argv[1]?.endsWith("mcp.ts");
if (isMain) {
  startMcp().catch((err) => {
    process.stderr.write(String(err) + "\n");
    process.exit(1);
  });
}
