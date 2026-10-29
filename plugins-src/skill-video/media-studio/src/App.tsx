import { useCallback, useEffect, useRef, useState } from "react"
import { AudioLinesIcon, DollarSignIcon, FolderIcon, ImageIcon, MoonIcon, SettingsIcon, SunIcon, VideoIcon } from "lucide-react"
import { ThemeProvider, useTheme } from "next-themes"
import { cn } from "cn"

import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { Toaster } from "@/components/ui/sonner"
import { api, per1000, plain, type Balances, type Job, type Kind, type Model, type Page, type State, type Tool } from "@/lib/api"
import { blank, Composer, type Compose } from "@/components/composer"
import { Credits, Library, SettingsPage } from "@/components/pages"
import { Results, type Bridge } from "@/components/results"

const RAIL = [
  { page: "image", label: "Image", icon: ImageIcon },
  { page: "video", label: "Video", icon: VideoIcon },
  { page: "audio", label: "Audio", icon: AudioLinesIcon },
  null,
  { page: "library", label: "Library", icon: FolderIcon },
  { page: "credits", label: "Credits", icon: DollarSignIcon },
  { page: "settings", label: "Settings", icon: SettingsIcon },
] as const
const SPACES: Kind[] = ["image", "video", "audio"]
const TITLE: Record<Kind, string> = { image: "Image", video: "Video", audio: "Audio" }

// the prompts Claude wrote that the user already applied, per space (this browser only)
const SEEN_KEY = "media-generator:drafts-seen"
const readSeen = (): Record<string, string> => {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}")
  } catch {
    return {}
  }
}

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <Dashboard />
      <Toaster position="bottom-right" />
    </ThemeProvider>
  )
}

function Dashboard() {
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tools, setTools] = useState<Record<Kind, Tool[]> | null>(null)
  const [models, setModels] = useState<Partial<Record<Kind, Model[]>>>({})
  const [balances, setBalances] = useState<Balances | null>(null)
  const [engine, setEngine] = useState("")
  const [page, setPage] = useState<Page>("video")
  const [compose, setCompose] = useState<Record<Kind, Compose>>({ image: blank("image"), video: blank("video"), audio: blank("audio") })
  const [seen, setSeen] = useState<Record<string, string>>(readSeen)

  // the folder's state every 2 s: running jobs, results, drafts, settings
  const refresh = useCallback(() => api.state().then((s) => (setState(s), setError(null)), (e) => setError(e.message)), [])
  useEffect(() => {
    refresh()
    api.tools().then(setTools, (e) => setError(e.message))
    api.engine().then((e) => setEngine(e.engine), () => {})
    const t = setInterval(refresh, 2000)
    return () => clearInterval(t)
  }, [refresh])

  // a draft older than an hour when the page opens counts as seen
  const first = useRef(true)
  useEffect(() => {
    if (!state || !first.current) return
    first.current = false
    setSeen((s) => {
      const old = Object.fromEntries(Object.entries(state.drafts).filter(([k, d]) => d && !s[k] && Date.now() - Date.parse(d.at) > 36e5).map(([k, d]) => [k, d!.at]))
      return { ...s, ...old }
    })
  }, [state])

  // the balances: on load, every minute, and after each finished job
  const finished = state?.media.filter((j) => j.status === "done" || j.status === "failed").length ?? 0
  useEffect(() => {
    api.balances(finished > 0).then(setBalances, () => {})
    const t = setInterval(() => api.balances().then(setBalances, () => {}), 60e3)
    return () => clearInterval(t)
  }, [finished])

  // the models of the spaces in view (Settings needs all three)
  useEffect(() => {
    const want = page === "settings" ? SPACES : SPACES.includes(page as Kind) ? [page as Kind] : []
    for (const k of want)
      if (!models[k]) api.models(k).then((list) => setModels((m) => ({ ...m, [k]: list })), () => setModels((m) => ({ ...m, [k]: [] })))
  }, [page, models])

  // what a result leads to: its remix, or the next tool with it as input
  const bridge = (b: Bridge, job: Job, file: string) => {
    const home = state!.home
    if (b === "remix") {
      const tool = tools?.[job.kind].find((t) => t.id === job.tool)
      const inputs = Object.fromEntries(Object.entries(job.inputs ?? {}).map(([k, list]) => [k, list.map((f) => `${home}/media/${job.id}/${f}`)]))
      const intent = job.raw_prompt ?? ""
      const raw = !!job.raw && tool?.template !== "{prompt}"
      setCompose((c) => ({
        ...c,
        [job.kind]: { tool: job.tool, model: job.provider === "openrouter" ? `openrouter:${job.model}` : undefined, intent: raw ? "" : intent, raw, rawText: raw ? intent : "", fields: job.fields ?? {}, inputs, params: job.params ?? {} },
      }))
      return setPage(job.kind)
    }
    const next = { animate: ["animate", "first_frame"], extend: ["extend", "video"], upscale: ["upscale", "video"], avatar: ["talking-avatar", "audio"] }[b]
    setCompose((c) => ({ ...c, video: { ...blank("video", next[0]), inputs: { [next[1]]: [file] } } }))
    setPage("video")
  }

  if (!state || !tools)
    return (
      <div className="grid h-screen place-items-center text-sm text-muted-foreground">
        {error ? `The dashboard's server does not answer (${error}). Run media.mjs studio again.` : "Loading…"}
      </div>
    )

  const space = SPACES.includes(page as Kind) ? (page as Kind) : null

  return (
    <div className="grid h-screen grid-cols-[64px_minmax(320px,380px)_1fr] grid-rows-[52px_1fr]">
      <Header state={state} balances={balances} />
      <nav className="flex flex-col items-center gap-1 border-r py-2.5" aria-label="Pages">
        {RAIL.map((r, i) =>
          r ? (
            <button
              key={r.page}
              type="button"
              aria-current={page === r.page ? "page" : undefined}
              onClick={() => setPage(r.page)}
              className={cn(
                "flex w-12 flex-col items-center gap-1 rounded-lg py-2 text-[11px] text-muted-foreground hover:text-foreground",
                page === r.page && "bg-muted text-foreground"
              )}
            >
              <r.icon className="size-[18px]" />
              {r.label}
            </button>
          ) : (
            <hr key={i} className="my-1.5 w-8" />
          )
        )}
      </nav>
      {space ? (
        <>
          <Composer
            key={space}
            kind={space}
            tools={tools[space]}
            models={models[space] ?? []}
            state={state}
            engine={engine}
            value={compose[space]}
            onChange={(v) => setCompose((c) => ({ ...c, [space]: v }))}
            draftSeen={seen[space] ?? ""}
            onDraftSeen={(at) => {
              const next = { ...seen, [space]: at }
              setSeen(next)
              try {
                localStorage.setItem(SEEN_KEY, JSON.stringify(next))
              } catch {
                /* a private window keeps it for the session */
              }
            }}
          />
          <main className="flex min-h-0 flex-col gap-4 overflow-auto px-5 py-4">
            <h2 className="text-lg font-semibold">{TITLE[space]}</h2>
            <Results
              jobs={state.media.filter((j) => j.kind === space)}
              home={state.home}
              per1000={per1000(state)}
              onBridge={bridge}
              empty={
                <div className="grid flex-1 place-items-center rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
                  Nothing here yet. Pick a tool, fill it in, generate: the results land here, with what each one cost.
                </div>
              }
            />
          </main>
        </>
      ) : page === "library" ? (
        <Library state={state} onBridge={bridge} />
      ) : page === "credits" ? (
        <Credits state={state} balances={balances} />
      ) : (
        <SettingsPage key={JSON.stringify(state.settings)} state={state} models={models} onSaved={refresh} />
      )}
    </div>
  )
}

