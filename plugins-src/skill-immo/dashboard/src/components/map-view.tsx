import { recentDpe } from "@engine/dpe.js"
import { around, inZone } from "@engine/geo.js"
import { isHome, matches, typeOf, unitPrice } from "@engine/market.js"
import type { Feature, FeatureCollection, Geometry, Point as GeoPoint, Position } from "geojson"
import { LngLatBounds, Map as MapLibre, NavigationControl, Popup, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent, type StyleSpecification } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"
import { useTheme } from "next-themes"
import { ChevronDownIcon, CrossIcon, LayersIcon, MapPinIcon, SchoolIcon, ShoppingBasketIcon, TrainFrontIcon, TreesIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { DPE_HEX, dpeInk } from "@/components/dpe"
import { levelOf } from "@/components/ruler"
import { TypeIcon } from "@/components/type-icon"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type DpeRow, type Hit, type IrisOdds, type Listing, type Odds, type Poi, type Point, type PropertyType } from "@/lib/api"
import { date, dpeAsk, eur, keur, LEVEL_LABEL, month, num, pct, perUnit, POI_LABEL, share, STATUS_LABEL, titleCase, TYPE_LABEL } from "@/lib/format"
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
// the IRIS's fill: the five classes of the metric shown, grey without figures
function irisColor(m: Metric) {
  const c = [1, 2, 3, 4, 5].map(k => cssColor(`--odds-${k}`)), s = METRICS[m].steps
  return ["case", ["<", ["get", "value"], 0], cssColor("--muted-foreground"), ["step", ["get", "value"], c[0], s[0], c[1], s[1], c[2], s[2], c[3], s[3], c[4]]] as never
}
// a sale's or a listing's gap to the sold market of its type, in its level's color: "−12 % sous le marché"
function gapTip(ppm2: number | null, ref: number | null | undefined) {
  const level = levelOf(ppm2, ref)
  if (!level || !ref || !ppm2) return ""
  return `<br><b style="color:var(--${level})">${pct(ppm2 / ref - 1)} ${LEVEL_LABEL[level]}</b>`
}
const CATS = { transport: TrainFrontIcon, shops: ShoppingBasketIcon, schools: SchoolIcon, parks: TreesIcon, health: CrossIcon } as const
const POI_COLOR: Record<string, string> = { transport: "--poi-transport", shops: "--poi-shops", schools: "--poi-schools" }
const PLACE_COLORS = ["--chart-2", "--chart-3", "--chart-4"]
// The recent DPE of an address (lib/dpe.js), each with the listing it belongs to: by its number or address, or probably
// (a listing placed roughly). Out of the search's zone (`out`) its listings are not known. Their tooltip lists them;
// clicked, the ones without a listing get « Chercher l'annonce ».
export type DpeGroup = { key: string; point: Point; address: string | null; out: boolean; items: (DpeRow & { listing: { id: string; how: "number" | "address" | "near" } | null })[] }
const esc = (x: string) => x.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
function dpeTip(g: DpeGroup, listings: Listing[], buttons = false) {
  const rows = g.items.slice(0, 8).map(d => {
    const l = d.listing && listings.find(x => x.id === d.listing!.id)
    const found = l ? `${d.listing!.how === "near" ? "Annonce probable" : "Annonce"} ${keur(l.price)}` : g.out ? "Hors de la zone suivie : annonce inconnue" : "Aucune annonce trouvée"
    return `<div class="dpe-row"><b class="dpe-chip" style="background:${DPE_HEX[d.energy]};color:${dpeInk(d.energy)}">${esc(d.energy)}</b>${TYPE_LABEL[d.type]}${d.area ? ` · ${num(d.area)} m²` : ""} · ${date(d.date)}<br><span>${found}</span>${buttons && !d.listing ? `<button type="button" data-n="${esc(d.number)}">Chercher l'annonce</button>` : ""}</div>`
  })
  const more = g.items.length > 8 ? `<span>+ ${g.items.length - 8} autres</span>` : ""
  // a G can no longer be let (since 2025): without a listing, more likely a sale
  const g7 = g.items.some(d => !d.listing && d.energy === "G") ? `<div class="dpe-row"><span>G : location interdite depuis 2025, plutôt une vente</span></div>` : ""
  return `<b>${esc(g.address ?? "Adresse inconnue")}</b>${rows.join("")}${more}${g7}`
}

// an IRIS's tooltip: its name and commune, then its three figures
function irisTip(i: IrisOdds) {
  const f = (m: Metric) => { const x = METRICS[m].of(i); return x == null ? "—" : METRICS[m].format(x) }
  const figures = i.census ? `<br>Vente à 12 mois : ${f("odds")}<br>Successions : ${f("successions")} · Séparations : ${f("separations")}` : "<br><span>Pas de chiffres INSEE (quartier d'activité ou peu habité)</span>"
  return `<b>${esc(i.name)}</b><br><span>${esc(i.commune)}</span>${figures}`
}

