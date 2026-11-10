import { useCallback, useEffect, useRef, useState } from "react"
import { AudioLinesIcon, DollarSignIcon, FolderIcon, FolderKanbanIcon, ImageIcon, LibraryBigIcon, MoonIcon, SettingsIcon, SparklesIcon, SunIcon, VideoIcon } from "lucide-react"
import { ThemeProvider, useTheme } from "next-themes"
import { cn } from "cn"

import { toast } from "sonner"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Switch } from "@/components/ui/switch"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { api, currentOf, inWorkspace, mediaKind, outputPath, per1000, plain, ROUTER_NAME, type Balances, type Clip, type Job, type Kind, type Model, type Page, type Place, type State, type Tool } from "@/lib/api"
import { endOf, freeze, inside, isStill, lay, marginsTo, place, placeOf, voiceUnder } from "@/lib/timeline"
import { Chips, valueIcon, ProviderIcon } from "@/components/chips"
import { blank, Composer, type Compose } from "@/components/composer"
import { CutDialog } from "@/components/cut"
import { upload, Workspaces } from "@/components/inputs"
import { Credits, Library } from "@/components/pages"
import type { ElementDraft, Use } from "@/components/elements"
import { SettingsPage } from "@/components/settings"
import { isRunning, Results, type Bridge } from "@/components/results"
import { lengthOf, useTimelines, type Ask } from "@/components/timeline"
import { WorkspaceMenu, WorkspacePage } from "@/components/workspace"
import { ToolFilter, toolKey } from "@/components/tool-filter"
import { locale, own, t } from "@/lib/i18n"

// the project first (the home page), the Library, then the spaces that make things, the money and the settings. Each
// word fits the rail's 60 px: the Library's has a key of its own ({short} fills with nothing), its French a short word
const RAIL = [
  { page: "workspace", label: t("Workspace"), icon: FolderKanbanIcon },
  { page: "library", label: t("Library{short}", { short: "" }), icon: LibraryBigIcon },
  null,
  { page: "image", label: t("Image"), icon: ImageIcon },
  { page: "video", label: t("Video"), icon: VideoIcon },
  { page: "audio", label: t("Audio"), icon: AudioLinesIcon },
  null,
  { page: "credits", label: t("Credits"), icon: DollarSignIcon },
  { page: "settings", label: t("Settings"), icon: SettingsIcon },
] as const
// a space with nothing yet, in the scope shown
const NONE_YET: Record<Kind, (name?: string) => string> = {
  image: (name) => (name ? t("No image in {name} yet", { name }) : t("No image yet")),
  video: (name) => (name ? t("No video in {name} yet", { name }) : t("No video yet")),
  audio: (name) => (name ? t("No audio in {name} yet", { name }) : t("No audio yet")),
}
const SPACES: Kind[] = ["image", "video", "audio"]
const TOOL_KEY = "media-generator:tool-filter"
const ICON = { image: ImageIcon, video: VideoIcon, audio: AudioLinesIcon }
const RUNNING_DOT = { image: "bg-img", video: "bg-vid", audio: "bg-aud" }

// the page lives in the URL (#image, #credits…): a reload or the back button keeps it
const PAGES = RAIL.flatMap((r) => (r ? [r.page] : []))
const fromHash = (): Page => {
  // a page may name its tab after it (#library/styles)
  const h = window.location.hash.slice(1).split("/")[0]
  return (PAGES as string[]).includes(h) ? (h as Page) : "workspace"
}

