import { score } from "@engine/decide.js"
import { badge, daysOnline, dropped, isHome, matches, typeOf, unitPrice } from "@engine/market.js"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, ChevronDownIcon, EyeIcon, EyeOffIcon, RefreshCwIcon, RotateCcwIcon, ScaleIcon, SearchIcon, SlidersHorizontalIcon, StarOffIcon, TagIcon, TagsIcon, TrendingDownIcon, XIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { toast } from "sonner"

import { CreditBadge } from "@/components/credit-badge"
import { Dpe } from "@/components/dpe"
import { Star } from "@/components/favorite"
import { Origin } from "@/components/origin"
import { LabelChip, LabelPicker, useLabels } from "@/components/labels"
import { Gap } from "@/components/ruler"
import { useRun } from "@/components/run-dialog"
import { NewBadge, StatusBadge, statusBand, StatusDot } from "@/components/status"
import { TypeIcon } from "@/components/type-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { api, type Listing, type PropertyType, type Status } from "@/lib/api"
import { eur, num, pct, SALE_STATUS, STATUS_LABEL, titleOf, TYPE_PLURAL } from "@/lib/format"
import { FLOORS, floorOk, isNew, shelved, unseen, type Floor } from "@/lib/rank"
import { useSearch, useStoredState } from "@/lib/store"
import { cn } from "@/lib/utils"

type Row = { l: Listing; score: number | null; gap: number | null; days: number | null; offer: number | null }
// each column: its header, what it sorts on, its cell; `wide` ones only show from a tablet up
const COLUMNS: { key: string; label: string; sort: (r: Row) => number | string | null; cell: (r: Row) => React.ReactNode; right?: boolean; center?: boolean; wide?: boolean }[] = [
  { key: "type", label: "Type", center: true, sort: r => typeOf(r.l), cell: r => <TypeIcon type={r.l.property_type} className="mx-auto size-4 text-muted-foreground" /> },
  { key: "title", label: "Bien", sort: r => titleOf(r.l), cell: r => <span className="flex flex-col"><span className="flex max-w-72 items-center gap-1 font-medium">{r.l.favorite && <Star on className="size-3.5 shrink-0" />}<span className="truncate">{titleOf(r.l)}</span>{unseen(r.l) && <NewBadge className="h-4 shrink-0 px-1.5 text-[10px]" />}</span><span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Origin l={r.l} />{[...new Set(r.l.urls.map(u => u.source).filter(Boolean))].join(", ")}</span>{!!r.l.labels?.length && <span className="mt-1 flex max-w-72 flex-wrap gap-1">{r.l.labels.map(x => <LabelChip key={x} name={x} className="h-4 px-1.5 text-[10px]" />)}</span>}</span> },
  { key: "price", label: "Prix", right: true, sort: r => r.l.price, cell: r => <PriceCell l={r.l} /> },
  { key: "area", label: "Surface", right: true, sort: r => r.l.area ?? r.l.land_area ?? null, cell: r => (r.l.area ? `${num(r.l.area)} m²` : r.l.land_area ? `${num(r.l.land_area)} m² de terrain` : "—") },
  { key: "ppm2", label: "Prix unitaire", right: true, wide: true, sort: r => unitPrice(r.l), cell: r => num(unitPrice(r.l)) },
  { key: "gap", label: "Écart", right: true, sort: r => r.gap, cell: r => <GapCell l={r.l} /> },
  { key: "rooms", label: "Pièces", right: true, wide: true, sort: r => r.l.rooms, cell: r => r.l.rooms ?? "—" },
  { key: "floor", label: "Étage", right: true, wide: true, sort: r => (typeOf(r.l) === "flat" ? r.l.floor : null), cell: r => (typeOf(r.l) !== "flat" || r.l.floor == null ? "—" : r.l.floor === 0 ? "RDC" : r.l.floor === 1 ? "1er" : `${r.l.floor}ᵉ`) },
  { key: "dpe", label: "DPE", wide: true, sort: r => r.l.dpe?.energy ?? null, cell: r => (isHome(typeOf(r.l)) ? <Dpe value={r.l.dpe?.energy} /> : "—") },
  { key: "score", label: "Score", right: true, sort: r => r.score, cell: r => (r.score == null ? "—" : <span className="font-semibold tabular-nums">{r.score}</span>) },
  { key: "mine", label: "Mon statut", sort: r => (r.l.my_status ? Object.keys(STATUS_LABEL).indexOf(r.l.my_status) : -1), cell: r => (r.l.my_status ? <StatusBadge status={r.l.my_status} /> : <span className="text-muted-foreground">À trier</span>) },
  { key: "status", label: "Annonce", wide: true, sort: r => r.l.status, cell: r => <span className={cn(r.l.status !== "AVAILABLE" && "text-muted-foreground")}>{r.l.status === "AVAILABLE" ? "En ligne" : SALE_STATUS[r.l.status] ?? r.l.status}</span> },
  { key: "days", label: "En ligne", right: true, wide: true, sort: r => r.days, cell: r => (r.days == null ? "—" : `${r.days} j`) },
  { key: "offer", label: "Offre", right: true, wide: true, sort: r => r.offer, cell: r => eur(r.offer) },
]
// the price first: large, with the first price seen struck through when it has changed since
function PriceCell({ l }: { l: Listing }) {
  const first = l.price_history?.[0]?.price, moved = first && l.price && first !== l.price ? (l.price - first) / first : null
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="text-base font-bold tabular-nums whitespace-nowrap">{eur(l.price)}</span>
      {moved != null && <span className={cn("text-xs whitespace-nowrap", moved < 0 ? "text-below" : "text-above")}><s className="text-muted-foreground">{eur(first)}</s> {pct(moved)}</span>}
    </span>
  )
}
function GapCell({ l }: { l: Listing }) {
  const { marketFor } = useSearch()
  return <Gap ppm2={unitPrice(l)} refPpm2={marketFor(l).ref?.ppm2} />
}

