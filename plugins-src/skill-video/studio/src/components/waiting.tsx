import { useEffect, useState } from "react"
import { CheckIcon, CircleDashedIcon, FilmIcon, LoaderCircleIcon, XIcon } from "lucide-react"

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import type { Progress, Step } from "@/lib/studio"
import { cn } from "@/lib/utils"

// how long a step took, or has been running: 8 s, 2 min 05
const span = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`
}
const hour = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

// Nothing to review yet: what is being done on the video, newest last. Claude's own steps (the brief, the scene, a
// review pass…) lead, the engine's (transcription, renders with their progress) sit under them. The page reloads by
// itself when the first version lands. No news for 30 minutes: the work stopped (the session ended, or it waits).
export function Waiting({ progress }: { progress: Progress | null }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  const steps = progress?.steps.slice(-14) ?? []
  const live = !!progress && now - Date.parse(progress.updated) < 30 * 60_000
  const current = live ? progress.steps.findLast((s) => s.by === "claude" && s.state === "running") : undefined
  const busy = live && steps.some((s) => s.state === "running")
  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">{busy ? <LoaderCircleIcon className="animate-spin" /> : <FilmIcon />}</EmptyMedia>
        <EmptyTitle>{current?.label ?? "No video to review yet"}</EmptyTitle>
        <EmptyDescription>
          {progress && !live
            ? `No news since ${hour(progress.updated)}.`
            : "The video shows here as soon as its first version is rendered: the page reloads by itself."}
        </EmptyDescription>
      </EmptyHeader>
      {steps.length > 0 && (
        <ol className="flex w-full max-w-md flex-col gap-0.5 text-left text-sm">
          {steps.map((s) => (
            <Row key={s.id} step={s} now={now} live={live} />
          ))}
        </ol>
      )}
    </Empty>
  )
}

function Row({ step: s, now, live }: { step: Step; now: number; live: boolean }) {
  const running = s.state === "running", took = (s.t1 ? Date.parse(s.t1) : now) - Date.parse(s.t0)
  return (
    <li className={cn("flex flex-col gap-1.5 rounded-md px-2 py-1.5", s.by === "engine" && "pl-8 text-xs", running && live && "bg-muted/60")}>
      <div className="flex items-center gap-2">
        {s.state === "done" ? (
          <CheckIcon className="size-4 shrink-0 text-muted-foreground" />
        ) : s.state === "failed" ? (
          <XIcon className="size-4 shrink-0 text-destructive" />
        ) : live ? (
          <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-highlight" />
        ) : (
          <CircleDashedIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className={cn("min-w-0 flex-1 truncate", s.by === "claude" && "font-medium", !running && "text-muted-foreground")}>{s.label}</span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
          {s.total ? `${s.done ?? 0}/${s.total} · ` : ""}
          {running && !live ? hour(s.t0) : span(took)}
        </span>
      </div>
      {/* the renders count their chunks */}
      {running && live && !!s.total && (
        <div className="ml-6 h-1 overflow-hidden rounded-full bg-foreground/10">
          <div className="h-full rounded-full bg-highlight transition-[width] duration-500" style={{ width: `${Math.round(((s.done ?? 0) / s.total) * 100)}%` }} />
        </div>
      )}
    </li>
  )
}
