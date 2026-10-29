import { inZone } from "@engine/geo.js"
import { isHome } from "@engine/market.js"
import { addressOdds, AUDIT_SALE, G_SALE, PERMIT_SALE, SALE_SHARE, saleShare, TURNOVER } from "@engine/odds.js"
import { CalculatorIcon, ChevronDownIcon, ClipboardCheckIcon, GaugeIcon, InfoIcon, ListIcon, ListOrderedIcon, MapIcon, MapPinnedIcon, PercentIcon, RefreshCwIcon, SearchIcon, StampIcon, XIcon, type LucideIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { AuditBadge, PermitBadge } from "@/components/badges"
import { DPE_HEX, dpeInk } from "@/components/dpe"
import { AUDIT_HELP, DPE_HELP, Hint, IRIS_HELP, MapView, METRICS, MIN_ZOOM, oddsTypes, PERMIT_HELP, PROBA, PROBA_HELP, type DpeGroup, type Metric, type OddsMap, type Shown, type Spot } from "@/components/map-view"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, type IrisOdds, type Odds, type OddsPlace } from "@/lib/api"
import { auditAsk, date, dpeAsk, keur, m2, num, permitLabel, permitWhat, share, TYPE_LABEL } from "@/lib/format"
import { useSearch } from "@/lib/store"
import { useIsMobile } from "@/lib/use-mobile"
import { cn } from "@/lib/utils"

type View = { bbox: number[]; zoom: number }

// The odds tab (« Prospection »): the same layout as the listings' (layers on the left, the map, the column on the right). The map loads
// the box it shows once it stops for half a second (from zoom 14), the call before dropped; the column says the box,
// the IRIS clicked and the recent DPE shown.
export function OddsTab() {
  const mobile = useIsMobile()
  const [view, setView] = useState<View | null>(null), [data, setData] = useState<Odds | null>(null)
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null), [tries, setTries] = useState(0)
  const [metric, setMetric] = useState<Metric>("odds"), [iris, setIris] = useState<string | null>(null)
  const [groups, setGroups] = useState<DpeGroup[]>([]), [focus, setFocus] = useState<Spot | null>(null), [show, setShow] = useState("map")
  const [hover, setHover] = useState<OddsMap["hover"]>(null), [shownRows, setShownRows] = useState<Shown>({ audits: [], permits: [], months: { audit: 12, permit: 12 } })
  // a DPE, an audit or a permit the follow-up asks to show: once the map is up, it goes there and pins its card, until
  // another is picked
  const { data: search, types, mapFocus, focusMap } = useSearch()
  const followed = useMemo<Spot | null>(() => {
    if (mapFocus?.kind !== "dpe") return mapFocus
    const d = mapFocus.row
    return { kind: "dpe", group: { key: d.ban ?? d.point.join(","), point: d.point, address: d.address, out: !inZone(d.point, search.search.zone as Parameters<typeof inZone>[1]), items: [{ ...d, listing: null }] } }
  }, [mapFocus, search.search.zone])
  useEffect(() => () => focusMap(null), [focusMap])
  // the types the map shows, the estimations' too
  const [shownTypes, setShownTypes] = useState<string[]>(() => oddsTypes(types))
  // the « Estimations »: the box's addresses by their odds of going on sale soon (the DPE and audits of the types shown;
  // a whole building's audit as a flat's), the search's listings telling which DPE of its zone are on sale already; the
  // address opened in the column (picked in its ranking or on the map)
  const [proba, setProba] = useState(false), [placeKey, setPlaceKey] = useState<string | null>(null)
  const places = useMemo(() => {
    if (!proba || !data) return null
    const rows = { dpe: data.dpe.filter(d => shownTypes.includes(d.type)), audits: data.audits.filter(a => shownTypes.includes(a.building ? "flat" : a.type)), permits: data.permits }
    return addressOdds(rows, data.iris, { listings: search.listings, zone: search.search.zone }) as OddsPlace[]
  }, [proba, data, shownTypes, search.listings, search.search.zone])
  const place = places?.find(g => g.key === placeKey)
  const shown = (view && followed) || focus
  // before the map says its box (it is loading), as loading
  const near = !view || view.zoom >= MIN_ZOOM - 0.01, busy = near && (loading || !view)

  useEffect(() => {
    if (!view || !near) return
    const ctl = new AbortController()
    const t = setTimeout(() => {
      setLoading(true)
      setError(null)
      api.odds(view.bbox.map(x => +x.toFixed(4)), ctl.signal).then(
        d => { setData(d); setLoading(false) },
        e => { if (!ctl.signal.aborted) { setError(e.message); setLoading(false) } },
      )
    }, 500)
    return () => { clearTimeout(t); ctl.abort() }
  }, [view, near, tries])

  const odds = { data, metric, setMetric, onView: setView, iris, onIris: setIris, onDpe: setGroups, onShown: setShownRows, focus: shown, hover, proba: { on: proba, set: setProba, places: places ?? [], pick: setPlaceKey, at: place?.point ?? null } }
  const typeFilter = { shown: shownTypes, set: setShownTypes }
  const status = <MapStatus near={near} loading={busy} error={error} retry={() => setTries(tries + 1)} />
  const panel = <OddsPanel data={data} near={near} loading={busy} metric={metric} iris={iris} onIris={setIris} groups={groups} rows={shownRows} places={places} place={place} onPlace={setPlaceKey}
    onFocus={sp => { focusMap(null); setFocus(sp); if (sp.kind === "place") setPlaceKey(sp.place.key); if (mobile) setShow("map") }} onHover={setHover} />
  return mobile ? (
    <div className="relative flex h-full flex-col">
      <ToggleGroup type="single" variant="outline" size="sm" value={show} onValueChange={v => v && setShow(v)} className="m-3 mb-0 self-start" aria-label="Affichage">
        <ToggleGroupItem value="map"><MapIcon />Carte</ToggleGroupItem>
        <ToggleGroupItem value="info"><ListIcon />Infos</ToggleGroupItem>
      </ToggleGroup>
      {show === "map" ? (
        <div className="relative mt-3 mb-16 min-h-0 flex-1">
          <MapView className="absolute inset-0" odds={odds} typeFilter={typeFilter} />
          <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-center">{status}</div>
        </div>
      ) : <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-20">{panel}</div>}
    </div>
  ) : (
    // as the listings' map: under both columns, the layers on its left, the column on its right
    <div className="relative h-full">
      <MapView className="absolute inset-0" right={440} odds={odds} typeFilter={typeFilter} />
      <div className="pointer-events-none absolute top-3 right-[452px] left-[332px] z-10 flex justify-center">{status}</div>
      <div className="absolute inset-y-0 right-0 z-10 w-[440px] overflow-y-auto border-l bg-background/60 p-3 backdrop-blur-md">{panel}</div>
    </div>
  )
}

