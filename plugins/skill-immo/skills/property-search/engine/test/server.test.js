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
const server = spawn(process.execPath, [ENGINE, 'serve'], { env: { ...process.env, IMMO_DIR: home, IMMO_PORT: `${port}`, STREAM_ESTATE_BASE: api.url, STREAM_ESTATE_API_KEY: 'test-key' } })
const base = `http://127.0.0.1:${port}`
test.after(() => { server.kill(); api.close() })

const up = async () => { for (let i = 0; i < 50; i++) { if (await fetch(base + '/__immo').then(() => true, () => false)) return; await new Promise(ok => setTimeout(ok, 100)) } }
const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) })

test('the searches, one search, the state without the key', async () => {
  await up()
  assert.deepEqual((await (await fetch(base + '/api/searches')).json()).map(s => [s.slug, s.mode, s.listings]), [['paul-bert', 'stream-estate', 0]])
  const s = await (await fetch(base + '/api/s/paul-bert')).json()
  assert.deepEqual([s.search.slug, s.listings.length, s.events.length], ['paul-bert', 0, 0])
  const state = await (await fetch(base + '/api/state')).text()
  assert.equal(JSON.parse(state).stream_estate, true)
  assert.ok(!state.includes('test-key'), 'the key never reaches the browser')
  assert.equal((await fetch(base + '/api/s/nope')).status, 404)
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
  let r = await post(`/api/s/paul-bert/listings/${property.id}`, { my_status: 'to_visit', notes: 'Visite samedi' })
  assert.equal(r.status, 200)
  assert.deepEqual(Object.values((({ my_status, notes }) => ({ my_status, notes }))(await r.json())), ['to_visit', 'Visite samedi'])
  assert.equal((await post(`/api/s/paul-bert/listings/${property.id}`, { my_status: 'bought' })).status, 400)
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
  const l = await (await post(`/api/s/paul-bert/listings/${property.id}`, { message: { id: 'm-1', sent: true } })).json()
  assert.ok(l.messages[0].sent_at)
  assert.equal(l.my_status, 'offer')
  assert.equal((await post(`/api/s/paul-bert/listings/${property.id}`, { message: { id: 'nope', sent: true } })).status, 404)
  // the user adds the agent's reply, then deletes it; a bad one is refused
  const msg = (body) => post(`/api/s/paul-bert/listings/${property.id}`, { message: body })
  let c = await (await msg({ add: { from: 'them', channel: 'email', text: 'Le vendeur accepte 255 000 €.' } })).json()
  const got = c.messages.at(-1)
  assert.deepEqual([got.from, got.channel, got.sent_at, got.text], ['them', 'email', null, 'Le vendeur accepte 255 000 €.'])
  assert.equal((await msg({ add: { from: 'nobody', text: 'x' } })).status, 400)
  assert.equal((await msg({ add: { from: 'them', text: '  ' } })).status, 400)
  c = await (await msg({ id: got.id, delete: true })).json()
  assert.ok(!c.messages.some(x => x.id === got.id))
})

test('the version follows the files; a search is deleted, not one with an alert', async () => {
  const v = (await (await fetch(base + '/api/s/paul-bert/version')).json()).version
  assert.equal((await (await fetch(base + '/api/s/paul-bert')).json()).version, v)
  fs.utimesSync(path.join(dir, 'listings.json'), new Date(), new Date(Date.now() + 5000))
  assert.ok((await (await fetch(base + '/api/s/paul-bert/version')).json()).version > v)
  const gone = path.join(home, 'to-delete'), del = slug => fetch(`${base}/api/s/${slug}`, { method: 'DELETE' })
  fs.cpSync(dir, gone, { recursive: true })
  const f = path.join(gone, 'search.json'), s = JSON.parse(fs.readFileSync(f, 'utf8'))
  fs.writeFileSync(f, JSON.stringify({ ...s, alert: { id: 'a-1' } }))
  assert.equal((await del('to-delete')).status, 409)
  fs.writeFileSync(f, JSON.stringify({ ...s, alert: null }))
  assert.equal((await del('to-delete')).status, 200)
  assert.ok(!fs.existsSync(gone))
  assert.equal((await del('to-delete')).status, 404)
  assert.equal((await fetch(`${base}/api/s/paul-bert`, { method: 'DELETE', headers: { Origin: 'https://evil.example' } })).status, 403)
})

test('nothing from a foreign site', async () => {
  assert.equal((await post('/api/profile', { rate: 9 }, { Origin: 'https://evil.example' })).status, 403)
  // DNS rebinding: a page of another host name that resolves here (fetch cannot set Host, http can)
  const status = await new Promise(ok => http.get({ host: '127.0.0.1', port, path: '/api/state', headers: { Host: 'evil.example' } }, r => { r.resume(); ok(r.statusCode) }))
  assert.equal(status, 403)
})
