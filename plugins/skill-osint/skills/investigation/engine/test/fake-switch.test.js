// The Fake APIs switch (developer mode): the server's state, POST /api/fake and /api/developer, the environment of the
// engine commands it starts, `setup set developer.on=…`, the « fake APIs » line in a case's Journal and print footer.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { startServer } from '../lib/server.js'
import { saveDeveloper } from '../lib/watch.js'
import { readNote } from '../lib/vault.js'
import { casesFolder, ENGINE, finishedCase, json, NEW, read, run, serveHome } from './helpers.js'

const BASES = { OSINT_BASE_RDAP: 'http://127.0.0.1:9/rdap', OSINT_BASE_WEB: 'http://127.0.0.1:9/web', OSINT_DNS: '/tmp/dns.json' }
const KEYS = Object.keys(BASES)
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-dist-'))
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>OSINT</title>')
// an « engine » that prints the fake variables it was started with: what a command run by the server would see
const spy = path.join(dist, 'spy.mjs')
fs.writeFileSync(spy, 'console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("OSINT_BASE_") || k === "OSINT_DNS"))))')

// a server started with `env` as the fake bases (or none); process.env is put back when the test ends
async function serve(t, env, home = casesFolder()) {
  const was = Object.fromEntries(KEYS.map(k => [k, process.env[k]]))
  for (const k of KEYS) delete process.env[k]
  Object.assign(process.env, env)
  const server = await startServer({ home, port: 0, dist, engine: spy, loaded: 0, watch: false })
  t.after(() => { server.close(); server.closeAllConnections(); for (const k of KEYS) { if (was[k] === undefined) delete process.env[k]; else process.env[k] = was[k] } })
  const base = `http://127.0.0.1:${server.address().port}`
  const call = (route, method = 'GET', body) => fetch(base + route, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }))
  return { base, home, state: () => call('/api/state').then(r => r.body), fake: on => call('/api/fake', 'POST', { on }), developer: on => call('/api/developer', 'POST', { on }), env: () => call('/api/doctor').then(r => r.body) }
}

test('a server started on fake bases: developer mode and the fakes on, its commands get the bases', async t => {
  const s = await serve(t, BASES)
  assert.deepEqual(await s.state(), { ...await s.state(), developer: true, fake: true, fake_available: true, fake_url: 'http://127.0.0.1:9' })
  assert.deepEqual(await s.env(), BASES)
})

test('a server without fake bases: nothing shown, nothing to turn on (409)', async t => {
  const s = await serve(t, {})
  const st = await s.state()
  assert.deepEqual([st.developer, st.fake, st.fake_available], [false, false, false])
  assert.equal((await s.fake(true)).status, 409)
  assert.deepEqual(await s.env(), {})
})

test('off removes the bases (and the fake resolver) from what the server starts, on puts them back; no restart', async t => {
  const s = await serve(t, BASES)
  assert.equal((await s.fake(false)).status, 200)
  assert.equal((await s.state()).fake, false)
  assert.deepEqual(await s.env(), {})
  assert.equal((await s.fake(true)).status, 200)
  assert.deepEqual(await s.env(), BASES)
})

test('what the server starts for a click (Refresh) runs on the setting at that moment', async t => {
  const home = casesFolder()
  await run(home, NEW)
  const seen = []
  const was = process.env.OSINT_BASE_RDAP
  process.env.OSINT_BASE_RDAP = BASES.OSINT_BASE_RDAP
  const server = await startServer({ home, port: 0, dist, engine: ENGINE, loaded: 0, watch: false, run: async () => { seen.push(!!process.env.OSINT_BASE_RDAP); return { code: 0, out: '{}', err: '' } } })
  t.after(() => { server.close(); server.closeAllConnections(); if (was === undefined) delete process.env.OSINT_BASE_RDAP; else process.env.OSINT_BASE_RDAP = was })
  const base = `http://127.0.0.1:${server.address().port}`
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  await post('/api/cases/durand-bakery-example/refresh', {})
  await post('/api/fake', { on: false })
  await post('/api/cases/durand-bakery-example/refresh', {})
  await post('/api/fake', { on: true })
  await post('/api/cases/durand-bakery-example/refresh', {})
  assert.deepEqual(seen, [true, false, true])
})

