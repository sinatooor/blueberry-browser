import React, { useState } from 'react'
import { Folder, FileText, ExternalLink, Download, MoveRight } from 'lucide-react'
import { useWorkbench } from '../contexts/WorkbenchContext'
import type { SandboxFile } from '../../../../../common/types'

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
      return { label: 'download', cls: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' }
    case 'agent':
      return { label: 'agent', cls: 'bg-primary/12 text-primary' }
    case 'code':
      return { label: 'code', cls: 'bg-success/12 text-success' }
    default:
      return { label: s, cls: 'bg-muted text-muted-foreground' }
  }
}

const MoveMenu: React.FC<{ file: SandboxFile; onClose: () => void }> = ({ file, onClose }) => {
  const { projects, activeProject, refreshFiles } = useWorkbench()
  const others = projects.filter((p) => p.id !== file.projectId)
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 z-20 card-soft shadow-expanded min-w-44 py-1 animate-fade-in">
        <div className="px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Move to…
        </div>
        {others.length === 0 ? (
          <div className="px-2.5 py-1.5 text-[11px] text-muted-foreground italic">No other projects</div>
        ) : (
          others.map((p) => (
            <button
              key={p.id}
              onClick={async () => {
                await window.workbench.moveFileToProject({
                  fileId: file.id,
                  fromProjectId: file.projectId,
                  destProjectId: p.id,
                  relPath: file.path,
                })
                if (activeProject) await refreshFiles()
                onClose()
              }}
              className="w-full text-left px-2.5 py-1.5 text-[11px] hover-warm flex items-center gap-1.5"
            >
              <MoveRight className="size-3 text-muted-foreground" />
              <span className="flex-1 truncate">{p.name}</span>
              <span className="text-[10px] text-muted-foreground font-mono">{p.slug}</span>
            </button>
          ))
        )}
      </div>
    </>
  )
}

const FileRow: React.FC<{ file: SandboxFile }> = ({ file }) => {
  const { activeProject } = useWorkbench()
  const [menuOpen, setMenuOpen] = useState(false)
  const tag = sourceTag(file.source)
  return (
    <li className="relative px-3 py-2.5 border-b border-border/60 hover-warm flex items-center gap-3 group">
      <div className="size-8 rounded-md bg-muted/50 flex items-center justify-center shrink-0">
        <FileText className="size-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-mono truncate text-foreground/90">{file.path}</div>
        <div className="text-[10px] text-muted-foreground flex items-center gap-1.5 mt-0.5">
          <span className={`px-1.5 py-px rounded font-medium ${tag.cls}`}>{tag.label}</span>
          <span className="tabular-nums">{fmtBytes(file.bytes)}</span>
          <span>·</span>
          <span>{fmtAgo(file.createdAt)}</span>
        </div>
      </div>
      <div className="relative shrink-0 flex items-center opacity-60 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="p-1.5 rounded-md hover:bg-muted"
          title="Move to another project"
        >
          <MoveRight className="size-3.5" />
        </button>
        <button
          onClick={() =>
            activeProject &&
            void window.workbench.revealFile(activeProject.id, file.path)
          }
          className="p-1.5 rounded-md hover:bg-muted"
          title="Open in OS"
        >
          <ExternalLink className="size-3.5" />
        </button>
        {menuOpen && <MoveMenu file={file} onClose={() => setMenuOpen(false)} />}
      </div>
    </li>
  )
}

export const FilesPanel: React.FC = () => {
  const { files, activeProject, refreshFiles } = useWorkbench()
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          <Folder className="size-3.5 text-primary" />
          Files
        </div>
        <div className="text-[12px] text-muted-foreground/80 mt-1 font-serif italic">
          Sandbox for{' '}
          <span className="font-mono not-italic text-[11px] text-foreground/80">
            {activeProject?.slug ?? 'no project'}
          </span>
          . Downloads, agent extracts, and code outputs all land here.
        </div>
      </div>
      <div className="px-3 py-2 border-b border-border bg-surface flex items-center gap-2">
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => void refreshFiles()}
          className="text-[11px] px-2.5 py-1 rounded-md border border-border hover:bg-muted"
        >
          Refresh
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <Download className="size-6 mx-auto mb-3 text-muted-foreground/40" />
            <div className="text-xs text-muted-foreground font-serif italic max-w-xs mx-auto">
              No files yet. Downloads and agent outputs route here automatically.
            </div>
          </div>
        ) : (
          <ul>
            {files.map((f) => (
              <FileRow key={f.id} file={f} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
