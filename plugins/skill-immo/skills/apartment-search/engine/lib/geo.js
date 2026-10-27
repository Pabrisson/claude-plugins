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

// The zone along a street: a capsule `radius_m` wide on each side of the segment between its two farthest points
// (its sales and its numbers), the ends rounded. A street shorter than its width becomes a circle.
// ponytail: a capsule fits straight streets; a buffer along the ordered points if a curved one overflows it
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
