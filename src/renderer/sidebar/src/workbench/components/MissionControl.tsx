import React, { useState } from 'react'
import {
  Play,
  Pause,
  Square,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import { useWorkbench } from '../contexts/WorkbenchContext'
import type { AgentStep, RiskLevel, StepStatus } from '../../../../../common/types'
import { cn } from '@common/lib/utils'

const RiskBadge: React.FC<{ level: RiskLevel }> = ({ level }) => {
  if (level === 'destructive')
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 px-1.5 py-0.5 rounded">
        <ShieldAlert className="size-3" /> destructive
      </span>
    )
  if (level === 'caution')
    return (
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 px-1.5 py-0.5 rounded">
        <AlertTriangle className="size-3" /> caution
      </span>
    )
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded">
      <ShieldCheck className="size-3" /> safe
    </span>
  )
}

const StatusDot: React.FC<{ status: StepStatus }> = ({ status }) => {
  const base = 'size-2.5 rounded-full inline-block'
  if (status === 'running') return <span className={cn(base, 'bg-sky-500 animate-pulse')} />
  if (status === 'awaiting-approval')
    return <span className={cn(base, 'bg-amber-500 animate-pulse')} />
  if (status === 'done') return <span className={cn(base, 'bg-emerald-500')} />
  if (status === 'failed') return <span className={cn(base, 'bg-rose-500')} />
  if (status === 'skipped') return <span className={cn(base, 'bg-gray-400')} />
  return <span className={cn(base, 'bg-gray-300 dark:bg-gray-600')} />
}

function actionLabel(step: AgentStep): string {
  const a = step.action
  switch (a.type) {
    case 'click':
      return `click ${a.selector}`
    case 'type':
      return `type into ${a.selector}: "${a.text.slice(0, 40)}"`
    case 'scroll':
      return `scroll ${a.direction} ${a.px}px`
    case 'navigate':
      return `navigate ${a.url}`
    case 'wait':
      return a.forSelector ? `wait for ${a.forSelector}` : `wait ${a.ms}ms`
    case 'extract':
      return a.source === 'network'
        ? `extract network "${a.networkUrl}" → files/${a.into}`
        : `extract ${a.selector} → files/${a.into}`
    case 'writeFile':
      return `write files/${a.path}`
    case 'runCode':
      return `run python (${a.source.length} chars)`
    case 'saveMemory':
      return `propose ${a.updates.length} memory updates`
    case 'finish':
      return `finish: ${a.summary.slice(0, 80)}`
    default:
      return JSON.stringify(a)
  }
}

