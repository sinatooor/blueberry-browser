// Channel name constants — single source of truth for IPC strings.
// Imported by both main (ipcMain.handle) and preload (ipcRenderer.invoke).

export const Channels = {
  // Projects
  ProjectsList: "projects:list",
  ProjectsCreate: "projects:create",
  ProjectsSetActive: "projects:setActive",
  ProjectsGetActive: "projects:getActive",

  // Files
  FilesList: "files:list",
  FilesRead: "files:read",
  FilesReveal: "files:reveal",
  FilesMoveToProject: "files:moveToProject",

  // Agent
  AgentStart: "agent:start",
  AgentCancel: "agent:cancel",
  AgentApproveStep: "agent:approveStep",
  AgentPause: "agent:pause",
  AgentResume: "agent:resume",
  AgentListRuns: "agent:listRuns",
  AgentGetRun: "agent:getRun",

  // Code
  CodeRun: "code:run",
  CodeCancel: "code:cancel",
  CodeWarmup: "code:warmup",

  // Network
  NetList: "net:list",
  NetGet: "net:get",
  NetClear: "net:clear",
  NetExplain: "net:explain",
  NetGenerateSnippet: "net:generateSnippet",
  NetExtractCsv: "net:extractCsv",
  NetReplay: "net:replay",

  // Build (universal extension maker)
  FeatureGetSpec: "feature:getSpec",
  FeatureBuild: "feature:build",
  FeatureRun: "feature:run",

  // Cross-session API catalog ("API Bank")
  ApiBankList: "apiBank:list",
  ApiBankAdd: "apiBank:add",
  ApiBankRemove: "apiBank:remove",
  ApiBankClearOrigin: "apiBank:clearOrigin",
  ApiBankRename: "apiBank:rename",

  // Saved extensions per site (built on top of SiteAugmentation memory)
  ExtensionsList: "extensions:list",
  ExtensionsSetEnabled: "extensions:setEnabled",
  ExtensionsRemove: "extensions:remove",

  // Memory
  MemoryGet: "memory:get",
  MemorySet: "memory:set",
  MemoryDelete: "memory:delete",
  MemoryListProposed: "memory:listProposed",
  MemoryAcceptProposed: "memory:acceptProposed",

  // Subscriptions (main → renderer events)
  EventAgentStep: "event:agent:step",
  EventAgentRun: "event:agent:run",
  EventCodeOutput: "event:code:output",
  EventNetRequest: "event:net:request",
  EventFileAdded: "event:file:added",
  EventMemoryProposed: "event:memory:proposed",
  EventToast: "event:toast",
  // Fires when the LLM-generated short name for an endpoint lands.
  EventApiNamed: "event:api:named",
} as const;

export type ChannelName = (typeof Channels)[keyof typeof Channels];
