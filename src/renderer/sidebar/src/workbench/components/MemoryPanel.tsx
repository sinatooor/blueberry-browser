import React, { useEffect, useState } from 'react'
import { Brain, Trash2, BookOpen, Target, Tag, Settings2 } from 'lucide-react'
import { useWorkbench } from '../contexts/WorkbenchContext'
import type { SiteMemory } from '../../../../../common/types'
import { cn } from '@common/lib/utils'

const Section: React.FC<{
  title: string
  Icon: React.ComponentType<{ className?: string }>
  count: number
  children: React.ReactNode
  empty?: string
}> = ({ title, Icon, count, children, empty }) => (
  <div className="card-soft overflow-hidden">
    <div className="px-3 py-2 border-b border-border flex items-center gap-2 bg-muted/30">
      <Icon className="size-3.5 text-primary" />
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </span>
      <span className="ml-auto text-[10px] text-muted-foreground font-mono tabular-nums">
        {count}
      </span>
    </div>
    {count === 0 ? (
      <div className="px-3 py-2.5 text-[11px] text-muted-foreground italic font-serif">
        {empty ?? 'Nothing yet.'}
      </div>
    ) : (
      <ul className="divide-y divide-border/50">{children}</ul>
    )}
  </div>
)

export const MemoryPanel: React.FC = () => {
  const { domain, proposedMemory, acceptProposed, dismissProposed } = useWorkbench()
  const [memory, setMemory] = useState<SiteMemory | null>(null)

  useEffect(() => {
    if (!domain) return
    void window.workbench.getMemory(domain).then(setMemory)
  }, [domain, proposedMemory])

  const clear = async (): Promise<void> => {
    if (!domain) return
    await window.workbench.deleteMemory(domain)
    setMemory(null)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          <Brain className="size-3.5 text-primary" />
          Site Memory
        </div>
        <div className="text-[12px] text-muted-foreground/80 mt-1 font-serif italic">
          Per-domain memory the agent reads on every run.
          {domain && (
            <>
              {' '}
              Active:{' '}
              <span className="font-mono not-italic text-[11px] text-foreground/80">
                {domain}
              </span>
            </>
          )}
        </div>
      </div>

      {proposedMemory && (
        <div className="m-3 card-soft !border-warning/40 bg-warning/5 overflow-hidden animate-fade-in">
          <div className="px-3 py-2 border-b border-warning/30 flex items-center gap-2">
            <Brain className="size-3.5 text-warning" />
            <div className="text-[11px] font-medium uppercase tracking-wider text-warning">
              Save what I learned?
            </div>
          </div>
          <div className="px-3 py-2.5">
            <div className="text-[12px] text-muted-foreground mb-2 font-serif italic">
              The agent proposes these updates for{' '}
              <span className="font-mono not-italic text-foreground/80">
                {proposedMemory.domain}
              </span>
              :
            </div>
            <ul className="text-[11px] space-y-1 mb-3">
              {proposedMemory.updates.map((u, i) => (
                <li key={i} className="font-mono break-all flex items-start gap-1.5">
                  <span className="text-muted-foreground/60 mt-0.5">·</span>
                  <span>
                    <span className="text-warning">{(u as any).kind}</span>:{' '}
                    {(u as any).name ??
                      (u as any).intent ??
                      (u as any).term ??
                      (u as any).key}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                onClick={() => void acceptProposed(proposedMemory.updates)}
                className="text-[11px] font-medium px-3 py-1.5 rounded-md bg-success text-background hover:opacity-90"
              >
                Save all
              </button>
              <button
                onClick={dismissProposed}
                className="text-[11px] px-3 py-1.5 rounded-md border border-border hover:bg-muted"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        {!memory ? (
          <div className="px-4 py-12 text-center">
            <Brain className="size-6 mx-auto mb-3 text-muted-foreground/40" />
            <div className="text-xs text-muted-foreground font-serif italic max-w-xs mx-auto">
              No memory for this domain yet. Run a task and the agent will propose what to remember.
            </div>
          </div>
        ) : (
          <>
            <Section
              title="Procedures"
              Icon={BookOpen}
              count={memory.procedures.length}
              empty="No procedures recorded."
            >
              {memory.procedures.map((p, i) => (
                <li key={i} className="px-3 py-2">
                  <div className="font-medium text-foreground">{p.name}</div>
                  <ol className="ml-4 mt-1 list-decimal text-muted-foreground space-y-0.5 text-[11px]">
                    {p.steps.map((s, j) => (
                      <li key={j}>{s}</li>
                    ))}
                  </ol>
                </li>
              ))}
            </Section>
            <Section
              title="Selectors"
              Icon={Target}
              count={memory.selectors.length}
              empty="No selectors stored."
            >
              {memory.selectors.map((s, i) => (
                <li key={i} className={cn('px-3 py-1.5', s.stale && 'opacity-50')}>
                  <span className="font-medium text-foreground">{s.intent}</span>
                  <code className="block text-[10px] font-mono text-muted-foreground mt-0.5 truncate">
                    {s.selector}
                  </code>
                  {s.stale && (
                    <span className="text-[9px] text-destructive uppercase tracking-wide">
                      stale
                    </span>
                  )}
                </li>
              ))}
            </Section>
            <Section
              title="Glossary"
              Icon={Tag}
              count={memory.glossary.length}
              empty="No glossary terms."
            >
              {memory.glossary.map((g, i) => (
                <li key={i} className="px-3 py-1.5">
                  <span className="font-medium text-foreground">{g.term}</span>
                  <span className="text-muted-foreground"> — {g.definition}</span>
                </li>
              ))}
            </Section>
            {Object.keys(memory.preferences).length > 0 && (
              <Section
                title="Preferences"
                Icon={Settings2}
                count={Object.keys(memory.preferences).length}
              >
                {Object.entries(memory.preferences).map(([k, v]) => (
                  <li key={k} className="px-3 py-1.5 font-mono text-[10.5px]">
                    <span className="text-foreground">{k}</span>
                    <span className="text-muted-foreground">: {JSON.stringify(v)}</span>
                  </li>
                ))}
              </Section>
            )}
          </>
        )}
      </div>

      {memory && (
        <div className="border-t border-border p-2 bg-surface flex">
          <div className="flex-1" />
          <button
            onClick={clear}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-md border border-destructive/30 text-destructive hover:bg-destructive/8"
          >
            <Trash2 className="size-3" />
            Clear all for {domain}
          </button>
        </div>
      )}
    </div>
  )
}
