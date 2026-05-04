import { generateText, type ModelMessage } from "ai";
import { inspectPage as cdpInspectPage, checkOverlay, summarizeSurvey } from "../cdp/inspect";
import { applyUpdates as applyMemoryUpdates } from "../memory/service";
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
  evalJs,
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

const STEPS_HARD_CAP = 30;
const WALL_CLOCK_MS = 180_000;

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
      // Bare alias is the current Anthropic convention for 4.6+ — do not
      // append a date suffix.
      return anthropic(process.env.LLM_MODEL || "claude-sonnet-4-6");
    }
    return openai(process.env.LLM_MODEL || "gpt-4o-mini");
  }

  // Vision-based verification that an evalJs change rendered as the user wanted.
  // Uses the same provider the agent uses; the multimodal models we default to
  // (gpt-4o-mini, claude-sonnet-4-6) both accept images natively.
  private async runVisualVerify(
    intent: string,
    selector: string | undefined,
    screenshotPath: string,
  ): Promise<{ severity: "ok" | "minor" | "major" | "broken"; issues: string[]; advice: string }> {
    let buf: Buffer;
    try {
      buf = fs.readFileSync(screenshotPath);
    } catch (e) {
      return {
        severity: "broken",
        issues: [`Could not read screenshot: ${(e as Error).message}`],
        advice: "Re-run the action and try again.",
      };
    }

    const sys = `You are a UI QA reviewer. Inspect the screenshot of a web page and judge whether the user's intent has been satisfied. Look for: missing element, element clipped or off-screen, element overlapping the site's existing chrome (header, nav, footer, sticky widgets) in a way that hides them, illegible color/contrast, broken layout. Reply with STRICT JSON only — no prose, no code fences:

{"severity": "ok" | "minor" | "major" | "broken", "issues": ["..."], "advice": "one short sentence on how to fix, or empty if ok"}

severity guide:
- "ok": looks correct, fits the page
- "minor": cosmetic issue (slight contrast, small clip)
- "major": noticeable overlap with existing UI or wrong placement
- "broken": element is missing, completely hidden, or page looks broken`;

    const userText =
      `Intent: ${intent}` +
      (selector ? `\nSelector under review: ${selector}` : "") +
      `\n\nReview the screenshot and reply with the JSON verdict.`;

    try {
      const turn = await generateText({
        model: this.getModel(),
        system: sys,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: userText },
              { type: "image", image: buf, mediaType: "image/png" },
            ],
          },
        ],
      });
      const text = turn.text?.trim() ?? "";
      // Be tolerant of accidental code fences.
      const jsonStart = text.indexOf("{");
      const jsonEnd = text.lastIndexOf("}");
      if (jsonStart === -1 || jsonEnd === -1) {
        return { severity: "minor", issues: ["Verifier returned non-JSON"], advice: text.slice(0, 120) };
      }
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as {
        severity?: "ok" | "minor" | "major" | "broken";
        issues?: string[];
        advice?: string;
      };
      return {
        severity: parsed.severity ?? "minor",
        issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 6) : [],
        advice: typeof parsed.advice === "string" ? parsed.advice.slice(0, 280) : "",
      };
    } catch (e) {
      return {
        severity: "minor",
        issues: [`Visual verifier call failed: ${(e as Error).message}`],
        advice: "Continue without visual verification.",
      };
    }
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
      case "inspectPage": {
        const r = await cdpInspectPage(wc);
        if (!r.ok) return { ok: false, error: r.error };
        const s = r.survey;
        const summary =
          `Surveyed ${s.theme.apparentTheme} site — ${s.viewport.width}×${s.viewport.height}, ` +
          `${s.fixedRegions.length} fixed region(s), maxZ=${s.maxZIndex}, ` +
          `${s.existingInjected.length} prior bb-* node(s)` +
          (s.settleTimedOut ? " ⚠️ DOM still mutating" : "");
        // Send the agent the dense plain-text digest, not the raw 3KB JSON,
        // so it survives the 1500-char message-history truncator.
        return {
          ok: true,
          summary,
          output: summarizeSurvey(s),
        };
      }
      case "verifyOverlay": {
        const r = await checkOverlay(wc, action.selector);
        if (!r.ok) return { ok: false, error: r.error };
        const c = r.check;
        if (!c.found) {
          return {
            ok: false,
            error: `Selector ${action.selector} not found — your evalJs likely didn't insert it (or used a different id/class).`,
          };
        }
        const conflicts = c.conflicts ?? [];
        const blocking = conflicts.filter((x) => !x.weAreOnTop);
        const summary = blocking.length
          ? `OVERLAP: ${action.selector} is behind ${blocking.length} fixed element(s) — fix z-index or move it`
          : conflicts.length
            ? `Placement OK (${conflicts.length} overlap on top, fine), bbox ${c.bbox?.width}×${c.bbox?.height}`
            : `Clean placement — no fixed-element collisions, bbox ${c.bbox?.width}×${c.bbox?.height}`;
        return {
          ok: true,
          summary,
          output: JSON.stringify(c),
        };
      }
      case "verifyVisually": {
        const shot = await screenshot(
          wc,
          projectScreenshotsDir(projectId),
          `verify_${String(step.index).padStart(3, "0")}`,
        );
        if (!shot.ok) return { ok: false, error: `Could not capture screenshot: ${shot.error}` };
        const verdict = await this.runVisualVerify(action.intent, action.selector, shot.path);
        const sev = verdict.severity ?? "ok";
        const summary =
          sev === "ok"
            ? `Visual check OK — "${action.intent.slice(0, 60)}"`
            : `Visual ${sev}: ${verdict.issues.slice(0, 2).join("; ").slice(0, 140)}`;
        return {
          ok: sev !== "broken",
          summary,
          output: JSON.stringify(verdict),
        };
      }
      case "evalJs": {
        const r = await evalJs(wc, action.source, action.awaitPromise ?? true);
        if (!r.ok) return { ok: false, error: r.error };
        let preview: string | undefined;
        if (r.value !== undefined) {
          try {
            preview = JSON.stringify(r.value).slice(0, 1500);
          } catch {
            preview = String(r.value).slice(0, 1500);
          }
        }
        return {
          ok: true,
          summary: `Ran JS in page (${action.source.length} chars)`,
          output: preview,
        };
      }
      case "saveAugmentation": {
        const domain = await this.resolveCurrentDomain(wc);
        if (!domain) return { ok: false, error: "Could not resolve current domain" };
        // Augmentations apply directly (no propose-toast flow): the user
        // already saw the change land in Mission Control + verifyOverlay/Visually.
        // The Memory panel surfaces them and lets the user delete/disable.
        applyMemoryUpdates(domain, [
          { kind: "augmentation", id: action.id, name: action.name, script: action.script },
        ]);
        this.send(Channels.EventToast, {
          kind: "info",
          title: "Augmentation saved",
          body: `"${action.name}" will auto-replay on every visit to ${domain}.`,
        });
        return {
          ok: true,
          summary: `Saved augmentation "${action.name}" (${action.id}) for ${domain}`,
        };
      }
      case "removeAugmentation": {
        const domain = await this.resolveCurrentDomain(wc);
        if (!domain) return { ok: false, error: "Could not resolve current domain" };
        applyMemoryUpdates(domain, [{ kind: "removeAugmentation", id: action.id }]);
        // Also strip from the live page so the user sees an immediate effect.
        const removeRes = await evalJs(
          wc,
          `const el = document.getElementById(${JSON.stringify(action.id)}); if (el) el.remove();`,
          true,
          2000,
        );
        const removed = removeRes.ok;
        return {
          ok: true,
          summary: removed
            ? `Removed augmentation #${action.id} (deleted from page + memory)`
            : `Removed augmentation #${action.id} from memory (not present on current page)`,
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

Page-augmentation cadence (when the user asks to add/restyle/move UI on the live page):
1. inspectPage FIRST. The survey is the ground truth — the user's previous answers may be stale. Use:
   - viewport.width/height — your placement must fit
   - theme.apparentTheme ('light' | 'dark' | 'mixed') — pick colors that match. If the site is dark, use a dark surface for your overlay; if light, use light. Never hardcode.
   - theme.backgroundColor / color / fontFamily — actually copy these into the styles you inject so it looks native.
   - fixedRegions[] — every bbox you must NOT cover. Pick an empty corner.
   - maxZIndex — set your z-index to (maxZIndex + 10), capped at 2147483640.
   - existingInjected[] — every prior bb-* element with its bbox. If you're adding a SECOND augmentation, lay it out NEXT TO these, not on top of them.
   - settleTimedOut — if true, the page is still rendering; wait 1-2s and inspectPage again.
2. evalJs to make the change. Hard rules:
   - Prefix EVERY id you create with 'bb-' (e.g. 'bb-theme-toggle', 'bb-translate-btn').
   - Idempotent: \`if (document.getElementById('bb-…')) return;\` early-out so re-runs and replays are safe.
   - Scope CSS: only style your bb-* ids. Never edit existing site rules.
   - Detect current state from the page (e.g. document.documentElement.classList) before assuming light/dark.
3. verifyOverlay with the selector you just created. If conflicts.length > 0 with weAreOnTop=false, fix the placement (don't add a second copy — re-run evalJs that re-positions the existing element by id).
4. (Optional) verifyVisually for tasks where the user asked for something specific.
5. saveAugmentation when the change is correct AND user-facing (a button, a panel, a re-style). Pass the SAME bb-id, a short human name ('Day/Night Toggle'), and the EXACT script you ran in step 2 — it auto-replays on every future visit to this domain. Do NOT save one-shot operations like 'click X' or 'extract data'.
6. finish. Tell the user what you added and that it's saved (if you saved it).

For removal/undo prompts: removeAugmentation deletes both the saved memory AND the live element on the page.

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

      // Caution actions: non-blocking toast so the user can intervene if needed.
      // Per PRD §F1, caution actions get a soft heads-up rather than a modal.
      if (risk.level === "caution") {
        this.send(Channels.EventToast, {
          kind: "warn",
          title: "Caution",
          body: risk.reason || `Step ${stepIndex + 1}: ${baseStep.goal}`,
        });
      }

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
      // jsonValueSchema rejects `undefined`, so omit any optional fields that
      // weren't set rather than including them as `undefined`.
      const resultValue: { [key: string]: string | boolean } = { ok: result.ok };
      if (result.summary !== undefined) resultValue.summary = result.summary;
      if (result.error !== undefined) resultValue.error = result.error;
      if (result.output !== undefined) resultValue.output = result.output.slice(0, 1500);

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
            output: { type: "json", value: resultValue },
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