// the world with the zone cut out: the veil that darkens everything outside it
const WORLD: Position[] = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]
function outside(g: Geometry): Geometry {
  const rings = g.type === "Polygon" ? [g.coordinates[0]] : g.type === "MultiPolygon" ? g.coordinates.map(p => p[0]) : []
  return { type: "Polygon", coordinates: [WORLD, ...rings] }
}

// The odds map loads its box from this zoom on (closer): farther, a large screen would ask hundreds of IRIS at once
export const MIN_ZOOM = 14
// a share of the IRIS's homes: the sales a year after successions or separations over its homes
const perHome = (x: number | null, i: IrisOdds) => (x == null || !i.census?.homes ? null : x / i.census.homes)
// What the odds map colors each IRIS by, in five fixed classes (a color means the same wherever the map goes; set on
// the quintiles of 151 IRIS of Lyon and Villeurbanne): the odds that one of its homes goes on sale within 12 months,
// for any reason, after a succession, after a separation; `help` says what it is, under the legend and on hovering
// its button or its figure
export const METRICS = {
  odds: {
    label: "Vente à 12 mois", of: (i: IrisOdds) => i.odds, steps: [0.015, 0.02, 0.025, 0.03], format: (x: number) => share(x, 1),
    help: "La probabilité qu'un logement du quartier soit mis en vente dans les 12 mois : la part de ses logements vendus en un an, d'après les ventes réelles (DVF) des 3 dernières années.",
  },
  successions: {
    label: "Successions", of: (i: IrisOdds) => perHome(i.successions, i), steps: [0.001, 0.0015, 0.002, 0.003], format: (x: number) => share(x, 2),
    help: "Une succession : le logement vendu par les héritiers après le décès de son propriétaire. La probabilité qu'un logement du quartier soit mis en vente pour cette raison dans les 12 mois, estimée avec les personnes de 55 ans et plus vivant seules (recensement), les taux de décès par âge en France et la part de propriétaires.",
  },
  separations: {
    label: "Séparations", of: (i: IrisOdds) => perHome(i.separations, i), steps: [0.0008, 0.0011, 0.0014, 0.0018], format: (x: number) => share(x, 2),
    help: "Une séparation : le logement vendu quand un couple de propriétaires se sépare (divorce, fin de PACS ou d'union libre). La probabilité qu'un logement du quartier soit mis en vente pour cette raison dans les 12 mois, estimée avec les couples du quartier (recensement), environ 1 % de séparations par an et la part de propriétaires.",
  },
}
export const DPE_HELP = "Le DPE (diagnostic de performance énergétique) est obligatoire avant une vente ou une location (ADEME) : un DPE récent sans annonce signale un logement peut-être bientôt en vente."
export const IRIS_HELP = "Les IRIS sont les quartiers de l'INSEE, d'environ 2 000 habitants : la maille la plus fine de ses statistiques."
// a hint on hovering (or focusing) what it wraps
export function Hint({ text, children }: { text: string; children: React.ReactElement }) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent className="max-w-72 leading-snug">{text}</TooltipContent></Tooltip>
}
export type Metric = keyof typeof METRICS
// the five classes of a metric, as the legend says them (its unit said once under it): « < 1,5 », « 1,5–2,0 »…, « ≥ 3,0 »
const classes = (m: Metric) => {
  const { steps, format } = METRICS[m], f = (x: number) => format(x).replace(/ %$/, "")
  return [`< ${f(steps[0])}`, ...steps.slice(1).map((x, i) => `${f(steps[i])}–${f(x)}`), `≥ ${f(steps.at(-1)!)}`]
}
// The odds tab's map: its box's data, what colors the IRIS, the box shown (at each stop), the IRIS selected, the DPE
// shown (for the column beside), a DPE to show (picked in that column)
export type OddsMap = {
  data: Odds | null; metric: Metric; setMetric: (m: Metric) => void; onView: (v: { bbox: number[]; zoom: number }) => void
  iris: string | null; onIris: (code: string | null) => void; onDpe: (groups: DpeGroup[]) => void; focus: DpeGroup | null
  // what the pointer is on in the column beside: an IRIS (its row, its block) or a DPE, set off on the map
  hover: { iris?: string; dpe?: string } | null
}

// the layers' column, docked on the left of a computer's map
const PANEL = 320
// the map's layers the panel's switches show or hide: at the map's making (its theme) and at each switch
const SWITCHED = { sales: ["sales"], veil: ["veil"], dpe: ["dpe-ring", "dpe", "dpe-count", "dpe-hover"], iris: ["iris-fill", "iris-line", "iris-hover", "iris-hover-line", "iris-selected"], listings: ["listings", "labels"] }
function showLayers(m: MapLibre, layers: string[]) {
  for (const [k, ids] of Object.entries(SWITCHED)) for (const id of ids) m.setLayoutProperty(id, "visibility", layers.includes(k) ? "visible" : "none")
}

