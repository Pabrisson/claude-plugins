import { useEffect, useState } from "react"
import { CheckIcon, ChevronRightIcon, CircleDashedIcon, FilmIcon, LoaderCircleIcon, TriangleAlertIcon, XIcon } from "lucide-react"

import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import type { Progress, Step } from "@/lib/studio"
import { cn } from "@/lib/utils"

// how long a step took, or has been running: 8 s, 2 min 05, 1 h 02
export const span = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  return s < 3600 ? `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 3600)} h ${String(Math.floor(s / 60) % 60).padStart(2, "0")}`
}
const hour = (t: string | number) => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

// a line of the list: a step, or the same engine step done several times in a row (3 stills) with their summed time.
// handled: it failed and the work went on after it (a check Claude then fixes), not the end of the story
type Line = { step: Step; count: number; ms: number; handled: boolean }
// one of Claude's steps with the engine's under it; an engine step before any of Claude's (Project created) stands alone
type Group = { head: Line; subs: Line[] }

function groupSteps(steps: Step[], now: number): Group[] {
  const groups: Group[] = []
  steps.forEach((s, i) => {
    const line = { step: s, count: 1, ms: (s.t1 ? Date.parse(s.t1) : now) - Date.parse(s.t0), handled: s.state === "failed" && i < steps.length - 1 }
    const g = groups.at(-1), prev = g?.subs.at(-1)
    if (s.by === "claude" || !g || g.head.step.by === "engine") groups.push({ head: line, subs: [] })
    else if (s.state === "done" && prev?.step.state === "done" && prev.step.label === s.label) Object.assign(prev, { count: prev.count + 1, ms: prev.ms + line.ms })
    else g.subs.push(line)
  })
  return groups
}

// the clock the running times follow
function useNow() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}
// the last news: a logged step, or a file Claude changed since. None for 30 minutes: the work stopped (the session
// ended, or it waits)
const lastNews = (p: Progress | null) => Math.max(Date.parse(p?.updated ?? "") || 0, Date.parse(p?.touched?.mtime ?? "") || 0)
const isLive = (last: number, now: number) => !!last && now - last < 30 * 60_000
// a step of the span still runs (started after `from`, before `to`, ISO times), with news in the last 30 minutes
export const busy = (p: Progress | null, from?: string | null, to?: string | null) =>
  isLive(lastNews(p), Date.now()) &&
  !!p?.steps.some((s) => s.state === "running" && (!from || Date.parse(s.t0) > Date.parse(from)) && (!to || Date.parse(s.t0) < Date.parse(to)))

// the change since the version shown: from Claude's first step after it (the `status` that opens it), without the
// engine's stray ones before it (a still, a check); with no step of Claude's, every step since that version
const change = (p: Progress | null, since: string) => {
  const all = p?.steps.filter((s) => Date.parse(s.t0) > Date.parse(since)) ?? []
  return all.slice(Math.max(0, all.findIndex((s) => s.by === "claude")))
}
// how long the change that made the next version took: from its first step to the end of the last one started before
// that version's render (final, and Claude's step around it); null with no step logged
export const took = (p: Progress | null, since: string, to: string) => {
  const steps = change(p, since).filter((s) => Date.parse(s.t0) < Date.parse(to))
  return steps.length ? Math.max(...steps.map((s) => Date.parse(s.t1 ?? to))) - Date.parse(steps[0].t0) : null
}

