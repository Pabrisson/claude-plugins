import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { ENGINE, fakeStreamEstate, property, searchesFolder } from './helpers.js'

// the dashboard server on a free port, over a throwaway searches folder and the fake Stream Estate
const api = await fakeStreamEstate()
const { home, dir } = searchesFolder(), port = 41700 + Math.floor(Math.random() * 300)
// the zone's DPE as the last refresh saw them: one, so that the watch at the server's start finds the other; no audit
// nor permit yet, so that it finds the zone's
const ademe = path.join(home, '.cache/ademe'), dpe = JSON.parse(fs.readFileSync(path.join(ademe, fs.readdirSync(ademe).find(f => f.startsWith('recent-'))), 'utf8'))
fs.writeFileSync(path.join(dir, 'area.json'), JSON.stringify({ dpe_recent: dpe.filter(d => d.number === '2669E0000002B'), audit_recent: [], permit_recent: [] }))
const server = spawn(process.execPath, [ENGINE, 'serve'], { env: { ...process.env, IMMO_DIR: home, IMMO_PORT: `${port}`, IMMO_NOTIFY: '0', STREAM_ESTATE_BASE: api.url, STREAM_ESTATE_API_KEY: 'test-key' } })
const base = `http://127.0.0.1:${port}`
test.after(() => { server.kill(); api.close() })

const up = async () => { for (let i = 0; i < 50; i++) { if (await fetch(base + '/__immo').then(() => true, () => false)) return; await new Promise(ok => setTimeout(ok, 100)) } }
const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) })

test('the searches, one search, the state without the key', async () => {
  await up()
  assert.deepEqual((await (await fetch(base + '/api/searches')).json()).map(s => [s.slug, s.mode, s.listings]), [['paul-bert', 'stream-estate', 0]])
  const s = await (await fetch(base + '/api/s/paul-bert')).json()
  assert.deepEqual([s.search.slug, s.listings.length], ['paul-bert', 0])
  const state = await (await fetch(base + '/api/state')).text()
  assert.equal(JSON.parse(state).stream_estate, true)
  assert.equal(JSON.parse(state).test_api, api.url, "the dashboard says it is the tests' fake API")
  assert.ok(!state.includes('test-key'), 'the key never reaches the browser')
  assert.equal((await fetch(base + '/api/s/nope')).status, 404)
})

