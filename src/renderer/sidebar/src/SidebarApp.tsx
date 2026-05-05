import React, { useEffect } from 'react'
import { WorkbenchProvider } from './workbench/contexts/WorkbenchContext'
import { ApiBankProvider } from './workbench/contexts/ApiBankContext'
import { ThreadProvider } from './workbench/contexts/ThreadContext'
import { Workbench } from './workbench/components/Workbench'
import { useDarkMode } from '@common/hooks/useDarkMode'

const SidebarContent: React.FC = () => {
    const { isDarkMode } = useDarkMode()

    useEffect(() => {
        if (isDarkMode) {
            document.documentElement.classList.add('dark')
        } else {
            document.documentElement.classList.remove('dark')
        }
    }, [isDarkMode])

    return <Workbench />
}

export const SidebarApp: React.FC = () => {
    // Provider order matters:
    //   - ApiBankProvider needs WorkbenchContext (active tab) for spec polling.
    //   - ThreadProvider needs both: WorkbenchContext for agent steps + tab id,
    //     and ApiBankContext to filter the spec passed to buildFeature.
    return (
        <WorkbenchProvider>
            <ApiBankProvider>
                <ThreadProvider>
                    <SidebarContent />
                </ThreadProvider>
            </ApiBankProvider>
        </WorkbenchProvider>
    )
}
