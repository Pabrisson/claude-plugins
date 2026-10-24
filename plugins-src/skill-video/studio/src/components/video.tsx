import { useState } from "react"

import { Block, Lanes, type Lane } from "@/components/lanes"
import { clock, colorOf, sameVisual, visualColor, type Part, type Range, type Strip, type Visual, type VisualRef } from "@/lib/studio"
import { cn } from "@/lib/utils"

// px: the frames' row, the sequences' row (thumbnails over a caption), a thumbnail's height, a kind of part's row,
// a step of a cascade
const STRIP = 56, CLIPS = 80, THUMB = 48, ROW = 22, STEP = 28

// one thumbnail of the sheet, `height` px high
function Thumb({ strip, i, height, className, style }: { strip: Strip; i: number; height: number; className?: string; style?: React.CSSProperties }) {
  const k = height / strip.h, w = strip.w * k, rows = Math.ceil(strip.count / strip.cols)
  return (
    <div
      className={className}
      style={{
        ...style,
        width: w,
        height,
        backgroundImage: `url(project/${strip.file})`,
        backgroundSize: `${strip.cols * w}px ${rows * height}px`,
        backgroundPosition: `-${(i % strip.cols) * w}px -${Math.floor(i / strip.cols) * height}px`,
      }}
    />
  )
}

// thumbnails from t0 to t1, one every `step` s so they sit side by side at this zoom, placed from t0
function Frames({ strip, t0, t1, scale }: { strip: Strip; t0: number; t1: number; scale: number }) {
  const step = Math.ceil((strip.w * THUMB) / strip.h / scale / strip.every) * strip.every
  return Array.from({ length: Math.max(1, Math.ceil((t1 - t0) / step)) }, (_, n) => (
    <Thumb
      key={n}
      strip={strip}
      i={Math.min(Math.round((t0 + n * step) / strip.every), strip.count - 1)}
      height={THUMB}
      className="absolute top-0"
      style={{ left: n * step * scale }}
    />
  ))
}

