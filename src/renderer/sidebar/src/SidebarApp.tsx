import React, { useEffect } from 'react'
import { ChatProvider } from './contexts/ChatContext'
import { WorkbenchProvider } from './workbench/contexts/WorkbenchContext'
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
    return (
        <WorkbenchProvider>
            <ChatProvider>
                <SidebarContent />
            </ChatProvider>
        </WorkbenchProvider>
    )
}
