# Architecture

Blueberry Browser is an Electron app with a single window that hosts a tab strip, a sidebar, and the live page. The sidebar is the entire product surface — six tabs that view and act on the page from increasingly higher levels of automation.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Main process (Node)                            │
│                                                                         │
│   Window  ─►  Tab[]  ─►  WebContentsView  ─►  CDP debugger              │
│                              │                    │                     │
│                              │                    ├─► cdp/network       │
│                              │                    │   (sniff + redact)  │
│                              │                    ├─► cdp/inspect       │
│                              │                    │   (page survey)     │
│                              │                    ├─► cdp/actions       │
│                              │                    │   (click/type/eval) │
│                              │                    └─► cdp/overlay       │
│                              │                                          │
│                              ▼                                          │
│   cdp/spec.ts  ──── aggregates network rows into EndpointSpec[]        │
│                                                                         │
│   cdp/copilot.ts        agent/runtime.ts          cdp/feature-builder  │
│   (per-request: explain  (multi-step loop with    (one-shot prompt →   │
│   / snippet / replay /   tools, screenshots,      strict-JSON          │
│   extract-to-csv)        risk gates)              BuiltFeature)        │
│                                                                         │
│   ipc/handlers.ts  ─── single source of truth for all ipcMain.handle    │
└─────────────────────────────────────────────────────────────────────────┘
                          ▲
                          │ contextBridge
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Preload: src/preload/sidebar.ts                                        │
│  exposes  window.sidebarAPI  +  window.workbench                        │
└─────────────────────────────────────────────────────────────────────────┘
                          ▲
                          ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Sidebar renderer (React)                                               │
│  Workbench.tsx  ─►  TabBar  ┬─► Chat                                    │
│                             ├─► Build       ◄─ MissionControl.tsx       │
│                             │                  + BuildComposer.tsx      │
│                             ├─► Code         ◄─ CodePanel.tsx           │
│                             ├─► Net          ◄─ NetworkPanel.tsx        │
│                             ├─► Files        ◄─ FilesPanel.tsx          │
│                             └─► Memory       ◄─ MemoryPanel.tsx         │
│  WorkbenchContext.tsx  ── shared state, subscriptions, IPC wiring       │
└─────────────────────────────────────────────────────────────────────────┘
```

## Process responsibilities

### Main (`src/main/`)

Owns everything privileged: native windowing, the CDP debugger, the LLM client, the project store, the Pyodide host.

- **`index.ts` / `Window.ts` / `Tab.ts`** — app lifecycle and tab management. Each `Tab` wraps a `WebContentsView` and attaches `cdp/network` on construction so traffic capture starts from the first request.
- **`cdp/`** — everything that talks Chrome DevTools Protocol.
  - `attach.ts` — single-attach guard, re-attaches across navigations.
  - `network.ts` — `NetworkCapture`: sniffs XHR/Fetch, redacts sensitive header values (`cookie`, `authorization`, `*-token`, `x-api-key`, `x-csrf-token`), persists per-project. Emits `Channels.EventNetRequest` on each new request.
  - `inspect.ts` — page-level survey (viewport, theme, fixed regions, max z-index, prior `bb-*` injections). Used by the agent before evalJs.
  - `actions.ts` — primitive tab actions (`click`, `type`, `scroll`, `navigate`, `waitForSelector`, `extractText`, `evalJs`).
  - `overlay.ts` — the brief "highlight this element before clicking it" overlay.
  - `schema.ts` — pure walker that turns any JSON value into a compact `SchemaNode` tree (truncated examples, depth-cap). See [API_SNIFFER.md](./API_SNIFFER.md).
  - `spec.ts` — groups captured requests into `EndpointSpec[]` and renders them as the compact text the LLM sees.
  - `copilot.ts` — the per-request helpers the Network tab uses: explain, snippet (curl/python/ts), replay, extract-to-CSV.
  - `feature-builder.ts` — the universal-extension flow: prompt + spec → strict-JSON `BuiltFeature` (code + safety metadata + static-analysis warnings). See [FEATURE_BUILDER.md](./FEATURE_BUILDER.md).
- **`agent/`** — the multi-step agent.
  - `runtime.ts` — manual one-tool-per-step loop, screenshots before/after, approval gates for destructive actions, persists steps via the project store. Now also injects the API-spec digest into its system prompt so the agent can call sniffed endpoints directly.
  - `tools.ts` — the agent's tool palette (click/type/scroll/navigate/wait/extractText/extractFromNetwork/runCode/evalJs/inspectPage/verifyOverlay/verifyVisually/saveAugmentation/removeAugmentation/saveMemory/finish).
  - `risk.ts` — classifies each `AgentAction` as `safe | caution | destructive`. Anything destructive blocks for explicit user approval.
- **`code/pyodide-host.ts`** — runs Python in a hidden BrowserWindow loading Pyodide. Used by the Code panel and by the agent's `runCode` tool.
- **`projects/store.ts` / `sandbox.ts`** — better-sqlite3-backed project store; sandbox dirs at `<userData>/projects/<slug>/{files,outputs,screenshots}`.
- **`memory/service.ts`** — per-domain `SiteMemory` (procedures, selectors, glossary, augmentations) plus a proposed-memory queue surfaced in the Memory panel.
- **`ipc/handlers.ts`** — every `ipcMain.handle` lives here. Channel names come from `src/common/channels.ts`.
- **`LLMClient.ts`** — the existing chat client (Chat tab). Streams via `streamText`.

### Preload (`src/preload/`)

Two preloads — one per renderer (sidebar + topbar). The sidebar preload exposes:

- `window.sidebarAPI` — original chat surface (sendChatMessage, getMessages, getPageText, etc.).
- `window.workbench` — projects/files/agent/code/network/memory APIs **plus** the new `getFeatureSpec / buildFeature / runFeature` triple for the Build flow.

Type signatures for both live in `src/preload/sidebar.d.ts` and import shared types from `src/common/types.ts`.

### Renderer (`src/renderer/sidebar/`)

One React app, `Workbench.tsx` at the top. Six tabs share a single `WorkbenchProvider` (in `workbench/contexts/WorkbenchContext.tsx`) which:

- Loads projects, watches the active tab, refreshes files on demand.
- Subscribes to `Channels.EventAgentStep / EventAgentRun / EventCodeOutput / EventNetRequest / EventFileAdded / EventMemoryProposed / EventToast` and pumps them into context state.
- Exposes everything the panels need as a single context object.

The Build tab (`MissionControl.tsx`) is now two stacked sections:

1. **`BuildComposer.tsx`** — the universal-extension flow. Prompt → Generate → ApprovalCard → Run. Shows captured endpoints with their inferred schema trees inline.
2. **Agent timeline** — every `AgentStep` from the live or most-recent run, with rationale, before/after screenshots, and the destructive-approval modal (`ApprovalDialog.tsx`).

## End-to-end data flow for the Build feature

```
User interacts with site
        │
        ▼  (every XHR/fetch)
