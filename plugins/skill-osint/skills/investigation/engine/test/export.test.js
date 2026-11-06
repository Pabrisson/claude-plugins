import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { hasBin, sha256File } from '../lib/util.js'
import { localDate } from '../lib/vault.js'
import { casesFolder, events, FAKE_BROWSER, finishedCase, NEW, read, run, serveHome } from './helpers.js'

const SLUG = 'durand-bakery-example', EXPORT = ['export', '-p', SLUG]

test('export: the print view printed to Exports/<slug>-<date>.pdf, its SHA-256 in the Journal; the PDF stays in git', async () => {
  const { home, dir } = await finishedCase()
  const log = path.join(home, 'browser.json'), env = { OSINT_BROWSER: FAKE_BROWSER, OSINT_FAKE_BROWSER_LOG: log }
  const r = await run(home, [...EXPORT, '--journal', '--json'], env)
  assert.equal(r.status, 0, r.err)
  const out = JSON.parse(r.out), day = localDate(new Date())
  assert.equal(out.file, `Exports/${SLUG}-${day}.pdf`)
  assert.equal(out.browser, `OSINT_BROWSER (${FAKE_BROWSER})`)
  const pdf = path.join(dir, out.file)
  assert.equal(fs.readFileSync(pdf, 'latin1').slice(0, 5), '%PDF-')
  assert.equal(out.sha256, sha256File(pdf))
  const last = read(dir, 'Journal.md').trim().split('\n').at(-1)
  assert.equal(last.replace(/^- \d{2}:\d{2}:\d{2} /, ''), `· export · ${out.file} (${out.browser}, Journal appended) · sha256 ${out.sha256} ^${out.journal}`)
  const b = JSON.parse(fs.readFileSync(log, 'utf8'))
  assert.deepEqual(b.args.slice(0, 3), ['--headless', '--disable-gpu', '--no-pdf-header-footer'])
  assert.match(b.url, new RegExp(`^http://127\\.0\\.0\\.1:\\d+/print/${SLUG}\\?journal=1$`))
  assert.ok(!['41387', '41390', '41391', '41399'].includes(new URL(b.url).port))
  assert.match(b.html, /<section class="appendix">/)
  assert.ok(events(dir).some(e => e.kind === 'export' && e.path === out.file && e.data.sha256 === out.sha256))
  assert.deepEqual(fs.readdirSync(path.join(dir, '.osint', 'cache')).filter(f => f.startsWith('export-')), [])
  if (hasBin('git')) {
    execFileSync('git', ['init', '-q', home])
    assert.equal(spawnSync('git', ['-C', home, 'check-ignore', '--no-index', `${SLUG}/${out.file}`], { windowsHide: true }).status, 1, 'the folder .gitignore must not hide Exports/')
  }
})

test('export never overwrites a PDF: a second one the same day, and two at once, each get their own name', async () => {
  const home = casesFolder()
  await run(home, NEW)
  const env = { OSINT_BROWSER: FAKE_BROWSER }, day = localDate(new Date())
  const first = JSON.parse((await run(home, [...EXPORT, '--json'], env)).out)
  const [a, b] = await Promise.all([run(home, [...EXPORT, '--json'], env), run(home, [...EXPORT, '--json'], env)])
  assert.equal(a.status, 0, a.err)
  assert.equal(b.status, 0, b.err)
  assert.equal(first.file, `Exports/${SLUG}-${day}.pdf`)
  assert.deepEqual([JSON.parse(a.out).file, JSON.parse(b.out).file].sort(), [`Exports/${SLUG}-${day}-2.pdf`, `Exports/${SLUG}-${day}-3.pdf`])
  assert.equal([...read(path.join(home, SLUG), 'Journal.md').matchAll(/· export · /g)].length, 3)
})

test('export without a browser exits 3; a browser that crashes, writes nothing or hangs leaves no PDF and a failure in the Journal', async () => {
  const home = casesFolder()
  await run(home, NEW)
  const dir = path.join(home, SLUG)
  const none = await run(home, EXPORT, { OSINT_BROWSER: path.join(home, 'no-such-browser') })
  assert.equal(none.status, 3)
  assert.match(none.err, /is not a file — the PDF export is off; Print view in the dashboard prints from any browser/)
  const crashed = await run(home, EXPORT, { OSINT_BROWSER: FAKE_BROWSER, OSINT_FAKE_BROWSER: 'fail' })
  assert.equal(crashed.status, 1)
  assert.match(crashed.err, /export: OSINT_BROWSER \(.*\) exited with 1 \(fake browser: crashed\) — Print view/)
  const empty = await run(home, EXPORT, { OSINT_BROWSER: FAKE_BROWSER, OSINT_FAKE_BROWSER: 'empty' })
  assert.equal(empty.status, 1)
  assert.match(empty.err, /wrote no PDF/)
  const t = Date.now(), hung = await run(home, EXPORT, { OSINT_BROWSER: FAKE_BROWSER, OSINT_FAKE_BROWSER: 'hang', OSINT_PDF_TIMEOUT: '1500' })
  assert.equal(hung.status, 1)
  assert.match(hung.err, /did not finish within 2 s/)
  assert.ok(Date.now() - t < 10000)
  assert.ok(!fs.existsSync(path.join(dir, 'Exports')))
  assert.equal([...read(dir, 'Journal.md').matchAll(/· fail · export: /g)].length, 3)
  assert.deepEqual(fs.readdirSync(path.join(dir, '.osint', 'cache')).filter(f => f.startsWith('export-')), [])
})

