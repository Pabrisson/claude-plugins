import assert from 'node:assert/strict'
import test from 'node:test'
import { alertsOf, atPlace, cleanAlerts, firing, newsKey, streetOf, takes } from '../lib/alerts.js'

const s = { types: ['flat'], criteria: { area_min: 40, dpe_max: 'E' } }
const dpe = (o = {}, outside) => ({ date: '2026-10-28T10:00:00Z', kind: 'dpe', ...(outside && { outside }), dpe: { number: 'X', date: '2026-10-20', energy: 'F', type: 'flat', area: 70, address: '311 Rue Paul Bert 69003 Lyon', ban: '69383_5245_00311', point: [4.8719, 45.7563], ...o } })
const drop = (l = {}) => ({ date: '2026-10-28T10:00:00Z', kind: 'price_drop', from: 300000, to: 282000, l: { id: 'a', price: 282000, area: 60, rooms: 3, dpe: { energy: 'D' }, location: { address: null }, favorite: true, ...l } })
const garibaldi = { how: 'street', ban: '69383_3030', label: 'Rue Garibaldi 69003 Lyon', point: [4.853, 45.753] }
const audit = (o = {}, outside) => ({ date: '2026-10-28T10:00:00Z', kind: 'audit', ...(outside && { outside }), audit: { number: 'A1', date: '2026-10-18', energy: 'G', type: 'flat', building: true, area: 530, address: '12 Rue Garibaldi 69003 Lyon', ban: '69383_3030_00012', point: [4.853, 45.753], ...o } })
const permit = (o = {}, outside) => ({ date: '2026-10-28T10:00:00Z', kind: 'permit', ...(outside && { outside }), permit: { number: 'PD1', kind: 'demolish', form: 'PD', date: '2026-09-29', homes: null, address: '14 Rue Garibaldi 69003 Lyon', ban: '69383_3030_00014', point: [4.853, 45.753], ...o } })

test('the street of an address, the key of a news', () => {
  assert.equal(streetOf('311 bis Rue Paul Bert 69003 Lyon'), 'Rue Paul Bert')
  assert.equal(streetOf('12 rue de la Part-Dieu, Lyon 3e'), 'rue de la Part-Dieu')
  assert.equal(streetOf(null), null)
  assert.equal(newsKey(dpe()), 'dpe-2026-10-28T10:00:00Z-X')
  assert.equal(newsKey(drop()), 'price_drop-2026-10-28T10:00:00Z-a')
})

test('the default alerts: on, the DPE one keeps the search criteria, an expiry only of a listing followed, one turned off stops its news', () => {
  const on = alertsOf()
  assert.deepEqual(firing(on, dpe({ energy: 'D' }), s).map(a => a.id), ['dpe'])
  assert.deepEqual(firing(on, dpe(), s), [], 'a DPE F is outside dpe_max=E')
  assert.deepEqual(firing(on, dpe({ energy: 'D' }, true), s), [], 'a DPE found outside the zone is none of the zone alerts')
  assert.deepEqual(firing(on, drop(), s).map(a => a.id), ['price_drop'])
  assert.deepEqual(firing(on, { ...drop(), kind: 'status' }, s).map(a => a.id), ['status'])
  // an expiry is news when the user follows the listing (a status of theirs), not when it waits to be sorted
  assert.deepEqual(firing(on, { ...drop({ my_status: 'to_visit' }), kind: 'expired' }, s).map(a => a.id), ['expired'])
  assert.deepEqual(firing(on, { ...drop(), kind: 'expired' }, s), [])
  assert.deepEqual(firing(alertsOf({ off: ['price_drop'] }), drop(), s), [])
  // every audit and permit of the zone, whatever the criteria (a whole building of 530 m²)
  assert.deepEqual(firing(on, audit(), s).map(a => a.id), ['audit'])
  assert.deepEqual(firing(on, permit(), s).map(a => a.id), ['permit'])
  assert.deepEqual(firing(on, permit({}, true), s), [], 'a permit found outside the zone is none of the zone alerts')
  assert.equal(newsKey(audit()), 'audit-2026-10-28T10:00:00Z-A1')
})

test("a user's alert on the audits and the permits: a whole building, a demolition or 10 homes in a street", () => {
  const whole = { event: 'audit', place: garibaldi, conditions: [{ field: 'building', op: 'is', value: true }, { field: 'energy', op: 'gte', value: 'E' }] }
  assert.ok(takes(whole, audit({}, true), s))
  assert.ok(!takes(whole, audit({ building: false }, true), s))
  assert.ok(!takes(whole, audit({ ban: '69383_5245_00012' }, true), s), 'another street')
  assert.ok(!takes(whole, permit({}, true), s), 'not its event')
  const down = { event: 'permit', place: garibaldi, conditions: [{ field: 'permit_kind', op: 'is', value: 'demolish' }] }
  assert.ok(takes(down, permit({}, true), s))
  assert.ok(!takes(down, permit({ kind: 'build', homes: 12 }, true), s))
  const homes = { event: 'permit', conditions: [{ field: 'homes', op: 'gte', value: 10 }, { field: 'street', op: 'contains', value: 'garibaldi' }] }
  assert.ok(takes(homes, permit({ kind: 'build', homes: 12 }), s))
  assert.ok(!takes(homes, permit(), s), 'a demolition creates no home')
  // a place's street by its BAN id alone: a permit the BAN placed on the street, not at a number
  assert.ok(atPlace(garibaldi, { ban: '69383_3030' }))
})

