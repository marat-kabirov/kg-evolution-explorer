import { useEffect, useRef, useState } from "react"
import * as d3 from "d3"

const CHANGE_TYPES = [
  { key: "object_property",   color: "#8E44AD", label: "Relation"   },
  { key: "datatype_property", color: "#E67E22", label: "Attribute"  },
  { key: "entity_lifecycle",  color: "#2980b9", label: "Lifecycle"  },
]

// ─── helpers ────────────────────────────────────────────────────────────────

function getGranularity(scale) {
  const [a, b] = scale.domain()
  const days = (b - a) / 864e5
  if (days <= 14)  return "day"
  if (days <= 90)  return "week"
  if (days <= 730) return "month"
  return "year"
}

function getThresholds(scale) {
  const gran = getGranularity(scale)
  const [a, b] = scale.domain()
  if (gran === "day")   return d3.timeDays(a, b)
  if (gran === "week")  return d3.timeWeeks(a, b)
  if (gran === "month") return d3.timeMonths(a, b)
  return d3.timeYears(d3.timeYear.floor(a), d3.timeYear.ceil(b))
}

function getTickFormat(scale) {
  const gran = getGranularity(scale)
  if (gran === "day")   return d3.timeFormat("%d %b '%y")
  if (gran === "week")  return d3.timeFormat("W%W '%y")
  if (gran === "month") return d3.timeFormat("%b %Y")
  return d3.timeFormat("%Y")
}

function getGranLabel(scale) {
  const map = { year: "year view", month: "month view", week: "week view", day: "day view" }
  return map[getGranularity(scale)] ?? "overview"
}

// ─── component ──────────────────────────────────────────────────────────────

