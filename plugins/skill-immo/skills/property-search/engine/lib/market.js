import { median } from './dvf.js'

// A listing against its market, shared by Node and the dashboard: its type, the criteria it meets, its days online,
// where its unit price stands against the sold one (DVF) and the margin a buyer may negotiate.

const DAY = 86400000
const LETTERS = 'ABCDEFG'

// The types of property a search covers, with Stream Estate's codes (v1: apartment 0, house 1, parking 3, office 4,
// land 5, shop 6; a whole building, 2, is not searched), and the criteria each takes: a parking has no rooms, a plot no
// DPE. A listing without a type is a flat (the searches made before the types).
export const TYPES = { flat: [0], house: [1], land: [5], parking: [3], premises: [4, 6] }
const TAKES = {
  flat: ['budget', 'area', 'rooms', 'floor', 'dpe', 'elevator', 'outdoor'], house: ['budget', 'area', 'rooms', 'dpe', 'outdoor', 'land'],
  land: ['budget', 'land'], parking: ['budget'], premises: ['budget', 'area'],
}
export const typeOf = l => l.property_type ?? 'flat'
// does a criterion (budget_max, rooms_min, elevator…) apply to a type
export const takes = (type, criterion) => TAKES[type]?.includes(criterion.replace(/_(min|max)$/, '')) ?? false
export const isHome = type => type === 'flat' || type === 'house'
// what a listing is weighed on: its price per m² (of land, for a plot), or its price, for a parking
export const unitPrice = l => (typeOf(l) === 'parking' ? l.price : l.price_per_m2)

// a listing the search keeps: one of its types, and the criteria that apply to it (an unknown value passes)
export function matches(l, c = {}, types) {
  const t = typeOf(l), on = k => takes(t, k)
  const ok = (v, min, max) => v == null || ((min == null || v >= min) && (max == null || v <= max))
  return (!types || types.includes(t)) && ok(l.price, c.budget_min, c.budget_max)
    && (!on('area') || ok(l.area, c.area_min, c.area_max)) && (!on('rooms') || ok(l.rooms, c.rooms_min, c.rooms_max))
    && (!on('floor') || ok(l.floor, c.floor_min, null)) && (!on('land') || ok(l.land_area, c.land_min, null))
    && (!on('dpe') || !c.dpe_max || !l.dpe?.energy || LETTERS.indexOf(l.dpe.energy) <= LETTERS.indexOf(c.dpe_max))
    && (!on('elevator') || !c.elevator || l.features?.elevator !== false)
    && (!on('outdoor') || !c.outdoor || ![l.features?.balcony, l.features?.terrace, l.features?.garden].every(x => x === false))
}

// The sold unit price a listing of this type is weighed against: the zone's last two years when they hold 10 sales,
// else its five years, else the commune's (none in Alsace-Moselle, which DVF leaves out)
export function reference(m, type = 'flat') {
  const d = m?.dvf?.[type]
  for (const scope of ['recent', 'zone', 'commune']) if (d?.[scope]?.count >= 10) return { ppm2: d[scope].median_ppm2, scope, count: d[scope].count, type }
  return null
}

// the zone's asking price per m² (market -p): its last month, else its median over two years
export const asking = (m, type = 'flat') => (m?.stream && (m.stream.type ?? 'flat') === type ? Object.values(m.stream.series ?? {}).at(-1) ?? m.stream.median ?? null : null)

// days since the listing was first published (or first seen here)
export const daysOnline = (l, now = Date.now()) => {
  const since = l.published_at ?? l.first_seen
  return since ? Math.max(0, Math.floor((now - Date.parse(since)) / DAY)) : null
}

// when a listing went offline (its « expired » change), or null while it is online
export const gone = l => {
  const c = l.changes?.find(x => x.kind === 'expired')?.date
  return c ? Date.parse(c) : l.status === 'EXPIRED' ? Date.parse(l.first_seen) : null
}

// the drop already made, from the first known price to the current one (0.08 = 8 % off)
export function dropped(l) {
  const prices = [...(l.price_changes ?? []).map(c => c.from), ...(l.price_history ?? []).map(h => h.price)].filter(x => x > 0)
  const top = Math.max(l.price ?? 0, ...prices)
  return top > 0 && l.price ? Math.max(0, (top - l.price) / top) : 0
}

