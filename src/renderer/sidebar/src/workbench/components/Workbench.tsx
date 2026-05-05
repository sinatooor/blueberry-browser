import React from 'react'
import { MainSurface } from './MainSurface'

// Workbench is now a thin shell. The interesting work happens in MainSurface
// (the unified mode-pill surface) plus the InspectDrawer it owns.
//
// We kept this wrapper so external imports (SidebarApp.tsx) don't have to
// change shape — and so future cross-cutting concerns (keyboard shortcuts,
// session restoration) have an obvious home.
export const Workbench: React.FC = () => {
    return <MainSurface />
}
