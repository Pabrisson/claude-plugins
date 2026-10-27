import { score } from "@engine/decide.js"
import { badge, daysOnline, unitPrice } from "@engine/market.js"
import { useMemo } from "react"

import type { Listing } from "@/lib/api"
import { useSearch } from "@/lib/store"

// what is new since the user's last visit: a listing first seen, or a change logged, after it
export const isNew = (l: Listing, since: string | null) => !!since && (l.first_seen > since || (l.changes ?? []).some(c => c.date > since && c.kind !== "new"))

export const SORTS = { score: "Score", gap: "Écart au marché", price: "Prix", recent: "Plus récents", days: "Plus longtemps en ligne" } as const
export type Sort = keyof typeof SORTS

// the listings sorted the way the user picked, with their score and gap to their type's market
export function useRanked(ls: Listing[], sort: Sort) {
  const { marketFor, aidsFor } = useSearch()
  return useMemo(() => ls.map(l => ({ l, score: score(l, aidsFor(l)).value as number | null, gap: (badge(unitPrice(l), marketFor(l).ref?.ppm2)?.gap ?? null) as number | null }))
    .toSorted((a, b) => sort === "score" ? (b.score ?? -1) - (a.score ?? -1) : sort === "gap" ? (a.gap ?? 9) - (b.gap ?? 9) : sort === "price" ? (a.l.price ?? 1e12) - (b.l.price ?? 1e12)
      : sort === "recent" ? b.l.first_seen.localeCompare(a.l.first_seen) : (daysOnline(b.l) ?? 0) - (daysOnline(a.l) ?? 0)),
  [ls, sort, marketFor, aidsFor])
}