cdp/network.ts  NetworkCapture
   • redacts Cookie / Authorization / *-token / X-API-Key / X-CSRF-Token VALUES
   • stores headers + bodies (capped at 256 KB) in an in-memory ring buffer
   • per-project persistence to better-sqlite3
        │
        ▼  ipc: feature:getSpec
cdp/spec.ts  buildApiSpec(tabId, origin)
   • groups captured rows by `${method} ${origin}${pathname}`
   • parses representative request/response bodies
   • runs cdp/schema.ts inferSchema → SchemaNode tree (1 example/leaf)
   • flags hasAuthHint / hasCsrfHint based on header NAMES
        │
        ▼
BuildComposer renders endpoint list (collapsible SchemaTree)
        │
        ▼  user types prompt + clicks Generate
ipc: feature:build → cdp/feature-builder.ts buildFeature(...)
   • renderApiSpec(...) builds the compact text spec
   • LLM call with strict-JSON system prompt
   • parseBuiltFeature + analyzeCode (warnings) + reconcileFlags
   → BuiltFeature { description, code, endpoints_used,
                    uses_csrf, uses_cookies, mutates_data,
                    ui_changes, warnings[] }
        │
        ▼
ApprovalCard shows: description, safety tags, endpoints, code (collapsed),
                    static-analysis warnings.
                    Run button is destructive-styled if mutates_data
                    OR warnings are non-empty OR uses_csrf.
        │
        ▼  user clicks Run
ipc: feature:run → cdp/actions.ts evalJs(webContents, code)
   • CDP Runtime.evaluate inside the active tab's main world
   • IIFE wrapped, race against 15 s timeout, userGesture true
   • cookies and same-origin trust ride along automatically
        │
        ▼
Result surfaces inline in the ApprovalCard
   (success: pretty-printed return value; error: message inline + console).
```

## Why the split looks like this

- **Privileged work in main**: only the main process has `webContents.debugger`, the project FS, and the LLM client.
- **Pure modules in `cdp/`**: `schema.ts` and `spec.ts` are dependency-free except for `NetworkCapture`. They're trivially testable and reused by both the Build flow and the agent.
- **The renderer is dumb**: every panel pulls from `WorkbenchContext` and calls `window.workbench.<method>`. No business logic in components.
- **One file for IPC**: `ipc/handlers.ts` is the channel inventory, validated with zod at the boundary.

## Adding a new IPC endpoint

1. Add a constant in `src/common/channels.ts`.
2. Register a handler in `src/main/ipc/handlers.ts` with a zod-parsed payload.
3. Expose a typed wrapper in `src/preload/sidebar.ts` and the matching signature in `src/preload/sidebar.d.ts`.
4. Call it from a panel via `window.workbench.<method>`.

## Why "Build" instead of "Mission"

The internal `TabKey` is still `mission` — keeping IPC, persisted UI state, and route-on-event behavior stable. The user-facing label is `Build`. The tab itself now houses both the one-shot universal-extension flow (`BuildComposer`) and the multi-step agent timeline below it. Same surface; bigger scope.
