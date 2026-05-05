import React, { useState } from 'react'
import {
    AlertTriangle,
    ArrowRight,
    ChevronDown,
    ChevronRight,
    Cookie,
    Loader2,
    Pencil,
    PlayCircle,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
    Wand2,
} from 'lucide-react'
import { cn } from '@common/lib/utils'
import type {
    AgentStep,
    BuiltFeature,
    RiskLevel,
    StepStatus,
} from '../../../../../common/types'
import { useThread, type BuildRunStatus, type ThreadEvent } from '../contexts/ThreadContext'

// Each event kind gets its own card. Cards share a consistent left rail so
// the thread reads top-to-bottom as a single conversation regardless of
// which mode produced each event.

const Bubble: React.FC<{
    align?: 'left' | 'right'
    tone?: 'user' | 'assistant' | 'note' | 'card'
    children: React.ReactNode
    className?: string
}> = ({ align = 'left', tone = 'card', children, className }) => (
    <div
        className={cn(
            'animate-fade-in max-w-full',
            align === 'right' ? 'ml-auto max-w-[85%]' : 'mr-auto max-w-full',
        )}
    >
        <div
            className={cn(
                'rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed',
                tone === 'user' && 'bg-muted text-foreground',
                tone === 'assistant' && 'bg-transparent text-foreground',
                tone === 'note' && 'border border-border bg-card',
                tone === 'card' && 'border border-border bg-card',
                className,
            )}
        >
            {children}
        </div>
    </div>
)

// ────────── User ──────────

const UserCard: React.FC<{ text: string; mode: ThreadEvent['kind'] extends 'user' ? string : string }> = ({
    text,
}) => (
    <Bubble align="right" tone="user">
        <div style={{ whiteSpace: 'pre-wrap' }}>{text}</div>
    </Bubble>
)

// ────────── Assistant (plain chat) ──────────

const AssistantCard: React.FC<{ text: string; isStreaming: boolean }> = ({
    text,
    isStreaming,
}) => (
    <Bubble align="left" tone="assistant" className="!p-0 !bg-transparent">
        <div className="text-foreground whitespace-pre-wrap">
            {text || (isStreaming ? '' : '(empty)')}
            {isStreaming && (
                <span className="inline-block w-2 h-4 bg-primary/60 ml-0.5 animate-pulse align-text-bottom" />
            )}
        </div>
    </Bubble>
)

// ────────── Note ──────────

const NoteCard: React.FC<{
    tone: 'info' | 'warn' | 'error' | 'success'
    title: string
    body?: string
}> = ({ tone, title, body }) => {
    const cls = {
        info: 'border-border bg-muted/30 text-foreground',
        warn: 'border-warning/40 bg-warning/10 text-foreground',
        error: 'border-destructive/40 bg-destructive/10 text-destructive',
        success: 'border-success/40 bg-success/10 text-foreground',
    }[tone]
    return (
        <Bubble tone="card" className={cn('!py-2 !px-3', cls)}>
            <div className="text-[12px] font-medium">{title}</div>
            {body && (
                <div className="text-[11.5px] mt-0.5 text-muted-foreground break-words">
                    {body}
                </div>
            )}
        </Bubble>
    )
}

// ────────── Build (extension generated) ──────────

const SafetyTag: React.FC<{
    icon: React.ReactNode
    label: string
    danger: boolean
}> = ({ icon, label, danger }) => (
    <div
        className={cn(
            'flex items-center gap-1.5 rounded px-2 py-0.5 text-[10.5px]',
            danger
                ? 'bg-warning/15 text-warning border border-warning/20'
                : 'bg-muted/40 text-muted-foreground border border-border',
        )}
    >
        {icon}
        {label}
    </div>
)