test("the server's watch at its start: a new DPE, audit and permit are news, the listings to fetch a count; read one by one or all; alerts and settings", async () => {
  let s
  for (let i = 0; i < 50 && !(s = await (await fetch(base + '/api/s/paul-bert')).json()).feed.items.length; i++) await new Promise(ok => setTimeout(ok, 100))
  // the flat's DPE in the zone (the house is already known, the third one is outside the 500 m), the zone's audit and
  // permit (Lyon's other one is in the 9e); the API's count apart
  assert.deepEqual(s.feed.items.map(n => [n.kind, n[n.kind].number]), [['dpe', '2669E0000001A'], ['audit', 'A26690000001A'], ['permit', 'PD06912326V0001']])
  assert.equal(s.feed.stream.total, 1)
  assert.deepEqual(s.area.dpe_recent.map(d => d.number), ['2669E0000001A', '2669E0000002B'])
  assert.deepEqual([s.area.audit_recent.length, s.area.permit_recent.length], [1, 1])
  assert.equal(s.unread, 3)
  // alerts turned off: their news no longer count; a bad alert is refused
  assert.equal((await post('/api/s/paul-bert/alerts', { off: ['dpe', 'audit', 'permit'] })).status, 200)
  assert.equal((await (await fetch(base + '/api/s/paul-bert/version')).json()).unread, 0)
  assert.deepEqual((await (await fetch(base + '/api/s/paul-bert')).json()).alerts, { off: ['dpe', 'audit', 'permit'], custom: [] })
  assert.equal((await post('/api/s/paul-bert/alerts', { custom: [{ id: 'a', name: 'x', event: 'dpe', conditions: [{ field: 'energy', op: 'gte', value: 'Z' }] }] })).status, 400)
  assert.equal((await post('/api/s/paul-bert/alerts', {})).status, 200)
  // read one by one (its key), then all
  const key = `dpe-${s.feed.items[0].date}-2669E0000001A`
  assert.equal((await post('/api/s/paul-bert/feed/read', { keys: [key] })).status, 200)
  assert.equal((await (await fetch(base + '/api/s/paul-bert/version')).json()).unread, 2, 'the audit and the permit')
  assert.equal((await post('/api/s/paul-bert/feed/read', {})).status, 200)
  assert.equal((await (await fetch(base + '/api/s/paul-bert/version')).json()).unread, 0)
  // the settings: checked, then the API off for every search
  assert.equal((await post('/api/settings', { watch_minutes: 17 })).status, 400)
  assert.equal((await post('/api/settings', { quiet: ['22:00', '8h'] })).status, 400)
  const st = await (await post('/api/settings', { watch_minutes: 30, api: false, quiet: ['22:00', '08:00'] })).json()
  assert.deepEqual([st.watch_minutes, st.api, st.quiet, st.auto_fetch], [30, false, ['22:00', '08:00'], false])
  const state = await (await fetch(base + '/api/state')).json()
  assert.deepEqual([state.stream_estate, state.has_key, !!state.watch.next], [false, true, true])
  assert.equal((await post('/api/settings', { watch_minutes: 360, api: true })).status, 200)
  // paused: no next watch, its period kept; resumed: the next one is back
  let w = (await (await post('/api/settings', { watch_paused: true })).json())
  assert.deepEqual([w.watch_paused, w.watch_minutes], [true, 360])
  w = (await (await fetch(base + '/api/state')).json()).watch
  assert.deepEqual([w.paused, w.next], [true, null])
  await post('/api/settings', { watch_paused: false })
  w = (await (await fetch(base + '/api/state')).json()).watch
  assert.ok(!w.paused && w.next, JSON.stringify(w))
  // the watch's free count is not logged
  assert.ok(!fs.existsSync(path.join(home, '.cache/api-usage.json')))
})

test('a paid action from the dashboard: the estimate first, then the run with the spend the user accepted', async () => {
  let r = await (await post('/api/run', { cmd: 'fetch', slug: 'paul-bert', estimate: true })).json()
  assert.deepEqual([r.code, r.estimate.credits, r.estimate.eur], [0, 1, 0.01])
  r = await (await post('/api/run', { cmd: 'fetch', slug: 'paul-bert' })).json()
  assert.equal(r.code, 2)
  r = await (await post('/api/run', { cmd: 'fetch', slug: 'paul-bert', args: { spend: 1 } })).json()
  assert.equal(r.code, 0, r.err)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'listings.json'), 'utf8')).length, 1)
  assert.equal((await post('/api/run', { cmd: 'doctor' })).status, 400)
  assert.equal((await post('/api/run', { cmd: 'fetch', slug: '../etc' })).status, 400)
})

test("the user's status and notes, the last visit, the profile", async () => {
  let r = await post(`/api/s/paul-bert/listings/${property.uuid}`, { my_status: 'to_visit', notes: 'Visite samedi' })
  assert.equal(r.status, 200)
  assert.deepEqual(Object.values((({ my_status, notes }) => ({ my_status, notes }))(await r.json())), ['to_visit', 'Visite samedi'])
  assert.equal((await post(`/api/s/paul-bert/listings/${property.uuid}`, { my_status: 'bought' })).status, 400)
  // a star, apart from the status; anything but a boolean leaves it as it is
  assert.equal((await (await post(`/api/s/paul-bert/listings/${property.uuid}`, { favorite: true })).json()).favorite, true)
  assert.equal((await (await post(`/api/s/paul-bert/listings/${property.uuid}`, { favorite: 'yes' })).json()).favorite, true)
  const fav = await (await post(`/api/s/paul-bert/listings/${property.uuid}`, { favorite: false })).json()
  assert.deepEqual([fav.favorite, fav.my_status], [false, 'to_visit'])
  assert.equal((await post('/api/s/paul-bert/listings/nope', { notes: 'x' })).status, 404)
  assert.equal((await (await post('/api/s/paul-bert/visit', {})).json()).last_visit, null)
  assert.ok((await (await post('/api/s/paul-bert/visit', {})).json()).last_visit)
  const p = await (await post('/api/profile', { rate: 3.1, down_payment: '50000', places: 'nope', weights: { price: 9, energy: '1', nope: 2 } })).json()
  assert.deepEqual([p.rate, p.down_payment, p.places, p.weights.price, p.weights.energy, p.weights.nope], [3.1, 50000, [], 3, 1, undefined])
})

