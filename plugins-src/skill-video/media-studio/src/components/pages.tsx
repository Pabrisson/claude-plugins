import { useEffect, useState } from "react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { api, money, per1000, type Balances, type Job, type Kind, type LedgerLine, type State, type Tool } from "@/lib/api"
import { Chips, Label, MultiChips } from "@/components/chips"
import { ElementsTab, type ElementDraft, type Use } from "@/components/elements"
import { StylesTab } from "@/components/styles"
import { isRunning, Results, type Bridge } from "@/components/results"
import { Viewer } from "@/components/viewer"

const KINDS: Kind[] = ["image", "video", "audio"]
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

export function Side({ children }: { children: React.ReactNode }) {
  return <aside className="flex min-h-0 flex-col gap-5 overflow-auto border-r bg-background p-4">{children}</aside>
}
export function Main({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="flex min-h-0 flex-col gap-5 overflow-auto bg-canvas px-6 py-5">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <span className="flex-1" />
        {aside}
      </div>
      {children}
    </main>
  )
}

// ---------- Library ----------

// the Library's tab lives in the URL (#library/elements), so a result's « Make an element » lands on it
const TABS = ["media", "elements", "styles"] as const
type Tab = (typeof TABS)[number]
const tabOf = (): Tab => TABS.find((t) => t !== "media" && window.location.hash.endsWith(`/${t}`)) ?? "media"

