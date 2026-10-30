import { Fragment, useEffect, useState } from "react"
import { CopyIcon, KeyRoundIcon, LayersIcon, TriangleAlertIcon, WalletIcon, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldTitle } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { Kbd } from "@/components/ui/kbd"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { api, money, plain, type Kind, type Model, type Settings, type State } from "@/lib/api"
import { Chips } from "@/components/chips"
import { ModelPicker } from "@/components/model-picker"
import { Main, Side } from "@/components/pages"

const KINDS: Kind[] = ["image", "video", "audio"]
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const PROVIDERS = [
  { id: "openrouter", name: "OpenRouter", unit: "usd", what: "Images, videos and voices" },
  { id: "elevenlabs", name: "ElevenLabs", unit: "credits", what: "Change voice and Translate" },
] as const
type Provider = (typeof PROVIDERS)[number]["id"]
type Limit = { on: boolean; text: string }
const LIMITS = PROVIDERS.flatMap((p) => (["threshold", "cap"] as const).map((k) => `${p.id}.${k}`))
const COMMAND = "/plugin configure skill-video@pabrisson"

// a limit as typed: on with a positive number, or off; anything else is an error to fix before saving
const amount = (l: Limit) => (l.on ? Number(l.text) : null)
const wrong = (l: Limit) => l.on && !(l.text.trim() !== "" && Number.isFinite(+l.text) && +l.text > 0)
// what an amount turned on still needs: a word while empty, an error once something wrong is typed
const hint = (l: Limit) =>
  !wrong(l) ? null : l.text.trim() === "" ? <span className="text-xs text-muted-foreground">Enter an amount, or turn it off.</span> : <FieldError>Enter an amount above 0.</FieldError>
const typed = (s: Settings): Record<string, Limit> =>
  Object.fromEntries(LIMITS.map((k) => { const [p, key] = k.split(".") as [Provider, "threshold" | "cap"], v = s[p][key]; return [k, { on: v != null, text: v != null ? String(v) : "" }] }))

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
function Row({ title, about, htmlFor, children }: { title: string; about: React.ReactNode; htmlFor?: string; children: React.ReactNode }) {
  return (
    <Field className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1fr)_20rem] md:items-start md:gap-8">
      <FieldContent>
        {htmlFor ? <FieldLabel htmlFor={htmlFor}>{title}</FieldLabel> : <FieldTitle>{title}</FieldTitle>}
        <FieldDescription>{about}</FieldDescription>
      </FieldContent>
      <div className="flex flex-col gap-2">{children}</div>
    </Field>
  )
}