test('a message marked sent: an offer puts the listing in "Offre faite"', async () => {
  const f = path.join(dir, 'listings.json'), ls = JSON.parse(fs.readFileSync(f, 'utf8'))
  ls[0].messages = [{ id: 'm-1', kind: 'offer', amount: 250000, text: 'x', sent_at: null }]
  ls[0].my_status = 'to_visit'
  fs.writeFileSync(f, JSON.stringify(ls))
  const l = await (await post(`/api/s/paul-bert/listings/${property.uuid}`, { message: { id: 'm-1', sent: true } })).json()
  assert.ok(l.messages[0].sent_at)
  assert.equal(l.my_status, 'offer')
  assert.equal((await post(`/api/s/paul-bert/listings/${property.uuid}`, { message: { id: 'nope', sent: true } })).status, 404)
  // the user adds the agent's reply, then deletes it; a bad one is refused
  const msg = (body) => post(`/api/s/paul-bert/listings/${property.uuid}`, { message: body })
  let c = await (await msg({ add: { from: 'them', channel: 'email', text: 'Le vendeur accepte 255 000 €.' } })).json()
  const got = c.messages.at(-1)
  assert.deepEqual([got.from, got.channel, got.sent_at, got.text], ['them', 'email', null, 'Le vendeur accepte 255 000 €.'])
  assert.equal((await msg({ add: { from: 'nobody', text: 'x' } })).status, 400)
  assert.equal((await msg({ add: { from: 'them', text: '  ' } })).status, 400)
  c = await (await msg({ id: got.id, delete: true })).json()
  assert.ok(!c.messages.some(x => x.id === got.id))
})

test('a listing the user typed: added free with its building data; refused without a price, with a bad link or type, when its link is known', async () => {
  const add = body => post('/api/s/paul-bert/listings', body)
  assert.equal((await add({ area: 50 })).status, 400)
  assert.equal((await add({ price: 250000, area: 50, url: 'javascript:alert(1)' })).status, 400)
  assert.equal((await add({ price: 250000, area: 50, type: 'toString' })).status, 400)
  const r = await add({ type: 'flat', price: 250000, area: 50, rooms: 2, dpe: 'D', point: [4.8455, 45.756], url: 'https://www.example.com/annonce-1' })
  assert.equal(r.status, 200)
  const l = await r.json()
  assert.deepEqual([l.id.slice(0, 2), l.source, l.price_per_m2, l.building.risks.natural[0].key], ['m-', 'manual', 5000, 'seisme'])
  const again = await add({ price: 240000, area: 50, url: 'https://www.example.com/annonce-1?utm_source=x' })
  assert.deepEqual([again.status, (await again.json()).id], [409, l.id])
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'listings.json'), 'utf8')).length, 2)
})

