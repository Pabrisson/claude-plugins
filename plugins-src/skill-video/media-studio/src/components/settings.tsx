import { createElement, Fragment, useEffect, useEffectEvent, useRef, useState } from "react"
import {
  BadgeCheckIcon,
  Building2Icon,
  CircleOffIcon,
  CodeIcon,
  CopyIcon,
  GiftIcon,
  KeyRoundIcon,
  LanguagesIcon,
  LayersIcon,
  LoaderCircleIcon,
  PaletteIcon,
  RefreshCwIcon,
  RouterIcon,
  SproutIcon,
  TrendingUpIcon,
  TriangleAlertIcon,
  WalletIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { api, money, plain, ROUTER_NAME, USES, toolUse, type Kind, type Model, type Router, type Settings, type State, type Tool } from "@/lib/api"
import { modelsFor } from "@/components/composer"
import { Chips, ProviderIcon } from "@/components/chips"
import { english, getLang, own, setLang, t, type Lang } from "@/lib/i18n"
import { capsOf, ModelPicker, NewBadge, shortName } from "@/components/model-picker"
import { ModelLogo } from "@/components/model-logo"
import { Main, Side } from "@/components/pages"

const KINDS: Kind[] = ["image", "video", "audio"]
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const KIND_LABEL: Record<Kind, string> = { image: t("Image"), video: t("Video"), audio: t("Audio") }
const EVERY_TOOL: Record<Kind, string> = { image: t("Every image tool."), video: t("Every video tool."), audio: t("Every audio tool.") }
const DEFAULT_OF: Record<Kind, string> = { image: t("Default image model"), video: t("Default video model"), audio: t("Default audio model") }
// ElevenLabs' plans, each its icon (a plan the engine adds later: a wallet)
const PLAN_ICON: Record<string, LucideIcon> = { none: CircleOffIcon, free: GiftIcon, starter: SproutIcon, creator: PaletteIcon, pro: BadgeCheckIcon, scale: TrendingUpIcon, business: Building2Icon }
const PROVIDERS = [
  { id: "kie", name: "Kie.ai", unit: "usd", what: t("Images, videos and voices, its credits counted") },
  { id: "openrouter", name: "OpenRouter", unit: "usd", what: t("Images, videos and voices") },
  { id: "elevenlabs", name: "ElevenLabs", unit: "credits", what: t("Voices straight from it, Change voice, Translate, sound effects, music, voice design and transcripts") },
] as const
// the routers, one active at a time (Kie by default): what each is, and its rate limit (OpenRouter's docs; Kie's docs and a probe,
// 2026-10-31)
const ROUTERS: { id: Router; about: string; limit: string }[] = [
  { id: "kie", about: t("Many labs through one key, billed in credits ($0.005 each) and shown in USD from its price list. Often cheaper; Seedance 2.5 edits a video here, in 1080p."), limit: t("20 new generations every 10 s for the account: past that, the next ones wait their turn here.") },
  { id: "openrouter", about: t("Many labs through one key, billed in USD. A video or a voice reaches it by a tunnel opened for the job."), limit: t("No request cap on paid models: when a model's own limit answers, the job waits the time it asks and tries again.") },
]
type Provider = (typeof PROVIDERS)[number]["id"]
type Limit = { on: boolean; text: string }
const LIMITS = PROVIDERS.flatMap((p) => (["threshold", "cap"] as const).map((k) => `${p.id}.${k}`))
const COMMAND = "/plugin configure skill-video@pabrisson"
// the section the page goes back to after a reload
const BACK = "media-generator:settings-back"
const KIND_NAME: Record<string, string> = { image: t("Image"), video: t("Video"), speech: t("Voice") }
// how long ago, in a few words
const ago = (iso: string) => {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60e3)
  return min < 1 ? t("just now") : min < 60 ? t("{n} min ago", { n: min }) : min < 1440 ? t("{n} h ago", { n: Math.round(min / 60) }) : t("{n} d ago", { n: Math.round(min / 1440) })
}

// a limit as typed: on with a positive number, or off; anything else is an error to fix before saving
const amount = (l: Limit) => (l.on ? Number(l.text) : null)
const wrong = (l: Limit) => l.on && !(l.text.trim() !== "" && Number.isFinite(+l.text) && +l.text > 0)
// what an amount turned on still needs: a word while empty, an error once something wrong is typed
const hint = (l: Limit) =>
  !wrong(l) ? null : l.text.trim() === "" ? <span className="text-xs text-muted-foreground">{t("Enter an amount, or turn it off.")}</span> : <FieldError>{t("Enter an amount above 0.")}</FieldError>