const StepRow: React.FC<{ step: AgentStep }> = ({ step }) => {
  const [open, setOpen] = useState(false)
  const { approveStep } = useWorkbench()
  const awaiting = step.status === 'awaiting-approval'
  const running = step.status === 'running'

  return (
    <div
      className={cn(
        'border-l-2 pl-3 py-2 transition-colors',
        running && 'border-sky-500 bg-sky-50/40 dark:bg-sky-950/20',
        awaiting && 'border-amber-500 bg-amber-50/40 dark:bg-amber-950/20',
        step.status === 'done' && 'border-emerald-500',
        step.status === 'failed' && 'border-rose-500',
        step.status === 'planning' && 'border-gray-300 dark:border-gray-600',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-2 text-left"
      >
        <span className="mt-1 shrink-0">
          <StatusDot status={step.status} />
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums w-6">
          {String(step.index + 1).padStart(2, '0')}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{step.goal}</span>
            <RiskBadge level={step.riskLevel} />
            {step.confidence && (
              <span className="text-[10px] text-muted-foreground">·conf {step.confidence}/5</span>
            )}
          </div>
          {step.rationale && (
            <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
              {step.rationale}
            </div>
          )}
          <div className="text-[11px] text-muted-foreground mt-1 font-mono truncate">
            {actionLabel(step)}
          </div>
        </div>
        <span className="shrink-0 text-muted-foreground mt-1">
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </span>
      </button>

      {awaiting && (
        <div className="mt-2 ml-6 p-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200 mb-1">
            <ShieldAlert className="size-3.5" />
            Approval required
          </div>
          <div className="text-xs text-amber-900/80 dark:text-amber-100/80 mb-2">
            This step looks destructive. Approve to continue or reject to ask the agent for an alternative.
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => approveStep(step.id, 'approve')}
              className="text-xs px-2.5 py-1 rounded bg-emerald-600 text-white hover:bg-emerald-500"
            >
              Approve
            </button>
            <button
              onClick={() => approveStep(step.id, 'reject')}
              className="text-xs px-2.5 py-1 rounded bg-rose-600 text-white hover:bg-rose-500"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="mt-2 ml-6 space-y-2 text-xs">
          <div className="font-mono bg-muted/40 p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(step.action, null, 2)}
          </div>
          {step.result?.summary && (
            <div className="text-muted-foreground">↳ {step.result.summary}</div>
          )}
          {step.result?.error && (
            <div className="text-rose-600 dark:text-rose-400">⚠ {step.result.error}</div>
          )}
          {step.result?.output && (
            <pre className="text-[11px] bg-muted/30 p-2 rounded overflow-x-auto max-h-40 whitespace-pre-wrap">
              {step.result.output}
            </pre>
          )}
          {(step.screenshotBefore || step.screenshotAfter) && (
            <div className="grid grid-cols-2 gap-2">
              {step.screenshotBefore && (
                <div>
                  <div className="text-[10px] text-muted-foreground mb-0.5">before</div>
                  <img
                    src={`file://${step.screenshotBefore}`}
                    className="rounded border border-border w-full"
                    alt="before"
                  />
                </div>
              )}
              {step.screenshotAfter && (
                <div>
                  <div className="text-[10px] text-muted-foreground mb-0.5">after</div>
                  <img
                    src={`file://${step.screenshotAfter}`}
                    className="rounded border border-border w-full"
                    alt="after"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const Composer: React.FC = () => {
  const [value, setValue] = useState('')
  const { startAgent, currentRun, activeProject, activeTabId } = useWorkbench()
  const isLive =
    currentRun && ['running', 'planning', 'awaiting-approval', 'paused'].includes(currentRun.status)

  return (
    <form
      className="flex gap-2 p-3 border-t border-border bg-background"
      onSubmit={(e) => {
        e.preventDefault()
        if (!value.trim() || isLive) return
        void startAgent(value.trim())
        setValue('')
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={
          activeProject && activeTabId
            ? 'What should the agent do? e.g. "Find the revenue dip and explain it"'
            : 'Pick a project and load a page to start'
        }
        disabled={!!isLive || !activeProject || !activeTabId}
        className="flex-1 px-3 py-2 text-sm rounded-md border border-border bg-background outline-none focus:border-primary/40"
      />
      <button
        disabled={!value.trim() || !!isLive || !activeProject || !activeTabId}
        className={cn(
          'px-3 py-2 rounded-md text-sm font-medium',
          'bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50',
        )}
      >
        Run
      </button>
    </form>
  )
}

const ControlBar: React.FC = () => {
  const { currentRun, paused, pauseAgent, resumeAgent, cancelAgent } = useWorkbench()
  const live =
    currentRun && ['running', 'planning', 'awaiting-approval', 'paused'].includes(currentRun.status)
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t border-border bg-muted/30">
      <button
        onClick={() => (paused ? resumeAgent() : pauseAgent())}
        disabled={!live}
        className={cn(
          'flex items-center gap-1 text-xs px-2 py-1 rounded',
          paused
            ? 'bg-primary text-primary-foreground'
            : 'bg-background border border-border hover:bg-muted',
          'disabled:opacity-40',
        )}
      >
        {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
        {paused ? 'Resume' : 'Pause'}
      </button>
      <button
        onClick={cancelAgent}
        disabled={!live}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-background border border-border hover:bg-muted disabled:opacity-40"
      >
        <Square className="size-3" />
        Cancel
      </button>
      <div className="flex-1" />
      <div className="text-xs text-muted-foreground">
        {currentRun ? (
          <>
            <span className="capitalize">{currentRun.status}</span>
            {currentRun.summary && (
              <span className="ml-2 text-muted-foreground/80 italic line-clamp-1">
                {currentRun.summary}
              </span>
            )}
          </>
        ) : (
          'idle'
        )}
      </div>
    </div>
  )
}

export const MissionControl: React.FC = () => {
  const { steps, currentRun } = useWorkbench()
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="p-3 border-b border-border">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            <Sparkles className="size-3.5" />
            Mission Control
          </div>
          <div className="text-xs text-muted-foreground/80 mt-0.5">
            Every action the agent takes is logged here, with before/after screenshots and approval gates for anything destructive.
          </div>
        </div>

        {steps.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            {currentRun?.status === 'planning' ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin" /> Planning…
              </span>
            ) : (
              'Start a run from the prompt below to see steps appear here.'
            )}
          </div>
        ) : (
          <div className="px-3 pb-3 space-y-1">
            {steps.map((s) => (
              <StepRow key={s.id} step={s} />
            ))}
          </div>
        )}
      </div>
      <ControlBar />
      <Composer />
    </div>
  )
}
