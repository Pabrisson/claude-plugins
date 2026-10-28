// The recent DPE of a zone against its listings, shared by Node and the dashboard. A DPE comes before a sale or a lease:
// a recent one that no listing matches may be a home about to go on sale.
import { distance } from './geo.js'
import { matches, typeOf } from './market.js'

const DAY = 86400000
const sameArea = (a, b) => !!a && !!b && Math.abs(a - b) / b < 0.08

// The listing each recent DPE belongs to, as its number → { id, how }. A listing takes one DPE at most, the surest way
// first: its own number (the registry's DPE the enrichment matched, the listing's own reference). A listing whose number is known takes no other one (its DPE is older). Else the DPE of its BAN address
// with the closest surface (within 8 %), else, for a listing placed roughly, the nearest of the same type and surface
// within 300 m, with its class and date when it gives them. A DPE taken goes to no other listing.
// ponytail: greedy in the listings' order; an optimal assignment if two listings often compete for one DPE
export function matchDpe(rows, listings) {
  const out = new Map(), recent = new Set(rows.map(d => d.number))
  const numbers = l => [l.building?.dpe_match, l.dpe?.reference].filter(Boolean)
  for (const l of listings) for (const n of numbers(l)) if (recent.has(n) && !out.has(n)) out.set(n, { id: l.id, how: 'number' })
  const take = (l, how, ok, by) => {
    const d = rows.filter(d => !out.has(d.number) && ok(d)).sort((a, b) => by(a) - by(b))[0]
    if (d) out.set(d.number, { id: l.id, how })
    return !!d
  }
  for (const l of listings) {
    if (numbers(l).length) continue
    const p = l.location?.point
    take(l, 'address', d => !!d.ban && l.building?.ban === d.ban && sameArea(d.area, l.area), d => Math.abs(d.area - l.area))
      || (p && take(l, 'near', d => typeOf(l) === d.type && sameArea(d.area, l.area) && distance(p, d.point) <= 300
        && (!l.dpe?.energy || l.dpe.energy === d.energy) && (!l.dpe?.date || l.dpe.date.slice(0, 10) === d.date), d => distance(p, d.point)))
  }
  return out
}

// The recent DPE the map shows: those of the last `days` days (of the search's types and criteria when `types` is
// given), each with its listing or null (matched over all the rows, whatever the period), grouped per address (its BAN
// id, else its point), newest first
export function recentDpe(rows, listings, { days = 365, criteria = {}, types, now = Date.now() } = {}) {
  const since = new Date(now - days * DAY).toISOString().slice(0, 10), owner = matchDpe(rows, listings), out = new Map()
  for (const d of rows) {
    if (d.date < since || (types && !matches({ property_type: d.type, area: d.area, dpe: { energy: d.energy } }, criteria, types))) continue
    const key = d.ban ?? d.point.join(',')
    if (!out.has(key)) out.set(key, { key, point: d.point, address: d.address, items: [] })
    out.get(key).items.push({ ...d, listing: owner.get(d.number) ?? null })
  }
  return [...out.values()]
}