function Header({ state, balances }: { state: State; balances: Balances | null }) {
  const { resolvedTheme, setTheme } = useTheme()
  const ob = balances?.openrouter, eb = balances?.elevenlabs
  return (
    <header className="col-span-full flex items-center gap-3 border-b px-4">
      <h1 className="text-[15px] font-semibold">Media Generator</h1>
      <span className="truncate text-sm text-muted-foreground" title={state.home}>{state.home}</span>
      <span className="flex-1" />
      <span className="flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1 text-sm whitespace-nowrap">
        OpenRouter{" "}
        {!state.keys.openrouter ? <span className="text-muted-foreground">no key</span>
          : !ob ? <span className="text-muted-foreground">…</span>
          : ob.error ? <span className="text-muted-foreground">unavailable</span>
          : ob.account_left != null ? <><b className="font-semibold tabular-nums">${ob.account_left.toFixed(2)}</b><small className="text-muted-foreground">left</small></>
          : ob.key_left != null ? <><b className="font-semibold tabular-nums">${ob.key_left.toFixed(2)}</b><small className="text-muted-foreground">left on this key</small></>
          : <small className="text-muted-foreground">no limit on this key</small>}
      </span>
      <span className="flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1 text-sm whitespace-nowrap">
        ElevenLabs{" "}
        {!state.keys.elevenlabs ? <span className="text-muted-foreground">no key</span>
          : !eb ? <span className="text-muted-foreground">…</span>
          : eb.error ? <span className="text-muted-foreground">unavailable</span>
          : <><b className="font-semibold tabular-nums">{(eb.left ?? 0).toLocaleString("en-US")} credits</b><small className="text-muted-foreground">left</small></>}
      </span>
      {state.fake?.bases?.length ? (
        // a dev or test server: the fake APIs it was started on, on or off; the page reloads on the other side
        <>
          {state.fake.on && (
            <span className="rounded-md border border-cost/60 px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap text-cost" title={`Nothing is spent: the APIs are fakes at ${state.fake.bases.join(" and ")}`}>
              Fake API
            </span>
          )}
          <Switch
            checked={state.fake.on}
            onCheckedChange={(on) => api.fake(on).then(() => window.location.reload(), (e) => toast.error(plain((e as Error).message)))}
            aria-label={state.fake.on ? "Use the real APIs" : "Use the fake APIs"}
            title={state.fake.on ? "On: the fake APIs, nothing is spent. Off: the real APIs, with this server's keys" : `Off: the real APIs. On: the fakes at ${state.fake.bases.join(" and ")}`}
          />
        </>
      ) : null}
      <button
        type="button"
        aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        title={resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        className="grid size-8 place-items-center rounded-lg border hover:bg-muted"
      >
        {resolvedTheme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
      </button>
    </header>
  )
}
