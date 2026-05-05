import React, { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@common/lib/utils'

// Vertical-split layout (top + bottom panes) with a draggable height
// divider in between. Drag with the mouse from the divider to resize.
//
// Height is stored as a 0..1 ratio of the container's measured height so
// the split adapts to window resizes; the ratio is persisted to
// localStorage under the given storageKey.
//
// Usage:
//   <ResizableSplit storageKey="bb:apibank-split" minTopRatio={0.18}>
//     <ListView />
//     <DetailView />
//   </ResizableSplit>

interface ResizableSplitProps {
    storageKey: string
    /** Both panes get clamped to at least this fraction (default 0.15). */
    minTopRatio?: number
    /** And no more than this fraction (default 0.85). */
    maxTopRatio?: number
    /** Initial ratio if nothing is in storage yet (default 0.5). */
    defaultRatio?: number
    children: [React.ReactNode, React.ReactNode]
}

export const ResizableSplit: React.FC<ResizableSplitProps> = ({
    storageKey,
    minTopRatio = 0.15,
    maxTopRatio = 0.85,
    defaultRatio = 0.5,
    children,
}) => {
    const containerRef = useRef<HTMLDivElement>(null)
    const [ratio, setRatio] = useState<number>(() => {
        if (typeof window === 'undefined') return defaultRatio
        const raw = localStorage.getItem(storageKey)
        if (!raw) return defaultRatio
        const n = Number(raw)
        if (!Number.isFinite(n)) return defaultRatio
        return clamp(n, minTopRatio, maxTopRatio)
    })
    const [dragging, setDragging] = useState(false)

    useEffect(() => {
        try {
            localStorage.setItem(storageKey, String(ratio))
        } catch {
            // ignore
        }
    }, [storageKey, ratio])

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault()
        setDragging(true)
    }, [])

    useEffect(() => {
        if (!dragging) return
        const onMove = (e: MouseEvent): void => {
            const c = containerRef.current
            if (!c) return
            const rect = c.getBoundingClientRect()
            if (rect.height <= 0) return
            const raw = (e.clientY - rect.top) / rect.height
            setRatio(clamp(raw, minTopRatio, maxTopRatio))
        }
        const onUp = (): void => setDragging(false)
        // Capture pointer-style events on window so dragging is smooth
        // even when the cursor leaves the divider.
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        // Lock the cursor + select-none body class while dragging.
        const prevCursor = document.body.style.cursor
        const prevUserSelect = document.body.style.userSelect
        document.body.style.cursor = 'ns-resize'
        document.body.style.userSelect = 'none'
        return () => {
            window.removeEventListener('mousemove', onMove)
            window.removeEventListener('mouseup', onUp)
            document.body.style.cursor = prevCursor
            document.body.style.userSelect = prevUserSelect
        }
    }, [dragging, minTopRatio, maxTopRatio])

    return (
        <div ref={containerRef} className="flex flex-col flex-1 min-h-0">
            <div
                className="min-h-0 overflow-hidden"
                style={{ flex: `${ratio} 1 0` }}
            >
                {children[0]}
            </div>
            <div
                role="separator"
                aria-orientation="horizontal"
                onMouseDown={onMouseDown}
                className={cn(
                    'group relative h-1 shrink-0 cursor-ns-resize bg-border',
                    'hover:bg-primary/30 transition-colors',
                    dragging && 'bg-primary/40',
                )}
            >
                {/* A wider hit-target so the user can grab without pixel
                    precision; the visible bar stays slim. */}
                <div className="absolute inset-x-0 -top-1 -bottom-1" />
            </div>
            <div
                className="min-h-0 overflow-hidden"
                style={{ flex: `${1 - ratio} 1 0` }}
            >
                {children[1]}
            </div>
        </div>
    )
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n))
}
