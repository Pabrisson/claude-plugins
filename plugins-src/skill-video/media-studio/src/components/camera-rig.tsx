import { useRef } from "react"
import { cn } from "cn"

import { opt, type Cam, type Field } from "@/lib/api"
import { CHIP, CHIP_OFF, CHIP_ON, Chips, Label } from "@/components/chips"
import { clamp, rad, wrap } from "@/components/light-rig"

// New angle's camera: dragged around the subject (seen from above, the picture's own camera at the bottom) and up or
// down (seen from the side), closer or farther. The field's value stays words, as the catalog's quick angles are
// (tools/image.json was written with these same words), so the CLI and a remix keep working; the camera itself rides
// along in fields["<key>:cam"]
export function camWords({ az, el, zoom }: Cam) {
  const parts = [
    Math.abs(az) >= 165 ? "the camera moved all the way around, behind the subject" : az ? `the camera moved ${Math.abs(az)}° to the ${az < 0 ? "left" : "right"} around the subject` : "the camera facing the subject",
    el >= 75 ? "looking straight down from above" : el > 10 ? `raised ${el}° above eye level, looking down` : el < -10 ? `lowered ${-el}° below eye level, looking up` : "at eye level",
  ]
  if (zoom > 0) parts.push("closer, a tighter framing")
  if (zoom < 0) parts.push("farther back, a wider framing")
  return parts.join(", ")
}

function readCam(field: Field, fields: Record<string, string>): Cam {
  try {
    const c = JSON.parse(fields[`${field.key}:cam`] ?? "")
    if (typeof c?.az === "number") return c
  } catch {
    /* none saved: from the value */
  }
  const value = fields[field.key] ?? String(field.default ?? "")
  return field.options?.map(opt).find((o) => o.value === value)?.cam ?? { az: -45, el: 0, zoom: 0 }
}

const S = 160, C = 80, R = 58
// the camera: a body facing the subject and the cone of what it sees
function Camera({ x, y, toX, toY }: { x: number; y: number; toX: number; toY: number }) {
  const a = Math.atan2(toY - y, toX - x), deg = (a * 180) / Math.PI
  const cone = [0.32, -0.32].map((d) => `${x + Math.cos(a + d) * 30},${y + Math.sin(a + d) * 30}`).join(" ")
  return (
    <g>
      <polygon points={`${x},${y} ${cone}`} className="fill-space/25" />
      <g transform={`translate(${x} ${y}) rotate(${deg})`}>
        <rect x={-9} y={-6} width={14} height={12} rx={2.5} className="fill-space" />
        <polygon points="5,-4 10,-6.5 10,6.5 5,4" className="fill-space" />
      </g>
    </g>
  )
}

// a drag on one of the two views: the angle from its pivot to the pointer
function useDrag(onAngle: (x: number, y: number) => void) {
  const box = useRef<SVGSVGElement>(null), on = useRef(false)
  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    onAngle(((e.clientX - r.left) * S) / r.width, ((e.clientY - r.top) * S) / r.height)
  }
  return {
    ref: box,
    onPointerDown: (e: React.PointerEvent) => (e.currentTarget.setPointerCapture(e.pointerId), (on.current = true), at(e)),
    onPointerMove: (e: React.PointerEvent) => on.current && at(e),
    onPointerUp: () => (on.current = false),
  }
}

