import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import { ContextMenu, DropdownMenu as DropdownPrims } from "radix-ui"
import {
  ChevronRightIcon,
  ClapperboardIcon,
  CopyPlusIcon,
  EyeIcon,
  EyeOffIcon,
  FastForwardIcon,
  MaximizeIcon,
  MicIcon,
  MinimizeIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RatioIcon,
  RedoIcon,
  RefreshCwIcon,
  ReplaceIcon,
  RewindIcon,
  ScissorsIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SnowflakeIcon,
  SparklesIcon,
  Trash2Icon,
  UndoIcon,
  Volume2Icon,
  VolumeXIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { api, fileUrl, isLocal, plain, STRIP, stripUrl, waveUrl, type Clip, type Job, type Kind, type Timeline, type Tool, type Workspace } from "@/lib/api"
import { cuts, duplicate, edit, endOf, fits, FPS, inside, isStill, lay, layOnNewTrack, lenOf, mainOf, marks, move, nearest, numbers, offers, place, RATIOS, remove, settle, split, totalOf, trackKind, trackName, uid, voiceUnder, withTracks, type Shot } from "@/lib/timeline"
import { LibraryList, type Pick } from "@/components/inputs"
import { ToolIcon } from "@/components/chips"

// what the timeline asks the composer for: a tool on a clip (edit it, start from its frame; ratio, the edit's format),
// Extend after or before it, a Remix of it, a freeze frame of it at the playhead, or a voice at the playhead on a track
export type Ask =
  | { how: "edit" | "frame"; kind: Kind; tool: string; clip: Clip; time: number; ratio: string }
  | { how: "after" | "before" | "remix" | "freeze"; clip: Clip; time: number }
  | { how: "voice"; track: string; time: number }

// a shot dragged from the bin, with its length: a drag's data cannot be read before the drop, its preview needs it
let dragged: (Shot & { dur?: number }) | null = null
export const dragShot = (s: (Shot & { dur?: number }) | null) => void (dragged = s)
// the id of the clip a drag from the bin shows before it is dropped
const GHOST = "ghost"

// px: the tracks' names
const LABEL = 132
// a track's height: the main track's shots the tallest
const rowOf = (t: Timeline, id: string) => (id === mainOf(t) ? 68 : t.tracks.find((x) => x.id === id)?.kind === "audio" ? 48 : 52)
// px: how near an edge or the playhead a dragged edge snaps
const SNAP = 8
// a ruler label every 72 px or more
const tickStep = (px: number) => [0.5, 1, 2, 5, 10, 15, 30, 60].find((s) => s * px >= 72) ?? 120
const clock = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}`
const mark = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`)
// px a second, the whole edit in a width
const fitFor = (w: number, total: number) => Math.min(240, Math.max(4, (w - LABEL - 40) / Math.max(total + 2, 20)))
// px: the tracks' panel around its rows: the toolbar, the ruler, the row of + Video track and + Audio track, a
// horizontal scrollbar
const CHROME = 45 + 29 + 38 + 16

// while a drag runs, no text of the page gets selected; the mouse focuses what it presses as usual (a focus given by
// script would draw its ring)
const holdSelection = () => {
  const was = document.body.style.userSelect
  document.body.style.userSelect = "none"
  return () => void (document.body.style.userSelect = was)
}

// a file's length, read once by the browser (a still has none)
const LENGTHS = new Map<string, number | undefined>()
export function lengthOf(path: string): Promise<number | undefined> {
  if (isStill(path)) return Promise.resolve(undefined)
  if (LENGTHS.has(path)) return Promise.resolve(LENGTHS.get(path))
  return new Promise((ok) => {
    const m = document.createElement("video")
    m.preload = "metadata"
    m.onloadedmetadata = () => (LENGTHS.set(path, m.duration), ok(m.duration))
    m.onerror = () => ok(undefined)
    m.src = fileUrl(path)
  })
}

// the timelines being edited, by workspace: this page's copy (saved half a second after each change, one save after
// the other), its undo and redo. rev: the saved copy it starts from; a newer one saved elsewhere replaces it while
// nothing here waits to be saved, and a save from an older one is refused (the newer one then replaces it)
type History = { now: Timeline; past: Timeline[]; next: Timeline[]; rev: number; dirty: boolean }
// this page's copy, unless a newer one was saved elsewhere and nothing here waits (fresh: the saved one); always its
// main track and an audio track, the main track's shots end to end (a timeline saved before had gaps there)
const pick = (h: History | undefined, s: Timeline | undefined) => {
  const fresh = !h || (!!s && !h.dirty && s.rev > h.rev), t = fresh ? s : h!.now
  const full = t && withTracks(t)
  return { t: full && settle(full, mainOf(full)!), fresh }
}
export function useTimelines(workspaces: Workspace[] | undefined) {
  const [own, setOwn] = useState<Record<string, History>>({})
  const server = useRef(workspaces), latest = useRef(own), timer = useRef(0), chain = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    server.current = workspaces
  }, [workspaces])
  const get = (slug: string) => pick(own[slug], workspaces?.find((w) => w.slug === slug)?.timeline).t
  const change = useCallback((slug: string, fn: (t: Timeline) => Timeline) =>
    setOwn((o) => {
      const s = server.current?.find((w) => w.slug === slug)?.timeline, h = o[slug], { t: cur, fresh } = pick(h, s)
      if (!cur) return o
      const now = fn(cur)
      if (now === cur) return o
      return { ...o, [slug]: { now, past: [...(fresh ? [] : h!.past), cur].slice(-100), next: [], rev: fresh ? s!.rev : h!.rev, dirty: true } }
    }), [])
  const step = (slug: string, back: boolean) =>
    setOwn((o) => {
      const h = o[slug], from = back ? h?.past : h?.next
      if (!h || !from?.length) return o
      const now = back ? from.at(-1)! : from[0]
      return { ...o, [slug]: { ...h, now, past: back ? from.slice(0, -1) : [...h.past, h.now], next: back ? [h.now, ...h.next] : from.slice(1), dirty: true } }
    })

  const save = useCallback(() => {
    for (const slug of Object.keys(latest.current))
      chain.current = chain.current.then(async () => {
        const h = latest.current[slug]
        if (!h?.dirty) return
        const sent = h.now
        try {
          const r = await api.workspaces({ slug, timeline: sent, rev: h.rev })
          const rev = r.workspaces.find((w) => w.slug === slug)?.timeline.rev ?? h.rev + 1
          setOwn((o) => ({ ...o, [slug]: { ...o[slug], rev, dirty: o[slug].now !== sent } }))
        } catch (e) {
          const err = e as Error & { status?: number; body?: { timeline?: Timeline } }
          if (err.status === 409 && err.body?.timeline) {
            const theirs = err.body.timeline
            setOwn((o) => ({ ...o, [slug]: { now: theirs, past: [], next: [], rev: theirs.rev, dirty: false } }))
            toast.info("The timeline changed in another window", { description: "Here is its latest version." })
          } else toast.error("The timeline was not saved", { description: plain(err.message) })
        }
      })
  }, [])
  useEffect(() => {
    latest.current = own
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(save, 500)
  }, [own, save])
  const flush = useCallback(async () => {
    window.clearTimeout(timer.current)
    save()
    await chain.current
  }, [save])
  return { get, change, undo: (slug: string) => step(slug, true), redo: (slug: string) => step(slug, false), can: (slug: string) => ({ undo: !!own[slug]?.past.length, redo: !!own[slug]?.next.length }), flush }
}

