import { distance } from './geo.js'

// geo-DVF: the real sales of a commune (one CSV per year, one row per local or lot of a mutation). A mutation
// (id_mutation) counts as the sale of one property when it sells exactly one local of one type, so its price per m²
// is that local's:
// - a flat, a house or a shop or office (premises): one local, its cellars and parkings (Dépendance) allowed;
// - a plot (land): no local, only building land, soils, gardens or leisure land (not farmland);
// - a parking: one lot, alone.

const LOCAL = { flat: 'Appartement', house: 'Maison', premises: 'Local industriel. commercial ou assimilé' }
const LAND = ['AB', 'S', 'J', 'AG']
// the unit price of each type, and what is too low or too high to be a real sale (a symbolic price, a typo)
const BOUNDS = { flat: [500, 30000], house: [500, 30000], premises: [200, 30000], land: [5, 5000], parking: [1000, 200000] }

// RFC 4180 CSV into objects keyed by the header (geo-DVF quotes only the fields with commas)
export function parseCsv(text) {
  const rows = [], row = [], s = text.replace(/\r\n?/g, '\n')
  let field = '', quoted = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') field += s[++i]
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row.splice(0)); field = '' }
    else field += c
  }
  if (field || row.length) { row.push(field); rows.push(row.splice(0)) }
  const [head, ...body] = rows
  return body.filter(r => r.length === head.length).map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])))
}

// the sales of DVF rows: { id, type, date, price, area, land, rooms, ppm2, point, number, street, code_voie, deps }.
// ppm2 is the unit price: € per m² (of land for a plot), or € for the lot of a parking.
export function dvfSales(rows) {
  const out = []
  for (const [id, rs] of Map.groupBy(rows, r => r.id_mutation)) {
    const price = +rs[0].valeur_fonciere
    if (rs[0].nature_mutation !== 'Vente' || !(price > 0)) continue
    // a local spread over several parcels repeats its row: one local is one parcel, lot and surface
    const locals = name => [...new Map(rs.filter(r => r.type_local === name).map(r => [`${r.id_parcelle}|${r.lot1_numero}|${r.surface_reelle_bati}`, r])).values()]
    const kinds = Object.entries(LOCAL).map(([t, name]) => [t, locals(name)]).filter(([, ls]) => ls.length)
    const deps = rs.filter(r => r.type_local === 'Dépendance')
    // the land of the mutation: each parcel and culture once
    const land = [...new Map(rs.filter(r => +r.surface_terrain > 0).map(r => [`${r.id_parcelle}|${r.code_nature_culture}`, r])).values()]
    const landArea = land.reduce((a, r) => a + +r.surface_terrain, 0)
    let type, a, area
    if (kinds.length === 1 && kinds[0][1].length === 1) {
      [type, [a]] = kinds[0]
      area = type === 'flat' ? +a.lot1_surface_carrez || +a.surface_reelle_bati : +a.surface_reelle_bati
      if (!(area >= 9)) continue
    } else if (!kinds.length && !deps.length && land.length && land.every(r => LAND.includes(r.code_nature_culture))) {
      [type, a, area] = ['land', land[0], landArea]
      if (!(area >= 50)) continue
    } else if (!kinds.length && deps.length === rs.length && new Set(deps.map(r => `${r.id_parcelle}|${r.lot1_numero}`)).size === 1) {
      [type, a, area] = ['parking', deps[0], null]
    } else continue
    const ppm2 = Math.round(area ? price / area : price), [lo, hi] = BOUNDS[type]
    if (ppm2 < lo || ppm2 > hi) continue
    out.push({
      id, type, date: a.date_mutation, price, area: area && Math.round(area * 10) / 10, land: type === 'house' && landArea ? landArea : null,
      rooms: +a.nombre_pieces_principales || null, ppm2, point: a.longitude && a.latitude ? [+a.longitude, +a.latitude] : null,
      number: a.adresse_numero ? `${a.adresse_numero}${a.adresse_suffixe ?? ''}` : null, street: a.adresse_nom_voie, code_voie: a.adresse_code_voie,
      deps: type === 'parking' ? 0 : deps.length,
    })
  }
  return out.sort((x, y) => x.date.localeCompare(y.date))
}