// Nothing to review yet: what is being done on the video, newest last, with the total time. Claude's own steps (the
// brief, the scene, a review pass…) lead, the engine's (transcription, renders with their progress) fold under them:
// only the step being done stays open. The layout grows downwards, the title stays put. The page reloads by itself
// when the first version lands.
export function Waiting({ progress }: { progress: Progress | null }) {
  const now = useNow()
  const steps = progress?.steps ?? []
  const last = lastNews(progress)
  const live = isLive(last, now)
  const current = live ? steps.findLast((s) => s.by === "claude" && s.state === "running") : undefined
  // from the project's creation (an older project: the oldest step kept), to now or to the last news
  const start = Date.parse(progress?.started ?? "") || Date.parse(steps[0]?.t0 ?? "") || 0
  const groups = groupSteps(steps, now)
  return (
    <Empty className="min-h-0 flex-1 justify-start overflow-y-auto px-0 pt-[10vh] sm:px-12">
      <EmptyHeader>
        {!steps.length && (
          <EmptyMedia variant="icon">
            <FilmIcon />
          </EmptyMedia>
        )}
        <EmptyTitle>{current?.label ?? "No video to review yet"}</EmptyTitle>
        {!!last && (
          <EmptyDescription className="flex flex-wrap items-center justify-center gap-x-1.5 tabular-nums">
            {live ? (
              <>
                <span className="size-2 animate-pulse rounded-full bg-done" />
                Live
              </>
            ) : (
              `No news since ${hour(last)}`
            )}
            {!!start && <span>· Total {span((live ? now : last) - start)}</span>}
            {current && <span>· this step {span(now - Date.parse(current.t0))}</span>}
          </EmptyDescription>
        )}
      </EmptyHeader>
      {groups.length > 0 && <Steps groups={groups} live={live} className="max-w-lg" />}
      <footer className="flex flex-col gap-1 text-xs text-muted-foreground">
        {progress?.touched && (
          <p>
            Last change: <span className="font-mono text-foreground/80">{progress.touched.file}</span> · {span(now - Date.parse(progress.touched.mtime))} ago
          </p>
        )}
        <p>The video opens here by itself once its first version is rendered.</p>
      </footer>
    </Empty>
  )
}

// The next version being made (a feedback applied, a change asked in the conversation), above the feedback: the
// totals and the step under way, the rest unfolds; a render under way has its own card under it, with its chunks, and
// joins the list once done. Only while it runs, a step started since the version shown still
// running with news in the last 30 minutes: the rest of the time the feedback keeps the room. When the version lands,
// the alert that offers to reload takes over.
export function Working({ progress, since, next }: { progress: Progress | null; since: string; next: number }) {
  const now = useNow()
  const steps = change(progress, since)
  if (!busy(progress, since)) return null
  // the renders under way: the engine's steps that count their chunks
  const renders = steps.filter((s) => s.by === "engine" && s.state === "running" && !!s.total)
  // folded, the step under way: Claude's that runs (a review pass, not its stills), never one of the engine's under it
  const groups = groupSteps(steps.filter((s) => !renders.includes(s)), now)
  const current = (groups.findLast((x) => x.head.step.state === "running") ?? groups.at(-1))?.head
  return (
    <div className="border-b p-2">
      <details className="group/working rounded-lg border bg-card">
        <summary className="cursor-pointer list-none rounded-lg hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
          <div className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-done" />
            <span className="shrink-0 font-medium">Working on v{next}</span>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
              · Total {span(now - Date.parse(steps[0].t0))} · {steps.length} step{steps.length > 1 ? "s" : ""}
            </span>
            <Warnings n={groups.flatMap((x) => [x.head, ...x.subs]).filter((x) => x.handled).length} />
            <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open/working:rotate-90" />
          </div>
          {current && (
            <div className="pb-1 group-open/working:hidden">
              <Row line={current} live small />
            </div>
          )}
        </summary>
        <Steps groups={groups} live small className="max-h-[40vh] overflow-y-auto pb-1" />
      </details>
      {renders.map((s) => (
        <div key={s.id} className="mt-2 flex flex-col gap-1.5 rounded-lg border bg-card px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-highlight" />
            <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
            <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
              {s.done ?? 0}/{s.total} · {span(now - Date.parse(s.t0))}
            </span>
          </div>
          <Bar step={s} />
        </div>
      ))}
    </div>
  )
}