export default function Timeline({ history, timeRange, onRangeChange }) {
  const svgRef     = useRef(null)
  const tooltipRef = useRef(null)
  const [granLabel, setGranLabel] = useState("year view")
  const [isZoomed, setIsZoomed]   = useState(false)
  const [rangeText, setRangeText] = useState("")

  // store zoom instance so we can reset from the button
  const zoomRef     = useRef(null)
  const xBaseRef    = useRef(null)

  useEffect(() => {
    if (!Array.isArray(history) || history.length === 0) return

    const svgEl  = svgRef.current
    const svg    = d3.select(svgEl)
    svg.selectAll("*").remove()

    const width  = svgEl.clientWidth || 800
    const height = 150
    const M      = { left: 40, right: 20, top: 8, bottom: 28 }
    const iW     = width  - M.left - M.right
    const iH     = height - M.top  - M.bottom

    const parseDate = d3.timeParse("%Y-%m-%d")
    const valid     = history.filter(d => d?.event_time?.length >= 10)
    if (valid.length === 0) return

    const dates  = valid.map(d => parseDate(d.event_time.slice(0, 10))).filter(Boolean)
    const xBase  = d3.scaleTime().domain(d3.extent(dates)).range([0, iW])
    xBaseRef.current = xBase
    let xCur = xBase.copy()

    svg.attr("width", width).attr("height", height)

    svg.append("defs").append("clipPath").attr("id", "tl-clip")
      .append("rect").attr("width", iW).attr("height", iH + 4)

    const g      = svg.append("g").attr("transform", `translate(${M.left},${M.top})`)
    const barsG  = g.append("g").attr("clip-path", "url(#tl-clip)")
    const axisG  = g.append("g").attr("transform", `translate(0,${iH})`)

    const tooltip = d3.select(tooltipRef.current)

    // ── draw ──────────────────────────────────────────────────────────────
    function drawBars(scale) {
      const gran       = getGranularity(scale)
      const thresholds = getThresholds(scale)

      const allBins = d3.bin()
        .value(d => parseDate(d.event_time.slice(0, 10)))
        .domain(scale.domain())
        .thresholds(thresholds)(valid)

      const binsByType = {}
      CHANGE_TYPES.forEach(ct => {
        const sub = valid.filter(d => d.change_type === ct.key)
        binsByType[ct.key] = d3.bin()
          .value(d => parseDate(d.event_time.slice(0, 10)))
          .domain(scale.domain())
          .thresholds(thresholds)(sub)
      })

      const yMax = d3.max(allBins, b => b.length) || 1

      barsG.selectAll(".bar-g").remove()

      allBins.forEach((bin, i) => {
        if (bin.length === 0) return
        const x0 = scale(bin.x0)
        const x1 = scale(bin.x1)
        const bw = Math.max(0, x1 - x0 - 1)
        if (bw <= 0) return

        const bg    = barsG.append("g").attr("class", "bar-g")
        let   yBase = iH

        // stacked colour segments
        CHANGE_TYPES.forEach(ct => {
          const count = (binsByType[ct.key][i] || { length: 0 }).length
          if (count === 0) return
          const segH = (count / yMax) * iH
          yBase -= segH
          bg.append("rect")
            .attr("x", x0 + 0.5).attr("width", bw)
            .attr("y", yBase).attr("height", segH)
            .attr("fill", ct.color).attr("opacity", 0.85)
            .attr("rx", 1)
        })

        // per-type counts for tooltip
        const counts = {}
        CHANGE_TYPES.forEach(ct => {
          counts[ct.key] = (binsByType[ct.key][i] || { length: 0 }).length
        })

        const addRows = bin.filter(d => d.op === "ADD")
        const delRows = bin.filter(d => d.op === "DELETE")

        // transparent hit-area covering full bar height
        bg.append("rect")
          .attr("x", x0 + 0.5).attr("width", bw)
          .attr("y", yBase).attr("height", iH - yBase + 4)
          .attr("fill", "transparent")
          .on("mouseover", (event) => {
            const fmtDate = d3.timeFormat(
              gran === "day"   ? "%d %B %Y" :
              gran === "week"  ? "'Week of' %d %b %Y" :
              gran === "month" ? "%B %Y" : "%Y"
            )

            // on day granularity show individual events (up to 6)
            let detailRows = ""
            if (gran === "day" && bin.length <= 20) {
              detailRows = bin.slice(0, 6).map(d => `
                <div style="display:flex;gap:6px;align-items:baseline;padding:1px 0;">
                  <span style="font-size:10px;color:${d.op === "DELETE" ? "#e74c3c" : "#27ae60"};font-weight:600;">${d.op}</span>
                  <span style="font-size:11px;color:#555;">${d.predicate ?? d.change_type}</span>
                  ${d.value ? `<span style="font-size:10px;color:#999;">→ ${d.value}</span>` : ""}
                </div>`).join("")
              if (bin.length > 6)
                detailRows += `<div style="font-size:10px;color:#aaa;margin-top:2px;">+${bin.length - 6} more…</div>`
            }

            tooltip.style("display", "block").html(`
              <div style="font-weight:600;font-size:13px;margin-bottom:6px;color:#222;">${fmtDate(bin.x0)}</div>
              <div style="display:flex;justify-content:space-between;gap:20px;margin-bottom:3px;">
                <span style="color:#666;">Total</span>
                <span style="font-weight:600;">${bin.length}</span>
              </div>
              ${CHANGE_TYPES.map(ct => `
              <div style="display:flex;justify-content:space-between;gap:20px;">
                <span style="display:flex;align-items:center;gap:5px;color:#666;">
                  <span style="width:8px;height:8px;border-radius:2px;background:${ct.color};display:inline-block;flex-shrink:0;"></span>
                  ${ct.label}
                </span>
                <span style="font-weight:600;">${counts[ct.key]}</span>
              </div>`).join("")}
              <div style="display:flex;justify-content:space-between;gap:20px;border-top:1px solid #eee;margin-top:6px;padding-top:5px;font-size:11px;">
                <span style="color:#27ae60;font-weight:600;">▲ ADD ${addRows.length}</span>
                <span style="color:#e74c3c;font-weight:600;">▼ DELETE ${delRows.length}</span>
              </div>
              ${detailRows ? `<div style="border-top:1px solid #eee;margin-top:6px;padding-top:5px;">${detailRows}</div>` : ""}
            `)
          })
          .on("mousemove", (event) => {
            tooltip
              .style("left", (event.offsetX + 16) + "px")
              .style("top",  (event.offsetY - 10) + "px")
          })
          .on("mouseout", () => tooltip.style("display", "none"))
      })

      // axis
      axisG.call(
        d3.axisBottom(scale)
          .ticks(6)
          .tickFormat(getTickFormat(scale))
          .tickSize(4)
      )
      axisG.selectAll("text").attr("font-size", 10).attr("fill", "#777")
      axisG.selectAll("line, path").attr("stroke", "#ccc")

      setGranLabel(getGranLabel(scale))
    }

    drawBars(xCur)

    // ── brush ─────────────────────────────────────────────────────────────
    const brush = d3.brushX()
      .extent([[0, 0], [iW, iH]])
      .on("end", (event) => {
        if (!event.selection) {
          onRangeChange({ from: null, to: null })
          setRangeText("")
          return
        }
        const [x0, x1] = event.selection
        const from = d3.timeFormat("%Y-%m-%d")(xCur.invert(x0))
        const to   = d3.timeFormat("%Y-%m-%d")(xCur.invert(x1))
        onRangeChange({ from, to })
        setRangeText(`${d3.timeFormat("%d %b %Y")(xCur.invert(x0))} → ${d3.timeFormat("%d %b %Y")(xCur.invert(x1))}`)
      })

    const brushG = g.append("g").attr("class", "brush").call(brush)
    brushG.select(".selection")
      .attr("fill", "rgba(99,130,220,0.18)")
      .attr("stroke", "none")

// ── zoom + pan ────────────────────────────────────────────────────────
const zoom = d3.zoom()
  .scaleExtent([1, 365])
  .on("zoom", (event) => {
    xCur = event.transform.rescaleX(xBase)
    drawBars(xCur)
    brushG.call(brush.move, null)
    onRangeChange({ from: null, to: null })
    setRangeText("")
    const zoomed = event.transform.k > 1.01
    setIsZoomed(zoomed)
    if (zoomRef.current) zoomRef.current.isZoomed = zoomed
  })
  // ← ТОЛЬКО wheel и touch, drag убираем отсюда
  .filter(e => e.type === "wheel" || e.type === "touchstart" || e.type === "touchmove")

svg.call(zoom)

// ── ручной pan через drag (только когда приближено) ───────────────────
let panStart = null
let transformAtPanStart = null

svg.on("mousedown.pan", (event) => {
  if (!zoomRef.current?.isZoomed) return
  // не перехватываем если это начало brush (brush живёт внутри g, не на svg напрямую)
  if (event.target.closest?.(".brush")) return
  panStart = event.clientX
  transformAtPanStart = d3.zoomTransform(svg.node())
  svg.style("cursor", "grabbing")
  event.preventDefault()
})

svg.on("mousemove.pan", (event) => {
  if (panStart === null) return
  const dx = event.clientX - panStart
  const t  = transformAtPanStart
  const newT = d3.zoomIdentity
    .translate(t.x + dx, t.y)
    .scale(t.k)
  svg.call(zoom.transform, newT)
})

svg.on("mouseup.pan mouseleave.pan", () => {
  if (panStart !== null) {
    panStart = null
    transformAtPanStart = null
    svg.style("cursor", zoomRef.current?.isZoomed ? "grab" : null)
  }
})
    zoomRef.current = { svg, zoom, isZoomed: false }
  }, [history])

  function handleReset() {
    if (!zoomRef.current) return
    const { svg, zoom } = zoomRef.current
    svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity)
    setIsZoomed(false)
    setRangeText("")
    onRangeChange({ from: null, to: null })
  }

  return (
    <div className="timeline-container" style={{ position: "relative" }}>

      {/* header */}
      <div className="timeline-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span className="panel-title">Timeline</span>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {/* legend */}
          <div style={{ display: "flex", gap: 10, fontSize: 11, color: "#888" }}>
            {CHANGE_TYPES.map(ct => (
              <span key={ct.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: ct.color, display: "inline-block" }} />
                {ct.label}
              </span>
            ))}
          </div>

          {/* granularity badge */}
          <span style={{
            fontSize: 11, color: "#999", padding: "2px 8px",
            border: "1px solid #e0e0e0", borderRadius: 4,
          }}>
            {granLabel}
          </span>

          {/* reset button */}
          {isZoomed && (
            <button
              onClick={handleReset}
              style={{ fontSize: 11, padding: "2px 10px", cursor: "pointer", borderRadius: 4, border: "1px solid #ccc" }}
            >
              Reset zoom
            </button>
          )}

          <span className="timeline-hint" style={{ fontSize: 11, color: "#aaa" }}>
            Drag to pan · Scroll to zoom
          </span>
        </div>
      </div>

      {/* chart */}
      <svg ref={svgRef} style={{ width: "100%", height: 150 }} />

      {/* range display */}
      {rangeText && (
        <div style={{ fontSize: 11, color: "#999", textAlign: "right", marginTop: 2 }}>
          Filter: {rangeText}
        </div>
      )}

      {/* tooltip */}
      <div
        ref={tooltipRef}
        style={{
          display: "none",
          position: "absolute",
          pointerEvents: "none",
          zIndex: 10,
          background: "rgba(255,255,255,0.98)",
          border: "1px solid #ddd",
          borderRadius: 6,
          padding: "8px 12px",
          fontSize: 12,
          lineHeight: 1.7,
          boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
          minWidth: 180,
        }}
      />
    </div>
  )
}