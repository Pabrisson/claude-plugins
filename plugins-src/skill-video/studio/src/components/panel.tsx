import { useRef, useState, type ReactNode } from "react"
import { AudioWaveformIcon, InfoIcon, Maximize2Icon, MessageSquareTextIcon, Minimize2Icon, ScissorsIcon, XIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Kbd } from "@/components/ui/kbd"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { clock, type Range } from "@/lib/studio"
import { cn } from "@/lib/utils"

export type Tab = { value: string; label: string; badge?: string; info: string }

// the card's height, dragged or expanded, kept across reloads
const HEIGHT = "video-editor.transcript-height"
const stored = () => {
  try {
    return Number(localStorage.getItem(HEIGHT)) || null
  } catch {
    return null
  }
}

// The card under the player: the transcript and the sound, one tab each. The selection's actions sit in the header,
// always in view; the top edge drags the card taller.
export function Panel({
  tabs,
  tab,
  range,
  sounds,
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
  sounds: number
  onTab: (tab: string) => void
  onCut: () => void
  onComment: () => void
  onClear: () => void
  className?: string
  children: ReactNode
}) {
  const [height, setHeight] = useState<number | null>(stored)
  const card = useRef<HTMLDivElement>(null)
  const selected = range && range.t1 > range.t0 ? range : null
  const current = tabs.find((t) => t.value === tab) ?? tabs[0]

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
        </CardTitle>
        <CardAction className="flex items-center gap-1">
          {selected && (
            <span className="mr-1 font-mono text-xs text-muted-foreground tabular-nums">
              {clock(selected.t0)} → {clock(selected.t1)}
            </span>
          )}
          {sounds > 0 && (
            <Badge variant="outline" className="mr-1 h-5 rounded-md border-highlight/30 bg-highlight/10 text-highlight">
              <AudioWaveformIcon data-icon="inline-start" />
              {sounds} sound{sounds > 1 ? "s" : ""}
            </Badge>
          )}
          {selected && (
            <Button variant="ghost" size="xs" className="text-destructive hover:text-destructive" onClick={onCut}>
              <ScissorsIcon data-icon="inline-start" />
              Cut <Kbd>⌫</Kbd>
            </Button>
          )}
          {(selected || sounds > 0) && (
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
