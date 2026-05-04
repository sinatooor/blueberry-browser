import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import {
    Wand2,
    Loader2,
    PlayCircle,
    AlertTriangle,
    ShieldCheck,
    ShieldAlert,
    Cookie,
    Pencil,
    ChevronRight,
    Trash2,
    RefreshCw,
} from 'lucide-react'
import { cn } from '@common/lib/utils'
import { SchemaTree } from './SchemaTree'
import type {
    BuiltFeature,
    EndpointSpec,
} from '../../../../../common/types'

type RunStatus =
    | { kind: 'idle' }
    | { kind: 'running' }
    | { kind: 'success'; value: unknown }
    | { kind: 'error'; error: string }

const POLL_INTERVAL_MS = 2000
const STORAGE_KEY = 'bb:build-composer:expanded'

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

const EndpointRow: React.FC<{ endpoint: EndpointSpec }> = ({ endpoint }) => {
    const [open, setOpen] = useState(false)
    const headerEntries = Object.entries(endpoint.requestHeaders).filter(
        ([k]) => !k.startsWith(':'),
    )
    return (
        <div className="border border-border rounded-md overflow-hidden bg-card">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-muted/40 text-left"
            >
                <ChevronRight
                    className={cn(
                        'size-3 text-muted-foreground transition-transform',
                        open && 'rotate-90',
                    )}
                />
                <span
                    className={cn(
                        'font-mono text-[10px] font-bold w-12 shrink-0',
                        methodTone(endpoint.method),
                    )}
                >
                    {endpoint.method}
                </span>
                <span className="font-mono text-[11px] flex-1 truncate" title={endpoint.pathname}>
                    {endpoint.pathname}
                </span>
                {endpoint.responseStatus != null && (
                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                        {endpoint.responseStatus}
                    </span>
                )}
                {endpoint.hasCsrfHint && (
                    <ShieldAlert className="size-3 text-warning" aria-label="csrf header" />
                )}
                {isMutating(endpoint.method) && (
                    <Pencil className="size-3 text-warning" aria-label="mutating" />
                )}
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                    ×{endpoint.count}
                </span>
            </button>

            {open && (
                <div className="px-2 pb-2 pt-1 flex flex-col gap-2 bg-muted/15 border-t border-border">
                    {endpoint.queryKeys.length > 0 && (
                        <div>
                            <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">
                                Query
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {endpoint.queryKeys.map((k) => (
                                    <span
                                        key={k}
                                        className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded"
                                    >
                                        {k}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {headerEntries.length > 0 && (
                        <div>
                            <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                                <Cookie className="size-3" />
                                Headers (sensitive values redacted)
                            </div>
                            <div className="font-mono text-[10px] space-y-0.5 max-h-28 overflow-y-auto">
                                {headerEntries.map(([k, v]) => (
                                    <div key={k} className="flex gap-2">
                                        <span className="text-muted-foreground">{k}:</span>
                                        <span
                                            className={cn(
                                                'truncate',
                                                v === '<redacted>' && 'text-warning',
                                            )}
                                        >
                                            {v}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {endpoint.requestBodySchema && (
                        <div>
                            <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">
                                Request body shape
                            </div>
                            <SchemaTree node={endpoint.requestBodySchema} defaultOpen />
                        </div>
                    )}

                    {endpoint.responseSchema ? (
                        <div>
                            <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">
                                Response shape
                            </div>
                            <SchemaTree node={endpoint.responseSchema} defaultOpen />
                        </div>
                    ) : (
                        <div className="text-[10px] text-muted-foreground italic">
                            No JSON response captured (non-JSON, oversize, or streaming).
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

const SafetyTag: React.FC<{
    icon: React.ReactNode
    label: string
    danger: boolean
}> = ({ icon, label, danger }) => (
    <div
        className={cn(
            'flex items-center gap-1.5 rounded px-2 py-1 text-[10.5px]',
            danger
                ? 'bg-warning/15 text-warning border border-warning/20'
                : 'bg-muted/40 text-muted-foreground border border-border',
        )}
    >
        {icon}
        <span>{label}</span>
    </div>
)

const ApprovalCard: React.FC<{
    feature: BuiltFeature
    runStatus: RunStatus
    onRun: () => void
    onDiscard: () => void
}> = ({ feature, runStatus, onRun, onDiscard }) => {
    const [showCode, setShowCode] = useState(false)
    const danger =
        feature.mutates_data ||
        feature.warnings.length > 0 ||
        feature.uses_csrf

    return (
        <div
            className={cn(
                'border rounded-lg p-3 flex flex-col gap-3 bg-card',
                danger ? 'border-warning/40' : 'border-border',
            )}
        >
            <div className="flex items-start gap-2">
                {danger ? (
                    <AlertTriangle className="size-4 text-warning mt-0.5 shrink-0" />
                ) : (
                    <ShieldCheck className="size-4 text-success mt-0.5 shrink-0" />
                )}
                <div className="flex-1">
                    <div className="text-[12px] font-medium">Review before running</div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 font-serif italic">
                        {feature.description || '(no description)'}
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
                <SafetyTag
                    icon={<Pencil className="size-3" />}
                    label={feature.mutates_data ? 'Mutates data' : 'Read-only'}
                    danger={feature.mutates_data}
                />
                <SafetyTag
                    icon={<Cookie className="size-3" />}
                    label={feature.uses_cookies ? 'Uses your cookies' : 'No cookies'}
                    danger={feature.uses_cookies}
                />
                <SafetyTag
                    icon={<ShieldAlert className="size-3" />}
                    label={feature.uses_csrf ? 'Reuses CSRF token' : 'No CSRF token'}
                    danger={feature.uses_csrf}
                />
                <SafetyTag
                    icon={<Wand2 className="size-3" />}
                    label={
                        feature.ui_changes && feature.ui_changes !== 'none'
                            ? 'Injects UI'
                            : 'No UI'
                    }
                    danger={false}
                />
            </div>

            {feature.warnings.length > 0 && (
                <div className="text-[10.5px] bg-warning/10 border border-warning/20 rounded p-2 space-y-0.5">
                    <div className="font-medium text-warning flex items-center gap-1 mb-0.5">
                        <AlertTriangle className="size-3" />
                        Static-analysis warnings
                    </div>
                    <ul className="text-foreground/80 list-disc list-inside space-y-0.5">
                        {feature.warnings.map((w, i) => (
                            <li key={i}>{w}</li>
                        ))}
                    </ul>
                </div>
            )}

            {feature.endpoints_used.length > 0 ? (
                <div>
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">
                        Will call
                    </div>
                    <div className="flex flex-col gap-1">
                        {feature.endpoints_used.map((e, i) => (
                            <code
                                key={i}
                                className="text-[10.5px] font-mono bg-background rounded px-2 py-1 border border-border"
                            >
                                {e}
                            </code>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="text-[10.5px] text-muted-foreground italic">
                    Script does not call backend endpoints (DOM-only).
                </div>
            )}

            <div>
                <button
                    type="button"
                    onClick={() => setShowCode((v) => !v)}
                    className="text-[10.5px] text-primary hover:underline"
                >
                    {showCode ? 'Hide' : 'Show'} generated code ({feature.code.length} chars)
                </button>
                {showCode && (
                    <pre className="mt-1 max-h-64 overflow-auto bg-background border border-border rounded p-2 text-[10.5px] font-mono whitespace-pre-wrap break-all">
                        {feature.code}
                    </pre>
                )}
            </div>

            <div className="flex gap-2">
                <button
                    type="button"
                    onClick={onRun}
                    disabled={runStatus.kind === 'running'}
                    className={cn(
                        'flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-md transition-opacity disabled:opacity-50',
                        danger
                            ? 'bg-destructive text-white hover:opacity-90'
                            : 'bg-primary text-primary-foreground hover:opacity-90',
                    )}
                >
                    {runStatus.kind === 'running' ? (
                        <>
                            <Loader2 className="size-3 animate-spin" /> Running…
                        </>
                    ) : (
                        <>
                            <PlayCircle className="size-3" />
                            {danger ? 'Approve & Run' : 'Run in tab'}
                        </>
                    )}
                </button>
                <button
                    type="button"
                    onClick={onDiscard}
                    disabled={runStatus.kind === 'running'}
                    className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-50"
                >
                    Discard
                </button>
            </div>

            {runStatus.kind === 'success' && (
                <div className="text-[11px] text-success">
                    ✓ Script ran. Check the tab — UI was injected with id <code>#bb-feature</code>.
                    {runStatus.value !== undefined && runStatus.value !== null && (
                        <pre className="mt-1 max-h-32 overflow-auto bg-background border border-border rounded p-2 text-[10.5px] font-mono whitespace-pre-wrap">
                            {(() => {
                                try {
                                    return JSON.stringify(runStatus.value, null, 2)
                                } catch {
                                    return String(runStatus.value)
                                }
                            })()}
                        </pre>
                    )}
                </div>
            )}
            {runStatus.kind === 'error' && (
                <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/20 rounded p-2 break-all">
                    Error: {runStatus.error}
                </div>
            )}
        </div>
    )
}

export const BuildComposer: React.FC = () => {
    const [endpoints, setEndpoints] = useState<EndpointSpec[]>([])
    const [origin, setOrigin] = useState<string | null>(null)
    const [tabId, setTabId] = useState<string | null>(null)
    const [prompt, setPrompt] = useState('')
    const [building, setBuilding] = useState(false)
    const [buildError, setBuildError] = useState<string | null>(null)
    const [feature, setFeature] = useState<BuiltFeature | null>(null)
    const [runStatus, setRunStatus] = useState<RunStatus>({ kind: 'idle' })
    const [expanded, setExpanded] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false
        return localStorage.getItem(STORAGE_KEY) === '1'
    })
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, expanded ? '1' : '0')
        } catch {
            // ignore
        }
    }, [expanded])

    const refresh = useCallback(async () => {
        try {
            const res = await window.workbench.getFeatureSpec()
            setEndpoints(res.endpoints)
            setOrigin(res.origin)
            setTabId(res.tabId)
        } catch (err) {
            console.error('getFeatureSpec failed:', err)
        }
    }, [])

    useEffect(() => {
        void refresh()
        const id = setInterval(refresh, POLL_INTERVAL_MS)
        return () => clearInterval(id)
    }, [refresh])

    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            textareaRef.current.style.height = `${Math.min(
                textareaRef.current.scrollHeight,
                160,
            )}px`
        }
    }, [prompt])

    const handleBuild = useCallback(async () => {
        if (!prompt.trim() || !tabId) return
        setBuilding(true)
        setBuildError(null)
        setFeature(null)
        setRunStatus({ kind: 'idle' })
        try {
            const result = await window.workbench.buildFeature(prompt.trim(), tabId)
            setFeature(result)
        } catch (err) {
            setBuildError(err instanceof Error ? err.message : String(err))
        } finally {
            setBuilding(false)
        }
    }, [prompt, tabId])

    const handleRun = useCallback(async () => {
        if (!feature || !tabId) return
        setRunStatus({ kind: 'running' })
        try {
            const res = await window.workbench.runFeature(feature.code, tabId)
            if (res.ok) {
                setRunStatus({ kind: 'success', value: res.value })
            } else {
                setRunStatus({ kind: 'error', error: res.error })
            }
        } catch (err) {
            setRunStatus({
                kind: 'error',
                error: err instanceof Error ? err.message : String(err),
            })
        }
    }, [feature, tabId])

    const handleDiscard = useCallback(() => {
        setFeature(null)
        setRunStatus({ kind: 'idle' })
    }, [])

    const handleClearSpec = useCallback(async () => {
        await window.workbench.clearNetwork()
        await refresh()
    }, [refresh])

    const captureSummary = useMemo(() => {
        if (endpoints.length === 0) {
            return origin
                ? `No JSON endpoints captured for ${origin} yet — interact with the page so it makes XHR/fetch calls.`
                : 'Open a tab and interact with it to capture APIs.'
        }
        return `${endpoints.length} endpoint${endpoints.length === 1 ? '' : 's'} captured for ${origin ?? 'this origin'}`
    }, [endpoints.length, origin])

    return (
        <div className="border-b border-border bg-card/40">
            <div className="px-4 py-3 flex items-center gap-2 border-b border-border">
                <Wand2 className="size-3.5 text-primary" />
                <div className="flex-1">
                    <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                        Build a feature
                    </div>
                    <div className="text-[11px] text-muted-foreground/80 mt-0.5 font-serif italic">
                        Describe what you want — the browser uses sniffed APIs + your cookies to build it.
                    </div>
                </div>
                <button
                    type="button"
                    onClick={refresh}
                    title="Refresh captured spec"
                    className="text-muted-foreground hover:text-foreground"
                >
                    <RefreshCw className="size-3.5" />
                </button>
                <button
                    type="button"
                    onClick={handleClearSpec}
                    title="Clear captured network"
                    className="text-muted-foreground hover:text-foreground"
                >
                    <Trash2 className="size-3.5" />
                </button>
            </div>

            <div className="px-4 py-3 flex flex-col gap-3">
                <textarea
                    ref={textareaRef}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault()
                            void handleBuild()
                        }
                    }}
                    placeholder="e.g. Add a button that exports my watch history as CSV"
                    className={cn(
                        'w-full resize-none rounded-md border border-border bg-background',
                        'p-2.5 text-[12px] outline-none focus:border-primary/30',
                        'min-h-[52px] max-h-[160px]',
                    )}
                    disabled={building}
                />
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handleBuild}
                        disabled={building || !prompt.trim() || !tabId}
                        className={cn(
                            'flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-md',
                            'bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40',
                        )}
                    >
                        {building ? (
                            <>
                                <Loader2 className="size-3 animate-spin" /> Generating…
                            </>
                        ) : (
                            <>
                                <Wand2 className="size-3" /> Generate
                            </>
                        )}
                    </button>
                    <span className="text-[10.5px] text-muted-foreground flex-1">
                        {captureSummary}
                    </span>
                </div>

                {buildError && (
                    <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/20 rounded p-2">
                        {buildError}
                    </div>
                )}

                {feature && (
                    <ApprovalCard
                        feature={feature}
                        runStatus={runStatus}
                        onRun={handleRun}
                        onDiscard={handleDiscard}
                    />
                )}

                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="text-[10.5px] text-muted-foreground hover:text-foreground self-start flex items-center gap-1"
                >
                    <ChevronRight
                        className={cn(
                            'size-3 transition-transform',
                            expanded && 'rotate-90',
                        )}
                    />
                    {expanded ? 'Hide' : 'Show'} captured APIs ({endpoints.length})
                </button>

                {expanded && (
                    <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto">
                        {endpoints.length === 0 ? (
                            <div className="text-[11px] text-muted-foreground italic text-center py-4">
                                Nothing captured yet on this origin.
                            </div>
                        ) : (
                            endpoints.map((e) => <EndpointRow key={e.key} endpoint={e} />)
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
