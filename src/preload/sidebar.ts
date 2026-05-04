import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";
import { Channels } from "../common/channels";

interface ChatRequest {
  message: string;
  context: {
    url: string | null;
    content: string | null;
    text: string | null;
  };
  messageId: string;
}

interface ChatResponse {
  messageId: string;
  content: string;
  isComplete: boolean;
}

const sidebarAPI = {
  // Chat (existing)
  sendChatMessage: (request: Partial<ChatRequest>) =>
    ipcRenderer.invoke("sidebar-chat-message", request),
  clearChat: () => ipcRenderer.invoke("sidebar-clear-chat"),
  getMessages: () => ipcRenderer.invoke("sidebar-get-messages"),
  onChatResponse: (callback: (data: ChatResponse) => void) => {
    ipcRenderer.on("chat-response", (_, data) => callback(data));
  },
  onMessagesUpdated: (callback: (messages: any[]) => void) => {
    ipcRenderer.on("chat-messages-updated", (_, messages) => callback(messages));
  },
  removeChatResponseListener: () => {
    ipcRenderer.removeAllListeners("chat-response");
  },
  removeMessagesUpdatedListener: () => {
    ipcRenderer.removeAllListeners("chat-messages-updated");
  },

  // Page content access
  getPageContent: () => ipcRenderer.invoke("get-page-content"),
  getPageText: () => ipcRenderer.invoke("get-page-text"),
  getCurrentUrl: () => ipcRenderer.invoke("get-current-url"),
  getActiveTabInfo: () => ipcRenderer.invoke("get-active-tab-info"),
};