test('--journal: a switch for export, still the cited entry for clue', async () => {
  const home = casesFolder()
  await run(home, NEW)
  const env = { OSINT_BROWSER: FAKE_BROWSER, OSINT_FAKE_BROWSER_LOG: path.join(home, 'b.json') }
  assert.equal((await run(home, ['export', '--journal', '-p', SLUG], env)).status, 0)
  assert.match(JSON.parse(fs.readFileSync(path.join(home, 'b.json'), 'utf8')).url, /\?journal=1$/)
  assert.equal((await run(home, ['export', '-p', SLUG], env)).status, 0)
  assert.doesNotMatch(JSON.parse(fs.readFileSync(path.join(home, 'b.json'), 'utf8')).url, /journal/)
  const c = await run(home, ['clue', 'Seen in the log', '--status', 'observed', '--journal', 'j001', '--json', '-p', SLUG])
  assert.equal(c.status, 0, c.err)
  assert.match(read(path.join(home, SLUG), JSON.parse(c.out).path), /^journal: "?j001"?$/m)
})

test('the dashboard exports through the engine and downloads the PDF; without a browser it answers code 3', async t => {
  const home = casesFolder()
  await run(home, NEW)
  const { base, close } = await serveHome(home)
  t.after(() => { close(); delete process.env.OSINT_BROWSER })
  process.env.OSINT_BROWSER = FAKE_BROWSER
  const r = await fetch(`${base}/api/cases/${SLUG}/export?journal=1`, { method: 'POST' })
  assert.equal(r.status, 200)
  const { file, sha256 } = await r.json()
  const pdf = await fetch(`${base}/api/cases/${SLUG}/file?path=${encodeURIComponent(file)}`)
  assert.equal(pdf.headers.get('content-type'), 'application/pdf')
  assert.equal(createHash('sha256').update(Buffer.from(await pdf.arrayBuffer())).digest('hex'), sha256)
  assert.ok(events(path.join(home, SLUG)).some(e => e.kind === 'export' && e.by === 'dashboard'))
  process.env.OSINT_BROWSER = path.join(home, 'none')
  const off = await fetch(`${base}/api/cases/${SLUG}/export`, { method: 'POST' })
  assert.equal(off.status, 400)
  const body = await off.json()
  assert.equal(body.code, 3)
  assert.match(body.error, /Print view/)
})

test('export writes only into <slug>/Exports/: a slug that is a path, an unknown case or a stray -p writes nothing', async () => {
  const home = casesFolder()
  await run(home, NEW)
  const env = { OSINT_BROWSER: FAKE_BROWSER }
  for (const p of ['../' + SLUG, `${SLUG}/..`, `${SLUG}/Exports`, '..', '.', 'nope', '']) {
    const r = await run(home, ['export', '-p', p], env)
    assert.equal(r.status, 1, p)
  }
  assert.equal((await run(home, ['export'], env)).status, 1)
  assert.ok(!fs.existsSync(path.join(home, SLUG, 'Exports')) && !fs.existsSync(path.join(home, '..', `${SLUG}-${localDate(new Date())}.pdf`)))
  assert.deepEqual(fs.readdirSync(home).filter(f => f.endsWith('.pdf')), [])
})

test('a person case prints its purpose and legal basis, the export holds what the vault holds', async () => {
  const home = casesFolder()
  const created = await run(home, ['new', 'person', 'Jeanne Durand', '--in', 'identifiers=pseudo: durand.bakery', '--question', 'Is this pseudo Jeanne Durand\'s?',
    '--frame', 'purpose=Check the manager before a supply contract', '--frame', 'legal_basis=Legitimate interest — checking a contracting party', '--frame', 'noisy=never'])
  assert.equal(created.status, 0, created.err)
  const log = path.join(home, 'b.json')
  const r = await run(home, ['export', '-p', 'jeanne-durand', '--journal', '--json'], { OSINT_BROWSER: FAKE_BROWSER, OSINT_FAKE_BROWSER_LOG: log })
  assert.equal(r.status, 0, r.err)
  const { html } = JSON.parse(fs.readFileSync(log, 'utf8'))
  assert.match(html, /<strong>Purpose<\/strong> — Check the manager before a supply contract/)
  assert.match(html, /<strong>Frame<\/strong> — .*Subject is a person: yes · Legal basis: Legitimate interest — checking a contracting party/)
  assert.match(html, /<p class="draft">Draft: this case is not concluded yet\.<\/p>/)
})
