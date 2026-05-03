import React, { useEffect, useMemo, useState } from 'react'
import { Globe, Loader2, RotateCcw, FileDown, Terminal, Sparkles, Search } from 'lucide-react'
import { useWorkbench } from '../contexts/WorkbenchContext'
import { cn } from '@common/lib/utils'
import type { NetRequest } from '../../../../../common/types'

const STATUS_TONE = (s?: number): string => {
  if (!s) return 'text-muted-foreground'
  if (s < 200) return 'text-blue-500'
  if (s < 300) return 'text-success'
  if (s < 400) return 'text-warning'
  return 'text-destructive'
}

const METHOD_TONE = (m: string): string => {
  if (m === 'GET') return 'text-foreground'
  if (m === 'POST') return 'text-success'
  if (m === 'PUT' || m === 'PATCH') return 'text-warning'
  if (m === 'DELETE') return 'text-destructive'
  return 'text-muted-foreground'
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
        'w-full text-left px-3 py-1.5 hover-warm flex items-center gap-2 text-[11px] border-l-2 border-transparent',
        selected && 'bg-primary/8 border-l-primary',
      )}
    >
      <span className={cn('font-mono w-12 shrink-0 font-medium', METHOD_TONE(req.method))}>
        {req.method}
      </span>
      <span className={cn('w-9 shrink-0 font-mono tabular-nums', STATUS_TONE(req.status))}>
        {req.status ?? '...'}
      </span>
      <span className="truncate flex-1 font-mono text-foreground/85">
        {u ? `${u.host}${u.pathname}${u.search.slice(0, 30)}` : req.url}
      </span>
      <span className="text-muted-foreground/70 tabular-nums shrink-0 text-[10px]">
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
  const [snippetLoading, setSnippetLoading] = useState<string | null>(null)
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
    setSnippetLoading(language)
    try {
      const text = await window.workbench.generateSnippet(req.id, language)
      setSnippet({ language, text })
    } finally {
      setSnippetLoading(null)
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
      <div className="px-3 py-2.5 border-b border-border bg-card">
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className={cn('font-mono font-medium', METHOD_TONE(req.method))}>{req.method}</span>
          <span className={cn('font-mono tabular-nums', STATUS_TONE(req.status))}>
            {req.status ?? '?'}
          </span>
          {req.resourceType && (
            <span className="text-[10px] text-muted-foreground">· {req.resourceType}</span>
          )}
          {req.resBodyTruncated && (
            <span className="text-[10px] text-warning ml-auto">truncated</span>
          )}
        </div>
        <div className="text-[11px] font-mono break-all mt-1 text-foreground/85">{req.url}</div>
      </div>

      <div className="flex border-b border-border bg-surface text-[11px] px-1">
        {(['response', 'request', 'headers'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3 py-1.5 capitalize relative',
              tab === t ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t}
            {tab === t && (
              <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-primary" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 bg-background">
        {tab === 'headers' && (
          <pre className="text-[10.5px] font-mono whitespace-pre-wrap break-all leading-relaxed">
            <span className="text-muted-foreground"># Request</span>
            {'\n'}
            {Object.entries(req.reqHeaders ?? {})
              .map(([k, v]) => `${k}: ${v}`)
              .join('\n')}
            {'\n\n'}
            <span className="text-muted-foreground"># Response</span>
            {'\n'}
            {Object.entries(req.resHeaders ?? {})
              .map(([k, v]) => `${k}: ${v}`)
              .join('\n')}
          </pre>
        )}
        {tab === 'request' && (
          <pre className="text-[10.5px] font-mono whitespace-pre-wrap break-all leading-relaxed">
            {req.reqBody ?? '(none)'}
          </pre>
        )}
        {tab === 'response' && (
          <pre className="text-[10.5px] font-mono whitespace-pre-wrap break-all leading-relaxed">
            {req.resBody ?? '(no body captured)'}
          </pre>
        )}
      </div>

      <div className="border-t border-border p-2.5 space-y-2 bg-surface">
        <div className="flex items-center gap-1 flex-wrap">
          <button
            onClick={askExplain}
            disabled={explainLoading || !req.resBody}
            className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            {explainLoading ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
            Explain
          </button>
          <button
            onClick={() => askSnippet('curl')}
            disabled={!!snippetLoading}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border hover:bg-muted disabled:opacity-50"
          >
            {snippetLoading === 'curl' ? <Loader2 className="size-3 animate-spin" /> : <Terminal className="size-3" />}
            curl
          </button>
          <button
            onClick={() => askSnippet('python')}
            disabled={!!snippetLoading}
            className="text-[11px] px-2 py-1 rounded-md border border-border hover:bg-muted disabled:opacity-50"
          >
            {snippetLoading === 'python' ? '…' : 'python'}
          </button>
          <button
            onClick={() => askSnippet('typescript')}
            disabled={!!snippetLoading}
            className="text-[11px] px-2 py-1 rounded-md border border-border hover:bg-muted disabled:opacity-50"
          >
            {snippetLoading === 'typescript' ? '…' : 'ts'}
          </button>
          <button
            onClick={replay}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border hover:bg-muted"
          >
            <RotateCcw className="size-3" />
            Replay
          </button>
        </div>

        <div className="flex items-center gap-1">
          <input
            value={csvName}
            onChange={(e) => setCsvName(e.target.value)}
            className="flex-1 text-[11px] px-2 py-1 rounded-md border border-border bg-background outline-none focus:border-primary/30 font-mono"
          />
          <button
            onClick={extractCsv}
            disabled={csvBusy || !req.resBody}
            className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-md bg-success text-background hover:opacity-90 disabled:opacity-40"
          >
            {csvBusy ? <Loader2 className="size-3 animate-spin" /> : <FileDown className="size-3" />}
            Extract → CSV
          </button>
        </div>

        {explain && (
          <div className="text-[11px] card-soft !rounded-md bg-card p-2.5 whitespace-pre-wrap leading-relaxed font-serif">
            {explain}
          </div>
        )}
        {snippet && (
          <div className="card-soft !rounded-md bg-card overflow-hidden">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border bg-muted/30">
              {snippet.language}
            </div>
            <pre className="text-[10.5px] font-mono p-2.5 overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {snippet.text}
            </pre>
          </div>
        )}
        {replayResult && (
          <div className="text-[11px] text-muted-foreground whitespace-pre-wrap break-all font-mono">
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
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          <Globe className="size-3.5 text-primary" />
          Network
        </div>
        <div className="text-[12px] text-muted-foreground/80 mt-1 font-serif italic">
          XHR & Fetch from the active tab. Ask the copilot to explain, replay, or extract.
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-surface">
        <div className="flex-1 relative">
          <Search className="size-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter url, method, status"
            className="w-full text-[11px] pl-7 pr-2 py-1.5 rounded-md border border-border bg-background outline-none focus:border-primary/30"
          />
        </div>
        <button
          onClick={() => void refreshNetwork()}
          className="text-[11px] px-2 py-1.5 rounded-md border border-border hover:bg-muted"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-rows-[1fr_1fr] flex-1 min-h-0">
        <div className="overflow-y-auto border-b border-border">
          {!activeTabId && (
            <div className="text-xs text-muted-foreground p-6 text-center font-serif italic">
              No active tab.
            </div>
          )}
          {filtered.length === 0 && activeTabId && (
            <div className="text-xs text-muted-foreground p-6 text-center font-serif italic">
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
            <div className="text-xs text-muted-foreground p-6 text-center font-serif italic">
              Select a request to inspect it.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
