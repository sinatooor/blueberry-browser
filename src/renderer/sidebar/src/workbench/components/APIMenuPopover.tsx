import React, { useEffect, useRef } from 'react'
import { Plus, BookOpen, ShieldAlert, Pencil } from 'lucide-react'
import { cn } from '@common/lib/utils'
import { useApiBank } from '../contexts/ApiBankContext'

// Small popover anchored above the Build composer's "APIs" button.
//
// Lists every API captured for the current site with an on/off toggle and
// a click target that opens the API Bank focused on that endpoint. The
// last item is "Add API" which opens the Bank without a selection.
//
// Toggling an API off removes it from the LLM context for the next Build
// call but keeps it visible in the Bank so the user can re-enable it.

interface APIMenuPopoverProps {
    open: boolean
    onClose: () => void
}

const isMutating = (method: string): boolean =>
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())

const methodTone = (method: string): string => {
    switch (method.toUpperCase()) {
        case 'GET':
            return 'text-foreground'
        case 'POST':
            return 'text-success'
        case 'PUT':
        case 'PATCH':
            return 'text-warning'
        case 'DELETE':
            return 'text-destructive'
        default:
            return 'text-muted-foreground'
    }
}

export const APIMenuPopover: React.FC<APIMenuPopoverProps> = ({ open, onClose }) => {
    const { spec, origin, isEnabled, toggleEnabled, openBank } = useApiBank()
    const ref = useRef<HTMLDivElement>(null)

    // Click outside / Esc dismiss.
    useEffect(() => {
        if (!open) return
        const onDoc = (e: MouseEvent): void => {
            if (ref.current && !ref.current.contains(e.target as Node)) onClose()
        }
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') onClose()
        }
        // Defer so the click that opened the popover doesn't immediately close it.
        const id = setTimeout(() => {
            document.addEventListener('mousedown', onDoc)
        }, 0)
        document.addEventListener('keydown', onKey)
        return () => {
            clearTimeout(id)
            document.removeEventListener('mousedown', onDoc)
            document.removeEventListener('keydown', onKey)
        }
    }, [open, onClose])

    if (!open) return null

    const visible = origin
        ? spec.filter((s) => s.origin === origin)
        : []

    return (
        <div
            ref={ref}
            className={cn(
                // Anchor to the button's right edge so the popover opens
                // leftward — the APIs button sits in the right half of the
                // bottom bar; left-aligning would clip it on narrow sidebars.
                'absolute bottom-full right-0 mb-2 z-50',
                'w-[320px] max-w-[calc(100vw-2rem)]',
                'bg-card border border-border rounded-lg shadow-xl overflow-hidden',
                'animate-fade-in',
            )}
            role="menu"
        >
            <div className="px-3 py-2 border-b border-border bg-card/60">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                    Captured APIs
                </div>
                <div className="text-[10.5px] font-mono text-foreground/80 truncate mt-0.5">
                    {origin ?? '(no active page)'}
                </div>
            </div>

            <div className="max-h-72 overflow-y-auto py-1">
                {visible.length === 0 ? (
                    <div className="px-3 py-6 text-[11px] text-muted-foreground text-center font-serif italic">
                        Nothing captured yet — interact with the page so it makes XHR/fetch calls.
                    </div>
                ) : (
                    visible.map((s) => {
                        const enabled = isEnabled(s.origin, s.key)
                        return (
                            <div
                                key={s.key}
                                className={cn(
                                    'flex items-center gap-2 px-3 py-1.5 hover:bg-muted/50 group',
                                    !enabled && 'opacity-50',
                                )}
                            >
                                <input
                                    type="checkbox"
                                    checked={enabled}
                                    onChange={() => toggleEnabled(s.origin, s.key)}
                                    onClick={(e) => e.stopPropagation()}
                                    title={
                                        enabled
                                            ? 'Enabled — included in LLM context'
                                            : 'Disabled — hidden from LLM'
                                    }
                                    className="size-3 cursor-pointer accent-primary shrink-0"
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        openBank(s.key)
                                        onClose()
                                    }}
                                    className="flex-1 min-w-0 text-left flex items-center gap-1.5"
                                >
                                    <span
                                        className={cn(
                                            'font-mono text-[10px] font-bold w-10 shrink-0',
                                            methodTone(s.method),
                                        )}
                                    >
                                        {s.method}
                                    </span>
                                    <span className="font-mono text-[11px] truncate flex-1">
                                        {s.pathname}
                                    </span>
                                    {s.hasCsrfHint && (
                                        <ShieldAlert
                                            className="size-3 text-warning shrink-0"
                                            aria-label="CSRF"
                                        />
                                    )}
                                    {isMutating(s.method) && (
                                        <Pencil
                                            className="size-3 text-warning shrink-0"
                                            aria-label="Mutating"
                                        />
                                    )}
                                </button>
                            </div>
                        )
                    })
                )}
            </div>

            <div className="border-t border-border bg-muted/20">
                <button
                    type="button"
                    onClick={() => {
                        openBank()
                        onClose()
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-foreground hover:bg-muted/50"
                >
                    <BookOpen className="size-3 text-primary" />
                    Open API Bank
                </button>
                <button
                    type="button"
                    onClick={() => {
                        // Routes to the Bank — manual-add form lands in a follow-up commit.
                        openBank()
                        onClose()
                    }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-[11px] text-foreground hover:bg-muted/50 border-t border-border"
                >
                    <Plus className="size-3 text-primary" />
                    Add API
                </button>
            </div>
        </div>
    )
}
