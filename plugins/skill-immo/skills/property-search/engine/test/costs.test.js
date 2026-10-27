import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { estimate, gate, routeOf, usage } from '../lib/costs.js'
import { NoCredits, se } from '../lib/stream.js'

test('routes with their ids put back', () => {
  assert.equal(routeOf('POST', '/properties'), 'POST /properties')
  assert.equal(routeOf('POST', '/properties/lookup-by-url'), 'POST /properties/lookup-by-url')
  assert.equal(routeOf('POST', '/properties/0199/resolve-address'), 'POST /properties/{id}/resolve-address')
  assert.equal(routeOf('GET', '/alerts/abc/events'), 'GET /alerts/{id}/events')
  assert.equal(routeOf('POST', '/alerts/forecast'), 'POST /alerts/forecast')
})

test('estimates: per result, per call, unknown until measured', () => {
  assert.equal(estimate('POST /properties', { results: 37 }), 37)
  assert.equal(estimate('POST /properties', { results: 0 }), 0)
  assert.equal(estimate('GET /properties/{id}', { calls: 3 }), 3)
  assert.equal(estimate('POST /alerts/forecast'), 0)
  assert.equal(estimate('GET /analytics/listings'), null)
  assert.equal(estimate('GET /analytics/listings', { calls: 4 }, { 'GET /analytics/listings': 2 }), 8)
})

test('the gate: a yes for credits, another for an unknown cost, and the monthly cap', () => {
  const base = { cap: 500, spent: 100, eur: 0.01 }
  assert.match(gate({ ...base, credits: 37 }), /estimated 37 credits \(0,37 €\), 400 left .* --spend 37/)
  assert.match(gate({ ...base, credits: 37, spend: 20 }), /--spend 37/)
  assert.equal(gate({ ...base, credits: 37, spend: 37 }), null)
  assert.equal(gate({ ...base, credits: 0 }), null)
  assert.match(gate({ ...base, credits: null }), /unknown cost.*--accept-unknown/)
  assert.equal(gate({ ...base, credits: null, acceptUnknown: true }), null)
  assert.match(gate({ ...base, credits: 450, spend: 450 }), /monthly cap of 500 credits would be passed/)
  assert.equal(gate({ ...base, credits: 450, spend: 450, force: true }), null)
})

test('the log: this month, 30 days, per search and route', () => {
  const log = [
    { date: '2026-09-20T10:00:00Z', route: 'POST /properties', credits: 40, search: 'a' },
    { date: '2026-10-02T10:00:00Z', route: 'POST /properties', credits: 30, search: 'a' },
    { date: '2026-10-20T10:00:00Z', route: 'GET /properties/{id}', credits: 1, search: 'b' },
    { date: '2026-10-21T10:00:00Z', route: 'GET /analytics/listings', credits: null, search: 'b' },
  ]
  const u = usage(log, new Date('2026-10-27T12:00:00Z'))
  assert.deepEqual([u.month, u.last30, u.unknown], [31, 31, 1])
  assert.deepEqual(u.by_search.a, { calls: 2, credits: 70, unknown: 0 })
  assert.deepEqual(u.by_month, { '2026-09': 40, '2026-10': 31 })
})

test('the client: the key in a header, the credits charged, a 402 that stops, a 429 that waits', async t => {
  const calls = []
  let next = []
  mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), init })
    return next.shift()
  })
  t.after(() => mock.restoreAll())
  const charged = []
  next = [new Response('[{"id":"a"},{"id":"b"}]', { status: 200, headers: { 'X-Credits-Charged': '2' } })]
  const r = await se('POST', '/properties', { key: 'k', body: { size: 2 }, charged: x => charged.push(x) })
  assert.equal(calls[0].init.headers['X-API-KEY'], 'k')
  assert.deepEqual(charged, [{ route: 'POST /properties', credits: 2, results: 2 }])
  assert.equal(r.data.length, 2)
  next = [new Response('', { status: 402 })]
  await assert.rejects(se('POST', '/properties', { key: 'k', body: {} }), NoCredits)
  next = [new Response('', { status: 404 })]
  assert.deepEqual(await se('POST', '/properties/lookup-by-url', { key: 'k', body: { url: 'x' } }), { status: 404, data: null, credits: 0 })
  next = [new Response('', { status: 429, headers: { 'Retry-After': '0.01' } }), new Response('{}', { status: 200 })]
  assert.equal((await se('GET', '/alerts', { key: 'k' })).status, 200)
  await assert.rejects(se('GET', '/alerts', { key: '' }), /no key/)
})
