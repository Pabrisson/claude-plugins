import { useState } from "react"
import { AudioLinesIcon, StarIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { api, elapsed, fileUrl, inputPath, mediaKind, money, outputPath, plain, when, type Job } from "@/lib/api"
import { Price } from "@/components/chips"

export type Bridge = "remix" | "animate" | "extend" | "upscale" | "avatar"

const kindColor = { image: "text-img", video: "text-vid", audio: "text-aud" } as const

// a generation on its way: what it is, where it runs, how long so far
export function JobCard({ job, home, per1000 }: { job: Job; home: string; per1000: number | null }) {
  const firstInput = Object.values(job.inputs ?? {}).flat().find((f) => mediaKind(f) === "image")
  return (
    <div className="flex items-center gap-3.5 rounded-xl border bg-card/60 p-2.5">
      <div className="aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-muted">
        {firstInput && <img src={fileUrl(inputPath(home, job, firstInput))} alt="" className="size-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate">
          <span className="font-semibold">{job.label}</span> <span className="text-sm text-muted-foreground">{job.name}</span>
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {job.note ?? `${job.status === "queued" ? "Waiting to start" : "Running"}${job.started ? `, ${elapsed(job.started)}` : ""}`}. It keeps going if you close the page.
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded bg-muted">
          <div className="h-full w-1/3 animate-pulse rounded bg-highlight" />
        </div>
      </div>
      {job.provider !== "local" && <Price>≈ {money(job.estimate.amount, job.estimate.unit, per1000)}</Price>}
    </div>
  )
}

// a finished (or failed) generation: its media, its price, and what to do next with it
export function ResultCard({
  job,
  home,
  per1000,
  onBridge,
}: {
  job: Job
  home: string
  per1000: number | null
  onBridge: (b: Bridge, job: Job, file: string) => void
}) {
  const [confirm, setConfirm] = useState(false)
  const file = job.outputs[0] ? outputPath(home, job, job.outputs[0]) : null
  const k = file ? mediaKind(file) : null
  const cost = job.provider === "local" ? "free"
    : job.status === "failed" ? `${money(job.actual ?? 0, job.estimate.unit, per1000)}, failed`
    : `${money(job.actual ?? job.estimate.amount, job.estimate.unit, per1000)}${job.actual_known ? "" : " (est.)"}`
  const act = (b: Bridge) => file && onBridge(b, job, file)

  function sendToEdit() {
    const text = `Use ${file} in video-editor (skill-video): make a new video with it, or add it as B-roll to one of my projects. Ask me which.`
    navigator.clipboard.writeText(text).then(() => toast.success("Prompt copied", { description: "Paste it in Claude Code to edit with it." }))
  }

  return (
    <div className="group overflow-hidden rounded-xl border bg-card/60">
      <div className="relative aspect-video bg-muted">
        {job.status === "failed" ? (
          <div className="flex size-full items-center justify-center p-4 text-center text-xs text-destructive">{plain(job.error ?? "Failed")}</div>
        ) : k === "image" ? (
          <img src={fileUrl(file!)} alt={job.prompt} className="size-full object-contain" />
        ) : k === "video" ? (
          <video src={fileUrl(file!)} controls preload="metadata" className="size-full object-contain" />
        ) : k === "audio" ? (
          <div className="flex size-full flex-col items-center justify-center gap-3 p-4">
            <AudioLinesIcon className="size-8 text-aud" />
            <audio src={fileUrl(file!)} controls className="w-full" />
          </div>
        ) : null}
        {job.outputs.length > 1 && <span className="absolute top-2 left-2 rounded bg-black/60 px-1.5 text-[11px] text-white">+{job.outputs.length - 1}</span>}
        <div className="absolute top-2 right-2 flex gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <button
            type="button"
            aria-label={job.favorite ? "Remove from favorites" : "Add to favorites"}
            onClick={() => api.media(job.id, "favorite")}
            className="rounded-md bg-black/60 p-1 text-white"
          >
            <StarIcon className={cn("size-4", job.favorite && "fill-current text-cost")} />
          </button>
          <button type="button" aria-label="Delete" onClick={() => setConfirm(true)} className="rounded-md bg-black/60 p-1 text-white">
            <Trash2Icon className="size-4" />
          </button>
        </div>
        {job.favorite && <StarIcon className="absolute top-2 right-2 size-4 fill-current text-cost group-hover:opacity-0" aria-label="Favorite" />}
      </div>
      <div className="flex items-start justify-between gap-2 px-3 py-2 text-sm">
        <div className="min-w-0">
          <div className={cn("text-xs font-semibold", kindColor[job.kind])}>{job.label}</div>
          <div className="truncate text-xs text-muted-foreground">
            {job.name} · {when(job.created)}
            {job.by === "claude" ? " · by Claude" : ""}
          </div>
        </div>
        <span className={cn("text-[13px] font-semibold whitespace-nowrap", job.provider === "local" || job.status === "failed" ? "text-muted-foreground" : "text-cost")}>{cost}</span>
      </div>
      {job.status === "failed" && (
        <div className="px-2.5 pb-2.5">
          <Button size="xs" variant="secondary" onClick={() => onBridge("remix", job, "")}>Remix</Button>
        </div>
      )}
      {job.status === "done" && (
        <div className="flex flex-wrap gap-1 px-2.5 pb-2.5">
          <Button size="xs" variant="secondary" onClick={() => act("remix")}>Remix</Button>
          {k === "image" && <Button size="xs" variant="secondary" onClick={() => act("animate")}>Animate</Button>}
          {k === "video" && <Button size="xs" variant="secondary" onClick={() => act("extend")}>Extend</Button>}
          {k === "video" && <Button size="xs" variant="secondary" onClick={() => act("upscale")}>Upscale</Button>}
          {k === "audio" && <Button size="xs" variant="secondary" onClick={() => act("avatar")}>Talking avatar</Button>}
          <Button size="xs" variant="secondary" onClick={sendToEdit}>Send to edit</Button>
        </div>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent>
          <DialogTitle>Delete this {job.kind}?</DialogTitle>
          <DialogDescription>It moves to the folder's .trash, where you can still get it back. Its cost stays in Credits.</DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirm(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirm(false)
                api.media(job.id, "delete").catch((e) => toast.error(plain(e.message)))
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

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
  const running = jobs.filter((j) => j.status === "queued" || j.status === "running")
  const done = jobs.filter((j) => j.status === "done" || j.status === "failed")
  if (!jobs.length) return <>{empty}</>
  return (
    <div className="flex flex-col gap-4">
      {running.map((j) => <JobCard key={j.id} job={j} home={home} per1000={per1000} />)}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">
        {done.map((j) => <ResultCard key={j.id} job={j} home={home} per1000={per1000} onBridge={onBridge} />)}
      </div>
    </div>
  )
}
