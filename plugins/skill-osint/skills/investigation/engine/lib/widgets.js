// The data the type widgets draw, pure (the dashboard imports it, the engine's tests check it): the map's features —
// the view's, plus the place entities and the hypotheses with a point that no feature cites yet (a type that draws an
// entity itself cites it by ref, and the widget does not draw it twice) — their circles, and the evidence gallery's
// items — every picture and video of Evidence, joined with the view's items by file.
import { circle } from './geo.js'

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const pointOf = (lat, lon, properties) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties })

export function mapFeatures(view, notes = []) {
  const own = view?.features ?? [], cited = new Set(own.map(f => f.properties?.ref).filter(Boolean)), out = [...own]
  for (const n of notes) {
    const p = n.props ?? {}, radius = num(p.radius_m)
    if (cited.has(n.path) || (p.id && cited.has(p.id))) continue
    if (n.folder === 'Entities' && p.kind === 'place') {
      const lat = num(p.lat), lon = num(p.lon)
      if (lat != null && lon != null) out.push(pointOf(lat, lon, { role: 'place', kind: 'entity', label: String(p.value ?? n.title), ref: n.path, ...(radius && { radius_m: radius }) }))
    } else if (n.folder === 'Hypotheses' && Array.isArray(p.point) && p.point.length === 2 && p.point.every(v => num(v) != null)) {
      const label = String(n.title).startsWith(String(p.id)) ? String(n.title) : `${p.id} ${n.title}`   // a note title may already carry its id
      out.push(pointOf(num(p.point[0]), num(p.point[1]), { role: p.status === 'excluded' ? 'excluded' : 'candidate', kind: p.level, status: p.status ?? 'active', label, ref: p.id, ...(radius && { radius_m: radius }) }))
    }
  }
  return { type: 'FeatureCollection', features: out }
}
// a polygon for each point that carries a radius (an error circle, an excluded area), with the point's properties
export const circlesOf = fc => fc.features.filter(f => f.geometry?.type === 'Point' && f.properties?.radius_m > 0)
  .map(f => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [circle([f.geometry.coordinates[1], f.geometry.coordinates[0]], f.properties.radius_m)] }, properties: f.properties }))

const PICTURE = /\.(jpe?g|png|webp|gif|avif|heic|heif|tiff?|bmp)$/i, VIDEO = /\.(mp4|m4v|webm|mov|mkv|avi|3gp)$/i
export const SECTIONS = ['original', 'masked', 'frame', 'candidate', 'crop', 'capture', 'remote']
export function evidenceItems(index, view) {
  const ev = new Map((index?.evidence ?? []).map(e => [e.file, e])), byFile = new Map(), out = []
  for (const it of view?.items ?? []) {
    if (it.file) byFile.set(it.file, it)
    else if (it.url) out.push({ ...it, section: 'remote', label: it.label ?? it.url, video: VIDEO.test(it.url), id: null, sha256: null, of: null })
  }
  for (const file of (index?.files ?? []).filter(f => f.startsWith('Evidence/') && (PICTURE.test(f) || VIDEO.test(f)))) {
    const e = ev.get(file), v = byFile.get(file) ?? {}
    const section = e?.kind === 'masked' ? 'masked' : e ? 'original' : file.startsWith('Evidence/frames/') ? 'frame' : v.kind === 'candidate' ? 'candidate' : file.startsWith('Evidence/captures/') ? 'capture' : 'crop'
    out.push({ ...v, file, section, label: v.label ?? file.split('/').pop(), video: VIDEO.test(file), id: e?.id ?? null, sha256: e?.sha256 ?? null, of: e?.of ?? null })
  }
  return out.sort((a, b) => SECTIONS.indexOf(a.section) - SECTIONS.indexOf(b.section) || (a.rank ?? 0) - (b.rank ?? 0) || String(a.file ?? a.url).localeCompare(String(b.file ?? b.url)))
}
