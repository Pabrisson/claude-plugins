import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ExpandIcon, RotateCcwIcon } from "lucide-react"
import { cn } from "cn"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { fileUrl } from "@/lib/api"
import { CHIP, CHIP_OFF, CHIP_ON, Label } from "@/components/chips"

// Expand's frame: margins on each side as a share of the image (top and bottom of its height, left and right of its
// width), the frame up to 3 times the image each way. The engine pads the image with them (media.mjs expandCanvas)
type Margins = { top: number; right: number; bottom: number; left: number }
const SIDES = ["top", "right", "bottom", "left"] as const
const NONE: Margins = { top: 0, right: 0, bottom: 0, left: 0 }
const MAX = 2
const RATIOS = ["1:1", "4:5", "3:4", "2:3", "9:16", "16:9", "3:2", "4:3", "21:9"]
const HANDLES = [
  { id: "nw", x: 0, y: 0, cursor: "nwse-resize" },
  { id: "n", x: 0.5, y: 0, cursor: "ns-resize" },
  { id: "ne", x: 1, y: 0, cursor: "nesw-resize" },
  { id: "e", x: 1, y: 0.5, cursor: "ew-resize" },
  { id: "se", x: 1, y: 1, cursor: "nwse-resize" },
  { id: "s", x: 0.5, y: 1, cursor: "ns-resize" },
  { id: "sw", x: 0, y: 1, cursor: "nesw-resize" },
  { id: "w", x: 0, y: 0.5, cursor: "ew-resize" },
]

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
const round = (m: Margins): Margins => Object.fromEntries(SIDES.map((k) => [k, Math.round(m[k] * 1000) / 1000])) as Margins
export const marginsOf = (fields: Record<string, string>): Margins => Object.fromEntries(SIDES.map((k) => [k, clamp(Number(fields[k]) || 0, 0, MAX)])) as Margins
const ratioOf = (r: string) => r.split(":").map(Number).reduce((a, b) => a / b)

// the smallest frame of a ratio around the image, centered
function fit(r: number, w: number, h: number): Margins {
  if (r > w / h) {
    const extra = Math.min(MAX, (h * r) / w - 1)
    return { ...NONE, left: extra / 2, right: extra / 2 }
  }
  const extra = Math.min(MAX, w / r / h - 1)
  return { ...NONE, top: extra / 2, bottom: extra / 2 }
}

// a drag of a handle (or of the image, which slides inside its frame) by dx, dy image widths and heights
function dragMargins(m: Margins, mode: string, dx: number, dy: number): Margins {
  if (mode === "move") {
    const x = clamp(dx, -m.left, m.right), y = clamp(dy, -m.top, m.bottom)
    return { left: m.left + x, right: m.right - x, top: m.top + y, bottom: m.bottom - y }
  }
  const n = { ...m }
  if (mode.includes("e")) n.right = clamp(m.right + dx, 0, MAX - m.left)
  if (mode.includes("w")) n.left = clamp(m.left - dx, 0, MAX - m.right)
  if (mode.includes("s")) n.bottom = clamp(m.bottom + dy, 0, MAX - m.top)
  if (mode.includes("n")) n.top = clamp(m.top - dy, 0, MAX - m.bottom)
  return n
}

