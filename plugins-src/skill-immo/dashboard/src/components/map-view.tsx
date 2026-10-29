import { recentDpe } from "@engine/dpe.js"
import { around, inZone, thin } from "@engine/geo.js"
import { isHome, matches, typeOf, unitPrice } from "@engine/market.js"
import type { Feature, FeatureCollection, Geometry, Point as GeoPoint, Position } from "geojson"
import { LngLatBounds, Map as MapLibre, NavigationControl, Popup, setWorkerUrl, type GeoJSONSource, type MapLayerMouseEvent, type StyleSpecification } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url"
import { useTheme } from "next-themes"
import { CheckIcon, ChevronDownIcon, CrossIcon, LayersIcon, MapPinIcon, PencilIcon, SchoolIcon, ShoppingBasketIcon, TrainFrontIcon, TreesIcon } from "lucide-react"
import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { AuditBadge, mapBadges, PermitBadge } from "@/components/badges"
import { DPE_HEX, dpeInk } from "@/components/dpe"
import { levelOf } from "@/components/ruler"
import { TypeIcon } from "@/components/type-icon"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type AuditRow, type DpeRow, type Hit, type IrisOdds, type Listing, type Odds, type OddsPlace, type PermitKind, type PermitRow, type Poi, type Point, type PropertyType } from "@/lib/api"
import { auditAsk, date, dpeAsk, eur, keur, LEVEL_LABEL, m2, month, num, pct, PERMIT_LABEL, permitLabel, permitWhat, perUnit, POI_LABEL, share, STATUS_LABEL, titleCase, TYPE_LABEL } from "@/lib/format"
import { shelved } from "@/lib/rank"
import { useSearch } from "@/lib/store"
import { useIsMobile } from "@/lib/use-mobile"
import { cn } from "@/lib/utils"
import { geometryOf, ringsOf, zoneEditor, type Rings } from "@/components/zone-editor"

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

// an energy audit's card: its class, what it is, when; « Chercher l'annonce » once pinned
export const AUDIT_HELP = "L'audit énergétique est obligatoire pour vendre une maison ou un immeuble entier classé E, F ou G (ADEME) : un audit récent signale souvent une vente proche. Il sert aussi à demander une aide à la rénovation, et rien ne distingue les deux."
function auditTip(a: AuditRow, buttons = false) {
  const what = `${a.building ? "Immeuble entier" : TYPE_LABEL[a.type]}${a.area ? ` · ${num(a.area)} m²` : ""}${a.period ? ` · construit ${a.period.startsWith("avant") || a.period.startsWith("après") ? a.period : `en ${a.period}`}` : ""}`
  return `<b>${esc(a.address ?? "Adresse inconnue")}</b><div class="dpe-row"><b class="dpe-chip" style="background:${DPE_HEX[a.energy]};color:${dpeInk(a.energy)}">${esc(a.energy)}</b>Audit énergétique du ${date(a.date)}<br><span>${what}</span>${buttons ? `<button type="button" data-n="${esc(a.number)}">Chercher l'annonce</button>` : ""}</div>`
}
// a building permit's card: its kind, when, what it builds or knocks down
export const PERMIT_HELP = "Les permis de construire, de démolir et d'aménager autorisés depuis 12 mois (Sitadel, publié chaque mois avec du retard : environ 6 mois pour construire, 1 mois pour démolir ou aménager) : une démolition annonce un terrain ou un programme, une maison divisée des logements à vendre, un programme neuf un achat sur plan, mais aussi des travaux ou un vis-à-vis. Le demandeur n'est jamais affiché."
function permitTip(p: PermitRow) {
  return `<b>${esc(p.address)}</b><div class="dpe-row"><b class="dpe-chip" style="background:var(--permit-${p.kind});color:#fff">${p.form}</b>${permitLabel(p)} du ${date(p.date)}${permitWhat(p) ? `<br><span>${permitWhat(p)}</span>` : ""}</div>`
}

// an address's card in the « Estimations »: its odds, its IRIS's share of sales, then each DPE (those of one day
// together), audit and permit with its chance; once pinned, « Chercher l'annonce » under each DPE and audit
function placeTip(g: OddsPlace, buttons = false) {
  const chip = (x: string, bg: string, ink: string) => `<b class="dpe-chip" style="background:${bg};color:${ink}">${esc(x)}</b>`
  const rows = g.signals.slice(0, 8).map(s => {
    const n = s.rows?.length ?? 1
    const what = s.kind === "dpe" ? `${chip(s.row.energy, DPE_HEX[s.row.energy], dpeInk(s.row.energy))}${n > 1 ? `${n} DPE du ${date(s.row.date)}, comptés une fois` : `DPE du ${date(s.row.date)}`} · ${TYPE_LABEL[s.row.type]}${s.row.area ? ` ${num(s.row.area)} m²` : ""}<br><span>${share(s.p)} · ${g.out ? "hors de la zone suivie : annonce inconnue" : "sans annonce"}</span>`
      : s.kind === "audit" ? `${chip(s.row.energy, DPE_HEX[s.row.energy], dpeInk(s.row.energy))}Audit énergétique du ${date(s.row.date)}<br><span>${share(s.p)} · ${s.row.building ? "immeuble entier" : TYPE_LABEL[s.row.type].toLowerCase()}</span>`
      : `${chip(s.row.form, `var(--permit-${s.row.kind})`, "#fff")}${permitLabel(s.row)} du ${date(s.row.date)}<br><span>${share(s.p)}${permitWhat(s.row) ? ` · ${permitWhat(s.row)}` : ""}</span>`
    return `<div class="dpe-row">${what}${buttons && s.kind !== "permit" ? `<button type="button" data-n="${esc(s.row.number)}">Chercher l'annonce</button>` : ""}</div>`
  })
  const more = g.signals.length > 8 ? `<span>+ ${g.signals.length - 8} autres</span>` : ""
  return `<b>${esc(g.address ?? "Adresse inconnue")}</b><br><b>${share(g.odds)}</b> de chance de mise en vente prochaine${g.sale != null ? `<br><span>Quartier : ${share(g.sale)} de ventes parmi les biens mis sur le marché</span>` : ""}${rows.join("")}${more}`
}

