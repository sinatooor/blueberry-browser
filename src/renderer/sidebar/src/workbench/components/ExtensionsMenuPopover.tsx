import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Boxes, Loader2, Pencil, Power, Trash2 } from 'lucide-react'
import { cn } from '@common/lib/utils'
import { useWorkbench } from '../contexts/WorkbenchContext'
import type { SiteAugmentation } from '../../../../../common/types'

// Small popover anchored above the Build composer's "Extensions" button.
//
// Lists every saved augmentation (extension) for the current site:
//   - Toggle on/off — flips `enabled`, the auto-replayer reads this on every
//     page load. Toggling off does NOT remove the extension from the page
//     it's currently on; refresh the page to actually unmount.
//   - Trash — removes both the saved record and the live element from the page.
//   - Pencil ("Modify with AI") — drops the extension's name + script into
//     the chat composer's prompt with a "Modify this extension:" prefix and
//     leaves the popover. (Mode-switching to Build is handled by the chat
//     surface listener for the modify-extension event.)

const POPOVER_WIDTH = 340
const VIEWPORT_MARGIN = 8

interface ExtensionsMenuPopoverProps {
    open: boolean
    onClose: () => void
    anchorRef: React.RefObject<HTMLElement | null>
    onModify: (ext: SiteAugmentation) => void
}

export const ExtensionsMenuPopover: React.FC<ExtensionsMenuPopoverProps> = ({
    open,
    onClose,
    anchorRef,
    onModify,
}) => {
    const { domain } = useWorkbench()
    const [list, setList] = useState<SiteAugmentation[]>([])
    const [loading, setLoading] = useState(false)
    const ref = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState<{ bottom: number; left: number; width: number } | null>(null)

    const refresh = useCallback(async () => {
        if (!domain) {
            setList([])
            return
        }
        setLoading(true)
        try {
            const all = await window.workbench.extensionsList(domain)
            setList(all)
        } catch (err) {
            console.error('[extensions] list failed:', err)
        } finally {
            setLoading(false)
        }
    }, [domain])

    useEffect(() => {
        if (open) void refresh()
    }, [open, refresh])

    // Center horizontally in viewport, pin bottom 8 px above anchor.
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

    // Click-outside / Esc dismiss; clicks inside the anchor flow through to
    // its onClick handler so the same button toggles the popover.
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

    const handleToggle = useCallback(
        async (ext: SiteAugmentation) => {
            if (!domain) return
            await window.workbench.extensionsSetEnabled(domain, ext.id, !ext.enabled)
            await refresh()
        },
        [domain, refresh],
    )

    const handleRemove = useCallback(
        async (ext: SiteAugmentation) => {
            if (!domain) return
            await window.workbench.extensionsRemove(domain, ext.id)
            await refresh()
        },
        [domain, refresh],
    )

    if (!open || !pos) return null

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
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium flex items-center gap-1.5">
                    <Boxes className="size-3 text-primary" />
                    Extensions
                </div>
                <div className="text-[10.5px] font-mono text-foreground/80 truncate mt-0.5">
                    {domain ?? '(no active page)'}
                </div>
            </div>

            <div className="max-h-72 overflow-y-auto">
                {loading ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-[11px] text-muted-foreground">
                        <Loader2 className="size-3 animate-spin" />
                        Loading…
                    </div>
                ) : list.length === 0 ? (
                    <div className="px-3 py-6 text-[11px] text-muted-foreground text-center font-serif italic">
                        No extensions saved for this site yet — build one in the chat,
                        and after it runs cleanly the agent can save it for replay.
                    </div>
                ) : (
                    list.map((ext) => (
                        <div
                            key={ext.id}
                            className={cn(
                                'flex items-center gap-2 px-3 py-2 border-b border-border last:border-b-0 hover:bg-muted/40',
                                !ext.enabled && 'opacity-50',
                            )}
                        >
                            <button
                                type="button"
                                onClick={() => void handleToggle(ext)}
                                title={
                                    ext.enabled
                                        ? 'Enabled — auto-replays on every page load. Click to disable.'
                                        : 'Disabled — won\'t replay. Click to re-enable.'
                                }
                                className={cn(
                                    'shrink-0 size-5 rounded flex items-center justify-center',
                                    ext.enabled
                                        ? 'bg-primary text-primary-foreground'
                                        : 'border border-border text-muted-foreground hover:bg-muted',
                                )}
                            >
                                <Power className="size-3" />
                            </button>
                            <div className="flex-1 min-w-0">
                                <div className="text-[11px] font-medium truncate">
                                    {ext.name || ext.id}
                                </div>
                                <div className="text-[9.5px] font-mono text-muted-foreground truncate">
                                    {ext.id}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => {
                                    onModify(ext)
                                    onClose()
                                }}
                                title="Ask the AI to modify this extension"
                                className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted"
                            >
                                <Pencil className="size-3" />
                            </button>
                            <button
                                type="button"
                                onClick={() => void handleRemove(ext)}
                                title="Remove this extension permanently"
                                className="text-muted-foreground hover:text-destructive p-1 rounded hover:bg-destructive/10"
                            >
                                <Trash2 className="size-3" />
                            </button>
                        </div>
                    ))
                )}
            </div>
        </div>,
        document.body,
    )
}
