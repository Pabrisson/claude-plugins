import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { dataset, datasetsInfo } from '../lib/datasets.js'
import { sha256 } from '../lib/util.js'
import { startFake } from './fake.mjs'
import { casesFolder } from './helpers.js'

// a fixtures folder of its own: the tests change its files
const fx = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-ds-'))
const put = (rel, bytes) => { const f = path.join(fx, 'raw', 'x', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, bytes) }
put('hello.txt', 'hello')
put('latin1.csv', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x3b, 0x31])) // « café;1 » in ISO-8859-1
put('data.json', '{"n":2}')
const fake = await startFake({ fixtures: fx })
test.after(() => fake.close())
const HELLO = { service: 'raw', path: '/x/hello.txt', hours: 24, describe: t => `${t.length} chars` }
const asked = rel => fake.seen.filter(s => s.path === `/raw${rel}`).length
const age = (home, id, hours) => {
  const f = path.join(home, '.cache', 'datasets', `${id}.json`), m = JSON.parse(fs.readFileSync(f, 'utf8'))
  fs.writeFileSync(f, JSON.stringify({ ...m, at: new Date(Date.now() - hours * 3600e3).toISOString() }))
}
test.beforeEach(() => { process.env.OSINT_BASE_RAW = `${fake.url}/raw` })
test.afterEach(() => { delete process.env.OSINT_BASE_RAW })

test('a dataset is downloaded once, kept with its date, public URL, SHA-256 and size, then given from the cache', async () => {
  const home = casesFolder()
  const a = await dataset(home, 'hello', HELLO)
  assert.deepEqual([a.text, a.cached, a.url, a.size], ['hello', false, 'https://raw.githubusercontent.com/x/hello.txt', 5])
  const dir = path.join(home, '.cache', 'datasets'), meta = JSON.parse(fs.readFileSync(path.join(dir, 'hello.json'), 'utf8'))
  assert.deepEqual([meta.id, meta.url, meta.sha256, meta.size, meta.hours, meta.about], ['hello', a.url, sha256(Buffer.from('hello')), 5, 24, '5 chars'])
  assert.equal(fs.readFileSync(path.join(dir, 'hello'), 'utf8'), 'hello')
  const n = asked('/x/hello.txt')
  const b = await dataset(home, 'hello', HELLO)
  assert.deepEqual([b.text, b.cached, b.at, asked('/x/hello.txt')], ['hello', true, a.at, n])
  assert.equal((await dataset(home, 'latin', { service: 'raw', path: '/x/latin1.csv', hours: 1, encoding: 'latin1' })).text, 'café;1')
  assert.deepEqual(datasetsInfo(home).map(m => [m.id, m.size]), [['hello', 5], ['latin', 6]])
  await assert.rejects(dataset(home, '../x', HELLO), /dataset id/)
})

test('an expired copy is downloaded again; a failed download gives the copy marked stale; without a copy it throws', async () => {
  const home = casesFolder()
  await dataset(home, 'hello', HELLO)
  age(home, 'hello', 25)
  const n = asked('/x/hello.txt')
  assert.equal((await dataset(home, 'hello', HELLO)).cached, false)
  assert.equal(asked('/x/hello.txt'), n + 1)
  age(home, 'hello', 25)
  process.env.OSINT_BASE_RAW = 'http://127.0.0.1:9/raw' // nothing listens there
  const s = await dataset(home, 'hello', HELLO)
  assert.deepEqual([s.text, s.cached, s.stale], ['hello', true, true])
  assert.match(s.error, /raw\.githubusercontent\.com/)
  process.env.OSINT_BASE_RAW = `${fake.url}/raw`
  await assert.rejects(dataset(casesFolder(), 'gone', { service: 'raw', path: '/x/none.txt', hours: 1 }), /^Error: dataset gone: HTTP 404, and no copy in /)
})

test('a download that describe() cannot read keeps the previous copy', async () => {
  const home = casesFolder(), J = { service: 'raw', path: '/x/data.json', hours: 1, describe: t => `${JSON.parse(t).n} items` }
  assert.equal((await dataset(home, 'data', J)).text, '{"n":2}')
  age(home, 'data', 2)
  put('data.json', '<html>rate limited</html>')
  const s = await dataset(home, 'data', J)
  assert.deepEqual([s.text, s.stale], ['{"n":2}', true])
  assert.match(s.error, /JSON/)
  assert.equal(datasetsInfo(home)[0].about, '2 items')
})

test('a host net.js refuses is never hidden behind a copy', async () => {
  const home = casesFolder(), D = { service: 'web', path: 'https://generativelanguage.googleapis.com/x', hours: 1 }
  const meta = path.join(home, '.cache', 'datasets')
  fs.mkdirSync(meta, { recursive: true })
  fs.writeFileSync(path.join(meta, 'ai'), 'old')
  fs.writeFileSync(path.join(meta, 'ai.json'), JSON.stringify({ id: 'ai', url: 'u', at: new Date(0).toISOString(), sha256: 'x', size: 3, hours: 1 }))
  await assert.rejects(dataset(home, 'ai', D), /never calls generativelanguage/)
})
