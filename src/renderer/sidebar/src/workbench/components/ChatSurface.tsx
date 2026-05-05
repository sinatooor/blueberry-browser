import React, {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
} from 'react'
import { ArrowUp, Loader2, Plus } from 'lucide-react'
import { cn } from '@common/lib/utils'
import { useThread, type Mode } from '../contexts/ThreadContext'
import { ThreadEventCard } from './ThreadEvents'
import { ComposerBottomBar } from './ComposerBottomBar'

// One chat surface, three modes. The surface itself never changes shape:
// thread above, composer below, mode pill + helpers under the composer.
// Mode just changes what Send does and which extras appear in the bottom bar.

const MODE_STORAGE_KEY = 'bb:chat-surface:mode'

const PLACEHOLDER: Record<Mode, string> = {
    build:
        'Describe a feature — the browser uses the page\'s sniffed APIs + your cookies to build it.',
    agent: 'Describe a multi-step task — the agent will plan and act, step by step.',
    chat: 'Ask anything about the current page.',
}

interface ChatSurfaceProps {
    onOpenAPIs: () => void
    onOpenExtensions: () => void
}

export const ChatSurface: React.FC<ChatSurfaceProps> = ({
    onOpenAPIs,
    onOpenExtensions,
}) => {
    const { events, busy, send, clear } = useThread()
    const [mode, setMode] = useState<Mode>(() => {
        if (typeof window === 'undefined') return 'build'
        const stored = localStorage.getItem(MODE_STORAGE_KEY) as Mode | null
        return stored === 'build' || stored === 'agent' || stored === 'chat'
            ? stored
            : 'build'
    })
    const [draft, setDraft] = useState('')
    const textareaRef = useRef<HTMLTextAreaElement>(null)
    const scrollAnchorRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        try {
            localStorage.setItem(MODE_STORAGE_KEY, mode)
        } catch {
            // ignore
        }
    }, [mode])

    // Auto-grow textarea up to ~140 px.
    useEffect(() => {
        const el = textareaRef.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 140)}px`
    }, [draft])

    // Auto-scroll to bottom on new events.
    useLayoutEffect(() => {
        scrollAnchorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }, [events.length, events[events.length - 1]?.id])

    const submit = useCallback(() => {
        const text = draft.trim()
        if (!text || busy) return
        setDraft('')
        if (textareaRef.current) textareaRef.current.style.height = 'auto'
        void send(text, mode)
    }, [draft, busy, send, mode])

    const onKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                submit()
            }
        },
        [submit],
    )

    return (
        <div className="flex flex-col h-full min-h-0">
            {/* Thread */}
            <div className="flex-1 overflow-y-auto">
                <div className="max-w-3xl mx-auto px-4 pt-3 pb-2 flex items-center gap-2">
                    {events.length > 0 && (
                        <button
                            type="button"
                            onClick={clear}
                            className="text-[10.5px] text-muted-foreground hover:text-foreground flex items-center gap-1 px-2 py-1 rounded-md hover:bg-muted"
                        >
                            <Plus className="size-3" />
                            New thread
                        </button>
                    )}
                </div>
                <div className="max-w-3xl mx-auto px-4 pb-6 flex flex-col gap-3">
                    {events.length === 0 ? (
                        <EmptyState mode={mode} />
                    ) : (
                        events.map((e) => <ThreadEventCard key={e.id} event={e} />)
                    )}
                    {busy && (
                        <div className="text-[11px] text-muted-foreground flex items-center gap-2">
                            <Loader2 className="size-3 animate-spin" />
                            Working…
                        </div>
                    )}
                    <div ref={scrollAnchorRef} />
                </div>
            </div>

            {/* Composer */}
            <div className="px-3 pb-3 pt-2 border-t border-border bg-card/40">
                <div className="max-w-3xl mx-auto">
                    <div
                        className={cn(
                            'card-soft flex items-end gap-1 px-3 py-2 transition-shadow',
                            'focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary/30',
                        )}
                    >
                        <textarea
                            ref={textareaRef}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={onKeyDown}
                            rows={1}
                            placeholder={PLACEHOLDER[mode]}
                            disabled={busy}
                            className="flex-1 resize-none bg-transparent outline-none text-sm placeholder:text-muted-foreground/70 leading-relaxed py-1 max-h-[140px]"
                            style={{ minHeight: 24 }}
                        />
                        <button
                            type="button"
                            onClick={submit}
                            disabled={busy || !draft.trim()}
                            className={cn(
                                'size-8 rounded-md flex items-center justify-center shrink-0',
                                'bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40 transition-opacity',
                            )}
                            aria-label="Send"
                        >
                            <ArrowUp className="size-4" />
                        </button>
                    </div>
                    <ComposerBottomBar
                        mode={mode}
                        onModeChange={setMode}
                        onOpenAPIs={onOpenAPIs}
                        onOpenExtensions={onOpenExtensions}
                    />
                </div>
            </div>
        </div>
    )
}

const EMPTY_COPY: Record<Mode, { title: string; body: string }> = {
    build: {
        title: '🫐 Build a feature for this page',
        body: 'Use the sniffed APIs + your cookies. The script lands inside #bb-feature.',
    },
    agent: {
        title: '🫐 Run a multi-step agent',
        body: 'It plans, acts, and shows every step with screenshots and approval gates.',
    },
    chat: {
        title: '🫐 Ask about this page',
        body: 'A plain Q&A with the current page text + a screenshot in context.',
    },
}

const EmptyState: React.FC<{ mode: Mode }> = ({ mode }) => {
    const copy = EMPTY_COPY[mode]
    return (
        <div className="text-center py-12 max-w-md mx-auto">
            <h3 className="text-base font-semibold">{copy.title}</h3>
            <p className="text-[12px] text-muted-foreground mt-2 font-serif italic">
                {copy.body}
            </p>
        </div>
    )
}
