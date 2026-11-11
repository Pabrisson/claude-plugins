import { daysOnline, isHome, matches, typeOf, unitPrice } from "@engine/market.js"
import { MailIcon, TagIcon, TrendingDownIcon } from "lucide-react"
import { useEffect, useState } from "react"

import { Dpe } from "@/components/dpe"
import { FavoriteButton } from "@/components/favorite"
import { LabelChip, useLabels } from "@/components/labels"
import { Origin } from "@/components/origin"
import { photosOf } from "@/components/photos"
import { Gap, Ruler } from "@/components/ruler"
import { NewBadge, StatusBadge, statusTint, tint } from "@/components/status"
import { TypeIcon } from "@/components/type-icon"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Listing, PropertyType } from "@/lib/api"
import { date, eur, num, perUnit, SALE_STATUS, TYPE_PLURAL, UNIT } from "@/lib/format"
import { floorOk, isNew, shelved, SORTS, unseen, useRanked, type Floor, type Sort } from "@/lib/rank"
import { useSearch } from "@/lib/store"
import { cn } from "@/lib/utils"

const FILTERS = { online: "En ligne", new: "Nouvelles", followed: "Suivies", favorites: "Favoris", dropped: "Écartées", all: "Toutes" } as const
const SCOPE: Record<string, string> = { recent: "zone, 2 ans", zone: "zone, 5 ans", commune: "commune, 5 ans" }

// the sold market of one type: its median unit price, its quartiles and the listings on its ruler
function MarketCard({ type, listings }: { type: PropertyType; listings: Listing[] }) {
  const { data, marketOf } = useSearch()
  const { ref, stats } = marketOf(type)
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Prix vendu{ref ? `, ${SCOPE[ref.scope]}` : ""}</CardTitle>
        <CardDescription>{ref ? `${ref.count} ventes DVF` : data.market.alsace_moselle ? "Pas de DVF en Alsace-Moselle" : "Pas assez de ventes dans la commune"}</CardDescription>
      </CardHeader>
      {ref && (
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-3xl font-bold tracking-tight">{num(ref.ppm2)}<span className="ml-1 text-base font-semibold">{UNIT[type]}</span></span>
            {stats && <span className="text-xs text-muted-foreground">{perUnit(stats.q1, type)} – {perUnit(stats.q3, type)}</span>}
          </div>
          {stats && <Ruler stats={stats} ticks={listings.filter(l => typeOf(l) === type).map(l => ({ id: l.id, ppm2: unitPrice(l) }))} />}
        </CardContent>
      )}
    </Card>
  )
}

