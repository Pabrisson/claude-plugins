import { useEffect, useRef, useState, type ReactNode } from "react"
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui"

import { ScrollBar } from "@/components/ui/scroll-area"
import { minutes, type Range } from "@/lib/studio"
import { cn } from "@/lib/utils"

// px: the rows' names
const LABEL = 112
// a ruler label every 64 px or more
const tickStep = (scale: number) => [1, 2, 5, 10, 15, 30, 60].find((s) => s * scale >= 64) ?? 120

export type Lane = {
  key: string
  label: string
  height: number
  // the dot before the name; none for a row that cannot be picked
  color?: string
  picked?: boolean
  title?: string
  onPick?: () => void
  count?: number
  // a kind under a track: indented
  sub?: boolean
  content: (scale: number) => ReactNode
}

// black or white text, whichever reads on a #rrggbb background (the hues of colorOf() are light)
const ink = (bg: string) => {
  const m = /^#(\w\w)(\w\w)(\w\w)$/.exec(bg)
  return m && 0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16) < 150 ? "#fff" : "#000"
}

// one moment of a row: a cue, a part; at least 6 px wide, its label inside when it fits. `edge`: the color is a
// line under a neutral block (a background color, which can be as dark as the studio or as light as paper)
export function Block({
  t0,
  t1,
  scale,
  color,
  edge,
  picked,
  label,
  title,
  height,
  onClick,
}: {
  t0: number
  t1: number
  scale: number
  color: string
  edge?: boolean
  picked: boolean
  label?: string
  title: string
  height: number
  onClick: () => void
}) {
  const width = Math.max((t1 - t0) * scale, 6)
  return (
    <button
      className={cn(
        "absolute top-1 truncate rounded-[3px] px-1.5 text-left font-mono text-[10px] leading-none opacity-75 ring-1 ring-foreground/15 transition-opacity hover:opacity-100",
        edge && "bg-muted text-foreground opacity-100 hover:bg-foreground/15",
        picked && "opacity-100 ring-2 ring-highlight ring-offset-1 ring-offset-card"
      )}
      style={{ left: t0 * scale, width, height: height - 8, ...(edge ? { boxShadow: `inset 0 -3px 0 ${color}` } : { background: color, color: ink(color) }) }}
      title={title}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onClick}
    >
      {label && width > 36 ? label : null}
    </button>
  )
}

// A timeline of rows under a ruler, for the Sound and Video tabs: a click on a row's name picks all of it, on the
// rows a click seeks and a drag selects a range. Pinch or ⌘-scroll zooms; the playhead stays in view while it plays.
export function Lanes({
  lanes,
  duration,
  time,
  range,
  onSeek,
  onRange,
}: {
  lanes: Lane[]
  duration: number
  time: number
  range: Range | null
  onSeek: (t: number) => void
  onRange: (r: Range | null) => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; t: number } | null>(null)
  const [width, setWidth] = useState(0)
  // px per second, null: the default
  const [zoom, setZoom] = useState<number | null>(null)
  const fit = Math.max(width - LABEL - 16, 100) / duration
  const scale = zoom ?? Math.max(fit, 40)
  const ticks = Array.from({ length: Math.floor(duration / tickStep(scale)) + 1 }, (_, i) => i * tickStep(scale))
  const selected = range && range.t1 > range.t0 ? range : null
  const at = (clientX: number) => {
    const r = inner.current!.getBoundingClientRect()
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

  useEffect(() => {
    const el = scroller.current!, x = time * scale, view = el.clientWidth - LABEL
    if (!drag.current && (x < el.scrollLeft || x > el.scrollLeft + view - 24)) el.scrollLeft = x - view * 0.25
    // follow the time, not the zoom (it keeps the point under the pointer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time])

  return (
    // the studio's scrollbars, both ways: the timeline is wider than the card once zoomed
    <ScrollAreaPrimitive.Root className="relative h-full">
      <ScrollAreaPrimitive.Viewport ref={scroller} className="size-full overscroll-x-contain">
        <div
          ref={inner}
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
                <span key={t} className="absolute top-0 h-5 border-l border-foreground/10 pl-1 font-mono text-[10px] leading-5 text-muted-foreground" style={{ left: t * scale }}>
                  {minutes(t)}
                </span>
              ))}
            </div>
          </div>
          {lanes.map((l) => (
            <div key={l.key} className={cn("flex border-t", l.picked && "bg-highlight/5")} style={{ height: l.height }}>
              <button
                className={cn(
                  "sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r bg-card pr-2 text-left text-xs transition-colors enabled:hover:text-foreground",
                  l.sub ? "pl-5 font-mono text-[11px]" : "pl-3 font-medium",
                  l.picked ? "text-highlight enabled:hover:text-highlight" : "text-muted-foreground"
                )}
                style={{ width: LABEL }}
                disabled={!l.onPick}
                aria-pressed={l.onPick ? !!l.picked : undefined}
                title={l.title}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={l.onPick}
              >
                {l.color && (
                  <span
                    className={cn("size-2 shrink-0 rounded-full", l.picked && "ring-2 ring-highlight ring-offset-1 ring-offset-card")}
                    style={{ background: l.color }}
                  />
                )}
                <span className="truncate">{l.label}</span>
                {l.count !== undefined && <span className="ml-auto text-[10px] text-muted-foreground/70 tabular-nums">{l.count}</span>}
              </button>
              <div className="relative flex-1">{l.content(scale)}</div>
            </div>
          ))}
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