// in the composer: the frame drawn small, its size, and the button to the large editor (open by itself once an image
// arrives without a frame)
export function ExpandPreview({ image, fields, onChange }: { image?: string; fields: Record<string, string>; onChange: (patch: Record<string, string>) => void }) {
  const m = marginsOf(fields), any = SIDES.some((k) => m[k] > 0)
  const [open, setOpen] = useState(false)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const seen = useRef(image)
  useEffect(() => {
    if (image && image !== seen.current && !any) setOpen(true)
    seen.current = image
  }, [image, any])
  if (!image) return null
  // the frame in the 16:9 box, as large as it fits; the image at its place inside
  const fw = 1 + m.left + m.right, fh = 1 + m.top + m.bottom, fa = size ? (size.w * fw) / (size.h * fh) : 16 / 9
  const [w, h] = fa > 16 / 9 ? [86, (86 * 16) / 9 / fa] : [(86 * fa * 9) / 16, 86]
  return (
    <div>
      <Label hint={any ? undefined : "drag it wider or taller"}>Frame</Label>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group relative block aspect-video w-full overflow-hidden rounded-xl border bg-black/85 transition-colors hover:border-space/60"
        aria-label="Edit the frame"
      >
        <span className="absolute rounded-sm border border-dashed border-white/70 bg-[repeating-linear-gradient(45deg,rgb(255_255_255/0.06)_0_6px,transparent_6px_12px)]" style={{ left: `${(100 - w) / 2}%`, top: `${(100 - h) / 2}%`, width: `${w}%`, height: `${h}%` }}>
          <img
            src={fileUrl(image)}
            alt=""
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            className="absolute object-cover"
            style={{ left: `${(100 * m.left) / fw}%`, top: `${(100 * m.top) / fh}%`, width: `${100 / fw}%`, height: `${100 / fh}%` }}
          />
        </span>
        <span className="absolute right-2 bottom-2 flex items-center gap-1.5 rounded-md bg-black/70 px-2 py-1 text-xs text-white opacity-90 group-hover:opacity-100">
          <ExpandIcon className="size-3.5" /> {any ? "Edit the frame" : "Expand"}
        </span>
      </button>
      {size && any && (
        <p className="mt-1.5 text-xs text-muted-foreground tabular-nums">
          {Math.round(size.w * fw)} × {Math.round(size.h * fh)} · {Math.round((fw * fh - 1) * 100)} % more picture
        </p>
      )}
      <ExpandDialog open={open} image={image} start={m} onClose={() => setOpen(false)} onDone={(n) => (onChange(Object.fromEntries(SIDES.map((k) => [k, String(n[k])]))), setOpen(false))} />
    </div>
  )
}

function ExpandDialog({ open, image, start, onClose, onDone }: { open: boolean; image: string; start: Margins; onClose: () => void; onDone: (m: Margins) => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[min(1000px,calc(100%-2rem))] sm:max-w-[min(1000px,calc(100%-2rem))]">
        <DialogTitle>Expand the frame</DialogTitle>
        <DialogDescription>Drag the frame's edges and corners outward, or the picture inside it. The striped area is what the model paints.</DialogDescription>
        {open && <Editor image={image} start={start} onDone={onDone} />}
      </DialogContent>
    </Dialog>
  )
}

