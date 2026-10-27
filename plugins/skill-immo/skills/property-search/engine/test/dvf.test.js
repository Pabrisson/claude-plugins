import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { building, dvfSales, median, parseCsv, quantile, stats, summary } from '../lib/dvf.js'
import { distance, inZone } from '../lib/geo.js'

// 17 real mutations of Lyon 3e in 2024 (geo-DVF): 14 on rue Paul Bert, 2 selling several apartments, a house, a
// parking, an exchange
const rows = parseCsv(fs.readFileSync(new URL('./fixtures/dvf-69383-2024.csv', import.meta.url), 'utf8'))
const all = dvfSales(rows), sales = all.filter(s => s.type === 'flat')

test('quoted CSV fields keep their commas and quotes', () => {
  assert.deepEqual(parseCsv('a,b\n"1,5","say ""hi"""\n2,3\n'), [{ a: '1,5', b: 'say "hi"' }, { a: '2', b: '3' }])
})

test('one sale per mutation of exactly one apartment, its cellar allowed', () => {
  assert.equal(new Set(rows.map(r => r.id_mutation)).size, 17)
  assert.equal(sales.length, 12)
  // several apartments or an exchange: never a price per m²
  for (const id of ['2024-826583', '2024-826858', '2024-826330']) assert.ok(!all.some(s => s.id === id), id)
  const s = sales.find(x => x.id === '2024-826289')
  assert.deepEqual([s.price, s.area, s.ppm2, s.number, s.code_voie, s.deps], [313000, 90.4, 3462, '308', '5245', 2])
})

test('a house with its land, a parking at its price', () => {
  const house = all.find(s => s.type === 'house'), parking = all.find(s => s.type === 'parking')
  assert.deepEqual([house.id, house.area, house.land, house.ppm2, house.deps], ['2024-826304', 63, 163, 5952, 2])
  assert.deepEqual([parking.id, parking.area, parking.ppm2], ['2024-827720', null, 30500])
  assert.equal(all.length, 14)
})

test('medians and quartiles', () => {
  assert.equal(median([3, 1, 2]), 2)
  assert.equal(median([1, 2, 3, 4]), 3)
  assert.equal(quantile([10, 20, 30, 40, 50], 0.25), 20)
  assert.equal(median([]), null)
  const st = stats(sales)
  assert.equal(st.count, 12)
  assert.equal(st.median_ppm2, 3864)
  assert.deepEqual(st.by_quarter.map(q => [q.quarter, q.count]), [['2024-Q1', 7], ['2024-Q2', 5]])
})

test('street, zone, commune and building', () => {
  const zone = { kind: 'radius', center: [4.8455, 45.756], radius_m: 600 }
  const m = summary(sales, { inZone: p => inZone(p, zone), code_voie: '5245', since: '2024-03-01' })
  assert.equal(m.street.count, 12)
  assert.ok(m.zone.count < m.commune.count)
  assert.ok(m.points.every(p => p.date >= '2024-03-01' && distance(p.point, zone.center) <= 600))
  assert.deepEqual(building(sales, 308, '5245').map(s => s.id), ['2024-826626', '2024-826459', '2024-826289'])
})
