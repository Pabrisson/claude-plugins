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

test('no DVF in Alsace-Moselle, without a single request', async () => {
  const before = asked.length
  assert.deepEqual(await od.dvf('67482'), { sales: [], years: [], alsace_moselle: true })
  assert.equal(asked.length, before)
})
