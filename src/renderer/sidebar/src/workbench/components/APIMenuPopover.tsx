import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, BookOpen, ShieldAlert, Pencil, Check, X } from 'lucide-react'
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
    // Element the popover anchors to. The popover's bottom-right is pinned
    // 8 px above the anchor's top-right and rendered in a portal at the
    // document root, so it isn't clipped by any ancestor's overflow:hidden
    // or max-width container.
    anchorRef: React.RefObject<HTMLElement | null>
}

const POPOVER_WIDTH = 320
const VIEWPORT_MARGIN = 8

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

export const APIMenuPopover: React.FC<APIMenuPopoverProps> = ({
    open,
    onClose,
    anchorRef,
}) => {
    const { spec, origin, isEnabled, toggleEnabled, renameApi, openBank } =
        useApiBank()
    const ref = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState<
        { bottom: number; left: number; width: number } | null
    >(null)
    const [editing, setEditing] = useState<{ key: string; draft: string } | null>(
        null,
    )

    // Position: pin the popover's BOTTOM 8 px above the anchor button so it
    // grows upward, then center horizontally in the viewport. We use a real
    // `bottom` value (not top + translateY) because the fade-in animation
    // also drives `transform`, and stacking translateY on top of an animated
    // transform makes the popover land in the wrong spot.
    useLayoutEffect(() => {
        if (!open || !anchorRef.current) return
        const update = (): void => {
            const r = anchorRef.current!.getBoundingClientRect()
            const maxWidth = window.innerWidth - VIEWPORT_MARGIN * 2
            const width = Math.min(POPOVER_WIDTH, maxWidth)
            const left = Math.round((window.innerWidth - width) / 2)
            const bottom = Math.max(VIEWPORT_MARGIN, window.innerHeight - r.top + 8)
            setPos({ bottom, left, width })
        }
        update()
        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, true)
        return () => {
            window.removeEventListener('resize', update)
            window.removeEventListener('scroll', update, true)
        }
    }, [open, anchorRef])

    // Click outside / Esc dismiss.
    useEffect(() => {
        if (!open) return
        const onDoc = (e: MouseEvent): void => {
            const t = e.target as Node
            if (ref.current?.contains(t)) return
            if (anchorRef.current?.contains(t)) return
            onClose()
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
    }, [open, onClose, anchorRef])

    if (!open || !pos) return null

    const visible = origin
        ? spec.filter((s) => s.origin === origin)
        : []

    const commitRename = async (): Promise<void> => {
        if (!editing) return
        const { key, draft } = editing
        setEditing(null)
        await renameApi(key, draft.trim())
    }

    return createPortal(
        <div
            ref={ref}
            style={{
                position: 'fixed',
                bottom: pos.bottom,
                left: pos.left,
                width: pos.width,
                zIndex: 9999,
            }}
            className={cn(
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
                        const isEditing = editing?.key === s.key
                        return (
                            <div
                                key={s.key}
                                className={cn(
                                    'flex items-start gap-2 px-3 py-1.5 hover:bg-muted/50 group',
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
                                    className="size-3 cursor-pointer accent-primary shrink-0 mt-1"
                                />
                                <div className="flex-1 min-w-0">
                                    {isEditing ? (
                                        <div
                                            className="flex items-center gap-1"
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <input
                                                type="text"
                                                value={editing!.draft}
                                                autoFocus
                                                onChange={(e) =>
                                                    setEditing({
                                                        key: s.key,
                                                        draft: e.target.value,
                                                    })
                                                }
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') void commitRename()
                                                    if (e.key === 'Escape') setEditing(null)
                                                }}
                                                placeholder="Short name"
                                                className="flex-1 min-w-0 text-[11.5px] bg-background border border-border rounded px-1.5 py-0.5 outline-none focus:border-primary"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => void commitRename()}
                                                title="Save name"
                                                className="text-success p-0.5 rounded hover:bg-muted"
                                            >
                                                <Check className="size-3" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setEditing(null)}
                                                title="Cancel"
                                                className="text-muted-foreground p-0.5 rounded hover:bg-muted"
                                            >
                                                <X className="size-3" />
                                            </button>
                                        </div>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                openBank(s.key)
                                                onClose()
                                            }}
                                            className="w-full text-left"
                                        >
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-[11.5px] font-medium truncate flex-1">
                                                    {s.name ?? (
                                                        <span className="text-muted-foreground italic font-serif">
                                                            naming…
                                                        </span>
                                                    )}
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
                                            </div>
                                            <div className="flex items-center gap-1.5 mt-0.5">
                                                <span
                                                    className={cn(
                                                        'font-mono text-[9.5px] font-bold w-9 shrink-0',
                                                        methodTone(s.method),
                                                    )}
                                                >
                                                    {s.method}
                                                </span>
                                                <span className="font-mono text-[10px] text-muted-foreground truncate flex-1">
                                                    {s.pathname}
                                                </span>
                                            </div>
                                        </button>
                                    )}
                                </div>
                                {!isEditing && (
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation()
                                            setEditing({
                                                key: s.key,
                                                draft: s.name ?? '',
                                            })
                                        }}
                                        title="Rename"
                                        className="text-muted-foreground hover:text-foreground p-0.5 rounded hover:bg-muted opacity-0 group-hover:opacity-100 mt-0.5"
                                    >
                                        <Pencil className="size-3" />
                                    </button>
                                )}
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
        </div>,
        document.body,
    )
}
