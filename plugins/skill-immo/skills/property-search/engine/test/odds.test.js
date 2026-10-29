import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { mock } from 'node:test'
import { census, irisOdds, MORTALITY, SEPARATION } from '../lib/odds.js'
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
