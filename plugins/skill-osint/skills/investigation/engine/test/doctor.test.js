import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { dataset } from '../lib/datasets.js'
import { installPlan } from '../lib/doctor.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, FAKE_BROWSER, FIXTURES, NEW, NEW_EMAIL, run } from './helpers.js'

const TYPES = { OSINT_TYPES: path.join(FIXTURES, 'types') }

test('doctor: one line per need, what stops working without it, Gemini and Vision off even with a key around', async () => {
  const home = casesFolder()
  const r = await run(home, ['doctor', '--json'], { ...TYPES, GEMINI_API_KEY: 'x', GOOGLE_API_KEY: 'y' })
  const d = JSON.parse(r.out), line = name => d.lines.find(l => l.name === name)
  assert.equal(line('node').status, 'ok')
  assert.ok(line('dashboard'))
  assert.deepEqual([line('gemini').status, line('gemini').text], ['info', 'off (the agent checks matches)'])
  assert.deepEqual([line('google vision').status, line('google vision').text], ['info', 'off (the agent recognises landmarks)'])
  assert.match(line('osint-no-such-tool').text, /nothing of this type runs/)
  assert.equal(line('osint-no-such-tool').status, 'missing')
  assert.match(line('OSINT_TEST_TOKEN').text, /not set — the token's source is skipped; set OSINT_TEST_TOKEN/)
  assert.deepEqual(d.types.map(t => [t.id, t.ready]), [['broken', false], ['needs', false], ['sample', true]])
  assert.ok(d.lines.some(l => l.status === 'warning' && /type broken: .*unknown widget pie/.test(l.text)))
  const text = await run(home, ['doctor'], TYPES)
  assert.match(text.out, /^missing osint-no-such-tool: no install hint — nothing of this type runs$/m)
  assert.match(text.out, /^gemini: off \(the agent checks matches\)$/m)
})

test('doctor warns of evidence changed since it was added, and of a .gitignore that hides the cases', async () => {
  const home = casesFolder()
  await run(home, NEW)
  const photo = path.join(home, 'p.jpg'); fs.writeFileSync(photo, 'one')
  await run(home, ['evidence', photo, '-p', 'durand-bakery-example'])
  const f = path.join(home, 'durand-bakery-example', 'Evidence', 'E01-p.jpg')
  fs.chmodSync(f, 0o644); fs.writeFileSync(f, 'two')
  execFileSync('git', ['init', '-q', home])
  fs.writeFileSync(path.join(home, '.gitignore'), '*\n')
  const d = JSON.parse((await run(home, ['doctor', '--json'])).out)
  assert.ok(d.lines.some(l => l.status === 'warning' && /E01 .*changed since it was added/.test(l.text)))
  assert.ok(d.lines.some(l => l.status === 'warning' && /git ignores/.test(l.text)))
  assert.ok(d.lines.some(l => l.status === 'warning' && /git ignores .*c\/Exports\/c-2026-11-03\.pdf/.test(l.text)), 'an exported PDF is a deliverable git keeps')
})

test('installPlan: a plain package manager command runs after a yes; a URL, sudo or a pipe is the user\'s to run', () => {
  assert.deepEqual(installPlan('cloudflared', { has: () => true, cmd: 'brew install cloudflared' }), { action: 'have', cmd: 'brew install cloudflared' })
  assert.deepEqual(installPlan('cloudflared', { has: () => false, cmd: 'brew install cloudflared' }), { action: 'run', cmd: 'brew install cloudflared', bin: 'brew', args: ['install', 'cloudflared'] })
  assert.deepEqual(installPlan('ffmpeg', { has: () => false, cmd: 'winget install Gyan.FFmpeg' }).args, ['install', 'Gyan.FFmpeg'])
  for (const cmd of ['sudo apt install ffmpeg', 'curl -LsSf https://astral.sh/uv/install.sh | sh', 'https://github.com/cloudflare/cloudflared/releases/latest']) assert.equal(installPlan('x', { has: () => false, cmd }).action, 'manual', cmd)
  assert.equal(installPlan('nope', { has: () => false, cmd: undefined }).action, 'unknown')
})

test('setup refuses an unknown tool', async () => {
  const home = casesFolder()
  const u = await run(home, ['setup', 'teleporter'])
  assert.equal(u.status, 1)
  assert.match(u.err, /unknown tool teleporter/)
})

test('doctor: a missing optional need gives its short note in the types line; the type stays ready', async () => {
  const d = JSON.parse((await run(casesFolder(), ['doctor', '--json'], TYPES)).out)
  const s = d.types.find(t => t.id === 'sample')
  assert.deepEqual([s.ready, s.notes], [true, ['no extra']])
  assert.match(d.lines.find(l => l.name === 'types').text, /sample ready \(no extra\)/)
  assert.match(d.lines.find(l => l.name === 'osint-no-such-extra').text, /the extra step is skipped/)
})

test('doctor: a line per dataset a type declares, not downloaded yet then its date and size; a cached one nobody declares too', async () => {
  const home = casesFolder(), line = (d, name) => d.lines.find(l => l.name === name)
  let d = JSON.parse((await run(home, ['doctor', '--json'], TYPES)).out)
  assert.deepEqual([line(d, 'sample').status, line(d, 'sample').text], ['info', 'sample data: not downloaded yet — the first sample case fetches it'])
  const fake = await startFake()
  process.env.OSINT_BASE_RAW = `${fake.url}/raw`
  try {
    await dataset(home, 'sample', { service: 'raw', path: '/x/sample.txt', hours: 1, describe: t => `${t.trim().split('\n').length} lines` })
    await dataset(home, 'loose', { service: 'raw', path: '/x/sample.txt', hours: 1 })
  } finally { delete process.env.OSINT_BASE_RAW; fake.close() }
  d = JSON.parse((await run(home, ['doctor', '--json'], TYPES)).out)
  assert.equal(line(d, 'sample').status, 'ok')
  assert.match(line(d, 'sample').text, /^sample data: 2 lines, \d{4}-\d{2}-\d{2} \(1 KB\)$/)
  assert.match(line(d, 'loose').text, /^loose: \d{4}-\d{2}-\d{2} \(1 KB\)$/)
  assert.match((await run(home, ['doctor'], TYPES)).out, /^ok {6}sample data: 2 lines, \d{4}-\d{2}-\d{2} \(1 KB\)$/m)
})

test('doctor: Holehe said unmaintained and run by uv on a yes only; the disposable domains list, its size and date; gravatar and xon probed, xon within its quota', async () => {
  const home = casesFolder(), fake = await startFake(), env = fakeEnv(fake.url)
  try {
    const d = JSON.parse((await run(home, ['doctor', '--json'], env)).out), line = (r, n) => r.lines.find(l => l.name === n)
    assert.equal(line(d, 'holehe').text, 'email account-probe runs holehe@latest by uv on the user\'s yes only (GPLv3, unmaintained since 2024, never bundled): its hits are inferred clues')
    assert.deepEqual([line(d, 'disposable-domains').status, line(d, 'disposable-domains').text], ['info', 'disposable email domains: not downloaded yet — the first email case fetches it'])
    assert.equal(d.types.find(t => t.id === 'email').ready, true)
    await run(home, NEW_EMAIL('jo@example.org'), env)
    await run(home, ['email', 'collect', '--only', 'disposable', '-p', 'jo-example-org'], env)
    const kept = line(JSON.parse((await run(home, ['doctor', '--json'], env)).out), 'disposable-domains')
    assert.equal(kept.status, 'ok')
    assert.match(kept.text, /^disposable email domains: 6 domains, \d{4}-\d\d-\d\d \(1 KB\)$/)
    const n = JSON.parse((await run(home, ['doctor', '--network', '--json'], env)).out)
    assert.deepEqual(['gravatar', 'xon'].map(s => line(n, s).status), ['ok', 'ok'])
    fs.writeFileSync(path.join(home, '.cache', 'quota-xon.json'), JSON.stringify({ calls: Array.from({ length: 25 }, () => Date.now()) }))
    const q = JSON.parse((await run(home, ['doctor', '--network', '--json'], env)).out)
    assert.match(line(q, 'xon').text, /^xon: not probed, its quota is used \(25 calls an hour, the next call after \d{4}-/)
  } finally { fake.close() }
})

test('doctor names the browser the PDF export prints with, or says the export is off and Print view still works', async () => {
  const home = casesFolder()
  const line = async env => JSON.parse((await run(home, ['doctor', '--json'], env)).out).lines.find(l => l.name === 'pdf export')
  assert.deepEqual(await line({ OSINT_BROWSER: FAKE_BROWSER }), { status: 'info', name: 'pdf export', text: `OSINT_BROWSER (${FAKE_BROWSER})` })
  const off = await line({ OSINT_BROWSER: path.join(home, 'no-browser') })
  assert.equal(off.status, 'missing')
  assert.match(off.text, /is not a file — the PDF export is off; Print view in the dashboard prints from any browser$/)
  assert.equal(off.fix, undefined)
  assert.match((await run(home, ['doctor'], { OSINT_BROWSER: FAKE_BROWSER })).out, /^pdf export: OSINT_BROWSER \(.+fake-browser\.mjs\)$/m)
  assert.match((await run(home, ['doctor'], { OSINT_BROWSER: path.join(home, 'no-browser') })).out, /^missing pdf export: OSINT_BROWSER=.+ is not a file/m)
})
