import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { startServer } from '../lib/server.js'
import { casesFolder, ENGINE, FIXTURES, NEW, run } from './helpers.js'

const dist = fs.mkdtempSync(path.join(casesFolder(), 'dist-'))
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>OSINT</title>')

async function serve(home) {
  const server = await startServer({ home, port: 0, dist, engine: ENGINE, loaded: 0 })
  const base = `http://127.0.0.1:${server.address().port}`
  test.after(() => server.close())
  return base
}
// an SSE stream: resolves with the events received once `until` holds (or after 3 s)
function stream(url, until, headers = {}) {
  return new Promise((ok, ko) => {
    const got = [], req = http.get(url, { headers }, res => {
      let buf = ''
      res.on('data', d => {
        buf += d
        for (let i; (i = buf.indexOf('\n\n')) >= 0;) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2)
          const ev = Object.fromEntries(block.split('\n').filter(l => /^(id|event|data):/.test(l)).map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]))
          if (ev.data) got.push({ ...ev, data: JSON.parse(ev.data) })
          if (until(got)) { req.destroy(); ok(got) }
        }
      })
    })
    req.on('error', e => (e.code === 'ECONNRESET' ? ok(got) : ko(e)))
    setTimeout(() => { req.destroy(); ok(got) }, 3000)
  })
}

test('the API lists the cases, serves one case index and one note; only pages of this machine', async () => {
  const home = casesFolder()
  await run(home, NEW)
  const base = await serve(home)
  const cases = await (await fetch(`${base}/api/cases`)).json()
  assert.deepEqual(cases.map(c => c.slug), ['durand-bakery-example'])
  const ix = await (await fetch(`${base}/api/cases/durand-bakery-example`)).json()
  assert.ok(ix.notes.some(n => n.path === 'Case.md'))
  const note = await (await fetch(`${base}/api/cases/durand-bakery-example/note?path=Case.md`)).json()
  assert.equal(note.props.type, 'domain')
  assert.equal((await fetch(`${base}/api/cases/durand-bakery-example/file?path=../../etc/passwd`)).status, 404)
  assert.equal((await fetch(`${base}/api/cases/durand-bakery-example/file?path=.osint/case.json`)).status, 404)
  fs.mkdirSync(path.join(home, 'durand-bakery-example', 'Evidence', 'captures'), { recursive: true })
  fs.writeFileSync(path.join(home, 'durand-bakery-example', 'Evidence', 'captures', 'x.html'), '<script>1</script>')
  const cap = await fetch(`${base}/api/cases/durand-bakery-example/file?path=Evidence/captures/x.html`)
  assert.deepEqual([cap.headers.get('content-security-policy'), cap.headers.get('x-content-type-options')], ['sandbox', 'nosniff'])
  assert.equal((await fetch(`${base}/api/state`)).status, 200)
  assert.ok((await fetch(`${base}/api/types`).then(r => r.json())).some(t => t.id === 'domain'))
  const evil = await new Promise(ok => http.get(`${base}/api/cases`, { headers: { host: 'evil.example' } }, ok))
  assert.equal(evil.statusCode, 403)
  const origin = o => new Promise(ok => http.get(`${base}/api/cases`, { headers: { origin: o } }, r => { r.resume(); ok(r.statusCode) }))
  const port = new URL(base).port
  assert.deepEqual(await Promise.all([`http://127.0.0.1:${port}`, `http://localhost:${port}`, 'http://127.0.0.1:1', 'http://localhost', 'http://evil.example'].map(origin)), [200, 200, 403, 403, 403])
  assert.match(await (await fetch(`${base}/c/durand-bakery-example`)).text(), /<title>OSINT<\/title>/)
})

test('the case stream pushes each event, resumes from Last-Event-ID and starts over on a reset file', async () => {
  const home = casesFolder()
  await run(home, NEW)
  const base = await serve(home), url = `${base}/api/cases/durand-bakery-example/events`
  const first = stream(url, got => got.some(e => e.data.kind === 'log'))
  await new Promise(ok => setTimeout(ok, 200))
  await run(home, ['log', '-p', 'durand-bakery-example', '--phase', 'collect', 'reading RDAP'])
  const got = await first
  assert.ok(got.some(e => e.data.kind === 'case.new'))
  const log = got.find(e => e.data.kind === 'log')
  assert.equal(log.data.by, 'agent')
  const again = await stream(url, g => g.length >= 1, { 'last-event-id': log.id })
  assert.ok(!again.some(e => e.data.kind === 'log' && e.id === log.id))
  fs.writeFileSync(path.join(home, 'durand-bakery-example', '.osint', 'events.jsonl'), JSON.stringify({ t: new Date().toISOString(), kind: 'case.new', by: 'engine' }) + '\n')
  const reset = await stream(url, g => g.some(e => e.data.kind === 'case.new'), { 'last-event-id': '999999' })
  assert.ok(reset.some(e => e.event === 'reset'))
})

