// The alerts of a search (<slug>/alerts.json), shared by Node and the dashboard: what of its news reaches « Suivi »,
// the bell, the desktop notifications and Claude's refresh. An alert takes one event, at a place, when all its
// conditions on the news' fields (FIELDS) hold; a news shows when one alert that is on takes it. The listings' events
// happen in the search's zone only; a source's (`anywhere`: the DPE, the energy audits, the building permits) is
// watched at the alert's own place too: a street, around an address, a commune. The default alerts carry the
// follow-up, each on until the user turns it off.
import { distance } from './geo.js'
import { matches, TYPES, typeOf } from './market.js'

const LETTERS = 'ABCDEFG'
// the events, the news kinds each one takes, and whether it may be watched outside the search's zone. A new source:
// an event here with `anywhere` (its news carry their row under their kind: n.dpe, n.audit), its fields below, its
// fetch in opendata.js and immo.mjs (SOURCES)
export const EVENTS = {
  dpe: { kinds: ['dpe'], anywhere: true },
  audit: { kinds: ['audit'], anywhere: true },
  permit: { kinds: ['permit'], anywhere: true },
  new: { kinds: ['new'] },
  price_drop: { kinds: ['price_drop'] },
  price_rise: { kinds: ['price_rise'] },
  status: { kinds: ['status'] },
  expired: { kinds: ['expired'] },
}
export const STATUSES = ['none', 'to_visit', 'visited', 'offer', 'dropped']
// a permit's kind: homes built (a building permit or a prior declaration), a demolition, a plot divided
export const PERMITS = ['build', 'demolish', 'develop']
const LISTING = ['new', 'price_drop', 'price_rise', 'status', 'expired'], HOME = ['dpe', 'audit', ...LISTING]

// the default alerts: alerts.json keeps only the ids turned off (`off`), so a default added later is on
export const DEFAULTS = [
  { id: 'dpe', event: 'dpe', conditions: [{ field: 'criteria', op: 'is', value: true }] },
  { id: 'new', event: 'new', conditions: [] },
  { id: 'price_drop', event: 'price_drop', conditions: [] },
  { id: 'price_rise', event: 'price_rise', conditions: [] },
  { id: 'status', event: 'status', conditions: [] },
  // a listing gone that the user follows (a status of theirs): the others leave the map and the cards quietly
  { id: 'expired', event: 'expired', conditions: [{ field: 'my_status', op: 'not', value: 'none' }] },
  // every new energy audit and building permit of the zone (1.10)
  { id: 'audit', event: 'audit', conditions: [] },
  { id: 'permit', event: 'permit', conditions: [] },
]

// the commune codes a DPE of a commune may carry: Paris, Lyon and Marseille give their arrondissement's
const span = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => `${a + i}`)
const ARRONDISSEMENTS = { 75056: span(75101, 75120), 69123: span(69381, 69389), 13055: span(13201, 13216) }
export const cityCodes = insee => ARRONDISSEMENTS[insee] ?? [insee]

// the street of an address: « 311 bis Rue Paul Bert 69003 Lyon » → « Rue Paul Bert »
export const streetOf = a => a?.split(',')[0].replace(/\s+\d{5}\b.*$/, '').replace(/^\s*\d+\s*(bis|ter|quater|[a-d])?\s+/i, '').trim() || null
// a news' id, for its read mark and the page: its kind, its date and what it is about
export const newsKey = n => `${n.kind}-${n.date}-${n.l?.id ?? n[n.kind]?.number ?? n.count ?? ''}`
// a source's row of a news (its DPE, audit or permit), none for a listing's
export const rowOf = n => (EVENTS[n.kind]?.anywhere ? n[n.kind] : null)
// what a news is about, as a listing: a DPE's or an audit's home, a permit's address, or the listing of a change
const subject = n => {
  const r = rowOf(n)
  if (!r) return n.l
  return n.kind === 'permit' ? { location: { address: r.address } } : { property_type: r.type, area: r.area, dpe: { energy: r.energy }, location: { address: r.address } }
}

// The fields a condition reads, the events that have them, and their kind (the operators it takes). A value the news
// does not give (an address a listing lacks) fails the condition.
export const FIELDS = {
  street: { kind: 'text', events: [...HOME, 'permit'], of: n => streetOf(subject(n).location?.address) },
  type: { kind: 'type', events: HOME, of: n => typeOf(subject(n)) },
  energy: { kind: 'class', events: HOME, of: n => subject(n).dpe?.energy },
  area: { kind: 'number', events: HOME, of: n => subject(n).area },
  price: { kind: 'number', events: LISTING, of: n => n.l.price },
  price_per_m2: { kind: 'number', events: LISTING, of: n => n.l.price_per_m2 },
  rooms: { kind: 'number', events: LISTING, of: n => n.l.rooms },
  change_pct: { kind: 'number', events: ['price_drop', 'price_rise'], of: n => (n.from ? Math.round(Math.abs(n.to - n.from) / n.from * 1000) / 10 : null) },
  favorite: { kind: 'bool', events: LISTING, of: n => !!n.l.favorite },
  my_status: { kind: 'status', events: LISTING, of: n => n.l.my_status ?? 'none' },
  criteria: { kind: 'bool', events: HOME, of: (n, s) => matches(subject(n), s.criteria, s.types ?? ['flat']) },
  building: { kind: 'bool', events: ['audit'], of: n => !!n.audit.building },
  permit_kind: { kind: 'permit', events: ['permit'], of: n => n.permit.kind },
  homes: { kind: 'number', events: ['permit'], of: n => n.permit.homes },
}

