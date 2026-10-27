import assert from 'node:assert/strict'
import test from 'node:test'
import { rentOf, rentVsBuy, works } from '../lib/budget.js'
import { review, score } from '../lib/decide.js'
import { matches, reference, unitPrice } from '../lib/market.js'

// the demo's T3 to renovate, rue Paul Bert: below the market, a DPE F, two drops, 263 m from the Guillotière tram
const l = {
  property_type: 'flat', price: 239000, area: 64, price_per_m2: 3734, rooms: 3, floor: 4, dpe: { energy: 'F' }, features: { elevator: false, balcony: true },
  fees: { condo_yearly: 1440 }, status: 'AVAILABLE', urgent: true, published_at: '2026-07-20', price_history: [{ price: 255000 }, { price: 239000 }],
  price_changes: [], changes: [], location: { point: [4.8455, 45.756] }, building: { construction_year: 1955, risks: { natural: [{ key: 'inondation' }] } },
}
const ctx = { ref: { ppm2: 4513, scope: 'recent' }, pois: [{ cat: 'transport', point: [4.8425, 45.7549], name: 'Guillotière' }], isochrones: [], profile: { net_income_monthly: 5000, down_payment: 40000 } }

test('the review: strong points, points to watch and questions, each from its source', () => {
  const r = review(l, ctx)
  assert.deepEqual(r.pros.map(x => x.source), ['DVF', 'annonce', 'annonce', 'OpenStreetMap'])
  assert.match(r.pros[0].text, /^17 % sous le prix vendu/)
  assert.match(r.cons.find(x => /DPE F/.test(x.text)).text, /location interdite dès 2028, travaux estimés de 12/)
  assert.ok(r.cons.some(x => x.text === '4ᵉ étage sans ascenseur') && r.cons.some(x => x.source === 'Géorisques'))
  assert.ok(r.questions.some(q => /procès-verbaux/.test(q)))
})

test('the score: the weighted mean of what is known, out of 100', () => {
  const s = score(l, ctx)
  assert.deepEqual(s.parts.map(p => [p.key, p.value]), [['price', 1], ['budget', 1], ['energy', 0.17], ['transport', 0.9], ['travel', null], ['outdoor', 1]])
  assert.equal(s.value, 81)
  // a buyer who only cares for energy
  assert.equal(score(l, { ...ctx, profile: { ...ctx.profile, weights: { price: 0, budget: 0, energy: 3, transport: 0, travel: 0, outdoor: 0 } } }).value, 17)
})

test('types: a parking takes no rooms, is weighed on its price, against the sales of its type', () => {
  const p = { property_type: 'parking', price: 22000, price_per_m2: null, features: {} }
  assert.ok(matches(p, { rooms_min: 3, budget_max: 25000 }, ['flat', 'parking']))
  assert.ok(!matches(p, {}, ['flat']))
  assert.equal(unitPrice(p), 22000)
  const m = { dvf: { flat: { recent: { count: 600, median_ppm2: 4513 } }, parking: { recent: { count: 3 }, zone: { count: 40, median_ppm2: 25000 } } } }
  assert.deepEqual([reference(m, 'flat').ppm2, reference(m, 'parking').ppm2, reference(m, 'parking').scope, reference(m, 'house')], [4513, 25000, 'zone', null])
})

test('renting the same flat, and the work of a DPE F', () => {
  const rent = { flat: { per_m2: 16.4 }, flat_small: { per_m2: 18.87 }, flat_large: { per_m2: 15.22, low: 11.75, high: 19.71 }, house: { per_m2: 17.89 } }
  assert.equal(rentOf(l, rent).per_m2, 15.22)
  assert.equal(rentOf({ property_type: 'house' }, rent).per_m2, 17.89)
  const r = rentVsBuy(l, rentOf(l, rent), ctx.profile)
  assert.deepEqual([r.rent, r.low, r.high, r.gross_yield], [974, 752, 1261, 0.049])
  // at 3.4 %, renting stays cheaper than owning: no break-even
  assert.equal(r.break_even_years, null)
  assert.ok(rentVsBuy(l, rentOf(l, rent), { ...ctx.profile, rate: 1, down_payment: 200000 }).break_even_years > 0)
  assert.deepEqual(works(l), { low: 12800, high: 22400 })
  assert.equal(works({ ...l, property_type: 'parking' }), null)
})
