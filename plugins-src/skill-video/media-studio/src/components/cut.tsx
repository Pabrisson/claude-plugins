import { useEffect, useRef, useState } from "react"
import { LoaderCircleIcon, PauseIcon, PlayIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { api, fileUrl, plain } from "@/lib/api"

// the part of the frame kept, in fractions of it; the whole frame keeps it uncropped
type Box = { x: number; y: number; w: number; h: number }
const WHOLE: Box = { x: 0, y: 0, w: 1, h: 1 }
const MIN_BOX = 0.05, MIN_SECONDS = 0.5
const HANDLES = [
  { id: "nw", x: 0, y: 0, cursor: "nwse-resize" },
  { id: "n", x: 0.5, y: 0, cursor: "ns-resize" },
  { id: "ne", x: 1, y: 0, cursor: "nesw-resize" },
  { id: "e", x: 1, y: 0.5, cursor: "ew-resize" },
  { id: "se", x: 1, y: 1, cursor: "nwse-resize" },
  { id: "s", x: 0.5, y: 1, cursor: "ns-resize" },
  { id: "sw", x: 0, y: 1, cursor: "nesw-resize" },
  { id: "w", x: 0, y: 0.5, cursor: "ew-resize" },
]

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
const clock = (t: number) => {
  const d = Math.round(t * 10) / 10
  return `${Math.floor(d / 60)}:${(d % 60).toFixed(1).padStart(4, "0")}`
}

// the box after a drag of its body (move) or of a handle, by dx, dy fractions of the frame
function dragBox(b: Box, mode: string, dx: number, dy: number): Box {
  if (mode === "move") return { ...b, x: clamp(b.x + dx, 0, 1 - b.w), y: clamp(b.y + dy, 0, 1 - b.h) }
  let { x, y } = b, r = b.x + b.w, bottom = b.y + b.h
  if (mode.includes("w")) x = clamp(x + dx, 0, r - MIN_BOX)
  if (mode.includes("e")) r = clamp(r + dx, x + MIN_BOX, 1)
  if (mode.includes("n")) y = clamp(y + dy, 0, bottom - MIN_BOX)
  if (mode.includes("s")) bottom = clamp(bottom + dy, y + MIN_BOX, 1)
  return { x, y, w: r - x, h: bottom - y }
}

// a video just sent to an input (or reopened from it): keep a part of it and an area of its frame, as a new file
export function CutDialog({ path, onClose, onDone }: { path: string | null; onClose: () => void; onDone: (path: string) => void }) {
  return (
    <Dialog open={!!path} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(960px,calc(100%-2rem))] sm:max-w-[min(960px,calc(100%-2rem))]">
        <DialogTitle>Edit reference</DialogTitle>
        <DialogDescription>Drag the ends of the strip to keep a part, the frame's edges to crop. Closing keeps the video whole.</DialogDescription>
        {path && <Editor key={path} path={path} onClose={onClose} onDone={onDone} />}
      </DialogContent>
    </Dialog>
  )
}

