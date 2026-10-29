import assert from 'node:assert/strict'
import test, { mock } from 'node:test'
import { estimate, gate, routeOf, usage } from '../lib/costs.js'
import { NoCredits, queryString, se } from '../lib/stream.js'

test('routes with their ids put back', () => {
  assert.equal(routeOf('GET', '/documents/properties'), 'GET /documents/properties')
  assert.equal(routeOf('GET', '/documents/properties/0199'), 'GET /documents/properties/{id}')
  assert.equal(routeOf('PUT', '/searches/abc'), 'PUT /searches/{id}')
  assert.equal(routeOf('POST', '/searches'), 'POST /searches')
})

test('estimates: per item returned, unknown until measured', () => {
  assert.equal(estimate('GET /documents/properties', { results: 37 }), 37)
  assert.equal(estimate('GET /documents/properties', { results: 0 }), 0)
  assert.equal(estimate('GET /indicators/price_per_meter'), null)
  assert.equal(estimate('DELETE /searches/{id}', { calls: 2 }, { 'DELETE /searches/{id}': 0 }), 0)
  assert.equal(estimate('GET /indicators/price_per_meter', { calls: 1 }, { 'GET /indicators/price_per_meter': 1 }), 1)
})

test('the v1 query string: [] for a list, indexes inside arrays, raw brackets', () => {
  assert.equal(queryString({ propertyTypes: [0, 1], expired: false, budgetMax: undefined, 'order[updatedAt]': 'desc' }), 'propertyTypes[]=0&propertyTypes[]=1&expired=false&order[updatedAt]=desc')
  assert.equal(queryString({ geoShapes: [[[4.84, 45.75], [4.85, 45.76]]] }), 'geoShapes[0][0][0]=4.84&geoShapes[0][0][1]=45.75&geoShapes[0][1][0]=4.85&geoShapes[0][1][1]=45.76')
  assert.equal(queryString({ fromUpdatedAt: '2026-10-28T10:00:00.000Z' }), 'fromUpdatedAt=2026-10-28T10%3A00%3A00.000Z')
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
    { date: '2026-09-20T10:00:00Z', route: 'GET /documents/properties', credits: 40, search: 'a' },
    { date: '2026-10-02T10:00:00Z', route: 'GET /documents/properties', credits: 30, search: 'a' },
    { date: '2026-10-20T10:00:00Z', route: 'GET /documents/properties', credits: 1, search: 'b' },
    { date: '2026-10-21T10:00:00Z', route: 'GET /indicators/price_per_meter', credits: null, search: 'b' },
  ]
  const u = usage(log, new Date('2026-10-27T12:00:00Z'))
  assert.deepEqual([u.month, u.last30, u.unknown], [31, 31, 1])
  assert.deepEqual(u.by_search.a, { calls: 2, credits: 70, unknown: 0 })
  assert.deepEqual(u.by_month, { '2026-09': 40, '2026-10': 31 })
})

test('the client: the key in a header, the items returned, a 402 that stops, a 429 that waits', async t => {
  const calls = []
  let next = []
  mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url: String(url), init })
    return next.shift()
  })
  t.after(() => mock.restoreAll())
  const charged = []
  next = [new Response('{"hydra:member":[{"uuid":"a"},{"uuid":"b"}],"hydra:totalItems":9}', { status: 200 })]
  const r = await se('GET', '/documents/properties', { key: 'k', query: { itemsPerPage: 2, propertyTypes: [0] }, charged: x => charged.push(x) })
  assert.equal(calls[0].init.headers['X-API-KEY'], 'k')
  assert.equal(calls[0].init.headers.Accept, 'application/ld+json')
  assert.match(calls[0].url, /\/documents\/properties\?itemsPerPage=2&propertyTypes\[\]=0$/)
  assert.deepEqual(charged, [{ route: 'GET /documents/properties', results: 2 }])
  assert.equal(r.data['hydra:totalItems'], 9)
  next = [new Response('{"hydra:member":[],"hydra:totalItems":9}', { status: 200 })]
  await se('GET', '/documents/properties', { key: 'k', query: { itemsPerPage: 0 }, charged: x => charged.push(x) })
  assert.equal(charged.at(-1).results, 0, 'a count returns no item')
  next = [new Response('', { status: 402 })]
  await assert.rejects(se('GET', '/documents/properties', { key: 'k' }), NoCredits)
  next = [new Response('', { status: 404 })]
  assert.deepEqual(await se('GET', '/documents/properties/x', { key: 'k' }), { status: 404, data: null })
  next = [new Response('', { status: 429, headers: { 'Retry-After': '0.01' } }), new Response('[]', { status: 200 })]
  assert.equal((await se('GET', '/searches', { key: 'k' })).status, 200)
  await assert.rejects(se('GET', '/searches', { key: '' }), /no key/)
})
