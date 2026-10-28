import { ArchiveIcon, DownloadIcon, HousePlusIcon, TagIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react"
import { useMemo } from "react"

import { DPE_HEX, dpeInk } from "@/components/dpe"
import type { Listing, News } from "@/lib/api"
import { num, titleOf, TYPE_LABEL } from "@/lib/format"
import { useSearch } from "@/lib/store"
import { cn } from "@/lib/utils"

// What the follow-up and the bell list: the feed's news (the server's watch, Claude's refresh) and the listings' own
// changes, newest first; an unread one has a dot and its tile in full color, the others are dimmed. Each kind has its color (index.css --news-*): the DPE's own class color for its tile, blue for a
// drop and orange for a rise as the market badges, teal for a new listing, violet for the paid API's.
export type Change = Listing["changes"][number] & { l: Listing }
export type NewsItem = News | Change

export const LOOK = {
  dpe: { label: "Nouveau DPE", color: "var(--news-dpe)", Icon: null },
  new: { label: "Nouvelle annonce", color: "var(--news-new)", Icon: HousePlusIcon },
  price_drop: { label: "Baisse de prix", color: "var(--news-drop)", Icon: TrendingDownIcon },
  price_rise: { label: "Hausse de prix", color: "var(--news-rise)", Icon: TrendingUpIcon },
  status: { label: "Changement de statut", color: "var(--news-other)", Icon: TagIcon },
  expired: { label: "Annonce expirée", color: "var(--news-other)", Icon: ArchiveIcon },
  listings: { label: "Annonces disponibles", color: "var(--news-stream)", Icon: DownloadIcon },
} as const

export function useNews() {
  const { data } = useSearch()
  const items = useMemo<NewsItem[]>(() => [...data.feed.items, ...data.listings.flatMap(l => (l.changes ?? []).map(c => ({ ...c, l })))]
    .sort((a, b) => b.date.localeCompare(a.date)), [data.feed.items, data.listings])
  return { items, fresh: (n: NewsItem) => n.date > (data.feed.read_at ?? "") }
}

// the id the follow-up scrolls to
export const newsKey = (n: NewsItem) => `${n.kind}-${n.date}-${"l" in n ? n.l.id : n.kind === "dpe" ? n.dpe.number : n.count}`
export const newsTitle = (n: NewsItem) => "l" in n ? titleOf(n.l)
  : n.kind === "dpe" ? `${TYPE_LABEL[n.dpe.type]}${n.dpe.area ? ` ${num(n.dpe.area)} m²` : ""}`
  : `${n.added} nouvelle${n.added > 1 ? "s" : ""} sur l'API`

// the dot of an unread one, next to its time
export const UnreadDot = () => <i aria-hidden className="size-2 shrink-0 rounded-full bg-primary" />

// its tile: a DPE's class on its official color, else the kind's icon on a wash of its color
export function NewsTile({ n, dim, className }: { n: NewsItem; dim?: boolean; className?: string }) {
  const box = cn("grid size-9 shrink-0 place-items-center rounded-lg transition-opacity", dim && "opacity-55", className)
  if (n.kind === "dpe") return <span aria-hidden className={cn(box, "text-sm font-bold")} style={{ background: DPE_HEX[n.dpe.energy] ?? "var(--muted)", color: dpeInk(n.dpe.energy) }}>{n.dpe.energy}</span>
  const { color, Icon } = LOOK[n.kind]
  return <span aria-hidden className={box} style={{ color, background: `color-mix(in oklab, ${color} 16%, transparent)` }}><Icon className="size-4.5" /></span>
}

const DAY = 86400000
const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
const daysAgo = (d: string) => Math.round((midnight(new Date()) - midnight(new Date(d))) / DAY)
const longDay = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" })
const shortDay = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" })
const clock = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" })
// the day a group of news is under: « Aujourd'hui », « Hier », « Lundi 26 octobre »
export const dayLabel = (d: string) => {
  const n = daysAgo(d)
  if (n === 0) return "Aujourd'hui"
  if (n === 1) return "Hier"
  const s = longDay.format(new Date(d))
  return s[0].toUpperCase() + s.slice(1)
}
export const clockOf = (d: string) => clock.format(new Date(d))
// when, in a list without days: the time today, « hier », else the date
export const whenOf = (d: string) => (daysAgo(d) === 0 ? clockOf(d) : daysAgo(d) === 1 ? "hier" : shortDay.format(new Date(d)))
