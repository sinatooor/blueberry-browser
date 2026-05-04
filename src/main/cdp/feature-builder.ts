// One-shot LLM call: turn a user prompt + sniffed API spec into a
// page-context script we can run via CDP Runtime.evaluate. The output is
// strict JSON the renderer can review before approving execution.

import { generateText, type LanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { renderApiSpec } from "./spec";
import type { BuiltFeature, EndpointSpec } from "../../common/types";

const SYSTEM_PROMPT = `You are a browser feature builder. The user is on a webpage. The browser has sniffed the page's XHR/fetch traffic and inferred a compact "API spec" for it. Your job: take the user's plain-English request and emit a self-contained script that delivers it by calling those APIs from inside the page (so the user's session cookies travel automatically).

INPUT
- Current page URL.
- Origin of the active tab.
- API spec, per endpoint:
  - METHOD path?queryKeys
  - origin and last-seen status
  - sanitized request headers (sensitive values like Cookie / Authorization / CSRF are "<redacted>" — names kept so you know what auth model the endpoint uses)
  - inferred request/response shape (a tree of types with one truncated example per leaf — never the full body)
- The user's feature request.

OUTPUT — strict JSON ONLY. No markdown. No fences. No commentary. Match this shape exactly:

{
  "description": string,
  "code": string,
  "endpoints_used": string[],
  "uses_csrf": boolean,
  "uses_cookies": boolean,
  "mutates_data": boolean,
  "ui_changes": string
}

CODE RULES — every rule matters; the script is reviewed before it runs.
1. Wrap everything in (async () => { ... })(). It runs inside the live page via CDP Runtime.evaluate.
2. NO import / require / Node APIs. Browser globals only.
3. ALWAYS use fetch(url, { credentials: "include", ... }) so the user's cookies travel automatically.
4. NEVER inline a literal cookie / authorization / CSRF value from the spec — those are "<redacted>" placeholders. If a request needs a CSRF token, READ it at runtime: parse document.cookie, document.querySelector('meta[name*="csrf" i],meta[name*="xsrf" i]'), or call the endpoint that returns one. Match how the page itself does it.
5. Inject any UI inside <div id="bb-feature">. Remove an existing #bb-feature first so the script is idempotent. Position fixed, z-index 2147483640, top-right by default. Detect the page theme (document.documentElement.classList contains "dark") and pick contrasting colors.
6. Catch ALL errors. On error, render the message inside #bb-feature and console.error. Never throw uncaught.
7. Hard cap: 4000 characters. Be terse — one helper function, no over-engineering.
8. Idempotent: running twice leaves the page in the same final state.

If the requested feature is impossible from the captured spec (e.g. the right endpoint isn't there yet), return code that injects #bb-feature with a one-sentence "what's missing — interact with X to capture it" message, set endpoints_used to [], uses_cookies to false, mutates_data to false.`;

const MUTATING_METHOD_RE = /method\s*:\s*["'`](POST|PUT|PATCH|DELETE)["'`]/i;
const FETCH_RE = /\bfetch\s*\(/;
const COOKIE_LITERAL_RE = /document\.cookie\s*=\s*['"`]/;
const LOCATION_WRITE_RE =
  /\b(?:window\.location|location\.href|location\.assign|location\.replace)\s*=/;
const STORAGE_CLEAR_RE =
  /\b(?:localStorage\.clear|sessionStorage\.clear)\s*\(/;
const REDACTED_LITERAL_RE = /["'`]<redacted>["'`]/;

function pickModel(): LanguageModel {
  if (process.env.LLM_PROVIDER?.toLowerCase() === "anthropic") {
    return anthropic(process.env.LLM_MODEL || "claude-sonnet-4-6");
  }
  return openai(process.env.LLM_MODEL || "gpt-4o-mini");
}

export interface BuildArgs {
  prompt: string;
  pageUrl: string | null;
  origin: string | null;
  spec: EndpointSpec[];
}

export async function buildFeature(args: BuildArgs): Promise<BuiltFeature> {
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "LLM not configured. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to .env.",
    );
  }

  const userMessage = [
    `Current page URL: ${args.pageUrl ?? "(unknown)"}`,
    `Origin: ${args.origin ?? "(unknown)"}`,
    "",
    "Discovered API spec for this page:",
    renderApiSpec(args.spec),
    "",
    "User feature request:",
    args.prompt,
  ].join("\n");

  const { text } = await generateText({
    model: pickModel(),
    system: SYSTEM_PROMPT,
    prompt: userMessage,
    temperature: 0.2,
    maxRetries: 2,
  });

  const parsed = parseBuiltFeature(text);
  const warnings = analyzeCode(parsed.code, parsed);
  // Reconcile self-reported flags with what the code actually does — the LLM
  // sometimes lies about mutates_data when the code clearly POSTs.
  const reconciled = reconcileFlags(parsed);
  return { ...reconciled, warnings };
}

export function parseBuiltFeature(raw: string): BuiltFeature {
  const cleaned = stripCodeFence(raw).trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error(
      `LLM returned no JSON object. First 200 chars: ${cleaned.slice(0, 200)}`,
    );
  }
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch (err) {
    throw new Error(
      `LLM returned malformed JSON: ${(err as Error).message}. First 200 chars: ${cleaned.slice(0, 200)}`,
    );
  }
  if (typeof obj !== "object" || obj === null) {
    throw new Error("LLM output is not a JSON object");
  }
  const o = obj as Record<string, unknown>;
  return {
    description: asString(o.description, ""),
    code: asString(o.code, ""),
    endpoints_used: asStringArray(o.endpoints_used),
    uses_csrf: asBoolean(o.uses_csrf, false),
    uses_cookies: asBoolean(o.uses_cookies, true),
    mutates_data: asBoolean(o.mutates_data, false),
    ui_changes: asString(o.ui_changes, "none"),
    warnings: [],
  };
}

// Static analysis on the generated code. We surface anything the user should
// know about before clicking Run — in addition to the LLM's self-reported
// flags. This catches the LLM under-reporting risk.
export function analyzeCode(code: string, parsed: BuiltFeature): string[] {
  const warnings: string[] = [];
  if (!code.includes("(async () =>") && !code.includes("(async()")) {
    warnings.push("Code is not wrapped in an async IIFE — may not run as expected.");
  }
  if (FETCH_RE.test(code) && !code.includes('credentials')) {
    warnings.push(
      'fetch() call without { credentials: "include" } — request will not carry the user\'s cookies.',
    );
  }
  if (COOKIE_LITERAL_RE.test(code)) {
    warnings.push("Code writes to document.cookie — review carefully.");
  }
  if (LOCATION_WRITE_RE.test(code)) {
    warnings.push("Code navigates the page (writes to location) — would leave the current site.");
  }
  if (STORAGE_CLEAR_RE.test(code)) {
    warnings.push("Code clears localStorage/sessionStorage — likely to log the user out.");
  }
  if (REDACTED_LITERAL_RE.test(code)) {
    warnings.push(
      'Code includes the literal "<redacted>" placeholder — the LLM did not read the live token. The request will fail until the token is read at runtime.',
    );
  }
  if (MUTATING_METHOD_RE.test(code) && !parsed.mutates_data) {
    warnings.push(
      "Code uses a mutating HTTP method (POST/PUT/PATCH/DELETE) but the LLM reported mutates_data=false. Treat as destructive.",
    );
  }
  if (code.length > 4000) {
    warnings.push(`Code is ${code.length} chars — exceeds the 4000-char hint.`);
  }
  return warnings;
}

function reconcileFlags(b: BuiltFeature): BuiltFeature {
  const mutates = b.mutates_data || MUTATING_METHOD_RE.test(b.code);
  const usesCookies = b.uses_cookies || /credentials\s*:\s*["'`]include/.test(b.code);
  return { ...b, mutates_data: mutates, uses_cookies: usesCookies };
}

function stripCodeFence(text: string): string {
  const m = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : text;
}

function asString(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback;
}

function asBoolean(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}
