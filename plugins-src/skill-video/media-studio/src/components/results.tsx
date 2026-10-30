import { useRef, useState } from "react"
import {
  AudioLinesIcon,
  BookmarkPlusIcon,
  FastForwardIcon,
  LoaderCircleIcon,
  MaximizeIcon,
  MessageCircleIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  ScissorsIcon,
  StarIcon,
  Trash2Icon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { api, elapsed, fileUrl, inputPath, mediaKind, money, outputPath, plain, type Job } from "@/lib/api"
import { Viewer } from "@/components/viewer"

export type Bridge = "remix" | "animate" | "extend" | "upscale" | "avatar" | "element"

// what a result leads to, by its medium: the next tool with it as input
export const BRIDGES: Record<string, { b: Bridge; label: string; icon: LucideIcon }[]> = {
  image: [
    { b: "animate", label: "Animate", icon: PlayIcon },
    { b: "element", label: "Make an element", icon: BookmarkPlusIcon },
  ],
  video: [
    { b: "extend", label: "Extend", icon: FastForwardIcon },
    { b: "upscale", label: "Upscale", icon: MaximizeIcon },
  ],
  audio: [
    { b: "avatar", label: "Talking avatar", icon: MessageCircleIcon },
    { b: "element", label: "Make a voice", icon: BookmarkPlusIcon },
  ],
}
export const REMIX = { label: "Remix", icon: RefreshCwIcon }
export const SEND = { label: "Send to edit", icon: ScissorsIcon }

export const isRunning = (j: Job) => j.status === "queued" || j.status === "running"
export const firstOutput = (home: string, job: Job) => (job.outputs[0] ? outputPath(home, job, job.outputs[0]) : null)

// what a result cost, as its caption shows it
export function costOf(job: Job, per1000: number | null) {
  return job.provider === "local" ? "free"
    : job.status === "failed" ? `${money(job.actual ?? 0, job.estimate.unit, per1000)}, failed`
    : `${money(job.actual ?? job.estimate.amount, job.estimate.unit, per1000)}${job.actual_known ? "" : " (est.)"}`
}

export function sendToEdit(file: string) {
  const text = `/skill-video:video-editor Use ${file}: make a new video with it, or add it as B-roll to one of my projects. Ask me which.`
  navigator.clipboard.writeText(text).then(() => toast.success("Prompt copied", { description: "Paste it in Claude Code to edit with it." }))
}

// a result's shape: what its file turned out to be (measured once a session), else the ratio it asked for, else its medium's usual
const MEASURED = new Map<string, number>()
const parseRatio = (r: unknown) => {
  const m = typeof r === "string" ? r.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/) : null
  return m ? +m[1] / +m[2] : null
}
function ratioOf(job: Job, file: string | null) {
  const k = file ? mediaKind(file) : job.kind
  return (file && MEASURED.get(file)) || parseRatio(job.params?.aspect_ratio) || (k === "audio" ? 2.4 : k === "image" ? 1 : 16 / 9)
}

// the results' row height: tiles keep their ratio and share each row's width, growing at most by a third
const ROW = 200
const tileSize = (r: number) => ({ flexGrow: r, flexBasis: r * ROW, maxWidth: r * ROW * 1.35 })

function day(iso: string) {
  const d = new Date(iso), now = new Date()
  if (d.toDateString() === now.toDateString()) return "Today"
  if (d.toDateString() === new Date(now.getTime() - 864e5).toDateString()) return "Yesterday"
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) })
}