// the pill over the map: zoom closer, loading, or the call that failed with « Réessayer »
function MapStatus({ near, loading, error, retry }: { near: boolean; loading: boolean; error: string | null; retry: () => void }) {
  const pill = "pointer-events-auto flex items-center gap-2 rounded-full border bg-card/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-md"
  if (!near) return <div className={pill}><InfoIcon className="size-4" />Zoomez pour charger la carte</div>
  if (loading) return <div className={pill} role="status"><Spinner />Chargement…</div>
  if (error) return <div className={cn(pill, "text-destructive")} role="alert">Données indisponibles ({error === "zoom" ? "zone trop large" : error})<Button size="xs" variant="outline" onClick={retry}><RefreshCwIcon data-icon="inline-start" />Réessayer</Button></div>
  return null
}

const sum = (xs: IrisOdds[], f: (i: IrisOdds) => number | null | undefined) => xs.reduce((a, i) => a + (f(i) ?? 0), 0)
// a figure a year, rounded to one decimal under ten
const perYear = (x: number) => `≈ ${num(x < 10 ? Math.round(x * 10) / 10 : Math.round(x))} par an`

// a figure of the box, what it is on hovering it
function Stat({ label, value, hint, help }: { label: string; value: string; hint: string; help: string }) {
  return (
    <Hint text={help}>
      <div tabIndex={0} className="flex cursor-help flex-col gap-0.5 rounded-lg border bg-background/60 p-2.5 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">{label}<InfoIcon className="size-3" /></span>
        <span className="text-lg font-semibold tracking-tight">{value}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
    </Hint>
  )
}

