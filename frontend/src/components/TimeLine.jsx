import { useEffect, useRef } from "react"
import * as d3 from "d3"

export default function Timeline({ history, timeRange, onRangeChange }) {
  const svgRef = useRef(null)

  useEffect(() => {
    if (!Array.isArray(history) || history.length === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll("*").remove()

    const width = svgRef.current.clientWidth || 800
    const height = 110
    const margin = { left: 40, right: 20, top: 10, bottom: 30 }
    const innerW = width - margin.left - margin.right
    const innerH = height - margin.top - margin.bottom

    const parseDate = d3.timeParse("%Y-%m-%d")

    const validData = history.filter(d => {
      const ts = d?.timestamp
      return ts && typeof ts === "string" && ts.length >= 10
    })

    if (validData.length === 0) return

    const dates = validData
      .map(d => parseDate(d.timestamp.slice(0, 10)))
      .filter(Boolean)

    if (dates.length === 0) return

    const xScaleBase = d3.scaleTime()
      .domain(d3.extent(dates))
      .range([0, innerW])

    let xScale = xScaleBase.copy()

    const g = svg
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`)

    // Clip path
    svg.append("defs").append("clipPath")
      .attr("id", "timeline-clip")
      .append("rect")
      .attr("width", innerW)
      .attr("height", innerH + 5)

    const barsGroup = g.append("g")
      .attr("clip-path", "url(#timeline-clip)")

    const axisGroup = g.append("g")
      .attr("transform", `translate(0,${innerH})`)

    const drawBars = (scale) => {
      const bins = d3.bin()
        .value(d => parseDate(d.timestamp.slice(0, 10)))
        .domain(scale.domain())
        .thresholds(scale.ticks(30))
        (validData)

      const yMax = d3.max(bins, b => b.length) || 1

      barsGroup.selectAll("rect").remove()
      barsGroup.selectAll("rect")
        .data(bins)
        .join("rect")
        .attr("x", d => scale(d.x0) + 1)
        .attr("width", d => Math.max(0, scale(d.x1) - scale(d.x0) - 1))
        .attr("y", d => innerH - (d.length / yMax) * innerH)
        .attr("height", d => (d.length / yMax) * innerH)
        .attr("fill", "#3498DB")
        .attr("opacity", 0.7)

      axisGroup.call(
        d3.axisBottom(scale).ticks(6).tickFormat(d3.timeFormat("%Y"))
      )
    }

    drawBars(xScale)

    // ── Brush — главный слой, поверх всего ──────────────────────────
    // Brush НЕ трогаем zoom'ом — у них разные слои
    const brush = d3.brushX()
      .extent([[0, 0], [innerW, innerH]])
      .on("brush", (event) => {
        // Во время brush — ничего не делаем, только показываем выделение
      })
      .on("end", (event) => {
        if (!event.selection) {
          onRangeChange({ from: null, to: null })
          return
        }
        const [x0, x1] = event.selection
        onRangeChange({
          from: d3.timeFormat("%Y-%m-%d")(xScale.invert(x0)),
          to:   d3.timeFormat("%Y-%m-%d")(xScale.invert(x1))
        })
      })

    const brushGroup = g.append("g")
      .attr("class", "brush")
      .call(brush)

    // ── Zoom — отдельный невидимый прямоугольник ТОЛЬКО для скролла ─
    // Он не перехватывает drag (brush делает drag сам)
    const zoom = d3.zoom()
      .scaleExtent([1, 20])
      .translateExtent([[0, 0], [innerW, innerH]])
      .extent([[0, 0], [innerW, innerH]])
      .filter((event) => {
        // Zoom работает ТОЛЬКО на колёсико мыши, НЕ на drag
        return event.type === "wheel"
      })
      .on("zoom", (event) => {
        xScale = event.transform.rescaleX(xScaleBase)
        drawBars(xScale)
        // Сбрасываем brush визуально при zoom
        brushGroup.call(brush.move, null)
        onRangeChange({ from: null, to: null })
      })

    // Zoom применяем к тому же svg
    svg.call(zoom)

  }, [history])

  return (
    <div className="timeline-container">
      <div className="timeline-header">
        <span className="panel-title">Timeline</span>
        <span className="timeline-hint">
          Drag to select range · Scroll to zoom
        </span>
      </div>
      <svg ref={svgRef} style={{ width: "100%", height: 110 }} />
    </div>
  )
}