test('an edit saved in the vault becomes a note.write by vault; the engine\'s own writes do not', async () => {
  const home = casesFolder()
  await run(home, NEW)
  const base = await serve(home), dir = path.join(home, 'durand-bakery-example')
  const s = stream(`${base}/api/cases/durand-bakery-example/events`, got => got.some(e => e.data.kind === 'note.write' && e.data.by === 'vault'))
  await new Promise(ok => setTimeout(ok, 200))
  await run(home, ['log', '-p', 'durand-bakery-example', '--phase', 'collect', 'x'])
  await new Promise(ok => setTimeout(ok, 400))
  fs.appendFileSync(path.join(dir, 'Report.md'), 'Typed in Obsidian.\n')
  const got = await s
  const writes = got.filter(e => e.data.kind === 'note.write')
  assert.deepEqual(writes.filter(e => e.data.by === 'vault').map(e => e.data.path), ['Report.md'])
  assert.ok(!writes.some(e => e.data.by === 'vault' && e.data.path === 'Case.md'))
})

test('the dashboard creates a case through the engine and moves a deleted one to .trash', async () => {
  const home = casesFolder()
  const base = await serve(home)
  const bad = await fetch(`${base}/api/cases`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'domain', inputs: { domain: 'durand-bakery.example' }, frame: {} }) })
  assert.equal(bad.status, 400)
  assert.match((await bad.json()).error, /--question/)
  const ok = await fetch(`${base}/api/cases`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'domain', inputs: { domain: 'durand-bakery.example', depth: 'quick' }, question: 'Who runs it?', frame: { noisy: 'never' }, lang: 'fr' }) })
  assert.equal(ok.status, 200)
  assert.deepEqual(await ok.json(), { slug: 'durand-bakery-example' })
  const odd = await fetch(`${base}/api/cases`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'domain', inputs: { domain: '--parent=x' }, question: 'Q?', frame: { noisy: 'never' } }) })
  assert.equal(odd.status, 200, 'a value that looks like an option is the input')
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, (await odd.json()).slug, '.osint', 'case.json'), 'utf8')).input.domain, '--parent=x')
  assert.equal((await fetch(`${base}/api/cases/durand-bakery-example`, { method: 'DELETE' })).status, 200)
  assert.ok(!fs.existsSync(path.join(home, 'durand-bakery-example')))
  assert.equal(fs.readdirSync(path.join(home, '.trash')).filter(n => n.startsWith('durand-bakery-example-')).length, 1)
})

test('a case made again after a delete does not receive the old vault\'s « deleted » events', async () => {
  const home = casesFolder()
  await run(home, NEW)
  await serve(home)
  const dir = path.join(home, 'durand-bakery-example')
  fs.rmSync(dir, { recursive: true, force: true })
  await run(home, NEW)
  await new Promise(ok => setTimeout(ok, 600))
  assert.ok(!fs.readFileSync(path.join(dir, '.osint', 'events.jsonl'), 'utf8').includes('"deleted":true'))
})

test('the dashboard\'s Refresh in a noisy=ask case runs the quiet steps and says which noisy ones it left', async () => {
  const home = casesFolder(), prev = process.env.OSINT_TYPES
  process.env.OSINT_TYPES = path.join(FIXTURES, 'types')
  try {
    await run(home, ['new', 'sample', 'thing one', '--question', 'Q?', '--frame', 'noisy=ask'])
    const base = await serve(home)
    const r = await fetch(`${base}/api/cases/thing-one/refresh`, { method: 'POST' })
    assert.equal(r.status, 200)
    assert.deepEqual((await r.json()).skipped, ['loud'])
  } finally { if (prev == null) delete process.env.OSINT_TYPES; else process.env.OSINT_TYPES = prev }
})

test('the dashboard uploads a file, makes a case from it and drops the upload; a path from elsewhere is refused', async () => {
  const home = casesFolder(), base = await serve(home)
  process.env.OSINT_TYPES = path.join(FIXTURES, 'types-files')
  try {
    const bytes = fs.readFileSync(path.join(FIXTURES, 'images', 'evora-temple.jpg'))
    const up = await (await fetch(`${base}/api/uploads?name=${encodeURIComponent('../Évora temple.jpg')}`, { method: 'POST', body: bytes })).json()
    assert.equal(path.basename(up.path), '..-Évora temple.jpg')
    assert.ok(up.path.startsWith(path.join(home, '.cache', 'uploads') + path.sep))
    const body = { type: 'media', inputs: { source: 'photo', photo: up.path }, question: 'Where?', frame: { image_may_leave: 'false', noisy: 'never' } }
    const post = b => fetch(`${base}/api/cases`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
    const ok = await post(body)
    assert.equal(ok.status, 200)
    const { slug } = await ok.json()
    assert.equal(slug, 'evora-temple')
    assert.equal(fs.statSync(path.join(home, slug, 'Evidence', 'E01-..-Évora temple.jpg')).size, bytes.length)
    assert.ok(!fs.existsSync(path.dirname(up.path)))
    const evil = await post({ ...body, inputs: { source: 'photo', photo: path.join(home, slug, 'Case.md') } })
    assert.equal(evil.status, 400)
    assert.match((await evil.json()).error, /a file comes from the dashboard's upload/)
    assert.equal((await fetch(`${base}/api/uploads?name=noext`, { method: 'POST', body: 'x' })).status, 400)
    assert.equal(path.basename((await (await fetch(`${base}/api/uploads?name=CON.png`, { method: 'POST', body: 'x' })).json()).path), '_CON.png')
  } finally { delete process.env.OSINT_TYPES }
})