function Editor({ image, start, onDone }: { image: string; start: Margins; onDone: (m: Margins) => void }) {
  const stage = useRef<HTMLDivElement>(null)
  const [m, setM] = useState(start)
  const [img, setImg] = useState<{ w: number; h: number } | null>(null)
  const [room, setRoom] = useState({ w: 800, h: 460 })
  // the scale holds while dragging (the frame grows on screen) and fits the frame again on release
  const [fitTo, setFitTo] = useState(start)
  const drag = useRef<{ mode: string; x: number; y: number; m: Margins } | null>(null)
  // while a handle moves, the picture stays where it is (the handle follows the pointer); while the picture moves,
  // the frame does
  const [anchor, setAnchor] = useState<{ pic?: { left: number; top: number }; frame?: { left: number; top: number } } | null>(null)

  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(() => setRoom({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const fw = (x: Margins) => (img ? img.w * (1 + x.left + x.right) : 1), fh = (x: Margins) => (img ? img.h * (1 + x.top + x.bottom) : 1)
  const scale = img ? Math.min((room.w * 0.84) / fw(fitTo), (room.h * 0.84) / fh(fitTo)) : 0
  const W = fw(m) * scale, H = fh(m) * scale
  const frame = img && anchor?.pic
    ? { left: anchor.pic.left - img.w * m.left * scale, top: anchor.pic.top - img.h * m.top * scale, width: W, height: H }
    : { left: anchor?.frame?.left ?? (room.w - W) / 2, top: anchor?.frame?.top ?? (room.h - H) / 2, width: W, height: H }
  const pic = img && { left: frame.left + img.w * m.left * scale, top: frame.top + img.h * m.top * scale, width: img.w * scale, height: img.h * scale }
  const ratio = fw(m) / fh(m)
  const set = (n: Margins) => (setM(round(n)), setFitTo(round(n)))

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" aria-pressed={!SIDES.some((k) => m[k])} onClick={() => set(NONE)} className={cn(CHIP, "flex items-center gap-1 px-2.5 py-0.5 text-xs", CHIP_OFF)}>
          <RotateCcwIcon className="size-3" /> Reset
        </button>
        {RATIOS.map((r) => {
          const on = !!img && SIDES.some((k) => m[k]) && Math.abs(Math.log(ratio / ratioOf(r))) < 0.01
          return (
            <button key={r} type="button" aria-pressed={on} disabled={!img} onClick={() => img && set(fit(ratioOf(r), img.w, img.h))} className={cn(CHIP, "px-2.5 py-0.5 text-xs tabular-nums", on ? CHIP_ON : CHIP_OFF)}>
              {r}
            </button>
          )
        })}
      </div>

      <div
        ref={stage}
        className="relative h-[min(60vh,560px)] touch-none overflow-hidden rounded-xl bg-black/85 select-none"
        onPointerMove={(e) => {
          const d = drag.current
          if (!d || !img) return
          setM(round(dragMargins(d.m, d.mode, (e.clientX - d.x) / (img.w * scale), (e.clientY - d.y) / (img.h * scale))))
        }}
        onPointerUp={() => {
          if (!drag.current) return
          drag.current = null
          setAnchor(null)
          setFitTo(m)
        }}
      >
        <img src={fileUrl(image)} alt="" hidden onLoad={(e) => setImg({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} />
        {pic && (
          <>
            <div className="absolute rounded-sm bg-[repeating-linear-gradient(45deg,rgb(255_255_255/0.07)_0_8px,transparent_8px_16px)]" style={frame} />
            <img
              src={fileUrl(image)}
              alt="The image to expand"
              draggable={false}
              className="absolute cursor-move"
              style={pic}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                drag.current = { mode: "move", x: e.clientX, y: e.clientY, m }
                setAnchor({ frame: { left: frame.left, top: frame.top } })
              }}
            />
            <div className="pointer-events-none absolute border-2 border-dashed border-white/85" style={frame} />
            {HANDLES.map((h) => (
              <div
                key={h.id}
                aria-hidden
                className="absolute size-6 -translate-1/2 rounded-full after:absolute after:inset-1.5 after:rounded-full after:bg-white after:shadow after:ring-2 after:ring-space"
                style={{ left: frame.left + h.x * W, top: frame.top + h.y * H, cursor: h.cursor }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  drag.current = { mode: h.id, x: e.clientX, y: e.clientY, m }
                  if (pic) setAnchor({ pic: { left: pic.left, top: pic.top } })
                }}
              />
            ))}
          </>
        )}
      </div>

      {/* the same, typed: a share of the image on each side */}
      <div className="flex flex-wrap items-end gap-3">
        {SIDES.map((k) => (
          <label key={k} className="flex w-24 flex-col gap-1 text-xs text-muted-foreground capitalize">
            {k}
            <span className="relative">
              <Input
                type="number"
                min={0}
                max={MAX * 100}
                step={5}
                value={Math.round(m[k] * 100)}
                onChange={(e) => set({ ...m, [k]: clamp((Number(e.target.value) || 0) / 100, 0, MAX - m[k === "top" ? "bottom" : k === "bottom" ? "top" : k === "left" ? "right" : "left"]) })}
                className="h-8 pr-6 tabular-nums"
              />
              <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">%</span>
            </span>
          </label>
        ))}
        <span className="mr-auto self-center text-sm text-muted-foreground tabular-nums">{img && `${Math.round(fw(m))} × ${Math.round(fh(m))}`}</span>
        <Button disabled={!SIDES.some((k) => m[k])} onClick={() => onDone(m)}>
          Use this frame
        </Button>
      </div>
    </>
  )
}
