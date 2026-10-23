import { useEffect, useRef, useState, type RefObject } from "react"
import {
  PauseIcon,
  PenLineIcon,
  PlayIcon,
  RotateCcwIcon,
  RotateCwIcon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react"

import { DrawLayer } from "@/components/draw"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { clock, type Comment, type Range } from "@/lib/studio"
import { cn } from "@/lib/utils"

// the playing time, read every frame (timeupdate only fires a few times a second)
export function useVideoTime(video: RefObject<HTMLVideoElement | null>) {
  const [time, setTime] = useState(0)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      setTime(video.current?.currentTime ?? 0)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [video])
  return time
}

export const toggle = (v: HTMLVideoElement | null) =>
  v && (v.paused ? v.play() : v.pause())

const RATES = [1, 2]

export function Player({
  video,
  src,
  ratio,
  time,
  comments,
  range,
  drawing,
  onSeek,
  onRange,
  onDraw,
  onAttach,
}: {
  video: RefObject<HTMLVideoElement | null>
  src: string
  ratio: number
  time: number
  comments: Comment[]
  range: Range | null
  drawing: boolean
  onSeek: (t: number) => void
  onRange: (r: Range | null) => void
  onDraw: (on: boolean) => void
  onAttach: (png: Blob) => void
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
                "size-full rounded-2xl bg-black ring-1 ring-foreground/10",
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
        </div>
      </div>
    </div>
  )
}

// a nice tick step for ~10 to 20 ticks
const step = (d: number) => [1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => d / s <= 20) ?? 600

// Commented ranges ride above the track; a click seeks, a drag selects a range.
function Timeline({
  time,
  duration,
  comments,
  range,
  onSeek,
  onRange,
}: {
  time: number
  duration: number
  comments: Comment[]
  range: Range | null
  onSeek: (t: number) => void
  onRange: (r: Range | null) => void
}) {
  const track = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; t: number } | null>(null)
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
      className="relative h-11 cursor-pointer touch-none select-none"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, t: at(e.clientX) }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || Math.abs(e.clientX - d.x) < 4) return
        const t = at(e.clientX)
        onRange({ t0: Math.min(d.t, t), t1: Math.max(d.t, t) })
      }}
      onPointerUp={(e) => {
        const d = drag.current
        drag.current = null
        if (d && Math.abs(e.clientX - d.x) < 4) {
          onRange(null)
          onSeek(at(e.clientX))
        }
      }}
    >
      {comments.map((c) => (
        <div key={c.id} className="absolute top-1 flex h-2.5 items-center" style={{ left: pct(c.t0), width: `calc(${pct(c.t1 - c.t0)} + 10px)` }}>
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
          className="absolute top-5.5 h-5 rounded-md border-2 border-highlight bg-highlight/20"
          style={{ left: pct(range.t0), width: pct(range.t1 - range.t0) }}
        />
      )}
      <div className="absolute top-4 flex -translate-x-1/2 flex-col items-center" style={{ left: pct(time) }}>
        <span className={cn("size-3 rounded-full bg-foreground", inComment && "bg-highlight")} />
        <span className="h-4 w-0.5 bg-foreground" />
      </div>
    </div>
  )
}
