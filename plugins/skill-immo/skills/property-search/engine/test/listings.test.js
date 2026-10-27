import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { addressQuery, fromInput, fromStreamEstate, merge, normUrl } from '../lib/listings.js'
import { badge, daysOnline, dropped, matches, negotiation } from '../lib/market.js'

// a property built from the OpenAPI examples, placed rue Paul Bert (to replace by a recorded one with the key)
const raw = JSON.parse(fs.readFileSync(new URL('./fixtures/se-property.json', import.meta.url), 'utf8'))
const se = fromStreamEstate(raw)

test('a Stream Estate property becomes a listing', () => {
  assert.equal(se.id, raw.id)
  assert.deepEqual([se.price, se.net_price, se.area, se.price_per_m2, se.rooms, se.floor], [280000, 266000, 56, 5000, 3, 2])
  assert.deepEqual([se.dpe.energy, se.dpe.energy_value, se.dpe.ghg], ['D', 245, 'D'])
  assert.deepEqual(se.fees, { agency: { amount: 14000, percentage: 5.26, included: true, paid_by: 'SELLER' }, condo_yearly: 1800, property_tax: 1200 })
  assert.deepEqual(se.location.point, [4.8455, 45.756])
  assert.equal(se.urls[0].source, 'seloger')
  assert.deepEqual([se.urgent, se.favorites, se.published_at], [true, 42, '2026-06-01T08:00:00+00:00'])
  assert.deepEqual(se.price_changes.map(c => [c.from, c.to]), [[300000, 290000], [290000, 280000]])
  assert.equal(se.publishers[0].phone, '+33 4 00 00 00 00')
  assert.equal(se.features.elevator, true)
})

test('the same listing whatever its tracking parameters', () => {
  assert.equal(normUrl('https://www.SeLoger.com/a/b/?utm=1#x'), 'seloger.com/a/b')
  assert.equal(normUrl('not a url'), null)
})

test('merge: new, deduplicated by URL, the user keeps status and notes, drops and expiries are logged', () => {
  const pasted = fromInput({ url: 'https://seloger.com/annonces/achat/appartement/lyon-3eme-69/123456789.htm', price: 290000, area: 56, rooms: 3, dpe: 'D' }, 'websearch')
  let r = merge([], [pasted], '2026-10-01')
  assert.deepEqual(r.changes.map(c => c.kind), ['new'])
  const [l] = r.listings
  l.my_status = 'to_visit'
  l.notes = 'lumineux'
  // Stream Estate finds it later: one listing, its id, the user's fields, and the drop from 290 000 to 280 000
  r = merge([l], [se], '2026-10-27')
  assert.equal(r.listings.length, 1)
  const m = r.listings[0]
  assert.deepEqual([m.id, m.source, m.my_status, m.notes, m.first_seen], [raw.id, 'stream-estate', 'to_visit', 'lumineux', '2026-10-01'])
  assert.deepEqual(r.changes.map(c => [c.kind, c.from, c.to]), [['price_drop', 290000, 280000]])
  assert.deepEqual(m.price_history.map(h => h.price), [290000, 280000])
  // under offer, then gone from the zone
  r = merge(r.listings, [{ ...se, status: 'UNDER_OFFER' }], '2026-11-02')
  assert.deepEqual(r.changes.map(c => [c.kind, c.to]), [['status', 'UNDER_OFFER']])
  r = merge(r.listings, [], '2026-11-20', [raw.id])
  assert.deepEqual(r.changes.map(c => c.kind), ['expired'])
  assert.equal(r.listings[0].status, 'EXPIRED')
  assert.deepEqual(r.listings[0].changes.map(c => c.kind), ['new', 'price_drop', 'status', 'expired'])
})

test('the same price again is no change', () => {
  const r1 = merge([], [se], '2026-10-27'), r2 = merge(r1.listings, [se], '2026-10-28')
  assert.deepEqual(r2.changes, [])
})

test('criteria, market badge and negotiation margin', () => {
  assert.ok(matches(se, { budget_max: 300000, rooms_min: 3, dpe_max: 'D' }))
  assert.ok(!matches(se, { dpe_max: 'C' }))
  assert.ok(matches({ price: 1 }, { rooms_min: 3 }), 'an unknown value passes')
  assert.deepEqual(badge(5000, 4000), { gap: 0.25, level: 'above' })
  assert.equal(badge(4100, 4000).level, 'at')
  assert.equal(daysOnline(se, Date.parse('2026-10-27')), 147)
  assert.ok(Math.abs(dropped(se) - 1 / 15) < 1e-9)
  const n = negotiation(se, 4000, Date.parse('2026-10-27'))
  // 3 % + half of the 25 % above + 2 % (147 days) + 2 % urgent − half of the 6.7 % already dropped (capped at 5 %)
  assert.equal(n.high, 0.15)
  assert.deepEqual(n.reasons.map(r => r[0]), ['above_market', 'days_online', 'urgent', 'already_dropped'])
  assert.equal(negotiation({ ...se, status: 'UNDER_OFFER' }, 4000), null)
})

test("the address the enrichment geocodes: with the listing's postcode and town when it has none", () => {
  const loc = { postcode: '78430', city: 'Louveciennes' }
  // alone, the address base finds « 11 Rue de l'Etang » in Versailles
  assert.equal(addressQuery("11 Rue de l'Etang", loc), "11 Rue de l'Etang 78430 Louveciennes")
  assert.equal(addressQuery("11 Rue de l'Etang", { postcode: null, city: 'Louveciennes' }), "11 Rue de l'Etang Louveciennes")
  assert.equal(addressQuery('Rue Paul Bert, 69003 Lyon', { postcode: '69003', city: 'Lyon' }), 'Rue Paul Bert, 69003 Lyon')
})
