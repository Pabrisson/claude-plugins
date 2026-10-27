import { around } from "@engine/geo.js"
import { matches, typeOf, unitPrice } from "@engine/market.js"
import type { Feature, FeatureCollection, Geometry, Point as GeoPoint, Position } from "geojson"
import { LngLatBounds, Map as MapLibre, NavigationControl, Popup, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent, type StyleSpecification } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"
import { useTheme } from "next-themes"
import { ChevronDownIcon, CrossIcon, LayersIcon, SchoolIcon, ShoppingBasketIcon, TrainFrontIcon, TreesIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { useRun } from "@/components/run-dialog"
import { levelOf } from "@/components/ruler"
import { TypeIcon } from "@/components/type-icon"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { Poi, PropertyType } from "@/lib/api"
import { eur, keur, num, perUnit, POI_LABEL, STATUS_LABEL, TYPE_LABEL } from "@/lib/format"
import { useSearch } from "@/lib/store"
import { useIsMobile } from "@/lib/use-mobile"
import { cn } from "@/lib/utils"

// MapLibre looks for its worker next to its own module, which the bundle does not keep: Vite ships it as an asset
setWorkerUrl(workerUrl)

// IGN's PLAN IGN in grey: free, keyless vector tiles that keep the colors for the data on top
const STYLE = "https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/gris.json"
// MapLibre's own texts, in French
const LOCALE = {
  "NavigationControl.ZoomIn": "Zoom avant", "NavigationControl.ZoomOut": "Zoom arrière", "NavigationControl.ResetBearing": "Remettre le nord en haut",
  "AttributionControl.ToggleAttribution": "Afficher les crédits", "AttributionControl.MapFeedback": "Signaler une erreur de carte", "Map.Title": "Carte",
  "Popup.Close": "Fermer", "Marker.Title": "Repère", "LogoControl.Title": "MapLibre", "FullscreenControl.Enter": "Plein écran", "FullscreenControl.Exit": "Quitter le plein écran",
  "GeolocateControl.FindMyLocation": "Me localiser", "GeolocateControl.LocationNotAvailable": "Position indisponible",
  "CooperativeGesturesHandler.WindowsHelpText": "Ctrl + molette pour zoomer", "CooperativeGesturesHandler.MacHelpText": "⌘ + molette pour zoomer", "CooperativeGesturesHandler.MobileHelpText": "Deux doigts pour déplacer la carte",
}

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
const CATS = { transport: TrainFrontIcon, shops: ShoppingBasketIcon, schools: SchoolIcon, parks: TreesIcon, health: CrossIcon } as const
const POI_COLOR: Record<string, string> = { transport: "--poi-transport", shops: "--poi-shops", schools: "--poi-schools" }
const PLACE_COLORS = ["--chart-2", "--chart-3", "--chart-4"]
// the world with the zone cut out: the veil that darkens everything outside it
const WORLD: Position[] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]
function outside(g: Geometry): Geometry {
  const rings = g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiPolygon" ? g.coordinates.map(p => p[0]) : []
  return { type: "Polygon", coordinates: [WORLD, ...rings] }
}

