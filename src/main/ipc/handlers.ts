import { ipcMain, shell, type WebContents } from "electron";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod";
import { Channels } from "../../common/channels";
import {
  listProjects,
  createProject as createProjectRow,
  getProject,
  listFiles,
  moveFileToProject,
  listRuns,
  getRunSteps,
} from "../projects/store";
import {
  projectFilesDir,
  resolveInProject,
} from "../projects/sandbox";
import { agentRuntime } from "../agent/runtime";
import { runPython, warmupPyodide } from "../code/pyodide-host";
import { networkCapture } from "../cdp/network";
import {
  explainRequest,
  generateSnippet,
  extractToCsv,
  replayGet,
} from "../cdp/copilot";
import { buildApiSpec } from "../cdp/spec";
import { buildFeature } from "../cdp/feature-builder";
import { evalJs } from "../cdp/actions";
import {
  getMemory,
  applyUpdates,
  clearMemory,
  listProposed,
  acceptProposed,
} from "../memory/service";
import type { Window } from "../Window";

let activeProjectId: string | null = null;

export function getActiveProjectId(): string | null {
  return activeProjectId;
}

export function broadcastToWindow(
  win: Window,
  channel: string,
  payload: unknown,
): void {
  win.sidebar.view.webContents.send(channel, payload);
}

