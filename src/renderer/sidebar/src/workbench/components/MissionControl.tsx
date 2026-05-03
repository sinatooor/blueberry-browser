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
  ArrowRight,
} from 'lucide-react'
import { useWorkbench } from '../contexts/WorkbenchContext'
import type { AgentStep, RiskLevel, StepStatus } from '../../../../../common/types'
import { cn } from '@common/lib/utils'

const RiskBadge: React.FC<{ level: RiskLevel }> = ({ level }) => {
  const cls = {
    destructive: 'text-destructive bg-destructive/10 border-destructive/20',
    caution: 'text-warning bg-warning/10 border-warning/20',
    safe: 'text-success bg-success/10 border-success/20',
  }[level]
  const Icon = level === 'destructive' ? ShieldAlert : level === 'caution' ? AlertTriangle : ShieldCheck
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[9.5px] font-medium tracking-wide uppercase px-1.5 py-0.5 rounded-md border',
        cls,
      )}
    >
      <Icon className="size-2.5" />
      {level}
    </span>
  )
}

const StatusGlyph: React.FC<{ status: StepStatus }> = ({ status }) => {
  const base = 'size-2 rounded-full inline-block ring-2 ring-background'
  if (status === 'running')
    return <span className={cn(base, 'bg-primary animate-claude-pulse')} />
  if (status === 'awaiting-approval')
    return <span className={cn(base, 'bg-warning animate-claude-pulse')} />
  if (status === 'done') return <span className={cn(base, 'bg-success')} />
  if (status === 'failed') return <span className={cn(base, 'bg-destructive')} />
  if (status === 'skipped') return <span className={cn(base, 'bg-muted-foreground/50')} />
  return <span className={cn(base, 'bg-border-strong')} />
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

const StepRow: React.FC<{ step: AgentStep; isLast: boolean }> = ({ step, isLast }) => {
  const [open, setOpen] = useState(false)
  const running = step.status === 'running'
  const awaiting = step.status === 'awaiting-approval'
  const done = step.status === 'done'

  return (
    <div className="relative">
      {/* Vertical timeline rail */}
      {!isLast && (
        <span
          className={cn(
            'absolute left-[14px] top-7 bottom-0 w-px',
            done ? 'bg-success/40' : 'bg-border',
          )}
        />
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full flex items-start gap-3 px-3 py-2.5 text-left rounded-lg transition-colors',
          running && 'bg-primary/5 ring-1 ring-primary/20',
          awaiting && 'bg-warning/8 ring-1 ring-warning/30',
        )}
      >
        <span className="mt-1.5 shrink-0 relative z-10">
          <StatusGlyph status={step.status} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-mono tabular-nums text-muted-foreground">
              {String(step.index + 1).padStart(2, '0')}
            </span>
            <span className="font-medium text-sm truncate text-foreground">{step.goal}</span>
            <RiskBadge level={step.riskLevel} />
          </div>
          {step.rationale && (
            <div className="text-[12px] text-muted-foreground mt-1 font-serif italic line-clamp-2">
              {step.rationale}
            </div>
          )}
          <div className="text-[10.5px] text-muted-foreground/80 mt-1 font-mono truncate">
            {actionLabel(step)}
          </div>
        </div>
        <span className="shrink-0 text-muted-foreground mt-1.5">
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        </span>
      </button>

      {open && (
        <div className="ml-9 mr-2 mb-3 mt-1 space-y-2 text-xs animate-fade-in">
          <div className="card-soft !rounded-md bg-muted/30 p-2 font-mono text-[10.5px] overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(step.action, null, 2)}
          </div>
          {step.result?.summary && (
            <div className="text-muted-foreground flex gap-1.5 items-start">
              <ArrowRight className="size-3 mt-0.5 shrink-0 text-success" />
              <span>{step.result.summary}</span>
            </div>
          )}
          {step.result?.error && (
            <div className="text-destructive flex gap-1.5 items-start">
              <AlertTriangle className="size-3 mt-0.5 shrink-0" />
              <span>{step.result.error}</span>
            </div>
          )}
          {step.result?.output && (
            <pre className="text-[10.5px] bg-muted/30 p-2 rounded-md overflow-x-auto max-h-32 whitespace-pre-wrap font-mono">
              {step.result.output}
            </pre>
          )}
          {(step.screenshotBefore || step.screenshotAfter) && (
            <div className="grid grid-cols-2 gap-2">
              {step.screenshotBefore && (
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">
                    Before
                  </div>
                  <img
                    src={`file://${step.screenshotBefore}`}
                    className="rounded-md border border-border w-full"
                    alt="before"
                  />
                </div>
              )}
              {step.screenshotAfter && (
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">
                    After
                  </div>
                  <img
                    src={`file://${step.screenshotAfter}`}
                    className="rounded-md border border-border w-full"
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
      className="px-3 py-3 border-t border-border bg-surface"
      onSubmit={(e) => {
        e.preventDefault()
        if (!value.trim() || isLive) return
        void startAgent(value.trim())
        setValue('')
      }}
    >
      <div
        className={cn(
          'card-soft flex items-end gap-1 px-3 py-2 transition-shadow',
          'focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/30',
        )}
      >
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (value.trim() && !isLive) {
                void startAgent(value.trim())
                setValue('')
              }
            }
          }}
          rows={1}
          placeholder={
            activeProject && activeTabId
              ? 'Describe the task — the agent will plan and act, step by step.'
              : 'Pick a project and load a page to begin.'
          }
          disabled={!!isLive || !activeProject || !activeTabId}
          className="flex-1 resize-none bg-transparent outline-none text-sm placeholder:text-muted-foreground/70 leading-relaxed py-1 max-h-32"
          style={{ minHeight: 24 }}
        />
        <button
          type="submit"
          disabled={!value.trim() || !!isLive || !activeProject || !activeTabId}
          className={cn(
            'size-8 rounded-md flex items-center justify-center shrink-0',
            'bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity',
          )}
          aria-label="Run agent"
        >
          <ArrowRight className="size-4" />
        </button>
      </div>
      <div className="text-[10px] text-muted-foreground mt-1.5 px-1 flex items-center justify-between">
        <span>
          <kbd className="font-mono px-1 rounded bg-muted">↵</kbd> to run ·{' '}
          <kbd className="font-mono px-1 rounded bg-muted">⇧↵</kbd> for newline
        </span>
        {activeTabId && (
          <span className="font-mono opacity-70">tab #{activeTabId}</span>
        )}
      </div>
    </form>
  )
}

const ControlBar: React.FC = () => {
  const { currentRun, paused, pauseAgent, resumeAgent, cancelAgent } = useWorkbench()
  const live =
    currentRun && ['running', 'planning', 'awaiting-approval', 'paused'].includes(currentRun.status)
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-t border-border bg-surface">
      <button
        onClick={() => (paused ? resumeAgent() : pauseAgent())}
        disabled={!live}
        className={cn(
          'flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md transition-colors',
          paused
            ? 'bg-primary text-primary-foreground hover:opacity-90'
            : 'border border-border hover:bg-muted',
          'disabled:opacity-30 disabled:cursor-not-allowed',
        )}
      >
        {paused ? <Play className="size-3" /> : <Pause className="size-3" />}
        {paused ? 'Resume' : 'Pause'}
      </button>
      <button
        onClick={cancelAgent}
        disabled={!live}
        className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md border border-border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed"
      >
        <Square className="size-3" />
        Cancel
      </button>
      <div className="flex-1" />
      <div className="text-[11px] text-muted-foreground">
        {currentRun ? (
          <span className="capitalize font-medium">{currentRun.status}</span>
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
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          <Sparkles className="size-3.5 text-primary" />
          Mission Control
        </div>
        <div className="text-[12px] text-muted-foreground/80 mt-1 font-serif italic">
          Every action the agent takes, in order — with rationale, screenshots, and
          approval gates for anything destructive.
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        {steps.length === 0 ? (
          <div className="px-4 py-12 text-center">
            {currentRun?.status === 'planning' ? (
              <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Planning the first step…
              </span>
            ) : (
              <div className="space-y-2">
                <Sparkles className="size-7 mx-auto text-muted-foreground/40" />
                <div className="text-xs text-muted-foreground font-serif italic max-w-xs mx-auto">
                  Describe a task below — the agent will break it into steps and run them
                  here, transparently.
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-0.5">
            {steps.map((s, i) => (
              <StepRow key={s.id} step={s} isLast={i === steps.length - 1} />
            ))}
          </div>
        )}
      </div>

      <ControlBar />
      <Composer />
    </div>
  )
}