// what this page edits of the settings, in the shape it saves them
const project = (s: Omit<Settings, "workspace">) => ({
  router: { active: s.router.active },
  openrouter: { threshold: s.openrouter.threshold, cap: s.openrouter.cap },
  kie: { threshold: s.kie.threshold, cap: s.kie.cap },
  elevenlabs: { threshold: s.elevenlabs.threshold, cap: s.elevenlabs.cap, plan: s.elevenlabs.plan },
  defaults: s.defaults,
  developer: { on: s.developer.on },
})
const typed = (s: Settings): Record<string, Limit> =>
  Object.fromEntries(LIMITS.map((k) => { const [p, key] = k.split(".") as [Provider, "threshold" | "cap"], v = s[p][key]; return [k, { on: v != null, text: v != null ? String(v) : "" }] }))

// Development's prompt for the agent: every model of both routers checked against its docs and wired, the ones each
// router's catalog adds named first
const listed = (m: Model) => `- ${m.model} (${m.name}; ${m.kind}, ${m.role}${capsOf(m, english).length ? `; ${capsOf(m, english).join(", ")}` : ""})`
const wirePrompt = (added: Record<Router, Model[]>, engine: string) =>
  [
    "Check every model of media-generator (skill-video) on both of its routers, Kie.ai and OpenRouter, and on ElevenLabs (reached straight), and wire what each one can do, every option it takes and what it costs. Generate nothing and spend nothing: read the docs, the price lists and the free routes only, no generation without my yes.",
    "",
    `The engine: ${engine || "media-generator's engine folder"} (model lists: providers/kie-models.json for Kie.ai, providers/openrouter-models.json for OpenRouter; ElevenLabs: providers/elevenlabs.js, its models beyond speech with their options and credit rates, its speech models read from its API, providers/elevenlabs-models.json their copy; tools: tools/image.json, tools/video.json, tools/audio.json, each tool's models for Kie.ai under its "kie" key where they differ).`,
    ...ROUTERS.flatMap((r) => [
      "",
      added[r.id].length
        ? `${ROUTER_NAME[r.id]}'s catalog adds ${added[r.id].length} model${added[r.id].length > 1 ? "s" : ""} its list lacks:\n${added[r.id].map(listed).join("\n")}`
        : `${ROUTER_NAME[r.id]}'s catalog adds no model its list lacks right now.`,
    ]),
    "",
    "1. Read the docs and prices fresh: Kie.ai, its docs pages and its price list; OpenRouter, its image, video and speech catalogs and each model's endpoints with their pricing; ElevenLabs, its API reference (elevenlabs.io/docs/llms.txt, each endpoint's page) and its pricing pages (elevenlabs.io/pricing, elevenlabs.io/pricing/api, its docs' cost notes), in credits.",
    "2. Check every model, each list's own and the catalogs' new ones, against its docs, on three counts:",
    "   - its capabilities: resolutions, ratios, durations, first and last frame, middle frames (keyframes), reference images (how many), omni references (reference videos and sounds: how many, how long), sound, seed, what it edits (video edit, upscale, avatar, lip sync), shots, elements, Library voices, masks of who speaks, draft;",
    "   - its options: every parameter its API takes beyond the shared fields (prompt, frames, references, resolution, ratio, duration, sound, seed) is one of its options, under the model in the composer (the key its API names, its type, its values with an icon each when they show as chips, its default, its range, a hint), or is in its skip list with why; each option's values, default and range still what the docs say;",
    "   - its price: every rule of it as its price list or endpoint gives it (per image, per second, per resolution, with or without a video or a sound, per character, per request…), the engine's estimate matching it for each setting that changes it; ElevenLabs' credit rates (RATE in providers/elevenlabs.js) and the date they were read. A price nowhere published stays unknown, and says so.",
    "3. Wire it, router by router and on ElevenLabs: each catalog model into its list with every capability, option and price rule; a wrong or missing capability, option or price of a listed model fixed; each model named in the tools that fit it (a tool's models or also, its \"kie\" lists for Kie.ai), so an edit, avatar or upscale model shows in its tools too. Something the engine or the dashboard cannot send yet: add it, or list it.",
    "4. Run the engine tests and the dashboard's checks, rebuild the dashboard, bump the plugin's version, restart the dashboards that run.",
    "5. Report by router (then ElevenLabs), then by model: capabilities, options and prices added, fixed, left as is and why.",
  ].join("\n")

