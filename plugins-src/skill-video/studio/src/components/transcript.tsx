import { Fragment, useEffect, useRef, useState } from "react"
import { LocateFixedIcon } from "lucide-react"

import { Mark } from "@/components/lanes"
import { Thumb } from "@/components/video"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { minutes, type Marks, type Part, type Range, type Strip, type VWord } from "@/lib/studio"
import { cn } from "@/lib/utils"

const overlaps = (w: VWord, r: Range) => w.v1 > r.t0 && w.v0 < r.t1
// a pause that starts a paragraph (source seconds): a shorter one after the end of a sentence
const pause = (a: VWord, b: VWord) => b.t0 - a.t1 >= (/[.!?…]["»”)]*$/.test(a.w) ? 0.3 : 0.8)
// the sequence playing at t, -1 before the first
const seqAt = (seqs: Part[] | undefined, t: number) => seqs?.findLastIndex((s) => s.t0 <= t + 0.01) ?? -1
const span = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k)

// Follows the playback until it is scrolled by hand. Speech: paragraphs cut at the pauses; a click on a word seeks
// there, a drag across words selects their range, a double-click corrects the word (emptied, it goes). Without
// speech the transcript is what the video shows, one line per moment with its frame: a
// click selects the moment, a drag several, a double-click corrects its text. Rows sit under their sequence, whose
// name selects all of it. What open comments cover carries their number (#2): a click on it shows them.
export function Transcript({
  words,
  sequences,
  strip,
  time,
  range,
  marked,
  onSeek,
  onRange,
  onFix,
}: {
  words: VWord[]
  sequences?: Part[]
  // the version's thumbnails, for the lines of what the video shows
  strip?: Strip
  time: number
  range: Range | null
  // the open comments over a word or a line
  marked: (w: VWord) => Marks
  onSeek: (t: number) => void
  onRange: (r: Range | null) => void
  onFix?: (line: VWord, to: string) => void
}) {
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null)
  // scrolled by hand: the playback is no longer followed
  const [free, setFree] = useState(false)
  // the line being corrected
  const [editing, setEditing] = useState<number | null>(null)
  const currentEl = useRef<HTMLElement | null>(null)
  const lines = !!words[0]?.screen
  const current = words.findLastIndex((w) => w.v0 <= time)
  const follow = (i: number) => (i === current ? (el: HTMLElement | null) => void (currentEl.current = el) : undefined)
  const selected = range && range.t1 > range.t0 ? range : null
  const marks = words.map(marked)

  useEffect(() => {
    const el = currentEl.current, view = el?.closest("[data-slot=scroll-area-viewport]")
    if (drag || free || !el || !view) return
    // not returned: Chrome's scrollIntoView gives a promise, which React would take for the effect's cleanup
    if (lines) {
      el.scrollIntoView({ block: "center", behavior: "smooth" })
      return
    }
    // the speech holds still while the word walks along it, clear of the fades; past them, its line goes up to a third
    const r = el.getBoundingClientRect(), v = view.getBoundingClientRect()
    if (r.top < v.top + 24 || r.bottom > v.bottom - 32) view.scrollBy({ top: r.top - v.top - v.height / 3, behavior: "smooth" })
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
        marked(words[a])?.onClick()
      } else {
        // a line is a moment: one click selects it
        onRange({ t0: words[a].v0, t1: words[b].v1 })
        onSeek(words[a].v0)
      }
      setDrag(null)
    }
    window.addEventListener("pointerup", up)
    return () => window.removeEventListener("pointerup", up)
  }, [drag, words, lines, marked, onRange, onSeek])

  const sel = words.map((w, i) =>
    drag ? i >= Math.min(drag.a, drag.b) && i <= Math.max(drag.a, drag.b) : !!selected && overlaps(w, selected)
  )
  const press = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    ;(document.activeElement as HTMLElement | null)?.blur()
    setFree(false)
    setDrag({ a: i, b: i })
  }

  // rows: one per line, or the paragraphs of the speech, as [first, last] word; a sequence starts a new one
  const rows: [number, number][] = []
  words.forEach((w, i) => {
    const p = words[i - 1]
    if (!p || lines || pause(p, w) || seqAt(sequences, w.v0) !== seqAt(sequences, p.v0)) rows.push([i, i])
    else rows[rows.length - 1][1] = i
  })

  // the name of the sequence a row starts
  const header = (r: number) => {
    const s = seqAt(sequences, words[rows[r][0]].v0)
    if (s < 0 || (r > 0 && s === seqAt(sequences, words[rows[r - 1][0]].v0))) return null
    const q = sequences![s]
    // its own rows only: a line on screen through the transition belongs to the sequence before or after
    let e = r
    while (e + 1 < rows.length && seqAt(sequences, words[rows[e + 1][0]].v0) === s) e++
    const own = words.slice(rows[r][0], rows[e][1] + 1)
    return (
      <button
        className={cn(
          "sticky top-0 z-10 flex w-full items-center gap-2 bg-card px-2 pt-2 pb-1 text-left text-[11px] font-medium tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground",
          s === seqAt(sequences, time) && "text-foreground"
        )}
        title="Select this sequence"
        onClick={() => {
          onRange({ t0: own[0].v0, t1: Math.max(...own.map((w) => w.v1)) })
          onSeek(own[0].v0)
        }}
      >
        {q.name ?? "sequence"}
        <span className="font-mono font-normal tracking-normal text-muted-foreground/70 normal-case tabular-nums">
          {minutes(q.t0)} · {(q.t1 - q.t0).toFixed(1)} s
        </span>
      </button>
    )
  }
  // how far the line playing now has played
  const bar = (i: number) =>
    i === current && (
      <span
        className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 origin-left rounded-full bg-foreground/40"
        style={{ transform: `scaleX(${Math.min(Math.max((time - words[i].v0) / (words[i].v1 - words[i].v0 || 1), 0), 1)})` }}
      />
    )

  return (
    <>
      <ScrollArea className="h-full" onWheel={() => setFree(true)} onTouchMove={() => setFree(true)}>
        {lines ? (
          <div className="flex flex-col gap-px px-2 py-2 text-sm select-none @6xl:text-[15px]">
            {rows.map(([i], r) => {
              const w = words[i]
              return (
                <Fragment key={i}>
                  {header(r)}
                  <div
                    ref={follow(i)}
                    data-v0={w.v0}
                    data-v1={w.v1}
                    title={onFix ? "Double-click to correct the text" : undefined}
                    className={cn(
                      "relative flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60",
                      w.v0 > time && "text-muted-foreground",
                      // the moment playing now stands out
                      i === current && !sel[i] && "bg-foreground/10 font-medium text-foreground",
                      sel[i] && "bg-highlight/25 text-foreground"
                    )}
                    onPointerDown={press(i)}
                    onPointerEnter={() => drag && setDrag({ ...drag, b: i })}
                    onDoubleClick={() => onFix && setEditing(i)}
                  >
                    {/* with a frame, everything sits on its 32 px: one line of text is centered on it, a longer one starts at its top */}
                    <span className={cn("w-9 shrink-0 text-right font-mono text-xs leading-5 text-muted-foreground tabular-nums", strip && "leading-8", i === current && "text-highlight")}>
                      {minutes(w.v0)}
                    </span>
                    {/* the frame halfway through the line */}
                    {strip && (
                      <Thumb
                        strip={strip}
                        i={Math.min(Math.round((w.v0 + w.v1) / 2 / strip.every), strip.count - 1)}
                        height={32}
                        className="shrink-0 rounded-[3px] ring-1 ring-foreground/10"
                      />
                    )}
                    {editing === i ? (
                      <Textarea
                        autoFocus
                        defaultValue={w.w}
                        aria-label="The corrected text"
                        className={cn("min-h-0 flex-1 px-1.5 py-0 text-sm leading-5 md:text-sm", strip && "my-[5px]")}
                        onFocus={(e) => e.currentTarget.select()}
                        onPointerDown={(e) => e.stopPropagation()}
                        onBlur={() => setEditing(null)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditing(null)
                          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return
                          e.preventDefault()
                          const to = e.currentTarget.value.trim()
                          if (to && to !== w.w) onFix?.(w, to)
                          setEditing(null)
                        }}
                      />
                    ) : (
                      <span className={cn("flex flex-1 items-center leading-5", strip && "min-h-8")}>
                        <span>
                          {w.w.split(" · ").map((part, j) => (
                            <Fragment key={j}>
                              {j > 0 && <span className="px-1.5 text-muted-foreground/50">·</span>}
                              {part}
                            </Fragment>
                          ))}
                        </span>
                      </span>
                    )}
                    {marks[i] && <Mark marks={marks[i]} className={strip ? "mt-2" : "mt-0.5"} />}
                    {bar(i)}
                  </div>
                </Fragment>
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col px-2 py-2 text-sm select-none @3xl:text-[15px] @6xl:text-base">
            {rows.map(([first, last], r) => (
              <Fragment key={first}>
                {header(r)}
                <div className="flex items-baseline gap-2 px-2 py-1.5">
                  <span className={cn("w-9 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums", current >= first && current <= last && "text-highlight")}>
                    {minutes(words[first].v0)}
                  </span>
                  <p className="flex-1 leading-[1.9] tracking-wide">
                    {span(first, last).map((i) => (
                      <Fragment key={i}>
                        {editing === i ? (
                          <input
                            autoFocus
                            defaultValue={words[i].w}
                            aria-label="The corrected word"
                            className="rounded-md bg-background px-1 py-0.5 text-foreground ring-1 ring-highlight outline-none"
                            style={{ width: `${Math.max(4, words[i].w.length + 2)}ch` }}
                            onFocus={(e) => e.currentTarget.select()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onBlur={() => setEditing(null)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setEditing(null)
                              if (e.key !== "Enter" || e.nativeEvent.isComposing) return
                              e.preventDefault()
                              const to = e.currentTarget.value.trim()
                              if (to !== words[i].w) onFix?.(words[i], to)
                              setEditing(null)
                            }}
                          />
                        ) : (
                          <span
                            ref={follow(i)}
                            data-v0={words[i].v0}
                            data-v1={words[i].v1}
                            title={onFix ? "Double-click to correct the word" : undefined}
                            className={cn(
                              // no fade: while one fades out and the next fades in, two words look lit and the light seems to step back
                              "cursor-pointer rounded-md px-1 py-0.5 text-muted-foreground",
                              words[i].v1 <= time && "text-foreground",
                              marks[i] && "underline decoration-foreground/50 decoration-dotted decoration-2 underline-offset-[7px]",
                              // one band over the selection, spaces included
                              sel[i] && "rounded-none bg-highlight/40 text-foreground",
                              sel[i] && !sel[i - 1] && "rounded-l-md",
                              sel[i] && !sel[i + 1] && "rounded-r-md",
                              i === current && !sel[i] && "bg-foreground text-background"
                            )}
                            onPointerDown={press(i)}
                            onPointerEnter={() => drag && setDrag({ ...drag, b: i })}
                            onDoubleClick={() => onFix && setEditing(i)}
                          >
                            {words[i].w}
                          </span>
                        )}
                        {/* the number once, after the last word a comment covers */}
                        {marks[i] && marks[i + 1]?.label !== marks[i].label && <Mark marks={marks[i]} className="ml-1 align-[1px]" />}
                        <span className={cn(sel[i] && sel[i + 1] && "bg-highlight/40")}> </span>
                      </Fragment>
                    ))}
                  </p>
                </div>
              </Fragment>
            ))}
          </div>
        )}
      </ScrollArea>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-linear-to-b from-card to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-linear-to-t from-card to-transparent" />
      {free && current >= 0 && (
        <Button
          variant="secondary"
          size="xs"
          className="absolute bottom-2 left-1/2 z-20 -translate-x-1/2 shadow-md"
          onClick={() => {
            setFree(false)
            currentEl.current?.scrollIntoView({ block: "center", behavior: "smooth" })
          }}
        >
          <LocateFixedIcon data-icon="inline-start" />
          Back to playback
        </Button>
      )}
    </>
  )
}
