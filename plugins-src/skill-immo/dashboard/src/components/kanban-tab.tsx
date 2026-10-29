import { daysOnline, isHome, matches, typeOf, unitPrice } from "@engine/market.js"
import { ChevronLeftIcon, ChevronRightIcon, EllipsisIcon, MailIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { Dpe } from "@/components/dpe"
import { Gap } from "@/components/ruler"
import { FavoriteButton } from "@/components/favorite"
import { Origin } from "@/components/origin"
import { StatusDot, statusTint, tint } from "@/components/status"
import { TypeIcon } from "@/components/type-icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { api, type Listing, type PropertyType, type Status } from "@/lib/api"
import { eur, SALE_STATUS, titleOf, TYPE_PLURAL } from "@/lib/format"
import { isNew, shelved, SORTS, useRanked, type Sort } from "@/lib/rank"
import { useSearch } from "@/lib/store"
import { cn } from "@/lib/utils"

const COLUMNS: { status: Status; label: string }[] = [
  { status: null, label: "À trier" }, { status: "to_visit", label: "À visiter" }, { status: "visited", label: "Visité" },
  { status: "offer", label: "Offre faite" }, { status: "dropped", label: "Écarté" },
]
// The listings as a board, one column per status of the user: a card moves by drag and drop, or by its menu (keyboard,
// touch). "Écarté" stays folded until opened, so the columns that matter keep the room.
export function KanbanTab() {
  const { slug, data, types, lastVisit, reload, select, spot } = useSearch()
  const [type, setType] = useState<"all" | PropertyType>("all"), [onlyMatching, setOnlyMatching] = useState(false), [onlyNew, setOnlyNew] = useState(false)
  const [sort, setSort] = useState<Sort>("score"), [dropOpen, setDropOpen] = useState(false), [over, setOver] = useState<string | null>(null)
  // an expired listing stays on the board only once the user has given it a status
  const shown = data.listings.filter(l => l.id === spot || (!shelved(l) && (type === "all" || typeOf(l) === type)
    && (!onlyMatching || matches(l, data.search.criteria, types)) && (!onlyNew || isNew(l, lastVisit))))
  // the card the dossier sent here (« Voir »): « Écarté » unfolds for it, then it comes in view
  const [seen, setSeen] = useState<string | null>(null)
  if (spot !== seen) {
    setSeen(spot)
    if (data.listings.find(l => l.id === spot)?.my_status === "dropped") setDropOpen(true)
  }
  useEffect(() => { if (spot) document.getElementById(`card-${spot}`)?.scrollIntoView({ block: "center", inline: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }) }, [spot, dropOpen])
  const ranked = useRanked(shown, sort)

  async function move(id: string, status: Status) {
    await api.listing(slug, id, { my_status: status })
    await reload()
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
        {types.length > 1 && (
          <Select value={type} onValueChange={v => setType(v as typeof type)}>
            <SelectTrigger size="sm" aria-label="Type de bien"><SelectValue /></SelectTrigger>
            <SelectContent><SelectGroup><SelectItem value="all">Tous les types</SelectItem>{types.map(t => <SelectItem key={t} value={t}><TypeIcon type={t} />{TYPE_PLURAL[t]}</SelectItem>)}</SelectGroup></SelectContent>
          </Select>
        )}
        <div className="flex items-center gap-2"><Switch id="k-crit" checked={onlyMatching} onCheckedChange={setOnlyMatching} /><Label htmlFor="k-crit">Dans mes critères</Label></div>
        <div className="flex items-center gap-2"><Switch id="k-new" checked={onlyNew} onCheckedChange={setOnlyNew} /><Label htmlFor="k-new">Nouveautés</Label></div>
        <span className="flex-1" />
        <Select value={sort} onValueChange={v => setSort(v as Sort)}>
          <SelectTrigger size="sm" aria-label="Trier"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{Object.entries(SORTS).map(([k, v]) => <SelectItem key={k} value={k}>Trier : {v}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </div>
      <div className="flex min-h-0 flex-1 snap-x scroll-px-4 gap-3 overflow-x-auto p-4">
        {COLUMNS.map(c => {
          const key = c.status ?? "none", items = ranked.filter(x => (x.l.my_status ?? null) === c.status), folded = c.status === "dropped" && !dropOpen
          const drop = {
            onDragOver: (e: React.DragEvent) => { e.preventDefault(); setOver(key) },
            onDragLeave: () => setOver(o => (o === key ? null : o)),
            onDrop: (e: React.DragEvent) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/plain"); if (id) move(id, c.status) },
          }
          if (folded)
            return (
              <button key={key} type="button" {...drop} onClick={() => setDropOpen(true)} aria-label={`${c.label} : ${items.length} biens, déplier la colonne`}
                className={cn("flex w-12 flex-none snap-start flex-col items-center gap-3 rounded-xl border bg-muted/40 py-3 text-sm text-muted-foreground hover:bg-muted", over === key && "border-ring bg-accent")}>
                <ChevronLeftIcon className="size-4" />
                <StatusDot status={c.status} /><span className="font-medium [writing-mode:vertical-rl]">{c.label}</span>
                <Badge variant="secondary">{items.length}</Badge>
              </button>
            )
          return (
            <section key={key} {...drop} aria-label={c.label}
              className={cn("flex w-[min(19rem,85vw)] flex-none snap-start flex-col rounded-xl border bg-muted/40", over === key && "border-ring bg-accent/60")}>
              <header className="flex items-center justify-between gap-2 px-3 py-2.5">
                <h3 className="flex items-center gap-2 text-sm font-semibold"><StatusDot status={c.status} />{c.label} <span className="ml-1 font-normal text-muted-foreground">{items.length}</span></h3>
                {c.status === "dropped" && <Button variant="ghost" size="icon-xs" aria-label="Replier la colonne" onClick={() => setDropOpen(false)}><ChevronRightIcon /></Button>}
              </header>
              <div className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
                {items.map(({ l, score: sc }) => (
                  <KanbanCard key={l.id} l={l} score={sc} fresh={isNew(l, lastVisit)} spotted={spot === l.id} onOpen={() => select(l.id)} onMove={s => move(l.id, s)} />
                ))}
                {!items.length && <p className="px-1 py-4 text-center text-xs text-muted-foreground">Glissez un bien ici</p>}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

function KanbanCard({ l, score, fresh, spotted, onOpen, onMove }: { l: Listing; score: number | null; fresh: boolean; spotted: boolean; onOpen: () => void; onMove: (s: Status) => void }) {
  const { marketFor } = useSearch()
  const days = daysOnline(l), messages = l.messages?.length ?? 0, offer = l.messages?.findLast(m => m.kind === "offer" && m.amount)
  return (
    <div id={`card-${l.id}`} draggable style={statusTint(l.my_status)} onDragStart={e => { e.dataTransfer.setData("text/plain", l.id); e.dataTransfer.effectAllowed = "move" }}
      className={cn("group relative flex cursor-grab flex-col gap-1.5 rounded-lg border p-2.5 text-sm shadow-xs hover:border-ring hover:shadow-md active:cursor-grabbing", tint(l.my_status), spotted && "spot border-ring")}>
      <button type="button" onClick={onOpen} className="flex flex-col gap-1 text-left after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:ring-3 focus-visible:after:ring-ring/50">
        <span className="flex items-center gap-1.5 pr-14">
          <TypeIcon type={l.property_type} className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-bold">{eur(l.price)}</span>
          {score != null && <span className="ml-auto rounded-md bg-muted px-1.5 text-xs font-semibold tabular-nums" title="Score sur 100">{score}</span>}
        </span>
        <span className="truncate text-xs text-muted-foreground">{titleOf(l)}</span>
      </button>
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <Gap ppm2={unitPrice(l)} refPpm2={marketFor(l).ref?.ppm2} />
        {isHome(typeOf(l)) && <Dpe value={l.dpe?.energy} />}
        {days != null && <span className="text-muted-foreground">{days} j</span>}
        {fresh && <Badge className="h-4 px-1.5 text-[10px]">Nouveau</Badge>}
        {l.status !== "AVAILABLE" && <Badge variant="outline" className="h-4 px-1.5 text-[10px]">{SALE_STATUS[l.status] ?? l.status}</Badge>}
        <Origin l={l} />
        {messages > 0 && <span className="flex items-center gap-1 text-muted-foreground" title={`${messages} message${messages > 1 ? "s" : ""}`}><MailIcon className="size-3.5" />{messages}</span>}
        {offer && <span className="font-medium">offre {eur(offer.amount)}</span>}
      </div>
      <FavoriteButton l={l} className="absolute top-1.5 right-8" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-xs" className="absolute top-1.5 right-1.5 z-10" aria-label="Déplacer vers…"><EllipsisIcon /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Déplacer vers…</DropdownMenuLabel>
          {COLUMNS.filter(c => c.status !== (l.my_status ?? null)).map(c => <DropdownMenuItem key={c.status ?? "none"} onSelect={() => onMove(c.status)}><StatusDot status={c.status} />{c.label}</DropdownMenuItem>)}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