// my statuses, « À trier » first: the list shows those ticked, every one but « Écarté » at first
const MINE = { none: "À trier", ...STATUS_LABEL } as Record<string, string>
const NOT_DROPPED = Object.keys(MINE).filter(k => k !== "dropped")

// The list's filters, kept per search in this browser (useStoredState). Those of the « Filtres » popover: ranges read
// as the search's criteria are (engine lib/market.js matches: an unknown value passes), the portals, a price drop.
type Filters = {
  type: "all" | PropertyType; floor: Floor; mine: string[]; labels: string[]; status: string; onlyMatching: boolean; onlyNew: boolean; onlyFavorites: boolean; hideExpired: boolean
  price_min: string; price_max: string; area_min: string; area_max: string; rooms_min: string; score_min: string; dpe_max: string; sources: string[]; drops: boolean
  sort: { key: string; dir: 1 | -1 }
}
const DEFAULTS: Filters = {
  type: "all", floor: "all", mine: NOT_DROPPED, labels: [], status: "all", onlyMatching: false, onlyNew: false, onlyFavorites: false, hideExpired: true,
  price_min: "", price_max: "", area_min: "", area_max: "", rooms_min: "", score_min: "", dpe_max: "", sources: [], drops: false, sort: { key: "score", dir: -1 },
}
const MORE = ["price_min", "price_max", "area_min", "area_max", "rooms_min", "score_min", "dpe_max", "sources", "drops"] as const
// the labels' filter: a listing carrying one of those ticked, or none when « Sans label » (NO_LABEL) is
const NO_LABEL = "\u0000none"
// a filter as it was at first (lists in any order)
const same = (a: unknown, b: unknown) => JSON.stringify(Array.isArray(a) ? a.toSorted() : a) === JSON.stringify(Array.isArray(b) ? b.toSorted() : b)
const isDefault = (f: Filters, k: keyof Filters) => same(f[k], DEFAULTS[k])
const number = (s: string) => (s.trim() === "" || !Number.isFinite(+s) ? undefined : +s)

