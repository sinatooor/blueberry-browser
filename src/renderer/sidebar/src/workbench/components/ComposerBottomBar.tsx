import React from 'react'
import {
    Sparkles,
    PlaySquare,
    MessageSquare,
    Pause,
    Play,
    Square,
    Globe,
    Boxes,
} from 'lucide-react'
import { cn } from '@common/lib/utils'
import { useWorkbench } from '../contexts/WorkbenchContext'
import type { Mode } from '../contexts/ThreadContext'

// Compact bar that lives directly below the composer textarea. Always shows
// the 3-mode pill on the left; mode-specific helper buttons appear on the
// right and change as the user switches modes.
//
// Build: Captured APIs · Extensions  (popovers — wired in a follow-up commit)
// Agent: Pause / Resume · Cancel · status text
// Chat:  (no extras)

const MODES: { key: Mode; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { key: 'build', label: 'Build', Icon: Sparkles },
    { key: 'agent', label: 'Agent', Icon: PlaySquare },
    { key: 'chat', label: 'Chat', Icon: MessageSquare },
]

interface ModeSwitchProps {
    mode: Mode
    onChange: (m: Mode) => void
}

const ModeSwitch: React.FC<ModeSwitchProps> = ({ mode, onChange }) => (
    <div className="inline-flex items-center bg-muted/40 border border-border rounded-md p-0.5">
        {MODES.map((m) => {
            const active = mode === m.key
            return (
                <button
                    key={m.key}
                    type="button"
                    onClick={() => onChange(m.key)}
                    aria-pressed={active}
                    className={cn(
                        'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors leading-tight',
                        active
                            ? 'bg-background text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                    )}
                >
                    <m.Icon className={cn('size-2.5', active && 'text-primary')} />
                    {m.label}
                </button>
            )
        })}
    </div>
)

const SmallButton: React.FC<{
    onClick?: () => void
    disabled?: boolean
    title?: string
    danger?: boolean
    children: React.ReactNode
}> = ({ onClick, disabled, title, danger, children }) => (
    <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        className={cn(
            'flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded',
            'border border-border hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed',
            'leading-tight',
            danger && 'text-destructive border-destructive/30 hover:bg-destructive/10',
        )}
    >
        {children}
    </button>
)

const BuildExtras: React.FC<{
    onOpenAPIs: () => void
    onOpenExtensions: () => void
}> = ({ onOpenAPIs, onOpenExtensions }) => (
    <>
        <SmallButton onClick={onOpenAPIs} title="Captured APIs (toggle on/off as LLM context)">
            <Globe className="size-2.5" />
            APIs
        </SmallButton>
        <SmallButton
            onClick={onOpenExtensions}
            title="Saved extensions for this site"
        >
            <Boxes className="size-2.5" />
            Extensions
        </SmallButton>
    </>
)

const AgentExtras: React.FC = () => {
    const { currentRun, paused, pauseAgent, resumeAgent, cancelAgent } = useWorkbench()
    const live =
        !!currentRun &&
        ['running', 'planning', 'awaiting-approval', 'paused'].includes(
            currentRun.status,
        )
    return (
        <>
            <SmallButton
                onClick={() => (paused ? resumeAgent() : pauseAgent())}
                disabled={!live}
                title={paused ? 'Resume agent' : 'Pause agent'}
            >
                {paused ? <Play className="size-2.5" /> : <Pause className="size-2.5" />}
                {paused ? 'Resume' : 'Pause'}
            </SmallButton>
            <SmallButton
                onClick={cancelAgent}
                disabled={!live}
                title="Cancel agent run"
                danger
            >
                <Square className="size-2.5" />
                Cancel
            </SmallButton>
            {currentRun && (
                <span className="text-[10px] text-muted-foreground capitalize self-center px-1">
                    {currentRun.status}
                </span>
            )}
        </>
    )
}

interface ComposerBottomBarProps {
    mode: Mode
    onModeChange: (m: Mode) => void
    onOpenAPIs: () => void
    onOpenExtensions: () => void
}

export const ComposerBottomBar: React.FC<ComposerBottomBarProps> = ({
    mode,
    onModeChange,
    onOpenAPIs,
    onOpenExtensions,
}) => (
    <div className="flex items-center gap-1.5 px-1 pt-1.5 flex-wrap">
        <ModeSwitch mode={mode} onChange={onModeChange} />
        <div className="flex items-center gap-1.5">
            {mode === 'build' && (
                <BuildExtras
                    onOpenAPIs={onOpenAPIs}
                    onOpenExtensions={onOpenExtensions}
                />
            )}
            {mode === 'agent' && <AgentExtras />}
            {/* Chat mode: no extras */}
        </div>
    </div>
)