export function registerWorkbenchIpc(win: Window): void {
  // Bind agent runtime to the window's tabs.
  agentRuntime.bind({
    getActiveTabContents: (tabId): WebContents | null => {
      const tab = win.getTab(tabId);
      return tab?.webContents ?? null;
    },
    emit: (channel, payload) => broadcastToWindow(win, channel, payload),
  });

  const ensureActiveProject = (): string => {
    if (activeProjectId) return activeProjectId;
    const projects = listProjects();
    const demo =
      projects.find((p) => p.slug === "saas-investigation") ??
      projects.find((p) => p.slug === "inbox") ??
      projects[0];
    activeProjectId = demo?.id ?? null;
    if (!activeProjectId) throw new Error("No projects exist");
    return activeProjectId;
  };
  ensureActiveProject();

  // ---- Projects ----
  ipcMain.handle(Channels.ProjectsList, () => listProjects());
  ipcMain.handle(Channels.ProjectsCreate, (_e, payload) => {
    const { name } = z.object({ name: z.string().min(1).max(80) }).parse(payload);
    return createProjectRow(name);
  });
  ipcMain.handle(Channels.ProjectsSetActive, (_e, payload) => {
    const { projectId } = z.object({ projectId: z.string() }).parse(payload);
    if (getProject(projectId)) {
      activeProjectId = projectId;
      return { ok: true, projectId };
    }
    return { ok: false };
  });
  ipcMain.handle(Channels.ProjectsGetActive, () =>
    activeProjectId ? getProject(activeProjectId) : null,
  );

  // ---- Files ----
  ipcMain.handle(Channels.FilesList, (_e, payload) => {
    const { projectId } = z.object({ projectId: z.string() }).parse(payload);
    return listFiles(projectId);
  });
  ipcMain.handle(Channels.FilesRead, (_e, payload) => {
    const { projectId, relPath } = z
      .object({ projectId: z.string(), relPath: z.string() })
      .parse(payload);
    const abs = resolveInProject(projectId, path.join("files", relPath));
    return fs.readFileSync(abs);
  });
  ipcMain.handle(Channels.FilesReveal, (_e, payload) => {
    const { projectId, relPath } = z
      .object({ projectId: z.string(), relPath: z.string() })
      .parse(payload);
    const abs = resolveInProject(projectId, path.join("files", relPath));
    void shell.openPath(abs);
    return { ok: true };
  });
  ipcMain.handle(Channels.FilesMoveToProject, (_e, payload) => {
    const { fileId, destProjectId, fromProjectId, relPath } = z
      .object({
        fileId: z.string(),
        destProjectId: z.string(),
        fromProjectId: z.string(),
        relPath: z.string(),
      })
      .parse(payload);
    const fromAbs = path.join(projectFilesDir(fromProjectId), relPath);
    const toAbs = path.join(projectFilesDir(destProjectId), relPath);
    fs.mkdirSync(path.dirname(toAbs), { recursive: true });
    fs.renameSync(fromAbs, toAbs);
    moveFileToProject(fileId, destProjectId, relPath);
    return { ok: true };
  });

  // ---- Agent ----
  ipcMain.handle(Channels.AgentStart, async (_e, payload) => {
    const { prompt, projectId, tabId } = z
      .object({
        prompt: z.string().min(1),
        projectId: z.string().optional(),
        tabId: z.string().optional(),
      })
      .parse(payload);
    const pid = projectId ?? ensureActiveProject();
    const tid = tabId ?? win.activeTab?.id;
    if (!tid) throw new Error("No active tab");
    return await agentRuntime.startRun({ prompt, projectId: pid, tabId: tid });
  });
  ipcMain.handle(Channels.AgentCancel, (_e, payload) => {
    const { runId } = z.object({ runId: z.string() }).parse(payload);
    agentRuntime.cancel(runId);
    return { ok: true };
  });
  ipcMain.handle(Channels.AgentApproveStep, (_e, payload) => {
    const { runId, stepId, verdict } = z
      .object({
        runId: z.string(),
        stepId: z.string(),
        verdict: z.enum(["approve", "reject"]),
      })
      .parse(payload);
    agentRuntime.approveStep(runId, stepId, verdict);
    return { ok: true };
  });
  ipcMain.handle(Channels.AgentPause, (_e, payload) => {
    const { runId } = z.object({ runId: z.string() }).parse(payload);
    agentRuntime.pause(runId);
    return { ok: true };
  });
  ipcMain.handle(Channels.AgentResume, (_e, payload) => {
    const { runId } = z.object({ runId: z.string() }).parse(payload);
    agentRuntime.resume(runId);
    return { ok: true };
  });
  ipcMain.handle(Channels.AgentListRuns, (_e, payload) => {
    const { projectId } = z.object({ projectId: z.string() }).parse(payload);
    return listRuns(projectId);
  });
  ipcMain.handle(Channels.AgentGetRun, (_e, payload) => {
    const { runId } = z.object({ runId: z.string() }).parse(payload);
    return getRunSteps(runId);
  });

  // ---- Code ----
  ipcMain.handle(Channels.CodeWarmup, async () => {
    await warmupPyodide();
    return { ok: true };
  });
  ipcMain.handle(Channels.CodeRun, async (_e, payload) => {
    const { source, projectId } = z
      .object({ source: z.string(), projectId: z.string().optional() })
      .parse(payload);
    const pid = projectId ?? ensureActiveProject();
    const result = await runPython(source, pid, (chunk) =>
      broadcastToWindow(win, Channels.EventCodeOutput, {
        runId: "manual",
        stepId: null,
        chunk,
      }),
    );
    return result;
  });

  // ---- Network ----
  ipcMain.handle(Channels.NetList, (_e, payload) => {
    const { tabId, limit } = z
      .object({
        tabId: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(payload ?? {});
    return networkCapture.list({ tabId, limit });
  });
  ipcMain.handle(Channels.NetGet, (_e, payload) => {
    const { id } = z.object({ id: z.string() }).parse(payload);
    return networkCapture.get(id);
  });
  ipcMain.handle(Channels.NetClear, () => {
    networkCapture.clear();
    return { ok: true };
  });
  ipcMain.handle(Channels.NetExplain, async (_e, payload) => {
    const { id } = z.object({ id: z.string() }).parse(payload);
    const req = networkCapture.get(id);
    if (!req) throw new Error("Request not found");
    return await explainRequest(req);
  });
  ipcMain.handle(Channels.NetGenerateSnippet, async (_e, payload) => {
    const { id, language } = z
      .object({ id: z.string(), language: z.enum(["curl", "python", "typescript"]) })
      .parse(payload);
    const req = networkCapture.get(id);
    if (!req) throw new Error("Request not found");
    return await generateSnippet(req, language);
  });
  ipcMain.handle(Channels.NetExtractCsv, async (_e, payload) => {
    const { id, projectId, filename } = z
      .object({
        id: z.string(),
        projectId: z.string().optional(),
        filename: z.string(),
      })
      .parse(payload);
    const req = networkCapture.get(id);
    if (!req) throw new Error("Request not found");
    const pid = projectId ?? ensureActiveProject();
    return await extractToCsv(req, pid, filename, (channel, p) =>
      broadcastToWindow(win, channel, p),
    );
  });
  ipcMain.handle(Channels.NetReplay, async (_e, payload) => {
    const { id } = z.object({ id: z.string() }).parse(payload);
    const req = networkCapture.get(id);
    if (!req) throw new Error("Request not found");
    return await replayGet(req);
  });

  // ---- Build (universal extension maker) ----
  // Returns a compact, sanitized spec of the JSON endpoints captured for the
  // active tab's origin. Used by the Build composer to show the user what's
  // available before they ask the LLM to build a feature.
  ipcMain.handle(Channels.FeatureGetSpec, (_e, payload) => {
    const { tabId, originFilter, maxEndpoints } = z
      .object({
        tabId: z.string().optional(),
        originFilter: z.string().optional(),
        maxEndpoints: z.number().int().min(1).max(200).optional(),
      })
      .parse(payload ?? {});
    const tid = tabId ?? win.activeTab?.id;
    if (!tid) return { tabId: null, origin: null, endpoints: [] };
    const url = win.getTab(tid)?.url ?? null;
    let origin: string | null = null;
    try {
      if (url) origin = new URL(url).origin;
    } catch {
      origin = null;
    }
    const endpoints = buildApiSpec({
      tabId: tid,
      originFilter: originFilter ?? origin ?? undefined,
      maxEndpoints,
    });
    return { tabId: tid, origin, endpoints };
  });

  // Calls the LLM with the prompt + spec and returns a strict-JSON BuiltFeature
  // with static-analysis warnings appended. Does NOT execute anything — the
  // renderer's ApprovalCard is the gate.
  ipcMain.handle(Channels.FeatureBuild, async (_e, payload) => {
    const { prompt, tabId } = z
      .object({
        prompt: z.string().min(1),
        tabId: z.string().optional(),
      })
      .parse(payload);
    const tid = tabId ?? win.activeTab?.id;
    if (!tid) throw new Error("No active tab");
    const url = win.getTab(tid)?.url ?? null;
    let origin: string | null = null;
    try {
      if (url) origin = new URL(url).origin;
    } catch {
      origin = null;
    }
    const spec = buildApiSpec({
      tabId: tid,
      originFilter: origin ?? undefined,
      maxEndpoints: 40,
    });
    return await buildFeature({
      prompt,
      pageUrl: url,
      origin,
      spec,
    });
  });

  // Approved by the user — run the generated script in the active tab via
  // CDP Runtime.evaluate. The script runs in the page's main world so it
  // inherits cookies and same-origin trust.
  ipcMain.handle(Channels.FeatureRun, async (_e, payload) => {
    const { code, tabId, timeoutMs } = z
      .object({
        code: z.string().min(1),
        tabId: z.string().optional(),
        timeoutMs: z.number().int().min(500).max(60_000).optional(),
      })
      .parse(payload);
    const tid = tabId ?? win.activeTab?.id;
    if (!tid) throw new Error("No active tab");
    const tab = win.getTab(tid);
    if (!tab) throw new Error(`Tab ${tid} not found`);
    const result = await evalJs(tab.webContents, code, true, timeoutMs ?? 15_000);
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, value: result.value };
  });

  // ---- Memory ----
  ipcMain.handle(Channels.MemoryGet, (_e, payload) => {
    const { domain } = z.object({ domain: z.string() }).parse(payload);
    return getMemory(domain);
  });
  ipcMain.handle(Channels.MemorySet, (_e, payload) => {
    const { domain, updates } = z
      .object({
        domain: z.string(),
        updates: z.array(z.any()),
      })
      .parse(payload);
    return applyUpdates(domain, updates);
  });
  ipcMain.handle(Channels.MemoryDelete, (_e, payload) => {
    const { domain } = z.object({ domain: z.string() }).parse(payload);
    clearMemory(domain);
    return { ok: true };
  });
  ipcMain.handle(Channels.MemoryListProposed, (_e, payload) => {
    const { domain } = z.object({ domain: z.string() }).parse(payload);
    return listProposed(domain);
  });
  ipcMain.handle(Channels.MemoryAcceptProposed, (_e, payload) => {
    const { domain, accepted } = z
      .object({ domain: z.string(), accepted: z.array(z.any()) })
      .parse(payload);
    return acceptProposed(domain, accepted);
  });
}
