import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react'
import type {
    AgentStep,
    BuiltFeature,
} from '../../../../../common/types'
import { useWorkbench } from './WorkbenchContext'
import { useApiBank } from './ApiBankContext'

// One unified thread of events that the chat surface renders top-to-bottom.
// Every mode (Build · Agent · Chat) writes events into this same list, so the
// user only ever interacts with one chat page; the mode just changes what
// pressing Send does and what auxiliary buttons sit under the composer.

export type Mode = 'build' | 'agent' | 'chat'

export type BuildRunStatus =
    | { kind: 'idle' }
    | { kind: 'running' }
    | { kind: 'success'; value: unknown }
    | { kind: 'error'; error: string }

export type ThreadEvent =
    | { id: string; kind: 'user'; mode: Mode; text: string; ts: number }
    | {
        id: string
        kind: 'assistant'
        text: string
        isStreaming: boolean
        messageId: string
        ts: number
    }
    | {
        id: string
        kind: 'build'
        feature: BuiltFeature
        runStatus: BuildRunStatus
        ts: number
    }
    | { id: string; kind: 'agent-step'; step: AgentStep; ts: number }
    | {
        id: string
        kind: 'note'
        tone: 'info' | 'warn' | 'error' | 'success'
        title: string
        body?: string
        ts: number
    }

interface ThreadContextValue {
    events: ThreadEvent[]
    busy: boolean
    send: (text: string, mode: Mode) => Promise<void>
    runBuiltFeature: (eventId: string) => Promise<void>
    saveBuiltFeature: (eventId: string) => Promise<void>
    discardBuiltFeature: (eventId: string) => void
    clear: () => void
}

const ThreadContext = createContext<ThreadContextValue | null>(null)

export const useThread = (): ThreadContextValue => {
    const ctx = useContext(ThreadContext)
    if (!ctx) throw new Error('useThread must be used inside ThreadProvider')
    return ctx
}

let eventCounter = 0
const nextId = (prefix: string): string =>
    `${prefix}-${Date.now()}-${++eventCounter}`

interface ChatResponseChunk {
    messageId: string
    content: string
    isComplete: boolean
}