// a generation on its way, where its result will land: its shape, how long so far, its estimate
function Pending({ job, home, per1000 }: { job: Job; home: string; per1000: number | null }) {
  const r = ratioOf(job, null)
  const first = Object.values(job.inputs ?? {}).flat().find((f) => mediaKind(f) === "image")
  return (
    <figure className="flex min-w-0 flex-col gap-1.5" style={tileSize(r)} aria-busy="true">
      <div className="relative overflow-hidden rounded-xl ring-1 ring-space/30" style={{ aspectRatio: r }} title={`${job.note ?? ""} It keeps going if you close the page.`.trim()}>
        {first && <img src={fileUrl(inputPath(home, job, first))} alt="" className="absolute inset-0 size-full object-cover opacity-25 blur-md" />}
        <Skeleton className="absolute inset-0 rounded-none bg-space/12" />
        <div className="relative flex size-full flex-col items-center justify-center gap-1.5 p-3 text-center">
          <LoaderCircleIcon className="size-5 animate-spin text-space" aria-hidden />
          <span className="text-sm font-medium">{job.status === "queued" ? "Waiting to start" : job.after && job.note?.startsWith("waiting") ? "Waiting for the first sheet" : "Generating"}</span>
          {job.started && <span className="text-xs text-muted-foreground tabular-nums">{elapsed(job.started)}</span>}
        </div>
      </div>
      <figcaption className="flex items-baseline justify-between gap-2 px-0.5 text-xs">
        <span className="min-w-0 truncate">
          <span className="font-medium">{job.label}</span> <span className="text-muted-foreground">· {job.name}</span>
        </span>
        {job.provider !== "local" && <span className="font-semibold whitespace-nowrap text-cost tabular-nums">≈ {money(job.estimate.amount, job.estimate.unit, per1000)}</span>}
      </figcaption>
    </figure>
  )
}

// a voice: its words, and a play button on the tile itself
function AudioFace({ job, file }: { job: Job; file: string }) {
  const [playing, setPlaying] = useState(false)
  const audio = useRef<HTMLAudioElement>(null)
  return (
    <>
      <div className="flex size-full items-center gap-3 bg-linear-to-br from-aud/20 to-aud/5 py-4 pr-5 pl-16">
        <p className="line-clamp-4 text-[15px] leading-snug text-foreground/90">{job.prompt ? `“${job.prompt}”` : job.name}</p>
        <AudioLinesIcon className="absolute top-3 right-3 size-4 text-aud" aria-hidden />
      </div>
      <audio ref={audio} src={fileUrl(file)} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => (playing ? audio.current?.pause() : audio.current?.play())}
        className="absolute top-1/2 left-4 z-10 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-aud text-background shadow-lg transition-transform hover:scale-105"
      >
        {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4 translate-x-px" />}
      </button>
    </>
  )
}

const overlayButton = "grid size-7 place-items-center rounded-md bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80"

// a finished (or failed) generation: its media at its own shape, its price, and on hover what comes next
function Tile({
  job,
  home,
  per1000,
  onOpen,
  onBridge,
}: {
  job: Job
  home: string
  per1000: number | null
  onOpen: () => void
  onBridge: (b: Bridge, job: Job, file: string) => void
}) {
  const file = firstOutput(home, job)
  const k = file ? mediaKind(file) : null
  const [r, setR] = useState(() => ratioOf(job, file))
  const [confirm, setConfirm] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const failed = job.status === "failed"
  const measure = (w: number, h: number) => {
    if (!file || !w || !h) return
    MEASURED.set(file, w / h)
    if (Math.abs(w / h - r) > 0.01) setR(w / h)
  }

  return (
    <figure
      className="group relative flex min-w-0 flex-col gap-1.5 animate-in fade-in-0 zoom-in-[0.98] duration-300"
      style={tileSize(r)}
      onMouseEnter={() => video.current?.play().catch(() => {})}
      onMouseLeave={() => {
        if (!video.current) return
        video.current.pause()
        video.current.currentTime = 0
      }}
    >
      <div className="relative overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/5" style={{ aspectRatio: r }}>
        {failed ? (
          <div className="flex size-full flex-col items-center justify-center gap-2 bg-destructive/10 p-4 text-center text-xs text-destructive">
            <TriangleAlertIcon className="size-5" aria-hidden />
            <span className="line-clamp-3">{plain(job.error ?? "Failed")}</span>
          </div>
        ) : k === "image" ? (
          <img
            src={fileUrl(file!)}
            alt={job.prompt}
            loading="lazy"
            onLoad={(e) => measure(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : k === "video" ? (
          <video
            ref={video}
            src={fileUrl(file!)}
            muted
            loop
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => measure(e.currentTarget.videoWidth, e.currentTarget.videoHeight)}
            className="size-full object-cover"
          />
        ) : null}
        <button type="button" onClick={onOpen} aria-label={`Open ${job.label}`} className="absolute inset-0 rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/70 focus-visible:ring-inset" />
        {k === "audio" && !failed && <AudioFace job={job} file={file!} />}
        {k === "video" && <PlayIcon className="pointer-events-none absolute bottom-2 left-2 size-4 text-white drop-shadow transition-opacity group-hover:opacity-0" aria-hidden />}
        {job.outputs.length > 1 && <span className="pointer-events-none absolute top-2 left-2 rounded-md bg-black/60 px-1.5 text-xs text-white">+{job.outputs.length - 1}</span>}
        {job.favorite && <StarIcon className="pointer-events-none absolute top-2 right-2 size-4 fill-current text-cost drop-shadow transition-opacity group-focus-within:opacity-0 group-hover:opacity-0" aria-label="Favorite" />}
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <button type="button" aria-label={job.favorite ? "Remove from favorites" : "Add to favorites"} title={job.favorite ? "Unfavorite" : "Favorite"} onClick={() => api.media(job.id, "favorite")} className={overlayButton}>
            <StarIcon className={cn("size-4", job.favorite && "fill-current text-cost")} />
          </button>
          <button type="button" aria-label="Delete" title="Delete" onClick={() => setConfirm(true)} className={overlayButton}>
            <Trash2Icon className="size-4" />
          </button>
        </div>
        <div className="absolute bottom-2 left-2 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          {[
            // an imported file has nothing to remix
            ...(job.tool === "import" ? [] : [{ ...REMIX, run: () => onBridge("remix", job, file ?? "") }]),
            ...(failed || !k ? [] : (BRIDGES[k] ?? []).map((x) => ({ ...x, run: () => onBridge(x.b, job, file!) }))),
            ...(failed ? [] : [{ ...SEND, run: () => sendToEdit(file!) }]),
          ].map((a) => (
            <button key={a.label} type="button" aria-label={a.label} title={a.label} onClick={a.run} className={overlayButton}>
              <a.icon className="size-4" />
            </button>
          ))}
        </div>
      </div>
      <figcaption className="flex items-baseline justify-between gap-2 px-0.5 text-xs">
        <span className="min-w-0 truncate">
          <span className="font-medium">{job.label}</span>{" "}
          <span className="text-muted-foreground">· {job.name}{job.by === "claude" ? " · by Claude" : ""}</span>
        </span>
        <span className={cn("font-semibold whitespace-nowrap tabular-nums", job.provider === "local" || failed ? "text-muted-foreground" : "text-cost")}>{costOf(job, per1000)}</span>
      </figcaption>
      <DeleteDialog job={job} open={confirm} onOpenChange={setConfirm} />
    </figure>
  )
}

