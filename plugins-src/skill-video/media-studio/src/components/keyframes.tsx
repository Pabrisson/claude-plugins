import { useEffect, useRef, useState } from "react"
import { ArrowLeftIcon, ChevronRightIcon, FilmIcon, FolderOpenIcon, LoaderCircleIcon, MonitorUpIcon, PlusIcon, XIcon, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { api, fileUrl, mediaKind, outputPath, plain, type Job } from "@/lib/api"
import { Label } from "@/components/chips"
import { LibraryList, Thumb, upload, type Pick } from "@/components/inputs"

// the Library's results of one medium, as a picker lists them
export const resultsOf = (media: Job[], home: string, kind: "image" | "video"): Pick[] =>
  media.flatMap((j) => (j.status === "done" ? j.outputs.map((o) => ({ path: outputPath(home, j, o), job: j })) : [])).filter((x) => mediaKind(x.path) === kind)

function Item({ icon: Icon, children, onClick }: { icon: LucideIcon; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none">
      <Icon className="size-4 text-muted-foreground" aria-hidden />
      {children}
    </button>
  )
}

// where an image comes from: the computer, the Library, or a frame of a Library video. The trigger is its child (told
// while a file uploads); several picks keep the Library open
export function ImageSource({ media, home, multiple, picked = [], onAdd, onRemove, frames = true, side = "right", children }: {
  media: Job[]
  home: string
  multiple?: boolean
  picked?: string[]
  onAdd: (paths: string[]) => void
  onRemove?: (path: string) => void
  frames?: boolean
  side?: "right" | "bottom"
  children: (busy: boolean) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<"menu" | "library" | "video">("menu")
  const [video, setVideo] = useState<string>()
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const close = () => (setOpen(false), setView("menu"), setVideo(undefined))
  async function fromComputer(list: File[]) {
    setBusy(true)
    try {
      onAdd(await Promise.all(list.slice(0, multiple ? undefined : 1).map(upload)))
    } catch (e) {
      toast.error(plain((e as Error).message))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Popover open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <PopoverTrigger asChild>{children(busy)}</PopoverTrigger>
        <PopoverContent side={side} align="start" sideOffset={8} collisionPadding={12} className={cn("flex max-h-(--radix-popover-content-available-height) flex-col gap-0 p-0", view === "menu" ? "w-56" : "w-[min(460px,calc(100vw-2rem))]")}>
          {view === "menu" && (
            <div className="flex flex-col p-1">
              <Item icon={MonitorUpIcon} onClick={() => (close(), file.current?.click())}>From your computer</Item>
              <Item icon={FolderOpenIcon} onClick={() => setView("library")}>From the library</Item>
              {frames && <Item icon={FilmIcon} onClick={() => setView("video")}>A frame of a video</Item>}
            </div>
          )}
          {view === "library" && (
            <LibraryList
              title="Images from the library"
              items={resultsOf(media, home, "image")}
              picked={picked}
              multiple={multiple}
              onPick={(p) => (picked.includes(p) ? onRemove?.(p) : (onAdd([p]), !multiple && close()))}
            />
          )}
          {view === "video" &&
            (video ? (
              <FrameAt video={video} onBack={() => setVideo(undefined)} onAdd={(p) => (onAdd([p]), close())} />
            ) : (
              <LibraryList title="A frame of which video?" items={resultsOf(media, home, "video")} picked={[]} onPick={setVideo} />
            ))}
        </PopoverContent>
      </Popover>
      <input ref={file} type="file" hidden multiple={multiple} accept="image/*" onChange={(e) => (e.target.files?.length && fromComputer([...e.target.files]), (e.target.value = ""))} />
    </>
  )
}

// a frame of a video at the time the slider says, kept as an image
function FrameAt({ video, onAdd, onBack }: { video: string; onAdd: (path: string) => void; onBack: () => void }) {
  const [t, setT] = useState(0)
  const [length, setLength] = useState(0)
  const [frame, setFrame] = useState<string>()
  const asked = useRef(0)
  useEffect(() => {
    const n = ++asked.current
    const wait = setTimeout(() => api.frame(video, false, t).then(({ path }) => n === asked.current && setFrame(path), (e) => toast.error(plain(e.message))), 250)
    return () => clearTimeout(wait)
  }, [video, t])
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-1.5">
        <Button size="icon-xs" variant="ghost" aria-label="Another video" title="Another video" onClick={onBack}>
          <ArrowLeftIcon />
        </Button>
        <span className="text-sm font-semibold">A frame of the video</span>
      </div>
      <div className="relative grid aspect-video place-items-center overflow-hidden rounded-lg bg-muted">
        {frame ? <img src={fileUrl(frame)} alt={`The frame at ${t.toFixed(1)} s`} className="size-full object-contain" /> : <LoaderCircleIcon className="size-5 animate-spin text-muted-foreground" />}
      </div>
      <video src={fileUrl(video)} preload="metadata" hidden onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLength(e.currentTarget.duration)} />
      <div className="flex items-center gap-3 px-1">
        <Slider className="flex-1" min={0} max={Math.max(0.1, length - 0.1)} step={0.1} value={[t]} disabled={!length} onValueChange={([v]) => setT(v)} aria-label="The frame" />
        <span className="w-12 text-right text-sm tabular-nums">{t.toFixed(1)} s</span>
      </div>
      <Button disabled={!frame} onClick={() => frame && onAdd(frame)}>
        Add this frame
      </Button>
    </div>
  )
}

export type MidFrames = { max: number; total?: number; timed?: boolean; cite?: string }
// how many frames a model takes at this length, first and last included (Kling 4.0: 3 s → 4 … 9 s and more → 10)
export const frameCap = (mf: MidFrames, seconds: number) => (mf.total ? Math.min(mf.total, Math.floor(seconds) + 1) : null)

// the frames a video goes through, in order: its first, the middle ones, its last. A tile is dragged to another place,
// an image dropped on one; a click on a tag cites that frame in the words (Kling 4.0), a middle frame of Grok has its time
export function KeyframeStrip({ inputs, times = [], mf, cite, seconds, media, home, onChange, onCite }: {
  inputs: Record<string, string[]>
  times?: (number | undefined)[]
  mf: MidFrames
  cite?: Record<string, string> | null
  seconds: number
  media: Job[]
  home: string
  onChange: (inputs: Record<string, string[]>, times: (number | undefined)[]) => void
  onCite: (tag: string) => void
}) {
  const first = inputs.first_frame?.[0], last = inputs.last_frame?.[0], mids = inputs.mid_frames ?? []
  const all = mids.length + (first ? 1 : 0) + (last ? 1 : 0), cap = frameCap(mf, seconds)
  const room = mids.length < mf.max && (cap == null || all < cap)
  const [dragged, setDragged] = useState<number | null>(null)
  const [over, setOver] = useState<number | "add" | null>(null)
  const [busy, setBusy] = useState(false)

  // the whole row as one list: [first, ...middle, last], a hole where a frame is missing
  const seq: (string | undefined)[] = [first, ...mids, last]
  const save = (s: (string | undefined)[], t: (number | undefined)[]) => {
    const middle = s.slice(1, -1)
    onChange({ ...inputs, first_frame: s[0] ? [s[0]] : [], mid_frames: middle.filter((x): x is string => !!x), last_frame: s.at(-1) ? [s.at(-1)!] : [] }, t.filter((_, i) => middle[i]))
  }
  // a frame moved: among the middle ones it slides into place, to or from the first or the last it swaps; onto « + »
  // it becomes the last middle frame
  const isEnd = (i: number) => i === 0 || i === seq.length - 1
  function move(from: number, to: number | "add") {
    if (from === to) return
    const s = [...seq], t = [...times]
    if (to === "add") {
      const v = s[from]
      if (isEnd(from)) s[from] = undefined
      else {
        s.splice(from, 1)
        t.splice(from - 1, 1)
      }
      s.splice(s.length - 1, 0, v)
      t.push(undefined)
    } else if (!isEnd(from) && !isEnd(to)) {
      s.splice(to, 0, ...s.splice(from, 1))
      t.splice(to - 1, 0, ...t.splice(from - 1, 1))
    } else {
      ;[s[from], s[to]] = [s[to], s[from]]
      if (!isEnd(from)) t[from - 1] = undefined
      if (!isEnd(to)) t[to - 1] = undefined
    }
    save(s, t)
  }
  // images put on the first or the last, or added after the middle ones (as many as fit)
  const place = (at: number | "add", paths: string[]) => {
    const s = [...seq]
    if (at !== "add" && isEnd(at)) {
      s[at] = paths[0]
      return save(s, times)
    }
    const fit = paths.slice(0, Math.max(0, Math.min(mf.max - mids.length, cap == null ? Infinity : cap - all)))
    if (fit.length < paths.length) toast.warning(`${paths.length - fit.length} left out`, { description: cap != null ? `${cap} frames at most at ${seconds} s, first and last included.` : `${mf.max} middle frames at most.` })
    s.splice(s.length - 1, 0, ...fit)
    save(s, [...times, ...fit.map(() => undefined)])
  }
  const remove = (at: number) => {
    const s = [...seq], t = [...times]
    if (isEnd(at)) s[at] = undefined
    else {
      s.splice(at, 1)
      t.splice(at - 1, 1)
    }
    save(s, t)
  }
  async function dropFiles(at: number | "add", files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"))
    if (!images.length) return
    setBusy(true)
    try {
      place(at, await Promise.all((at !== "add" && isEnd(at) ? images.slice(0, 1) : images).map(upload)))
    } catch (e) {
      toast.error(plain((e as Error).message))
    } finally {
      setBusy(false)
    }
  }

  const tagOf = (at: number) => (at === 0 ? cite?.first_frame : at === seq.length - 1 ? cite?.last_frame : mf.cite?.replace("{n}", String(at)))
  const nameOf = (at: number) => (at === 0 ? "First" : at === seq.length - 1 ? "Last" : `Frame ${at}`)
  const dropProps = (at: number | "add") => ({
    onDragOver: (e: React.DragEvent) => (e.preventDefault(), e.stopPropagation(), setOver(at)),
    onDragLeave: () => setOver(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setOver(null)
      if (e.dataTransfer.files.length) dropFiles(at, [...e.dataTransfer.files])
      else if (dragged != null) move(dragged, at)
      setDragged(null)
    },
  })

  const tile = (at: number) => {
    const path = seq[at], tag = tagOf(at), end = isEnd(at)
    return (
      <div key={`${at}:${path ?? ""}`} className="flex min-w-16 shrink-0 flex-col items-center gap-1">
        {path ? (
          <div
            draggable
            onDragStart={(e) => (setDragged(at), (e.dataTransfer.effectAllowed = "move"))}
            onDragEnd={() => (setDragged(null), setOver(null))}
            {...dropProps(at)}
            title="Drag it to another place"
            className={cn("group relative size-16 cursor-grab overflow-hidden rounded-lg border active:cursor-grabbing", over === at && "ring-2 ring-space", dragged === at && "opacity-40")}
          >
            <Thumb path={path} />
            <button
              type="button"
              aria-label={`Remove ${nameOf(at).toLowerCase()}`}
              onClick={() => remove(at)}
              className="absolute top-1 right-1 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            >
              <XIcon className="size-3" />
            </button>
          </div>
        ) : (
          <ImageSource media={media} home={home} onAdd={(p) => place(at, p)}>
            {(loading) => (
              <button
                type="button"
                {...dropProps(at)}
                aria-label={`Add the ${nameOf(at).toLowerCase()} frame`}
                title="From your computer, the library or a frame of a video; or drop an image here"
                className={cn("grid size-16 place-items-center rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-space/60 hover:text-space", over === at && "border-space bg-space/10 text-space")}
              >
                {loading || (busy && over === at) ? <LoaderCircleIcon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
              </button>
            )}
          </ImageSource>
        )}
        {/* its tag when the model cites its frames (a click puts it in the words), else its place */}
        {path && tag ? (
          <button type="button" onClick={() => onCite(tag)} title={`Cite ${tag} in your words`} className="rounded px-1 font-mono text-[10px] leading-4 whitespace-nowrap text-muted-foreground hover:bg-muted hover:text-foreground">
            {tag}
          </button>
        ) : (
          <span className={cn("text-xs leading-4", end ? "text-muted-foreground" : "text-foreground")}>{end ? nameOf(at) : at}</span>
        )}
        {path && !end && mf.timed && (
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Input
              inputMode="decimal"
              className="h-6 w-11 px-1.5 text-center text-[11px]"
              placeholder="s"
              aria-label={`Frame ${at}: its time in seconds`}
              value={times[at - 1] ?? ""}
              onChange={(e) => {
                const t = [...times]
                t[at - 1] = e.target.value === "" || Number.isNaN(+e.target.value) ? undefined : +e.target.value
                onChange(inputs, t)
              }}
            />
            s
          </label>
        )}
      </div>
    )
  }
  const arrow = (k: string) => <ChevronRightIcon key={k} className="mt-6 size-3.5 shrink-0 text-muted-foreground/50" aria-hidden />

  return (
    <div>
      <Label
        hint={
          <span className={cn("tabular-nums", cap != null && all > cap && "font-medium text-destructive")}>
            {cap != null ? `${all} / ${cap} frames at ${seconds} s` : `${mids.length} / ${mf.max} middle frames`}
          </span>
        }
      >
        Keyframes
      </Label>
      <div className="flex items-start gap-1.5 overflow-x-auto pb-1">
        {tile(0)}
        {mids.map((_, i) => [arrow(`a${i}`), tile(i + 1)])}
        {room && (
          <>
            {arrow("add")}
            <div className="flex min-w-16 shrink-0 flex-col items-center gap-1">
              <ImageSource media={media} home={home} multiple onAdd={(p) => place("add", p)}>
                {(loading) => (
                  <button
                    type="button"
                    {...dropProps("add")}
                    aria-label="Add a middle frame"
                    title="From your computer, the library or a frame of a video; or drop images here"
                    className={cn("grid size-16 place-items-center rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-space/60 hover:text-space", over === "add" && "border-space bg-space/10 text-space")}
                  >
                    {loading || (busy && over === "add") ? <LoaderCircleIcon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
                  </button>
                )}
              </ImageSource>
              <span className="text-xs leading-4 text-muted-foreground">Middle</span>
            </div>
          </>
        )}
        {arrow("last")}
        {tile(seq.length - 1)}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        {mf.timed ? "The video passes through each middle frame at its time." : "The video passes through each frame in this order."} Drag a frame to move it.
        {cite && " Click a tag to cite it in your words."}
      </p>
    </div>
  )
}
