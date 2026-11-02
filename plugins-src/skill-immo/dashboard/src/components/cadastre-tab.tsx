import { iduOf } from "@engine/geo.js"
import type { Geometry, Point as GeoPoint } from "geojson"
import { Map as MapLibre, NavigationControl, Popup, type ExpressionSpecification, type GeoJSONSource, type MapLayerMouseEvent } from "maplibre-gl"
import { useTheme } from "next-themes"
import {
  BotIcon, Building2Icon, CalendarIcon, ChevronDownIcon, CopyIcon, ExternalLinkIcon, GaugeIcon, HistoryIcon, InfoIcon, LandPlotIcon, LayersIcon, ListIcon, ListOrderedIcon, MapIcon, MinusIcon,
  PlusIcon, RefreshCwIcon, ScrollTextIcon, SearchIcon, ShieldAlertIcon, SquareStackIcon, StampIcon, Trash2Icon, XIcon,
} from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { AuditBadge, PermitBadge } from "@/components/badges"
import { DPE_HEX, dpeInk } from "@/components/dpe"
import { addDpeLayers, cssColor, DpeControls, dpeGroups, dpeSource, dpeTip, esc, fc, Group, Hint, loadStyle, LOCALE, PANEL, PlaceSearch, zoomOf, type DpeGroup } from "@/components/map-view"
import { Block, DpeBlock, MapStatus, Stat, useScrolledTo } from "@/components/odds-tab"
import { TypeIcon } from "@/components/type-icon"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, type Cadastre, type OwnerKind, type ParcelSale, type Sold, type SoldKind } from "@/lib/api"
import { date, dpeAsk, eur, m2, num, permitLabel, permitWhat, titleOf, TYPE_LABEL } from "@/lib/format"
import { shelved } from "@/lib/rank"
import { useSearch } from "@/lib/store"
import { useIsMobile } from "@/lib/use-mobile"
import { cn } from "@/lib/utils"

// Etalab's cadastre in vector tiles (cadastre.data.gouv.fr): the parcels from zoom 13, their sections, the buildings
const TILES = "https://openmaptiles.geo.data.gouv.fr/data/cadastre.json"
// the parcels from this zoom on: farther, a screen holds thousands and the tiles merge the small ones
const MIN_ZOOM = 15
// the map's layers each switch of the layers' column shows or hides
const SWITCHED = { sections: ["sections-line", "sections-label"], buildings: ["buildings"], listings: ["listings"], zone: ["zone"], sold: ["parcels-sold"], range: ["parcels-range", "parcels-range-line"], dpe: ["dpe-ring", "dpe", "dpe-count", "dpe-hover"] }
const SECTION_HELP = "Une section est une partie de la commune sur le plan cadastral, désignée par une ou deux lettres (AO, ZA…) : la référence d'une parcelle est sa section et son numéro."
const ARPENTE_HELP = "Arpentée : la parcelle a été mesurée sur le terrain par un géomètre (document d'arpentage). Sinon, sa contenance est calculée sur le plan."
const SOLD_HELP = "Les parcelles où DVF enregistre une vente sur la période, colorées par ce qui s'est vendu : un appartement (même un seul lot d'un immeuble), une maison, un terrain nu, un local, des dépendances seules (parking, cave)."
// what a parcel sold, in the colors of the map and its legend
const SOLD_KINDS: { kind: Exclude<SoldKind, "other">; color: string }[] = [
  { kind: "flat", color: "--chart-2" }, { kind: "house", color: "--chart-4" }, { kind: "land", color: "--chart-3" }, { kind: "premises", color: "--news-new" }, { kind: "parking", color: "--chart-5" },
]
// the legal persons' categories (never their names: an SCI may bear a person's)
const OWNER_LABEL: Record<OwnerKind, string> = { state: "État", local: "collectivité locale", public: "établissement public", social: "bailleur social", sci: "SCI", civil: "société civile", condo: "syndicat de copropriétaires", association: "association", company: "société", other: "autre personne morale" }
// the zones of an urban plan by their type, and the most common public easements (SUP)
const ZONE_KIND: Record<string, string> = { U: "urbaine", AUc: "à urbaniser", AUs: "à urbaniser plus tard", A: "agricole", N: "naturelle" }
const SUP_LABEL: Record<string, string> = {
  ac1: "Abords d'un monument historique", ac2: "Site inscrit ou classé", ac4: "Site patrimonial remarquable", pm1: "Plan de prévention des risques naturels", pm3: "Plan de prévention des risques technologiques",
  as1: "Captage d'eau potable", el7: "Plan d'alignement", t1: "Voie ferrée", t5: "Dégagement d'aérodrome", t7: "Hors dégagement d'aérodrome", i3: "Canalisation de gaz", i4: "Ligne électrique",
  int1: "Voisinage d'un cimetière", pt1: "Télécommunications", pt2: "Télécommunications", a4: "Cours d'eau",
}

// the BDNB writes its words in capitals or without accents: « BETON - MEULIERE », « electricite »
const ACCENTS: [RegExp, string][] = [[/beton/g, "béton"], [/meuliere/g, "meulière"], [/electricite/g, "électricité"], [/reseau/g, "réseau"]]
const word = (x: string | null) => x && ACCENTS.reduce((s, [re, w]) => s.replace(re, w), x.toLowerCase())

// a parcel as Etalab's tiles have it: its IDU (`id`), commune, prefix, section, number and contenance (m²)
type TileParcel = { id: string; commune: string; prefixe: string; section: string; numero: string; contenance?: number; arpente?: boolean; created?: string; updated?: string }
type Bounds = [number, number, number, number]
// the parcels the map shows (from zoom 15), each once with the box around its shape; the commune most of them are in
// and the box it shows (the columns over the map left out)
type Box = { zoom: number; bounds: Bounds; parcels: (TileParcel & { bbox: Bounds })[]; sections: string[]; commune: string | null }
// the parcel opened: by a click (its tile's record, its shape there), from a list (`go`: the map goes there) or by a
// search or a dossier (`fit`: the map goes to IGN's shape once it comes)
type Picked = { idu: string; tile: TileParcel | null; geometry: Geometry | null; go?: Bounds; fit?: boolean }
type Loaded = { idu: string; data: Cadastre | null; error: string | null }
// the contenance filter: the parcels from `min` to `max` m², lit on the map and alone in the ranking
type Range = { on: boolean; min: string; max: string }

// a contenance: in m², in hectares from one
const area = (m: number | null | undefined) => (m == null ? "—" : m >= 10000 ? `${(m / 10000).toFixed(2).replace(".", ",")} ha` : `${num(m)} m²`)
// a parcel's reference as the cadastre writes it: « AO 213 », « 123 ZA 45 » with an absorbed commune's prefix
const refOf = (p: { prefixe: string; section: string; numero: string }) => `${p.prefixe !== "000" ? `${p.prefixe} ` : ""}${p.section.replace(/^0(?=[A-Z])/, "")} ${+p.numero}`
// the same from an IDU alone
const refOfIdu = (idu: string) => refOf({ prefixe: idu.slice(5, 8), section: idu.slice(8, 10), numero: idu.slice(10) })
// an arrondissement of Paris (101–120), Marseille (201–216) or Lyon (381–389): « 3e »
const arrondissement = (a: string) => { const n = +a >= 380 ? +a - 380 : +a % 100; return `${n}${n === 1 ? "er" : "e"}` }
const inRange = (r: Range, m: number | undefined) => r.on && m != null && m >= (+r.min || 0) && m <= (+r.max || Infinity)
const since = (years: string) => new Date(Date.now() - +years * 365.25 * 86400000).toISOString().slice(0, 10)

function boundsOf(g: Geometry): Bounds {
  const pts = (g.type === "Polygon" ? g.coordinates.flat() : g.type === "MultiPolygon" ? g.coordinates.flat(2) : []) as number[][]
  return pts.reduce<Bounds>((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [Infinity, Infinity, -Infinity, -Infinity])
}
const middle = (b: Bounds): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]

// what a mutation of DVF sold: its locals (four and more counted), its outbuildings, its land, its parcels
function soldWhat(s: ParcelSale) {
  const main = s.locals.filter(l => l.type !== "outbuilding"), deps = s.locals.length - main.length
  const parts = main.length > 3 ? [`${main.length} locaux`] : main.map(l => `${TYPE_LABEL[l.type as "flat"]}${l.area ? ` ${num(l.area)} m²` : ""}${l.rooms ? ` (${l.rooms} p.)` : ""}`)
  if (deps) parts.push(`${deps} dépendance${deps > 1 ? "s" : ""}`)
  if (s.land) parts.push(`terrain ${area(s.land)}`)
  if (s.parcels.length > 1) parts.push(`${s.parcels.length} parcelles vendues ensemble`)
  // one local alone on this parcel: its price per m²
  if (main.length === 1 && main[0].area && s.price && s.parcels.length === 1 && main[0].type !== "premises") parts.push(m2(Math.round(s.price / main[0].area)))
  return parts.join(" · ") || "Ni local ni terrain renseigné"
}

