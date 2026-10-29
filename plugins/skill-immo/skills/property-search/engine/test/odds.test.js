import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { mock } from 'node:test'
import { addressOdds, AUDIT_SALE, census, G_SALE, irisOdds, MORTALITY, PERMIT_SALE, SALE_SHARE, saleShare, SEPARATION, TURNOVER } from '../lib/odds.js'
import { openData } from '../lib/opendata.js'

// the census of the IRIS Danton-Bir Hakeim (Lyon 3e), as Melodi answered on 2026-10-28
const danton = JSON.parse(fs.readFileSync(new URL('./fixtures/melodi-iris-danton.json', import.meta.url), 'utf8'))
const asked = []
mock.method(globalThis, 'fetch', async url => {
  asked.push(String(url))
  const geos = new URL(url).searchParams.getAll('GEO')
  if (/DS_RP_(MENAGES|LOGEMENT)_PRINC_IRIS/.test(url)) return Response.json({ observations: danton.filter(o => geos.some(g => o.dimensions.GEO.endsWith(g)) && (url.includes('MENAGES') ? !o.dimensions.TSH : !!o.dimensions.TSH)) })
  return new Response('', { status: 404 })
})

test('the census of an IRIS: its homes, owners, marital status and people living alone, vacant and old homes', () => {
  assert.deepEqual(census(danton), {
    year: 2023, homes: 6750, main: 5474, owners: 1512, owner_years: 13,
    married: 1873, pacsed: 765, cohabiting: 1462, widowed: 295, divorced: 443, alone_55_79: 483, alone_80: 206,
    vacant: 503, secondary: 773, before_1946: 630, oil: 44, settled_10: 1432,
  })
  assert.equal(census([]), null)
})

// a square IRIS of 1 km and the sales of its commune
const square = { type: 'Polygon', coordinates: [[[4.84, 45.75], [4.853, 45.75], [4.853, 45.759], [4.84, 45.759], [4.84, 45.75]]] }
const iris = { code: '693830302', name: 'Danton-Bir Hakeim', insee: '69383', commune: 'Lyon 3e Arrondissement', kind: 'H', geometry: square }
const sale = (date, point = [4.845, 45.755], type = 'flat') => ({ date, point, type })

test('the odds of an IRIS: its flats and houses sold a year over the years given, against its homes', () => {
  const sales = [sale('2024-03-01'), sale('2025-06-01', [4.846, 45.756], 'house'), sale('2025-01-01', [4.9, 45.755]), sale('2025-02-01', undefined, 'parking'), sale('2022-05-01')]
  const [i] = irisOdds([iris], { [iris.code]: danton }, { 69383: sales }, ['2024', '2025'])
  assert.equal(i.sold, 1)
  assert.equal(i.odds, 1 / 6750)
  // the owners' share of the main homes, applied to the deaths and splits France's rates make likely
  const owned = 1512 / 5474
  assert.equal(i.successions, Math.round((483 * MORTALITY.alone_55_79 + 206 * MORTALITY.alone_80) * owned * 10) / 10)
  assert.equal(i.separations, Math.round(((1873 + 765 + 1462) / 2) * SEPARATION * owned * 10) / 10)
  assert.deepEqual([i.code, i.geometry], [iris.code, square])
})

test('the prices of an IRIS: the median € per m² of its homes sold, from 5 sales on, flats and houses apart', () => {
  const at = (ppm2, type = 'flat') => ({ ...sale('2025-01-01', [4.845, 45.755], type), ppm2 })
  const flats = [4000, 4500, 5000, 5500, 6000].map(x => at(x)), houses = [3000, 3200].map(x => at(x, 'house'))
  let [i] = irisOdds([iris], {}, { 69383: [...flats, ...houses, { ...at(9000), point: [4.9, 45.755] }] }, ['2025'])
  assert.deepEqual([i.ppm2, i.ppm2_flat, i.ppm2_house], [4500, 5000, null])
  ;[i] = irisOdds([iris], {}, { 69383: houses }, ['2025'])
  assert.deepEqual([i.ppm2, i.ppm2_flat], [null, null])
})

test('the odds without DVF (Alsace-Moselle, no year) or without census: unknown, not zero', () => {
  for (const [salesOf, years] of [[{ 69383: null }, ['2025']], [{}, ['2025']], [{ 69383: [sale('2025-01-01')] }, []]]) {
    const [i] = irisOdds([iris], { [iris.code]: danton }, salesOf, years)
    assert.deepEqual([i.sold, i.odds], [null, null])
  }
  const [i] = irisOdds([iris], {}, { 69383: [sale('2025-01-01')] }, ['2025'])
  assert.deepEqual([i.sold, i.odds, i.census, i.successions], [1, null, null, null])
})

test('Melodi: several IRIS a call, each kept', async () => {
  const od = openData(fs.mkdtempSync(path.join(os.tmpdir(), 'immo-odds-')))
  const first = await od.irisCensus(['693830302', '693830301'])
  assert.equal(census(first['693830302']).homes, 6750)
  assert.deepEqual(first['693830301'], [])
  assert.equal(asked.filter(u => /GEO=IRIS-693830302&GEO=IRIS-693830301/.test(u)).length, 2)
  const n = asked.length
  await od.irisCensus(['693830301', '693830302'])
  assert.equal(asked.length, n, 'both IRIS come from the cache')
})