export const ThreadProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const wb = useWorkbench()
    const apiBank = useApiBank()
    const [events, setEvents] = useState<ThreadEvent[]>([])
    const [busy, setBusy] = useState(false)

    // Track which agent step ids we've already projected into the thread, so
    // re-renders of wb.steps don't double-add. Step *updates* (status changes)
    // refresh the existing thread event in place.
    const seenStepIds = useRef<Set<string>>(new Set())

    // Project agent steps into the thread. Steps are auth-of-truth in the
    // WorkbenchContext (it subscribes to the main process's stream); we just
    // mirror them here so they appear in chronological order alongside user
    // messages and build cards.
    useEffect(() => {
        setEvents((prev) => {
            const fresh = wb.steps.filter((s) => !seenStepIds.current.has(s.id))
            const updates = wb.steps.filter((s) => seenStepIds.current.has(s.id))
            let next = prev
            if (updates.length > 0) {
                next = next.map((e) => {
                    if (e.kind === 'agent-step') {
                        const u = updates.find((s) => s.id === e.step.id)
                        if (u && u !== e.step) return { ...e, step: u }
                    }
                    return e
                })
            }
            if (fresh.length > 0) {
                fresh.forEach((s) => seenStepIds.current.add(s.id))
                next = [
                    ...next,
                    ...fresh.map(
                        (s): ThreadEvent => ({
                            id: `step-${s.id}`,
                            kind: 'agent-step',
                            step: s,
                            ts: s.startedAt,
                        }),
                    ),
                ]
            }
            return next
        })
    }, [wb.steps])

    // Plain-chat streaming: bypass the legacy ChatProvider entirely. We
    // accumulate chunks per messageId into a single 'assistant' event and
    // mark it !isStreaming when isComplete.
    useEffect(() => {
        const handler = (data: ChatResponseChunk): void => {
            setEvents((prev) =>
                prev.map((e) => {
                    if (e.kind !== 'assistant' || e.messageId !== data.messageId) return e
                    if (data.isComplete) {
                        // Last frame is a per-chunk delta in some setups and the full
                        // accumulated text in others (LLMClient does the latter on the
                        // final flush). Be tolerant: if the incoming content is shorter
                        // than what we have, prefer ours; if longer, take it whole.
                        const finalText =
                            data.content.length >= e.text.length ? data.content : e.text
                        return { ...e, text: finalText, isStreaming: false }
                    }
                    return { ...e, text: e.text + data.content }
                }),
            )
            if (data.isComplete) setBusy(false)
        }
        window.sidebarAPI.onChatResponse(handler)
        return () => {
            window.sidebarAPI.removeChatResponseListener()
        }
    }, [])

    const pushEvent = useCallback((event: ThreadEvent) => {
        setEvents((prev) => [...prev, event])
    }, [])

    const pushNote = useCallback(
        (tone: 'info' | 'warn' | 'error' | 'success', title: string, body?: string) => {
            pushEvent({
                id: nextId('n'),
                kind: 'note',
                tone,
                title,
                body,
                ts: Date.now(),
            })
        },
        [pushEvent],
    )

    const send = useCallback(
        async (text: string, mode: Mode): Promise<void> => {
            const trimmed = text.trim()
            if (!trimmed) return

            setBusy(true)
            pushEvent({
                id: nextId('u'),
                kind: 'user',
                mode,
                text: trimmed,
                ts: Date.now(),
            })

            try {
                if (mode === 'build') {
                    if (!wb.activeTabId) {
                        pushNote('error', 'No active tab', 'Open a tab to capture APIs first.')
                        return
                    }
                    // Hand the LLM only the spec entries the user has left
                    // toggled on for the current site. A snapshot is taken
                    // here so toggles flipped after Send don't change this
                    // request mid-flight.
                    const enabled = apiBank.enabledSpec
                    // Gather the most recent build event in the thread so
                    // chat-iteration ("now make it red", "add a refresh
                    // button") modifies the existing feature instead of
                    // generating a fresh one with a different id. "New
                    // thread" or starting in a different mode resets this.
                    const lastBuild = [...events]
                        .reverse()
                        .find(
                            (e): e is Extract<ThreadEvent, { kind: 'build' }> =>
                                e.kind === 'build',
                        )
                    const previousFeature = lastBuild
                        ? {
                            description: lastBuild.feature.description,
                            code: lastBuild.feature.code,
                            suggested_id: lastBuild.feature.suggested_id,
                            suggested_name: lastBuild.feature.suggested_name,
                        }
                        : undefined
                    const feature = await window.workbench.buildFeature(
                        trimmed,
                        wb.activeTabId,
                        enabled,
                        previousFeature,
                    )
                    // The LLM picks one of two routes:
                    //   "answer" — surface as a plain assistant message in the thread
                    //   "build"  — surface the approval card with code + safety review
                    if (feature.kind === 'answer') {
                        pushEvent({
                            id: nextId('a'),
                            kind: 'assistant',
                            text: feature.answer || '(no answer)',
                            isStreaming: false,
                            messageId: `build-answer-${Date.now()}`,
                            ts: Date.now(),
                        })
                    } else {
                        pushEvent({
                            id: nextId('b'),
                            kind: 'build',
                            feature,
                            runStatus: { kind: 'idle' },
                            ts: Date.now(),
                        })
                    }
                } else if (mode === 'agent') {
                    if (!wb.activeProject || !wb.activeTabId) {
                        pushNote(
                            'error',
                            'Cannot start agent',
                            'Pick a project and load a page first.',
                        )
                        return
                    }
                    await wb.startAgent(trimmed)
                    // Steps stream in via the wb.steps subscription above.
                } else {
                    // chat
                    const messageId = `chat-${Date.now()}-${++eventCounter}`
                    pushEvent({
                        id: `a-${messageId}`,
                        kind: 'assistant',
                        text: '',
                        isStreaming: true,
                        messageId,
                        ts: Date.now(),
                    })
                    await window.sidebarAPI.sendChatMessage({ message: trimmed, messageId })
                    // Streaming completion sets busy=false in the chunk handler above.
                    return
                }
            } catch (err) {
                pushNote(
                    'error',
                    'Action failed',
                    err instanceof Error ? err.message : String(err),
                )
            } finally {
                // For chat mode busy is cleared by the chunk handler; for the others
                // we're done synchronously (build) or the async timeline takes over (agent).
                if (mode !== 'chat') setBusy(false)
            }
        },
        [pushEvent, pushNote, wb, apiBank, events],
    )

    const runBuiltFeature = useCallback(
        async (eventId: string): Promise<void> => {
            const target = events.find(
                (e): e is Extract<ThreadEvent, { kind: 'build' }> =>
                    e.kind === 'build' && e.id === eventId,
            )
            if (!target) return
            setEvents((prev) =>
                prev.map((e) =>
                    e.id === eventId && e.kind === 'build'
                        ? { ...e, runStatus: { kind: 'running' as const } }
                        : e,
                ),
            )
            try {
                const res = await window.workbench.runFeature(
                    target.feature.code,
                    wb.activeTabId ?? undefined,
                )
                setEvents((prev) =>
                    prev.map((e) =>
                        e.id === eventId && e.kind === 'build'
                            ? {
                                ...e,
                                runStatus: res.ok
                                    ? { kind: 'success' as const, value: res.value }
                                    : { kind: 'error' as const, error: res.error },
                            }
                            : e,
                    ),
                )
            } catch (err) {
                setEvents((prev) =>
                    prev.map((e) =>
                        e.id === eventId && e.kind === 'build'
                            ? {
                                ...e,
                                runStatus: {
                                    kind: 'error' as const,
                                    error: err instanceof Error ? err.message : String(err),
                                },
                            }
                            : e,
                    ),
                )
            }
        },
        [events, wb.activeTabId],
    )

    const discardBuiltFeature = useCallback((eventId: string) => {
        setEvents((prev) => prev.filter((e) => e.id !== eventId))
    }, [])

    // Persist a successful build as a per-site extension. Uses the LLM's
    // suggested_id / suggested_name when present; otherwise extracts the
    // first bb-* id from the code (matched by feature-builder's parser).
    // Pushes a confirmation note into the thread.
    const saveBuiltFeature = useCallback(
        async (eventId: string): Promise<void> => {
            const target = events.find(
                (e): e is Extract<ThreadEvent, { kind: 'build' }> =>
                    e.kind === 'build' && e.id === eventId,
            )
            if (!target) return
            if (!wb.domain) {
                pushNote(
                    'error',
                    'Cannot save extension',
                    'Open a tab on a site first.',
                )
                return
            }
            const id = target.feature.suggested_id
            if (!id) {
                pushNote(
                    'error',
                    'Cannot save extension',
                    'No bb-* id found in the generated code — ask the model to add one.',
                )
                return
            }
            const name =
                target.feature.suggested_name ||
                target.feature.description.slice(0, 60) ||
                id
            try {
                await window.workbench.extensionsAdd(wb.domain, {
                    id,
                    name,
                    script: target.feature.code,
                })
                pushNote(
                    'success',
                    'Saved extension',
                    `"${name}" will auto-run on every visit to ${wb.domain}.`,
                )
            } catch (err) {
                pushNote(
                    'error',
                    'Save failed',
                    err instanceof Error ? err.message : String(err),
                )
            }
        },
        [events, wb.domain, pushNote],
    )

    const clear = useCallback(() => {
        setEvents([])
        seenStepIds.current.clear()
    }, [])

    const value = useMemo<ThreadContextValue>(
        () => ({
            events,
            busy,
            send,
            runBuiltFeature,
            saveBuiltFeature,
            discardBuiltFeature,
            clear,
        }),
        [
            events,
            busy,
            send,
            runBuiltFeature,
            saveBuiltFeature,
            discardBuiltFeature,
            clear,
        ],
    )

    return (
        <ThreadContext.Provider value={value}>{children}</ThreadContext.Provider>
    )
}
