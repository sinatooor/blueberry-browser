import React, { useState } from 'react'
import { ChevronsUpDown, Plus, FolderOpen } from 'lucide-react'
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
        className="w-full flex items-center gap-2 px-3 py-2 border-b border-border hover:bg-muted/40 text-left"
      >
        <FolderOpen className="size-4 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium truncate">
            {activeProject?.name ?? 'No project'}
          </div>
          <div className="text-[10px] text-muted-foreground truncate font-mono">
            {domain ?? activeUrl ?? 'no tab'}
          </div>
        </div>
        <ChevronsUpDown className="size-3 text-muted-foreground" />
      </button>
      {open && (
        <div className="absolute z-10 left-2 right-2 top-full mt-1 rounded-md border border-border bg-background shadow-lg overflow-hidden">
          <ul className="max-h-60 overflow-y-auto">
            {projects.map((p) => (
              <li key={p.id}>
                <button
                  onClick={async () => {
                    await setActiveProject(p.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'w-full text-left text-xs px-3 py-1.5 hover:bg-muted',
                    activeProject?.id === p.id && 'bg-muted/60 font-medium',
                  )}
                >
                  {p.name}
                  <span className="text-[10px] text-muted-foreground ml-2 font-mono">
                    {p.slug}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <form
            className="flex gap-1 border-t border-border p-2 bg-muted/30"
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
              placeholder="New project name"
              className="flex-1 text-xs px-2 py-1 rounded border border-border bg-background"
            />
            <button
              type="submit"
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:opacity-90"
            >
              <Plus className="size-3" /> Add
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