// the orders of the recent DPE's list, each address by its newest DPE (ties: the newest first); « sans annonce »: one of
// the search's zone that no listing matches
const newest = (a: DpeGroup, b: DpeGroup) => b.items[0].date.localeCompare(a.items[0].date)
const unlisted = (g: DpeGroup) => (!g.out && g.items.some(d => !d.listing) ? 1 : 0)
const DPE_SORTS = {
  newest: { label: "Les plus récents", by: newest },
  oldest: { label: "Les plus anciens", by: (a: DpeGroup, b: DpeGroup) => -newest(a, b) },
  unlisted: { label: "Sans annonce d'abord", by: (a: DpeGroup, b: DpeGroup) => unlisted(b) - unlisted(a) || newest(a, b) },
  energyUp: { label: "Classe énergie, A → G", by: (a: DpeGroup, b: DpeGroup) => a.items[0].energy.localeCompare(b.items[0].energy) || newest(a, b) },
  energyDown: { label: "Classe énergie, G → A", by: (a: DpeGroup, b: DpeGroup) => b.items[0].energy.localeCompare(a.items[0].energy) || newest(a, b) },
  area: { label: "Les plus grands", by: (a: DpeGroup, b: DpeGroup) => (b.items[0].area ?? 0) - (a.items[0].area ?? 0) || newest(a, b) },
  count: { label: "Le plus de DPE à l'adresse", by: (a: DpeGroup, b: DpeGroup) => b.items.length - a.items.length || newest(a, b) },
}

// A block of the column, as the layers' column: its icon and title over it (what it shows on hovering them), then its
// `action` (a sort, a close) beside the chevron; the title and the chevron fold it
function Block({ icon: Icon, title, help, action, folded = false, children }: { icon: LucideIcon; title: React.ReactNode; help: string; action?: React.ReactNode; folded?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!folded)
  return (
    <section className="rounded-lg border bg-card/70">
      <div className="flex items-center gap-1 pr-1.5">
        <Hint text={help}>
          <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
            <Icon className="size-4 shrink-0" /><span className="flex min-w-0 items-center gap-2 truncate">{title}</span>
          </button>
        </Hint>
        {action}
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen(!open)} aria-expanded={open} aria-label={open ? "Replier le bloc" : "Déplier le bloc"}>
          <ChevronDownIcon className={cn("transition-transform", !open && "-rotate-90")} />
        </Button>
      </div>
      {open && <div className="flex flex-col gap-2 border-t p-3">{children}</div>}
    </section>
  )
}

