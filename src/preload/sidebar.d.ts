import { ElectronAPI } from "@electron-toolkit/preload";
import type {
  Project,
  SandboxFile,
  AgentRun,
  AgentStep,
  NetRequest,
  SiteMemory,
  SiteAugmentation,
  CodeRunResult,
  CodeOutputChunk,
  MemoryUpdate,
  EndpointSpec,
  BuiltFeature,
} from "../common/types";

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

interface TabInfo {
  id: string;
  title: string;
  url: string;
  isActive: boolean;
}

interface SidebarAPI {
  sendChatMessage: (request: Partial<ChatRequest>) => Promise<void>;
  clearChat: () => Promise<void>;
  getMessages: () => Promise<any[]>;
  onChatResponse: (cb: (data: ChatResponse) => void) => void;
  onMessagesUpdated: (cb: (messages: any[]) => void) => void;
  removeChatResponseListener: () => void;
  removeMessagesUpdatedListener: () => void;
  getPageContent: () => Promise<string | null>;
  getPageText: () => Promise<string | null>;
  getCurrentUrl: () => Promise<string | null>;
  getActiveTabInfo: () => Promise<TabInfo | null>;
}

interface WorkbenchAPI {
  // Projects
  listProjects: () => Promise<Project[]>;
  createProject: (name: string) => Promise<Project>;
  setActiveProject: (projectId: string) => Promise<{ ok: boolean; projectId?: string }>;
  getActiveProject: () => Promise<Project | null>;

  // Files
  listFiles: (projectId: string) => Promise<SandboxFile[]>;
  readFile: (projectId: string, relPath: string) => Promise<Uint8Array>;
  revealFile: (projectId: string, relPath: string) => Promise<{ ok: boolean }>;
  moveFileToProject: (args: {
    fileId: string;
    destProjectId: string;
    fromProjectId: string;
    relPath: string;
  }) => Promise<{ ok: boolean }>;

  // Agent
  startAgent: (args: {
    prompt: string;
    projectId?: string;
    tabId?: string;
  }) => Promise<{ runId: string }>;
  cancelAgent: (runId: string) => Promise<{ ok: boolean }>;
  approveStep: (args: {
    runId: string;
    stepId: string;
    verdict: "approve" | "reject";
  }) => Promise<{ ok: boolean }>;
  pauseAgent: (runId: string) => Promise<{ ok: boolean }>;
  resumeAgent: (runId: string) => Promise<{ ok: boolean }>;
  listRuns: (projectId: string) => Promise<AgentRun[]>;
  getRun: (runId: string) => Promise<AgentStep[]>;

  // Code
  warmupCode: () => Promise<{ ok: boolean }>;
  runCode: (source: string, projectId?: string) => Promise<CodeRunResult>;

  // Network
  listNetwork: (opts?: { tabId?: string; limit?: number }) => Promise<NetRequest[]>;
  getNetwork: (id: string) => Promise<NetRequest | null>;
  clearNetwork: () => Promise<{ ok: boolean }>;
  explainNetwork: (id: string) => Promise<string>;
  generateSnippet: (id: string, language: "curl" | "python" | "typescript") => Promise<string>;
  extractToCsv: (
    id: string,
    filename: string,
    projectId?: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  replayNetwork: (
    id: string,
  ) => Promise<{ ok: boolean; status?: number; body?: string; error?: string }>;

  // Build (universal extension maker)
  getFeatureSpec: (opts?: {
    tabId?: string;
    originFilter?: string;
    onlyActiveOrigin?: boolean;
    maxEndpoints?: number;
  }) => Promise<{
    tabId: string | null;
    origin: string | null;
    endpoints: EndpointSpec[];
  }>;
  buildFeature: (
    prompt: string,
    tabId?: string,
    endpoints?: EndpointSpec[],
    previousFeature?: {
      description?: string;
      code: string;
      suggested_id?: string;
      suggested_name?: string;
    },
  ) => Promise<BuiltFeature>;
  runFeature: (
    code: string,
    tabId?: string,
    timeoutMs?: number,
  ) => Promise<{ ok: true; value: unknown } | { ok: false; error: string }>;

  // API Bank
  apiBankList: (opts?: { origin?: string; limit?: number }) => Promise<EndpointSpec[]>;
  apiBankAdd: (args: {
    origin: string;
    method: string;
    pathname: string;
    url: string;
    sampleResponse?: string;
    notes?: string;
  }) => Promise<EndpointSpec>;
  apiBankRemove: (key: string) => Promise<{ ok: boolean }>;
  apiBankClearOrigin: (origin: string) => Promise<{ ok: boolean }>;
  apiBankRename: (key: string, name: string) => Promise<EndpointSpec | null>;

  // Extensions
  extensionsList: (domain: string) => Promise<SiteAugmentation[]>;
  extensionsSetEnabled: (
    domain: string,
    id: string,
    enabled: boolean,
  ) => Promise<{ ok: boolean }>;
  extensionsRemove: (domain: string, id: string) => Promise<{ ok: boolean }>;
  extensionsAdd: (
    domain: string,
    args: { id: string; name: string; script: string },
  ) => Promise<{ ok: boolean }>;

  // Memory
  getMemory: (domain: string) => Promise<SiteMemory>;
  setMemory: (domain: string, updates: MemoryUpdate[]) => Promise<SiteMemory>;
  deleteMemory: (domain: string) => Promise<{ ok: boolean }>;
  listProposedMemory: (domain: string) => Promise<MemoryUpdate[]>;
  acceptProposedMemory: (domain: string, accepted: MemoryUpdate[]) => Promise<SiteMemory>;

  // Subscriptions return unsubscribe()
  onAgentStep: (cb: (step: AgentStep) => void) => () => void;
  onAgentRun: (cb: (run: AgentRun) => void) => () => void;
  onCodeOutput: (
    cb: (payload: { runId: string; stepId: string | null; chunk: CodeOutputChunk }) => void,
  ) => () => void;
  onNetRequest: (cb: (req: NetRequest) => void) => () => void;
  onFileAdded: (cb: (payload: { projectId: string; path: string }) => void) => () => void;
  onMemoryProposed: (cb: (payload: { domain: string; updates: MemoryUpdate[] }) => void) => () => void;
  onToast: (cb: (payload: { kind: "info" | "warn" | "error"; title: string; body?: string }) => void) => () => void;
  onApiNamed: (cb: (spec: EndpointSpec) => void) => () => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    sidebarAPI: SidebarAPI;
    workbench: WorkbenchAPI;
  }
}

export {};
