import { score } from "@engine/decide.js"
import { badge, daysOnline, typeOf, unitPrice } from "@engine/market.js"
import { ArrowUpFromLineIcon, Building2Icon, DoorOpenIcon } from "lucide-react"
import { useMemo } from "react"

import type { Listing } from "@/lib/api"
import { useSearch } from "@/lib/store"

// an expired listing the user has not sorted (no status of theirs): off the map, the cards and the board, the list shows
// it on demand. One they follow stays, and its expiry is news (the default alert « Annonces suivies expirées »).
export const shelved = (l: Listing) => l.status === "EXPIRED" && !l.my_status

// « Nouveau »: a listing online the user never opened; one they gave a status or a star counts as seen
export const unseen = (l: Listing) => !l.seen_at && !l.my_status && !l.favorite && l.status !== "EXPIRED"
// the « Nouveautés » filters: the listings never opened, and those that changed (price, status) since the last visit
export const isNew = (l: Listing, since: string | null) => unseen(l) || (!!since && (l.changes ?? []).some(c => c.date > since && c.kind !== "new"))

// the floor filter of the map, the list and the board, on flats only (the other types pass): « Rez-de-chaussée » keeps
// the ground floors, « Étages » the others, and a flat whose floor is unknown shows with neither
export const FLOORS = { all: { label: "Tous les étages", icon: Building2Icon }, ground: { label: "Rez-de-chaussée", icon: DoorOpenIcon }, upper: { label: "Étages", icon: ArrowUpFromLineIcon } } as const
export type Floor = keyof typeof FLOORS
export const floorOk = (l: Listing, f: Floor) => f === "all" || typeOf(l) !== "flat" || (l.floor != null && (l.floor === 0) === (f === "ground"))

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
