// Shared types used across main + preload + renderer.
// Keep this file dependency-free so it can be imported anywhere.

export type RiskLevel = "safe" | "caution" | "destructive";

export type StepStatus =
  | "planning"
  | "awaiting-approval"
  | "running"
  | "done"
  | "failed"
  | "skipped";

export type AgentAction =
  | { type: "click"; selector: string }
  | { type: "type"; selector: string; text: string }
  | { type: "scroll"; direction: "up" | "down"; px: number }
  | { type: "navigate"; url: string }
  | { type: "wait"; forSelector?: string; ms?: number }
  | { type: "extract"; selector?: string; into: string; source?: "dom" | "network"; networkUrl?: string }
  | { type: "runCode"; language: "python"; source: string; saveAs?: string }
  | { type: "http"; method: "GET"; url: string; headers?: Record<string, string> }
  | { type: "writeFile"; path: string; content: string }
  | { type: "saveMemory"; updates: MemoryUpdate[] }
  | { type: "finish"; summary: string };

export type AgentStep = {
  id: string;
  runId: string;
  index: number;
  goal: string;
  rationale: string;
  action: AgentAction;
  status: StepStatus;
  startedAt: number;
  endedAt?: number;
  screenshotBefore?: string; // sandbox-relative path
  screenshotAfter?: string;
  domTarget?: { selector: string; bbox?: [number, number, number, number] };
  riskLevel: RiskLevel;
  result?: { ok: boolean; summary?: string; error?: string; output?: string };
  confidence?: number; // 1..5
};

export type AgentRunStatus =
  | "idle"
  | "planning"
  | "running"
  | "paused"
  | "awaiting-approval"
  | "done"
  | "failed"
  | "cancelled";

export type AgentRun = {
  id: string;
  projectId: string;
  prompt: string;
  status: AgentRunStatus;
  startedAt: number;
  endedAt?: number;
  summary?: string;
};

export type Project = {
  id: string;
  slug: string;
  name: string;
  createdAt: number;
  archivedAt?: number;
};

export type SandboxFile = {
  id: string;
  projectId: string;
  path: string; // sandbox-relative path under <project>/files/
  source: "download" | "agent" | "code" | "manual";
  url?: string;
  title?: string;
  mime?: string;
  bytes: number;
  createdAt: number;
};

export type NetRequest = {
  id: string;
  tabId: string;
  projectId?: string;
  method: string;
  url: string;
  status?: number;
  resourceType?: string;
  reqHeaders?: Record<string, string>;
  reqBody?: string;
  resHeaders?: Record<string, string>;
  resBody?: string;
  resBodyTruncated?: boolean;
  ts: number;
};

export type SiteMemory = {
  domain: string;
  procedures: { name: string; steps: string[]; lastVerified: number }[];
  selectors: { intent: string; selector: string; lastSeenAt: number; stale?: boolean }[];
  glossary: { term: string; definition: string }[];
  preferences: Record<string, unknown>;
  updatedAt: number;
};

export type MemoryUpdate =
  | { kind: "procedure"; name: string; steps: string[] }
  | { kind: "selector"; intent: string; selector: string }
  | { kind: "glossary"; term: string; definition: string }
  | { kind: "preference"; key: string; value: unknown };

export type CodeOutputChunk =
  | { kind: "stdout"; text: string }
  | { kind: "stderr"; text: string }
  | { kind: "image"; path: string; mime: string }
  | { kind: "result"; value: string }
  | { kind: "done"; ok: boolean; error?: string; durationMs: number };

export type CodeRunResult = {
  ok: boolean;
  error?: string;
  outputs: CodeOutputChunk[];
  durationMs: number;
};
