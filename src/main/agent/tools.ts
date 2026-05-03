import { tool } from "ai";
import { z } from "zod";
import type { AgentAction } from "../../common/types";

// The agent's "tool palette". Each tool's description is written for the model:
// concrete, terse, no jargon. The actual execution runs in `runtime.ts`,
// which intercepts tool calls so it can emit AgentStep events with screenshots.

export type ToolName =
  | "click"
  | "typeText"
  | "scroll"
  | "navigate"
  | "wait"
  | "extractText"
  | "extractFromNetwork"
  | "writeFile"
  | "runCode"
  | "saveMemory"
  | "finish";

const goal = z.string().describe("One short sentence: what this single step accomplishes.");
const rationale = z
  .string()
  .max(200)
  .describe("≤ 20 words. Why this step. Visible to the user — write it like you're narrating.");

export function buildTools() {
  return {
    click: tool({
      description:
        "Click an element on the current page. Use a precise CSS selector (prefer ids, data-* attrs, role).",
      inputSchema: z.object({
        goal,
        rationale,
        selector: z.string().describe("CSS selector for the element to click"),
      }),
    }),
    typeText: tool({
      description:
        "Focus a text input or textarea and type. Use after click() if you need to ensure focus.",
      inputSchema: z.object({
        goal,
        rationale,
        selector: z.string(),
        text: z.string(),
      }),
    }),
    scroll: tool({
      description: "Scroll the page up or down by a pixel amount.",
      inputSchema: z.object({
        goal,
        rationale,
        direction: z.enum(["up", "down"]),
        px: z.number().int().min(50).max(5000),
      }),
    }),
    navigate: tool({
      description: "Load a URL in the active tab. Use sparingly.",
      inputSchema: z.object({
        goal,
        rationale,
        url: z.string().url(),
      }),
    }),
    wait: tool({
      description: "Wait for a selector to appear, or for a fixed time (ms).",
      inputSchema: z.object({
        goal,
        rationale,
        forSelector: z.string().optional(),
        ms: z.number().int().min(50).max(15000).optional(),
      }),
    }),
    extractText: tool({
      description:
        "Read visible text from an element. Returns the text. Use to confirm state or pick up small bits of data.",
      inputSchema: z.object({
        goal,
        rationale,
        selector: z.string(),
        into: z.string().describe("Sandbox file (relative path under files/) to save text to. e.g. 'extracted.txt'"),
      }),
    }),
    extractFromNetwork: tool({
      description:
        "Extract data from a network request that the page already made. Provide a URL substring; the most recent matching response body is saved to the project sandbox. Modern dashboards expose JSON APIs — this is far cheaper than DOM scraping.",
      inputSchema: z.object({
        goal,
        rationale,
        urlSubstring: z.string().describe("Substring to match against captured request URLs"),
        into: z.string().describe("Sandbox file path under files/, e.g. 'revenue.json'"),
      }),
    }),
    writeFile: tool({
      description:
        "Write a text file into the project sandbox (under files/). Use for reports, summaries, derived data.",
      inputSchema: z.object({
        goal,
        rationale,
        path: z.string().describe("Relative path under files/, e.g. 'report.md'"),
        content: z.string(),
      }),
    }),
    runCode: tool({
      description:
        "Run Python in the in-browser interpreter against project files. /project/files/ is mounted. " +
        "matplotlib plots are auto-saved as PNGs. Use for analysis, transformation, charts.",
      inputSchema: z.object({
        goal,
        rationale,
        source: z.string().describe("Python source"),
        saveAs: z
          .string()
          .optional()
          .describe("If set, save the source as a script under outputs/<saveAs>"),
      }),
    }),
    saveMemory: tool({
      description:
        "Propose 0..N updates to per-site memory after a successful run. Procedures = how to do something; selectors = stable element references; glossary = domain vocabulary; preferences = toggles.",
      inputSchema: z.object({
        goal,
        rationale,
        updates: z
          .array(
            z.union([
              z.object({
                kind: z.literal("procedure"),
                name: z.string(),
                steps: z.array(z.string()),
              }),
              z.object({
                kind: z.literal("selector"),
                intent: z.string(),
                selector: z.string(),
              }),
              z.object({
                kind: z.literal("glossary"),
                term: z.string(),
                definition: z.string(),
              }),
              z.object({
                kind: z.literal("preference"),
                key: z.string(),
                value: z.unknown(),
              }),
            ]),
          )
          .min(0)
          .max(8),
      }),
    }),
    finish: tool({
      description:
        "End the run. Provide a 1-2 sentence summary the user will see. Always emit this when the task is complete.",
      inputSchema: z.object({
        goal,
        rationale,
        summary: z.string(),
      }),
    }),
  };
}

// Map a tool call into our AgentAction discriminated union.
export function toolCallToAction(name: ToolName, args: any): AgentAction {
  switch (name) {
    case "click":
      return { type: "click", selector: args.selector };
    case "typeText":
      return { type: "type", selector: args.selector, text: args.text };
    case "scroll":
      return { type: "scroll", direction: args.direction, px: args.px };
    case "navigate":
      return { type: "navigate", url: args.url };
    case "wait":
      return { type: "wait", forSelector: args.forSelector, ms: args.ms };
    case "extractText":
      return { type: "extract", source: "dom", selector: args.selector, into: args.into };
    case "extractFromNetwork":
      return { type: "extract", source: "network", networkUrl: args.urlSubstring, into: args.into };
    case "writeFile":
      return { type: "writeFile", path: args.path, content: args.content };
    case "runCode":
      return { type: "runCode", language: "python", source: args.source, saveAs: args.saveAs };
    case "saveMemory":
      return { type: "saveMemory", updates: args.updates };
    case "finish":
      return { type: "finish", summary: args.summary };
  }
}
