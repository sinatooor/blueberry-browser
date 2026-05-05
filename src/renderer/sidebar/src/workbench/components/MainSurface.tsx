import React, { useState } from 'react'
import { Loader2, SlidersHorizontal } from 'lucide-react'
import { cn } from '@common/lib/utils'
import { useWorkbench } from '../contexts/WorkbenchContext'
import { ProjectSwitcher } from './ProjectSwitcher'
import { ApprovalDialog } from './ApprovalDialog'
import { InspectDrawer, type InspectTab } from './InspectDrawer'
import { ChatSurface } from './ChatSurface'

// MainSurface is the sidebar's outer shell. It owns:
//   - The project switcher row
//   - The agent run pill (when a run is live)
//   - A tiny top toolbar with just the Inspect button
//   - The unified ChatSurface (one thread, mode pill below the input)
//   - Inspect drawer (overlays from the right when opened)
//   - The destructive-step approval dialog and toast stack
//
// The 6-tab TabBar is gone — modes live below the composer, advanced
// surfaces (Memory/Files/Network/Code) live in the Inspect drawer.

const RunPill: React.FC = () => {
    const { currentRun, steps } = useWorkbench()
    if (!currentRun) return null
    const live = ['running', 'planning', 'awaiting-approval', 'paused'].includes(
        currentRun.status,
    )
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
                            {t.body && (
                                <div className="text-muted-foreground mt-0.5">{t.body}</div>
                            )}
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

const TopToolbar: React.FC<{
    inspectOpen: boolean
    onToggleInspect: () => void
}> = ({ inspectOpen, onToggleInspect }) => {
    const { network, files, proposedMemory } = useWorkbench()
    const inspectBadge: string | null = proposedMemory
        ? '!'
        : network.length + files.length > 0
            ? null
            : null

    return (
        <div className="flex items-center justify-end gap-2 px-3 py-1.5 border-b border-border bg-card/40">
            <button
                type="button"
                onClick={onToggleInspect}
                aria-pressed={inspectOpen}
                title="Inspect — Memory · Files · Network · Code"
                className={cn(
                    'relative flex items-center gap-1.5 text-[10.5px] font-medium px-2 py-1 rounded-md border',
                    inspectOpen
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border hover:bg-muted text-foreground',
                )}
            >
                <SlidersHorizontal className="size-3" />
                Inspect
                {inspectBadge !== null && !inspectOpen && (
                    <span className="absolute -top-1 -right-1 size-3.5 rounded-full bg-warning text-background text-[9px] font-mono flex items-center justify-center">
                        {inspectBadge}
                    </span>
                )}
            </button>
        </div>
    )
}

export const MainSurface: React.FC = () => {
    const [inspectOpen, setInspectOpen] = useState(false)
    const [inspectInitialTab, setInspectInitialTab] = useState<InspectTab | null>(
        null,
    )

    const openInspect = (tab?: InspectTab): void => {
        if (tab) setInspectInitialTab(tab)
        setInspectOpen(true)
    }

    return (
        <div className="relative h-screen flex flex-col bg-background border-l border-border overflow-hidden">
            <ProjectSwitcher />
            <RunPill />
            <TopToolbar
                inspectOpen={inspectOpen}
                onToggleInspect={() => setInspectOpen((v) => !v)}
            />

            <div className="flex-1 min-h-0">
                <ChatSurface
                    onOpenAPIs={() => openInspect('network')}
                    onOpenExtensions={() => openInspect('memory')}
                />
            </div>

            <InspectDrawer
                open={inspectOpen}
                onClose={() => {
                    setInspectOpen(false)
                    setInspectInitialTab(null)
                }}
                initialTab={inspectInitialTab ?? undefined}
            />
            <ApprovalDialog />
            <Toasts />
        </div>
    )
}
