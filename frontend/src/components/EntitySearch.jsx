import { useState, useEffect } from "react"
import axios from "axios"

export default function EntitySearch({ apiBase, onSelect, selected }) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (query.length < 2) {
      setResults([])
      return
    }
    const timer = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await axios.get(`${apiBase}/entities`, {
          params: { search: query }
        })
        setResults(res.data)
      } catch (e) {
        console.error(e)
      }
      setLoading(false)
    }, 300)

    return () => clearTimeout(timer)
  }, [query, apiBase])

  const handleReset = () => {
    setQuery("");
    setResults([]);
    onSelect(null); // Сбрасываем выбор в родительском компоненте
  }

  return (
    <div className="entity-search">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
        <h3 style={{ margin: 0 }}>Search Entity</h3>
        {selected && (
          <button 
            className="reset-btn" 
            onClick={handleReset}
            style={{ fontSize: "11px", color: "#e74c3c", cursor: "pointer", background: "none", border: "none", textDecoration: "underline" }}
          >
            Clear Selection ✕
          </button>
        )}
      </div>

      <div style={{ position: "relative" }}>
        <input
          className="search-input"
          type="text"
          placeholder="e.g. James, Bryant..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          style={{ width: "100%", padding: "8px", boxSizing: "border-box" }}
        />
        {loading && <div className="search-loading-mini">Searching...</div>}
      </div>

      <div className="search-results">
        {results.map(entity => (
          <div
            key={entity.subject_iri}
            className={`search-result-item ${selected?.subject_iri === entity.subject_iri ? "active" : ""}`}
            onClick={() => {
              onSelect(entity)
              setQuery(entity.subject_label)
              setResults([])
            }}
          >
            <div className="result-label">{entity.subject_label}</div>
            <div className="result-iri">{entity.subject_iri.split("/").pop()}</div>
          </div>
        ))}
      </div>
    </div>
  )
}