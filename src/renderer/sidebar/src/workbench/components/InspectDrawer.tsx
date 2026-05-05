import React, { useEffect, useState } from 'react'
import { X, Brain, Folder, Globe, Code as CodeIcon, Search } from 'lucide-react'
import { cn } from '@common/lib/utils'
import { useWorkbench } from '../contexts/WorkbenchContext'
import { MemoryPanel } from './MemoryPanel'
import { FilesPanel } from './FilesPanel'
import { NetworkPanel } from './NetworkPanel'
import { CodePanel } from './CodePanel'

// The Inspect drawer holds every advanced surface that doesn't belong in the
// main chat-shaped flow: persistent site memory, downloaded/extracted files,
// the raw network capture (the Network Copilot still lives here), and the
// Python REPL. Slides in from the right; press Esc or click the backdrop to
// dismiss. State for the inner tab persists across opens via localStorage.

export type InspectTab = 'memory' | 'files' | 'network' | 'code'

const TABS: { key: InspectTab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'memory', label: 'Memory', Icon: Brain },
    { key: 'files', label: 'Files', Icon: Folder },
    { key: 'network', label: 'Net', Icon: Globe },
    { key: 'code', label: 'Code', Icon: CodeIcon },
]

const STORAGE_KEY = 'bb:inspect-drawer:tab'

interface InspectDrawerProps {
    open: boolean
    onClose: () => void
    // If provided, jumps to this tab when the drawer opens. Lets the chat
    // surface's "APIs" / "Extensions" buttons land on the right tab.
    initialTab?: InspectTab
}

export const InspectDrawer: React.FC<InspectDrawerProps> = ({
    open,
    onClose,
    initialTab,
}) => {
    const { network, files, proposedMemory } = useWorkbench()
    const [tab, setTab] = useState<InspectTab>(() => {
        if (typeof window === 'undefined') return 'memory'
        const stored = localStorage.getItem(STORAGE_KEY) as InspectTab | null
        return stored && TABS.some((t) => t.key === stored) ? stored : 'memory'
    })

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, tab)
        } catch {
            // ignore
        }
    }, [tab])

    // Honor the caller's preferred opening tab the moment the drawer opens.
    useEffect(() => {
        if (open && initialTab) setTab(initialTab)
    }, [open, initialTab])

    // Esc closes the drawer.
    useEffect(() => {
        if (!open) return
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [open, onClose])

    // Auto-open Memory if proposed updates arrive while the drawer is open.
    useEffect(() => {
        if (open && proposedMemory) setTab('memory')
    }, [open, proposedMemory])

    if (!open) return null

    const badgeFor = (k: InspectTab): string | null => {
        if (k === 'network' && network.length > 0)
            return network.length > 99 ? '99+' : `${network.length}`
        if (k === 'files' && files.length > 0)
            return files.length > 99 ? '99+' : `${files.length}`
        if (k === 'memory' && proposedMemory) return '!'
        return null
    }

    return (
        <div
            className="absolute inset-0 z-40 bg-background/40 backdrop-blur-sm flex justify-end animate-fade-in"
            onClick={onClose}
            aria-modal="true"
            role="dialog"
        >
            <div
                className="w-full max-w-md h-full bg-background border-l border-border flex flex-col shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card">
                    <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                        <Search className="size-3.5 text-primary" />
                        Inspect
                    </div>
                    <button
                        onClick={onClose}
                        className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted"
                        aria-label="Close"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                <div className="flex border-b border-border bg-surface">
                    {TABS.map(({ key, label, Icon }) => {
                        const active = tab === key
                        const badge = badgeFor(key)
                        return (
                            <button
                                key={key}
                                onClick={() => setTab(key)}
                                className={cn(
                                    'relative flex-1 flex items-center justify-center gap-1 py-2 text-[10px] font-medium uppercase tracking-wide hover-warm',
                                    active ? 'text-foreground' : 'text-muted-foreground',
                                )}
                            >
                                <Icon
                                    className={cn(
                                        'size-3.5 transition-colors',
                                        active && 'text-primary',
                                    )}
                                />
                                <span>{label}</span>
                                {active && (
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

                <div className="flex-1 min-h-0 overflow-hidden">
                    {tab === 'memory' && <MemoryPanel />}
                    {tab === 'files' && <FilesPanel />}
                    {tab === 'network' && <NetworkPanel />}
                    {tab === 'code' && <CodePanel />}
                </div>
            </div>
        </div>
    )
}