test('the routes keep the Host/Origin check: a foreign page changes nothing', async t => {
  const s = await serve(t, BASES)
  const port = new URL(s.base).port
  const post = (route, headers, body) => new Promise(ok => { const r = http.request(`${s.base}${route}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, x => { x.resume(); ok(x.statusCode) }); r.end(JSON.stringify(body)) })
  for (const route of ['/api/fake', '/api/developer']) {
    assert.equal(await post(route, { origin: 'http://evil.example' }, { on: false }), 403, route)
    assert.equal(await post(route, { origin: 'http://127.0.0.1:1' }, { on: false }), 403, route)
    assert.equal(await post(route, { host: 'evil.example' }, { on: false }), 403, route)
  }
  assert.equal(await post('/api/fake', { origin: `http://localhost:${port}` }, { on: false }), 200)
  assert.deepEqual([(await s.state()).fake, (await s.state()).developer], [false, true])
})

test('the value of a setting is validated; developer mode off turns the fakes off and refuses them', async t => {
  const s = await serve(t, BASES)
  for (const on of ['yes', 1, 'true', undefined, {}]) assert.equal((await s.developer(on)).status, 400, String(on))
  for (const on of ['yes', 1, null, undefined]) assert.equal((await s.fake(on)).status, 400, String(on))
  assert.equal(fs.existsSync(path.join(s.home, '.osint-settings.json')), false, 'a refused value writes nothing')
  assert.equal((await s.developer(false)).status, 200)
  assert.deepEqual([(await s.state()).developer, (await s.state()).fake], [false, false])
  assert.deepEqual(await s.env(), {})
  assert.equal((await s.fake(true)).status, 409, 'no fakes while developer mode is off')
  assert.equal((await s.developer(true)).status, 200)
  assert.deepEqual([(await s.state()).developer, (await s.state()).fake], [true, true])
  assert.deepEqual(json(s.home, '.osint-settings.json').developer, { on: true })
})

test('the setting is read when the server starts: off in the file, fakes off, switch hidden', async t => {
  const home = casesFolder()
  fs.writeFileSync(path.join(home, '.osint-settings.json'), JSON.stringify({ developer: { on: false } }))
  const s = await serve(t, BASES, home)
  assert.deepEqual([(await s.state()).developer, (await s.state()).fake, (await s.state()).fake_available], [false, false, true])
  assert.deepEqual(await s.env(), {})
})

test('a folder that says developer.on: true cannot give a server fake bases it was not started with', async t => {
  const home = casesFolder()
  fs.writeFileSync(path.join(home, '.osint-settings.json'), JSON.stringify({ developer: { on: true }, fake: true }))
  fs.mkdirSync(path.join(home, 'x', '.osint'), { recursive: true })
  fs.writeFileSync(path.join(home, 'x', '.osint', 'case.json'), JSON.stringify({ fake: true, developer: { on: true }, env: BASES }))
  const s = await serve(t, {}, home)
  assert.equal((await s.state()).fake, false)
  assert.equal((await s.fake(true)).status, 409)
  assert.deepEqual(await s.env(), {})
})

test('a base that does not point at 127.0.0.1 is not a fake: not switchable, environment left as it is', async t => {
  const s = await serve(t, { OSINT_BASE_RDAP: 'http://rdap.example.com/rdap' })
  const st = await s.state()
  assert.deepEqual([st.fake_available, st.developer], [false, false])
  assert.equal((await s.fake(false)).status, 409)
  assert.deepEqual(await s.env(), { OSINT_BASE_RDAP: 'http://rdap.example.com/rdap' })
})

test('setup set developer.on=on|off|none writes the folder\'s setting; anything else is refused', async () => {
  const home = casesFolder(), file = path.join(home, '.osint-settings.json')
  const r1 = await run(home, ['setup', 'set', 'developer.on=off'])
  assert.equal(r1.status, 0, r1.err)
  assert.deepEqual(json(home, '.osint-settings.json').developer, { on: false })
  await run(home, ['setup', 'set', 'developer.on=on'])
  assert.deepEqual(json(home, '.osint-settings.json').developer, { on: true })
  const before = fs.readFileSync(file, 'utf8')
  for (const bad of ['developer.on=maybe', 'developer.on=', 'developer.off=on', 'watch.on=true', 'developer.on']) {
    const r = await run(home, ['setup', 'set', bad])
    assert.notEqual(r.status, 0, bad)
    assert.match(r.err, /usage: setup set developer\.on=<on\|off\|none>/, bad)
    assert.equal(fs.readFileSync(file, 'utf8'), before, bad)
  }
  await run(home, ['setup', 'set', 'developer.on=none'])
  assert.deepEqual(json(home, '.osint-settings.json').developer, { on: null })
})

test('a case made or refreshed on fake APIs says so in its Journal; one on the real services does not', async () => {
  const fakeEnv = { OSINT_BASE_RDAP: BASES.OSINT_BASE_RDAP }, home = casesFolder(), real = casesFolder()
  const fakeCase = { OSINT_TYPES: path.join(path.dirname(ENGINE), 'test', 'fixtures', 'types'), OSINT_SAMPLE_ITEMS: '[]' }
  await run(home, NEW, fakeEnv)
  await run(real, NEW, { OSINT_BASE_RDAP: '' })
  const journal = h => readNote(path.join(h, 'durand-bakery-example', 'Journal.md')).body
  assert.equal((journal(home).match(/fake APIs/g) ?? []).length, 1)
  assert.doesNotMatch(journal(real), /fake APIs/)
  await run(home, ['new', 'sample', 'thing', '--question', 'Q?', '--frame', 'noisy=never'], { ...fakeCase, ...fakeEnv })
  const r = await run(home, ['refresh', '-p', 'thing', '--json'], { ...fakeCase, ...fakeEnv })
  assert.equal(r.status, 0, r.err)
  assert.equal((readNote(path.join(home, 'thing', 'Journal.md')).body.match(/fake APIs/g) ?? []).length, 2, 'created, then refreshed')
  assert.equal(json(path.join(home, 'thing'), '.osint/case.json').fake_apis, true)
})

test('the print view of a case made on fake APIs carries « Fake APIs » in its footer; a real one does not', async t => {
  const { home } = await finishedCase()
  const { base, close } = await serveHome(home)
  t.after(close)
  const page = () => fetch(`${base}/print/durand-bakery-example`).then(r => r.text())
  assert.doesNotMatch(await page(), /<footer/)
  const f = path.join(home, 'durand-bakery-example', '.osint', 'case.json'), c = JSON.parse(read(home, 'durand-bakery-example/.osint/case.json'))
  fs.writeFileSync(f, JSON.stringify({ ...c, fake_apis: true }))
  assert.match(await page(), /<footer[^>]*>[^<]*Fake APIs/)
})

test('saveDeveloper takes true, false or null and nothing else', () => {
  const home = casesFolder()
  for (const bad of ['on', 1, undefined, 'false']) assert.throws(() => saveDeveloper(home, bad), /developer\.on: on, off or none/)
  assert.equal(fs.existsSync(path.join(home, '.osint-settings.json')), false)
  assert.deepEqual(saveDeveloper(home, false).developer, { on: false })
})

test('the state says a command is running (the dashboard asks before going from fake to real APIs)', async t => {
  const home = casesFolder()
  await run(home, NEW)
  let release
  const held = new Promise(ok => { release = ok })
  const server = await startServer({ home, port: 0, dist, engine: ENGINE, loaded: 0, watch: false, run: async () => { await held; return { code: 0, out: '{}', err: '' } } })
  t.after(() => { release(); server.close(); server.closeAllConnections() })
  const base = `http://127.0.0.1:${server.address().port}`
  assert.equal((await fetch(`${base}/api/state`).then(r => r.json())).busy, false)
  const pending = fetch(`${base}/api/cases/durand-bakery-example/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  await new Promise(ok => setTimeout(ok, 200))
  assert.equal((await fetch(`${base}/api/state`).then(r => r.json())).busy, true)
  release(); await pending
  assert.equal((await fetch(`${base}/api/state`).then(r => r.json())).busy, false)
})
