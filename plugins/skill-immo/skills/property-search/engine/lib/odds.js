// The odds that a home goes on sale, per IRIS, from public figures only: no person is identified. The base is what
// DVF shows (the homes sold a year against the homes the census counts); successions and separations are what the
// census's people living alone and couples make likely among the owners, at France's rates.
import { matchDpe } from './dpe.js'
import { median } from './dvf.js'
import { bbox, inGeometry, inZone } from './geo.js'

// a year's deaths per person living alone, by age band: France's death rates (INSEE, 2023), averaged over the band
// ponytail: France's rates, not the IRIS's; the department's rates by age if one IRIS seems off
export const MORTALITY = { alone_55_79: 0.013, alone_80: 0.09 }
// the couples (married, in a PACS, living together) that split in a year: about 1 in 100 in France
export const SEPARATION = 0.01

// the dimensions every row of an IRIS shares (where, when, its labels): the others say what a row counts
const META = new Set(['GEO', 'FREQ', 'TIME_PERIOD', 'TRIRIS', 'LAB_IRIS', 'LARGE_DISTRICT', 'TYP_IRIS'])

// The census figures of an IRIS from its Melodi observations (null without any): its homes, its main homes and those
// their owners live in, how many years these owners have lived there on average, its people of 15 and more by
// marital status, and its people living alone of 55 to 79 and of 80 and more; its vacant and second homes, its main
// homes built before 1946, heated with oil, and whose household moved in 10 years ago or more
export function census(observations) {
  if (!observations?.length) return null
  const key = dims => dims.sort().join('|')
  const rows = new Map(observations.map(o => [key(Object.entries(o.dimensions).filter(([k, v]) => !META.has(k) && v !== '_T').map(([k, v]) => `${k}=${v}`)), o.measures.OBS_VALUE_NIVEAU?.value]))
  const raw = (...dims) => rows.get(key(dims)) ?? null
  const at = (...dims) => (raw(...dims) == null ? null : Math.round(raw(...dims)))
  const status = s => at('RP_MEASURE=POP', 'AGE=Y_GE15', `CIVIL_STATUS=${s}`)
  const owners = at('RP_MEASURE=DWELLINGS', 'OCS=DW_MAIN', 'TSH=100'), stay = raw('RP_MEASURE=DWELLING_L_STAY', 'OCS=DW_MAIN', 'TSH=100')
  const main = (...dims) => raw('RP_MEASURE=DWELLINGS', 'OCS=DW_MAIN', ...dims), old = [main('BUILD_END=Y_LT1919'), main('BUILD_END=Y1919T1945')]
  return {
    year: +observations[0].dimensions.TIME_PERIOD,
    homes: at('RP_MEASURE=DWELLINGS'), main: at('RP_MEASURE=DWELLINGS', 'OCS=DW_MAIN'), owners, owner_years: owners && stay != null ? Math.round(stay / owners) : null,
    married: status(1), pacsed: status(2), cohabiting: status(3), widowed: status(4), divorced: status(5),
    alone_55_79: at('RP_MEASURE=ONEPERS', 'NOC=P1', 'OCS=DW_MAIN', 'AGE=Y55T79'), alone_80: at('RP_MEASURE=ONEPERS', 'NOC=P1', 'OCS=DW_MAIN', 'AGE=Y_GE80'),
    vacant: at('RP_MEASURE=DWELLINGS', 'OCS=DW_VAC'), secondary: at('RP_MEASURE=DWELLINGS', 'OCS=DW_SEC_DW_OCC'),
    before_1946: old.every(x => x == null) ? null : Math.round(old.reduce((a, x) => a + (x ?? 0), 0)),
    oil: at('RP_MEASURE=DWELLINGS', 'OCS=DW_MAIN', 'NRG_SRC=OIL'), settled_10: at('RP_MEASURE=DWELLINGS', 'OCS=DW_MAIN', 'L_STAY=Y_GE10'),
  }
}

// Each IRIS with its census and its odds:
// - sold: its flats and houses DVF counts a year, over `years`, null without DVF (Alsace-Moselle, no year);
// - odds: the share of its homes sold in a year, the odds that one of them goes on sale within 12 months;
// - successions, separations: the sales a year likely to follow a death of an owner living alone, a couple of owners
//   splitting (the owners' share of its main homes stands for the owners' share of these people);
// - ppm2, ppm2_flat, ppm2_house: the median € per m² of its homes sold over `years`, flats and houses together then
//   apart, from 5 sales on (null below).
// `censusOf` maps an IRIS code to its Melodi observations, `salesOf` a commune to its DVF sales.
// ponytail: DVF's sales of one home only (a flat with its cellar), several homes sold at once are left out
export function irisOdds(iris, censusOf, salesOf, years) {
  const r1 = x => Math.round(x * 10) / 10, ppm2 = xs => (xs?.length >= 5 ? median(xs.map(x => x.ppm2)) : null)
  return iris.map(i => {
    const c = census(censusOf[i.code]), [w, s, e, n] = bbox({ kind: 'polygon', geometry: i.geometry })
    const sales = years.length ? (salesOf[i.insee] ?? null) : null
    const homes = sales && sales.filter(x => x.point && (x.type === 'flat' || x.type === 'house') && years.includes(x.date.slice(0, 4))
      && x.point[0] >= w && x.point[0] <= e && x.point[1] >= s && x.point[1] <= n && inGeometry(x.point, i.geometry))
    const sold = homes && homes.length / years.length
    const owned = c?.main ? (c.owners ?? 0) / c.main : null, n0 = x => x ?? 0
    return {
      ...i, census: c, sold: sold == null ? null : r1(sold), odds: sold != null && c?.homes ? Math.min(1, sold / c.homes) : null,
      successions: owned == null ? null : r1((n0(c.alone_55_79) * MORTALITY.alone_55_79 + n0(c.alone_80) * MORTALITY.alone_80) * owned),
      separations: owned == null ? null : r1(((n0(c.married) + n0(c.pacsed) + n0(c.cohabiting)) / 2) * SEPARATION * owned),
      ppm2: ppm2(homes), ppm2_flat: ppm2(homes?.filter(x => x.type === 'flat')), ppm2_house: ppm2(homes?.filter(x => x.type === 'house')),
    }
  })
}

