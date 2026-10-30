import { useState } from "react"
import { AudioLinesIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, DownloadIcon, StarIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { api, fileUrl, inputPath, mediaKind, outputPath, plain, when, type Job } from "@/lib/api"
import { Label } from "@/components/chips"
import { Thumb } from "@/components/inputs"
import { BRIDGES, costOf, DeleteDialog, REMIX, SEND, sendToEdit, type Bridge } from "@/components/results"

// the settings a result was made with, in words
const PARAMS: Record<string, [string, (v: unknown) => string]> = {
  aspect_ratio: ["Ratio", String],
  duration: ["Duration", (v) => `${v} s`],
  resolution: ["Resolution", String],
  quality: ["Quality", String],
  n: ["Images", String],
  sound: ["Sound", (v) => (v ? "on" : "off")],
  voice: ["Voice", String],
  seed: ["Seed", String],
}
const words = (k: string) => (k[0].toUpperCase() + k.slice(1)).replaceAll("_", " ")

// a result in full: its media, how it was made, what it cost, and every next step; ← and → walk the list
export function Viewer({
  jobs,
  id,
  onId,
  home,
  per1000,
  onBridge,
}: {
  jobs: Job[]
  id: string | null
  onId: (id: string | null) => void
  home: string
  per1000: number | null
  onBridge: (b: Bridge, job: Job, file: string) => void
}) {
  const i = jobs.findIndex((j) => j.id === id)
  const job = i >= 0 ? jobs[i] : null
  const go = (d: number) => jobs[i + d] && onId(jobs[i + d].id)
  return (
    <Dialog open={!!job} onOpenChange={(o) => !o && onId(null)}>
      {job && (
        <DialogContent
          className="flex h-[min(900px,calc(100vh-2rem))] w-[calc(100vw-2rem)] max-w-none gap-0 overflow-hidden p-0 sm:max-w-[min(1440px,calc(100vw-2rem))]"
          onKeyDown={(e) => {
            if ((e.target as HTMLElement).closest("video, audio, input, textarea")) return
            if (e.key === "ArrowLeft") go(-1)
            if (e.key === "ArrowRight") go(1)
          }}
        >
          <Body key={job.id} job={job} home={home} per1000={per1000} prev={i > 0 ? () => go(-1) : null} next={i < jobs.length - 1 ? () => go(1) : null} onBridge={(b, f) => (onId(null), onBridge(b, job, f))} onDeleted={() => onId(null)} />
        </DialogContent>
      )}
    </Dialog>
  )
}

function Body({
  job,
  home,
  per1000,
  prev,
  next,
  onBridge,
  onDeleted,
}: {
  job: Job
  home: string
  per1000: number | null
  prev: (() => void) | null
  next: (() => void) | null
  onBridge: (b: Bridge, file: string) => void
  onDeleted: () => void
}) {
  const [out, setOut] = useState(0)
  const [confirm, setConfirm] = useState(false)
  const file = job.outputs[out] ? outputPath(home, job, job.outputs[out]) : null
  const k = file ? mediaKind(file) : null
  const failed = job.status === "failed"
  const params = Object.entries(job.params ?? {}).filter(([, v]) => v !== undefined && v !== null && v !== "")
  const fields = Object.entries(job.fields ?? {}).filter(([, v]) => v)
  const inputs = Object.values(job.inputs ?? {}).flat()
  const actions = [
    ...(job.tool === "import" ? [] : [{ ...REMIX, run: () => onBridge("remix", failed ? "" : (file ?? "")) }]),
    ...(failed || !k ? [] : (BRIDGES[k] ?? []).map((x) => ({ ...x, run: () => onBridge(x.b, file!) }))),
    ...(failed || !file ? [] : [{ ...SEND, run: () => sendToEdit(file) }]),
  ]

  return (
    <>
      <div className="relative flex min-w-0 flex-1 flex-col bg-black">
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          {failed ? (
            <p className="max-w-md text-center text-sm text-destructive">{plain(job.error ?? "Failed")}</p>
          ) : k === "image" ? (
            <img src={fileUrl(file!)} alt={job.prompt} className="max-h-full max-w-full rounded-lg object-contain" />
          ) : k === "video" ? (
            <video src={fileUrl(file!)} controls autoPlay loop playsInline className="max-h-full max-w-full rounded-lg" />
          ) : k === "audio" ? (
            <div className="flex w-full max-w-lg flex-col items-center gap-6">
              <AudioLinesIcon className="size-16 text-aud" aria-hidden />
              <audio src={fileUrl(file!)} controls autoPlay className="w-full" />
            </div>
          ) : null}
        </div>
        {job.outputs.length > 1 && (
          <div className="flex justify-center gap-2 pb-4">
            {job.outputs.map((o, n) => (
              <button
                key={o}
                type="button"
                aria-label={`Result ${n + 1}`}
                aria-current={n === out}
                onClick={() => setOut(n)}
                className={cn("size-14 overflow-hidden rounded-md opacity-60 ring-2 ring-transparent transition hover:opacity-100", n === out && "opacity-100 ring-white")}
              >
                <Thumb path={outputPath(home, job, o)} />
              </button>
            ))}
          </div>
        )}
        {prev && (
          <Button variant="secondary" size="icon" aria-label="Previous" onClick={prev} className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full bg-white/10 text-white ring-1 ring-white/20 backdrop-blur-sm hover:bg-white/20">
            <ChevronLeftIcon />
          </Button>
        )}
        {next && (
          <Button variant="secondary" size="icon" aria-label="Next" onClick={next} className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-white/10 text-white ring-1 ring-white/20 backdrop-blur-sm hover:bg-white/20">
            <ChevronRightIcon />
          </Button>
        )}
      </div>

      <aside className="flex w-80 shrink-0 flex-col gap-5 overflow-auto border-l p-5">
        <div className="pr-8">
          <DialogTitle className="text-base font-semibold">{job.label}</DialogTitle>
          <DialogDescription className="mt-1">
            {job.name} · {when(job.created)}
            {job.by === "claude" ? " · by Claude" : ""}
          </DialogDescription>
        </div>

        <div className="flex items-baseline justify-between rounded-lg bg-muted/50 px-3 py-2">
          <span className="text-xs text-muted-foreground">Cost</span>
          <span className={cn("font-semibold tabular-nums", job.provider === "local" || failed ? "text-muted-foreground" : "text-cost")}>{costOf(job, per1000)}</span>
        </div>

        {job.prompt && (
          <div>
            <Label>{job.kind === "audio" && k === "audio" ? "Text" : "Prompt"}</Label>
            <p className="max-h-48 overflow-auto rounded-lg bg-muted/50 p-3 text-sm leading-relaxed whitespace-pre-wrap">{job.prompt}</p>
            <Button
              variant="ghost"
              size="xs"
              className="mt-1"
              onClick={() => navigator.clipboard.writeText(job.prompt).then(() => toast.success("Prompt copied"))}
            >
              <CopyIcon data-icon="inline-start" /> Copy
            </Button>
          </div>
        )}

        {(params.length > 0 || fields.length > 0) && (
          <div>
            <Label>Settings</Label>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              {[
                ...params.map(([key, v]) => [PARAMS[key]?.[0] ?? words(key), PARAMS[key]?.[1](v) ?? String(v)]),
                ...fields.map(([key, v]) => [words(key), v]),
              ].map(([l, v]) => (
                <div key={l} className="contents">
                  <dt className="text-muted-foreground">{l}</dt>
                  <dd className="truncate">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {inputs.length > 0 && (
          <div>
            <Label>Inputs</Label>
            <div className="flex flex-wrap gap-2">
              {inputs.map((f) => (
                <a key={f} href={fileUrl(inputPath(home, job, f))} target="_blank" rel="noreferrer" className="size-14 overflow-hidden rounded-md border" title={f}>
                  <Thumb path={inputPath(home, job, f)} />
                </a>
              ))}
            </div>
          </div>
        )}

        <span className="flex-1" />

        <div className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2">
            {actions.map((a) => (
              <Button key={a.label} variant="secondary" onClick={a.run}>
                <a.icon data-icon="inline-start" /> {a.label}
              </Button>
            ))}
          </div>
          <div className="flex gap-2">
            {file && (
              <Button variant="outline" className="flex-1" asChild>
                <a href={fileUrl(file)} download={file.split("/").pop()}>
                  <DownloadIcon data-icon="inline-start" /> Download
                </a>
              </Button>
            )}
            <Button variant="outline" size="icon" aria-label={job.favorite ? "Remove from favorites" : "Add to favorites"} title="Favorite" onClick={() => api.media(job.id, "favorite")}>
              <StarIcon className={cn(job.favorite && "fill-current text-cost")} />
            </Button>
            <Button variant="outline" size="icon" aria-label="Delete" title="Delete" onClick={() => setConfirm(true)}>
              <Trash2Icon />
            </Button>
          </div>
          {(prev || next) && (
            <p className="text-center text-xs text-muted-foreground">
              <Kbd>←</Kbd> <Kbd>→</Kbd> to browse · <Kbd>Esc</Kbd> to close
            </p>
          )}
        </div>
        <DeleteDialog job={job} open={confirm} onOpenChange={setConfirm} onDeleted={onDeleted} />
      </aside>
    </>
  )
}
