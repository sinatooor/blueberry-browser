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
  "ui_changes": string,              // brief description of UI inserted, or "none"
  "suggested_id": string,            // the SAME bb-<short-name> id used inside __bb_widget(...) — required so the user can save the build as a replayable extension
  "suggested_name": string           // 2-4 word human label shown in the Extensions menu, e.g. "Payments Over Time"
}

PAGE-SIDE HELPERS — every page has these globals (we inject them before any script runs):

* window.__bb_widget(id, title, body) → returns a content slot DOM element
    Creates a draggable, closeable floating panel pinned to the top-right with the given title in the header. \`id\` MUST start with "bb-". \`body\` may be an HTMLString or a DOM Node. Re-running with the same id reuses the existing panel (idempotent). Position is auto-persisted to localStorage. Use this INSTEAD of building your own fixed-position div — the user can drag your panel around and close it.

* window.__bb_runPython(code, data?) → Promise<{ stdout, stderr, plots: [{ dataUrl, mime }], value }>
    Runs Python in a Pyodide sandbox in the main process and returns results. Use this for plotting, pandas, numpy, anything statistical. matplotlib plots are auto-captured as base64-encoded PNGs in \`plots\`; turn them into <img src={dataUrl}> inside your widget.
    PASS DATA IN VIA THE SECOND ARGUMENT, NOT BY INTERPOLATING JSON INTO THE CODE. The host serializes once and Pyodide hands you a real Python object as the global \`_data\` — dict/list/scalar mirroring whatever you passed. This is the ONLY safe way to ship arrays of objects to Python; nesting JSON.stringify inside a backtick template is the #1 cause of "Missing } in template expression" syntax errors.

    GOOD:
        const rows = json.events;  // already a JS array of objects
        const py = await window.__bb_runPython(\`
import pandas as pd
import matplotlib.pyplot as plt
df = pd.DataFrame(_data)
df["date"] = pd.to_datetime(df["date"])
df.plot(x="date", y=["failed_payments","successful_payments"])
plt.show()
        \`, rows);

    BAD (do not do this):
        const py = await window.__bb_runPython(\`data = \${JSON.stringify(rows)}\\n...\`);   // brittle, often syntax-errors

BUILD CODE RULES (every rule matters — the script is reviewed before it runs):
1. Wrap everything in (async () => { ... })(). Runs in the live page via CDP Runtime.evaluate.
2. NO import / require / Node APIs. Browser globals + the __bb_* helpers only.
3. ALWAYS use fetch(url, { credentials: "include", ... }) so the user's cookies travel automatically.
4. NEVER inline a literal cookie / authorization / CSRF value from the spec — those are "<redacted>" placeholders. If a request needs a CSRF token, READ it at runtime: parse document.cookie, document.querySelector('meta[name*="csrf" i],meta[name*="xsrf" i]'), or call the endpoint that returns one. Match how the page itself does it.
5. Use window.__bb_widget('bb-feature-<short-name>', '<Human Title>', '') for any visible UI. The user can move and close it. Don't build your own fixed-position chrome.
6. CREATE THE WIDGET FIRST and put a "Loading…" placeholder in it BEFORE you start any fetch / __bb_runPython work. Example pattern:
     const slot = window.__bb_widget('bb-feature-payments', 'Payments plot', '');
     slot.innerHTML = '<div style="padding:16px;color:#888">Loading data…</div>';
     try {
       const data = await fetch(...);
       slot.innerHTML = '<div style="padding:16px;color:#888">Rendering plot (Pyodide)…</div>';
       const py = await window.__bb_runPython(\`...\`);
       slot.innerHTML = py.plots.map(p => '<img style="max-width:100%" src="' + p.dataUrl + '">').join('') || '<pre>' + py.stdout + '</pre>';
     } catch (e) {
       slot.innerHTML = '<pre style="color:#c00;white-space:pre-wrap">' + (e && e.message || e) + '</pre>';
     }
   The first __bb_runPython call after app start can take 30+ seconds while Pyodide loads matplotlib — without a visible Loading state the user thinks nothing is happening.
7. For analysis / plots, send raw data into __bb_runPython and render the returned plots[] as <img>. End your Python with plt.show() — that is what captures the figure into result.plots. Don't try to pull pandas into the page.
8. Catch ALL errors. On error, render the message inside the widget body and console.error. Never throw uncaught.
9. Hard cap: 5000 characters. Be terse — one helper function, no over-engineering.
10. Idempotent: re-running leaves the page in the same final state.

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
  // Optional previous build to iterate on. When present we ask the model
  // to modify it rather than start over — keeps the same widget id, tweaks
  // the code, and avoids two stacked panels for the same feature.
  previousFeature?: {
    description?: string;
    code: string;
    suggested_id?: string;
    suggested_name?: string;
  };
}

export async function buildFeature(args: BuildArgs): Promise<BuiltFeature> {
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "LLM not configured. Add OPENAI_API_KEY or ANTHROPIC_API_KEY to .env.",
    );
  }

  const previousBlock = args.previousFeature
    ? [
        "",
        "Previous version of this feature (the user is iterating, not starting fresh):",
        args.previousFeature.description
          ? `description: ${args.previousFeature.description}`
          : "",
        args.previousFeature.suggested_id
          ? `id: ${args.previousFeature.suggested_id}`
          : "",
        "```js",
        args.previousFeature.code,
        "```",
        "",
        "MODIFY the previous version to satisfy the new request unless the user explicitly says 'start over' or 'new feature'. Keep the SAME suggested_id so the panel updates in place rather than stacking. Re-emit the full code in your response — partial diffs aren't supported.",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const userMessage = [
    `Current page URL: ${args.pageUrl ?? "(unknown)"}`,
    `Origin: ${args.origin ?? "(unknown)"}`,
    "",
    "Discovered API spec for this page:",
    renderApiSpec(args.spec),
    previousBlock,
    "",
    "User feature request:",
    args.prompt,
  ].join("\n");

  // First pass.
  let parsed = await callBuilder(userMessage);

  // For build outputs, syntax-check the code with V8's parser. If it fails,
  // give the model the literal V8 error message and a re-run prompt — twice.
  // The most common LLM failure is unbalanced template literals (e.g. nested
  // backticks while building Python source strings), which a single retry
  // with the actual error message reliably fixes.
  if (parsed.kind === "build" && parsed.code) {
    let syntaxError = checkJsSyntax(parsed.code);
    let attempts = 0;
    while (syntaxError && attempts < 2) {
      attempts++;
      const repairPrompt = [
        userMessage,
        "",
        "Your previous response had a JavaScript syntax error:",
        "",
        `  ${syntaxError}`,
        "",
        "Code that failed to parse:",
        "```js",
        parsed.code,
        "```",
        "",
        "Re-emit the SAME strict-JSON shape (kind=build, description, code, endpoints_used, uses_csrf, uses_cookies, mutates_data, ui_changes) but with valid JavaScript this time. The most common cause is mismatched backticks/braces while interpolating Python source — escape carefully or use string concatenation if nesting template literals is hard.",
      ].join("\n");
      const next = await callBuilder(repairPrompt);
      if (next.kind !== "build" || !next.code) break;
      parsed = next;
      syntaxError = checkJsSyntax(parsed.code);
    }
  }

  if (parsed.kind === "answer") {
    return { ...parsed, warnings: [] };
  }
  const warnings = analyzeCode(parsed.code, parsed);
  // Reconcile self-reported flags with what the code actually does — the LLM
  // sometimes lies about mutates_data when the code clearly POSTs.
  const reconciled = reconcileFlags(parsed);
  return { ...reconciled, warnings };
}

