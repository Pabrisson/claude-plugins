import { badge } from "@engine/market.js"

import { cn } from "@/lib/utils"
import type { Stats } from "@/lib/api"

export type Level = "below" | "at" | "above"
export const levelOf = (ppm2: number | null | undefined, ref: number | null | undefined): Level | null => (badge(ppm2, ref)?.level as Level | undefined) ?? null

const DOT = { below: "bg-below", at: "bg-at", above: "bg-above" } as const

// The price per m² ruler: the sold quartiles of the zone as a band, their median as a mark, and each listing as a
// dot in the color of its gap to the market. Its scale is the band widened by 1.2 times its width on each side.
export function Ruler({ stats, ticks, className }: { stats: Stats; ticks: { id: string; ppm2: number | null }[]; className?: string }) {
  if (!stats.q1 || !stats.q3 || !stats.median_ppm2) return null
  const pad = (stats.q3 - stats.q1) * 1.2, lo = stats.q1 - pad, hi = stats.q3 + pad
  const pos = (x: number) => `${((Math.min(hi, Math.max(lo, x)) - lo) / (hi - lo)) * 100}%`
  return (
    <div className={cn("relative h-4", className)} role="img" aria-label={`Médiane vendue ${stats.median_ppm2} €/m², entre ${stats.q1} et ${stats.q3}`}>
      <div className="absolute inset-x-0 top-[7px] h-0.5 rounded-full bg-border" />
      <div className="absolute top-1 h-2 rounded-full border bg-muted" style={{ left: pos(stats.q1), width: `calc(${pos(stats.q3)} - ${pos(stats.q1)})` }} />
      <div className="absolute top-0 h-4 w-0.5 rounded-full bg-foreground" style={{ left: pos(stats.median_ppm2) }} />
      {ticks.map(t => t.ppm2 != null && (
        <div key={t.id} className={cn("absolute top-0.5 size-3 -translate-x-1.5 rounded-full ring-2 ring-card", DOT[levelOf(t.ppm2, stats.median_ppm2) ?? "at"])} style={{ left: pos(t.ppm2) }} />
      ))}
    </div>
  )
}

export function Gap({ ppm2, refPpm2, long = false }: { ppm2: number | null | undefined; refPpm2: number | null | undefined; long?: boolean }) {
  const b = badge(ppm2, refPpm2)
  if (!b) return <span className="text-muted-foreground">—</span>
  const label = { below: "sous le marché", at: "au prix", above: "au-dessus" }[b.level as Level], n = Math.round(b.gap * 100)
  return (
    <span className={cn("font-semibold whitespace-nowrap", { below: "text-below", at: "text-muted-foreground", above: "text-above" }[b.level as Level])}>
      {n > 0 ? "+" : n < 0 ? "−" : ""}{Math.abs(n)} %{long ? ` ${label}` : ""}
    </span>
  )
}
