import React, { useState } from 'react'
import { Play, Trash2, Code, Loader2, FileText, ChevronDown } from 'lucide-react'
import { useWorkbench } from '../contexts/WorkbenchContext'
import { cn } from '@common/lib/utils'

const DEFAULT_SAMPLE = `# Files in /project/files/ are auto-mounted.
# Try: list files, read JSON, print first lines.
import os
print("files:", os.listdir("/project/files"))
`

export const CodePanel: React.FC = () => {
  const { runCode, codeOutputs, codeRunning, files, activeProject, clearCodeOutputs } =
    useWorkbench()
  const [source, setSource] = useState(DEFAULT_SAMPLE)
  const [filesOpen, setFilesOpen] = useState(true)

  const stdout = codeOutputs
    .filter((o) => o.kind === 'stdout' || o.kind === 'result')
    .map((o) => ('text' in o ? o.text : 'value' in o ? o.value : ''))
    .join('')
  const stderr = codeOutputs
    .filter((o) => o.kind === 'stderr')
    .map((o) => ('text' in o ? o.text : ''))
    .join('')
  const images = codeOutputs.filter((o) => o.kind === 'image') as {
    kind: 'image'
    path: string
    mime: string
  }[]
  const done = codeOutputs.find((o) => o.kind === 'done') as
    | { kind: 'done'; ok: boolean; error?: string; durationMs: number }
    | undefined

  const insertFileLoad = (filename: string): void => {
    const ext = filename.split('.').pop()?.toLowerCase() ?? ''
    let snippet = `path = "/project/files/${filename}"\n`
    if (ext === 'csv') {
      snippet += `import pandas as pd\ndf = pd.read_csv(path)\nprint(df.head())\n`
    } else if (ext === 'json') {
      snippet += `import json\nwith open(path) as f: data = json.load(f)\nprint(type(data), str(data)[:300])\n`
    } else if (['txt', 'md'].includes(ext)) {
      snippet += `with open(path) as f: text = f.read()\nprint(text[:500])\n`
    } else {
      snippet += `# binary file (${ext})\n`
    }
    setSource((s) => `${s}\n\n${snippet}`)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          <Code className="size-3.5 text-primary" />
          Code Interpreter
          <span className="text-[10px] text-muted-foreground/70 normal-case font-normal tracking-normal">
            · Python · Pyodide
          </span>
        </div>
        <div className="text-[12px] text-muted-foreground/80 mt-1 font-serif italic">
          Files in <code className="font-mono not-italic text-[11px] text-foreground/80">/project/files/</code>{' '}
          are mounted. Plots auto-saved.
        </div>
      </div>

      {files.length > 0 && (
        <div className="border-b border-border">
          <button
            onClick={() => setFilesOpen((v) => !v)}
            className="w-full px-4 py-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground hover-warm"
          >
            <ChevronDown
              className={cn('size-3 transition-transform', !filesOpen && '-rotate-90')}
            />
            <span>Use file</span>
            <span className="ml-auto text-muted-foreground/60 normal-case tracking-normal">
              {files.length} available
            </span>
          </button>
          {filesOpen && (
            <div className="px-3 pb-2 flex flex-wrap gap-1.5">
              {files.slice(0, 12).map((f) => (
                <button
                  key={f.id}
                  onClick={() => insertFileLoad(f.path.split('/').pop()!)}
                  className="text-[10.5px] px-2 py-1 rounded-md border border-border bg-card hover:bg-muted hover:border-primary/30 font-mono transition-colors flex items-center gap-1"
                >
                  <FileText className="size-2.5 text-muted-foreground" />
                  {f.path.split('/').pop()}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="px-2 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-primary/60" />
          Editor
        </div>
        <textarea
          value={source}
          onChange={(e) => setSource(e.target.value)}
          spellCheck={false}
          className={cn(
            'flex-1 min-h-32 mx-2 mb-2 p-3 text-xs font-mono leading-relaxed',
            'bg-card border border-border rounded-md outline-none resize-none',
            'focus:border-primary/30 focus:ring-2 focus:ring-primary/10 transition-colors',
          )}
          style={{ fontFeatureSettings: '"liga" 0' }}
        />

        <div className="flex items-center gap-1.5 px-3 py-2 border-t border-border bg-surface">
          <button
            onClick={() => void runCode(source)}
            disabled={codeRunning || !activeProject}
            className="flex items-center gap-1.5 text-[11px] font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            {codeRunning ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
            Run
          </button>
          <button
            onClick={clearCodeOutputs}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-md border border-border hover:bg-muted"
          >
            <Trash2 className="size-3" />
            Clear
          </button>
          <div className="flex-1" />
          {done && (
            <span
              className={cn(
                'text-[10.5px] font-mono tabular-nums',
                done.ok ? 'text-success' : 'text-destructive',
              )}
            >
              {done.ok ? `✓ ${done.durationMs}ms` : `× ${done.error?.slice(0, 50) ?? 'error'}`}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 bg-background min-h-32">
          {stdout && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-medium">
                Output
              </div>
              <pre className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono bg-card border border-border rounded-md p-3">
                {stdout}
              </pre>
            </div>
          )}
          {stderr && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-destructive mb-1 font-medium">
                Stderr
              </div>
              <pre className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono bg-destructive/8 border border-destructive/20 text-destructive rounded-md p-3">
                {stderr}
              </pre>
            </div>
          )}
          {images.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-medium">
                Plots
              </div>
              <div className="space-y-2">
                {images.map((img, i) => (
                  <div key={i} className="card-soft p-2">
                    <img
                      src={`file://${img.path}`}
                      className="rounded w-full"
                      alt={`plot-${i}`}
                    />
                    <div className="text-[10px] text-muted-foreground mt-1.5 font-mono truncate">
                      {img.path.split('/').pop()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          {!stdout && !stderr && images.length === 0 && (
            <div className="text-xs text-muted-foreground text-center py-6 font-serif italic">
              No output yet. Hit Run.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
