# Blueberry Workbench

# demo
<img width="3024" height="1964" alt="image" src="https://github.com/user-attachments/assets/29212bd6-493c-4fd5-8d0d-e065ae796e49" />




https://github.com/user-attachments/assets/3e8a1269-3260-4178-99db-3088f6e3bd2d





https://github.com/user-attachments/assets/272ef13d-787c-4c0b-82fb-b1d569505063




> An Electron browser that's also an AI workbench — a transparent **Computer-Use** mission control, a per-project **Code Interpreter** (Pyodide), a **Network Copilot**, smart **Downloads** routing, and **per-site memory**. Built on top of the [`dendrite-systems/blueberry-browser`](https://github.com/dendrite-systems/blueberry-browser) baseline.

This repo is an extension of the original Blueberry challenge. The challenge spec asked for either a Computer-Use framework *or* a Code Interpreter Sandbox — this build ships **both, unified under a single product concept** (the Workbench), because each is half-built without the other:

- A **Computer-Use** agent that downloads a CSV but has no place to analyze it is a worse browser.
- A **Code Interpreter** that can't see the page, the network calls, or the files the agent just produced is a worse ChatGPT.

Read `PRD.md` and `TASKS.md` (in `~/Downloads/`) for the full design.

## What's in here

| Area | Where |
|---|---|
| **Computer-Use** agent loop (Plan → Act → Observe) over Chrome DevTools Protocol | `src/main/agent/`, `src/main/cdp/` |
| **Mission Control** UI with rationale, before/after screenshots, approval gates | `src/renderer/sidebar/src/workbench/components/MissionControl.tsx` |
| **Pyodide** in-renderer Python (pandas, numpy, matplotlib) with project-mounted FS | `src/main/code/pyodide-host.ts`, `resources/pyodide-host/` |
| **Network Copilot** — captures every XHR/fetch, can explain, generate snippets, replay GET, extract to CSV | `src/main/cdp/network.ts`, `src/main/cdp/copilot.ts` |
| **Smart Downloads** — `will-download` interceptor routes files into the active project sandbox | `src/main/downloads/router.ts` |
| **Per-site memory** — agent proposes memory updates after each successful run | `src/main/memory/`, `MemoryPanel.tsx` |
| **ProjectStore** (SQLite + sandbox FS) | `src/main/projects/` |
| Typed IPC contract used end-to-end | `src/common/`, `src/main/ipc/handlers.ts`, `src/preload/sidebar.ts` |

The original sidebar Chat panel still works — the Workbench wraps it as one of six tabs (Chat · Mission · Code · Net · Files · Memory).

## Demo: SaaS dashboard investigation

A mock dashboard ships in `demo/saas-dashboard/`. It serves a chart with a clear October revenue dip and a billing-events table showing failed-payment spikes Oct 4–7.

```bash
# Terminal 1
pnpm demo:dashboard          # http://localhost:3000

# Terminal 2 (after adding a key to .env)
pnpm dev
```

In Blueberry: load `http://localhost:3000`, switch to the **Mission** tab, prompt:

> *Why did revenue drop in October? Explain it and prep something I can send to the team.*

The agent should:

1. Spot the page's `/api/v1/revenue?range=12m` call in the captured network log.
2. `extractFromNetwork` it into `files/revenue.json`.
3. Cross-check the `/api/v1/billing-events` call.
4. `runCode` a pandas snippet that flags October as a 38% drop.
5. Generate a matplotlib chart (auto-saved into `outputs/`).
6. `writeFile` a markdown summary.
7. Propose memory: *"Revenue chart data lives at `/api/v1/revenue?range=12m` — read network, not DOM"*.

Every step is visible in **Mission Control** with rationale, screenshots, and an approval gate for anything destructive.

## Setup

```bash
pnpm install
# add an API key to .env in the repo root:
#   OPENAI_API_KEY=sk-…    (default)
# or:
#   LLM_PROVIDER=anthropic
#   ANTHROPIC_API_KEY=sk-ant-…
pnpm dev
```

If `better-sqlite3` errors with `NODE_MODULE_VERSION` mismatch on first launch, force-rebuild against Electron's ABI:

```bash
node node_modules/.pnpm/@electron+rebuild@3.6.1/node_modules/@electron/rebuild/lib/cli.js \
  --version=37.5.0 \
  --module-dir=node_modules/.pnpm/better-sqlite3@12.9.0/node_modules/better-sqlite3 \
  --force
```

## Architecture

```
┌─────────────────────────── ELECTRON MAIN PROCESS ───────────────────────────┐
│                                                                              │
│  TabManager  ─►  AgentRuntime  ◄──►  ProjectStore (SQLite + WAL)             │
│  + CDP attach   + Plan→Act→Observe loop  + projects/files/runs/steps/memory  │
│                 + AgentStep events       + net_requests                      │
│                                                                              │
│  NetworkCapture  ─►  cdp/network.ts ring-buffer + persistence                │
│  DownloadRouter  ─►  will-download → project sandbox                         │
│  CodeRuntime     ─►  Pyodide off-screen window (preload bridge)              │
│  MemoryService   ─►  per-domain (eTLD+1) procedures/selectors/glossary       │
│                                                                              │
│  IPC: Channels constants in src/common/channels.ts                           │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                          SIDEBAR RENDERER (React)
                          ─ Workbench (tabbed)
                            • Chat · Mission · Code · Net · Files · Memory
                          ─ ProjectSwitcher
                          ─ Live RunPill + Toasts
```

Key files:

- `src/main/agent/runtime.ts` — the loop. One tool call per turn so we can sandwich each in before/after screenshots, risk classification, and approval gates.
- `src/main/cdp/actions.ts` — click/type/scroll/screenshot/extractText via Chrome DevTools Protocol.
- `src/main/cdp/network.ts` — Network domain capture with sensitive-header redaction (`Authorization`, `Cookie`, `*-Token`).
- `src/main/code/pyodide-host.ts` — off-screen `BrowserWindow` running Pyodide. **`nodeIntegration: false`** is required so Pyodide doesn't auto-detect Node and try to import `node:url`. IPC happens through `resources/pyodide-host/preload.js`.
- `src/main/projects/store.ts` — `better-sqlite3` schema and CRUD. Seeds an `Inbox` and `SaaS Investigation` project on first launch.

## What's *not* built (Tier 2/3)

These were explicitly scoped out per the PRD's 14-day budget:

- **Reverse Engineer** ("Survey this app") — passive 30s probe to map endpoints + UI tree.
- **Browser Data Room** — first-class Projects view with archive/export-as-zip.
- **Avanza-style augmentation** — local-only feature overlays injected into a real site (Tier 3 vision).
- **Tab Completion Model** (Tier 3).
- **Node child-process JS sandbox** — Pyodide handles the demo cases; cut from Tier 1.
- **Network replay for non-GET** — GET-only in this build (POST/PUT/DELETE flagged as out-of-MVP).

Discussion piece on the call.

## Security posture

- Every IPC handler validates payload with `zod`.
- Sandbox files are path-jailed via `resolveInProject(projectId, …)` — no `..` traversal.
- Sensitive headers (`Authorization`, `Cookie`, `Set-Cookie`, `*-Token`, `X-Api-Key`, `X-Csrf-Token`) are stripped before they hit the UI or SQLite.
- Pyodide runs in `contextIsolation: true`, `nodeIntegration: false` with no fs access except the mounted `/project/files/`.
- Risk classifier runs before every action. `destructive` actions block on user approval; no auto-timeout.
