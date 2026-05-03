import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  AgentRun,
  AgentStep,
  CodeOutputChunk,
  NetRequest,
  Project,
  SandboxFile,
  MemoryUpdate,
} from '../../../../../common/types'

type Toast = {
  id: string
  kind: 'info' | 'warn' | 'error'
  title: string
  body?: string
}

interface WorkbenchContextValue {
  projects: Project[]
  activeProject: Project | null
  setActiveProject: (id: string) => Promise<void>
  refreshProjects: () => Promise<void>
  createProject: (name: string) => Promise<void>

  files: SandboxFile[]
  refreshFiles: () => Promise<void>
  network: NetRequest[]
  refreshNetwork: () => Promise<void>

  steps: AgentStep[]
  currentRun: AgentRun | null
  startAgent: (prompt: string) => Promise<void>
  cancelAgent: () => void
  pauseAgent: () => void
  resumeAgent: () => void
  approveStep: (stepId: string, verdict: 'approve' | 'reject') => void
  paused: boolean

  proposedMemory: { domain: string; updates: MemoryUpdate[] } | null
  acceptProposed: (accepted: MemoryUpdate[]) => Promise<void>
  dismissProposed: () => void

  toasts: Toast[]
  dismissToast: (id: string) => void

  activeTabId: string | null
  activeUrl: string | null
  domain: string | null

  // Code panel state
  codeOutputs: CodeOutputChunk[]
  appendCodeOutput: (chunk: CodeOutputChunk) => void
  clearCodeOutputs: () => void
  runCode: (source: string) => Promise<void>
  codeRunning: boolean
}

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null)

export const useWorkbench = (): WorkbenchContextValue => {
  const ctx = useContext(WorkbenchContext)
  if (!ctx) throw new Error('useWorkbench must be used inside WorkbenchProvider')
  return ctx
}

function deriveDomain(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    const parts = u.hostname.split('.')
    if (parts.length <= 2) return u.hostname
    return parts.slice(-2).join('.')
  } catch {
    return null
  }
}

