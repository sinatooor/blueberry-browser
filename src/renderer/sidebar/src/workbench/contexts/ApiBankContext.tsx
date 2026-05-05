import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
} from 'react'
import type { EndpointSpec } from '../../../../../common/types'
import { useWorkbench } from './WorkbenchContext'

// The "API Bank" is the user's own catalog of captured endpoints. It lives
// alongside the chat surface as an overlay page; it's also the destination
// when the user clicks an entry in the small APIs popover from the Build
// composer's bottom bar.
//
// This context owns two things:
//
// 1. Per-site enable/disable toggles. Disabled endpoints are filtered out
//    of the spec the LLM sees during a Build call, but stay visible in the
//    Bank so the user can re-enable them. State persists to localStorage.
//
// 2. The Bank overlay's open/closed state, the currently selected endpoint
//    key, and the active filter (e.g. "this site only" vs "everywhere").
//
// Cross-site persistence (a real DB of every API the system has ever seen)
// is a follow-up commit. For now the Bank shows whatever's currently in
// the live network capture, plus toggle preferences from localStorage.

export type BankFilter = 'this-site' | 'all'

const STORAGE_KEY = 'bb:api-bank:disabled'
const FILTER_KEY = 'bb:api-bank:filter'

// Persisted shape: { [origin]: ["METHOD origin/path", ...] }
type PersistedDisabled = Record<string, string[]>

interface ApiBankContextValue {
    // Live spec snapshot for the active tab + origin (re-fetches when the
    // tab/url changes). Bank UI reads from this; Build flow filters this
    // before handing to the LLM.
    spec: EndpointSpec[]
    origin: string | null
    refreshing: boolean
    refresh: () => Promise<void>

    // Per-(origin, key) toggles. Default is enabled.
    isEnabled: (origin: string, key: string) => boolean
    toggleEnabled: (origin: string, key: string) => void
    setEnabled: (origin: string, key: string, enabled: boolean) => void

    // Convenience: the spec already filtered by the user's toggle prefs
    // for the active origin. This is what should go to buildFeature.
    enabledSpec: EndpointSpec[]

    // Manual entry / removal in the persistent catalog.
    addManualApi: (args: {
        origin: string
        method: string
        pathname: string
        url: string
        sampleResponse?: string
        notes?: string
    }) => Promise<EndpointSpec>
    removeApiByKey: (key: string) => Promise<void>

    // Bank overlay state.
    bankOpen: boolean
    bankSelectedKey: string | null
    bankFilter: BankFilter
    openBank: (selectedKey?: string) => void
    closeBank: () => void
    setBankFilter: (f: BankFilter) => void
    setBankSelected: (k: string | null) => void
}

const ApiBankContext = createContext<ApiBankContextValue | null>(null)

export const useApiBank = (): ApiBankContextValue => {
    const ctx = useContext(ApiBankContext)
    if (!ctx) throw new Error('useApiBank must be used inside ApiBankProvider')
    return ctx
}

function loadDisabled(): PersistedDisabled {
    if (typeof window === 'undefined') return {}
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw)
        if (typeof parsed !== 'object' || parsed === null) return {}
        return parsed as PersistedDisabled
    } catch {
        return {}
    }
}

function loadFilter(): BankFilter {
    if (typeof window === 'undefined') return 'this-site'
    const stored = localStorage.getItem(FILTER_KEY)
    return stored === 'all' ? 'all' : 'this-site'
}

const POLL_INTERVAL_MS = 2000

