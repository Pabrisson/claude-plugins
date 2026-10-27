import assert from 'node:assert/strict'
import test from 'node:test'
import { matchDpe, recentDpe } from '../lib/dpe.js'

// a recent DPE rue Paul Bert, and the listings it may belong to
const dpe = { number: '2669E2663903R', date: '2026-10-19', energy: 'D', type: 'flat', area: 56, address: '20 Rue Paul Bert 69003 Lyon', ban: '69383_5245_00020', point: [4.8455, 45.756] }
const flat = (x = {}) => ({ id: 'a', property_type: 'flat', area: 55, dpe: { energy: null, date: null, reference: null }, location: { point: [4.8475, 45.756] }, ...x })
const listingOf = (d, listings) => matchDpe([d], listings).get(d.number) ?? null

test('a DPE and its listing: by its number first, wherever the engine found it', () => {
  for (const l of [flat({ building: { dpe_match: dpe.number } }), flat({ building: { address: { certificate: dpe.number } } }), flat({ dpe: { reference: dpe.number } })])
    assert.deepEqual(listingOf(dpe, [flat({ id: 'x', area: 30 }), { ...l, id: 'b', area: 30 }]), { id: 'b', how: 'number' })
})

test('a DPE and its listing: the same address and surface, within 8 %', () => {
  assert.deepEqual(listingOf(dpe, [flat({ area: 52, location: { point: null }, building: { ban: dpe.ban } })]), { id: 'a', how: 'address' })
  assert.equal(listingOf(dpe, [flat({ area: 51, location: { point: null }, building: { ban: dpe.ban } })]), null)
})

test('a listing placed roughly: same type and surface within 300 m, its class and date when it gives them', () => {
  assert.deepEqual(listingOf(dpe, [flat()]), { id: 'a', how: 'near' })
  assert.deepEqual(listingOf(dpe, [flat({ dpe: { energy: 'D', date: '2026-10-19' } })]), { id: 'a', how: 'near' })
  // 160 m away, but another class, another DPE date, a house, 400 m away, or no surface
  for (const l of [flat({ dpe: { energy: 'E' } }), flat({ dpe: { date: '2024-06-15' } }), flat({ property_type: 'house' }), flat({ location: { point: [4.8507, 45.756] } }), flat({ area: null })])
    assert.equal(listingOf(dpe, [l]), null)
})

test('a listing takes one DPE at most, the nearest; a DPE taken goes to no other listing', () => {
  const near = { ...dpe, number: 'near', ban: null, point: [4.848, 45.756] }, far = { ...dpe, number: 'far', ban: null, point: [4.8495, 45.756] }
  assert.deepEqual([...matchDpe([far, near], [flat()])], [['near', { id: 'a', how: 'near' }]])
  // its own DPE by number, another listing nearby gets the next one; a listing whose (older) DPE is known takes none
  const own = flat({ id: 'own', dpe: { reference: 'near' } })
  assert.deepEqual([...matchDpe([far, near], [flat(), own])], [['near', { id: 'own', how: 'number' }], ['far', { id: 'a', how: 'near' }]])
  assert.deepEqual([...matchDpe([far, near], [flat({ building: { dpe_match: '2421E1234567X' } })])], [])
})

test('the map: the DPE of the period, grouped per address, newest first, each with its listing or none', () => {
  const now = Date.parse('2026-10-27')
  const rows = [dpe, { ...dpe, number: 'n2', date: '2026-06-01', area: 30 }, { ...dpe, number: 'n3', date: '2026-01-10', ban: null, point: [4.85, 45.76] }]
  const all = recentDpe(rows, [flat()], { now })
  assert.deepEqual(all.map(a => [a.key, a.items.map(d => [d.number, d.listing?.id ?? null])]), [['69383_5245_00020', [['2669E2663903R', 'a'], ['n2', null]]], ['4.85,45.76', [['n3', null]]]])
  assert.deepEqual(recentDpe(rows, [], { now, days: 180 }).flatMap(a => a.items.map(d => d.number)), ['2669E2663903R', 'n2'])
})

test("the map, in the search's criteria: its types, surface and worst class", () => {
  const rows = [dpe, { ...dpe, number: 'g', energy: 'G' }, { ...dpe, number: 'small', area: 20 }, { ...dpe, number: 'house', type: 'house' }]
  const kept = recentDpe(rows, [], { now: Date.parse('2026-10-27'), criteria: { dpe_max: 'E', area_min: 40, budget_max: 300000 }, types: ['flat'] })
  assert.deepEqual(kept.flatMap(a => a.items.map(d => d.number)), ['2669E2663903R'])
})
