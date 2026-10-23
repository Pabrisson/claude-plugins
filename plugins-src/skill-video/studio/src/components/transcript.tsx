import { Fragment, useEffect, useRef, useState } from "react"
import { InfoIcon, Maximize2Icon, MessageSquareTextIcon, Minimize2Icon, ScissorsIcon, XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Kbd } from "@/components/ui/kbd"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { clock, minutes, type Range, type VWord } from "@/lib/studio"
import { cn } from "@/lib/utils"

const overlaps = (w: VWord, r: Range) => w.v1 > r.t0 && w.v0 < r.t1
// the card's height, dragged or expanded, kept across reloads
const HEIGHT = "video-editor.transcript-height"
const stored = () => {
  try {
    return Number(localStorage.getItem(HEIGHT)) || null
  } catch {
    return null
  }
}

// Follows the playback. Speech: a click on a word seeks there, a drag across words selects their range. Without
// speech the transcript is what the video shows, one line per moment: a click selects the moment, a drag several.
// The selection's actions sit in the header, always in view; the top edge drags the card taller.
export function Transcript({
  words,
  time,
  range,
  marked,
  onSeek,
  onRange,
  onCut,
  onComment,
  className,
}: {
  words: VWord[]
  time: number
  range: Range | null
  marked: Range[]
  onSeek: (t: number) => void
  onRange: (r: Range | null) => void
  onCut: () => void
  onComment: () => void
  className?: string
}) {
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null)
  const [height, setHeight] = useState<number | null>(stored)
  const card = useRef<HTMLDivElement>(null)
  const currentEl = useRef<HTMLElement | null>(null)
  const lines = !!words[0]?.screen
  const current = words.findLastIndex((w) => w.v0 <= time)
  const follow = (i: number) => (i === current ? (el: HTMLElement | null) => void (currentEl.current = el) : undefined)
  const selected = range && range.t1 > range.t0 ? range : null

  const keep = (h: number | null) => {
    setHeight(h)
    try {
      if (h) localStorage.setItem(HEIGHT, String(Math.round(h)))
      else localStorage.removeItem(HEIGHT)
    } catch {
      // private window: the size just lasts for this visit
    }
  }
  // the player keeps at least 20rem (video, timeline, controls)
  const room = () => (card.current?.parentElement?.clientHeight ?? 800) - 320
  const resize = (e: React.PointerEvent) => {
    e.preventDefault()
    const y0 = e.clientY, h0 = card.current?.offsetHeight ?? 200
    const move = (m: PointerEvent) => keep(Math.max(120, Math.min(room(), h0 + y0 - m.clientY)))
    const up = () => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", up)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", up)
  }

  useEffect(() => {
    if (!drag) currentEl.current?.scrollIntoView({ block: "center", behavior: "smooth" })
    // follow the word, not every frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  useEffect(() => {
    if (!drag) return
    const up = () => {
      const [a, b] = [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)]
      if (a === b && !lines) {
        onRange(null)
        onSeek(words[a].v0)
      } else {
        // a line is a moment: one click selects it
        onRange({ t0: words[a].v0, t1: words[b].v1 })
        onSeek(words[a].v0)
      }
      setDrag(null)
    }
    window.addEventListener("pointerup", up)
    return () => window.removeEventListener("pointerup", up)
  }, [drag, words, lines, onRange, onSeek])

  const sel = words.map((w, i) =>
    drag ? i >= Math.min(drag.a, drag.b) && i <= Math.max(drag.a, drag.b) : !!selected && overlaps(w, selected)
  )
  const press = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    ;(document.activeElement as HTMLElement | null)?.blur()
    setDrag({ a: i, b: i })
  }

  return (
    <Card
      ref={card}
      size="sm"
      className={cn("relative min-h-0 gap-1", className)}
      style={height ? { height, maxHeight: "calc(100% - 20rem)" } : undefined}
    >
      <div
        className="absolute inset-x-0 top-0 z-10 flex h-3 cursor-row-resize justify-center"
        onPointerDown={resize}
        onDoubleClick={() => keep(null)}
        title="Drag to resize, double-click to reset"
      >
        <span className="mt-1 h-1 w-10 rounded-full bg-border transition-colors hover:bg-muted-foreground" />
      </div>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xs">
          Transcript
          {lines && (
            <Badge variant="secondary" className="font-normal">
              On screen · {words.length}
            </Badge>
          )}
        </CardTitle>
        <CardAction className="flex items-center gap-1">
          {selected && (
            <>
              <span className="mr-1 font-mono text-xs text-muted-foreground tabular-nums">
                {clock(selected.t0)} → {clock(selected.t1)}
              </span>
              <Button variant="ghost" size="xs" className="text-destructive hover:text-destructive" onClick={onCut}>
                <ScissorsIcon data-icon="inline-start" />
                Cut <Kbd>⌫</Kbd>
              </Button>
              <Button variant="secondary" size="xs" onClick={onComment}>
                <MessageSquareTextIcon data-icon="inline-start" />
                Comment <Kbd>C</Kbd>
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label="Clear the selection" onClick={() => onRange(null)}>
                <XIcon />
              </Button>
            </>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={height ? "Reset the size" : "Expand"} onClick={() => keep(height ? null : room())}>
                {height ? <Minimize2Icon /> : <Maximize2Icon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{height ? "Reset the size" : "Expand"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <InfoIcon className="size-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {lines
                ? "What the video shows, moment by moment. Click a line to select it, drag across lines to select several, then comment."
                : "Click a word to jump there. Drag across words to select their range, then cut it or comment on it."}
            </TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>
      <CardContent className="relative min-h-0 flex-1 px-0">
        <ScrollArea className="h-full">
          {lines ? (
            <div className="flex flex-col gap-px px-2 py-2 text-sm select-none @6xl:text-[15px]">
              {words.map((w, i) => (
                <div
                  key={i}
                  ref={follow(i)}
                  className={cn(
                    "flex cursor-pointer gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60",
                    w.v0 > time && "text-muted-foreground",
                    // the moment playing now stands out
                    i === current && !sel[i] && "bg-foreground/10 font-medium text-foreground",
                    sel[i] && "bg-highlight/25 text-foreground"
                  )}
                  onPointerDown={press(i)}
                  onPointerEnter={() => drag && setDrag({ ...drag, b: i })}
                >
                  <span className={cn("w-9 shrink-0 text-right font-mono text-xs leading-5 text-muted-foreground tabular-nums", i === current && "text-highlight")}>
                    {minutes(w.v0)}
                  </span>
                  {/* its own slot, as far from the time as from the text */}
                  <span className="flex h-5 w-1.5 shrink-0 items-center">
                    {marked.some((r) => overlaps(w, r)) && <span className="size-1.5 rounded-full bg-highlight" />}
                  </span>
                  <span className="leading-5">
                    {w.w.split(" · ").map((part, j) => (
                      <Fragment key={j}>
                        {j > 0 && <span className="px-1.5 text-muted-foreground/50">·</span>}
                        {part}
                      </Fragment>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="px-4 py-2 text-sm leading-[1.9] tracking-wide select-none @3xl:text-[15px] @6xl:text-base">
              {words.map((w, i) => (
                <Fragment key={i}>
                  <span
                    ref={follow(i)}
                    className={cn(
                      "cursor-pointer rounded-md px-1 py-0.5 text-muted-foreground transition-colors",
                      w.v1 <= time && "text-foreground",
                      marked.some((r) => overlaps(w, r)) && "underline decoration-highlight decoration-dotted decoration-2 underline-offset-[7px]",
                      // one band over the selection, spaces included
                      sel[i] && "rounded-none bg-highlight/40 text-foreground",
                      sel[i] && !sel[i - 1] && "rounded-l-md",
                      sel[i] && !sel[i + 1] && "rounded-r-md",
                      i === current && !sel[i] && "bg-foreground text-background"
                    )}
                    onPointerDown={press(i)}
                    onPointerEnter={() => drag && setDrag({ ...drag, b: i })}
                  >
                    {w.w}
                  </span>
                  <span className={cn(sel[i] && sel[i + 1] && "bg-highlight/40")}> </span>
                </Fragment>
              ))}
            </p>
          )}
        </ScrollArea>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-linear-to-b from-card to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-card to-transparent" />
      </CardContent>
    </Card>
  )
}
