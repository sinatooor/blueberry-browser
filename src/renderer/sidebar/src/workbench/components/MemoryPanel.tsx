import React, { useEffect, useState } from 'react'
import { Brain, Trash2 } from 'lucide-react'
import { useWorkbench } from '../contexts/WorkbenchContext'
import type { SiteMemory } from '../../../../../common/types'

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
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Brain className="size-3.5" />
          Site memory
        </div>
        <div className="text-xs text-muted-foreground/80 mt-0.5">
          Per-domain memory the agent uses on its next run.
          {domain && (
            <>
              {' '}
              Active: <span className="font-mono">{domain}</span>
            </>
          )}
        </div>
      </div>

      {proposedMemory && (
        <div className="m-3 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3">
          <div className="text-xs font-semibold text-amber-800 dark:text-amber-200 mb-1.5">
            Save what I learned about {proposedMemory.domain}?
          </div>
          <ul className="text-[11px] space-y-1 mb-2">
            {proposedMemory.updates.map((u, i) => (
              <li key={i} className="font-mono break-all">
                · {(u as any).kind}: {(u as any).name ?? (u as any).intent ?? (u as any).term ?? (u as any).key}
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <button
              onClick={() => void acceptProposed(proposedMemory.updates)}
              className="text-[11px] px-2.5 py-1 rounded bg-emerald-600 text-white hover:opacity-90"
            >
              Save all
            </button>
            <button
              onClick={dismissProposed}
              className="text-[11px] px-2.5 py-1 rounded border border-border hover:bg-muted"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        {!memory ? (
          <div className="text-muted-foreground text-center py-4">No memory for this domain yet.</div>
        ) : (
          <>
            <Section title={`Procedures (${memory.procedures.length})`}>
              {memory.procedures.map((p, i) => (
                <li key={i}>
                  <div className="font-medium">{p.name}</div>
                  <ol className="ml-4 list-decimal text-muted-foreground">
                    {p.steps.map((s, j) => (
                      <li key={j}>{s}</li>
                    ))}
                  </ol>
                </li>
              ))}
            </Section>
            <Section title={`Selectors (${memory.selectors.length})`}>
              {memory.selectors.map((s, i) => (
                <li key={i} className={s.stale ? 'opacity-50' : ''}>
                  <span className="font-medium">{s.intent}</span>:{' '}
                  <code className="text-[10px]">{s.selector}</code>
                  {s.stale && <span className="ml-1 text-rose-600">[stale]</span>}
                </li>
              ))}
            </Section>
            <Section title={`Glossary (${memory.glossary.length})`}>
              {memory.glossary.map((g, i) => (
                <li key={i}>
                  <span className="font-medium">{g.term}</span> — {g.definition}
                </li>
              ))}
            </Section>
          </>
        )}
      </div>

      {memory && (
        <div className="border-t border-border p-2 flex">
          <div className="flex-1" />
          <button
            onClick={clear}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-rose-300 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
          >
            <Trash2 className="size-3" />
            Clear all for {domain}
          </button>
        </div>
      )}
    </div>
  )
}

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">{title}</div>
    <ul className="space-y-1">{children}</ul>
  </div>
)
