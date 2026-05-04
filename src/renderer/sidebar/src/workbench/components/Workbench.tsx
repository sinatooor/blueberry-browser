import React, { useState, useEffect } from 'react'
import {
  MessageSquare,
  Sparkles,
  Code,
  Globe,
  Folder,
  Brain,
  Loader2,
} from 'lucide-react'
import { useWorkbench } from '../contexts/WorkbenchContext'
import { ProjectSwitcher } from './ProjectSwitcher'
import { MissionControl } from './MissionControl'
import { CodePanel } from './CodePanel'
import { NetworkPanel } from './NetworkPanel'
import { FilesPanel } from './FilesPanel'
import { MemoryPanel } from './MemoryPanel'
import { Chat } from '../../components/Chat'
import { ApprovalDialog } from './ApprovalDialog'
import { cn } from '@common/lib/utils'

// `mission` is preserved as the internal TabKey to keep IPC + storage stable;
// it surfaces in the UI as "Build" — that tab is now the universal-extension
// flow plus the agent timeline below it.
type TabKey = 'chat' | 'mission' | 'code' | 'network' | 'files' | 'memory'

const TABS: { key: TabKey; label: string; Icon: any }[] = [
  { key: 'chat', label: 'Chat', Icon: MessageSquare },
  { key: 'mission', label: 'Build', Icon: Sparkles },
  { key: 'code', label: 'Code', Icon: Code },
  { key: 'network', label: 'Net', Icon: Globe },
  { key: 'files', label: 'Files', Icon: Folder },
  { key: 'memory', label: 'Memory', Icon: Brain },
]

const TabBar: React.FC<{ active: TabKey; onChange: (t: TabKey) => void }> = ({
  active,
  onChange,
}) => {
  const { steps, currentRun, network, files, proposedMemory } = useWorkbench()
  const liveAgent =
    currentRun &&
    ['running', 'planning', 'awaiting-approval', 'paused'].includes(currentRun.status)

  const badgeFor = (k: TabKey): string | null => {
    if (k === 'mission' && liveAgent) return `${steps.length}`
    if (k === 'network' && network.length > 0) return network.length > 99 ? '99+' : `${network.length}`
    if (k === 'files' && files.length > 0) return files.length > 99 ? '99+' : `${files.length}`
    if (k === 'memory' && proposedMemory) return '!'
    return null
  }

  return (
    <div className="flex items-stretch border-b border-border bg-background/60 backdrop-blur-sm">
      {TABS.map(({ key, label, Icon }) => {
        const badge = badgeFor(key)
        const isActive = active === key
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={cn(
              'relative flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium tracking-wide uppercase',
              'hover-warm',
              isActive
                ? 'text-foreground'
                : 'text-muted-foreground',
            )}
          >
            <Icon className={cn('size-3.5 transition-colors', isActive && 'text-primary')} />
            <span className="text-[9.5px]">{label}</span>
            {isActive && (
              <span className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] w-6 rounded-full bg-primary" />
            )}
            {badge !== null && (
              <span
                className={cn(
                  'absolute top-1 right-1.5 text-[9px] font-mono px-1 rounded leading-tight tabular-nums',
                  badge === '!'
                    ? 'bg-warning text-background'
                    : 'bg-primary/90 text-primary-foreground',
                )}
              >
                {badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

const RunPill: React.FC = () => {
  const { currentRun, steps } = useWorkbench()
  if (!currentRun) return null
  const live = ['running', 'planning', 'awaiting-approval', 'paused'].includes(currentRun.status)
  if (!live && currentRun.status !== 'done') return null
  const liveCount = steps.filter((s) => s.status !== 'planning').length
  const dotCls =
    currentRun.status === 'running'
      ? 'bg-primary animate-claude-pulse'
      : currentRun.status === 'paused'
      ? 'bg-warning'
      : currentRun.status === 'awaiting-approval'
      ? 'bg-warning animate-claude-pulse'
      : currentRun.status === 'done'
      ? 'bg-success'
      : 'bg-muted-foreground/60 animate-claude-pulse'

  return (
    <div className="px-4 py-2 text-[11px] flex items-center gap-2 border-b border-border grad-warm">
      <span className={cn('size-2 rounded-full shrink-0', dotCls)} />
      <span className="font-medium text-foreground/90 tabular-nums">
        {currentRun.status === 'planning'
          ? 'Planning…'
          : currentRun.status === 'awaiting-approval'
          ? 'Awaiting approval'
          : currentRun.status === 'paused'
          ? 'Paused'
          : currentRun.status === 'done'
          ? 'Done'
          : `Step ${liveCount}`}
      </span>
      {currentRun.summary && (
        <span className="text-muted-foreground italic line-clamp-1 ml-1 font-serif text-[12px]">
          {currentRun.summary}
        </span>
      )}
      {currentRun.status === 'planning' && (
        <Loader2 className="size-3 animate-spin text-muted-foreground ml-auto shrink-0" />
      )}
    </div>
  )
}

const Toasts: React.FC = () => {
  const { toasts, dismissToast } = useWorkbench()
  if (toasts.length === 0) return null
  return (
    <div className="absolute top-3 right-3 z-50 space-y-2 max-w-[300px]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'card-soft px-3 py-2.5 text-xs shadow-subtle animate-fade-in',
            t.kind === 'error' && '!border-destructive/40',
            t.kind === 'warn' && '!border-warning/50',
          )}
        >
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <div className="font-medium text-foreground">{t.title}</div>
              {t.body && <div className="text-muted-foreground mt-0.5">{t.body}</div>}
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-muted-foreground hover:text-foreground leading-none text-base"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export const Workbench: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('mission')
  const { currentRun, proposedMemory } = useWorkbench()

  useEffect(() => {
    if (currentRun && tab === 'chat') setTab('mission')
  }, [currentRun?.id])

  useEffect(() => {
    if (proposedMemory) setTab('memory')
  }, [proposedMemory])

  return (
    <div className="relative h-screen flex flex-col bg-background border-l border-border overflow-hidden">
      <ProjectSwitcher />
      <RunPill />
      <TabBar active={tab} onChange={setTab} />
      <div className="flex-1 min-h-0">
        {tab === 'chat' && <Chat />}
        {tab === 'mission' && <MissionControl />}
        {tab === 'code' && <CodePanel />}
        {tab === 'network' && <NetworkPanel />}
        {tab === 'files' && <FilesPanel />}
        {tab === 'memory' && <MemoryPanel />}
      </div>
      <ApprovalDialog />
      <Toasts />
    </div>
  )
}