// a section of the page: its title and what it is for, then its rows
function Section({ id, icon: Icon, title, about, children }: { id: string; icon: LucideIcon; title: string; about: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-5 rounded-2xl border bg-card">
      <header className="flex items-start gap-3 border-b px-5 py-4">
        <Icon className="mt-0.5 size-5 text-muted-foreground" aria-hidden />
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="mt-0.5 text-sm text-muted-foreground">{about}</p>
        </div>
      </header>
      <FieldGroup className="gap-0 divide-y">{children}</FieldGroup>
    </section>
  )
}
// a row: what the setting does on the left, its control on the right
// end: a single button, switch or badge, set right so the text keeps the width
// icon: a provider's, before its title (the API keys)
function Row({ title, icon, about, htmlFor, end, children }: { title: string; icon?: string; about: React.ReactNode; htmlFor?: string; end?: boolean; children: React.ReactNode }) {
  const named = icon ? (
    <>
      <ProviderIcon id={icon} className="size-4 shrink-0 text-muted-foreground" />
      {title}
    </>
  ) : (
    title
  )
  return (
    <Field className={cn("grid gap-3 px-5 py-4 md:items-start md:gap-8", end ? "md:grid-cols-[minmax(0,1fr)_auto]" : "md:grid-cols-[minmax(0,1fr)_20rem]")}>
      <FieldContent>
        {htmlFor ? <FieldLabel htmlFor={htmlFor}>{named}</FieldLabel> : <FieldTitle>{named}</FieldTitle>}
        <FieldDescription>{about}</FieldDescription>
      </FieldContent>
      <div className={cn("flex flex-col gap-2", end && "items-start md:items-end")}>{children}</div>
    </Field>
  )
}