export function DeleteDialog({ job, open, onOpenChange, onDeleted }: { job: Job; open: boolean; onOpenChange: (o: boolean) => void; onDeleted?: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Delete this {job.kind}?</DialogTitle>
        <DialogDescription>It moves to the folder's .trash, where you can still get it back. Its cost stays in Credits.</DialogDescription>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={() => {
              onOpenChange(false)
              api.media(job.id, "delete").then(onDeleted, (e) => toast.error(plain(e.message)))
            }}
          >
            Delete
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// the results by day, newest first: the runs where their results will land, then the finished ones; a click opens the viewer
export function Results({
  jobs,
  home,
  per1000,
  onBridge,
  empty,
}: {
  jobs: Job[]
  home: string
  per1000: number | null
  onBridge: (b: Bridge, job: Job, file: string) => void
  empty: React.ReactNode
}) {
  const [open, setOpen] = useState<string | null>(null)
  if (!jobs.length) return <>{empty}</>
  const done = jobs.filter((j) => !isRunning(j))
  const days = new Map<string, Job[]>()
  for (const j of [...jobs.filter(isRunning), ...done]) days.set(day(j.created), [...(days.get(day(j.created)) ?? []), j])
  return (
    <div className="flex flex-col gap-7">
      {[...days].map(([label, list]) => (
        <section key={label} className="flex flex-col gap-3" aria-label={label}>
          <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{label}</h3>
          <div className="flex flex-wrap gap-x-3 gap-y-4">
            {list.map((j) =>
              isRunning(j) ? (
                <Pending key={j.id} job={j} home={home} per1000={per1000} />
              ) : (
                <Tile key={j.id} job={j} home={home} per1000={per1000} onOpen={() => setOpen(j.id)} onBridge={onBridge} />
              )
            )}
            {/* takes the last row's spare room, so its tiles keep the row height */}
            <span style={{ flexGrow: 1e4 }} />
          </div>
        </section>
      ))}
      <Viewer jobs={done} id={open} onId={setOpen} home={home} per1000={per1000} onBridge={onBridge} />
    </div>
  )
}
