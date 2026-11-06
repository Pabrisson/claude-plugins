import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { startServer } from '../lib/server.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, ENGINE, events, FIXTURES, json, nodeOnlyPath, PATHX, read, run } from './helpers.js'

const MEDIA = { OSINT_TYPES: path.join(FIXTURES, 'types-files') }
const NEWM = leave => ['new', 'media', '--question', 'Where is it?', '--frame', `image_may_leave=${leave}`, '--frame', 'noisy=never']
const TEMPLE = path.join(FIXTURES, 'images', 'evora-temple.jpg'), P = ['-p', 'evora-temple'], skip = process.platform === 'win32'
const HOST = 'osint-fake-tunnel.trycloudflare.com'
const port = () => String(43000 + Math.floor(Math.random() * 2000))
async function temple(env, leave = true) { const home = casesFolder(); await run(home, [...NEWM(leave), '--file', TEMPLE], env); return { home, dir: path.join(home, 'evora-temple') } }

test('reverse refuses what may not leave: the frame first, then a file with people, --unmasked outside verify-media; without cloudflared, exit code 3', { skip }, async () => {
  const closed = await temple(MEDIA, false)
  const f = await run(closed.home, ['reverse', '--files', 'E01', '--no-people', ...P], { ...MEDIA, ...PATHX })
  assert.equal(f.status, 1)
  assert.match(f.err, /the frame keeps the image on this machine/)
  const { home } = await temple(MEDIA)
  const people = await run(home, ['reverse', '--files', 'E01', ...P], { ...MEDIA, ...PATHX })
  assert.equal(people.status, 1)
  assert.match(people.err, /people may show/)
  const unmasked = await run(home, ['reverse', '--files', 'E01', '--unmasked', ...P], { ...MEDIA, ...PATHX })
  assert.match(unmasked.err, /verify-media cases only/)
  const nocf = await run(home, ['reverse', '--files', 'E01', '--no-people', ...P], { ...MEDIA, ...nodeOnlyPath() })
  assert.equal(nocf.status, 3)
  assert.match(nocf.err, /needs cloudflared/)
})

test('reverse opens the tunnel through the dashboard server: a random path, the chosen file only, the engines\' links; --close closes it and the Journal says who fetched what', { skip }, async () => {
  const fake = await startFake(), env = { ...MEDIA, ...PATHX, ...fakeEnv(fake.url), OSINT_PORT: port() }
  const { home, dir } = await temple(env)
  try {
    const r = await run(home, ['reverse', '--files', 'E01', '--no-people', ...P, '--json'], env)
    assert.equal(r.status, 0, r.err)
    const o = JSON.parse(r.out), url = o.files[0].url, token = new URL(url).pathname.split('/')[1]
    assert.match(url, new RegExp(`^https://${HOST.replace(/\./g, '\\.')}/[0-9a-f]{32}/1\\.jpg$`))
    assert.deepEqual(o.files[0].links.map(l => l.engine), ['lens', 'yandex', 'bing', 'tineye', 'baidu'])
    const got = await fetch(`${fake.url}/web/${HOST}/${token}/1.jpg`, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; Googlebot-Image/1.0)' } })
    assert.equal(Buffer.from(await got.arrayBuffer()).length, fs.statSync(TEMPLE).size)
    assert.equal((await fetch(`${fake.url}/web/${HOST}/${token}/2.jpg`)).status, 404)
    assert.equal((await fetch(`${fake.url}/web/${HOST}/${'0'.repeat(32)}/1.jpg`)).status, 404)
    assert.match(read(dir, 'Journal.md'), /· tunnel · tunnel opened until \d\d:\d\d UTC \(15 min\) for Evidence\/E01-evora-temple\.jpg/)
    assert.ok(events(dir).some(e => e.kind === 'tunnel.open'))
    const c = await run(home, ['reverse', '--close', ...P], env)
    assert.equal(c.status, 0, c.err)
    assert.match(c.out, /tunnel closed/)
    assert.match(read(dir, 'Journal.md'), /tunnel closed \(closed by the user\); served: E01-evora-temple\.jpg → lens ×1/)
    assert.equal(json(dir, '.osint/case.json').reverse.tunnels[0].served[0].engine, 'lens')
    assert.equal((await fetch(`${fake.url}/web/${HOST}/${token}/1.jpg`)).status, 502)
  } finally {
    await fetch(`http://127.0.0.1:${env.OSINT_PORT}/__osint/quit`, { method: 'POST' }).catch(() => {})
    fake.close()
  }
})

