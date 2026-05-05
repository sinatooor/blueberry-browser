// One-shot LLM call: turn a user prompt + sniffed API spec into a
// page-context script we can run via CDP Runtime.evaluate. The output is
// strict JSON the renderer can review before approving execution.

import { generateText, type LanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { renderApiSpec } from "./spec";
import type { BuiltFeature, EndpointSpec } from "../../common/types";

const SYSTEM_PROMPT = `You are a browser feature builder. The user is on a webpage. The browser has sniffed the page's XHR/fetch traffic and inferred a compact "API spec" for it. The user has toggled which endpoints are visible to you — only the enabled ones appear below.

You can do TWO things, and you choose per request:

1. ANSWER — the user asked a *question* (e.g. "what does this API return?", "how many of these are open?", "what shape is the response?"). Reply in the chat with prose grounded in the spec. Do NOT generate code.

2. BUILD — the user asked for a *feature* (a button, panel, exporter, plot, dashboard widget, automation). Emit a self-contained script that runs in the live page and delivers it.

If a question can be answered from the spec alone, prefer ANSWER. If it requires fetching live data to answer (e.g. "how many of these are open *right now*?"), BUILD a small inspector that fetches and renders the answer — that's still a build, just an information-display one.

OUTPUT — strict JSON ONLY. No markdown. No fences. No commentary. ALWAYS include "kind".

For ANSWER, return:
{
  "kind": "answer",
  "answer": string                  // the text the user will read in chat (use \\n for newlines, can include short markdown)
}

For BUILD, return:
{
  "kind": "build",
  "description": string,             // 1-2 sentence summary, shown above the run button
  "code": string,                    // self-contained async IIFE, runs in the page
  "endpoints_used": string[],        // ["GET /api/foo", "POST /api/bar"] — listed verbatim in the safety card
  "uses_csrf": boolean,
  "uses_cookies": boolean,           // true whenever the script calls fetch on this origin
  "mutates_data": boolean,           // any POST/PUT/PATCH/DELETE
  "ui_changes": string               // brief description of UI inserted, or "none"
}

PAGE-SIDE HELPERS — every page has these globals (we inject them before any script runs):

* window.__bb_widget(id, title, body) → returns a content slot DOM element
    Creates a draggable, closeable floating panel pinned to the top-right with the given title in the header. \`id\` MUST start with "bb-". \`body\` may be an HTMLString or a DOM Node. Re-running with the same id reuses the existing panel (idempotent). Position is auto-persisted to localStorage. Use this INSTEAD of building your own fixed-position div — the user can drag your panel around and close it.

* window.__bb_runPython(code) → Promise<{ stdout, stderr, plots: [{ dataUrl, mime }], value }>
    Runs Python in a Pyodide sandbox in the main process and returns results. Use this for plotting, pandas, numpy, anything statistical. matplotlib plots are auto-captured as base64-encoded PNGs in \`plots\`; turn them into <img src={dataUrl}> inside your widget. \`value\` is the final expression (if any). The Python sandbox sees the project's /project/files/ directory but is otherwise isolated from the page; pass data IN by interpolating it into the source string.

BUILD CODE RULES (every rule matters — the script is reviewed before it runs):
1. Wrap everything in (async () => { ... })(). Runs in the live page via CDP Runtime.evaluate.
2. NO import / require / Node APIs. Browser globals + the __bb_* helpers only.
3. ALWAYS use fetch(url, { credentials: "include", ... }) so the user's cookies travel automatically.
4. NEVER inline a literal cookie / authorization / CSRF value from the spec — those are "<redacted>" placeholders. If a request needs a CSRF token, READ it at runtime: parse document.cookie, document.querySelector('meta[name*="csrf" i],meta[name*="xsrf" i]'), or call the endpoint that returns one. Match how the page itself does it.
5. Use window.__bb_widget('bb-feature-<short-name>', '<Human Title>', '') for any visible UI. The user can move and close it. Don't build your own fixed-position chrome.
6. For analysis / plots, send raw data into __bb_runPython and render the returned plots[] as <img>. Don't try to pull pandas into the page.
7. Catch ALL errors. On error, render the message inside the widget body and console.error. Never throw uncaught.
8. Hard cap: 5000 characters. Be terse — one helper function, no over-engineering.
9. Idempotent: re-running leaves the page in the same final state.

If the requested feature is impossible from the captured spec (e.g. the right endpoint isn't enabled / captured), prefer kind="answer" with a one-sentence "what's missing — interact with X or enable Y in the API menu" message, and DO NOT generate code.`;

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
  if (parsed.kind === "answer") {
    return { ...parsed, warnings: [] };
  }
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
  // Discriminate by `kind`. Older outputs without `kind` but with `code`
  // are treated as builds for backwards compatibility.
  const declaredKind = o.kind === "answer" ? "answer" : "build";
  const hasCode = typeof o.code === "string" && (o.code as string).trim().length > 0;
  const kind: "answer" | "build" =
    declaredKind === "answer" || (declaredKind === "build" && !hasCode && typeof o.answer === "string")
      ? "answer"
      : "build";
  return {
    kind,
    description: asString(o.description, ""),
    code: asString(o.code, ""),
    endpoints_used: asStringArray(o.endpoints_used),
    uses_csrf: asBoolean(o.uses_csrf, false),
    uses_cookies: asBoolean(o.uses_cookies, true),
    mutates_data: asBoolean(o.mutates_data, false),
    ui_changes: asString(o.ui_changes, "none"),
    answer: typeof o.answer === "string" ? (o.answer as string) : undefined,
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
  if (code.length > 5000) {
    warnings.push(`Code is ${code.length} chars — exceeds the 5000-char hint.`);
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