// the odds of an address: its recent DPE, audits and permits, the IRIS it is in (1 000 main homes, 400 let, 40 sold a year)
const now = Date.parse('2026-10-29')
const quarter = { ...iris, census: { main: 1000, owners: 600 }, sold: 40 }
const at = { address: '20 Rue Paul Bert 69003 Lyon', ban: '69383_5245_00020', point: [4.845, 45.755] }
const dpeRow = (x = {}) => ({ number: 'd1', date: '2026-10-19', energy: 'D', type: 'flat', area: 56, ...at, ...x })
const auditRow = (x = {}) => ({ number: 'a1', date: '2026-07-21', energy: 'F', type: 'house', building: false, area: 120, period: null, ...at, ...x })
const permitRow = (x = {}) => ({ number: 'p1', kind: 'demolish', form: 'PD', date: '2026-05-01', homes: null, demolished: 1, land: null, ...at, ...x })

test('the sales share of an IRIS: its sales a year against its tenants moving out, France\'s without figures', () => {
  assert.equal(saleShare(quarter), 40 / (40 + 400 * TURNOVER))
  for (const i of [undefined, { ...quarter, sold: null }, { ...quarter, census: null }]) assert.equal(saleShare(i), SALE_SHARE)
})

test('the odds of an address: its DPE, audit and permit together, 1 − Π(1 − p)', () => {
  const [place, ...rest] = addressOdds({ dpe: [dpeRow()], audits: [auditRow()], permits: [permitRow()] }, [quarter], { now })
  assert.equal(rest.length, 0)
  assert.deepEqual([place.key, place.address, place.sale, place.iris], [at.ban, at.address, 1 / 3, iris.code])
  // the DPE of 10 days at the IRIS's share, the audit of 100 days at half, the demolition
  assert.deepEqual(place.signals.map(s => [s.kind, s.p]), [['permit', 0.5], ['dpe', 1 / 3], ['audit', AUDIT_SALE * 0.5]])
  assert.ok(Math.abs(place.odds - (1 - (2 / 3) * 0.75 * 0.5)) < 1e-9)
})

test('a DPE fades with its age, a G is mostly a sale (it can no longer be let)', () => {
  const p = (d, i = [quarter]) => +addressOdds({ dpe: [d] }, i, { now })[0].odds.toFixed(9)
  assert.deepEqual([p(dpeRow({ date: '2026-09-15' })), p(dpeRow({ date: '2026-06-01' })), p(dpeRow({ date: '2026-01-10' }))], [1 / 3, 1 / 6, 1 / 12].map(x => +x.toFixed(9)))
  assert.equal(p(dpeRow({ energy: 'G' })), G_SALE)
  // out of every IRIS: France's share
  assert.equal(p(dpeRow({ point: [5, 46], ban: null })), SALE_SHARE)
})

test('the DPE of an address the same day: one owner\'s campaign or one home diagnosed twice, one signal', () => {
  const day = [dpeRow(), dpeRow({ number: 'd2', energy: 'G' }), dpeRow({ number: 'd3', area: 30 })], other = dpeRow({ number: 'd4', date: '2026-10-20' })
  const [place] = addressOdds({ dpe: [...day, other] }, [quarter], { now })
  assert.deepEqual(place.signals.map(s => [s.row.number, s.rows.map(d => d.number), s.p]), [['d2', ['d1', 'd2', 'd3'], G_SALE], ['d4', ['d4'], 1 / 3]])
  assert.ok(Math.abs(place.odds - (1 - (1 - G_SALE) * (2 / 3))) < 1e-9)
})

test('a permit: plots, homes on plan, a demolition, a house for oneself', () => {
  const p = x => +addressOdds({ permits: [permitRow(x)] }, [], { now })[0].odds.toFixed(9)
  assert.deepEqual([p({ kind: 'develop', form: 'PA' }), p({ kind: 'build', form: 'PC', homes: 12 }), p({}), p({ kind: 'build', form: 'PC', homes: 1 })],
    [PERMIT_SALE.develop, PERMIT_SALE.homes, PERMIT_SALE.demolish, PERMIT_SALE.home])
})

test('in the search\'s zone a DPE with a listing is on sale already: left out; out of it, its listing unknown', () => {
  const listing = { id: 'x', property_type: 'flat', area: 56, dpe: { reference: 'd1' }, location: { point: at.point } }
  const zone = { kind: 'radius', center: at.point, radius_m: 300 }
  assert.deepEqual(addressOdds({ dpe: [dpeRow()] }, [quarter], { listings: [listing], zone, now }), [])
  const far = dpeRow({ number: 'd2', ban: null, point: [4.852, 45.758] })
  assert.deepEqual(addressOdds({ dpe: [dpeRow(), far] }, [quarter], { zone, now }).map(g => [g.key, g.out]), [[at.ban, false], ['4.852,45.758', true]])
})

test('the addresses, likeliest first, those without a chance left out', () => {
  const quiet = { ...quarter, sold: 0 }
  const places = addressOdds({ dpe: [dpeRow({ ban: 'b', point: [4.846, 45.756] })], permits: [permitRow({ kind: 'develop', form: 'PA' })] }, [quiet], { now })
  assert.deepEqual(places.map(g => g.key), [at.ban])
})