// The video as a track of its sequences (their thumbnails, name and length, the field's color as a line under them)
// and one row per other kind of part the scene declared. A row's name picks every part of it for the next comment, a block that part; hovering the track shows the frame.
export function VideoTimeline({
  visual,
  format,
  duration,
  time,
  range,
  picked,
  onSeek,
  onRange,
  onPick,
}: {
  visual: Visual
  format: string
  duration: number
  time: number
  range: Range | null
  picked: VisualRef[]
  onSeek: (t: number) => void
  onRange: (r: Range | null) => void
  onPick: (x: VisualRef) => void
}) {
  const [hover, setHover] = useState<{ x: number; i: number } | null>(null)
  const isPicked = (x: VisualRef) => picked.some((p) => sameVisual(p, x))
  const strip = visual.strips[format] ?? Object.values(visual.strips)[0]
  const seqs = visual.parts.filter((p) => p.kind === "sequence")
  // the next sequence starts during a transition: each block ends where the next begins
  const ends = seqs.map((s, i) => Math.min(s.t1, seqs[i + 1]?.t0 ?? s.t1))
  const playing = seqs.findLast((s) => s.t0 <= time && time < s.t1)
  // in order of first appearance
  const kinds = [...new Set(visual.parts.map((p) => p.kind))].filter((k) => k !== "sequence" || !strip)

  // the frame under the pointer, as a larger thumbnail under the row
  const hovering = (children: React.ReactNode, scale: number) => {
    const at = (e: React.PointerEvent) => e.clientX - e.currentTarget.getBoundingClientRect().left
    return (
      <div
        className="absolute inset-0"
        onPointerMove={(e) => setHover({ x: at(e), i: Math.min(Math.round(at(e) / scale / strip.every), strip.count - 1) })}
        onPointerLeave={() => setHover(null)}
      >
        {children}
        {hover && (
          <div className="pointer-events-none absolute top-full z-30 rounded-md bg-popover p-1 shadow-lg ring-1 ring-foreground/15" style={{ left: Math.max(hover.x - strip.w / 2, 0) }}>
            <Thumb strip={strip} i={hover.i} height={strip.h} className="rounded-sm" />
            <p className="pt-1 text-center font-mono text-[10px] text-muted-foreground">{clock(hover.i * strip.every)}</p>
          </div>
        )}
      </div>
    )
  }

  const track: Lane | null = !strip
    ? null
    : seqs.length
      ? {
          key: "sequences",
          label: "Sequences",
          height: CLIPS,
          color: colorOf("sequence"),
          picked: isPicked({ kind: "sequence" }),
          title: "Comment on every sequence",
          onPick: () => onPick({ kind: "sequence" }),
          count: seqs.length,
          content: (scale) =>
            hovering(
              seqs.map((s, i) => (
                <button
                  key={i}
                  className={cn(
                    "absolute top-1 bottom-1 overflow-hidden rounded-md bg-muted text-left ring-1 ring-foreground/15 transition-shadow hover:ring-foreground/40",
                    s === playing && "ring-2 ring-foreground/70 hover:ring-foreground/70",
                    isPicked(s) && "ring-2 ring-highlight hover:ring-highlight"
                  )}
                  style={{ left: s.t0 * scale, width: Math.max((ends[i] - s.t0) * scale - 2, 4) }}
                  title={`${s.name ?? "sequence"} · ${clock(s.t0)} → ${clock(s.t1)}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => {
                    onPick(s)
                    onSeek(s.t0)
                  }}
                >
                  <Frames strip={strip} t0={s.t0} t1={ends[i]} scale={scale} />
                  <span className={cn("absolute inset-x-0 bottom-0 flex h-[22px] items-center gap-1.5 truncate bg-card/95 px-1.5 pb-[3px] font-mono text-[10px]", s === playing ? "text-foreground" : "text-muted-foreground")}>
                    <span className="truncate">{s.name ?? "sequence"}</span>
                    <span className="shrink-0 text-muted-foreground/70 tabular-nums">{(s.t1 - s.t0).toFixed(1)} s</span>
                  </span>
                  <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: visualColor(s) }} />
                </button>
              )),
              scale
            ),
        }
      : { key: "frames", label: "Frames", height: STRIP, title: "Hover to see the frame", content: (scale) => hovering(<Frames strip={strip} t0={0} t1={duration} scale={scale} />, scale) }

  const lanes: Lane[] = [
    ...(track ? [track] : []),
    ...kinds.map((kind) => {
      const parts = visual.parts.filter((p) => p.kind === kind)
      const about = (p: Part) => {
        const data = Object.entries(p).filter(([k]) => !["kind", "t0", "t1", "name", "color"].includes(k))
        return [`${p.name ?? kind} · ${clock(p.t0)} → ${clock(p.t1)}`, ...data.map(([a, b]) => `${a} ${JSON.stringify(b)}`)].join(" · ")
      }
      const choose = (p: Part) => () => {
        onPick(p)
        onSeek(p.t0)
      }
      // under sequences, a cascade: each part one step lower than the one before it in the same sequence
      const seen = new Map<number, number>()
      const levels = parts.map((p) => {
        const s = seqs.findLastIndex((q) => q.t0 <= p.t0 + 0.01), n = seen.get(s) ?? 0
        seen.set(s, n + 1)
        return n
      })
      const cascade = seqs.length > 0
      return {
        key: `kind-${kind}`,
        label: kind,
        height: cascade ? Math.max(...levels, 0) * STEP + STEP + 4 : ROW,
        sub: true,
        color: colorOf(kind),
        picked: isPicked({ kind }),
        title: `Comment on every ${kind}`,
        onPick: () => onPick({ kind }),
        count: parts.length,
        content: (scale: number) =>
          parts.map((p: Part, i) =>
            cascade ? (
              <button
                key={i}
                className={cn(
                  "absolute flex items-center gap-1.5 overflow-hidden rounded-md bg-muted pr-1.5 text-left font-mono text-[10px] text-muted-foreground ring-1 ring-foreground/15 transition-shadow hover:ring-foreground/40",
                  p.t0 <= time && time < p.t1 && "text-foreground ring-foreground/70 hover:ring-foreground/70",
                  isPicked(p) && "ring-2 ring-highlight hover:ring-highlight"
                )}
                style={{ left: p.t0 * scale, top: 4 + levels[i] * STEP, width: Math.max((p.t1 - p.t0) * scale - 2, 24), height: STEP - 4 }}
                title={about(p)}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={choose(p)}
              >
                {/* a frame a little after it starts: the first one is often still the transition */}
                {strip && (
                  <Thumb
                    strip={strip}
                    i={Math.min(Math.round((p.t0 + Math.min(1, (p.t1 - p.t0) / 3)) / strip.every), strip.count - 1)}
                    height={STEP - 4}
                    className="shrink-0"
                  />
                )}
                <span className="truncate">{p.name ?? kind}</span>
                <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: visualColor(p) }} />
              </button>
            ) : (
              <Block
                key={i}
                t0={p.t0}
                t1={p.t1}
                scale={scale}
                height={ROW}
                color={visualColor(p)}
                edge={!!p.color}
                picked={isPicked(p)}
                label={p.name ?? kind}
                title={about(p)}
                onClick={choose(p)}
              />
            )
          ),
      }
    }),
  ]
  return <Lanes lanes={lanes} duration={duration} time={time} range={range} onSeek={onSeek} onRange={onRange} />
}
