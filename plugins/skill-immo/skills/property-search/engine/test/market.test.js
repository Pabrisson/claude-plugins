import assert from 'node:assert/strict'
import test from 'node:test'
import { priceSteps, study } from '../lib/market.js'

const now = '2026-10-28T20:00:00.000Z'
const steps = l => priceSteps(l, now).map(s => [s.date.slice(0, 10), s.price, s.pct == null ? null : Math.round(s.pct * 100)])

test("the price's steps: the portals' changes and the prices the search saw, once each, to today", () => {
  // the drop seen by both the portal and the search counts once
  assert.deepEqual(steps({
    published_at: '2026-09-20T00:00:00Z', first_seen: '2026-10-07T15:37:10Z',
    price_changes: [{ date: '2026-10-28T15:38:01Z', from: 175000, to: 166000 }],
    price_history: [{ date: '2026-10-07T15:37:10Z', price: 175000 }, { date: '2026-10-28T15:38:01Z', price: 166000 }],
  }), [['2026-09-20', 175000, null], ['2026-10-28', 166000, -5], ['2026-10-28', 166000, null]])
  // a change before the search: its old price starts at the publication when it comes before
  assert.deepEqual(steps({
    published_at: '2026-07-01T00:00:00Z', first_seen: '2026-10-03T00:00:00Z',
    price_changes: [{ date: '2026-08-31T00:00:00Z', from: 455000, to: 433000 }], price_history: [{ date: '2026-10-03T00:00:00Z', price: 433000 }],
  }), [['2026-07-01', 455000, null], ['2026-08-31', 433000, -5], ['2026-10-28', 433000, null]])
})

test("the price's steps without a date before the first change: the old price starts at the change", () => {
  assert.deepEqual(steps({ first_seen: '2026-10-03T00:00:00Z', price_changes: [{ date: '2026-08-31T00:00:00Z', from: 455000, to: 433000 }] }),
    [['2026-08-31', 455000, null], ['2026-08-31', 433000, -5], ['2026-10-28', 433000, null]])
  // a rise, then a drop; one price only: one step
  assert.deepEqual(steps({ price_history: [{ date: '2026-09-01T00:00:00Z', price: 200000 }, { date: '2026-09-15T00:00:00Z', price: 210000 }, { date: '2026-10-01T00:00:00Z', price: 199500 }] }).map(s => s[2]), [null, 5, -5, null])
  assert.equal(new Set(priceSteps({ price_history: [{ date: '2026-09-01T00:00:00Z', price: 200000 }] }, now).map(s => s.price)).size, 1)
})

test('a group of listings as a market: its prices against the sales of their size, what they are, their pace', () => {
  const at = '2026-11-04T00:00:00.000Z', now = Date.parse(at), ago = d => new Date(now - d * 864e5).toISOString()
  const ls = [
    // a T2 at the price of the T2 sold, a balcony, a drop of 10 %, a favorite
    { id: 'a', price: 225000, area: 50, price_per_m2: 4500, rooms: 2, floor: 0, construction_year: 1970, dpe: { energy: 'D' }, features: { balcony: true }, first_seen: ago(10), price_history: [{ date: ago(10), price: 250000 }], favorite: true },
    // a T5 at 4000 against T5 sold at 3200: dearer by 25 % for its size, dismissed, an elevator
    { id: 'b', price: 480000, area: 120, price_per_m2: 4000, rooms: 6, floor: 4, building: { construction_year: 1990 }, dpe: { energy: 'F' }, features: { elevator: true, parking: true }, first_seen: ago(200), my_status: 'dropped' },
    // gone offline 40 days after it was seen, 60 days ago
    { id: 'c', price: 300000, area: 75, price_per_m2: 4000, rooms: 3, status: 'EXPIRED', first_seen: ago(100), changes: [{ date: ago(60), kind: 'expired' }] },
  ]
  const rooms = [{ rooms: 2, median_ppm2: 4500 }, { rooms: 5, median_ppm2: 3200 }]
  const x = study(ls, { ref: 4000, rooms, budget: 400000, score: l => ({ a: 70, b: 40 })[l.id] ?? null, now })
  assert.equal(x.n, 3); assert.equal(x.expired, 1); assert.equal(x.price, 300000); assert.equal(x.ppm2, 4000)
  assert.deepEqual([x.ppm2_min, x.ppm2_max], [4000, 4500])
  // a: 0, b: +25 % for its size, c (a T3, no sales of its size): 0 against the zone
  assert.equal(x.gap_size, 0)
  // at the zone's price, the T5 alone is 25 % above the T5 sold; the T2 alone, at the price of the T2 sold
  assert.equal(study([ls[1]], { ref: 4000, rooms }).gap_size, 0.25); assert.equal(study([ls[0]], { ref: 4000, rooms }).gap_size, 0)
  assert.deepEqual(x.rooms, { 1: 0, 2: 1, 3: 1, 4: 0, 5: 1 })
  assert.equal(x.dpe.D, 1); assert.equal(x.poor, 0.5)
  assert.equal(x.in_budget, 2 / 3); assert.equal(x.outdoor, 1 / 3); assert.equal(x.elevator, 1 / 3)
  assert.equal(x.floor, 2); assert.equal(x.year, 1980)
  assert.equal(x.added, 1); assert.equal(x.removed, 0); assert.equal(x.days_off, 40)
  assert.equal(x.drops, 1 / 3); assert.equal(x.drop, 0.1)
  assert.equal(x.favorites, 1); assert.equal(x.dismissed, 1)
  assert.equal(x.score, 55); assert.deepEqual(x.best, { id: 'a', value: 70 })
  // the expired listing has no margin left; the two others: 3 % at least, more for the one online 200 days
  assert.ok(x.margin.low > 0 && x.margin.high >= 0.03)
  assert.equal(study([]).n, 0); assert.equal(study([]).ppm2, null); assert.equal(study([]).margin, null)
})
