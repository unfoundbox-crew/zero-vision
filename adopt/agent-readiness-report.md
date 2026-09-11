# zero-vision agent-readiness report

Lane: AUDIT. Date: 2026-09-11. Repo: `unfoundbox-crew/zero-vision` @ 0.1.2 (commit `4dea419` + uncommitted README/docs-agent work).
Sibling lane DOCS is authoring `docs-agent/llms.txt`, `llms-full.txt`, `AGENT-MANIFEST.md` in parallel — those files were read as evidence only, never edited. They are untracked and still in flux; findings about them may go stale.

Scoring: pass = full, partial = half, fail = 0, UNVERIFIABLE = excluded from scored max (npm package has no site).
Total: **69.75 / 91 scored (~77%)**. Max 100 with 9 pts unverifiable.

## Access — 20/20 scored (25 max, 5 unverifiable)

| # | Check | Result | Evidence | Fix |
|---|-------|--------|----------|-----|
| A1 | npm registry page public, no login wall | pass | `npm view zero-vision` returns `zero-vision@0.1.2`, Apache-2.0, 2 deps, `latest: 0.1.2`, published ~22 min before audit | — |
| A2 | GitHub repo public, license visible | pass | `api.github.com/repos/unfoundbox-crew/zero-vision`: `private: false`, `license: apache-2.0`, default branch `main` | — |
| A3 | No bot-blocking on agent surfaces | pass | Unauthenticated npm view + GitHub REST API both succeed, no CAPTCHA/login | — |
| A4 | robots.txt permits crawling | UNVERIFIABLE | No site: `has_pages: false`, `homepage: null`. Nothing to serve or block | If a docs site ships, add `robots.txt` allowing `GPTBot/ClaudeBot` + agent fetchers |
| A5 | Registry rate-limit friendliness | pass | Two unauthenticated reads (npm view, GitHub API) succeeded first try, no 429 | — |

Lighthouse also UNVERIFIABLE (no site to audit).

## Discovery — 6/16 scored (20 max, 4 unverifiable)

| # | Check | Result | Evidence | Fix |
|---|-------|--------|----------|-----|
| D1 | `llms.txt` valid | partial | `docs-agent/llms.txt` exists (3,821 B), H1 + blockquote summary + sectioned, 19/19 relative links resolve to real files. BUT not at conventional root `/llms.txt` | Move/copy to repo root as `llms.txt` (keep `docs-agent/` as source if desired), or add root pointer |
| D2 | Full companion | partial | `docs-agent/llms-full.txt` exists (11,566 B, ~2.9k tokens). BUT carries **0 markdown links** — sources named as plain text, so agents cannot follow them | Render the "Sources, in order" list as relative links like `llms.txt` does |
| D3 | sitemap.xml | UNVERIFIABLE | No site; N/A for npm per brief | If a docs site ships, emit sitemap listing `llms.txt` + spec pages |
| D4 | Docs reachable from root + shipped on npm | fail | README links to `docs/spec.md` only — no pointer to `docs-agent/llms.txt`. Worse: `package.json` `files[]` = `dist, docs/spec.md, README, LICENSE, NOTICE` — **`docs-agent/` is NOT in the published tarball**, so registry installs lack all three agent files | 1) Add README link to `docs-agent/llms.txt`. 2) Add `docs-agent/llms.txt`, `llms-full.txt` (and `SKILL.md`) to `files[]` |
| D5 | GitHub discoverability (description, topics, homepage) | partial | Description + license present. Topics empty (`[]`), `homepage: null` | Add topics (`ocr`, `mcp`, `apple-vision`, `claude`, `agent-skill`), set homepage to npm page or docs URL |

## Comprehension — 25/25 scored

| # | Check | Result | Evidence | Fix |
|---|-------|--------|----------|-----|
| C1 | Markdown availability | pass | `README.md`, `SKILL.md`, `docs/spec.md`, `CHANGELOG.md` all present as `.md` | — |
| C2 | Quickstart shallow + actually runs | pass | `node dist/cli.js --help` prints usage; `ocr fixtures/ocr/hello.png` → `HELLO ZEROVISION`, byte-match to `hello.expected.txt`; `--tabs` with no Chrome fail-closes with actionable message (`no debug port (tried 1948, 9223)…`) | — |
| C3 | Structure (rank diagram, commands, examples, limits) | pass | README has perception rank, arch diagram, compare table, Linux backend table, full command list, MCP tools, v1 limits; spec is ~24k chars with numbered engine sections | — |
| C4 | Token budgets | pass | Measured chars/4: `llms.txt` ~951, `llms-full.txt` ~2,880, README ~1,810, SKILL ~537, spec ~6,006, manifest ~842. Quickstart answer fits in <2k tokens | — |
| C5 | Link liveness (5 links followed) | pass | README's 3 links: `github.com/unfoundbox-crew` = live account (API: type User), `docs/spec.md` + `LICENSE` exist. `llms.txt`'s 19 relative links: 19/19 resolve. `llms-full.txt`'s 0 links noted under D2 | — |

## Integration — 18.75/30 scored

| # | Check | Result | Evidence | Fix |
|---|-------|--------|----------|-----|
| I1 | Package name resolves on npm, matches repo | pass | `zero-vision@0.1.2`, `dist-tags.latest: 0.1.2`, bins `zrv, snap, zrv-mcp`; repo field `unfoundbox-crew/zero-vision`; README's taken-name warning (`npx zero-vision`, never `npx zrv`) is accurate | — |
| I2 | Install works, bins land on PATH | partial | `zrv --help` works globally; `node_modules/` populated (111 pkgs); `dist/cli.js` runs. BUT global `zrv` is a symlink to this checkout, and a fresh `npm install -g zero-vision` from the registry was **not** tested (audit constraint: no network installs) | After next publish, one registry-install smoke test: `npm i -g zero-vision && zrv --help && zrv ocr <png>` on a clean machine |
| I3 | MCP tools list | pass | Live stdio `tools/list` returned exactly `peek_tabs, peek_page, peek_a11y, ocr_image, ocr_video` (5/5, matching README/SKILL/`src/mcp.ts`) | — |
| I4 | Auth path documented | partial | `docs/spec.md` §5.5: `cloud-vlm` needs `apiKeyEnv: GEMINI_API_KEY`, env-only, refuses when unset, never logs bytes. BUT `llms.txt` says "opt-in only" without naming the env var, and README has no auth section | Add one line to `llms.txt` Engines + README: `cloud-vlm` auth = `GEMINI_API_KEY` env var, never a config file |

## Fails (1) with fixes

- **D4** — README has no pointer to `docs-agent/llms.txt`, and `package.json` `files[]` excludes `docs-agent/`, so npm installs ship zero agent files. Fix: link from README; add `docs-agent/llms.txt`, `docs-agent/llms-full.txt`, `SKILL.md` to `files[]`.

## Unverifiables (site-dependent, npm package has no site)

- A4 robots.txt, D3 sitemap.xml, Lighthouse — `has_pages: false`, `homepage: null`. Not fails. Revisit only if a docs site ships.

## Not run (constraints)

- Fresh `npm install -g` from registry (no network installs). `npx skills add` agent-skill install (network). `npm run build`/`npm test` (would rewrite `dist/`; audit is read-only). DOCS-lane files were mid-write during audit.
