import { useEffect, useRef, useState, type ReactNode } from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { ScrollBar } from "@/components/ui/scroll-area"
import { clock, minutes, sameSound, soundColor, TRACKS, type Range, type Sound, type SoundRef, type Track } from "@/lib/studio"
import { cn } from "@/lib/utils"

// px: the rows' names, a track's row, a kind of sound's row
const LABEL = 112, LANE = 34, ROW = 20
// a ruler label every 64 px or more
const tickStep = (scale: number) => [1, 2, 5, 10, 15, 30, 60].find((s) => s * scale >= 64) ?? 120

// a level lane (dB every `step` s) as a waveform mirrored around its middle
function Level({ db, step, scale, color }: { db: number[]; step: number; scale: number; color: string }) {
  const h = (d: number) => Math.min(Math.max((d + 40) / 40, 0), 1) * 0.95
  const top = db.map((d, i) => `${i},${1 - h(d)}`), bottom = db.map((d, i) => `${i},${1 + h(d)}`).reverse()
  return (
    <svg
      viewBox={`0 0 ${Math.max(db.length - 1, 1)} 2`}
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-y-0 left-0 h-full"
      style={{ width: (db.length - 1) * step * scale }}
    >
      <path d={`M${top.join("L")}L${bottom.join("L")}Z`} fill={color} fillOpacity={0.45} />
    </svg>
  )
}

