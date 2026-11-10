import { useEffect, useState } from "react"
import { Grid3x3Icon, RotateCcwIcon } from "lucide-react"
import { cn } from "cn"

import { FIT, panBy, sharp, zoomAt, type View } from "@/lib/zoom"
import { locale, t } from "@/lib/i18n"

// the first pane showing a media: root itself (the viewer) or one inside it (Compare's A and B)
const firstPane = (root: HTMLElement) => (root.matches("[data-zoom]") ? root : root.querySelector<HTMLElement>("[data-zoom]"))

const MEDIA = "[data-zoom] img, [data-zoom] video"
// a media's file width and its size as shown at 100 % (fitted whole, object-contain or not)
function fitted(m: HTMLImageElement | HTMLVideoElement) {
  const [nw, nh] = m instanceof HTMLImageElement ? [m.naturalWidth, m.naturalHeight] : [m.videoWidth, m.videoHeight]
  const f = nw && nh ? Math.min(m.offsetWidth / nw, m.offsetHeight / nh) : 0
  return { nw, w: f ? nw * f : m.offsetWidth, h: f ? nh * f : m.offsetHeight }
}

// the pane under the pointer (or the first one): its room inside its padding, its center on screen, and the largest
// media of every pane as shown at 100 % (an image or a video fitted whole, object-contain or not)
function measure(root: HTMLElement, from: EventTarget | null) {
  const pane = ((from instanceof Element && from.closest("[data-zoom]")) || firstPane(root)) as HTMLElement | null
  if (!pane) return null
  const r = pane.getBoundingClientRect(), cs = getComputedStyle(pane)
  const [top, right, bottom, left] = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat)
  const room = { w: r.width - left - right, h: r.height - top - bottom }
  const size = { w: 0, h: 0 }
  for (const m of root.querySelectorAll<HTMLImageElement | HTMLVideoElement>(MEDIA)) {
    const { w, h } = fitted(m)
    size.w = Math.max(size.w, w)
    size.h = Math.max(size.h, h)
  }
  return { room, size, center: { x: r.left + left + room.w / 2, y: r.top + top + room.h / 2 } }
}

