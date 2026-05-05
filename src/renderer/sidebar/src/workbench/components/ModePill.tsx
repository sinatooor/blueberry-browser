import React from 'react'
import { Sparkles, PlaySquare, MessageSquare } from 'lucide-react'
import { cn } from '@common/lib/utils'

// The three things this surface can do. Build is the focus (universal
// extension maker); Agent is multi-step automation; Chat is plain Q&A.
export type Mode = 'build' | 'agent' | 'chat'

const MODES: { key: Mode; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'build', label: 'Build', Icon: Sparkles },
    { key: 'agent', label: 'Agent', Icon: PlaySquare },
    { key: 'chat', label: 'Chat', Icon: MessageSquare },
]

interface ModePillProps {
    mode: Mode
    onChange: (mode: Mode) => void
}

export const ModePill: React.FC<ModePillProps> = ({ mode, onChange }) => (
    <div className="inline-flex items-center bg-muted/40 border border-border rounded-md p-0.5">
        {MODES.map((m) => {
            const active = mode === m.key
            return (
                <button
                    key={m.key}
                    type="button"
                    onClick={() => onChange(m.key)}
                    className={cn(
                        'flex items-center gap-1.5 px-2.5 py-1 rounded text-[10.5px] font-medium transition-colors',
                        active
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                    )}
                    aria-pressed={active}
                >
                    <m.Icon className={cn('size-3', active && 'text-primary')} />
                    {m.label}
                </button>
            )
        })}
    </div>
)
