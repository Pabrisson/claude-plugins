import { BotIcon, CalendarDaysIcon, ChartColumnIcon, ChevronRightIcon, DownloadIcon, FolderSearchIcon, HistoryIcon, InfoIcon, LayersIcon, RefreshCwIcon, TrendingUpIcon, WalletIcon } from "lucide-react"
import { useMemo, useState } from "react"
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts"

import { CreditBadge } from "@/components/credit-badge"
import { clockOf, dayLabel } from "@/components/news"
import { useRun } from "@/components/run-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { UsageEntry } from "@/lib/api"
import { num } from "@/lib/format"
import { useSearch } from "@/lib/store"
import { cn } from "@/lib/utils"

const DAY = 864e5
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10)
const eurOf = (credits: number, rate: number) => `${(credits * rate).toFixed(2).replace(".", ",")} €`
const cr = (n: number) => `${num(n)} crédit${Math.round(n) >= 2 ? "s" : ""}`
const longDay = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long" }), longYear = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric" })
// « 8 juillet », with its year when it is not this one
const long = { format: (t: number | Date) => (new Date(t).getFullYear() === new Date().getFullYear() ? longDay : longYear).format(t) }, short = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" })
const monthName = new Intl.DateTimeFormat("fr-FR", { month: "short" }), clock = new Intl.DateTimeFormat("fr-FR", { weekday: "short", hour: "2-digit", minute: "2-digit" })
const title = "flex items-center gap-2"

// what a call was for, in the user's words: the routes of the API v1 (references/stream-estate.md)
const USES = {
  fetched: "Annonces récupérées",
  counts: "Comptages",
  asking: "Prix affichés du marché",
  alert: "Suppression d'une ancienne alerte",
  other: "Autres appels",
} as const
type Use = keyof typeof USES
const purposeOf = (e: UsageEntry): Use => (e.route === "GET /documents/properties" ? (e.results ? "fetched" : "counts") : e.route === "GET /indicators/price_per_meter" ? "asking" : e.route.startsWith("DELETE /searches") ? "alert" : "other")
const ROUTE_LABEL: Record<string, string> = {
  "GET /documents/properties": "Annonces (récupération, comptage)",
  "GET /indicators/price_per_meter": "Prix affichés du marché",
  "DELETE /searches/{id}": "Suppression d'une ancienne alerte",
}
const chartConfig = {
  me: { label: "Vous et Claude", color: "var(--chart-2)" },
  auto: { label: "Récupération automatique", color: "var(--chart-4)" },
  cumul: { label: "Cumul du mois", color: "var(--chart-1)" },
  projected: { label: "Prévision", color: "var(--chart-1)" },
} satisfies ChartConfig

