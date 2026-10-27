import { BarChart3Icon } from "lucide-react"
import { useState } from "react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"

import { useRun } from "@/components/run-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TypeIcon } from "@/components/type-icon"
import type { PropertyType } from "@/lib/api"
import { date, eur, m2, num, perUnit, TYPE_PLURAL, UNIT } from "@/lib/format"
import { useSearch } from "@/lib/store"

const config = {
  sold: { label: "Vendu (DVF, médiane des trimestres d'au moins 3 ventes)", color: "var(--chart-1)" },
  asking: { label: "Affiché (Stream Estate, médiane du mois)", color: "var(--chart-2)" },
} satisfies ChartConfig

const PUBLISHER: Record<string, string> = { PRIVATE_INDIVIDUAL: "Particuliers", REAL_ESTATE_AGENCY: "Agences", COMMERCIAL_AGENT: "Agents commerciaux", MANDATED_AGENT: "Mandataires" }

function Kpi({ title, value, sub }: { title: string; value: string; sub: string }) {
  return (
    <Card size="sm">
      <CardHeader><CardDescription>{title}</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-1">
        <span className="text-2xl font-bold tracking-tight">{value}</span>
        <span className="text-xs text-muted-foreground">{sub}</span>
      </CardContent>
    </Card>
  )
}