export function Library({
  state,
  tools,
  engine,
  onBridge,
  draft,
  onDraftUsed,
  onUse,
  onChanged,
}: {
  state: State
  tools: Record<Kind, Tool[]>
  engine: string
  onBridge: (b: Bridge, job: Job, file: string) => void
  draft: ElementDraft | null
  onDraftUsed: () => void
  onUse: Use
  onChanged: () => void
}) {
  const [tab, setTab] = useState<Tab>(tabOf)
  useEffect(() => {
    const on = () => setTab(tabOf())
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  const [kind, setKind] = useState<"all" | Kind>("all")
  const [provider, setProvider] = useState("all")
  const [favorites, setFavorites] = useState(false)
  const jobs = state.media.filter(
    (j) => (kind === "all" || j.kind === kind) && (provider === "all" || j.provider === provider) && (!favorites || j.favorite)
  )
  const tabs = (
    <Chips
      options={TABS}
      value={tab}
      label={(t) => ({ media: "Media", elements: "Elements", styles: "Styles" })[t]}
      onChange={(t) => (window.location.hash = t === "media" ? "library" : `library/${t}`)}
      className="grid grid-cols-3 [&>button]:px-1"
    />
  )
  if (tab === "elements") return <ElementsTab tabs={tabs} state={state} tools={tools.image} engine={engine} draft={draft} onDraftUsed={onDraftUsed} onUse={onUse} onChanged={onChanged} />
  if (tab === "styles")
    return <StylesTab tabs={tabs} state={state} options={tools.image.find((t) => t.id === "restyle")?.fields.find((f) => f.type === "style")?.options ?? []} engine={engine} onUse={onUse} onChanged={onChanged} />
  return (
    <>
      <Side>
        {tabs}
        <div>
          <Label>Medium</Label>
          <Chips options={["all", ...KINDS] as const} value={kind} label={(k) => (k === "all" ? "All" : cap(k))} onChange={setKind} />
        </div>
        <div>
          <Label>Made with</Label>
          <Chips
            options={["all", "openrouter", "elevenlabs", "local"]}
            value={provider}
            label={(p) => ({ all: "All", openrouter: "OpenRouter", elevenlabs: "ElevenLabs", local: "Local" })[p] ?? p}
            onChange={setProvider}
          />
        </div>
        <div>
          <Label>Show</Label>
          <Chips options={["all", "favorites"] as const} value={favorites ? "favorites" : "all"} label={(f) => (f === "all" ? "Everything" : "Favorites")} onChange={(f) => setFavorites(f === "favorites")} />
        </div>
      </Side>
      <Main title="Library" aside={<span className="text-sm text-muted-foreground">{jobs.length} items</span>}>
        <Results jobs={jobs} home={state.home} per1000={per1000(state)} onBridge={onBridge} empty={<p className="text-sm text-muted-foreground">Nothing here yet: what you generate lands here, by you or by Claude.</p>} />
      </Main>
    </>
  )
}

// ---------- Credits ----------

type Period = "7d" | "month" | "all"
const sum = (lines: LedgerLine[]) => lines.reduce((a, l) => a + (l.actual ?? l.estimate ?? 0), 0)

function Bars({ days, lines, series }: { days: string[]; lines: LedgerLine[]; series: { key: Kind; color: string }[] }) {
  const per = days.map((d) => series.map((s) => sum(lines.filter((l) => l.at.startsWith(d) && l.kind === s.key))))
  const max = Math.max(...per.map((x) => x.reduce((a, b) => a + b, 0)), 0)
  return (
    <div className="mt-3 flex h-28 items-end gap-[3px]" role="img" aria-label="Spend per day">
      {per.map((vals, i) => (
        <div key={days[i]} className="flex h-full flex-1 flex-col-reverse gap-px" title={`${days[i]}: ${vals.reduce((a, b) => a + b, 0).toFixed(2)}`}>
          {vals.map((v, j) => (v > 0 ? <div key={j} className="rounded-[2px]" style={{ height: `${(v / (max || 1)) * 100}%`, background: series[j].color }} /> : null))}
        </div>
      ))}
    </div>
  )
}

export function Credits({ state, balances, onBridge }: { state: State; balances: Balances | null; onBridge: (b: Bridge, job: Job, file: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>("month")
  const [provider, setProvider] = useState<"both" | "openrouter" | "elevenlabs">("both")
  const [kinds, setKinds] = useState<Kind[]>(KINDS)
  const [by, setBy] = useState<string[]>(["dashboard", "claude"])
  const [ledger, setLedger] = useState<LedgerLine[]>([])
  const finished = state.media.filter((j) => j.status === "done" || j.status === "failed").length
  useEffect(() => {
    api.ledger().then(setLedger, () => {})
  }, [finished])

  const usd = per1000(state), plan = state.settings.elevenlabs.plan
  const now = new Date(), month = now.toISOString().slice(0, 7)
  const since = period === "7d" ? new Date(now.getTime() - 6 * 864e5).toISOString().slice(0, 10) : period === "month" ? `${month}-01` : "0000"
  const lines = ledger.filter((l) => l.at.slice(0, 10) >= since && kinds.includes(l.kind) && by.includes(l.by))
  const or = lines.filter((l) => l.provider === "openrouter"), el = lines.filter((l) => l.provider === "elevenlabs")
  const today = now.toISOString().slice(0, 10)
  const end = Date.parse(today), n = period === "7d" ? 7 : period === "month" ? new Date(end).getUTCDate() : 30
  const days = Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * 864e5).toISOString().slice(0, 10))
  const running = state.media.filter((j) => (j.status === "running" || j.status === "queued") && j.provider !== "local")
  const rows = [
    ...running.map((j) => ({ key: j.id, at: j.created, label: j.label, model: j.name, unit: j.estimate.unit, estimate: j.estimate.amount, actual: null as number | null, known: false, status: "running", by: j.by, provider: j.provider, job: null as string | null })),
    ...[...lines].reverse().map((l) => {
      const job = state.media.find((j) => j.id === l.id)
      return { key: `${l.id}-${l.at}`, at: l.at, label: l.label, model: job?.name ?? l.model, unit: l.unit, estimate: l.estimate, actual: l.actual, known: !!l.actual_known, status: l.status, by: l.by, provider: l.provider, job: job && !isRunning(job) ? job.id : null }
    }),
  ].filter((r) => provider === "both" || r.provider === provider)

  const ob = balances?.openrouter, eb = balances?.elevenlabs
  const orSpent = sum(or), elSpent = sum(el)
  const limits = state.settings
  const noLimits = [limits.openrouter, limits.elevenlabs].every((l) => l.threshold == null && l.cap == null)

  return (
    <>
      <Side>
        <div>
          <Label>Period</Label>
          <Chips options={["7d", "month", "all"] as const} value={period} label={(p) => ({ "7d": "7 days", month: "This month", all: "All" })[p]} onChange={setPeriod} />
        </div>
        <div>
          <Label>Provider</Label>
          <Chips options={["both", "openrouter", "elevenlabs"] as const} value={provider} label={(p) => ({ both: "Both", openrouter: "OpenRouter", elevenlabs: "ElevenLabs" })[p]} onChange={setProvider} />
        </div>
        <div>
          <Label>Medium</Label>
          <MultiChips options={KINDS} value={kinds} label={cap} onChange={setKinds} />
        </div>
        <div>
          <Label>By</Label>
          <MultiChips options={["dashboard", "claude"]} value={by} label={(b) => (b === "claude" ? "Claude" : "Dashboard")} onChange={setBy} />
        </div>
        <p className="rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground">
          {noLimits
            ? "No confirmation threshold and no monthly cap are set: every click on a paid button spends. Set them in Settings."
            : `Limits: OpenRouter ${limits.openrouter.threshold != null ? `asks above $${limits.openrouter.threshold}` : "never asks"}${limits.openrouter.cap != null ? `, caps at $${limits.openrouter.cap} a month` : ""}. ElevenLabs ${limits.elevenlabs.threshold != null ? `asks above ${limits.elevenlabs.threshold} credits` : "never asks"}${limits.elevenlabs.cap != null ? `, caps at ${limits.elevenlabs.cap} credits a month` : ""}.`}
        </p>
      </Side>
      <Main title="Credits" aside={<span className="text-sm text-muted-foreground">{now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>}>
        <div className="grid gap-3.5 lg:grid-cols-2">
          {provider !== "elevenlabs" && (
            <div className="rounded-2xl border bg-card p-4">
              <div className="text-sm text-muted-foreground">OpenRouter, USD</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">
                {money(orSpent, "usd")} <span className="text-sm font-normal text-muted-foreground">spent {period === "7d" ? "in 7 days" : period === "month" ? "this month" : "in all"}</span>
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {!ob ? "Loading the balance…" : ob.error ? (ob.error === "no key" ? "No key set: see Settings" : ob.error)
                  : [ob.account_left != null && `$${ob.account_left.toFixed(2)} left on the account`, ob.key_left != null ? `$${ob.key_left.toFixed(2)} left on this key` : "no limit on this key", ob.account_left == null && "add a management key to see the account balance"].filter(Boolean).join(" · ")}
                {limits.openrouter.cap != null && ` · cap $${limits.openrouter.cap} a month, $${state.month.openrouter.toFixed(2)} used`}
              </div>
              <Bars days={days} lines={or} series={KINDS.map((k) => ({ key: k, color: `var(--${k === "image" ? "img" : k === "video" ? "vid" : "aud"})` }))} />
              <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
                {KINDS.map((k) => (
                  <span key={k} className="flex items-center gap-1.5">
                    <i className="size-2 rounded-[2px]" style={{ background: `var(--${k === "image" ? "img" : k === "video" ? "vid" : "aud"})` }} />
                    {k === "audio" ? "Voice" : cap(k)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {provider !== "openrouter" && (
            <div className="rounded-2xl border bg-card p-4">
              <div className="text-sm text-muted-foreground">ElevenLabs, credits</div>
              <div className="mt-1 text-3xl font-semibold tabular-nums">
                {Math.round(elSpent).toLocaleString("en-US")} credits{" "}
                {usd ? <span className="text-sm font-normal text-muted-foreground">{money((elSpent * usd) / 1000, "usd")}</span> : null}
              </div>
              {eb && !eb.error && eb.limit ? (
                <div className="mt-3 h-1.5 overflow-hidden rounded bg-muted">
                  <div className="h-full bg-cost" style={{ width: `${Math.min(100, (100 * (eb.limit - (eb.left ?? 0))) / eb.limit)}%` }} />
                </div>
              ) : null}
              <div className="mt-1.5 text-sm text-muted-foreground">
                {!eb ? "Loading the balance…" : eb.error ? (eb.error === "no key" ? "No key set: see Settings" : eb.error)
                  : `${(eb.left ?? 0).toLocaleString("en-US")} of ${(eb.limit ?? 0).toLocaleString("en-US")} left${eb.reset ? `, renewed ${eb.reset}` : ""}`}
                {usd ? ` · ${cap(plan ?? "")} plan, $${usd} per 1,000 credits` : ""}
              </div>
              <Bars days={days} lines={el} series={[{ key: "audio", color: "var(--aud)" }]} />
              <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><i className="size-2 rounded-[2px] bg-aud" />Change voice and Translate</span>
              </div>
            </div>
          )}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="p-2 font-medium">When</th>
              <th className="p-2 font-medium">Action</th>
              <th className="p-2 font-medium">Model</th>
              <th className="p-2 text-right font-medium">Estimated</th>
              <th className="p-2 text-right font-medium">Actual</th>
              <th className="p-2 font-medium">By</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b transition-colors hover:bg-muted/40">
                <td className="p-2 whitespace-nowrap">
                  {r.status === "running" && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-highlight align-middle" />}
                  {new Date(r.at).toLocaleString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className="p-2 whitespace-nowrap">{r.label}</td>
                <td className="max-w-64 truncate p-2 text-muted-foreground" title={r.model}>{r.model}</td>
                <td className="p-2 text-right whitespace-nowrap tabular-nums">{money(r.estimate, r.unit, usd)}</td>
                <td className={cn("p-2 text-right whitespace-nowrap tabular-nums", r.actual ? "font-semibold text-cost" : "text-muted-foreground")}>
                  {r.status === "running" ? "running" : `${money(r.actual, r.unit, usd)}${r.status === "failed" ? ", failed" : r.known ? "" : " (est.)"}`}
                </td>
                <td className="p-2 text-xs text-muted-foreground">{r.by === "claude" ? "Claude" : "dashboard"}</td>
                <td className="p-2 text-right">{r.job && <Button size="xs" variant="ghost" onClick={() => setOpen(r.job)}>View</Button>}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="p-6 text-center text-muted-foreground">Nothing spent in this period.</td>
              </tr>
            )}
          </tbody>
        </table>
        <Viewer jobs={state.media.filter((j) => !isRunning(j))} id={open} onId={setOpen} home={state.home} per1000={usd} onBridge={onBridge} />
      </Main>
    </>
  )
}
