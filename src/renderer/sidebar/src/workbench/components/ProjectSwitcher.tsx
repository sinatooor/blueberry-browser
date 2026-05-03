import React, { useState } from 'react'
import { ChevronsUpDown, Plus, FolderOpen, Check } from 'lucide-react'
import { useWorkbench } from '../contexts/WorkbenchContext'
import { cn } from '@common/lib/utils'

export const ProjectSwitcher: React.FC = () => {
  const { projects, activeProject, setActiveProject, createProject, domain, activeUrl } =
    useWorkbench()
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 hover-warm border-b border-border text-left"
      >
        <div className="size-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <FolderOpen className="size-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate text-foreground">
            {activeProject?.name ?? 'No project'}
          </div>
          <div className="text-[10.5px] text-muted-foreground truncate font-mono">
            {domain ?? activeUrl ?? 'no tab'}
          </div>
        </div>
        <ChevronsUpDown className="size-3.5 text-muted-foreground shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 left-2 right-2 top-full mt-1 card-soft shadow-expanded overflow-hidden animate-fade-in">
            <ul className="max-h-60 overflow-y-auto py-1">
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={async () => {
                      await setActiveProject(p.id)
                      setOpen(false)
                    }}
                    className={cn(
                      'w-full text-left text-sm px-3 py-1.5 hover-warm flex items-center gap-2',
                      activeProject?.id === p.id && 'bg-primary/8',
                    )}
                  >
                    <Check
                      className={cn(
                        'size-3 shrink-0',
                        activeProject?.id === p.id ? 'text-primary' : 'opacity-0',
                      )}
                    />
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {p.slug}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="flex gap-1.5 border-t border-border p-2 bg-muted/40"
              onSubmit={async (e) => {
                e.preventDefault()
                if (!newName.trim()) return
                await createProject(newName.trim())
                setNewName('')
                setOpen(false)
              }}
            >
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New project…"
                className="flex-1 text-xs px-2.5 py-1.5 rounded-md border border-border bg-background outline-none focus:border-primary/30"
              />
              <button
                type="submit"
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground hover:opacity-90 font-medium"
              >
                <Plus className="size-3" /> Create
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
