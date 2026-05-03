import React, { useEffect, useMemo, useState } from 'react'
import { Globe, Loader2, RotateCcw, FileDown, Terminal, Sparkles } from 'lucide-react'
import { useWorkbench } from '../contexts/WorkbenchContext'
import { cn } from '@common/lib/utils'
import type { NetRequest } from '../../../../../common/types'

const STATUS_CLASS = (s?: number): string => {
  if (!s) return 'text-gray-500'
  if (s < 200) return 'text-blue-500'
  if (s < 300) return 'text-emerald-600'
  if (s < 400) return 'text-amber-600'
  return 'text-rose-600'
}

const RequestRow: React.FC<{
  req: NetRequest
  selected: boolean
  onSelect: () => void
}> = ({ req, selected, onSelect }) => {
  const u = (() => {
    try {
      return new URL(req.url)
    } catch {
      return null
    }
  })()
  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full text-left px-2 py-1 border-b border-border/50 hover:bg-muted/40 flex items-center gap-2 text-[11px]',
        selected && 'bg-sky-50 dark:bg-sky-950/30',
      )}
    >
      <span className="font-mono w-12 shrink-0">{req.method}</span>
      <span className={cn('w-8 shrink-0 font-mono tabular-nums', STATUS_CLASS(req.status))}>
        {req.status ?? '...'}
      </span>
      <span className="truncate flex-1 font-mono">
        {u ? `${u.host}${u.pathname}${u.search.slice(0, 30)}` : req.url}
      </span>
      <span className="text-muted-foreground tabular-nums shrink-0">
        {req.resourceType?.[0] ?? '?'}
      </span>
    </button>
  )
}