export function CameraRig({ field, fields, onChange }: { field: Field; fields: Record<string, string>; onChange: (patch: Record<string, string>) => void }) {
  const cam = readCam(field, fields), value = fields[field.key] ?? String(field.default ?? "")
  const quick = (field.options ?? []).map(opt).filter((o) => o.cam)
  const save = (next: Cam, words = camWords(next)) => onChange({ [field.key]: words, [`${field.key}:cam`]: JSON.stringify(next) })
  const put = (patch: Partial<Cam>) => save({ ...cam, ...patch })

  // seen from above: the subject faces the bottom, where the picture was taken; left is the camera's left
  const around = useDrag((x, y) => put({ az: Math.round(wrap((Math.atan2(x - C, y - C) * 180) / Math.PI) / 5) * 5 }))
  // seen from the side: the subject on the left, the camera on an arc from below to straight above
  const SX = 44, SY = 112
  const height = useDrag((x, y) => put({ el: Math.round(clamp((Math.atan2(SY - y, Math.max(x - SX, 0.01)) * 180) / Math.PI, -60, 90) / 5) * 5 }))
  const top = { x: C + Math.sin(cam.az * rad) * R, y: C + Math.cos(cam.az * rad) * R }
  const side = { x: SX + Math.cos(cam.el * rad) * 84, y: SY - Math.sin(cam.el * rad) * 84 }
  const keys = (step: (e: React.KeyboardEvent) => Partial<Cam> | null) => (e: React.KeyboardEvent) => {
    const p = step(e)
    if (!p) return
    e.preventDefault()
    put(p)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label>Quick angles</Label>
        <div className="grid grid-cols-3 gap-1.5">
          {quick.map((o) => (
            <button key={o.label} type="button" aria-pressed={o.value === value} onClick={() => save(o.cam!, o.value)} className={cn(CHIP, "rounded-md px-1", o.value === value ? CHIP_ON : CHIP_OFF)}>
              {o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <figure className="overflow-hidden rounded-xl bg-black/85 text-white">
          <svg
            {...around}
            viewBox={`0 0 ${S} ${S}`}
            role="slider"
            tabIndex={0}
            aria-label="Around the subject"
            aria-valuemin={-180}
            aria-valuemax={180}
            aria-valuenow={cam.az}
            aria-valuetext={cam.az ? `${Math.abs(cam.az)}° to the ${cam.az < 0 ? "left" : "right"}` : "in front"}
            onKeyDown={keys((e) => ({ ArrowLeft: { az: wrap(cam.az - 15) }, ArrowRight: { az: wrap(cam.az + 15) } })[e.key] ?? null)}
            className="aspect-square w-full cursor-grab touch-none outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
          >
            <circle cx={C} cy={C} r={R} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeDasharray="3 4" />
            <circle cx={C} cy={C + R} r={3} fill="currentColor" fillOpacity={0.35} />
            <ellipse cx={C} cy={C} rx={15} ry={11} fill="currentColor" fillOpacity={0.85} />
            <circle cx={C} cy={C + 2} r={7} fill="currentColor" />
            <path d={`M${C - 3},${C + 8} L${C},${C + 13} L${C + 3},${C + 8} Z`} fill="currentColor" />
            <Camera x={top.x} y={top.y} toX={C} toY={C} />
          </svg>
          <figcaption className="pb-2 text-center text-[11px] text-white/60">Around · {cam.az ? `${Math.abs(cam.az)}° ${cam.az < 0 ? "left" : "right"}` : "front"}</figcaption>
        </figure>
        <figure className="overflow-hidden rounded-xl bg-black/85 text-white">
          <svg
            {...height}
            viewBox={`0 0 ${S} ${S}`}
            role="slider"
            tabIndex={0}
            aria-label="Camera height"
            aria-valuemin={-60}
            aria-valuemax={90}
            aria-valuenow={cam.el}
            aria-valuetext={cam.el > 0 ? `${cam.el}° above` : cam.el < 0 ? `${-cam.el}° below` : "eye level"}
            onKeyDown={keys((e) => ({ ArrowUp: { el: clamp(cam.el + 15, -60, 90) }, ArrowDown: { el: clamp(cam.el - 15, -60, 90) } })[e.key] ?? null)}
            className="aspect-square w-full cursor-grab touch-none outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
          >
            <path d={`M${SX + Math.cos(-60 * rad) * 84},${SY - Math.sin(-60 * rad) * 84} A84,84 0 0,0 ${SX},${SY - 84}`} fill="none" stroke="currentColor" strokeOpacity={0.18} strokeDasharray="3 4" />
            <line x1={10} x2={S - 10} y1={SY + 24} y2={SY + 24} stroke="currentColor" strokeOpacity={0.25} />
            <circle cx={SX} cy={SY - 14} r={8} fill="currentColor" />
            <path d={`M${SX - 9},${SY + 24} L${SX - 7},${SY - 4} Q${SX},${SY - 8} ${SX + 7},${SY - 4} L${SX + 9},${SY + 24} Z`} fill="currentColor" fillOpacity={0.85} />
            <Camera x={side.x} y={side.y} toX={SX} toY={SY - 10} />
          </svg>
          <figcaption className="pb-2 text-center text-[11px] text-white/60">Height · {cam.el > 0 ? `${cam.el}° above` : cam.el < 0 ? `${-cam.el}° below` : "eye level"}</figcaption>
        </figure>
      </div>
      <div>
        <Label>Distance</Label>
        <Chips className="grid grid-cols-3" options={[-1, 0, 1] as const} value={cam.zoom as -1 | 0 | 1} label={(z) => (z < 0 ? "Farther" : z > 0 ? "Closer" : "Same")} onChange={(zoom) => put({ zoom })} />
      </div>
      <p className="-mt-1 text-xs text-muted-foreground" aria-live="polite">
        {value.charAt(0).toUpperCase() + value.slice(1)}.
      </p>
    </div>
  )
}
