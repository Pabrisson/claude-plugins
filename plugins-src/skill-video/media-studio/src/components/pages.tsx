import { useEffect, useState } from "react"
import { cn } from "cn"

import { ArrowUpRightIcon, AudioLinesIcon, CalendarDaysIcon, CalendarRangeIcon, ImageIcon, LayoutDashboardIcon, PaletteIcon, ShapesIcon, SparklesIcon, VideoIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, money, opt, per1000, ROUTER_NAME, type Balances, type Job, type Kind, type LedgerLine, type Router, type State, type Tool } from "@/lib/api"
import { Chips, Label, MultiChips, ProviderIcon, valueIcon } from "@/components/chips"
import { ElementsTab, type ElementDraft, type Use } from "@/components/elements"
import { StylesTab } from "@/components/styles"
import { type Preset } from "@/components/style-picker"
import { isRunning, type Bridge } from "@/components/results"
import { ModelLogo } from "@/components/model-logo"
import { Viewer } from "@/components/viewer"

const KINDS: Kind[] = ["image", "video", "audio"]
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

// a page's left column: its tabs and main action (head) stay put, its filters scroll under them; both keep the
// scrollbar's room, so nothing moves when a long list brings it
export function Side({ head, children }: { head?: React.ReactNode; children: React.ReactNode }) {
  return (
    <aside className="flex min-h-0 flex-col border-r bg-background">
      {head && <div className="flex shrink-0 flex-col gap-5 overflow-hidden p-4 pb-0 [scrollbar-gutter:stable]">{head}</div>}
      <div className={cn("flex min-h-0 flex-1 flex-col gap-5 overflow-auto p-4 [scrollbar-gutter:stable]", head && "pt-5")}>{children}</div>
    </aside>
  )
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

// which workspace a page shows: all of them, or one
function WorkspaceFilter({ state, value, onChange }: { state: State; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label>Workspace</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full" aria-label="Workspace">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All workspaces</SelectItem>
          <SelectSeparator />
          {state.workspaces.map((w) => (
            <SelectItem key={w.slug} value={w.slug}>{w.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

// ---------- Library ----------

// the Library's tab lives in the URL (#library/elements, #library/styles, #library/sound-styles), so a result's « Make an
// element » lands on it; the media are on the Workspace page (« All workspaces »)
const TABS = ["elements", "styles", "sound-styles"] as const
type Tab = (typeof TABS)[number]
const TAB_NAMES: Record<Tab, [string, typeof ShapesIcon]> = { elements: ["Elements", ShapesIcon], styles: ["Visuals", PaletteIcon], "sound-styles": ["Sounds", AudioLinesIcon] }
const tabOf = (): Tab => TABS.find((t) => window.location.hash === `#library/${t}`) ?? "elements"

export function Library({
  state,
  tools,
  engine,
  draft,
  onDraftUsed,
  onUse,
  onChanged,
}: {
  state: State
  tools: Record<Kind, Tool[]>
  engine: string
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
  const tabs = (
    <Chips
      options={TABS}
      value={tab}
      label={(t) => TAB_NAMES[t][0]}
      icon={(t) => {
        const Icon = TAB_NAMES[t][1]
        return <Icon />
      }}
      onChange={(t) => (window.location.hash = `library/${t}`)}
      className="grid grid-cols-3"
    />
  )
  if (tab === "styles")
    return <StylesTab tabs={tabs} state={state} presets={(tools.image.find((t) => t.id === "restyle")?.fields.find((f) => f.type === "style")?.options ?? []).map((o) => opt(o) as Preset)} engine={engine} onUse={onUse} onChanged={onChanged} />
  if (tab === "sound-styles") {
    // each family's presets once, from the first tool that picks them (Music's Style, Voice's How it sounds, Sound effect's)
    const fields = tools.audio.flatMap((t) => t.fields).filter((f) => f.type === "style" && f.for)
    const presets = (["music", "voice", "sound"] as const).filter((family) => fields.some((f) => f.for === family)).flatMap((family) => (fields.find((f) => f.for === family)!.options ?? []).map((o) => ({ ...opt(o), for: family }) as Preset))
    return <StylesTab tabs={tabs} state={state} presets={presets} sound engine={engine} onUse={onUse} onChanged={onChanged} />
  }
  return <ElementsTab tabs={tabs} state={state} tools={tools.image} engine={engine} draft={draft} onDraftUsed={onDraftUsed} onUse={onUse} onChanged={onChanged} />
}

// nothing generated in this folder yet: what lands on the page once there is, and the spaces to start in
export function NoGenerations({ what }: { what: string }) {
  return (
    <Empty className="border border-dashed">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SparklesIcon />
        </EmptyMedia>
        <EmptyTitle>No generation yet</EmptyTitle>
        <EmptyDescription>{what}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent className="flex-row justify-center">
        {([["image", "Image", ImageIcon], ["video", "Video", VideoIcon], ["audio", "Audio", AudioLinesIcon]] as const).map(([hash, label, Icon]) => (
          <Button key={hash} variant="outline" size="sm" asChild>
            <a href={`#${hash}`}>
              <Icon data-icon="inline-start" /> {label}
            </a>
          </Button>
        ))}
      </EmptyContent>
    </Empty>
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

// a kind's color in the charts, where each provider's credits are bought, and a ledger line's provider: a router, or
// ElevenLabs straight (its voices, Change voice, Translate)
type Who = Router | "elevenlabs"
const COLOR: Record<Kind, string> = { image: "var(--img)", video: "var(--vid)", audio: "var(--aud)" }
const TOP_UP: Record<Who, string> = { kie: "https://kie.ai/billing", openrouter: "https://openrouter.ai/settings/credits", elevenlabs: "https://elevenlabs.io/app/subscription" }
const ROUTER_OF: Record<string, string> = { ...ROUTER_NAME, local: "This machine", elevenlabs: "ElevenLabs" }

export function Credits({ state, balances, onBridge }: { state: State; balances: Balances | null; onBridge: (b: Bridge, job: Job, file: string) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [period, setPeriod] = useState<Period>("month")
  const [provider, setProvider] = useState<"all" | Who>("all")
  const [kinds, setKinds] = useState<Kind[]>(KINDS)
  const [by, setBy] = useState<string[]>(["dashboard", "claude"])
  const [ws, setWs] = useState("all")
  const inWs = (id: string) => ws === "all" || !!state.media.find((j) => j.id === id)?.workspaces?.includes(ws)
  const [ledger, setLedger] = useState<LedgerLine[]>([])
  const finished = state.media.filter((j) => j.status === "done" || j.status === "failed").length
  useEffect(() => {
    api.ledger().then(setLedger, () => {})
  }, [finished])

  const now = new Date(), month = now.toISOString().slice(0, 7)
  const since = period === "7d" ? new Date(now.getTime() - 6 * 864e5).toISOString().slice(0, 10) : period === "month" ? `${month}-01` : "0000"
  const lines = ledger.filter((l) => l.at.slice(0, 10) >= since && kinds.includes(l.kind) && by.includes(l.by) && inWs(l.id))
  // a card for each router, the active one first, then ElevenLabs'
  const routers: Who[] = [...(state.router === "kie" ? ["kie", "openrouter"] as const : ["openrouter", "kie"] as const), "elevenlabs"]
  const usd = per1000(state)
  const today = now.toISOString().slice(0, 10)
  const end = Date.parse(today), n = period === "7d" ? 7 : period === "month" ? new Date(end).getUTCDate() : 30
  const days = Array.from({ length: n }, (_, i) => new Date(end - (n - 1 - i) * 864e5).toISOString().slice(0, 10))
  const running = state.media.filter((j) => (j.status === "running" || j.status === "queued") && j.provider !== "local" && inWs(j.id))
  const rows = [
    ...running.map((j) => ({ key: j.id, at: j.created, label: j.label, model: j.name, unit: j.estimate.unit, estimate: j.estimate.amount, actual: null as number | null, known: false, status: "running", by: j.by, provider: j.provider, job: null as string | null })),
    ...[...lines].reverse().map((l) => {
      const job = state.media.find((j) => j.id === l.id)
      return { key: `${l.id}-${l.at}`, at: l.at, label: l.label, model: job?.name ?? l.model, unit: l.unit, estimate: l.estimate, actual: l.actual, known: !!l.actual_known, status: l.status, by: l.by, provider: l.provider, job: job && !isRunning(job) ? job.id : null }
    }),
  ].filter((r) => provider === "all" || r.provider === provider)

  const ob = balances?.openrouter, kb = balances?.kie, eb = balances?.elevenlabs
  const limits = state.settings, active = limits[state.router]
  const noLimits = active.threshold == null && active.cap == null
  // a balance: Kie's dollars with its credits beside, OpenRouter's account (else this key's limit) left, ElevenLabs' credits
  // left of its month (their dollars on a paid plan)
  const balanceOf = (r: Who) => {
    const b = r === "kie" ? kb : r === "elevenlabs" ? eb : ob
    const note = "text-sm font-normal text-muted-foreground"
    if (!state.keys[r] || b?.error === "no key")
      return <span className={note}>No key: see <a href="#settings" className="underline underline-offset-2 hover:text-foreground">Settings</a></span>
    if (!b || b.error) return <span className={note}>{b ? b.error : "Loading the balance…"}</span>
    if (r === "elevenlabs")
      return (
        <span className="text-3xl font-semibold tabular-nums" title={eb?.limit ? `${(eb.left ?? 0).toLocaleString("en-US")} of ${eb.limit.toLocaleString("en-US")} credits this month` : undefined}>
          {(eb?.left ?? 0).toLocaleString("en-US")} <span className={note}>credits left{usd ? ` · ${money(((eb?.left ?? 0) * usd) / 1000, "usd")}` : ""}{eb?.reset ? ` · renews ${new Date(eb.reset).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</span>
        </span>
      )
    const [left, words] =
      r === "kie" ? [kb?.account_left ?? 0, `left · ${(kb?.credits ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} credits`]
        : ob?.account_left != null ? [ob.account_left, "left"]
        : ob?.key_left != null ? [ob.key_left, "left on this key"]
        : [null, "no limit on this key"]
    return left == null ? <span className={note}>{words}</span> : <span className="text-3xl font-semibold tabular-nums">${left.toFixed(2)} <span className={note}>{words}</span></span>
  }

  return (
    <>
      <Side>
        <div>
          <Label>Period</Label>
          <Chips options={["7d", "month", "all"] as const} value={period} label={(p) => ({ "7d": "7 days", month: "This month", all: "All" })[p]} icon={(p) => (p === "7d" ? <CalendarDaysIcon /> : p === "month" ? <CalendarRangeIcon /> : valueIcon(p))} onChange={setPeriod} />
        </div>
        <div>
          <Label>Provider</Label>
          <Chips options={["all", "kie", "openrouter", "elevenlabs"] as const} value={provider} label={(p) => (p === "all" ? "All" : ROUTER_OF[p])} icon={(p) => valueIcon(p)} onChange={setProvider} />
        </div>
        <div>
          <Label>Media</Label>
          <MultiChips options={KINDS} value={kinds} label={cap} icon={(k) => valueIcon(k)} onChange={setKinds} />
        </div>
        <div>
          <Label>By</Label>
          <MultiChips options={["dashboard", "claude"]} value={by} label={(b) => (b === "claude" ? "Claude" : "Dashboard")} icon={(b) => (b === "claude" ? <SparklesIcon /> : <LayoutDashboardIcon />)} onChange={setBy} />
        </div>
        <WorkspaceFilter state={state} value={ws} onChange={setWs} />
        <p className="rounded-lg border bg-muted/50 p-3 text-xs text-muted-foreground">
          {noLimits
            ? "No confirmation threshold and no monthly cap are set: every click on a paid button spends. Set them in Settings."
            : `Limits: ${ROUTER_NAME[state.router]} ${active.threshold != null ? `asks above $${active.threshold}` : "never asks"}${active.cap != null ? `, caps at $${active.cap} a month` : ""}.`}
        </p>
      </Side>
      <Main title="Credits" aside={<span className="text-sm text-muted-foreground">{now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}</span>}>
        <div className="grid gap-3.5 lg:grid-cols-2 2xl:grid-cols-3">
          {routers.map((r) => {
            const mine = lines.filter((l) => l.provider === r), { cap: most, threshold } = limits[r] ?? { cap: null, threshold: null }, used = state.month[r] ?? 0
            // ElevenLabs counts in its credits, their dollars on a paid plan; the routers in dollars
            const unit = r === "elevenlabs" ? "credits" : "usd", show = (n: number) => money(n, unit, usd)
            return (
              <div key={r} className="rounded-2xl border bg-card p-4">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ProviderIcon id={r} className="size-4 shrink-0" />
                  {ROUTER_OF[r]}
                  {r === "elevenlabs" && <span className="text-xs">· straight, not a router</span>}
                  {r === state.router && <Badge variant="secondary" className="ml-auto">Active</Badge>}
                </div>
                <div className="mt-1 flex min-h-9 items-baseline gap-3">
                  {balanceOf(r)}
                  <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" asChild>
                    <a href={TOP_UP[r]} target="_blank" rel="noreferrer">
                      Top up <ArrowUpRightIcon data-icon="inline-end" />
                    </a>
                  </Button>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  <span className="font-semibold text-cost tabular-nums">{show(sum(mine))}</span> spent {period === "7d" ? "in 7 days" : period === "month" ? "this month" : "in all"}
                </div>
                <Bars days={days} lines={mine} series={KINDS.map((k) => ({ key: k, color: COLOR[k] }))} />
                <div className="mt-2 flex gap-3 text-xs text-muted-foreground">
                  {KINDS.map((k) => (
                    <span key={k} className="flex items-center gap-1.5">
                      <i className="size-2 rounded-[2px]" style={{ background: COLOR[k] }} />
                      {cap(k)}
                    </span>
                  ))}
                </div>
                {/* its limits: this month's spend against the cap, else what asks first */}
                {most != null ? (
                  <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground" title={`${show(used)} of ${show(most)} spent this month`}>
                    <span className="whitespace-nowrap">cap {show(most)}</span>
                    <Progress value={Math.min(100, (100 * used) / most)} className={cn("flex-1", used >= most && "[&>div]:bg-destructive")} aria-label="Spent this month" />
                    <span className="tabular-nums">{Math.round((100 * used) / most)} %</span>
                  </div>
                ) : (
                  <div className="mt-3 text-xs text-muted-foreground">{threshold != null ? `no cap · asks above ${show(threshold)}` : "no limit set"}</div>
                )}
              </div>
            )
          })}
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="p-2 font-medium">When</th>
              <th className="p-2 font-medium">Action</th>
              <th className="p-2 font-medium">Model</th>
              <th className="p-2 font-medium">Router</th>
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
                <td className="max-w-64 p-2 text-muted-foreground" title={r.model}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <ModelLogo model={r.model} className="size-4 rounded-sm bg-transparent p-0" />
                    <span className="truncate">{r.model}</span>
                  </span>
                </td>
                <td className="p-2 whitespace-nowrap text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <ProviderIcon id={r.provider} className="size-3.5 shrink-0" />
                    {ROUTER_OF[r.provider] ?? r.provider}
                  </span>
                </td>
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
                <td colSpan={8} className="p-6 text-center text-muted-foreground">{ledger.length ? "Nothing spent in this period." : <NoGenerations what="Each paid generation lands here with its estimate and its real cost, by you or by Claude." />}</td>
              </tr>
            )}
          </tbody>
        </table>
        <Viewer jobs={state.media.filter((j) => !isRunning(j))} id={open} onId={setOpen} home={state.home} per1000={per1000(state)} onBridge={onBridge} />
      </Main>
    </>
  )
}
