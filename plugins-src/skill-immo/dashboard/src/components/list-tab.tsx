import { score } from "@engine/decide.js"
import { badge, daysOnline, isHome, matches, typeOf, unitPrice } from "@engine/market.js"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, ChevronDownIcon, SearchIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import { Dpe } from "@/components/dpe"
import { Star } from "@/components/favorite"
import { Origin } from "@/components/origin"
import { Gap } from "@/components/ruler"
import { StatusBadge, statusBand } from "@/components/status"
import { TypeIcon } from "@/components/type-icon"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Listing, PropertyType } from "@/lib/api"
import { eur, num, pct, SALE_STATUS, STATUS_LABEL, titleOf, TYPE_PLURAL } from "@/lib/format"
import { isNew, shelved } from "@/lib/rank"
import { useSearch } from "@/lib/store"
import { cn } from "@/lib/utils"

type Row = { l: Listing; score: number | null; gap: number | null; days: number | null; offer: number | null }
// each column: its header, what it sorts on, its cell; `wide` ones only show from a tablet up
const COLUMNS: { key: string; label: string; sort: (r: Row) => number | string | null; cell: (r: Row) => React.ReactNode; right?: boolean; center?: boolean; wide?: boolean }[] = [
  { key: "type", label: "Type", center: true, sort: r => typeOf(r.l), cell: r => <TypeIcon type={r.l.property_type} className="mx-auto size-4 text-muted-foreground" /> },
  { key: "title", label: "Bien", sort: r => titleOf(r.l), cell: r => <span className="flex flex-col"><span className="flex max-w-64 items-center gap-1 font-medium">{r.l.favorite && <Star on className="size-3.5 shrink-0" />}<span className="truncate">{titleOf(r.l)}</span></span><span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Origin l={r.l} />{[...new Set(r.l.urls.map(u => u.source).filter(Boolean))].join(", ")}</span></span> },
  { key: "price", label: "Prix", right: true, sort: r => r.l.price, cell: r => <PriceCell l={r.l} /> },
  { key: "area", label: "Surface", right: true, sort: r => r.l.area ?? r.l.land_area ?? null, cell: r => (r.l.area ? `${num(r.l.area)} m²` : r.l.land_area ? `${num(r.l.land_area)} m² de terrain` : "—") },
  { key: "ppm2", label: "Prix unitaire", right: true, wide: true, sort: r => unitPrice(r.l), cell: r => num(unitPrice(r.l)) },
  { key: "gap", label: "Écart", right: true, sort: r => r.gap, cell: r => <GapCell l={r.l} /> },
  { key: "rooms", label: "Pièces", right: true, wide: true, sort: r => r.l.rooms, cell: r => r.l.rooms ?? "—" },
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

// Every listing of the search in one table: filters above, a sort on each column, a row opens the dossier
export function ListTab() {
  const { data, types, lastVisit, marketFor, aidsFor, select, spot } = useSearch()
  const [q, setQ] = useState(""), [type, setType] = useState<"all" | PropertyType>("all"), [mine, setMine] = useState<string[]>(NOT_DROPPED), [status, setStatus] = useState("all")
  const [onlyMatching, setOnlyMatching] = useState(false), [onlyNew, setOnlyNew] = useState(false), [onlyFavorites, setOnlyFavorites] = useState(false), [hideExpired, setHideExpired] = useState(true)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "score", dir: -1 })
  const rows = useMemo(() => data.listings.map(l => ({
    l, score: score(l, aidsFor(l)).value as number | null, gap: badge(unitPrice(l), marketFor(l).ref?.ppm2)?.gap ?? null, days: daysOnline(l),
    offer: l.messages?.findLast(m => m.kind === "offer" && m.amount)?.amount ?? null,
  })), [data.listings, aidsFor, marketFor])
  const needle = q.trim().toLowerCase()
  const shown = rows
    .filter(({ l }) => l.id === spot || (!needle || [titleOf(l), l.location.address, l.location.city, ...l.urls.map(u => u.source)].some(x => x?.toLowerCase().includes(needle)))
      && (type === "all" || typeOf(l) === type) && mine.includes(l.my_status ?? "none")
      && (status === "all" || (status === "online" ? l.status === "AVAILABLE" : l.status === status))
      && (!onlyMatching || matches(l, data.search.criteria, types)) && (!onlyNew || isNew(l, lastVisit)) && (!onlyFavorites || !!l.favorite)
      && (!hideExpired || status === "EXPIRED" || !shelved(l)))
    .toSorted((a, b) => {
      const col = COLUMNS.find(c => c.key === sort.key)!, x = col.sort(a), y = col.sort(b)
      // what is unknown goes last, whatever the direction
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1
      return (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * sort.dir
    })

  useEffect(() => { if (spot) document.getElementById(`row-${spot}`)?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }) }, [spot])

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <InputGroup className="w-full sm:w-64">
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher un bien, une adresse…" aria-label="Rechercher" />
        </InputGroup>
        {types.length > 1 && (
          <Select value={type} onValueChange={v => setType(v as typeof type)}>
            <SelectTrigger size="sm" aria-label="Type de bien"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectItem value="all">Tous les types</SelectItem>{types.map(t => <SelectItem key={t} value={t}><TypeIcon type={t} />{TYPE_PLURAL[t]}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Mon statut" className="flex h-8 w-fit items-center justify-between gap-1.5 rounded-md border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50">
              {mine.length === Object.keys(MINE).length ? "Tous mes statuts" : mine.length === NOT_DROPPED.length && !mine.includes("dropped") ? "Sans les écartés" : mine.length ? mine.map(k => MINE[k]).join(", ") : "Aucun statut"}
              <ChevronDownIcon className="size-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {Object.entries(MINE).map(([k, v]) => (
              <DropdownMenuCheckboxItem key={k} checked={mine.includes(k)} onSelect={e => e.preventDefault()} onCheckedChange={on => setMine(m => (on ? [...m, k] : m.filter(x => x !== k)))}>{v}</DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={mine.length === Object.keys(MINE).length} onSelect={e => e.preventDefault()} onCheckedChange={on => setMine(on ? Object.keys(MINE) : [])}>Tous</DropdownMenuCheckboxItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" aria-label="Statut de l'annonce"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup><SelectItem value="all">Toutes les annonces</SelectItem><SelectItem value="online">En ligne</SelectItem><SelectItem value="UNDER_OFFER">Sous offre</SelectItem><SelectItem value="EXPIRED">Expirées</SelectItem></SelectGroup></SelectContent>
        </Select>
        <div className="flex items-center gap-2"><Switch id="l-crit" checked={onlyMatching} onCheckedChange={setOnlyMatching} /><Label htmlFor="l-crit">Dans mes critères</Label></div>
        <div className="flex items-center gap-2"><Switch id="l-new" checked={onlyNew} onCheckedChange={setOnlyNew} /><Label htmlFor="l-new">Nouveautés</Label></div>
        <div className="flex items-center gap-2"><Switch id="l-exp" checked={hideExpired && status !== "EXPIRED"} disabled={status === "EXPIRED"} onCheckedChange={setHideExpired} /><Label htmlFor="l-exp" title="Sauf celles que vous suivez (un statut autre que « À trier »)">Masquer les expirées</Label></div>
        <div className="flex items-center gap-2"><Switch id="l-fav" checked={onlyFavorites} onCheckedChange={setOnlyFavorites} /><Label htmlFor="l-fav"><Star on className="size-3.5" />Favoris</Label></div>
        <span className="ml-auto text-sm text-muted-foreground">{shown.length} bien{shown.length > 1 ? "s" : ""}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map(c => {
                const on = sort.key === c.key, Icon = !on ? ArrowUpDownIcon : sort.dir === 1 ? ArrowUpIcon : ArrowDownIcon
                return (
                  <TableHead key={c.key} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={cn(c.right && "text-right", c.center && "w-16 text-center", c.wide && "hidden md:table-cell")}>
                    {/* the arrow of the sorted column only, the others' on hover: it sits on the side away from the
                        column's alignment, so the labels line up with their values */}
                    <button type="button" onClick={() => setSort(s => ({ key: c.key, dir: s.key === c.key ? (-s.dir as 1 | -1) : c.key === "score" ? -1 : 1 }))}
                      className={cn("group/sort relative inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", c.right && "flex-row-reverse", on && "text-foreground")}>
                      {c.label}<Icon className={cn("size-3.5", c.center && "absolute left-full ml-1", !on && "opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60")} />
                    </button>
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map(r => (
              <TableRow key={r.l.id} id={`row-${r.l.id}`} onClick={() => select(r.l.id)} style={statusBand(r.l.my_status)} className={cn("cursor-pointer scroll-mt-16", spot === r.l.id && "spot bg-accent/60")}>
                {COLUMNS.map(c => (
                  <TableCell key={c.key} className={cn(c.right && "text-right", c.center && "text-center", c.wide && "hidden md:table-cell")}>
                    {c.key === "title" ? (
                      <button type="button" onClick={e => { e.stopPropagation(); select(r.l.id) }} className="text-left focus-visible:underline focus-visible:outline-none">{c.cell(r)}</button>
                    ) : c.cell(r)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {!shown.length && <TableRow><TableCell colSpan={COLUMNS.length} className="py-8 text-center text-muted-foreground">Aucun bien pour ces filtres.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
