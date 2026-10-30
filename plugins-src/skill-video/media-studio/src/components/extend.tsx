import { useState } from "react"
import { ArrowLeftIcon, ArrowRightIcon, VideoIcon } from "lucide-react"
import { cn } from "cn"

import { Slider } from "@/components/ui/slider"
import { fileUrl, opt, shown, type Field } from "@/lib/api"
import { Chips, Label } from "@/components/chips"
import { FilmStrip } from "@/components/cut"

// Extend in clicks: which side gets the new shot (each card shows the frame it hooks on), how long it is, a timeline of
// the result to scale, and how it joins. Nothing is dragged
export function ExtendPanel({
  video,
  fields,
  join,
  durations,
  duration,
  onFields,
  onDuration,
}: {
  video?: string
  fields: Record<string, string>
  join?: Field
  durations: number[]
  duration?: number
  onFields: (patch: Record<string, string>) => void
  onDuration: (d: number) => void
}) {
  const [length, setLength] = useState(0)
  const prequel = fields.direction === "prequel"
  const added = durations.includes(duration ?? -1) ? duration! : durations.includes(5) ? 5 : durations[0]
  const src = video && fileUrl(video)
  const total = length + (added ?? 0)

  const card = (side: "prequel" | "sequel") => {
    const on = (side === "prequel") === prequel
    return (
      <button
        key={side}
        type="button"
        aria-pressed={on}
        onClick={() => onFields({ direction: side })}
        className={cn("flex flex-col overflow-hidden rounded-lg border text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50", on ? "border-space ring-1 ring-space" : "hover:border-foreground/30")}
      >
        <span className="relative grid aspect-video place-items-center bg-black/85 text-white/40">
          {src ? (
            <video
              src={src}
              muted
              playsInline
              preload="metadata"
              className="size-full object-cover"
              onLoadedMetadata={(e) => {
                const v = e.currentTarget
                if (!Number.isFinite(v.duration)) return
                setLength(v.duration)
                v.currentTime = side === "prequel" ? 0.05 : Math.max(0, v.duration - 0.05)
              }}
            />
          ) : (
            <VideoIcon className="size-5" />
          )}
          <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white">{side === "prequel" ? "First frame" : "Last frame"}</span>
        </span>
        <span className="flex flex-col gap-0.5 px-2.5 py-2">
          <span className={cn("flex items-center gap-1 text-sm font-medium", on && "text-space")}>
            {side === "prequel" ? <ArrowLeftIcon className="size-3.5" /> : null}
            {side === "prequel" ? "Before" : "After"}
            {side === "sequel" ? <ArrowRightIcon className="size-3.5" /> : null}
          </span>
          <span className="text-xs text-muted-foreground">{side === "prequel" ? "The new shot ends on this frame" : "The new shot starts from this frame"}</span>
        </span>
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>Direction</Label>
        <div className="grid grid-cols-2 gap-2">{(["prequel", "sequel"] as const).map(card)}</div>
      </div>

      {durations.length > 0 && (
        <div>
          <Label hint="the new shot">Added length</Label>
          {durations.length > 6 ? (
            <div className="flex items-center gap-3">
              <Slider min={durations[0]} max={durations.at(-1)} step={1} value={[added]} onValueChange={([d]) => onDuration(d)} aria-label="Added length" />
              <span className="w-10 text-right text-sm tabular-nums">{added} s</span>
            </div>
          ) : (
            <Chips options={durations} value={added} label={(d) => `${d} s`} onChange={onDuration} />
          )}
        </div>
      )}

      {src && length > 0 && (
        <div>
          <Label hint={`${length.toFixed(1)} s + ${added} s = ${total.toFixed(1)} s`}>Result</Label>
          <div className={cn("flex h-12 gap-1", prequel && "flex-row-reverse")} role="img" aria-label={`Your video, ${length.toFixed(1)} s, with ${added} s added ${prequel ? "before" : "after"}`}>
            <div className="relative min-w-0 overflow-hidden rounded-md bg-black/40" style={{ flex: length }}>
              <FilmStrip src={src} duration={length} />
              <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[11px] text-white tabular-nums">{length.toFixed(1)} s</span>
            </div>
            <div className="grid min-w-12 place-items-center rounded-md border-2 border-dashed border-space/70 bg-[repeating-linear-gradient(45deg,color-mix(in_oklch,var(--color-space)_22%,transparent)_0_2px,transparent_2px_8px)] text-xs font-semibold text-space tabular-nums" style={{ flex: added }}>
              +{added} s
            </div>
          </div>
        </div>
      )}

      {join && (
        <div>
          <Label>Join</Label>
          <Chips className="grid grid-cols-2" options={(join.options ?? []).map((o) => opt(o).value)} value={fields.join ?? String(join.default ?? "")} label={(v) => shown(join, v)} onChange={(v) => onFields({ join: v })} />
        </div>
      )}
    </div>
  )
}
