import { generateText, type ModelMessage } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { nanoid } from "nanoid";
import path from "node:path";
import fs from "node:fs";
import { parse as parseTld } from "tldts";
import type { WebContents } from "electron";
import {
  buildTools,
  toolCallToAction,
  type ToolName,
} from "./tools";
import { classifyAction } from "./risk";
import {
  click,
  type as typeAction,
  scroll,
  navigate,
  waitForSelector,
  screenshot,
  extractText as extractDomText,
} from "../cdp/actions";
import { highlight } from "../cdp/overlay";
import { networkCapture } from "../cdp/network";
import { runPython } from "../code/pyodide-host";
import {
  addFile,
  createRun,
  persistStep,
  updateRun,
  getSiteMemory,
} from "../projects/store";
import {
  projectFilesDir,
  projectScreenshotsDir,
  resolveInProject,
} from "../projects/sandbox";
import { addProposedMemory } from "../memory/service";
import { Channels } from "../../common/channels";
import type {
  AgentAction,
  AgentRun,
  AgentStep,
  AgentRunStatus,
  MemoryUpdate,
} from "../../common/types";

type StartReq = {
  prompt: string;
  projectId: string;
  tabId: string;
};

type RunHandle = {
  run: AgentRun;
  abort: AbortController;
  // Pending approval, if any.
  pendingApproval?: {
    stepId: string;
    resolve: (verdict: "approve" | "reject" | "edit") => void;
    editedAction?: AgentAction;
  };
  paused: boolean;
};

const STEPS_HARD_CAP = 20;
const WALL_CLOCK_MS = 120_000;

export class AgentRuntime {
  private runs = new Map<string, RunHandle>();
  private getActiveTabContents:
    | ((tabId: string) => WebContents | null)
    | null = null;
  private emit: ((channel: string, payload: unknown) => void) | null = null;

  bind(opts: {
    getActiveTabContents: (tabId: string) => WebContents | null;
    emit: (channel: string, payload: unknown) => void;
  }): void {
    this.getActiveTabContents = opts.getActiveTabContents;
    this.emit = opts.emit;
  }

  private send(channel: string, payload: unknown): void {
    this.emit?.(channel, payload);
  }

  private getModel() {
    if (process.env.LLM_PROVIDER?.toLowerCase() === "anthropic") {
      return anthropic(
        process.env.LLM_MODEL || "claude-sonnet-4-5-20250929",
      );
    }
    return openai(process.env.LLM_MODEL || "gpt-4o-mini");
  }

  private async resolveCurrentDomain(wc: WebContents | null): Promise<string | undefined> {
    if (!wc) return undefined;
    try {
      const url = wc.getURL();
      const parsed = parseTld(url);
      return parsed.domain ?? parsed.hostname ?? undefined;
    } catch {
      return undefined;
    }
  }

  async startRun(req: StartReq): Promise<{ runId: string }> {
    if (!this.getActiveTabContents || !this.emit) {
      throw new Error("AgentRuntime not bound");
    }
    const wc = this.getActiveTabContents(req.tabId);
    if (!wc) throw new Error(`Tab ${req.tabId} not found`);

    const runId = `run_${nanoid(10)}`;
    const run: AgentRun = {
      id: runId,
      projectId: req.projectId,
      prompt: req.prompt,
      status: "planning",
      startedAt: Date.now(),
    };
    createRun(run);

    const handle: RunHandle = {
      run,
      abort: new AbortController(),
      paused: false,
    };
    this.runs.set(runId, handle);
    this.send(Channels.EventAgentRun, run);

    // Run async; don't block the IPC reply.
    void this.executeRun(handle, req, wc).catch((err) => {
      console.error("[agent] run crashed:", err);
      this.finalizeRun(handle, "failed", `Crashed: ${(err as Error).message}`);
    });

    return { runId };
  }

  cancel(runId: string): void {
    const h = this.runs.get(runId);
    if (!h) return;
    h.abort.abort();
    h.pendingApproval?.resolve("reject");
    this.finalizeRun(h, "cancelled");
  }

  pause(runId: string): void {
    const h = this.runs.get(runId);
    if (h) h.paused = true;
  }

  resume(runId: string): void {
    const h = this.runs.get(runId);
    if (h) h.paused = false;
  }

  approveStep(runId: string, stepId: string, verdict: "approve" | "reject"): void {
    const h = this.runs.get(runId);
    if (!h?.pendingApproval || h.pendingApproval.stepId !== stepId) return;
    h.pendingApproval.resolve(verdict);
  }

