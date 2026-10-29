// Distances and shapes in WGS 84 ([lon, lat], like GeoJSON), shared by Node and the dashboard. A search zone is a
// circle around a point ({ kind: 'radius', center, radius_m }) or a polygon ({ kind: 'polygon', geometry }).

const R = 6371008.8

// great-circle distance in meters
export function distance([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// ray casting on each ring: inside the outer ring and outside its holes
function inRings(p, rings) {
  let inside = false
  for (const ring of rings)
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j]
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside
    }
  return inside
}

export function inGeometry(p, g) {
  if (!g) return false
  if (g.type === 'Polygon') return inRings(p, g.coordinates)
  if (g.type === 'MultiPolygon') return g.coordinates.some(rings => inRings(p, rings))
  return false
}

export const inZone = (p, zone) => !!p && (zone.kind === 'radius' ? distance(p, zone.center) <= zone.radius_m : inGeometry(p, zone.geometry))

// a circle as a 64-sided polygon, to draw it and to send it where only shapes are taken
export function circle([lon, lat], radius_m, n = 64) {
  const dLat = radius_m / 111320, dLon = dLat / Math.cos((lat * Math.PI) / 180)
  const ring = Array.from({ length: n + 1 }, (_, i) => {
    const t = ((i % n) / n) * 2 * Math.PI
    return [+(lon + dLon * Math.cos(t)).toFixed(6), +(lat + dLat * Math.sin(t)).toFixed(6)]
  })
  return { type: 'Polygon', coordinates: [ring] }
}

// meters around a point, enough for a few kilometers: to [x, y] and back to [lon, lat]
function plane([lon0, lat0]) {
  const my = 111320, mx = my * Math.cos((lat0 * Math.PI) / 180)
  return { to: ([lon, lat]) => [(lon - lon0) * mx, (lat - lat0) * my], back: ([x, y]) => [+(lon0 + x / mx).toFixed(6), +(lat0 + y / my).toFixed(6)] }
}
// the distance of p to the segment ab, in the plane
function toSegment([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l)) : 0
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}
// Douglas-Peucker: the points of a line that keep it within `tol` of where it was (extra items of a point are kept)
function simplify(pts, tol) {
  let k = 0, far = 0
  for (let i = 1; i < pts.length - 1; i++) { const d = toSegment(pts[i], pts[0], pts.at(-1)); if (d > far) [k, far] = [i, d] }
  return far <= tol ? [pts[0], pts.at(-1)] : [...simplify(pts.slice(0, k + 1), tol).slice(0, -1), ...simplify(pts.slice(k), tol)]
}
const area = ring => ring.reduce((a, [x, y], i) => { const [u, v] = ring[(i + 1) % ring.length]; return a + x * v - u * y }, 0) / 2

// A ring cut to `max` vertices at most, its shape kept: Douglas-Peucker in meters, from 1 m, the tolerance doubled
// until it fits
export function thin(ring, max) {
  if (ring.length <= max) return ring
  const p = plane(ring[0]), pts = ring.map((x, i) => [...p.to(x), i])
  for (let tol = 1; ; tol *= 2) {
    const kept = simplify(pts, tol)
    if (kept.length <= max) return kept.map(x => ring[x[2]])
  }
}