// Single LLM call → parsed BuiltFeature. Used by buildFeature for both the
// initial pass and any syntax-repair retries.
async function callBuilder(userMessage: string): Promise<BuiltFeature> {
  const { text } = await generateText({
    model: pickModel(),
    system: SYSTEM_PROMPT,
    prompt: userMessage,
    temperature: 0.2,
    maxRetries: 2,
  });
  return parseBuiltFeature(text);
}

// Validate that `code` parses as JavaScript before we ship it to CDP. The
// LLM's most common failure mode is malformed template literals while
// interpolating Python source — V8's "Missing } in template expression"
// message is the giveaway. We use the Function constructor as a parser-only
// check (not actually invoked).
export function checkJsSyntax(code: string): string | null {
  try {
    // Wrapping in `async function` lets the LLM's top-level await + IIFE
    // patterns parse without complaining.
    new Function(`return (async () => {\n${code}\n})()`);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
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
  const suggestedIdRaw = asString(o.suggested_id, "").trim();
  const suggestedNameRaw = asString(o.suggested_name, "").trim();
  // Fallback: pluck the first bb-* id out of the code itself if the model
  // forgot to echo it explicitly. Keeps Save-as-extension working even when
  // the schema regression happens.
  const codeStr = asString(o.code, "");
  const fallbackIdMatch = codeStr.match(/['"`](bb-[a-z0-9-]+)['"`]/i);
  const suggested_id = suggestedIdRaw || fallbackIdMatch?.[1] || undefined;
  return {
    kind,
    description: asString(o.description, ""),
    code: codeStr,
    endpoints_used: asStringArray(o.endpoints_used),
    uses_csrf: asBoolean(o.uses_csrf, false),
    uses_cookies: asBoolean(o.uses_cookies, true),
    mutates_data: asBoolean(o.mutates_data, false),
    ui_changes: asString(o.ui_changes, "none"),
    answer: typeof o.answer === "string" ? (o.answer as string) : undefined,
    suggested_id,
    suggested_name: suggestedNameRaw || undefined,
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
