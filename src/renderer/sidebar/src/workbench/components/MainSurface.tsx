import React, { useEffect, useState } from 'react'
import { Loader2, SlidersHorizontal } from 'lucide-react'
import { cn } from '@common/lib/utils'
import { useWorkbench } from '../contexts/WorkbenchContext'
import { ProjectSwitcher } from './ProjectSwitcher'
import { ApprovalDialog } from './ApprovalDialog'
import { ModePill, type Mode } from './ModePill'
import { InspectDrawer } from './InspectDrawer'
import { BuildComposer } from './BuildComposer'
import { AgentPanel } from './AgentPanel'
import { Chat } from '../../components/Chat'

// One unified surface that hosts whichever mode the user picked. The old
// 6-tab TabBar is gone; everything that doesn't belong in the chat-shaped
// flow (Memory, Files, Network, Code) moved into the Inspect drawer.
//
// Build is the focus and the default. Agent and Chat are still here and
// fully functional — just one click away under the mode pill.

const MODE_STORAGE_KEY = 'bb:main-surface:mode'

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

interface ToolbarProps {
    mode: Mode
    onModeChange: (mode: Mode) => void
    onInspectToggle: () => void
    inspectOpen: boolean
}

const Toolbar: React.FC<ToolbarProps> = ({
    mode,
    onModeChange,
    onInspectToggle,
    inspectOpen,
}) => {
    const { network, files, proposedMemory } = useWorkbench()
    // One badge on Inspect when something inside wants attention. Keeps the
    // top bar uncluttered compared to the old per-tab badges.
    const inspectBadge: string | null = proposedMemory
        ? '!'
        : network.length + files.length > 0
            ? null // counts shown inside the drawer; no badge needed for normal state
            : null

    return (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card/40">
            <ModePill mode={mode} onChange={onModeChange} />
            <div className="flex-1" />
            <button
                type="button"
                onClick={onInspectToggle}
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
    const [mode, setMode] = useState<Mode>(() => {
        if (typeof window === 'undefined') return 'build'
        const stored = localStorage.getItem(MODE_STORAGE_KEY) as Mode | null
        return stored === 'build' || stored === 'agent' || stored === 'chat'
            ? stored
            : 'build'
    })
    const [inspectOpen, setInspectOpen] = useState(false)
    const { currentRun } = useWorkbench()

    useEffect(() => {
        try {
            localStorage.setItem(MODE_STORAGE_KEY, mode)
        } catch {
            // ignore
        }
    }, [mode])

    // When a multi-step agent run kicks off, jump to Agent mode so the
    // timeline is visible.
    useEffect(() => {
        if (
            currentRun &&
            ['running', 'planning', 'awaiting-approval'].includes(currentRun.status)
        ) {
            setMode('agent')
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentRun?.id])

    return (
        <div className="relative h-screen flex flex-col bg-background border-l border-border overflow-hidden">
            <ProjectSwitcher />
            <RunPill />
            <Toolbar
                mode={mode}
                onModeChange={setMode}
                onInspectToggle={() => setInspectOpen((v) => !v)}
                inspectOpen={inspectOpen}
            />

            <div className="flex-1 min-h-0">
                {mode === 'build' && (
                    <div className="h-full overflow-y-auto">
                        <BuildComposer />
                    </div>
                )}
                {mode === 'agent' && <AgentPanel />}
                {mode === 'chat' && <Chat />}
            </div>

            <InspectDrawer
                open={inspectOpen}
                onClose={() => setInspectOpen(false)}
            />
            <ApprovalDialog />
            <Toasts />
        </div>
    )
}
