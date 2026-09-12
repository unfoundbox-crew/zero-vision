#!/usr/bin/env node
import { spawn } from "node:child_process";
import { perceive, resolveEngine, type PerceptionResult } from "./engines/index.js";
import { attach, findOpenPort, listTabs } from "./cdp/attach.js";
import { captureScreenshot, extractPage, extractSelector, fetchUrl } from "./cdp/extract.js";
import { interactiveCapture, runScreencapture } from "./snap.js";

const BOOL = new Set([
  "md",
  "a11y",
  "json",
  "navigate",
  "fetch",
  "ocr",
  "ocr-opaque",
  "scroll",
  "clipboard",
  "tabs",
  "verbose",
  "help",
]);

function usage(): never {
  process.stderr.write(`zrv — read a page, a screenshot, or a video as text
  zrv [--md|--a11y] [--tab id] [--url u] [--engine e] [--json]
  zrv --selector <css> [--tab id] [--url u]
  zrv --tabs
  zrv ocr <file> [--engine e] [--task transcribe|describe] [--mode scene|interval|all-idr] [--interval s] [--max-frames n]
  zrv snap [--ocr] [--save path]
  zrv mcp
`);
  process.exit(1);
}

function isVideo(p: string): boolean {
  return /\.(mp4|mov|m4v|webm)$/i.test(p);
}

async function copyText(text: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const pb = spawn("pbcopy");
    pb.stdin.write(text);
    pb.stdin.end();
    pb.on("close", () => resolve());
  });
}

// 0 ok; 1 usage or "cannot describe"; 2 input/path missing; 3 engine unavailable
// (weights, key, or binary missing) — also where cloud-vlm lands when the
// proxy rerouted the model or the model refused to look at the image, since
// neither is a call the caller can retry as-is; 4 any other engine failure.
// The named `local_vlm_*` / `cloud_vlm_*` prefixes are the contract and are
// matched first; the loose substrings below still cover the older engines' prose.
const UNAVAILABLE = [
  "local_vlm_no_weights",
  "local_vlm_no_python",
  "local_vlm_no_runner",
  "cloud_vlm_no_key",
  "cloud_vlm_model_mismatch",
  "cloud_vlm_no_vision",
];
const BAD_INPUT = /^(local|cloud)_vlm_bad_input: (input missing|path required)/;

function failCode(result: PerceptionResult): number {
  const err = result.error ?? "";
  if (err.includes("cannot describe")) return 1;
  if (UNAVAILABLE.some((e) => err.startsWith(e))) return 3;
  if (BAD_INPUT.test(err)) return 2;
  if (err.includes("unavailable") || err.includes("weights missing") || err.includes("unset")) return 3;
  if (err.includes("input missing") || err.includes("path required")) return 2;
  return 4;
}

function outResult(result: PerceptionResult, json: boolean): never {
  if (json) {
    process.stdout.write(JSON.stringify(result) + "\n");
  } else if (result.ok) {
    process.stdout.write(result.text + (result.text.endsWith("\n") ? "" : "\n"));
  } else {
    process.stderr.write((result.error ?? "failed") + "\n");
  }
  process.exit(result.ok ? 0 : failCode(result));
}

export function parseArgv(raw: string[]): {
  cmd: string;
  pos: string[];
  flags: Record<string, string | boolean>;
  langs: string[];
} {
  const flags: Record<string, string | boolean> = {};
  const pos: string[] = [];
  const langs: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === "-h" || a === "--help") flags.help = true;
    else if (a === "--lang" && i + 1 < raw.length) langs.push(raw[++i]);
    else if (a.startsWith("--") && BOOL.has(a.slice(2))) flags[a.slice(2)] = true;
    else if (a.startsWith("--") && i + 1 < raw.length) flags[a.slice(2)] = raw[++i];
    else if (a.startsWith("--")) usage();
    else pos.push(a);
  }
  const cmd = pos[0] === "ocr" || pos[0] === "snap" || pos[0] === "mcp" ? pos.shift()! : "page";
  return { cmd, pos, flags, langs };
}

