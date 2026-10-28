// The odds that a home goes on sale, per IRIS, from public figures only: no person is identified. The base is what
// DVF shows (the homes sold a year against the homes the census counts); successions and separations are what the
// census's people living alone and couples make likely among the owners, at France's rates.
import { bbox, inGeometry } from './geo.js'

// a year's deaths per person living alone, by age band: France's death rates (INSEE, 2023), averaged over the band
// ponytail: France's rates, not the IRIS's; the department's rates by age if one IRIS seems off
export const MORTALITY = { alone_55_79: 0.013, alone_80: 0.09 }
// the couples (married, in a PACS, living together) that split in a year: about 1 in 100 in France
export const SEPARATION = 0.01

// the dimensions every row of an IRIS shares (where, when, its labels): the others say what a row counts
const META = new Set(['GEO', 'FREQ', 'TIME_PERIOD', 'TRIRIS', 'LAB_IRIS', 'LARGE_DISTRICT', 'TYP_IRIS'])

// The census figures of an IRIS from its Melodi observations (null without any): its homes, its main homes and those
// their owners live in, how many years these owners have lived there on average, its people of 15 and more by
// marital status, and its people living alone of 55 to 79 and of 80 and more
export function census(observations) {
  if (!observations?.length) return null
  const key = dims => dims.sort().join('|')
  const rows = new Map(observations.map(o => [key(Object.entries(o.dimensions).filter(([k, v]) => !META.has(k) && v !== '_T').map(([k, v]) => `${k}=${v}`)), o.measures.OBS_VALUE_NIVEAU?.value]))
  const raw = (...dims) => rows.get(key(dims)) ?? null
  const at = (...dims) => (raw(...dims) == null ? null : Math.round(raw(...dims)))
  const status = s => at('RP_MEASURE=POP', 'AGE=Y_GE15', `CIVIL_STATUS=${s}`)
  const owners = at('RP_MEASURE=DWELLINGS', 'OCS=DW_MAIN', 'TSH=100'), stay = raw('RP_MEASURE=DWELLING_L_STAY', 'OCS=DW_MAIN', 'TSH=100')
  return {
    year: +observations[0].dimensions.TIME_PERIOD,
    homes: at('RP_MEASURE=DWELLINGS'), main: at('RP_MEASURE=DWELLINGS', 'OCS=DW_MAIN'), owners, owner_years: owners && stay != null ? Math.round(stay / owners) : null,
    married: status(1), pacsed: status(2), cohabiting: status(3), widowed: status(4), divorced: status(5),
    alone_55_79: at('RP_MEASURE=ONEPERS', 'NOC=P1', 'OCS=DW_MAIN', 'AGE=Y55T79'), alone_80: at('RP_MEASURE=ONEPERS', 'NOC=P1', 'OCS=DW_MAIN', 'AGE=Y_GE80'),
  }
}

// Each IRIS with its census and its odds:
// - sold: its flats and houses DVF counts a year, over `years`, null without DVF (Alsace-Moselle, no year);
// - odds: the share of its homes sold in a year, the odds that one of them goes on sale within 12 months;
// - successions, separations: the sales a year likely to follow a death of an owner living alone, a couple of owners
//   splitting (the owners' share of its main homes stands for the owners' share of these people).
// `censusOf` maps an IRIS code to its Melodi observations, `salesOf` a commune to its DVF sales.
// ponytail: DVF's sales of one home only (a flat with its cellar), several homes sold at once are left out
export function irisOdds(iris, censusOf, salesOf, years) {
  const r1 = x => Math.round(x * 10) / 10
  return iris.map(i => {
    const c = census(censusOf[i.code]), [w, s, e, n] = bbox({ kind: 'polygon', geometry: i.geometry })
    const sales = years.length ? (salesOf[i.insee] ?? null) : null
    const sold = sales && sales.filter(x => x.point && (x.type === 'flat' || x.type === 'house') && years.includes(x.date.slice(0, 4))
      && x.point[0] >= w && x.point[0] <= e && x.point[1] >= s && x.point[1] <= n && inGeometry(x.point, i.geometry)).length / years.length
    const owned = c?.main ? (c.owners ?? 0) / c.main : null, n0 = x => x ?? 0
    return {
      ...i, census: c, sold: sold == null ? null : r1(sold), odds: sold != null && c?.homes ? Math.min(1, sold / c.homes) : null,
      successions: owned == null ? null : r1((n0(c.alone_55_79) * MORTALITY.alone_55_79 + n0(c.alone_80) * MORTALITY.alone_80) * owned),
      separations: owned == null ? null : r1(((n0(c.married) + n0(c.pacsed) + n0(c.cohabiting)) / 2) * SEPARATION * owned),
    }
  })
}