// `right`: the width of what covers the map on its right (the listings' column), which its camera and controls keep clear of.
// With `odds`, the odds tab's map: the IRIS colored by their odds, the recent DPE of the box shown, the listings neutral.
export function MapView({ className, right = 0, odds }: { className?: string; right?: number; odds?: OddsMap }) {
  const { data, types, marketOf, selected, select, addFeedback } = useSearch()
  const { resolvedTheme } = useTheme()
  const mobile = useIsMobile()
  const box = useRef<HTMLDivElement>(null), map = useRef<MapLibre | null>(null)
  const [cats, setCats] = useState<string[]>(odds ? [] : ["transport"])
  const [layers, setLayers] = useState<string[]>(odds ? ["iris", "dpe", "dpe-open", "listings"] : ["sales", "veil", "listings"])
  // a computer's map keeps the layers' column clear (a phone's floats, folded)
  const left = mobile ? 0 : PANEL
  const [scope, setScope] = useState("all"), [shownTypes, setShownTypes] = useState<string[]>(types)
  const [dpeDays, setDpeDays] = useState("180"), [dpeScope, setDpeScope] = useState("all")
  // the DPE groups and listings the click on a DPE reads, the odds tab's callbacks (the map's handlers are made once),
  // and how a DPE's card is pinned (made with the map)
  const dpeRef = useRef<{ groups: Map<string, DpeGroup>; listings: Listing[] }>({ groups: new Map(), listings: [] })
  const oddsRef = useRef(odds), pin = useRef<(g: DpeGroup) => void>(() => {})
  useEffect(() => { oddsRef.current = odds })
  const pois = useMemo(() => (Array.isArray(data.area.pois) ? data.area.pois : []), [data.area.pois])
  const places = useMemo(() => [...new Set((data.area.isochrones ?? []).map(i => i.place))], [data.area.isochrones])
  const on = (t: string) => types.length < 2 || shownTypes.includes(t)
  // the odds map's recent DPE of the period (in the search's criteria when asked), then only those without a listing in
  // the search's zone when asked: out of it, no listing is known
  const rows = odds?.data?.dpe
  const dpe = useMemo(() => {
    const zone = data.search.zone as Parameters<typeof inZone>[1]
    const all = (recentDpe(rows ?? [], data.listings, { days: +dpeDays, ...(dpeScope === "criteria" ? { criteria: data.search.criteria, types } : {}) }) as DpeGroup[]).map(g => ({ ...g, out: !inZone(g.point, zone) }))
    const flag = layers.includes("dpe-open"), only = flag && layers.includes("dpe-only"), open = (g: DpeGroup) => g.items.filter(d => !g.out && !d.listing)
    const groups = only ? all.map(g => ({ ...g, items: open(g) })).filter(g => g.items.length) : all
    return { groups, flag, count: all.reduce((a, g) => a + g.items.length, 0), open: all.reduce((a, g) => a + open(g).length, 0) }
  }, [rows, data.listings, data.search.criteria, data.search.zone, types, dpeDays, dpeScope, layers])
  const onDpe = odds?.onDpe, metric = odds?.metric ?? "odds", irisCode = odds?.iris ?? null, hover = odds?.hover
  useEffect(() => { onDpe?.(dpe.groups) }, [onDpe, dpe.groups])

  const sources = useMemo(() => {
    const zone = data.search.zone.geometry as Geometry
    return {
      veil: fc([{ type: "Feature", geometry: outside(zone), properties: {} }]),
      zone: fc([{ type: "Feature", geometry: zone, properties: {} }]),
      sales: fc(types.filter(on).flatMap(t => (data.market.dvf?.[t]?.points ?? []).map(p => ({
        type: "Feature" as const, geometry: { type: "Point" as const, coordinates: p.point },
        properties: { level: levelOf(p.ppm2, marketOf(t).ref?.ppm2) ?? "at", tip: `<b>Vendu ${eur(p.price)}</b><br>${TYPE_LABEL[t]}${p.area ? ` · ${p.area} m²` : ""} · ${perUnit(p.ppm2, t)}${gapTip(p.ppm2, marketOf(t).ref?.ppm2)}<br>${titleCase(p.address)} · ${month(p.date)}` },
      })))),
      listings: fc(data.listings.filter(l => l.location.point && l.status !== "EXPIRED" && on(typeOf(l)) && (scope === "all" || matches(l, data.search.criteria, types))).map(l => {
        const t = typeOf(l) as PropertyType
        return {
          type: "Feature", geometry: { type: "Point", coordinates: l.location.point! },
          properties: { id: l.id, level: odds ? "at" : (levelOf(unitPrice(l), marketOf(t).ref?.ppm2) ?? "at"), status: l.my_status ?? "", label: keur(l.price), tip: `<b>${eur(l.price)}</b><br>${TYPE_LABEL[t]}${l.area ? ` · ${l.area} m²` : ""}${l.rooms ? ` · ${l.rooms} p.` : ""} · ${perUnit(unitPrice(l), t)}${gapTip(unitPrice(l), marketOf(t).ref?.ppm2)}${l.my_status ? `<br><span>${STATUS_LABEL[l.my_status]}</span>` : ""}` },
        }
      })),
      pois: fc(pois.filter(p => cats.includes(p.cat)).map((p: Poi) => ({ type: "Feature", geometry: { type: "Point", coordinates: p.point }, properties: { cat: p.cat, tip: `${p.name ?? p.kind}<br><span>${POI_LABEL[p.cat] ?? p.cat}</span>` } }))),
      // a dot per address in the class of its newest DPE, ringed when one has no listing (the switch on, in the zone)
      dpe: fc(dpe.groups.map(g => ({ type: "Feature", geometry: { type: "Point", coordinates: g.point }, properties: { key: g.key, energy: g.items[0].energy, count: g.items.length, open: dpe.flag && !g.out && g.items.some(d => !d.listing), tip: dpeTip(g, data.listings) } }))),
      // each IRIS in the class of the metric shown (-1 without figures), its tooltip with the three
      iris: fc((odds?.data?.iris ?? []).map(i => ({ type: "Feature", geometry: i.geometry as Geometry, properties: { code: i.code, value: METRICS[odds!.metric].of(i) ?? -1, tip: irisTip(i) } }))),
      isochrones: fc((data.area.isochrones ?? []).filter(i => i.geometry && layers.includes(`place:${i.place}`) && i.profile === "pedestrian").map(i => ({ type: "Feature", geometry: i.geometry as Geometry, properties: { place: places.indexOf(i.place), minutes: i.minutes } }))),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, types, marketOf, cats, layers, pois, places, scope, shownTypes, dpe, odds?.data, odds?.metric])

  // the map, made again when the theme changes (its style is not the same)
  useEffect(() => {
    let gone = false
    const dark = resolvedTheme === "dark"
    loadStyle(dark).then(style => {
      if (gone || !box.current) return
      const z = data.search.zone, center = z.center ?? data.search.point
      const m = new MapLibre({ container: box.current, style, center, zoom: 15, attributionControl: { compact: true }, locale: LOCALE })
      map.current = m
      m.setPadding({ top: 0, bottom: 0, left, right })
      m.addControl(new NavigationControl({ showCompass: false }), "top-right")
      m.on("load", () => {
        const [below, at, above, ink, card, hi] = ["--below", "--at", "--above", "--foreground", "--card", "--highlight"].map(cssColor)
        const status = Object.fromEntries(Object.keys(STATUS_LABEL).map(k => [k, cssColor(`--status-${k}`)]))
        const poiColor = Object.fromEntries(Object.keys(CATS).map(c => [c, cssColor(POI_COLOR[c] ?? "--poi-other")]))
        for (const [id, s] of Object.entries(sources)) m.addSource(id, { type: "geojson", data: s })
        // outside the zone darker, inside a light tint and a solid outline with a halo: the zone stands out
        m.addLayer({ id: "veil", type: "fill", source: "veil", paint: { "fill-color": "#000", "fill-opacity": dark ? 0.55 : 0.28 } })
        // the IRIS in the five classes of their figure, a thin outline in the card's color between them; grey without figures
        m.addLayer({ id: "iris-fill", type: "fill", source: "iris", paint: { "fill-color": irisColor(oddsRef.current?.metric ?? "odds"), "fill-opacity": ["case", ["<", ["get", "value"], 0], 0.12, dark ? 0.5 : 0.45] as never } })
        m.addLayer({ id: "iris-line", type: "line", source: "iris", paint: { "line-color": card, "line-width": 1 } })
        // the IRIS under the pointer in the column: tinted and outlined in the highlight
        m.addLayer({ id: "iris-hover", type: "fill", source: "iris", filter: ["==", ["get", "code"], ""], paint: { "fill-color": hi, "fill-opacity": 0.35 } })
        m.addLayer({ id: "iris-hover-line", type: "line", source: "iris", filter: ["==", ["get", "code"], ""], paint: { "line-color": hi, "line-width": 3.5 } })
        m.addLayer({ id: "zone-fill", type: "fill", source: "zone", paint: { "fill-color": ink, "fill-opacity": dark ? 0.05 : 0.04 } })
        m.addLayer({ id: "zone-halo", type: "line", source: "zone", paint: { "line-color": ink, "line-width": 6, "line-opacity": 0.12 } })
        m.addLayer({ id: "zone", type: "line", source: "zone", paint: { "line-color": ink, "line-width": 2 } })
        m.addLayer({ id: "iris-selected", type: "line", source: "iris", filter: ["==", ["get", "code"], oddsRef.current?.iris ?? ""], paint: { "line-color": hi, "line-width": 3.5 } })
        m.addLayer({ id: "isochrones", type: "fill", source: "isochrones", paint: { "fill-color": ["match", ["get", "place"], 0, cssColor(PLACE_COLORS[0]), 1, cssColor(PLACE_COLORS[1]), cssColor(PLACE_COLORS[2])], "fill-opacity": ["case", ["<=", ["get", "minutes"], 15], 0.18, 0.08] } })
        // the DPE grow with the zoom: a whole district shows thousands, as small dots that leave the IRIS readable
        const grow = (one: number, many: number, k: number) => ["interpolate", ["linear"], ["zoom"], 14, ["case", [">", ["get", "count"], 1], many * k, one * k], 16.5, ["case", [">", ["get", "count"], 1], many, one]] as never
        m.addLayer({ id: "dpe-ring", type: "circle", source: "dpe", filter: ["get", "open"], paint: { "circle-radius": grow(10, 13, 0.45), "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": ink, "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 14, 1.5, 16.5, 2.5] } })
        m.addLayer({ id: "dpe", type: "circle", source: "dpe", paint: { "circle-radius": grow(6, 9, 0.45), "circle-color": ["match", ["get", "energy"], ...Object.entries(DPE_HEX).flat(), "#888"] as never, "circle-stroke-color": card, "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 14, 0.5, 16.5, 1.5] } })
        m.addLayer({ id: "dpe-count", type: "symbol", source: "dpe", minzoom: 15.5, filter: [">", ["get", "count"], 1], layout: { "text-field": ["to-string", ["get", "count"]], "text-font": ["Source Sans Pro Bold"], "text-size": 11, "text-allow-overlap": true }, paint: { "text-color": ["match", ["get", "energy"], ["A", "G"], "#fff", "#000"] } })
        m.addLayer({ id: "pois", type: "circle", source: "pois", paint: { "circle-radius": 4, "circle-color": ["match", ["get", "cat"], "transport", poiColor.transport, "shops", poiColor.shops, "schools", poiColor.schools, poiColor.parks], "circle-stroke-color": card, "circle-stroke-width": 1 } })
        // the sales as rings, the listings as dots: both in the color of their gap to the market
        m.addLayer({ id: "sales", type: "circle", source: "sales", paint: { "circle-radius": 4, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": ["match", ["get", "level"], "below", below, "above", above, at], "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.85 } })
        m.addLayer({ id: "listings", type: "circle", source: "listings", paint: { "circle-radius": ["case", ["==", ["get", "id"], ""], 12, 8], "circle-color": ["match", ["get", "level"], "below", below, "above", above, at], "circle-stroke-color": ["match", ["get", "status"], "to_visit", status.to_visit, "visited", status.visited, "offer", status.offer, "dropped", status.dropped, card], "circle-stroke-width": ["case", ["==", ["get", "status"], ""], 2.5, 3.5] } })
        // the DPE under the pointer in the column, over everything: a halo in the highlight, wider than the rings of the
        // DPE without a listing
        m.addLayer({ id: "dpe-hover", type: "circle", source: "dpe", filter: ["==", ["get", "key"], ""], paint: { "circle-radius": 22, "circle-color": hi, "circle-opacity": 0.3, "circle-stroke-color": hi, "circle-stroke-width": 4 } })
        m.addLayer({ id: "labels", type: "symbol", source: "listings", layout: { "text-field": ["get", "label"], "text-font": ["Source Sans Pro Bold"], "text-size": 12, "text-offset": [0, -1.5], "text-allow-overlap": false }, paint: { "text-color": ink, "text-halo-color": card, "text-halo-width": 2 } })
        showLayers(m, layers)
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
        // the odds map opens where it loads: its zoom at least
        if (oddsRef.current && m.getZoom() < MIN_ZOOM) m.setZoom(MIN_ZOOM)
        const popup = new Popup({ closeButton: false, closeOnClick: false, className: "immo-popup" })
        for (const id of ["listings", "sales", "pois", "dpe"]) {
          m.on("mouseenter", id, (e: MapLayerMouseEvent) => { m.getCanvas().style.cursor = "pointer"; const f = e.features?.[0]; if (f) popup.setLngLat((f.geometry as GeoPoint).coordinates as [number, number]).setHTML(f.properties.tip).addTo(m) })
          m.on("mouseleave", id, () => { m.getCanvas().style.cursor = ""; popup.remove() })
        }
        m.on("click", "listings", (e: MapLayerMouseEvent) => select(e.features?.[0]?.properties.id ?? null))
        // an IRIS: its tooltip follows the pointer, a click selects it (unless a DPE or a listing is under it)
        const dot = (e: MapLayerMouseEvent) => m.queryRenderedFeatures(e.point, { layers: ["dpe", "listings"] }).length > 0
        m.on("mousemove", "iris-fill", (e: MapLayerMouseEvent) => { if (!dot(e) && e.features?.[0]) popup.setLngLat(e.lngLat).setHTML(e.features[0].properties.tip).addTo(m) })
        m.on("mouseleave", "iris-fill", () => popup.remove())
        m.on("click", "iris-fill", (e: MapLayerMouseEvent) => { if (!dot(e)) oddsRef.current?.onIris(e.features?.[0]?.properties.code ?? null) })
        // the box the user sees (the columns over the map left out), at each stop of the map and once made
        const view = () => {
          const c = m.getContainer(), x0 = left < c.clientWidth - right ? left : 0, x1 = left < c.clientWidth - right ? c.clientWidth - right : c.clientWidth
          const a = m.unproject([x0, c.clientHeight]), b = m.unproject([x1, 0])
          oddsRef.current?.onView({ bbox: [a.lng, a.lat, b.lng, b.lat], zoom: m.getZoom() })
        }
        m.on("moveend", view)
        view()
        // a DPE clicked: its card stays, each DPE without a listing with « Chercher l'annonce » (a prompt item for Claude)
        const pinned = new Popup({ className: "immo-popup", maxWidth: "300px" })
        m.on("click", "dpe", (e: MapLayerMouseEvent) => {
          const g = dpeRef.current.groups.get(e.features?.[0]?.properties.key)
          if (g) pin.current(g)
        })
        pin.current = g => {
          const el = document.createElement("div")
          el.innerHTML = dpeTip(g, dpeRef.current.listings, true)
          for (const b of el.querySelectorAll<HTMLButtonElement>("button[data-n]")) b.onclick = () => {
            addFeedback({ kind: "chercher", text: dpeAsk(g.items.find(d => d.number === b.dataset.n)!) })
            toast.success("Ajouté au prompt : Claude cherchera l'annonce")
            b.disabled = true
          }
          popup.remove()
          pinned.setLngLat(g.point).setDOMContent(el).addTo(m)
        }
      })
    })
    return () => { gone = true; map.current?.remove(); map.current = null }
    // sources follow through the effect below; the map itself only follows the theme and the search
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme, data.search.slug])

  // new data, filters, selection: the sources and the selected dot change in place
  useEffect(() => {
    dpeRef.current = { groups: new Map(dpe.groups.map(g => [g.key, g])), listings: data.listings }
    // the map's layers made (its load done): isStyleLoaded() is false while tiles load, and would skip this change
    const m = map.current
    if (!m?.getLayer("labels")) return
    for (const [id, s] of Object.entries(sources)) (m.getSource(id) as GeoJSONSource | undefined)?.setData(s)
    if (m.getLayer("listings")) m.setPaintProperty("listings", "circle-radius", ["case", ["==", ["get", "id"], selected ?? ""], 12, 8])
    m.setPaintProperty("iris-fill", "fill-color", irisColor(metric))
    m.setFilter("iris-selected", ["==", ["get", "code"], irisCode ?? ""])
    for (const id of ["iris-hover", "iris-hover-line"]) m.setFilter(id, ["==", ["get", "code"], hover?.iris ?? ""])
    m.setFilter("dpe-hover", ["==", ["get", "key"], hover?.dpe ?? ""])
    showLayers(m, layers)
    const l = data.listings.find(x => x.id === selected)
    if (l?.location.point) m.easeTo({ center: l.location.point, duration: 400 })
  }, [sources, selected, layers, data.listings, dpe.groups, metric, irisCode, hover])

  // a DPE picked in the odds tab's column: the map goes to it and pins its card
  const focus = odds?.focus
  useEffect(() => {
    if (!focus || !map.current) return
    map.current.easeTo({ center: focus.point, zoom: Math.max(map.current.getZoom(), 16), duration: 600 })
    pin.current(focus)
  }, [focus])

  const sales = types.filter(on).reduce((a, t) => a + (data.market.dvf?.[t]?.points.length ?? 0), 0)
  return (
    <div className={cn("immo-map", className)} style={{ "--map-right": `${right}px` } as React.CSSProperties}>
      {/* maplibre-gl.css, outside the layers, makes it position: relative: it takes the whole box by its size */}
      <div ref={box} className="h-full w-full" />
      <LayersPanel docked={!mobile} {...{ cats, setCats, layers, setLayers, scope, setScope, shownTypes, setShownTypes, pois, places, sales }}
        dpe={{ days: dpeDays, setDays: setDpeDays, scope: dpeScope, setScope: setDpeScope, count: dpe.count, open: dpe.open }}
        odds={odds && { metric, setMetric: odds.setMetric, listings: sources.listings.features.length, onPlace: h => map.current?.flyTo({ center: [h.x, h.y], zoom: zoomOf(h), duration: 1200 }) }} />
    </div>
  )
}

// the panel's toggles, smaller than the page's
const CHIP = "h-7 px-2 text-xs"

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="flex flex-col gap-2"><h3 className="text-xs font-semibold text-foreground">{title}</h3>{children}</section>
}

// a place of the autocomplete, at the zoom of its kind: an address, a street, a commune, another place
const zoomOf = (h: Hit) => (h.kind === "housenumber" ? 17 : h.kind === "street" ? 16 : /municipality|administratif|commune|arrondissement/i.test(h.kind) ? MIN_ZOOM : 15)

// The search above the odds map's layers: a street, a commune, a place, an address (Géoplateforme's autocomplete);
// picked, the map goes there and loads it
function PlaceSearch({ onPlace }: { onPlace: (h: Hit) => void }) {
  // the places found and the text they answer: « Aucun lieu » only once the text typed has its answer
  const [q, setQ] = useState(""), [found, setFound] = useState<{ q: string; hits: Hit[] }>({ q: "", hits: [] }), [picked, setPicked] = useState(false)
  useEffect(() => {
    if (q.length < 3 || picked) return
    const t = setTimeout(() => api.autocomplete(q).then(hits => setFound({ q, hits }), () => setFound({ q, hits: [] })), 200)
    return () => clearTimeout(t)
  }, [q, picked])
  return (
    // one box, its field centered (the command's paddings are for a list under it)
    <Command shouldFilter={false} className="h-auto bg-transparent p-0 [&_[data-slot=command-input-wrapper]]:p-0">
      <CommandInput aria-label="Aller à un lieu" placeholder="Une rue, une ville, une adresse…" value={q} onValueChange={v => { setQ(v); setPicked(false) }} />
      {!picked && q.length >= 3 && (
        <CommandList className="mt-1 rounded-lg border bg-popover p-1">
          {found.q === q ? <CommandEmpty>Aucun lieu trouvé.</CommandEmpty> : !found.hits.length && <p className="px-3 py-2 text-xs text-muted-foreground">Recherche…</p>}
          <CommandGroup>
            {found.hits.map(h => <CommandItem key={`${h.fulltext}|${h.kind}`} value={`${h.fulltext}|${h.kind}`} onSelect={() => { setPicked(true); setQ(h.fulltext); onPlace(h) }}><MapPinIcon />{h.fulltext}</CommandItem>)}
          </CommandGroup>
        </CommandList>
      )}
    </Command>
  )
}

// The panel of the map's layers. On the listings' map: the listings shown, the zone (darkened outside or not: it changes
// through Claude), the sales, the walking areas to the user's places and the places of the neighborhood, each with its
// color and its count. On the odds map: a search to move it, the IRIS's figure, the recent DPE, the search's listings,
// the zone. On a computer a column docked on the left, its whole height, always open (the listings' column on the
// right); on a phone it floats, folded until tapped.
function LayersPanel({ docked, cats, setCats, layers, setLayers, scope, setScope, shownTypes, setShownTypes, pois, places, sales, dpe, odds }: {
  docked: boolean; cats: string[]; setCats: (v: string[]) => void; layers: string[]; setLayers: (v: string[]) => void; scope: string; setScope: (v: string) => void
  shownTypes: string[]; setShownTypes: (v: string[]) => void; pois: Poi[]; places: string[]; sales: number
  dpe: { days: string; setDays: (v: string) => void; scope: string; setScope: (v: string) => void; count: number; open: number }
  odds?: { metric: Metric; setMetric: (m: Metric) => void; listings: number; onPlace: (h: Hit) => void }
}) {
  const { types, data } = useSearch()
  const [unfolded, setUnfolded] = useState(false), open = docked || unfolded
  const toggle = (k: string, v: boolean) => setLayers(v ? [...layers, k] : layers.filter(x => x !== k))
  const count = (c: string) => pois.filter(p => p.cat === c).length
  const zone = (
    <Group title="Zone">
      <div className="flex items-center gap-2"><Switch id="veil" checked={layers.includes("veil")} onCheckedChange={v => toggle("veil", v)} /><Label htmlFor="veil" className="text-xs">Assombrir l'extérieur de la zone</Label></div>
    </Group>
  )
  return (
    <div className={cn("absolute z-10 bg-card/70 text-xs backdrop-blur-md",
      docked ? "inset-y-0 left-0 flex w-80 flex-col border-r" : "bottom-3 left-3 w-80 max-w-[calc(100%-1.5rem)] rounded-lg border shadow-sm")}>
      {odds && docked && <div className="border-b p-3"><PlaceSearch onPlace={odds.onPlace} /></div>}
      {docked ? (
        !odds && <h2 className="flex items-center gap-2 px-3 py-2 text-sm font-medium"><LayersIcon className="size-4" />Calques</h2>
      ) : (
        <button type="button" onClick={() => setUnfolded(!unfolded)} aria-expanded={unfolded} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          <LayersIcon className="size-4" />Calques<ChevronDownIcon className={cn("ml-auto size-4 transition-transform", !unfolded && "-rotate-90")} />
        </button>
      )}
      {open && (
        <div className={cn("flex flex-col gap-3.5 overflow-y-auto p-3", !(odds && docked) && "border-t", docked ? "min-h-0 flex-1" : "max-h-[55vh]")}>
          {odds && !docked && <PlaceSearch onPlace={odds.onPlace} />}
          {odds ? (
            <>
              <Group title="Probabilités">
                <div className="flex items-center gap-2">
                  <Switch id="iris" checked={layers.includes("iris")} onCheckedChange={v => toggle("iris", v)} />
                  <Hint text={IRIS_HELP}><Label htmlFor="iris" className="text-xs">Quartiers INSEE (IRIS)</Label></Hint>
                </div>
                <ToggleGroup type="single" size="sm" variant="outline" value={odds.metric} onValueChange={v => v && odds.setMetric(v as Metric)} className="w-full" aria-label="Couleur des quartiers">
                  {Object.entries(METRICS).map(([k, m]) => <Hint key={k} text={m.help}><ToggleGroupItem className={cn(CHIP, "flex-auto")} value={k}>{m.label}</ToggleGroupItem></Hint>)}
                </ToggleGroup>
                <div className="grid grid-cols-5 gap-0.5 text-[10px] whitespace-nowrap text-muted-foreground" aria-label="Légende, en % des logements sur 12 mois">
                  {classes(odds.metric).map((c, k) => <span key={c} className="flex flex-col gap-1"><i className="h-2 rounded-sm" style={{ background: `var(--odds-${k + 1})` }} />{c}</span>)}
                </div>
                <p className="-mt-1 text-[10px] text-muted-foreground">En % des logements du quartier, sur 12 mois.</p>
                <p className="text-muted-foreground">{METRICS[odds.metric].help} Gris : pas de chiffres INSEE.</p>
              </Group>
              {types.some(isHome) && (
                <Group title="DPE récents">
                  <div className="flex items-center gap-2">
                    <Switch id="dpe" checked={layers.includes("dpe")} onCheckedChange={v => toggle("dpe", v)} />
                    <Hint text={DPE_HELP}><Label htmlFor="dpe" className="text-xs">Diagnostics récents de la carte <span className="text-muted-foreground">({num(dpe.count)})</span></Label></Hint>
                  </div>
                  {layers.includes("dpe") && (
                    <>
                      <ToggleGroup type="single" size="sm" variant="outline" value={dpe.days} onValueChange={v => v && dpe.setDays(v)} className="justify-start" aria-label="Période des DPE">
                        {[["90", "3 mois"], ["180", "6 mois"], ["365", "12 mois"]].map(([v, l]) => <ToggleGroupItem className={CHIP} key={v} value={v}>{l}</ToggleGroupItem>)}
                      </ToggleGroup>
                      <ToggleGroup type="single" size="sm" variant="outline" value={dpe.scope} onValueChange={v => v && dpe.setScope(v)} className="justify-start" aria-label="DPE affichés">
                        <ToggleGroupItem className={CHIP} value="all">Tous</ToggleGroupItem>
                        <Hint text="Seulement les DPE des types de bien et des critères de la recherche (surface, classe énergie)."><ToggleGroupItem className={CHIP} value="criteria">Dans mes critères</ToggleGroupItem></Hint>
                      </ToggleGroup>
                      <div className="flex flex-wrap items-center gap-1 text-muted-foreground">
                        {Object.entries(DPE_HEX).map(([k, c]) => <i key={k} className="grid size-4 place-items-center rounded-sm text-[10px] font-bold not-italic" style={{ background: c, color: dpeInk(k) }}>{k}</i>)}
                        <span className="ml-1">la classe du dernier DPE, le nombre à l'adresse</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch id="dpe-open" checked={layers.includes("dpe-open")} onCheckedChange={v => toggle("dpe-open", v)} />
                        <Label htmlFor="dpe-open" className="text-xs"><i className="size-3 rounded-full border-2 border-foreground" />Signaler les DPE sans annonce <span className="text-muted-foreground">({num(dpe.open)})</span></Label>
                      </div>
                      {layers.includes("dpe-open") && (
                        <>
                          <div className="flex items-center gap-2">
                            <Switch id="dpe-only" checked={layers.includes("dpe-only")} onCheckedChange={v => toggle("dpe-only", v)} />
                            <Label htmlFor="dpe-only" className="text-xs">Seulement ceux-là</Label>
                          </div>
                          <p className="text-muted-foreground">
                            Un DPE précède une vente ou une location : sans annonce, le bien est peut-être bientôt en vente. Hors de la zone de la recherche, les annonces ne sont pas connues : ces DPE ne sont pas signalés.
                            {data.search.mode === "classic" && " En OpenData, c'est sans annonce dans cette recherche."}
                          </p>
                        </>
                      )}
                    </>
                  )}
                </Group>
              )}
              <Group title="Annonces">
                <div className="flex items-center gap-2">
                  <Switch id="listings" checked={layers.includes("listings")} onCheckedChange={v => toggle("listings", v)} />
                  <Label htmlFor="listings" className="text-xs">Annonces de la recherche <span className="text-muted-foreground">({num(odds.listings)})</span></Label>
                </div>
                <p className="text-muted-foreground">Celles déjà chargées dans l'onglet Annonces, aux mêmes positions : aucune nouvelle recherche.</p>
              </Group>
              {zone}
            </>
          ) : (
            <>
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
              {zone}
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
            </>
          )}
        </div>
      )}
    </div>
  )
}

// what a listing has within 500 m, for its dossier
export const nearby = (point: [number, number] | null, pois: Poi[]) => (point ? (around(point, pois, 500) as Record<string, { count: number; nearest: number; name: string | null }>) : {})