// The asking price over time, for the dossier's chart: the portals' changes (they can predate the search) and the
// prices the search saw, from the first known price to `now`, one step a change, each with its change from the step
// before (`pct`, -0.05 = 5 % off). The first price starts at the listing's publication or first sight when they come
// before its first change, else at that change.
export function priceSteps(l, now = new Date().toISOString()) {
  const changes = [...(l.price_changes ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  const start = changes[0] && { date: [l.published_at, l.first_seen].filter(d => d && d < changes[0].date).sort()[0] ?? changes[0].date, price: changes[0].from }
  // the start first: at the same date as the first change, it still comes before it (the sort keeps the order of ties)
  const points = [start, ...(l.price_history ?? []), ...changes.map(c => ({ date: c.date, price: c.to }))].filter(p => p?.price > 0).sort((a, b) => a.date.localeCompare(b.date))
  const steps = []
  for (const p of points) if (p.price !== steps.at(-1)?.price) steps.push({ date: p.date, price: p.price, pct: steps.length ? p.price / steps.at(-1).price - 1 : null })
  if (steps.length && steps.at(-1).date < now) steps.push({ date: now, price: steps.at(-1).price, pct: null })
  return steps
}

// below, at or above the market: within 5 % of the sold median is "at"
export function badge(ppm2, ref) {
  if (!ppm2 || !ref) return null
  const gap = (ppm2 - ref) / ref
  return { gap: Math.round(gap * 1000) / 1000, level: gap < -0.05 ? 'below' : gap > 0.05 ? 'above' : 'at' }
}

// The margin to negotiate, as a range of the asking price, with its reasons. 3 % is the usual gap between asked and
// sold prices; half of the excess over the sold median, a long time online and the urgent flag add to it, a drop
// already made takes from it.
// ponytail: a flat heuristic on four signals, a model fitted on the listings that sold when there are enough
export function negotiation(l, ref, now = Date.now()) {
  if (!l.price || l.status === 'UNDER_OFFER' || l.status === 'SOLD' || l.status === 'EXPIRED') return null
  const reasons = [], b = badge(unitPrice(l), ref), days = daysOnline(l, now), drop = dropped(l)
  let m = 0.03
  if (b?.gap > 0) { m += b.gap / 2; reasons.push(['above_market', b.gap]) }
  if (days > 90) { m += 0.02; reasons.push(['days_online', days]) }
  if (days > 180) m += 0.02
  if (l.urgent) { m += 0.02; reasons.push(['urgent', true]) }
  if (drop > 0) { m -= Math.min(drop, 0.05) / 2; reasons.push(['already_dropped', Math.round(drop * 1000) / 1000]) }
  m = Math.min(0.15, Math.max(0, m))
  const round = x => Math.round(x * 1000) / 1000
  return { low: round(m * 0.6), high: round(m), reasons }
}

// A group of listings as a market (the dashboard's study by label): what they ask, what they are, how fast they go and
// what the user made of them. `ref` the zone's sold unit price, `rooms` its sold prices by size (DVF by_rooms rows, 5
// for 5 and more), `budget` the criteria's max, `score` a listing's score. The expired listings count until they went
// offline; a feature the listing does not mention counts as absent.
/** @param {any[]} ls @param {{ ref?: number | null, rooms?: { rooms: number, median_ppm2: number }[], budget?: number | null, score?: (l: any) => number | null, now?: number }} [opts] */
export function study(ls, { ref = null, rooms = [], budget = null, score = () => null, now = Date.now() } = {}) {
  const n = ls.length, pos = xs => xs.filter(x => x != null && x > 0), some = xs => xs.filter(x => x != null)
  const part = f => (n ? ls.filter(f).length / n : null), count = f => ls.filter(f).length
  const tally = (keys, of) => Object.fromEntries(keys.map(k => [k, count(l => of(l) === k)]))
  const ppm2s = pos(ls.map(unitPrice)), off = ls.filter(l => gone(l) != null), recent = t => t != null && t > now - 30 * DAY
  // each listing against the sales of its size: a group of small homes is not dearer only for being small
  const bySize = Object.fromEntries(rooms.map(r => [r.rooms, r.median_ppm2]))
  const gaps = some(ls.map(l => badge(unitPrice(l), (l.rooms && bySize[Math.min(5, l.rooms)]) || ref)?.gap))
  const margins = ls.map(l => negotiation(l, ref, now)).filter(Boolean)
  const drops = ls.map(dropped).filter(x => x > 0), dpe = tally([...LETTERS], l => l.dpe?.energy)
  const dpeKnown = Object.values(dpe).reduce((a, b) => a + b, 0)
  const scored = ls.map(l => ({ id: l.id, value: score(l) })).filter(s => s.value != null)
  const f = (l, k) => l.features?.[k] === true
  // the median of shares (dvf's median rounds to units)
  const mid = xs => (xs.length ? median(xs.map(x => x * 1000)) / 1000 : null)
  return {
    n, expired: count(l => l.status === 'EXPIRED'),
    price: median(pos(ls.map(l => l.price))), area: median(pos(ls.map(l => l.area ?? l.land_area))), land: median(pos(ls.map(l => l.land_area))),
    ppm2: median(ppm2s), ppm2_min: ppm2s.length ? Math.min(...ppm2s) : null, ppm2_max: ppm2s.length ? Math.max(...ppm2s) : null,
    gap_size: mid(gaps),
    margin: margins.length ? { low: mid(margins.map(m => m.low)), high: mid(margins.map(m => m.high)) } : null,
    in_budget: budget ? part(l => l.price > 0 && l.price <= budget) : null,
    rooms: tally([1, 2, 3, 4, 5], l => (l.rooms ? Math.min(5, l.rooms) : null)),
    dpe, poor: dpeKnown ? (dpe.F + dpe.G) / dpeKnown : null,
    outdoor: part(l => f(l, 'balcony') || f(l, 'terrace') || f(l, 'garden')), parking: part(l => f(l, 'parking')), elevator: part(l => f(l, 'elevator')),
    floor: median(some(ls.map(l => l.floor))), year: median(pos(ls.map(l => l.construction_year ?? l.building?.construction_year))),
    added: count(l => recent(Date.parse(l.first_seen))), removed: count(l => recent(gone(l))),
    days: median(some(ls.map(l => daysOnline(l, gone(l) ?? now)))), days_off: median(some(off.map(l => daysOnline(l, gone(l))))),
    drops: part(l => dropped(l) > 0), drop: mid(drops),
    favorites: count(l => l.favorite), dismissed: count(l => l.my_status === 'dropped'),
    score: scored.length ? median(scored.map(s => s.value)) : null, best: scored.toSorted((a, b) => b.value - a.value)[0] ?? null,
  }
}
