import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { Engine, PerceiveInput, PerceptionResult, Task, TextBlock } from "./index.js";

const execFileAsync = promisify(execFile);

// BCP-47 (or bare) -> tesseract traineddata code. Small map, "eng" fallback.
const LANG_MAP: Record<string, string> = {
  en: "eng",
  ja: "jpn",
  zh: "chi_sim",
  "zh-Hans": "chi_sim",
  "zh-Hant": "chi_tra",
  ko: "kor",
  fr: "fra",
  de: "deu",
  es: "spa",
  it: "ita",
  pt: "por",
  ru: "rus",
};
function toTessLang(langs: string[]): string {
  const mapped = langs.map((l) => LANG_MAP[l] ?? LANG_MAP[l.split("-")[0]] ?? "eng");
  return [...new Set(mapped)].join("+");
}

async function which(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(process.platform === "win32" ? "where" : "which", [bin]);
    return stdout.trim().split("\n")[0] || null;
  } catch {
    return null;
  }
}

function fail(task: Task | undefined, error: string): PerceptionResult {
  return { ok: false, engine: "tesseract", task: task ?? "transcribe", text: "", ms: 0, error };
}

async function ocrSystemTesseract(
  imagePath: string,
  tessLang: string,
): Promise<{ text: string; blocks: TextBlock[] }> {
  // tsv: level word conf left top width height text (header line first)
  const { stdout } = await execFileAsync("tesseract", [imagePath, "stdout", "-l", tessLang, "--psm", "3", "tsv"], {
    timeout: 120_000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const lines = stdout.trim().split("\n").slice(1);
  const blocks: TextBlock[] = [];
  const words: string[] = [];
  for (const line of lines) {
    const cols = line.split("\t");
    if (cols.length < 12 || cols[0] !== "5") continue; // word level only
    const conf = Number(cols[10]);
    const text = (cols[11] ?? "").trim();
    if (!text) continue;
    words.push(text);
    blocks.push({
      text,
      confidence: Number.isFinite(conf) ? conf / 100 : undefined,
      bbox: { x: Number(cols[6]), y: Number(cols[7]), w: Number(cols[8]), h: Number(cols[9]) },
    });
  }
  return { text: words.join(" "), blocks };
}

async function ocrWasm(image: string | Buffer, tessLang: string): Promise<{ text: string; blocks: TextBlock[] }> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(tessLang.split("+")[0] || "eng");
  try {
    const { data } = await worker.recognize(image);
    // v6 Page shape: blocks[] -> paragraphs[] -> lines[] -> words[]
    const out: TextBlock[] = [];
    for (const b of data.blocks ?? []) {
      for (const p of b.paragraphs ?? []) {
        for (const l of p.lines ?? []) {
          for (const w of l.words ?? []) {
            const t = (w.text ?? "").trim();
            if (!t) continue;
            out.push({
              text: t,
              confidence: typeof w.confidence === "number" ? w.confidence / 100 : undefined,
              bbox: w.bbox ? { x: w.bbox.x0, y: w.bbox.y0, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0 } : undefined,
            });
          }
        }
      }
    }
    return { text: (data.text ?? "").trim().replace(/\s+/g, " "), blocks: out };
  } finally {
    await worker.terminate();
  }
}

async function maybeDownsample(srcPath: string, level: string, tmp: string): Promise<string> {
  if (level !== "fast") return srcPath;
  if (!(await which("ffmpeg"))) return srcPath;
  const out = join(tmp, "fast.png");
  await execFileAsync("ffmpeg", ["-y", "-v", "error", "-i", srcPath, "-vf", "scale='min(1600,iw)':-2", out], {
    timeout: 60_000,
  });
  return out;
}

export const tesseract: Engine = {
  id: "tesseract",
  capabilities: ["transcribe"],
  async perceive(input: PerceiveInput): Promise<PerceptionResult> {
    const t0 = Date.now();
    const done = (text: string, blocks?: TextBlock[]): PerceptionResult => ({
      ok: true,
      engine: "tesseract",
      task: "transcribe",
      text,
      blocks,
      ms: Date.now() - t0,
    });
    if ((input.task ?? "transcribe") === "describe") {
      return {
        ok: false,
        engine: "tesseract",
        task: "describe",
        text: "",
        ms: 0,
        error: "engine tesseract cannot describe; use apple-fm, local-vlm, or cloud-vlm",
      };
    }
    const tessLang = toTessLang(input.lang ?? ["en-US"]);
    const level = input.level ?? "accurate";
    const tmp = mkdtempSync(join(tmpdir(), "zrv-tess-"));
    try {
      if (input.kind === "clipboard") {
        const grabber = (await which("wl-paste")) ? ["wl-paste", "--type", "image/png"] : await (async () =>
          (await which("xclip")) ? ["xclip", "-selection", "clipboard", "-t", "image/png", "-o"] : null)();
        if (!grabber) {
          return fail(input.task, "clipboard unavailable: install wl-clipboard (Wayland) or xclip (X11)");
        }
        const out = join(tmp, "clip.png");
        const { stdout } = await execFileAsync(grabber[0], grabber.slice(1), { encoding: "buffer", timeout: 30_000 });
        if (!stdout.length) return fail(input.task, "clipboard has no image");
        writeFileSync(out, stdout);
        return runImage(out, tessLang, level, tmp, done);
      }
      if (input.kind === "video") return runVideo(input, tessLang, tmp, t0);
      let path = input.path;
      if (input.bytes) {
        if (input.bytes.length > 30 * 1024 * 1024) return fail(input.task, "input exceeds 30 MB");
        path = join(tmp, "in.bin");
        writeFileSync(path, input.bytes);
      }
      if (!path) return fail(input.task, "path required");
      return runImage(path, tessLang, level, tmp, done);
    } catch (e) {
      return fail(input.task, e instanceof Error ? e.message.slice(0, 300) : String(e).slice(0, 300));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  },
};

async function runImage(
  path: string,
  tessLang: string,
  level: string,
  tmp: string,
  done: (text: string, blocks?: TextBlock[]) => PerceptionResult,
): Promise<PerceptionResult> {
  const src = await maybeDownsample(path, level, tmp);
  if (await which("tesseract")) {
    const { text, blocks } = await ocrSystemTesseract(src, tessLang);
    return done(text, blocks);
  }
  const { text, blocks } = await ocrWasm(src, tessLang);
  return done(text, blocks);
}

async function runVideo(
  input: PerceiveInput,
  tessLang: string,
  tmp: string,
  t0: number,
): Promise<PerceptionResult> {
  if (!input.path) {
    return { ok: false, engine: "tesseract", task: "transcribe", text: "", ms: 0, error: "path required" };
  }
  if (!(await which("ffmpeg"))) {
    return {
      ok: false,
      engine: "tesseract",
      task: "transcribe",
      text: "",
      ms: 0,
      error: "video needs ffmpeg: install it (apt install ffmpeg) or pick a single frame",
    };
  }
  const mode = input.video?.mode ?? "scene";
  const interval = input.video?.interval ?? 2;
  const maxFrames = Math.min(input.video?.maxFrames ?? 60, 120);
  const vf =
    mode === "all-idr" ? "select='eq(pict_type\\,I)'" : mode === "interval" ? `fps=1/${interval}` : "select='gt(scene\\,0.4)',mpdecimate";
  const framesDir = join(tmp, "frames");
  const { mkdirSync } = await import("node:fs");
  mkdirSync(framesDir, { recursive: true });
  await execFileAsync(
    "ffmpeg",
    ["-y", "-v", "error", "-i", input.path, "-vf", `${vf},scale='min(1600,iw)':-2`, join(framesDir, "f%04d.png")],
    { timeout: 180_000 },
  );
  const { readdirSync, readFileSync } = await import("node:fs");
  const frames = readdirSync(framesDir)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .slice(0, maxFrames);
  const transcript: { t: number; text: string }[] = [];
  const useSystem = await which("tesseract");
  let i = 0;
  for (const f of frames) {
    const p = join(framesDir, f);
    const { text } = useSystem
      ? await ocrSystemTesseract(p, tessLang)
      : await ocrWasm(readFileSync(p), tessLang);
    if (text.trim()) transcript.push({ t: mode === "interval" ? Math.round(i * interval) : i, text: text.trim() });
    i++;
  }
  return {
    ok: true,
    engine: "tesseract",
    task: "transcribe",
    text: transcript.map((s) => s.text).join("\n"),
    transcript,
    ms: Date.now() - t0,
  };
}
