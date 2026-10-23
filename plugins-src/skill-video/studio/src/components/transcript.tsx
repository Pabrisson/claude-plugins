import { Fragment, useEffect, useRef, useState } from "react"

import { ScrollArea } from "@/components/ui/scroll-area"
import { minutes, type Range, type VWord } from "@/lib/studio"
import { cn } from "@/lib/utils"

const overlaps = (w: VWord, r: Range) => w.v1 > r.t0 && w.v0 < r.t1

// Follows the playback. Speech: a click on a word seeks there, a drag across words selects their range. Without
// speech the transcript is what the video shows, one line per moment: a click selects the moment, a drag several.
export function Transcript({
  words,
  time,
  range,
  marked,
  onSeek,
  onRange,
}: {
  words: VWord[]
  time: number
  range: Range | null
  marked: Range[]
  onSeek: (t: number) => void
  onRange: (r: Range | null) => void
}) {
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null)
  const currentEl = useRef<HTMLElement | null>(null)
  const lines = !!words[0]?.screen
  const current = words.findLastIndex((w) => w.v0 <= time)
  const follow = (i: number) => (i === current ? (el: HTMLElement | null) => void (currentEl.current = el) : undefined)
  const selected = range && range.t1 > range.t0 ? range : null

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
    <>
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
    </>
  )
}