test('a tunnel never outlives its case nor its server', { skip }, async () => {
  const fake = await startFake(), old = { ...process.env }
  Object.assign(process.env, MEDIA, PATHX, fakeEnv(fake.url))
  try {
    const { home } = await temple(MEDIA)
    await run(home, ['reverse', '--files', 'E01', '--no-people', ...P], { ...MEDIA, ...nodeOnlyPath() })
    const dist = fs.mkdtempSync(path.join(home, 'dist-')); fs.writeFileSync(path.join(dist, 'index.html'), '<title>OSINT</title>')
    const server = await startServer({ home, port: 0, dist, engine: ENGINE, loaded: 0 }), base = `http://127.0.0.1:${server.address().port}`
    const post = () => fetch(`${base}/api/cases/evora-temple/tunnel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: ['E01'] }) })
    const o = await (await post()).json(), token = new URL(o.files[0].url).pathname.split('/')[1]
    assert.equal((await (await fetch(`${base}/api/cases/evora-temple/tunnel`)).json()).open, true)
    assert.equal((await fetch(`${base}/api/cases/evora-temple`, { method: 'DELETE' })).status, 200)
    assert.equal((await fetch(`${fake.url}/web/${HOST}/${token}/1.jpg`)).status, 502)
    const { home: h2 } = await temple(MEDIA)
    await run(h2, ['reverse', '--files', 'E01', '--no-people', ...P], { ...MEDIA, ...nodeOnlyPath() })
    const s2 = await startServer({ home: h2, port: 0, dist, engine: ENGINE, loaded: 0 })
    const o2 = await (await fetch(`http://127.0.0.1:${s2.address().port}/api/cases/evora-temple/tunnel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: ['E01'] }) })).json()
    await new Promise(ok => s2.close(ok))
    assert.equal((await fetch(`${fake.url}/web/${HOST}/${new URL(o2.files[0].url).pathname.split('/')[1]}/1.jpg`)).status, 502)
    assert.match(read(path.join(h2, 'evora-temple'), 'Journal.md'), /tunnel closed \(server stopped\)/)
    server.close()
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in old)) delete process.env[k]
    Object.assign(process.env, old)
    fake.close()
  }
})

test('a capture pasted in the dashboard goes to Evidence/captures under a fresh name; anything but an image is refused', async () => {
  const { home } = await temple(MEDIA)
  const dist = fs.mkdtempSync(path.join(home, 'dist-')); fs.writeFileSync(path.join(dist, 'index.html'), '<title>OSINT</title>')
  const server = await startServer({ home, port: 0, dist, engine: ENGINE, loaded: 0 }), base = `http://127.0.0.1:${server.address().port}`
  try {
    const png = fs.readFileSync(TEMPLE), send = name => fetch(`${base}/api/cases/evora-temple/capture?name=${encodeURIComponent(name)}`, { method: 'POST', body: png })
    assert.deepEqual(await (await send('lens-crop-03.png')).json(), { path: 'Evidence/captures/lens-crop-03-1.png' })
    assert.deepEqual(await (await send('lens-crop-03.png')).json(), { path: 'Evidence/captures/lens-crop-03-2.png' })
    assert.equal((await send('../x.sh')).status, 400)
    assert.match(read(path.join(home, 'evora-temple'), 'Journal.md'), /· capture · pasted from the dashboard: Evidence\/captures\/lens-crop-03-1\.png · sha256 [0-9a-f]{12}/)
  } finally { server.close() }
})

test('doctor --network opens a test tunnel, reads its file back from outside and closes it', { skip }, async () => {
  const fake = await startFake()
  try {
    const d = JSON.parse((await run(casesFolder(), ['doctor', '--network', '--json'], { ...PATHX, ...fakeEnv(fake.url) })).out)
    assert.match(d.lines.find(l => l.name === 'tunnel').text, /a file served and read back from outside/)
  } finally { fake.close() }
})

test('the tunnel serves a copy without EXIF and GPS, never the file as it is; the Journal says so', { skip }, async () => {
  const fake = await startFake(), env = { ...MEDIA, ...PATHX, ...fakeEnv(fake.url), OSINT_PORT: port() }
  const home = casesFolder(), jpg = fs.readFileSync(TEMPLE), app1 = Buffer.concat([Buffer.from('Exif\0\0MM\0*\0\0\0\x08\0\0\0\0\0\0GPS 38.5727917 -7.9076417'), Buffer.alloc(0)])
  const src = path.join(home, 'gps.jpg')
  fs.writeFileSync(src, Buffer.concat([jpg.subarray(0, 2), Buffer.from([0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255]), app1, jpg.subarray(2)]))
  try {
    assert.equal((await run(home, [...NEWM(true), '--file', src], env)).status, 0)
    const r = await run(home, ['reverse', '--files', 'E01', '--no-people', '-p', 'gps', '--json'], env)
    assert.equal(r.status, 0, r.err)
    const token = new URL(JSON.parse(r.out).files[0].url).pathname.split('/')[1]
    const body = Buffer.from(await (await fetch(`${fake.url}/web/${HOST}/${token}/1.jpg`)).arrayBuffer())
    assert.ok(body.length > 1000 && !body.includes('GPS 38.57') && !body.includes('Exif'))
    assert.match(read(path.join(home, 'gps'), 'Journal.md'), /· send · Evidence\/E01-gps\.jpg sent as a copy without its metadata/)
    assert.ok(fs.readFileSync(path.join(home, 'gps', 'Evidence', 'E01-gps.jpg')).includes('GPS 38.57'), 'the original keeps its metadata')
  } finally {
    await fetch(`http://127.0.0.1:${env.OSINT_PORT}/__osint/quit`, { method: 'POST' }).catch(() => {})
    fake.close()
  }
})
