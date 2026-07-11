import { memo, useCallback, useState } from 'react'
import TransitLibrary from './components/TransitLibrary'
import TimelineEditor from './components/TimelineEditor'
import ItineraryPreview from './components/ItineraryPreview'
import { APP_VERSION, BUILD_DATETIME } from './version'
import './App.css'

const StableTimelineEditor = memo(TimelineEditor)
const StableItineraryPreview = memo(ItineraryPreview)

function App() {
  const [libraryCollapsed, setLibraryCollapsed] = useState(
    () => localStorage.getItem('libraryCollapsed') === 'true',
  )

  const handleLibraryCollapsedChange = useCallback((collapsed: boolean) => {
    setLibraryCollapsed(collapsed)
    localStorage.setItem('libraryCollapsed', String(collapsed))
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>行程安排工具</h1>
          <p>约束驱动的拖拽排程</p>
        </div>
        <a className="tutorial-link"
          href="./tutorial.html"
          target="_blank" rel="noreferrer">📖 使用教程</a>
      </header>
      <div className={`app-layout${libraryCollapsed ? ' library-collapsed' : ''}`}>
        <TransitLibrary
          collapsed={libraryCollapsed}
          onCollapsedChange={handleLibraryCollapsedChange}
        />
        <StableTimelineEditor />
        <StableItineraryPreview />
      </div>
      <footer className="app-footer">{APP_VERSION} · {BUILD_DATETIME}</footer>
    </div>
  )
}

export default App