export function SettingsPage({ state, models, onSaved }: { state: State; models: Partial<Record<Kind, Model[]>>; onSaved: () => void }) {
  const saved = state.settings
  const [plan, setPlan] = useState(saved.elevenlabs.plan)
  const [defaults, setDefaults] = useState(saved.defaults)
  const [limits, setLimits] = useState(() => typed(saved))
  const [busy, setBusy] = useState(false)
  const [at, setAt] = useState("spending")

  const next: Settings = {
    openrouter: { threshold: amount(limits["openrouter.threshold"]), cap: amount(limits["openrouter.cap"]) },
    elevenlabs: { threshold: amount(limits["elevenlabs.threshold"]), cap: amount(limits["elevenlabs.cap"]), plan },
    defaults,
  }
  const dirty = JSON.stringify(next) !== JSON.stringify({ openrouter: { threshold: saved.openrouter.threshold, cap: saved.openrouter.cap }, elevenlabs: { threshold: saved.elevenlabs.threshold, cap: saved.elevenlabs.cap, plan: saved.elevenlabs.plan }, defaults: saved.defaults })
  const invalid = LIMITS.some((k) => wrong(limits[k]))

  async function save() {
    if (!dirty || invalid || busy) return
    setBusy(true)
    try {
      await api.settings(next)
      toast.success("Settings saved")
      onSaved()
    } catch (e) {
      toast.error(plain((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  // ⌘S saves
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "s" || !(e.metaKey || e.ctrlKey)) return
      e.preventDefault()
      save()
    }
    window.addEventListener("keydown", on)
    return () => window.removeEventListener("keydown", on)
  })

  const put = (k: string, patch: Partial<Limit>) => setLimits((l) => ({ ...l, [k]: { ...l[k], ...patch } }))
  const noLimits = PROVIDERS.every((p) => !limits[`${p.id}.threshold`].on && !limits[`${p.id}.cap`].on)
  const keys = [
    { set: state.keys.openrouter, name: "OpenRouter key", about: "Every image, video and voice model. Without it, prices show and nothing can be generated." },
    { set: state.keys.management, name: "OpenRouter management key", about: "Optional: the account's whole balance in the header, not only this key's." },
    { set: state.keys.elevenlabs, name: "ElevenLabs key", about: "Change voice and Translate, and the credits left." },
  ]
  const nav = [
    { id: "spending", icon: WalletIcon, title: "Spending", status: noLimits ? "No limit set" : "Limits set", warn: noLimits },
    { id: "plan", icon: WalletIcon, title: "ElevenLabs plan", status: plan ? cap(plan) : "Not set", warn: false },
    { id: "models", icon: LayersIcon, title: "Default models", status: KINDS.some((k) => defaults[k]) ? `${KINDS.filter((k) => defaults[k]).length} of 3 set` : "The tools' choice", warn: false },
    { id: "keys", icon: KeyRoundIcon, title: "API keys", status: `${keys.filter((k) => k.set).length} of 3 set`, warn: !state.keys.openrouter },
  ]

  return (
    <>
      <Side>
        <nav className="flex flex-col gap-1" aria-label="Settings">
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
              {n.warn && <TriangleAlertIcon className="size-4 shrink-0 text-cost" aria-label="Needs a look" />}
            </button>
          ))}
        </nav>
        <p className="mt-auto text-xs text-muted-foreground">Saved in this folder's settings.json. The keys stay in Claude Code.</p>
      </Side>

      <Main title="Settings">
        <div className="flex max-w-4xl flex-col gap-5 pb-4">
          <Section id="spending" icon={WalletIcon} title="Spending" about="Each provider in its own unit. Off means never: every click on a paid button spends.">
            {PROVIDERS.map((p) => {
              const t = limits[`${p.id}.threshold`], c = limits[`${p.id}.cap`]
              const spent = state.month[p.id], usd = p.unit === "usd"
              const show = (n: number) => money(n, p.unit)
              const summary = !t.on && !c.on ? "Never asks, no cap."
                : [t.on && !wrong(t) && `Asks above ${show(+t.text)}`, c.on && !wrong(c) && `stops at ${show(+c.text)} a month`].filter(Boolean).join(", ") + "."
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
                      placeholder={l.on ? "0.00" : "off"}
                      aria-invalid={(wrong(l) && l.text.trim() !== "") || undefined}
                      value={l.text}
                      onChange={(e) => put(k, { text: e.target.value.replace(/[^\d.]/g, "") })}
                    />
                    {!usd && <InputGroupAddon align="inline-end"><InputGroupText>credits</InputGroupText></InputGroupAddon>}
                  </InputGroup>
                </div>
              )
              return (
                <Fragment key={p.id}>
                  <div className="flex items-baseline gap-2 bg-muted/30 px-5 py-2.5">
                    <span className="text-sm font-semibold">{p.name}</span>
                    <span className="text-xs text-muted-foreground">{p.what}, in {usd ? "USD" : "credits"}</span>
                    <span className={cn("ml-auto text-xs", !t.on && !c.on ? "text-cost" : "text-muted-foreground")}>{summary}</span>
                  </div>
                  <Row title="Ask before spending more than" about="A generation above this asks for your yes first, here and with Claude." htmlFor={`${p.id}.threshold`}>
                    {field(`${p.id}.threshold`, t, `Ask before spending more than, ${p.name}`)}
                    {hint(t)}
                  </Row>
                  <Row title="Monthly cap" about="Past it, nothing more is spent this month, even with a yes." htmlFor={`${p.id}.cap`}>
                    {field(`${p.id}.cap`, c, `Monthly cap, ${p.name}`)}
                    {wrong(c) ? (
                      hint(c)
                    ) : c.on ? (
                      <>
                        <Progress value={Math.min(100, (100 * spent) / +c.text)} className={cn(spent >= +c.text && "[&>div]:bg-destructive")} aria-label="Spent this month" />
                        <span className="text-xs text-muted-foreground">{show(spent)} of {show(+c.text)} spent this month</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">{show(spent)} spent this month</span>
                    )}
                    {t.on && c.on && !wrong(t) && !wrong(c) && +c.text < +t.text && (
                      <span className="text-xs text-cost">The cap is below the threshold: it stops before anything asks.</span>
                    )}
                  </Row>
                </Fragment>
              )
            })}
          </Section>

          <Section id="plan" icon={WalletIcon} title="ElevenLabs plan" about="Your plan prices ElevenLabs' credits in USD, everywhere a cost shows.">
            <Row title="Plan" about="USD per 1,000 credits. Not set: costs show in credits only.">
              <Chips
                options={["none", ...Object.keys(state.plans)]}
                value={plan ?? "none"}
                label={(p) => (p === "none" ? "Not set" : `${cap(p)}${state.plans[p] ? ` · $${state.plans[p]}` : ""}`)}
                onChange={(p) => setPlan(p === "none" ? null : p)}
              />
            </Row>
          </Section>

          <Section id="models" icon={LayersIcon} title="Default models" about="Used when a tool recommends no model, and by Claude when you name none.">
            {KINDS.map((k) => (
              <Row key={k} title={cap(k)} about={k === "audio" ? "Speech: the voice reading your text." : k === "video" ? "Generation from words or images." : "Generation and edits."}>
                <ModelPicker
                  kind={k}
                  recommended={[]}
                  others={(models[k] ?? []).filter((m) => k !== "video" || m.role === "generate")}
                  value={defaults[k]}
                  onChange={(id) => setDefaults({ ...defaults, [k]: id })}
                  none="The tool's choice"
                  label={`Default ${k} model`}
                />
              </Row>
            ))}
          </Section>

          <Section id="keys" icon={KeyRoundIcon} title="API keys" about="They stay in Claude Code, never in this folder.">
            {keys.map((k) => (
              <Row key={k.name} title={k.name} about={k.about}>
                <Badge variant={k.set ? "secondary" : "outline"} className={cn("h-6 px-2.5", k.set && "bg-done/15 text-done")}>
                  {k.set ? "Set" : "Not set"}
                </Badge>
              </Row>
            ))}
            <Row title="Set or change a key" about="Run this in Claude Code, then restart it.">
              <InputGroup>
                <InputGroupInput readOnly value={COMMAND} aria-label="Command" className="font-mono text-xs md:text-xs" />
                <InputGroupAddon align="inline-end">
                  <Button size="icon-xs" variant="ghost" aria-label="Copy the command" onClick={() => navigator.clipboard.writeText(COMMAND).then(() => toast.success("Command copied"))}>
                    <CopyIcon />
                  </Button>
                </InputGroupAddon>
              </InputGroup>
            </Row>
          </Section>
        </div>

        {dirty && (
          <div className="sticky bottom-0 mt-auto flex max-w-4xl items-center gap-3 rounded-xl border bg-popover/95 p-3 pl-4 shadow-lg backdrop-blur animate-in fade-in-0 slide-in-from-bottom-2">
            <span className="flex-1 text-sm">{invalid ? <span className="text-muted-foreground">Enter the amounts turned on to save.</span> : "Unsaved changes"}</span>
            <Button
              variant="ghost"
              onClick={() => {
                setPlan(saved.elevenlabs.plan)
                setDefaults(saved.defaults)
                setLimits(typed(saved))
              }}
            >
              Discard
            </Button>
            <Button disabled={invalid || busy} onClick={save}>
              Save <Kbd className="bg-primary-foreground/15 text-primary-foreground/80">⌘S</Kbd>
            </Button>
          </div>
        )}
      </Main>
    </>
  )
}
