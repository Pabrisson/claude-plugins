import { parseLatLon } from "@engine/geo.js"
import { useEffect, useState } from "react"
import { Bar, BarChart, XAxis, YAxis } from "recharts"
import { toast } from "sonner"

import { Icon } from "@/components/icon"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { api, type CalibrationView, type CaseIndex, type Truth } from "@/lib/api"
import { locale, t } from "@/lib/i18n"
import { caseHref, go } from "@/lib/route"
import { TONE } from "@/lib/tones"

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)} %`)
const km = (v: number | null) => (v == null ? "—" : v < 1 ? `${Math.round(v * 1000)} m` : `${new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 }).format(v)} km`)
const HIT = (v: boolean | null) => (v == null ? { label: "{what} unknown", icon: "circle-help", tone: TONE.amber } : v ? { label: "{what} right", icon: "circle-check", tone: TONE.emerald } : { label: "{what} wrong", icon: "circle-x", tone: TONE.rose })
const LEVEL = { high: TONE.emerald, medium: TONE.amber, low: TONE.neutral } as const

function Hit({ what, v }: { what: string; v: boolean | null }) {
  const h = HIT(v)
  return <Badge className={`gap-1 ${h.tone}`}><Icon name={h.icon} aria-hidden />{t(h.label, { what })}</Badge>
}

// Calibration: the gut call written before the tools, the answer, the ground truth once known, the folder's scoreboard
export function CalibrationWidget({ index, pulse }: { index: CaseIndex; pulse: number }) {
  const slug = index.slug, [cal, setCal] = useState<CalibrationView | null>(null), [ask, setAsk] = useState(false)
  useEffect(() => { api.view<CalibrationView>(slug, "calibration").then(setCal, () => setCal(null)) }, [slug, pulse])
  const c = index.conclusion, ans = c ? index.notes.find(n => n.folder === "Hypotheses" && n.props.id === c.answer) : null, truth = cal?.truth ?? null, board = cal?.scoreboard ?? null
  return (
    <div className="flex flex-col gap-6 py-4">
      <section aria-labelledby="cal-gut" className="flex flex-col gap-2">
        <h2 id="cal-gut" className="text-sm font-semibold">{t("Gut call (before tools)")}</h2>
        {cal?.gut ? (
          <div className="flex flex-col gap-2 rounded-xl p-3 ring-1 ring-foreground/10">
            <ol className="flex flex-col gap-2">
              {cal.gut.ranked.map(r => (
                <li key={r.place} className="flex flex-col gap-0.5 text-sm">
                  <span className="flex items-center gap-2"><span className="w-28 truncate font-medium">{r.place}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, r.p)}%` }} /></span><span className="w-10 text-right text-xs tabular-nums">{r.p} %</span></span>
                  {r.cues && <span className="text-xs text-muted-foreground">{r.cues}</span>}
                </li>
              ))}
            </ol>
            {cal.gut.region && <p className="text-xs"><span className="text-muted-foreground">{t("Region hunch: ")}</span>{cal.gut.region}</p>}
            <p className="text-xs"><span className="text-muted-foreground">{t("Would change my mind: ")}</span>{cal.gut.would_change}</p>
          </div>
        ) : <p className="text-sm text-muted-foreground">{t("No gut call yet (geolocate-image gut)")}</p>}
      </section>
      <section aria-labelledby="cal-answer" className="flex flex-col gap-2">
        <h2 id="cal-answer" className="text-sm font-semibold">{t("Answer")}</h2>
        {c ? (
          <div className="flex flex-col gap-2 rounded-xl p-3 text-sm ring-1 ring-foreground/10">
            <p>{ans ? <button type="button" className="font-medium hover:underline" onClick={() => go(caseHref(slug, "brain", ans.path))}><span className="mr-1.5 font-mono text-xs text-muted-foreground">{c.answer}</span>{ans.title}</button> : c.answer}
              {c.radius_m != null && <span className="ml-2 text-xs text-muted-foreground">{t("radius {r} m", { r: c.radius_m })}</span>}</p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(c.confidence).map(([level, v]) => (
                <Tooltip key={level}><TooltipTrigger asChild><Badge className={`gap-1 ${LEVEL[v]}`}>{t("{level}: {v}", { level, v: t(v) })}</Badge></TooltipTrigger><TooltipContent>{c.criteria[level] ?? "—"}</TooltipContent></Tooltip>
              ))}
            </div>
          </div>
        ) : <p className="text-sm text-muted-foreground">{t("Not concluded yet")}</p>}
      </section>
      <section aria-labelledby="cal-truth" className="flex flex-col gap-2">
        <div className="flex items-center gap-2"><h2 id="cal-truth" className="mr-auto text-sm font-semibold">{t("Ground truth")}</h2>
          <Tooltip><TooltipTrigger asChild><span><Button type="button" size="sm" variant="outline" disabled={!c} onClick={() => setAsk(true)}><Icon name="map-pin-check" data-icon="inline-start" aria-hidden />{truth ? t("Change") : t("Set true location")}</Button></span></TooltipTrigger>
            {!c && <TooltipContent>{t("Conclude first: the truth is scored against the answer")}</TooltipContent>}</Tooltip></div>
        {truth ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl p-3 text-sm ring-1 ring-foreground/10">
            <span className="font-semibold tabular-nums" data-testid="truth-error">{km(truth.error_km)}</span><span className="text-muted-foreground">{t("off · score")}</span><span className="font-semibold tabular-nums">{truth.score ?? "—"}</span><span className="text-muted-foreground">/ {new Intl.NumberFormat(locale()).format(5000)}</span>
            <Hit what={t("country")} v={truth.country_hit} /><Hit what={t("region")} v={truth.region_hit} /><Hit what={t("gut call")} v={truth.gut_hit} />
            {truth.answer.confidence && <Badge variant="outline">{t("stated {confidence}", { confidence: t(truth.answer.confidence) })}</Badge>}
          </div>
        ) : <p className="text-sm text-muted-foreground">{t("Not set")}</p>}
      </section>
      <section aria-labelledby="cal-board" className="flex flex-col gap-3">
        <h2 id="cal-board" className="text-sm font-semibold">{t("Scoreboard")}</h2>
        {board && board.cases ? <Board board={board} slug={slug} /> : <p className="text-sm text-muted-foreground">{t("No case with a truth yet")}</p>}
      </section>
      <TruthDialog open={ask} onClose={() => setAsk(false)} slug={slug} onDone={(r: Truth) => { toast.success(t("Truth recorded: {km} off", { km: km(r.error_km) })); setAsk(false); api.view<CalibrationView>(slug, "calibration").then(setCal, () => {}) }} />
    </div>
  )
}

