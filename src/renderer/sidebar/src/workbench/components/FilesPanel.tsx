import React from 'react'
import { Folder, FileText, ExternalLink, Download } from 'lucide-react'
import { useWorkbench } from '../contexts/WorkbenchContext'

function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}

function fmtAgo(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

const sourceTag = (s: string): { label: string; cls: string } => {
  switch (s) {
    case 'download':
      return { label: 'download', cls: 'bg-sky-50 dark:bg-sky-950/30 text-sky-700 dark:text-sky-300' }
    case 'agent':
      return {
        label: 'agent',
        cls: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300',
      }
    case 'code':
      return {
        label: 'code',
        cls: 'bg-purple-50 dark:bg-purple-950/30 text-purple-700 dark:text-purple-300',
      }
    default:
      return { label: s, cls: 'bg-muted text-muted-foreground' }
  }
}

export const FilesPanel: React.FC = () => {
  const { files, activeProject, refreshFiles } = useWorkbench()
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          <Folder className="size-3.5" />
          Files
        </div>
        <div className="text-xs text-muted-foreground/80 mt-0.5">
          Sandbox for <span className="font-mono">{activeProject?.slug ?? 'no project'}</span>. Downloads, agent extracts, and code outputs all land here.
        </div>
      </div>
      <div className="px-3 py-1.5 border-b border-border bg-muted/20 flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground">{files.length} files</span>
        <div className="flex-1" />
        <button
          onClick={() => void refreshFiles()}
          className="text-[11px] px-2 py-1 rounded border border-border hover:bg-muted"
        >
          Refresh
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <div className="text-xs text-muted-foreground p-6 text-center">
            <Download className="size-5 mx-auto mb-2 opacity-40" />
            No files yet. The agent and downloads route here automatically.
          </div>
        ) : (
          <ul>
            {files.map((f) => {
              const tag = sourceTag(f.source)
              return (
                <li
                  key={f.id}
                  className="px-3 py-2 border-b border-border/60 hover:bg-muted/30 flex items-center gap-2"
                >
                  <FileText className="size-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono truncate">{f.path}</div>
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
                      <span className={`px-1 rounded ${tag.cls}`}>{tag.label}</span>
                      <span>{fmtBytes(f.bytes)}</span>
                      <span>· {fmtAgo(f.createdAt)}</span>
                    </div>
                  </div>
                  <button
                    onClick={() =>
                      activeProject &&
                      void window.workbench.revealFile(activeProject.id, f.path)
                    }
                    className="text-[10px] p-1 rounded hover:bg-muted"
                    title="Open in OS"
                  >
                    <ExternalLink className="size-3.5" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
