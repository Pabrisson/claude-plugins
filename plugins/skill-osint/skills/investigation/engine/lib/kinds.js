import { canonicalIp } from './cidr.js'
import { haversineKm } from './geo.js'
// The kinds of entities a case records, with their lucide icon and color (the vault's graph, the dashboard), and the
// key that says two entities of two cases are the same one. Pure: the dashboard imports it too.
export const KINDS = {
  domain: { icon: 'globe', color: '#4f8cff', label: 'Domain' },
  url: { icon: 'link', color: '#94a3b8', label: 'URL' },
  ip: { icon: 'server', color: '#22c55e', label: 'IP' },
  organization: { icon: 'building-2', color: '#f59e0b', label: 'Organization' },
  person: { icon: 'user', color: '#ec4899', label: 'Person' },
  email: { icon: 'mail', color: '#06b6d4', label: 'Email' },
  account: { icon: 'at-sign', color: '#a855f7', label: 'Account' },
  username: { icon: 'user-round-search', color: '#eab308', label: 'Username' },
  tracker: { icon: 'radar', color: '#ef4444', label: 'Tracker' },
  place: { icon: 'map-pin', color: '#84cc16', label: 'Place' },
  phone: { icon: 'phone', color: '#14b8a6', label: 'Phone' },
  image: { icon: 'image', color: '#f97316', label: 'Image' },
  video: { icon: 'film', color: '#fb923c', label: 'Video' },
}
export function normalize(kind, value, props = {}) {
  let v = String(value).trim()
  if (['domain', 'email'].includes(kind)) v = v.toLowerCase().replace(/\.$/, '')
  else if (kind === 'organization' && props.siren) v = String(props.siren).replace(/\D/g, '')
  else if (kind === 'phone') {
    v = v.replace(/[^\d+]/g, '')
    // one number of the French national plan is one identifier, whatever its writing: 06 39…, +33 6 39…, or +262 639… (ARCEP gives 0639 to Mayotte)
    const m = /^\+(33|262|590|594|596|508)(\d+)$/.exec(v), nat = m ? (m[1] === '508' && m[2].length === 6 ? `0508${m[2]}` : `0${m[2]}`) : /^0\d{9}$/.test(v) ? v : null
    if (nat) v = `fr:${nat}`
  }
  else if (['account', 'url'].includes(kind)) v = v.toLowerCase().replace(/\/+$/, '')
  else if (kind === 'place' && props.osm) v = String(props.osm).toLowerCase()
  // an IP's coarse location (a circle, no lat/lon) never shares a key with a precise place of the same name
  else if (kind === 'place' && props.coarse) v = `coarse:${v.toLowerCase()}`
  else if (['image', 'video'].includes(kind) && props.sha256) v = String(props.sha256).toLowerCase()
  // two people of one name are the same only with the same month of birth (a company's officers)
  // (a namesake is written « Jean Durand (1961-04) »: its birth is in the key once, not twice)
  else if (kind === 'person' && props.born) v = `${v.toLowerCase().replace(/ \((\d{4}(-\d\d)?|\?)\)$/, '')} ${String(props.born).slice(0, 7)}`
  else if (kind === 'ip') v = canonicalIp(v) ?? v.toLowerCase()
  else v = v.toLowerCase()
  return `${kind}:${v}`
}
// what a clue rests on, and the cap of its likelihood ratio (GeoINT's board): only a text read or a calculation
// excludes a hypothesis
export const CAPS = { read: 50, computed: 50, observed: 5, inferred: 3, model: 3 }
export const EXCLUDERS = ['read', 'computed']

// § 2.7: two places of two cases are one when they share an OpenStreetMap id, or, when one of them has none, stand
// within 100 m of each other. A coarse place (an IP's circle: `coarse`, `center`, no lat/lon) has no point.
export const PLACE_M = 100
const num = x => (x == null || x === '' ? NaN : Number(x))
export function placePoint(p) {
  const lat = num(p?.lat), lon = num(p?.lon)
  return !p?.coarse && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [lat, lon] : null
}
// A place with an identifier (an OSM id, a SIRET: an establishment) is that place only: two of them are one when the
// identifiers are the same, never by distance (two shops of one street). The 100 m rule is for the others: the
// subject place, an address, a photo's position.
const idOf = p => (p?.osm ? `osm:${String(p.osm).toLowerCase()}` : p?.siret ? `siret:${String(p.siret).replace(/\D/g, '')}` : null)
export function samePlace(a, b) {
  const x = idOf(a), y = idOf(b)
  if (x && y) {
    if (x === y) return true
    // an OSM id against a SIRET: one place only when the OSM one is the building itself (or the subject), not a shop next door
    const osm = x.startsWith('osm:') ? a : y.startsWith('osm:') ? b : null
    if (!(x.startsWith('osm:') !== y.startsWith('osm:')) || !(osm?.role === 'building' || a?.role === 'subject' || b?.role === 'subject')) return false
  }
  const p = placePoint(a), q = placePoint(b)
  return !!(p && q) && haversineKm(p, q) * 1000 <= PLACE_M
}
