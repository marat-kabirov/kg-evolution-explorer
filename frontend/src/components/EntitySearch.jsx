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
    }, 300) // debounce — ждём 300ms после последнего символа

    return () => clearTimeout(timer)
  }, [query])

  return (
    <div className="entity-search">
      <h3>Search Entity</h3>
      <input
        className="search-input"
        type="text"
        placeholder="e.g. Messi, Ronaldo..."
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      {loading && <div className="search-loading">Searching...</div>}
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