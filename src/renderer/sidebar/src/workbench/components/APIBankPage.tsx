import React, { useEffect, useMemo, useState } from 'react'
import {
    BookOpen,
    Search,
    X,
    ShieldAlert,
    Pencil,
    Plus,
    RefreshCw,
} from 'lucide-react'
import { cn } from '@common/lib/utils'
import { useApiBank, type BankFilter } from '../contexts/ApiBankContext'
import { EndpointDetail } from './EndpointDetail'
import type { EndpointSpec } from '../../../../../common/types'

// Full-overlay page that takes over the sidebar's main content while open.
// The user lands here from the APIs menu (clicking an entry → focus that
// endpoint; "Add API" → no selection); they leave via the close button or
// the Esc key.
//
// Layout: top toolbar (filter dropdown + search + close), then a list (top)
// + detail (bottom) split. Toggle checkboxes in the list mirror the popover
// state — disabled APIs are dimmed and excluded from the LLM context.

const FILTER_LABEL: Record<BankFilter, string> = {
    'this-site': 'This site',
    all: 'All sites',
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

const RowItem: React.FC<{
    spec: EndpointSpec
    enabled: boolean
    selected: boolean
    onSelect: () => void
    onToggle: () => void
    showOrigin: boolean
}> = ({ spec, enabled, selected, onSelect, onToggle, showOrigin }) => (
    <div
        className={cn(
            'flex items-center gap-2 px-3 py-1.5 hover:bg-muted/40 border-l-2',
            selected ? 'border-l-primary bg-primary/5' : 'border-l-transparent',
            !enabled && 'opacity-50',
        )}
    >
        <input
            type="checkbox"
            checked={enabled}
            onChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            className="size-3 cursor-pointer accent-primary shrink-0"
            title={
                enabled
                    ? 'Enabled — included in LLM context'
                    : 'Disabled — hidden from LLM'
            }
        />
        <button
            type="button"
            onClick={onSelect}
            className="flex-1 min-w-0 text-left flex items-center gap-1.5"
        >
            <span
                className={cn(
                    'font-mono text-[10px] font-bold w-10 shrink-0',
                    methodTone(spec.method),
                )}
            >
                {spec.method}
            </span>
            <div className="flex-1 min-w-0">
                <div className="font-mono text-[11px] truncate">{spec.pathname}</div>
                {showOrigin && (
                    <div className="font-mono text-[9.5px] text-muted-foreground truncate">
                        {spec.origin}
                    </div>
                )}
            </div>
            {spec.hasCsrfHint && (
                <ShieldAlert className="size-3 text-warning shrink-0" />
            )}
            {isMutating(spec.method) && (
                <Pencil className="size-3 text-warning shrink-0" />
            )}
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                ×{spec.count}
            </span>
        </button>
    </div>
)

export const APIBankPage: React.FC = () => {
    const {
        spec,
        origin,
        refresh,
        refreshing,
        isEnabled,
        toggleEnabled,
        bankSelectedKey,
        setBankSelected,
        bankFilter,
        setBankFilter,
        closeBank,
    } = useApiBank()
    const [search, setSearch] = useState('')

    // Esc dismisses.
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') closeBank()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [closeBank])

    const filtered = useMemo(() => {
        let list = spec
        if (bankFilter === 'this-site' && origin) {
            list = list.filter((s) => s.origin === origin)
        }
        const q = search.trim().toLowerCase()
        if (q) {
            list = list.filter(
                (s) =>
                    s.pathname.toLowerCase().includes(q) ||
                    s.origin.toLowerCase().includes(q) ||
                    s.method.toLowerCase().includes(q),
            )
        }
        return list
    }, [spec, bankFilter, origin, search])

    const selected =
        filtered.find((s) => s.key === bankSelectedKey) ?? filtered[0] ?? null

    const enabledCount = filtered.filter((s) => isEnabled(s.origin, s.key)).length

    return (
        <div className="absolute inset-0 z-30 bg-background flex flex-col animate-fade-in">
            {/* Top toolbar */}
            <div className="px-3 py-2 border-b border-border bg-card flex items-center gap-2">
                <BookOpen className="size-4 text-primary shrink-0" />
                <div className="text-[12px] font-medium">API Bank</div>
                <span className="text-[10px] text-muted-foreground">
                    {enabledCount}/{filtered.length} enabled
                </span>
                <div className="flex-1" />
                <button
                    type="button"
                    onClick={() => void refresh()}
                    title="Refresh"
                    disabled={refreshing}
                    className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted disabled:opacity-50"
                >
                    <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
                </button>
                <button
                    type="button"
                    onClick={closeBank}
                    title="Close (Esc)"
                    className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted"
                >
                    <X className="size-4" />
                </button>
            </div>

            {/* Filter row */}
            <div className="px-3 py-2 border-b border-border bg-surface flex items-center gap-2">
                <select
                    value={bankFilter}
                    onChange={(e) => setBankFilter(e.target.value as BankFilter)}
                    className="text-[11px] px-2 py-1 rounded border border-border bg-background outline-none focus:border-primary/30"
                >
                    {(['this-site', 'all'] as const).map((f) => (
                        <option key={f} value={f}>
                            {FILTER_LABEL[f]}
                            {f === 'this-site' && origin ? ` · ${origin}` : ''}
                        </option>
                    ))}
                </select>
                <div className="flex-1 relative">
                    <Search className="size-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="filter url, method"
                        className="w-full text-[11px] pl-7 pr-2 py-1 rounded border border-border bg-background outline-none focus:border-primary/30"
                    />
                </div>
                <button
                    type="button"
                    title="Add API (manual entry — coming soon)"
                    disabled
                    className="flex items-center gap-1 text-[10.5px] px-2 py-1 rounded border border-border opacity-40 cursor-not-allowed"
                >
                    <Plus className="size-3" />
                    Add API
                </button>
            </div>

            {/* List + detail */}
            <div className="grid grid-rows-[1fr_1fr] flex-1 min-h-0">
                <div className="overflow-y-auto border-b border-border">
                    {filtered.length === 0 ? (
                        <div className="p-8 text-center text-[11px] text-muted-foreground font-serif italic">
                            {bankFilter === 'this-site'
                                ? 'No JSON endpoints captured for this site yet — interact with the page so it makes XHR/fetch calls.'
                                : 'Nothing captured yet on any origin.'}
                        </div>
                    ) : (
                        filtered.map((s) => (
                            <RowItem
                                key={s.key}
                                spec={s}
                                enabled={isEnabled(s.origin, s.key)}
                                selected={selected?.key === s.key}
                                onSelect={() => setBankSelected(s.key)}
                                onToggle={() => toggleEnabled(s.origin, s.key)}
                                showOrigin={bankFilter === 'all'}
                            />
                        ))
                    )}
                </div>
                <div className="overflow-y-auto">
                    {selected ? (
                        <EndpointDetail spec={selected} />
                    ) : (
                        <div className="p-8 text-center text-[11px] text-muted-foreground font-serif italic">
                            Select an endpoint to inspect its headers and shape.
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
