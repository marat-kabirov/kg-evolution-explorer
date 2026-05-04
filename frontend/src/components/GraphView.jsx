import { useEffect, useRef, useState } from "react"
import * as d3 from "d3"

export default function GraphView({ entity, neighbours, onSelectEntity, history }) {
  const svgRef = useRef(null)
  const tooltipRef = useRef(null)
  const [showAll, setShowAll] = useState(false)
  const MAX_NEIGHBOURS = 15 // Увеличим для информативности

  useEffect(() => {
    if (!entity) return

    const svg = d3.select(svgRef.current)
    svg.selectAll("*").remove()

    const width = svgRef.current.clientWidth || 600
    const height = svgRef.current.clientHeight || 400

    // 1. АНАЛИЗ ИСТОРИИ С ПРИОРИТЕТОМ УДАЛЕНИЯ
    const neighbourStatus = {}
    const neighbourCount = {}
    const historyLabels = {}

    if (Array.isArray(history)) {
      // Сортируем историю по времени (от старых к новым), если есть timestamp
      const sortedHistory = [...history].sort((a, b) => 
        new Date(a.timestamp) - new Date(b.timestamp)
      )

      sortedHistory.forEach(event => {
        if (event.change_type === "object_property" && event.object_value) {
          const iri = event.object_value
          
          // СТРОГАЯ ЛОГИКА СТАТУСА:
          // Если мы когда-либо видели 'delete' для этого IRI, 
          // помечаем его как удаленный, даже если потом были мелкие 'add' (правки метаданных)
          if (!neighbourStatus[iri] || event.operation === "delete") {
            neighbourStatus[iri] = event.operation
          }
          
          neighbourCount[iri] = (neighbourCount[iri] || 0) + 1
          if (event.object_label) historyLabels[iri] = event.object_label
        }
      })
    }

    // 2. ОПРЕДЕЛЕНИЕ ТИПА НОДЫ (Current vs Historical)
    const currentIris = new Set(neighbours.map(n => n.iri))
    
    // Собираем всех, кто есть в истории, но отсутствует в текущих связях
    const historicalNeighbours = Object.keys(neighbourStatus)
      .filter(iri => !currentIris.has(iri))
      .map(iri => ({
        iri,
        label: historyLabels[iri] || iri.split("/").pop(),
        isDeleted: true // Явно помечаем как удаленную связь
      }))

    // 3. ФОРМИРОВАНИЕ СПИСКА (Hairball Control)
    const allPotentialNodes = [...neighbours, ...historicalNeighbours]
    
    // Приоритет при сортировке: сначала те, у кого статус 'delete', потом по количеству правок
    const sorted = allPotentialNodes.sort((a, b) => {
      const aStat = neighbourStatus[a.iri] === 'delete' ? 1 : 0
      const bStat = neighbourStatus[b.iri] === 'delete' ? 1 : 0
      if (bStat !== aStat) return bStat - aStat
      return (neighbourCount[b.iri] || 0) - (neighbourCount[a.iri] || 0)
    })

    const displayed = showAll ? sorted : sorted.slice(0, MAX_NEIGHBOURS)

    const nodes = [
      { id: entity.subject_iri, label: entity.subject_label, isCenter: true, count: history?.length || 0 },
      ...displayed.map(n => ({
        id: n.iri,
        label: n.label,
        isCenter: false,
        // Если ноды нет в текущих (currentIris), она точно 'delete'
        operation: !currentIris.has(n.iri) ? "delete" : neighbourStatus[n.iri],
        count: neighbourCount[n.iri] || 0
      }))
    ]

    const links = displayed.map(n => ({
      source: entity.subject_iri,
      target: n.iri,
      operation: !currentIris.has(n.iri) ? "delete" : neighbourStatus[n.iri],
      label: displayed.length <= 6 ? (n.predicate_label || "") : ""
    }))

    // 4. D3 RENDERING
    const sim = d3.forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(130))
      .force("charge", d3.forceManyBody().strength(-400))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide(45))

    const g = svg.append("g")
    svg.call(d3.zoom().scaleExtent([0.1, 5]).on("zoom", (e) => g.attr("transform", e.transform)))

    // Цвета: Яркий красный для удаленных, спокойный зеленый для существующих
    const getLinkColor = (op) => op === "delete" ? "#E74C3C" : (op === "add" ? "#2ECC71" : "#BDC3C7")
    const getNodeColor = (d) => {
      if (d.isCenter) return "#34495E"
      if (d.operation === "delete") return "#C0392B" // Темно-красный
      if (d.operation === "add") return "#27AE60"
      return "#7F8C8D"
    }

    const link = g.selectAll("line").data(links).join("line")
      .attr("stroke", d => getLinkColor(d.operation))
      .attr("stroke-width", d => d.operation === "delete" ? 3 : 2)
      .attr("stroke-dasharray", d => d.operation === "delete" ? "5 3" : "0")
      .attr("stroke-opacity", 0.8)

    const node = g.selectAll("circle").data(nodes).join("circle")
      .attr("r", d => d.isCenter ? 20 : 13)
      .attr("fill", d => getNodeColor(d))
      .attr("stroke", "#fff")
      .attr("stroke-width", 2)
      .style("cursor", "pointer")
      .on("mouseover", (event, d) => {
        d3.select(tooltipRef.current)
          .style("display", "block")
          .html(`
            <div style="font-weight:bold">${d.label}</div>
            <div style="color:${d.operation === 'delete' ? 'red' : 'inherit'}">
              Status: ${d.operation === 'delete' ? 'DELETED / HISTORICAL' : 'Active'}
            </div>
            <div>Changes detected: ${d.count}</div>
          `)
      })
      .on("mousemove", (event) => {
        d3.select(tooltipRef.current)
          .style("left", (event.offsetX + 15) + "px")
          .style("top", (event.offsetY - 20) + "px")
      })
      .on("mouseout", () => d3.select(tooltipRef.current).style("display", "none"))
      .on("click", (e, d) => !d.isCenter && onSelectEntity({ subject_iri: d.id, subject_label: d.label }))
      .call(d3.drag()
        .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y })
        .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y })
        .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null }))

    const label = g.selectAll(".node-label").data(nodes).join("text")
      .text(d => d.label?.length > 18 ? d.label.slice(0, 15) + "..." : d.label)
      .attr("font-size", 11)
      .attr("text-anchor", "middle")
      .attr("dy", d => d.isCenter ? -28 : -20)
      .style("pointer-events", "none")
      .attr("fill", "#2C3E50")

    sim.on("tick", () => {
      link.attr("x1", d => d.source.x).attr("y1", d => d.source.y).attr("x2", d => d.target.x).attr("y2", d => d.target.y)
      node.attr("cx", d => d.x).attr("cy", d => d.y)
      label.attr("x", d => d.x).attr("y", d => d.y)
    })

    return () => sim.stop()
  }, [entity, neighbours, history, showAll])

  return (
    <div className="graph-view" style={{ position: "relative", height: "100%", background: "#f9f9f9", borderRadius: "8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", padding: "12px", borderBottom: "1px solid #eee" }}>
        <span style={{ fontWeight: "bold", color: "#34495E" }}>Network Discovery & History</span>
        <button 
          className={`filter-btn ${showAll ? 'active' : ''}`} 
          onClick={() => setShowAll(!showAll)}
          style={{ fontSize: "11px", padding: "4px 10px", cursor: "pointer" }}
        >
          {showAll ? "Show Top Connections" : `Scan Full History (${history?.length || 0} events)`}
        </button>
      </div>
      <svg ref={svgRef} style={{ width: "100%", height: "400px" }} />
      <div 
        ref={tooltipRef} 
        style={{ 
          display: "none", 
          position: "absolute", 
          background: "rgba(255,255,255,0.95)", 
          padding: "8px", 
          border: "1px solid #34495E", 
          borderRadius: "4px", 
          boxShadow: "0 2px 10px rgba(0,0,0,0.1)",
          fontSize: "12px", 
          pointerEvents: "none",
          zIndex: 100 
        }} 
      />
    </div>
  )
}