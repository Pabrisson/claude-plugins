import { useEffect, useRef, useState } from "react"
import { ArrowUpRightIcon, CircleIcon, PenLineIcon, SquareIcon, Undo2Icon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

// the review studio's drawing tools (video-editor's draw.tsx), over an image instead of a paused video
type Tool = "pen" | "ellipse" | "arrow" | "rect"
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
  const lw = Math.max(3, Math.min(w, h) * 0.01)
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

// Draw on an image, then save it with the drawing as a PNG
export function SketchDialog({
  src,
  open,
  onClose,
  onSave,
}: {
  src: string | null
  open: boolean
  onClose: () => void
  onSave: (png: Blob) => void
}) {
  const img = useRef<HTMLImageElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [shapes, setShapes] = useState<Shape[]>([])
  const [tool, setTool] = useState<Tool>("pen")
  const [color, setColor] = useState(COLORS[0].value)
  const drawing = useRef(false)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const draw = () => {
      el.width = el.clientWidth * devicePixelRatio
      el.height = el.clientHeight * devicePixelRatio
      paint(el.getContext("2d")!, shapes, el.width, el.height)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(el)
    return () => ro.disconnect()
  }, [shapes, open])

  const at = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect()
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]
  }

  function save() {
    const i = img.current!, out = document.createElement("canvas")
    out.width = i.naturalWidth
    out.height = i.naturalHeight
    const ctx = out.getContext("2d")!
    ctx.drawImage(i, 0, 0)
    paint(ctx, shapes, out.width, out.height)
    out.toBlob((png) => png && onSave(png), "image/png")
    setShapes([])
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(1100px,calc(100%-2rem))] sm:max-w-[min(1100px,calc(100%-2rem))]">
        <DialogTitle>Mark the area</DialogTitle>
        <DialogDescription>Draw over what should change. The marks are sent with the image, the model edits that area only.</DialogDescription>
        <div className="flex flex-wrap items-center gap-1">
          <ToggleGroup type="single" value={tool} onValueChange={(v) => v && setTool(v as Tool)}>
            {TOOLS.map(({ value, label, icon: Icon }) => (
              <ToggleGroupItem key={value} value={value} aria-label={label} title={label}>
                <Icon />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ToggleGroup type="single" value={color} onValueChange={(v) => v && setColor(v)}>
            {COLORS.map(({ value, label }) => (
              <ToggleGroupItem key={value} value={value} aria-label={label} title={label}>
                <span className="size-4 rounded-full ring-1 ring-foreground/30" style={{ background: value }} />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <Button variant="ghost" size="icon" aria-label="Undo" title="Undo" disabled={!shapes.length} onClick={() => setShapes((s) => s.slice(0, -1))}>
            <Undo2Icon />
          </Button>
        </div>
        <div className="relative mx-auto w-fit">
          {src && <img ref={img} src={src} alt="To draw on" className="max-h-[65vh] max-w-full rounded-lg select-none" draggable={false} />}
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
                return [...s.slice(0, -1), { ...last, points: tool === "pen" ? [...last.points, p] : [last.points[0], p] }]
              })
            }}
            onPointerUp={() => (drawing.current = false)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={!shapes.length}>Use this sketch</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