export const WorkbenchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeProject, setActiveProjectState] = useState<Project | null>(null)
  const [files, setFiles] = useState<SandboxFile[]>([])
  const [network, setNetwork] = useState<NetRequest[]>([])
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [currentRun, setCurrentRun] = useState<AgentRun | null>(null)
  const [paused, setPaused] = useState(false)
  const [proposedMemory, setProposedMemory] =
    useState<{ domain: string; updates: MemoryUpdate[] } | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [activeUrl, setActiveUrl] = useState<string | null>(null)
  const [codeOutputs, setCodeOutputs] = useState<CodeOutputChunk[]>([])
  const [codeRunning, setCodeRunning] = useState(false)

  const stepsByRun = useRef<Map<string, AgentStep[]>>(new Map())

  const refreshProjects = useCallback(async () => {
    const ps = await window.workbench.listProjects()
    setProjects(ps)
    const active = await window.workbench.getActiveProject()
    setActiveProjectState(active)
  }, [])

  const setActiveProject = useCallback(async (id: string) => {
    const r = await window.workbench.setActiveProject(id)
    if (r.ok) {
      const p = projects.find((x) => x.id === id)
      if (p) setActiveProjectState(p)
    }
  }, [projects])

  const createProject = useCallback(async (name: string) => {
    await window.workbench.createProject(name)
    await refreshProjects()
  }, [refreshProjects])

  const refreshFiles = useCallback(async () => {
    if (!activeProject) {
      setFiles([])
      return
    }
    const fs = await window.workbench.listFiles(activeProject.id)
    setFiles(fs)
  }, [activeProject])

  const refreshNetwork = useCallback(async () => {
    if (!activeTabId) {
      setNetwork([])
      return
    }
    const reqs = await window.workbench.listNetwork({ tabId: activeTabId, limit: 200 })
    setNetwork(reqs)
  }, [activeTabId])

  const refreshActiveTab = useCallback(async () => {
    const info = await window.sidebarAPI.getActiveTabInfo()
    setActiveTabId(info?.id ?? null)
    setActiveUrl(info?.url ?? null)
  }, [])

  // Subscriptions
  useEffect(() => {
    const offStep = window.workbench.onAgentStep((step) => {
      const list = stepsByRun.current.get(step.runId) ?? []
      const idx = list.findIndex((s) => s.id === step.id)
      if (idx >= 0) list[idx] = step
      else list.push(step)
      stepsByRun.current.set(step.runId, list)
      // Render the *current* run's steps
      setCurrentRun((r) => {
        if (!r || r.id !== step.runId) return r
        return r
      })
      setSteps([...list].sort((a, b) => a.index - b.index))
    })
    const offRun = window.workbench.onAgentRun((run) => {
      setCurrentRun(run)
      if (run.status === 'paused') setPaused(true)
      if (run.status === 'running') setPaused(false)
      if (['done', 'failed', 'cancelled'].includes(run.status)) {
        setPaused(false)
      }
    })
    const offFile = window.workbench.onFileAdded(() => {
      void refreshFiles()
    })
    const offNet = window.workbench.onNetRequest((req) => {
      setNetwork((n) => [req, ...n].slice(0, 200))
    })
    const offMem = window.workbench.onMemoryProposed((p) => {
      setProposedMemory(p)
    })
    const offCode = window.workbench.onCodeOutput((p) => {
      setCodeOutputs((o) => [...o, p.chunk])
    })
    const offToast = window.workbench.onToast((t) => {
      const id = `t_${Date.now()}_${Math.random()}`
      setToasts((ts) => [...ts, { id, ...t }])
      setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 4500)
    })
    return () => {
      offStep()
      offRun()
      offFile()
      offNet()
      offMem()
      offCode()
      offToast()
    }
  }, [refreshFiles])

  // Initial load + tab info polling
  useEffect(() => {
    void refreshProjects()
    void refreshActiveTab()
    const id = setInterval(refreshActiveTab, 1500)
    return () => clearInterval(id)
  }, [refreshProjects, refreshActiveTab])

  useEffect(() => {
    void refreshFiles()
  }, [refreshFiles, activeProject])

  useEffect(() => {
    void refreshNetwork()
  }, [refreshNetwork])

  const startAgent = useCallback(
    async (prompt: string) => {
      if (!activeProject || !activeTabId) return
      stepsByRun.current.clear()
      setSteps([])
      setProposedMemory(null)
      const r = await window.workbench.startAgent({
        prompt,
        projectId: activeProject.id,
        tabId: activeTabId,
      })
      void r
    },
    [activeProject, activeTabId],
  )

  const cancelAgent = useCallback(() => {
    if (currentRun) void window.workbench.cancelAgent(currentRun.id)
  }, [currentRun])

  const pauseAgent = useCallback(() => {
    if (currentRun) {
      void window.workbench.pauseAgent(currentRun.id)
      setPaused(true)
    }
  }, [currentRun])

  const resumeAgent = useCallback(() => {
    if (currentRun) {
      void window.workbench.resumeAgent(currentRun.id)
      setPaused(false)
    }
  }, [currentRun])

  const approveStep = useCallback(
    (stepId: string, verdict: 'approve' | 'reject') => {
      if (!currentRun) return
      void window.workbench.approveStep({ runId: currentRun.id, stepId, verdict })
    },
    [currentRun],
  )

  const acceptProposed = useCallback(
    async (accepted: MemoryUpdate[]) => {
      if (!proposedMemory) return
      await window.workbench.acceptProposedMemory(proposedMemory.domain, accepted)
      setProposedMemory(null)
    },
    [proposedMemory],
  )

  const dismissProposed = useCallback(() => setProposedMemory(null), [])
  const dismissToast = useCallback(
    (id: string) => setToasts((ts) => ts.filter((t) => t.id !== id)),
    [],
  )

  const appendCodeOutput = useCallback(
    (chunk: CodeOutputChunk) => setCodeOutputs((o) => [...o, chunk]),
    [],
  )
  const clearCodeOutputs = useCallback(() => setCodeOutputs([]), [])

  const runCode = useCallback(
    async (source: string) => {
      if (!activeProject) return
      setCodeRunning(true)
      clearCodeOutputs()
      try {
        await window.workbench.runCode(source, activeProject.id)
      } finally {
        setCodeRunning(false)
      }
    },
    [activeProject, clearCodeOutputs],
  )

  const value = useMemo<WorkbenchContextValue>(
    () => ({
      projects,
      activeProject,
      setActiveProject,
      refreshProjects,
      createProject,
      files,
      refreshFiles,
      network,
      refreshNetwork,
      steps,
      currentRun,
      startAgent,
      cancelAgent,
      pauseAgent,
      resumeAgent,
      approveStep,
      paused,
      proposedMemory,
      acceptProposed,
      dismissProposed,
      toasts,
      dismissToast,
      activeTabId,
      activeUrl,
      domain: deriveDomain(activeUrl),
      codeOutputs,
      appendCodeOutput,
      clearCodeOutputs,
      runCode,
      codeRunning,
    }),
    [
      projects,
      activeProject,
      setActiveProject,
      refreshProjects,
      createProject,
      files,
      refreshFiles,
      network,
      refreshNetwork,
      steps,
      currentRun,
      startAgent,
      cancelAgent,
      pauseAgent,
      resumeAgent,
      approveStep,
      paused,
      proposedMemory,
      acceptProposed,
      dismissProposed,
      toasts,
      dismissToast,
      activeTabId,
      activeUrl,
      codeOutputs,
      appendCodeOutput,
      clearCodeOutputs,
      runCode,
      codeRunning,
    ],
  )

  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>
}