// Every listing of the search in one table: filters above, a sort on each column, a row opens the dossier, the boxes
// select rows for the actions on several at once
export function ListTab() {
  const { slug, data, types, lastVisit, marketFor, aidsFor, select, spot } = useSearch()
  const [q, setQ] = useState(""), [f, setF] = useStoredState<Filters>(`immo:${slug}:list`, DEFAULTS), [picked, setPicked] = useState<string[]>([]), labels = useLabels()
  const set = (x: Partial<Filters>) => setF(v => ({ ...v, ...x }))
  const { sort, type, floor, mine, status, hideExpired } = f
  const rows = useMemo(() => data.listings.map(l => ({
    l, score: score(l, aidsFor(l)).value as number | null, gap: badge(unitPrice(l), marketFor(l).ref?.ppm2)?.gap ?? null, days: daysOnline(l),
    offer: l.messages?.findLast(m => m.kind === "offer" && m.amount)?.amount ?? null,
  })), [data.listings, aidsFor, marketFor])
  const sources = useMemo(() => [...new Set(data.listings.flatMap(l => l.urls.map(u => u.source)).filter((x): x is string => !!x))].toSorted((a, b) => a.localeCompare(b)), [data.listings])
  const needle = q.trim().toLowerCase(), minScore = number(f.score_min)
  const range = { budget_min: number(f.price_min), budget_max: number(f.price_max), area_min: number(f.area_min), area_max: number(f.area_max), rooms_min: number(f.rooms_min), dpe_max: f.dpe_max || undefined }
  const shown = rows
    .filter(({ l, score: sc }) => l.id === spot || (!needle || [titleOf(l), l.location.address, l.location.city, ...l.urls.map(u => u.source)].some(x => x?.toLowerCase().includes(needle)))
      && (type === "all" || typeOf(l) === type) && floorOk(l, floor) && mine.includes(l.my_status ?? "none")
      && (!f.labels.length || f.labels.some(x => (x === NO_LABEL ? !l.labels?.length : !!l.labels?.includes(x))))
      && (status === "all" || (status === "online" ? l.status === "AVAILABLE" : l.status === status))
      && (!f.onlyMatching || matches(l, data.search.criteria, types)) && (!f.onlyNew || isNew(l, lastVisit)) && (!f.onlyFavorites || !!l.favorite)
      && (!hideExpired || status === "EXPIRED" || !shelved(l))
      && matches(l, range) && (minScore == null || (sc ?? -1) >= minScore) && (!f.sources.length || l.urls.some(u => u.source && f.sources.includes(u.source))) && (!f.drops || dropped(l) > 0))
    .toSorted((a, b) => {
      const col = COLUMNS.find(c => c.key === sort.key) ?? COLUMNS.find(c => c.key === "score")!, x = col.sort(a), y = col.sort(b)
      // what is unknown goes last, whatever the direction
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1
      return (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * sort.dir
    })
  // the actions take the rows ticked that the filters still show
  const chosen = shown.filter(r => picked.includes(r.l.id)).map(r => r.l), all = shown.length > 0 && chosen.length === shown.length
  const more = MORE.filter(k => !isDefault(f, k)).length, filtered = (Object.keys(DEFAULTS) as (keyof Filters)[]).some(k => k !== "sort" && !isDefault(f, k))

  useEffect(() => { if (spot) document.getElementById(`row-${spot}`)?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }) }, [spot])

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher un bien, une adresse…" aria-label="Rechercher" />
        </InputGroup>
        {types.length > 1 && (
          <Select value={type} onValueChange={v => set({ type: v as Filters["type"] })}>
            <SelectTrigger size="sm" aria-label="Type de bien"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectItem value="all">Tous les types</SelectItem>{types.map(t => <SelectItem key={t} value={t}><TypeIcon type={t} />{TYPE_PLURAL[t]}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        )}
        {types.includes("flat") && (
          <Select value={floor} onValueChange={v => set({ floor: v as Floor })}>
            <SelectTrigger size="sm" aria-label="Étage des appartements"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup>{Object.entries(FLOORS).map(([k, x]) => <SelectItem key={k} value={k}><x.icon />{x.label}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Mon statut" className="flex h-8 w-fit items-center justify-between gap-1.5 rounded-md border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50">
              {mine.length === Object.keys(MINE).length ? "Tous mes statuts" : same(mine, NOT_DROPPED) ? "Sans les écartés" : mine.length ? Object.keys(MINE).filter(k => mine.includes(k)).map(k => MINE[k]).join(", ") : "Aucun statut"}
              <ChevronDownIcon className="size-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {Object.entries(MINE).map(([k, v]) => (
              <DropdownMenuCheckboxItem key={k} checked={mine.includes(k)} onSelect={e => e.preventDefault()} onCheckedChange={on => setF(x => ({ ...x, mine: on ? [...x.mine, k] : x.mine.filter(m => m !== k) }))}>{v}</DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={mine.length === Object.keys(MINE).length} onSelect={e => e.preventDefault()} onCheckedChange={on => set({ mine: on ? Object.keys(MINE) : [] })}>Tous</DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {(labels.length > 0 || f.labels.length > 0) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Labels" className="flex h-8 w-fit max-w-64 items-center justify-between gap-1.5 rounded-md border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50">
                <TagIcon className="size-4 text-muted-foreground" />
                <span className="truncate">{f.labels.length ? f.labels.map(x => (x === NO_LABEL ? "Sans label" : x)).join(", ") : "Tous les labels"}</span>
                <ChevronDownIcon className="size-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {labels.map(x => (
                <DropdownMenuCheckboxItem key={x} checked={f.labels.includes(x)} onSelect={e => e.preventDefault()} onCheckedChange={on => setF(v => ({ ...v, labels: on ? [...v.labels, x] : v.labels.filter(y => y !== x) }))}><TagIcon />{x}</DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={f.labels.includes(NO_LABEL)} onSelect={e => e.preventDefault()} onCheckedChange={on => setF(v => ({ ...v, labels: on ? [...v.labels, NO_LABEL] : v.labels.filter(y => y !== NO_LABEL) }))}>Sans label</DropdownMenuCheckboxItem>
              {f.labels.length > 0 && <DropdownMenuItem onSelect={() => set({ labels: [] })}><RotateCcwIcon />Tous les labels</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Select value={status} onValueChange={v => set({ status: v })}>
          <SelectTrigger size="sm" aria-label="Statut de l'annonce"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup><SelectItem value="all">Toutes les annonces</SelectItem><SelectItem value="online">En ligne</SelectItem><SelectItem value="UNDER_OFFER">Sous offre</SelectItem><SelectItem value="EXPIRED">Expirées</SelectItem></SelectGroup></SelectContent>
        </Select>
        <MoreFilters f={f} set={set} sources={sources} count={more} />
        <div className="flex items-center gap-2"><Switch id="l-crit" checked={f.onlyMatching} onCheckedChange={v => set({ onlyMatching: v })} /><Label htmlFor="l-crit">Dans mes critères</Label></div>
        <div className="flex items-center gap-2"><Switch id="l-new" checked={f.onlyNew} onCheckedChange={v => set({ onlyNew: v })} /><Label htmlFor="l-new" title="Jamais ouvertes, ou modifiées depuis votre dernière visite">Nouveautés</Label></div>
        <div className="flex items-center gap-2"><Switch id="l-exp" checked={hideExpired && status !== "EXPIRED"} disabled={status === "EXPIRED"} onCheckedChange={v => set({ hideExpired: v })} /><Label htmlFor="l-exp" title="Sauf celles que vous suivez (un statut autre que « À trier »)">Masquer les expirées</Label></div>
        <div className="flex items-center gap-2"><Switch id="l-fav" checked={f.onlyFavorites} onCheckedChange={v => set({ onlyFavorites: v })} /><Label htmlFor="l-fav"><Star on className="size-3.5" />Favoris</Label></div>
        <span className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
          {filtered && <Button size="sm" variant="ghost" onClick={() => setF(x => ({ ...DEFAULTS, sort: x.sort }))}><RotateCcwIcon data-icon="inline-start" />Réinitialiser</Button>}
          {shown.length} bien{shown.length > 1 ? "s" : ""}
        </span>
      </div>
      {chosen.length > 0 && <BulkBar ls={chosen} onClear={() => setPicked([])} />}
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10 pr-0">
                <Checkbox aria-label={all ? "Tout désélectionner" : "Sélectionner les biens affichés"} checked={all ? true : chosen.length ? "indeterminate" : false} disabled={!shown.length}
                  onCheckedChange={() => setPicked(all ? [] : shown.map(r => r.l.id))} />
              </TableHead>
              {COLUMNS.map(c => {
                const on = sort.key === c.key, Icon = !on ? ArrowUpDownIcon : sort.dir === 1 ? ArrowUpIcon : ArrowDownIcon
                return (
                  <TableHead key={c.key} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={cn(c.right && "text-right", c.center && "w-16 text-center", c.wide && "hidden md:table-cell")}>
                    {/* the arrow of the sorted column only, the others' on hover: it sits on the side away from the
                        column's alignment, so the labels line up with their values */}
                    <button type="button" onClick={() => set({ sort: { key: c.key, dir: sort.key === c.key ? (-sort.dir as 1 | -1) : c.key === "score" ? -1 : 1 } })}
                      className={cn("group/sort relative inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", c.right && "flex-row-reverse", on && "text-foreground")}>
                      {c.label}<Icon className={cn("size-3.5", c.center && "absolute left-full ml-1", !on && "opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60")} />
                    </button>
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map(r => {
              const on = picked.includes(r.l.id)
              return (
                <TableRow key={r.l.id} id={`row-${r.l.id}`} data-state={on ? "selected" : undefined} onClick={() => select(r.l.id)} style={statusBand(r.l.my_status)} className={cn("cursor-pointer scroll-mt-16", spot === r.l.id && "spot bg-accent/60")}>
                  <TableCell className="pr-0" onClick={e => e.stopPropagation()}>
                    <Checkbox aria-label={`Sélectionner ${titleOf(r.l)}`} checked={on} onCheckedChange={v => setPicked(p => (v ? [...p, r.l.id] : p.filter(x => x !== r.l.id)))} />
                  </TableCell>
                  {COLUMNS.map(c => (
                    <TableCell key={c.key} className={cn(c.right && "text-right", c.center && "text-center", c.wide && "hidden md:table-cell")}>
                      {c.key === "title" ? (
                        <button type="button" onClick={e => { e.stopPropagation(); select(r.l.id) }} className="text-left focus-visible:underline focus-visible:outline-none">{c.cell(r)}</button>
                      ) : c.cell(r)}
                    </TableCell>
                  ))}
                </TableRow>
              )
            })}
            {!shown.length && <TableRow><TableCell colSpan={COLUMNS.length + 1} className="py-8 text-center text-muted-foreground">Aucun bien pour ces filtres.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}

// « Filtres »: what the toolbar has no room for, its count on the button
function MoreFilters({ f, set, sources, count }: { f: Filters; set: (x: Partial<Filters>) => void; sources: string[]; count: number }) {
  const range = (label: string, min: "price_min" | "area_min", max: "price_max" | "area_max", unit: string) => (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <span className="flex items-center gap-2">
        {([[min, "min"], [max, "max"]] as const).map(([k, p]) => (
          <InputGroup key={k}>
            <InputGroupInput inputMode="numeric" aria-label={`${label} ${p}`} placeholder={p} value={f[k]} onChange={e => set({ [k]: e.target.value.replace(/[^\d]/g, "") })} />
            <InputGroupAddon align="inline-end"><InputGroupText>{unit}</InputGroupText></InputGroupAddon>
          </InputGroup>
        ))}
      </span>
    </Field>
  )
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline"><SlidersHorizontalIcon data-icon="inline-start" />Filtres{count > 0 && <Badge className="h-4 min-w-4 px-1 tabular-nums">{count}</Badge>}</Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <PopoverHeader><PopoverTitle>Filtres</PopoverTitle></PopoverHeader>
        <FieldGroup className="gap-4">
          {range("Prix", "price_min", "price_max", "€")}
          {range("Surface", "area_min", "area_max", "m²")}
          <span className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="f-rooms">Pièces min.</FieldLabel>
              <InputGroup><InputGroupInput id="f-rooms" inputMode="numeric" placeholder="—" value={f.rooms_min} onChange={e => set({ rooms_min: e.target.value.replace(/[^\d]/g, "") })} /></InputGroup>
            </Field>
            <Field>
              <FieldLabel htmlFor="f-score">Score min.</FieldLabel>
              <InputGroup><InputGroupInput id="f-score" inputMode="numeric" placeholder="sur 100" value={f.score_min} onChange={e => set({ score_min: e.target.value.replace(/[^\d]/g, "").slice(0, 3) })} /></InputGroup>
            </Field>
          </span>
          <Field>
            <FieldLabel>DPE au plus</FieldLabel>
            <Select value={f.dpe_max || "all"} onValueChange={v => set({ dpe_max: v === "all" ? "" : v })}>
              <SelectTrigger size="sm" aria-label="DPE au plus"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="all">Tous les DPE</SelectItem>{[..."ABCDEFG"].map(x => <SelectItem key={x} value={x}><Dpe value={x} />{x === "A" ? "A seulement" : `A à ${x}`}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          </Field>
          {sources.length > 1 && (
            <Field>
              <FieldLabel>Portails</FieldLabel>
              <span className="grid max-h-32 grid-cols-2 gap-x-3 gap-y-1.5 overflow-y-auto">
                {sources.map(x => (
                  <Label key={x} className="font-normal"><Checkbox checked={f.sources.includes(x)} onCheckedChange={on => set({ sources: on ? [...f.sources, x] : f.sources.filter(y => y !== x) })} />{x}</Label>
                ))}
              </span>
            </Field>
          )}
          <div className="flex items-center gap-2"><Switch id="f-drops" checked={f.drops} onCheckedChange={v => set({ drops: v })} /><Label htmlFor="f-drops"><TrendingDownIcon className="size-3.5" />Avec une baisse de prix</Label></div>
          {count > 0 && <Button size="sm" variant="ghost" className="self-start" onClick={() => set(Object.fromEntries(MORE.map(k => [k, DEFAULTS[k]])))}><RotateCcwIcon data-icon="inline-start" />Effacer ces filtres</Button>}
        </FieldGroup>
      </PopoverContent>
    </Popover>
  )
}

// The actions on the rows ticked: the user's own data, changed at once (statuses, stars, « Nouveau »), the comparison,
// and a paid reading of their adverts again (the run dialog asks first)
function BulkBar({ ls, onClear }: { ls: Listing[]; onClear: () => void }) {
  const { slug, data, state, reload, toggleCompare, clearCompare } = useSearch(), run = useRun(), [busy, setBusy] = useState(false)
  const n = ls.length, s = n > 1 ? "s" : "", fetched = ls.filter(l => l.se_id)
  // ticked in the picker: the labels every listing of the selection carries; one picked goes on all, or off all
  const common = (ls[0]?.labels ?? []).filter(x => ls.every(l => l.labels?.includes(x)))
  const label = (x: string, on: boolean) => apply(l => ({ labels: on ? [...new Set([...(l.labels ?? []), x])] : (l.labels ?? []).filter(y => y !== x) }), `${n} bien${s} : label « ${x} » ${on ? "ajouté" : "retiré"}`)
  async function apply(body: { my_status?: Status; favorite?: boolean; seen?: boolean } | ((l: Listing) => { labels: string[] }), done: string) {
    setBusy(true)
    try {
      await Promise.all(ls.map(l => api.listing(slug, l.id, typeof body === "function" ? body(l) : body)))
      toast.success(done)
    } catch (e) { toast.error("Modification interrompue", { description: (e as Error).message }) } finally { await reload(); setBusy(false) }
  }
  return (
    <div role="toolbar" aria-label="Actions sur la sélection" className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/50 px-3 py-2">
      <span className="mr-1 text-sm font-medium tabular-nums">{n} sélectionné{s}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={busy}><TagIcon data-icon="inline-start" />Mon statut<ChevronDownIcon data-icon="inline-end" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {Object.entries(MINE).map(([k, v]) => (
            <DropdownMenuItem key={k} onSelect={() => apply({ my_status: k === "none" ? null : (k as Status) }, `${n} bien${s} : ${v}`)}><StatusDot status={k === "none" ? null : (k as Status)} />{v}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <LabelPicker chosen={common} onPick={label}>
        <Button size="sm" variant="outline" disabled={busy}><TagsIcon data-icon="inline-start" />Labels<ChevronDownIcon data-icon="inline-end" /></Button>
      </LabelPicker>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => apply({ favorite: true }, `${n} bien${s} en favoris`)}><Star on className="size-3.5" />Favoris</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => apply({ favorite: false }, `${n} bien${s} retiré${s} des favoris`)}><StarOffIcon data-icon="inline-start" />Retirer des favoris</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => apply({ seen: true }, `${n} bien${s} marqué${s} comme vu${s}`)}><EyeIcon data-icon="inline-start" />Marquer comme vu{s}</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => apply({ seen: false }, `${n} bien${s} de nouveau « Nouveau »`)}><EyeOffIcon data-icon="inline-start" />Marquer non vu{s}</Button>
      <Button size="sm" variant="outline" disabled={busy || n < 2 || n > 4} title="De 2 à 4 biens" onClick={() => { clearCompare(); ls.forEach(l => toggleCompare(l.id)); toast.success(`${n} biens dans « Comparer »`) }}><ScaleIcon data-icon="inline-start" />Comparer</Button>
      {state.stream_estate && data.search.mode === "stream-estate" && fetched.length > 0 && (
        <Button size="sm" variant="outline" disabled={busy} title="Photos, prix et annonces des portails lus à nouveau sur l'API ; celles qui ont disparu expirent"
          onClick={() => run({ cmd: "reread", slug, args: { id: fetched.map(l => l.id).join(",") }, label: `Relecture de ${fetched.length} annonce${fetched.length > 1 ? "s" : ""} (API)` })}>
          <RefreshCwIcon data-icon="inline-start" />Relire sur l'API<CreditBadge cost={{ route: "GET /documents/properties/{id}", calls: fetched.length }} />
        </Button>
      )}
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}><XIcon data-icon="inline-start" />Désélectionner</Button>
    </div>
  )
}