// a parcel's card on the map: its reference, contenance and latest sale
function tip(p: TileParcel, sold: Sold[string] | undefined) {
  const sale = sold ? `<br>Vendue le ${date(sold.date)}${sold.price ? ` · ${eur(sold.price)}` : ""}${sold.kind !== "other" ? ` · ${TYPE_LABEL[sold.kind].toLowerCase()}` : ""}${sold.count > 1 ? ` · ${sold.count} ventes` : ""}` : ""
  return `<b>Parcelle ${esc(refOf(p))}</b><br>${area(p.contenance)}${sale}<br><span>Un clic ouvre sa fiche · Maj+clic l'ajoute à la sélection</span>`
}

// The official sites on a parcel: its urban plan's rules (GPU), the IGN map with the cadastre, Etalab's cadastre, the
// official plan's extract (cadastre.gouv.fr asks the commune and reference itself), the risks' report
function links(d: Cadastre | null, idu: string, at: [number, number] | null) {
  const [x, y] = at ?? [0, 0]
  return [
    d?.urbanism?.document && { label: "Règlement du PLU", href: `https://www.geoportail-urbanisme.gouv.fr/document/by-id/${d.urbanism.document.id}` },
    at && { label: "Géoportail de l'urbanisme", href: `https://www.geoportail-urbanisme.gouv.fr/map/#tile=1&lon=${x}&lat=${y}&zoom=19` },
    at && { label: "Carte IGN", href: `https://cartes.gouv.fr/explorer-les-cartes/?c=${x},${y}&z=19&l=CADASTRALPARCELS.PARCELLAIRE_EXPRESS$GEOPORTAIL:OGC:WMTS(1;1;1;0)&permalink=yes` },
    { label: "cadastre.data.gouv.fr", href: `https://cadastre.data.gouv.fr/map?style=ortho&parcelleId=${idu}` },
    { label: "Plan officiel (cadastre.gouv.fr)", href: "https://www.cadastre.gouv.fr/scpc/accueil.do" },
    d?.risks?.url && { label: "Rapport Géorisques", href: d.risks.url },
  ].filter(Boolean) as { label: string; href: string }[]
}

