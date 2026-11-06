import { circlesOf, mapFeatures } from "@engine/widgets.js"
import type { Feature, FeatureCollection, LineString, Point } from "geojson"
import { LngLatBounds, Map as MapLibre, NavigationControl, Popup, setWorkerUrl, type ExpressionSpecification, type GeoJSONSource, type MapLayerMouseEvent } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"
import { useTheme } from "next-themes"
import { LayersIcon, MapPinnedIcon, MaximizeIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Chips } from "@/components/chips"
import { resolveNote } from "@/components/markdown"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { arrowImage, cssColor, loadStyle, ROLES, roleColor } from "@/components/widgets/map-style"
import { api, type CaseIndex, type MapProps, type MapView, type Raster } from "@/lib/api"
import { t } from "@/lib/i18n"
import { caseHref, go } from "@/lib/route"

// MapLibre looks for its worker next to its own module, which the bundle does not keep: Vite ships it as an asset
setWorkerUrl(workerUrl)

type Feat = Feature<Point | LineString, MapProps>
const KEY = (slug: string) => `osint-map-roles:${slug}`
const keptRoles = (slug: string): string[] | null => { try { const v = JSON.parse(localStorage.getItem(KEY(slug)) ?? "null"); return Array.isArray(v) ? v : null } catch { return null } }
const BG = (slug: string) => `osint-map-bg:${slug}`
const keptBg = (slug: string): string => { try { return localStorage.getItem(BG(slug)) ?? "map" } catch { return "map" } }
const ORDER = Object.keys(ROLES)
const ends = (f: Feat): [number, number][] => (f.geometry.type === "LineString" ? f.geometry.coordinates.map(c => [c[0], c[1]] as [number, number]) : [[f.geometry.coordinates[0], f.geometry.coordinates[1]]])
const bearing = ([a, b]: [number, number][]) => {
  const r = (d: number) => (d * Math.PI) / 180, dl = r(b[0] - a[0])
  const y = Math.sin(dl) * Math.cos(r(b[1])), x = Math.cos(r(a[1])) * Math.sin(r(b[1])) - Math.sin(r(a[1])) * Math.cos(r(b[1])) * Math.cos(dl)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}
const colorBy = (colors: Record<string, string>, fallback: string) => ["match", ["get", "role"], ...Object.entries(colors).flat(), fallback] as unknown as ExpressionSpecification

