import { useEffect, useRef } from "react"
import * as d3 from "d3"

export default function GraphView({ entity, neighbours, onSelectEntity, history }) {
  const svgRef = useRef(null)
  const tooltipRef = useRef(null)

  useEffect(() => {
    if (!entity || !neighbours.length) return

    const svg = d3.select(svgRef.current)
    svg.selectAll("*").remove()

    const width = svgRef.current.clientWidth || 600
    const height = svgRef.current.clientHeight || 380

    // Считаем операцию и количество событий для каждого соседа
    const neighbourStatus = {}
    const neighbourCount = {}
    if (Array.isArray(history)) {
      history.forEach(event => {
        if (event.change_type === "object_property" && event.object_value) {
          neighbourStatus[event.object_value] = event.operation
          neighbourCount[event.object_value] = (neighbourCount[event.object_value] || 0) + 1
        }
      })
    }

    const nodes = [
      {
        id: entity.subject_iri,
        label: entity.subject_label,
        fullIri: entity.subject_iri,
        isCenter: true,
        count: history?.length || 0
      },
      ...neighbours.map(n => ({
        id: n.iri,
        label: n.label || n.iri.split("/").pop(),
        fullIri: n.iri,
        isCenter: false,
        operation: neighbourStatus[n.iri] || null,
        count: neighbourCount[n.iri] || 0
      }))
    ]

    const links = neighbours.map(n => ({
      source: entity.subject_iri,
      target: n.iri,
      label: neighbours.length <= 8 ? n.predicate_label : "",
      operation: neighbourStatus[n.iri] || null
    }))

    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(110))
      .force("charge", d3.forceManyBody().strength(-280))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide(35))

    const g = svg
      .attr("width", width)
      .attr("height", height)
      .append("g")

    svg.call(d3.zoom()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => g.attr("transform", event.transform))
    )

    const edgeColor = (op) => {
      if (op === "add") return "#27AE60"
      if (op === "delete") return "#E74C3C"
      return "#BDC3C7"
    }

    const nodeColor = (d) => {
      if (d.isCenter) return "#2980B9"
      if (d.operation === "add") return "#27AE60"
      if (d.operation === "delete") return "#E74C3C"
      return "#95A5A6"
    }

    // Tooltip div
    const tooltip = d3.select(tooltipRef.current)

    // Рёбра
    const link = g.selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", d => edgeColor(d.operation))
      .attr("stroke-width", 2)
      .attr("stroke-opacity", 0.7)

    // Подписи рёбер
    const linkLabel = g.selectAll(".link-label")
      .data(links)
      .join("text")
      .attr("class", "link-label")
      .text(d => d.label || "")
      .attr("font-size", 9)
      .attr("fill", "#7F8C8D")
      .attr("text-anchor", "middle")

    // Узлы
    const node = g.selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", d => d.isCenter ? 16 : 10)
      .attr("fill", d => nodeColor(d))
      .attr("stroke", "#fff")
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .on("mouseover", (event, d) => {
        tooltip
          .style("display", "block")
          .style("left", (event.offsetX + 12) + "px")
          .style("top", (event.offsetY - 10) + "px")
          .html(`
            <div class="tooltip-label">${d.label}</div>
            <div class="tooltip-iri">${d.fullIri}</div>
            ${d.count > 0 ? `<div class="tooltip-count">${d.count} change event${d.count !== 1 ? "s" : ""}</div>` : ""}
          `)
      })
      .on("mousemove", (event) => {
        tooltip
          .style("left", (event.offsetX + 12) + "px")
          .style("top", (event.offsetY - 10) + "px")
      })
      .on("mouseout", () => {
        tooltip.style("display", "none")
      })
      .on("click", (event, d) => {
        if (!d.isCenter) {
          onSelectEntity({ subject_iri: d.id, subject_label: d.label })
        }
      })
      .call(d3.drag()
        .on("start", (event, d) => {
          if (!event.active) sim.alphaTarget(0.3).restart()
          d.fx = d.x
          d.fy = d.y
        })
        .on("drag", (event, d) => {
          d.fx = event.x
          d.fy = event.y
        })
        .on("end", (event, d) => {
          if (!event.active) sim.alphaTarget(0)
          d.fx = null
          d.fy = null
        })
      )

    // Badge с количеством событий
    const badge = g.selectAll(".badge")
      .data(nodes.filter(d => d.count > 0))
      .join("g")
      .attr("class", "badge")

    badge.append("circle")
      .attr("r", 8)
      .attr("fill", "#E74C3C")
      .attr("stroke", "#fff")
      .attr("stroke-width", 1)

    badge.append("text")
      .text(d => d.count > 99 ? "99+" : d.count)
      .attr("font-size", 7)
      .attr("fill", "white")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")

    // Метки узлов
    const label = g.selectAll(".node-label")
      .data(nodes)
      .join("text")
      .attr("class", "node-label")
      .text(d => d.label?.split(" ").slice(0, 2).join(" ") || "")
      .attr("font-size", 10)
      .attr("text-anchor", "middle")
      .attr("dy", d => d.isCenter ? -22 : -15)
      .attr("fill", "#2C3E50")
      .style("pointer-events", "none")

    sim.on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y)
      linkLabel
        .attr("x", d => (d.source.x + d.target.x) / 2)
        .attr("y", d => (d.source.y + d.target.y) / 2)
      node
        .attr("cx", d => d.x)
        .attr("cy", d => d.y)
      label
        .attr("x", d => d.x)
        .attr("y", d => d.y)
      badge
        .attr("transform", d => `translate(${d.x + 10}, ${d.y - 10})`)
    })

    return () => sim.stop()
  }, [entity, neighbours, history])

  return (
    <div className="graph-view" style={{ position: "relative" }}>
      <div className="panel-title">Graph Neighbourhood</div>

      <div className="graph-legend">
        <span className="legend-item">
          <span className="legend-dot" style={{ background: "#2980B9" }}></span>Selected
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: "#27AE60" }}></span>Added
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: "#E74C3C" }}></span>Deleted
        </span>
        <span className="legend-item">
          <span className="legend-dot" style={{ background: "#95A5A6" }}></span>Unchanged
        </span>
      </div>

      {neighbours.length === 0 ? (
        <div className="empty">No relations found</div>
      ) : (
        <>
          <svg ref={svgRef} style={{ width: "100%", flex: 1, minHeight: 300 }} />
          {/* Tooltip */}
          <div ref={tooltipRef} className="graph-tooltip" style={{ display: "none" }} />
        </>
      )}
    </div>
  )
}