export function SettingsPage({ state, models, tools, engine, onSaved, onModels }: { state: State; models: Partial<Record<Kind, Model[]>>; tools: Record<Kind, Tool[]> | null; engine: string; onSaved: () => void; onModels: () => void }) {
  const saved = state.settings
  const [plan, setPlan] = useState(saved.elevenlabs.plan)
  const [router, setRouter] = useState<Router>(saved.router.active)
  const [defaults, setDefaults] = useState(saved.defaults)
  const [limits, setLimits] = useState(() => typed(saved))
  const [developer, setDeveloper] = useState(saved.developer.on)
  // what this page last sent, and the settings last read: read ones other than it changed elsewhere (the agent's setup),
  // and the page takes them
  const read = JSON.stringify(project(saved))
  const [sent, setSent] = useState(read)
  const [seen, setSeen] = useState(read)
  if (read !== seen) {
    setSeen(read)
    if (read !== sent) {
      setSent(read)
      setPlan(saved.elevenlabs.plan)
      setRouter(saved.router.active)
      setDefaults(saved.defaults)
      setLimits(typed(saved))
      setDeveloper(saved.developer.on)
    }
  }
  const [at, setAt] = useState("spending")
  // the active router's catalog read on a click: its loader, then the models it found that time (null before any click)
  const [checking, setChecking] = useState(false)
  const [found, setFound] = useState<string[] | null>(null)
  // the newest first: the ones just found, then by the day each first showed
  const added = KINDS.flatMap((k) => (models[k] ?? []).filter((m) => m.new)).sort((a, b) => +!!found?.includes(b.id) - +!!found?.includes(a.id) || (b.since ?? "").localeCompare(a.since ?? ""))
  const loaded = KINDS.every((k) => models[k])
  // both routers' catalog additions, for Development's prompt: read while developer mode shows it
  const [catalogs, setCatalogs] = useState<Record<Router, Model[]> | null>(null)
  useEffect(() => {
    if (!developer) return
    let live = true
    Promise.all(ROUTERS.map((r) => Promise.all(KINDS.map((k) => api.models(k, r.id))).then((l) => [r.id, l.flat().filter((m) => m.new)] as const)))
      .then((pairs) => live && setCatalogs(Object.fromEntries(pairs) as Record<Router, Model[]>), (e) => toast.error(plain((e as Error).message)))
    return () => { live = false }
  }, [developer])
  // the models may have read the catalog (once a day): its date then comes with the state read again. Back from the
  // reload developer mode makes, the page shows its section again, once the lists above it have their height
  useEffect(() => {
    if (!loaded) return
    onSaved()
    try {
      const id = sessionStorage.getItem(BACK)
      sessionStorage.removeItem(BACK)
      if (id) setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }))
    } catch { /* stays at the top */ }
  }, [loaded, onSaved])

  async function updateModels() {
    setChecking(true)
    try {
      const r = await api.refreshModels()
      const ids = Object.values(r.added).flat().filter((m) => m.found).map((m) => m.id)
      setFound(ids)
      const from = ROUTER_NAME[saved.router.active]
      toast.success(!ids.length ? t("The model list is up to date") : ids.length > 1 ? t("{n} new models from {router}", { n: ids.length, router: from }) : t("{n} new model from {router}", { n: 1, router: from }))
      onModels()
      document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    } catch (e) {
      toast.error(plain((e as Error).message))
    } finally {
      setChecking(false)
    }
  }

  const json = JSON.stringify(project({
    router: { active: router },
    openrouter: { threshold: amount(limits["openrouter.threshold"]), cap: amount(limits["openrouter.cap"]) },
    kie: { threshold: amount(limits["kie.threshold"]), cap: amount(limits["kie.cap"]) },
    elevenlabs: { threshold: amount(limits["elevenlabs.threshold"]), cap: amount(limits["elevenlabs.cap"]), plan },
    defaults,
    developer: { on: developer },
  }))
  const invalid = LIMITS.some((k) => wrong(limits[k]))

  // each change saved by itself, half a second after the last one; an amount turned on but not typed waits
  const pending = useRef<string | null>(null)
  const save = useEffectEvent(async (body: string) => {
    pending.current = null
    const was = JSON.parse(sent).router.active, now = JSON.parse(body).router.active
    setSent(body)
    try {
      await api.settings(JSON.parse(body))
      // developer mode on a server started on fakes: the APIs changed with it, the page reads them again (as the
      // header's switch does)
      if (state.fake?.bases?.length && JSON.parse(body).developer.on !== JSON.parse(sent).developer.on) {
        try { sessionStorage.setItem(BACK, "dev") } catch { /* the page opens at its top */ }
        return window.location.reload()
      }
      // another router: its models in every list
      if (now !== was) {
        toast.success(t("{router} is now the router: the tools show its models", { router: ROUTER_NAME[now as Router] }), { id: "settings" })
        onModels()
      } else toast.success(t("Settings saved"), { id: "settings" })
      onSaved()
    } catch (e) {
      toast.error(t("Not saved: {error}", { error: plain((e as Error).message) }), { id: "settings" })
    }
  })
  useEffect(() => {
    if (invalid || json === sent) return
    pending.current = json
    const timer = setTimeout(() => save(json), 500)
    return () => clearTimeout(timer)
  }, [json, invalid, sent])
  // leaving the page: a change still waiting is saved all the same
  useEffect(() => () => {
    if (pending.current) save(pending.current)
  }, [])

  const put = (k: string, patch: Partial<Limit>) => setLimits((l) => ({ ...l, [k]: { ...l[k], ...patch } }))
  // the spending of the router picked here and ElevenLabs'
  const spending = PROVIDERS.filter((p) => p.id === router || p.id === "elevenlabs")
  const noLimits = spending.every((p) => !limits[`${p.id}.threshold`].on && !limits[`${p.id}.cap`].on)
  const name = ROUTER_NAME[saved.router.active]
  const keys = [
    { set: state.keys.kie, provider: "kie", name: t("Kie.ai key"), about: t("Every image, video and voice model while Kie.ai is the router, and its credits left.") },
    { set: state.keys.openrouter, provider: "openrouter", name: t("OpenRouter key"), about: t("Every image, video and voice model while OpenRouter is the router. Without it, prices show and nothing can be generated.") },
    { set: state.keys.management, provider: "openrouter", name: t("OpenRouter management key"), about: t("Optional: the account's whole balance in the header, not only this key's.") },
    { set: state.keys.elevenlabs, provider: "elevenlabs", name: t("ElevenLabs key"), about: t("Voice straight from ElevenLabs (Eleven v4…), Change voice, Translate, its sound effects, music, voice design and transcripts, and the credits left. Without it, the router's ElevenLabs voices.") },
  ]
  // developer mode: on a server started on fake APIs, it brings the header's Fake API switch (turned on with it)
  const fakes = !!state.fake?.bases?.length
  // a use's models: the ones its tools recommend first, then the others they take
  const modelsOfUse = (k: Kind, use: string) => {
    const fits = (tools?.[k] ?? []).filter((t) => !t.hidden && toolUse(k, t) === use).map((t) => modelsFor(t, k, models[k] ?? []))
    const recommended = [...new Set(fits.flatMap((f) => f.recommended))]
    return { recommended, others: [...new Set(fits.flatMap((f) => f.others))].filter((m) => !recommended.includes(m)) }
  }
  // the tools' own defaults, in the order of the kinds then of the tools
  const ownDefaults = KINDS.flatMap((kind) =>
    Object.entries(defaults)
      .filter(([key, id]) => id && key.startsWith(`${kind}/`))
      .map(([key, id]) => ({ key, kind, id, tool: tools?.[kind]?.find((t) => t.id === key.slice(kind.length + 1)) }))
  )
  const nav = [
    { id: "spending", icon: WalletIcon, title: t("Spending"), status: noLimits ? t("No limit set") : t("Limits set"), warn: noLimits },
    { id: "plan", icon: WalletIcon, title: t("ElevenLabs plan"), status: plan ? cap(plan) : t("Not set"), warn: false },
    { id: "models", icon: LayersIcon, title: t("Default models"), status: Object.values(defaults).some(Boolean) ? t("{n} set", { n: Object.values(defaults).filter(Boolean).length }) : t("The tools' choice"), warn: false },
    { id: "keys", icon: KeyRoundIcon, title: t("API keys"), status: t("{n} of {total} set", { n: keys.filter((k) => k.set).length, total: keys.length }), warn: !state.keys[saved.router.active] },
    { id: "router", icon: RouterIcon, title: t("Router"), status: `${t("{name} active", { name })}${state.catalog.at ? ` · ${t("list {when}", { when: ago(state.catalog.at) })}` : ""}`, warn: !state.keys[router] },
    { id: "language", icon: LanguagesIcon, title: t("Language"), status: getLang() === "fr" ? "Français" : "English", warn: false },
    { id: "dev", icon: CodeIcon, title: t("Development"), status: !developer ? t("Off") : fakes ? (state.fake.on ? t("On · fake APIs") : t("On · real APIs")) : t("On"), warn: false },
  ]

  return (
    <>
      <Side>
        <nav className="flex flex-col gap-1" aria-label={t("Settings")}>
          {nav.map((n) => (
            <button
              key={n.id}
              type="button"
              aria-current={at === n.id ? "true" : undefined}
              onClick={() => (setAt(n.id), document.getElementById(n.id)?.scrollIntoView({ behavior: "smooth", block: "start" }))}
              className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-muted/60", at === n.id && "bg-muted")}
            >
              <n.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{n.title}</span>
                <span className={cn("block truncate text-xs", n.warn ? "text-cost" : "text-muted-foreground")}>{n.status}</span>
              </span>
              {n.warn && <TriangleAlertIcon className="size-4 shrink-0 text-cost" aria-label={t("Needs a look")} />}
            </button>
          ))}
        </nav>
        <p className="mt-auto text-xs text-muted-foreground">{t("Saved in this folder's settings.json. The keys stay in your agent's settings.")}</p>
      </Side>

      <Main title={t("Settings")}>
        <div className="flex max-w-4xl flex-col gap-5 pb-4">
          <Section id="spending" icon={WalletIcon} title={t("Spending")} about={t("Each provider in its own unit. Off means never: every click on a paid button spends.")}>
            {spending.map((p) => {
              const th = limits[`${p.id}.threshold`], c = limits[`${p.id}.cap`]
              const spent = state.month[p.id], usd = p.unit === "usd"
              const show = (n: number) => money(n, p.unit)
              const summary = !th.on && !c.on ? t("Never asks, no cap.")
                : [th.on && !wrong(th) && t("Asks above {amount}", { amount: show(+th.text) }), c.on && !wrong(c) && t("stops at {amount} a month", { amount: show(+c.text) })].filter(Boolean).join(", ") + "."
              const field = (k: string, l: Limit, label: string) => (
                <div className="flex items-center gap-3">
                  <Switch
                    checked={l.on}
                    onCheckedChange={(on) => {
                      put(k, { on })
                      if (on) setTimeout(() => document.getElementById(k)?.focus())
                    }}
                    aria-label={label}
                  />
                  <InputGroup className={cn("flex-1", !l.on && "opacity-50")}>
                    {usd && <InputGroupAddon><InputGroupText>$</InputGroupText></InputGroupAddon>}
                    <InputGroupInput
                      id={k}
                      inputMode="decimal"
                      disabled={!l.on}
                      placeholder={l.on ? "0.00" : t("off")}
                      aria-invalid={(wrong(l) && l.text.trim() !== "") || undefined}
                      value={l.text}
                      onChange={(e) => put(k, { text: e.target.value.replace(/[^\d.]/g, "") })}
                    />
                    {!usd && <InputGroupAddon align="inline-end"><InputGroupText>{t("credits")}</InputGroupText></InputGroupAddon>}
                  </InputGroup>
                </div>
              )
              return (
                <Fragment key={p.id}>
                  <div className="flex items-baseline gap-2 bg-muted/30 px-5 py-2.5">
                    <span className="flex items-center gap-1.5 self-center text-sm font-semibold">
                      <ProviderIcon id={p.id} className="size-4 shrink-0 text-muted-foreground" />
                      {p.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{usd ? t("{what}, in USD", { what: p.what }) : t("{what}, in credits", { what: p.what })}</span>
                    <span className={cn("ml-auto text-xs", !th.on && !c.on ? "text-cost" : "text-muted-foreground")}>{summary}</span>
                  </div>
                  <Row title={t("Ask before spending more than")} about={t("A generation above this asks for your yes first, here and with the agent.")} htmlFor={`${p.id}.threshold`}>
                    {field(`${p.id}.threshold`, th, t("Ask before spending more than, {provider}", { provider: p.name }))}
                    {hint(th)}
                  </Row>
                  <Row title={t("Monthly cap")} about={t("Past it, nothing more is spent this month, even with a yes.")} htmlFor={`${p.id}.cap`}>
                    {field(`${p.id}.cap`, c, t("Monthly cap, {provider}", { provider: p.name }))}
                    {wrong(c) ? (
                      hint(c)
                    ) : c.on ? (
                      <>
                        <Progress value={Math.min(100, (100 * spent) / +c.text)} className={cn(spent >= +c.text && "[&>div]:bg-destructive")} aria-label={t("Spent this month")} />
                        <span className="text-xs text-muted-foreground">{t("{spent} of {cap} spent this month", { spent: show(spent), cap: show(+c.text) })}</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("{spent} spent this month", { spent: show(spent) })}</span>
                    )}
                    {th.on && c.on && !wrong(th) && !wrong(c) && +c.text < +th.text && (
                      <span className="text-xs text-cost">{t("The cap is below the threshold: it stops before anything asks.")}</span>
                    )}
                  </Row>
                </Fragment>
              )
            })}
          </Section>

          <Section id="plan" icon={WalletIcon} title={t("ElevenLabs plan")} about={t("Your plan prices ElevenLabs' credits in USD, everywhere a cost shows.")}>
            <Row title={t("Plan")} about={t("Not set: costs show in credits only.")}>
              <Chips
                options={["none", ...Object.keys(state.plans)]}
                value={plan ?? "none"}
                label={(p) => (p === "none" ? t("Not set") : cap(p))}
                icon={(p) => createElement(PLAN_ICON[p] ?? WalletIcon)}
                onChange={(p) => setPlan(p === "none" ? null : p)}
              />
            </Row>
          </Section>

          <Section id="models" icon={LayersIcon} title={t("Default models")} about={t("The most precise one wins: a tool's own, then its use, then its kind. Each applies only to the tools its model fits, else the tool's first recommended model. The agent follows them too.")}>
            {KINDS.map((k) => (
              <Fragment key={k}>
                <Row title={KIND_LABEL[k]} about={EVERY_TOOL[k]}>
                  <ModelPicker
                    kind={k}
                    recommended={[]}
                    others={(models[k] ?? []).filter((m) => k !== "video" || m.role === "generate")}
                    value={defaults[k] ?? null}
                    onChange={(id) => setDefaults({ ...defaults, [k]: id })}
                    none={t("The tool's choice")}
                    label={DEFAULT_OF[k]}
                  />
                </Row>
                {USES[k].map((u) => {
                  const key = `${k}:${u.id}`, { recommended, others } = modelsOfUse(k, u.id)
                  return (
                    <Row key={key} title={`${KIND_LABEL[k]} · ${u.label}`} about={u.about}>
                      <ModelPicker kind={k} recommended={recommended} others={others} value={defaults[key] ?? null} onChange={(id) => setDefaults({ ...defaults, [key]: id })} none={t("Not set")} label={t("Default {kind} {use} model", { kind: KIND_LABEL[k].toLowerCase(), use: u.label.toLowerCase() })} />
                    </Row>
                  )
                })}
              </Fragment>
            ))}
            {ownDefaults.length ? (
              ownDefaults.map(({ key, kind, tool, id }) => {
                const fit = tool ? modelsFor(tool, kind, models[kind] ?? []) : { recommended: [], others: [] }
                return (
                  <Row key={key} title={`${KIND_LABEL[kind]} · ${own(tool?.label) ?? key.split("/")[1]}`} about={t("This tool's own default.")}>
                    <div className="flex items-center gap-1.5">
                      <div className="min-w-0 flex-1">
                        <ModelPicker kind={kind} recommended={fit.recommended} others={fit.others} value={id} onChange={(v) => setDefaults({ ...defaults, [key]: v })} none={t("Not set")} label={t("{tool} default model", { tool: own(tool?.label) ?? key })} />
                      </div>
                      <Button variant="ghost" size="icon-sm" aria-label={t("Remove {tool}'s default", { tool: own(tool?.label) ?? key })} title={t("Remove")} onClick={() => setDefaults({ ...defaults, [key]: null })}>
                        <XIcon />
                      </Button>
                    </div>
                  </Row>
                )
              })
            ) : (
              <Row title={t("Tools")} about={t("A tool's own default, the most precise one, is set by the agent when you ask.")}>
                <span className="text-sm text-muted-foreground">{t("None yet")}</span>
              </Row>
            )}
          </Section>

          <Section id="keys" icon={KeyRoundIcon} title={t("API keys")} about={t("They stay in your agent's settings, never in this folder.")}>
            {keys.map((k) => (
              <Row key={k.name} title={k.name} icon={k.provider} about={k.about} end>
                <Badge variant={k.set ? "secondary" : "outline"} className={cn("h-6 px-2.5", k.set && "bg-done/15 text-done")}>
                  {k.set ? t("Set") : t("Not set")}
                </Badge>
              </Row>
            ))}
            <Row title={t("Set or change a key")} about={t("Run this in your agent, or set its variable (KIE_API_KEY, OPENROUTER_API_KEY, OPENROUTER_MANAGEMENT_KEY, ELEVENLABS_API_KEY), then restart the agent.")}>
              <InputGroup>
                <InputGroupInput readOnly value={COMMAND} aria-label={t("Command")} className="font-mono text-xs md:text-xs" />
                <InputGroupAddon align="inline-end">
                  <Button size="icon-xs" variant="ghost" aria-label={t("Copy the command")} onClick={() => navigator.clipboard.writeText(COMMAND).then(() => toast.success(t("Command copied")))}>
                    <CopyIcon />
                  </Button>
                </InputGroupAddon>
              </InputGroup>
            </Row>
          </Section>

          <Section id="router" icon={RouterIcon} title={t("Router")} about={t("Where every image, video and voice is made. One router at a time: the tools show its models, priced by it.")}>
            <div className="px-5 py-4">
              <RadioGroup value={router} onValueChange={(v) => setRouter(v as Router)} className="grid gap-3 md:grid-cols-2" aria-label={t("Active router")}>
                {ROUTERS.map((r) => (
                  <FieldLabel key={r.id} htmlFor={`router-${r.id}`}>
                    <Field orientation="horizontal" className="items-start">
                      <RadioGroupItem value={r.id} id={`router-${r.id}`} className="mt-0.5" />
                      <FieldContent>
                        <FieldTitle>
                          <ProviderIcon id={r.id} className="size-4 shrink-0 text-muted-foreground" />
                          {ROUTER_NAME[r.id]}
                          {saved.router.active === r.id && <Badge variant="secondary">{t("Active")}</Badge>}
                          <Badge variant="outline" className={cn(state.keys[r.id] ? "text-done" : "text-cost")}>{state.keys[r.id] ? t("Key set") : t("No key")}</Badge>
                        </FieldTitle>
                        <FieldDescription>{r.about}</FieldDescription>
                        <FieldDescription className="text-xs">{t("Rate limit: {limit}", { limit: r.limit })}</FieldDescription>
                      </FieldContent>
                    </Field>
                  </FieldLabel>
                ))}
              </RadioGroup>
            </div>
            <Row
              title={t("{name}'s model list", { name })}
              end
              about={saved.router.active === "kie"
                ? t("The list kept with media-generator, plus the models Kie adds (read from its docs), and its prices from its price list: read at each start of this dashboard and once a day. They show « New » among the other models of the tools that create.")
                : t("The list kept with media-generator, plus the models OpenRouter adds to its catalog, read at each start of this dashboard and once a day. They show « New » among the other models of the tools that create.")}
            >
              <Button variant="outline" disabled={checking} onClick={updateModels} aria-busy={checking || undefined}>
                {checking ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />}
                {checking ? t("Updating the list…") : t("Update the list")}
              </Button>
              <span className="text-xs text-muted-foreground">
                {state.catalog.at ? t("Checked {when}", { when: ago(state.catalog.at) }) : t("Not checked yet")}
                {state.catalog.prices_at ? ` · ${t("prices {when}", { when: ago(state.catalog.prices_at) })}` : ""}
              </span>
            </Row>
            <div id="catalog" className="scroll-mt-5 px-5 py-4">
              <div className="mb-2 flex items-baseline gap-2">
                <span className="text-sm font-medium">{t("Added from {name}'s catalog", { name })}</span>
                {loaded && <span className="text-xs text-muted-foreground tabular-nums">{added.length}</span>}
                {found && <span className="ml-auto text-xs text-muted-foreground">{found.length ? t("{n} found just now", { n: found.length }) : t("Nothing new just now")}</span>}
              </div>
              {!loaded ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircleIcon className="size-4 animate-spin" aria-hidden /> {t("Loading the models…")}</p>
              ) : !added.length ? (
                <p className="text-sm text-muted-foreground">{t("None: the list already has every model of the catalog.")}</p>
              ) : (
                <ul className="max-h-96 divide-y overflow-y-auto overscroll-contain rounded-lg border">
                  {added.map((m) => (
                    <li key={m.id} className={cn("flex items-center gap-3 px-3 py-2", found?.includes(m.id) && "bg-space/5")}>
                      <ModelLogo model={m.model} lab={m.lab} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium">{shortName(m)}</span>
                          {found?.includes(m.id) ? <NewBadge>{t("Just added")}</NewBadge> : <NewBadge />}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {[m.since && t("added {when}", { when: ago(m.since) }), m.lab, KIND_NAME[m.kind] ?? m.kind, m.role === "edit" ? t("edit only") : m.role === "upscale" && t("upscale only"), ...capsOf(m)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {m.from && <span className="text-xs font-semibold whitespace-nowrap text-cost tabular-nums">{m.from}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {loaded && added.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {saved.router.active === "kie"
                    ? t("Read from Kie's docs: their price is not on its list yet, so each asks for your yes, and the reference images a video model takes are unknown.")
                    : t("Their prices are OpenRouter's, never measured here, and the reference images a video model takes are unknown.")}
                </p>
              )}
            </div>
          </Section>

          <Section id="language" icon={LanguagesIcon} title={t("Language")} about={t("The dashboard's words, in this browser. What goes to the models, the prompts copied for the agent and the engine's messages stay in English.")}>
            <Row title={t("Interface")} about={t("The page reloads in the language chosen.")}>
              <Chips<Lang>
                options={["en", "fr"]}
                value={getLang()}
                label={(l) => (l === "fr" ? "Français" : "English")}
                icon={() => <LanguagesIcon />}
                onChange={(l) => {
                  if (l === getLang()) return
                  try {
                    sessionStorage.setItem(BACK, "language")
                  } catch {
                    /* the page opens at its top */
                  }
                  setLang(l)
                }}
              />
            </Row>
          </Section>

          <Section id="dev" icon={CodeIcon} title={t("Development")} about={t("For working on media-generator itself.")}>
            <Row
              title={t("Developer mode")}
              about={fakes
                ? t("Shows the tools below, and the header's Fake API switch, turned on with it: nothing is spent until you switch it off. Off, the real APIs, switch hidden.")
                : t("Shows the tools below. This server was started without fake APIs: everything runs on the real ones.")}
              htmlFor="developer"
              end
            >
              <Switch id="developer" checked={developer} onCheckedChange={setDeveloper} />
            </Row>
            {developer && (
              <Row
                title={t("Check and wire every model")}
                end
                about={t("Copies a prompt to paste in your agent: the agent reads the docs and price lists of every model of both routers, Kie.ai and OpenRouter (the ones their catalogs add first), and of ElevenLabs, checks what each one takes (reference images, omni references, video edits, avatars, shots, keyframes, elements, voices…), every option of its API and every rule of its price, wires what is missing into the model lists, their options, their estimates and the tools that fit, then runs the tests and rebuilds this dashboard. Nothing is generated, nothing is spent.")}
              >
                <Button
                  variant="outline"
                  disabled={!catalogs}
                  onClick={() => navigator.clipboard.writeText(wirePrompt(catalogs!, engine)).then(() => toast.success(t("Prompt copied: paste it in your agent")))}
                >
                  {catalogs ? <CopyIcon aria-hidden /> : <LoaderCircleIcon className="animate-spin" aria-hidden />} {t("Copy prompt")}
                </Button>
              </Row>
            )}
          </Section>
        </div>
      </Main>
    </>
  )
}
