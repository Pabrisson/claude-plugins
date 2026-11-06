import { CopyIcon, PlusIcon, WifiIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useState, type ReactNode } from "react"
import { toast } from "sonner"

import { Chips } from "@/components/chips"
import { Icon } from "@/components/icon"
import { copyText } from "@/components/obsidian-button"
import { PrivateBadge } from "@/components/private-badge"
import { useFakeGuard } from "@/components/fake-switch"
import { appState, TopBar, useAppState } from "@/components/top-bar"
import { useTypes } from "@/components/case-page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { WatchSettings } from "@/components/watch-settings"
import { api, type Doctor, type DoctorLine } from "@/lib/api"
import { useBasket } from "@/lib/basket"
import { TONE } from "@/lib/tones"
import { cn } from "@/lib/utils"

const LOOK: Record<string, { icon: string; tone: string; label: string }> = {
  ok: { icon: "circle-check", tone: "text-emerald-600 dark:text-emerald-400", label: "ok" },
  missing: { icon: "circle-alert", tone: "text-amber-600 dark:text-amber-400", label: "missing" },
  MISSING: { icon: "octagon-x", tone: "text-rose-600 dark:text-rose-400", label: "MISSING" },
}
const AI = ["gemini", "google vision"]

// Settings: what the engine needs and has (doctor), the keys (set or not, never their value), each type's readiness,
// the AI services (off), the warnings, the network check, the cases folder, the theme, the version
// Settings › Development: developer mode (shows the bar's Fake APIs switch) and the Fake APIs, on a server started on them
function Development() {
  const st = useAppState(), { change, dialog } = useFakeGuard()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Icon name="flask-conical" className="size-4" />Development</CardTitle>
        <CardDescription>For testing the dashboard without calling any real service.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <label className="flex items-start gap-3">
          <Switch checked={st.developer} onCheckedChange={on => change(!on && st.fake, () => api.developer(on))} aria-label="Developer mode" className="mt-0.5" />
          <span className="min-w-0 text-sm"><span className="flex items-center gap-1.5 font-medium"><Icon name="code" className="size-4 text-muted-foreground" aria-hidden />Developer mode</span>
            <span className="text-muted-foreground">Shows the Fake APIs switch in the top bar. Turning it off also turns the fake APIs off.</span></span>
        </label>
        {st.fake_available ? (
          <>
            {st.developer && (
              <label className="flex items-start gap-3">
                <Switch checked={st.fake} onCheckedChange={on => change(!on, () => api.fake(on))} aria-label="Fake APIs" className="mt-0.5" />
                <span className="min-w-0 text-sm"><span className="flex items-center gap-1.5 font-medium"><Icon name="drama" className="size-4 text-muted-foreground" aria-hidden />Fake APIs</span>
                  <span className="text-muted-foreground">On: every service the engine calls (the watch and the PDF export included) answers from recorded fixtures, with made-up data. Off: the real services are called. No restart needed; a command already running ends on the old setting. A case made or refreshed on the fake APIs says so in its Journal and its print footer.</span></span>
              </label>
            )}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Icon name="server" className="size-4 text-muted-foreground" aria-hidden /><span className="font-medium">Fake API server</span>
              <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs">{st.fake_url}</code>
              <Badge className={cn("gap-1", st.fake ? TONE.amber : TONE.neutral)}>{st.fake ? "In use" : "Not in use"}</Badge>
            </div>
          </>
        ) : <p className="text-sm text-muted-foreground">This server was not started on fake APIs (the demo and the tests are), so it has none to turn on.</p>}
      </CardContent>
      {dialog}
    </Card>
  )
}

