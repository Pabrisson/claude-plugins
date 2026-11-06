import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DENY, isLocalAddress, quota, request, SMTP_PORTS, target } from '../lib/net.js'

const server = (handler) => new Promise(ok => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${s.address().port}`, close: () => s.close() })) })

test('a service base is replaced by OSINT_BASE_<SERVICE>; a web page by OSINT_BASE_WEB', () => {
  process.env.OSINT_BASE_RDAP = 'http://127.0.0.1:1/rdap'
  assert.deepEqual(target('rdap', '/domain/x.example'), { url: 'http://127.0.0.1:1/rdap/domain/x.example', host: 'rdap.org', real: false })
  delete process.env.OSINT_BASE_RDAP
  assert.deepEqual(target('rdap', '/domain/x.example'), { url: 'https://rdap.org/domain/x.example', host: 'rdap.org', real: true })
  process.env.OSINT_BASE_WEB = 'http://127.0.0.1:1/web'
  assert.equal(target('web', 'https://x.example/a?b=1').url, 'http://127.0.0.1:1/web/x.example/a?b=1')
  delete process.env.OSINT_BASE_WEB
})

test('the Google AI hosts are refused, even at the end of a redirect', async () => {
  for (const h of DENY) await assert.rejects(request('web', `https://${h}/v1/x`), /never calls/)
  const s = await server((req, res) => { res.writeHead(302, { location: 'https://vision.googleapis.com/v1/images:annotate' }); res.end() })
  process.env.OSINT_BASE_WEB = s.url
  try { await assert.rejects(request('web', 'https://x.example/'), /never calls vision\.googleapis\.com/) } finally { delete process.env.OSINT_BASE_WEB; s.close() }
})

test('a 502 is tried again, a body is capped, the host meant is sent to the fake', async () => {
  let n = 0
  const s = await server((req, res) => {
    if (req.url.endsWith('/flaky') && n++ === 0) { res.writeHead(502); return res.end() }
    res.writeHead(200, { 'content-type': 'text/plain', 'x-host-seen': req.headers['x-osint-host'] ?? '' })
    res.end(req.url.endsWith('/big') ? 'x'.repeat(5000) : 'ok')
  })
  process.env.OSINT_BASE_WEB = s.url
  try {
    const a = await request('web', 'https://x.example/flaky', { retries: 2 })
    assert.deepEqual([a.status, a.body.toString(), a.headers['x-host-seen']], [200, 'ok', 'x.example'])
    const b = await request('web', 'https://x.example/big', { max: 1000 })
    assert.deepEqual([b.body.length <= 1000 + 65536, b.truncated], [true, true])
  } finally { delete process.env.OSINT_BASE_WEB; s.close() }
})

test('a web page on this machine or its network is refused, unless the web is the fake server', async () => {
  for (const h of ['localhost', 'app.localhost', '127.0.0.1', '10.0.0.5', '172.20.1.1', '192.168.1.10', '169.254.169.254', '[::1]', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1', 'printer.local', 'intranet']) assert.equal(isLocalAddress(h), true, h)
  for (const h of ['example.org', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.equal(isLocalAddress(h), false, h)
  await assert.rejects(request('web', 'http://127.0.0.1:1/'), /on this machine or its network/)
  await assert.rejects(request('web', 'http://localhost/'), /on this machine or its network/)
})

test('Nominatim is asked once a second at most (its usage policy); the DNS-over-HTTPS resolver without a wait', async () => {
  const s = await server((req, res) => res.end('{}'))
  process.env.OSINT_BASE_NOMINATIM = s.url; process.env.OSINT_BASE_DOH = s.url
  try {
    const t0 = Date.now()
    await request('nominatim', '/status'); await request('nominatim', '/status')
    assert.ok(Date.now() - t0 >= 1100)
    const t1 = Date.now()
    await request('doh', '/dns-query?name=a'); await request('doh', '/dns-query?name=b')
    assert.ok(Date.now() - t1 < 500)
    assert.deepEqual(['mapillary', 'hf', 'openmeteo'].map(x => target(x, '/x').host), ['graph.mapillary.com', 'huggingface.co', 'archive-api.open-meteo.com'])
  } finally { delete process.env.OSINT_BASE_NOMINATIM; delete process.env.OSINT_BASE_DOH; s.close() }
})

test('follow: false gives back the redirect itself, its Location kept; by default it is followed', async () => {
  const s = await server((req, res) => {
    if (req.url.endsWith('/old')) { res.writeHead(302, { location: '/x.example/new' }); return res.end('302 Found') }
    res.end('new page')
  })
  process.env.OSINT_BASE_WEB = s.url
  try {
    const a = await request('web', 'https://x.example/old', { follow: false })
    assert.deepEqual([a.status, a.headers.location, a.body.toString()], [302, '/x.example/new', '302 Found'])
    const b = await request('web', 'https://x.example/old')
    assert.deepEqual([b.status, b.body.toString()], [200, 'new page'])
  } finally { delete process.env.OSINT_BASE_WEB; s.close() }
})

test('no request ever reaches a mail server port, not even at the end of a redirect', async () => {
  for (const p of SMTP_PORTS) await assert.rejects(request('web', `http://mx.example.org:${p}/`), /never talks to a mail server/)
  const s = await server((req, res) => { res.writeHead(302, { location: 'http://mx.example.org:25/' }); res.end() })
  process.env.OSINT_BASE_WEB = s.url
  try { await assert.rejects(request('web', 'https://x.example/'), /never talks to a mail server \(port 25\)/) } finally { delete process.env.OSINT_BASE_WEB; s.close() }
})

test('quota: a free API\'s limits over a sliding hour and day, for the whole cases folder', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-quota-')), t0 = Date.parse('2026-11-03T10:00:00Z')
  for (let i = 0; i < 25; i++) assert.equal(quota(home, 'xon', t0 + i * 1000).ok, true, `call ${i}`)
  assert.deepEqual(quota(home, 'xon', t0 + 30e3), { ok: false, limit: '25 calls an hour', next: '2026-11-03T11:00:00.000Z' })
  assert.equal(quota(home, 'xon', t0 + 3600e3 + 1).ok, true)
  assert.ok(fs.existsSync(path.join(home, '.cache', 'quota-xon.json')))
  const day = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-quota-'))
  for (let i = 0; i < 100; i++) assert.equal(quota(day, 'xon', t0 + Math.floor(i / 20) * 3600e3 + (i % 20) * 1000).ok, true, `call ${i}`)
  assert.deepEqual(quota(day, 'xon', t0 + 6 * 3600e3), { ok: false, limit: '100 calls a day', next: '2026-11-04T10:00:00.000Z' })
  assert.deepEqual(quota(day, 'xon', t0 + 86400e3 + 1).left, { hour: 24, day: 0 })
  assert.throws(() => quota(home, 'nope'), /no quota for nope/)
})
