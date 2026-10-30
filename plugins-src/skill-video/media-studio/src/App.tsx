import { useCallback, useEffect, useRef, useState } from "react"
import { AudioLinesIcon, DollarSignIcon, FolderIcon, ImageIcon, LibraryBigIcon, MoonIcon, SettingsIcon, SparklesIcon, SunIcon, VideoIcon } from "lucide-react"
import { ThemeProvider, useTheme } from "next-themes"
import { cn } from "cn"

import { toast } from "sonner"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Switch } from "@/components/ui/switch"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { api, mediaKind, per1000, plain, type Balances, type Job, type Kind, type Model, type Page, type State, type Tool } from "@/lib/api"
import { blank, Composer, type Compose } from "@/components/composer"
import { CutDialog } from "@/components/cut"
import { upload } from "@/components/inputs"
import { Credits, Library } from "@/components/pages"
import { SettingsPage } from "@/components/settings"
import { isRunning, Results, type Bridge } from "@/components/results"

const RAIL = [
  { page: "image", label: "Image", icon: ImageIcon },
  { page: "video", label: "Video", icon: VideoIcon },
  { page: "audio", label: "Audio", icon: AudioLinesIcon },
  null,
  { page: "library", label: "Library", icon: LibraryBigIcon },
  { page: "credits", label: "Credits", icon: DollarSignIcon },
  { page: "settings", label: "Settings", icon: SettingsIcon },
] as const
const SPACES: Kind[] = ["image", "video", "audio"]
const ICON = { image: ImageIcon, video: VideoIcon, audio: AudioLinesIcon }
const RUNNING_DOT = { image: "bg-img", video: "bg-vid", audio: "bg-aud" }

