import { daysOnline, matches } from "@engine/market.js"
import { useMemo, useState } from "react"

import { Dpe } from "@/components/dpe"
import { Gap, Ruler } from "@/components/ruler"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Listing } from "@/lib/api"
import { eur, m2, SALE_STATUS, STATUS_LABEL } from "@/lib/format"
import { useSearch } from "@/lib/store"
import { cn } from "@/lib/utils"

const SORTS = {
  gap: { label: "Écart au marché", fn: (a: Listing, b: Listing) => (a.price_per_m2 ?? 1e9) - (b.price_per_m2 ?? 1e9) },
  price: { label: "Prix", fn: (a: Listing, b: Listing) => (a.price ?? 1e12) - (b.price ?? 1e12) },
  recent: { label: "Plus récentes", fn: (a: Listing, b: Listing) => (b.first_seen ?? "").localeCompare(a.first_seen ?? "") },
  days: { label: "Plus longtemps en ligne", fn: (a: Listing, b: Listing) => (daysOnline(b) ?? 0) - (daysOnline(a) ?? 0) },
} as const
const FILTERS = { online: "En ligne", new: "Nouvelles", followed: "Suivies", dropped: "Écartées", all: "Toutes" } as const

// what is new since the user's last visit: a listing first seen, or a change logged, after it
export const isNew = (l: Listing, since: string | null) => !!since && (l.first_seen > since || (l.changes ?? []).some(c => c.date > since && c.kind !== "new"))

export function ListingList({ className }: { className?: string }) {
  const { data, ref, refStats, lastVisit, selected, select } = useSearch()
  const [sort, setSort] = useState<keyof typeof SORTS>("gap")
  const [filter, setFilter] = useState<keyof typeof FILTERS>("online")
  const shown = useMemo(() => data.listings
    .filter(l => filter === "all" || (filter === "online" ? l.status !== "EXPIRED" && l.my_status !== "dropped" && matches(l, data.search.criteria)
      : filter === "new" ? isNew(l, lastVisit) : filter === "followed" ? !!l.my_status && l.my_status !== "dropped" : l.my_status === "dropped"))
    .toSorted(SORTS[sort].fn), [data, sort, filter, lastVisit])
  const scope = { recent: "zone, 2 ans", zone: "zone, 5 ans", commune: "commune, 5 ans", transactions: "ventes Stream Estate" }[ref?.scope ?? ""] ?? ""

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <Card size="sm">
        <CardHeader>
          <CardTitle>Prix vendu au m², {scope}</CardTitle>
          <CardDescription>{ref ? `${ref.count} ventes ${ref.scope === "transactions" ? "réconciliées" : "DVF"}` : data.market.alsace_moselle ? "Pas de DVF en Alsace-Moselle" : "Pas assez de ventes"}</CardDescription>
        </CardHeader>
        {ref && (
          <CardContent className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-3xl font-bold tracking-tight">{m2(ref.ppm2)}</span>
              {refStats && <span className="text-xs text-muted-foreground">{m2(refStats.q1)} – {m2(refStats.q3)}</span>}
            </div>
            {refStats && <Ruler stats={refStats} ticks={shown.map(l => ({ id: l.id, ppm2: l.price_per_m2 }))} />}
          </CardContent>
        )}
      </Card>
      <div className="flex items-center justify-between gap-2">
        <Select value={filter} onValueChange={v => setFilter(v as keyof typeof FILTERS)}>
          <SelectTrigger size="sm" aria-label="Filtrer"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{Object.entries(FILTERS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{shown.length} annonce{shown.length > 1 ? "s" : ""}</span>
        <Select value={sort} onValueChange={v => setSort(v as keyof typeof SORTS)}>
          <SelectTrigger size="sm" aria-label="Trier"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>{Object.entries(SORTS).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectGroup></SelectContent>
        </Select>
      </div>
      {!shown.length && (
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>{data.listings.length ? "Aucune annonce pour ce filtre" : "Pas encore d'annonce"}</EmptyTitle>
            <EmptyDescription>
              {data.listings.length ? "Changez de filtre pour voir les autres." : data.search.mode === "stream-estate" ? "Récupérez les annonces de la zone avec le bouton « Annonces Stream Estate »." : "Demandez à Claude d'en chercher, ou ajoutez une annonce par son lien ou son texte."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {shown.map(l => <ListingCard key={l.id} l={l} refPpm2={ref?.ppm2} active={selected === l.id} fresh={isNew(l, lastVisit)} onOpen={() => select(l.id)} />)}
    </div>
  )
}

function ListingCard({ l, refPpm2, active, fresh, onOpen }: { l: Listing; refPpm2: number | undefined; active: boolean; fresh: boolean; onOpen: () => void }) {
  const { refStats } = useSearch()
  const days = daysOnline(l), drop = l.price_changes.at(-1)
  return (
    <button type="button" onClick={onOpen} className={cn("grid grid-cols-[88px_1fr] gap-3 rounded-xl border bg-card p-2.5 text-left transition-colors hover:bg-accent/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none", active && "border-ring ring-1 ring-ring")}>
      <div className="h-20 overflow-hidden rounded-lg bg-muted">
        {l.pictures[0] && <img src={l.pictures[0]} alt="" loading="lazy" className="size-full object-cover" onError={e => e.currentTarget.remove()} />}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-base font-bold">{eur(l.price)}</span>
          <span className="flex gap-1">
            {fresh && <Badge>Nouveau</Badge>}
            {l.status !== "AVAILABLE" && <Badge variant="outline">{SALE_STATUS[l.status] ?? l.status}</Badge>}
            {l.my_status && <Badge variant="secondary">{STATUS_LABEL[l.my_status]}</Badge>}
          </span>
        </div>
        <span className="truncate text-xs text-muted-foreground">
          {[l.area && `${l.area} m²`, l.rooms && `${l.rooms} p.`, l.floor != null && (l.floor === 0 ? "RDC" : `${l.floor}ᵉ`), m2(l.price_per_m2)].filter(Boolean).join(" · ")}
        </span>
        {refStats && <Ruler stats={refStats} ticks={[{ id: l.id, ppm2: l.price_per_m2 }]} />}
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="flex items-center gap-2">
            <Gap ppm2={l.price_per_m2} refPpm2={refPpm2} long />
            {drop && drop.to < drop.from && <span className="text-below">baisse {eur(drop.from - drop.to)}</span>}
          </span>
          <span className="flex items-center gap-2 text-muted-foreground">
            <Dpe value={l.dpe?.energy} />
            {days != null && <span>{days} j</span>}
          </span>
        </div>
      </div>
    </button>
  )
}