export function Settings() {
  const [doc, setDoc] = useState<Doctor | null>(null)
  const [net, setNet] = useState<DoctorLine[] | null>(null), [checking, setChecking] = useState(false)
  const [version, setVersion] = useState("")
  const types = useTypes()
  const { add } = useBasket()
  const { theme, setTheme } = useTheme()
  useEffect(() => { api.doctor().then(setDoc, e => toast.error("doctor failed", { description: (e as Error).message })); appState().then(s => setVersion(s.version)) }, [])
  const keyIds = new Set((types ?? []).flatMap(t => (t as { requires?: { keys?: { id: string }[] } }).requires?.keys?.map(k => k.id) ?? []))
  const lines = doc?.lines ?? []
  // the PDF export line is an `info` line (the browser it prints with) or `missing`: shown in Tools either way
  const tools = lines.filter(l => l.status in LOOK || l.name === "pdf export").map(l => (l.status === "info" ? { ...l, status: "ok" as const } : l))
  const keys = lines.filter(l => keyIds.has(l.name))
  const ai = lines.filter(l => AI.includes(l.name))
  const warnings = lines.filter(l => l.status === "warning")
  async function check() {
    setChecking(true)
    try { const d = await api.doctor(true), known = new Set(lines.map(l => l.name)); setNet(d.lines.filter(l => !known.has(l.name))) } catch (e) { toast.error("Network check failed", { description: (e as Error).message }) }
    setChecking(false)
  }
  const ask = (tool: string) => { add({ tag: "install", text: tool }); toast.success("Added to the prompt", { description: `[install] ${tool}` }) }
  const row = (l: DoctorLine, extra?: ReactNode) => {
    const look = LOOK[l.status] ?? { icon: "info", tone: "text-muted-foreground", label: l.status }
    const [what, off] = l.text.split(/ — (.+)/)
    return (
      <li key={`${l.name}-${l.text}`} className="flex flex-col gap-2 py-2.5">
        <div className="flex items-start gap-2.5">
          <Icon name={look.icon} className={cn("mt-0.5 size-4 shrink-0", look.tone)} aria-label={look.label} />
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-medium">{l.name}</span>
            <span className="text-muted-foreground"> · {l.status === "ok" ? l.text : what}</span>
            {off && <p className="text-xs text-muted-foreground">Without it: {off}</p>}
          </div>
          {extra}
        </div>
        {l.status !== "ok" && l.fix && (
          <div className="ml-6.5 flex flex-wrap items-center gap-2">
            <code className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 font-mono text-xs">{l.fix}
              <Button variant="ghost" size="icon-xs" aria-label={`Copy: ${l.fix}`} onClick={() => copyText(l.fix!, "Command copied")}><CopyIcon /></Button>
            </code>
            {l.name !== "pdf export" && <Button variant="outline" size="xs" onClick={() => ask(l.name)}><PlusIcon data-icon="inline-start" />Ask the agent to install it</Button>}
          </div>
        )}
      </li>
    )
  }
  return (
    <>
      <TopBar />
      <main className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
          <p className="text-sm text-muted-foreground">What the engine needs on this machine, and how this dashboard looks.</p>
        </div>
        {!doc ? <Skeleton className="h-64 rounded-xl" /> : (
          <>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Icon name="wrench" className="size-4" />Tools</CardTitle><CardDescription>Each one the engine and the installed types use.</CardDescription></CardHeader>
              <CardContent><ul className="divide-y">{tools.map(l => row(l))}</ul></CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Icon name="key-round" className="size-4" />Keys</CardTitle><CardDescription>Set or not; their value never shows here.</CardDescription></CardHeader>
              <CardContent>
                {keys.length ? <ul className="divide-y">{keys.map(l => row({ ...l, status: l.text.startsWith("set") ? "ok" : "missing" }))}</ul>
                  : <p className="text-sm text-muted-foreground">No installed type needs a key: everything runs on free services.</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Icon name="boxes" className="size-4" />Types</CardTitle><CardDescription>The kinds of case this plugin can run, and the ones of this cases folder (.osint-types). Private types' engine.js are checked by osint.mjs types, never by this page.</CardDescription></CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {doc.types.map(t => {
                    const m = t.refused ? undefined : types?.find(x => x.id === t.id)
                    return (
                      <li key={t.path} className="flex flex-col gap-1.5 py-2.5 text-sm">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <Icon name={t.refused ? "octagon-x" : m?.icon ?? "circle-help"} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          <span className="font-medium">{m?.label ?? t.label ?? t.id}</span>
                          {t.private && <PrivateBadge id={t.id} />}
                          <span className="flex-1" />
                          {t.refused ? <Badge className={cn("gap-1", TONE.rose)}><Icon name="octagon-x" aria-hidden />Refused</Badge>
                            : t.ready ? <><Badge className={cn("gap-1", TONE.emerald)}><Icon name="circle-check" aria-hidden />Ready</Badge>{!!t.notes?.length && <span className="text-xs text-muted-foreground">· {t.notes.join(", ")}</span>}</>
                              : <Badge className={cn("gap-1", TONE.amber)}><Icon name="circle-alert" aria-hidden />Needs {t.missing.join(", ")}</Badge>}
                        </div>
                        {t.refused && <p className="text-xs text-muted-foreground">{t.refused}</p>}
                        {t.private && (
                          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                            <code className="min-w-0 truncate font-mono">{t.where}</code>
                            <Button variant="ghost" size="icon-xs" aria-label={`Copy the path of ${t.id}`} onClick={() => copyText(t.path, "Path copied")}><CopyIcon /></Button>
                          </div>
                        )}
                        {t.errors.length > 0 && <ul className="flex flex-col gap-0.5 font-mono text-xs text-muted-foreground">{t.errors.map((x, i) => <li key={i} className="break-words">{x}</li>)}</ul>}
                      </li>
                    )
                  })}
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Icon name="sparkles" className="size-4" />AI services</CardTitle><CardDescription>No paid service runs by default: the agent does this work itself.</CardDescription></CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {ai.map(l => (
                    <li key={l.name} className="flex items-center gap-2.5 py-2.5 text-sm">
                      <Icon name="power-off" className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="font-medium">{l.name === "gemini" ? "Gemini" : "Google Vision"}</span>
                      <span className="text-muted-foreground">{l.text}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
            {warnings.length > 0 && (
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Icon name="triangle-alert" className="size-4 text-amber-600 dark:text-amber-400" />Warnings</CardTitle></CardHeader>
                <CardContent><ul className="flex flex-col gap-2 text-sm">{warnings.map((w, i) => <li key={i} className={cn("rounded-md px-3 py-2", TONE.amber)}>{w.text}</li>)}</ul></CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Icon name="wifi" className="size-4" />Network</CardTitle>
                <CardDescription>One call to each free service the types read, with its answer and its time.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Button variant="outline" className="self-start" onClick={check} disabled={checking}>{checking ? <Spinner data-icon="inline-start" /> : <WifiIcon data-icon="inline-start" />}Check network</Button>
                {net && (net.length ? <ul className="divide-y">{net.map(l => row(l))}</ul> : <p className="text-sm text-muted-foreground">No service answered.</p>)}
              </CardContent>
            </Card>
            <WatchSettings />
            <Development />
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Icon name="folder-open" className="size-4" />Cases folder</CardTitle><CardDescription>Each case is a folder in it, and an Obsidian vault.</CardDescription></CardHeader>
              <CardContent>
                <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
                  <span className="flex-1">{doc.home}</span>
                  <Button variant="ghost" size="icon-xs" aria-label="Copy the folder's path" onClick={() => copyText(doc.home, "Path copied")}><CopyIcon /></Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Icon name="palette" className="size-4" />Appearance</CardTitle></CardHeader>
          <CardContent>
            <Chips label="Theme" value={theme ?? "dark"} onChange={setTheme} options={[{ value: "dark", label: "Dark", icon: "moon" }, { value: "light", label: "Light", icon: "sun" }, { value: "system", label: "System", icon: "monitor" }]} />
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground">skill-osint {version}</p>
      </main>
    </>
  )
}
