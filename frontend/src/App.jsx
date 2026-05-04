import { useState, useEffect, useCallback } from "react"
import axios from "axios"
import EntitySearch from "./components/EntitySearch"
import Timeline from "./components/Timeline"
import EntityDetail from "./components/EntityDetail"
import GraphView from "./components/GraphView"
import "./App.css"

const API = "http://localhost:8000"

export default function App() {
  const [selectedEntity, setSelectedEntity] = useState(null)
  const [allHistory, setAllHistory] = useState([])      // полная история — не меняется
  const [history, setHistory] = useState([])             // отфильтрованная — показывается
  const [neighbours, setNeighbours] = useState([])
  const [timeRange, setTimeRange] = useState({ from: null, to: null })
  const [loading, setLoading] = useState(false)

  // Загружаем данные когда выбрана сущность
  useEffect(() => {
    if (!selectedEntity) return

    const fetchData = async () => {
      setLoading(true)
      try {
        const [histRes, neighRes] = await Promise.all([
          axios.get(`${API}/entities/${encodeURIComponent(selectedEntity.subject_iri)}/history`),
          axios.get(`${API}/entities/${encodeURIComponent(selectedEntity.subject_iri)}/neighbours`)
        ])
        const data = Array.isArray(histRes.data) ? histRes.data : []
        setAllHistory(data)
        setHistory(data)
        setNeighbours(Array.isArray(neighRes.data) ? neighRes.data : [])
        setTimeRange({ from: null, to: null })
      } catch (e) {
        console.error(e)
      }
      setLoading(false)
    }

    fetchData()
  }, [selectedEntity])

  // Фильтруем локально когда меняется timeRange — без запроса к серверу
  // Это быстрее и даёт мгновенный отклик для R1
  useEffect(() => {
    if (!allHistory.length) return

    if (!timeRange.from && !timeRange.to) {
      setHistory(allHistory)
      return
    }

    const filtered = allHistory.filter(event => {
      const ts = event.timestamp?.slice(0, 10)
      if (!ts) return false
      if (timeRange.from && ts < timeRange.from) return false
      if (timeRange.to && ts > timeRange.to) return false
      return true
    })

    setHistory(filtered)
  }, [timeRange, allHistory])

  // Когда кликают на соседний узел в графе
  const handleSelectNeighbour = useCallback((entity) => {
    setSelectedEntity(entity)
  }, [])

  return (
    <div className="app">
      <header className="app-header">
        <h1>KG Evolution Explorer</h1>
        <p className="subtitle">Entity-level visualization of Knowledge Graph evolution</p>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <EntitySearch
            apiBase={API}
            onSelect={setSelectedEntity}
            selected={selectedEntity}
          />
        </aside>

        <main className="main-content">
          {!selectedEntity ? (
            <div className="empty-state">
              <div className="empty-icon">🔍</div>
              <h2>Select an entity to explore its evolution</h2>
              <p>Search for a basketball player on the left to see how their data changed over time</p>
            </div>
          ) : (
            <>
              <div className="entity-title">
                <h2>{selectedEntity.subject_label}</h2>
                <a href={selectedEntity.subject_iri} target="_blank" rel="noreferrer" className="iri-link">
                  {selectedEntity.subject_iri}
                </a>
                {timeRange.from && (
                  <span className="time-range-badge">
                    {timeRange.from} → {timeRange.to}
                    <button
                      className="clear-range"
                      onClick={() => setTimeRange({ from: null, to: null })}
                    >
                      ✕
                    </button>
                  </span>
                )}
              </div>

              <Timeline
                history={allHistory}
                timeRange={timeRange}
                onRangeChange={setTimeRange}
              />

              <div className="bottom-panels">
                <EntityDetail
                  history={history}
                  loading={loading}
                  entityLabel={selectedEntity.subject_label}
                  totalCount={allHistory.length}
                />
                <GraphView
                  entity={selectedEntity}
                  neighbours={neighbours}
                  onSelectEntity={handleSelectNeighbour}
                  history={history}
                />
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}