test("a user's alert: a DPE in a street of the zone, a passoire elsewhere, a drop of 5 % on a favorite", () => {
  const street = { event: 'dpe', place: { how: 'zone' }, conditions: [{ field: 'street', op: 'contains', value: 'paul bért' }, { field: 'energy', op: 'gte', value: 'F' }] }
  assert.ok(takes(street, dpe(), s))
  assert.ok(!takes(street, dpe({ address: '2 Rue Garibaldi 69003 Lyon' }), s))
  assert.ok(!takes(street, dpe({ address: null }), s), 'an unknown street fails')
  // at a place: what the watch found there, and what the zone found there
  const away = { event: 'dpe', place: garibaldi, conditions: [{ field: 'energy', op: 'gte', value: 'F' }] }
  assert.ok(takes(away, dpe({ ban: '69383_3030_00012' }, true), s))
  assert.ok(takes(away, dpe({ ban: '69383_3030_00012' }), s), 'a DPE of the zone on that street')
  assert.ok(!takes(away, dpe({}, true), s), 'another street')
  const fav = { event: 'price_drop', conditions: [{ field: 'change_pct', op: 'gte', value: 5 }, { field: 'favorite', op: 'is', value: true }] }
  assert.ok(takes(fav, drop(), s), '6 % on a favorite')
  assert.ok(!takes(fav, drop({ favorite: false }), s))
  assert.ok(!takes(fav, { ...drop(), kind: 'new' }, s), 'not its event')
})

test('a place: a street by its BAN id, a commune with its arrondissements, a circle', () => {
  assert.ok(atPlace(garibaldi, { ban: '69383_3030_00012' }))
  assert.ok(!atPlace(garibaldi, { ban: '69383_30300_00012' }))
  assert.ok(atPlace({ how: 'commune', insee: '69123' }, { ban: '69387_1234_00001' }), 'Lyon holds its 7th')
  assert.ok(!atPlace({ how: 'commune', insee: '69383' }, { ban: '69387_1234_00001' }))
  assert.ok(atPlace({ how: 'radius', point: [4.8719, 45.7563], radius_m: 100 }, { point: [4.8725, 45.7565] }))
  assert.ok(!atPlace({ how: 'radius', point: [4.8719, 45.7563], radius_m: 100 }, { point: [4.88, 45.76] }))
})

test('alerts.json checked at the door', () => {
  const ok = cleanAlerts({ off: ['dpe', 'nope'], custom: [{ id: 'a-1', name: ' DPE rue Garibaldi ', events: ['dpe', 'new'], place: { ...garibaldi, extra: 1 }, conditions: [{ field: 'area', op: 'gte', value: '60' }] }] })
  assert.deepEqual(ok, { off: ['dpe'], custom: [{ id: 'a-1', name: 'DPE rue Garibaldi', event: 'dpe', place: garibaldi, conditions: [{ field: 'area', op: 'gte', value: 60 }], enabled: true }] })
  const bad = (c, o = {}) => assert.throws(() => cleanAlerts({ custom: [{ id: 'a', name: 'x', event: 'dpe', conditions: [c].filter(Boolean), ...o }] }))
  bad({ field: 'energy', op: 'gte', value: 'Z' })
  bad({ field: 'area', op: 'contains', value: 1 })
  bad({ field: 'area', op: 'gte', value: '' })
  bad({ field: 'price', op: 'gte', value: 1 }, {}) // a DPE has no price
  bad({ field: 'street', op: 'is', value: ' ' })
  bad(null, { event: 'new', place: garibaldi })
  bad(null, { place: { how: 'street', ban: '../x', label: 'x', point: [1, 2] } })
  bad(null, { place: { how: 'radius', radius_m: 10000, label: 'x', point: [1, 2] } })
  bad({ field: 'permit_kind', op: 'is', value: 'renovate' }, { event: 'permit' })
  bad({ field: 'energy', op: 'gte', value: 'F' }, { event: 'permit' })
  bad({ field: 'building', op: 'is', value: true }, { event: 'dpe' })
  assert.deepEqual(cleanAlerts({ custom: [{ id: 'p', name: 'Démolitions', event: 'permit', place: garibaldi, conditions: [{ field: 'permit_kind', op: 'is', value: 'demolish' }, { field: 'homes', op: 'gte', value: '2' }] }] }).custom[0].conditions,
    [{ field: 'permit_kind', op: 'is', value: 'demolish' }, { field: 'homes', op: 'gte', value: 2 }])
  assert.throws(() => cleanAlerts({ custom: [{ id: '../x', name: 'x', event: 'dpe' }] }))
})

test('an alert of 1.7, with a list of events, reads as its first', () => {
  const [a] = alertsOf({ custom: [{ id: 'a-1', name: 'x', events: ['dpe'], conditions: [], enabled: true }] }).filter(x => !x.builtin)
  assert.ok(takes(a, dpe(), s))
})