// an IRIS's tooltip: its name and commune, then its figures
function irisTip(i: IrisOdds) {
  const f = (m: Metric) => { const x = METRICS[m].of(i); return x == null ? "—" : METRICS[m].format(x) }
  const figures = i.census ? `<br>Vente à 12 mois : ${f("odds")}<br>Successions : ${f("successions")} · Séparations : ${f("separations")}<br>Logements vacants : ${f("vacant")} · Prix : ${i.ppm2 ? m2(i.ppm2) : "—"}` : "<br><span>Pas de chiffres INSEE (quartier d'activité ou peu habité)</span>"
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
// the quintiles of 151 IRIS of Lyon and Villeurbanne, 117 for the last two): the odds that one of its homes goes on
// sale within 12 months, for any reason, after a succession, after a separation (row « odds »); its vacant homes and
// its sold price per m² (row « iris »). `help` says what it is, under the legend and on hovering its button or its
// figure; `legend` its unit, under the legend (`short` its classes' figures there, when `format` is too long).
const PER_YEAR = "En % des logements du quartier, sur 12 mois."
export const METRICS = {
  odds: {
    label: "Vente à 12 mois", row: "odds", of: (i: IrisOdds) => i.odds, steps: [0.015, 0.02, 0.025, 0.03], format: (x: number) => share(x, 1), legend: PER_YEAR,
    help: "La probabilité qu'un logement du quartier soit mis en vente dans les 12 mois : la part de ses logements vendus en un an, d'après les ventes réelles (DVF) des 3 dernières années.",
  },
  successions: {
    label: "Successions", row: "odds", of: (i: IrisOdds) => perHome(i.successions, i), steps: [0.001, 0.0015, 0.002, 0.003], format: (x: number) => share(x, 2), legend: PER_YEAR,
    help: "Une succession : le logement vendu par les héritiers après le décès de son propriétaire. La probabilité qu'un logement du quartier soit mis en vente pour cette raison dans les 12 mois, estimée avec les personnes de 55 ans et plus vivant seules (recensement), les taux de décès par âge en France et la part de propriétaires.",
  },
  separations: {
    label: "Séparations", row: "odds", of: (i: IrisOdds) => perHome(i.separations, i), steps: [0.0008, 0.0011, 0.0014, 0.0018], format: (x: number) => share(x, 2), legend: PER_YEAR,
    help: "Une séparation : le logement vendu quand un couple de propriétaires se sépare (divorce, fin de PACS ou d'union libre). La probabilité qu'un logement du quartier soit mis en vente pour cette raison dans les 12 mois, estimée avec les couples du quartier (recensement), environ 1 % de séparations par an et la part de propriétaires.",
  },
  vacant: {
    label: "Logements vacants", row: "iris", of: (i: IrisOdds) => (i.census?.homes && i.census.vacant != null ? i.census.vacant / i.census.homes : null), steps: [0.06, 0.075, 0.09, 0.11], format: (x: number) => share(x, 1),
    legend: "En % des logements du quartier (recensement).",
    help: "La part des logements vides au recensement : à vendre, à louer, en attente d'une succession ou de travaux. Un quartier qui en compte beaucoup offre plus d'occasions, souvent à rénover.",
  },
  price: {
    label: "Prix au m²", row: "iris", of: (i: IrisOdds) => i.ppm2 ?? null, steps: [3600, 4200, 4700, 5100], format: (x: number) => m2(x), short: (x: number) => (x / 1000).toFixed(1).replace(".", ","),
    legend: "En milliers d'€ par m², appartements et maisons vendus (DVF, 3 dernières années).",
    help: "Le prix médian au m² des appartements et maisons vendus dans le quartier (DVF, 3 dernières années), à partir de 5 ventes. Les classes sont calées sur Lyon : ailleurs, comparez les quartiers entre eux.",
  },
}
export const DPE_HELP = "Le DPE (diagnostic de performance énergétique) est obligatoire avant une vente ou une location (ADEME) : un DPE récent sans annonce signale un logement peut-être bientôt en vente."
export const IRIS_HELP = "Les IRIS sont les quartiers de l'INSEE, d'environ 2 000 habitants : la maille la plus fine de ses statistiques."
// a hint on hovering (or focusing) what it wraps
export function Hint({ text, children }: { text: string; children: React.ReactElement }) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent className="max-w-72 leading-snug">{text}</TooltipContent></Tooltip>
}
export type Metric = keyof typeof METRICS
// a scale of five classes, in the colors `tone`-1 to 5 (the IRIS's blues by default)
type Scale = { steps: number[]; format: (x: number) => string; short?: (x: number) => string; legend: string; tone?: string }
// the five classes of a scale, as the legend says them (its unit said once under it): « < 1,5 », « 1,5–2,0 »…, « ≥ 3,0 »
const classes = ({ steps, format, short }: Scale) => {
  const f = (x: number) => (short ?? format)(x).replace(/ %$/, "")
  return [`< ${f(steps[0])}`, ...steps.slice(1).map((x, i) => `${f(steps[i])}–${f(x)}`), `≥ ${f(steps.at(-1)!)}`]
}
// the « Estimations »: the addresses in five classes of their odds, red to green
export const PROBA: Scale = { steps: [0.15, 0.3, 0.45, 0.6], format: (x: number) => share(x), legend: "En % de chance qu'un logement de l'adresse au moins soit mis en vente.", tone: "--estim" }
export const PROBA_HELP = "La chance qu'un logement de l'adresse au moins soit mis en vente dans les prochains mois, d'après ses DPE, audits énergétiques et permis des 12 derniers mois et les ventes et locataires de son quartier. Une estimation raisonnée, pas une mesure : le détail dans « Comment c'est calculé »."
// the audits and permits the odds map shows, with the layers' period (months) and kinds: its column lists them
export type Shown = { audits: AuditRow[]; permits: PermitRow[]; months: { audit: number; permit: number } }
// the types the odds map filters: flats and houses (the DPE's and audits'), then the search's others (its listings')
export const oddsTypes = (types: PropertyType[]) => [...new Set<PropertyType>(["flat", "house", ...types])]
// what the odds map pins and goes to: the DPE of an address, an energy audit, a building permit, an address of the
// « Estimations » (only goes there: its block in the column says it)
export type Spot = { kind: "dpe"; group: DpeGroup } | { kind: "audit"; row: AuditRow } | { kind: "permit"; row: PermitRow } | { kind: "place"; place: OddsPlace }
const spotPoint = (s: Spot) => (s.kind === "dpe" ? s.group.point : s.kind === "place" ? s.place.point : s.row.point)
// The odds tab's map: its box's data, what colors the IRIS, the box shown (at each stop), the IRIS selected, the DPE
// shown (for the column beside), a DPE, audit or permit to show (picked in that column)
export type OddsMap = {
  data: Odds | null; metric: Metric; setMetric: (m: Metric) => void; onView: (v: { bbox: number[]; zoom: number }) => void
  iris: string | null; onIris: (code: string | null) => void; onDpe: (groups: DpeGroup[]) => void; onShown: (s: Shown) => void; focus: Spot | null
  // what the pointer is on in the column beside: an IRIS (its row, its block), a DPE, an audit or a permit (its
  // point), set off on the map
  hover: { iris?: string; dpe?: string; point?: Point } | null
  // the « Estimations »: on, the map shows only its addresses; one clicked opens in the column (`pick`), set off on
  // the map (`at`)
  proba: { on: boolean; set: (v: boolean) => void; places: OddsPlace[]; pick: (key: string) => void; at: Point | null }
}

// the corners of a zone drawn on the map, in all: what Stream Estate takes
const MAX_CORNERS = 60
// the layers' column, docked on the left of a computer's map
const PANEL = 320
// the map's layers the panel's switches show or hide: at the map's making (its theme) and at each switch
const SWITCHED = {
  sales: ["sales"], veil: ["veil"], dpe: ["dpe-ring", "dpe", "dpe-count", "dpe-hover"], iris: ["iris-fill", "iris-line", "iris-hover", "iris-hover-line", "iris-selected"], listings: ["listings", "labels"], audits: ["audits"], permits: ["permits"],
  zone: ["zone-fill", "zone-halo", "zone"], proba: ["proba", "proba-label"],
}
function showLayers(m: MapLibre, layers: string[]) {
  for (const [k, ids] of Object.entries(SWITCHED)) for (const id of ids) m.setLayoutProperty(id, "visibility", layers.includes(k) ? "visible" : "none")
}