test('the version follows the files; a search is deleted, not one with an alert', async () => {
  const v = (await (await fetch(base + '/api/s/paul-bert/version')).json()).version
  assert.equal((await (await fetch(base + '/api/s/paul-bert')).json()).version, v)
  fs.utimesSync(path.join(dir, 'listings.json'), new Date(), new Date(Date.now() + 5000))
  assert.ok((await (await fetch(base + '/api/s/paul-bert/version')).json()).version > v)
  const gone = path.join(home, 'to-delete'), del = slug => fetch(`${base}/api/s/${slug}`, { method: 'DELETE' })
  fs.cpSync(dir, gone, { recursive: true })
  const f = path.join(gone, 'search.json'), s = JSON.parse(fs.readFileSync(f, 'utf8'))
  fs.writeFileSync(f, JSON.stringify({ ...s, alert: { searches: [{ id: 's-1', type: 'flat' }] } }))
  assert.equal((await del('to-delete')).status, 409)
  fs.writeFileSync(f, JSON.stringify({ ...s, alert: null }))
  assert.equal((await del('to-delete')).status, 200)
  assert.ok(!fs.existsSync(gone))
  assert.equal((await del('to-delete')).status, 404)
  assert.equal((await fetch(`${base}/api/s/paul-bert`, { method: 'DELETE', headers: { Origin: 'https://evil.example' } })).status, 403)
})

test('a zone drawn on the map: kept as a draft for Claude, closed and rounded; the search does not change', async () => {
  const v = (await (await fetch(base + '/api/s/paul-bert/version')).json()).version
  for (const geometry of [null, { type: 'Point', coordinates: [4.85, 45.75] }, { type: 'Polygon', coordinates: [[[4.85, 45.75], [4.86, 45.75]]] }, { type: 'Polygon', coordinates: [[[4.85, 45.75], [4.86, 'x'], [4.86, 45.76]]] }, { type: 'Polygon', coordinates: [Array.from({ length: 61 }, (_, i) => [4.85 + i / 1e5, 45.75 + (i % 2) / 1e4])] }])
    assert.equal((await post('/api/s/paul-bert/zone', { geometry })).status, 400, JSON.stringify(geometry).slice(0, 80))
  const r = await post('/api/s/paul-bert/zone', { geometry: { type: 'Polygon', coordinates: [[[4.85, 45.75], [4.86, 45.75], [4.8600004, 45.7600004]]] } })
  assert.equal(r.status, 200)
  const draft = JSON.parse(fs.readFileSync(path.join(dir, 'zone-draft.json'), 'utf8'))
  assert.deepEqual(draft.geometry, { type: 'Polygon', coordinates: [[[4.85, 45.75], [4.86, 45.75], [4.86, 45.76], [4.85, 45.75]]] })
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'search.json'), 'utf8')).zone.how, 'radius')
  assert.equal((await (await fetch(base + '/api/s/paul-bert/version')).json()).version, v, 'no « Recharger » bar for a draft')
  // 60 corners: the most the map's editor and Stream Estate take
  const sixty = Array.from({ length: 60 }, (_, i) => [+(4.85 + 0.01 * Math.cos(i / 9.55)).toFixed(6), +(45.75 + 0.01 * Math.sin(i / 9.55)).toFixed(6)])
  assert.equal((await post('/api/s/paul-bert/zone', { geometry: { type: 'Polygon', coordinates: [sixty] } })).status, 200)
  fs.rmSync(path.join(dir, 'zone-draft.json'))
})

test('the odds of a box of the map: refused without a box, or too wide for the map to load', async () => {
  for (const q of ['', '?bbox=4.8,45.7', '?bbox=4.9,45.7,4.8,45.8']) assert.equal((await fetch(base + '/api/odds' + q)).status, 400)
  assert.deepEqual(await (await fetch(base + '/api/odds?bbox=4.5,45.5,5,45.9')).json(), { error: 'zoom' })
})

test('nothing from a foreign site', async () => {
  assert.equal((await post('/api/profile', { rate: 9 }, { Origin: 'https://evil.example' })).status, 403)
  // DNS rebinding: a page of another host name that resolves here (fetch cannot set Host, http can)
  const status = await new Promise(ok => http.get({ host: '127.0.0.1', port, path: '/api/state', headers: { Host: 'evil.example' } }, r => { r.resume(); ok(r.statusCode) }))
  assert.equal(status, 403)
})
