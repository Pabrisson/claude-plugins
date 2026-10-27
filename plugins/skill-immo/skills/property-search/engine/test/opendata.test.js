import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { mock } from 'node:test'
import { openData } from '../lib/opendata.js'

// the open data answers recorded on 2026-10-27 around 20 rue Paul Bert (Lyon 3e), served by a fake fetch
const fixture = f => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')
const ROUTES = [
  [/geocodage\/search/, 'geocode-20-rue-paul-bert.json'], [/georisques/, 'georisques-20-rue-paul-bert.json'], [/overpass/, 'overpass-paul-bert.json'],
  [/navigation\/isochrone/, 'isochrone-pedestrian-15.json'], [/wfs/, 'iris-moncey.json'],
  [/data\.gouv\.fr\/api\/1\/datasets\/\?q=Carte/, 'rent-datasets.json'], [/tabular-api.*INSEE_C__exact=69383/, 'rent-69383.json'],
  [/dpe03existant\/values_agg/, 'dpe-classes-paul-bert.json'], [/dpe03existant\/lines.*bbox/, 'dpe-recent-paul-bert.json'], [/fiscalite-locale.*insee_com/, 'tax-69123.json'], [/fiscalite-locale.*mpoid/, 'tax-france.json'],
  [/dido\/api\/v1\/datasets\//, 'sitadel-dataset.json'], [/dido\/api\/v1\/datafiles\/.*COMM=eq%3A69383/, 'sitadel-69383.json'],
]
const asked = []
mock.method(globalThis, 'fetch', async (url, init) => {
  asked.push({ url: String(url), ua: init?.headers?.['User-Agent'] })
  const hit = ROUTES.find(([re]) => re.test(String(url)))
  return hit ? new Response(fixture(hit[1]), { status: 200 }) : new Response('', { status: 404 })
})
const od = openData(fs.mkdtempSync(path.join(os.tmpdir(), 'immo-od-')))
const point = [4.845472, 45.755958]

test('geocoding: the BAN id carries the street code DVF uses', async () => {
  const [f] = await od.geocode('20 rue paul bert lyon', { limit: 1 })
  assert.deepEqual([f.properties.citycode, f.properties.id, f.properties.type], ['69383', '69383_5245_00020', 'housenumber'])
})

test('risks: only those present, with their label', async () => {
  const r = await od.georisques(point)
  assert.deepEqual(r.natural.map(x => x.key), ['inondation', 'remonteeNappe', 'seisme', 'retraitGonflementArgile', 'radon'])
  assert.ok(r.technological.some(x => x.key === 'icpe'))
})

test('Overpass: one point per place, by category, with an identifying User-Agent', async () => {
  const pois = await od.overpass([4.84, 45.75, 4.85, 45.76])
  assert.ok(pois.length > 0 && pois.every(p => p.cat && p.point.length === 2))
  assert.ok(pois.some(p => p.cat === 'transport' && /Guillotière/.test(p.name)))
  assert.match(asked.find(a => /overpass/.test(a.url)).ua, /^skill-immo\/1\.0 \(\+https:/)
})

test('isochrone and IRIS outlines, then the cache answers without the network', async () => {
  assert.equal((await od.isochrone(point, 'pedestrian', 15)).type, 'Polygon')
  const iris = await od.irisAt(point)
  assert.deepEqual([iris.code, iris.name, iris.geometry.type], ['693830201', 'Moncey', 'MultiPolygon'])
  const before = asked.length
  await od.irisAt(point)
  assert.equal(asked.length, before)
})

test("the rent map: the latest year's resources, found by their title", async () => {
  const r = await od.rent('69383')
  assert.deepEqual([r.year, r.flat.per_m2, r.flat.low, r.flat.high, r.flat.scope], [2025, 16.4, 12.82, 20.98, 'commune'])
  assert.ok(['55b34088', '14a1fe11', '5e3b28a4', '129f764d'].every(id => asked.some(a => a.url.includes(id))))
  assert.ok(!asked.some(a => a.url.includes('old-flat')))
})

test('no DVF in Alsace-Moselle, without a single request', async () => {
  const before = asked.length
  assert.deepEqual(await od.dvf('67482'), { sales: [], years: [], alsace_moselle: true })
  assert.equal(asked.length, before)
})

test('the DPE of the zone, one per home: flats and houses apart, building DPE left out', async () => {
  const d = await od.dpeClasses({ point: [4.856, 45.756], radius: 300 })
  assert.deepEqual(d, { flat: { A: 5, B: 60, C: 1026, D: 621, E: 306, F: 84, G: 30 }, house: { C: 3, D: 1 } })
  const q = new URL(asked.findLast(a => a.url.includes('values_agg')).url).searchParams
  assert.deepEqual([q.get('geo_distance'), q.get('methode_application_dpe_neq')], ['4.856,45.756,300', 'dpe appartement généré à partir des données DPE immeuble'])
})

test('the recent DPE of a box: the last 12 months, newest first, one per home, each with its point', async () => {
  const rows = await od.recentDpe([4.8391, 45.7515, 4.8519, 45.7605])
  assert.equal(rows.length, 12)
  assert.deepEqual(rows[0], { number: '2669E2663903R', date: '2026-10-19', energy: 'E', type: 'flat', area: 26.5, address: '13bis Rue Chalopin 69007 Lyon', ban: '69387_1380_00013_bis', point: [4.844620040377923, 45.75168297914536] })
  const q = new URL(asked.findLast(a => a.url.includes('dpe03existant/lines')).url).searchParams
  assert.deepEqual([q.get('bbox'), q.get('type_batiment_in'), q.get('sort'), q.get('methode_application_dpe_neq')], ['4.8391,45.7515,4.8519,45.7605', 'appartement,maison', '-date_etablissement_dpe', 'dpe appartement généré à partir des données DPE immeuble'])
  assert.equal(q.get('date_etablissement_dpe_gte'), new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10))
})

test("the property tax: Lyon's rate for an arrondissement, and France's average", async () => {
  assert.deepEqual(await od.tax('69383'), { year: 2025, city: 'LYON', commune: 31.89, epci: 0.55, epci_name: 'Métropole de Lyon', total: 32.82, waste: 5.19, france: 43.13 })
  assert.ok(asked.some(a => new URL(a.url).searchParams.get('where') === "insee_com='69123'"))
})

test('the homes authorised: the newest release already out, never one announced for later', async () => {
  const h = await od.housing('69383')
  assert.equal(h.release, '2026-09')
  assert.deepEqual(h.years.at(-1), { year: 2025, authorised: 174, started: null })
  assert.equal(h.years[0].year, 2013)
  assert.ok(asked.some(a => a.url.includes('millesime=2026-09')) && !asked.some(a => a.url.includes('millesime=2099')))
})
