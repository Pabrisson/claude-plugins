import { around } from "@engine/geo.js"
import type { Feature, FeatureCollection, Geometry, Point as GeoPoint } from "geojson"
import { LngLatBounds, Map as MapLibre, NavigationControl, Popup, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent, type StyleSpecification } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"
import { useTheme } from "next-themes"
import { useEffect, useMemo, useRef, useState } from "react"

import { levelOf } from "@/components/ruler"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { Poi } from "@/lib/api"
import { eur, keur, m2, POI_LABEL } from "@/lib/format"
import { useSearch } from "@/lib/store"

// MapLibre looks for its worker next to its own module, which the bundle does not keep: Vite ships it as an asset
setWorkerUrl(workerUrl)

// IGN's PLAN IGN in grey: free, keyless vector tiles that keep the colors for the data on top
const STYLE = "https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/gris.json"

// IGN has no dark style: every color of the grey one gets its lightness inverted (white roads become dark grey)
function rgba(color: string): number[] | null {
  const hex = color.match(/^#([0-9a-f]{3,8})$/i)?.[1]
  if (hex) {
    const h = hex.length <= 4 ? [...hex].map(c => c + c).join("") : hex
    return [0, 2, 4, 6].map(i => (i < h.length ? parseInt(h.slice(i, i + 2), 16) : 255)).map((v, i) => (i === 3 ? v / 255 : v))
  }
  const m = color.match(/rgba?\(([^)]+)\)/)
  return m ? [...m[1].split(",").map(Number), 1].slice(0, 4) : null
}
function invert(color: string) {
  const c = rgba(color)
  if (!c) return color
  const [r, g, b, a] = c, l = (Math.max(r, g, b) + Math.min(r, g, b)) / 510, v = Math.round((0.09 + (1 - l) * 0.6) * 255)
  return `rgba(${v},${v},${Math.min(255, v + 4)},${a})`
}
const darken = (x: unknown): unknown =>
  typeof x === "string" ? (/^(#[0-9a-f]{3,8}|rgba?\()/i.test(x) ? invert(x) : x) : Array.isArray(x) ? x.map(darken) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, darken(v)])) : x

let styleCache: StyleSpecification | null = null
async function loadStyle(dark: boolean) {
  styleCache ??= await (await fetch(STYLE)).json()
  const s = structuredClone(styleCache!)
  if (dark) s.layers = s.layers.map(l => ("paint" in l && l.paint ? { ...l, paint: darken(l.paint) } : l)) as typeof s.layers
  return s
}

// a CSS color (oklch included) as rgb, which MapLibre reads
function cssColor(name: string) {
  const c = document.createElement("canvas").getContext("2d")!
  c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#888"
  c.fillRect(0, 0, 1, 1)
  const [r, g, b] = c.getImageData(0, 0, 1, 1).data
  return `rgb(${r},${g},${b})`
}

const fc = (features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features })
const CATS = ["transport", "shops", "schools", "parks", "health"] as const
const PLACE_COLORS = ["--chart-2", "--chart-3", "--chart-4"]

export function MapView({ className }: { className?: string }) {
  const { data, ref, selected, select } = useSearch()
  const { resolvedTheme } = useTheme()
  const box = useRef<HTMLDivElement>(null), map = useRef<MapLibre | null>(null)
  const [cats, setCats] = useState<string[]>(["transport"])
  const [layers, setLayers] = useState<string[]>(["sales"])
  const pois = useMemo(() => (Array.isArray(data.area.pois) ? data.area.pois : []), [data.area.pois])
  const places = useMemo(() => [...new Set((data.area.isochrones ?? []).map(i => i.place))], [data.area.isochrones])

  const sources = useMemo(() => ({
    zone: fc([{ type: "Feature", geometry: data.search.zone.geometry as Geometry, properties: {} }]),
    sales: fc((data.market.dvf?.points ?? []).map(p => ({ type: "Feature", geometry: { type: "Point", coordinates: p.point }, properties: { tip: `<b>Vendu ${eur(p.price)}</b><br>${m2(p.ppm2)} · ${p.area} m²<br>${p.address} · ${p.date.slice(0, 7)}` } }))),
    listings: fc(data.listings.filter(l => l.location.point && l.status !== "EXPIRED").map(l => ({
      type: "Feature", geometry: { type: "Point", coordinates: l.location.point! },
      properties: { id: l.id, level: levelOf(l.price_per_m2, ref?.ppm2) ?? "at", label: keur(l.price), tip: `<b>${eur(l.price)}</b><br>${l.area ?? "?"} m² · ${l.rooms ?? "?"} p. · ${m2(l.price_per_m2)}` },
    }))),
    pois: fc(pois.filter(p => cats.includes(p.cat)).map((p: Poi) => ({ type: "Feature", geometry: { type: "Point", coordinates: p.point }, properties: { cat: p.cat, tip: `${p.name ?? p.kind}<br><span>${POI_LABEL[p.cat] ?? p.cat}</span>` } }))),
    isochrones: fc((data.area.isochrones ?? []).filter(i => i.geometry && layers.includes(`place:${i.place}`) && i.profile === "pedestrian").map(i => ({ type: "Feature", geometry: i.geometry as Geometry, properties: { place: places.indexOf(i.place), minutes: i.minutes } }))),
  }), [data, ref, cats, layers, pois, places])

  // the map, made again when the theme changes (its style is not the same)
  useEffect(() => {
    let gone = false
    const dark = resolvedTheme === "dark"
    loadStyle(dark).then(style => {
      if (gone || !box.current) return
      const z = data.search.zone, center = z.center ?? data.search.point
      const m = new MapLibre({ container: box.current, style, center, zoom: 15, attributionControl: { compact: true } })
      map.current = m
      m.addControl(new NavigationControl({ showCompass: false }), "top-right")
      m.on("load", () => {
        const [below, at, above, ink, card] = ["--below", "--at", "--above", "--foreground", "--card"].map(cssColor)
        for (const [id, s] of Object.entries(sources)) m.addSource(id, { type: "geojson", data: s })
        m.addLayer({ id: "isochrones", type: "fill", source: "isochrones", paint: { "fill-color": ["match", ["get", "place"], 0, cssColor(PLACE_COLORS[0]), 1, cssColor(PLACE_COLORS[1]), cssColor(PLACE_COLORS[2])], "fill-opacity": ["case", ["<=", ["get", "minutes"], 15], 0.18, 0.08] } })
        m.addLayer({ id: "zone", type: "line", source: "zone", paint: { "line-color": ink, "line-width": 1.5, "line-dasharray": [2, 2] } })
        m.addLayer({ id: "pois", type: "circle", source: "pois", paint: { "circle-radius": 3.5, "circle-color": cssColor("--chart-5"), "circle-stroke-color": card, "circle-stroke-width": 1 } })
        m.addLayer({ id: "sales", type: "circle", source: "sales", paint: { "circle-radius": 4, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": at, "circle-stroke-width": 1.5 } })
        m.addLayer({ id: "listings", type: "circle", source: "listings", paint: { "circle-radius": ["case", ["==", ["get", "id"], ""], 12, 8], "circle-color": ["match", ["get", "level"], "below", below, "above", above, at], "circle-stroke-color": card, "circle-stroke-width": 2.5 } })
        m.addLayer({ id: "labels", type: "symbol", source: "listings", layout: { "text-field": ["get", "label"], "text-font": ["Source Sans Pro Bold"], "text-size": 12, "text-offset": [0, -1.5], "text-allow-overlap": false }, paint: { "text-color": ink, "text-halo-color": card, "text-halo-width": 2 } })
        const all = [...sources.listings.features, ...sources.sales.features]
        if (all.length) {
          const b = new LngLatBounds()
          for (const f of [...sources.zone.features, ...all]) {
            const g = f.geometry
            if (g.type === "Point") b.extend(g.coordinates as [number, number])
            else if (g.type === "Polygon") for (const p of g.coordinates[0]) b.extend(p as [number, number])
            else if (g.type === "MultiPolygon") for (const p of g.coordinates.flat(2)) b.extend(p as [number, number])
          }
          m.fitBounds(b, { padding: 40, maxZoom: 16, duration: 0 })
        }
        const popup = new Popup({ closeButton: false, closeOnClick: false, className: "immo-popup" })
        for (const id of ["listings", "sales", "pois"]) {
          m.on("mouseenter", id, (e: MapLayerMouseEvent) => { m.getCanvas().style.cursor = "pointer"; const f = e.features?.[0]; if (f) popup.setLngLat((f.geometry as GeoPoint).coordinates as [number, number]).setHTML(f.properties.tip).addTo(m) })
          m.on("mouseleave", id, () => { m.getCanvas().style.cursor = ""; popup.remove() })
        }
        m.on("click", "listings", (e: MapLayerMouseEvent) => select(e.features?.[0]?.properties.id ?? null))
      })
    })
    return () => { gone = true; map.current?.remove(); map.current = null }
    // sources follow through the effect below; the map itself only follows the theme and the zone
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme, data.search.slug])

  // new data, filters, selection: the sources and the selected dot change in place
  useEffect(() => {
    const m = map.current
    if (!m?.isStyleLoaded()) return
    for (const [id, s] of Object.entries(sources)) (m.getSource(id) as GeoJSONSource | undefined)?.setData(s)
    if (m.getLayer("listings")) m.setPaintProperty("listings", "circle-radius", ["case", ["==", ["get", "id"], selected ?? ""], 12, 8])
    m.setLayoutProperty("sales", "visibility", layers.includes("sales") ? "visible" : "none")
    const l = data.listings.find(x => x.id === selected)
    if (l?.location.point) m.easeTo({ center: l.location.point, duration: 400 })
  }, [sources, selected, layers, data.listings])

  return (
    <div className={className}>
      {/* maplibre-gl.css, outside the layers, makes it position: relative: it takes the whole box by its size */}
      <div ref={box} className="h-full w-full" />
      <div className="absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-col gap-2 rounded-lg border bg-card/95 p-2 text-xs shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-muted-foreground">
          <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-below" />Sous le marché</span>
          <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-at" />Au prix</span>
          <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-above" />Au-dessus</span>
        </div>
        <ToggleGroup type="multiple" size="sm" variant="outline" value={layers} onValueChange={setLayers} className="flex-wrap justify-start">
          <ToggleGroupItem value="sales" aria-label="Ventes DVF">Ventes DVF</ToggleGroupItem>
          {places.map(p => <ToggleGroupItem key={p} value={`place:${p}`}>{p} à pied</ToggleGroupItem>)}
        </ToggleGroup>
        {pois.length > 0 && (
          <ToggleGroup type="multiple" size="sm" variant="outline" value={cats} onValueChange={setCats} className="flex-wrap justify-start">
            {CATS.map(c => <ToggleGroupItem key={c} value={c}>{POI_LABEL[c]}</ToggleGroupItem>)}
          </ToggleGroup>
        )}
      </div>
    </div>
  )
}

// what a listing has within 500 m, for its dossier
export const nearby = (point: [number, number] | null, pois: Poi[]) => (point ? (around(point, pois, 500) as Record<string, { count: number; nearest: number; name: string | null }>) : {})
