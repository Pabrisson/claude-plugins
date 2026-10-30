import { useEffect, useRef, useState } from "react"
import { BrushIcon, EraserIcon, FlipHorizontal2Icon, LassoIcon, LoaderCircleIcon, Redo2Icon, Trash2Icon, Undo2Icon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { Slider } from "@/components/ui/slider"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, fileUrl, plain } from "@/lib/api"

// a mask painted over an image (inpaint) or a frame of a video (clean up). The strokes keep fractions of the picture,
// so the screen shows them at its size and the file at the picture's; what is sent is the picture with the painted
// area in translucent magenta, which the tools' templates name. An image inpaint also keeps the area in black and
// white (the matte), never sent: the engine lays the model's result back on the original inside it
type Tool = "brush" | "eraser" | "lasso"
type Op = { tool: Tool | "invert"; size: number; points: [number, number][] }
const TOOLS = [
  { value: "brush", label: "Brush", key: "B", icon: BrushIcon },
  { value: "eraser", label: "Eraser", key: "E", icon: EraserIcon },
  { value: "lasso", label: "Lasso: fill a shape", key: "L", icon: LassoIcon },
] as const
// the brush in thousandths of the picture's long side
const SIZES = { min: 5, max: 200, start: 40 }
const MAGENTA = "rgba(255, 0, 255, 0.55)"

// the strokes into a context of w × h, the painted area in the given color
function paint(ctx: CanvasRenderingContext2D, ops: Op[], w: number, h: number, color: string) {
  ctx.clearRect(0, 0, w, h)
  const long = Math.max(w, h)
  for (const op of ops) {
    ctx.globalCompositeOperation = op.tool === "eraser" ? "destination-out" : op.tool === "invert" ? "xor" : "source-over"
    ctx.fillStyle = ctx.strokeStyle = "black"
    if (op.tool === "invert") {
      ctx.fillRect(0, 0, w, h)
      continue
    }
    const pts = op.points.map(([x, y]) => [x * w, y * h] as const)
    ctx.beginPath()
    if (op.tool === "lasso") {
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.closePath()
      ctx.fill()
      continue
    }
    ctx.lineWidth = (op.size / 1000) * long
    ctx.lineCap = ctx.lineJoin = "round"
    if (pts.length === 1) {
      ctx.arc(pts[0][0], pts[0][1], ctx.lineWidth / 2, 0, Math.PI * 2)
      ctx.fill()
    } else {
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
    }
  }
  ctx.globalCompositeOperation = "source-in"
  ctx.fillStyle = color
  ctx.fillRect(0, 0, w, h)
  ctx.globalCompositeOperation = "source-over"
}

// the tool's words beside the mask (Put there, Remove): written here too, the same field as the composer's
export type MaskWords = { label: string; placeholder?: string; value: string; onChange: (v: string) => void }

export function MaskDialog({ src, video, matte, words, onClose, onSave }: { src: string | null; video?: string; matte?: boolean; words?: MaskWords; onClose: () => void; onSave: (png: Blob, matte?: Blob) => void }) {
  return (
    <Dialog open={!!src} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(1100px,calc(100%-2rem))] sm:max-w-[min(1100px,calc(100%-2rem))]">
        <DialogTitle>Paint the area</DialogTitle>
        <DialogDescription>
          Paint over what should change, a little wider than the new thing will be{words ? `, then say it below` : ""}. The model works there only{matte ? "; the rest of the image is kept pixel for pixel" : ""}.
        </DialogDescription>
        {src && <Painter key={src} start={src} video={video} matte={matte} words={words} onSave={onSave} />}
      </DialogContent>
    </Dialog>
  )
}