// The version's sound on its timeline: one row per track with its level, then one row per kind of cue under the
// effects, each in its color. A click on a row's name picks all of it for the next comment, a click on a cue that cue;
// on the rows a click seeks, a drag selects a range. Pinch or ⌘-scroll zooms.
export function SoundTimeline({
  sound,
  duration,
  time,
  range,
  picked,
  onSeek,
  onRange,
  onPick,
}: {
  sound: Sound
  duration: number
  time: number
  range: Range | null
  picked: SoundRef[]
  onSeek: (t: number) => void
  onRange: (r: Range | null) => void
  onPick: (s: SoundRef) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const lanes = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; t: number } | null>(null)
  const [width, setWidth] = useState(0)
  // px per second, null: the default
  const [zoom, setZoom] = useState<number | null>(null)
  const fit = Math.max(width - LABEL - 16, 100) / duration
  const scale = zoom ?? Math.max(fit, 40)
  const tracks = (["voice", "music", "fx"] as Track[]).filter((k) => sound.tracks[k] || (k === "fx" && sound.cues.length))
  // in order of first appearance
  const kinds = [...new Set(sound.cues.map((c) => c.kind))]
  const ticks = Array.from({ length: Math.floor(duration / tickStep(scale)) + 1 }, (_, i) => i * tickStep(scale))
  const selected = range && range.t1 > range.t0 ? range : null
  const isPicked = (s: SoundRef) => picked.some((p) => sameSound(p, s))
  const at = (clientX: number) => {
    const r = lanes.current!.getBoundingClientRect()
    return Math.min(Math.max((clientX - r.left - LABEL) / scale, 0), duration)
  }

  useEffect(() => {
    const el = scroller.current!, ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = scroller.current!
    // a pinch arrives as a wheel with ctrlKey: zoom around the pointer instead of the page
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const from = scale, fitNow = Math.max(el.clientWidth - LABEL - 16, 100) / duration
      const to = Math.min(Math.max(from * Math.exp(-e.deltaY / 200), fitNow), 400)
      const x = e.clientX - el.getBoundingClientRect().left - LABEL, left = el.scrollLeft
      setZoom(to)
      requestAnimationFrame(() => (el.scrollLeft = ((left + x) * to) / from - x))
    }
    el.addEventListener("wheel", wheel, { passive: false })
    return () => el.removeEventListener("wheel", wheel)
  }, [duration, scale])

  // the playhead stays in view while it plays
  useEffect(() => {
    const el = scroller.current!, x = time * scale, view = el.clientWidth - LABEL
    if (!drag.current && (x < el.scrollLeft || x > el.scrollLeft + view - 24)) el.scrollLeft = x - view * 0.25
    // follow the time, not the zoom (it keeps the point under the pointer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time])

  const row = (ref: SoundRef, label: string, height: number, content: ReactNode, count?: number) => (
    <div key={typeof ref === "string" ? ref : `kind-${ref.kind}`} className={cn("flex border-t", isPicked(ref) && "bg-highlight/5")} style={{ height }}>
      <button
        className={cn(
          "sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r bg-card pr-2 text-left text-xs transition-colors hover:text-foreground",
          typeof ref === "string" ? "pl-3 font-medium" : "pl-5 font-mono text-[11px]",
          isPicked(ref) ? "text-highlight hover:text-highlight" : "text-muted-foreground"
        )}
        style={{ width: LABEL }}
        aria-pressed={isPicked(ref)}
        title={typeof ref === "string" ? `Comment on the whole ${TRACKS[ref].toLowerCase()} track` : `Comment on every ${ref.kind}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => onPick(ref)}
      >
        <span
          className={cn("size-2 shrink-0 rounded-full", isPicked(ref) && "ring-2 ring-highlight ring-offset-1 ring-offset-card")}
          style={{ background: soundColor(ref) }}
        />
        <span className="truncate">{label}</span>
        {count !== undefined && <span className="ml-auto text-[10px] text-muted-foreground/70 tabular-nums">{count}</span>}
      </button>
      <div className="relative flex-1">{content}</div>
    </div>
  )

  const cuesOf = (kind: string) =>
    sound.cues
      .filter((c) => c.kind === kind)
      .map((c, i) => {
        const { t, ...data } = c
        return (
          <button
            key={i}
            className={cn(
              "absolute top-[4px] rounded-[3px] opacity-70 transition-opacity hover:opacity-100",
              isPicked(c) && "opacity-100 ring-2 ring-foreground ring-offset-1 ring-offset-card"
            )}
            style={{ left: t * scale, width: Math.max((Number(c.dur) || 0) * scale, 6), height: ROW - 8, background: soundColor(c) }}
            title={[clock(t), ...Object.entries(data).map(([a, b]) => `${a} ${JSON.stringify(b)}`)].join(" · ")}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              onPick(c)
              onSeek(t)
            }}
          />
        )
      })

  return (
    // the studio's scrollbars, both ways: the timeline is wider than the card once zoomed
    <ScrollAreaPrimitive.Root className="relative h-full">
      <ScrollAreaPrimitive.Viewport ref={scroller} className="size-full overscroll-x-contain">
        <div
          ref={lanes}
          className="relative min-h-full touch-none pb-3 select-none"
          style={{ width: LABEL + duration * scale + 16 }}
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
          <div className="sticky top-0 z-20 flex h-5 bg-card">
            <div className="sticky left-0 z-20 shrink-0 border-r bg-card" style={{ width: LABEL }} />
            <div className="relative flex-1">
              {ticks.map((t) => (
                <span key={t} className="absolute top-0 h-full border-l border-foreground/10 pl-1 font-mono text-[10px] leading-5 text-muted-foreground" style={{ left: t * scale }}>
                  {minutes(t)}
                </span>
              ))}
            </div>
          </div>
          {tracks.map((k) =>
            row(k, TRACKS[k], LANE, sound.tracks[k] && <Level db={sound.tracks[k]} step={sound.step} scale={scale} color={soundColor(k)} />)
          )}
          {kinds.map((kind) => row({ kind }, kind, ROW, cuesOf(kind), sound.cues.filter((c) => c.kind === kind).length))}
          {selected && (
            <div
              className="pointer-events-none absolute inset-y-0 z-10 border-x border-highlight bg-highlight/15"
              style={{ left: LABEL + selected.t0 * scale, width: (selected.t1 - selected.t0) * scale }}
            />
          )}
          <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-foreground" style={{ left: LABEL + time * scale }} />
        </div>
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar className="z-30" />
      <ScrollBar orientation="horizontal" className="z-30" />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}
