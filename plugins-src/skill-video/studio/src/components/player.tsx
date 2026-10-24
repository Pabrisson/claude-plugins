import { useEffect, useRef, useState, type RefObject } from "react"
import {
  FlagTriangleLeftIcon,
  FlagTriangleRightIcon,
  MaximizeIcon,
  PauseIcon,
  PenLineIcon,
  PlayIcon,
  RotateCcwIcon,
  RotateCwIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react"

import { DrawLayer } from "@/components/draw"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { clock, numberOf, type Comment, type Range } from "@/lib/studio"
import { cn } from "@/lib/utils"

// the playing time, read every frame (timeupdate only fires a few times a second). The media clock steps back a few
// hundredths now and then (the audio clock catching up, a pause): only a seek moves it back, so the word, the line
// and the playhead never flicker to the one before
export function useVideoTime(video: RefObject<HTMLVideoElement | null>) {
  const [time, setTime] = useState(0)
  useEffect(() => {
    let raf = 0, seeked = false
    // media events do not bubble: caught on the way down
    const seek = () => void (seeked = true)
    document.addEventListener("seeking", seek, true)
    const tick = () => {
      const v = video.current, x = v?.currentTime ?? 0, back = seeked || !!v?.seeking
      setTime((t) => (x < t && !back ? t : x))
      seeked = false
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener("seeking", seek, true)
    }
  }, [video])
  return time
}

export const toggle = (v: HTMLVideoElement | null) =>
  v && (v.paused ? v.play() : v.pause())
// In and Out (I, O): the playhead becomes the selection's start or end, the other end stays when it can. A lone mark
// is a selection of no length, shown as a line until the other one is set
export const mark = (side: "in" | "out", t: number, r: Range | null): Range =>
  side === "in" ? { t0: t, t1: r && r.t1 > t ? r.t1 : t } : { t0: r && r.t0 < t ? r.t0 : t, t1: t }

// the video alone on the screen; Esc, F or a second call come back
export const fullscreen = (v: HTMLVideoElement | null) =>
  document.fullscreenElement ? document.exitFullscreen() : v?.requestFullscreen()

const RATES = [1, 2]

export function Player({
  video,
  src,
  ratio,
  format,
  formats,
  onFormat,
  time,
  comments,
  range,
  drawing,
  onSeek,
  onRange,
  onDraw,
  onAttach,
  onFocus,
}: {
  video: RefObject<HTMLVideoElement | null>
  src: string
  ratio: number
  format: string
  // the project's formats, ready when this version has its file
  formats: { value: string; ready: boolean }[]
  onFormat: (f: string) => void
  time: number
  comments: Comment[]
  range: Range | null
  drawing: boolean
  onSeek: (t: number) => void
  onRange: (r: Range | null) => void
  onDraw: (on: boolean) => void
  onAttach: (png: Blob) => void
  onFocus: (ids: string[]) => void
}) {
  const [paused, setPaused] = useState(true)
  const [muted, setMuted] = useState(false)
  const [rate, setRate] = useState(1)
  const [duration, setDuration] = useState(0)
  // the real ratio once the file is read; the format's until then
  const [meta, setMeta] = useState<{ src: string; ratio: number } | null>(null)
  const ar = meta?.src === src ? meta.ratio : ratio
  // a format switch loads another file: carry the time over
  const resume = useRef(0)

  useEffect(() => {
    resume.current = video.current?.currentTime ?? 0
  }, [src, video])

  useEffect(() => {
    if (drawing) video.current?.pause()
  }, [drawing, video])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative min-h-0 flex-1" style={{ containerType: "size" }}>
        {formats.length > 1 && (
          <Tabs orientation="vertical" value={format} onValueChange={onFormat} className="absolute top-1/2 right-0 z-10 -translate-y-1/2">
            <TabsList className="bg-popover/90 shadow-md ring-1 ring-foreground/10 backdrop-blur-sm">
              {formats.map((f) => (
                <TabsTrigger key={f.value} value={f.value} disabled={!f.ready} className="font-mono text-xs group-data-vertical/tabs:justify-center">
                  {f.value}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="relative"
            style={{ width: `min(100cqw, ${ar} * 100cqh)`, aspectRatio: ar }}
          >
            <video
              ref={video}
              src={src}
              muted={muted}
              playsInline
              className={cn(
                "size-full bg-background ring-1 ring-foreground/10",
                drawing && "ring-2 ring-highlight"
              )}
              onClick={() => toggle(video.current)}
              onPlay={() => setPaused(false)}
              onPause={() => setPaused(true)}
              onLoadedMetadata={(e) => {
                setDuration(e.currentTarget.duration)
                setMeta({ src, ratio: e.currentTarget.videoWidth / e.currentTarget.videoHeight })
                e.currentTarget.currentTime = resume.current
                e.currentTarget.playbackRate = rate
              }}
            />
            {paused && !drawing && (
              <button
                aria-label="Play"
                className="absolute top-1/2 left-1/2 flex size-16 -translate-1/2 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm"
                onClick={() => toggle(video.current)}
              >
                <PlayIcon className="size-7 fill-current" />
              </button>
            )}
            {drawing && (
              <DrawLayer video={video} onClose={() => onDraw(false)} onAttach={onAttach} />
            )}
          </div>
        </div>
      </div>

      <Timeline
        time={time}
        duration={duration}
        comments={comments}
        range={range}
        onSeek={onSeek}
        onRange={onRange}
        onFocus={onFocus}
      />

      <div className="flex items-center gap-1 @lg:gap-2">
        <Button size="icon-lg" className="rounded-full" aria-label={paused ? "Play" : "Pause"} onClick={() => toggle(video.current)}>
          {paused ? <PlayIcon className="fill-current" /> : <PauseIcon className="fill-current" />}
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Back 5 s" onClick={() => onSeek(time - 5)}>
              <RotateCcwIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>−5 s</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Forward 5 s" onClick={() => onSeek(time + 5)}>
              <RotateCwIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>+5 s</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Mark in" onClick={() => onRange(mark("in", time, range))}>
              <FlagTriangleRightIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>In: the selection starts here (I)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Mark out" onClick={() => onRange(mark("out", time, range))}>
              <FlagTriangleLeftIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Out: the selection ends here (O)</TooltipContent>
        </Tooltip>
        <span className="ml-1 font-mono text-xs whitespace-nowrap tabular-nums @lg:ml-2 @lg:text-sm">
          {clock(time)} <span className="text-muted-foreground">/ {clock(duration)}</span>
        </span>
        <div className="ml-auto flex items-center gap-1 @lg:gap-2">
          <Button variant={drawing ? "secondary" : "outline"} size="sm" aria-label="Draw" onClick={() => onDraw(!drawing)}>
            <PenLineIcon data-icon="inline-start" />
            <span className="hidden @lg:inline">Draw</span> <Kbd className="hidden @lg:inline-flex">P</Kbd>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="font-mono"
            onClick={() => {
              const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]
              setRate(next)
              if (video.current) video.current.playbackRate = next
            }}
          >
            {rate}×
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={muted ? "Unmute" : "Mute"}
            className={cn(muted && "bg-highlight/15 text-highlight hover:bg-highlight/20 hover:text-highlight")}
            onClick={() => setMuted(!muted)}
          >
            {muted ? <VolumeXIcon /> : <Volume2Icon />}
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Full screen" onClick={() => fullscreen(video.current)}>
                <MaximizeIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Full screen (F)</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}

// a nice tick step for ~10 to 20 ticks
const step = (d: number) => [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => d / s <= 20) ?? 600

// Open comments ride above the track (a click on one shows it); a click seeks, a drag selects a range. Grabbing the
// playhead itself drags it, grabbing the selection slides it along.
function Timeline({
  time,
  duration,
  comments: all,
  range,
  onSeek,
  onRange,
  onFocus,
}: {
  time: number
  duration: number
  // the version's comments, numbered in this order
  comments: Comment[]
  range: Range | null
  onSeek: (t: number) => void
  onRange: (r: Range | null) => void
  onFocus: (ids: string[]) => void
}) {
  const comments = all.filter((c) => !c.resolved)
  const track = useRef<HTMLDivElement>(null)
  // moving: the selection as it was when grabbed
  const drag = useRef<{ x: number; t: number; scrub: boolean; moving?: Range } | null>(null)
  const [scrubbing, setScrubbing] = useState(false)
  const pct = (t: number) => `${(duration ? Math.min(Math.max(t / duration, 0), 1) : 0) * 100}%`
  const at = (x: number) => {
    const r = track.current!.getBoundingClientRect()
    return Math.min(Math.max((x - r.left) / r.width, 0), 1) * duration
  }
  const inComment = comments.some((c) => time >= c.t0 && time <= Math.max(c.t1, c.t0 + 0.3))
  const ticks = duration ? Array.from({ length: Math.floor(duration / step(duration)) + 1 }, (_, i) => i * step(duration)) : []

  return (
    <div
      ref={track}
      className={cn("relative h-11 touch-none select-none", scrubbing ? "cursor-grabbing" : "cursor-pointer")}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        const pill = (e.target as HTMLElement).closest<HTMLElement>("[data-comment]")
        if (pill) onFocus([pill.dataset.comment!])
        const scrub = !!(e.target as HTMLElement).closest("[data-playhead]")
        const moving = !scrub && range && (e.target as HTMLElement).closest("[data-range]") ? range : undefined
        drag.current = { x: e.clientX, t: at(e.clientX), scrub, moving }
        setScrubbing(scrub || !!moving)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (d?.scrub) return onSeek(at(e.clientX))
        if (d?.moving) {
          const { t0, t1 } = d.moving, dt = Math.min(Math.max(at(e.clientX) - d.t, -t0), duration - t1)
          onRange({ t0: t0 + dt, t1: t1 + dt })
          return onSeek(t0 + dt)
        }
        if (!d || Math.abs(e.clientX - d.x) < 4) return
        const t = at(e.clientX)
        onRange({ t0: Math.min(d.t, t), t1: Math.max(d.t, t) })
      }}
      onPointerUp={(e) => {
        const d = drag.current
        drag.current = null
        setScrubbing(false)
        if (d && !d.scrub && Math.abs(e.clientX - d.x) < 4) {
          // a click on the selection keeps it
          if (!d.moving) onRange(null)
          onSeek(at(e.clientX))
        }
      }}
    >
      {comments.map((c) => (
        <div
          key={c.id}
          data-comment={c.id}
          className="absolute top-1 flex h-2.5 items-center"
          style={{ left: pct(c.t0), width: `calc(${pct(c.t1 - c.t0)} + 10px)` }}
          title={`Feedback #${numberOf(all, c)}`}
        >
          <span className="size-2.5 shrink-0 rounded-full bg-highlight" />
          <span className="h-1 flex-1 rounded-r-full bg-highlight" />
        </div>
      ))}
      <div className="absolute inset-x-0 top-7 h-2 overflow-hidden rounded-full bg-muted/70">
        <div className="h-full bg-muted-foreground/25" style={{ width: pct(time) }} />
        {ticks.map((t) => (
          <span key={t} className="absolute top-0.5 h-1 w-px bg-foreground/15" style={{ left: pct(t) }} />
        ))}
      </div>
      {range && (
        <div
          data-range
          className={cn("absolute top-5.5 h-5 rounded-md border-2 border-highlight bg-highlight/20", scrubbing ? "cursor-grabbing" : "cursor-grab")}
          style={{ left: pct(range.t0), width: pct(range.t1 - range.t0) }}
          title="Drag to move the selection"
        />
      )}
      {/* the hit area is wider than the knob, so it is easy to grab */}
      <div
        data-playhead
        className={cn("group/playhead absolute top-3 flex -translate-x-1/2 flex-col items-center px-2 pt-1", scrubbing ? "cursor-grabbing" : "cursor-grab")}
        style={{ left: pct(time) }}
      >
        <span className={cn("size-3 rounded-full bg-foreground transition-transform group-hover/playhead:scale-125", scrubbing && "scale-125", inComment && "bg-highlight")} />
        <span className="h-4 w-0.5 bg-foreground" />
      </div>
    </div>
  )
}