// The zone along a street's real line (its segments, lib/opendata.js streetLine): every point within `radius_m` of it,
// a Polygon, or a MultiPolygon when its segments lie apart. On a grid of cells a tenth of the width, those within reach,
// their outline traced along their sides (inside on the left: the outer rings counterclockwise, the holes clockwise),
// then simplified to a cell.
export function band(lines, radius_m) {
  const r = radius_m, p = plane(lines[0][0]), xy = lines.map(l => l.map(p.to))
  const c = Math.max(4, r / 10), all = xy.flat(), xs = all.map(q => q[0]), ys = all.map(q => q[1])
  const x0 = Math.min(...xs) - r - 2 * c, y0 = Math.min(...ys) - r - 2 * c
  const W = Math.ceil((Math.max(...xs) + r + 2 * c - x0) / c), H = Math.ceil((Math.max(...ys) + r + 2 * c - y0) / c)
  // a cell is in when its center is within reach: each segment looks at the cells of its own box
  const grid = new Uint8Array(W * H)
  for (const l of xy)
    for (let k = 1; k < l.length; k++) {
      const [a, b] = [l[k - 1], l[k]]
      const i0 = Math.floor((Math.min(a[0], b[0]) - r - x0) / c), i1 = Math.ceil((Math.max(a[0], b[0]) + r - x0) / c)
      const j0 = Math.floor((Math.min(a[1], b[1]) - r - y0) / c), j1 = Math.ceil((Math.max(a[1], b[1]) + r - y0) / c)
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) if (!grid[j * W + i] && toSegment([x0 + (i + 0.5) * c, y0 + (j + 0.5) * c], a, b) <= r) grid[j * W + i] = 1
    }
  const at = (i, j) => i >= 0 && j >= 0 && i < W && j < H && grid[j * W + i] === 1
  // the sides between a cell in and one out, from corner to corner; a corner where two cells in touch by a tip has
  // two ways out
  const next = new Map(), side = (i, j, to) => { const k = `${i},${j}`; next.has(k) ? next.get(k).push(to) : next.set(k, [to]) }
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      if (!at(i, j)) continue
      if (!at(i, j - 1)) side(i, j, [i + 1, j])
      if (!at(i + 1, j)) side(i + 1, j, [i + 1, j + 1])
      if (!at(i, j + 1)) side(i + 1, j + 1, [i, j + 1])
      if (!at(i - 1, j)) side(i, j + 1, [i, j])
    }
  const rings = []
  for (const [start, outs] of next) {
    if (!outs.length) continue
    const ring = []
    for (let k = start; next.get(k)?.length; ) {
      const [i, j] = k.split(',').map(Number), [a, b] = next.get(k).pop()
      ring.push([x0 + i * c, y0 + j * c])
      k = `${a},${b}`
    }
    rings.push(simplify([...ring, ring[0]], c))
  }
  // each hole goes with the outer ring around it
  const polygons = rings.filter(g => area(g) > 0).map(g => [g])
  for (const h of rings.filter(g => area(g) < 0)) polygons.find(([o]) => inRings(h[0], [o]))?.push(h)
  const out = polygons.map(rs => rs.map(g => g.map(p.back)))
  return out.length === 1 ? { type: 'Polygon', coordinates: out[0] } : { type: 'MultiPolygon', coordinates: out }
}

// The zone along a street with no known line: a capsule `radius_m` wide on each side of the segment between its two
// farthest points (its sales and its numbers), the ends rounded. A street shorter than its width becomes a circle.
export function corridor(points, radius_m, n = 16) {
  let a = points[0], b = points[0], far = 0
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const d = distance(points[i], points[j])
      if (d > far) [a, b, far] = [points[i], points[j], d]
    }
  if (far < radius_m) return circle([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], radius_m)
  // meters around a, enough for a few kilometers
  const my = 111320, mx = my * Math.cos((a[1] * Math.PI) / 180)
  const [bx, by] = [(b[0] - a[0]) * mx, (b[1] - a[1]) * my], t = Math.atan2(by, bx)
  const cap = ([cx, cy], from) => Array.from({ length: n + 1 }, (_, i) => {
    const u = from + (i / n) * Math.PI
    return [cx + radius_m * Math.cos(u), cy + radius_m * Math.sin(u)]
  })
  const ring = [...cap([bx, by], t - Math.PI / 2), ...cap([0, 0], t + Math.PI / 2)]
  ring.push(ring[0])
  return { type: 'Polygon', coordinates: [ring.map(([x, y]) => [+(a[0] + x / mx).toFixed(6), +(a[1] + y / my).toFixed(6)])] }
}

// [minLon, minLat, maxLon, maxLat] of a zone, grown by `pad_m` meters
export function bbox(zone, pad_m = 0) {
  const g = zone.kind === 'radius' ? circle(zone.center, zone.radius_m, 16) : zone.geometry
  const pts = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).flat(2)
  const lons = pts.map(p => p[0]), lats = pts.map(p => p[1])
  const dLat = pad_m / 111320, dLon = dLat / Math.cos((((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI) / 180)
  return [Math.min(...lons) - dLon, Math.min(...lats) - dLat, Math.max(...lons) + dLon, Math.max(...lats) + dLat]
}

// the center of a zone: its point, or the middle of its box
export const center = zone => {
  if (zone.kind === 'radius') return zone.center
  const [a, b, c, d] = bbox(zone)
  return [+((a + c) / 2).toFixed(6), +((b + d) / 2).toFixed(6)]
}

// what is within `radius_m` of a point, per category: how many, and the nearest one's distance
export function around(p, pois, radius_m = 500) {
  const out = {}
  for (const x of pois ?? []) {
    const d = distance(p, x.point)
    if (d > radius_m) continue
    const c = (out[x.cat] ??= { count: 0, nearest: null, name: null })
    c.count++
    if (c.nearest == null || d < c.nearest) Object.assign(c, { nearest: Math.round(d), name: x.name })
  }
  return out
}
