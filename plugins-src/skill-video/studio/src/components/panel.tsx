import { useRef, useState, type ReactNode } from "react"
import { InfoIcon, PlayIcon, Maximize2Icon, MessageSquareTextIcon, Minimize2Icon, ScissorsIcon, XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Kbd } from "@/components/ui/kbd"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { clock, type Range } from "@/lib/studio"
import { cn } from "@/lib/utils"

// actions: the tab's own buttons, in the header while it is shown
export type Tab = { value: string; label: string; badge?: string; info: string; actions?: ReactNode }

// a size the user dragged or expanded, kept across reloads; null: the layout's default
export function useStoredSize(key: string) {
  const [size, setSize] = useState<number | null>(() => {
    try {
      return Number(localStorage.getItem(key)) || null
    } catch {
      return null
    }
  })
  const keep = (s: number | null) => {
    setSize(s)
    try {
      if (s) localStorage.setItem(key, String(Math.round(s)))
      else localStorage.removeItem(key)
    } catch {
      // private window: the size just lasts for this visit
    }
  }
  return [size, keep] as const
}

// follows a drag from `e` until the pointer is released: `move` gets how far it went (px)
export function follow(e: React.PointerEvent, move: (dx: number, dy: number) => void) {
  e.preventDefault()
  const x0 = e.clientX, y0 = e.clientY
  const onMove = (m: PointerEvent) => move(m.clientX - x0, m.clientY - y0)
  const up = () => {
    window.removeEventListener("pointermove", onMove)
    window.removeEventListener("pointerup", up)
  }
  window.addEventListener("pointermove", onMove)
  window.addEventListener("pointerup", up)
}

// The card under the player: the transcript and the sound, one tab each. The selection's actions sit in the header,
// always in view; the top edge drags the card taller.
export function Panel({
  tabs,
  tab,
  range,
  picked,
  status,
  onTab,
  onCut,
  onComment,
  onClear,
  className,
  children,
}: {
  tabs: Tab[]
  tab: string
  range: Range | null
  // what is picked for the next comment ("2 sounds · 1 visual"), empty when nothing
  picked: string
  // what the tab follows while it plays ("the reveal: Figural")
  status?: string
  onTab: (tab: string) => void
  onCut: () => void
  onComment: () => void
  onClear: () => void
  className?: string
  children: ReactNode
}) {
  const [height, keep] = useStoredSize("video-editor.transcript-height")
  const card = useRef<HTMLDivElement>(null)
  const selected = range && range.t1 > range.t0 ? range : null
  const current = tabs.find((t) => t.value === tab) ?? tabs[0]

  // the player keeps at least 20rem (video, timeline, controls)
  const room = () => (card.current?.parentElement?.clientHeight ?? 800) - 320
  const resize = (e: React.PointerEvent) => {
    const h0 = card.current?.offsetHeight ?? 200
    follow(e, (_, dy) => keep(Math.max(120, Math.min(room(), h0 - dy))))
  }

  return (
    <Card
      ref={card}
      size="sm"
      className={cn("relative min-h-0 gap-1", className)}
      style={height ? { height, maxHeight: "calc(100% - 20rem)" } : undefined}
    >
      <div
        className="absolute inset-x-0 top-0 z-30 flex h-3 cursor-row-resize justify-center"
        onPointerDown={resize}
        onDoubleClick={() => keep(null)}
        title="Drag to resize, double-click to reset"
      >
        <span className="mt-1 h-1 w-10 rounded-full bg-border transition-colors hover:bg-muted-foreground" />
      </div>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-xs">
          {tabs.length > 1 ? (
            <Tabs value={current.value} onValueChange={onTab}>
              <TabsList className="h-7">
                {tabs.map((t) => (
                  <TabsTrigger key={t.value} value={t.value} className="text-xs">
                    {t.label}
                    {t.badge && <span className="text-muted-foreground tabular-nums">{t.badge}</span>}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          ) : (
            <>
              {current.label}
              {current.badge && (
                <Badge variant="secondary" className="font-normal">
                  {current.badge}
                </Badge>
              )}
            </>
          )}
          {status && (
            <span className="flex min-w-0 items-center gap-1 truncate font-normal text-muted-foreground">
              <PlayIcon className="size-3 shrink-0 fill-current" />
              {status}
            </span>
          )}
        </CardTitle>
        <CardAction className="flex items-center gap-1">
          {selected && (
            <span className="mr-1 font-mono text-xs text-muted-foreground tabular-nums">
              {clock(selected.t0)} → {clock(selected.t1)}
            </span>
          )}
          {picked && (
            <Badge variant="outline" className="mr-1 h-5 rounded-md border-highlight/30 bg-highlight/10 text-highlight">
              {picked}
            </Badge>
          )}
          {selected && (
            <Button variant="ghost" size="xs" className="text-destructive hover:text-destructive" onClick={onCut}>
              <ScissorsIcon data-icon="inline-start" />
              Cut <Kbd>⌫</Kbd>
            </Button>
          )}
          {(selected || picked) && (
            <>
              <Button variant="secondary" size="xs" onClick={onComment}>
                <MessageSquareTextIcon data-icon="inline-start" />
                Comment <Kbd>C</Kbd>
              </Button>
              <Button variant="ghost" size="icon-xs" aria-label="Clear the selection" onClick={onClear}>
                <XIcon />
              </Button>
            </>
          )}
          {current.actions}
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
            <TooltipContent className="max-w-64">{current.info}</TooltipContent>
          </Tooltip>
        </CardAction>
      </CardHeader>
      <CardContent className="relative min-h-0 flex-1 px-0">{children}</CardContent>
    </Card>
  )
}
