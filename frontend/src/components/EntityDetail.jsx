import { useState } from "react"

const CHANGE_CONFIG = {
  object_property:   { icon: "→", color: "#8E44AD", label: "Relation",  desc: "Link to another entity" },
  datatype_property: { icon: "#", color: "#E67E22", label: "Attribute",  desc: "Literal value (number, date, string)" },
  entity_lifecycle:  { icon: "◉", color: "#2C3E50", label: "Lifecycle",  desc: "Entity created or removed" },
}

const OP_COLOR = {
  add:    "#27AE60",
  delete: "#E74C3C",
}

export default function EntityDetail({ history, loading, entityLabel, totalCount, onClearRange }) {
  const [filter, setFilter] = useState("all")
  const [showLegend, setShowLegend] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")

  // Комбинированная фильтрация: по типу И по тексту
  const filtered = history.filter(e => {
    const matchesType = filter === "all" || e.change_type === filter;
    const term = searchTerm.toLowerCase();
    const matchesSearch = 
      e.predicate_label?.toLowerCase().includes(term) ||
      e.object_label?.toLowerCase().includes(term) ||
      e.object_value?.toString().toLowerCase().includes(term);
    
    return matchesType && matchesSearch;
  })

  return (
    <div className="entity-detail">
      <div className="panel-header">
        <div className="header-top-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", marginBottom: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="panel-title">Change Log — {entityLabel}</span>
            <span className="event-count">
              {filtered.length}{totalCount !== history.length ? ` / ${totalCount}` : ""} events
            </span>
          </div>
          <button
            className="legend-toggle"
            onClick={() => setShowLegend(v => !v)}
            title="Show legend"
          >
            {showLegend ? "Hide legend" : "Legend ?"}
          </button>
        </div>

        <div className="controls-row" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {/* Поле поиска по предикату */}
          <input 
            type="text"
            className="predicate-search-input"
            placeholder="Search by predicate or value..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{ padding: "6px 10px", borderRadius: "4px", border: "1px solid #ccc" }}
          />

          <div className="filter-buttons">
            {["all", "object_property", "datatype_property", "entity_lifecycle"].map(f => (
              <button
                key={f}
                className={`filter-btn ${filter === f ? "active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f === "all" ? "All" : CHANGE_CONFIG[f]?.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showLegend && (
        <div className="change-legend">
          <div className="change-legend-section">
            <div className="change-legend-title">Change type</div>
            {Object.entries(CHANGE_CONFIG).map(([key, cfg]) => (
              <div key={key} className="change-legend-item">
                <span className="change-type-icon" style={{ color: cfg.color }}>{cfg.icon}</span>
                <span className="change-legend-label">{cfg.label}</span>
                <span className="change-legend-desc">{cfg.desc}</span>
              </div>
            ))}
          </div>
          <div className="change-legend-section">
            <div className="change-legend-title">Operation</div>
            <div className="change-legend-item">
              <span className="change-op" style={{ color: OP_COLOR.add }}>ADD</span>
              <span className="change-legend-desc">Triple was added</span>
            </div>
            <div className="change-legend-item">
              <span className="change-op" style={{ color: OP_COLOR.delete }}>DELETE</span>
              <span className="change-legend-desc">Triple was removed</span>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading-container" style={{ textAlign: "center", padding: "40px" }}>
          <div className="spinner"></div>
          <div style={{ marginTop: "10px", color: "#7f8c8d" }}>Loading changes...</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon-small">📭</div>
          <div>No changes found</div>
          {totalCount > 0 && (
            <div className="empty-hint">
              <button className="clear-range-hint" onClick={onClearRange}>
                Clear time filter
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="change-list">
          {filtered.map(event => {
            const cfg = CHANGE_CONFIG[event.change_type] || { icon: "?", color: "#999" }
            return (
              <div key={event.id} className="change-item">
                <span className="change-date">{event.timestamp?.slice(0, 10)}</span>
                <span className="change-type-icon" style={{ color: cfg.color }} title={cfg.label}>
                  {cfg.icon}
                </span>
                <span className="change-op" style={{ color: OP_COLOR[event.operation] }}>
                  {event.operation?.toUpperCase()}
                </span>
                <span className="change-predicate">{event.predicate_label}</span>
                <span className="change-arrow">→</span>
                <span className="change-value">{event.object_label || event.object_value}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}