// `right`: the width of what covers the map on its right (the listings' column), which its camera and controls keep clear of.
// With `odds`, the odds tab's map: the IRIS colored by their odds, the recent DPE of the box shown, the listings neutral.
// `typeFilter`: the types shown, the tab's (the listings' column follows it, the odds tab's estimations too).
export function MapView({ className, right = 0, odds, typeFilter }: { className?: string; right?: number; odds?: OddsMap; typeFilter: { shown: string[]; set: (v: string[]) => void } }) {
  const { slug, data, types, marketOf, selected, select, feedback, addFeedback, removeFeedback, spot } = useSearch()
  // the listing the map shows larger and goes to: the dossier's, or the one it sent here (« Voir »), where the map opens
  const pointed = selected ?? spot, spotAt = useRef<[number, number] | null>(null)
  useEffect(() => { spotAt.current = (spot && data.listings.find(l => l.id === spot)?.location.point) || null })
  const { resolvedTheme } = useTheme()
  const mobile = useIsMobile()
  const box = useRef<HTMLDivElement>(null), map = useRef<MapLibre | null>(null)
  const [cats, setCats] = useState<string[]>(odds ? [] : ["transport"])
  const [layers, setLayers] = useState<string[]>(odds ? ["iris", "dpe", "dpe-open", "listings", "audits", "permits"] : ["sales", "veil", "listings"])
  // the audits' and permits' period (days, the 12 months the server sends by default) and the permits' kinds shown on
  // the odds map
  const [kinds, setKinds] = useState<PermitKind[]>(["build", "demolish", "develop"])
  const [auditDays, setAuditDays] = useState("365"), [permitDays, setPermitDays] = useState("365")
  // a computer's map keeps the layers' column clear (a phone's floats, folded)
  const left = mobile ? 0 : PANEL
  const [scope, setScope] = useState("all"), { shown: shownTypes, set: setShownTypes } = typeFilter
  // the legend's keys the user clicked off: a price level, a status (« Écarté »…), their listings off the map
  const [hidden, setHidden] = useState<string[]>([])
  const flip = (k: string) => setHidden(h => (h.includes(k) ? h.filter(x => x !== k) : [...h, k]))
  const [dpeDays, setDpeDays] = useState("180"), [dpeScope, setDpeScope] = useState("all")
  // the DPE groups, audits, permits and listings a click on the map reads, the odds tab's callbacks (the map's
  // handlers are made once), and how a card is pinned (made with the map)
  // the zone being edited (the listings' map only: « Modifier la zone »), its rings as they go, and the zone drawn and
  // sent to the prompt, dashed until Claude applies it. `ready` counts the map's loads (a theme change makes it again).
  const [editing, setEditing] = useState(false), [edit, setEdit] = useState({ corners: 0, drawing: false }), [drawn, setDrawn] = useState<Rings | null>(null)
  const [ready, setReady] = useState(0), rings = useRef<Rings>([]), editor = useRef<ReturnType<typeof zoneEditor> | null>(null), editingRef = useRef(false)
  useEffect(() => { editingRef.current = editing })
  const dpeRef = useRef<{ groups: Map<string, DpeGroup>; audits: Map<string, AuditRow>; permits: Map<string, PermitRow>; places: Map<string, OddsPlace>; listings: Listing[] }>({ groups: new Map(), audits: new Map(), permits: new Map(), places: new Map(), listings: [] })
  const oddsRef = useRef(odds), pin = useRef<(s: Spot) => void>(() => {})
  useEffect(() => { oddsRef.current = odds })
  const pois = useMemo(() => (Array.isArray(data.area.pois) ? data.area.pois : []), [data.area.pois])
  const places = useMemo(() => [...new Set((data.area.isochrones ?? []).map(i => i.place))], [data.area.isochrones])
  // a type shown: always when there is nothing to choose (a search of one type, on the listings' map)
  const on = (t: string) => (odds ? 2 : types.length) < 2 || shownTypes.includes(t)
  // the odds map's recent DPE of the period (in the search's criteria when asked), then only those without a listing in
  // the search's zone when asked: out of it, no listing is known
  const rows = odds?.data?.dpe
  const dpe = useMemo(() => {
    const zone = data.search.zone as Parameters<typeof inZone>[1]
    const all = (recentDpe(rows ?? [], data.listings, { days: +dpeDays, ...(dpeScope === "criteria" ? { criteria: data.search.criteria, types } : {}) }) as DpeGroup[])
      .map(g => ({ ...g, items: g.items.filter(d => shownTypes.includes(d.type)), out: !inZone(g.point, zone) })).filter(g => g.items.length)
    const flag = layers.includes("dpe-open"), only = flag && layers.includes("dpe-only"), open = (g: DpeGroup) => g.items.filter(d => !g.out && !d.listing)
    const groups = only ? all.map(g => ({ ...g, items: open(g) })).filter(g => g.items.length) : all
    return { groups, flag, count: all.reduce((a, g) => a + g.items.length, 0), open: all.reduce((a, g) => a + open(g).length, 0) }
  }, [rows, data.listings, data.search.criteria, data.search.zone, types, dpeDays, dpeScope, layers, shownTypes])
  const onDpe = odds?.onDpe, metric = odds?.metric ?? "odds", irisCode = odds?.iris ?? null, hover = odds?.hover
  // the « Estimations » hide all the rest, the zone too
  const addresses = odds?.proba.places, proba = !!odds?.proba.on, shown = useMemo(() => (proba ? ["proba"] : [...layers, "zone"]), [proba, layers])
  useEffect(() => { onDpe?.(dpe.groups) }, [onDpe, dpe.groups])
  // the box's audits and permits of the period (the permits of every kind, for the kinds' counts), then those shown
  const audits = odds?.data?.audits, permits = odds?.data?.permits, [now] = useState(() => Date.now())
  const recent = useMemo(() => {
    const since = (days: string) => new Date(now - +days * 86400000).toISOString().slice(0, 10)
    const inPeriod = (permits ?? []).filter(p => p.date >= since(permitDays))
    // a whole building's audit as a flat's; the permits say no type
    return { audits: (audits ?? []).filter(a => a.date >= since(auditDays) && shownTypes.includes(a.building ? "flat" : a.type)), inPeriod, permits: inPeriod.filter(p => kinds.includes(p.kind)) }
  }, [audits, permits, auditDays, permitDays, kinds, now, shownTypes])
  const onShown = odds?.onShown
  useEffect(() => { onShown?.({ audits: recent.audits, permits: recent.permits, months: { audit: Math.round(+auditDays / 30.4), permit: Math.round(+permitDays / 30.4) } }) }, [onShown, recent, auditDays, permitDays])

  const sources = useMemo(() => {
    const zone = data.search.zone.geometry as Geometry
    return {
      veil: fc([{ type: "Feature", geometry: outside(zone), properties: {} }]),
      zone: fc([{ type: "Feature", geometry: zone, properties: {} }]),
      drawn: fc(drawn ? [{ type: "Feature", geometry: geometryOf(drawn), properties: {} }] : []),
      sales: fc(types.filter(on).flatMap(t => (data.market.dvf?.[t]?.points ?? []).map(p => ({
        type: "Feature" as const, geometry: { type: "Point" as const, coordinates: p.point },
        properties: { level: levelOf(p.ppm2, marketOf(t).ref?.ppm2) ?? "at", tip: `<b>Vendu ${eur(p.price)}</b><br>${TYPE_LABEL[t]}${p.area ? ` · ${p.area} m²` : ""} · ${perUnit(p.ppm2, t)}${gapTip(p.ppm2, marketOf(t).ref?.ppm2)}<br>${titleCase(p.address)} · ${month(p.date)}` },
      })))),
      listings: fc(data.listings.filter(l => l.location.point && !shelved(l) && on(typeOf(l)) && (scope === "all" || matches(l, data.search.criteria, types))).flatMap(l => {
        const t = typeOf(l) as PropertyType, level = odds ? "at" : (levelOf(unitPrice(l), marketOf(t).ref?.ppm2) ?? "at")
        if (hidden.includes(level) || (l.my_status && hidden.includes(l.my_status))) return []
        return {
          type: "Feature" as const, geometry: { type: "Point" as const, coordinates: l.location.point! },
          properties: { id: l.id, level, status: l.my_status ?? "", label: keur(l.price), tip: `<b>${eur(l.price)}</b><br>${TYPE_LABEL[t]}${l.area ? ` · ${l.area} m²` : ""}${l.rooms ? ` · ${l.rooms} p.` : ""} · ${perUnit(unitPrice(l), t)}${gapTip(unitPrice(l), marketOf(t).ref?.ppm2)}${l.my_status ? `<br><span>${STATUS_LABEL[l.my_status]}${l.status === "EXPIRED" ? " · annonce expirée" : ""}</span>` : ""}` },
        }
      })),
      pois: fc(pois.filter(p => cats.includes(p.cat)).map((p: Poi) => ({ type: "Feature", geometry: { type: "Point", coordinates: p.point }, properties: { cat: p.cat, tip: `${p.name ?? p.kind}<br><span>${POI_LABEL[p.cat] ?? p.cat}</span>` } }))),
      // a dot per address in the class of its newest DPE, ringed when one has no listing (the switch on, in the zone)
      dpe: fc(dpe.groups.map(g => ({ type: "Feature", geometry: { type: "Point", coordinates: g.point }, properties: { key: g.key, energy: g.items[0].energy, count: g.items.length, open: dpe.flag && !g.out && g.items.some(d => !d.listing), tip: dpeTip(g, data.listings) } }))),
      // the box's energy audits of the period in the class of their DPE, its permits of the period and kinds shown in
      // their kind's color
      audits: fc(recent.audits.map(a => ({ type: "Feature", geometry: { type: "Point", coordinates: a.point }, properties: { n: a.number, energy: a.energy, tip: auditTip(a) } }))),
      permits: fc(recent.permits.map(p => ({ type: "Feature", geometry: { type: "Point", coordinates: p.point }, properties: { n: p.number, kind: p.kind, tip: permitTip(p) } }))),
      // each IRIS in the class of the metric shown (-1 without figures), its tooltip with its figures
      iris: fc((odds?.data?.iris ?? []).map(i => ({ type: "Feature", geometry: i.geometry as Geometry, properties: { code: i.code, value: METRICS[odds!.metric].of(i) ?? -1, tip: irisTip(i) } }))),
      // an address of the « Estimations » per dot, its odds written beside it
      proba: fc((addresses ?? []).map(g => ({ type: "Feature", geometry: { type: "Point", coordinates: g.point }, properties: { key: g.key, odds: g.odds, label: share(g.odds), tip: placeTip(g) } }))),
      isochrones: fc((data.area.isochrones ?? []).filter(i => i.geometry && layers.includes(`place:${i.place}`) && i.profile === "pedestrian").map(i => ({ type: "Feature", geometry: i.geometry as Geometry, properties: { place: places.indexOf(i.place), minutes: i.minutes } }))),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, types, marketOf, cats, layers, pois, places, scope, shownTypes, hidden, dpe, odds?.data, odds?.metric, recent, drawn, addresses])

  // the map, made again when the theme changes (its style is not the same)
  useEffect(() => {
    let gone = false
    const dark = resolvedTheme === "dark"
    // the style, and the audits' and permits' badges in this theme's colors (without them, the map still comes)
    Promise.all([loadStyle(dark), mapBadges(cssColor, cssColor("--card")).catch(e => { console.error(e); return {} })]).then(([style, badges]) => {
      if (gone || !box.current) return
      const z = data.search.zone, center = z.center ?? data.search.point
      const m = new MapLibre({ container: box.current, style, center, zoom: 15, attributionControl: { compact: true }, locale: LOCALE })
      map.current = m
      m.setPadding({ top: 0, bottom: 0, left, right })
      m.addControl(new NavigationControl({ showCompass: false }), "top-right")
      m.on("load", () => {
        const [below, at, above, ink, card, hi] = ["--below", "--at", "--above", "--foreground", "--card", "--highlight"].map(cssColor), estim = [1, 2, 3, 4, 5].map(k => cssColor(`--estim-${k}`))
        const status = Object.fromEntries(Object.keys(STATUS_LABEL).map(k => [k, cssColor(`--status-${k}`)]))
        const poiColor = Object.fromEntries(Object.keys(CATS).map(c => [c, cssColor(POI_COLOR[c] ?? "--poi-other")]))
        for (const [id, s] of Object.entries(sources)) m.addSource(id, { type: "geojson", data: s })
        // the point of an audit or a permit under the pointer in the column (set as it moves)
        m.addSource("spot", { type: "geojson", data: fc([]) })
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
        m.addLayer({ id: "drawn", type: "line", source: "drawn", paint: { "line-color": ink, "line-width": 2, "line-dasharray": [2, 1.5] } })
        m.addLayer({ id: "iris-selected", type: "line", source: "iris", filter: ["==", ["get", "code"], oddsRef.current?.iris ?? ""], paint: { "line-color": hi, "line-width": 3.5 } })
        m.addLayer({ id: "isochrones", type: "fill", source: "isochrones", paint: { "fill-color": ["match", ["get", "place"], 0, cssColor(PLACE_COLORS[0]), 1, cssColor(PLACE_COLORS[1]), cssColor(PLACE_COLORS[2])], "fill-opacity": ["case", ["<=", ["get", "minutes"], 15], 0.18, 0.08] } })
        // the DPE grow with the zoom: a whole district shows thousands, as small dots that leave the IRIS readable
        const grow = (one: number, many: number, k: number) => ["interpolate", ["linear"], ["zoom"], 14, ["case", [">", ["get", "count"], 1], many * k, one * k], 16.5, ["case", [">", ["get", "count"], 1], many, one]] as never
        m.addLayer({ id: "dpe-ring", type: "circle", source: "dpe", filter: ["get", "open"], paint: { "circle-radius": grow(10, 13, 0.45), "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": ink, "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 14, 1.5, 16.5, 2.5] } })
        m.addLayer({ id: "dpe", type: "circle", source: "dpe", paint: { "circle-radius": grow(6, 9, 0.45), "circle-color": ["match", ["get", "energy"], ...Object.entries(DPE_HEX).flat(), "#888"] as never, "circle-stroke-color": card, "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 14, 0.5, 16.5, 1.5] } })
        m.addLayer({ id: "dpe-count", type: "symbol", source: "dpe", minzoom: 15.5, filter: [">", ["get", "count"], 1], layout: { "text-field": ["to-string", ["get", "count"]], "text-font": ["Source Sans Pro Bold"], "text-size": 11, "text-allow-overlap": true }, paint: { "text-color": ["match", ["get", "energy"], ["A", "G"], "#fff", "#000"] } })
        // over the DPE dots: the permits' discs and the audits' rounded squares, each with its icon (components/badges)
        for (const [k, img] of Object.entries(badges)) m.addImage(k, img, { pixelRatio: 2 })
        const icon = (image: unknown, small: number, large: number) => ({ "icon-image": image, "icon-size": ["interpolate", ["linear"], ["zoom"], 14, small, 16.5, large], "icon-allow-overlap": true, "icon-ignore-placement": true }) as never
        m.addLayer({ id: "permits", type: "symbol", source: "permits", layout: icon(["concat", "permit-", ["get", "kind"]], 0.85, 1.15) })
        m.addLayer({ id: "audits", type: "symbol", source: "audits", layout: icon(["concat", "audit-", ["get", "energy"]], 0.85, 1.15) })
        // the « Estimations »: a dot per address in the class of its odds, larger and more opaque as they grow, the
        // likeliest on top; its % beside it from zoom 16
        const byOdds = (low: number, high: number) => ["interpolate", ["linear"], ["get", "odds"], 0, low, 1, high]
        m.addLayer({
          id: "proba", type: "circle", source: "proba", layout: { "circle-sort-key": ["get", "odds"] },
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 14, byOdds(2.5, 7), 16.5, byOdds(5, 14)] as never, "circle-color": ["step", ["get", "odds"], estim[0], ...PROBA.steps.flatMap((x, k) => [x, estim[k + 1]])] as never,
            "circle-opacity": ["interpolate", ["linear"], ["get", "odds"], 0, 0.5, 0.6, 1], "circle-stroke-color": card, "circle-stroke-width": 1,
          },
        })
        m.addLayer({ id: "proba-label", type: "symbol", source: "proba", minzoom: 16, layout: { "text-field": ["get", "label"], "text-font": ["Source Sans Pro Bold"], "text-size": 11, "text-variable-anchor": ["left", "right", "top", "bottom"], "text-radial-offset": byOdds(0.7, 1.6) as never, "symbol-sort-key": ["-", ["get", "odds"]] }, paint: { "text-color": ink, "text-halo-color": card, "text-halo-width": 1.5 } })
        m.addLayer({ id: "pois", type: "circle", source: "pois", paint: { "circle-radius": 4, "circle-color": ["match", ["get", "cat"], "transport", poiColor.transport, "shops", poiColor.shops, "schools", poiColor.schools, poiColor.parks], "circle-stroke-color": card, "circle-stroke-width": 1 } })
        // the sales as rings, the listings as dots: both in the color of their gap to the market
        m.addLayer({ id: "sales", type: "circle", source: "sales", paint: { "circle-radius": 4, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": ["match", ["get", "level"], "below", below, "above", above, at], "circle-stroke-width": 1.5, "circle-stroke-opacity": 0.85 } })
        m.addLayer({ id: "listings", type: "circle", source: "listings", paint: { "circle-radius": ["case", ["==", ["get", "id"], ""], 12, 8], "circle-color": ["match", ["get", "level"], "below", below, "above", above, at], "circle-stroke-color": ["match", ["get", "status"], "to_visit", status.to_visit, "visited", status.visited, "offer", status.offer, "dropped", status.dropped, card], "circle-stroke-width": ["case", ["==", ["get", "status"], ""], 2.5, 3.5] } })
        // the DPE under the pointer in the column, over everything: a halo in the highlight, wider than the rings of the
        // DPE without a listing
        m.addLayer({ id: "dpe-hover", type: "circle", source: "dpe", filter: ["==", ["get", "key"], ""], paint: { "circle-radius": 22, "circle-color": hi, "circle-opacity": 0.3, "circle-stroke-color": hi, "circle-stroke-width": 4 } })
        m.addLayer({ id: "spot-hover", type: "circle", source: "spot", paint: { "circle-radius": 22, "circle-color": hi, "circle-opacity": 0.3, "circle-stroke-color": hi, "circle-stroke-width": 4 } })
        m.addLayer({ id: "labels", type: "symbol", source: "listings", layout: { "text-field": ["get", "label"], "text-font": ["Source Sans Pro Bold"], "text-size": 12, "text-offset": [0, -1.5], "text-allow-overlap": false }, paint: { "text-color": ink, "text-halo-color": card, "text-halo-width": 2 } })
        showLayers(m, shown)
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
          if (spotAt.current) m.jumpTo({ center: spotAt.current, zoom: 16 })
        }
        // the odds map opens where it loads: its zoom at least
        if (oddsRef.current && m.getZoom() < MIN_ZOOM) m.setZoom(MIN_ZOOM)
        const popup = new Popup({ closeButton: false, closeOnClick: false, className: "immo-popup" })
        for (const id of ["listings", "sales", "pois", "dpe", "audits", "permits", "proba"]) {
          m.on("mouseenter", id, (e: MapLayerMouseEvent) => { m.getCanvas().style.cursor = "pointer"; const f = e.features?.[0]; if (f) popup.setLngLat((f.geometry as GeoPoint).coordinates as [number, number]).setHTML(f.properties.tip).addTo(m) })
          m.on("mouseleave", id, () => { m.getCanvas().style.cursor = ""; popup.remove() })
        }
        // a listing clicked opens its dossier, not while the zone is edited (a click there is a corner)
        m.on("click", "listings", (e: MapLayerMouseEvent) => { if (!editingRef.current) select(e.features?.[0]?.properties.id ?? null) })
        // an IRIS: its tooltip follows the pointer, a click selects it (unless a DPE or a listing is under it)
        const dot = (e: MapLayerMouseEvent) => m.queryRenderedFeatures(e.point, { layers: ["dpe", "listings", "audits", "permits"] }).length > 0
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
        // a DPE, an audit or a permit clicked: its card stays, each DPE without a listing and each audit with « Chercher
        // l'annonce » (a prompt item for Claude)
        const pinned = new Popup({ className: "immo-popup", maxWidth: "300px" })
        const clicked = (e: MapLayerMouseEvent) => e.features?.[0]?.properties
        m.on("click", "dpe", e => { const g = dpeRef.current.groups.get(clicked(e)?.key); if (g) pin.current({ kind: "dpe", group: g }) })
        m.on("click", "audits", e => { const a = dpeRef.current.audits.get(clicked(e)?.n); if (a) pin.current({ kind: "audit", row: a }) })
        m.on("click", "permits", e => { const p = dpeRef.current.permits.get(clicked(e)?.n); if (p) pin.current({ kind: "permit", row: p }) })
        // an address of the « Estimations »: its block opens in the column, no card
        m.on("click", "proba", e => { const g = dpeRef.current.places.get(clicked(e)?.key); if (g) oddsRef.current?.proba.pick(g.key) })
        pin.current = s => {
          const el = document.createElement("div")
          el.innerHTML = s.kind === "dpe" ? dpeTip(s.group, dpeRef.current.listings, true) : s.kind === "place" ? placeTip(s.place, true) : s.kind === "audit" ? auditTip(s.row, true) : permitTip(s.row)
          for (const b of el.querySelectorAll<HTMLButtonElement>("button[data-n]")) b.onclick = () => {
            // the DPE or the audit of the button
            const r = s.kind === "place" ? s.place.signals.find(x => x.row.number === b.dataset.n)! : s.kind === "dpe" ? { kind: "dpe" as const, row: s.group.items.find(d => d.number === b.dataset.n)! } : s
            addFeedback({ kind: "chercher", text: r.kind === "audit" ? auditAsk(r.row) : dpeAsk(r.row as DpeRow) })
            toast.success("Ajouté au prompt : Claude cherchera l'annonce")
            b.disabled = true
          }
          popup.remove()
          pinned.setLngLat(spotPoint(s)).setDOMContent(el).addTo(m)
        }
        setReady(n => n + 1)
      })
    })
    return () => { gone = true; map.current?.remove(); map.current = null }
    // sources follow through the effect below; the map itself only follows the theme and the search
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme, data.search.slug])

  // new data, filters, selection: the sources and the selected dot change in place
  useEffect(() => {
    dpeRef.current = { groups: new Map(dpe.groups.map(g => [g.key, g])), audits: new Map((odds?.data?.audits ?? []).map(a => [a.number, a])), permits: new Map((odds?.data?.permits ?? []).map(p => [p.number, p])), places: new Map((addresses ?? []).map(g => [g.key, g])), listings: data.listings }
    // the map's layers made (its load done): isStyleLoaded() is false while tiles load, and would skip this change
    const m = map.current
    if (!m?.getLayer("labels")) return
    for (const [id, s] of Object.entries(sources)) (m.getSource(id) as GeoJSONSource | undefined)?.setData(s)
    if (m.getLayer("listings")) m.setPaintProperty("listings", "circle-radius", ["case", ["==", ["get", "id"], pointed ?? ""], 12, 8])
    m.setPaintProperty("iris-fill", "fill-color", irisColor(metric))
    m.setFilter("iris-selected", ["==", ["get", "code"], irisCode ?? ""])
    for (const id of ["iris-hover", "iris-hover-line"]) m.setFilter(id, ["==", ["get", "code"], hover?.iris ?? ""])
    m.setFilter("dpe-hover", ["==", ["get", "key"], hover?.dpe ?? ""])
    // the point under the pointer in the column, else the address opened in the « Estimations »
    const at = hover?.point ?? (proba ? odds?.proba.at : null)
    ;(m.getSource("spot") as GeoJSONSource).setData(fc(at ? [{ type: "Feature", geometry: { type: "Point", coordinates: at }, properties: {} }] : []))
    showLayers(m, shown)
    const l = data.listings.find(x => x.id === pointed)
    if (l?.location.point) m.easeTo({ center: l.location.point, zoom: spot === l.id ? Math.max(m.getZoom(), 16) : m.getZoom(), duration: 400 })
  }, [sources, pointed, spot, shown, data.listings, dpe.groups, metric, irisCode, hover, odds?.data, addresses, proba, odds?.proba.at])

  // the zone's editor on the map while editing, over each map made
  useEffect(() => {
    const m = map.current
    if (!editing || !m?.getLayer("labels")) return
    const e = zoneEditor(m, rings.current, MAX_CORNERS, cssColor("--foreground"), cssColor("--card"), (r, drawing) => { rings.current = r; setEdit({ corners: drawing ? drawing.length : r.reduce((a, x) => a + x.length, 0), drawing: !!drawing }) })
    editor.current = e
    return () => { e.stop(); editor.current = null }
  }, [editing, ready])
  // from the zone drawn before, else the search's outer rings, cut to 60 corners in all, their shape kept (a circle has
  // 64, a long street's band more)
  const startEdit = () => {
    const rs = drawn ?? ringsOf(data.search.zone.geometry), each = Math.floor(MAX_CORNERS / rs.length)
    rings.current = rs.map(r => (thin([...r, r[0]], each + 1) as Rings[number]).slice(0, -1))
    setEditing(true)
  }
  // « Valider »: the draft kept by the server, one [zone] item in the prompt (the last one drawn); Claude applies it
  async function saveZone() {
    try { await api.saveZone(slug, geometryOf(rings.current)) } catch (e) { return void toast.error(`Zone non enregistrée : ${(e as Error).message}`) }
    setDrawn(rings.current.map(r => r.slice()))
    setEditing(false)
    const i = feedback.findIndex(f => f.kind === "zone")
    if (i >= 0) removeFeedback(i)
    addFeedback({ kind: "zone", text: `dessinée sur la carte (${edit.corners} sommets)` })
    toast.success("Zone enregistrée : copiez le prompt, Claude l'appliquera")
  }

  // a DPE, an audit, a permit or an address picked in the odds tab's column: the map goes to it and pins its card (an
  // address's is its block)
  const focus = odds?.focus
  useEffect(() => {
    if (!focus || !map.current) return
    map.current.easeTo({ center: spotPoint(focus), zoom: Math.max(map.current.getZoom(), 16), duration: 600 })
    if (focus.kind !== "place") pin.current(focus)
  }, [focus])

  const sales = types.filter(on).reduce((a, t) => a + (data.market.dvf?.[t]?.points.length ?? 0), 0)
  return (
    <div className={cn("immo-map", className)} style={{ "--map-right": `${right}px` } as React.CSSProperties}>
      {/* maplibre-gl.css, outside the layers, makes it position: relative: it takes the whole box by its size */}
      <div ref={box} className="h-full w-full" />
      {editing && (
        // between the layers' column and the zoom buttons
        <div className="absolute top-3 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card/90 p-2 text-xs shadow-sm backdrop-blur-md" style={{ left: left + 12, maxWidth: `calc(100% - ${left + right + 64}px)` }}>
          <span className="min-w-0 flex-1 basis-60 text-muted-foreground">
            {edit.drawing ? "Cliquez pour poser les sommets ; double-cliquez, ou cliquez le premier, pour fermer." : "Glissez un sommet pour le déplacer, un point au milieu d'un côté pour en ajouter un ; double-cliquez un sommet pour le retirer."}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <span className={cn("whitespace-nowrap tabular-nums", edit.corners >= MAX_CORNERS ? "text-foreground" : "text-muted-foreground")}>{edit.corners} / {MAX_CORNERS} sommets</span>
            <Button size="xs" variant="outline" onClick={() => editor.current?.redraw()} disabled={edit.drawing}><PencilIcon data-icon="inline-start" />Redessiner</Button>
            <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>Annuler</Button>
            <Button size="xs" onClick={saveZone} disabled={edit.drawing || edit.corners < 3}><CheckIcon data-icon="inline-start" />Valider</Button>
          </div>
        </div>
      )}
      {!(editing && mobile) && <LayersPanel docked={!mobile} {...{ cats, setCats, layers, setLayers, scope, setScope, shownTypes, setShownTypes, hidden, flip, pois, places, sales }}
        dpe={{ days: dpeDays, setDays: setDpeDays, scope: dpeScope, setScope: setDpeScope, count: dpe.count, open: dpe.open }}
        sources={{ audits: recent.audits, permits: recent.permits, inPeriod: recent.inPeriod, kinds, setKinds, auditDays, setAuditDays, permitDays, setPermitDays }}
        odds={odds && { metric, setMetric: odds.setMetric, proba: { on: proba, set: odds.proba.set, count: addresses?.length ?? 0 }, listings: sources.listings.features.length, iris: odds.data?.iris?.length ?? 0, onPlace: h => map.current?.flyTo({ center: [h.x, h.y], zoom: zoomOf(h), duration: 1200 }) }}
        edit={odds ? undefined : { start: startEdit, editing, drawn: !!drawn }} />}
    </div>
  )
}

// the panel's toggles, smaller than the page's
const CHIP = "h-7 px-2 text-xs"
// the periods of the recent DPE, audits and permits, in days
const PERIODS = [["90", "3 mois"], ["180", "6 mois"], ["365", "12 mois"]]

// a scale's five classes in its colors, its unit under them
function Legend({ scale }: { scale: Scale }) {
  return (
    <>
      <div className="grid grid-cols-5 gap-0.5 text-[10px] whitespace-nowrap text-muted-foreground" aria-label={`Légende. ${scale.legend}`}>
        {classes(scale).map((c, k) => <span key={c} className="flex flex-col gap-1"><i className="h-2 rounded-sm" style={{ background: `var(${scale.tone ?? "--odds"}-${k + 1})` }} />{c}</span>)}
      </div>
      <p className="-mt-1 text-[10px] text-muted-foreground">{scale.legend}</p>
    </>
  )
}

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
function LayersPanel({ docked, cats, setCats, layers, setLayers, scope, setScope, shownTypes, setShownTypes, hidden, flip, pois, places, sales, dpe, sources, odds, edit }: {
  docked: boolean; cats: string[]; setCats: (v: string[]) => void; layers: string[]; setLayers: (v: string[]) => void; scope: string; setScope: (v: string) => void
  hidden: string[]; flip: (k: string) => void
  shownTypes: string[]; setShownTypes: (v: string[]) => void; pois: Poi[]; places: string[]; sales: number
  dpe: { days: string; setDays: (v: string) => void; scope: string; setScope: (v: string) => void; count: number; open: number }
  sources: {
    audits: AuditRow[]; permits: PermitRow[]; inPeriod: PermitRow[]; kinds: PermitKind[]; setKinds: (v: PermitKind[]) => void
    auditDays: string; setAuditDays: (v: string) => void; permitDays: string; setPermitDays: (v: string) => void
  }
  odds?: { metric: Metric; setMetric: (m: Metric) => void; proba: { on: boolean; set: (v: boolean) => void; count: number }; listings: number; iris: number; onPlace: (h: Hit) => void }
  // the listings' map: the zone redrawn there
  edit?: { start: () => void; editing: boolean; drawn: boolean }
}) {
  const { types, data } = useSearch()
  const [unfolded, setUnfolded] = useState(false), open = docked || unfolded
  const toggle = (k: string, v: boolean) => setLayers(v ? [...layers, k] : layers.filter(x => x !== k))
  const count = (c: string) => pois.filter(p => p.cat === c).length
  // a key of the legend: a click takes its listings off the map, or back
  const legendKey = (k: string, dot: React.ReactNode, label: string) => (
    <button type="button" aria-pressed={!hidden.includes(k)} onClick={() => flip(k)} title={hidden.includes(k) ? "Réafficher sur la carte" : "Masquer de la carte"}
      className={cn("flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none", hidden.includes(k) && "line-through opacity-45")}>
      {dot}{label}
    </button>
  )
  // the types' chips: the search's on the listings' map (from two), flats, houses and the search's others on the odds map
  // the types' chips, each with `help` on hovering it when given
  const chips = (ts: PropertyType[], help?: string) => (
    <ToggleGroup type="multiple" size="sm" variant="outline" value={shownTypes} onValueChange={setShownTypes} className="flex-wrap justify-start" aria-label="Types de bien">
      {ts.map(t => {
        const chip = <ToggleGroupItem className={CHIP} key={t} value={t}><TypeIcon type={t} />{TYPE_LABEL[t]}</ToggleGroupItem>
        return help ? <Hint key={t} text={help}>{chip}</Hint> : chip
      })}
    </ToggleGroup>
  )
  const zone = (
    <Group title="Zone">
      <div className="flex items-center gap-2"><Switch id="veil" checked={layers.includes("veil")} onCheckedChange={v => toggle("veil", v)} /><Label htmlFor="veil" className="text-xs">Assombrir l'extérieur de la zone</Label></div>
      {edit && <Button size="xs" variant="outline" className="self-start" onClick={edit.start} disabled={edit.editing}><PencilIcon data-icon="inline-start" />Modifier la zone</Button>}
      {edit?.drawn && <p className="text-muted-foreground">En pointillés : la zone dessinée, ajoutée au prompt. Claude l'applique quand vous le collez.</p>}
    </Group>
  )
  return (
    <div className={cn("absolute z-10 bg-card/70 text-xs backdrop-blur-md",
      docked ? "inset-y-0 left-0 flex w-80 flex-col border-r" : "bottom-3 left-3 w-80 max-w-[calc(100%-1.5rem)] rounded-lg border shadow-sm")}>
      {odds && docked && <div className="border-b p-3"><PlaceSearch onPlace={odds.onPlace} /></div>}
      {!docked && (
        <button type="button" onClick={() => setUnfolded(!unfolded)} aria-expanded={unfolded} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
          <LayersIcon className="size-4" />Calques<ChevronDownIcon className={cn("ml-auto size-4 transition-transform", !unfolded && "-rotate-90")} />
        </button>
      )}
      {open && (
        <div className={cn("flex flex-col gap-3.5 overflow-y-auto p-3", !docked && "border-t", docked ? "min-h-0 flex-1" : "max-h-[55vh]")}>
          {odds && !docked && <PlaceSearch onPlace={odds.onPlace} />}
          {odds && (
            <Group title="Type de bien">{chips(oddsTypes(types), "Les DPE, les audits (un immeuble entier compte comme appartement) et les annonces de ces types, sur la carte comme dans les estimations. Les permis ne disent pas leur type : ils restent.")}</Group>
          )}
          {odds && (
            <Group title="Estimations">
              <div className="flex items-center gap-2">
                <Switch id="proba" checked={odds.proba.on} onCheckedChange={odds.proba.set} />
                <Hint text={PROBA_HELP}><Label htmlFor="proba" className="text-xs">Chance de vente par adresse{odds.proba.on && <span className="text-muted-foreground">({num(odds.proba.count)})</span>}</Label></Hint>
              </div>
              {odds.proba.on && (
                <>
                  <Legend scale={PROBA} />
                  <p className="text-muted-foreground">Chaque adresse réunit ses DPE, audits énergétiques et permis des 12 derniers mois, quelle que soit la zone de la recherche. Dans la zone, un DPE qui a déjà son annonce ne compte pas. Les autres calques sont masqués : désactivez pour les retrouver.</p>
                </>
              )}
            </Group>
          )}
          {odds?.proba.on ? null : odds ? (
            <>
              <Group title="Quartiers INSEE">
                <div className="flex items-center gap-2">
                  <Switch id="iris" checked={layers.includes("iris")} onCheckedChange={v => toggle("iris", v)} />
                  <Hint text={IRIS_HELP}><Label htmlFor="iris" className="text-xs">Quartiers de la carte <span className="text-muted-foreground">({num(odds.iris)})</span></Label></Hint>
                </div>
                {/* one figure colors the IRIS: a probability (first row) or a figure of the quarter (second row) */}
                {(["odds", "iris"] as const).map(row => (
                  <ToggleGroup key={row} type="single" size="sm" variant="outline" value={METRICS[odds.metric].row === row ? odds.metric : ""} onValueChange={v => v && odds.setMetric(v as Metric)} className="w-full" aria-label={row === "odds" ? "Couleur des quartiers : probabilités" : "Couleur des quartiers : logements et prix"}>
                    {Object.entries(METRICS).filter(([, m]) => m.row === row).map(([k, m]) => <Hint key={k} text={m.help}><ToggleGroupItem className={cn(CHIP, "flex-auto")} value={k}>{m.label}</ToggleGroupItem></Hint>)}
                  </ToggleGroup>
                ))}
                <Legend scale={METRICS[odds.metric]} />
                <p className="text-muted-foreground">{METRICS[odds.metric].help} Gris : pas de chiffres INSEE{odds.metric === "price" ? " ou moins de 5 ventes" : ""}.</p>
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
                        {PERIODS.map(([v, l]) => <ToggleGroupItem className={CHIP} key={v} value={v}>{l}</ToggleGroupItem>)}
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
                            Un DPE précède une vente ou une location : sans annonce, le bien est peut-être bientôt en vente. Hors de la zone de la recherche, les annonces ne sont pas connues.
                            {data.search.mode === "classic" && " En OpenData, c'est sans annonce dans cette recherche."}
                          </p>
                        </>
                      )}
                    </>
                  )}
                </Group>
              )}
              {types.some(isHome) && (
                <Group title="Audits énergétiques">
                  <div className="flex items-center gap-2">
                    <Switch id="audits" checked={layers.includes("audits")} onCheckedChange={v => toggle("audits", v)} />
                    <Hint text={AUDIT_HELP}><Label htmlFor="audits" className="text-xs"><AuditBadge className="size-3.5" />Audits récents de la carte <span className="text-muted-foreground">({num(sources.audits.length)})</span></Label></Hint>
                  </div>
                  {layers.includes("audits") && (
                    <>
                      <ToggleGroup type="single" size="sm" variant="outline" value={sources.auditDays} onValueChange={v => v && sources.setAuditDays(v)} className="justify-start" aria-label="Période des audits">
                        {PERIODS.map(([v, l]) => <ToggleGroupItem className={CHIP} key={v} value={v}>{l}</ToggleGroupItem>)}
                      </ToggleGroup>
                      <p className="text-muted-foreground">Obligatoire pour vendre une maison ou un immeuble entier classé E, F ou G.</p>
                    </>
                  )}
                </Group>
              )}
              <Group title="Permis">
                <div className="flex items-center gap-2">
                  <Switch id="permits" checked={layers.includes("permits")} onCheckedChange={v => toggle("permits", v)} />
                  <Hint text={PERMIT_HELP}><Label htmlFor="permits" className="text-xs">Permis récents de la carte <span className="text-muted-foreground">({num(sources.permits.length)})</span></Label></Hint>
                </div>
                {layers.includes("permits") && (
                  <>
                    <ToggleGroup type="single" size="sm" variant="outline" value={sources.permitDays} onValueChange={v => v && sources.setPermitDays(v)} className="justify-start" aria-label="Période des permis">
                      {PERIODS.map(([v, l]) => <ToggleGroupItem className={CHIP} key={v} value={v}>{l}</ToggleGroupItem>)}
                    </ToggleGroup>
                    <ToggleGroup type="multiple" size="sm" variant="outline" value={sources.kinds} onValueChange={v => sources.setKinds(v as PermitKind[])} className="flex-wrap justify-start" aria-label="Permis affichés">
                      {(Object.keys(PERMIT_LABEL) as PermitKind[]).map(k => (
                        <ToggleGroupItem className={CHIP} key={k} value={k}>
                          <PermitBadge kind={k} className="size-3.5" />{{ build: "Construire", demolish: "Démolir", develop: "Aménager" }[k]}<span className="text-muted-foreground">{sources.inPeriod.filter(p => p.kind === k).length}</span>
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    <p className="text-muted-foreground">Datés de leur autorisation, ils arrivent en retard dans Sitadel (publié chaque mois) : environ 6 mois pour construire, 1 mois pour démolir ou aménager. Sur 3 mois, les permis de construire manquent presque tous.</p>
                  </>
                )}
              </Group>
              <Group title="Annonces">
                <div className="flex items-center gap-2">
                  <Switch id="listings" checked={layers.includes("listings")} onCheckedChange={v => toggle("listings", v)} />
                  <Label htmlFor="listings" className="text-xs">Annonces de la recherche <span className="text-muted-foreground">({num(odds.listings)})</span></Label>
                </div>
                <p className="text-muted-foreground">Celles déjà chargées dans l'onglet Annonces, aux mêmes positions.</p>
              </Group>
              {zone}
            </>
          ) : (
            <>
              <Group title="Annonces">
                <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-muted-foreground">
                  {legendKey("below", <i className="size-2.5 rounded-full bg-below" />, "Sous le marché")}
                  {legendKey("at", <i className="size-2.5 rounded-full bg-at" />, "Au prix")}
                  {legendKey("above", <i className="size-2.5 rounded-full bg-above" />, "Au-dessus")}
                </div>
                <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-muted-foreground">
                  <span className="mr-1 text-foreground">Contour :</span>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => <Fragment key={k}>{legendKey(k, <i className="size-2.5 rounded-full border-2 bg-transparent" style={{ borderColor: `var(--status-${k})` }} />, v)}</Fragment>)}
                </div>
                <p className="text-muted-foreground">{hidden.length ? `${hidden.length} masqué${hidden.length > 1 ? "s" : ""} : cliquez pour les réafficher.` : "Cliquez une pastille pour masquer ces annonces."}</p>
                <ToggleGroup type="single" size="sm" variant="outline" value={scope} onValueChange={v => v && setScope(v)} className="justify-start">
                  <ToggleGroupItem className={CHIP} value="all">Toutes</ToggleGroupItem>
                  <ToggleGroupItem className={CHIP} value="criteria">Dans mes critères</ToggleGroupItem>
                </ToggleGroup>
                {types.length > 1 && chips(types)}
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