const norm = v => String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const is = (v, x) => v === x
export const OPS = {
  text: { contains: (v, x) => norm(v).includes(norm(x)), is: (v, x) => norm(v) === norm(x) },
  number: { gte: (v, x) => v >= x, lte: (v, x) => v <= x },
  class: { lte: (v, x) => LETTERS.includes(v) && v <= x, gte: (v, x) => LETTERS.includes(v) && v >= x },
  type: { is }, status: { is, not: (v, x) => v !== x }, bool: { is }, permit: { is },
}

// is a source's row (a DPE, an audit, a permit) at an alert's place: its BAN id on the street or in the commune (an id
// starts with its commune's code), its point within the circle
export function atPlace(p, d) {
  if (p.how === 'street') return d.ban === p.ban || !!d.ban?.startsWith(`${p.ban}_`)
  if (p.how === 'commune') return cityCodes(p.insee).some(c => !!d.ban?.startsWith(`${c}_`))
  if (p.how === 'radius') return !!d.point && distance(p.point, d.point) <= p.radius_m
  return false
}

// the alerts of a search: the default ones, on unless turned off, then the user's own (one of 1.7 had a list of events)
export const alertsOf = (file = {}) => [
  ...DEFAULTS.map(a => ({ ...a, builtin: true, enabled: !file.off?.includes(a.id) })),
  ...(file.custom ?? []).map(a => (a.event ? a : { ...a, event: a.events?.[0] })),
]

// Does an alert take a news of the search s: its event, its place, its conditions. A news of the zone goes to the
// alerts of the zone, and to those whose place holds it; one the watch found outside the zone (`outside`), to those
// whose place holds it.
export function takes(a, n, s) {
  if (!EVENTS[a.event]?.kinds.includes(n.kind)) return false
  const p = a.place ?? { how: 'zone' }
  if (p.how === 'zone' ? n.outside : !(rowOf(n) && atPlace(p, rowOf(n)))) return false
  return a.conditions.every(c => {
    const f = FIELDS[c.field], v = f?.events.includes(a.event) ? f.of(n, s) : null
    return v != null && OPS[f.kind][c.op](v, c.value)
  })
}
// the alerts on that take a news
export const firing = (alerts, n, s) => alerts.filter(a => a.enabled && takes(a, n, s))

// a street's BAN id: its commune's INSEE code (2A, 2B in Corsica), then FANTOIR's 4 characters or the BAN's newer
// ones (6: `13207_dqffc7`, the Corniche Kennedy)
export const BAN_STREET = /^[0-9AB]{5}_[a-z0-9]{4,8}$/i

// an alert's place, checked: the search's zone, else (for an event watched anywhere) a street by its BAN id, a
// commune by its code, a circle of 50 m to 3 km, each with its label and point
function cleanPlace(p, event) {
  if (!p || p.how === 'zone') return { how: 'zone' }
  if (!EVENTS[event].anywhere) throw new Error(`${event} is watched in the search's zone only`)
  const label = String(p.label ?? '').trim().slice(0, 120), point = p.point?.length === 2 && p.point.every(Number.isFinite) ? [+p.point[0], +p.point[1]] : null
  if (!label || !point) throw new Error('a place needs a label and a point')
  if (p.how === 'street' && BAN_STREET.test(p.ban ?? '')) return { how: 'street', ban: p.ban, label, point }
  if (p.how === 'commune' && /^[0-9AB]{5}$/i.test(p.insee ?? '')) return { how: 'commune', insee: p.insee, label, point }
  if (p.how === 'radius' && +p.radius_m >= 50 && +p.radius_m <= 3000) return { how: 'radius', radius_m: Math.round(+p.radius_m), label, point }
  throw new Error('bad place')
}

// alerts.json as the dashboard or Claude sends it, checked at the door: the default ids turned off, 50 alerts of the
// user's at most, each with a name, one event, its place and 10 conditions at most on that event's fields
export function cleanAlerts(x) {
  const off = [...new Set(x?.off ?? [])].filter(id => DEFAULTS.some(a => a.id === id))
  const custom = (x?.custom ?? []).slice(0, 50).map(a => {
    // an alert of 1.7 had a list of events
    const name = String(a.name ?? '').trim().slice(0, 80), event = a.event ?? a.events?.[0]
    if (!/^[\w-]{1,40}$/.test(a.id ?? '') || !name || !Object.hasOwn(EVENTS, event ?? '')) throw new Error('an alert needs an id, a name and an event')
    const conditions = (a.conditions ?? []).slice(0, 10).map(c => {
      const f = FIELDS[c.field]
      if (!f || !f.events.includes(event) || !OPS[f.kind][c.op]) throw new Error(`bad condition ${c.field} ${c.op} for ${event}`)
      const value = f.kind === 'number' ? (c.value === '' || c.value == null ? NaN : +c.value) : f.kind === 'bool' ? c.value === true : String(c.value ?? '').trim().slice(0, 80)
      const ok = { number: Number.isFinite(value), class: LETTERS.includes(value) && value.length === 1, type: Object.hasOwn(TYPES, value), status: STATUSES.includes(value), permit: PERMITS.includes(value), text: value !== '', bool: true }[f.kind]
      if (!ok) throw new Error(`bad value for ${c.field}`)
      return { field: c.field, op: c.op, value }
    })
    return { id: a.id, name, event, place: cleanPlace(a.place, event), conditions, enabled: a.enabled !== false }
  })
  return { off, custom }
}