// The case's map: the type's map view (candidates, excluded areas, sight lines, panoramas, places) plus the place
// entities and the hypotheses that have a point, on OpenFreeMap. A view only: edits go through the agent.
export function MapWidget({ index, pulse }: { index: CaseIndex; pulse: number }) {
  const slug = index.slug, { resolvedTheme } = useTheme(), dark = resolvedTheme !== "light"
  const box = useRef<HTMLDivElement>(null), map = useRef<MapLibre | null>(null), fitted = useRef(false)
  const [view, setView] = useState<MapView | null>(null), [hidden, setHidden] = useState<string[]>(() => keptRoles(slug) ?? []), [bgId, setBgId] = useState(() => keptBg(slug))
  useEffect(() => { api.view<MapView>(slug, "map").then(setView, () => setView(null)) }, [slug, pulse])
  const fc = useMemo(() => mapFeatures(view, index.notes) as FeatureCollection<Point | LineString, MapProps>, [view, index.notes])
  const feats = fc.features as Feat[]
  const counts = useMemo(() => { const c: Record<string, number> = {}; for (const f of feats) c[f.properties.role] = (c[f.properties.role] ?? 0) + 1; return c }, [feats])
  const roles = ORDER.filter(r => counts[r]), visible = roles.filter(r => !hidden.includes(r))
  // the background the case chose (a period of IGN's orthophotos): the type's rasters, "map" (the vector style) otherwise
  const rasters = view?.rasters ?? [], raster = rasters.find(r => r.id === bgId) ?? null
  const latest = useRef({ fc, visible, slug, index, raster })
  useEffect(() => { latest.current = { fc, visible, slug, index, raster } })

  const bounds = () => {
    const b = new LngLatBounds()
    for (const f of latest.current.fc.features as Feat[]) for (const c of ends(f)) b.extend(c)
    for (const c of circlesOf(latest.current.fc as never)) for (const p of (c.geometry as never as { coordinates: number[][][] }).coordinates[0]) b.extend(p as [number, number])
    return b
  }
  const fit = (animate = true) => {
    const m = map.current
    if (!m || !latest.current.fc.features.length) return
    // a lone point with a radius (a coarse IP location) fits its circle, never a street-level zoom
    const b = bounds(), one = latest.current.fc.features.length === 1 && !circlesOf(latest.current.fc as never).length
    if (one) m.easeTo({ center: b.getCenter(), zoom: 16, duration: animate ? 500 : 0 })
    else m.fitBounds(b, { padding: 48, maxZoom: 17, duration: animate ? 500 : 0 })
  }

  // the raster background under every data layer (the first one, when the data layers exist), one at a time
  function putRaster(m: MapLibre) {
    for (const l of m.getStyle().layers.filter(x => x.id.startsWith("raster-"))) m.removeLayer(l.id)
    for (const id of Object.keys(m.getStyle().sources).filter(x => x.startsWith("raster-"))) m.removeSource(id)
    const r = latest.current.raster
    if (!r) return
    m.addSource(`raster-${r.id}`, { type: "raster", tiles: [r.tiles], tileSize: 256, minzoom: 6, maxzoom: r.maxzoom, ...(r.attribution && { attribution: r.attribution }) })
    m.addLayer({ id: `raster-${r.id}`, type: "raster", source: `raster-${r.id}` }, m.getLayer("circles-fill") ? "circles-fill" : undefined)
  }
  // the layers, added at each style load (a new theme reloads the style): data in two sources, one layer per drawing
  function setup(m: MapLibre) {
    if (!m.hasImage("arrow")) m.addImage("arrow", arrowImage(), { sdf: true })
    const col = Object.fromEntries(ORDER.map(r => [r, roleColor(r)])), ink = cssColor("--foreground"), bg = cssColor("--background"), truth = roleColor("truth"), muted = cssColor("--muted-foreground")
    const edge = latest.current.raster ? "#fff" : bg   // on a photograph a white edge keeps every point readable, in both themes
    const { fc: now } = latest.current
    putRaster(m)
    m.addSource("features", { type: "geojson", data: now })
    m.addSource("circles", { type: "geojson", data: { type: "FeatureCollection", features: circlesOf(now as never) } as FeatureCollection })
    m.addSource("ends", { type: "geojson", data: endsOf(now.features as Feat[]) })
    const vis = (base: unknown[]) => ["all", base, ["in", ["get", "role"], ["literal", latest.current.visible]]] as unknown as ExpressionSpecification
    const isPoint = ["==", ["geometry-type"], "Point"], isLine = ["==", ["geometry-type"], "LineString"], excl = ["==", ["get", "role"], "excluded"]
    m.addLayer({ id: "circles-fill", type: "fill", source: "circles", filter: vis(["all"]), paint: { "fill-color": colorBy(col, "#888"), "fill-opacity": 0.12 } })
    m.addLayer({ id: "circles-line", type: "line", source: "circles", filter: vis(["!", excl]), paint: { "line-color": colorBy(col, "#888"), "line-width": 1.5 } })
    m.addLayer({ id: "circles-line-excluded", type: "line", source: "circles", filter: vis(excl), paint: { "line-color": col.excluded, "line-width": 1.5, "line-dasharray": [2, 2] } })
    m.addLayer({ id: "lines", type: "line", source: "features", filter: vis(isLine), paint: { "line-color": col.sightline, "line-width": 2, "line-dasharray": [2, 1.5] } })
    m.addLayer({ id: "line-heads", type: "symbol", source: "ends", filter: vis(["==", ["get", "role"], "sightline"]), layout: { "icon-image": "arrow", "icon-size": 0.5, "icon-rotate": ["get", "heading"], "icon-rotation-alignment": "map", "icon-allow-overlap": true }, paint: { "icon-color": col.sightline } })
    m.addLayer({ id: "points", type: "circle", source: "features", filter: vis(["all", isPoint, ["!", ["has", "heading"]], ["!=", ["get", "kind"], "truth"]]), paint: { "circle-radius": ["match", ["get", "role"], "place", 5, 6], "circle-color": ["case", excl, bg, ["==", ["get", "kind"], "closed"], muted, colorBy(col, "#888")] as unknown as ExpressionSpecification, "circle-opacity": ["case", ["==", ["get", "kind"], "closed"], 0.6, 1] as unknown as ExpressionSpecification, "circle-stroke-width": 1.5, "circle-stroke-color": ["case", excl, col.excluded, edge] as unknown as ExpressionSpecification } })
    m.addLayer({ id: "panos", type: "symbol", source: "features", filter: vis(["all", isPoint, ["has", "heading"]]), layout: { "icon-image": "arrow", "icon-size": 0.55, "icon-rotate": ["get", "heading"], "icon-rotation-alignment": "map", "icon-allow-overlap": true }, paint: { "icon-color": col.pano, "icon-halo-color": bg, "icon-halo-width": 1 } })
    m.addLayer({ id: "truth-ring", type: "circle", source: "features", filter: vis(["==", ["get", "kind"], "truth"]), paint: { "circle-radius": 10, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 2, "circle-stroke-color": truth } })
    m.addLayer({ id: "truth", type: "circle", source: "features", filter: vis(["==", ["get", "kind"], "truth"]), paint: { "circle-radius": 4, "circle-color": truth, "circle-stroke-width": 1.5, "circle-stroke-color": bg } })
    m.addLayer({ id: "labels", type: "symbol", source: "features", minzoom: 14, filter: vis(["any", ["==", ["get", "role"], "candidate"], ["==", ["get", "kind"], "truth"]]), layout: { "text-field": ["get", "label"], "text-size": 12, "text-offset": [0, 1.2], "text-anchor": "top", "text-optional": true }, paint: { "text-color": ink, "text-halo-color": bg, "text-halo-width": 1.5 } })
  }
  const endsOf = (fs: Feat[]): FeatureCollection => ({ type: "FeatureCollection", features: fs.filter(f => f.geometry.type === "LineString").map(f => { const e = ends(f); return { type: "Feature", geometry: { type: "Point", coordinates: e.at(-1)! }, properties: { role: f.properties.role, heading: f.properties.heading ?? bearing(e.slice(-2) as [number, number][]) } } }) })

  useEffect(() => {
    const el = box.current!, m = new MapLibre({ container: el, style: { version: 8, sources: {}, layers: [] }, center: [0, 20], zoom: 1.5, attributionControl: { compact: true } })
    map.current = m
    Object.defineProperty(el, "__map", { value: m, enumerable: false, configurable: true })
    m.addControl(new NavigationControl({ showCompass: false }), "top-right")
    m.on("style.load", () => setup(m))
    // a tile outside the coverage of a period is no error for the person: the vector map shows through
    m.on("error", e => { if (!String((e as { sourceId?: string }).sourceId ?? "").startsWith("raster-")) console.error(e.error) })
    m.on("load", () => { if (!fitted.current && latest.current.fc.features.length) { fitted.current = true; fit(false) } })
    // the box changes size (a phone turned, a window resized): the map fits the data again, unless the person has moved it
    let touched = false
    for (const ev of ["dragstart", "zoomstart", "rotatestart"] as const) m.on(ev, e => { if ((e as { originalEvent?: unknown }).originalEvent) touched = true })
    const ro = new ResizeObserver(() => { if (!touched && fitted.current) fit(false) })
    ro.observe(el)
    const pop = new Popup({ maxWidth: "260px", closeButton: true })
    const open = (e: MapLayerMouseEvent) => {
      const f = e.features?.[0]
      if (!f) return
      const p = f.properties as unknown as MapProps & { heading?: number }, { slug: s, index: ix } = latest.current, kind = p.kind === "truth" ? "truth" : p.role
      const root = document.createElement("div"); root.className = "flex flex-col gap-1 text-sm text-foreground"
      const add = (tag: string, text: string, cls = "") => { const n = document.createElement(tag); n.textContent = text; n.className = cls; root.append(n); return n }
      add("strong", p.label || (ROLES[p.role] ? t(ROLES[p.role].label) : p.role))
      add("span", `${ROLES[kind] ? t(ROLES[kind].label) : kind === "truth" ? t("True location") : p.role}${p.kind && p.kind !== "truth" ? ` · ${p.kind}` : ""}`, "text-xs text-muted-foreground")
      if (p.date) add("span", p.date, "text-xs")
      if (p.radius_m) add("span", `± ${p.radius_m} m`, "text-xs")
      if (p.heading != null) add("span", t("bearing {h}°", { h: p.heading }), "text-xs")
      if (p.url) { const a = add("a", t("Open"), "text-xs underline") as HTMLAnchorElement; a.href = p.url; a.target = "_blank"; a.rel = "noreferrer" }
      if (p.ref) {
        const path = /^[A-Z]\d+$/.test(p.ref) ? ix.notes.find(n => n.props.id === p.ref)?.path : resolveNote(ix.files, p.ref) ?? p.ref
        if (path) { const b = add("button", t("Open note"), "w-fit text-xs underline"); b.setAttribute("type", "button"); b.onclick = () => go(caseHref(s, "brain", path)) }
      }
      pop.setLngLat(e.lngLat).setDOMContent(root).addTo(m)
    }
    for (const l of ["points", "panos", "truth", "truth-ring", "lines", "circles-fill"]) { m.on("click", l, open); m.on("mouseenter", l, () => (m.getCanvas().style.cursor = "pointer")); m.on("mouseleave", l, () => (m.getCanvas().style.cursor = "")) }
    return () => { ro.disconnect(); pop.remove(); m.remove(); map.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // a theme: its own style, the layers back at style.load, the view unchanged
  useEffect(() => { let off = false; loadStyle(dark).then(s => { if (!off && map.current) map.current.setStyle(s, { diff: false }) }); return () => { off = true } }, [dark])
  // the background: the layer again, the points' edge with it, the view unchanged
  useEffect(() => {
    const m = map.current
    if (!m || !m.getSource("features")) return
    putRaster(m)
    m.setPaintProperty("points", "circle-stroke-color", ["case", ["==", ["get", "role"], "excluded"], roleColor("excluded"), raster ? "#fff" : cssColor("--background")])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raster?.id, rasters.length])
  // data and visible roles: the sources again, never a new view
  useEffect(() => {
    const m = map.current
    // the sources exist once setup ran (isStyleLoaded() is false while tiles load: the data would never be set)
    if (!m || !m.getSource("features")) return
    ;(m.getSource("features") as GeoJSONSource | undefined)?.setData(fc)
    ;(m.getSource("circles") as GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: circlesOf(fc as never) } as FeatureCollection)
    ;(m.getSource("ends") as GeoJSONSource | undefined)?.setData(endsOf(feats))
    for (const l of m.getStyle().layers.map(x => x.id).filter(id => ["circles-fill", "circles-line", "circles-line-excluded", "lines", "line-heads", "points", "panos", "truth-ring", "truth", "labels"].includes(id))) {
      const base = m.getFilter(l) as unknown[] | undefined
      if (base?.[0] === "all" && Array.isArray(base[2])) m.setFilter(l, ["all", base[1], ["in", ["get", "role"], ["literal", visible]]] as never)
    }
    if (!fitted.current && feats.length) { fitted.current = true; fit(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fc, hidden])

  const chooseBg = (id: string) => { setBgId(id); try { localStorage.setItem(BG(slug), id) } catch { /* not kept */ } }
  const toggle = (v: string[]) => { const h = roles.filter(r => !v.includes(r)); setHidden(h); try { localStorage.setItem(KEY(slug), JSON.stringify(h)) } catch { /* not kept */ } }
  return (
    <div className="flex flex-col gap-3 py-4">
      <div className="flex flex-wrap items-center gap-2">
        {roles.length > 0 && <Chips multiple label={t("Map roles")} value={visible} onChange={toggle} options={roles.map(r => ({ value: r, label: t(ROLES[r].label), icon: ROLES[r].icon, count: counts[r] }))} />}
        <div className="ml-auto flex items-center gap-2">
          {rasters.length > 0 && (
            <Select value={raster?.id ?? "map"} onValueChange={chooseBg}>
              <SelectTrigger size="sm" data-testid="map-background" aria-label={t("Background")}><LayersIcon aria-hidden /><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup>{[{ id: "map", label: t("Map") } as Raster, ...rasters].map(r => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => fit()} disabled={!feats.length}><MaximizeIcon data-icon="inline-start" />{t("Fit")}</Button>
        </div>
      </div>
      <div className="relative">
        <div ref={box} data-testid="case-map" className="h-[min(70vh,640px)] w-full overflow-hidden rounded-xl ring-1 ring-foreground/10" />
        {!feats.length && (
          <Empty className="absolute inset-0 border-0 bg-background/70 backdrop-blur-[1px]">
            <EmptyHeader><EmptyMedia variant="icon"><MapPinnedIcon /></EmptyMedia><EmptyTitle>{t("No location yet")}</EmptyTitle><EmptyDescription>{t("Candidates, sight lines and panoramas appear here as the case goes.")}</EmptyDescription></EmptyHeader>
          </Empty>
        )}
      </div>
    </div>
  )
}