  private finalizeRun(h: RunHandle, status: AgentRunStatus, summary?: string): void {
    if (h.run.status === status) return;
    h.run.status = status;
    h.run.endedAt = Date.now();
    h.run.summary = summary ?? h.run.summary;
    updateRun(h.run.id, { status, endedAt: h.run.endedAt, summary: h.run.summary });
    this.send(Channels.EventAgentRun, h.run);
    this.runs.delete(h.run.id);
  }

  private async writeStep(step: AgentStep): Promise<void> {
    persistStep(step);
    this.send(Channels.EventAgentStep, step);
  }

  private async waitForApproval(
    h: RunHandle,
    step: AgentStep,
  ): Promise<"approve" | "reject"> {
    return new Promise<"approve" | "reject">((resolve) => {
      step.status = "awaiting-approval";
      this.writeStep(step);
      h.pendingApproval = {
        stepId: step.id,
        resolve: (v) => {
          h.pendingApproval = undefined;
          resolve(v === "edit" ? "approve" : v);
        },
      };
    });
  }

  private async maybeWaitWhilePaused(h: RunHandle): Promise<void> {
    while (h.paused && !h.abort.signal.aborted) {
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  private async executeAction(
    h: RunHandle,
    wc: WebContents,
    step: AgentStep,
    action: AgentAction,
    projectId: string,
    tabId: string,
  ): Promise<{ ok: boolean; summary?: string; error?: string; output?: string; finished?: boolean }> {
    switch (action.type) {
      case "click": {
        await highlight(wc, action.selector, 350);
        const r = await click(wc, action.selector);
        if (!r.ok) return { ok: false, error: r.error };
        step.domTarget = { selector: action.selector, bbox: r.bbox };
        return { ok: true, summary: `Clicked ${action.selector}` };
      }
      case "type": {
        await highlight(wc, action.selector, 250);
        const r = await typeAction(wc, action.selector, action.text);
        if (!r.ok) return { ok: false, error: r.error };
        return { ok: true, summary: `Typed into ${action.selector}` };
      }
      case "scroll": {
        const r = await scroll(wc, action.direction, action.px);
        return r.ok ? { ok: true, summary: `Scrolled ${action.direction} ${action.px}px` } : { ok: false, error: r.error };
      }
      case "navigate": {
        const r = await navigate(wc, action.url);
        return r.ok ? { ok: true, summary: `Loaded ${action.url}` } : { ok: false, error: r.error };
      }
      case "wait": {
        if (action.forSelector) {
          const r = await waitForSelector(wc, action.forSelector, action.ms ?? 8000);
          return r.ok ? { ok: true, summary: `Found ${action.forSelector}` } : { ok: false, error: r.error };
        }
        await new Promise((r) => setTimeout(r, action.ms ?? 500));
        return { ok: true, summary: `Waited ${action.ms ?? 500}ms` };
      }
      case "extract": {
        if (action.source === "network" && action.networkUrl) {
          const requests = networkCapture.list({ tabId });
          const match = requests.find(
            (r) => r.url.includes(action.networkUrl!) && r.resBody,
          );
          if (!match) {
            return { ok: false, error: `No captured network response matching '${action.networkUrl}'` };
          }
          const abs = path.join(projectFilesDir(projectId), action.into);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, match.resBody!, "utf8");
          const stat = fs.statSync(abs);
          addFile({
            projectId,
            path: action.into,
            source: "agent",
            url: match.url,
            mime: match.resHeaders?.["content-type"] ?? "application/json",
            bytes: stat.size,
          });
          this.send(Channels.EventFileAdded, { projectId, path: action.into });
          return {
            ok: true,
            summary: `Saved ${match.url} → files/${action.into} (${stat.size}B)`,
            output: match.resBody!.slice(0, 500),
          };
        }
        if (action.selector) {
          const r = await extractDomText(wc, action.selector);
          if (!r.ok) return { ok: false, error: r.error };
          const abs = path.join(projectFilesDir(projectId), action.into);
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, r.text, "utf8");
          addFile({
            projectId,
            path: action.into,
            source: "agent",
            mime: "text/plain",
            bytes: Buffer.byteLength(r.text),
          });
          this.send(Channels.EventFileAdded, { projectId, path: action.into });
          return {
            ok: true,
            summary: `Extracted text → files/${action.into}`,
            output: r.text.slice(0, 500),
          };
        }
        return { ok: false, error: "extract requires selector or networkUrl" };
      }
      case "writeFile": {
        const abs = resolveInProject(projectId, path.join("files", action.path));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, action.content, "utf8");
        addFile({
          projectId,
          path: action.path,
          source: "agent",
          mime: action.path.endsWith(".md") ? "text/markdown" : "text/plain",
          bytes: Buffer.byteLength(action.content),
        });
        this.send(Channels.EventFileAdded, { projectId, path: action.path });
        return { ok: true, summary: `Wrote files/${action.path}` };
      }
      case "runCode": {
        const result = await runPython(action.source, projectId, (chunk) => {
          this.send(Channels.EventCodeOutput, { runId: h.run.id, stepId: step.id, chunk });
        });
        if (action.saveAs) {
          const abs = resolveInProject(projectId, path.join("outputs", action.saveAs));
          fs.mkdirSync(path.dirname(abs), { recursive: true });
          fs.writeFileSync(abs, action.source, "utf8");
        }
        const textOut = result.outputs
          .filter((o) => o.kind === "stdout" || o.kind === "result")
          .map((o) => (o as any).text ?? (o as any).value)
          .join("\n");
        return {
          ok: result.ok,
          error: result.error,
          summary: result.ok ? "Python run succeeded" : `Python run failed: ${result.error}`,
          output: textOut.slice(0, 1500),
        };
      }
      case "saveMemory": {
        const domain = await this.resolveCurrentDomain(wc);
        if (!domain) return { ok: false, error: "Could not resolve current domain" };
        // Surface as a proposal — user must accept.
        addProposedMemory(domain, action.updates as MemoryUpdate[]);
        this.send(Channels.EventMemoryProposed, { domain, updates: action.updates });
        return { ok: true, summary: `Proposed ${action.updates.length} memory updates for ${domain}` };
      }
      case "finish": {
        return { ok: true, summary: action.summary, finished: true };
      }
      case "http": {
        return { ok: false, error: "http action not enabled in MVP" };
      }
    }
  }

  private async executeRun(
    h: RunHandle,
    req: StartReq,
    wc: WebContents,
  ): Promise<void> {
    const tools = buildTools();
    const startedAt = Date.now();
    let stepIndex = 0;
    let finishedSummary: string | undefined;

    const url = wc.getURL();
    const domain = await this.resolveCurrentDomain(wc);
    const memory = domain ? getSiteMemory(domain) : null;

    const memoryBlock = memory
      ? [
          `\n# Site memory for ${memory.domain}`,
          memory.procedures.length > 0
            ? `Procedures:\n${memory.procedures.map((p) => `- ${p.name}: ${p.steps.join(" → ")}`).join("\n")}`
            : "",
          memory.selectors.filter((s) => !s.stale).length > 0
            ? `Known selectors:\n${memory.selectors.filter((s) => !s.stale).map((s) => `- ${s.intent}: ${s.selector}`).join("\n")}`
            : "",
          memory.glossary.length > 0
            ? `Glossary:\n${memory.glossary.map((g) => `- ${g.term}: ${g.definition}`).join("\n")}`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";

    const system = `You are an in-browser agent operating the user's browser through a small set of tools.

Active URL: ${url}
${memoryBlock}

Operating rules:
- Take ONE action per step. After each tool call you'll see the result.
- Prefer extractFromNetwork over scraping the DOM — modern dashboards return JSON via XHR/fetch and we capture them all.
- Save derived data and reports as files in the project sandbox; the user can use them in the Code panel.
- For analysis, generate concise Python (pandas/matplotlib) — plots are auto-captured.
- Always end with the 'finish' tool, including a 1-2 sentence user-facing summary.
- Never invent selectors. If you're unsure, use extractText on a broad selector (e.g. 'main', 'body') first, or extractFromNetwork on the most recent matching URL.

Style:
- Each rationale is ≤ 20 words and explains what THIS step does. The user reads it. No "I will…" filler.
- Be terse and confident. The UI shows the user every step in real time.`;

    const messages: ModelMessage[] = [
      { role: "user", content: req.prompt },
    ];

    h.run.status = "running";
    this.send(Channels.EventAgentRun, h.run);

    // Manual loop: ONE tool call per turn so we can sandwich each in
    // before/after screenshots, approval gates, and UI events.
    while (
      !h.abort.signal.aborted &&
      stepIndex < STEPS_HARD_CAP &&
      Date.now() - startedAt < WALL_CLOCK_MS &&
      !finishedSummary
    ) {
      await this.maybeWaitWhilePaused(h);
      if (h.abort.signal.aborted) break;

      const beforeShot = await screenshot(
        wc,
        projectScreenshotsDir(req.projectId),
        `step_${String(stepIndex).padStart(3, "0")}_before`,
      );

      const stepId = `step_${nanoid(8)}`;
      const baseStep: AgentStep = {
        id: stepId,
        runId: h.run.id,
        index: stepIndex,
        goal: "Planning…",
        rationale: "",
        action: { type: "wait", ms: 0 },
        status: "planning",
        startedAt: Date.now(),
        screenshotBefore: beforeShot.ok ? beforeShot.path : undefined,
        riskLevel: "safe",
      };
      this.writeStep(baseStep);

      let toolName: ToolName | null = null;
      let toolArgs: any = null;

      try {
        const turn = await generateText({
          model: this.getModel(),
          system,
          messages,
          tools,
          toolChoice: "required",
          abortSignal: h.abort.signal,
        });
        const tc = turn.toolCalls?.[0];
        if (!tc) {
          finishedSummary = turn.text || "Agent stopped without a tool call.";
          baseStep.status = "done";
          baseStep.endedAt = Date.now();
          baseStep.action = { type: "finish", summary: finishedSummary };
          baseStep.goal = "Finish";
          baseStep.rationale = finishedSummary.slice(0, 160);
          this.writeStep(baseStep);
          break;
        }
        toolName = tc.toolName as ToolName;
        toolArgs = tc.input;
      } catch (err) {
        baseStep.status = "failed";
        baseStep.endedAt = Date.now();
        baseStep.result = { ok: false, error: (err as Error).message };
        this.writeStep(baseStep);
        h.run.summary = `Failed: ${(err as Error).message}`;
        break;
      }

      const action = toolCallToAction(toolName!, toolArgs);
      const risk = classifyAction(action, { currentDomain: domain });

      baseStep.goal = String(toolArgs?.goal ?? toolName);
      baseStep.rationale = String(toolArgs?.rationale ?? "");
      baseStep.action = action;
      baseStep.riskLevel = risk.level;

      // Approval gate
      if (risk.level === "destructive") {
        const verdict = await this.waitForApproval(h, baseStep);
        if (verdict === "reject") {
          baseStep.status = "skipped";
          baseStep.endedAt = Date.now();
          baseStep.result = { ok: false, error: "User rejected" };
          this.writeStep(baseStep);
          messages.push({
            role: "user",
            content: `Step ${stepIndex} rejected by user. Pick a safer alternative.`,
          });
          stepIndex++;
          continue;
        }
      }

      // Execute
      baseStep.status = "running";
      this.writeStep(baseStep);

      let result;
      try {
        result = await this.executeAction(h, wc, baseStep, action, req.projectId, req.tabId);
      } catch (err) {
        result = { ok: false, error: (err as Error).message };
      }

      const afterShot = await screenshot(
        wc,
        projectScreenshotsDir(req.projectId),
        `step_${String(stepIndex).padStart(3, "0")}_after`,
      );
      baseStep.screenshotAfter = afterShot.ok ? afterShot.path : undefined;
      baseStep.endedAt = Date.now();
      baseStep.result = {
        ok: result.ok,
        summary: result.summary,
        error: result.error,
        output: result.output,
      };
      baseStep.status = result.ok ? "done" : "failed";
      this.writeStep(baseStep);

      // Feed result back to the model as a tool message so it can plan the next step.
      messages.push({
        role: "assistant",
        content: [{ type: "tool-call", toolCallId: stepId, toolName: toolName!, input: toolArgs }],
      });
      messages.push({
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: stepId,
            toolName: toolName!,
            output: {
              type: "json",
              value: {
                ok: result.ok,
                summary: result.summary,
                error: result.error,
                output: result.output?.slice(0, 1500),
              },
            },
          },
        ],
      });

      if ("finished" in result && result.finished) {
        finishedSummary = result.summary || "Done.";
        break;
      }

      stepIndex++;
    }

    if (h.abort.signal.aborted) {
      this.finalizeRun(h, "cancelled", "Cancelled by user");
      return;
    }
    if (Date.now() - startedAt >= WALL_CLOCK_MS) {
      this.finalizeRun(h, "failed", "Wall-clock cap reached");
      return;
    }
    if (stepIndex >= STEPS_HARD_CAP && !finishedSummary) {
      this.finalizeRun(h, "failed", "Step cap reached");
      return;
    }
    this.finalizeRun(h, "done", finishedSummary ?? "Run complete");
  }
}

export const agentRuntime = new AgentRuntime();
