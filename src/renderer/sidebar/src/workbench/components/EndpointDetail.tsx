import React from 'react'
import { Cookie } from 'lucide-react'
import { cn } from '@common/lib/utils'
import { SchemaTree } from './SchemaTree'
import type { EndpointSpec } from '../../../../../common/types'

// Detail view for one EndpointSpec. Shared by the API Bank's right pane
// and any future popover that wants to show the same level of detail.

const methodTone = (method: string): string => {
    switch (method.toUpperCase()) {
        case 'GET':
            return 'text-foreground'
        case 'POST':
            return 'text-success'
        case 'PUT':
        case 'PATCH':
            return 'text-warning'
        case 'DELETE':
            return 'text-destructive'
        default:
            return 'text-muted-foreground'
    }
}

interface EndpointDetailProps {
    spec: EndpointSpec
}

export const EndpointDetail: React.FC<EndpointDetailProps> = ({ spec }) => {
    const headerEntries = Object.entries(spec.requestHeaders).filter(
        ([k]) => !k.startsWith(':'),
    )
    return (
        <div className="flex flex-col gap-3 p-3 text-[12px]">
            <div>
                <div className="flex items-center gap-2 flex-wrap">
                    <span
                        className={cn(
                            'font-mono text-[11px] font-bold',
                            methodTone(spec.method),
                        )}
                    >
                        {spec.method}
                    </span>
                    <span className="font-mono text-[12px] break-all flex-1 min-w-0">
                        {spec.pathname}
                    </span>
                </div>
                <div className="text-[10.5px] text-muted-foreground mt-1 font-mono break-all">
                    {spec.origin}
                </div>
                <div className="flex flex-wrap gap-2 mt-2 text-[10px] text-muted-foreground">
                    {spec.responseStatus != null && (
                        <span>
                            last status:{' '}
                            <span className="text-foreground tabular-nums">
                                {spec.responseStatus}
                            </span>
                        </span>
                    )}
                    <span>
                        seen ×<span className="text-foreground tabular-nums">{spec.count}</span>
                    </span>
                    {spec.hasAuthHint && (
                        <span className="text-warning">auth: {spec.authHeaderName}</span>
                    )}
                    {spec.hasCsrfHint && (
                        <span className="text-warning">csrf: {spec.csrfHeaderName}</span>
                    )}
                </div>
            </div>

            {spec.queryKeys.length > 0 && (
                <div>
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">
                        Query keys
                    </div>
                    <div className="flex flex-wrap gap-1">
                        {spec.queryKeys.map((k) => (
                            <span
                                key={k}
                                className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded"
                            >
                                {k}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            {headerEntries.length > 0 && (
                <div>
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                        <Cookie className="size-3" />
                        Request headers (sensitive values redacted)
                    </div>
                    <div className="font-mono text-[10px] space-y-0.5 max-h-40 overflow-y-auto">
                        {headerEntries.map(([k, v]) => (
                            <div key={k} className="flex gap-2">
                                <span className="text-muted-foreground">{k}:</span>
                                <span
                                    className={cn(
                                        'truncate',
                                        v === '<redacted>' && 'text-warning',
                                    )}
                                >
                                    {v}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {spec.requestBodySchema && (
                <div>
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">
                        Request body shape
                    </div>
                    <SchemaTree node={spec.requestBodySchema} defaultOpen />
                </div>
            )}

            {spec.responseSchema ? (
                <div>
                    <div className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">
                        Response shape
                    </div>
                    <SchemaTree node={spec.responseSchema} defaultOpen />
                </div>
            ) : (
                <div className="text-[10.5px] text-muted-foreground italic">
                    No JSON response captured (non-JSON, oversize, or streaming).
                </div>
            )}
        </div>
    )
}
