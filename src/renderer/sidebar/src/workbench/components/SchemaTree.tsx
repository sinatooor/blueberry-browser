import React, { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@common/lib/utils'
import type { SchemaNode } from '../../../../../common/types'

const TypeBadge: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <span className="text-[9px] uppercase tracking-wide text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded">
        {children}
    </span>
)

interface NodeProps {
    name?: string
    node: SchemaNode | null
    defaultOpen?: boolean
}

export const SchemaTree: React.FC<NodeProps> = ({ name, node, defaultOpen = false }) => {
    const [open, setOpen] = useState(defaultOpen)

    if (!node) {
        return (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {name && <span className="font-mono">{name}:</span>}
                <span>(no sample)</span>
            </div>
        )
    }

    if (node.type === 'object') {
        const entries = Object.entries(node.fields)
        return (
            <div className="text-[11px]">
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="flex items-center gap-1 hover:text-foreground text-foreground/90 w-full text-left"
                >
                    <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
                    {name && <span className="font-mono">{name}</span>}
                    <TypeBadge>object · {entries.length}</TypeBadge>
                </button>
                {open && (
                    <div className="ml-4 mt-1 border-l border-border pl-2 flex flex-col gap-0.5">
                        {entries.map(([k, v]) => (
                            <SchemaTree key={k} name={k} node={v} />
                        ))}
                    </div>
                )}
            </div>
        )
    }

    if (node.type === 'array') {
        return (
            <div className="text-[11px]">
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="flex items-center gap-1 hover:text-foreground text-foreground/90 w-full text-left"
                >
                    <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
                    {name && <span className="font-mono">{name}</span>}
                    <TypeBadge>array[{node.observedLength}]</TypeBadge>
                </button>
                {open && (
                    <div className="ml-4 mt-1 border-l border-border pl-2">
                        {node.item ? (
                            <SchemaTree name="[item]" node={node.item} />
                        ) : (
                            <span className="text-muted-foreground">empty</span>
                        )}
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="flex items-center gap-2 text-[11px]">
            {name && <span className="font-mono text-foreground/90">{name}:</span>}
            <TypeBadge>{node.type}</TypeBadge>
            {'example' in node && node.example !== undefined && (
                <span className="text-[10px] text-muted-foreground truncate">
                    e.g. {JSON.stringify(node.example)}
                </span>
            )}
        </div>
    )
}