function Painter({ start, video, matte, words, onSave }: { start: string; video?: string; matte?: boolean; words?: MaskWords; onSave: (png: Blob, matte?: Blob) => void }) {
  const img = useRef<HTMLImageElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [src, setSrc] = useState(start)
  const [ops, setOps] = useState<Op[]>([])
  const [undone, setUndone] = useState<Op[]>([])
  const [tool, setTool] = useState<Tool>("brush")
  const [size, setSize] = useState(SIZES.start)
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const drawing = useRef(false)
  // a video: the frame to paint on, picked along its length
  const [length, setLength] = useState(0)
  const [at, setAt] = useState(0)
  const [busy, setBusy] = useState(false)
  // a frame is asked once the slider rests, and only the last one asked is shown
  const wait = useRef(0), asked = useRef(0)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const draw = () => {
      el.width = el.clientWidth * devicePixelRatio
      el.height = el.clientHeight * devicePixelRatio
      setBox({ w: el.clientWidth, h: el.clientHeight })
      paint(el.getContext("2d")!, ops, el.width, el.height, MAGENTA)
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ops, src])

  const commit = (next: Op[]) => (setOps(next), setUndone([]))
  function undo() {
    if (!ops.length) return
    setUndone([ops.at(-1)!, ...undone])
    setOps(ops.slice(0, -1))
  }
  function redo() {
    if (!undone.length) return
    setOps([...ops, undone[0]])
    setUndone(undone.slice(1))
  }
  const resize = (by: number) => setSize((s) => Math.min(SIZES.max, Math.max(SIZES.min, s + by)))

  // the keys: B E L for the tools, [ and ] for the size, ⌘Z and ⇧⌘Z
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, textarea")) return
      const k = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && k === "z") {
        e.preventDefault()
        return e.shiftKey ? redo() : undo()
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const t = TOOLS.find((x) => x.key.toLowerCase() === k)
      if (t) setTool(t.value)
      if (e.key === "[" || e.key === "]") resize(e.key === "[" ? -10 : 10)
    }
    window.addEventListener("keydown", on)
    return () => window.removeEventListener("keydown", on)
  })

  const point = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect()
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]
  }

  async function pickFrame(t: number) {
    const n = ++asked.current
    setBusy(true)
    try {
      const { path } = await api.frame(video!, false, t)
      if (n === asked.current) setSrc(fileUrl(path))
    } catch (e) {
      toast.error(plain((e as Error).message))
    } finally {
      if (n === asked.current) setBusy(false)
    }
  }

  async function save() {
    const i = img.current!
    await i.decode().catch(() => {})
    if (!i.naturalWidth) return toast.error("The picture is still loading")
    const out = document.createElement("canvas"), mask = document.createElement("canvas")
    out.width = mask.width = i.naturalWidth
    out.height = mask.height = i.naturalHeight
    paint(mask.getContext("2d")!, ops, mask.width, mask.height, MAGENTA)
    const ctx = out.getContext("2d")!
    ctx.drawImage(i, 0, 0)
    ctx.drawImage(mask, 0, 0)
    const blob = (c: HTMLCanvasElement) => new Promise<Blob | null>((ok) => c.toBlob(ok, "image/png"))
    const png = await blob(out)
    if (!png) return
    if (!matte) return onSave(png)
    // the matte: white where painted, black elsewhere, at the picture's size
    const bw = document.createElement("canvas")
    bw.width = mask.width
    bw.height = mask.height
    paint(mask.getContext("2d")!, ops, mask.width, mask.height, "white")
    const b = bw.getContext("2d")!
    b.fillStyle = "black"
    b.fillRect(0, 0, bw.width, bw.height)
    b.drawImage(mask, 0, 0)
    onSave(png, (await blob(bw)) ?? undefined)
  }

  const brushPx = (size / 1000) * Math.max(box.w, box.h)
  return (
    <>
      <div className="flex flex-wrap items-center gap-1">
        <ToggleGroup type="single" value={tool} onValueChange={(v) => v && setTool(v as Tool)} aria-label="Paint tool">
          {TOOLS.map(({ value, label, key, icon: Icon }) => (
            <ToggleGroupItem key={value} value={value} aria-label={label} title={`${label} (${key})`}>
              <Icon />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <div className={tool === "lasso" ? "pointer-events-none flex items-center gap-2 opacity-40" : "flex items-center gap-2"}>
          <span className="text-sm text-muted-foreground">Size</span>
          <Slider className="w-36" min={SIZES.min} max={SIZES.max} step={1} value={[size]} onValueChange={([v]) => setSize(v)} aria-label="Brush size" />
          <span className="grid size-8 place-items-center" aria-hidden>
            <span className="rounded-full bg-[rgb(255_0_255/0.55)] ring-1 ring-foreground/30" style={{ width: Math.max(3, Math.min(32, brushPx)), height: Math.max(3, Math.min(32, brushPx)) }} />
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Kbd>[</Kbd>
            <Kbd>]</Kbd>
          </span>
        </div>
        <Separator orientation="vertical" className="mx-1 h-5" />
        <Button variant="ghost" size="icon" aria-label="Undo" title="Undo (⌘Z)" disabled={!ops.length} onClick={undo}>
          <Undo2Icon />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Redo" title="Redo (⇧⌘Z)" disabled={!undone.length} onClick={redo}>
          <Redo2Icon />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Invert the mask" title="Invert: paint everything else" onClick={() => commit([...ops, { tool: "invert", size: 0, points: [] }])}>
          <FlipHorizontal2Icon />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Clear the mask" title="Clear" disabled={!ops.length} onClick={() => commit([])}>
          <Trash2Icon />
        </Button>
      </div>

      <div className="rounded-xl bg-black/40 p-3">
        <div className="relative mx-auto w-fit" onPointerLeave={() => setCursor(null)}>
          <img ref={img} src={src} alt="To paint on" className="block max-h-[60vh] max-w-full rounded-md select-none" draggable={false} />
          <canvas
            ref={canvas}
            className={tool === "lasso" ? "absolute inset-0 size-full cursor-crosshair touch-none" : "absolute inset-0 size-full cursor-none touch-none"}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              drawing.current = true
              commit([...ops, { tool, size, points: [point(e)] }])
            }}
            onPointerMove={(e) => {
              const r = canvas.current!.getBoundingClientRect()
              setCursor({ x: e.clientX - r.left, y: e.clientY - r.top })
              if (!drawing.current) return
              const p = point(e)
              setOps((list) => [...list.slice(0, -1), { ...list.at(-1)!, points: [...list.at(-1)!.points, p] }])
            }}
            onPointerUp={() => (drawing.current = false)}
          />
          {cursor && tool !== "lasso" && (
            <span
              aria-hidden
              className="pointer-events-none absolute rounded-full border border-white shadow-[0_0_0_1px_rgb(0_0_0/0.6)]"
              style={{ left: cursor.x - brushPx / 2, top: cursor.y - brushPx / 2, width: brushPx, height: brushPx }}
            />
          )}
          {busy && <LoaderCircleIcon className="absolute top-3 right-3 size-5 animate-spin text-white" />}
        </div>
      </div>

      {video && (
        <div className="flex items-center gap-3 rounded-xl bg-muted px-3 py-2">
          <video src={fileUrl(video)} preload="metadata" hidden onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLength(e.currentTarget.duration)} />
          <span className="text-sm whitespace-nowrap text-muted-foreground">Paint on the frame at</span>
          <Slider className="flex-1" min={0} max={Math.max(0.1, length - 0.1)} step={0.1} value={[at]} disabled={!length} onValueChange={([t]) => setAt(t)} onValueCommit={([t]) => {
              clearTimeout(wait.current)
              wait.current = window.setTimeout(() => pickFrame(t), 250)
            }} aria-label="The frame to paint on" />
          <span className="w-14 text-right text-sm tabular-nums">{at.toFixed(1)} s</span>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-end gap-3">
        {words ? (
          <label className="mr-auto flex min-w-64 flex-1 flex-col gap-1.5">
            <span className="text-xs font-semibold tracking-wider text-foreground/70 uppercase">{words.label}</span>
            <Input value={words.value} placeholder={words.placeholder} onChange={(e) => words.onChange(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ops.some((o) => o.tool !== "eraser") && save()} />
          </label>
        ) : (
          <span className="mr-auto self-center text-xs text-muted-foreground">B brush · E eraser · L lasso · [ ] size · ⌘Z undo</span>
        )}
        <Button onClick={save} disabled={!ops.some((o) => o.tool !== "eraser")}>Use this mask</Button>
      </div>
    </>
  )
}