// A source asked per commune the map shows once its layer is on, then kept: what each answered, still loading, failed
// (those asked again on « Réessayer » only)
function usePerCommune<T>(on: boolean, communes: string[], ask: (insee: string) => Promise<T>) {
  const [by, setBy] = useState<Record<string, T>>({}), [failed, setFailed] = useState<string[]>([]), [tries, setTries] = useState(0), asked = useRef(new Set<string>())
  const key = communes.join(",")
  useEffect(() => {
    if (!on) return
    for (const c of key.split(",").filter(Boolean)) if (!asked.current.has(c)) {
      asked.current.add(c)
      ask(c).then(d => setBy(s => ({ ...s, [c]: d })), () => { asked.current.delete(c); setFailed(f => [...f, c]) })
    }
    // `ask` is one of api's, the same each render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, key, tries])
  return { by, loading: on && communes.some(c => !(c in by) && !failed.includes(c)), failed: failed.length > 0, retry: () => { setFailed([]); setTries(t => t + 1) } }
}

// The « Cadastre » tab: the same layout as « Prospection » (layers on the left, the map, the column on the right). The map
// draws Etalab's cadastre itself, the parcels DVF sold and those of a contenance on demand; a parcel clicked, picked in
// the column, searched by its reference or sent by a listing's dossier opens its record there (IGN's, its urban plan,
// sales, permits, buildings, energy, risks); Maj+clic gathers parcels in a selection.
export function CadastreTab() {
  const mobile = useIsMobile(), { data, types, parcelFocus, focusParcel } = useSearch()
  const [box, setBox] = useState<Box | null>(null), [hover, setHover] = useState<string | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [layers, setLayers] = useState<string[]>(["sections", "listings", "zone", "dpe-open"]), [show, setShow] = useState("map")
  const [rec, setRec] = useState<Loaded | null>(null), [tries, setTries] = useState(0)
  const [selection, setSelection] = useState<{ id: string; area: number | null }[]>([])
  const [range, setRange] = useState<Range>({ on: false, min: "500", max: "1500" })
  const [years, setYears] = useState("2"), [kinds, setKinds] = useState<string[]>(SOLD_KINDS.map(k => k.kind))
  // a parcel a dossier sent here (« Voir au cadastre »): opened once, the map going to it
  if (parcelFocus && picked?.idu !== parcelFocus) setPicked({ idu: parcelFocus, tile: null, geometry: null, fit: true })
  useEffect(() => { if (parcelFocus && picked?.idu === parcelFocus) focusParcel(null) }, [parcelFocus, picked?.idu, focusParcel])
  // the parcel opened: its record (null while it loads: `record` below is another parcel's or none), the call before dropped
  const idu = picked?.idu
  useEffect(() => {
    if (!idu) return
    const ctl = new AbortController()
    api.cadastre(idu, ctl.signal).then(d => setRec({ idu, data: d, error: null }), e => { if (!ctl.signal.aborted) setRec({ idu, data: null, error: e.message }) })
    return () => ctl.abort()
  }, [idu, tries])
  const record = rec?.idu === idu ? rec : null, ign = (record?.data?.parcel?.geometry ?? null) as Geometry | null
  const shape = ign ?? picked?.geometry ?? null
  const go = picked?.go ?? (picked?.fit && ign ? boundsOf(ign) : null)
  const near = !box || box.zoom >= MIN_ZOOM - 0.01

  // the parcels DVF sold and the recent DPE, each asked per commune the map shows once its layer is on
  const communes = [...new Set((box?.parcels ?? []).map(p => p.commune))].toSorted()
  const soldOf = usePerCommune(layers.includes("sold"), communes, api.sold), dpeOf = usePerCommune(layers.includes("dpe"), communes, api.dpe)
  const sold = useMemo(() => Object.assign({}, ...Object.values(soldOf.by)) as Sold, [soldOf.by])
  const shownSold = useMemo(() => {
    if (!layers.includes("sold")) return {}
    const from = since(years)
    return Object.fromEntries(Object.entries(sold).filter(([, s]) => s.date >= from && kinds.includes(s.kind)))
  }, [layers, sold, years, kinds])
  // the recent DPE of the box shown, by address, with Prospection's filters (a DPE of either type); the one under the
  // pointer in the column, the one picked there (the map goes to it and pins its card)
  const [dpeDays, setDpeDays] = useState("180"), [dpeScope, setDpeScope] = useState("all")
  const [dpeHover, setDpeHover] = useState<string | null>(null), [dpeFocus, setDpeFocus] = useState<DpeGroup | null>(null)
  const dpe = useMemo(() => {
    const b = box?.bounds, rows = b ? Object.values(dpeOf.by).flat().filter(d => d.point[0] >= b[0] && d.point[0] <= b[2] && d.point[1] >= b[1] && d.point[1] <= b[3]) : []
    return dpeGroups(rows, data, { days: dpeDays, scope: dpeScope, types, shown: ["flat", "house"], layers })
  }, [dpeOf.by, box?.bounds, data, dpeDays, dpeScope, types, layers])

  const pick = (p: TileParcel, geometry: Geometry | null, bbox?: Bounds) => { setPicked({ idu: p.id, tile: p, geometry, go: bbox }); if (bbox && mobile) setShow("map") }
  const search = (id: string) => { setPicked({ idu: id, tile: null, geometry: null, fit: true }); if (mobile) setShow("map") }
  const onTile = (t: TileParcel) => setPicked(p => (p && p.idu === t.id && !p.tile ? { ...p, tile: t } : p))
  const toggle = (id: string, a: number | null) => setSelection(s => (s.some(x => x.id === id) ? s.filter(x => x.id !== id) : [...s, { id, area: a }]))
  const map = { layers, setLayers, hover, picked, shape, go, onPick: pick, onBox: setBox, onTile, onToggle: (p: TileParcel) => toggle(p.id, p.contenance ?? null), selection: selection.map(s => s.id), sold, shownSold, range, setRange, years, setYears, kinds, setKinds, soldCount: box ? box.parcels.filter(p => shownSold[p.id]).length : 0, soldLoading: soldOf.loading,
    dpe, dpeHover, dpeFocus, dpeSettings: { days: dpeDays, setDays: setDpeDays, scope: dpeScope, setScope: setDpeScope } }
  const status = <MapStatus near={near} loading={soldOf.loading || dpeOf.loading} error={soldOf.failed ? "DVF" : dpeOf.failed ? "DPE" : null} retry={() => { soldOf.retry(); dpeOf.retry() }} far="Zoomez pour voir les parcelles" />
  const dpeBlock = near && layers.includes("dpe") && box && (
    <DpeBlock groups={dpe.groups} onPick={g => { setDpeFocus(g); if (mobile) setShow("map") }}
      hover={g => ({ onMouseEnter: () => setDpeHover(g.key), onMouseLeave: () => setDpeHover(null), onFocus: () => setDpeHover(g.key), onBlur: () => setDpeHover(null) })} />
  )
  const panel = (
    <CadastrePanel box={box} near={near} picked={picked} record={record} onSearch={search} onPick={pick} onClose={() => { setHover(null); setPicked(null) }} onHover={setHover}
      retry={() => { setRec(null); setTries(tries + 1) }} selection={selection} onToggle={toggle} onClear={() => setSelection([])} range={range} sold={sold} dpeBlock={dpeBlock} />
  )
  return mobile ? (
    <div className="relative flex h-full flex-col">
      <ToggleGroup type="single" variant="outline" size="sm" value={show} onValueChange={v => v && setShow(v)} className="m-3 mb-0 self-start" aria-label="Affichage">
        <ToggleGroupItem value="map"><MapIcon />Carte</ToggleGroupItem>
        <ToggleGroupItem value="info"><ListIcon />Infos{picked && <span className="size-1.5 rounded-full bg-primary" />}</ToggleGroupItem>
      </ToggleGroup>
      {show === "map" ? (
        <div className="relative mt-3 mb-16 min-h-0 flex-1">
          <CadastreMap className="absolute inset-0" {...map} />
          <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-center">{status}</div>
        </div>
      ) : <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-20">{panel}</div>}
    </div>
  ) : (
    <div className="relative h-full">
      <CadastreMap className="absolute inset-0" right={440} {...map} />
      <div className="pointer-events-none absolute top-3 right-[452px] left-[332px] z-10 flex justify-center">{status}</div>
      <div className="absolute inset-y-0 right-0 z-10 w-[440px] overflow-y-auto border-l bg-background/60 p-3 backdrop-blur-md">{panel}</div>
    </div>
  )
}

type MapProps = {
  className?: string; right?: number; layers: string[]; setLayers: (v: string[]) => void; hover: string | null; picked: Picked | null; shape: Geometry | null; go: Bounds | null
  onPick: (p: TileParcel, geometry: Geometry | null) => void; onBox: (b: Box) => void; onTile: (t: TileParcel) => void; onToggle: (p: TileParcel) => void; selection: string[]
  sold: Sold; shownSold: Sold; range: Range; setRange: (r: Range) => void; years: string; setYears: (v: string) => void; kinds: string[]; setKinds: (v: string[]) => void; soldCount: number; soldLoading: boolean
  dpe: ReturnType<typeof dpeGroups>; dpeHover: string | null; dpeFocus: DpeGroup | null; dpeSettings: { days: string; setDays: (v: string) => void; scope: string; setScope: (v: string) => void }
}

// The cadastre's map: IGN's grey plan, Etalab's parcels, sections and buildings over it, the parcels sold and those of a
// contenance when asked, the selection, the search's zone and listings; the parcel under the pointer tinted with its
// card, the one opened outlined; the recent DPE as on « Prospection » (a click pins their card, « Chercher l'annonce »).
// At each stop, once its tiles are in, it tells the parcels and the box it shows.
function CadastreMap({ className, right = 0, layers, setLayers, hover, picked, shape, go, onPick, onBox, onTile, onToggle, selection, sold, shownSold, range, setRange, years, setYears, kinds, setKinds, soldCount, soldLoading, dpe, dpeHover, dpeFocus, dpeSettings }: MapProps) {
  const { data, select, addFeedback } = useSearch(), { resolvedTheme } = useTheme(), mobile = useIsMobile()
  const box = useRef<HTMLDivElement>(null), map = useRef<MapLibre | null>(null), [ready, setReady] = useState(0)
  // the handlers are made with the map: they read the latest callbacks, hover, sales and DPE here
  const cb = useRef({ onPick, onBox, onTile, onToggle, hover, sold, groups: new Map<string, DpeGroup>(), listings: data.listings, addFeedback })
  useEffect(() => { cb.current = { onPick, onBox, onTile, onToggle, hover, sold, groups: new Map(dpe.groups.map(g => [g.key, g])), listings: data.listings, addFeedback } })
  const pin = useRef<(g: DpeGroup) => void>(() => {})
  const dpes = useMemo(() => dpeSource(dpe, data.listings), [dpe, data.listings])
  const left = mobile ? 0 : PANEL
  const listings = useMemo(() => fc(data.listings.filter(l => l.location.point && !shelved(l)).map(l => ({
    type: "Feature", geometry: { type: "Point", coordinates: l.location.point! }, properties: { id: l.id, tip: `<b>${eur(l.price)}</b><br>${esc(titleOf(l))}` },
  }))), [data.listings])

  // the map, made again when the theme changes (its style is not the same)
  useEffect(() => {
    let gone = false
    const dark = resolvedTheme === "dark"
    loadStyle(dark).then(style => {
      if (gone || !box.current) return
      const z = data.search.zone, m = new MapLibre({ container: box.current, style, center: z.center ?? data.search.point, zoom: 16.5, attributionControl: { compact: true }, locale: LOCALE })
      map.current = m
      m.setPadding({ top: 0, bottom: 0, left, right })
      m.addControl(new NavigationControl({ showCompass: false }), "top-right")
      m.on("load", () => {
        const [ink, card, hi, muted, at, lit] = ["--foreground", "--card", "--highlight", "--muted-foreground", "--at", "--news-dpe"].map(cssColor)
        // a parcel's IDU is its feature's id: the sales color it through its state
        m.addSource("cadastre", { type: "vector", url: TILES, promoteId: { parcelles: "id" } })
        m.addSource("zone", { type: "geojson", data: fc([{ type: "Feature", geometry: z.geometry as Geometry, properties: {} }]) })
        m.addSource("listings", { type: "geojson", data: listings })
        m.addSource("shape", { type: "geojson", data: fc([]) })
        m.addSource("dpe", { type: "geojson", data: fc([]) })
        const tiles = (layer: string) => ({ source: "cadastre", "source-layer": layer })
        const none = ["==", ["get", "id"], ""] as ExpressionSpecification
        m.addLayer({ id: "buildings", type: "fill", ...tiles("batiments"), minzoom: MIN_ZOOM, paint: { "fill-color": muted, "fill-opacity": 0.3 } })
        // the parcels sold, in the color of what sold (their state, set below)
        m.addLayer({ id: "parcels-sold", type: "fill", ...tiles("parcelles"), minzoom: MIN_ZOOM, paint: { "fill-color": ["match", ["coalesce", ["feature-state", "sold"], ""], ...SOLD_KINDS.flatMap(k => [k.kind, cssColor(k.color)]), "rgba(0,0,0,0)"] as unknown as ExpressionSpecification, "fill-opacity": dark ? 0.55 : 0.45 } })
        // the parcels of the contenance asked
        m.addLayer({ id: "parcels-range", type: "fill", ...tiles("parcelles"), minzoom: MIN_ZOOM, filter: none, paint: { "fill-color": lit, "fill-opacity": 0.35 } })
        m.addLayer({ id: "parcels-range-line", type: "line", ...tiles("parcelles"), minzoom: MIN_ZOOM, filter: none, paint: { "line-color": lit, "line-width": 2.5 } })
        // the parcels: an invisible fill the pointer reads, their outlines, the one under the pointer tinted
        m.addLayer({ id: "parcels", type: "fill", ...tiles("parcelles"), minzoom: MIN_ZOOM, paint: { "fill-color": hi, "fill-opacity": 0 } })
        m.addLayer({ id: "parcel-hover", type: "fill", ...tiles("parcelles"), minzoom: MIN_ZOOM, filter: none, paint: { "fill-color": hi, "fill-opacity": 0.3 } })
        m.addLayer({ id: "parcels-line", type: "line", ...tiles("parcelles"), minzoom: MIN_ZOOM, paint: { "line-color": ink, "line-opacity": 0.5, "line-width": ["interpolate", ["linear"], ["zoom"], 15, 0.4, 18, 1.2] } })
        m.addLayer({ id: "sections-line", type: "line", ...tiles("sections"), minzoom: 13, paint: { "line-color": ink, "line-width": ["interpolate", ["linear"], ["zoom"], 13, 1, 17, 2.5] } })
        m.addLayer({ id: "zone", type: "line", source: "zone", paint: { "line-color": ink, "line-width": 2, "line-dasharray": [2, 1.5] } })
        // the selection, dashed in the highlight; the parcel opened, in the highlight
        m.addLayer({ id: "parcels-selected", type: "fill", ...tiles("parcelles"), minzoom: MIN_ZOOM, filter: none, paint: { "fill-color": hi, "fill-opacity": 0.15 } })
        m.addLayer({ id: "parcels-selected-line", type: "line", ...tiles("parcelles"), minzoom: MIN_ZOOM, filter: none, paint: { "line-color": hi, "line-width": 2.5, "line-dasharray": [2, 1] } })
        m.addLayer({ id: "shape-fill", type: "fill", source: "shape", paint: { "fill-color": hi, "fill-opacity": 0.2 } })
        m.addLayer({ id: "shape-line", type: "line", source: "shape", paint: { "line-color": hi, "line-width": 3.5 } })
        // the recent DPE, as on « Prospection »
        const dpeHoverLayer = addDpeLayers(m, { ink, card, hi })
        // the parcels' numbers close up, the sections' letters until then
        m.addLayer({ id: "parcels-label", type: "symbol", ...tiles("parcelles"), minzoom: 17, layout: { "text-field": ["to-string", ["to-number", ["get", "numero"]]], "text-font": ["Source Sans Pro Regular"], "text-size": 11 }, paint: { "text-color": ink, "text-halo-color": card, "text-halo-width": 1.5 } })
        m.addLayer({ id: "sections-label", type: "symbol", ...tiles("sections"), minzoom: 14, maxzoom: 17, layout: { "text-field": ["get", "code"], "text-font": ["Source Sans Pro Bold"], "text-size": 15 }, paint: { "text-color": ink, "text-opacity": 0.75, "text-halo-color": card, "text-halo-width": 2 } })
        m.addLayer({ id: "listings", type: "circle", source: "listings", paint: { "circle-radius": 7, "circle-color": at, "circle-stroke-color": card, "circle-stroke-width": 2 } })
        dpeHoverLayer()

        const popup = new Popup({ closeButton: false, closeOnClick: false, className: "immo-popup" })
        const onDot = (e: MapLayerMouseEvent) => m.queryRenderedFeatures(e.point, { layers: ["listings", "dpe"] }).length > 0
        m.on("mousemove", "parcels", (e: MapLayerMouseEvent) => {
          const p = e.features?.[0]?.properties as TileParcel | undefined
          if (!p || onDot(e)) return
          m.getCanvas().style.cursor = "pointer"
          m.setFilter("parcel-hover", ["==", ["get", "id"], p.id])
          popup.setLngLat(e.lngLat).setHTML(tip(p, cb.current.sold[p.id])).addTo(m)
        })
        m.on("mouseleave", "parcels", () => { m.getCanvas().style.cursor = ""; m.setFilter("parcel-hover", ["==", ["get", "id"], cb.current.hover ?? ""]); popup.remove() })
        // a click opens the parcel, Maj+clic adds it to the selection (or takes it out)
        m.on("click", "parcels", (e: MapLayerMouseEvent) => {
          const f = e.features?.[0]
          if (!f || onDot(e)) return
          if (e.originalEvent.shiftKey) cb.current.onToggle(f.properties as TileParcel)
          else cb.current.onPick(f.properties as TileParcel, f.geometry)
        })
        m.on("mouseenter", "listings", (e: MapLayerMouseEvent) => { m.getCanvas().style.cursor = "pointer"; const f = e.features?.[0]; if (f) popup.setLngLat((f.geometry as GeoPoint).coordinates as [number, number]).setHTML(f.properties.tip).addTo(m) })
        m.on("mouseleave", "listings", () => { m.getCanvas().style.cursor = ""; popup.remove() })
        m.on("click", "listings", (e: MapLayerMouseEvent) => select(e.features?.[0]?.properties.id ?? null))
        // a DPE: its card on hovering it; clicked, the card stays, « Chercher l'annonce » under each one without a
        // listing (a prompt item for the agent)
        m.on("mouseenter", "dpe", (e: MapLayerMouseEvent) => { m.getCanvas().style.cursor = "pointer"; const f = e.features?.[0]; if (f) popup.setLngLat((f.geometry as GeoPoint).coordinates as [number, number]).setHTML(f.properties.tip).addTo(m) })
        m.on("mouseleave", "dpe", () => { m.getCanvas().style.cursor = ""; popup.remove() })
        const pinned = new Popup({ className: "immo-popup", maxWidth: "300px" })
        pin.current = g => {
          const el = document.createElement("div")
          el.innerHTML = dpeTip(g, cb.current.listings, true)
          for (const b of el.querySelectorAll<HTMLButtonElement>("button[data-n]")) b.onclick = () => {
            cb.current.addFeedback({ kind: "chercher", text: dpeAsk(g.items.find(d => d.number === b.dataset.n)!) })
            toast.success("Ajouté au prompt : l'agent cherchera l'annonce")
            b.disabled = true
          }
          popup.remove()
          pinned.setLngLat(g.point).setDOMContent(el).addTo(m)
        }
        m.on("click", "dpe", (e: MapLayerMouseEvent) => { const g = cb.current.groups.get(e.features?.[0]?.properties.key); if (g) pin.current(g) })

        // the parcels of the box the user sees (the columns over the map left out), each once (a parcel across tiles
        // comes in pieces), once the map is still and its tiles in; told only when they changed
        let last = ""
        const view = () => {
          const c = m.getContainer(), wide = left < c.clientWidth - right, x0 = wide ? left : 0, x1 = wide ? c.clientWidth - right : c.clientWidth
          const zoom = m.getZoom(), parcels = new Map<string, Box["parcels"][number]>(), a = m.unproject([x0, c.clientHeight]), b2 = m.unproject([x1, 0])
          if (zoom >= MIN_ZOOM - 0.01) for (const f of m.queryRenderedFeatures([[x0, 0], [x1, c.clientHeight]], { layers: ["parcels"] })) {
            const p = f.properties as TileParcel, b = boundsOf(f.geometry), had = parcels.get(p.id)?.bbox
            parcels.set(p.id, { ...p, bbox: had ? [Math.min(had[0], b[0]), Math.min(had[1], b[1]), Math.max(had[2], b[2]), Math.max(had[3], b[3])] : b })
          }
          const key = `${zoom.toFixed(2)}|${m.getBounds().toArray().flat().map(x => x.toFixed(5))}|${parcels.size}`
          if (key === last) return
          last = key
          const all = [...parcels.values()], count: { [k: string]: number } = {}
          for (const p of all) count[p.commune] = (count[p.commune] ?? 0) + 1
          const commune = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
          cb.current.onBox({ zoom, bounds: [a.lng, a.lat, b2.lng, b2.lat], parcels: all, sections: [...new Set(all.map(p => `${p.commune}${p.prefixe}${p.section}`))], commune })
        }
        m.on("idle", view)
        setReady(n => n + 1)
      })
    })
    return () => { gone = true; map.current?.remove(); map.current = null }
    // the map itself only follows the theme and the search; the rest goes through the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme, data.search.slug])

  // the listings, the parcel opened, the one under the pointer in the column, the selection, the contenance asked, the
  // layers shown
  useEffect(() => {
    const m = map.current
    if (!m?.getLayer("listings")) return
    ;(m.getSource("listings") as GeoJSONSource).setData(listings)
    ;(m.getSource("shape") as GeoJSONSource).setData(fc(shape ? [{ type: "Feature", geometry: shape, properties: {} }] : []))
    ;(m.getSource("dpe") as GeoJSONSource).setData(dpes)
    m.setFilter("dpe-hover", ["==", ["get", "key"], dpeHover ?? ""])
    m.setFilter("parcel-hover", ["==", ["get", "id"], hover ?? ""])
    for (const id of ["parcels-selected", "parcels-selected-line"]) m.setFilter(id, ["in", ["get", "id"], ["literal", selection]])
    const r = ["all", [">=", ["coalesce", ["get", "contenance"], -1], +range.min || 0], ["<=", ["coalesce", ["get", "contenance"], -1], +range.max || 1e12]] as ExpressionSpecification
    for (const id of ["parcels-range", "parcels-range-line"]) m.setFilter(id, r)
    for (const [k, ids] of Object.entries(SWITCHED)) for (const id of ids) m.setLayoutProperty(id, "visibility", (k === "range" ? range.on : layers.includes(k)) ? "visible" : "none")
  }, [ready, listings, shape, hover, layers, selection, range, dpes, dpeHover])
  // a DPE picked in the column: the map goes to it and pins its card
  useEffect(() => {
    if (!dpeFocus || !map.current) return
    map.current.easeTo({ center: dpeFocus.point, zoom: Math.max(map.current.getZoom(), 17), duration: 600 })
    pin.current(dpeFocus)
  }, [dpeFocus, ready])
  // the parcels sold of the period and kinds: their state, the rest cleared
  useEffect(() => {
    const m = map.current
    if (!m?.getLayer("parcels-sold")) return
    m.removeFeatureState({ source: "cadastre", sourceLayer: "parcelles" })
    for (const [id, s] of Object.entries(shownSold)) m.setFeatureState({ source: "cadastre", sourceLayer: "parcelles", id }, { sold: s.kind })
  }, [ready, shownSold])
  // a parcel picked in the column or searched: the map goes to it
  const goKey = go?.join(",")
  useEffect(() => {
    if (go) map.current?.fitBounds([[go[0], go[1]], [go[2], go[3]]], { padding: 80, maxZoom: 18, duration: 800 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goKey, ready])
  // a parcel searched: its tile's record (arpentée, dates) once the map has it
  const lookFor = picked && !picked.tile ? picked.idu : null
  useEffect(() => {
    const m = map.current
    if (!lookFor || !m) return
    const look = () => { const f = m.querySourceFeatures("cadastre", { sourceLayer: "parcelles", filter: ["==", ["get", "id"], lookFor] })[0]; if (f) cb.current.onTile(f.properties as TileParcel) }
    m.on("idle", look)
    return () => { m.off("idle", look) }
  }, [lookFor, ready])

  return (
    <div className={cn("immo-map", className)} style={{ "--map-right": `${right}px` } as React.CSSProperties}>
      <div ref={box} className="h-full w-full" />
      <CadastreLayers docked={!mobile} {...{ layers, setLayers, range, setRange, years, setYears, kinds, setKinds, soldCount, soldLoading }} hasSold={Object.keys(sold).length > 0} listings={listings.features.length}
        dpe={<DpeControls id="cadastre-" layers={layers} toggle={(k, v) => setLayers(v ? [...layers, k] : layers.filter(x => x !== k))} dpe={{ ...dpeSettings, count: dpe.count, open: dpe.open }} mode={data.search.mode} />}
        onPlace={h => map.current?.flyTo({ center: [h.x, h.y], zoom: Math.max(zoomOf(h), 16), duration: 1200 })} />
    </div>
  )
}

// the panel's toggles, smaller than the page's
const CHIP = "h-7 px-2 text-xs"

// The layers' column, as Prospection's: a search to move the map, the cadastre's layers, the parcels sold (their period
// and kinds), the contenance asked, the search's. Docked on the left of a computer's map, floating and folded on a phone.
function CadastreLayers({ docked, layers, setLayers, range, setRange, years, setYears, kinds, setKinds, soldCount, soldLoading, hasSold, listings, onPlace, dpe }: {
  docked: boolean; layers: string[]; setLayers: (v: string[]) => void; range: Range; setRange: (r: Range) => void; years: string; setYears: (v: string) => void; kinds: string[]; setKinds: (v: string[]) => void
  soldCount: number; soldLoading: boolean; hasSold: boolean; listings: number; onPlace: Parameters<typeof PlaceSearch>[0]["onPlace"]; dpe: React.ReactNode
}) {
  const [unfolded, setUnfolded] = useState(false), open = docked || unfolded
  const toggle = (k: string, v: boolean) => setLayers(v ? [...layers, k] : layers.filter(x => x !== k))
  const sw = (k: string, label: React.ReactNode, help?: string, checked = layers.includes(k), onChange = (v: boolean) => toggle(k, v)) => {
    const l = <Label htmlFor={`cadastre-${k}`} className="text-xs">{label}</Label>
    return <div className="flex items-center gap-2"><Switch id={`cadastre-${k}`} checked={checked} onCheckedChange={onChange} />{help ? <Hint text={help}>{l}</Hint> : l}</div>
  }
  return (
    <div className={cn("absolute z-10 bg-card/70 text-xs backdrop-blur-md", docked ? "inset-y-0 left-0 flex w-80 flex-col border-r" : "bottom-3 left-3 w-80 max-w-[calc(100%-1.5rem)] rounded-lg border shadow-sm")}>
      {docked && <div className="border-b p-3"><PlaceSearch onPlace={onPlace} /></div>}
      {!docked && (
        <button type="button" onClick={() => setUnfolded(!unfolded)} aria-expanded={unfolded} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          <LayersIcon className="size-4" />Calques<ChevronDownIcon className={cn("ml-auto size-4 transition-transform", !unfolded && "-rotate-90")} />
        </button>
      )}
      {open && (
        <div className={cn("flex flex-col gap-3.5 overflow-y-auto p-3", !docked && "border-t", docked ? "min-h-0 flex-1" : "max-h-[55vh]")}>
          {!docked && <PlaceSearch onPlace={onPlace} />}
          <Group title="Cadastre">
            <p className="text-muted-foreground">Les parcelles à partir du zoom {MIN_ZOOM}, leur numéro en zoomant encore. Un clic ouvre la fiche d'une parcelle, Maj+clic l'ajoute à la sélection.</p>
            {sw("sections", "Sections cadastrales", SECTION_HELP)}
            {sw("buildings", "Bâtiments", "Les bâtiments dessinés sur le plan cadastral, en dur ou légers.")}
          </Group>
          {dpe}
          <Group title="Parcelles vendues">
            {sw("sold", <>Ventes DVF sur la carte{layers.includes("sold") && <span className="text-muted-foreground">({soldLoading ? "chargement…" : num(soldCount)})</span>}</>, SOLD_HELP)}
            {layers.includes("sold") && (
              <>
                <ToggleGroup type="single" size="sm" variant="outline" value={years} onValueChange={v => v && setYears(v)} className="justify-start" aria-label="Période des ventes">
                  {[["1", "1 an"], ["2", "2 ans"], ["5", "5 ans"]].map(([v, l]) => <ToggleGroupItem className={CHIP} key={v} value={v}><CalendarIcon />{l}</ToggleGroupItem>)}
                </ToggleGroup>
                <ToggleGroup type="multiple" size="sm" variant="outline" value={kinds} onValueChange={setKinds} className="flex-wrap justify-start" aria-label="Ventes affichées">
                  {SOLD_KINDS.map(k => (
                    <ToggleGroupItem className={CHIP} key={k.kind} value={k.kind}>
                      <i className="size-2.5 rounded-sm" style={{ background: `var(${k.color})` }} /><TypeIcon type={k.kind} />{k.kind === "parking" ? "Dépendances" : TYPE_LABEL[k.kind]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <p className="text-muted-foreground">La dernière vente de chaque parcelle (DVF, 5 dernières années, environ 6 mois de retard){hasSold ? "" : " ; rien en Alsace-Moselle"}. Survolez une parcelle pour son prix.</p>
              </>
            )}
          </Group>
          <Group title="Contenance">
            {sw("range", "Surligner une contenance", "Les parcelles dont la contenance (leur surface au cadastre) est dans cet intervalle : pour chercher un terrain, une maison avec jardin. La liste « Parcelles par contenance » ne garde qu'elles.", range.on, v => setRange({ ...range, on: v }))}
            {range.on && (
              <div className="flex items-center gap-1.5">
                <Input aria-label="Contenance minimale en m²" inputMode="numeric" value={range.min} onChange={e => setRange({ ...range, min: e.target.value.replace(/\D/g, "") })} className="h-7 w-20 text-xs" />
                <span>à</span>
                <Input aria-label="Contenance maximale en m²" inputMode="numeric" placeholder="sans limite" value={range.max} onChange={e => setRange({ ...range, max: e.target.value.replace(/\D/g, "") })} className="h-7 w-24 text-xs" />
                <span>m²</span>
              </div>
            )}
          </Group>
          <Group title="Recherche">
            {sw("listings", <>Annonces de la recherche <span className="text-muted-foreground">({num(listings)})</span></>)}
            {sw("zone", "Zone de la recherche")}
          </Group>
        </div>
      )}
    </div>
  )
}

// The column, in blocks: a parcel searched by its reference, the selection, the parcel opened (its record, urban plan,
// sales, permits, buildings, energy, risks), the parcels of the map in figures, its recent DPE, its parcels by
// contenance, the sources
function CadastrePanel({ box, near, picked, record, onSearch, onPick, onClose, onHover, retry, selection, onToggle, onClear, range, sold, dpeBlock }: {
  box: Box | null; near: boolean; picked: Picked | null; record: Loaded | null; onSearch: (idu: string) => void; onPick: (p: TileParcel, geometry: Geometry | null, bbox?: Bounds) => void
  onClose: () => void; onHover: (idu: string | null) => void; retry: () => void; selection: { id: string; area: number | null }[]; onToggle: (id: string, a: number | null) => void; onClear: () => void
  range: Range; sold: Sold; dpeBlock: React.ReactNode
}) {
  const { data: search, addFeedback } = useSearch()
  const [q, setQ] = useState(""), [bad, setBad] = useState(false), [all, setAll] = useState(false)
  // a reference typed is in the commune the map shows most, else the search's
  const insee = box?.commune ?? search.search.insee, where = insee === search.search.insee ? (search.search.district ?? search.search.city) : `la commune ${insee}`
  const parcels = box?.parcels ?? [], sized = parcels.filter(p => p.contenance != null).sort((a, b) => b.contenance! - a.contenance!)
  const ranked = range.on ? sized.filter(p => inRange(range, p.contenance)) : sized
  const sizes = sized.map(p => p.contenance!).reverse(), median = sizes.length ? sizes[Math.floor(sizes.length / 2)] : null
  const communes = new Set(parcels.map(p => p.commune)).size, soldHere = parcels.filter(p => sold[p.id]).length
  const on = (id: string) => ({ onMouseEnter: () => onHover(id), onMouseLeave: () => onHover(null), onFocus: () => onHover(id), onBlur: () => onHover(null) })
  const total = selection.reduce((a, s) => a + (s.area ?? 0), 0)
  return (
    <div className="flex flex-col gap-3">
      <Block icon={SearchIcon} title="Rechercher une parcelle" help="Une parcelle par sa référence cadastrale (sa section et son numéro, sur un acte, un avis de taxe foncière ou un certificat d'urbanisme), dans la commune au centre de la carte ; ou par son identifiant (IDU) partout en France.">
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); const id = iduOf(q, insee); setBad(!id); if (id) onSearch(id) }}>
          <Input aria-label="Référence cadastrale" aria-invalid={bad} placeholder="AO 213, ou un IDU" value={q} onChange={e => { setQ(e.target.value); setBad(false) }} className="h-8" />
          <Button size="sm" type="submit" disabled={!q.trim()}><SearchIcon data-icon="inline-start" />Chercher</Button>
        </form>
        <p className={cn("text-xs", bad ? "text-destructive" : "text-muted-foreground")}>
          {bad ? "Référence non reconnue : une section (une ou deux lettres) puis un numéro, par exemple AO 213." : `Dans ${where}, au centre de la carte. Un IDU de 14 caractères (69383000AO0213) vaut partout.`}
        </p>
      </Block>
      {selection.length > 0 && (
        <Block icon={SquareStackIcon} title={`Sélection · ${area(total)}`} help="Les parcelles réunies par Maj+clic sur la carte (ou « Ajouter à la sélection ») : leur contenance totale, pour un terrain fait de plusieurs parcelles ou une division."
          action={<Button variant="ghost" size="icon-sm" onClick={onClear} aria-label="Vider la sélection"><Trash2Icon /></Button>}>
          <ul className="-mx-1 flex flex-col text-sm">
            {selection.map(s => (
              <li key={s.id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-accent" {...on(s.id)}>
                <LandPlotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{refOfIdu(s.id)} <span className="text-xs text-muted-foreground">{s.id.slice(0, 5)}</span></span>
                <span className="tabular-nums">{area(s.area)}</span>
                <Button variant="ghost" size="icon-xs" onClick={() => onToggle(s.id, s.area)} aria-label={`Retirer la parcelle ${refOfIdu(s.id)}`}><MinusIcon /></Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            <Button size="xs" variant="outline" onClick={() => navigator.clipboard.writeText(selection.map(s => `${refOfIdu(s.id)} (${s.id})`).join(", ")).then(() => toast.success("Références copiées"), () => toast.error("Copie impossible"))}><CopyIcon data-icon="inline-start" />Copier les références</Button>
            <Button size="xs" variant="outline" onClick={() => { addFeedback({ kind: "parcelle", text: `étudier ensemble les parcelles ${selection.map(s => `${refOfIdu(s.id)} (${s.id})`).join(", ")}, ${area(total)} au total` }); toast.success("Ajouté au prompt : l'agent étudiera ces parcelles") }}><BotIcon data-icon="inline-start" />Étudier avec l'agent</Button>
          </div>
        </Block>
      )}
      {picked && <ParcelBlocks key={picked.idu} picked={picked} record={record} onClose={onClose} retry={retry} hover={on(picked.idu)} selected={selection.some(s => s.id === picked.idu)} onToggle={onToggle} />}
      <Block icon={MapIcon} title="Carte affichée" help={`Les parcelles de la partie de carte visible, à partir du zoom ${MIN_ZOOM}, entières même coupées par le bord. Elles se relisent à chaque déplacement.`}>
        {!near ? <p className="text-xs text-muted-foreground">Zoomez sur la carte (zoom {MIN_ZOOM}) pour lire ses parcelles, ou cherchez un lieu au-dessus des calques.</p> : !box ? <div className="grid grid-cols-2 gap-2">{[0, 1, 2, 3].map(k => <Skeleton key={k} className="h-20" />)}</div> : (
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Parcelles" help="Les parcelles visibles sur la carte, même en partie." value={num(parcels.length)} hint={`dans ${num(box.sections.length)} section${box.sections.length > 1 ? "s" : ""}${communes > 1 ? `, ${communes} communes` : ""}`} />
            <Stat label="Contenance médiane" help="La contenance est la surface de la parcelle au cadastre : la moitié des parcelles visibles sont plus petites." value={area(median)} hint="la moitié des parcelles sont plus petites" />
            <Stat label="Plus grande" help="La parcelle visible à la plus grande contenance." value={area(sized[0]?.contenance)} hint={sized[0] ? `parcelle ${refOf(sized[0])}` : "—"} />
            {Object.keys(sold).length ? <Stat label="Vendues" help="Les parcelles visibles avec une vente DVF sur les 5 dernières années (calque « Parcelles vendues »)." value={num(soldHere)} hint={parcels.length ? `${Math.round((soldHere / parcels.length) * 100)} % des parcelles visibles, en 5 ans` : "—"} />
              : <Stat label="Contenance totale" help="Toutes les parcelles visibles, chacune entière." value={area(sizes.reduce((a, x) => a + x, 0))} hint="des parcelles visibles" />}
          </div>
        )}
      </Block>
      {dpeBlock}
      {near && ranked.length > 0 && (
        <Block icon={ListOrderedIcon} title={range.on ? `Parcelles de ${num(+range.min || 0)} à ${range.max ? `${num(+range.max)} m²` : "plus"} · ${num(ranked.length)}` : "Parcelles par contenance"} help="Les parcelles de la carte visible (celles de la contenance surlignée quand le calque est actif), de la plus grande à la plus petite ; un clic ouvre sa fiche et centre la carte sur elle.">
          <ol className="-mx-1 flex flex-col text-sm">
            {ranked.slice(0, all ? 100 : 8).map(p => (
              <li key={p.id}>
                <button type="button" onClick={() => onPick(p, null, p.bbox)} aria-pressed={p.id === picked?.idu} {...on(p.id)}
                  className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", p.id === picked?.idu && "bg-accent")}>
                  <LandPlotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{refOf(p)}{communes > 1 && <span className="text-xs text-muted-foreground"> {p.commune}</span>}{sold[p.id] && <span className="text-xs text-muted-foreground"> · vendue {sold[p.id].date.slice(0, 4)}</span>}</span>
                  <span className="tabular-nums">{area(p.contenance)}</span>
                </button>
              </li>
            ))}
          </ol>
          {ranked.length > 8 && <Button variant="ghost" size="xs" className="self-start" onClick={() => setAll(!all)}>{all ? "Moins" : `Voir les ${Math.min(ranked.length, 100)} plus grandes`}</Button>}
        </Block>
      )}
      {near && range.on && !ranked.length && box && <p className="px-1 text-xs text-muted-foreground">Aucune parcelle de cette contenance sur la carte : élargissez l'intervalle ou déplacez la carte.</p>}
      <Block icon={InfoIcon} title="D'où viennent les données" help="Les sources de cet onglet et ce que vaut la contenance d'une parcelle." folded>
        <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          <p>Carte : le plan cadastral de la DGFiP publié par Etalab (cadastre.data.gouv.fr), mis à jour chaque trimestre ; son édition est dans les crédits de la carte.</p>
          <p>Fiche : l'API Carto de l'IGN, module Cadastre, interrogée par la référence de la parcelle. Urbanisme : le Géoportail de l'urbanisme (PLU, PLUi, carte communale, servitudes d'utilité publique), par l'API Carto.</p>
          <p>Contenance : la surface de la parcelle au cadastre, qui sert à l'impôt. Elle ne garantit rien : seul un bornage par un géomètre-expert fixe les limites et la surface d'un terrain. {ARPENTE_HELP}</p>
          <p>Ventes : DVF (demandes de valeurs foncières, DGFiP), les 5 dernières années, publiées avec environ 6 mois de retard, sauf dans le Bas-Rhin, le Haut-Rhin et la Moselle. Chaque vente telle qu'elle est enregistrée : son prix vaut pour tous ses lots et toutes ses parcelles.</p>
          <p>Permis : les listes Sitadel des 12 derniers mois, par la référence cadastrale que porte chaque permis. Bâtiments : la BDNB du CSTB (année, hauteur, logements, matériaux, DPE, aléa argile, abords de monument historique). DPE et audits : l'ADEME, aux adresses des bâtiments. Copropriété : le registre national (RNIC). Risques : Géorisques, au milieu de la parcelle.</p>
          <p>Propriétaires : seulement la catégorie des personnes morales qui ont des droits sur la parcelle (fichier de la DGFiP repris par la BDNB, forme juridique de l'INSEE), jamais leur nom ; les particuliers n'y figurent pas. Ni le cadastre publié ni DVF ne disent qui possède ou a vendu.</p>
        </div>
      </Block>
    </div>
  )
}

// a row of the record: its label, its value (and a copy button)
function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-right tabular-nums">{v}</dd></div>)}
    </dl>
  )
}
const copy = (text: string, what: string) => navigator.clipboard.writeText(text).then(() => toast.success(`${what} copié${what === "Référence" ? "e" : ""}`), () => toast.error("Copie impossible"))
const CopyButton = ({ text, what }: { text: string; what: string }) => <Button variant="ghost" size="icon-xs" onClick={() => copy(text, what)} aria-label={`Copier ${what === "IDU" ? "l'IDU" : "la référence"}`}><CopyIcon /></Button>
// a DPE class's chip
const Chip = ({ c }: { c: string }) => <b className="grid size-4 shrink-0 place-items-center rounded-sm text-[10px]" style={{ background: DPE_HEX[c], color: dpeInk(c) }}>{c}</b>

// The parcel opened, in blocks: its record (IGN's, Etalab's tile) with its actions and the official sites, then its
// urban plan, the mutations DVF has on it, its permits, its buildings (their condominium, the legal persons' categories),
// their energy, its risks. Opened, the column scrolls to it.
function ParcelBlocks({ picked, record, onClose, retry, hover, selected, onToggle }: {
  picked: Picked; record: Loaded | null; onClose: () => void; retry: () => void; hover: { onMouseEnter: () => void; onMouseLeave: () => void }; selected: boolean; onToggle: (id: string, a: number | null) => void
}) {
  const ref = useScrolledTo(), { addFeedback } = useSearch(), [all, setAll] = useState(false), [allRules, setAllRules] = useState(false)
  const t = picked.tile, d = record?.data ?? null, p = d?.parcel
  const reference = p ? refOf({ prefixe: p.prefix, section: p.section, numero: p.number }) : t ? refOf(t) : refOfIdu(picked.idu)
  const commune = p ? `${p.commune}${p.arrondissement ? ` ${arrondissement(p.arrondissement)}` : ""}` : (t?.commune ?? picked.idu.slice(0, 5))
  const contenance = p?.area ?? t?.contenance ?? null
  const at = d?.middle ?? (picked.geometry ? middle(boundsOf(picked.geometry)) : null)
  const missing = record?.error === "not found", loading = !record?.data && !record?.error
  const rows: [string, React.ReactNode][] = [
    ["Commune", p ? `${commune} (${p.insee})` : commune],
    ["Référence", <span className="inline-flex items-center gap-1">{reference}<CopyButton text={reference} what="Référence" /></span>],
    ...(p && p.prefix !== "000" ? [["Préfixe", `${p.prefix} (commune absorbée)`] as [string, string]] : []),
    ["Feuille", p ? num(p.sheet) : "—"],
    ["Contenance", area(contenance)],
    ["IDU", <span className="inline-flex items-center gap-1 font-mono text-xs">{picked.idu}<CopyButton text={picked.idu} what="IDU" /></span>],
    ...(t ? [["Arpentée", t.arpente ? "Oui" : "Non"], ["Créée le", date(t.created)], ["Mise à jour le", date(t.updated)]] as [string, string][] : []),
  ]
  const u = d?.urbanism, rules = u?.prescriptions ?? [], dvf = d?.dvf
  const study = () => { addFeedback({ kind: "parcelle", text: `étudier la parcelle ${reference} (${picked.idu}), ${commune}, ${area(contenance)}` }); toast.success("Ajouté au prompt : l'agent étudiera la parcelle") }
  return (
    <div ref={ref} className="flex scroll-mt-3 flex-col gap-3" onMouseEnter={hover.onMouseEnter} onMouseLeave={hover.onMouseLeave}>
      <Block icon={LandPlotIcon} title={`Parcelle ${reference}`} help={`La parcelle ouverte : sa référence et sa contenance au cadastre (IGN, Etalab), puis tout ce que les données publiques en disent. ${ARPENTE_HELP}`}
        action={<Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fermer la parcelle"><XIcon /></Button>}>
        {record?.error && (
          <Alert variant={missing ? "default" : "destructive"}>
            <InfoIcon />
            <AlertTitle>{missing ? "Parcelle introuvable" : "Fiche indisponible"}</AlertTitle>
            <AlertDescription>
              <p>{missing ? "L'IGN ne connaît pas cette parcelle : vérifiez la section et le numéro, et la commune au centre de la carte (ou le préfixe d'une commune absorbée)." : `L'API ne répond pas pour l'instant (${record.error}).`}</p>
              {!missing && <Button size="xs" variant="outline" className="mt-1" onClick={retry}><RefreshCwIcon data-icon="inline-start" />Réessayer</Button>}
            </AlertDescription>
          </Alert>
        )}
        {d && d.failed.length > 0 && <Alert><InfoIcon /><AlertTitle>Sources indisponibles</AlertTitle><AlertDescription><p>{d.failed.join(" · ")}. Le reste s'affiche.</p><Button size="xs" variant="outline" className="mt-1" onClick={retry}><RefreshCwIcon data-icon="inline-start" />Réessayer</Button></AlertDescription></Alert>}
        {!missing && (loading ? <Skeleton className="h-40" /> : <Rows rows={rows} />)}
        {!missing && (
          <div className="flex flex-wrap gap-1.5">
            <Hint text="Ajoute au prompt une étude de la parcelle par l'agent : ce que permet le PLU, les servitudes et les risques, ses ventes et le prix du terrain, ce qu'on peut y construire ou diviser.">
              <Button size="xs" onClick={study}><BotIcon data-icon="inline-start" />Étudier avec l'agent</Button>
            </Hint>
            <Button size="xs" variant="outline" onClick={() => onToggle(picked.idu, contenance)}>{selected ? <MinusIcon data-icon="inline-start" /> : <PlusIcon data-icon="inline-start" />}{selected ? "Retirer de la sélection" : "Ajouter à la sélection"}</Button>
          </div>
        )}
        {!missing && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {links(d, picked.idu, at).map(l => <a key={l.label} href={l.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"><ExternalLinkIcon className="size-3" />{l.label}</a>)}
          </div>
        )}
      </Block>
      {d && u && (
        <Block icon={ScrollTextIcon} title="Urbanisme" help="Ce que le document d'urbanisme de la commune (PLU, PLUi, carte communale) dit de la parcelle : sa zone, ses prescriptions (hauteur, recul, mixité sociale, patrimoine…), et les servitudes d'utilité publique qui la grèvent. Le règlement de la zone fait foi : ouvrez-le avant d'acheter pour construire.">
          <p className="text-xs text-muted-foreground">{u.rnu ? "Pas de document d'urbanisme : le règlement national d'urbanisme (RNU) s'applique." : u.document ? `${u.document.kind} « ${u.document.name} »` : "Aucun document d'urbanisme trouvé sur la parcelle."}</p>
          {u.zones.map(z => (
            <div key={z.label} className="flex flex-col gap-0.5 text-sm">
              <span><b>Zone {z.label}</b>{z.kind && <span className="text-muted-foreground"> · {ZONE_KIND[z.kind] ?? z.kind}</span>}{z.date && <span className="text-muted-foreground"> · approuvée le {date(`${z.date.slice(0, 4)}-${z.date.slice(4, 6)}-${z.date.slice(6, 8)}`)}</span>}</span>
              {z.name && <span className="text-xs text-muted-foreground">{z.name}</span>}
            </div>
          ))}
          {rules.length > 0 && (
            <>
              <h3 className="mt-1 text-xs font-semibold">Prescriptions</h3>
              <ul className="flex flex-col gap-0.5 text-sm">{rules.slice(0, allRules ? undefined : 8).map(r => <li key={r.label}>{r.label}{r.value && !r.label.includes(r.value) && <span className="text-muted-foreground"> ({r.value})</span>}</li>)}</ul>
              {rules.length > 8 && <Button variant="ghost" size="xs" className="self-start" onClick={() => setAllRules(!allRules)}>{allRules ? "Moins" : `Voir les ${rules.length}`}</Button>}
            </>
          )}
          {u.easements.length > 0 && (
            <>
              <h3 className="mt-1 text-xs font-semibold">Servitudes d'utilité publique</h3>
              <ul className="flex flex-col gap-0.5 text-sm">{u.easements.map(x => <li key={`${x.kind}-${x.name}`}>{SUP_LABEL[x.kind] ?? "Servitude"} <span className="text-muted-foreground">({x.kind.toUpperCase()}){x.name ? ` · ${x.name}` : ""}</span></li>)}</ul>
            </>
          )}
          {u.infos.length > 0 && <p className="text-xs text-muted-foreground">À savoir : {u.infos.join(" · ")}.</p>}
        </Block>
      )}
      {d && (
        <Block icon={HistoryIcon} title="Ventes DVF de la parcelle" help="Chaque vente enregistrée sur la parcelle depuis 5 ans (DVF), telle qu'elle est : son prix vaut pour tous ses lots et toutes ses parcelles. Sur un immeuble, ce sont les ventes de ses appartements.">
          {!dvf ? <p className="text-xs text-muted-foreground">DVF n'a pas répondu.</p>
            : dvf.alsace_moselle ? <p className="text-xs text-muted-foreground">Pas de DVF dans le Bas-Rhin, le Haut-Rhin et la Moselle : leur livre foncier n'y est pas.</p>
            : dvf.sales.length ? (
              <>
                <ul className="flex flex-col gap-2">
                  {dvf.sales.slice(0, all ? undefined : 8).map(s => (
                    <li key={s.id} className="flex flex-col gap-0.5 text-sm">
                      <div className="flex gap-2">
                        <span className="min-w-0 flex-1">{date(s.date)}{s.nature !== "Vente" && <span className="text-muted-foreground"> · {s.nature}</span>}</span>
                        <span className="font-medium tabular-nums">{eur(s.price)}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{soldWhat(s)}</span>
                    </li>
                  ))}
                </ul>
                {dvf.sales.length > 8 && <Button variant="ghost" size="xs" className="self-start" onClick={() => setAll(!all)}>{all ? "Moins" : `Voir les ${dvf.sales.length} ventes`}</Button>}
                <p className="text-xs text-muted-foreground">DVF {dvf.years[0]}–{dvf.years.at(-1)} · le prix est celui de toute la vente, tous ses lots et parcelles.</p>
              </>
            ) : <p className="text-xs text-muted-foreground">Aucune vente enregistrée sur cette parcelle {dvf.years.length ? `depuis ${dvf.years[0]}` : "dans DVF"}.</p>}
        </Block>
      )}
      {d?.permits && (
        <Block icon={StampIcon} title="Permis sur la parcelle" help="Les permis de construire, de démolir et d'aménager et les déclarations préalables autorisés depuis 12 mois qui citent cette parcelle (Sitadel, publié chaque mois avec du retard). Le demandeur n'est jamais affiché.">
          {d.permits.length ? (
            <ul className="flex flex-col gap-2">
              {d.permits.map(x => (
                <li key={x.number} className="flex items-start gap-2 text-sm">
                  <PermitBadge kind={x.kind} className="mt-0.5" />
                  <span className="min-w-0 flex-1">{permitLabel(x)} du {date(x.date)}<span className="block text-xs text-muted-foreground">{[permitWhat(x), x.parcels.length > 1 && `sur ${x.parcels.length} parcelles`, x.number].filter(Boolean).join(" · ")}</span></span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted-foreground">Aucun permis autorisé sur cette parcelle depuis 12 mois.</p>}
        </Block>
      )}
      {d && (
        <Block icon={Building2Icon} title="Bâtiment" help="Les bâtiments de la parcelle selon la BDNB (base de données nationale des bâtiments, CSTB) : année de construction, hauteur, logements, matériaux, DPE, aléa retrait-gonflement des argiles, abords d'un monument historique ; sa copropriété (registre national) et la catégorie des personnes morales qui y ont des droits, jamais leur nom.">
          {d.buildings.length ? d.buildings.slice(0, 3).map(b => (
            <div key={b.id} className="flex flex-col gap-1">
              {d.buildings.length > 1 && <h3 className="text-xs font-semibold">{b.address ?? "Bâtiment"}</h3>}
              <Rows rows={([
                ["Usage", b.use], ["Construit en", b.year && `${b.year}`], ["Niveaux", b.levels && `${b.levels}${b.height ? ` · ${num(b.height)} m de haut` : ""}`], ["Logements", b.homes && num(b.homes)],
                ["Emprise au sol", b.footprint && `${num(b.footprint)} m²${contenance ? ` (${Math.round((b.footprint / contenance) * 100)} % de la parcelle)` : ""}`], ["Murs", word(b.walls)],
                ["Chauffage", word(b.heating)], ["Aléa argile", b.clay?.toLowerCase()], ["Monument historique", b.monument ? "aux abords (avis de l'architecte des Bâtiments de France)" : null],
                ["DPE", Object.keys(b.dpe_classes).length ? <span className="inline-flex flex-wrap justify-end gap-1">{Object.entries(b.dpe_classes).map(([c, n]) => <span key={c} className="inline-flex items-center gap-0.5"><Chip c={c} />{n}</span>)}</span> : b.dpe && <Chip c={b.dpe} />],
              ] as [string, React.ReactNode][]).filter(([, v]) => v != null && v !== false && v !== "")} />
            </div>
          )) : <p className="text-xs text-muted-foreground">Aucun bâtiment recensé sur cette parcelle (BDNB) : un terrain nu, une cour, une voie, ou un bâtiment rattaché à la parcelle voisine.</p>}
          {d.copro && (
            <>
              <h3 className="mt-1 text-xs font-semibold">Copropriété</h3>
              <Rows rows={[["Nom", d.copro.name], ["Immatriculation", d.copro.number], ["Lots", `${num(d.copro.lots)} dont ${num(d.copro.dwellings)} logements${d.copro.parking ? `, ${num(d.copro.parking)} stationnements` : ""}`], ["Syndic", d.copro.syndic ?? "inconnu"]]} />
            </>
          )}
          {Object.keys(d.owners).length > 0 && <p className="text-xs text-muted-foreground">Personnes morales titulaires de droits (propriétaire, gérant…) : {Object.entries(d.owners).map(([k, n]) => `${OWNER_LABEL[k as OwnerKind]}${n > 1 ? ` × ${n}` : ""}`).join(", ")}. Leur nom n'est pas affiché.</p>}
        </Block>
      )}
      {d && ((d.dpe?.length ?? 0) > 0 || (d.audits?.length ?? 0) > 0) && (
        <Block icon={GaugeIcon} title="DPE et audits" help="Les diagnostics de performance énergétique et les audits énergétiques enregistrés par l'ADEME aux adresses des bâtiments de la parcelle (depuis 2021 pour les DPE, septembre 2023 pour les audits).">
          <ul className="flex flex-col gap-1.5 text-sm">
            {(d.audits ?? []).map(a => <li key={a.number} className="flex items-center gap-2"><AuditBadge energy={a.energy} /><span className="min-w-0 flex-1">Audit énergétique du {date(a.date)}<span className="text-muted-foreground"> · {a.building ? "immeuble entier" : "logement"}{a.area ? ` · ${num(a.area)} m²` : ""}</span></span></li>)}
            {(d.dpe ?? []).slice(0, 12).map(x => <li key={x.number} className="flex items-center gap-2"><Chip c={x.energy} /><span className="min-w-0 flex-1">DPE du {date(x.date)}<span className="text-muted-foreground">{x.area ? ` · ${num(x.area)} m²` : ""}{x.floor ? ` · étage ${x.floor}` : ""}</span></span></li>)}
          </ul>
          {(d.dpe?.length ?? 0) > 12 && <p className="text-xs text-muted-foreground">+ {num(d.dpe!.length - 12)} autres DPE.</p>}
        </Block>
      )}
      {d?.risks && (
        <Block icon={ShieldAlertIcon} title="Risques" help="Les risques naturels et technologiques que Géorisques signale au milieu de la parcelle. Le rapport officiel (lien) est celui de l'état des risques remis à l'acheteur.">
          {[...d.risks.natural, ...d.risks.technological].length
            ? <p className="text-sm">{[...d.risks.natural, ...d.risks.technological].map(r => r.label).join(", ")}</p>
            : <p className="text-xs text-muted-foreground">Aucun risque signalé.</p>}
        </Block>
      )}
    </div>
  )
}