// The API's costs: this month, the month's end at the current pace and the account (read only, set in « Réglages »);
// what the watch found to fetch; the spending day by day or month by month, the automatic fetch apart; where it went,
// per search and per use; the calls, in words; how it is counted. `onView` opens another tab.
export function CostsTab({ onView }: { onView: (v: string) => void }) {
  const { state } = useSearch()
  const u = state.usage, rate = u.eur_per_credit
  const [now] = useState(() => Date.now())
  // the pace of the last 30 days, carried to the month's end; when the cap and the account would be reached
  const f = useMemo(() => {
    const at = new Date(now), last = Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0), today = dayOf(now)
    const pace = Object.entries(u.daily).filter(([d]) => d >= dayOf(now - 30 * DAY)).reduce((a, [, v]) => a + v, 0) / 30
    const end = Math.round(u.month + pace * Math.max(0, (last - Date.parse(today)) / DAY))
    const reach = (left: number) => (pace > 0 && left > 0 ? now + (left / pace) * DAY : null)
    return { pace, end, last, cap: reach(u.cap - u.month), out: u.account ? reach(u.account.left_items) : null }
  }, [u.daily, u.month, u.cap, u.account, now])
  const autoMonth = u.monthly_auto[dayOf(now).slice(0, 7)] ?? 0

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      {!state.stream_estate && (
        <Alert>
          <InfoIcon />
          <AlertTitle>{state.has_key ? "API coupée" : "Pas de clé de l'API"}</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {state.has_key ? "Rien n'est facturé : les recherches se contentent des données ouvertes et des annonces trouvées par Claude." : "Rien n'est facturé. Pour l'API : /plugin configure skill-immo@pabrisson, puis redémarrez Claude Code."}
            {state.has_key && <Button size="xs" variant="outline" onClick={() => onView("settings")}>Réglages</Button>}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile icon={CalendarDaysIcon} label="Ce mois-ci" value={cr(u.month)}>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-label="Crédits du mois sur le plafond" aria-valuenow={u.month} aria-valuemin={0} aria-valuemax={u.cap}>
            <div className={cn("h-full", u.month >= u.cap * 0.9 ? "bg-destructive" : "bg-foreground")} style={{ width: `${Math.min(100, u.cap ? (u.month / u.cap) * 100 : 0)}%` }} />
          </div>
          <p>{eurOf(u.month, rate)} sur un plafond de {num(u.cap)}{autoMonth ? `, dont ${num(autoMonth)} en automatique` : ""}</p>
        </Tile>
        <Tile icon={TrendingUpIcon} label="Fin de mois prévue" value={f.pace > 0 ? `≈ ${cr(f.end)}` : cr(u.month)}>
          <p>{f.pace > 0 ? `${eurOf(f.end, rate)} au rythme de ${num(f.pace)} par jour sur 30 jours` : "Aucune dépense sur 30 jours"}</p>
          <p className={cn(f.cap && f.cap <= f.last && "text-destructive")}>{f.cap && f.cap <= f.last ? `Plafond atteint vers le ${long.format(f.cap)}` : "Sous le plafond"}</p>
        </Tile>
        <Tile icon={WalletIcon} label="Solde du compte" value={u.account ? `${u.account.left.toFixed(2).replace(".", ",")} €` : "—"}>
          {u.account
            ? <p>{cr(u.account.left_items)}{f.out ? ` · épuisé vers le ${long.format(f.out)}` : ""}</p>
            : <p>{state.has_key ? "Non renseigné" : "Sans clé de l'API"}</p>}
          <button type="button" onClick={() => onView("settings")} className="flex items-center gap-0.5 self-start text-foreground underline-offset-2 hover:underline">{u.account ? "Modifier dans Réglages" : "Le renseigner dans Réglages"}<ChevronRightIcon className="size-3.5" /></button>
        </Tile>
      </div>

      <Upcoming onView={onView} />
      <Spending />
      <div className="grid gap-4 md:grid-cols-2">
        <PerSearch />
        <PerUse />
      </div>
      <Calls />
      <HowCounted />
    </div>
  )
}

// a figure at the top: its icon and label, the value, a few words under it
function Tile({ icon: Icon, label, value, children }: { icon: typeof WalletIcon; label: string; value: string; children: React.ReactNode }) {
  return (
    <Card size="sm">
      <CardHeader><CardDescription className={title}><Icon className="size-4" />{label}</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
        <p className="text-2xl font-bold tracking-tight text-foreground tabular-nums">{value}</p>
        {children}
      </CardContent>
    </Card>
  )
}