// the timeline tab: the bin (side) and the preview above, the track table across the whole width under them, its
// height dragged from the bar between
export function TimelineEditor({
  timeline: t,
  onChange,
  onUndo,
  onRedo,
  can,
  jobs,
  items,
  side,
  header,
  focus,
  tools,
  onBridge,
  onAsk,
}: {
  timeline: Timeline
  onChange: (fn: (t: Timeline) => Timeline) => void
  onUndo: () => void
  onRedo: () => void
  can: { undo: boolean; redo: boolean }
  jobs: Job[]
  // what Swap take lists: every result
  items: Pick[]
  side: React.ReactNode
  header: React.ReactNode
  // a file to show selected at the start (a result's « #2 »)
  focus?: string | null
  tools: Record<Kind, Tool[]>
  // a video made by a tool from the last frame of the shot before to the first frame of the one after
  onBridge: (a: Clip, b: Clip, track: string, tool: string) => void
  // a tool, a freeze frame or a voice, laid by its clip or at the playhead once done
  onAsk: (a: Ask) => void
}) {
  const focused = focus ? t.clips.find((c) => c.path === focus) : undefined
  const [time, setTime] = useState(focused?.at ?? 0)
  const [playing, setPlaying] = useState(false)
  const [sel, setSel] = useState<string | null>(focused?.id ?? null)
  const [zoom, setZoom] = useState<number | null>(null)
  const [preview, setPreview] = useState<Timeline | null>(null)
  const [snapAt, setSnapAt] = useState<number | null>(null)
  const [auto, setAuto] = useState<string | null>(null)
  // the tracks' height: all of them and the buttons under them, until dragged
  const [pulled, setPulled] = useState<number | null>(null)
  const fitted = CHROME + t.tracks.reduce((h, tr) => h + rowOf(t, tr.id) + 1, 0)
  const height = Math.min(pulled ?? fitted, Math.max(180, window.innerHeight - 220))
  const [swapping, setSwapping] = useState(false)
  const [width, setWidth] = useState(1000)
  const lanes = useRef<HTMLDivElement>(null)
  const screen = useRef<HTMLDivElement>(null)
  const total = totalOf(t)
  // the preview fullscreen (F, the button, Esc to leave); the keys keep working there
  const [full, setFull] = useState(false)
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", on)
    return () => document.removeEventListener("fullscreenchange", on)
  }, [])
  const fullscreen = () => {
    if (document.fullscreenElement) return void document.exitFullscreen().catch(() => {})
    screen.current?.requestFullscreen().then(() => screen.current?.focus(), () => {})
  }

  // px a second: fitted to the width when it opens and on Fit, then kept (adding a long sound changes nothing)
  const totalRef = useRef(total)
  useEffect(() => {
    totalRef.current = total
  }, [total])
  useEffect(() => {
    const el = lanes.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth)
      setZoom((z) => z ?? fitFor(el.clientWidth, totalRef.current))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const px = zoom ?? 20
  // ⌘ or Ctrl and the wheel zoom around the pointer; the wheel alone scrolls
  const pxRef = useRef(px)
  useEffect(() => {
    pxRef.current = px
  }, [px])
  useEffect(() => {
    const el = lanes.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return
      e.preventDefault()
      const x = e.clientX - el.getBoundingClientRect().left - LABEL, at = (el.scrollLeft + x) / pxRef.current
      const next = Math.min(240, Math.max(2, pxRef.current * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))
      setZoom(next)
      requestAnimationFrame(() => (el.scrollLeft = at * next - x))
    }
    el.addEventListener("wheel", wheel, { passive: false })
    return () => el.removeEventListener("wheel", wheel)
  }, [])
  // the selected clip in view when it opens on one
  useEffect(() => {
    if (focused) requestAnimationFrame(() => lanes.current?.querySelector(`[data-clip="${focused.id}"]`)?.scrollIntoView({ block: "nearest", inline: "center" }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shown = preview ?? t
  const selected = t.clips.find((c) => c.id === sel)
  const kindOf = (c: Clip) => t.tracks.find((x) => x.id === c.track)?.kind ?? "video"
  const job = (c: Clip) => jobs.find((j) => j.id === c.job)
  const name = (c: Clip) => job(c)?.label ?? c.file
  const meta = (c: Clip) => job(c)?.meta?.[c.file]
  const nums = numbers(shown)
  const ratio = t.ratio ?? auto ?? "16:9"

  // the playback clock: from where the playhead is (the start again at the end), until the end
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const t0 = performance.now(), from = time >= total - 0.01 ? 0 : time
    const tick = (now: number) => {
      const x = from + (now - t0) / 1000
      if (x >= total) return (setTime(total), setPlaying(false))
      setTime(x)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing])

  const jump = (dir: number) => {
    const all = marks(t)
    const to = dir < 0 ? all.filter((m) => m < time - 0.01).at(-1) : all.find((m) => m > time + 0.01)
    if (to != null) setTime(Math.min(total, to))
  }
  const drop = (id: string) => (onChange((x) => remove(x, id)), setSel(null))
  // Alt and ← →: a shot of the main track swaps with its neighbor; another clip moves a frame (a second with Shift)
  const nudge = (c: Clip, dir: number, by: number) =>
    onChange((x) => {
      if (c.track !== mainOf(x)) return move(x, c.id, c.track, Math.max(0, c.at + dir * by))
      const shots = x.clips.filter((o) => o.track === c.track).sort((a, b) => a.at - b.at), other = shots[shots.findIndex((o) => o.id === c.id) + dir]
      return other ? move(x, c.id, c.track, dir > 0 ? endOf(other) : other.at - lenOf(c)) : x
    })
  const retrack = (c: Clip, dir: number) => {
    const same = t.tracks.filter((x) => x.kind === kindOf(c)), to = same[same.findIndex((x) => x.id === c.track) + dir]
    if (to) onChange((x) => move(x, c.id, to.id, c.at))
  }
  // the keys, anywhere in the editor but a field
  function keys(e: React.KeyboardEvent) {
    const el = e.target as HTMLElement
    if (el.closest("input, textarea, select, [role=slider], [role=combobox], [role=listbox], [role=dialog], [role=menu]")) return
    const mod = e.metaKey || e.ctrlKey, by = e.shiftKey ? 1 : 1 / FPS
    const go = (fn: () => void) => (e.preventDefault(), fn())
    if (e.key === " " && !el.closest("button")) go(() => setPlaying((p) => !p))
    else if (mod && e.key.toLowerCase() === "z") go(e.shiftKey ? onRedo : onUndo)
    else if (mod && e.key.toLowerCase() === "y") go(onRedo)
    else if (mod && e.key.toLowerCase() === "d" && selected) go(() => onChange((x) => duplicate(x, selected.id)))
    else if (mod) return
    else if (e.key.toLowerCase() === "s" && selected) go(() => onChange((x) => split(x, selected.id, time)))
    else if ((e.key === "Delete" || e.key === "Backspace") && selected) go(() => drop(selected.id))
    else if (e.altKey && selected && (e.key === "ArrowLeft" || e.key === "ArrowRight")) go(() => nudge(selected, e.key === "ArrowLeft" ? -1 : 1, by))
    else if (e.altKey && selected && (e.key === "ArrowUp" || e.key === "ArrowDown")) go(() => retrack(selected, e.key === "ArrowUp" ? -1 : 1))
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") go(() => setTime((x) => Math.min(total, Math.max(0, x + (e.key === "ArrowLeft" ? -by : by)))))
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") go(() => jump(e.key === "ArrowUp" ? -1 : 1))
    else if (e.key.toLowerCase() === "f") go(fullscreen)
    else if (e.key === "Home") go(() => setTime(0))
    else if (e.key === "End") go(() => setTime(total))
    else if (e.key === "+" || e.key === "=") go(() => setZoom(Math.min(240, px * 1.25)))
    else if (e.key === "-") go(() => setZoom(Math.max(2, px / 1.25)))
  }

  // a clip dragged: moved (on the main track into another cut, the others making room; elsewhere where it is put,
  // to another track of its kind too), or an edge trimmed; the result shows live, edges snap to the others and the
  // playhead
  function grab(e: React.PointerEvent, c: Clip, mode: "move" | "start" | "end") {
    if (e.button !== 0) return
    e.stopPropagation()
    const release = holdSelection()
    setSel(c.id)
    const base = t, x0 = e.clientX, main = mainOf(base)
    const edges = [0, time, ...base.clips.filter((o) => o.id !== c.id).flatMap((o) => [o.at, endOf(o)])]
    const near = (x: number) => edges.find((y) => Math.abs(y - x) * px < SNAP)
    const before = Math.max(0, ...base.clips.filter((o) => o.track === c.track && o.id !== c.id && endOf(o) <= c.at + 1e-3).map(endOf))
    let moved = false, result = base
    const onMove = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return
      moved = true
      const dx = (ev.clientX - x0) / px
      let snapped: number | null = null
      if (mode === "move") {
        const row = document.elementsFromPoint(ev.clientX, ev.clientY).find((n) => (n as HTMLElement).dataset?.track) as HTMLElement | undefined
        const tr = base.tracks.find((x) => x.id === row?.dataset.track && x.kind === kindOf(c))?.id ?? c.track
        let at = Math.max(0, c.at + dx)
        if (tr !== main) {
          const a = near(at), b = near(at + lenOf(c))
          snapped = a ?? b ?? null
          if (a != null) at = a
          else if (b != null) at = b - lenOf(c)
        }
        result = move(base, c.id, tr, at)
      } else {
        const wanted = mode === "start" ? c.at + dx : endOf(c) + dx, s = near(wanted)
        if (s != null) snapped = s
        const x = s ?? wanted
        if (mode === "start") {
          // the head: into the file (a still has none to run out of), never over the clip before on a free track
          const floor = c.track === main ? -600 : before - c.at
          const d = Math.min(Math.max(x - c.at, c.dur == null ? floor : Math.max(-c.in, floor)), lenOf(c) - 0.1)
          result = edit(base, c.id, c.dur == null ? { at: c.at + d, out: c.out - d } : { at: c.at + d, in: c.in + d })
        } else {
          const d = Math.max(Math.min(x - endOf(c), c.dur == null ? Infinity : c.dur - c.out), 0.1 - lenOf(c))
          result = edit(base, c.id, { out: c.out + d })
        }
      }
      setPreview(result)
      setSnapAt(snapped)
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      release()
      setPreview(null)
      setSnapAt(null)
      if (moved) onChange(() => result)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp, { once: true })
  }
  // the playhead follows the pointer on the ruler or an empty stretch of a track
  function seek(e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0) return
    const release = holdSelection()
    const left = e.currentTarget.getBoundingClientRect().left
    const at = (x: number) => setTime(Math.min(Math.max(0, (x - left) / px), Math.max(total, 0)))
    at(e.clientX)
    setSel(null)
    const onMove = (ev: PointerEvent) => at(ev.clientX)
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", () => (window.removeEventListener("pointermove", onMove), release()), { once: true })
  }
  // a shot from the bin: shown where it would land while it is dragged, laid there when dropped
  const over = (e: React.DragEvent<HTMLElement>, track: string | null) => {
    if (!dragged) return
    e.preventDefault()
    e.dataTransfer.dropEffect = "copy"
    const at = Math.max(0, (e.clientX - e.currentTarget.getBoundingClientRect().left - (track === null ? LABEL : 0)) / px)
    const fits = track && t.tracks.find((x) => x.id === track)?.kind === trackKind(dragged.path)
    setPreview(track === null ? layOnNewTrack(t, dragged, dragged.dur, at, GHOST) : lay(t, dragged, dragged.dur, fits ? track : undefined, at, GHOST))
  }
  const land = (e: React.DragEvent) => {
    if (!preview || !dragged) return
    e.preventDefault()
    const done = preview, id = uid()
    onChange(() => ({ ...done, clips: done.clips.map((c) => (c.id === GHOST ? { ...c, id } : c)) }))
    setPreview(null)
    setSel(id)
  }
  const swap = (c: Clip, path: string) => {
    const j = items.find((i) => i.path === path)?.job.id ?? ""
    setSwapping(false)
    lengthOf(path).then((dur) => onChange((x) => place(x, { path, job: j }, { workspace: "", track: c.track, at: c.at, replace: c.id }, dur)))
  }
  // the bar between the preview and the tracks: dragged up or down; a double click fits the tracks again
  function resize(e: React.PointerEvent) {
    e.preventDefault()
    const y0 = e.clientY, h0 = height
    const onMove = (ev: PointerEvent) => setPulled(Math.min(window.innerHeight - 220, Math.max(140, h0 - (ev.clientY - y0))))
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", () => window.removeEventListener("pointermove", onMove), { once: true })
  }

  const extent = Math.max(totalOf(shown) + 10, (width - LABEL) / px)
  const step = tickStep(px)
  const actions = (c: Clip) => ({
    split: () => onChange((x) => split(x, c.id, time)),
    duplicate: () => onChange((x) => duplicate(x, c.id)),
    swap: () => (setSel(c.id), setSwapping(true)),
    remix: job(c) && job(c)!.tool !== "import" ? () => onAsk({ how: "remix", clip: c, time }) : undefined,
    remove: () => drop(c.id),
    generate: () => generate(c),
  })
  const act = selected && actions(selected)
  // a picture not in the edit's format: Reframe (a video, here and free) or Expand (a still) bring it to it
  const misfit = (c: Clip) => {
    const m = meta(c)
    return kindOf(c) === "video" && !!m?.w && !!m?.h && !fits(m.w, m.h, ratio)
  }
  const fit = (c: Clip) => onAsk({ how: "edit", kind: isStill(c.path) ? "image" : "video", tool: isStill(c.path) ? "expand" : "reframe", clip: c, time, ratio })
  // what a clip's menus offer to make of it: Extend, a freeze frame, its format, then the tools that take it, by what
  // they make of it, each list grouped as the tool picker groups them
  function generate(c: Clip): Generate {
    const kind = kindOf(c), still = isStill(c.path), video = kind === "video" && !still, at = inside(c, time) ? time : null
    const voice = voiceUnder(t, c, time)
    const top: Entry[] = [
      ...(video
        ? [
            { label: "Extend after", icon: <FastForwardIcon />, note: "a new shot", run: () => onAsk({ how: "after", clip: c, time }) },
            { label: "Extend before", icon: <RewindIcon />, note: "a new shot", run: () => onAsk({ how: "before", clip: c, time }) },
          ]
        : []),
      ...(video && at != null ? [{ label: `Freeze frame at ${at.toFixed(1)} s`, icon: <SnowflakeIcon />, note: "free", run: () => onAsk({ how: "freeze", clip: c, time }) }] : []),
      ...(misfit(c) ? [{ label: `Fit to ${ratio}`, icon: <RatioIcon />, note: still ? "Expand" : "Reframe, free", run: () => fit(c) }] : []),
    ]
    const title = (o: "edit" | "frame") =>
      o === "edit" ? (kind === "audio" ? "Edit this sound" : still ? "Edit this image" : "Edit this shot") : still ? "Animate this image" : at != null ? `From the frame at ${at.toFixed(1)} s` : "Next shot from its last frame"
    const subs = offers(tools, c, kind)
      .filter((o) => o.items.length)
      .map((o) => {
        const groups: [string, Entry[]][] = []
        for (const { kind: k, tool: x } of o.items) {
          const e = { label: x.label, icon: <ToolIcon name={x.icon} />, note: x.id === "talking-avatar" && voice ? "says the voice under it" : isLocal(x) ? "free" : undefined, run: () => onAsk({ how: o.title, kind: k, tool: x.id, clip: c, time, ratio }) }
          const g = groups.find(([name]) => name === x.group)
          if (g) g[1].push(e)
          else groups.push([x.group, [e]])
        }
        return { label: title(o.title), icon: o.title === "edit" ? <WandSparklesIcon /> : <ClapperboardIcon />, groups }
      })
    return { top, subs }
  }
  // the tools a Bridge shot can run: those that take a first and a last frame
  const bridges = tools.video.filter((x) => ["first_frame", "last_frame"].every((k) => x.inputs.some((i) => i.key === k && i.kind === "image")))
  // a voice at the playhead: on the first audio track free there, else on a new one
  const voiceHere = () => {
    const free = t.tracks.find((tr) => tr.kind === "audio" && !t.clips.some((c) => c.track === tr.id && time < endOf(c) && time + 0.1 > c.at))
    onAsk({ how: "voice", track: free?.id ?? `a${uid()}`, time })
  }
  return (
    <div className="col-span-2 grid min-h-0 min-w-0" style={{ gridTemplateRows: `minmax(0,1fr) 8px ${height}px` }} onKeyDown={keys}>
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(340px,392px)_minmax(0,1fr)]">
        {side}
        <section className="flex min-h-0 min-w-0 flex-col gap-2 bg-canvas px-6 pt-4 pb-2">
          {header}
          <Preview t={t} time={time} playing={playing} ratio={ratio} onAuto={setAuto} number={numbers(t)} screen={screen} />
          <div className="flex items-center justify-center gap-1.5">
            <Button size="icon-sm" variant="ghost" aria-label="Previous cut" title="Previous cut (↑)" onClick={() => jump(-1)} disabled={!total}>
              <SkipBackIcon />
            </Button>
            <Button size="icon" variant="secondary" className="rounded-full" aria-label={playing ? "Pause" : "Play"} title="Play or pause (Space)" onClick={() => setPlaying((p) => !p)} disabled={!total}>
              {playing ? <PauseIcon /> : <PlayIcon className="translate-x-px" />}
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Next cut" title="Next cut (↓)" onClick={() => jump(1)} disabled={!total}>
              <SkipForwardIcon />
            </Button>
            <span className="ml-2 font-mono text-sm whitespace-nowrap tabular-nums">
              {clock(time)} <span className="text-muted-foreground">/ {clock(total)}</span>
            </span>
            <Select value={t.ratio ?? "auto"} onValueChange={(v) => onChange((x) => ({ ...x, ratio: v === "auto" ? null : v }))}>
              <SelectTrigger size="sm" aria-label="Format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto ({auto ?? "16:9"})</SelectItem>
                {Object.keys(RATIOS).map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="icon-sm" variant="ghost" aria-label={full ? "Leave full screen" : "Full screen"} title="Full screen (F)" onClick={(e) => (e.currentTarget.blur(), fullscreen())}>
              {full ? <MinimizeIcon /> : <MaximizeIcon />}
            </Button>
          </div>
        </section>
      </div>

      <div role="separator" aria-orientation="horizontal" aria-label="Drag to resize the tracks" title="Drag to resize the tracks, double-click to fit them" onPointerDown={resize} onDoubleClick={() => setPulled(null)} className="group/bar flex cursor-row-resize touch-none items-center justify-center border-t bg-background hover:bg-muted">
        <span className="h-1 w-10 rounded-full bg-border transition-colors group-hover/bar:bg-foreground/40" />
      </div>

      <div className="flex min-h-0 min-w-0 flex-col bg-background">
        <div className="flex min-h-11 flex-wrap items-center gap-1 border-b px-3 py-1">
          <Button size="sm" variant="ghost" disabled={!act} onClick={act?.split} title="Split the clip at the playhead (S)">
            <ScissorsIcon data-icon="inline-start" /> Split
          </Button>
          <Button size="sm" variant="ghost" disabled={!act} onClick={act?.duplicate} title="Duplicate the clip (⌘D)">
            <CopyPlusIcon data-icon="inline-start" /> Duplicate
          </Button>
          <Button size="icon-sm" variant="ghost" disabled={!act} aria-label="Delete the clip" title="Delete the clip (Delete)" onClick={act?.remove}>
            <Trash2Icon />
          </Button>
          <Button size="sm" variant="ghost" onClick={voiceHere} title="Audio › Voice: the voice is laid at the playhead once done">
            <MicIcon data-icon="inline-start" /> Voice here
          </Button>
          {selected && act && (
            <span className="flex min-w-0 items-center gap-1.5 border-l pl-3">
              {nums[selected.id] && <span className="rounded bg-vid/15 px-1.5 text-xs font-semibold text-vid tabular-nums">#{nums[selected.id]}</span>}
              <span className="max-w-48 truncate text-sm font-medium" title={selected.file}>{name(selected)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{lenOf(selected).toFixed(1)} s</span>
              {!isStill(selected.path) && (
                <span className="flex items-center gap-1.5 pl-1" title="Its sound's volume">
                  <Volume2Icon className="size-3.5 text-muted-foreground" aria-hidden />
                  <Slider className="w-20" min={0} max={100} step={5} value={[Math.round((selected.volume ?? 1) * 100)]} onValueChange={([v]) => onChange((x) => ({ ...x, clips: x.clips.map((o) => (o.id === selected.id ? { ...o, volume: v / 100 } : o)) }))} aria-label="Volume" />
                  <span className="w-10 text-xs whitespace-nowrap text-muted-foreground tabular-nums">{Math.round((selected.volume ?? 1) * 100)} %</span>
                </span>
              )}
              <Popover open={swapping} onOpenChange={setSwapping}>
                <PopoverTrigger asChild>
                  <Button size="sm" variant="ghost" title="Another result in its place, at the same time and length">
                    <ReplaceIcon data-icon="inline-start" /> Swap take
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[min(460px,calc(100vw-2rem))] gap-0 p-0">
                  <LibraryList title={`In place of ${name(selected)}`} items={items.filter((i) => trackKind(i.path) === kindOf(selected))} picked={[selected.path]} onPick={(p) => swap(selected, p)} />
                </PopoverContent>
              </Popover>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost" title="A tool on this clip: the result is laid by it once done">
                    <SparklesIcon data-icon="inline-start" /> Generate
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-56">
                  <GenerateItems M={DropdownPrims as unknown as Prims} make={act.generate} />
                </DropdownMenuContent>
              </DropdownMenu>
              {act.remix && (
                <Button size="sm" variant="ghost" onClick={act.remix} title="The same settings in the composer: the result takes its place">
                  <RefreshCwIcon data-icon="inline-start" /> Remix
                </Button>
              )}
            </span>
          )}
          <span className="flex-1" />
          <Button size="icon-sm" variant="ghost" aria-label="Undo" title="Undo (⌘Z)" disabled={!can.undo} onClick={onUndo}>
            <UndoIcon />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!can.redo} onClick={onRedo}>
            <RedoIcon />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Zoom out" title="Zoom out (−, or ⌘ and the wheel)" onClick={() => setZoom(Math.max(2, px / 1.5))}>
            <MinusIcon />
          </Button>
          <Slider className="w-24" min={2} max={240} step={1} value={[Math.round(px)]} onValueChange={([v]) => setZoom(v)} aria-label="Zoom" />
          <Button size="icon-sm" variant="ghost" aria-label="Zoom in" title="Zoom in (+, or ⌘ and the wheel)" onClick={() => setZoom(Math.min(240, px * 1.5))}>
            <PlusIcon />
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setZoom(fitFor(width, total))} title="The whole edit in view">
            Fit
          </Button>
        </div>

        <div
          ref={lanes}
          tabIndex={0}
          aria-label="Timeline. Space plays, S splits the selected clip, Delete removes it, arrows move the playhead, up and down jump between cuts, Alt and arrows move the clip"
          className="relative min-h-0 flex-1 overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset"
          onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setPreview(null)}
        >
          <div className="relative min-h-full" style={{ width: LABEL + extent * px }}>
            <div className="sticky top-0 z-20 flex h-7 border-b bg-background">
              <div className="sticky left-0 z-10 shrink-0 border-r bg-background" style={{ width: LABEL }} />
              <div className="relative flex-1 cursor-ew-resize" onPointerDown={seek} title="Drag to move the playhead">
                {Array.from({ length: Math.floor(extent / step) + 1 }, (_, i) => i * step).map((s) => (
                  <span key={s} className="absolute top-0 h-full border-l border-border pl-1 text-[11px] leading-7 text-muted-foreground tabular-nums select-none" style={{ left: s * px }}>
                    {mark(s)}
                  </span>
                ))}
              </div>
            </div>

            {shown.tracks.map((tr) => {
              const mine = shown.clips.filter((c) => c.track === tr.id), label = trackName(shown, tr), main = tr.id === mainOf(shown)
              return (
                <div key={tr.id} className={cn("flex border-b", main && "bg-muted/30")} style={{ height: rowOf(shown, tr.id) }}>
                  <div className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r bg-background px-2" style={{ width: LABEL }}>
                    <span className={cn("grid h-6 min-w-8 place-items-center rounded-md px-1.5 text-xs font-semibold", tr.kind === "video" ? "bg-vid/15 text-vid" : "bg-aud/15 text-aud", tr.off && "opacity-50")}>{label}</span>
                    {main && <span className="text-[11px] text-muted-foreground">main</span>}
                    <span className="flex-1" />
                    <Button size="icon-xs" variant="ghost" aria-label={tr.kind === "video" ? (tr.off ? `Show ${label}` : `Hide ${label}`) : tr.off ? `Unmute ${label}` : `Mute ${label}`} aria-pressed={!!tr.off} onClick={() => onChange((x) => ({ ...x, tracks: x.tracks.map((o) => (o.id === tr.id ? { ...o, off: !o.off } : o)) }))}>
                      {tr.kind === "video" ? tr.off ? <EyeOffIcon /> : <EyeIcon /> : tr.off ? <VolumeXIcon /> : <Volume2Icon />}
                    </Button>
                    {shown.tracks.filter((x) => x.kind === tr.kind).length > 1 ? (
                      <Button size="icon-xs" variant="ghost" aria-label={`Remove ${label}${mine.length ? " and its clips" : ""}`} title={`Remove ${label}${mine.length ? " and its clips" : ""}`} onClick={() => onChange((x) => ({ ...x, tracks: x.tracks.filter((o) => o.id !== tr.id), clips: x.clips.filter((c) => c.track !== tr.id) }))}>
                        <XIcon />
                      </Button>
                    ) : (
                      <span className="size-6" aria-hidden />
                    )}
                  </div>
                  <div data-track={tr.id} className="relative flex-1" onPointerDown={seek} onDragOver={(e) => over(e, tr.id)} onDrop={land}>
                    {!mine.length && (
                      <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-xs text-muted-foreground">
                        {main ? "The shots, end to end: drag them here from the bin, or « Add to timeline » on any result" : tr.kind === "video" ? "Over the main track: titles, inserts" : "A voice, music, a sound"}
                      </span>
                    )}
                    {mine.map((c) => (
                      <ClipMenu key={c.id} actions={actions(c)}>
                        <ClipBox
                          c={c}
                          kind={tr.kind}
                          px={px}
                          height={rowOf(shown, tr.id) - 8}
                          name={name(c)}
                          number={nums[c.id]}
                          aspect={meta(c)?.w && meta(c)?.h ? meta(c)!.w! / meta(c)!.h! : 16 / 9}
                          state={c.id === GHOST ? "ghost" : preview && c.id === sel ? "lifted" : sel === c.id ? "selected" : null}
                          off={!!tr.off}
                          misfit={c.id !== GHOST && misfit(c) ? { ratio, run: () => fit(c) } : undefined}
                          onGrab={(e, mode) => grab(e, c, mode)}
                          onSelect={() => setSel(c.id)}
                        />
                      </ClipMenu>
                    ))}
                    {main &&
                      !preview &&
                      cuts(shown).map(({ a, b }) => (
                        <DropdownMenu key={`${a.id}-${b.id}`}>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              aria-label={`Bridge shot between #${nums[a.id]} and #${nums[b.id]}`}
                              title="Bridge shot: a video from the last frame before to the first frame after, laid in this cut"
                              onPointerDown={(e) => e.stopPropagation()}
                              className="absolute bottom-0 z-10 grid size-5 -translate-x-1/2 translate-y-1/2 place-items-center rounded-full border bg-background text-space shadow-sm transition-colors hover:bg-space hover:text-space-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-space data-[state=open]:text-space-foreground"
                              style={{ left: endOf(a) * px }}
                            >
                              <SparklesIcon className="size-3" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="center" className="min-w-56" onPointerDown={(e) => e.stopPropagation()}>
                            <DropdownPrims.Label className="px-2 py-1 text-xs text-muted-foreground">Bridge shot from #{nums[a.id]} to #{nums[b.id]}</DropdownPrims.Label>
                            {bridges.map((x) => (
                              <DropdownPrims.Item key={x.id} className={ITEM} onSelect={() => onBridge(a, b, tr.id, x.id)}>
                                <ToolIcon name={x.icon} /> <span className="flex-1">{x.label}</span>
                              </DropdownPrims.Item>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ))}
                  </div>
                </div>
              )
            })}

            <div className={cn("sticky left-0 flex items-center gap-1.5 px-2 py-1.5", preview && dragged && "bg-space/10")} style={{ width }} onDragOver={(e) => over(e, null)} onDrop={land}>
              <Button size="xs" variant="ghost" onClick={() => onChange((x) => ({ ...x, tracks: [{ id: `v${uid()}`, kind: "video" }, ...x.tracks] }))}>
                <PlusIcon data-icon="inline-start" /> Video track
              </Button>
              <Button size="xs" variant="ghost" onClick={() => onChange((x) => ({ ...x, tracks: [...x.tracks, { id: `a${uid()}`, kind: "audio" }] }))}>
                <PlusIcon data-icon="inline-start" /> Audio track
              </Button>
              <span className="text-xs text-muted-foreground">or drop a shot here for a new track</span>
            </div>

            {snapAt != null && <div className="pointer-events-none absolute top-7 bottom-0 z-20 w-px bg-cost" style={{ left: LABEL + snapAt * px }} />}
            <div className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-highlight" style={{ left: LABEL + time * px }}>
              <span className="absolute top-0 -left-[5px] h-3 w-[11px] rounded-b-[3px] bg-highlight" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const CLIP = { video: "border-vid/70 bg-vid/20", still: "border-img/70 bg-img/20", audio: "border-aud/60 bg-aud/10" }

function ClipBox({
  c,
  kind,
  px,
  height,
  name,
  number,
  aspect,
  state,
  off,
  misfit,
  onGrab,
  onSelect,
  ...rest
}: {
  c: Clip
  kind: "video" | "audio"
  px: number
  height: number
  name: string
  number?: number
  aspect: number
  state: "ghost" | "lifted" | "selected" | null
  off: boolean
  // not in the edit's format: a badge that fits it
  misfit?: { ratio: string; run: () => void }
  onGrab: (e: React.PointerEvent, mode: "move" | "start" | "end") => void
  onSelect: () => void
} & React.ComponentProps<"div">) {
  const still = isStill(c.path), width = Math.max(4, lenOf(c) * px), dur = c.dur ?? lenOf(c)
  // a video's frames: one each cell, the one of its time
  const cell = (height - 2) * aspect, cells = still || kind === "audio" ? 0 : Math.min(300, Math.ceil(width / cell))
  return (
    <div
      {...rest}
      role="button"
      tabIndex={0}
      data-clip={c.id}
      aria-pressed={state === "selected"}
      aria-label={`${number ? `Shot ${number}, ` : ""}${name}, ${c.at.toFixed(2)} to ${endOf(c).toFixed(2)} s`}
      onPointerDown={(e) => onGrab(e, "move")}
      onFocus={onSelect}
      className={cn(
        "absolute top-1 bottom-1 cursor-grab touch-none overflow-hidden rounded-md border outline-none select-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring",
        CLIP[kind === "audio" ? "audio" : still ? "still" : "video"],
        state === "selected" && "ring-2 ring-foreground",
        state === "lifted" && "z-10 shadow-lg ring-2 ring-space",
        state === "ghost" && "border-dashed opacity-70 ring-2 ring-space",
        off && "opacity-45"
      )}
      style={{ left: c.at * px, width, ...(still ? { backgroundImage: `url("${fileUrl(c.path)}")`, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" } : {}) }}
    >
      {Array.from({ length: cells }, (_, i) => {
        const at = c.in + ((i + 0.5) * cell) / px, k = Math.min(STRIP - 1, Math.max(0, Math.floor((at / dur) * STRIP)))
        return <span key={i} className="pointer-events-none absolute inset-y-0" style={{ left: i * cell, width: cell, backgroundImage: `url("${stripUrl(c.path)}")`, backgroundSize: `${STRIP * cell}px 100%`, backgroundPosition: `${-k * cell}px 0` }} />
      })}
      {kind === "audio" && (
        <span
          className="pointer-events-none absolute inset-0 bg-aud/80"
          style={{ maskImage: `url("${waveUrl(c.path)}")`, WebkitMaskImage: `url("${waveUrl(c.path)}")`, maskSize: `${dur * px}px 100%`, WebkitMaskSize: `${dur * px}px 100%`, maskPosition: `${-c.in * px}px 0`, WebkitMaskPosition: `${-c.in * px}px 0`, maskRepeat: "no-repeat", WebkitMaskRepeat: "no-repeat" }}
        />
      )}
      <span className="pointer-events-none absolute top-1 left-1.5 flex max-w-[calc(100%-12px)] items-center gap-1 rounded bg-black/60 px-1 text-[11px] leading-4 font-medium text-white">
        {number && <b className="tabular-nums">#{number}</b>}
        <span className="truncate">{name}</span>
      </span>
      {misfit && width > 56 && (
        <button
          type="button"
          aria-label={`Fit to ${misfit.ratio}`}
          title={`Not ${misfit.ratio}: fit it to the edit's format (${still ? "Expand" : "Reframe, free"})`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={misfit.run}
          className="absolute top-1 right-2.5 grid size-4.5 place-items-center rounded bg-black/60 text-white transition-colors hover:bg-space hover:text-space-foreground"
        >
          <RatioIcon className="size-3" />
        </button>
      )}
      <span aria-hidden onPointerDown={(e) => onGrab(e, "start")} className="absolute inset-y-0 left-0 w-2 cursor-ew-resize hover:bg-white/30" />
      <span aria-hidden onPointerDown={(e) => onGrab(e, "end")} className="absolute inset-y-0 right-0 w-2 cursor-ew-resize hover:bg-white/30" />
    </div>
  )
}

// a clip's right-click menu: what the toolbar does to the selected one
const ITEM = "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent [&_svg]:size-4 [&_svg]:shrink-0"
const MENU = "z-50 min-w-48 rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
const SEPARATOR = "-mx-1 my-1 h-px bg-border"

// Generate's items, the same in the right-click menu and the toolbar's: a few on their own, then a sub-menu per thing
// to make of the clip, its tools under their group; made when the menu opens
type Entry = { label: string; icon: React.ReactNode; note?: string; run: () => void }
type Generate = { top: Entry[]; subs: { label: string; icon: React.ReactNode; groups: [string, Entry[]][] }[] }
// the menu parts both kinds of menu have alike
type Prims = typeof ContextMenu
function GenerateItems({ M, make }: { M: Prims; make: () => Generate }) {
  const { top, subs } = make()
  const item = (e: Entry) => (
    <M.Item key={e.label} className={ITEM} onSelect={e.run}>
      {e.icon} <span className="flex-1">{e.label}</span>
      {e.note && <span className="text-xs text-muted-foreground">{e.note}</span>}
    </M.Item>
  )
  return (
    <>
      {top.map(item)}
      {subs.map((s, i) => (
        <M.Sub key={i}>
          <M.SubTrigger className={ITEM}>
            {s.icon} <span className="flex-1">{s.label}</span>
            <ChevronRightIcon className="text-muted-foreground" />
          </M.SubTrigger>
          <M.Portal>
            <M.SubContent className={cn(MENU, "max-h-[70vh] min-w-60 overflow-y-auto")}>
              {s.groups.map(([group, list], i) => (
                <Fragment key={group}>
                  {i > 0 && <M.Separator className={SEPARATOR} />}
                  <M.Label className="px-2 pt-1 pb-0.5 text-xs text-muted-foreground">{group}</M.Label>
                  {list.map(item)}
                </Fragment>
              ))}
            </M.SubContent>
          </M.Portal>
        </M.Sub>
      ))}
    </>
  )
}

function ClipMenu({ actions, children }: { actions: { split: () => void; duplicate: () => void; swap: () => void; remix?: () => void; remove: () => void; generate: () => Generate }; children: React.ReactNode }) {
  const items = [
    { label: "Split at the playhead", run: actions.split, icon: ScissorsIcon, key: "S" },
    { label: "Duplicate", run: actions.duplicate, icon: CopyPlusIcon, key: "⌘D" },
    { label: "Swap take…", run: actions.swap, icon: ReplaceIcon },
    ...(actions.remix ? [{ label: "Remix", run: actions.remix, icon: RefreshCwIcon }] : []),
  ]
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        {/* a press in it never reaches the track it is drawn from (React bubbles through portals): the playhead stays */}
        <ContextMenu.Content className={MENU} onPointerDown={(e) => e.stopPropagation()}>
          {items.map((it) => (
            <ContextMenu.Item key={it.label} className={ITEM} onSelect={it.run}>
              <it.icon /> <span className="flex-1">{it.label}</span>
              {"key" in it && <span className="text-xs text-muted-foreground">{it.key}</span>}
            </ContextMenu.Item>
          ))}
          <ContextMenu.Separator className={SEPARATOR} />
          <GenerateItems M={ContextMenu} make={actions.generate} />
          <ContextMenu.Separator className={SEPARATOR} />
          <ContextMenu.Item className={cn(ITEM, "text-destructive focus:bg-destructive/10 focus:text-destructive")} onSelect={actions.remove}>
            <Trash2Icon /> <span className="flex-1">Delete</span>
            <span className="text-xs text-muted-foreground">⌫</span>
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

// the frame at the playhead: the top clip of the video tracks there, every sound playing with it; the media stay
// mounted, so a cut shows at once
function Preview({ t, time, playing, ratio, onAuto, number, screen }: { t: Timeline; time: number; playing: boolean; ratio: string; onAuto: (r: string) => void; number: Record<string, number>; screen: React.RefObject<HTMLDivElement | null> }) {
  const els = useRef(new Map<string, HTMLVideoElement | HTMLAudioElement | HTMLImageElement>())
  const order = (c: Clip) => t.tracks.findIndex((x) => x.id === c.track)
  const kind = (c: Clip) => t.tracks[order(c)]?.kind
  const off = (c: Clip) => !!t.tracks[order(c)]?.off
  const on = (c: Clip) => time >= c.at && time < endOf(c)
  const pictures = t.clips.filter((c) => kind(c) === "video")
  const top = pictures.filter((c) => on(c) && !off(c)).sort((a, b) => order(a) - order(b))[0]
  const first = pictures.filter((c) => !off(c)).sort((a, b) => a.at - b.at)[0]

  // its format from its first picture, once loaded
  const measure = () => {
    const m = first && els.current.get(first.id)
    const [w, h] = m instanceof HTMLVideoElement ? [m.videoWidth, m.videoHeight] : m instanceof HTMLImageElement ? [m.naturalWidth, m.naturalHeight] : [0, 0]
    if (w && h) onAuto(nearest(w / h))
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(measure, [first?.id])

  // every medium in step with the playhead: playing while its clip is under it, else still on its frame
  useEffect(() => {
    for (const c of t.clips) {
      const m = els.current.get(c.id)
      if (!m || m instanceof HTMLImageElement) continue
      const want = c.in + (time - c.at)
      m.volume = Math.min(1, c.volume ?? 1)
      m.muted = off(c)
      if (playing && on(c) && !off(c)) {
        if (Math.abs(m.currentTime - want) > 0.3) m.currentTime = want
        if (m.paused) m.play().catch(() => {})
      } else {
        if (!m.paused) m.pause()
        if (!playing && c === top && Math.abs(m.currentTime - want) > 0.04) m.currentTime = want
      }
    }
  })

  const r = RATIOS[ratio as keyof typeof RATIOS] ?? 16 / 9
  const keep = (c: Clip) => (m: HTMLVideoElement | HTMLAudioElement | HTMLImageElement | null) => void (m ? els.current.set(c.id, m) : els.current.delete(c.id))
  return (
    <div className="grid min-h-0 flex-1 place-items-center" style={{ containerType: "size" }}>
      <div ref={screen} tabIndex={-1} className="relative overflow-hidden rounded-lg bg-black ring-1 ring-foreground/10 outline-none fullscreen:rounded-none" style={{ aspectRatio: r, width: `min(100cqw, calc(100cqh * ${r}))` }}>
        {pictures.map((c) =>
          isStill(c.path) ? (
            <img key={c.id} ref={keep(c)} src={fileUrl(c.path)} alt="" onLoad={measure} className={cn("absolute inset-0 size-full object-contain", c !== top && "invisible")} />
          ) : (
            <video key={c.id} ref={keep(c)} src={fileUrl(c.path)} preload="auto" playsInline onLoadedMetadata={measure} className={cn("absolute inset-0 size-full object-contain", c !== top && "invisible")} />
          )
        )}
        {t.clips.filter((c) => kind(c) === "audio").map((c) => (
          <audio key={c.id} ref={keep(c)} src={fileUrl(c.path)} preload="auto" />
        ))}
        {top && number[top.id] && <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 text-xs font-semibold text-white tabular-nums">#{number[top.id]}</span>}
        {!top && <span className="absolute inset-0 grid place-items-center p-4 text-center text-xs text-white/45">{t.clips.length ? "Nothing on the video tracks here" : "The edit plays here"}</span>}
      </div>
    </div>
  )
}
