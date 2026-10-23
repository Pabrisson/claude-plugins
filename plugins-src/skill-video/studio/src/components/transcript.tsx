import { Fragment, useEffect, useRef, useState } from "react"
import { InfoIcon, MessageSquareTextIcon, ScissorsIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Kbd } from "@/components/ui/kbd"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { Range, VWord } from "@/lib/studio"
import { cn } from "@/lib/utils"

const overlaps = (w: VWord, r: Range) => w.v1 > r.t0 && w.v0 < r.t1

// Follows the playback. A click on a word seeks there, a drag across words selects their range.
export function Transcript({
  words,
  time,
  range,
  marked,
  canCut,
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
  canCut: boolean
  onSeek: (t: number) => void
  onRange: (r: Range | null) => void
  onCut: () => void
  onComment: () => void
  className?: string
}) {
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null)
  const current = words.findLastIndex((w) => w.v0 <= time)
  const currentEl = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!drag) currentEl.current?.scrollIntoView({ block: "center", behavior: "smooth" })
    // follow the word, not every frame
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  useEffect(() => {
    if (!drag) return
    const up = () => {
      const [a, b] = [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)]
      if (a === b) {
        onRange(null)
        onSeek(words[a].v0)
      } else onRange({ t0: words[a].v0, t1: words[b].v1 })
      setDrag(null)
    }
    window.addEventListener("pointerup", up)
    return () => window.removeEventListener("pointerup", up)
  }, [drag, words, onRange, onSeek])

  const sel = words.map((w, i) =>
    drag ? i >= Math.min(drag.a, drag.b) && i <= Math.max(drag.a, drag.b) : !!range && range.t1 > range.t0 && overlaps(w, range)
  )
  const firstSelected = drag ? -1 : sel.indexOf(true)

  return (
    <Card size="sm" className={cn("min-h-0 gap-1", className)}>
      <CardHeader>
        <CardTitle className="text-xs">Transcript</CardTitle>
        <CardAction>
          <Tooltip>
            <TooltipTrigger asChild>
              <InfoIcon className="size-3.5 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              Click a word to jump there. Drag across words to select their range, then cut it or comment on it.
            </TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>
      <CardContent className="relative min-h-0 flex-1 px-0">
        <ScrollArea className="h-full">
          <p className="px-4 py-2 text-sm leading-[1.9] tracking-wide select-none @3xl:text-[15px] @6xl:text-base">
            {words.map((w, i) => (
              <Fragment key={i}>
                <span
                  ref={i === current ? currentEl : undefined}
                  className={cn(
                    "relative cursor-pointer rounded-md px-1 py-0.5 text-muted-foreground transition-colors",
                    w.v1 <= time && "text-foreground",
                    marked.some((r) => overlaps(w, r)) && "underline decoration-highlight decoration-dotted decoration-2 underline-offset-[7px]",
                    // one band over the selection, spaces included
                    sel[i] && "rounded-none bg-highlight/40 text-foreground",
                    sel[i] && !sel[i - 1] && "rounded-l-md",
                    sel[i] && !sel[i + 1] && "rounded-r-md",
                    i === current && !sel[i] && "bg-foreground text-background"
                  )}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    ;(document.activeElement as HTMLElement | null)?.blur()
                    setDrag({ a: i, b: i })
                  }}
                  onPointerEnter={() => drag && setDrag({ ...drag, b: i })}
                >
                  {w.w}
                  {i === firstSelected && (
                    <span
                      className="absolute top-full left-0 z-10 mt-2 flex items-center gap-1 rounded-lg bg-popover p-1 text-sm tracking-normal whitespace-nowrap text-popover-foreground shadow-lg ring-1 ring-foreground/10"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      {canCut && (
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onCut}>
                          <ScissorsIcon data-icon="inline-start" />
                          Cut <Kbd>⌫</Kbd>
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={onComment}>
                        <MessageSquareTextIcon data-icon="inline-start" />
                        Comment <Kbd>C</Kbd>
                      </Button>
                    </span>
                  )}
                </span>
                <span className={cn(sel[i] && sel[i + 1] && "bg-highlight/40")}> </span>
              </Fragment>
            ))}
          </p>
        </ScrollArea>
        <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-linear-to-b from-card to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-card to-transparent" />
      </CardContent>
    </Card>
  )
}