// Claude's steps with the engine's folded under them, the last one open. small: a notch smaller, in the feedback column
function Steps({ groups, live, small, className }: { groups: Group[]; live: boolean; small?: boolean; className?: string }) {
  return (
    <ol className={cn("flex w-full flex-col gap-0.5 text-left text-sm", className)}>
      {groups.map((g, i) => (
        <li key={g.head.step.id}>
          {g.subs.length ? (
            <details open={i === groups.length - 1} className="group">
              <summary className="cursor-pointer list-none rounded-md hover:bg-muted/40 [&::-webkit-details-marker]:hidden">
                <Row line={g.head} live={live} small={small} fold warnings={g.subs.filter((x) => x.handled).length} />
              </summary>
              <ol className="flex flex-col gap-0.5">
                {g.subs.map((x) => (
                  <li key={x.step.id}>
                    <Row line={x} live={live} small={small} sub />
                  </li>
                ))}
              </ol>
            </details>
          ) : (
            <Row line={g.head} live={live} small={small} />
          )}
        </li>
      ))}
    </ol>
  )
}

function Row({ line: { step: s, count, ms, handled }, live, fold, sub, small, warnings = 0 }: { line: Line; live: boolean; fold?: boolean; sub?: boolean; small?: boolean; warnings?: number }) {
  const running = s.state === "running"
  return (
    <div
      className={cn(
        "flex flex-col gap-1.5 rounded-md px-2 py-1.5",
        sub && "pl-14 text-xs",
        small && ["py-1 [&_svg]:size-3.5", sub ? "pl-12 text-[11px]" : "text-xs"],
        running && live && !sub && "bg-muted/60"
      )}
    >
      <div className="flex items-center gap-2">
        {/* a step with the engine's under it folds: its chevron, the others keep the room so the labels line up */}
        {!sub && <ChevronRightIcon className={cn("size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90", !fold && "invisible")} />}
        {s.state === "done" ? (
          <CheckIcon className="size-4 shrink-0 text-muted-foreground" />
        ) : s.state === "failed" ? (
          handled ? <TriangleAlertIcon className="size-4 shrink-0 text-amber-500" /> : <XIcon className="size-4 shrink-0 text-destructive" />
        ) : live ? (
          <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-highlight" />
        ) : (
          <CircleDashedIcon className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className={cn("min-w-0 flex-1 truncate", s.by === "claude" && "font-medium", !running && (s.by === "claude" ? "text-foreground/75" : "text-muted-foreground"))}>
          {s.label}
          {count > 1 && <span className="text-muted-foreground"> ×{count}</span>}
        </span>
        <Warnings n={warnings} />
        <span className={cn("shrink-0 font-mono text-xs text-muted-foreground tabular-nums", small && sub && "text-[11px]")}>
          {s.total ? `${s.done ?? 0}/${s.total} · ` : ""}
          {running && !live ? hour(s.t0) : span(ms)}
        </span>
      </div>
      {/* the renders count their chunks */}
      {running && live && !!s.total && <Bar step={s} className="ml-6" />}
    </div>
  )
}

// the failed checks Claude fixed after
function Warnings({ n }: { n: number }) {
  if (!n) return null
  return (
    <span className="flex shrink-0 items-center gap-1 text-xs text-amber-500 tabular-nums" title={`${n} failed check${n > 1 ? "s" : ""}, fixed after`}>
      <TriangleAlertIcon className="size-3.5" />
      {n}
    </span>
  )
}

// a render's chunks done
function Bar({ step: s, className }: { step: Step; className?: string }) {
  return (
    <div className={cn("h-1 overflow-hidden rounded-full bg-foreground/10", className)}>
      <div className="h-full rounded-full bg-highlight transition-[width] duration-500" style={{ width: `${Math.round(((s.done ?? 0) / (s.total ?? 1)) * 100)}%` }} />
    </div>
  )
}