// zoom on the wheel (or a pinch) toward the pointer, drag to move once zoomed, double-click for 2× or back, + − 0:
// root is the element holding the panes, data-zoom on each pane showing a media, style on each media (one zoom for all,
// so A and B show the same spot); back to 100 % whenever key changes. Pixels on: each media past its own resolution
// shows its file's pixels sharp (an upscale shows what it made), kept in this browser like the theme
const PIXELS = "media-generator:pixels"
export function useZoom(key: string, root: HTMLElement | null) {
  const [view, setView] = useState<View>(FIT)
  const [seen, setSeen] = useState(key)
  if (seen !== key) {
    setSeen(key)
    setView(FIT)
  }
  // a drag: where it started, the zoom then, the pane's measures
  const [grab, setGrab] = useState<{ x: number; y: number; from: View; g: NonNullable<ReturnType<typeof measure>> } | null>(null)
  const zoom = (s: (v: View) => number, from: EventTarget | null, x?: number, y?: number) => {
    const g = root && measure(root, from)
    if (!g) return
    const q = x == null || y == null ? { x: 0, y: 0 } : { x: x - g.center.x, y: y - g.center.y }
    setView((v) => zoomAt(v, s(v), q, g.size, g.room))
  }
  useEffect(() => {
    if (!root) return
    // not passive: the wheel zooms instead of scrolling the page
    const wheel = (e: WheelEvent) => {
      // the pane under the pointer, through what lies over it (Compare's split line); not a picker in its place
      const pane = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el.matches("[data-zoom]") && root.contains(el))
      if (!pane) return
      e.preventDefault()
      const g = measure(root, pane)
      if (!g) return
      // a pinch comes as a wheel with Ctrl, in small steps; a mouse notch is about 100 px, ×1.22
      const d = e.deltaY * (e.deltaMode === 1 ? 16 : 1)
      const q = { x: e.clientX - g.center.x, y: e.clientY - g.center.y }
      setView((v) => zoomAt(v, v.s * Math.exp(-d * (e.ctrlKey ? 0.01 : 0.002)), q, g.size, g.room))
    }
    root.addEventListener("wheel", wheel, { passive: false })
    return () => root.removeEventListener("wheel", wheel)
  }, [root])
  const [pixels, setPixels] = useState(() => {
    try {
      return localStorage.getItem(PIXELS) === "on"
    } catch {
      return false
    }
  })
  // per media: A and B of Compare cross their resolution at different zooms
  useEffect(() => {
    for (const m of root?.querySelectorAll<HTMLImageElement | HTMLVideoElement>(MEDIA) ?? []) {
      const { nw, w } = fitted(m)
      m.style.imageRendering = pixels && sharp(view.s, nw, w, window.devicePixelRatio || 1) ? "pixelated" : ""
    }
  }, [root, view.s, pixels])
  return {
    view,
    pixels,
    togglePixels() {
      setPixels(!pixels)
      try {
        localStorage.setItem(PIXELS, pixels ? "off" : "on")
      } catch {
        /* a private window keeps it for this page */
      }
    },
    zoomed: view.s > 1,
    style: { transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` },
    reset: () => setView(FIT),
    // true when the press moves the media (zoomed, on a pane, not on a control)
    down(e: React.PointerEvent) {
      const target = e.target as Element
      if (view.s <= 1 || !target.closest("[data-zoom]") || target.closest("button, a, input, textarea, [role=slider], [data-slot=slider]")) return false
      const g = root && measure(root, target)
      if (!g) return false
      e.currentTarget.setPointerCapture(e.pointerId)
      setGrab({ x: e.clientX, y: e.clientY, from: view, g })
      return true
    },
    // from the drag's start, so moves the page has not drawn yet add nothing twice
    move(e: React.PointerEvent) {
      if (!grab) return false
      setView(panBy(grab.from, e.clientX - grab.x, e.clientY - grab.y, grab.g.size, grab.g.room))
      return true
    },
    up() {
      setGrab(null)
    },
    // a video's double-click goes fullscreen otherwise
    double(e: React.MouseEvent) {
      if (!(e.target as Element).closest("[data-zoom]") || (e.target as Element).closest("button, [role=slider], [data-slot=slider]")) return
      e.preventDefault()
      zoom((v) => (v.s > 1 ? 1 : 2), e.target, e.clientX, e.clientY)
    },
    // + − 0 from the keyboard, at the center; true when it was one of them
    key(k: string) {
      const by = ({ "+": 1.5, "=": 1.5, "-": 1 / 1.5, "0": 0 } as Record<string, number>)[k]
      if (by == null || !root || !firstPane(root)) return false
      zoom((v) => (by ? v.s * by : 1), null)
      return true
    },
  }
}

// while zoomed: the zoom (a click goes back to 100 %) and Pixels
const PILL = "flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs text-white ring-1 ring-white/20 backdrop-blur-sm hover:bg-black/75"
export function ZoomBadge({ zoom, className }: { zoom: ReturnType<typeof useZoom>; className?: string }) {
  return (
    <div onPointerDown={(e) => e.stopPropagation()} className={cn("pointer-events-auto flex items-center gap-1.5", className)}>
      <button type="button" onClick={zoom.reset} aria-label={t("Back to 100 %")} title={t("Back to 100 % (0)")} className={cn(PILL, "tabular-nums")}>
        {zoom.view.s.toLocaleString(locale(), { style: "percent", maximumFractionDigits: 0 })}
        <RotateCcwIcon className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        aria-pressed={zoom.pixels}
        onClick={zoom.togglePixels}
        title={t("The file's own pixels, sharp, once zoomed past its resolution")}
        className={cn(PILL, zoom.pixels && "bg-white text-black ring-white hover:bg-white/90")}
      >
        <Grid3x3Icon className="size-3.5" aria-hidden />
        {t("Pixels")}
      </button>
    </div>
  )
}
