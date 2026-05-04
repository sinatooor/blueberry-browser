// Builds an "API spec" view of the network capture buffer for a tab.
//
// `NetworkCapture` already redacts sensitive header values (Cookie,
// Authorization, *-token, X-API-Key, X-CSRF-Token). This module:
//   1. Pulls captured XHR/Fetch requests for a tab/origin
//   2. Groups by `${method} ${origin}${pathname}` (so repeated calls collapse)
//   3. Picks a representative request per group
//   4. Infers JSON schemas (tree + 1 example per leaf) for request/response
//      bodies via cdp/schema.ts
//   5. Flags which endpoints rely on auth headers vs CSRF tokens, so the
//      Build tab's safety panel can warn before running
//
// We never expose the raw response body up the chain — only the inferred
// schema. That keeps the LLM context small and bounds the user's data
// exposure if a body got captured.

import { networkCapture } from "./network";
import { inferSchema, renderSchema } from "./schema";
import type { EndpointSpec, NetRequest, SchemaNode } from "../../common/types";

const CSRF_HEADER_HINTS = [/csrf/i, /xsrf/i, /^x-requested-with$/i];
const AUTH_HEADER_HINTS = [
  /^authorization$/i,
  /^x-api-key$/i,
  /^x-auth-token$/i,
  /^x-session-token$/i,
];

const MAX_BODY_PARSE_BYTES = 256 * 1024;

export interface BuildSpecOptions {
  tabId: string;
  originFilter?: string;
  // Cap how many endpoints we surface; the most-recently-seen win.
  maxEndpoints?: number;
}

export function buildApiSpec(opts: BuildSpecOptions): EndpointSpec[] {
  const reqs = networkCapture.list({ tabId: opts.tabId, limit: 500 });
  const groups = new Map<string, EndpointSpec>();

  for (const req of reqs) {
    if (!isApiCall(req)) continue;
    let parsed: URL;
    try {
      parsed = new URL(req.url);
    } catch {
      continue;
    }
    if (opts.originFilter && parsed.origin !== opts.originFilter) continue;

    const key = `${req.method} ${parsed.origin}${parsed.pathname}`;
    const existing = groups.get(key);
    const responseSchema = parseSchema(req.resBody);
    const requestBodySchema = parseSchema(req.reqBody);
    const reqHeaders = req.reqHeaders ?? {};
    const redactedHeaderNames = Object.entries(reqHeaders)
      .filter(([, v]) => v === "<redacted>")
      .map(([k]) => k);
    const csrfHeader = Object.keys(reqHeaders).find((k) =>
      CSRF_HEADER_HINTS.some((p) => p.test(k)),
    );
    const authHeader = Object.keys(reqHeaders).find((k) =>
      AUTH_HEADER_HINTS.some((p) => p.test(k)),
    );

    if (!existing) {
      groups.set(key, {
        key,
        origin: parsed.origin,
        method: req.method,
        pathname: parsed.pathname,
        url: req.url,
        queryKeys: Array.from(parsed.searchParams.keys()),
        contentType:
          req.resHeaders?.["content-type"] ??
          req.resHeaders?.["Content-Type"],
        requestHeaders: reqHeaders,
        hasCsrfHint: !!csrfHeader,
        csrfHeaderName: csrfHeader,
        hasAuthHint: !!authHeader,
        authHeaderName: authHeader,
        redactedHeaderNames,
        requestBodySchema,
        responseSchema,
        responseStatus: req.status,
        count: 1,
        lastSeen: req.ts,
      });
      continue;
    }

    existing.count++;
    if (req.ts > existing.lastSeen) existing.lastSeen = req.ts;
    // Prefer the first non-null schema we got; later samples don't widen.
    if (responseSchema && !existing.responseSchema)
      existing.responseSchema = responseSchema;
    if (requestBodySchema && !existing.requestBodySchema)
      existing.requestBodySchema = requestBodySchema;
    if (req.status != null && existing.responseStatus == null)
      existing.responseStatus = req.status;
  }

  const out = Array.from(groups.values()).sort(
    (a, b) => b.lastSeen - a.lastSeen,
  );
  if (opts.maxEndpoints && out.length > opts.maxEndpoints) {
    return out.slice(0, opts.maxEndpoints);
  }
  return out;
}

function isApiCall(req: NetRequest): boolean {
  const t = req.resourceType;
  return t === "XHR" || t === "Fetch";
}

function parseSchema(body: string | undefined): SchemaNode | null {
  if (!body) return null;
  if (body.length > MAX_BODY_PARSE_BYTES) return null;
  try {
    return inferSchema(JSON.parse(body));
  } catch {
    return null;
  }
}

// Render an EndpointSpec[] as compact text suitable for an LLM prompt.
// We greedily include endpoints until we hit the byte budget so the prompt
// stays predictable on noisy sites.
export function renderApiSpec(
  specs: EndpointSpec[],
  maxBytes = 6000,
): string {
  if (specs.length === 0) {
    return "(no JSON endpoints captured yet — interact with the page so it makes XHR/fetch calls, then try again)";
  }
  const blocks = specs.map(renderEndpoint);
  const out: string[] = [];
  let used = 0;
  for (let i = 0; i < blocks.length; i++) {
    if (used + blocks[i].length > maxBytes && out.length > 0) {
      out.push(
        `(${blocks.length - out.length} more endpoint(s) omitted to fit context budget)`,
      );
      break;
    }
    out.push(blocks[i]);
    used += blocks[i].length;
  }
  return out.join("\n\n");
}

function renderEndpoint(s: EndpointSpec): string {
  const lines: string[] = [];
  const queryPart = s.queryKeys.length
    ? `?${s.queryKeys.join("&")}`
    : "";
  lines.push(`### ${s.method} ${s.pathname}${queryPart}`);
  lines.push(`origin: ${s.origin}`);
  if (s.responseStatus != null) lines.push(`last status: ${s.responseStatus}`);
  if (s.hasAuthHint) {
    lines.push(
      `auth: yes (header "${s.authHeaderName}" value redacted — DO NOT inline; call from the page so cookies/headers are supplied automatically)`,
    );
  }
  if (s.hasCsrfHint) {
    lines.push(
      `csrf: yes (header "${s.csrfHeaderName}" must be reused — read it live from document.cookie / meta tag / page state at runtime)`,
    );
  }
  if (s.requestBodySchema) {
    lines.push("request body shape:");
    lines.push(indent(renderSchema(s.requestBodySchema), 2));
  }
  if (s.responseSchema) {
    lines.push("response shape:");
    lines.push(indent(renderSchema(s.responseSchema), 2));
  } else {
    lines.push("response: (no JSON body captured for this endpoint)");
  }
  return lines.join("\n");
}

function indent(text: string, n: number): string {
  const pad = " ".repeat(n);
  return text
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}
