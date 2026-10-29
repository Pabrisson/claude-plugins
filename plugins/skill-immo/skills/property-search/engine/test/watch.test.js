import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fromStreamEstate } from '../lib/listings.js'
import { ENGINE, fakeStreamEstate, property, searchesFolder } from './helpers.js'

// A search refreshed once, its one listing fetched: the fake API says it changed since (it matches the refresh's
// query, and nothing does once it is excluded). An alert watches the DPE of the rue Garibaldi, outside the zone: it
// already saw one, ADEME now has two more. The automatic fetch is on, 5 credits a month.
const api = await fakeStreamEstate()
const { home, dir } = searchesFolder(), port = 42000 + Math.floor(Math.random() * 300)
const write = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v)) }
write(path.join(dir, 'search.json'), { ...JSON.parse(fs.readFileSync(path.join(dir, 'search.json'), 'utf8')), last_refresh: '2026-10-20T10:00:00.000Z' })
write(path.join(dir, 'listings.json'), [{ ...fromStreamEstate(property), first_seen: '2026-10-20T10:00:00.000Z', price_history: [], my_status: null, notes: '', messages: [], changes: [] }])
const place = { how: 'street', ban: '69383_3030', label: 'Rue Garibaldi 69003 Lyon', point: [4.853, 45.753] }
write(path.join(dir, 'alerts.json'), { off: [], custom: [{ id: 'a-gar', name: 'Passoires rue Garibaldi', event: 'dpe', place, conditions: [{ field: 'energy', op: 'gte', value: 'F' }], enabled: true }] })
const row = (number, energy, n) => ({ number, date: '2026-10-25', energy, type: 'flat', area: 50, address: `${n} Rue Garibaldi 69003 Lyon`, ban: `69383_3030_000${n}`, point: [4.853, 45.753] })
write(path.join(home, '.cache/ademe/place-69383_3030.json'), [row('OLD1', 'G', 10), row('NEW1', 'G', 12), row('NEW2', 'C', 14)])
write(path.join(home, '.cache/alerts/paul-bert/a-gar.json'), ['OLD1'])
write(path.join(home, '.settings.json'), { auto_fetch: true, auto_credits: 5 })
const server = spawn(process.execPath, [ENGINE, 'serve'], { env: { ...process.env, IMMO_DIR: home, IMMO_PORT: `${port}`, IMMO_NOTIFY: '0', STREAM_ESTATE_BASE: api.url, STREAM_ESTATE_API_KEY: 'test-key' } })
test.after(() => { server.kill(); api.close() })

test('the watch: a DPE at an alert outside the zone, the changed listings counted free, then fetched automatically within its credits', async () => {
  const usage = path.join(home, '.cache/api-usage.json')
  let s
  for (let i = 0; i < 150; i++) {
    s = await fetch(`http://127.0.0.1:${port}/api/s/paul-bert`).then(r => r.json(), () => null)
    if (s && fs.existsSync(usage) && JSON.parse(fs.readFileSync(usage, 'utf8')).some(e => e.by === 'auto')) break
    await new Promise(ok => setTimeout(ok, 100))
  }
  // the G one the alert had not seen; the C one fails its condition
  assert.deepEqual(s.feed.items.map(n => [n.dpe.number, n.outside]), [['NEW1', true]])
  assert.equal(s.unread, 1)
  assert.deepEqual([s.feed.changed.since, s.feed.changed.total], ['2026-10-20T10:00:00.000Z', 1])
  // the counts paid nothing; the automatic refresh paid its one item, marked as the watch's
  const log = JSON.parse(fs.readFileSync(usage, 'utf8'))
  assert.deepEqual(log.map(e => [e.route, e.credits, e.by]), [['GET /documents/properties', 0, 'auto'], ['GET /documents/properties', 0, 'auto'], ['GET /documents/properties', 1, 'auto']])
})