const BuildCard: React.FC<{
    eventId: string
    feature: BuiltFeature
    runStatus: BuildRunStatus
}> = ({ eventId, feature, runStatus }) => {
    const { runBuiltFeature, discardBuiltFeature } = useThread()
    const [showCode, setShowCode] = useState(false)
    const danger =
        feature.mutates_data || feature.warnings.length > 0 || feature.uses_csrf

    return (
        <Bubble
            tone="card"
            className={cn(
                'flex flex-col gap-2.5 !py-3',
                danger && '!border-warning/40',
            )}
        >
            <div className="flex items-start gap-2">
                <Wand2 className="size-4 text-primary mt-0.5 shrink-0" />
                <div className="flex-1">
                    <div className="text-[12px] font-medium">Generated extension</div>
                    <p className="text-[11.5px] text-muted-foreground mt-0.5 font-serif italic">
                        {feature.description || '(no description)'}
                    </p>
                </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
                <SafetyTag
                    icon={<Pencil className="size-3" />}
                    label={feature.mutates_data ? 'Mutates data' : 'Read-only'}
                    danger={feature.mutates_data}
                />
                <SafetyTag
                    icon={<Cookie className="size-3" />}
                    label={feature.uses_cookies ? 'Uses cookies' : 'No cookies'}
                    danger={feature.uses_cookies}
                />
                <SafetyTag
                    icon={<ShieldAlert className="size-3" />}
                    label={feature.uses_csrf ? 'Uses CSRF token' : 'No CSRF'}
                    danger={feature.uses_csrf}
                />
                <SafetyTag
                    icon={<Sparkles className="size-3" />}
                    label={
                        feature.ui_changes && feature.ui_changes !== 'none' ? 'Injects UI' : 'No UI'
                    }
                    danger={false}
                />
            </div>

            {feature.warnings.length > 0 && (
                <div className="text-[10.5px] bg-warning/10 border border-warning/20 rounded p-1.5 space-y-0.5">
                    <div className="font-medium text-warning flex items-center gap-1 mb-0.5">
                        <AlertTriangle className="size-3" />
                        Warnings
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
                    DOM-only — no backend calls.
                </div>
            )}

            <div>
                <button
                    type="button"
                    onClick={() => setShowCode((v) => !v)}
                    className="text-[10.5px] text-primary hover:underline"
                >
                    {showCode ? 'Hide' : 'Show'} code ({feature.code.length} chars)
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
                    onClick={() => void runBuiltFeature(eventId)}
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
                            {danger ? 'Approve & Run' : 'Run'}
                        </>
                    )}
                </button>
                <button
                    type="button"
                    onClick={() => discardBuiltFeature(eventId)}
                    disabled={runStatus.kind === 'running'}
                    className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md border border-border hover:bg-muted disabled:opacity-50"
                >
                    Discard
                </button>
            </div>

            {runStatus.kind === 'success' && (
                <div className="text-[11px] text-success">
                    ✓ Ran. Check the tab for <code>#bb-feature</code>.
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
        </Bubble>
    )
}

// ────────── Agent step ──────────

const RiskBadge: React.FC<{ level: RiskLevel }> = ({ level }) => {
    const cls = {
        destructive: 'text-destructive bg-destructive/10 border-destructive/20',
        caution: 'text-warning bg-warning/10 border-warning/20',
        safe: 'text-success bg-success/10 border-success/20',
    }[level]
    const Icon =
        level === 'destructive'
            ? ShieldAlert
            : level === 'caution'
                ? AlertTriangle
                : ShieldCheck
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 text-[9.5px] font-medium tracking-wide uppercase px-1.5 py-0.5 rounded-md border',
                cls,
            )}
        >
            <Icon className="size-2.5" />
            {level}
        </span>
    )
}

const StatusGlyph: React.FC<{ status: StepStatus }> = ({ status }) => {
    const base = 'size-2 rounded-full inline-block'
    if (status === 'running')
        return <span className={cn(base, 'bg-primary animate-claude-pulse')} />
    if (status === 'awaiting-approval')
        return <span className={cn(base, 'bg-warning animate-claude-pulse')} />
    if (status === 'done') return <span className={cn(base, 'bg-success')} />
    if (status === 'failed') return <span className={cn(base, 'bg-destructive')} />
    if (status === 'skipped')
        return <span className={cn(base, 'bg-muted-foreground/50')} />
    return <span className={cn(base, 'bg-border-strong')} />
}

function actionLabel(step: AgentStep): string {
    const a = step.action
    switch (a.type) {
        case 'click':
            return `🖱️ click ${a.selector}`
        case 'type':
            return `⌨️ type "${a.text.slice(0, 40)}" into ${a.selector}`
        case 'scroll':
            return `🖲️ scroll ${a.direction} ${a.px}px`
        case 'navigate':
            return `🌐 navigate ${a.url}`
        case 'wait':
            return a.forSelector ? `⏳ wait for ${a.forSelector}` : `⏳ wait ${a.ms}ms`
        case 'extract':
            return a.source === 'network'
                ? `📡 extract net "${a.networkUrl}" → ${a.into}`
                : `📋 extract ${a.selector} → ${a.into}`
        case 'writeFile':
            return `📝 write files/${a.path}`
        case 'runCode':
            return `🐍 run python (${a.source.length} chars)`
        case 'evalJs':
            return `📜 evalJs (${a.source.length} chars)`
        case 'inspectPage':
            return `🔍 inspect page`
        case 'verifyOverlay':
            return `📐 verify ${a.selector}`
        case 'verifyVisually':
            return `👁️ visual: "${a.intent.slice(0, 60)}"`
        case 'saveAugmentation':
            return `💾 save "${a.name}" (#${a.id})`
        case 'removeAugmentation':
            return `🗑️ remove #${a.id}`
        case 'saveMemory':
            return `🧠 propose ${a.updates.length} memory updates`
        case 'finish':
            return `✅ finish: ${a.summary.slice(0, 80)}`
        default:
            return JSON.stringify(a)
    }
}

