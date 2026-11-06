import { useEffect, useRef, useState, type RefObject } from "react"

export type Transform = { x: number; y: number; k: number }
const clamp = (k: number) => Math.min(8, Math.max(0.1, k))
// Pan and zoom over an element: the wheel zooms around the pointer, dragging the background moves; `skip` leaves a
// pointer press to the caller (a node being dragged). Shared by the Graph and the Canvas.
export function usePanZoom(ref: RefObject<HTMLElement | null>, skip?: (e: PointerEvent) => boolean) {
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, k: 1 })
  const skipRef = useRef(skip)
  useEffect(() => { skipRef.current = skip })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top
      setTransform(t => { const k = clamp(t.k * Math.exp(-e.deltaY * 0.0015)); return { k, x: px - ((px - t.x) * k) / t.k, y: py - ((py - t.y) * k) / t.k } })
    }
    let drag: { x: number; y: number } | null = null
    const down = (e: PointerEvent) => { if (e.button !== 0 || skipRef.current?.(e)) return; drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); el.style.cursor = "grabbing" }
    const move = (e: PointerEvent) => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY }; setTransform(t => ({ ...t, x: t.x + dx, y: t.y + dy })) }
    const up = () => { drag = null; el.style.cursor = "" }
    el.addEventListener("wheel", wheel, { passive: false })
    el.addEventListener("pointerdown", down)
    el.addEventListener("pointermove", move)
    el.addEventListener("pointerup", up)
    el.addEventListener("pointercancel", up)
    return () => { el.removeEventListener("wheel", wheel); el.removeEventListener("pointerdown", down); el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); el.removeEventListener("pointercancel", up) }
  }, [ref])
  return { transform, setTransform, reset: () => setTransform({ x: 0, y: 0, k: 1 }) }
}
// the transform that fits a box (world coordinates) into an element of size w × h, with a margin
export function fit(box: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number, pad = 40): Transform {
  const bw = Math.max(1, box.x1 - box.x0), bh = Math.max(1, box.y1 - box.y0), k = clamp(Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh, 1.5))
  return { k, x: (w - bw * k) / 2 - box.x0 * k, y: (h - bh * k) / 2 - box.y0 * k }
}
