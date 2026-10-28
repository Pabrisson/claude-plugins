import assert from 'node:assert/strict'
import test from 'node:test'
import { priceSteps } from '../lib/market.js'

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