// All Workbench-specific channels go through one typed object.
const workbenchAPI = {
  // Projects
  listProjects: () => ipcRenderer.invoke(Channels.ProjectsList),
  createProject: (name: string) =>
    ipcRenderer.invoke(Channels.ProjectsCreate, { name }),
  setActiveProject: (projectId: string) =>
    ipcRenderer.invoke(Channels.ProjectsSetActive, { projectId }),
  getActiveProject: () => ipcRenderer.invoke(Channels.ProjectsGetActive),

  // Files
  listFiles: (projectId: string) =>
    ipcRenderer.invoke(Channels.FilesList, { projectId }),
  readFile: (projectId: string, relPath: string) =>
    ipcRenderer.invoke(Channels.FilesRead, { projectId, relPath }),
  revealFile: (projectId: string, relPath: string) =>
    ipcRenderer.invoke(Channels.FilesReveal, { projectId, relPath }),
  moveFileToProject: (args: {
    fileId: string;
    destProjectId: string;
    fromProjectId: string;
    relPath: string;
  }) => ipcRenderer.invoke(Channels.FilesMoveToProject, args),

  // Agent
  startAgent: (args: { prompt: string; projectId?: string; tabId?: string }) =>
    ipcRenderer.invoke(Channels.AgentStart, args),
  cancelAgent: (runId: string) =>
    ipcRenderer.invoke(Channels.AgentCancel, { runId }),
  approveStep: (args: { runId: string; stepId: string; verdict: "approve" | "reject" }) =>
    ipcRenderer.invoke(Channels.AgentApproveStep, args),
  pauseAgent: (runId: string) =>
    ipcRenderer.invoke(Channels.AgentPause, { runId }),
  resumeAgent: (runId: string) =>
    ipcRenderer.invoke(Channels.AgentResume, { runId }),
  listRuns: (projectId: string) =>
    ipcRenderer.invoke(Channels.AgentListRuns, { projectId }),
  getRun: (runId: string) => ipcRenderer.invoke(Channels.AgentGetRun, { runId }),

  // Code
  warmupCode: () => ipcRenderer.invoke(Channels.CodeWarmup),
  runCode: (source: string, projectId?: string) =>
    ipcRenderer.invoke(Channels.CodeRun, { source, projectId }),

  // Network
  listNetwork: (opts?: { tabId?: string; limit?: number }) =>
    ipcRenderer.invoke(Channels.NetList, opts ?? {}),
  getNetwork: (id: string) => ipcRenderer.invoke(Channels.NetGet, { id }),
  clearNetwork: () => ipcRenderer.invoke(Channels.NetClear),
  explainNetwork: (id: string) => ipcRenderer.invoke(Channels.NetExplain, { id }),
  generateSnippet: (id: string, language: "curl" | "python" | "typescript") =>
    ipcRenderer.invoke(Channels.NetGenerateSnippet, { id, language }),
  extractToCsv: (id: string, filename: string, projectId?: string) =>
    ipcRenderer.invoke(Channels.NetExtractCsv, { id, filename, projectId }),
  replayNetwork: (id: string) => ipcRenderer.invoke(Channels.NetReplay, { id }),

  // Build (universal extension maker)
  getFeatureSpec: (opts?: {
    tabId?: string;
    originFilter?: string;
    maxEndpoints?: number;
  }) => ipcRenderer.invoke(Channels.FeatureGetSpec, opts ?? {}),
  buildFeature: (prompt: string, tabId?: string) =>
    ipcRenderer.invoke(Channels.FeatureBuild, { prompt, tabId }),
  runFeature: (code: string, tabId?: string, timeoutMs?: number) =>
    ipcRenderer.invoke(Channels.FeatureRun, { code, tabId, timeoutMs }),

  // Memory
  getMemory: (domain: string) => ipcRenderer.invoke(Channels.MemoryGet, { domain }),
  setMemory: (domain: string, updates: any[]) =>
    ipcRenderer.invoke(Channels.MemorySet, { domain, updates }),
  deleteMemory: (domain: string) =>
    ipcRenderer.invoke(Channels.MemoryDelete, { domain }),
  listProposedMemory: (domain: string) =>
    ipcRenderer.invoke(Channels.MemoryListProposed, { domain }),
  acceptProposedMemory: (domain: string, accepted: any[]) =>
    ipcRenderer.invoke(Channels.MemoryAcceptProposed, { domain, accepted }),

  // Subscriptions: each returns an unsubscribe function for cleanup.
  onAgentStep: (cb: (step: any) => void) => {
    const fn = (_e: unknown, step: any): void => cb(step);
    ipcRenderer.on(Channels.EventAgentStep, fn);
    return () => ipcRenderer.off(Channels.EventAgentStep, fn);
  },
  onAgentRun: (cb: (run: any) => void) => {
    const fn = (_e: unknown, run: any): void => cb(run);
    ipcRenderer.on(Channels.EventAgentRun, fn);
    return () => ipcRenderer.off(Channels.EventAgentRun, fn);
  },
  onCodeOutput: (cb: (payload: any) => void) => {
    const fn = (_e: unknown, p: any): void => cb(p);
    ipcRenderer.on(Channels.EventCodeOutput, fn);
    return () => ipcRenderer.off(Channels.EventCodeOutput, fn);
  },
  onNetRequest: (cb: (req: any) => void) => {
    const fn = (_e: unknown, r: any): void => cb(r);
    ipcRenderer.on(Channels.EventNetRequest, fn);
    return () => ipcRenderer.off(Channels.EventNetRequest, fn);
  },
  onFileAdded: (cb: (payload: any) => void) => {
    const fn = (_e: unknown, p: any): void => cb(p);
    ipcRenderer.on(Channels.EventFileAdded, fn);
    return () => ipcRenderer.off(Channels.EventFileAdded, fn);
  },
  onMemoryProposed: (cb: (payload: any) => void) => {
    const fn = (_e: unknown, p: any): void => cb(p);
    ipcRenderer.on(Channels.EventMemoryProposed, fn);
    return () => ipcRenderer.off(Channels.EventMemoryProposed, fn);
  },
  onToast: (cb: (payload: any) => void) => {
    const fn = (_e: unknown, p: any): void => cb(p);
    ipcRenderer.on(Channels.EventToast, fn);
    return () => ipcRenderer.off(Channels.EventToast, fn);
  },
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("sidebarAPI", sidebarAPI);
    contextBridge.exposeInMainWorld("workbench", workbenchAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore
  window.electron = electronAPI;
  // @ts-ignore
  window.sidebarAPI = sidebarAPI;
  // @ts-ignore
  window.workbench = workbenchAPI;
}
