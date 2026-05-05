// Persistent, cross-site catalog of every JSON endpoint the user has ever
// brushed against — sniffed from real traffic (`source: "sniffed"`) or
// added by hand from the API Bank's "Add API" form (`source: "manual"`).
//
// The in-memory NetworkCapture buffer is still the source of truth for
// the *active tab* (live updates, response-body access, copilot replays).
// This SQLite-backed catalog complements it: it persists across sessions,
// holds endpoints from origins the user isn't currently visiting, and is
// what the API Bank's "All sites" filter reads from.

import { getDb } from "../projects/store";
import { inferSchema } from "../cdp/schema";
import type {
  EndpointSpec,
  NetRequest,
  SchemaNode,
} from "../../common/types";

const SENSITIVE_HEADER_PATTERNS: RegExp[] = [
  /^authorization$/i,
  /^cookie$/i,
  /^set-cookie$/i,
  /-token$/i,
  /^x-api-key$/i,
  /^x-csrf-token$/i,
];

const CSRF_HEADER_HINTS = [/csrf/i, /xsrf/i, /^x-requested-with$/i];
const AUTH_HEADER_HINTS = [
  /^authorization$/i,
  /^x-api-key$/i,
  /^x-auth-token$/i,
  /^x-session-token$/i,
];

const MAX_BODY_PARSE_BYTES = 256 * 1024;

export type ApiSource = "sniffed" | "manual";

interface StoredRow {
  endpoint_key: string;
  origin: string;
  method: string;
  pathname: string;
  spec_json: string;
  source: ApiSource;
  first_seen: number;
  last_seen: number;
  count: number;
}

// Insert or merge an endpoint spec for a single observed request. We keep
// the schemas we already inferred (don't overwrite with null) and bump the
// count + last_seen each time the same key shows up.
export function upsertApiFromRequest(req: NetRequest): EndpointSpec | null {
  if (!isApiCall(req)) return null;
  let parsed: URL;
  try {
    parsed = new URL(req.url);
  } catch {
    return null;
  }
  const key = `${req.method} ${parsed.origin}${parsed.pathname}`;
  const now = req.ts;

  const reqHeaders = sanitizeHeaders(req.reqHeaders ?? {});
  const responseSchema = parseSchema(req.resBody);
  const requestBodySchema = parseSchema(req.reqBody);
  const csrfHeader = Object.keys(reqHeaders).find((k) =>
    CSRF_HEADER_HINTS.some((p) => p.test(k)),
  );
  const authHeader = Object.keys(reqHeaders).find((k) =>
    AUTH_HEADER_HINTS.some((p) => p.test(k)),
  );

  const fresh: EndpointSpec = {
    key,
    origin: parsed.origin,
    method: req.method,
    pathname: parsed.pathname,
    url: req.url,
    queryKeys: Array.from(parsed.searchParams.keys()),
    contentType:
      req.resHeaders?.["content-type"] ?? req.resHeaders?.["Content-Type"],
    requestHeaders: reqHeaders,
    hasCsrfHint: !!csrfHeader,
    csrfHeaderName: csrfHeader,
    hasAuthHint: !!authHeader,
    authHeaderName: authHeader,
    redactedHeaderNames: Object.entries(reqHeaders)
      .filter(([, v]) => v === "<redacted>")
      .map(([k]) => k),
    requestBodySchema,
    responseSchema,
    responseStatus: req.status,
    count: 1,
    lastSeen: now,
  };

  const existing = getRow(key);
  const merged = existing
    ? mergeSpecs(deserializeSpec(existing.spec_json), fresh)
    : fresh;

  const db = getDb();
  if (existing) {
    db.prepare(
      `UPDATE captured_apis
         SET spec_json = ?, last_seen = ?, count = count + 1
         WHERE endpoint_key = ?`,
    ).run(JSON.stringify(merged), now, key);
  } else {
    db.prepare(
      `INSERT INTO captured_apis
         (endpoint_key, origin, method, pathname, spec_json, source, first_seen, last_seen, count)
       VALUES (?, ?, ?, ?, ?, 'sniffed', ?, ?, 1)`,
    ).run(
      key,
      parsed.origin,
      req.method,
      parsed.pathname,
      JSON.stringify(merged),
      now,
      now,
    );
  }
  return merged;
}

