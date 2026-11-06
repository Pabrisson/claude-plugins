// Distances, bearings and shapes on the sphere (radius 6371.0088 km, as GeoINT computes them), for the engine (truth,
// the map's sight lines) and the dashboard's map. Pure: the dashboard imports it.
const R = 6371.0088, rad = d => (d * Math.PI) / 180, deg = r => (r * 180) / Math.PI

export function parseLatLon(s) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(s ?? ''))
  if (!m) return null
  const lat = Number(m[1]), lon = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null
}
export function haversineKm([lat1, lon1], [lat2, lon2]) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)))
}
// the point km away along a compass bearing (0 = north, 90 = east)
export function destination([lat, lon], bearing, km) {
  const d = km / R, b = rad(bearing), p1 = rad(lat), l1 = rad(lon)
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b))
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))
  return [deg(p2), ((deg(l2) + 540) % 360) - 180]
}
// a circle as a closed GeoJSON ring of [lon, lat]
export function circle(center, radius_m, n = 64) {
  const ring = Array.from({ length: n }, (_, i) => destination(center, (360 * i) / n, radius_m / 1000)).map(([la, lo]) => [lo, la])
  return [...ring, ring[0]]
}
// GeoINT's approximate world-map game score
export const gameScore = km => Math.round(5000 * Math.exp(-km / 1492.7))
