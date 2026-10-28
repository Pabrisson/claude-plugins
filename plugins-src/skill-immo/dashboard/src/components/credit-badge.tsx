import { CoinsIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import type { SearchData } from "@/lib/api"
import { credits, num } from "@/lib/format"
import { useSearch } from "@/lib/store"

// the latest free count of the listings not fetched yet: the search's (search, fetch) or the server's watch
export const lastCount = (d: SearchData) => [d.search.stream, d.feed.stream].filter(x => x != null).sort((a, b) => b.counted_at.localeCompare(a.counted_at))[0] ?? null

type Cost = "fetch" | "refresh" | { route: string; calls?: number }

// The credits a paid button may spend, as a badge inside it, in Stream Estate mode only (nothing in OpenData):
// - fetch: what the last free count found, up to the search's max;
// - refresh: what changed is only counted when it runs, so the search's max at most (nothing before a first fetch);
// - a route: its price (the engine's table, `costs set`) times the calls, « ? » while unknown.
// The run dialog still gives the exact amount and asks first.
export function CreditBadge({ cost }: { cost: Cost }) {
  const { data, state } = useSearch()
  if (!state.stream_estate || data.search.mode !== "stream-estate") return null
  const s = data.search, last = lastCount(data), upTo = cost === "refresh" && !!s.last_refresh
  const price = typeof cost === "object" ? state.costs[cost.route]?.credits : null
  const n = cost === "fetch" ? (last ? Math.min(last.total, s.max) : null)
    : cost === "refresh" ? (s.last_refresh ? s.max : 0)
    : price == null ? null : price * (cost.calls ?? 1)
  const title = n == null ? "Coût inconnu, annoncé avant de lancer" : `${upTo ? "Au plus " : ""}${credits(n, state.usage.eur_per_credit)}`
  return (
    <Badge variant="secondary" className="h-4 px-1.5 tabular-nums" title={title}>
      <CoinsIcon data-icon="inline-start" /><span aria-hidden>{n == null ? "?" : `${upTo ? "≤ " : ""}${num(n)}`}</span><span className="sr-only">{title}</span>
    </Badge>
  )
}