export function quantile(xs, q) {
  if (!xs.length) return null
  const s = xs.toSorted((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i)
  return Math.round(s[lo] + (s[Math.ceil(i)] - s[lo]) * (i - lo))
}
export const median = xs => quantile(xs, 0.5)

const quarter = d => `${d.slice(0, 4)}-Q${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}`

// the price per m² of a set of sales: count, median, quartiles, and per quarter (DVF is too thin per month on a street)
export function stats(sales) {
  const p = sales.map(s => s.ppm2)
  return {
    count: sales.length, median_ppm2: median(p), q1: quantile(p, 0.25), q3: quantile(p, 0.75),
    median_price: median(sales.map(s => s.price)), median_area: median(sales.map(s => s.area)),
    by_quarter: [...Map.groupBy(sales, s => quarter(s.date))].map(([q, ss]) => ({ quarter: q, count: ss.length, median_ppm2: median(ss.map(s => s.ppm2)) })),
  }
}

const monthsBefore = (d, n) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() - n); return x.toISOString().slice(0, 10) }
const ratio = (a, b) => (a && b ? Math.round((a / b - 1) * 1000) / 1000 : null)
// How the median unit price moved: its last 12 months (to the newest sale, DVF lags by about 6 months) against the
// 12 months one and three years before, with 10 sales at least on each side, else null.
export function trend(sales) {
  const to = sales.at(-1)?.date
  if (!to) return null
  const year = back => sales.filter(s => s.date > monthsBefore(to, 12 * (back + 1)) && s.date <= monthsBefore(to, 12 * back)).map(s => s.ppm2)
  const [now, y1, y3] = [year(0), year(1), year(3)].map(p => (p.length >= 10 ? median(p) : null))
  return { to, median_ppm2: now, y1: ratio(now, y1), y3: ratio(now, y3) }
}

// what a home costs by its number of rooms (5 and more together), on 3 sales or more
export const byRooms = sales => [...Map.groupBy(sales.filter(s => s.rooms), s => Math.min(5, s.rooms))]
  .filter(([, ss]) => ss.length >= 3).sort(([a], [b]) => a - b)
  .map(([rooms, ss]) => ({ rooms, count: ss.length, median_price: median(ss.map(s => s.price)), median_area: median(ss.map(s => s.area)), median_ppm2: median(ss.map(s => s.ppm2)) }))

// The streets of the commune with 5 sales or more, the nearest to `center` first: their median unit price, its move
// (the last two years against the years before, 3 sales on each side) and their middle point.
export function streets(sales, { center, since, max = 40 }) {
  const out = []
  for (const [code, ss] of Map.groupBy(sales.filter(s => s.code_voie && s.point), s => s.code_voie)) {
    if (ss.length < 5) continue
    const point = [median(ss.map(s => s.point[0] * 1e6)) / 1e6, median(ss.map(s => s.point[1] * 1e6)) / 1e6]
    const late = ss.filter(s => s.date >= since).map(s => s.ppm2), early = ss.filter(s => s.date < since).map(s => s.ppm2)
    out.push({
      code_voie: code, name: ss[0].street, count: ss.length, median_ppm2: median(ss.map(s => s.ppm2)), point,
      change: late.length >= 3 && early.length >= 3 ? ratio(median(late), median(early)) : null, distance: center ? Math.round(distance(point, center)) : null,
    })
  }
  return out.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0)).slice(0, max)
}

// The market of one type of property from its commune's sales: the street (its code_voie), the zone (`inZone(point)`)
// and the commune, over every year given; how the zone's and the commune's prices move, the prices by rooms (the
// zone's last two years, or its five when they are too few), the commune's streets around `center`, and the zone's
// last two years as points for the map.
export function summary(sales, { inZone, code_voie, since, center, points = 400 }) {
  const zone = sales.filter(s => s.point && inZone(s.point)), recent = zone.filter(s => s.date >= since)
  const rooms = recent.length >= 30 ? recent : zone
  return {
    commune: stats(sales),
    zone: stats(zone),
    street: code_voie ? stats(sales.filter(s => s.code_voie === code_voie)) : null,
    recent: stats(recent),
    years: [...new Set(sales.map(s => s.date.slice(0, 4)))],
    trend: { zone: trend(zone), commune: trend(sales) },
    by_rooms: { scope: rooms === recent ? 'recent' : 'zone', rows: byRooms(rooms) },
    streets: streets(sales, { center, since }),
    points: recent.slice(-points).map(({ id, type, date, price, area, rooms, ppm2, point, number, street }) => ({ id, type, date, price, area, rooms, ppm2, point, address: [number, street].filter(Boolean).join(' ') })),
  }
}

// the sales of one building (same number and street code), newest first
export const building = (sales, number, code_voie) => sales.filter(s => s.code_voie === code_voie && String(s.number) === String(number)).reverse()