// the page lives in the URL (#image, #credits…): a reload or the back button keeps it
const PAGES = RAIL.flatMap((r) => (r ? [r.page] : []))
const fromHash = (): Page => {
  const h = window.location.hash.slice(1)
  return (PAGES as string[]).includes(h) ? (h as Page) : "video"
}

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
      <TooltipProvider delayDuration={300}>
        <Dashboard />
      </TooltipProvider>
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
  const [page, setShown] = useState<Page>(fromHash)
  const setPage = (p: Page) => (window.location.hash = p)
  useEffect(() => {
    const on = () => setShown(fromHash())
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
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

  // the space's color on <html>: the dialogs and popovers, drawn outside this tree, take it too
  useEffect(() => {
    const k = SPACES.includes(page as Kind) ? page : null
    if (k) document.documentElement.dataset.space = k
    else delete document.documentElement.dataset.space
  }, [page])

  // a job that ends out of sight says so, with a way to it
  const was = useRef<Record<string, string> | null>(null)
  useEffect(() => {
    if (!state) return
    for (const j of state.media) {
      const before = was.current?.[j.id]
      if (!before || before === j.status || !["queued", "running"].includes(before) || j.kind === page) continue
      const open = { label: "Open", onClick: () => setPage(j.kind) }
      if (j.status === "done") toast.success(`${j.label} is ready`, { description: j.name, action: open })
      if (j.status === "failed") toast.error(`${j.label} failed`, { description: plain(j.error ?? ""), action: open })
    }
    was.current = Object.fromEntries(state.media.map((j) => [j.id, j.status]))
  }, [state, page])

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
  const running = Object.fromEntries(SPACES.map((k) => [k, state.media.filter((j) => j.kind === k && isRunning(j)).length]))

  return (
    <div className="grid h-screen grid-cols-[76px_minmax(340px,392px)_1fr] grid-rows-[48px_1fr]">
      <Header state={state} balances={balances} />
      <nav className="flex flex-col items-center gap-1 border-r py-3" aria-label="Pages">
        {RAIL.map((r, i) =>
          r ? (
            <button
              key={r.page}
              type="button"
              aria-current={page === r.page ? "page" : undefined}
              onClick={() => setPage(r.page)}
              className={cn(
                "relative flex w-15 flex-col items-center gap-1 rounded-xl py-2 text-xs text-muted-foreground transition-colors duration-150 outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                page === r.page && (space ? "bg-space/15 font-medium text-space hover:bg-space/15 hover:text-space" : "bg-muted font-medium text-foreground")
              )}
            >
              <r.icon className="size-5" />
              {r.label}
              {running[r.page] > 0 && (
                <span
                  className={cn("absolute top-1 right-2 grid h-4.5 min-w-4.5 place-items-center rounded-full px-1 text-xs leading-none font-semibold text-background tabular-nums", RUNNING_DOT[r.page as Kind])}
                  aria-label={`${running[r.page]} running`}
                >
                  {running[r.page]}
                </span>
              )}
            </button>
          ) : (
            <hr key={i} className="my-2 w-8" />
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
          <main className="flex min-h-0 flex-col overflow-auto bg-canvas px-6 py-5">
            <Results
              jobs={state.media.filter((j) => j.kind === space)}
              home={state.home}
              per1000={per1000(state)}
              onBridge={bridge}
              empty={
                <Empty>
                  <EmptyHeader>
                    <EmptyMedia variant="icon" className="bg-space/15 text-space">
                      {(() => {
                        const Icon = ICON[space]
                        return <Icon />
                      })()}
                    </EmptyMedia>
                    <EmptyTitle>No {space} yet</EmptyTitle>
                    <EmptyDescription>Pick a tool, fill it in, generate: the results land here, with what each one cost. <kbd>⌘V</kbd> pastes a file into the tool.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              }
            />
          </main>
        </>
      ) : page === "library" ? (
        <Library state={state} onBridge={bridge} />
      ) : page === "credits" ? (
        <Credits state={state} balances={balances} onBridge={bridge} />
      ) : (
        <SettingsPage key={JSON.stringify(state.settings)} state={state} models={models} onSaved={refresh} />
      )}
      <DropToLibrary onAdded={refresh} />
    </div>
  )
}

// a file dropped anywhere the composer does not take it goes to the library; a video passes through Edit reference
// first (closing it keeps the video whole), several one after the other
async function keep(path: string, onAdded: () => void) {
  try {
    await api.import(path)
    toast.success("Added to the library", { description: path.split("/").pop()?.replace(/^\d+-/, ""), action: { label: "Show", onClick: () => (window.location.hash = "library") } })
    onAdded()
  } catch (e) {
    toast.error(plain((e as Error).message))
  }
}

function DropToLibrary({ onAdded }: { onAdded: () => void }) {
  const [over, setOver] = useState(false)
  const [taken, setTaken] = useState(false)
  const [videos, setVideos] = useState<string[]>([])
  const depth = useRef(0)

  useEffect(() => {
    const files = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files")
    const enter = (e: DragEvent) => files(e) && ++depth.current && setOver(true)
    const leave = (e: DragEvent) => files(e) && --depth.current <= 0 && ((depth.current = 0), setOver(false))
    // the composer prevents the default when its inputs take the file: then it is not the library's
    const move = (e: DragEvent) => {
      if (!files(e)) return
      setTaken(e.defaultPrevented)
      e.preventDefault()
    }
    const drop = async (e: DragEvent) => {
      depth.current = 0
      setOver(false)
      if (e.defaultPrevented || !e.dataTransfer?.files.length) return
      e.preventDefault()
      for (const f of [...e.dataTransfer.files]) {
        const k = mediaKind(f.name)
        if (k === "other") {
          toast.error(`${f.name} is not an image, a video or a sound`)
          continue
        }
        try {
          const path = await upload(f)
          if (k === "video") setVideos((v) => [...v, path])
          else await keep(path, onAdded)
        } catch (err) {
          toast.error(plain((err as Error).message))
        }
      }
    }
    const on = { dragenter: enter, dragleave: leave, dragover: move, drop } as const
    for (const [type, fn] of Object.entries(on)) window.addEventListener(type, fn as EventListener)
    return () => {
      for (const [type, fn] of Object.entries(on)) window.removeEventListener(type, fn as EventListener)
    }
  }, [onAdded])

  const next = (path: string) => {
    setVideos((v) => v.slice(1))
    keep(path, onAdded)
  }
  return (
    <>
      {over && !taken && (
        <div className="pointer-events-none fixed inset-2 z-50 grid place-items-center rounded-2xl border-2 border-dashed border-space bg-space/10 animate-in fade-in-0">
          <span className="flex items-center gap-2 rounded-full bg-background/95 px-4 py-2 text-sm font-medium shadow-lg">
            <LibraryBigIcon className="size-4 text-space" /> Drop to add to the library
          </span>
        </div>
      )}
      <CutDialog path={videos[0] ?? null} onClose={() => next(videos[0])} onDone={next} />
    </>
  )
}

function Header({ state, balances }: { state: State; balances: Balances | null }) {
  const { resolvedTheme, setTheme } = useTheme()
  const ob = balances?.openrouter, eb = balances?.elevenlabs
  const folder = state.home.split("/").filter(Boolean).pop()
  return (
    <header className="col-span-full flex items-center gap-3 border-b px-4">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-linear-to-br from-img via-vid to-aud text-white" aria-hidden>
        <SparklesIcon className="size-4" />
      </span>
      <h1 className="text-[15px] font-semibold tracking-tight whitespace-nowrap">Media Generator</h1>
      <button
        type="button"
        title={`${state.home}\nClick to copy the path`}
        onClick={() => navigator.clipboard.writeText(state.home).then(() => toast.success("Folder path copied"))}
        className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <FolderIcon className="size-3.5 shrink-0" />
        <span className="truncate">{folder}</span>
      </button>
      <span className="flex-1" />
      <Balance name="OpenRouter">
        {!state.keys.openrouter ? <span className="text-muted-foreground">no key</span>
          : !ob ? <span className="text-muted-foreground">…</span>
          : ob.error ? <span className="text-muted-foreground">unavailable</span>
          : ob.account_left != null ? <><b className="font-semibold tabular-nums">${ob.account_left.toFixed(2)}</b><small className="text-muted-foreground">left</small></>
          : ob.key_left != null ? <><b className="font-semibold tabular-nums">${ob.key_left.toFixed(2)}</b><small className="text-muted-foreground">left on this key</small></>
          : <small className="text-muted-foreground">no limit on this key</small>}
      </Balance>
      <Balance name="ElevenLabs">
        {!state.keys.elevenlabs ? <span className="text-muted-foreground">no key</span>
          : !eb ? <span className="text-muted-foreground">…</span>
          : eb.error ? <span className="text-muted-foreground">unavailable</span>
          : <><b className="font-semibold tabular-nums">{(eb.left ?? 0).toLocaleString("en-US")}</b><small className="text-muted-foreground">credits left</small></>}
      </Balance>
      {state.fake?.bases?.length ? (
        // a dev or test server: the fake APIs it was started on, on or off; the page reloads on the other side
        <span className="flex items-center gap-2">
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
        </span>
      ) : null}
      <button
        type="button"
        aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        title={resolvedTheme === "dark" ? "Light mode" : "Dark mode"}
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {resolvedTheme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
      </button>
    </header>
  )
}

function Balance({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-1.5 rounded-full border bg-card/50 px-3 py-1 text-sm whitespace-nowrap">
      <span className="text-muted-foreground">{name}</span>
      {children}
    </span>
  )
}