function Editor({ path, onClose, onDone }: { path: string; onClose: () => void; onDone: (path: string) => void }) {
  const src = fileUrl(path)
  const video = useRef<HTMLVideoElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const track = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ mode: string; px: number; py: number; box: Box } | null>(null)
  const scrub = useRef<string | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0, duration: 0 })
  const [failed, setFailed] = useState(false)
  const [box, setBox] = useState(WHOLE)
  const [range, setRange] = useState({ start: 0, end: 0 })
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const { duration } = size

  // the strip: as many frames as fit at its height, each the moment under its middle
  useEffect(() => {
    const c = strip.current
    if (!c || !duration) return
    let stop = false
    const v = document.createElement("video")
    v.muted = true
    v.preload = "auto"
    v.src = src
    const next = (event: string) => new Promise((ok) => v.addEventListener(event, ok, { once: true }))
    ;(async () => {
      await next("loadeddata")
      c.width = c.clientWidth * devicePixelRatio
      c.height = c.clientHeight * devicePixelRatio
      const tw = (c.height * v.videoWidth) / v.videoHeight, ctx = c.getContext("2d")!
      for (let i = 0; i * tw < c.width && !stop; i++) {
        v.currentTime = Math.min(duration - 0.05, (((i + 0.5) * tw) / c.width) * duration)
        await next("seeked")
        ctx.drawImage(v, i * tw, 0, tw, c.height)
      }
    })()
    return () => {
      stop = true
      v.removeAttribute("src")
      v.load()
    }
  }, [src, duration])

  // while it plays: the playhead follows, and it stops at the end of the part kept
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const v = video.current!
      if (v.currentTime >= range.end) {
        v.pause()
        v.currentTime = range.end
      }
      setTime(v.currentTime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, range.end])

  function seek(t: number) {
    const v = video.current!
    v.pause()
    v.currentTime = t
    setTime(t)
  }

  function toggle() {
    const v = video.current!
    if (!v.paused) return v.pause()
    if (v.currentTime < range.start || v.currentTime >= range.end - 0.05) v.currentTime = range.start
    v.play()
  }

  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    return clamp((clientX - r.left) / r.width, 0, 1) * duration
  }
  // a drag on the strip: an end of the part kept, or the playhead anywhere else
  function moveRange(mode: string, t: number) {
    if (mode === "start") {
      const start = clamp(t, 0, range.end - MIN_SECONDS)
      setRange({ ...range, start })
      seek(start)
    } else if (mode === "end") {
      const end = clamp(t, range.start + MIN_SECONDS, duration)
      setRange({ ...range, end })
      seek(end)
    } else seek(t)
  }
  const nudge = (mode: "start" | "end") => (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key]
    if (!step) return
    e.preventDefault()
    moveRange(mode, range[mode] + step * (e.shiftKey ? 1 : 0.1))
  }

  async function confirm() {
    const whole = range.start < 0.05 && range.end > duration - 0.05
    const uncropped = box.w > 0.995 && box.h > 0.995
    if (failed || (whole && uncropped)) return onClose()
    setBusy(true)
    try {
      onDone((await api.cut(path, range.start, range.end, uncropped ? undefined : box)).path)
    } catch (e) {
      toast.error(plain((e as Error).message))
      setBusy(false)
    }
  }

  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`
  const even = (x: number) => Math.max(2, Math.floor(x / 2) * 2)
  const out = { w: even(box.w * size.w), h: even(box.h * size.h) }

  const boxStyle = { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }

  return (
    <>
      {/* the padding leaves room for the handles on the frame's edges */}
      <div className="rounded-xl bg-black/40 p-3">
        <div className="relative mx-auto w-fit max-w-full">
          <video
            ref={video}
            src={src}
            playsInline
            preload="auto"
            className="block max-h-[55vh] max-w-full select-none"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget
              // a recording whose length the browser can't tell (some webm) stays whole
              if (!Number.isFinite(v.duration)) return setFailed(true)
              setSize({ w: v.videoWidth, h: v.videoHeight, duration: v.duration })
              setRange({ start: 0, end: v.duration })
            }}
            onError={() => setFailed(true)}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
          {failed && <p className="p-10 text-center text-sm text-white/80">This browser can't read this video: it stays whole.</p>}
          {!!duration && (
            <>
              <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute shadow-[0_0_0_9999px_rgb(0_0_0/0.55)]" style={boxStyle} />
              </div>
              <div
                ref={frame}
                className="absolute inset-0 touch-none"
                onPointerMove={(e) => {
                  const d = drag.current
                  if (!d) return
                  const r = frame.current!.getBoundingClientRect()
                  setBox(dragBox(d.box, d.mode, (e.clientX - d.px) / r.width, (e.clientY - d.py) / r.height))
                }}
                onPointerUp={() => (drag.current = null)}
              >
                <div
                  className="absolute cursor-move border border-white/90"
                  style={boxStyle}
                  onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId)
                    drag.current = { mode: (e.target as HTMLElement).dataset.handle ?? "move", px: e.clientX, py: e.clientY, box }
                  }}
                >
                  {[1, 2].map((i) => (
                    <div key={i} className="pointer-events-none">
                      <div className="absolute inset-y-0 w-px bg-white/35" style={{ left: `${(i * 100) / 3}%` }} />
                      <div className="absolute inset-x-0 h-px bg-white/35" style={{ top: `${(i * 100) / 3}%` }} />
                    </div>
                  ))}
                  {HANDLES.map((h) => (
                    <div
                      key={h.id}
                      data-handle={h.id}
                      aria-hidden
                      className="absolute size-5 -translate-1/2 rounded-full after:pointer-events-none after:absolute after:inset-1 after:rounded-full after:bg-white after:shadow"
                      style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, cursor: h.cursor }}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {!!duration && (
        <div className="flex items-center gap-3 rounded-xl bg-muted p-2">
          <Button size="icon" variant="secondary" className="size-11 shrink-0 rounded-lg" aria-label={playing ? "Pause" : "Play the part kept"} onClick={toggle}>
            {playing ? <PauseIcon className="fill-current" /> : <PlayIcon className="fill-current" />}
          </Button>
          <div
            ref={track}
            className="relative h-12 flex-1 touch-none select-none"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              scrub.current = (e.target as HTMLElement).dataset.end ?? "playhead"
              if (scrub.current === "playhead") seek(timeAt(e.clientX))
            }}
            onPointerMove={(e) => scrub.current && moveRange(scrub.current, timeAt(e.clientX))}
            onPointerUp={() => (scrub.current = null)}
          >
            <div className="absolute inset-0 overflow-hidden rounded-lg bg-black/40">
              <canvas ref={strip} className="pointer-events-none size-full" />
              <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: pct(range.start) }} />
              <div className="absolute inset-y-0 right-0 bg-black/60" style={{ left: pct(range.end) }} />
            </div>
            <div className="pointer-events-none absolute inset-y-0 rounded-lg border-2 border-space" style={{ left: pct(range.start), width: `calc(${pct(range.end)} - ${pct(range.start)})` }} />
            {(["start", "end"] as const).map((end) => (
              <div
                key={end}
                data-end={end}
                role="slider"
                tabIndex={0}
                aria-label={end === "start" ? "Start of the part kept" : "End of the part kept"}
                aria-valuemin={0}
                aria-valuemax={Math.round(duration * 10) / 10}
                aria-valuenow={Math.round(range[end] * 10) / 10}
                aria-valuetext={clock(range[end])}
                onKeyDown={nudge(end)}
                className="absolute inset-y-0 w-3 cursor-ew-resize rounded-sm bg-space outline-none after:pointer-events-none after:absolute after:inset-y-3.5 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:rounded-full after:bg-space-foreground/70 focus-visible:ring-3 focus-visible:ring-ring/50"
                style={{ left: end === "start" ? pct(range.start) : `calc(${pct(range.end)} - 0.75rem)` }}
              />
            ))}
            <div className="pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-white shadow" style={{ left: pct(time) }}>
              <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-xs whitespace-nowrap text-white tabular-nums">{clock(time)}</span>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2">
        {!!duration && (
          <span className="mr-auto text-sm text-muted-foreground tabular-nums">
            {clock(range.start)} – {clock(range.end)} · {(range.end - range.start).toFixed(1)} s of {duration.toFixed(1)} s · {out.w}×{out.h}
          </span>
        )}
        <Button onClick={confirm} disabled={busy}>
          {busy && <LoaderCircleIcon className="animate-spin" />} Confirm
        </Button>
      </div>
    </>
  )
}