const Detail: React.FC<{ req: NetRequest }> = ({ req }) => {
  const [tab, setTab] = useState<'headers' | 'response' | 'request'>('response')
  const [explain, setExplain] = useState<string | null>(null)
  const [explainLoading, setExplainLoading] = useState(false)
  const [snippet, setSnippet] = useState<{ language: string; text: string } | null>(null)
  const [snippetLoading, setSnippetLoading] = useState(false)
  const { activeProject } = useWorkbench()
  const [csvName, setCsvName] = useState('extracted.csv')
  const [csvBusy, setCsvBusy] = useState(false)
  const [replayResult, setReplayResult] = useState<string | null>(null)

  useEffect(() => {
    setExplain(null)
    setSnippet(null)
    setReplayResult(null)
    const u = (() => {
      try {
        return new URL(req.url)
      } catch {
        return null
      }
    })()
    if (u) {
      const last = u.pathname.split('/').filter(Boolean).pop() ?? 'extracted'
      setCsvName(`${last}.csv`)
    }
  }, [req.id])

  const askExplain = async (): Promise<void> => {
    setExplainLoading(true)
    try {
      const text = await window.workbench.explainNetwork(req.id)
      setExplain(text)
    } finally {
      setExplainLoading(false)
    }
  }

  const askSnippet = async (language: 'curl' | 'python' | 'typescript'): Promise<void> => {
    setSnippetLoading(true)
    try {
      const text = await window.workbench.generateSnippet(req.id, language)
      setSnippet({ language, text })
    } finally {
      setSnippetLoading(false)
    }
  }

  const extractCsv = async (): Promise<void> => {
    setCsvBusy(true)
    try {
      const r = await window.workbench.extractToCsv(req.id, csvName, activeProject?.id)
      if (r.ok) setReplayResult(`Saved files/${csvName.endsWith('.csv') ? csvName : csvName + '.csv'}`)
      else setReplayResult(`Error: ${r.error}`)
    } finally {
      setCsvBusy(false)
    }
  }

  const replay = async (): Promise<void> => {
    if (req.method !== 'GET') {
      setReplayResult('Replay limited to GET in this build')
      return
    }
    const r = await window.workbench.replayNetwork(req.id)
    if (r.ok) setReplayResult(`status ${r.status} · ${r.body?.slice(0, 200) ?? ''}`)
    else setReplayResult(`Error: ${r.error}`)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border">
        <div className="text-[11px] font-mono break-all">
          <span className="font-semibold">{req.method}</span> {req.url}
        </div>
        <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
          <span className={cn('text-[10px] font-mono', STATUS_CLASS(req.status))}>
            status {req.status ?? '?'}
          </span>
          {req.resourceType && (
            <span className="text-[10px] text-muted-foreground">· {req.resourceType}</span>
          )}
          {req.resBodyTruncated && (
            <span className="text-[10px] text-amber-600">· truncated</span>
          )}
        </div>
      </div>

      <div className="flex border-b border-border bg-muted/20 text-[11px]">
        {(['response', 'request', 'headers'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3 py-1.5 capitalize',
              tab === t ? 'bg-background font-medium' : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {tab === 'headers' && (
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-all">
            {[
              '# Request',
              ...Object.entries(req.reqHeaders ?? {}).map(([k, v]) => `${k}: ${v}`),
              '',
              '# Response',
              ...Object.entries(req.resHeaders ?? {}).map(([k, v]) => `${k}: ${v}`),
            ].join('\n')}
          </pre>
        )}
        {tab === 'request' && (
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-all">
            {req.reqBody ?? '(none)'}
          </pre>
        )}
        {tab === 'response' && (
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-all">
            {req.resBody ?? '(no body captured)'}
          </pre>
        )}
      </div>

      <div className="border-t border-border p-2 space-y-2">
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={askExplain}
            disabled={explainLoading || !req.resBody}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            {explainLoading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
            Explain
          </button>
          <button
            onClick={() => askSnippet('curl')}
            disabled={snippetLoading}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border hover:bg-muted"
          >
            <Terminal className="size-3" /> curl
          </button>
          <button
            onClick={() => askSnippet('python')}
            className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted"
          >
            python
          </button>
          <button
            onClick={() => askSnippet('typescript')}
            className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted"
          >
            ts
          </button>
          <button
            onClick={replay}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-border hover:bg-muted"
          >
            <RotateCcw className="size-3" /> Replay
          </button>
        </div>

        <div className="flex items-center gap-1">
          <input
            value={csvName}
            onChange={(e) => setCsvName(e.target.value)}
            className="flex-1 text-[11px] px-2 py-1 rounded border border-border bg-background"
          />
          <button
            onClick={extractCsv}
            disabled={csvBusy || !req.resBody}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-emerald-600 text-white hover:opacity-90 disabled:opacity-40"
          >
            {csvBusy ? <Loader2 className="size-3 animate-spin" /> : <FileDown className="size-3" />}
            Extract → CSV
          </button>
        </div>

        {explain && (
          <div className="text-[11px] bg-muted/30 rounded p-2 whitespace-pre-wrap">{explain}</div>
        )}
        {snippet && (
          <pre className="text-[10px] font-mono bg-muted/30 rounded p-2 overflow-x-auto whitespace-pre-wrap">
            <div className="text-muted-foreground mb-1">{snippet.language}</div>
            {snippet.text}
          </pre>
        )}
        {replayResult && (
          <div className="text-[11px] text-muted-foreground whitespace-pre-wrap break-all">
            {replayResult}
          </div>
        )}
      </div>
    </div>
  )
}

export const NetworkPanel: React.FC = () => {
  const { network, refreshNetwork, activeTabId } = useWorkbench()
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return network
    return network.filter(
      (r) =>
        r.url.toLowerCase().includes(f) ||
        r.method.toLowerCase().includes(f) ||
        String(r.status ?? '').includes(f),
    )
  }, [network, filter])

  const selected = filtered.find((r) => r.id === selectedId) ?? filtered[0] ?? null

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Globe className="size-3.5" />
          Network
        </div>
        <div className="text-xs text-muted-foreground/80 mt-0.5">
          XHR/Fetch from the active tab. Ask the copilot to explain, replay (GET), or extract to CSV.
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-muted/20">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter (url, method, status)"
          className="flex-1 text-[11px] px-2 py-1 rounded border border-border bg-background"
        />
        <button
          onClick={() => void refreshNetwork()}
          className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted"
        >
          Refresh
        </button>
      </div>
      <div className="grid grid-rows-[1fr_1fr] flex-1 min-h-0">
        <div className="overflow-y-auto border-b border-border">
          {!activeTabId && (
            <div className="text-xs text-muted-foreground p-3 text-center">
              No active tab.
            </div>
          )}
          {filtered.length === 0 && activeTabId && (
            <div className="text-xs text-muted-foreground p-3 text-center">
              No requests yet — try interacting with the page.
            </div>
          )}
          {filtered.map((r) => (
            <RequestRow
              key={r.id}
              req={r}
              selected={selected?.id === r.id}
              onSelect={() => setSelectedId(r.id)}
            />
          ))}
        </div>
        <div className="overflow-hidden">
          {selected ? (
            <Detail req={selected} />
          ) : (
            <div className="text-xs text-muted-foreground p-3 text-center">
              Select a request to inspect it.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
