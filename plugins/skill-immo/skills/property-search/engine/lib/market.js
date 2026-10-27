// A listing against its market, shared by Node and the dashboard: its type, the criteria it meets, its days online,
// where its unit price stands against the sold one (DVF) and the margin a buyer may negotiate.

const DAY = 86400000
const LETTERS = 'ABCDEFG'

// The types of property a search covers, as Stream Estate names them, and the criteria each takes: a parking has no
// rooms, a plot no DPE. A listing without a type is a flat (the searches made before the types).
export const TYPES = { flat: ['FLAT'], house: ['HOUSE'], land: ['LAND'], parking: ['PARKING'], premises: ['OFFICE', 'SHOP', 'COMMERCIAL_PREMISES'] }
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
// else its five years, else the commune's, else Stream Estate's reconciled sales (Alsace-Moselle has no DVF)
export function reference(m, type = 'flat') {
  const d = m?.dvf?.[type]
  for (const scope of ['recent', 'zone', 'commune']) if (d?.[scope]?.count >= 10) return { ppm2: d[scope].median_ppm2, scope, count: d[scope].count, type }
  const t = m?.stream?.transactions
  return t?.count >= 10 && (t.type ?? 'flat') === type ? { ppm2: t.median_ppm2, scope: 'transactions', count: t.count, type } : null
}

// days since the listing was first published (or first seen here)
export const daysOnline = (l, now = Date.now()) => {
  const since = l.published_at ?? l.first_seen
  return since ? Math.max(0, Math.floor((now - Date.parse(since)) / DAY)) : null
}

// the drop already made, from the first known price to the current one (0.08 = 8 % off)
export function dropped(l) {
  const prices = [...(l.price_changes ?? []).map(c => c.from), ...(l.price_history ?? []).map(h => h.price)].filter(x => x > 0)
  const top = Math.max(l.price ?? 0, ...prices)
  return top > 0 && l.price ? Math.max(0, (top - l.price) / top) : 0
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
// ponytail: a flat heuristic on four signals, a model fitted on the listings that sold (transactions) when there are enough
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
