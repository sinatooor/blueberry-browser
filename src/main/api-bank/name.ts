// Tiny LLM helper that turns a captured endpoint into a short, human-readable
// label like "Monthly revenue" or "Billing events". The result is persisted on
// the EndpointSpec so the API menu / Bank can show a friendly name next to the
// raw "GET /api/v1/billing-events" path.
//
// Naming runs in the background, debounced per endpoint, and never blocks the
// capture path. The first time the LLM call fails (no key, network blip), we
// just leave `name` undefined and try again next capture.

import { generateText, type LanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { renderSchema } from "../cdp/schema";
import type { EndpointSpec, SchemaNode } from "../../common/types";

const inFlight = new Map<string, Promise<string | null>>();

function pickModel(): LanguageModel {
  if (process.env.LLM_PROVIDER?.toLowerCase() === "anthropic") {
    // Use Haiku for naming — short, fast, cheap. Falls back to whatever the
    // user configured for the build flow if the env var is set.
    return anthropic(process.env.LLM_NAME_MODEL || "claude-haiku-4-5-20251001");
  }
  return openai(process.env.LLM_NAME_MODEL || "gpt-4o-mini");
}

function describeForPrompt(spec: EndpointSpec): string {
  const lines: string[] = [];
  lines.push(`${spec.method} ${spec.pathname}`);
  if (spec.queryKeys.length > 0) {
    lines.push(`query params: ${spec.queryKeys.join(", ")}`);
  }
  if (spec.responseSchema) {
    lines.push(`response shape:\n${renderSchema(spec.responseSchema)}`);
  } else if (spec.requestBodySchema) {
    lines.push(
      `request body shape:\n${renderSchema(spec.requestBodySchema)}`,
    );
  }
  // Cap to keep the prompt small — the model only needs the gist.
  return lines.join("\n").slice(0, 1500);
}

// Returns a 1-3 word title-case label or null if naming failed.
export async function generateApiName(
  spec: EndpointSpec,
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return null;
  }
  const description = describeForPrompt(spec);
  const system = `You label API endpoints with a short, human-readable name describing the data they return.

Rules:
- 1 to 3 words.
- Title Case.
- No quotes, no punctuation, no trailing period.
- Describe the DATA, not the URL. "Monthly Revenue" beats "Revenue Get".
- For mutating endpoints (POST/PUT/PATCH/DELETE), describe the action: "Send Message", "Update Profile".
- If the shape is unclear, use the resource word from the path.

Reply with ONLY the label. No prose.`;
  try {
    const { text } = await generateText({
      model: pickModel(),
      system,
      prompt: description,
      temperature: 0.2,
      maxRetries: 1,
    });
    const cleaned = (text ?? "")
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/[.!?]+$/g, "")
      .replace(/\s+/g, " ");
    if (!cleaned) return null;
    // Defensive cap — the prompt asks for 1-3 words but models occasionally
    // narrate. Trim to first 4 words, max 40 chars.
    const words = cleaned.split(" ").slice(0, 4).join(" ");
    return words.slice(0, 40);
  } catch {
    return null;
  }
}

// Background-friendly: returns a single in-flight Promise per key so callers
// can't trigger a thundering herd if the same endpoint shows up many times.
export function nameApiBackground(
  spec: EndpointSpec,
): Promise<string | null> {
  const cached = inFlight.get(spec.key);
  if (cached) return cached;
  const p = generateApiName(spec).finally(() => inFlight.delete(spec.key));
  inFlight.set(spec.key, p);
  return p;
}

// Lightweight derived signal so we don't fire the LLM for endpoints whose
// shape we haven't actually captured yet — naming "GET /api/v1/foo" with no
// response shape produces useless guesses.
export function hasEnoughShape(spec: EndpointSpec): boolean {
  return !!(spec.responseSchema || spec.requestBodySchema);
}

// Recursively count fields in a schema — used as a quick proxy for "is the
// shape rich enough to name well?".
export function schemaSize(node: SchemaNode | null): number {
  if (!node) return 0;
  if (node.type === "object") {
    return (
      Object.keys(node.fields).length +
      Object.values(node.fields).reduce((n, c) => n + schemaSize(c), 0)
    );
  }
  if (node.type === "array") return 1 + schemaSize(node.item);
  return 1;
}
