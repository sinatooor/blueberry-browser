import React, { useEffect } from 'react'
import { ShieldAlert, X } from 'lucide-react'
import { useWorkbench } from '../contexts/WorkbenchContext'
import type { AgentStep } from '../../../../../common/types'

function summarize(step: AgentStep): string {
  const a = step.action
  switch (a.type) {
    case 'click':
      return `Click \`${a.selector}\``
    case 'type':
      return `Type "${a.text.slice(0, 80)}" into \`${a.selector}\``
    case 'navigate':
      return `Navigate to ${a.url}`
    case 'runCode':
      return `Run ${a.source.length}-char Python script`
    default:
      return a.type
  }
}

export const ApprovalDialog: React.FC = () => {
  const { steps, approveStep } = useWorkbench()
  const pending = steps.find((s) => s.status === 'awaiting-approval')

  // Allow Esc to reject; Enter to approve. Quality-of-life.
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') approveStep(pending.id, 'reject')
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) approveStep(pending.id, 'approve')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending?.id, approveStep])

  if (!pending) return null

  return (
    <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="card-soft max-w-sm w-full shadow-expanded overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-warning/8 flex items-center gap-2">
          <ShieldAlert className="size-4 text-warning" />
          <div className="font-serif text-base">Approval required</div>
          <button
            onClick={() => approveStep(pending.id, 'reject')}
            className="ml-auto text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="px-4 py-4 space-y-3">
          <p className="text-xs text-muted-foreground leading-relaxed">
            The agent classified the next step as{' '}
            <span className="font-medium text-foreground">destructive</span>.
            Review before allowing it to proceed.
          </p>
          <div className="card-soft !rounded-md bg-muted/30 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Step {pending.index + 1}
            </div>
            <div className="font-medium text-sm">{pending.goal}</div>
            {pending.rationale && (
              <div className="text-xs text-muted-foreground italic mt-1 font-serif">
                {pending.rationale}
              </div>
            )}
            <div className="mt-2 text-[11px] font-mono break-all text-foreground/80">
              {summarize(pending)}
            </div>
          </div>
          {pending.screenshotBefore && (
            <img
              src={`file://${pending.screenshotBefore}`}
              className="w-full rounded-md border border-border"
              alt="page state"
            />
          )}
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center gap-2 bg-muted/20">
          <button
            onClick={() => approveStep(pending.id, 'reject')}
            className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-muted font-medium"
          >
            Reject
          </button>
          <div className="flex-1 text-[10px] text-muted-foreground">
            <kbd className="font-mono px-1 rounded bg-muted">Esc</kbd> to reject ·{' '}
            <kbd className="font-mono px-1 rounded bg-muted">⌘↵</kbd> to approve
          </div>
          <button
            onClick={() => approveStep(pending.id, 'approve')}
            className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 font-medium"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  )
}
