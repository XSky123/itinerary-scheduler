import TransitLibrary from './components/TransitLibrary'
import TimelineEditor from './components/TimelineEditor'
import ItineraryPreview from './components/ItineraryPreview'
import { APP_VERSION, BUILD_DATE } from './version'
import './App.css'

function App() {
  return (
    <div className="app">
      <header className="app-header">
        <h1>行程安排工具 <span className="app-version-badge">{APP_VERSION}</span></h1>
        <p>约束驱动的拖拽排程</p>
      </header>
      <div className="app-layout">
        <TransitLibrary />
        <TimelineEditor />
        <ItineraryPreview />
      </div>
      <footer className="app-footer">{APP_VERSION} · {BUILD_DATE}</footer>
    </div>
  )
}

export default App