// the prompts the agent wrote that the user already applied, per space (this browser only)
const SEEN_KEY = "media-generator:drafts-seen"
// what a space's results show: the current workspace's, or all (this browser only)
const SCOPE_KEY = "media-generator:results-scope"
const readScope = () => {
  try {
    return localStorage.getItem(SCOPE_KEY) === "all" ? "all" : "workspace"
  } catch {
    return "workspace"
  }
}
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
  const [elementDraft, setElementDraft] = useState<ElementDraft | null>(null)
  const draftUsed = useCallback(() => setElementDraft(null), [])
  // a Library page opens a tool of a space, filled in (Make sheets, Restyle with a style, speak with a voice)
  const use: Use = (kind, tool, patch) => {
    setCompose((c) => ({ ...c, [kind]: { ...blank(kind, tool), ...patch } }))
    setPage(kind)
  }
  const [seen, setSeen] = useState<Record<string, string>>(readSeen)
  const [scope, setScope] = useState<"workspace" | "all">(readScope)
  // each space's Tool filter, kept for this tab
  const [toolBy, setToolBy] = useState<Partial<Record<Kind, string>>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(TOOL_KEY) ?? "{}")
    } catch {
      return {}
    }
  })
  const pickTool = (k: Kind, v: string) => {
    const next = { ...toolBy, [k]: v }
    setToolBy(next)
    try {
      sessionStorage.setItem(TOOL_KEY, JSON.stringify(next))
    } catch {
      /* a private window keeps it for the page */
    }
  }
  const timelines = useTimelines(state?.workspaces)
  // a result's file the timeline opens on (its « #2 » clicked)
  const [focus, setFocus] = useState<string | null>(null)

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
      const open = { label: t("Open"), onClick: () => setPage(j.kind) }
      if (j.status === "done") toast.success(t("{label} is ready", { label: own(j.label) }), { description: j.name, action: open })
      if (j.status === "failed") toast.error(t("{label} failed", { label: own(j.label) }), { description: plain(j.error ?? ""), action: open })
    }
    was.current = Object.fromEntries(state.media.map((j) => [j.id, j.status]))
  }, [state, page])

  // a result asked from the timeline (a Bridge shot, a take, a tool on a clip, a voice), once done, lands where it was
  // asked on its workspace's timeline (once: placed keeps it)
  const laid = useRef(new Set<string>())
  useEffect(() => {
    if (!state) return
    for (const j of state.media) {
      const asked = j.place, line = asked && timelines.get(asked.workspace)
      if (!asked || !line || isRunning(j) || laid.current.has(j.id) || line.placed.includes(j.id)) continue
      laid.current.add(j.id)
      // Extend going back in time lands before its clip
      const p = j.tool === "extend" && asked.how === "after" && j.fields?.direction === "prequel" ? { ...asked, how: "before" as const } : asked
      // a new shot of its own: Extend's new part (its last output), not the whole extended video
      const files = j.status === "done" ? j.outputs.filter((o) => mediaKind(o) !== "other" && !/\.mov$/i.test(o)) : []
      const out = p.how === "after" || p.how === "before" ? files.at(-1) : files[0]
      if (!out) {
        timelines.change(p.workspace, (x) => ({ ...x, placed: [...x.placed, j.id] }))
        continue
      }
      const path = outputPath(state.home, j, out), name = state.workspaces.find((w) => w.slug === p.workspace)?.name
      if (!inWorkspace(j, p.workspace)) api.workspaces({ slug: p.workspace, add: [j.id] }).catch(() => {})
      lengthOf(path).then((dur) => {
        timelines.change(p.workspace, (x) => ({ ...place(x, { path, job: j.id }, p, dur), placed: [...x.placed, j.id] }))
        const said = p.how === "after" || p.how === "before" ? t("The new shot is on the timeline") : p.replace ? t("The new take is on the timeline") : j.kind === "audio" ? t("The voice is on the timeline") : t("The Bridge shot is on the timeline")
        toast.success(said, { description: name, action: { label: t("Show"), onClick: () => (window.location.hash = "workspace/timeline") } })
      })
    }
  }, [state, timelines])

  // the agent fills or submits a space's composer (media.mjs draft, submit): the page goes to that space, whose composer
  // takes it (a fill within the hour, a submit within the minute)
  useEffect(() => {
    if (!state) return
    const fresh = (at: string | undefined, ms: number) => !!at && Date.now() - Date.parse(at) < ms
    const k = SPACES.find((k) => {
      const d = state.drafts[k]
      return (fresh(d?.at, 36e5) && d!.at! > (seen[k] ?? "")) || (fresh(d?.submit?.at, 6e4) && !d!.submit!.claimed)
    })
    if (k && page !== k) setPage(k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const bridge = (b: Bridge, job: Job, file: string, at?: Place) => {
    const home = state!.home
    // on the current workspace's timeline, after its last shot; the result joins the workspace too
    if (b === "shot") return (setFocus(file), (window.location.hash = "workspace/timeline"))
    if (b === "timeline") {
      const ws = currentOf(state!)
      if (!inWorkspace(job, ws.slug)) api.workspaces({ slug: ws.slug, add: [job.id] }).then(refresh, () => {})
      lengthOf(file).then((dur) => timelines.change(ws.slug, (t) => lay(t, { path: file, job: job.id }, dur)))
      return toast.success(t("Added to the timeline"), { description: ws.name, action: { label: t("Show"), onClick: () => (window.location.hash = "workspace/timeline") } })
    }
    if (b === "remix") {
      const tool = tools?.[job.kind].find((t) => t.id === job.tool)
      const inputs = Object.fromEntries(Object.entries(job.inputs ?? {}).map(([k, list]) => [k, list.map((f) => `${home}/media/${job.id}/${f}`)]))
      const intent = job.raw_prompt ?? ""
      const raw = !!job.raw && tool?.template !== "{prompt}"
      setCompose((c) => ({
        ...c,
        [job.kind]: { tool: job.tool, model: job.provider === "local" ? undefined : `${job.provider}:${job.model}`, intent: raw ? "" : intent, raw, rawText: raw ? intent : "", fields: job.fields ?? {}, inputs, params: job.params ?? {}, place: at },
      }))
      return setPage(job.kind)
    }
    // a draft's final (Seedance 2.5 on Kie): Custom on its model, from the draft, nothing else to fill
    if (b === "final") {
      setCompose((c) => ({ ...c, video: { ...blank("video", "free"), model: `${job.provider}:${job.model}`, params: { draft_of: job.id }, place: at } }))
      return setPage("video")
    }
    // a new Element of a result: a References sheet brings its whole set and the photos it was made from
    if (b === "element") {
      const tool = tools?.[job.kind].find((t) => t.id === job.tool), root = job.after ?? job.id
      const set = tool?.element ? state!.media.filter((j) => j.status === "done" && (j.id === root || j.after === root)).reverse() : [job]
      const first = state!.media.find((j) => j.id === root) ?? job
      const kind = job.kind === "audio" ? "audio" : "image"
      setElementDraft({
        type: job.kind === "audio" ? "voice" : (tool?.element ?? "other"),
        paths: [...set.flatMap((j) => j.outputs.filter((o) => mediaKind(o) === kind).map((o) => `${home}/media/${j.id}/${o}`)), ...(tool?.element ? (first.inputs?.references ?? []).map((f) => `${home}/media/${first.id}/${f}`) : [])],
        words: job.fields?.who ?? job.fields?.what ?? job.fields?.instructions ?? "",
      })
      window.location.hash = "library/elements"
      return
    }
    // a song's own tools, the clip given
    if (b === "extend-music" || b === "cover" || b === "stems") {
      setCompose((c) => ({ ...c, audio: { ...blank("audio", b), inputs: { clip: [file] } } }))
      return setPage("audio")
    }
    const next = { animate: ["animate", "first_frame"], extend: ["extend", "video"], upscale: ["upscale", "video"], avatar: ["talking-avatar", "audio"], s2v: ["speech-to-video", "audio"] }[b]
    setCompose((c) => ({ ...c, video: { ...blank("video", next[0]), inputs: { [next[1]]: [file] }, place: at } }))
    setPage("video")
  }

  // a Bridge shot: a tool (First & last frame…) from the last frame of the clip before to the first frame of the one
  // after, laid in the cut once done
  async function bridgeShot(a: Clip, b: Clip, track: string, tool: string) {
    const ws = currentOf(state!)
    try {
      const [from, to] = await Promise.all([isStill(a.path) ? a.path : api.frame(a.path, false, Math.max(0, a.out - 0.05)).then((r) => r.path), isStill(b.path) ? b.path : api.frame(b.path, false, b.in).then((r) => r.path)])
      setCompose((c) => ({ ...c, video: { ...blank("video", tool), inputs: { first_frame: [from], last_frame: [to] }, place: { workspace: ws.slug, track, at: endOf(a) } } }))
      setPage("video")
    } catch (e) {
      toast.error(plain((e as Error).message))
    }
  }
  // what the timeline asks: the composer opens on the tool, filled from the clip as it is cut (its part of its file,
  // the frame at the playhead or its last, the voice under it), the result laid by it once done; a freeze frame is
  // made here, free
  async function ask(a: Ask) {
    const ws = currentOf(state!), home = state!.home
    const open = (kind: Kind, tool: string, patch: Partial<Compose>) => (setCompose((cs) => ({ ...cs, [kind]: { ...blank(kind, tool), ...patch } })), setPage(kind))
    if (a.how === "voice") return open("audio", "voice", { place: { workspace: ws.slug, track: a.track, at: a.time } })
    const c = a.clip, by: Place = { workspace: ws.slug, track: c.track, at: c.at, replace: c.id }
    // a second of the timeline in the clip's file; the clip's file as it is cut there (the file itself when it is all of it)
    const fileAt = (x: number) => c.in + x - c.at
    const source = async (x: Clip, from = x.in, to = x.out) => (isStill(x.path) || (from < 0.05 && (x.dur == null || to > x.dur - 0.05)) ? x.path : (await api.cut(x.path, from, to)).path)
    try {
      if (a.how === "remix") {
        const job = state!.media.find((j) => j.id === c.job)
        return job && bridge("remix", job, c.path, by)
      }
      if (a.how === "freeze") {
        const frame = (await api.frame(c.path, false, fileAt(a.time))).path, made = await api.import(frame)
        timelines.change(ws.slug, (t) => freeze(t, c.id, a.time, { path: `${home}/media/${made.id}/${frame.split(/[\\/]/).pop()!.replace(/^\d+-/, "")}`, job: made.id }))
        refresh()
        return toast.success(t("Freeze frame laid"), { description: t("Free, from this machine.") })
      }
      if (a.how === "after" || a.how === "before") return open("video", "extend", { inputs: { video: [await source(c)] }, fields: { direction: a.how === "before" ? "prequel" : "sequel" }, place: { ...by, how: "after" } })
      if (a.how !== "edit" && a.how !== "frame") return
      const tool = tools![a.kind].find((x) => x.id === a.tool)
      if (!tool) return
      if (a.how === "edit") {
        // the clip goes into the tool's first input; Reframe and Expand bring it to the edit's format
        const m = state!.media.find((j) => j.id === c.job)?.meta?.[c.file]
        const fields = tool.id === "reframe" ? { ratio: a.ratio } : tool.id === "expand" && m?.w && m?.h ? marginsTo(m.w, m.h, a.ratio) : {}
        return open(a.kind, tool.id, { inputs: { [tool.inputs.find((i) => !i.optional)!.key]: [await source(c)] }, fields, place: { ...by, how: "whole" } })
      }
      // from a frame: a talking avatar from the start of the voice under it, saying its stretch, in place of that
      // stretch (its sound off: the voice plays already); else the frame at the playhead (what follows it replaced),
      // or its last (a shot after it); a still animated in its place
      const voice = tool.id === "talking-avatar" ? voiceUnder(timelines.get(ws.slug)!, c, a.time) : undefined
      const at = voice ? voice.from : inside(c, a.time) ? a.time : null
      const frame = isStill(c.path) ? c.path : (await api.frame(c.path, false, at == null ? Math.max(0, c.out - 0.05) : fileAt(at))).path
      const said = voice && (await source(voice.voice, voice.voice.in + voice.from - voice.voice.at, voice.voice.in + voice.to - voice.voice.at))
      const where: Place = voice ? { ...by, at: voice.from, how: "from", from: fileAt(voice.from), to: fileAt(voice.to), mute: true } : isStill(c.path) ? { ...by, how: "whole" } : at == null ? { ...by, how: "after" } : { ...by, at, how: "from", from: fileAt(at) }
      open("video", tool.id, { inputs: { first_frame: [frame], ...(said ? { audio: [said] } : {}) }, place: where })
    } catch (e) {
      toast.error(plain((e as Error).message))
    }
  }

  if (!state || !tools)
    return (
      <div className="grid h-screen place-items-center text-sm text-muted-foreground">
        {error ? t("The dashboard's server does not answer ({error}). Run media.mjs studio again.", { error }) : t("Loading…")}
      </div>
    )

  const space = SPACES.includes(page as Kind) ? (page as Kind) : null
  const ws = currentOf(state)
  // a space's results in the scope shown, then of the tool picked
  const spacePool = space ? state.media.filter((j) => j.kind === space && (scope === "all" || inWorkspace(j, ws.slug))) : []
  const spaceTool = space ? (toolBy[space] ?? "") : ""
  // where each file is on the current workspace's timeline, the main track's shots first
  const tl = timelines.get(ws.slug)
  const shots: Record<string, string> = {}
  for (const c of [...(tl?.clips ?? [])].sort((a, b) => Number(placeOf(tl!, b).startsWith("#")) - Number(placeOf(tl!, a).startsWith("#")) || a.at - b.at)) shots[c.path] ??= placeOf(tl!, c)
  const running = Object.fromEntries(SPACES.map((k) => [k, state.media.filter((j) => j.kind === k && isRunning(j)).length]))

  return (
    <Workspaces.Provider value={{ list: state.workspaces, current: ws.slug, shots }}>
    <div className="grid h-screen grid-cols-[76px_minmax(340px,392px)_1fr] grid-rows-[48px_1fr]">
      <Header state={state} balances={balances} onChanged={refresh} />
      <nav className="flex flex-col items-center gap-1 border-r py-3" aria-label={t("Pages")}>
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
                  aria-label={t("{n} running", { n: running[r.page] })}
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
          <main className="flex min-h-0 flex-col gap-4 overflow-auto bg-canvas px-6 py-5">
            <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
              <ToolFilter compact jobs={spacePool} value={spaceTool} onChange={(v) => pickTool(space!, v)} />
              {t("Show")}
              <Chips
                options={["workspace", "all"] as const}
                value={scope}
                label={(o) => (o === "workspace" ? ws.name : t("All"))}
                icon={(o) => (o === "workspace" ? <FolderKanbanIcon /> : valueIcon(o))}
                onChange={(o) => {
                  setScope(o)
                  try {
                    localStorage.setItem(SCOPE_KEY, o)
                  } catch {
                    /* a private window keeps it for the session */
                  }
                }}
                className="[&>button]:max-w-56 [&>button]:truncate [&>button]:px-2.5 [&>button]:py-0.5 [&>button]:text-xs"
              />
            </div>
            <Results
              jobs={spaceTool ? spacePool.filter((j) => toolKey(j) === spaceTool) : spacePool}
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
                    <EmptyTitle>{NONE_YET[space](scope === "workspace" ? ws.name : undefined)}</EmptyTitle>
                    <EmptyDescription>{t("Pick a tool, fill it in, generate: the results land here, with what each one cost.")} <kbd>⌘V</kbd> {t("pastes a file into the tool.")}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              }
            />
          </main>
        </>
      ) : page === "workspace" ? (
        <WorkspacePage state={state} tools={tools} onBridge={bridge} onChanged={refresh} timelines={timelines} focus={focus} onBridgeShot={bridgeShot} onAsk={ask} />
      ) : page === "library" ? (
        <Library state={state} tools={tools} engine={engine} draft={elementDraft} onDraftUsed={draftUsed} onUse={use} onChanged={refresh} />
      ) : page === "credits" ? (
        <Credits state={state} balances={balances} onBridge={bridge} />
      ) : (
        <SettingsPage state={state} models={models} tools={tools} engine={engine} onSaved={refresh} onModels={() => (setModels({}), api.tools().then(setTools, () => {}), refresh())} />
      )}
      <DropToLibrary onAdded={refresh} />
    </div>
    </Workspaces.Provider>
  )
}

