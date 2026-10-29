import type { Feature, Position } from "geojson"
import type { GeoJSONSource, Map as MapLibre, MapLayerMouseEvent, MapLayerTouchEvent, MapMouseEvent, MapTouchEvent } from "maplibre-gl"

// a zone's outer rings, open: [lon, lat], the first corner not repeated at the end
export type Rings = Position[][]

// a zone's geometry as rings to edit (its holes left out), and back
export const ringsOf = (g: { type: string; coordinates: unknown }): Rings =>
  (g.type === "Polygon" ? [(g.coordinates as Position[][])[0]] : g.type === "MultiPolygon" ? (g.coordinates as Position[][][]).map(p => p[0]) : []).map(r => r.slice(0, -1))
export const geometryOf = (rings: Rings) => {
  const closed = rings.map(r => [...r, r[0]])
  return closed.length === 1 ? { type: "Polygon" as const, coordinates: closed } : { type: "MultiPolygon" as const, coordinates: closed.map(r => [r]) }
}

const IDS = ["edit-fill", "edit-line", "edit-mids", "edit-corners"]

// The zone's editor on the listings' map, over its layers: a corner dragged moves, the dot in the middle of a side
// dragged adds one, a corner double-clicked goes (a ring keeps 3). redraw() starts an outline clicked corner by corner,
// closed by a double click or a click on its first corner; it replaces the zone's rings. `max` corners in all (Stream
// Estate takes 60): no side's dot, no click added beyond. `onChange` gets the rings and whether an outline is being
// clicked (its corners so far); stop() takes it all off the map.
export function zoneEditor(m: MapLibre, start: Rings, max: number, ink: string, card: string, onChange: (rings: Rings, drawing: Position[] | null) => void) {
  let rings = start.map(r => r.slice()), drawing: Position[] | null = null, drag: { r: number; i: number } | null = null
  const point = (coordinates: Position, properties = {}): Feature => ({ type: "Feature", geometry: { type: "Point", coordinates }, properties })
  const corners = () => rings.reduce((a, r) => a + r.length, 0)
  const set = (id: string, features: Feature[]) => (m.getSource(id) as GeoJSONSource).setData({ type: "FeatureCollection", features })
  function render() {
    set("edit-shape", drawing
      ? [{ type: "Feature", geometry: { type: "LineString", coordinates: drawing }, properties: {} }]
      : rings.map(r => ({ type: "Feature", geometry: { type: "Polygon", coordinates: [[...r, r[0]]] }, properties: {} })))
    set("edit-corners", (drawing ? [drawing] : rings).flatMap((r, ri) => r.map((p, i) => point(p, { r: ri, i }))))
    set("edit-mids", drawing || corners() >= max ? [] : rings.flatMap((r, ri) => r.map((p, i) => { const q = r[(i + 1) % r.length]; return point([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], { r: ri, i }) })))
    onChange(rings, drawing)
  }

  for (const id of ["edit-shape", "edit-corners", "edit-mids"]) m.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } })
  m.addLayer({ id: "edit-fill", type: "fill", source: "edit-shape", paint: { "fill-color": ink, "fill-opacity": 0.08 } })
  m.addLayer({ id: "edit-line", type: "line", source: "edit-shape", paint: { "line-color": ink, "line-width": 2.5 } })
  m.addLayer({ id: "edit-mids", type: "circle", source: "edit-mids", paint: { "circle-radius": 4.5, "circle-color": card, "circle-opacity": 0.85, "circle-stroke-color": ink, "circle-stroke-width": 1, "circle-stroke-opacity": 0.6 } })
  m.addLayer({ id: "edit-corners", type: "circle", source: "edit-corners", paint: { "circle-radius": 6.5, "circle-color": card, "circle-stroke-color": ink, "circle-stroke-width": 2.5 } })
  m.doubleClickZoom.disable()

  // a corner or a side's middle taken: the map does not pan under the finger or the mouse
  const take = (e: MapLayerMouseEvent | MapLayerTouchEvent) => {
    const f = e.features?.[0]
    if (drawing || !f) return
    e.preventDefault()
    const { r, i } = f.properties as { r: number; i: number }
    if (f.layer.id === "edit-mids") { if (corners() >= max) return; rings[r].splice(i + 1, 0, e.lngLat.toArray()); drag = { r, i: i + 1 }; render() } else drag = { r, i }
  }
  const move = (e: MapMouseEvent | MapTouchEvent) => { if (drag) { rings[drag.r][drag.i] = e.lngLat.toArray(); render() } }
  const drop = () => { drag = null }
  const remove = (e: MapLayerMouseEvent) => {
    const f = e.features?.[0]
    if (drawing || !f) return
    e.preventDefault()
    const { r, i } = f.properties as { r: number; i: number }
    if (rings[r].length > 3) { rings[r].splice(i, 1); render() }
  }
  // drawing: a click adds a corner (not the second click of a double click), the first corner or a double click closes
  const near = (p: Position, e: MapMouseEvent, px: number) => { const a = m.project(p as [number, number]); return Math.hypot(a.x - e.point.x, a.y - e.point.y) < px }
  const close = () => { if (drawing && drawing.length >= 3) { rings = [drawing]; drawing = null; m.getCanvas().style.cursor = ""; render() } }
  const click = (e: MapMouseEvent) => {
    if (!drawing) return
    if (drawing.length >= 3 && near(drawing[0], e, 10)) return close()
    if ((drawing.length && near(drawing.at(-1)!, e, 6)) || drawing.length >= max) return
    drawing.push(e.lngLat.toArray())
    render()
  }
  const dblclick = (e: MapMouseEvent) => { if (drawing) { e.preventDefault(); close() } }
  const cursor = (c: string) => () => { m.getCanvas().style.cursor = drawing ? "crosshair" : c }

  const subs = [
    m.on("mousedown", "edit-corners", take), m.on("touchstart", "edit-corners", take), m.on("mousedown", "edit-mids", take), m.on("touchstart", "edit-mids", take),
    m.on("mousemove", move), m.on("touchmove", move), m.on("mouseup", drop), m.on("touchend", drop),
    m.on("dblclick", "edit-corners", remove), m.on("click", click), m.on("dblclick", dblclick),
    m.on("mouseenter", "edit-corners", cursor("move")), m.on("mouseenter", "edit-mids", cursor("copy")), m.on("mouseleave", "edit-corners", cursor("")), m.on("mouseleave", "edit-mids", cursor("")),
  ]
  render()

  return {
    redraw() { drawing = []; drag = null; m.getCanvas().style.cursor = "crosshair"; render() },
    stop() {
      // the map may be gone already (a change of theme makes it again)
      try {
        for (const s of subs) s.unsubscribe()
        for (const id of IDS) m.removeLayer(id)
        for (const id of ["edit-shape", "edit-corners", "edit-mids"]) m.removeSource(id)
        m.doubleClickZoom.enable()
        m.getCanvas().style.cursor = ""
      } catch { /* gone */ }
    },
  }
}
