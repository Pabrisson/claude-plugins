import { useContext, useEffect, useState } from "react"
import { AudioLinesIcon, ChevronDownIcon, CopyIcon, DownloadIcon, FolderKanbanIcon, FolderMinusIcon, LayersIcon, LinkIcon, PlayIcon, PlusIcon, SearchIcon, UnlinkIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { api, currentOf, fileUrl, inWorkspace, mediaKind, outputPath, per1000, plain, when, type Clip, type Job, type Kind, type State, type Timeline, type Tool, type Workspace } from "@/lib/api"
import { lay } from "@/lib/timeline"
import { Chips, Label } from "@/components/chips"
import { ElementCard, ElementDialog, NewElement, type ElementDraft, type Use } from "@/components/elements"
import { byMedium, FilterChips, LibraryList, Listen, Section, SortSelect, Thumb, useSort, Workspaces, type Pick } from "@/components/inputs"
import { factsOf, NO_FILTERS, passes, ratioOf, resOf, sorted } from "@/lib/filters"
import { Main, Side } from "@/components/pages"
import { Results, type Bridge } from "@/components/results"
import { dragShot, lengthOf, TimelineEditor, type Ask, type useTimelines } from "@/components/timeline"
import { NewWorkspaceDialog, WorkspaceRows } from "@/components/workspace-list"

type Timelines = ReturnType<typeof useTimelines>
const TABS = ["assets", "timeline"] as const
type Tab = (typeof TABS)[number]
// the tab lives in the URL (#workspace/timeline), so « Show » on a toast lands on it
const tabOf = (): Tab => (window.location.hash.endsWith("/timeline") ? "timeline" : "assets")
const KINDS: Kind[] = ["image", "video", "audio"]
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

// every result of the folder, to pick from
export const allResults = (s: State): Pick[] => s.media.flatMap((j) => (j.status === "done" ? j.outputs.filter((o) => mediaKind(o) !== "other").map((o) => ({ path: outputPath(s.home, j, o), job: j })) : []))

const download = (href: string) => Object.assign(document.createElement("a"), { href, download: "" }).click()

// the header's switcher: the current workspace beside the folder, the others a click away
export function WorkspaceMenu({ state, onChanged }: { state: State; onChanged: () => void }) {
  const [making, setMaking] = useState(false)
  const ws = currentOf(state)
  if (!ws) return null
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" title="The current workspace: what you generate lands in it" className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium transition-colors hover:bg-muted aria-expanded:bg-muted">
            <FolderKanbanIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="max-w-48 truncate">{ws.name}</span>
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={ws.slug} onValueChange={(slug) => api.workspaces({ slug, use: true }).then(onChanged, (e) => toast.error(plain(e.message)))}>
            {state.workspaces.map((w) => (
              <DropdownMenuRadioItem key={w.slug} value={w.slug}>
                <span className="truncate">{w.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setMaking(true)}>
            <PlusIcon /> New workspace…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => (window.location.hash = "workspace")}>
            <FolderKanbanIcon /> All workspaces
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewWorkspaceDialog open={making} onClose={() => setMaking(false)} onChanged={onChanged} />
    </>
  )
}

// Download: its files, or with the edit
function DownloadMenu({ ws, timeline, flush }: { ws: Workspace; timeline: Timeline; flush: () => Promise<void> }) {
  const edited = timeline.clips.length > 0
  async function withEdit() {
    await flush()
    download(`/api/workspaces/${ws.slug}/zip?edit`)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <DownloadIcon data-icon="inline-start" /> Download <ChevronDownIcon data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem onSelect={() => download(`/api/workspaces/${ws.slug}/zip`)}>
          <span className="flex flex-col">
            <span>Assets and elements</span>
            <span className="text-xs text-muted-foreground">A .zip: images, videos, audio, elements</span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!edited} onSelect={withEdit}>
          <span className="flex flex-col">
            <span>With the edit</span>
            <span className="text-xs text-muted-foreground">{edited ? "Plus the timeline and the edit in words" : "Lay shots on the timeline first"}</span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// the edit copied for video-editor: every clip's times, file and sound
function CopyEdit({ ws, timeline, flush }: { ws: Workspace; timeline: Timeline; flush: () => Promise<void> }) {
  const edited = timeline.clips.length > 0
  async function copy() {
    await flush()
    try {
      const { text } = await api.edit(ws.slug)
      if (!text) return toast.error("The timeline is empty")
      await navigator.clipboard.writeText(`/skill-video:video-editor ${text}`)
      toast.success("Prompt copied", { description: "Paste it in Claude Code: video-editor makes the video on this edit." })
    } catch (e) {
      toast.error(plain((e as Error).message))
    }
  }
  return (
    <Button size="sm" disabled={!edited} onClick={copy} title={edited ? "Copies the exact edit for video-editor: every clip's times, file and sound" : "Lay shots on the timeline first"}>
      <CopyIcon data-icon="inline-start" /> Copy prompt for video-editor
    </Button>
  )
}

function Title({ ws, aside }: { ws: Workspace; aside?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <h2 className="truncate text-lg font-semibold tracking-tight">{ws.name}</h2>
      <span className="flex-1" />
      {aside}
    </div>
  )
}

export function WorkspacePage({
  state,
  tools,
  engine,
  onBridge,
  onUse,
  onChanged,
  timelines,
  focus,
  onBridgeShot,
  onAsk,
}: {
  state: State
  tools: Record<Kind, Tool[]>
  engine: string
  onBridge: (b: Bridge, job: Job, file: string) => void
  onUse: Use
  onChanged: () => void
  timelines: Timelines
  // a file the timeline opens on (a result's « #2 »)
  focus: string | null
  onBridgeShot: (a: Clip, b: Clip, track: string, tool: string) => void
  onAsk: (a: Ask) => void
}) {
  const [tab, setTab] = useState<Tab>(tabOf)
  useEffect(() => {
    const on = () => setTab(tabOf())
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  const [kind, setKind] = useState<"all" | Kind | "elements">("all")
  const [favorites, setFavorites] = useState(false)
  const [query, setQuery] = useState("")
  const [open, setOpen] = useState<string | null>(null)
  const [making, setMaking] = useState<ElementDraft | null>(null)
  const ws = currentOf(state)
  if (!ws) return null
  const timeline = timelines.get(ws.slug) ?? ws.timeline
  const q = query.trim().toLowerCase()
  const mine = state.media.filter((j) => inWorkspace(j, ws.slug))
  const jobs = mine.filter((j) => (kind === "all" || j.kind === kind) && (!favorites || j.favorite) && (!q || `${j.prompt} ${j.label} ${j.name} ${j.outputs.join(" ")}`.toLowerCase().includes(q)))
  const els = (state.elements ?? []).filter((e) => ws.linked.includes(e.name) && (!q || `${e.name} ${e.words}`.toLowerCase().includes(q)))
  const shown = state.elements.find((e) => e.name === open)
  const results = allResults(state)
  const use = (slug: string) => slug !== ws.slug && api.workspaces({ slug, use: true }).then(onChanged, (e) => toast.error(plain(e.message)))

  const tabs = (
    <Chips options={TABS} value={tab} label={(t) => ({ assets: "Assets", timeline: "Timeline" })[t]} onChange={(t) => (window.location.hash = t === "assets" ? "workspace" : "workspace/timeline")} className="grid grid-cols-2" />
  )
  const downloads = <DownloadMenu ws={ws} timeline={timeline} flush={timelines.flush} />

  if (tab === "timeline")
    return (
      <TimelineEditor
        key={ws.slug}
        timeline={timeline}
        onChange={(fn) => timelines.change(ws.slug, fn)}
        onUndo={() => timelines.undo(ws.slug)}
        onRedo={() => timelines.redo(ws.slug)}
        can={timelines.can(ws.slug)}
        jobs={state.media}
        items={results}
        focus={focus}
        tools={tools}
        onBridge={onBridgeShot}
        onAsk={onAsk}
        header={
          <Title
            ws={ws}
            aside={
              <span className="flex items-center gap-2">
                {downloads}
                <CopyEdit ws={ws} timeline={timeline} flush={timelines.flush} />
              </span>
            }
          />
        }
        side={
          <Side>
            {tabs}
            <Bin jobs={mine} home={state.home} onAdd={(job, path) => lengthOf(path).then((dur) => timelines.change(ws.slug, (t) => lay(t, { path, job: job.id }, dur)))} />
          </Side>
        }
      />
    )

  const showEls = kind === "all" || kind === "elements"
  return (
    <>
      <Side>
        <WorkspaceRows state={state} value={ws.slug} onPick={use} count={(slug) => state.media.filter((j) => inWorkspace(j, slug)).length} unit="item" manage onChanged={onChanged} />
        {tabs}
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search prompts, tools, files" aria-label="Search the workspace" className="pl-8" />
        </div>
        <div>
          <Label>Media</Label>
          <Chips options={["all", ...KINDS, "elements"] as const} value={kind} label={(k) => (k === "all" ? "All" : cap(k))} onChange={setKind} />
        </div>
        {kind !== "elements" && (
          <div>
            <Label>Show</Label>
            <Chips options={["all", "favorites"] as const} value={favorites ? "favorites" : "all"} label={(f) => (f === "all" ? "Everything" : "Favorites")} onChange={(f) => setFavorites(f === "favorites")} />
          </div>
        )}
      </Side>
      <Main
        title={ws.name}
        aside={
          <span className="flex flex-wrap items-center justify-end gap-2">
            <AddFromLibrary ws={ws} results={results} onChanged={onChanged} />
            <LinkElement state={state} ws={ws} onChanged={onChanged} />
            <Button variant="outline" size="sm" onClick={() => setMaking({ type: "character", paths: [] })}>
              <PlusIcon data-icon="inline-start" /> New element
            </Button>
            {downloads}
          </span>
        }
      >
        {showEls && (els.length > 0 || kind === "elements") && (
          <section className="flex flex-col gap-3" aria-label="Elements">
            <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">Elements</h3>
            {els.length ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3.5">
                {els.map((el) => (
                  <div key={el.name} className="group/el relative flex min-w-0">
                    <ElementCard el={el} onOpen={() => setOpen(el.name)} className="w-full" />
                    {ws.elements.includes(el.name) ? (
                      <Button size="icon-xs" variant="secondary" aria-label={`Unlink @${el.name}`} title="Unlink from this workspace (it stays in the Library)" onClick={() => api.workspaces({ slug: ws.slug, unlink: [el.name] }).then(onChanged)} className="absolute top-2 right-2 opacity-0 group-hover/el:opacity-100 focus-visible:opacity-100">
                        <UnlinkIcon />
                      </Button>
                    ) : (
                      <span className="absolute top-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-xs text-white" title="Cited by one of its generations">cited</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{q ? "No element matches." : "No element linked yet: link the Library's characters, objects, places and voices this project uses, or make a new one."}</p>
            )}
          </section>
        )}
        {kind !== "elements" && (
          <Results
            jobs={jobs}
            home={state.home}
            per1000={per1000(state)}
            onBridge={onBridge}
            extra={[{ label: "Remove from workspace", icon: FolderMinusIcon, run: (j) => api.workspaces({ slug: ws.slug, drop: [j.id] }).then(onChanged, (e) => toast.error(plain(e.message))) }]}
            empty={
              mine.length ? (
                <p className="text-sm text-muted-foreground">No media matches these filters.</p>
              ) : els.length ? null : (
                <Empty className="border border-dashed">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FolderKanbanIcon />
                    </EmptyMedia>
                    <EmptyTitle>Nothing in {ws.name} yet</EmptyTitle>
                    <EmptyDescription>What you or Claude generate while it is the current workspace lands here, and the files dropped on the page. Results already made join it from the library.</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent className="flex-row justify-center">
                    <AddFromLibrary ws={ws} results={results} onChanged={onChanged} />
                  </EmptyContent>
                </Empty>
              )
            }
          />
        )}
      </Main>
      {shown && <ElementDialog el={shown} state={state} tools={tools.image} onClose={() => setOpen(null)} onUse={onUse} onChanged={onChanged} />}
      {making && <NewElement draft={making} state={state} tools={tools.image} engine={engine} onClose={() => setMaking(null)} onSaved={(name) => (setMaking(null), onChanged(), setOpen(name))} />}
    </>
  )
}

// results of the whole library joining the workspace (or leaving it), several at once
function AddFromLibrary({ ws, results, onChanged }: { ws: Workspace; results: Pick[]; onChanged: () => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <PlusIcon data-icon="inline-start" /> Add from library
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(460px,calc(100vw-2rem))] gap-0 p-0">
        <LibraryList
          title={`Add to ${ws.name}`}
          items={results}
          from="library"
          multiple
          picked={results.filter((r) => inWorkspace(r.job, ws.slug)).map((r) => r.path)}
          onPick={(path) => {
            const job = results.find((r) => r.path === path)!.job
            api.workspaces({ slug: ws.slug, ...(inWorkspace(job, ws.slug) ? { drop: [job.id] } : { add: [job.id] }) }).then(onChanged, (e) => toast.error(plain(e.message)))
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

// a Library element linked to the workspace
function LinkElement({ state, ws, onChanged }: { state: State; ws: Workspace; onChanged: () => void }) {
  const others = (state.elements ?? []).filter((e) => !ws.linked.includes(e.name))
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={!others.length}>
          <LinkIcon data-icon="inline-start" /> Link an element
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Search the Library's elements" />
          <CommandList className="max-h-72">
            <CommandEmpty>No element of that name.</CommandEmpty>
            {others.map((e) => (
              <CommandItem key={e.name} value={`${e.name} ${e.words}`} onSelect={() => api.workspaces({ slug: ws.slug, link: [e.name] }).then(onChanged, (err) => toast.error(plain(err.message)))}>
                {e.files[0] && mediaKind(e.files[0]) === "image" ? <img src={fileUrl(e.files[0])} alt="" className="size-7 rounded-md object-cover" /> : e.type === "voice" ? <AudioLinesIcon className="size-4 text-aud" /> : <LayersIcon className="size-4" />}
                <span className="min-w-0 flex-1 truncate">@{e.name}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// the bin: the workspace's results, filtered (medium, format, quality, favorites) and sorted like every picker, by
// medium, dragged onto a track or added after the last shot with +; a result already on the timeline shows its place
function Bin({ jobs, home, onAdd }: { jobs: Job[]; home: string; onAdd: (job: Job, path: string) => void }) {
  const { shots } = useContext(Workspaces)
  const [filters, setFilters] = useState(NO_FILTERS)
  const [sort, setSort] = useSort()
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const pool = jobs
    .filter((j) => j.status === "done" && (!q || `${j.prompt} ${j.label} ${j.name}`.toLowerCase().includes(q)))
    .flatMap((j) => j.outputs.filter((o) => mediaKind(o) !== "other" && !/\.mov$/i.test(o)).map((o) => ({ job: j, path: outputPath(home, j, o) })))
  const items = sorted(pool.filter((i) => passes(i, filters)), sort)
  type Item = (typeof items)[number]
  const { videos, images, sounds } = byMedium(items), titled = [videos, images, sounds].filter((l) => l.length).length > 1
  const drag = (i: Item) => (e: React.DragEvent) => {
    e.dataTransfer.setData("application/x-media-generator-shot", i.path)
    e.dataTransfer.effectAllowed = "copy"
    dragShot({ path: i.path, job: i.job.id, dur: factsOf(i).dur })
  }
  const add = (i: Item) => (
    <Button size="icon-xs" variant="secondary" aria-label={`Add ${i.job.label} to the timeline`} title="Add after the last shot" onClick={() => onAdd(i.job, i.path)} className="shrink-0">
      <PlusIcon />
    </Button>
  )
  // a picture to drag: its place on the timeline, its format, quality and length
  const tile = (i: Item, video: boolean) => (
    <div key={i.path} draggable onDragStart={drag(i)} onDragEnd={() => dragShot(null)} title={`${i.job.label} · ${when(i.job.created)}`} className={cn("group/bin relative cursor-grab overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/5 active:cursor-grabbing", video ? "aspect-video" : "aspect-square")}>
      <Thumb path={i.path} />
      {shots[i.path] && <span className="absolute top-1 left-1 rounded bg-black/65 px-1 text-[11px] font-semibold text-white tabular-nums">{shots[i.path]}</span>}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-linear-to-t from-black/75 to-transparent px-1.5 pt-4 pb-1 text-[10px] text-white tabular-nums">
        {video && <PlayIcon className="mr-1 inline size-3 align-[-2px]" aria-hidden />}
        {facts(i)}
      </span>
      <span className="absolute top-1 right-1 opacity-0 transition-opacity group-hover/bin:opacity-100 focus-within:opacity-100">{add(i)}</span>
    </div>
  )
  const facts = (i: Item) => {
    const { w, h, dur } = factsOf(i)
    return [w && h ? (ratioOf(w, h) === "other" ? `${w}×${h}` : ratioOf(w, h)) : "", w && h ? resOf(w, h) : "", dur ? `${dur.toFixed(1)} s` : ""].filter(Boolean).join(" · ")
  }
  return (
    <>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the bin" aria-label="Search the bin" className="pl-8" />
      </div>
      <FilterChips value={filters} onChange={setFilters} items={pool} />
      <div className="flex min-h-0 flex-col">
        <div className="mb-2 flex items-center gap-2">
          <Label hint="drag onto a track, or +">Bin</Label>
          <span className="flex-1" />
          {(filters.kind !== "all" || filters.ratio !== "all" || filters.res !== "all" || filters.favorites) && (
            <Button size="xs" variant="ghost" className="-mt-2" onClick={() => setFilters(NO_FILTERS)}>
              Clear
            </Button>
          )}
          <span className="-mt-2">
            <SortSelect value={sort} onChange={setSort} />
          </span>
        </div>
        {!items.length && <p className="text-sm text-muted-foreground">{pool.length ? "Nothing matches these filters." : "Nothing in this workspace yet: generate while it is the current one, or add results from the Assets tab."}</p>}
        <div className="flex flex-col gap-4">
          {videos.length > 0 && (
            <Section title="Videos" count={videos.length} titled={titled}>
              <div className="grid grid-cols-2 gap-2">{videos.map((i) => tile(i, true))}</div>
            </Section>
          )}
          {images.length > 0 && (
            <Section title="Images" count={images.length} titled={titled}>
              <div className="grid grid-cols-3 gap-2">{images.map((i) => tile(i, false))}</div>
            </Section>
          )}
          {sounds.length > 0 && (
            <Section title="Audio" count={sounds.length} titled={titled}>
              <div className="flex flex-col gap-1.5">
                {sounds.map((i) => (
                  <div key={i.path} draggable onDragStart={drag(i)} onDragEnd={() => dragShot(null)} className="flex cursor-grab items-center gap-2.5 rounded-lg border px-2 py-1.5 active:cursor-grabbing">
                    <Listen path={i.path} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{i.job.prompt || i.job.label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {shots[i.path] ? `${shots[i.path]} · ` : ""}
                        {i.job.label}
                        {factsOf(i).dur ? ` · ${factsOf(i).dur!.toFixed(1)} s` : ""}
                      </span>
                    </span>
                    {add(i)}
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      </div>
    </>
  )
}
