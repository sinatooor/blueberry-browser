# Feature Builder — the universal extension flow

The Build tab's headline feature: the user describes a feature in plain English, the browser uses the page's already-sniffed APIs (with the user's session cookies) to build and run it.

## The loop

```
1. User opens the Build tab in the sidebar
2. User interacts with the page → cdp/network captures XHR/Fetch traffic
3. BuildComposer polls feature:getSpec every 2 s → renders captured endpoints
4. User types a prompt → clicks Generate
5. feature:build → cdp/feature-builder.ts → strict-JSON BuiltFeature
6. ApprovalCard renders: description, safety tags, endpoints, code preview, warnings
7. User clicks Run → feature:run → cdp/actions.ts evalJs(...)
8. Generated UI lives inside #bb-feature; result/error surfaces inline
```

Files involved:

```
src/main/cdp/feature-builder.ts   ← LLM call + parse + static analysis
src/main/cdp/spec.ts              ← buildApiSpec / renderApiSpec
src/main/cdp/schema.ts            ← inferSchema / renderSchema
src/main/ipc/handlers.ts          ← feature:getSpec / feature:build / feature:run
src/preload/sidebar.ts            ← getFeatureSpec / buildFeature / runFeature
src/renderer/sidebar/src/workbench/components/BuildComposer.tsx
src/renderer/sidebar/src/workbench/components/SchemaTree.tsx
```

## The strict-JSON contract

Output of `cdp/feature-builder.ts buildFeature(...)`:

```ts
interface BuiltFeature {
  description: string       // 1–2 plain-English sentences for the approval card
  code: string              // self-contained async IIFE (see CODE RULES)
  endpoints_used: string[]  // ["GET /api/foo", "POST /api/bar"] — listed verbatim in the card
  uses_csrf: boolean        // reuses CSRF/XSRF tokens?
  uses_cookies: boolean     // relies on session cookies? (almost always true for same-origin)
  mutates_data: boolean     // any POST/PUT/PATCH/DELETE?
  ui_changes: string        // brief DOM-injection description, or "none"
  warnings: string[]        // appended by analyzeCode() on the main side
}
```

`parseBuiltFeature(raw)` is tolerant of `\`\`\`json` fences and missing optional fields. It throws if the model returns no JSON object at all.

## Code rules baked into the prompt

The system prompt in `cdp/feature-builder.ts` enforces:

1. Single `(async () => { ... })()` IIFE.
2. Runs in page context — no `import`, no Node APIs.
3. `fetch(url, { credentials: "include" })` so cookies travel automatically.
4. **Never** inline a literal cookie / authorization / CSRF value. The spec passes those as `<redacted>`. CSRF tokens must be read at runtime from `document.cookie`, a meta tag, an existing global, or a known endpoint that returns one — matching how the page itself does it.
5. All injected DOM goes inside `<div id="bb-feature">`. Existing one is removed first. Position fixed, z-index 2147483640, top-right by default. Detect dark mode via `document.documentElement.classList`.
6. Catch all errors. Render the message inside `#bb-feature` and `console.error`. Never throw uncaught.
7. Hard cap: 4000 characters. One helper function, no over-engineering.
8. Idempotent: running twice leaves the page in the same final state.

If the requested feature is impossible from the captured spec, the LLM is instructed to inject `#bb-feature` with a one-sentence "what's missing — interact with X to capture it" message and set `endpoints_used = []`.

## Static analysis (`analyzeCode`)

After the LLM responds, `analyzeCode(code, parsed)` runs a small set of regex-based checks. Anything it finds becomes a warning surfaced in the ApprovalCard:

| Pattern | Warning |
| --- | --- |
| Code is not wrapped in `(async () =>` / `(async()` | "may not run as expected" |
| `fetch(` without `credentials` | "request will not carry the user's cookies" |
| `document.cookie =` | "Code writes to document.cookie — review carefully" |
| `(window\|location).(href\|assign\|replace) =` | "would leave the current site" |
| `localStorage.clear / sessionStorage.clear` | "likely to log the user out" |
| `"<redacted>"` literal in code | "the LLM did not read the live token; the request will fail" |
| `method: "POST/PUT/PATCH/DELETE"` but `mutates_data === false` | "Treat as destructive" |
| Code length > 4000 | "exceeds the 4000-char hint" |

`reconcileFlags` then auto-corrects `mutates_data` and `uses_cookies` against what the code actually does — so the safety tags don't mislead even if the LLM under-reports.

## Why the approval step is mandatory

A generated script runs *as the user* in a logged-in tab. It can read everything the user can read and write anywhere the user can write. The mitigation is making the consequences obvious before the user clicks Run:

- **Endpoints used** — listed verbatim, not buried in code.
- **Mutation flag** — `mutates_data === true` turns the card border amber and the Run button red.
- **CSRF / cookies tags** — surface the trust assumptions the LLM made.
- **Static-analysis warnings** — surfaced in their own block; they alone are enough to flip the card to amber.
- **Code preview** — collapsed by default, expandable, monospaced.

There is no auto-run path. To undo a feature, refresh the page or run `document.getElementById('bb-feature').remove()`.

## Execution

`feature:run` IPC handler calls `cdp/actions.ts evalJs(webContents, code, true, 15_000)`:

- Wraps the user code in a Promise.race against a 15 s timeout so a hung script can't hang the IPC.
- Sets `userGesture: true` so the script can trigger things like `window.open`.
- Returns `{ ok: true, value }` on success or `{ ok: false, error }` on exception.

The script runs in the page's main world. Cookies, localStorage, sessionStorage, and any globals the page exposes are all available.

## Why this works without a real extension API

- Same-origin fetch automatically includes cookies → no need to plumb auth.
- The page's existing JavaScript already paid the engineering cost of using the private API correctly. The sniffer extracts that knowledge into the spec.
- The LLM's job is "translate a feature request into a fetch call against this auto-discovered shape" — well within current model capability.
- The injected UI is namespaced to `#bb-feature` and the Tab's `replaySavedAugmentations` hook is ID-prefixed (`bb-*`) so feature scripts never accidentally collide with persisted augmentations.

## Failure modes

| Failure | What happens |
| --- | --- |
| LLM returns non-JSON | `parseBuiltFeature` throws with the first 200 chars; surfaced inline. |
| LLM returns valid JSON but `code` is broken | `evalJs` rejects; sidebar shows the error inline in the result panel. |
| API contract changes server-side | User refreshes the page (or clicks Trash to clear the capture) → sniffer recapture → Build again. |
| Page uses GraphQL | Every operation collapses to one `/graphql` shape; LLM gets only the most-recent op's shape. Works partially; flagged for v2. |
| No endpoints captured yet | Spec is empty; LLM is instructed to return a script that injects a `#bb-feature` "what's missing" message. |
| LLM lies about mutates_data | `analyzeCode` catches POST/PUT/PATCH/DELETE in the code, adds a warning, and `reconcileFlags` flips the flag. |

## How this fits with the agent

The agent (`src/main/agent/runtime.ts`) and the BuildComposer share `cdp/spec.ts` and `cdp/schema.ts`. The agent's system prompt now includes the same API spec digest (capped at 3000 chars), so:

- The user can use BuildComposer for one-shot "give me a feature" tasks.
- The user can use the agent's bottom-of-tab Composer for multi-step tasks that need clicks, navigation, etc., with the spec available as context.

Both end up calling `evalJs` under the hood — the agent through its own approval/risk gate (`agent/risk.ts`), the BuildComposer through its dedicated ApprovalCard.

## Extension points

- **Multi-sample schema merging** — observe several response samples per endpoint and union the types. Bigger spec, fewer hallucinations.
- **GraphQL splitting** — recognize the `operationName` field in request bodies and key endpoints by `{url, operationName}`.
- **Persistent recipes** — once a script works, save it as a re-runnable recipe per origin. The persisted-augmentation system in `Tab.replaySavedAugmentations` already supports the auto-replay half; the missing piece is "save this BuildComposer feature as an augmentation".
- **Sandboxed dry-run** — execute the generated script inside a `Function` proxy that intercepts `fetch` and shows the user the actual requests that would go out, before granting real network access.