export function MarketTab() {
  const { slug, data, state, types } = useSearch()
  const run = useRun()
  const [type, setType] = useState<PropertyType>(types[0])
  // the asking prices and their analytics are those of the search's first type (Stream Estate)
  const d = data.market.dvf?.[type], se = data.market.stream && (data.market.stream.type ?? "flat") === type ? data.market.stream : undefined
  const streamOn = state.stream_estate && data.search.mode === "stream-estate", u = (n: number | null | undefined) => perUnit(n, type)
  const rents = data.market.rent && !("error" in data.market.rent) ? data.market.rent : null
  const rent = rents && (type === "flat" || type === "house") ? rents[type] : null
  // one time axis in months: a quarter's sold median sits on its middle month
  const rows = new Map<string, { month: string; sold?: number; asking?: number }>()
  // a quarter of one or two sales says nothing (a single house, a typo): only those of 3 sales and more
  for (const q of (d?.zone.by_quarter ?? []).filter(q => q.count >= 3)) {
    const month = `${q.quarter.slice(0, 4)}-${String((+q.quarter.slice(6) - 1) * 3 + 2).padStart(2, "0")}`
    rows.set(month, { month, sold: q.median_ppm2 })
  }
  for (const x of se?.trend?.data ?? []) {
    const month = String(x.group.time_bucket ?? x.group.event_at ?? "").slice(0, 7)
    if (month) rows.set(month, { ...rows.get(month), month, asking: x.metrics["median:price_per_sqm"] })
  }
  const series = [...rows.values()].sort((a, b) => a.month.localeCompare(b.month))
  const online = se?.online?.data?.[0]?.metrics

  return (
    <div className="flex flex-col gap-4 p-4">
      {types.length > 1 && (
        <ToggleGroup type="single" variant="outline" size="sm" value={type} onValueChange={v => v && setType(v as PropertyType)} className="self-start" aria-label="Type de bien">
          {types.map(t => <ToggleGroupItem key={t} value={t}><TypeIcon type={t} />{TYPE_PLURAL[t]}</ToggleGroupItem>)}
        </ToggleGroup>
      )}
      {data.market.alsace_moselle && (
        <Alert><AlertTitle>Pas de ventes DVF en Alsace-Moselle</AlertTitle><AlertDescription>Le Bas-Rhin, le Haut-Rhin et la Moselle tiennent leur propre livre foncier, absent de DVF. Les ventes réconciliées de Stream Estate peuvent le compléter.</AlertDescription></Alert>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi title="Vendu, zone (2 ans)" value={u(d?.recent.median_ppm2)} sub={`${num(d?.recent.count)} ventes DVF`} />
        <Kpi title={`Vendu, ${data.search.street?.name ?? "rue"}`} value={u(d?.street?.median_ppm2)} sub={d?.street ? `${num(d.street.count)} ventes, ${d.years.length} ans` : "Recherche sans rue"} />
        <Kpi title="Vendu, commune" value={u(d?.commune.median_ppm2)} sub={`${num(d?.commune.count)} ventes, ${d?.years.length ?? 0} ans`} />
        <Kpi title="Loyer, commune" value={rent ? `${String(rent.per_m2).replace(".", ",")} €/m²` : "—"} sub={rent ? `par mois charges comprises, carte des loyers ${rents!.year}` : type === "flat" || type === "house" ? "Pas de loyer de référence" : "Logements seulement"} />
        <Kpi title="Affiché, zone" value={m2(se?.trend?.data?.at(-1)?.metrics["median:price_per_sqm"])} sub={se ? "Dernier mois, Stream Estate" : "Nécessite Stream Estate"} />
        <Kpi title="Durée en ligne" value={online ? `${num(online["median:days_between_events"])} j` : "—"} sub={online ? `médiane, ${num(online.count)} annonces retirées en 1 an` : "Nécessite Stream Estate"} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{type === "parking" ? "Prix d'une place" : type === "land" ? "Prix au m² de terrain" : "Prix au m²"}, vendu{se ? " et affiché" : ""}</CardTitle>
          <CardDescription>Zone de la recherche ({data.search.zone.label})</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" disabled={!streamOn} title={streamOn ? undefined : "Nécessite Stream Estate"} onClick={() => run({ cmd: "market", slug, label: "Analyses du marché (Stream Estate)" })}>
              <BarChart3Icon data-icon="inline-start" />{se ? "Mettre à jour l'affiché" : "Ajouter l'affiché"}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {series.length ? (
            <ChartContainer config={config} className="aspect-auto h-64 w-full">
              <LineChart data={series} margin={{ left: 8, right: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="month" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={m => `${m.slice(5)}/${m.slice(2, 4)}`} />
                <YAxis tickLine={false} axisLine={false} width={56} domain={["auto", "auto"]} tickFormatter={v => num(v)} />
                <ChartTooltip content={<ChartTooltipContent formatter={(v, n) => [n === "asking" ? m2(v as number) : u(v as number), config[n as keyof typeof config]?.label]} />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Line dataKey="sold" type="monotone" stroke="var(--color-sold)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                {se && <Line dataKey="asking" type="monotone" stroke="var(--color-asking)" strokeWidth={2} dot={false} connectNulls />}
              </LineChart>
            </ChartContainer>
          ) : <p className="text-sm text-muted-foreground">Pas de ventes dans la zone.</p>}
        </CardContent>
      </Card>
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
          <AlertTitle>Prix affichés et durée en ligne : Stream Estate</AlertTitle>
          <AlertDescription>{state.stream_estate ? "Cette recherche est en mode Classique. Passez-la en mode Stream Estate pour ajouter les prix affichés, la durée en ligne et les ventes des notaires." : "Sans clé Stream Estate, le marché repose sur les ventes réelles DVF, gratuites. La clé ajoute les prix affichés, la durée en ligne et les ventes des notaires."}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader><CardTitle>Ventes récentes dans la zone</CardTitle><CardDescription>DVF, 2 dernières années, {TYPE_PLURAL[type].toLowerCase()}</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Adresse</TableHead><TableHead className="text-right">Surface</TableHead><TableHead className="text-right">Pièces</TableHead><TableHead className="text-right">Prix</TableHead><TableHead className="text-right">{type === "parking" ? "€ la place" : UNIT[type]}</TableHead></TableRow></TableHeader>
            <TableBody>
              {(d?.points ?? []).toReversed().slice(0, 40).map(p => (
                <TableRow key={p.id}><TableCell>{date(p.date)}</TableCell><TableCell>{p.address}</TableCell><TableCell className="text-right">{p.area ? `${p.area} m²` : "—"}</TableCell><TableCell className="text-right">{p.rooms ?? "—"}</TableCell><TableCell className="text-right">{eur(p.price)}</TableCell><TableCell className="text-right font-medium">{num(p.ppm2)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