export const ApiBankProvider: React.FC<{ children: React.ReactNode }> = ({
    children,
}) => {
    const wb = useWorkbench()
    const [disabled, setDisabled] = useState<PersistedDisabled>(loadDisabled)
    const [spec, setSpec] = useState<EndpointSpec[]>([])
    const [origin, setOrigin] = useState<string | null>(null)
    const [refreshing, setRefreshing] = useState(false)

    const [bankOpen, setBankOpen] = useState(false)
    const [bankSelectedKey, setBankSelected] = useState<string | null>(null)
    const [bankFilter, setBankFilterState] = useState<BankFilter>(loadFilter)

    // Persist disabled toggles + filter preference.
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(disabled))
        } catch {
            // ignore
        }
    }, [disabled])

    useEffect(() => {
        try {
            localStorage.setItem(FILTER_KEY, bankFilter)
        } catch {
            // ignore
        }
    }, [bankFilter])

    // Pull captured spec for the active tab + origin. Polled so the Bank
    // and the popover see new endpoints as the page makes calls.
    const refresh = useCallback(async () => {
        setRefreshing(true)
        try {
            // Two sources, merged by endpoint key:
            //   live  — current-tab capture (has fresh response data)
            //   stored — SQLite catalog across every origin the user has touched
            // We prefer the live entry when both exist (it has the most recent
            // counts/headers). Stored entries fill in cross-origin gaps so the
            // Bank's "All sites" filter actually has something to show.
            const [liveRes, stored] = await Promise.all([
                window.workbench.getFeatureSpec(),
                window.workbench.apiBankList(),
            ])
            const merged = new Map<string, EndpointSpec>()
            for (const s of stored) merged.set(s.key, s)
            for (const s of liveRes.endpoints) merged.set(s.key, s)
            const arr = Array.from(merged.values()).sort(
                (a, b) => b.lastSeen - a.lastSeen,
            )
            setSpec(arr)
            setOrigin(liveRes.origin)
        } catch (err) {
            console.error('[apibank] refresh failed:', err)
        } finally {
            setRefreshing(false)
        }
    }, [])

    const addManualApi = useCallback(
        async (args: {
            origin: string
            method: string
            pathname: string
            url: string
            sampleResponse?: string
            notes?: string
        }): Promise<EndpointSpec> => {
            const created = await window.workbench.apiBankAdd(args)
            await refresh()
            return created
        },
        [refresh],
    )

    const removeApiByKey = useCallback(
        async (key: string): Promise<void> => {
            await window.workbench.apiBankRemove(key)
            await refresh()
        },
        [refresh],
    )

    useEffect(() => {
        void refresh()
        const id = setInterval(refresh, POLL_INTERVAL_MS)
        return () => clearInterval(id)
    }, [refresh, wb.activeTabId])

    const isEnabled = useCallback(
        (o: string, key: string): boolean => {
            const list = disabled[o]
            return !list || !list.includes(key)
        },
        [disabled],
    )

    const setEnabled = useCallback(
        (o: string, key: string, enabled: boolean): void => {
            setDisabled((prev) => {
                const cur = new Set(prev[o] ?? [])
                if (enabled) cur.delete(key)
                else cur.add(key)
                const next = { ...prev }
                if (cur.size === 0) delete next[o]
                else next[o] = Array.from(cur)
                return next
            })
        },
        [],
    )

    const toggleEnabled = useCallback(
        (o: string, key: string): void => {
            setEnabled(o, key, !isEnabled(o, key))
        },
        [isEnabled, setEnabled],
    )

    // Spec for the active origin, with disabled entries filtered out. This
    // is what ThreadContext.send(build) passes to buildFeature.
    const enabledSpec = useMemo<EndpointSpec[]>(() => {
        if (!origin) return []
        return spec.filter(
            (s) => s.origin === origin && isEnabled(s.origin, s.key),
        )
    }, [spec, origin, isEnabled])

    const openBank = useCallback((selectedKey?: string) => {
        if (selectedKey) setBankSelected(selectedKey)
        setBankOpen(true)
    }, [])

    const closeBank = useCallback(() => setBankOpen(false), [])

    const setBankFilter = useCallback((f: BankFilter) => setBankFilterState(f), [])

    const value = useMemo<ApiBankContextValue>(
        () => ({
            spec,
            origin,
            refreshing,
            refresh,
            isEnabled,
            toggleEnabled,
            setEnabled,
            enabledSpec,
            addManualApi,
            removeApiByKey,
            bankOpen,
            bankSelectedKey,
            bankFilter,
            openBank,
            closeBank,
            setBankFilter,
            setBankSelected,
        }),
        [
            spec,
            origin,
            refreshing,
            refresh,
            isEnabled,
            toggleEnabled,
            setEnabled,
            enabledSpec,
            addManualApi,
            removeApiByKey,
            bankOpen,
            bankSelectedKey,
            bankFilter,
            openBank,
            closeBank,
            setBankFilter,
        ],
    )

    return (
        <ApiBankContext.Provider value={value}>{children}</ApiBankContext.Provider>
    )
}
