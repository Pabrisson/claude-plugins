import { score } from "@engine/decide.js"
import { badge, daysOnline, isHome, matches, typeOf, unitPrice } from "@engine/market.js"
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, SearchIcon } from "lucide-react"
import { useMemo, useState } from "react"

import { Dpe } from "@/components/dpe"
import { Gap } from "@/components/ruler"
import { StatusBadge, statusBand } from "@/components/status"
import { TypeIcon } from "@/components/type-icon"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { Listing, PropertyType } from "@/lib/api"
import { eur, num, SALE_STATUS, SOURCE_LABEL, STATUS_LABEL, titleOf, TYPE_PLURAL } from "@/lib/format"
import { isNew } from "@/lib/rank"
import { useSearch } from "@/lib/store"
import { cn } from "@/lib/utils"

type Row = { l: Listing; score: number | null; gap: number | null; days: number | null; offer: number | null }
// each column: its header, what it sorts on, its cell; `wide` ones only show from a tablet up
const COLUMNS: { key: string; label: string; sort: (r: Row) => number | string | null; cell: (r: Row) => React.ReactNode; right?: boolean; wide?: boolean }[] = [
  { key: "type", label: "Type", sort: r => typeOf(r.l), cell: r => <TypeIcon type={r.l.property_type} className="size-4 text-muted-foreground" /> },
  { key: "title", label: "Bien", sort: r => titleOf(r.l), cell: r => <span className="flex flex-col"><span className="max-w-64 truncate font-medium">{titleOf(r.l)}</span><span className="text-xs text-muted-foreground">{r.l.urls.map(u => u.source).filter(Boolean).join(", ") || SOURCE_LABEL[r.l.source]}</span></span> },
  { key: "price", label: "Prix", right: true, sort: r => r.l.price, cell: r => <b>{eur(r.l.price)}</b> },
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
function GapCell({ l }: { l: Listing }) {
  const { marketFor } = useSearch()
  return <Gap ppm2={unitPrice(l)} refPpm2={marketFor(l).ref?.ppm2} />
}

// Every listing of the search in one table: filters above, a sort on each column, a row opens the dossier
export function ListTab() {
  const { data, types, lastVisit, marketFor, aidsFor, select } = useSearch()
  const [q, setQ] = useState(""), [type, setType] = useState<"all" | PropertyType>("all"), [mine, setMine] = useState("all"), [status, setStatus] = useState("all")
  const [onlyMatching, setOnlyMatching] = useState(false), [onlyNew, setOnlyNew] = useState(false)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: "score", dir: -1 })
  const rows = useMemo(() => data.listings.map(l => ({
    l, score: score(l, aidsFor(l)).value as number | null, gap: badge(unitPrice(l), marketFor(l).ref?.ppm2)?.gap ?? null, days: daysOnline(l),
    offer: l.messages?.findLast(m => m.kind === "offer" && m.amount)?.amount ?? null,
  })), [data.listings, aidsFor, marketFor])
  const needle = q.trim().toLowerCase()
  const shown = rows
    .filter(({ l }) => (!needle || [titleOf(l), l.location.address, l.location.city, ...l.urls.map(u => u.source)].some(x => x?.toLowerCase().includes(needle)))
      && (type === "all" || typeOf(l) === type) && (mine === "all" || (l.my_status ?? "none") === mine)
      && (status === "all" || (status === "online" ? l.status === "AVAILABLE" : l.status === status))
      && (!onlyMatching || matches(l, data.search.criteria, types)) && (!onlyNew || isNew(l, lastVisit)))
    .toSorted((a, b) => {
      const col = COLUMNS.find(c => c.key === sort.key)!, x = col.sort(a), y = col.sort(b)
      // what is unknown goes last, whatever the direction
      if (x == null || y == null) return x == null ? (y == null ? 0 : 1) : -1
      return (typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number)) * sort.dir
    })

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
        <Select value={mine} onValueChange={setMine}>
          <SelectTrigger size="sm" aria-label="Mon statut"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup><SelectItem value="all">Tous mes statuts</SelectItem><SelectItem value="none">À trier</SelectItem>{Object.entries(STATUS_LABEL).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger size="sm" aria-label="Statut de l'annonce"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup><SelectItem value="all">Toutes les annonces</SelectItem><SelectItem value="online">En ligne</SelectItem><SelectItem value="UNDER_OFFER">Sous offre</SelectItem><SelectItem value="EXPIRED">Expirées</SelectItem></SelectGroup></SelectContent>
        </Select>
        <div className="flex items-center gap-2"><Switch id="l-crit" checked={onlyMatching} onCheckedChange={setOnlyMatching} /><Label htmlFor="l-crit">Dans mes critères</Label></div>
        <div className="flex items-center gap-2"><Switch id="l-new" checked={onlyNew} onCheckedChange={setOnlyNew} /><Label htmlFor="l-new">Nouveautés</Label></div>
        <span className="ml-auto text-sm text-muted-foreground">{shown.length} bien{shown.length > 1 ? "s" : ""}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map(c => {
                const on = sort.key === c.key, Icon = !on ? ArrowUpDownIcon : sort.dir === 1 ? ArrowUpIcon : ArrowDownIcon
                return (
                  <TableHead key={c.key} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={cn(c.right && "text-right", c.wide && "hidden md:table-cell")}>
                    <button type="button" onClick={() => setSort(s => ({ key: c.key, dir: s.key === c.key ? (-s.dir as 1 | -1) : c.key === "score" ? -1 : 1 }))}
                      className={cn("inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", c.right && "flex-row-reverse", on && "text-foreground")}>
                      {c.label}<Icon className={cn("size-3.5", !on && "opacity-40")} />
                    </button>
                  </TableHead>
                )
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map(r => (
              <TableRow key={r.l.id} onClick={() => select(r.l.id)} style={statusBand(r.l.my_status)} className="cursor-pointer">
                {COLUMNS.map(c => (
                  <TableCell key={c.key} className={cn(c.right && "text-right", c.wide && "hidden md:table-cell")}>
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
