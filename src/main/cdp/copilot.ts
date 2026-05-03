import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import path from "node:path";
import fs from "node:fs";
import { networkCapture } from "./network";
import { runPython } from "../code/pyodide-host";
import { addFile } from "../projects/store";
import { projectFilesDir } from "../projects/sandbox";
import { Channels } from "../../common/channels";
import type { NetRequest } from "../../common/types";

function model() {
  if (process.env.LLM_PROVIDER?.toLowerCase() === "anthropic") {
    return anthropic(process.env.LLM_MODEL || "claude-sonnet-4-5-20250929");
  }
  return openai(process.env.LLM_MODEL || "gpt-4o-mini");
}

function describeRequest(req: NetRequest): string {
  const sample = req.resBody ? req.resBody.slice(0, 4000) : "(no body captured)";
  return [
    `${req.method} ${req.url}`,
    `Status: ${req.status ?? "?"}`,
    `Request headers: ${JSON.stringify(req.reqHeaders ?? {}, null, 2)}`,
    req.reqBody ? `Request body:\n${req.reqBody.slice(0, 2000)}` : "",
    `Response headers: ${JSON.stringify(req.resHeaders ?? {}, null, 2)}`,
    `Response body (truncated):\n${sample}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function explainRequest(req: NetRequest): Promise<string> {
  const { text } = await generateText({
    model: model(),
    system:
      "You explain HTTP requests captured from a user's browser. Be terse. Output ≤ 8 lines of plain markdown. Cover: what the endpoint does, the response shape, and one notable field.",
    prompt: describeRequest(req),
  });
  return text;
}

export async function generateSnippet(
  req: NetRequest,
  language: "curl" | "python" | "typescript",
): Promise<string> {
  const { text } = await generateText({
    model: model(),
    system: `You generate copy-pasteable HTTP request snippets. Output ONLY the code, no markdown fences, no commentary.
- For curl: single command, sensible flags, line-continuation.
- For python: use the requests library.
- For typescript: use the global fetch API.
Auth headers MUST be replaced with <YOUR_TOKEN> placeholders.`,
    prompt: `Language: ${language}\n\n${describeRequest(req)}`,
  });
  return text.trim();
}

const NET_TO_CSV_PROMPT = `You generate ONE Python snippet that:
1. Reads the JSON in the variable \`raw\` (already a Python str).
2. Parses it with json.loads.
3. Flattens any obvious top-level list of records into a pandas DataFrame.
4. Saves the DataFrame to /project/files/<filename> as CSV via to_csv(index=False).
5. Prints the first 3 rows.

Output ONLY Python code. No markdown fences. The variable \`raw\` is pre-defined; the variable \`out_path\` (string) is pre-defined too — write to that path.`;

export async function extractToCsv(
  req: NetRequest,
  projectId: string,
  filename: string,
  emit: (channel: string, payload: unknown) => void,
): Promise<{ ok: boolean; error?: string }> {
  if (!req.resBody) return { ok: false, error: "Response body is empty" };
  const { text: codeOnly } = await generateText({
    model: model(),
    system: NET_TO_CSV_PROMPT,
    prompt: `URL: ${req.url}\nResponse sample:\n${req.resBody.slice(0, 3000)}`,
  });

  const safeName = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  const setup = `
raw = ${JSON.stringify(req.resBody)}
out_path = "/project/files/${safeName.replace(/"/g, '\\"')}"
`;

  const result = await runPython(setup + "\n" + codeOnly, projectId, (chunk) =>
    emit(Channels.EventCodeOutput, { runId: "net-extract", chunk }),
  );

  if (!result.ok) return { ok: false, error: result.error };

  // Pyodide wrote it inside the FS, but the project files dir is on disk.
  // We need to read the file out via a follow-up Python that base64-encodes it.
  const dump = await runPython(
    `import base64
with open("/project/files/${safeName.replace(/"/g, '\\"')}", "rb") as f:
    print(base64.b64encode(f.read()).decode("ascii"))
`,
    projectId,
  );
  const b64 = dump.outputs
    .filter((o) => o.kind === "stdout")
    .map((o) => (o as any).text)
    .join("")
    .trim();
  if (!b64) return { ok: false, error: "Generated CSV not found in sandbox" };

  const abs = path.join(projectFilesDir(projectId), safeName);
  fs.writeFileSync(abs, Buffer.from(b64, "base64"));
  const stat = fs.statSync(abs);
  addFile({
    projectId,
    path: safeName,
    source: "code",
    url: req.url,
    mime: "text/csv",
    bytes: stat.size,
  });
  emit(Channels.EventFileAdded, { projectId, path: safeName });
  return { ok: true };
}

export async function replayGet(req: NetRequest): Promise<{
  ok: boolean;
  status?: number;
  body?: string;
  error?: string;
}> {
  if (req.method !== "GET") {
    return { ok: false, error: "Only GET replay is enabled in this build." };
  }
  try {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.reqHeaders ?? {})) {
      if (v !== "<redacted>") headers[k] = String(v);
    }
    const resp = await fetch(req.url, { method: "GET", headers });
    const body = await resp.text();
    return { ok: true, status: resp.status, body: body.slice(0, 200_000) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// Quick lookup for the Network Copilot
export function findRecentNetwork(urlSubstring: string): NetRequest | null {
  return networkCapture.list().find((r) => r.url.includes(urlSubstring)) ?? null;
}
