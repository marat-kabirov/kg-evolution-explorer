import { useState } from "react"

const CHANGE_CONFIG = {
  object_property:   { icon: "→", color: "#8E44AD", label: "Relation",   desc: "Link to another entity" },
  datatype_property: { icon: "#", color: "#E67E22", label: "Attribute",  desc: "Literal value (number, date, string)" },
  entity_lifecycle:  { icon: "◉", color: "#2C3E50", label: "Lifecycle",  desc: "Entity created or removed" },
}

const OP_COLOR = {
  add:    "#27AE60",
  delete: "#E74C3C",
}

export default function EntityDetail({ history, loading, entityLabel, totalCount }) {
  const [filter, setFilter] = useState("all")
  const [showLegend, setShowLegend] = useState(false)

  const filtered = filter === "all"
    ? history
    : history.filter(e => e.change_type === filter)

  return (
    <div className="entity-detail">
      <div className="panel-header">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="panel-title">Change Log — {entityLabel}</span>
          <span className="event-count">
            {filtered.length}{totalCount !== history.length ? ` / ${totalCount}` : ""} events
          </span>
          {/* Кнопка легенды */}
          <button
            className="legend-toggle"
            onClick={() => setShowLegend(v => !v)}
            title="Show legend"
          >
            {showLegend ? "Hide legend" : "Legend ?"}
          </button>
        </div>
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

      {/* Легенда иконок */}
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
              <span className="change-legend-desc">Triple was added to the graph</span>
            </div>
            <div className="change-legend-item">
              <span className="change-op" style={{ color: OP_COLOR.delete }}>DELETE</span>
              <span className="change-legend-desc">Triple was removed from the graph</span>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <div className="empty-icon-small">📭</div>
          <div>No changes in selected period</div>
          {totalCount > 0 && (
            <div className="empty-hint">
              There are {totalCount} events outside this time range.
              <button
                className="clear-range-hint"
                onClick={() => {}}
              >
                Clear filter
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