// geo-DVF: the real sales of a commune (one CSV per year, one row per local or lot of a mutation). An apartment sale
// is a mutation (id_mutation) that sells exactly one apartment: its cellar or parking (Dépendance, no surface) may
// come with it, another apartment, a house or a shop may not, so the price per m² stays the apartment's.

const LOCALS = ['Maison', 'Local industriel. commercial ou assimilé']

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

// the apartment sales of DVF rows: { id, date, price, area, rooms, ppm2, point, number, street, code_voie, deps }
export function apartmentSales(rows) {
  const byMutation = Map.groupBy(rows, r => r.id_mutation), sales = []
  for (const [id, rs] of byMutation) {
    if (rs[0].nature_mutation !== 'Vente' || rs.some(r => LOCALS.includes(r.type_local))) continue
    // a local spread over several parcels repeats its row: one apartment is one parcel, lot and surface
    const apts = [...new Map(rs.filter(r => r.type_local === 'Appartement').map(r => [`${r.id_parcelle}|${r.lot1_numero}|${r.surface_reelle_bati}`, r])).values()]
    if (apts.length !== 1) continue
    const a = apts[0], area = +a.lot1_surface_carrez || +a.surface_reelle_bati, price = +a.valeur_fonciere
    if (!(area >= 9) || !(price > 0)) continue
    const ppm2 = Math.round(price / area)
    // a symbolic price or a typo in the surface
    if (ppm2 < 500 || ppm2 > 30000) continue
    sales.push({
      id, date: a.date_mutation, price, area: Math.round(area * 10) / 10, rooms: +a.nombre_pieces_principales || null, ppm2,
      point: a.longitude && a.latitude ? [+a.longitude, +a.latitude] : null,
      number: a.adresse_numero ? `${a.adresse_numero}${a.adresse_suffixe ?? ''}` : null, street: a.adresse_nom_voie, code_voie: a.adresse_code_voie,
      deps: rs.filter(r => r.type_local === 'Dépendance').length,
    })
  }
  return sales.sort((x, y) => x.date.localeCompare(y.date))
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

// The market of a search from its commune's sales: the street (its code_voie), the zone (`inZone(point)`) and the
// commune, over every year given; the last two years of the zone as points for the map.
export function summary(sales, { inZone, code_voie, since, points = 400 }) {
  const zone = sales.filter(s => s.point && inZone(s.point)), recent = zone.filter(s => s.date >= since)
  return {
    commune: stats(sales),
    zone: stats(zone),
    street: code_voie ? stats(sales.filter(s => s.code_voie === code_voie)) : null,
    recent: stats(recent),
    years: [...new Set(sales.map(s => s.date.slice(0, 4)))],
    points: recent.slice(-points).map(({ id, date, price, area, rooms, ppm2, point, number, street }) => ({ id, date, price, area, rooms, ppm2, point, address: [number, street].filter(Boolean).join(' ') })),
  }
}

// the sales of one building (same number and street code), newest first
export const building = (sales, number, code_voie) => sales.filter(s => s.code_voie === code_voie && String(s.number) === String(number)).reverse()
