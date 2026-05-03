import React, { useState } from 'react'
import { Play, Trash2, Code, Loader2, FileText } from 'lucide-react'
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
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Code className="size-3.5" />
          Code Interpreter (Python · Pyodide)
        </div>
        <div className="text-xs text-muted-foreground/80 mt-0.5">
          Files in <code className="text-[11px]">/project/files/</code> are mounted. Plots are auto-saved.
        </div>
      </div>

      {files.length > 0 && (
        <div className="px-3 py-1.5 border-b border-border bg-muted/20 flex flex-wrap gap-1.5">
          <span className="text-[10px] uppercase text-muted-foreground tracking-wide self-center">
            Use file:
          </span>
          {files.slice(0, 8).map((f) => (
            <button
              key={f.id}
              onClick={() => insertFileLoad(f.path.split('/').pop()!)}
              className="text-[10px] px-1.5 py-0.5 rounded bg-background border border-border hover:bg-muted font-mono"
            >
              <FileText className="size-2.5 inline mr-0.5" />
              {f.path.split('/').pop()}
            </button>
          ))}
        </div>
      )}

      <textarea
        value={source}
        onChange={(e) => setSource(e.target.value)}
        spellCheck={false}
        className="flex-1 min-h-32 p-3 text-xs font-mono bg-background outline-none resize-none border-b border-border"
      />

      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <button
          onClick={() => void runCode(source)}
          disabled={codeRunning || !activeProject}
          className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {codeRunning ? <Loader2 className="size-3 animate-spin" /> : <Play className="size-3" />}
          Run
        </button>
        <button
          onClick={clearCodeOutputs}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-border hover:bg-muted"
        >
          <Trash2 className="size-3" />
          Clear
        </button>
        <div className="flex-1" />
        {done && (
          <span
            className={cn(
              'text-[11px]',
              done.ok ? 'text-emerald-600' : 'text-rose-600',
            )}
          >
            {done.ok ? `done · ${done.durationMs}ms` : `failed · ${done.error?.slice(0, 60) ?? ''}`}
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {stdout && (
          <pre className="text-xs whitespace-pre-wrap font-mono bg-muted/30 p-2 rounded">
            {stdout}
          </pre>
        )}
        {stderr && (
          <pre className="text-xs whitespace-pre-wrap font-mono bg-rose-50 dark:bg-rose-950/30 text-rose-800 dark:text-rose-200 p-2 rounded">
            {stderr}
          </pre>
        )}
        {images.map((img, i) => (
          <div key={i}>
            <div className="text-[10px] text-muted-foreground mb-1">plot · {img.path}</div>
            <img
              src={`file://${img.path}`}
              className="rounded border border-border max-w-full"
              alt={`plot-${i}`}
            />
          </div>
        ))}
        {!stdout && !stderr && images.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-8">
            No output yet. Hit Run.
          </div>
        )}
      </div>
    </div>
  )
}