function Board({ board: b, slug }: { board: NonNullable<CalibrationView["scoreboard"]>; slug: string }) {
  const tiles: [string, string][] = [[t("Scored cases"), String(b.cases)], [t("Median error"), km(b.median_km)], [t("Mean score"), b.mean_score == null ? "—" : String(b.mean_score)], [t("Country right"), pct(b.country_rate)], [t("Gut call's country right"), pct(b.gut_country_rate)]]
  const bars = (["1", "25", "200", "750", "2500"] as const).map(k => ({ k: `${new Intl.NumberFormat(locale()).format(Number(k))} km`, v: Math.round((b.within[k] ?? 0) * 100) }))
  const config = { v: { label: t("Cases within"), color: "var(--type-1)" } } satisfies ChartConfig
  return (
    <>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">{tiles.map(([k, v]) => <li key={k} className="rounded-xl p-3 ring-1 ring-foreground/10"><div className="text-xs text-muted-foreground">{k}</div><div className="text-lg font-semibold tabular-nums">{v}</div></li>)}</ul>
      <figure className="rounded-xl p-3 ring-1 ring-foreground/10">
        <figcaption className="mb-1 text-xs text-muted-foreground">{t("Share of cases within a distance of the truth")}</figcaption>
        <ChartContainer config={config} className="aspect-auto h-32 w-full">
          <BarChart data={bars} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
            <XAxis dataKey="k" tickLine={false} axisLine={false} fontSize={11} /><YAxis hide domain={[0, 100]} />
            <ChartTooltip cursor={{ fill: "var(--muted)" }} content={<ChartTooltipContent hideIndicator formatter={v => `${v} %`} />} />
            <Bar dataKey="v" fill="var(--color-v)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ChartContainer>
      </figure>
      <div className="overflow-x-auto rounded-xl ring-1 ring-foreground/10">
        <table className="w-full text-left text-xs"><caption className="p-2 text-left text-muted-foreground">{t("Calibration by stated confidence")}</caption>
          <thead className="text-muted-foreground"><tr><th className="p-2 font-medium">{t("Stated")}</th><th className="p-2 font-medium">{t("Cases")}</th><th className="p-2 font-medium">{t("Median error")}</th><th className="p-2 font-medium">{t("Within 25 km")}</th><th className="p-2 font-medium">{t("Within 200 km")}</th></tr></thead>
          <tbody className="divide-y">{(["high", "medium", "low"] as const).map(k => <tr key={k}><td className="p-2">{t(k)}</td><td className="p-2 tabular-nums">{b.by_confidence[k].n}</td><td className="p-2 tabular-nums">{km(b.by_confidence[k].median_km)}</td><td className="p-2 tabular-nums">{pct(b.by_confidence[k].within_25)}</td><td className="p-2 tabular-nums">{pct(b.by_confidence[k].within_200)}</td></tr>)}</tbody></table>
      </div>
      <ul className="flex flex-col divide-y rounded-xl text-sm ring-1 ring-foreground/10">{b.rows.map(r => <li key={r.slug} className="flex items-center gap-3 p-2"><a className="min-w-0 flex-1 truncate hover:underline" href={caseHref(r.slug)}>{r.slug === slug ? t("{slug} (this case)", { slug: r.slug }) : r.slug}</a><span className="tabular-nums">{km(r.error_km)}</span><span className="w-12 text-right tabular-nums text-muted-foreground">{r.score ?? "—"}</span></li>)}</ul>
    </>
  )
}

function TruthDialog({ open, onClose, slug, onDone }: { open: boolean; onClose: () => void; slug: string; onDone: (t: Truth) => void }) {
  const [v, setV] = useState(""), [msg, setMsg] = useState<string | null>(null), [busy, setBusy] = useState(false)
  async function send() {
    const ll = parseLatLon(v)
    if (!ll) return setMsg(t("Decimal degrees: 38.5728, -7.9076"))
    setMsg(null); setBusy(true)
    try { onDone(await api.truth(slug, ll[0], ll[1])); setV("") } catch (e) { setMsg((e as Error).message) }
    setBusy(false)
  }
  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("Set true location")}</DialogTitle><DialogDescription>{t("The case is scored against it: error, world-map score, country, region and the gut call.")}</DialogDescription></DialogHeader>
        <form onSubmit={e => { e.preventDefault(); send() }} className="flex flex-col gap-2">
          <label htmlFor="truth-ll" className="text-sm font-medium">{t("Latitude, longitude")}</label>
          <Input id="truth-ll" value={v} onChange={e => setV(e.target.value)} placeholder="38.5728, -7.9076" autoComplete="off" aria-invalid={!!msg || undefined} />
          {msg && <p role="alert" className="text-sm whitespace-pre-wrap text-destructive">{msg}</p>}
          <DialogFooter><Button type="submit" disabled={busy}>{t("Record")}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
