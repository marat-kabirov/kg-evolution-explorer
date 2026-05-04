import { useEffect, useRef } from "react"
import * as d3 from "d3"

const CHANGE_TYPES = [
  { key: "object_property",   color: "#8E44AD", label: "Relation"   },
  { key: "datatype_property", color: "#E67E22", label: "Attribute"  },
  { key: "entity_lifecycle",  color: "#2C3E50", label: "Lifecycle"  },
]

export default function Timeline({ history, timeRange, onRangeChange }) {
  const svgRef    = useRef(null)
  const tooltipRef = useRef(null)

  useEffect(() => {
    if (!Array.isArray(history) || history.length === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll("*").remove()

    const width  = svgRef.current.clientWidth || 800
    const height = 130
    const margin = { left: 40, right: 20, top: 10, bottom: 30 }
    const innerW = width  - margin.left - margin.right
    const innerH = height - margin.top  - margin.bottom

    const parseDate  = d3.timeParse("%Y-%m-%d")
    const validData  = history.filter(d => d?.timestamp?.length >= 10)
    if (validData.length === 0) return

    const dates      = validData.map(d => parseDate(d.timestamp.slice(0, 10))).filter(Boolean)
    const xScaleBase = d3.scaleTime().domain(d3.extent(dates)).range([0, innerW])
    let   xScale     = xScaleBase.copy()

    const g = svg.attr("width", width).attr("height", height)
      .append("g").attr("transform", `translate(${margin.left},${margin.top})`)

    const tooltip = d3.select(tooltipRef.current)

    svg.append("defs").append("clipPath").attr("id", "timeline-clip")
      .append("rect").attr("width", innerW).attr("height", innerH + 5)

    const barsGroup = g.append("g").attr("clip-path", "url(#timeline-clip)")
    const axisGroup = g.append("g").attr("transform", `translate(0,${innerH})`)

    // ── Legend (top-right inside the SVG) ────────────────────────────
    const legendG = g.append("g").attr("transform", `translate(${innerW - 160}, 0)`)
    CHANGE_TYPES.forEach((ct, i) => {
      legendG.append("rect").attr("x", 0).attr("y", i * 14).attr("width", 10).attr("height", 10).attr("fill", ct.color)
      legendG.append("text").attr("x", 14).attr("y", i * 14 + 9).attr("font-size", 10).attr("fill", "#555").text(ct.label)
    })

    const drawBars = (scale) => {
      // Bin the full dataset
      const thresholds = scale.ticks(30)
      const allBins = d3.bin()
        .value(d => parseDate(d.timestamp.slice(0, 10)))
        .domain(scale.domain())
        .thresholds(thresholds)(validData)

      // For each change type, bin separately to get per-type counts
      const binsByType = {}
      CHANGE_TYPES.forEach(ct => {
        const subset = validData.filter(d => d.change_type === ct.key)
        binsByType[ct.key] = d3.bin()
          .value(d => parseDate(d.timestamp.slice(0, 10)))
          .domain(scale.domain())
          .thresholds(thresholds)(subset)
      })

      const yMax = d3.max(allBins, b => b.length) || 1

      barsGroup.selectAll(".bar-group").remove()

      allBins.forEach((bin, i) => {
        if (bin.length === 0) return

        const x     = scale(bin.x0)
        const bw    = Math.max(0, scale(bin.x1) - scale(bin.x0) - 1)
        let   yBase = innerH   // start from bottom

        const barG = barsGroup.append("g").attr("class", "bar-group")

        // Stack each change type
        CHANGE_TYPES.forEach(ct => {
          const count = (binsByType[ct.key][i] || { length: 0 }).length
          if (count === 0) return
          const segH = (count / yMax) * innerH
          yBase -= segH

          barG.append("rect")
            .attr("x", x + 1)
            .attr("width", bw)
            .attr("y", yBase)
            .attr("height", segH)
            .attr("fill", ct.color)
            .attr("opacity", 0.8)
        })

        // Invisible overlay rect for tooltip
        const counts = {}
        CHANGE_TYPES.forEach(ct => {
          counts[ct.key] = (binsByType[ct.key][i] || { length: 0 }).length
        })

        barG.append("rect")
          .attr("x", x + 1)
          .attr("width", bw)
          .attr("y", yBase)
          .attr("height", innerH - yBase)
          .attr("fill", "transparent")
          .on("mouseover", (event) => {
            tooltip.style("display", "block").html(`
              <strong>${bin.length} events</strong><br/>
              ${d3.timeFormat("%b %Y")(bin.x0)}<br/>
              <span style="color:#8E44AD">■</span> Relation: ${counts.object_property}<br/>
              <span style="color:#E67E22">■</span> Attribute: ${counts.datatype_property}<br/>
              <span style="color:#2C3E50">■</span> Lifecycle: ${counts.entity_lifecycle}
            `)
          })
          .on("mousemove", (event) => {
            tooltip
              .style("left", (event.offsetX + 15) + "px")
              .style("top",  (event.offsetY - 10) + "px")
          })
          .on("mouseout", () => tooltip.style("display", "none"))
      })

      axisGroup.call(d3.axisBottom(scale).ticks(6).tickFormat(d3.timeFormat("%Y")))
    }

    drawBars(xScale)

    // ── Brush ────────────────────────────────────────────────────────
    const brush = d3.brushX()
      .extent([[0, 0], [innerW, innerH]])
      .on("end", (event) => {
        if (!event.selection) { onRangeChange({ from: null, to: null }); return }
        const [x0, x1] = event.selection
        onRangeChange({
          from: d3.timeFormat("%Y-%m-%d")(xScale.invert(x0)),
          to:   d3.timeFormat("%Y-%m-%d")(xScale.invert(x1)),
        })
      })

    const brushGroup = g.append("g").attr("class", "brush").call(brush)

    // ── Zoom ─────────────────────────────────────────────────────────
    const zoom = d3.zoom().scaleExtent([1, 20])
      .on("zoom", (event) => {
        xScale = event.transform.rescaleX(xScaleBase)
        drawBars(xScale)
        brushGroup.call(brush.move, null)
        onRangeChange({ from: null, to: null })
      })
      .filter(e => e.type === "wheel")

    svg.call(zoom)
  }, [history])

  return (
    <div className="timeline-container" style={{ position: "relative" }}>
      <div className="timeline-header">
        <span className="panel-title">Timeline</span>
        <span className="timeline-hint">Drag to filter · Scroll to zoom</span>
      </div>
      <svg ref={svgRef} style={{ width: "100%", height: 130 }} />
      <div
        ref={tooltipRef}
        className="graph-tooltip"
        style={{
          display: "none",
          position: "absolute",
          pointerEvents: "none",
          zIndex: 10,
          background: "rgba(255,255,255,0.97)",
          border: "1px solid #ccc",
          borderRadius: 4,
          padding: "6px 10px",
          fontSize: 12,
          lineHeight: 1.6,
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
        }}
      />
    </div>
  )
}