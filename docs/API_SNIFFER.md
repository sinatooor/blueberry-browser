# API Sniffer

The sniffer's job: make every site's private API legible to the LLM without ever exposing the user's secrets.

It's a three-layer pipeline, each layer pure and independently testable:

```
     XHR/Fetch traffic on a tab
                │
                ▼
   src/main/cdp/network.ts          NetworkCapture
   (CDP listener, sanitization,     ring buffer, persistence)
                │
                ▼
   src/main/cdp/spec.ts             buildApiSpec(tabId, origin)
   (group + dedupe + schema infer,  flag CSRF/auth)
                │
                ├─ renderApiSpec → compact text → LLM
                │
                ▼
       BuildComposer / agent runtime
       (sees structure, never raw bodies, never secret values)
```

## Why CDP, not `webRequest`

Electron's `webRequest` API exposes URLs and headers but not response bodies. We need bodies to infer the JSON schema. The Chrome DevTools Protocol does, and it's available on every `WebContents` via `webContents.debugger`. So:

- One sniffer per tab.
- One CDP attachment per tab, guarded against double-attach (`cdp/attach.ts`).
- Re-attaches automatically on `did-navigate` so a SPA route change doesn't drop the listener.

## Layer 1 — capture and sanitize (`cdp/network.ts`)

CDP events used:

| Event | Action |
| --- | --- |
| `Network.requestWillBeSent` | Build a pending row with method, URL, request headers (post-sanitize), `postData`. Skip if `type` is `Image / Font / Stylesheet / Media / Manifest / TextTrack`. |
| `Network.responseReceived` | Record status code and response headers (sanitized). |
| `Network.loadingFinished` | If resource type is `XHR / Fetch / Document / Script`, call `Network.getResponseBody`. Cap body at 256 KB; if base64 and not text/json, skip. Commit the row to the buffer. |
| `Network.loadingFailed` | Commit whatever we have. |

### Sanitization rule

Header values whose KEY matches one of these patterns are replaced with `<redacted>` before the row leaves `NetworkCapture`:

```ts
[/^authorization$/i, /^cookie$/i, /^set-cookie$/i,
 /-token$/i, /^x-api-key$/i, /^x-csrf-token$/i]
```

The header NAME stays. The downstream consumers (the agent, the Build flow, the Network panel) need to know "this endpoint requires a Cookie / Authorization / CSRF token", but they never need the value — generated scripts run inside the page where the browser supplies cookies via `credentials: "include"` and the page itself can re-read CSRF tokens from `document.cookie` or a meta tag.

### Storage

In memory: a single ring buffer of capacity 500. Per project (when an active project is set): each row is persisted via `projects/store.persistNetRequest` so investigations survive restarts.

## Layer 2 — schema inference (`cdp/schema.ts`)

`inferSchema(value, depth)` walks a parsed JSON value and returns a compact `SchemaNode`:

```ts
type SchemaNode =
  | { type: 'string';  example?: string }      // truncated to 80 chars
  | { type: 'number';  example?: number }
  | { type: 'boolean'; example?: boolean }
  | { type: 'null' }
  | { type: 'array';   item: SchemaNode | null; observedLength: number }
  | { type: 'object';  fields: Record<string, SchemaNode> }
  | { type: 'unknown' }
```

Caps:

- depth ≤ 6 (anything deeper becomes `unknown`)
- objects: first 60 keys
- arrays: only the first item is sampled (`observedLength` records the real length)
- strings: truncated to 80 chars + ellipsis

Why "tree + one example" instead of the raw body:

- Big arrays don't blow up the prompt — first item is enough to write code against.
- Long strings (URLs, descriptions, base64 blobs) get truncated.
- The LLM has every field name, every type, and a representative value.
- The user's data exposure is bounded — full payloads never leave main.

`renderSchema(node)` formats the tree as indented text:

```
object
  id: number (e.g. 42)
  items: array[3] of
    object
      name: string (e.g. "widget")
```

## Layer 3 — endpoint aggregation (`cdp/spec.ts`)

`buildApiSpec({ tabId, originFilter, maxEndpoints })`:

1. Pulls captured XHR/Fetch rows for the tab.
2. Groups by `${method} ${origin}${pathname}` so repeated calls (with different query strings) collapse into one entry.
3. For each group, takes the first observed JSON request/response body and runs `inferSchema`.
4. Counts, tracks `lastSeen`, and remembers the representative `url`.
5. Sets `hasAuthHint` / `hasCsrfHint` based on header NAMES (`/^authorization$/i`, `/^x-api-key$/i`, `/-token$/i` for auth; `/csrf/i`, `/xsrf/i`, `/^x-requested-with$/i` for CSRF).

`renderApiSpec(specs, maxBytes = 6000)` greedily renders endpoints into a compact block format. Each endpoint:

```
### POST /api/comments?postId
origin: https://example.com
last status: 201
auth: yes (header "Authorization" value redacted — DO NOT inline; …)
csrf: yes (header "X-CSRF-Token" must be reused — read it live from document.cookie / meta tag …)
request body shape:
  object
    text: string (e.g. "looks great")
    parentId: number (e.g. 12)
response shape:
  object
    id: number (e.g. 99)
    createdAt: string (e.g. "2026-05-04T22:31:18Z")
```

If the spec exceeds the byte budget, the tail endpoints are omitted with a `(N more endpoint(s) omitted)` marker. The renderer stays predictable on noisy sites.

## How the API is delivered to the LLM

Two consumers today:

1. **Build flow (`BuildComposer` → `cdp/feature-builder.ts`)** — the spec is rendered into the user prompt, paired with the user's feature request, and the LLM emits a strict-JSON `BuiltFeature`.

2. **Agent runtime (`agent/runtime.ts`)** — the spec digest is injected into the agent's system prompt at run start, capped at 3000 chars. The agent gets a heads-up about which endpoints are available without manually probing via `extractFromNetwork`.

Both consumers see the *same* sanitized view. There is no second path that bypasses sanitization.

## What's intentionally not handled (yet)

- **GraphQL** — every operation hits the same `/graphql` URL, so our `${method} ${origin}${pathname}` keying lumps them together. Out of scope per the user's instruction; tracked as the obvious next iteration.
- **WebSockets / SSE** — captured at the request level but no body parsing.
- **Streaming JSON / NDJSON** — `Network.getResponseBody` returns the whole body, but we skip if MIME isn't text/JSON-ish.
- **Multi-sample schema merging** — only the first observed JSON shape per endpoint is kept. Later samples don't widen unions or detect optional fields.
- **Form-encoded request bodies** — only `application/json` request bodies become a `requestBodySchema`.

Each of these is a clean extension point. Sanitization, the schema renderer, and the prompt format do not need to change.

## What happens when an inferred API breaks

Per the user's spec: "if the api breaks then user just need to run a refresh to fix it". That's exactly what the architecture supports:

- The capture buffer is in-memory; clearing it (Network panel → Clear, or just refreshing the page) re-sniffs the live shape from scratch.
- Each Build call re-pulls the spec via `buildApiSpec` — there's no stale cache.
- If a generated script's `endpoints_used` no longer match the current spec, the script will fail at runtime (404 / 5xx); the user sees the error inline in the ApprovalCard's result panel and can hit Generate again.