// What the watch counted for free, search by search, and what fetching it would cost; this search's own buttons, a
// link to the others; the automatic fetch's state and what is left of its budget
function Upcoming({ onView }: { onView: (v: string) => void }) {
  const { slug, data, state } = useSearch()
  const run = useRun()
  const u = state.usage, st = state.settings, pending = state.pending.filter(p => p.on && (p.added || p.changed))
  const autoLeft = Math.max(0, st.auto_credits - (u.monthly_auto[new Date().toISOString().slice(0, 7)] ?? 0))
  return (
    <Card>
      <CardHeader>
        <CardTitle className={title}><DownloadIcon className="size-4" />À venir</CardTitle>
        <CardDescription>Ce que la veille a compté gratuitement{state.watch.last ? ` (${clock.format(new Date(state.watch.last))})` : ""}, et ce que le récupérer coûterait au plus.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {pending.length ? (
          <ul className="flex flex-col divide-y">
            {pending.map(p => {
              const here = p.slug === slug, max = Math.min(p.added + p.changed, u.max_fetch)
              return (
                <li key={p.slug} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5 first:pt-0 last:pb-0">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium"><span className="truncate">{p.label}</span>{here && <Badge variant="secondary">Cette recherche</Badge>}</span>
                    <span className="text-xs text-muted-foreground">{[p.added && `${num(p.added)} nouvelle${p.added > 1 ? "s" : ""}`, p.changed && `${num(p.changed)} modifiée${p.changed > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span className="text-sm tabular-nums">≤ {cr(max)} <span className="text-muted-foreground">({eurOf(max, u.eur_per_credit)})</span></span>
                  {here ? (
                    <span className="flex gap-2">
                      {p.added > 0 && <Button size="sm" onClick={() => run({ cmd: "fetch", slug, label: "Annonces de l'API" })}><DownloadIcon data-icon="inline-start" />Récupérer<CreditBadge cost="fetch" /></Button>}
                      {p.changed > 0 && !!data.search.last_refresh && <Button size="sm" variant="outline" onClick={() => run({ cmd: "refresh", slug, label: "Actualisation de la recherche" })}><RefreshCwIcon data-icon="inline-start" />Actualiser</Button>}
                    </span>
                  ) : <Button size="sm" variant="ghost" asChild><a href={`/${p.slug}/`}>Ouvrir<ChevronRightIcon data-icon="inline-end" /></a></Button>}
                </li>
              )
            })}
          </ul>
        ) : <p className="text-sm text-muted-foreground">{state.stream_estate ? "Rien à récupérer au dernier comptage." : "API coupée : rien n'est compté ni récupéré."}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
          <span className="flex items-center gap-2 text-muted-foreground">
            <BotIcon className="size-4" />
            {st.auto_fetch
              ? `Récupération automatique${state.watch.next ? ` à la prochaine veille (${clock.format(new Date(state.watch.next))})` : ""} : reste ${cr(autoLeft)} de ${num(st.auto_credits)} ce mois-ci.`
              : "Récupération automatique coupée : rien n'est payé sans vous."}
          </span>
          <Button size="xs" variant="ghost" onClick={() => onView("settings")}>Réglages<ChevronRightIcon data-icon="inline-end" /></Button>
        </div>
      </CardContent>
    </Card>
  )
}

// The credits spent: this month day by day (yours and the automatic fetch's), its running total and the forecast to
// its end; or the last 12 months. The cap shows once the curve comes near it.
function Spending() {
  const { state } = useSearch()
  const u = state.usage
  const [span, setSpan] = useState("month"), [now] = useState(() => Date.now())
  const rows = useMemo<{ x: string; me: number | null; auto: number | null; cumul?: number | null; projected?: number | null }[]>(() => {
    const at = new Date(now)
    if (span === "year") return Array.from({ length: 12 }, (_, i) => {
      const m = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - 11 + i, 1)).toISOString().slice(0, 7), auto = u.monthly_auto[m] ?? 0
      return { x: m, me: Math.max(0, (u.by_month[m] ?? 0) - auto), auto }
    })
    const first = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1), last = Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0), today = dayOf(now)
    const pace = Object.entries(u.daily).filter(([d]) => d >= dayOf(now - 30 * DAY)).reduce((a, [, v]) => a + v, 0) / 30
    const out = []
    let sum = 0
    for (let t = first; t <= last; t += DAY) {
      const d = dayOf(t), past = d <= today, all = u.daily[d] ?? 0, auto = u.daily_auto[d] ?? 0
      if (past) sum += all
      out.push({ x: d, me: past ? all - auto : null, auto: past ? auto : null, cumul: past ? sum : null, projected: d < today ? null : Math.round(sum + pace * (t - Date.parse(today)) / DAY) })
    }
    return out
  }, [span, u.daily, u.daily_auto, u.by_month, u.monthly_auto, now])
  const top = Math.max(0, ...rows.map(r => Math.max(r.cumul ?? 0, r.projected ?? 0, (r.me ?? 0) + (r.auto ?? 0))))
  const showCap = top >= u.cap * 0.5
  return (
    <Card>
      <CardHeader>
        <CardTitle className={title}><ChartColumnIcon className="size-4" />Dépenses</CardTitle>
        <CardDescription>{span === "month" ? "Crédits par jour, leur cumul et la prévision jusqu'à la fin du mois." : "Crédits par mois, sur un an."}</CardDescription>
        <CardAction>
          <ToggleGroup type="single" variant="outline" size="sm" value={span} onValueChange={v => v && setSpan(v)} aria-label="Période">
            <ToggleGroupItem value="month">Ce mois</ToggleGroupItem>
            <ToggleGroupItem value="year">12 mois</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ChartContainer config={chartConfig} className="aspect-auto h-60 w-full">
          <ComposedChart data={rows} margin={{ left: 4, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="x" tickLine={false} axisLine={false} minTickGap={24} tickFormatter={x => (span === "year" ? monthName.format(new Date(`${x}-01`)) : short.format(new Date(x)))} />
            <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} domain={[0, showCap ? Math.max(top, u.cap) : "auto"]} tickFormatter={v => num(v)} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={x => (span === "year" ? new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(new Date(`${x}-01`)) : long.format(new Date(x)))} formatter={(v, n) => [cr(v as number), chartConfig[n as keyof typeof chartConfig]?.label]} />} />
            <ChartLegend content={<ChartLegendContent />} />
            {showCap && <ReferenceLine y={u.cap} stroke="var(--destructive)" strokeDasharray="4 4" label={{ value: `plafond ${num(u.cap)}`, position: "insideTopRight", fontSize: 11, fill: "var(--muted-foreground)" }} />}
            <Bar dataKey="me" stackId="d" fill="var(--color-me)" radius={[0, 0, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="auto" stackId="d" fill="var(--color-auto)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            {span === "month" && <Line dataKey="cumul" type="linear" stroke="var(--color-cumul)" strokeWidth={2} dot={false} isAnimationActive={false} />}
            {span === "month" && <Line dataKey="projected" type="linear" stroke="var(--color-projected)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />}
          </ComposedChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}

// a list of shares: its label, a bar of its part of the largest, its credits and euros (or « gratuit », « coût inconnu »)
function Shares({ rows, rate }: { rows: { key: string; label: string; credits: number; calls: number; unknown: number; hint?: string }[]; rate: number }) {
  const max = Math.max(1, ...rows.map(r => r.credits))
  if (!rows.length) return <p className="text-sm text-muted-foreground">Aucun appel à l'API pour l'instant.</p>
  return (
    <ul className="flex flex-col gap-3">
      {rows.map(r => (
        <li key={r.key} className="flex flex-col gap-1">
          <span className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">{r.label}{r.hint && <span className="text-muted-foreground"> · {r.hint}</span>}</span>
            <span className="shrink-0 tabular-nums">{r.credits ? <>{cr(r.credits)} <span className="text-muted-foreground">({eurOf(r.credits, rate)})</span></> : r.unknown ? <span className="text-muted-foreground">coût inconnu</span> : <span className="text-muted-foreground">gratuit</span>}</span>
          </span>
          <span className="h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-chart-2" style={{ width: `${(r.credits / max) * 100}%` }} /></span>
        </li>
      ))}
    </ul>
  )
}

// where the credits went, search by search, since the start
function PerSearch() {
  const { state, slug } = useSearch()
  const labels = Object.fromEntries(state.pending.map(p => [p.slug, p.label]))
  const rows = Object.entries(state.usage.by_search).map(([k, v]) => ({ key: k, label: k === "-" ? "Hors recherche" : labels[k] ?? k, credits: v.credits, calls: v.calls, unknown: (v as { unknown?: number }).unknown ?? 0, hint: k === slug ? "cette recherche" : undefined }))
    .sort((a, b) => b.credits - a.credits)
  return (
    <Card>
      <CardHeader><CardTitle className={title}><FolderSearchIcon className="size-4" />Par recherche</CardTitle><CardDescription>Depuis le début.</CardDescription></CardHeader>
      <CardContent><Shares rows={rows} rate={state.usage.eur_per_credit} /></CardContent>
    </Card>
  )
}

// where the credits went, per use: listings fetched, free counts, asking prices…
function PerUse() {
  const { state } = useSearch()
  const rows = (Object.entries(state.usage.by_use) as [Use, { calls: number; credits: number; unknown: number }][])
    .map(([k, v]) => ({ key: k, label: USES[k], credits: v.credits, calls: v.calls, unknown: v.unknown, hint: `${num(v.calls)} appel${v.calls > 1 ? "s" : ""}` }))
    .sort((a, b) => b.credits - a.credits || b.calls - a.calls)
  return (
    <Card>
      <CardHeader><CardTitle className={title}><LayersIcon className="size-4" />Par usage</CardTitle><CardDescription>Depuis le début.</CardDescription></CardHeader>
      <CardContent><Shares rows={rows} rate={state.usage.eur_per_credit} /></CardContent>
    </Card>
  )
}

const PAGE = 30
// The calls, in words and day by day: when, for which search, what for, by whom, for how much. The free counts and the
// other searches can be left out.
function Calls() {
  const { state } = useSearch()
  const [free, setFree] = useState(false), [search, setSearch] = useState("all"), [shown, setShown] = useState(PAGE)
  const labels = Object.fromEntries(state.pending.map(p => [p.slug, p.label]))
  const list = state.log.toReversed().filter(e => (free || e.credits !== 0) && (search === "all" || (e.search ?? "-") === search))
  const days = list.slice(0, shown).reduce<[string, UsageEntry[]][]>((out, e) => {
    const d = dayLabel(e.date)
    if (out.at(-1)?.[0] === d) out.at(-1)![1].push(e)
    else out.push([d, [e]])
    return out
  }, [])
  const slugs = [...new Set(state.log.map(e => e.search ?? "-"))]
  const what = (e: UsageEntry) => {
    const use = purposeOf(e)
    return use === "fetched" ? `${num(e.results)} annonce${e.results > 1 ? "s" : ""} récupérée${e.results > 1 ? "s" : ""}` : use === "counts" ? "Comptage des annonces" : USES[use]
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className={title}><HistoryIcon className="size-4" />Historique</CardTitle>
        <CardDescription>Les derniers appels à l'API.</CardDescription>
        <CardAction className="flex flex-wrap items-center justify-end gap-3">
          <span className="flex items-center gap-2"><Switch id="c-free" checked={free} onCheckedChange={v => { setFree(v); setShown(PAGE) }} /><Label htmlFor="c-free" className="text-sm font-normal">Comptages gratuits</Label></span>
          {slugs.length > 1 && (
            <Select value={search} onValueChange={v => { setSearch(v); setShown(PAGE) }}>
              <SelectTrigger size="sm" aria-label="Recherche"><SelectValue /></SelectTrigger>
              <SelectContent><SelectGroup><SelectItem value="all">Toutes les recherches</SelectItem>{slugs.map(s => <SelectItem key={s} value={s}>{s === "-" ? "Hors recherche" : labels[s] ?? s}</SelectItem>)}</SelectGroup></SelectContent>
            </Select>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!list.length && <p className="text-sm text-muted-foreground">Aucun appel payant pour l'instant.</p>}
        {days.map(([day, es]) => (
          <section key={day} aria-label={day} className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-muted-foreground">{day}</h3>
            <ol className="flex flex-col divide-y">
              {es.map((e, i) => (
                <li key={`${e.date}-${i}`} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 py-2 text-sm">
                  <time dateTime={e.date} className="text-xs text-muted-foreground tabular-nums">{clockOf(e.date)}</time>
                  <span className="min-w-0">
                    <span className="block truncate">{what(e)}</span>
                    <span className="flex items-center gap-2 truncate text-xs text-muted-foreground">{e.search ? labels[e.search] ?? e.search : "Hors recherche"}{e.by === "auto" && <Badge variant="outline" className="h-4 gap-1 px-1.5 text-[10px]"><BotIcon />auto</Badge>}</span>
                  </span>
                  <span className="text-right tabular-nums">{e.credits == null ? <span className="text-muted-foreground">coût inconnu</span> : e.credits ? cr(e.credits) : <span className="text-muted-foreground">gratuit</span>}</span>
                </li>
              ))}
            </ol>
          </section>
        ))}
        {list.length > shown && <Button variant="ghost" size="sm" className="self-center" onClick={() => setShown(s => s + PAGE)}>Afficher plus</Button>}
      </CardContent>
    </Card>
  )
}

// How the API bills, folded: a credit per listing returned, the free counts, the prices measured or still unknown
function HowCounted() {
  const { state } = useSearch()
  const rate = state.usage.eur_per_credit
  return (
    <details className="group rounded-xl border bg-card text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-medium [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />Comment c'est compté
      </summary>
      <div className="flex flex-col gap-3 px-4 pb-4 text-muted-foreground">
        <p>Stream Estate facture chaque annonce renvoyée : un crédit, {eurOf(1, rate)}. Un comptage ne renvoie aucune annonce : il est gratuit, comme la veille. Le moteur estime chaque dépense et demande votre accord avant, sauf la récupération automatique, dans le budget que vous lui donnez.</p>
        <ul className="flex flex-col divide-y rounded-lg border">
          {Object.entries(state.costs).map(([route, c]) => (
            <li key={route} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
              <span className="flex flex-col"><span className="text-foreground">{ROUTE_LABEL[route] ?? route}</span><span className="font-mono text-[11px]">{route}</span></span>
              <span className={cn("tabular-nums", c.credits == null && "text-foreground")}>{c.credits == null ? "coût inconnu : votre accord à chaque appel" : `${c.credits} crédit${c.per ? " par annonce" : " par appel"}${c.note === "measured" ? " (mesuré)" : ""}`}</span>
            </li>
          ))}
        </ul>
      </div>
    </details>
  )
}