// several types: one compact card, a line and a ruler for each
function MarketsCard({ listings }: { listings: Listing[] }) {
  const { types, marketOf } = useSearch()
  return (
    <Card size="sm">
      <CardHeader><CardTitle>Prix vendu</CardTitle><CardDescription>Médiane des ventes DVF de chaque type, et leurs quartiles</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-3">
        {types.map(t => {
          const { ref, stats } = marketOf(t)
          return (
            <div key={t} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 font-medium"><TypeIcon type={t} className="size-4 text-muted-foreground" />{TYPE_PLURAL[t]}</span>
                {ref ? <span className="text-right"><b className="text-base">{num(ref.ppm2)}</b> {UNIT[t]} <span className="text-xs text-muted-foreground">· {ref.count} ventes, {SCOPE[ref.scope]}</span></span> : <span className="text-xs text-muted-foreground">pas assez de ventes</span>}
              </div>
              {stats && <Ruler stats={stats} ticks={listings.filter(l => typeOf(l) === t).map(l => ({ id: l.id, ppm2: unitPrice(l) }))} />}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// `shownTypes`: the types the listings' map shows, the cards too (from two types on); `floor`: the map's floor filter
export function ListingList({ className, shownTypes, floor }: { className?: string; shownTypes: string[]; floor: Floor }) {
  const { data, types, lastVisit, selected, select, spot } = useSearch()
  const [sort, setSort] = useState<Sort>("score")
  // one of FILTERS, or « label:<name> » (the listings carrying it); a label no listing carries any more goes back to « En ligne »
  const labels = useLabels(), [picked, setFilter] = useState<string>("online")
  const filter = picked.startsWith("label:") && !labels.includes(picked.slice(6)) ? "online" : picked
  // an expired listing waiting to be sorted never shows here; one the user follows does, with its « Expiré » badge
  const kept = data.listings.filter(l => l.id === spot || !shelved(l) && (types.length < 2 || shownTypes.includes(typeOf(l))) && floorOk(l, floor) && (filter === "all" || (filter.startsWith("label:") ? !!l.labels?.includes(filter.slice(6)) : filter === "online" ? l.my_status !== "dropped" && matches(l, data.search.criteria, types)
    : filter === "new" ? isNew(l, lastVisit) : filter === "followed" ? !!l.my_status && l.my_status !== "dropped" : filter === "favorites" ? !!l.favorite : l.my_status === "dropped")))
  const shown = useRanked(kept, sort)
  useEffect(() => { if (spot) document.getElementById(`listing-${spot}`)?.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }) }, [spot])

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {types.length === 1 ? <MarketCard type={types[0]} listings={kept} /> : <MarketsCard listings={kept} />}
      <div className="flex items-center justify-between gap-2">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger size="sm" aria-label="Filtrer" className="max-w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup>{Object.entries(FILTERS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectGroup>
            {labels.length > 0 && (
              <>
                <SelectSeparator />
                <SelectGroup><SelectLabel>Labels</SelectLabel>{labels.map(x => <SelectItem key={x} value={`label:${x}`}><TagIcon />{x}</SelectItem>)}</SelectGroup>
              </>
            )}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{shown.length} annonce{shown.length > 1 ? "s" : ""}</span>
        <Select value={sort} onValueChange={v => setSort(v as Sort)}>
          <SelectTrigger size="sm" aria-label="Trier"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{Object.entries(SORTS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </div>
      {!shown.length && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>{data.listings.length ? "Aucune annonce pour ce filtre" : "Pas encore d'annonce"}</EmptyTitle>
            <EmptyDescription>
              {data.listings.length ? "Changez de filtre pour voir les autres." : data.search.mode === "stream-estate" ? "Récupérez les annonces de la zone avec le bouton « Annonces »." : "Demandez à l'agent d'en chercher, ou ajoutez une annonce par son lien ou son texte."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {shown.map(({ l, score }) => <ListingCard key={l.id} l={l} score={score} active={selected === l.id || spot === l.id} fresh={unseen(l)} onOpen={() => select(l.id)} />)}
    </div>
  )
}

// A listing by levels: the photo carries the star, « Nouveau » and the last drop; then the price and its score, what it
// is, its price against the sold market, the chips (my status, the sale's, my labels); a quiet footer says where it comes
// from, its messages and how long it has been online
function ListingCard({ l, score, active, fresh, onOpen }: { l: Listing; score: number | null; active: boolean; fresh: boolean; onOpen: () => void }) {
  const { slug, marketFor } = useSearch()
  const { ref, stats } = marketFor(l), t = typeOf(l) as PropertyType, photo = photosOf(slug, l)[0]?.src
  // the last price change, the portal's or one this search saw itself (the only ones in Classic mode)
  const seen = (l.changes ?? []).filter(c => c.kind === "price_drop" || c.kind === "price_rise").map(c => ({ date: c.date, from: c.from as number, to: c.to as number }))
  const days = daysOnline(l), drop = [...l.price_changes, ...seen].toSorted((a, b) => a.date.localeCompare(b.date)).at(-1), messages = l.messages?.length ?? 0
  const chips = !!l.my_status || l.status !== "AVAILABLE" || !!l.labels?.length
  return (
    <div id={`listing-${l.id}`} className="group relative scroll-mt-4">
    <button type="button" onClick={onOpen} style={statusTint(l.my_status)} className={cn("grid w-full grid-cols-[104px_1fr] gap-x-3 rounded-xl border p-2.5 text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", tint(l.my_status), active && "spot border-ring ring-1 ring-ring")}>
      <div className="relative grid size-[104px] place-items-center overflow-hidden rounded-lg bg-muted">
        {photo ? <img key={photo} src={photo} alt="" loading="lazy" className="size-full object-cover" onError={e => e.currentTarget.remove()} /> : <TypeIcon type={t} className="size-6 text-muted-foreground" />}
        {fresh && <NewBadge className="absolute top-1 right-1 h-4 px-1.5 text-[10px]" />}
        {/* the last drop on the photo, as the portals tag it */}
        {drop && drop.to < drop.from && (
          <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded-md bg-background/85 px-1 text-[10px] leading-4 font-semibold whitespace-nowrap text-below tabular-nums backdrop-blur-sm" title={`Baisse de ${eur(drop.from - drop.to)} le ${date(drop.date)}`}>
            <TrendingDownIcon className="size-3" />−{eur(drop.from - drop.to)}
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-lg leading-6 font-bold whitespace-nowrap tabular-nums">{eur(l.price)}</span>
          {score != null && <span className="rounded-md bg-muted px-1.5 text-xs leading-5 font-semibold tabular-nums" title="Score sur 100">{score}</span>}
        </div>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <TypeIcon type={t} className="size-3.5 shrink-0" />
          <span className="truncate">{[l.area && `${l.area} m²`, l.land_area && `terrain ${l.land_area} m²`, l.rooms && `${l.rooms} p.`, t === "flat" && l.floor != null && (l.floor === 0 ? "RDC" : `${l.floor}ᵉ`)].filter(Boolean).join(" · ") || "—"}</span>
          {isHome(t) && <Dpe value={l.dpe?.energy} className="ml-auto h-4 w-5 shrink-0 text-[10px]" />}
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="flex items-baseline justify-between gap-2 text-xs"><span className="text-muted-foreground tabular-nums">{perUnit(unitPrice(l), t)}</span><Gap ppm2={unitPrice(l)} refPpm2={ref?.ppm2} long /></span>
          {stats && <Ruler stats={stats} ticks={[{ id: l.id, ppm2: unitPrice(l) }]} />}
        </div>
        {chips && (
          <span className="flex flex-wrap gap-1">
            <StatusBadge status={l.my_status} />
            {l.status !== "AVAILABLE" && <Badge variant="outline">{SALE_STATUS[l.status] ?? l.status}</Badge>}
            {l.labels?.map(x => <LabelChip key={x} name={x} />)}
          </span>
        )}
      </div>
      <div className="col-span-2 mt-2 flex items-center gap-2 border-t pt-1.5 text-xs text-muted-foreground">
        <Origin l={l} />
        {messages > 0 && <span className="flex items-center gap-1" title={`${messages} message${messages > 1 ? "s" : ""}`}><MailIcon className="size-3.5" />{messages}</span>}
        {days != null && <span className="ml-auto whitespace-nowrap" title={l.published_at ? `1ʳᵉ mise en ligne le ${date(l.published_at)}` : `Vue pour la 1ʳᵉ fois le ${date(l.first_seen)}`}>{days} j en ligne</span>}
      </div>
    </button>
    <FavoriteButton l={l} className="absolute top-3.5 left-3.5" />
    </div>
  )
}