// Add a manual entry from the Bank's "Add API" form. The user pastes a
// URL + method + sample response (JSON), we infer the schema and store it.
export function addManualApi(args: {
  origin: string;
  method: string;
  pathname: string;
  url: string;
  sampleResponse?: string;
  notes?: string;
}): EndpointSpec | null {
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(args.url);
  } catch {
    parsedUrl = null;
  }
  const origin = args.origin || parsedUrl?.origin || "";
  const pathname = args.pathname || parsedUrl?.pathname || "/";
  const key = `${args.method} ${origin}${pathname}`;
  const now = Date.now();
  const responseSchema = parseSchema(args.sampleResponse);

  const spec: EndpointSpec = {
    key,
    origin,
    method: args.method.toUpperCase(),
    pathname,
    url: args.url,
    queryKeys: parsedUrl ? Array.from(parsedUrl.searchParams.keys()) : [],
    contentType: undefined,
    requestHeaders: {},
    hasCsrfHint: false,
    hasAuthHint: false,
    redactedHeaderNames: [],
    requestBodySchema: null,
    responseSchema,
    responseStatus: undefined,
    count: 1,
    lastSeen: now,
  };

  const db = getDb();
  const existing = getRow(key);
  if (existing) {
    const merged = mergeSpecs(deserializeSpec(existing.spec_json), spec);
    db.prepare(
      `UPDATE captured_apis SET spec_json = ?, last_seen = ?, source = 'manual'
       WHERE endpoint_key = ?`,
    ).run(JSON.stringify(merged), now, key);
    return merged;
  }
  db.prepare(
    `INSERT INTO captured_apis
       (endpoint_key, origin, method, pathname, spec_json, source, first_seen, last_seen, count)
     VALUES (?, ?, ?, ?, ?, 'manual', ?, ?, 1)`,
  ).run(key, origin, spec.method, pathname, JSON.stringify(spec), now, now);
  return spec;
}

export function listApis(opts?: {
  origin?: string;
  limit?: number;
}): EndpointSpec[] {
  const db = getDb();
  const limit = opts?.limit ?? 500;
  const rows = opts?.origin
    ? (db
        .prepare(
          `SELECT spec_json FROM captured_apis WHERE origin = ?
           ORDER BY last_seen DESC LIMIT ?`,
        )
        .all(opts.origin, limit) as { spec_json: string }[])
    : (db
        .prepare(
          `SELECT spec_json FROM captured_apis ORDER BY last_seen DESC LIMIT ?`,
        )
        .all(limit) as { spec_json: string }[]);
  return rows
    .map((r) => deserializeSpec(r.spec_json))
    .filter((s): s is EndpointSpec => s !== null);
}

export function removeApi(key: string): void {
  getDb().prepare(`DELETE FROM captured_apis WHERE endpoint_key = ?`).run(key);
}

export function clearApisForOrigin(origin: string): void {
  getDb().prepare(`DELETE FROM captured_apis WHERE origin = ?`).run(origin);
}

// ---- helpers ---------------------------------------------------------------

function getRow(key: string): StoredRow | null {
  const row = getDb()
    .prepare(`SELECT * FROM captured_apis WHERE endpoint_key = ?`)
    .get(key) as StoredRow | undefined;
  return row ?? null;
}

function deserializeSpec(json: string): EndpointSpec | null {
  try {
    return JSON.parse(json) as EndpointSpec;
  } catch {
    return null;
  }
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

function sanitizeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (SENSITIVE_HEADER_PATTERNS.some((p) => p.test(k))) {
      out[k] = "<redacted>";
    } else {
      out[k] = typeof v === "string" ? v : String(v);
    }
  }
  return out;
}

function mergeSpecs(prev: EndpointSpec | null, next: EndpointSpec): EndpointSpec {
  if (!prev) return next;
  return {
    ...prev,
    url: next.url,
    queryKeys: union(prev.queryKeys, next.queryKeys),
    requestHeaders: { ...prev.requestHeaders, ...next.requestHeaders },
    hasCsrfHint: prev.hasCsrfHint || next.hasCsrfHint,
    csrfHeaderName: prev.csrfHeaderName ?? next.csrfHeaderName,
    hasAuthHint: prev.hasAuthHint || next.hasAuthHint,
    authHeaderName: prev.authHeaderName ?? next.authHeaderName,
    redactedHeaderNames: union(
      prev.redactedHeaderNames,
      next.redactedHeaderNames,
    ),
    requestBodySchema: prev.requestBodySchema ?? next.requestBodySchema,
    responseSchema: prev.responseSchema ?? next.responseSchema,
    responseStatus: next.responseStatus ?? prev.responseStatus,
    count: prev.count + next.count,
    lastSeen: Math.max(prev.lastSeen, next.lastSeen),
  };
}

function union(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b]));
}
