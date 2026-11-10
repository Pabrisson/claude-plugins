// a viewer's zoom: a scale and a shift of the media from its frame's center, in px; zoomed past its frame, the media
// keeps covering it (no black edge pulled in), and along a side it still fits, it stays centered
export type View = { s: number; x: number; y: number }
type Size = { w: number; h: number }

export const FIT: View = { s: 1, x: 0, y: 0 }
export const MAX = 8

const keep = (v: number, shown: number, room: number) => {
  const half = (shown - room) / 2
  return half > 0 ? Math.min(half, Math.max(-half, v)) : 0
}
// size: the media as shown at 100 %; room: its frame; at 100 % the media is where the page put it, even a pixel wider
// than the frame (Compare's B pane has a border)
export const clampView = (v: View, size: Size, room: Size): View => (v.s <= 1 ? FIT : { s: v.s, x: keep(v.x, size.w * v.s, room.w), y: keep(v.y, size.h * v.s, room.h) })

// to the scale s (100 % to MAX), the point q (from the frame's center) staying under the pointer
export function zoomAt(v: View, s: number, q: { x: number; y: number }, size: Size, room: Size): View {
  const n = Math.min(MAX, Math.max(1, s)), k = n / v.s
  return clampView({ s: n, x: q.x - (q.x - v.x) * k, y: q.y - (q.y - v.y) * k }, size, room)
}

// the file's own pixels drawn sharp: zoomed, and one of them covers a screen pixel or more (natural: the file's width,
// shown: its width at 100 % in CSS px, dpr: screen pixels per CSS px); below, sharp pixels of a still reduced media shimmer
export const sharp = (s: number, natural: number, shown: number, dpr: number) => s > 1 && natural > 0 && (shown * s * dpr) / natural >= 1

export const panBy = (v: View, dx: number, dy: number, size: Size, room: Size) => clampView({ ...v, x: v.x + dx, y: v.y + dy }, size, room)
