import React, { useState, useEffect } from 'react'
import {
  MessageSquare,
  Sparkles,
  Code,
  Globe,
  Folder,
  Brain,
} from 'lucide-react'
import { useWorkbench } from '../contexts/WorkbenchContext'
import { ProjectSwitcher } from './ProjectSwitcher'
import { MissionControl } from './MissionControl'
import { CodePanel } from './CodePanel'
import { NetworkPanel } from './NetworkPanel'
import { FilesPanel } from './FilesPanel'
import { MemoryPanel } from './MemoryPanel'
import { Chat } from '../../components/Chat'
import { cn } from '@common/lib/utils'

type TabKey = 'chat' | 'mission' | 'code' | 'network' | 'files' | 'memory'

const TABS: { key: TabKey; label: string; Icon: any }[] = [
  { key: 'chat', label: 'Chat', Icon: MessageSquare },
  { key: 'mission', label: 'Mission', Icon: Sparkles },
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
    <div className="flex items-stretch border-b border-border bg-muted/20">
      {TABS.map(({ key, label, Icon }) => {
        const badge = badgeFor(key)
        const isActive = active === key
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={cn(
              'relative flex-1 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] uppercase tracking-wide',
              isActive
                ? 'bg-background border-b-2 border-primary text-foreground -mb-px'
                : 'text-muted-foreground hover:bg-muted/50',
            )}
          >
            <Icon className="size-3.5" />
            {label}
            {badge !== null && (
              <span
                className={cn(
                  'absolute top-1 right-1 text-[9px] font-mono px-1 rounded',
                  badge === '!'
                    ? 'bg-amber-500 text-white'
                    : 'bg-primary/80 text-primary-foreground',
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
  return (
    <div className="px-3 py-1.5 text-[11px] flex items-center gap-1.5 border-b border-border bg-muted/30">
      <span
        className={cn(
          'size-2 rounded-full',
          currentRun.status === 'running' && 'bg-sky-500 animate-pulse',
          currentRun.status === 'paused' && 'bg-amber-500',
          currentRun.status === 'awaiting-approval' && 'bg-amber-500 animate-pulse',
          currentRun.status === 'done' && 'bg-emerald-500',
          currentRun.status === 'planning' && 'bg-gray-400 animate-pulse',
        )}
      />
      <span className="font-mono">
        {currentRun.status === 'planning'
          ? 'planning…'
          : currentRun.status === 'awaiting-approval'
          ? 'awaiting approval'
          : currentRun.status === 'paused'
          ? 'paused'
          : `step ${liveCount}`}
      </span>
      {currentRun.summary && (
        <span className="text-muted-foreground italic line-clamp-1 ml-1">
          · {currentRun.summary}
        </span>
      )}
    </div>
  )
}

const Toasts: React.FC = () => {
  const { toasts, dismissToast } = useWorkbench()
  if (toasts.length === 0) return null
  return (
    <div className="absolute top-2 right-2 z-50 space-y-1.5 max-w-[280px]">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'rounded-md border bg-background shadow-md px-3 py-2 text-xs',
            t.kind === 'error' && 'border-rose-300',
            t.kind === 'warn' && 'border-amber-300',
          )}
        >
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <div className="font-medium">{t.title}</div>
              {t.body && <div className="text-muted-foreground">{t.body}</div>}
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              className="text-muted-foreground hover:text-foreground"
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

  // Auto-jump to Mission when a run starts
  useEffect(() => {
    if (currentRun && tab === 'chat') setTab('mission')
  }, [currentRun?.id])

  // Pop Memory tab open when there's a proposal waiting
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
      <Toasts />
    </div>
  )
}
