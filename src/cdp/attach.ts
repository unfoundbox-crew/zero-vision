import { CdpClient } from "./client.js";

const INTERNAL = /^(chrome|devtools|chrome-extension|edge):\/\//;

export interface TabInfo {
  id: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
  type: string;
}

export interface AttachResult {
  client: CdpClient;
  sessionId: string;
  targetId: string;
  title: string;
  url: string;
  port: number;
}

function host(): string {
  return process.env.ZEROVISION_HOST ?? "127.0.0.1";
}

export function probePorts(explicit?: number): number[] {
  if (explicit) return [explicit];
  const env = process.env.ZEROVISION_PORT;
  if (env) return [Number(env)];
  const list: number[] = [];
  if (process.env.AGENT_CHROME_PORT) list.push(Number(process.env.AGENT_CHROME_PORT));
  list.push(1948, 9223);
  if (process.env.ZEROVISION_ALLOW_USER_CHROME === "1") list.push(9222);
  return list;
}

export async function findOpenPort(explicit?: number): Promise<{ port: number; version: { webSocketDebuggerUrl: string } }> {
  const h = host();
  if (h !== "127.0.0.1" && h !== "localhost" && !process.env.ZEROVISION_HOST) {
    throw new Error("refusing non-loopback host");
  }
  const ports = probePorts(explicit);
  const tried: number[] = [];
  for (const port of ports) {
    tried.push(port);
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 150);
      const res = await fetch(`http://${h}:${port}/json/version`, { signal: ac.signal });
      clearTimeout(t);
      if (!res.ok) continue;
      const version = (await res.json()) as { webSocketDebuggerUrl: string };
      return { port, version };
    } catch {
      continue;
    }
  }
  throw Object.assign(new Error(`no debug port (tried ${tried.join(", ")}). Start Chrome with --remote-debugging-port=<n>`), {
    code: 2,
  });
}

export async function listTabs(port: number): Promise<TabInfo[]> {
  const res = await fetch(`http://${host()}:${port}/json/list`);
  if (!res.ok) throw new Error(`json/list ${res.status}`);
  const raw = (await res.json()) as TabInfo[];
  return raw.filter((t) => (t.type === "page" || t.type === "tab") && !INTERNAL.test(t.url ?? ""));
}

export function pickTab(tabs: TabInfo[], opts: { tab?: string; url?: string }): TabInfo {
  let matches = tabs;
  if (opts.tab) {
    const q = opts.tab.toLowerCase();
    matches = tabs.filter(
      (t) => t.id === opts.tab || t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q),
    );
  } else if (opts.url) {
    matches = tabs.filter((t) => t.url === opts.url || t.url.startsWith(opts.url!));
  }
  if (matches.length === 0) {
    throw Object.assign(new Error("no matching tab"), { code: 1, tabs });
  }
  if ((opts.tab || opts.url) && matches.length > 1) {
    const list = matches.map((t) => `${t.id}\t${t.title}\t${t.url}`).join("\n");
    throw Object.assign(new Error(`multiple matches:\n${list}`), { code: 1, tabs: matches });
  }
  return matches[0];
}

export async function attach(opts: {
  port?: number;
  tab?: string;
  url?: string;
  navigate?: boolean;
}): Promise<AttachResult> {
  const { port, version } = await findOpenPort(opts.port);
  const client = new CdpClient();
  await client.connect(version.webSocketDebuggerUrl);
  await client.send("Target.setDiscoverTargets", { discover: true });
  const { targetInfos } = (await client.send("Target.getTargets")) as {
    targetInfos: { targetId: string; type: string; title: string; url: string }[];
  };

  let pages = targetInfos.filter((t) => (t.type === "page" || t.type === "tab") && !INTERNAL.test(t.url));
  let chosen = pages[0];

  if (opts.url && opts.navigate) {
    const existing = pages.filter((t) => t.url === opts.url || t.url.startsWith(opts.url!));
    if (existing.length === 1) chosen = existing[0];
    else if (existing.length === 0) {
      const { targetId } = (await client.send("Target.createTarget", { url: opts.url })) as { targetId: string };
      const { targetInfos: again } = (await client.send("Target.getTargets")) as {
        targetInfos: { targetId: string; type: string; title: string; url: string }[];
      };
      chosen = again.find((t) => t.targetId === targetId) ?? { targetId, type: "page", title: "", url: opts.url };
    } else {
      client.close();
      throw Object.assign(
        new Error(`multiple matches:\n${existing.map((t) => `${t.targetId}\t${t.title}\t${t.url}`).join("\n")}`),
        { code: 1 },
      );
    }
  } else {
    const tabs: TabInfo[] = pages.map((t) => ({
      id: t.targetId,
      title: t.title,
      url: t.url,
      type: t.type,
    }));
    const tab = pickTab(tabs, { tab: opts.tab, url: opts.url });
    chosen = pages.find((p) => p.targetId === tab.id) ?? pages[0];
  }

  if (!chosen) {
    client.close();
    throw Object.assign(new Error("no attachable page target"), { code: 2 });
  }

  const { sessionId } = (await client.send("Target.attachToTarget", {
    targetId: chosen.targetId,
    flatten: true,
  })) as { sessionId: string };

  return {
    client,
    sessionId,
    targetId: chosen.targetId,
    title: chosen.title,
    url: chosen.url,
    port,
  };
}