// The column of the odds map, in blocks: the box shown in figures, the IRIS clicked, the IRIS ranked by the figure the
// map colors (the map's table), its recent DPE, energy audits and building permits (picked, the map goes to it), the
// method. In the « Estimations » (`places`), the address opened and the addresses ranked by their odds in place of the
// IRIS and the rows.
function OddsPanel({ data, near, loading, metric, iris, onIris, groups, rows, places, place, onPlace, onFocus, onHover }: {
  data: Odds | null; near: boolean; loading: boolean; metric: Metric; iris: string | null; onIris: (c: string | null) => void; groups: DpeGroup[]; rows: Shown
  places: OddsPlace[] | null; place: OddsPlace | undefined; onPlace: (k: string | null) => void; onFocus: (s: Spot) => void
  onHover: (h: OddsMap["hover"]) => void
}) {
  // a row or a block the pointer (or the keyboard) is on: its IRIS or DPE set off on the map
  const on = (h: OddsMap["hover"]) => ({ onMouseEnter: () => onHover(h), onMouseLeave: () => onHover(null), onFocus: () => onHover(h), onBlur: () => onHover(null) })
  const { data: search, types } = useSearch()
  const [all, setAll] = useState(false), [dpeSort, setDpeSort] = useState<keyof typeof DPE_SORTS>("newest")
  if (!near) return <Empty className="border"><EmptyHeader><EmptyTitle>Zoomez sur la carte</EmptyTitle><EmptyDescription>Les quartiers et les DPE se chargent à partir du zoom {MIN_ZOOM}, pour quelques kilomètres à la fois. Ou cherchez un lieu au-dessus des calques.</EmptyDescription></EmptyHeader></Empty>
  if (!data) return <div className="flex flex-col gap-3"><Skeleton className="h-10" /><div className="grid grid-cols-2 gap-2">{[0, 1, 2, 3].map(k => <Skeleton key={k} className="h-20" />)}</div><Skeleton className="h-40" /></div>
  const m = METRICS[metric], homes = sum(data.iris, i => i.census?.homes), sold = sum(data.iris, i => i.sold), ranked = data.iris.filter(i => m.of(i) != null).sort((a, b) => m.of(b)! - m.of(a)!)
  const selected = data.iris.find(i => i.code === iris)
  const items = groups.flatMap(g => g.items), open = groups.reduce((a, g) => a + g.items.filter(d => !g.out && !d.listing).length, 0)
  const { audits, permits, months } = rows, vacant = sum(data.iris, i => i.census?.vacant)
  // the quarters' median prices, their median: the box's price in one figure
  const prices = data.iris.map(i => i.ppm2).filter((x): x is number => !!x).sort((a, b) => a - b), price = prices.length ? prices[Math.floor(prices.length / 2)] : null
  const row = "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
  const sorted = [...groups].sort(DPE_SORTS[dpeSort].by)
  return (
    <div className={cn("flex flex-col gap-3 transition-opacity", loading && "opacity-60")} aria-busy={loading}>
      <Block icon={MapIcon} title={<>Carte affichée{loading && <Spinner />}</>} help="Les chiffres de la partie de carte visible, tous quartiers réunis. Ils se rechargent à chaque déplacement de la carte, à partir du zoom 14.">
        <p className="text-xs text-muted-foreground">{data.iris.length} quartiers INSEE (IRIS) · {data.communes.map(c => c.name).join(", ") || "aucune commune"}</p>
        {data.failed.length > 0 && <Alert><InfoIcon /><AlertTitle>Sources indisponibles</AlertTitle><AlertDescription>{data.failed.join(" · ")}. Le reste s'affiche ; déplacez la carte pour réessayer.</AlertDescription></Alert>}
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Vente à 12 mois" help={METRICS.odds.help} value={homes ? share(sold / homes, 1) : "—"} hint={data.years.length ? `d'un logement · ${num(Math.round(sold))} ventes par an (DVF ${data.years[0]}–${data.years.at(-1)})` : "Pas de DVF ici"} />
          <Stat label="Successions" help={METRICS.successions.help} value={perYear(sum(data.iris, i => i.successions))} hint="ventes après le décès d'un propriétaire vivant seul" />
          <Stat label="Séparations" help={METRICS.separations.help} value={perYear(sum(data.iris, i => i.separations))} hint="ventes après la séparation d'un couple de propriétaires" />
          <Stat label="DPE récents" help={DPE_HELP} value={num(items.length)} hint={`${num(open)} sans annonce dans votre zone`} />
          <Stat label="Audits énergétiques" help={AUDIT_HELP} value={num(audits.length)} hint={`sur ${months.audit} mois · ${num(audits.filter(a => a.building).length)} immeubles entiers`} />
          <Stat label="Permis" help={PERMIT_HELP} value={num(permits.length)} hint={`sur ${months.permit} mois · ${num(permits.filter(p => p.kind === "demolish").length)} démolitions, ${num(permits.reduce((a, p) => a + (p.homes ?? 0), 0))} logements créés`} />
          <Stat label="Logements vacants" help={METRICS.vacant.help} value={homes ? share(vacant / homes, 1) : "—"} hint={`${num(vacant)} logements vides au recensement`} />
          <Stat label="Prix au m²" help={METRICS.price.help} value={m2(price)} hint="médiane des quartiers de la carte (DVF)" />
        </div>
      </Block>
      {place && <PlaceBlock key={place.key} g={place} i={data.iris.find(i => i.code === place.iris)} onClose={() => { onHover(null); onPlace(null) }} hover={on({ point: place.point })} />}
      {places && (
        <Block icon={PercentIcon} title="Adresses les plus probables" help={`${PROBA_HELP} Celles de la carte visible, de la plus probable à la moins probable ; un clic centre la carte sur l'adresse.`}>
          {places.length ? (
            <ol className="-mx-1 flex flex-col">
              {places.slice(0, 30).map(g => (
                <li key={g.key}>
                  <button type="button" onClick={() => onFocus({ kind: "place", place: g })} aria-pressed={g.key === place?.key} {...on({ point: g.point })} className={cn(row, "items-center", g.key === place?.key && "bg-accent")}>
                    <i className="size-2.5 shrink-0 rounded-sm" style={{ background: `var(--estim-${1 + PROBA.steps.filter(s => g.odds >= s).length})` }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{g.address ?? "Adresse inconnue"}</span>
                      <span className="block truncate text-xs text-muted-foreground">{g.signals.map(s => (s.kind === "permit" ? permitLabel(s.row) : `${s.kind === "dpe" ? "DPE" : "Audit"} ${s.row.energy}${(s.rows?.length ?? 1) > 1 ? ` ×${s.rows!.length}` : ""}`)).join(" · ")}{g.out ? " · hors de votre zone" : ""}</span>
                    </span>
                    <span className="tabular-nums">{share(g.odds)}</span>
                  </button>
                </li>
              ))}
            </ol>
          ) : <p className="text-xs text-muted-foreground">Aucun DPE, audit ni permis récent sur la carte.</p>}
          {places.length > 30 && <p className="text-xs text-muted-foreground">+ {num(places.length - 30)} autres adresses sur la carte.</p>}
        </Block>
      )}
      {!places && selected && <IrisBlock key={selected.code} i={selected} years={data.years} onClose={() => { onHover(null); onIris(null) }} hover={on({ iris: selected.code })} />}
      {!places && <Block icon={ListOrderedIcon} title={`Quartiers par ${m.label.toLowerCase()}`} help={`Les quartiers INSEE (IRIS) de la carte visible, du plus haut au plus bas, classés par le chiffre qui colore la carte (« ${m.label} », à choisir dans les calques). Un clic ouvre la fiche du quartier.`}>
        <ol className="-mx-1 flex flex-col text-sm">
          {(all ? ranked : ranked.slice(0, 8)).map(i => (
            <li key={i.code}>
              <button type="button" onClick={() => onIris(i.code === iris ? null : i.code)} aria-pressed={i.code === iris} {...on({ iris: i.code })}
                className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", i.code === iris && "bg-accent")}>
                <i className="size-2.5 shrink-0 rounded-sm" style={{ background: `var(--odds-${1 + m.steps.filter(s => m.of(i)! >= s).length})` }} />
                <span className="min-w-0 flex-1 truncate">{i.name} <span className="text-xs text-muted-foreground">{i.commune}</span></span>
                <span className="tabular-nums">{m.format(m.of(i)!)}</span>
              </button>
            </li>
          ))}
        </ol>
        {ranked.length > 8 && <Button variant="ghost" size="xs" className="self-start" onClick={() => setAll(!all)}>{all ? "Moins" : `Voir les ${ranked.length}`}</Button>}
      </Block>}
      {!places && types.some(isHome) && (
        <Block icon={GaugeIcon} title="DPE récents" help={`${DPE_HELP} Ceux de la carte visible, avec les filtres du calque « DPE récents », dans l'ordre choisi ; un clic centre la carte sur l'adresse.`}
          action={
            <Select value={dpeSort} onValueChange={v => setDpeSort(v as keyof typeof DPE_SORTS)}>
              <SelectTrigger size="sm" className="h-7 text-xs" aria-label="Trier les DPE"><SelectValue /></SelectTrigger>
              <SelectContent align="end"><SelectGroup>{Object.entries(DPE_SORTS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          }>
          {sorted.length ? (
            <ul className="-mx-1 flex flex-col">
              {sorted.slice(0, 30).map(g => {
                const d = g.items[0], l = d.listing && search.listings.find(x => x.id === d.listing!.id)
                return (
                  <li key={g.key}>
                    <button type="button" onClick={() => onFocus({ kind: "dpe", group: g })} {...on({ dpe: g.key })} className={row}>
                      <b className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-sm text-[10px]" style={{ background: DPE_HEX[d.energy], color: dpeInk(d.energy) }}>{d.energy}</b>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{g.address ?? "Adresse inconnue"}</span>
                        <span className="block text-xs text-muted-foreground">
                          {TYPE_LABEL[d.type]}{d.area ? ` · ${num(d.area)} m²` : ""} · {date(d.date)}{g.items.length > 1 ? ` · ${g.items.length} DPE` : ""} · {l ? `Annonce ${keur(l.price)}` : g.out ? "hors de votre zone : annonce inconnue" : "sans annonce"}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : <p className="text-xs text-muted-foreground">Aucun DPE récent sur la carte avec ces filtres (calque « DPE récents »).</p>}
          {sorted.length > 30 && <p className="text-xs text-muted-foreground">+ {num(sorted.length - 30)} autres adresses sur la carte.</p>}
        </Block>
      )}
      {!places && types.some(isHome) && (
        <Block icon={ClipboardCheckIcon} title="Audits énergétiques récents" help={`${AUDIT_HELP} Ceux de la carte visible, sur la période du calque « Audits énergétiques », les plus récents d'abord ; un clic centre la carte sur l'adresse.`}>
          {audits.length ? (
            <ul className="-mx-1 flex flex-col">
              {audits.slice(0, 30).map(a => (
                <li key={a.number}>
                  <button type="button" onClick={() => onFocus({ kind: "audit", row: a })} {...on({ point: a.point })} className={row}>
                    <AuditBadge energy={a.energy} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{a.address ?? "Adresse inconnue"}</span>
                      <span className="block text-xs text-muted-foreground">Classe {a.energy} · {a.building ? "immeuble entier" : TYPE_LABEL[a.type].toLowerCase()}{a.area ? ` · ${num(a.area)} m²` : ""} · {date(a.date)}{a.period ? ` · ${a.period}` : ""}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted-foreground">Aucun audit énergétique sur la carte depuis {months.audit} mois.</p>}
          {audits.length > 30 && <p className="text-xs text-muted-foreground">+ {num(audits.length - 30)} autres sur la carte.</p>}
        </Block>
      )}
      {!places && <Block icon={StampIcon} title="Permis récents" help={`${PERMIT_HELP} Ceux de la carte visible, avec la période et les natures du calque « Permis », les plus récents d'abord ; un clic centre la carte sur l'adresse.`}>
        {permits.length ? (
          <ul className="-mx-1 flex flex-col">
            {permits.slice(0, 30).map(p => (
              <li key={p.number}>
                <button type="button" onClick={() => onFocus({ kind: "permit", row: p })} {...on({ point: p.point })} className={row}>
                  <PermitBadge kind={p.kind} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{p.address}</span>
                    <span className="block text-xs text-muted-foreground">{permitLabel(p)} · {date(p.date)}{permitWhat(p) ? ` · ${permitWhat(p)}` : ""}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-muted-foreground">Aucun permis autorisé sur la carte depuis {months.permit} mois (calque « Permis »).</p>}
        {permits.length > 30 && <p className="text-xs text-muted-foreground">+ {num(permits.length - 30)} autres sur la carte.</p>}
      </Block>}
      <Block icon={CalculatorIcon} title="Comment c'est calculé" help="Les sources et les calculs de cet onglet, et pourquoi aucune personne n'y est identifiée." folded>
        <div className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          <p>Vente à 12 mois : les appartements et maisons vendus seuls dans le quartier (DVF, {data.years.join(", ") || "—"}), divisés par ses logements (recensement de la population, INSEE).</p>
          <p>Successions : les personnes vivant seules de 55 à 79 ans et de 80 ans et plus, multipliées par les taux de décès de la France à ces âges, puis par la part de propriétaires du quartier.</p>
          <p>Séparations : les couples du quartier (mariés, pacsés, en union libre), multipliés par 1 % de séparations par an, puis par la part de propriétaires.</p>
          <p>Logements vacants : les logements vides au recensement, sur tous ses logements. Prix au m² : la médiane des appartements et maisons vendus (DVF, mêmes années), à partir de 5 ventes.</p>
          <p>
            Estimations : chaque DPE, audit énergétique et permis des 12 derniers mois d'une adresse donne une chance p, réunies en 1 − (1 − p₁)(1 − p₂)… : la chance qu'un logement au moins soit mis en vente.
            Les DPE d'une adresse faits le même jour comptent une fois : un propriétaire qui fait diagnostiquer tout un immeuble, ou un logement diagnostiqué deux fois.
            Un DPE précède une vente ou une location : sa chance est la part des ventes dans ce que son quartier met sur le marché (ses ventes DVF par an, contre ses locataires qui déménagent, {share(TURNOVER)} par an), au moins {share(G_SALE)} pour un G, qui ne peut plus être loué depuis 2025.
            Un audit : {share(AUDIT_SALE)}. Tous deux comptent en entier pendant 2 mois, à moitié jusqu'à 6 mois, au quart ensuite. Un permis d'aménager : {share(PERMIT_SALE.develop)}, de construire 2 logements ou plus : {share(PERMIT_SALE.homes)}, de démolir : {share(PERMIT_SALE.demolish)}, une seule maison : {share(PERMIT_SALE.home)}.
            Dans la zone de la recherche, un DPE qui a son annonce est déjà en vente : il ne compte pas. Ce sont des poids raisonnés, pas mesurés.
          </p>
          <p>Audits énergétiques : ceux de l'ADEME des 12 derniers mois. Permis : les listes Sitadel des permis de construire, de démolir et d'aménager, placés à leur adresse par la Base Adresse Nationale ; le demandeur n'est jamais affiché.</p>
          <p>Que des chiffres publics par quartier ou par commune : aucune personne n'est identifiée. Les décès et divorces individuels ne sont pas publiés avec une adresse, et DVF interdit de retrouver qui a vendu.</p>
        </div>
      </Block>
    </div>
  )
}

// the column scrolls to the block opened (made again for each IRIS or address)
function useScrolledTo() {
  const ref = useRef<HTMLDivElement>(null)
  // braces: Chrome's scrollIntoView returns a promise, which React would take for the effect's cleanup
  useEffect(() => { ref.current?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }) }, [])
  return ref
}

// the IRIS clicked on the map or in the ranking: its census, its sales and its odds. Opened, the column scrolls to it.
function IrisBlock({ i, years, onClose, hover }: { i: IrisOdds; years: string[]; onClose: () => void; hover: { onMouseEnter: () => void; onMouseLeave: () => void } }) {
  const ref = useScrolledTo(), c = i.census
  const rows: [string, string][] = c ? [
    ["Logements", num(c.homes)],
    ["Résidences principales", num(c.main)],
    ["Propriétaires occupants", `${num(c.owners)}${c.main ? ` (${share((c.owners ?? 0) / c.main)})` : ""}`],
    ["Depuis, en moyenne", c.owner_years ? `${num(c.owner_years)} ans` : "—"],
    ["Ventes par an", i.sold == null ? "—" : num(i.sold)],
    ["Vente à 12 mois", i.odds == null ? "—" : share(i.odds, 1)],
    ["Personnes seules de 80 ans et plus", num(c.alone_80)],
    ["Personnes seules de 55 à 79 ans", num(c.alone_55_79)],
    ["Successions", i.successions == null ? "—" : perYear(i.successions)],
    ["Couples", num(Math.round(((c.married ?? 0) + (c.pacsed ?? 0) + (c.cohabiting ?? 0)) / 2))],
    ["Séparations", i.separations == null ? "—" : perYear(i.separations)],
    ["Veufs et veuves", num(c.widowed)],
    ["Divorcés", num(c.divorced)],
    ["Logements vacants", c.vacant == null ? "—" : `${num(c.vacant)}${c.homes ? ` (${share(c.vacant / c.homes, 1)})` : ""}`],
    ["Résidences secondaires", num(c.secondary)],
    ["Construits avant 1946", c.before_1946 == null ? "—" : `${num(c.before_1946)}${c.main ? ` (${share(c.before_1946 / c.main)})` : ""}`],
    ["Chauffés au fioul", num(c.oil)],
    ["Installés depuis 10 ans et plus", c.settled_10 == null ? "—" : `${num(c.settled_10)}${c.main ? ` (${share(c.settled_10 / c.main)})` : ""}`],
    ["Prix au m², appartements", m2(i.ppm2_flat)],
    ["Prix au m², maisons", m2(i.ppm2_house)],
  ] : []
  return (
    <div ref={ref} className="scroll-mt-3" onMouseEnter={hover.onMouseEnter} onMouseLeave={hover.onMouseLeave}>
      <Block icon={MapPinnedIcon} title={i.name} help={`Le quartier INSEE (IRIS) ouvert : ses logements, propriétaires et habitants (recensement), ses ventes (DVF) et ses probabilités. ${IRIS_HELP}`} action={<Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fermer le quartier"><XIcon /></Button>}>
        <p className="text-xs text-muted-foreground">{i.commune}{c ? ` · recensement ${c.year}` : ""}{years.length ? ` · DVF ${years[0]}–${years.at(-1)}` : ""}</p>
        {c ? (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-right tabular-nums">{v}</dd></div>)}
          </dl>
        ) : <p className="text-sm text-muted-foreground">Pas de chiffres INSEE pour ce quartier (quartier d'activité ou peu habité).</p>}
      </Block>
    </div>
  )
}

// The address opened in the « Estimations » (its row in the ranking, its dot on the map): its odds, its quarter's
// figures behind a DPE's chance, each signal with its chance (a home's value at its quarter's median price, « Chercher
// l'annonce » for a DPE or an audit). Opened, the column scrolls to it.
function PlaceBlock({ g, i, onClose, hover }: { g: OddsPlace; i: IrisOdds | undefined; onClose: () => void; hover: { onMouseEnter: () => void; onMouseLeave: () => void } }) {
  const ref = useScrolledTo(), { addFeedback } = useSearch(), [asked, setAsked] = useState<string[]>([])
  const ask = (n: string, text: string) => (
    <Button size="xs" variant="outline" className="shrink-0" disabled={asked.includes(n)} onClick={() => { addFeedback({ kind: "chercher", text }); setAsked([...asked, n]); toast.success("Ajouté au prompt : Claude cherchera l'annonce") }}>
      <SearchIcon data-icon="inline-start" />Chercher l'annonce
    </Button>
  )
  // a home at the quarter's median price of its type
  const value = (type: "flat" | "house", area: number | null) => { const p = type === "flat" ? i?.ppm2_flat : i?.ppm2_house; return p && area ? ` · ≈ ${keur(p * area)} au prix médian du quartier` : "" }
  const c = i?.census, muted = "min-w-0 flex-1 text-xs text-muted-foreground"
  const rows: [string, string][] = i && c ? [
    ["Ventes parmi les biens mis sur le marché", share(saleShare(i))],
    ["Vente à 12 mois", i.odds == null ? "—" : share(i.odds, 1)],
    ["Ventes par an", i.sold == null ? "—" : num(i.sold)],
    ["Propriétaires occupants", `${num(c.owners)}${c.main ? ` (${share((c.owners ?? 0) / c.main)})` : ""}`],
    ["Locataires", c.main != null && c.owners != null ? num(c.main - c.owners) : "—"],
    ["Logements vacants", c.vacant == null ? "—" : `${num(c.vacant)}${c.homes ? ` (${share(c.vacant / c.homes, 1)})` : ""}`],
    ["Prix au m², appartements", m2(i.ppm2_flat)],
    ["Prix au m², maisons", m2(i.ppm2_house)],
  ] : []
  return (
    <div ref={ref} className="scroll-mt-3" onMouseEnter={hover.onMouseEnter} onMouseLeave={hover.onMouseLeave}>
      <Block icon={MapPinnedIcon} title={g.address ?? "Adresse inconnue"} help={`L'adresse ouverte : ses DPE, audits énergétiques et permis des 12 derniers mois avec leur chance, et les chiffres de son quartier. ${PROBA_HELP}`} action={<Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Fermer l'adresse"><XIcon /></Button>}>
        <p className="text-xs text-muted-foreground">{[i?.commune, i && `quartier ${i.name}`, g.out ? "hors de votre zone : annonces inconnues" : "dans votre zone"].filter(Boolean).join(" · ")}</p>
        <div className="flex items-center gap-2">
          <i className="size-3 shrink-0 rounded-sm" style={{ background: `var(--estim-${1 + PROBA.steps.filter(x => g.odds >= x).length})` }} />
          <span className="text-2xl font-semibold tracking-tight tabular-nums">{share(g.odds)}</span>
          <span className="text-xs text-muted-foreground">de chance de mise en vente prochaine</span>
        </div>
        <h3 className="mt-1 text-xs font-semibold">Le quartier</h3>
        {rows.length ? (
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-right tabular-nums">{v}</dd></div>)}
          </dl>
        ) : <p className="text-sm text-muted-foreground">Pas de chiffres INSEE pour ce quartier : un DPE y prend la part des ventes de la France ({share(SALE_SHARE)}).</p>}
        <h3 className="mt-1 text-xs font-semibold">Signaux</h3>
        <ul className="flex flex-col gap-2.5">
          {g.signals.map(s => {
            const day = s.kind === "dpe" ? (s.rows ?? [s.row]) : []
            return (
              <li key={`${s.kind}-${s.row.number}`} className="flex items-start gap-2 text-sm">
                {s.kind === "dpe" ? <b className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-sm text-[10px]" style={{ background: DPE_HEX[s.row.energy], color: dpeInk(s.row.energy) }}>{s.row.energy}</b>
                  : s.kind === "audit" ? <AuditBadge energy={s.row.energy} className="mt-0.5" /> : <PermitBadge kind={s.row.kind} className="mt-0.5" />}
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex gap-2">
                    <span className="min-w-0 flex-1">{s.kind === "dpe" ? (day.length > 1 ? `${day.length} DPE du ${date(s.row.date)}, comptés une fois` : `DPE du ${date(s.row.date)}`) : s.kind === "audit" ? `Audit énergétique du ${date(s.row.date)}` : `${permitLabel(s.row)} du ${date(s.row.date)}`}</span>
                    <span className="tabular-nums">{share(s.p)}</span>
                  </div>
                  {s.kind === "dpe" && (
                    <>
                      {day.length > 1 && <p className="text-xs text-muted-foreground">Un propriétaire qui fait diagnostiquer tout un immeuble, ou un logement diagnostiqué deux fois.</p>}
                      {day.slice(0, 5).map(d => <div key={d.number} className="flex items-center gap-2"><span className={muted}>{day.length > 1 && `${d.energy} · `}{TYPE_LABEL[d.type]}{d.area ? ` ${num(d.area)} m²` : ""}{value(d.type, d.area)}</span>{ask(d.number, dpeAsk(d))}</div>)}
                      {day.length > 5 && <p className="text-xs text-muted-foreground">+ {num(day.length - 5)} autres DPE ce jour-là</p>}
                    </>
                  )}
                  {s.kind === "audit" && (
                    <div className="flex items-center gap-2">
                      <span className={muted}>{s.row.building ? "Immeuble entier" : TYPE_LABEL[s.row.type]}{s.row.area ? ` ${num(s.row.area)} m²` : ""}{s.row.period ? ` · construit ${/^(avant|après)/.test(s.row.period) ? s.row.period : `en ${s.row.period}`}` : ""}{s.row.building ? "" : value(s.row.type, s.row.area)}</span>
                      {ask(s.row.number, auditAsk(s.row))}
                    </div>
                  )}
                  {s.kind === "permit" && permitWhat(s.row) && <span className="text-xs text-muted-foreground">{permitWhat(s.row)}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      </Block>
    </div>
  )
}
