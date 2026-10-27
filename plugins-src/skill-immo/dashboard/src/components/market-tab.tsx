import { median } from "@engine/dvf.js"
import { badge, daysOnline, dropped, typeOf, unitPrice } from "@engine/market.js"
import { ArrowDownRightIcon, ArrowRightIcon, ArrowUpRightIcon, BarChart3Icon, BuildingIcon, CoinsIcon, EyeIcon, HouseIcon, KeyRoundIcon, LandmarkIcon, LeafIcon, MapPinnedIcon, ReceiptTextIcon, TrendingUpIcon, WalletIcon, type LucideIcon } from "lucide-react"
import { useState } from "react"
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, XAxis, YAxis } from "recharts"

import { DPE_HEX, dpeInk } from "@/components/dpe"
import { useRun } from "@/components/run-dialog"
import { Gap, levelOf, Ruler } from "@/components/ruler"
import { TypeIcon } from "@/components/type-icon"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { DpeClasses, Dvf, Housing, Listing, PropertyType, Tax } from "@/lib/api"
import { date, eur, LEVEL_LABEL, m2, month, num, pct, perUnit, share, titleCase, TYPE_PLURAL, UNIT } from "@/lib/format"
import { useSearch } from "@/lib/store"
import { cn } from "@/lib/utils"

const DAY = 864e5
const PUBLISHER: Record<string, string> = { PRIVATE_INDIVIDUAL: "Particuliers", REAL_ESTATE_AGENCY: "Agences", COMMERCIAL_AGENT: "Agents commerciaux", MANDATED_AGENT: "Mandataires" }
const LEVEL_COLOR = { below: "var(--below)", at: "var(--at)", above: "var(--above)" } as const
const ok = <T,>(x: T | { error: string } | null | undefined): T | null => (x && !(typeof x === "object" && "error" in x) ? (x as T) : null)
const day = (t: number) => new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" }).format(new Date(t))

// a section's title with its icon on a tint of its color: each part of the page has its own
function Title({ icon: Icon, tone, children }: { icon: LucideIcon; tone: string; children: React.ReactNode }) {
  return (
    <CardTitle className="flex items-center gap-2">
      <span className="grid size-7 place-items-center rounded-md" style={{ color: tone, background: `color-mix(in oklab, ${tone} 16%, transparent)` }}><Icon className="size-4" /></span>
      {children}
    </CardTitle>
  )
}

// a rise or a fall, colored like the gap to the market: up in orange (dearer), down in blue
function Delta({ x, label }: { x: number | null | undefined; label: string }) {
  if (x == null) return null
  const Icon = Math.abs(x) < 0.005 ? ArrowRightIcon : x > 0 ? ArrowUpRightIcon : ArrowDownRightIcon
  return <span className={cn("inline-flex items-center gap-0.5 text-xs font-semibold whitespace-nowrap", x > 0.005 ? "text-above" : x < -0.005 ? "text-below" : "text-muted-foreground")}><Icon className="size-3.5" />{pct(x, 1)} <span className="font-normal text-muted-foreground">{label}</span></span>
}

function Kpi({ title, value, sub, icon, tone, children }: { title: string; value: string; sub: string; icon: LucideIcon; tone: string; children?: React.ReactNode }) {
  const Icon = icon
  return (
    <Card size="sm">
      <CardHeader><CardDescription className="flex items-center gap-1.5"><Icon className="size-3.5" style={{ color: tone }} />{title}</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-1">
        <span className="text-2xl font-bold tracking-tight">{value}</span>
        {children}
        <span className="text-xs text-muted-foreground">{sub}</span>
      </CardContent>
    </Card>
  )
}