const AgentStepCard: React.FC<{ step: AgentStep }> = ({ step }) => {
    const [open, setOpen] = useState(false)
    const running = step.status === 'running'
    const awaiting = step.status === 'awaiting-approval'
    return (
        <Bubble
            tone="card"
            className={cn(
                '!py-2 !px-3',
                running && '!ring-1 !ring-primary/20 !border-primary/30',
                awaiting && '!ring-1 !ring-warning/30 !border-warning/40 bg-warning/8',
            )}
        >
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="w-full text-left flex items-start gap-2"
            >
                <span className="mt-1.5 shrink-0">
                    <StatusGlyph status={step.status} />
                </span>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-mono tabular-nums text-muted-foreground">
                            {String(step.index + 1).padStart(2, '0')}
                        </span>
                        <span className="font-medium text-[12px] truncate">{step.goal}</span>
                        <RiskBadge level={step.riskLevel} />
                    </div>
                    {step.rationale && (
                        <div className="text-[11px] text-muted-foreground mt-0.5 font-serif italic line-clamp-2">
                            {step.rationale}
                        </div>
                    )}
                    <div className="text-[10.5px] text-muted-foreground/80 mt-1 font-mono truncate">
                        {actionLabel(step)}
                    </div>
                </div>
                <span className="shrink-0 text-muted-foreground mt-1">
                    {open ? (
                        <ChevronDown className="size-3" />
                    ) : (
                        <ChevronRight className="size-3" />
                    )}
                </span>
            </button>

            {open && (
                <div className="mt-2 ml-4 space-y-2 text-xs">
                    <div className="card-soft !rounded-md bg-muted/30 p-2 font-mono text-[10.5px] overflow-x-auto whitespace-pre-wrap break-all">
                        {JSON.stringify(step.action, null, 2)}
                    </div>
                    {step.result?.summary && (
                        <div className="text-muted-foreground flex gap-1.5 items-start">
                            <ArrowRight className="size-3 mt-0.5 shrink-0 text-success" />
                            <span>{step.result.summary}</span>
                        </div>
                    )}
                    {step.result?.error && (
                        <div className="text-destructive flex gap-1.5 items-start">
                            <AlertTriangle className="size-3 mt-0.5 shrink-0" />
                            <span>{step.result.error}</span>
                        </div>
                    )}
                    {step.result?.output && (
                        <pre className="text-[10.5px] bg-muted/30 p-2 rounded-md overflow-x-auto max-h-32 whitespace-pre-wrap font-mono">
                            {step.result.output}
                        </pre>
                    )}
                    {(step.screenshotBefore || step.screenshotAfter) && (
                        <div className="grid grid-cols-2 gap-2">
                            {step.screenshotBefore && (
                                <div>
                                    <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">
                                        Before
                                    </div>
                                    <img
                                        src={`file://${step.screenshotBefore}`}
                                        className="rounded-md border border-border w-full"
                                        alt="before"
                                    />
                                </div>
                            )}
                            {step.screenshotAfter && (
                                <div>
                                    <div className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide">
                                        After
                                    </div>
                                    <img
                                        src={`file://${step.screenshotAfter}`}
                                        className="rounded-md border border-border w-full"
                                        alt="after"
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </Bubble>
    )
}

// ────────── Dispatcher ──────────

export const ThreadEventCard: React.FC<{ event: ThreadEvent }> = ({ event }) => {
    switch (event.kind) {
        case 'user':
            return <UserCard text={event.text} mode={event.mode} />
        case 'assistant':
            return <AssistantCard text={event.text} isStreaming={event.isStreaming} />
        case 'note':
            return <NoteCard tone={event.tone} title={event.title} body={event.body} />
        case 'build':
            return (
                <BuildCard
                    eventId={event.id}
                    feature={event.feature}
                    runStatus={event.runStatus}
                />
            )
        case 'agent-step':
            return <AgentStepCard step={event.step} />
    }
}
