#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { perceive, resolveEngine, isEngineId, type EngineId } from "./engines/index.js";
import { attach, findOpenPort, listTabs } from "./cdp/attach.js";
import { captureScreenshot, extractPage, fetchUrl } from "./cdp/extract.js";

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

function engineOf(args: Record<string, unknown> | undefined): EngineId {
  const e = args?.engine;
  if (typeof e === "string") {
    if (!isEngineId(e)) throw new Error(`unknown engine: ${e}`);
    return e;
  }
  return resolveEngine();
}

export async function startMcp(): Promise<void> {
  const server = new Server({ name: "zero-vision", version: "0.1.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "peek_tabs",
        description: "List open debug-Chrome tabs. Prefer this over a screenshot when the goal is to read a page.",
        inputSchema: { type: "object", properties: {} },
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
            engine: { type: "string", enum: ["apple-vision", "apple-fm", "local-vlm", "cloud-vlm"] },
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
            engine: { type: "string", enum: ["apple-vision", "apple-fm", "local-vlm", "cloud-vlm"] },
            task: { type: "string", enum: ["transcribe", "describe"], default: "transcribe" },
            level: { type: "string", enum: ["accurate", "fast"] },
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
          },
        },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    switch (req.params.name) {
      case "peek_tabs": {
        const { port } = await findOpenPort();
        const tabs = await listTabs(port);
        return text(JSON.stringify({ port, tabs }, null, 2));
      }
      case "peek_page": {
        if (args.fetch && typeof args.url === "string") {
          const { text: t, markdown } = await fetchUrl(args.url);
          return text(args.format === "markdown" ? markdown : t);
        }
        const attached = await attach({
          tab: typeof args.targetId === "string" ? args.targetId : undefined,
          url: typeof args.url === "string" ? args.url : undefined,
          navigate: Boolean(args.navigate),
        });
        try {
          const extracted = await extractPage(attached.client, attached.sessionId, {
            waitMs: typeof args.waitMs === "number" ? args.waitMs : undefined,
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
          tab: typeof args.targetId === "string" ? args.targetId : undefined,
          url: typeof args.url === "string" ? args.url : undefined,
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
        if (args.clipboard) {
          const r = await perceive(engine, { kind: "clipboard", task });
          return text(JSON.stringify(r));
        }
        if (typeof args.base64 === "string") {
          const buf = Buffer.from(args.base64, "base64");
          const r = await perceive(engine, { kind: "image", bytes: buf, task });
          return text(JSON.stringify(r));
        }
        if (typeof args.path !== "string") throw new Error("path, base64, or clipboard required");
        const r = await perceive(engine, { kind: "image", path: args.path, task });
        return text(JSON.stringify(r));
      }
      case "ocr_video": {
        if (typeof args.path !== "string") throw new Error("path required");
        const engine = engineOf(args);
        const r = await perceive(engine, {
          kind: "video",
          path: args.path,
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
