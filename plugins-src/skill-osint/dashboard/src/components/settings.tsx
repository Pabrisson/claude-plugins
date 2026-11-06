import { CopyIcon, PlusIcon, WifiIcon } from "lucide-react"
import { useTheme } from "next-themes"
import { useEffect, useRef, useState, type ReactNode } from "react"
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
import { useWatchState } from "@/components/watch-control"
import { WatchSettings } from "@/components/watch-settings"
import { WorkspacesCard, useWorkspaces } from "@/components/workspace-menu"
import { api, type Doctor, type DoctorLine } from "@/lib/api"
import { useBasket } from "@/lib/basket"
import { setLang, t, useLang, type Lang } from "@/lib/i18n"
import { TONE } from "@/lib/tones"
import { cn } from "@/lib/utils"

const LOOK: Record<string, { icon: string; tone: string; label: string }> = {
  ok: { icon: "circle-check", tone: "text-emerald-600 dark:text-emerald-400", label: "ok" },
  missing: { icon: "circle-alert", tone: "text-amber-600 dark:text-amber-400", label: "missing" },
  MISSING: { icon: "octagon-x", tone: "text-rose-600 dark:text-rose-400", label: "MISSING" },
}
const AI = ["gemini", "google vision"]

// Settings: what the engine needs and has (doctor), the keys (set or not, never their value), each type's readiness,
// the AI services (off), the warnings, the network check, the cases folder, the theme, the version; on a wide screen a
// contents column on the left, each section with its state, the one in view highlighted
// Settings › Development: developer mode (shows the bar's Fake APIs switch) and the Fake APIs, on a server started on them
function Development() {
  const st = useAppState(), { change, dialog } = useFakeGuard()
  return (
    <Card id="development" data-toc className="scroll-mt-20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Icon name="flask-conical" className="size-4" />{t("Development")}</CardTitle>
        <CardDescription>{t("For testing the dashboard without calling any real service.")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <label className="flex items-start gap-3">
          <Switch checked={st.developer} onCheckedChange={on => change(!on && st.fake, () => api.developer(on))} aria-label={t("Developer mode")} className="mt-0.5" />
          <span className="min-w-0 text-sm"><span className="flex items-center gap-1.5 font-medium"><Icon name="code" className="size-4 text-muted-foreground" aria-hidden />{t("Developer mode")}</span>
            <span className="text-muted-foreground">{t("Shows the Fake APIs switch in the top bar. Turning it off also turns the fake APIs off.")}</span></span>
        </label>
        {st.fake_available ? (
          <>
            {st.developer && (
              <label className="flex items-start gap-3">
                <Switch checked={st.fake} onCheckedChange={on => change(!on, () => api.fake(on))} aria-label={t("Fake APIs")} className="mt-0.5" />
                <span className="min-w-0 text-sm"><span className="flex items-center gap-1.5 font-medium"><Icon name="drama" className="size-4 text-muted-foreground" aria-hidden />{t("Fake APIs")}</span>
                  <span className="text-muted-foreground">{t("On: every service the engine calls (the watch and the PDF export included) answers from recorded fixtures, with made-up data. Off: the real services are called. No restart needed; a command already running ends on the old setting. A case made or refreshed on the fake APIs says so in its Journal and its print footer.")}</span></span>
              </label>
            )}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Icon name="server" className="size-4 text-muted-foreground" aria-hidden /><span className="font-medium">{t("Fake API server")}</span>
              <code className="rounded-md bg-muted px-2 py-1 font-mono text-xs">{st.fake_url}</code>
              <Badge className={cn("gap-1", st.fake ? TONE.amber : TONE.neutral)}>{st.fake ? t("In use") : t("Not in use")}</Badge>
            </div>
          </>
        ) : <p className="text-sm text-muted-foreground">{t("This server was not started on fake APIs (the demo and the tests are), so it has none to turn on.")}</p>}
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
  const lang = useLang(), st = useAppState(), watch = useWatchState().state, ws = useWorkspaces()
  // each workspace's investigations (the cases at a top), for Settings › Workspaces
  const [counts, setCounts] = useState<Record<string, number>>({})
  useEffect(() => { api.cases().then(cs => { const here = new Set(cs.map(c => c.slug)), n: Record<string, number> = {}; for (const c of cs) if (!c.parent || !here.has(c.parent)) n[c.workspace] = (n[c.workspace] ?? 0) + 1; setCounts(n) }, () => {}) }, [ws])
  const [at, setAt] = useState("tools"), picked = useRef<string | null>(null)
  // the section in view: the last whose top passed under the bar; at the page's end, the one clicked if it shows, else the last
  useEffect(() => {
    const f = () => {
      const els = [...document.querySelectorAll<HTMLElement>("[data-toc]")]
      let cur: string | undefined = els[0]?.id
      for (const el of els) if (el.getBoundingClientRect().top <= 96) cur = el.id
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) {
        const p = picked.current ? document.getElementById(picked.current) : null
        cur = p && p.getBoundingClientRect().top < innerHeight ? p.id : els.at(-1)?.id
      }
      if (cur) setAt(cur)
    }
    f()
    addEventListener("scroll", f, { passive: true })
    return () => removeEventListener("scroll", f)
  }, [doc])
  const go = (id: string) => { picked.current = id; setAt(id); document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }) }
  useEffect(() => { api.doctor().then(setDoc, e => toast.error(t("doctor failed"), { description: (e as Error).message })); appState().then(s => setVersion(s.version)) }, [])
  // #/settings?at=<section> (« Manage workspaces » in the bar): that section, once the page is drawn
  useEffect(() => { const to = new URLSearchParams(location.hash.split("?")[1] ?? "").get("at"); if (!doc || !to) return; const id = setTimeout(() => go(to), 50); return () => clearTimeout(id) }, [doc])
  const keyIds = new Set((types ?? []).flatMap(t => (t as { requires?: { keys?: { id: string }[] } }).requires?.keys?.map(k => k.id) ?? []))
  const lines = doc?.lines ?? []
  // the PDF export line is an `info` line (the browser it prints with) or `missing`: shown in Tools either way
  const tools = lines.filter(l => l.status in LOOK || l.name === "pdf export").map(l => (l.status === "info" ? { ...l, status: "ok" as const } : l))
  const keys = lines.filter(l => keyIds.has(l.name))
  const ai = lines.filter(l => AI.includes(l.name))
  const warnings = lines.filter(l => l.status === "warning")
  async function check() {
    setChecking(true)
    try { const d = await api.doctor(true), known = new Set(lines.map(l => l.name)); setNet(d.lines.filter(l => !known.has(l.name))) } catch (e) { toast.error(t("Network check failed"), { description: (e as Error).message }) }
    setChecking(false)
  }
  const missing = tools.filter(l => l.status !== "ok"), unready = (doc?.types ?? []).filter(ty => ty.refused || !ty.ready)
  const answered = (net ?? []).filter(l => l.status === "ok").length, wait = doc ? "" : "…"
  const toc: { id: string; icon: string; title: string; status: string; warn?: boolean }[] = [
    { id: "tools", icon: "wrench", title: t("Tools"), status: wait || (missing.length ? t("{n} missing", { n: missing.length }) : t("{n} ok", { n: tools.length })), warn: tools.some(l => l.status === "MISSING") },
    { id: "keys", icon: "key-round", title: t("Keys"), status: wait || (keys.length ? t("Set: {n} of {m}", { n: keys.filter(l => l.text.startsWith("set")).length, m: keys.length }) : t("None needed")) },
    { id: "types", icon: "boxes", title: t("Types"), status: wait || (unready.length ? t("{n} ready · {m} to look at", { n: doc!.types.length - unready.length, m: unready.length }) : t("{n} ready", { n: doc!.types.length })), warn: unready.length > 0 },
    { id: "ai", icon: "sparkles", title: t("AI services"), status: wait || t("All off") },
    ...(warnings.length ? [{ id: "warnings", icon: "triangle-alert", title: t("Warnings"), status: t(warnings.length === 1 ? "{n} warning" : "{n} warnings", { n: warnings.length }), warn: true }] : []),
    { id: "network", icon: "wifi", title: t("Network"), status: wait || (net ? t("{n} of {m} answered", { n: answered, m: net.length }) : t("Not checked yet")), warn: !!net && answered < net.length },
    { id: "watch", icon: "eye", title: t("Watch"), status: !watch ? "…" : !watch.on ? t("Paused") : t(watch.cases.length === 1 ? "On · {n} case" : "On · {n} cases", { n: watch.cases.length }) },
    { id: "development", icon: "flask-conical", title: t("Development"), status: !st.developer ? t("Off") : st.fake ? t("On · fake APIs") : t("On") },
    { id: "workspaces", icon: "folder-kanban", title: t("Workspaces"), status: ws ? t(ws.list.length === 1 ? "{n} workspace" : "{n} workspaces", { n: ws.list.length }) : "…" },
    { id: "folder", icon: "folder-open", title: t("Cases folder"), status: wait || (doc!.home.split(/[\\/]/).filter(Boolean).at(-1) ?? doc!.home) },
    { id: "appearance", icon: "palette", title: t("Appearance"), status: `${t({ light: "Light", system: "System" }[theme ?? ""] ?? "Dark")} · ${lang === "fr" ? "Français" : "English"}` },
  ]
  const ask = (tool: string) => { add({ tag: "install", text: tool }); toast.success(t("Added to the prompt"), { description: `[install] ${tool}` }) }
  const row = (l: DoctorLine, extra?: ReactNode) => {
    const look = LOOK[l.status] ?? { icon: "info", tone: "text-muted-foreground", label: l.status }
    const [what, off] = l.text.split(/ — (.+)/)
    return (
      <li key={`${l.name}-${l.text}`} className="flex flex-col gap-2 py-2.5">
        <div className="flex items-start gap-2.5">
          <Icon name={look.icon} className={cn("mt-0.5 size-4 shrink-0", look.tone)} aria-label={t(look.label)} />
          <div className="min-w-0 flex-1 text-sm">
            <span className="font-medium">{l.name}</span>
            <span className="text-muted-foreground"> · {l.status === "ok" ? l.text : what}</span>
            {off && <p className="text-xs text-muted-foreground">{t("Without it: {off}", { off })}</p>}
          </div>
          {extra}
        </div>
        {l.status !== "ok" && l.fix && (
          <div className="ml-6.5 flex flex-wrap items-center gap-2">
            <code className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 font-mono text-xs">{l.fix}
              <Button variant="ghost" size="icon-xs" aria-label={t("Copy: {text}", { text: l.fix })} onClick={() => copyText(l.fix!, t("Command copied"))}><CopyIcon /></Button>
            </code>
            {l.name !== "pdf export" && <Button variant="outline" size="xs" onClick={() => ask(l.name)}><PlusIcon data-icon="inline-start" />{t("Ask the agent to install it")}</Button>}
          </div>
        )}
      </li>
    )
  }
  return (
    <>
      <TopBar />
      <div className="mx-auto flex max-w-[66rem] gap-8 px-4 py-6">
        <aside className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] w-60 shrink-0 self-start overflow-y-auto lg:block">
          <nav className="flex flex-col gap-1" aria-label={t("Settings")}>
            {toc.map(n => (
              <button key={n.id} type="button" aria-current={at === n.id ? "true" : undefined} onClick={() => go(n.id)}
                className={cn("flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50", at === n.id && "bg-muted")}>
                <Icon name={n.icon} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{n.title}</span>
                  <span className={cn("block truncate text-xs", n.warn ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>{n.status}</span>
                </span>
                {n.warn && <Icon name="triangle-alert" className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-label={t("Needs a look")} />}
              </button>
            ))}
          </nav>
        </aside>
        <main className="mx-auto flex min-w-0 max-w-3xl flex-1 flex-col gap-5">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{t("Settings")}</h1>
            <p className="text-sm text-muted-foreground">{t("What the engine needs on this machine, and how this dashboard looks.")}</p>
          </div>
          {!doc ? <Skeleton className="h-64 rounded-xl" /> : (
            <>
              <Card id="tools" data-toc className="scroll-mt-20">
                <CardHeader><CardTitle className="flex items-center gap-2"><Icon name="wrench" className="size-4" />{t("Tools")}</CardTitle><CardDescription>{t("Each one the engine and the installed types use.")}</CardDescription></CardHeader>
                <CardContent><ul className="divide-y">{tools.map(l => row(l))}</ul></CardContent>
              </Card>
              <Card id="keys" data-toc className="scroll-mt-20">
                <CardHeader><CardTitle className="flex items-center gap-2"><Icon name="key-round" className="size-4" />{t("Keys")}</CardTitle><CardDescription>{t("Set or not; their value never shows here.")}</CardDescription></CardHeader>
                <CardContent>
                  {keys.length ? <ul className="divide-y">{keys.map(l => row({ ...l, status: l.text.startsWith("set") ? "ok" : "missing" }))}</ul>
                    : <p className="text-sm text-muted-foreground">{t("No installed type needs a key: everything runs on free services.")}</p>}
                </CardContent>
              </Card>
              <Card id="types" data-toc className="scroll-mt-20">
                <CardHeader><CardTitle className="flex items-center gap-2"><Icon name="boxes" className="size-4" />{t("Types")}</CardTitle><CardDescription>{t("The kinds of case this plugin can run, and the ones of this cases folder (.osint-types). Private types' engine.js are checked by osint.mjs types, never by this page.")}</CardDescription></CardHeader>
                <CardContent>
                  <ul className="divide-y">
                    {doc.types.map(ty => {
                      const m = ty.refused ? undefined : types?.find(x => x.id === ty.id)
                      return (
                        <li key={ty.path} className="flex flex-col gap-1.5 py-2.5 text-sm">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <Icon name={ty.refused ? "octagon-x" : m?.icon ?? "circle-help"} className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="font-medium">{m?.label ?? ty.label ?? ty.id}</span>
                            {ty.private && <PrivateBadge id={ty.id} />}
                            <span className="flex-1" />
                            {ty.refused ? <Badge className={cn("gap-1", TONE.rose)}><Icon name="octagon-x" aria-hidden />{t("Refused")}</Badge>
                              : ty.ready ? <><Badge className={cn("gap-1", TONE.emerald)}><Icon name="circle-check" aria-hidden />{t("Ready")}</Badge>{!!ty.notes?.length && <span className="text-xs text-muted-foreground">· {ty.notes.join(", ")}</span>}</>
                                : <Badge className={cn("gap-1", TONE.amber)}><Icon name="circle-alert" aria-hidden />{t("Needs {list}", { list: ty.missing.join(", ") })}</Badge>}
                          </div>
                          {ty.refused && <p className="text-xs text-muted-foreground">{ty.refused}</p>}
                          {ty.private && (
                            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                              <code className="min-w-0 truncate font-mono">{ty.where}</code>
                              <Button variant="ghost" size="icon-xs" aria-label={t("Copy the path of {id}", { id: ty.id })} onClick={() => copyText(ty.path, t("Path copied"))}><CopyIcon /></Button>
                            </div>
                          )}
                          {ty.errors.length > 0 && <ul className="flex flex-col gap-0.5 font-mono text-xs text-muted-foreground">{ty.errors.map((x, i) => <li key={i} className="break-words">{x}</li>)}</ul>}
                        </li>
                      )
                    })}
                  </ul>
                </CardContent>
              </Card>
              <Card id="ai" data-toc className="scroll-mt-20">
                <CardHeader><CardTitle className="flex items-center gap-2"><Icon name="sparkles" className="size-4" />{t("AI services")}</CardTitle><CardDescription>{t("No paid service runs by default: the agent does this work itself.")}</CardDescription></CardHeader>
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
                <Card id="warnings" data-toc className="scroll-mt-20">
                  <CardHeader><CardTitle className="flex items-center gap-2"><Icon name="triangle-alert" className="size-4 text-amber-600 dark:text-amber-400" />{t("Warnings")}</CardTitle></CardHeader>
                  <CardContent><ul className="flex flex-col gap-2 text-sm">{warnings.map((w, i) => <li key={i} className={cn("rounded-md px-3 py-2", TONE.amber)}>{w.text}</li>)}</ul></CardContent>
                </Card>
              )}
              <Card id="network" data-toc className="scroll-mt-20">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Icon name="wifi" className="size-4" />{t("Network")}</CardTitle>
                  <CardDescription>{t("One call to each free service the types read, with its answer and its time.")}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Button variant="outline" className="self-start" onClick={check} disabled={checking}>{checking ? <Spinner data-icon="inline-start" /> : <WifiIcon data-icon="inline-start" />}{t("Check network")}</Button>
                  {net && (net.length ? <ul className="divide-y">{net.map(l => row(l))}</ul> : <p className="text-sm text-muted-foreground">{t("No service answered.")}</p>)}
                </CardContent>
              </Card>
              <div id="watch" data-toc className="scroll-mt-20"><WatchSettings /></div>
              <Development />
              <WorkspacesCard counts={counts} />
              <Card id="folder" data-toc className="scroll-mt-20">
                <CardHeader><CardTitle className="flex items-center gap-2"><Icon name="folder-open" className="size-4" />{t("Cases folder")}</CardTitle><CardDescription>{t("Each case is a folder in it, and an Obsidian vault.")}</CardDescription></CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 font-mono text-xs break-all">
                    <span className="flex-1">{doc.home}</span>
                    <Button variant="ghost" size="icon-xs" aria-label={t("Copy the folder's path")} onClick={() => copyText(doc.home, t("Path copied"))}><CopyIcon /></Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
          <Card id="appearance" data-toc className="scroll-mt-20">
            <CardHeader><CardTitle className="flex items-center gap-2"><Icon name="palette" className="size-4" />{t("Appearance")}</CardTitle></CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="w-24 text-sm text-muted-foreground">{t("Theme")}</span>
                <Chips label={t("Theme")} value={theme ?? "dark"} onChange={setTheme} options={[{ value: "dark", label: t("Dark"), icon: "moon" }, { value: "light", label: t("Light"), icon: "sun" }, { value: "system", label: t("System"), icon: "monitor" }]} />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="w-24 text-sm text-muted-foreground">{t("Language")}</span>
                {/* each language by its own name, whatever the language shown */}
                <Chips label={t("Language")} value={lang} onChange={v => setLang(v as Lang)} options={[{ value: "en", label: "English", icon: "languages" }, { value: "fr", label: "Français", icon: "languages" }]} />
              </div>
            </CardContent>
          </Card>
          <p className="text-center text-xs text-muted-foreground">skill-osint {version}</p>
        </main>
      </div>
    </>
  )
}
