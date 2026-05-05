import React, { useEffect } from 'react'
import { WorkbenchProvider } from './workbench/contexts/WorkbenchContext'
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
    // ThreadProvider lives inside WorkbenchProvider because it consumes
    // workbench state (active tab, agent steps, project) when wiring sends.
    return (
        <WorkbenchProvider>
            <ThreadProvider>
                <SidebarContent />
            </ThreadProvider>
        </WorkbenchProvider>
    )
}