// The odds that an address goes on sale soon (the dashboard's « Estimations »), from what the open data says of it:
// each recent DPE, energy audit and building permit a chance p, together 1 − Π(1 − p), that one of its homes at least
// goes on sale. A DPE comes before a sale or a lease: its chance is the share of sales in what its IRIS puts on the
// market, at least G_SALE for a G (it can no longer be let since 2025). The DPE of one day are one signal (one owner
// diagnosing a whole building, or one home diagnosed twice). An audit is due to sell a house or a whole building rated
// E, F or G, or made for a renovation grant. Both fade with their age (a listing follows within weeks); a permit is a
// programme. A DPE a listing of the search has is on sale already: left out.
// ponytail: weights reasoned, not measured; calibrate them on DVF's sales at the DPE's address within 12 months
export const TURNOVER = 0.2
export const SALE_SHARE = 0.3
export const G_SALE = 0.8
export const AUDIT_SALE = 0.5
export const PERMIT_SALE = { develop: 0.7, homes: 0.6, demolish: 0.5, home: 0.1 }
// a DPE's or an audit's chance kept by its age in days: whole for 2 months, half to 6, a quarter after
const FADE = [[60, 1], [180, 0.5], [Infinity, 0.25]]
const DAY = 86400000

// the share of sales in what an IRIS puts on the market a year: its DVF sales against its tenants moving out (one in
// TURNOVER a year), France's share without figures
export function saleShare(i) {
  const c = i?.census, moves = c?.main != null && c.owners != null ? (c.main - c.owners) * TURNOVER : null
  return i?.sold != null && moves != null && i.sold + moves > 0 ? i.sold / (i.sold + moves) : SALE_SHARE
}

// Each address (its BAN id, else its point) of the DPE, audits and permits given, with its signals and their chance
// (a DPE's: its day's `rows`, the likeliest as its `row`), its IRIS's code and sales share (`sale`, when it has a DPE),
// whether it is out of the search's `zone` (its listings unknown) and its `odds`; likeliest first, those without a
// chance left out
/** @param {{ dpe?: any[], audits?: any[], permits?: any[] }} rows @param {any[]} iris @param {{ listings?: any[], zone?: any, now?: number }} [opts] */
export function addressOdds({ dpe = [], audits = [], permits = [] }, iris, { listings = [], zone = null, now = Date.now() } = {}) {
  const listed = matchDpe(dpe, listings), boxes = iris.map(i => [i, bbox({ kind: 'polygon', geometry: i.geometry })])
  const irisOf = p => boxes.find(([i, [w, s, e, n]]) => p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n && inGeometry(p, i.geometry))?.[0]
  const fade = date => FADE.find(([days]) => (now - Date.parse(date)) / DAY <= days)[1]
  const permit = p => (p.kind === 'build' ? (p.homes >= 2 ? PERMIT_SALE.homes : PERMIT_SALE.home) : PERMIT_SALE[p.kind])
  const places = new Map()
  for (const [kind, rows] of [['dpe', dpe.filter(d => !listed.has(d.number))], ['audit', audits], ['permit', permits]]) for (const row of rows) {
    const key = row.ban ?? row.point.join(',')
    if (!places.has(key)) places.set(key, { key, point: row.point, address: null, signals: [] })
    const g = places.get(key)
    g.address ??= row.address
    const day = kind === 'dpe' && g.signals.find(s => s.kind === 'dpe' && s.row.date === row.date)
    if (day) day.rows.push(row)
    else g.signals.push(kind === 'dpe' ? { kind, row, rows: [row] } : { kind, row })
  }
  return [...places.values()].map(g => {
    const i = irisOf(g.point), sale = g.signals.some(s => s.kind === 'dpe') ? saleShare(i) : null
    const signals = g.signals.map(s => {
      if (s.kind === 'permit') return { ...s, p: permit(s.row) }
      const row = s.rows?.find(d => d.energy === 'G') ?? s.row
      return { ...s, row, p: fade(row.date) * (s.kind === 'audit' ? AUDIT_SALE : row.energy === 'G' ? Math.max(sale, G_SALE) : sale) }
    })
    return { ...g, iris: i?.code ?? null, out: !!zone && !inZone(g.point, zone), sale, signals: signals.sort((a, b) => b.p - a.p), odds: 1 - signals.reduce((a, s) => a * (1 - s.p), 1) }
  }).filter(g => g.odds > 0).sort((a, b) => b.odds - a.odds)
}
