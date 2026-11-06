import { useEffect, useMemo, useState } from "react"
import { Bar, BarChart, XAxis } from "recharts"

import { Icon } from "@/components/icon"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { api, type CaseIndex } from "@/lib/api"
import { caseHref } from "@/lib/route"
import { cn } from "@/lib/utils"

type Item = { date: string; label: string; ref?: string; kind?: string; url?: string }
const KIND_ICON: Record<string, string> = { rdap: "file-badge", certificate: "shield-check", wayback: "history", source: "file-text", posted: "message-square", page: "file-text", earliest: "flag", taken: "camera", registry: "building-2", establishment: "store", ground: "camera", bodacc: "scroll-text" }
const month = (d: string) => d.slice(0, 7)
const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })
const dayLabel = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
const config = { n: { label: "Events", color: "var(--type-1)" } } satisfies ChartConfig

// The case's dated items (the type's timeline view, plus when each source was read), by day, newest first; above, the
// density by month (one hue), a click on a month goes to it
export function Timeline({ index, pulse }: { index: CaseIndex; pulse: number }) {
  const [view, setView] = useState<Item[]>([])
  useEffect(() => { api.view<Item[]>(index.slug, "timeline").then(r => setView(Array.isArray(r) ? r : []), () => setView([])) }, [index.slug, pulse])
  const items = useMemo(() => {
    const read = index.notes.filter(n => n.folder === "Sources" && n.props.accessed).map(n => ({ date: String(n.props.accessed), label: `Read: ${n.title}`, ref: String(n.props.id ?? ""), kind: "source", url: n.props.url ? String(n.props.url) : undefined }))
    return [...view, ...read].filter(x => /^\d{4}-\d{2}-\d{2}/.test(x.date)).sort((a, b) => b.date.localeCompare(a.date))
  }, [view, index.notes])
  const days = useMemo(() => { const m = new Map<string, Item[]>(); for (const x of items) { const d = x.date.slice(0, 10); m.set(d, [...(m.get(d) ?? []), x]) } return [...m] }, [items])
  const bars = useMemo(() => {
    if (!items.length) return []
    const first = month(items.at(-1)!.date), last = month(items[0].date), out: { m: string; label: string; n: number }[] = []
    for (let d = new Date(`${first}-01T00:00:00Z`); month(d.toISOString()) <= last; d.setUTCMonth(d.getUTCMonth() + 1)) { const m = month(d.toISOString()); out.push({ m, label: monthLabel(m), n: items.filter(x => month(x.date) === m).length }) }
    return out
  }, [items])
  const source = (id?: string) => index.notes.find(n => n.folder === "Sources" && n.props.id === id)
  const goMonth = (m: string) => document.querySelector(`[data-month="${m}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  if (!items.length) return <p className="py-10 text-center text-sm text-muted-foreground">Nothing dated yet.</p>
  return (
    <div className="flex flex-col gap-4 py-4">
      <figure className="rounded-xl p-3 ring-1 ring-foreground/10">
        <figcaption className="mb-1 text-xs text-muted-foreground">Dated items per month, {bars[0].label} – {bars.at(-1)!.label} · click a month to go to it</figcaption>
        <ChartContainer config={config} className="aspect-auto h-24 w-full">
          <BarChart data={bars} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} onClick={s => { const m = (s as { activeLabel?: string } | null)?.activeLabel; const b = bars.find(x => x.label === m); if (b && b.n) goMonth(b.m) }}>
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={40} fontSize={11} />
            <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent hideIndicator />} />
            <Bar dataKey="n" fill="var(--color-n)" radius={[4, 4, 0, 0]} minPointSize={0} className="cursor-pointer" />
          </BarChart>
        </ChartContainer>
      </figure>
      <ol className="flex flex-col gap-4">
        {days.map(([d, xs], i) => (
          <li key={d} data-month={i === 0 || days[i - 1][0].slice(0, 7) !== d.slice(0, 7) ? d.slice(0, 7) : undefined} className="scroll-mt-4">
            <h3 className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">{dayLabel(d)}</h3>
            <ul className="flex flex-col gap-1">
              {xs.map((x, j) => {
                const s = source(x.ref)
                return (
                  <li key={j} className="flex items-start gap-2.5 rounded-md p-1.5 hover:bg-muted/50">
                    <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground", x.kind === "earliest" && "text-primary")}><Icon name={KIND_ICON[x.kind ?? ""] ?? "circle"} className="size-3.5" aria-hidden /></span>
                    <span className={cn("min-w-0 flex-1 text-sm", x.kind === "earliest" && "font-bold")}>
                      <span className="mr-2 font-mono text-xs text-muted-foreground">{x.date.length > 10 ? x.date.slice(11, 16) : ""}</span>{x.label}
                      <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                        {s && <a href={caseHref(index.slug, "brain", s.path)} className="text-muted-foreground hover:text-foreground hover:underline">{s.title}</a>}
                        {x.url && (/^https?:\/\//.test(x.url) ? <a href={x.url} target="_blank" rel="noreferrer" className="truncate text-primary underline underline-offset-2">{x.url}</a> : <span className="truncate text-muted-foreground">{x.url}</span>)}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  )
}