async function main(): Promise<void> {
  const argv0 = process.argv[1] ?? "";
  const raw = process.argv.slice(2);
  if (argv0.endsWith("/snap") || argv0 === "snap" || argv0.endsWith("\\snap")) raw.unshift("snap");

  const { cmd, pos, flags, langs } = parseArgv(raw);
  if (flags.help) usage();

  if (cmd === "mcp") {
    const { startMcp } = await import("./mcp.js");
    await startMcp();
    return;
  }

  const engine = resolveEngine(typeof flags.engine === "string" ? flags.engine : undefined);

  if (cmd === "snap") {
    if (!flags.ocr && !flags.save) {
      const code = await runScreencapture();
      process.exit(code === 0 ? 0 : 130);
    }
    const save = typeof flags.save === "string" ? flags.save : undefined;
    const file = await interactiveCapture({ save });
    if (!file) process.exit(130);
    if (flags.ocr) {
      const result = await perceive(engine, { kind: "image", path: file, task: "transcribe" });
      if (!result.ok) {
        process.stderr.write((result.error ?? "ocr failed") + "\n");
        process.exit(failCode(result));
      }
      process.stdout.write(result.text + (result.text.endsWith("\n") ? "" : "\n"));
      await copyText(result.text);
    }
    return;
  }

  if (cmd === "ocr") {
    const file = pos[0];
    const task = flags.task === "describe" ? "describe" : "transcribe";
    if (flags.clipboard) {
      const result = await perceive(engine, {
        kind: "clipboard",
        task,
        level: flags.level === "fast" ? "fast" : "accurate",
        lang: langs.length ? langs : undefined,
      });
      outResult(result, Boolean(flags.json));
    }
    if (!file) usage();
    const kind = isVideo(file) ? "video" : "image";
    const modeRaw = typeof flags.mode === "string" ? flags.mode : "scene";
    const mode = modeRaw === "interval" || modeRaw === "all-idr" ? modeRaw : "scene";
    const result = await perceive(engine, {
      kind,
      path: file,
      task,
      level: flags.level === "fast" ? "fast" : "accurate",
      lang: langs.length ? langs : undefined,
      ...(kind === "video"
        ? {
            video: {
              mode,
              interval: flags.interval ? Number(flags.interval) : 2,
              maxFrames: flags["max-frames"] ? Number(flags["max-frames"]) : 60,
            },
          }
        : {}),
    });
    outResult(result, Boolean(flags.json));
  }

  if (flags.tabs) {
    const { port } = await findOpenPort(flags.port ? Number(flags.port) : undefined);
    const tabs = await listTabs(port);
    for (const t of tabs) process.stdout.write(`${t.id}\t${t.title}\t${t.url}\n`);
    return;
  }

  if (flags.fetch && typeof flags.url === "string") {
    const { text, markdown } = await fetchUrl(flags.url);
    process.stdout.write((flags.md ? markdown : text) + "\n");
    return;
  }

  const attached = await attach({
    port: flags.port ? Number(flags.port) : undefined,
    tab: typeof flags.tab === "string" ? flags.tab : undefined,
    url: typeof flags.url === "string" ? flags.url : undefined,
    navigate: Boolean(flags.navigate),
  });
  if (typeof flags.selector === "string") {
    const sel = await extractSelector(attached.client, attached.sessionId, flags.selector);
    attached.client.close();
    if (!sel.found) {
      process.stderr.write(`no match for selector: ${flags.selector}\n`);
      process.exit(2);
    }
    process.stdout.write(sel.text + (sel.text.endsWith("\n") ? "" : "\n"));
    return;
  }
  process.stderr.write(`${attached.title}\t${attached.url}\n`);
  try {
    const extracted = await extractPage(attached.client, attached.sessionId, {
      waitMs: flags["wait-ms"] ? Number(flags["wait-ms"]) : undefined,
      waitText: typeof flags["wait-text"] === "string" ? flags["wait-text"] : undefined,
      scroll: Boolean(flags.scroll),
      verbose: Boolean(flags.verbose),
    });
    let body = extracted.text;
    if (flags.a11y) body = extracted.a11y;
    else if (flags.md) body = extracted.markdown;
    if (flags["ocr-opaque"] && extracted.opaque.fraction >= 0.3) {
      const png = await captureScreenshot(attached.client, attached.sessionId);
      const ocr = await perceive(engine, { kind: "image", bytes: png, task: "transcribe" });
      if (ocr.ok && ocr.text) body += (body.endsWith("\n") ? "" : "\n") + "--- opaque ocr ---\n" + ocr.text;
    }
    if (flags.json) {
      process.stdout.write(
        JSON.stringify({
          ok: true,
          source: "cdp",
          port: attached.port,
          targetId: attached.targetId,
          title: attached.title,
          url: attached.url,
          text: body,
          opaque: extracted.opaque,
        }) + "\n",
      );
    } else {
      process.stdout.write(body + (body.endsWith("\n") ? "" : "\n"));
    }
  } finally {
    attached.client.close();
  }
}

const isMain =
  process.argv[1]?.endsWith("cli.js") ||
  process.argv[1]?.endsWith("cli.ts") ||
  process.argv[1]?.endsWith("/zrv") ||
  process.argv[1]?.endsWith("/snap");
if (isMain) {
  main().catch((err) => {
    const code = typeof err === "object" && err && "code" in err ? Number((err as { code: number }).code) : 1;
    process.stderr.write((err instanceof Error ? err.message : String(err)) + "\n");
    process.exit(Number.isFinite(code) && code > 0 ? code : 1);
  });
}
