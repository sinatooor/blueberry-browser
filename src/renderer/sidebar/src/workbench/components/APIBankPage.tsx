import React, { useEffect, useMemo, useState } from 'react'
import {
    BookOpen,
    Search,
    X,
    ShieldAlert,
    Pencil,
    Plus,
    RefreshCw,
    Trash2,
} from 'lucide-react'
import { cn } from '@common/lib/utils'
import { useApiBank, type BankFilter } from '../contexts/ApiBankContext'
import { EndpointDetail } from './EndpointDetail'
import { ResizableSplit } from './ResizableSplit'
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
        addManualApi,
        removeApiByKey,
    } = useApiBank()
    const [search, setSearch] = useState('')
    const [addOpen, setAddOpen] = useState(false)

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
                    onClick={() => setAddOpen((v) => !v)}
                    title="Manually add an API (URL + method + sample response)"
                    className={cn(
                        'flex items-center gap-1 text-[10.5px] px-2 py-1 rounded border',
                        addOpen
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border hover:bg-muted',
                    )}
                >
                    <Plus className="size-3" />
                    Add API
                </button>
            </div>

            {addOpen && (
                <AddApiForm
                    defaultOrigin={origin ?? ''}
                    onSubmit={async (args) => {
                        const created = await addManualApi(args)
                        setAddOpen(false)
                        setBankSelected(created.key)
                    }}
                    onCancel={() => setAddOpen(false)}
                />
            )}

            {/* List + detail with a draggable height divider. */}
            <ResizableSplit storageKey="bb:apibank-split">
                <div className="overflow-y-auto h-full">
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
                <div className="overflow-y-auto h-full">
                    {selected ? (
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => void removeApiByKey(selected.key)}
                                className="absolute top-2 right-2 z-10 flex items-center gap-1 text-[10px] text-muted-foreground hover:text-destructive px-2 py-0.5 rounded hover:bg-destructive/10"
                                title="Remove this endpoint from the catalog"
                            >
                                <Trash2 className="size-3" />
                                Remove
                            </button>
                            <EndpointDetail spec={selected} />
                        </div>
                    ) : (
                        <div className="p-8 text-center text-[11px] text-muted-foreground font-serif italic">
                            Select an endpoint to inspect its headers and shape.
                        </div>
                    )}
                </div>
            </ResizableSplit>
        </div>
    )
}

interface AddApiFormProps {
    defaultOrigin: string
    onSubmit: (args: {
        origin: string
        method: string
        pathname: string
        url: string
        sampleResponse?: string
    }) => Promise<void>
    onCancel: () => void
}

const AddApiForm: React.FC<AddApiFormProps> = ({
    defaultOrigin,
    onSubmit,
    onCancel,
}) => {
    const [url, setUrl] = useState('')
    const [method, setMethod] = useState('GET')
    const [sample, setSample] = useState('')
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    const handleSubmit = async (): Promise<void> => {
        setErr(null)
        let parsed: URL
        try {
            parsed = new URL(url)
        } catch {
            setErr('Enter a full URL like https://example.com/api/foo')
            return
        }
        setBusy(true)
        try {
            await onSubmit({
                origin: parsed.origin,
                method,
                pathname: parsed.pathname,
                url,
                sampleResponse: sample.trim() || undefined,
            })
            setUrl('')
            setSample('')
        } catch (e) {
            setErr(e instanceof Error ? e.message : String(e))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="px-3 py-3 border-b border-border bg-card/40 space-y-2">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
                Add API
            </div>
            <div className="text-[10.5px] text-muted-foreground/80">
                Defaults to{' '}
                <span className="font-mono">{defaultOrigin || '(no active site)'}</span>.
                Paste a URL — origin and path are derived from it.
            </div>
            <div className="flex gap-1.5">
                <select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    className="text-[11px] px-1.5 py-1 rounded border border-border bg-background outline-none font-mono"
                >
                    {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                        <option key={m} value={m}>
                            {m}
                        </option>
                    ))}
                </select>
                <input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={`${defaultOrigin || 'https://example.com'}/api/foo`}
                    className="flex-1 text-[11px] px-2 py-1 rounded border border-border bg-background outline-none focus:border-primary/30 font-mono"
                />
            </div>
            <textarea
                value={sample}
                onChange={(e) => setSample(e.target.value)}
                placeholder="Optional: paste a sample JSON response so the LLM knows the shape"
                rows={4}
                className="w-full text-[10.5px] px-2 py-1 rounded border border-border bg-background outline-none focus:border-primary/30 font-mono resize-y"
            />
            {err && (
                <div className="text-[10.5px] text-destructive bg-destructive/10 border border-destructive/20 rounded p-1.5">
                    {err}
                </div>
            )}
            <div className="flex gap-1.5 justify-end">
                <button
                    type="button"
                    onClick={onCancel}
                    className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={busy || !url.trim()}
                    className="text-[11px] px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
                >
                    {busy ? 'Adding…' : 'Add to Bank'}
                </button>
            </div>
        </div>
    )
}