export function MarketTab() {
  const { slug, data, state, types } = useSearch()
  const run = useRun()
  const [type, setType] = useState<PropertyType>(types[0])
  // the asking prices and their analytics are those of the search's first type (paid API)
  const d = data.market.dvf?.[type], se = data.market.stream && (data.market.stream.type ?? "flat") === type ? data.market.stream : undefined
  const streamOn = state.stream_estate && data.search.mode === "stream-estate", u = (n: number | null | undefined) => perUnit(n, type)
  const rents = ok(data.market.rent), rent = rents && (type === "flat" || type === "house") ? rents[type] : null
  // a year of rent over the sold price of a m²: the zone's gross yield
  const yieldOf = rent && d?.recent.median_ppm2 ? (rent.per_m2 * 12) / d.recent.median_ppm2 : null
  const context = data.market.context
  const listings = data.listings.filter(l => typeOf(l) === type)

  return (
    <div className="flex flex-col gap-4 p-4">
      {types.length > 1 && (
        <ToggleGroup type="single" variant="outline" size="sm" value={type} onValueChange={v => v && setType(v as PropertyType)} className="self-start" aria-label="Type de bien">
          {types.map(t => <ToggleGroupItem key={t} value={t}><TypeIcon type={t} />{TYPE_PLURAL[t]}</ToggleGroupItem>)}
        </ToggleGroup>
      )}
      {data.market.alsace_moselle && (
        <Alert><AlertTitle>Pas de ventes DVF en Alsace-Moselle</AlertTitle><AlertDescription>Le Bas-Rhin, le Haut-Rhin et la Moselle tiennent leur propre livre foncier, absent de DVF. Les ventes réconciliées de l'API payante peuvent le compléter.</AlertDescription></Alert>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi title="Vendu, zone (2 ans)" value={u(d?.recent.median_ppm2)} sub={`${num(d?.recent.count)} ventes DVF`} icon={MapPinnedIcon} tone="var(--chart-2)">
          <Delta x={d?.trend?.zone?.y1} label="en 1 an" />
        </Kpi>
        <Kpi title={`Vendu, ${data.search.street?.name ?? "rue"}`} value={u(d?.street?.median_ppm2)} sub={d?.street ? `${num(d.street.count)} ventes, ${d.years.length} ans` : "Recherche sans rue"} icon={MapPinnedIcon} tone="var(--chart-2)" />
        <Kpi title="Vendu, commune" value={u(d?.commune.median_ppm2)} sub={`${num(d?.commune.count)} ventes, ${d?.years.length ?? 0} ans`} icon={LandmarkIcon} tone="var(--chart-2)">
          <Delta x={d?.trend?.commune?.y3} label="en 3 ans" />
        </Kpi>
        <Kpi title="Loyer, commune" value={rent ? `${String(rent.per_m2).replace(".", ",")} €/m²` : "—"} sub={rent ? `par mois charges comprises, carte des loyers ${rents!.year}` : type === "flat" || type === "house" ? "Pas de loyer de référence" : "Logements seulement"} icon={KeyRoundIcon} tone="var(--chart-3)" />
        <Kpi title="Rendement brut, zone" value={yieldOf ? share(yieldOf, 1) : "—"} sub={yieldOf ? `${num(1 / yieldOf)} ans de loyer pour payer le prix` : "Loyer et ventes nécessaires"} icon={CoinsIcon} tone="var(--chart-3)" />
        <Kpi title="Affiché, zone" value={m2(se?.trend?.data?.at(-1)?.metrics["median:price_per_sqm"])} sub={se ? "Dernier mois, API payante" : "Nécessite l'API payante"} icon={EyeIcon} tone="var(--chart-4)" />
      </div>
      {d && <TrendCard d={d} type={type} se={se} streamOn={streamOn} onAsking={() => run({ cmd: "market", slug, label: "Analyses du marché (API payante)" })} />}
      <div className="grid gap-4 xl:grid-cols-2">
        {d && <BudgetCard d={d} type={type} listings={listings} />}
        <WatchCard type={type} listings={listings} />
      </div>
      {d?.streets?.length ? <StreetsCard d={d} type={type} /> : null}
      {context && (type === "flat" || type === "house") && (
        <div className="grid gap-4 lg:grid-cols-3">
          <DpeCard dpe={ok(context.dpe)} type={type} />
          <TaxCard tax={ok(context.tax)} />
          <HousingCard housing={ok(context.housing)} />
        </div>
      )}
      {se && (
        <div className="grid gap-3 md:grid-cols-3">
          <Card size="sm">
            <CardHeader><CardTitle>Affiché par classe DPE</CardTitle><CardDescription>12 derniers mois</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              {(se.dpe?.data ?? []).filter(x => x.group.dpe_energy_rating).sort((a, b) => a.group.dpe_energy_rating.localeCompare(b.group.dpe_energy_rating)).map(x => (
                <div key={x.group.dpe_energy_rating} className="flex justify-between"><span>{x.group.dpe_energy_rating}</span><span className="font-medium">{m2(x.metrics["median:price_per_sqm"])} <span className="text-muted-foreground">({num(x.metrics.count)})</span></span></div>
              ))}
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader><CardTitle>Particuliers et agences</CardTitle><CardDescription>12 derniers mois</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              {(se.publishers?.data ?? []).map(x => (
                <div key={x.group.publisher_type} className="flex justify-between"><span>{PUBLISHER[x.group.publisher_type] ?? x.group.publisher_type}</span><span className="font-medium">{m2(x.metrics["median:price_per_sqm"])} <span className="text-muted-foreground">({num(x.metrics.count)})</span></span></div>
              ))}
            </CardContent>
          </Card>
          <Card size="sm">
            <CardHeader><CardTitle>Ventes réconciliées</CardTitle><CardDescription>DVF et notaires, 2 ans</CardDescription></CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              <div className="flex justify-between"><span>Médiane</span><span className="font-medium">{m2(se.transactions?.median_ppm2)}</span></div>
              {Object.entries(se.transactions?.by_source ?? {}).map(([k, v]) => <div key={k} className="flex justify-between"><span>{k === "FR_NOTARIES" ? "Notaires" : "DVF"}</span><span className="font-medium">{num(v)}</span></div>)}
            </CardContent>
          </Card>
        </div>
      )}
      {!streamOn && (
        <Alert>
          <AlertTitle>Prix affichés et durée en ligne de tout le marché : API payante</AlertTitle>
          <AlertDescription>{state.stream_estate ? "Cette recherche est en mode OpenData. Passez-la en mode API payante pour ajouter les prix affichés, la durée en ligne et les ventes des notaires." : "Sans clé d'API payante, le marché repose sur les ventes réelles DVF et l'open data, gratuits. La clé ajoute les prix affichés, la durée en ligne et les ventes des notaires."}</AlertDescription>
        </Alert>
      )}
      {d && <SalesCard d={d} type={type} />}
    </div>
  )
}

const trendConfig = {
  sold: { label: "Vendu (DVF, médiane du trimestre)", color: "var(--chart-2)" },
  asking: { label: "Affiché (API payante, médiane du mois)", color: "var(--chart-4)" },
  count: { label: "Ventes du trimestre", color: "var(--chart-3)" },
} satisfies ChartConfig

// The sold price per quarter and, under it on its own axis, the number of sales: the price's direction and the
// market's pace. A quarter of one or two sales says nothing about the price (a single house, a typo): 3 at least.
function TrendCard({ d, type, se, streamOn, onAsking }: { d: Dvf; type: PropertyType; se: NonNullable<ReturnType<typeof useSearch>["data"]["market"]["stream"]> | undefined; streamOn: boolean; onAsking: () => void }) {
  const { data } = useSearch()
  const u = (n: number | null | undefined) => perUnit(n, type)
  const rows = new Map<string, { month: string; sold?: number; asking?: number; count?: number }>()
  for (const q of d.zone.by_quarter) {
    const m = `${q.quarter.slice(0, 4)}-${String((+q.quarter.slice(6) - 1) * 3 + 2).padStart(2, "0")}`
    rows.set(m, { month: m, count: q.count, ...(q.count >= 3 ? { sold: q.median_ppm2 } : {}) })
  }
  for (const x of se?.trend?.data ?? []) {
    const m = String(x.group.time_bucket ?? x.group.event_at ?? "").slice(0, 7)
    if (m) rows.set(m, { ...rows.get(m), month: m, asking: x.metrics["median:price_per_sqm"] })
  }
  const series = [...rows.values()].sort((a, b) => a.month.localeCompare(b.month))
  const tick = (m: string) => `${m.slice(5)}/${m.slice(2, 4)}`
  return (
    <Card>
      <CardHeader>
        <Title icon={TrendingUpIcon} tone="var(--chart-2)">Tendance et volume</Title>
        <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{type === "parking" ? "Prix d'une place" : type === "land" ? "Prix au m² de terrain" : "Prix au m²"} vendu, zone ({data.search.zone.label})</span>
          <Delta x={d.trend?.zone?.y1} label="en 1 an" /><Delta x={d.trend?.zone?.y3} label="en 3 ans" />
        </CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" disabled={!streamOn} title={streamOn ? undefined : "Nécessite l'API payante"} onClick={onAsking}>
            <BarChart3Icon data-icon="inline-start" />{se ? "Mettre à jour l'affiché" : "Ajouter l'affiché"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {series.length ? (
          <>
            <ChartContainer config={trendConfig} className="aspect-auto h-56 w-full">
              <LineChart data={series} syncId="trend" margin={{ left: 8, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={tick} />
                <YAxis tickLine={false} axisLine={false} width={56} domain={["auto", "auto"]} tickFormatter={v => num(v)} />
                <ChartTooltip content={<ChartTooltipContent formatter={(v, n) => [n === "asking" ? m2(v as number) : u(v as number), trendConfig[n as keyof typeof trendConfig]?.label]} />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Line dataKey="sold" type="monotone" stroke="var(--color-sold)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                {se && <Line dataKey="asking" type="monotone" stroke="var(--color-asking)" strokeWidth={2} dot={false} connectNulls />}
              </LineChart>
            </ChartContainer>
            <ChartContainer config={trendConfig} className="aspect-auto h-24 w-full">
              <BarChart data={series} syncId="trend" margin={{ left: 8, right: 8 }}>
                <XAxis dataKey="month" hide />
                <YAxis tickLine={false} axisLine={false} width={56} allowDecimals={false} tickFormatter={v => num(v)} />
                <ChartTooltip content={<ChartTooltipContent formatter={v => [`${num(v as number)} ventes`, "Ventes du trimestre"]} />} />
                <Bar dataKey="count" fill="var(--color-count)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
            <p className="text-xs text-muted-foreground">En barres, le nombre de ventes de chaque trimestre : un marché qui ralentit vend moins. DVF publie les ventes avec environ six mois de retard{d.trend?.zone ? ` (dernière vente : ${month(d.trend.zone.to)})` : ""}.</p>
          </>
        ) : <p className="text-sm text-muted-foreground">Pas de ventes dans la zone.</p>}
      </CardContent>
    </Card>
  )
}

// What the budget buys in the zone: the price of each size of home, the m² it pays for, the share of the sales it
// reaches, and the spread of the sold prices with the listings on it
function BudgetCard({ d, type, listings }: { d: Dvf; type: PropertyType; listings: Listing[] }) {
  const { data } = useSearch()
  const budget = data.search.criteria.budget_max, ref = d.recent.median_ppm2, home = type === "flat" || type === "house"
  const pts = d.points, inBudget = budget && pts.length ? pts.filter(p => p.price <= budget).length / pts.length : null
  // 12 bins between the 5th and the 95th percentile, each in the color of its gap to the median
  const sorted = pts.map(p => p.ppm2).sort((a, b) => a - b), lo = sorted[Math.floor(sorted.length * 0.05)], hi = sorted[Math.ceil(sorted.length * 0.95) - 1]
  const width = lo != null && hi > lo ? (hi - lo) / 12 : null
  const bins = width ? Array.from({ length: 12 }, (_, i) => {
    const from = lo + i * width, to = from + width
    return { from: Math.round(from), to: Math.round(to), count: sorted.filter(x => x >= from && (i === 11 ? x <= to : x < to)).length, level: levelOf((from + to) / 2, ref) ?? "at" }
  }) : []
  const config = { count: { label: "Ventes", color: "var(--chart-3)" } } satisfies ChartConfig
  return (
    <Card>
      <CardHeader>
        <Title icon={WalletIcon} tone="var(--chart-3)">Mon budget</Title>
        <CardDescription>{budget ? `Budget max des critères : ${eur(budget)}.` : "Indiquez un budget max dans les critères pour situer vos moyens."} Ventes DVF de la zone, {d.by_rooms?.scope === "zone" ? "5 ans" : "2 ans"}.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {budget && (
          <div className="grid grid-cols-2 gap-3">
            {home && ref ? <div className="rounded-lg bg-muted/50 p-3"><div className="text-2xl font-bold tracking-tight">≈ {num(budget / ref)} m²</div><div className="text-xs text-muted-foreground">au prix médian vendu de la zone</div></div> : null}
            {inBudget != null && <div className="rounded-lg bg-muted/50 p-3"><div className="text-2xl font-bold tracking-tight">{share(inBudget)}</div><div className="text-xs text-muted-foreground">des ventes de la zone (2 ans) dans le budget</div></div>}
          </div>
        )}
        {home && d.by_rooms?.rows.length ? (
          <Table>
            <TableHeader><TableRow><TableHead>Taille</TableHead><TableHead className="text-right">Ventes</TableHead><TableHead className="text-right">Prix médian</TableHead><TableHead className="text-right">Surface</TableHead><TableHead className="text-right">{UNIT[type]}</TableHead></TableRow></TableHeader>
            <TableBody>
              {d.by_rooms.rows.map(r => {
                const fits = budget ? r.median_price <= budget : null
                return (
                  <TableRow key={r.rooms}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {fits != null && <i aria-hidden className="size-2 rounded-full" style={{ background: fits ? "var(--chart-3)" : "var(--at)" }} />}
                        {type === "house" ? `${r.rooms}${r.rooms === 5 ? "+" : ""} pièces` : `T${r.rooms}${r.rooms === 5 ? "+" : ""}`}
                        {fits && <span className="sr-only">dans le budget</span>}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{num(r.count)}</TableCell>
                    <TableCell className={cn("text-right font-semibold", fits === false && "text-muted-foreground")}>{eur(r.median_price)}</TableCell>
                    <TableCell className="text-right">{num(r.median_area)} m²</TableCell>
                    <TableCell className="text-right">{num(r.median_ppm2)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        ) : null}
        {budget && home && d.by_rooms?.rows.length ? <p className="-mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"><i aria-hidden className="size-2 rounded-full" style={{ background: "var(--chart-3)" }} />prix médian dans le budget</p> : null}
        {bins.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">Répartition des prix vendus ({UNIT[type]})</span>
            <ChartContainer config={config} className="aspect-auto h-32 w-full">
              <BarChart data={bins} margin={{ left: 16, right: 16 }} barCategoryGap={2}>
                <XAxis dataKey="from" tickLine={false} axisLine={false} interval={2} tickFormatter={v => num(v)} />
                <ChartTooltip content={<ChartTooltipContent hideIndicator labelFormatter={(_, p) => { const b = p?.[0]?.payload; return b ? `${num(b.from)} à ${num(b.to)} ${UNIT[type]}` : "" }} formatter={(v, _n, p) => [`${num(v as number)} ventes, ${LEVEL_LABEL[p.payload.level as keyof typeof LEVEL_LABEL]}`, ""]} />} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>{bins.map(b => <Cell key={b.from} fill={LEVEL_COLOR[b.level]} />)}</Bar>
              </BarChart>
            </ChartContainer>
            {d.recent.q1 && <Ruler stats={d.recent} ticks={listings.map(l => ({ id: l.id, ppm2: unitPrice(l) }))} />}
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {(["below", "at", "above"] as const).map(k => <span key={k} className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm" style={{ background: LEVEL_COLOR[k] }} />{LEVEL_LABEL[k]}</span>)}
              <span>· en dessous, vos annonces sur la médiane et les quartiles</span>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// the listings' follow-up as a market: the stock week by week, what came in and what went, the drops, the time
// online and the gap between asked and sold prices
function WatchCard({ type, listings }: { type: PropertyType; listings: Listing[] }) {
  const { data, marketOf } = useSearch()
  const [now] = useState(() => Date.now()), ref = marketOf(type).ref?.ppm2
  const gone = (l: Listing) => { const c = l.changes?.find(x => x.kind === "expired")?.date; return c ? Date.parse(c) : l.status === "EXPIRED" ? Date.parse(l.first_seen) : null }
  const live = listings.filter(l => gone(l) == null)
  const first = Math.min(...listings.map(l => Date.parse(l.first_seen)))
  const weeks = listings.length ? Math.min(26, Math.max(4, Math.ceil((now - first) / (7 * DAY)))) : 0
  const series = Array.from({ length: weeks }, (_, i) => {
    const end = now - (weeks - 1 - i) * 7 * DAY, start = end - 7 * DAY, at = (t: number | null) => t != null && t > start && t <= end
    return {
      week: day(end),
      online: listings.filter(l => Date.parse(l.first_seen) <= end && !((gone(l) ?? Infinity) <= end)).length,
      added: listings.filter(l => at(Date.parse(l.first_seen))).length,
      removed: listings.filter(l => at(gone(l))).length,
    }
  })
  const month30 = (t: number | null) => t != null && t > now - 30 * DAY
  const gaps = live.map(l => badge(unitPrice(l), ref)?.gap).filter((x): x is number => x != null)
  const days = live.map(l => daysOnline(l)).filter((x): x is number => x != null)
  const config = {
    online: { label: "En ligne", color: "var(--chart-2)" }, added: { label: "Nouvelles", color: "var(--chart-3)" }, removed: { label: "Retirées", color: "var(--chart-4)" },
  } satisfies ChartConfig
  const stats: [string, string][] = [
    ["En ligne", num(live.length)],
    ["Nouvelles (30 j)", num(listings.filter(l => month30(Date.parse(l.first_seen))).length)],
    ["Retirées (30 j)", num(listings.filter(l => month30(gone(l))).length)],
    ["En baisse", live.length ? share(live.filter(l => dropped(l) > 0).length / live.length) : "—"],
    ["En ligne depuis", days.length ? `${num(median(days))} j` : "—"],
    ["Affiché / vendu", gaps.length ? pct((median(gaps.map(g => g * 1000)) ?? 0) / 1000) : "—"],
  ]
  return (
    <Card>
      <CardHeader>
        <Title icon={EyeIcon} tone="var(--chart-4)">Veille des annonces</Title>
        <CardDescription>{data.search.mode === "stream-estate" ? "Les annonces de la zone suivies par la recherche, semaine par semaine." : "Les annonces trouvées par Claude, semaine par semaine : un échantillon, pas tout le marché."}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-6 xl:grid-cols-3 2xl:grid-cols-6">
          {stats.map(([k, v]) => <div key={k}><div className="text-lg font-bold tracking-tight">{v}</div><div className="text-xs text-muted-foreground">{k}</div></div>)}
        </div>
        {series.length ? (
          <ChartContainer config={config} className="aspect-auto h-52 w-full">
            <ComposedChart data={series} margin={{ left: 0, right: 8 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="week" tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tickLine={false} axisLine={false} width={28} allowDecimals={false} domain={[0, (max: number) => max + 1]} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="added" fill="var(--color-added)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="removed" fill="var(--color-removed)" radius={[4, 4, 0, 0]} />
              <Line dataKey="online" type="monotone" stroke="var(--color-online)" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ChartContainer>
        ) : <p className="text-sm text-muted-foreground">Pas encore d'annonce de ce type.</p>}
        <p className="text-xs text-muted-foreground">« Affiché / vendu » : l'écart médian entre le prix au m² des annonces en ligne et le prix vendu de la zone, la marge que les vendeurs se donnent.</p>
      </CardContent>
    </Card>
  )
}

// the streets of the commune with 5 sales or more, around the search: the nearest or the cheapest first
function StreetsCard({ d, type }: { d: Dvf; type: PropertyType }) {
  const { data } = useSearch()
  const [order, setOrder] = useState("near"), [all, setAll] = useState(false)
  const ref = d.recent.median_ppm2 ?? d.zone.median_ppm2, own = data.search.street?.code_voie
  const rows = (d.streets ?? []).toSorted((a, b) => (order === "near" ? (a.distance ?? 0) - (b.distance ?? 0) : a.median_ppm2 - b.median_ppm2))
  return (
    <Card>
      <CardHeader>
        <Title icon={MapPinnedIcon} tone="var(--below)">Prix par rue</Title>
        <CardDescription>Les rues de la commune ayant au moins 5 ventes ({d.years[0]}–{d.years.at(-1)}), leur écart au prix vendu de la zone et leur évolution sur les 2 dernières années.</CardDescription>
        <CardAction>
          <ToggleGroup type="single" variant="outline" size="sm" value={order} onValueChange={v => v && setOrder(v)} aria-label="Ordre">
            <ToggleGroupItem value="near">Plus proches</ToggleGroupItem>
            <ToggleGroupItem value="cheap">Moins chères</ToggleGroupItem>
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Rue</TableHead><TableHead className="text-right">Distance</TableHead><TableHead className="text-right">Ventes</TableHead><TableHead className="text-right">Médiane</TableHead><TableHead className="text-right">Écart</TableHead><TableHead className="text-right">Évolution</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.slice(0, all ? undefined : 12).map(s => (
              <TableRow key={s.code_voie} className={cn(s.code_voie === own && "bg-muted/50")}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2"><i aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: LEVEL_COLOR[levelOf(s.median_ppm2, ref) ?? "at"] }} />{titleCase(s.name)}{s.code_voie === own && <Badge variant="secondary">votre rue</Badge>}</span>
                </TableCell>
                <TableCell className="text-right text-muted-foreground">{s.distance == null ? "—" : s.distance < 1000 ? `${num(Math.round(s.distance / 10) * 10)} m` : `${String(Math.round(s.distance / 100) / 10).replace(".", ",")} km`}</TableCell>
                <TableCell className="text-right text-muted-foreground">{num(s.count)}</TableCell>
                <TableCell className="text-right font-semibold">{perUnit(s.median_ppm2, type)}</TableCell>
                <TableCell className="text-right"><Gap ppm2={s.median_ppm2} refPpm2={ref} /></TableCell>
                <TableCell className="text-right">{s.change == null ? <span className="text-muted-foreground">—</span> : <Delta x={s.change} label="" />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length > 12 && <Button variant="ghost" size="sm" className="self-start" onClick={() => setAll(!all)}>{all ? "Moins de rues" : `Voir les ${rows.length} rues`}</Button>}
      </CardContent>
    </Card>
  )
}

// the DPE of the homes around, one per home: the coming supply of homes to renovate
function DpeCard({ dpe, type }: { dpe: DpeClasses | null; type: "flat" | "house" }) {
  const { data } = useSearch()
  const own = dpe?.[type] ?? {}, total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)
  // a type with too few DPE around (houses in a city center) takes both
  const counts: Record<string, number> = total(own) >= 30 ? own : Object.fromEntries([..."ABCDEFG"].map(c => [c, (dpe?.flat[c] ?? 0) + (dpe?.house[c] ?? 0)]))
  const n = total(counts), poor = n ? ((counts.F ?? 0) + (counts.G ?? 0)) / n : null
  const z = data.search.zone
  return (
    <Card>
      <CardHeader>
        <Title icon={LeafIcon} tone="var(--chart-3)">DPE du quartier</Title>
        <CardDescription>{dpe ? `${num(n)} DPE ${counts === own ? (type === "flat" ? "d'appartements" : "de maisons") : "de logements"} ${dpe.scope === "zone" ? `à moins de ${z.radius_m} m du centre de la zone` : "dans la commune"} (ADEME, depuis 2021)` : "Indisponible pour l'instant."}</CardDescription>
      </CardHeader>
      {dpe && n > 0 && (
        <CardContent className="flex flex-col gap-3">
          <div className="flex h-7 overflow-hidden rounded-md" role="img" aria-label={[..."ABCDEFG"].map(c => `${c} ${share((counts[c] ?? 0) / n)}`).join(", ")}>
            {[..."ABCDEFG"].filter(c => counts[c]).map(c => (
              <div key={c} className="grid place-items-center text-xs font-bold" style={{ width: `${(counts[c] / n) * 100}%`, background: DPE_HEX[c], color: dpeInk(c) }} title={`${c} : ${share(counts[c] / n)} (${num(counts[c])})`}>
                {counts[c] / n >= 0.07 ? c : ""}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs">
            {[..."ABCDEFG"].map(c => <div key={c}><div className="font-semibold">{c}</div><div className="text-muted-foreground">{share((counts[c] ?? 0) / n)}</div></div>)}
          </div>
          <p className="text-sm"><b>{share(poor)}</b> de passoires (F et G) : la location leur sera interdite, en 2025 pour G et en 2028 pour F. Plus il y en a, plus les biens à rénover seront nombreux sur le marché.</p>
        </CardContent>
      )}
    </Card>
  )
}

// the property tax rate of the commune against France's: what the bill's rate will be (the bill is this rate times
// half the cadastral rental value, which the seller's last bill shows)
function TaxCard({ tax }: { tax: Tax | null }) {
  const rate = (x: number) => `${x.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`
  const top = tax ? Math.max(tax.total, tax.france ?? 0) : 1
  return (
    <Card>
      <CardHeader>
        <Title icon={ReceiptTextIcon} tone="var(--chart-4)">Taxe foncière</Title>
        <CardDescription>{tax ? `Taux ${tax.year} voté à ${titleCase(tax.city)} (DGFiP)` : "Indisponible pour l'instant."}</CardDescription>
      </CardHeader>
      {tax && (
        <CardContent className="flex flex-col gap-3">
          <div className="text-2xl font-bold tracking-tight">{rate(tax.total)}</div>
          <div className="flex flex-col gap-1.5 text-xs">
            {[[titleCase(tax.city), tax.total, "var(--chart-4)"], ["Moyenne de la France", tax.france, "var(--at)"]].map(([k, v, c]) => v != null && (
              <div key={k as string} className="flex items-center gap-2">
                <span className="w-36 shrink-0 text-muted-foreground">{k}</span>
                <div className="h-2.5 flex-1 rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${((v as number) / top) * 100}%`, background: c as string }} /></div>
                <span className="w-14 text-right font-medium">{rate(v as number)}</span>
              </div>
            ))}
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Part de la commune</dt><dd className="text-right">{rate(tax.commune)}</dd>
            <dt className="text-muted-foreground">{tax.epci_name}</dt><dd className="text-right">{rate(tax.epci)}</dd>
            <dt className="text-muted-foreground">Syndicats et taxes annexes</dt><dd className="text-right">{rate(Math.max(0, tax.total - tax.commune - tax.epci))}</dd>
            <dt className="text-muted-foreground">Ordures ménagères (à part)</dt><dd className="text-right">{rate(tax.waste)}</dd>
          </dl>
          <p className="text-xs text-muted-foreground">La taxe foncière vaut ce taux appliqué à la moitié de la valeur locative cadastrale : demandez au vendeur son dernier avis.</p>
        </CardContent>
      )}
    </Card>
  )
}

// the homes authorised and started each year: the new supply to come
function HousingCard({ housing }: { housing: Housing | null }) {
  const { data } = useSearch()
  const years = (housing?.years ?? []).slice(-10), last = years.at(-1)
  const config = { authorised: { label: "Autorisés", color: "var(--chart-3)" }, started: { label: "Commencés", color: "var(--chart-2)" } } satisfies ChartConfig
  return (
    <Card>
      <CardHeader>
        <Title icon={BuildingIcon} tone="var(--chart-2)">Logements neufs</Title>
        <CardDescription>{housing ? `${data.search.district ?? data.search.city}, chaque année (Sitadel${housing.release ? `, ${month(`${housing.release}-01`)}` : ""})` : "Indisponible pour l'instant."}</CardDescription>
      </CardHeader>
      {years.length > 0 && (
        <CardContent className="flex flex-col gap-2">
          <div className="flex items-baseline gap-2"><span className="text-2xl font-bold tracking-tight">{num(last?.authorised)}</span><span className="text-xs text-muted-foreground">logements autorisés en {last?.year}</span></div>
          <ChartContainer config={config} className="aspect-auto h-40 w-full">
            <BarChart data={years} margin={{ left: 0, right: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="year" tickLine={false} axisLine={false} tickFormatter={y => `${String(y).slice(2)}`} />
              <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={v => num(v)} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="authorised" fill="var(--color-authorised)" radius={[4, 4, 0, 0]} />
              <Bar dataKey="started" fill="var(--color-started)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ChartContainer>
          <p className="text-xs text-muted-foreground">Beaucoup de neuf à venir, c'est plus d'offre et moins de pression sur les prix de l'ancien. La dernière année est encore incomplète.</p>
        </CardContent>
      )}
    </Card>
  )
}

const FILTER = { all: "Toutes", below: "Sous le marché", at: "Au prix", above: "Au-dessus" } as const
// the zone's last sales, each with its gap to the zone's median in color
function SalesCard({ d, type }: { d: Dvf; type: PropertyType }) {
  const [filter, setFilter] = useState<keyof typeof FILTER>("all"), [n, setN] = useState(15)
  const ref = d.recent.median_ppm2
  const sales = d.points.toReversed().filter(p => filter === "all" || (levelOf(p.ppm2, ref) ?? "at") === filter)
  return (
    <Card>
      <CardHeader>
        <Title icon={HouseIcon} tone="var(--chart-2)">Ventes récentes dans la zone</Title>
        <CardDescription>DVF, 2 dernières années, {TYPE_PLURAL[type].toLowerCase()} : {num(d.recent.count)} ventes, médiane {perUnit(ref, type)}</CardDescription>
        <CardAction>
          <ToggleGroup type="single" variant="outline" size="sm" value={filter} onValueChange={v => v && (setFilter(v as keyof typeof FILTER), setN(15))} className="flex-wrap justify-end" aria-label="Filtrer les ventes">
            {Object.entries(FILTER).map(([k, v]) => <ToggleGroupItem key={k} value={k}>{k !== "all" && <i aria-hidden className="size-2 rounded-full" style={{ background: LEVEL_COLOR[k as keyof typeof LEVEL_COLOR] }} />}{v}</ToggleGroupItem>)}
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 overflow-x-auto">
        <Table>
          <TableHeader><TableRow><TableHead>Vente</TableHead><TableHead>Adresse</TableHead><TableHead className="text-right">Prix</TableHead><TableHead className="text-right">{type === "parking" ? "€ la place" : UNIT[type]}</TableHead><TableHead className="text-right">Écart</TableHead></TableRow></TableHeader>
          <TableBody>
            {sales.slice(0, n).map(p => {
              const level = levelOf(p.ppm2, ref) ?? "at"
              return (
                <TableRow key={p.id} style={{ boxShadow: `inset 3px 0 0 ${LEVEL_COLOR[level]}` }}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{date(p.date)}</TableCell>
                  <TableCell>
                    <span className="flex flex-col">
                      <span className="font-medium">{titleCase(p.address)}</span>
                      <span className="text-xs text-muted-foreground">{[p.rooms && (type === "flat" ? `T${p.rooms}` : `${p.rooms} pièces`), p.area && `${num(p.area)} m²`].filter(Boolean).join(" · ") || "—"}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-semibold whitespace-nowrap">{eur(p.price)}</TableCell>
                  <TableCell className="text-right whitespace-nowrap">{num(p.ppm2)}</TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex rounded-md px-1.5 py-0.5" style={{ background: `color-mix(in oklab, ${LEVEL_COLOR[level]} 16%, transparent)` }}><Gap ppm2={p.ppm2} refPpm2={ref} /></span>
                  </TableCell>
                </TableRow>
              )
            })}
            {!sales.length && <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">Aucune vente pour ce filtre.</TableCell></TableRow>}
          </TableBody>
        </Table>
        {sales.length > n && <Button variant="ghost" size="sm" className="self-start" onClick={() => setN(n + 30)}>Voir plus de ventes ({num(sales.length - n)})</Button>}
      </CardContent>
    </Card>
  )
}
