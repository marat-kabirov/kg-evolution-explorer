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

// Format event_time based on precision — never show fake 01-01
function formatEventTime(dateStr, precision) {
  if (!dateStr) return null
  if (precision === 11) return dateStr.slice(0, 10)         // full date
  if (precision === 10) return dateStr.slice(0, 7)          // year-month
  return dateStr.slice(0, 4)                                // year only
}

// Format knowledge_time — exact datetime from MediaWiki revision
function formatKnowledgeTime(ts) {
  if (!ts) return null
  // ts is "YYYY-MM-DD HH:MM:SS"
  const date = ts.slice(0, 10)
  const time = ts.slice(11, 16)
  return { date, time }
}

export default function EntityDetail({ history, loading, entityLabel, totalCount, onClearRange }) {
  const [filter, setFilter] = useState("all")
  const [showLegend, setShowLegend] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  // Toggle between knowledge_time and event_time as primary sort/display
  const [primaryTime, setPrimaryTime] = useState("knowledge") // "knowledge" | "event"

  const filtered = history.filter(e => {
    const matchesType = filter === "all" || e.change_type === filter
    const term = searchTerm.toLowerCase()
    const matchesSearch =
      e.predicate_label?.toLowerCase().includes(term) ||
      e.object_label?.toLowerCase().includes(term) ||
      e.object_value?.toString().toLowerCase().includes(term)
    return matchesType && matchesSearch
  })

  return (
    <div className="entity-detail">
      <style>{`
        .time-mode-toggle {
          display: flex;
          gap: 0;
          border: 1px solid #ddd;
          border-radius: 4px;
          overflow: hidden;
          font-size: 11px;
        }
        .time-mode-btn {
          padding: 4px 10px;
          border: none;
          background: #f5f5f5;
          cursor: pointer;
          color: #666;
          font-size: 11px;
        }
        .time-mode-btn.active {
          background: #2C3E50;
          color: #fff;
        }
        .change-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px 10px;
          border-bottom: 1px solid #f0f0f0;
          font-size: 13px;
        }
        .change-item:hover {
          background: #fafafa;
        }
        .kt-block {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          min-width: 90px;
        }
        .kt-date {
          font-weight: 600;
          color: #2C3E50;
          font-size: 12px;
          font-family: monospace;
        }
        .kt-time {
          font-size: 10px;
          color: #999;
          font-family: monospace;
        }
        .kt-missing {
          font-size: 11px;
          color: #bbb;
          font-style: italic;
          min-width: 90px;
          text-align: right;
        }
        .et-badge {
          font-size: 10px;
          background: #f0f0f0;
          color: #888;
          border-radius: 3px;
          padding: 1px 5px;
          white-space: nowrap;
        }
        .et-badge.year-only {
          color: #aaa;
        }
        .editor-badge {
          font-size: 10px;
          border-radius: 3px;
          padding: 1px 5px;
          white-space: nowrap;
        }
        .editor-badge.human {
          background: #eaf5ea;
          color: #27AE60;
        }
        .editor-badge.bot {
          background: #fdf2e9;
          color: #E67E22;
        }
        .time-legend-note {
          font-size: 11px;
          color: #888;
          margin-top: 6px;
          padding: 6px 10px;
          background: #f9f9f9;
          border-left: 3px solid #2C3E50;
        }
      `}</style>

      <div className="panel-header">
        <div className="header-top-row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", marginBottom: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="panel-title">Change Log — {entityLabel}</span>
            <span className="event-count">
              {filtered.length}{totalCount !== history.length ? ` / ${totalCount}` : ""} events
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Toggle: which time to show as primary */}
            <div className="time-mode-toggle">
              <button
                className={`time-mode-btn ${primaryTime === "knowledge" ? "active" : ""}`}
                onClick={() => setPrimaryTime("knowledge")}
                title="Sort by when Wikidata was edited (exact timestamp)"
              >
                KG time
              </button>
              <button
                className={`time-mode-btn ${primaryTime === "event" ? "active" : ""}`}
                onClick={() => setPrimaryTime("event")}
                title="Sort by when the real-world event happened"
              >
                Event time
              </button>
            </div>
            <button
              className="legend-toggle"
              onClick={() => setShowLegend(v => !v)}
              title="Show legend"
            >
              {showLegend ? "Hide legend" : "Legend ?"}
            </button>
          </div>
        </div>

        <div className="controls-row" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
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

      {/* Contextual note explaining the two time columns */}
      <div className="time-legend-note">
        {primaryTime === "knowledge"
          ? "📌 Showing when facts were added/removed in Wikidata (knowledge time). Event year shown as context."
          : "📌 Showing when the real-world event occurred (event time). Exact KG edit time shown as context."}
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
              <span className="change-legend-desc">Triple was added to KG</span>
            </div>
            <div className="change-legend-item">
              <span className="change-op" style={{ color: OP_COLOR.delete }}>DELETE</span>
              <span className="change-legend-desc">Triple was removed from KG</span>
            </div>
          </div>
          <div className="change-legend-section">
            <div className="change-legend-title">Time columns</div>
            <div className="change-legend-item">
              <span style={{ fontFamily: "monospace", fontSize: 12, fontWeight: 600 }}>2008-03-14</span>
              <span className="change-legend-desc">KG time — exact Wikidata edit timestamp</span>
            </div>
            <div className="change-legend-item">
              <span className="et-badge year-only">~2004</span>
              <span className="change-legend-desc">Event time — real-world date (~ = year precision only)</span>
            </div>
            <div className="change-legend-item">
              <span className="editor-badge human">human</span>
              <span className="editor-badge bot" style={{ marginLeft: 4 }}>bot</span>
              <span className="change-legend-desc">Who made the edit</span>
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
            const kt  = formatKnowledgeTime(event.knowledge_time)
            const etFormatted = formatEventTime(event.event_time, event.time_precision)
            const isYearOnly  = event.time_precision === 9 || event.time_precision == null

            return (
              <div key={event.id} className="change-item">

                {/* PRIMARY DATE — switches based on toggle */}
                {primaryTime === "knowledge" ? (
                  kt ? (
                    <div className="kt-block">
                      <span className="kt-date">{kt.date}</span>
                      <span className="kt-time">{kt.time}</span>
                    </div>
                  ) : (
                    <span className="kt-missing">no KG time</span>
                  )
                ) : (
                  <div className="kt-block">
                    <span className="kt-date">{etFormatted || "—"}</span>
                    {isYearOnly && etFormatted && (
                      <span className="kt-time">year only</span>
                    )}
                  </div>
                )}

                {/* Change type icon */}
                <span className="change-type-icon" style={{ color: cfg.color }} title={cfg.label}>
                  {cfg.icon}
                </span>

                {/* Operation */}
                <span className="change-op" style={{ color: OP_COLOR[event.operation] }}>
                  {event.operation?.toUpperCase()}
                </span>

                {/* Predicate + value */}
                <span className="change-predicate">{event.predicate_label}</span>
                <span className="change-arrow">→</span>
                <span className="change-value">{event.object_label || event.object_value}</span>

                {/* SECONDARY info — event year badge + editor */}
                <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
                  {primaryTime === "knowledge" && etFormatted && (
                    <span className={`et-badge ${isYearOnly ? "year-only" : ""}`}>
                      {isYearOnly ? `~${etFormatted}` : etFormatted}
                    </span>
                  )}
                  {primaryTime === "event" && kt && (
                    <span className="kt-time" style={{ fontSize: 11, color: "#aaa" }}>
                      {kt.date}
                    </span>
                  )}
                  {event.editor_type && (
                    <span className={`editor-badge ${event.editor_type}`}>
                      {event.editor_type === "bot" ? "🤖" : "✎"} {event.editor_type}
                    </span>
                  )}
                </div>

              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}