export function MapView({ className }: { className?: string }) {
  const { data, types, marketOf, selected, select } = useSearch()
  const { resolvedTheme } = useTheme()
  const mobile = useIsMobile()
  const box = useRef<HTMLDivElement>(null), map = useRef<MapLibre | null>(null)
  const [cats, setCats] = useState<string[]>(["transport"])
  const [layers, setLayers] = useState<string[]>(["sales", "veil"])
  const [scope, setScope] = useState("all"), [shownTypes, setShownTypes] = useState<string[]>(types)
  const pois = useMemo(() => (Array.isArray(data.area.pois) ? data.area.pois : []), [data.area.pois])
  const places = useMemo(() => [...new Set((data.area.isochrones ?? []).map(i => i.place))], [data.area.isochrones])
  const on = (t: string) => types.length < 2 || shownTypes.includes(t)

  const sources = useMemo(() => {
    const zone = data.search.zone.geometry as Geometry
    return {
      veil: fc([{ type: "Feature", geometry: outside(zone), properties: {} }]),
      zone: fc([{ type: "Feature", geometry: zone, properties: {} }]),
      sales: fc(types.filter(on).flatMap(t => (data.market.dvf?.[t]?.points ?? []).map(p => ({
        type: "Feature" as const, geometry: { type: "Point" as const, coordinates: p.point },
        properties: { level: levelOf(p.ppm2, marketOf(t).ref?.ppm2) ?? "at", tip: `<b>Vendu ${eur(p.price)}</b><br>${TYPE_LABEL[t]}${p.area ? ` · ${p.area} m²` : ""} · ${perUnit(p.ppm2, t)}<br>${p.address} · ${p.date.slice(0, 7)}` },
      })))),
      listings: fc(data.listings.filter(l => l.location.point && l.status !== "EXPIRED" && on(typeOf(l)) && (scope === "all" || matches(l, data.search.criteria, types))).map(l => {
        const t = typeOf(l) as PropertyType
        return {
          type: "Feature", geometry: { type: "Point", coordinates: l.location.point! },
          properties: { id: l.id, level: levelOf(unitPrice(l), marketOf(t).ref?.ppm2) ?? "at", status: l.my_status ?? "", label: keur(l.price), tip: `<b>${eur(l.price)}</b><br>${TYPE_LABEL[t]}${l.area ? ` · ${l.area} m²` : ""}${l.rooms ? ` · ${l.rooms} p.` : ""} · ${perUnit(unitPrice(l), t)}${l.my_status ? `<br><span>${STATUS_LABEL[l.my_status]}</span>` : ""}` },
        }
      })),
      pois: fc(pois.filter(p => cats.includes(p.cat)).map((p: Poi) => ({ type: "Feature", geometry: { type: "Point", coordinates: p.point }, properties: { cat: p.cat, tip: `${p.name ?? p.kind}<br><span>${POI_LABEL[p.cat] ?? p.cat}</span>` } }))),
      isochrones: fc((data.area.isochrones ?? []).filter(i => i.geometry && layers.includes(`place:${i.place}`) && i.profile === "pedestrian").map(i => ({ type: "Feature", geometry: i.geometry as Geometry, properties: { place: places.indexOf(i.place), minutes: i.minutes } }))),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, types, marketOf, cats, layers, pois, places, scope, shownTypes])

  // the map, made again when the theme changes (its style is not the same)
  useEffect(() => {
    let gone = false
    const dark = resolvedTheme === "dark"
    loadStyle(dark).then(style => {
      if (gone || !box.current) return
      const z = data.search.zone, center = z.center ?? data.search.point
      const m = new MapLibre({ container: box.current, style, center, zoom: 15, attributionControl: { compact: true }, locale: LOCALE })
      map.current = m
      m.addControl(new NavigationControl({ showCompass: false }), "top-right")
      m.on("load", () => {
        const [below, at, above, ink, card] = ["--below", "--at", "--above", "--foreground", "--card"].map(cssColor)
        const status = Object.fromEntries(Object.keys(STATUS_LABEL).map(k => [k, cssColor(`--status-${k}`)]))
        const poiColor = Object.fromEntries(Object.keys(CATS).map(c => [c, cssColor(POI_COLOR[c] ?? "--poi-other")]))
        for (const [id, s] of Object.entries(sources)) m.addSource(id, { type: "geojson", data: s })
        // outside the zone darker, inside a light tint and a solid outline with a halo: the zone stands out
        m.addLayer({ id: "veil", type: "fill", source: "veil", paint: { "fill-color": "#000", "fill-opacity": dark ? 0.38 : 0.16 } })
        m.addLayer({ id: "zone-fill", type: "fill", source: "zone", paint: { "fill-color": ink, "fill-opacity": dark ? 0.05 : 0.04 } })
        m.addLayer({ id: "zone-halo", type: "line", source: "zone", paint: { "line-color": ink, "line-width": 6, "line-opacity": 0.12 } })
        m.addLayer({ id: "zone", type: "line", source: "zone", paint: { "line-color": ink, "line-width": 2 } })
        m.addLayer({ id: "isochrones", type: "fill", source: "isochrones", paint: { "fill-color": ["match", ["get", "place"], 0, cssColor(PLACE_COLORS[0]), 1, cssColor(PLACE_COLORS[1]), cssColor(PLACE_COLORS[2])], "fill-opacity": ["case", ["<=", ["get", "minutes"], 15], 0.18, 0.08] } })
        m.addLayer({ id: "pois", type: "circle", source: "pois", paint: { "circle-radius": 4, "circle-color": ["match", ["get", "cat"], "transport", poiColor.transport, "shops", poiColor.shops, "schools", poiColor.schools, poiColor.parks], "circle-stroke-color": card, "circle-stroke-width": 1 } })
        // the sales as rings, the listings as dots: both in the color of their gap to the market
        m.addLayer({ id: "sales", type: "circle", source: "sales", paint: { "circle-radius": 4, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": ["match", ["get", "level"], "below", below, "above", above, at], "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.85 } })
        m.addLayer({ id: "listings", type: "circle", source: "listings", paint: { "circle-radius": ["case", ["==", ["get", "id"], ""], 12, 8], "circle-color": ["match", ["get", "level"], "below", below, "above", above, at], "circle-stroke-color": ["match", ["get", "status"], "to_visit", status.to_visit, "visited", status.visited, "offer", status.offer, "dropped", status.dropped, card], "circle-stroke-width": ["case", ["==", ["get", "status"], ""], 2.5, 3.5] } })
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
    // sources follow through the effect below; the map itself only follows the theme and the search
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme, data.search.slug])

  // new data, filters, selection: the sources and the selected dot change in place
  useEffect(() => {
    const m = map.current
    if (!m?.isStyleLoaded()) return
    for (const [id, s] of Object.entries(sources)) (m.getSource(id) as GeoJSONSource | undefined)?.setData(s)
    if (m.getLayer("listings")) m.setPaintProperty("listings", "circle-radius", ["case", ["==", ["get", "id"], selected ?? ""], 12, 8])
    m.setLayoutProperty("sales", "visibility", layers.includes("sales") ? "visible" : "none")
    m.setLayoutProperty("veil", "visibility", layers.includes("veil") ? "visible" : "none")
    const l = data.listings.find(x => x.id === selected)
    if (l?.location.point) m.easeTo({ center: l.location.point, duration: 400 })
  }, [sources, selected, layers, data.listings])

  const sales = types.filter(on).reduce((a, t) => a + (data.market.dvf?.[t]?.points.length ?? 0), 0)
  return (
    <div className={className}>
      {/* maplibre-gl.css, outside the layers, makes it position: relative: it takes the whole box by its size */}
      <div ref={box} className="h-full w-full" />
      <LayersPanel key={mobile ? "m" : "d"} startOpen={!mobile} {...{ cats, setCats, layers, setLayers, scope, setScope, shownTypes, setShownTypes, pois, places, sales }} />
    </div>
  )
}

// the panel's toggles, smaller than the page's
const CHIP = "h-7 px-2 text-xs"

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="flex flex-col gap-2"><h3 className="text-xs font-semibold text-foreground">{title}</h3>{children}</section>
}

// The panel of the map's layers: the listings shown, the zone (darkened outside, changed here for free), the sales,
// the walking areas to the user's places and the places of the neighborhood, each with its color and its count
function LayersPanel({ startOpen, cats, setCats, layers, setLayers, scope, setScope, shownTypes, setShownTypes, pois, places, sales }: {
  startOpen: boolean; cats: string[]; setCats: (v: string[]) => void; layers: string[]; setLayers: (v: string[]) => void; scope: string; setScope: (v: string) => void
  shownTypes: string[]; setShownTypes: (v: string[]) => void; pois: Poi[]; places: string[]; sales: number
}) {
  const { slug, data, types } = useSearch()
  const run = useRun()
  const [open, setOpen] = useState(startOpen)
  const z = data.search.zone, street = data.search.type === "street" && !!data.search.street
  const [how, setHow] = useState(z.how === "division" ? "radius" : z.how), [radius, setRadius] = useState(z.radius_m ?? (street ? 300 : 500))
  const changed = how !== z.how || (how === "radius" && radius !== z.radius_m)
  const toggle = (k: string, v: boolean) => setLayers(v ? [...layers, k] : layers.filter(x => x !== k))
  const count = (c: string) => pois.filter(p => p.cat === c).length
  return (
    <div className="absolute bottom-3 left-3 z-10 w-80 max-w-[calc(100%-1.5rem)] rounded-lg border bg-card/95 text-xs shadow-sm backdrop-blur">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
        <LayersIcon className="size-4" />Calques<ChevronDownIcon className={cn("ml-auto size-4 transition-transform", !open && "-rotate-90")} />
      </button>
      {open && (
        <div className="flex max-h-[55vh] flex-col gap-3.5 overflow-y-auto border-t p-3">
          <Group title="Annonces">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
              <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-below" />Sous le marché</span>
              <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-at" />Au prix</span>
              <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-above" />Au-dessus</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
              <span className="text-foreground">Contour :</span>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <span key={k} className="flex items-center gap-1.5"><i className="size-2.5 rounded-full border-2 bg-transparent" style={{ borderColor: `var(--status-${k})` }} />{v}</span>)}
            </div>
            <ToggleGroup type="single" size="sm" variant="outline" value={scope} onValueChange={v => v && setScope(v)} className="justify-start">
              <ToggleGroupItem className={CHIP} value="all">Toutes</ToggleGroupItem>
              <ToggleGroupItem className={CHIP} value="criteria">Dans mes critères</ToggleGroupItem>
            </ToggleGroup>
            {types.length > 1 && (
              <ToggleGroup type="multiple" size="sm" variant="outline" value={shownTypes} onValueChange={setShownTypes} className="flex-wrap justify-start" aria-label="Types de bien">
                {types.map(t => <ToggleGroupItem className={CHIP} key={t} value={t}><TypeIcon type={t} />{TYPE_LABEL[t]}</ToggleGroupItem>)}
              </ToggleGroup>
            )}
          </Group>
          <Group title="Zone">
            <div className="flex items-center gap-2"><Switch id="veil" checked={layers.includes("veil")} onCheckedChange={v => toggle("veil", v)} /><Label htmlFor="veil" className="text-xs">Assombrir l'extérieur de la zone</Label></div>
            <ToggleGroup type="single" size="sm" variant="outline" value={how} onValueChange={v => v && setHow(v)} className="flex-wrap justify-start">
              <ToggleGroupItem className={CHIP} value="radius">{street ? "Le long de la rue" : "Autour du lieu"}</ToggleGroupItem>
              <ToggleGroupItem className={CHIP} value="iris">Quartier</ToggleGroupItem>
              <ToggleGroupItem className={CHIP} value="commune">Commune</ToggleGroupItem>
            </ToggleGroup>
            {how === "radius" && (
              <div className="flex flex-col gap-2">
                <span className="text-muted-foreground">{street ? `${radius} m de part et d'autre de la rue` : `${radius} m autour du lieu`}</span>
                <Slider min={100} max={1500} step={50} value={[radius]} onValueChange={([v]) => setRadius(v)} aria-label={street ? "Largeur de la zone" : "Rayon de la zone"} />
              </div>
            )}
            {changed && <Button size="xs" className="self-start" onClick={() => run({ cmd: "search", slug, args: { zone: how, ...(how === "radius" ? { radius } : {}) }, label: "Nouvelle zone (gratuit)" })}>Appliquer la nouvelle zone</Button>}
          </Group>
          <Group title="Marché">
            <div className="flex items-center gap-2">
              <Switch id="sales" checked={layers.includes("sales")} onCheckedChange={v => toggle("sales", v)} />
              <Label htmlFor="sales" className="text-xs">Ventes DVF des 2 dernières années <span className="text-muted-foreground">({num(sales)})</span></Label>
            </div>
          </Group>
          {places.length > 0 && (
            <Group title="À pied">
              {places.map((p, i) => (
                <div key={p} className="flex items-center gap-2">
                  <Switch id={`place-${i}`} checked={layers.includes(`place:${p}`)} onCheckedChange={v => toggle(`place:${p}`, v)} />
                  <Label htmlFor={`place-${i}`} className="text-xs"><i className="size-2.5 rounded-sm" style={{ background: `var(${PLACE_COLORS[i % 3]})` }} />{p} : 15 et 30 min</Label>
                </div>
              ))}
            </Group>
          )}
          {pois.length > 0 && (
            <Group title="Quartier">
              <ToggleGroup type="multiple" size="sm" variant="outline" value={cats} onValueChange={setCats} className="flex-wrap justify-start" aria-label="Lieux du quartier">
                {Object.entries(CATS).map(([c, Icon]) => (
                  <ToggleGroupItem className={CHIP} key={c} value={c} aria-label={`${POI_LABEL[c]} (${count(c)})`}>
                    <i className="size-2.5 rounded-full" style={{ background: `var(${POI_COLOR[c] ?? "--poi-other"})` }} /><Icon />{POI_LABEL[c]}<span className="text-muted-foreground">{count(c)}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </Group>
          )}
        </div>
      )}
    </div>
  )
}

// what a listing has within 500 m, for its dossier
export const nearby = (point: [number, number] | null, pois: Poi[]) => (point ? (around(point, pois, 500) as Record<string, { count: number; nearest: number; name: string | null }>) : {})