// a file dropped anywhere the composer does not take it joins the current workspace; a video passes through Edit reference
// first (closing it keeps the video whole), several one after the other
async function keep(path: string, onAdded: () => void) {
  try {
    await api.import(path)
    toast.success(t("Added to the workspace"), { description: path.split(/[\\/]/).pop()?.replace(/^\d+-/, ""), action: { label: t("Show"), onClick: () => (window.location.hash = "workspace") } })
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
          toast.error(t("{name} is not an image, a video or a sound", { name: f.name }))
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
            <FolderKanbanIcon className="size-4 text-space" /> {t("Drop to add to the workspace")}
          </span>
        </div>
      )}
      <CutDialog path={videos[0] ?? null} onClose={() => next(videos[0])} onDone={next} />
    </>
  )
}

function Header({ state, balances, onChanged }: { state: State; balances: Balances | null; onChanged: () => void }) {
  const { resolvedTheme, setTheme } = useTheme()
  const ob = balances?.openrouter, kb = balances?.kie, eb = balances?.elevenlabs
  const folder = state.home.split(/[\\/]/).filter(Boolean).pop()
  return (
    <header className="col-span-full flex items-center gap-3 border-b px-4">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-linear-to-br from-img via-vid to-aud text-white" aria-hidden>
        <SparklesIcon className="size-4" />
      </span>
      <h1 className="text-[15px] font-semibold tracking-tight whitespace-nowrap">Media Generator</h1>
      <button
        type="button"
        title={`${state.home}\n${t("Click to copy the path")}`}
        onClick={() => navigator.clipboard.writeText(state.home).then(() => toast.success(t("Folder path copied")))}
        className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <FolderIcon className="size-3.5 shrink-0" />
        <span className="truncate">{folder}</span>
      </button>
      <span className="text-muted-foreground/50" aria-hidden>/</span>
      <WorkspaceMenu state={state} onChanged={onChanged} />
      <span className="flex-1" />
      {/* the balances, hidden on the fake APIs (their amounts are made up); the active router's in dollars */}
      {!state.fake?.on && <>
      <Balance name={ROUTER_NAME[state.router]} provider={state.router}>
        {!state.keys[state.router] ? <span className="text-muted-foreground">{t("no key")}</span>
          : state.router === "kie"
            ? !kb ? <span className="text-muted-foreground">…</span>
              : kb.error ? <span className="text-muted-foreground">{t("unavailable")}</span>
              : <><b className="font-semibold tabular-nums">${(kb.account_left ?? 0).toFixed(2)}</b><small className="text-muted-foreground">{t("left")}</small></>
          : !ob ? <span className="text-muted-foreground">…</span>
          : ob.error ? <span className="text-muted-foreground">{t("unavailable")}</span>
          : ob.account_left != null ? <><b className="font-semibold tabular-nums">${ob.account_left.toFixed(2)}</b><small className="text-muted-foreground">{t("left")}</small></>
          : ob.key_left != null ? <><b className="font-semibold tabular-nums">${ob.key_left.toFixed(2)}</b><small className="text-muted-foreground">{t("left on this key")}</small></>
          : <small className="text-muted-foreground">{t("no limit on this key")}</small>}
      </Balance>
      {/* ElevenLabs, straight: its voices, Change voice and Translate; in dollars on a paid plan (its credits have no price
          on the free one) */}
      <Balance name="ElevenLabs" provider="elevenlabs">
        {!state.keys.elevenlabs ? <span className="text-muted-foreground">{t("no key")}</span>
          : !eb ? <span className="text-muted-foreground">…</span>
          : eb.error ? <span className="text-muted-foreground">{t("unavailable")}</span>
          : per1000(state) ? <><b className="font-semibold tabular-nums">${(((eb.left ?? 0) * per1000(state)!) / 1000).toFixed(2)}</b><small className="text-muted-foreground">{t("left")}</small></>
          : <><b className="font-semibold tabular-nums">{(eb.left ?? 0).toLocaleString(locale())}</b><small className="text-muted-foreground">{t("credits left")}</small></>}
      </Balance>
      </>}
      {(state.settings.developer?.on || state.fake?.on) && state.fake?.bases?.length ? (
        // developer mode on a server started on fake APIs: the fakes on or off; the page reloads on the other side
        <span className="flex items-center gap-2">
          {state.fake.on && (
            <span className="rounded-md border border-cost/60 px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap text-cost" title={t("Nothing is spent: the APIs are fakes at {bases}", { bases: state.fake.bases.join(` ${t("and")} `) })}>
              Fake API
            </span>
          )}
          <Switch
            checked={state.fake.on}
            onCheckedChange={(on) => api.fake(on).then(() => window.location.reload(), (e) => toast.error(plain((e as Error).message)))}
            aria-label={state.fake.on ? t("Use the real APIs") : t("Use the fake APIs")}
            title={state.fake.on ? t("On: the fake APIs, nothing is spent. Off: the real APIs, with this server's keys") : t("Off: the real APIs. On: the fakes at {bases}", { bases: state.fake.bases.join(` ${t("and")} `) })}
          />
        </span>
      ) : null}
      <button
        type="button"
        aria-label={resolvedTheme === "dark" ? t("Switch to light mode") : t("Switch to dark mode")}
        title={resolvedTheme === "dark" ? t("Light mode") : t("Dark mode")}
        onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
        className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {resolvedTheme === "dark" ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
      </button>
    </header>
  )
}

function Balance({ name, provider, children }: { name: string; provider: string; children: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-1.5 rounded-full border bg-card/50 px-3 py-1 text-sm whitespace-nowrap">
      <ProviderIcon id={provider} className="size-3.5 shrink-0 self-center text-muted-foreground" />
      <span className="text-muted-foreground">{name}</span>
      {children}
    </span>
  )
}
