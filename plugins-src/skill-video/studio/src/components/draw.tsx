import { useEffect, useRef, useState, type RefObject } from "react"
import {
  ArrowUpRightIcon,
  CircleIcon,
  PenLineIcon,
  SquareIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type Tool = "pen" | "ellipse" | "arrow" | "rect"
// points in 0..1 of the video frame, so the drawing survives a resize
type Shape = { tool: Tool; color: string; points: [number, number][] }

const TOOLS = [
  { value: "pen", label: "Pencil", icon: PenLineIcon },
  { value: "ellipse", label: "Ellipse", icon: CircleIcon },
  { value: "arrow", label: "Arrow", icon: ArrowUpRightIcon },
  { value: "rect", label: "Rectangle", icon: SquareIcon },
] as const
const COLORS = [
  { value: "#ef4444", label: "Red" },
  { value: "#eab308", label: "Yellow" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#ffffff", label: "White" },
]

function paint(ctx: CanvasRenderingContext2D, shapes: Shape[], w: number, h: number) {
  const lw = Math.max(2, Math.min(w, h) * 0.006)
  ctx.lineWidth = lw
  ctx.lineCap = ctx.lineJoin = "round"
  for (const { tool, color, points } of shapes) {
    const [[x0, y0], [x1, y1]] = [points[0], points.at(-1)!].map(([x, y]) => [x * w, y * h])
    ctx.strokeStyle = color
    ctx.beginPath()
    if (tool === "pen") points.forEach(([x, y], i) => (i ? ctx.lineTo(x * w, y * h) : ctx.moveTo(x * w, y * h)))
    if (tool === "rect") ctx.rect(x0, y0, x1 - x0, y1 - y0)
    if (tool === "ellipse") ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2)
    if (tool === "arrow") {
      const a = Math.atan2(y1 - y0, x1 - x0), head = lw * 5
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      for (const side of [-1, 1]) {
        ctx.moveTo(x1, y1)
        ctx.lineTo(x1 - head * Math.cos(a + side * 0.5), y1 - head * Math.sin(a + side * 0.5))
      }
    }
    ctx.stroke()
  }
}

// Canvas over the paused video plus its floating toolbar. Attach exports the frame with the drawing as a PNG.
export function DrawLayer({
  video,
  onClose,
  onAttach,
}: {
  video: RefObject<HTMLVideoElement | null>
  onClose: () => void
  onAttach: (png: Blob) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [shapes, setShapes] = useState<Shape[]>([])
  const [tool, setTool] = useState<Tool>("pen")
  const [color, setColor] = useState(COLORS[0].value)
  const drawing = useRef(false)

  useEffect(() => {
    const el = canvas.current!
    const draw = () => {
      const r = devicePixelRatio
      el.width = el.clientWidth * r
      el.height = el.clientHeight * r
      paint(el.getContext("2d")!, shapes, el.width, el.height)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(el)
    return () => ro.disconnect()
  }, [shapes])

  const at = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]
  }

  function attach() {
    const v = video.current!, out = document.createElement("canvas")
    out.width = v.videoWidth
    out.height = v.videoHeight
    const ctx = out.getContext("2d")!
    ctx.drawImage(v, 0, 0)
    paint(ctx, shapes, out.width, out.height)
    out.toBlob((png) => png && onAttach(png), "image/png")
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement) return
      if (e.key === "Enter") attach()
      if (e.key === "z" && (e.metaKey || e.ctrlKey)) setShapes((s) => s.slice(0, -1))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  })

  return (
    <>
      <canvas
        ref={canvas}
        className="absolute inset-0 size-full cursor-crosshair touch-none"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drawing.current = true
          setShapes((s) => [...s, { tool, color, points: [at(e), at(e)] }])
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return
          const p = at(e)
          setShapes((s) => {
            const last = s.at(-1)!
            const points = tool === "pen" ? [...last.points, p] : [last.points[0], p]
            return [...s.slice(0, -1), { ...last, points }]
          })
        }}
        onPointerUp={() => (drawing.current = false)}
      />
      <div className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-foreground/10">
        <ToggleGroup type="single" value={tool} onValueChange={(v) => v && setTool(v as Tool)}>
          {TOOLS.map(({ value, label, icon: Icon }) => (
            <Tooltip key={value}>
              <TooltipTrigger asChild>
                <ToggleGroupItem value={value} aria-label={label} className="data-[state=on]:text-highlight">
                  <Icon />
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <ToggleGroup type="single" value={color} onValueChange={(v) => v && setColor(v)}>
          {COLORS.map(({ value, label }) => (
            <ToggleGroupItem key={value} value={value} aria-label={label}>
              <span
                className="size-4 rounded-full ring-2 ring-transparent ring-offset-2 ring-offset-popover group-data-[state=on]/toggle:ring-foreground/80"
                style={{ background: value }}
              />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Undo" disabled={!shapes.length} onClick={() => setShapes((s) => s.slice(0, -1))}>
              <Undo2Icon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo (⌘Z)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
              <XIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Close (Esc)</TooltipContent>
        </Tooltip>
        <Button size="sm" className="ml-1" onClick={attach}>
          Attach <Kbd>↵</Kbd>
        </Button>
      </div>
    </>
  )
}
