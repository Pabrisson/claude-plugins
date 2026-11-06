import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { readNote } from '../lib/vault.js'
import { casesFolder, events, json, NEW, read, run } from './helpers.js'

test('new writes a vault: Case.md with the frame, the Journal, .obsidian, case.json, the folder .gitignore', async () => {
  const home = casesFolder()
  const r = await run(home, NEW)
  assert.equal(r.status, 0, r.err)
  const dir = path.join(home, 'durand-bakery-example')
  const c = readNote(path.join(dir, 'Case.md')).props
  assert.deepEqual([c.type, c.status, c.question, c.noisy, c.input, c.person, c.lang], ['domain', 'draft', 'Who runs this bakery site?', 'never', 'durand-bakery.example', false, 'en'])
  for (const f of ['Journal.md', 'Report.md', 'Leads.md', 'Graph.canvas', '.obsidian/app.json', 'Entities', 'Clues', 'Hypotheses', 'Sources', 'Evidence']) assert.ok(fs.existsSync(path.join(dir, f)), f)
  assert.match(read(dir, 'Journal.md'), /· case · created \(domain: durand-bakery\.example\) — Who runs this bakery site\? \^j001\n$/)
  assert.deepEqual(json(dir, '.osint/case.json').input, { domain: 'durand-bakery.example', depth: 'standard' })
  assert.equal(events(dir)[0].kind, 'case.new')
  assert.match(read(home, '.gitignore'), /# skill-osint:[\s\S]*\n\.trash\/\n[\s\S]*\n\*\/\.osint\/cache\/\n/)
  assert.equal((await run(home, NEW)).status, 0)
  assert.ok(fs.existsSync(path.join(home, 'durand-bakery-example-2')))
})

test('new refuses an incomplete frame and the inputs its type does not take', async () => {
  const home = casesFolder()
  const cases = [
    [['new', 'domain', 'x.example', '--frame', 'noisy=never'], /--question/],
    [['new', 'domain', 'x.example', '--question', 'Q'], /noisy=ask\|never/],
    [[...NEW, '--frame', 'person=true'], /legal_basis/],
    [[...NEW, '--in', 'depth=quick', '--in', 'subdomains=true'], /only goes with depth=standard/],
    [['new', 'bogus', 'x', '--question', 'Q'], /unknown case type bogus/],
  ]
  for (const [argv, err] of cases) {
    const r = await run(home, argv)
    assert.equal(r.status, 1, argv.join(' '))
    assert.match(r.err, err)
  }
})

test('parallel commands on one case keep their ids unique and case.json whole', async () => {
  const home = casesFolder()
  await run(home, NEW)
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => run(home, ['log', '-p', 'durand-bakery-example', '--phase', 'collect', `step ${i}`])))
  for (const r of rs) assert.equal(r.status, 0, r.err)
  const dir = path.join(home, 'durand-bakery-example')
  const ids = [...read(dir, 'Journal.md').matchAll(/\^(j\d+)$/gm)].map(m => m[1])
  assert.equal(ids.length, 9)
  assert.equal(new Set(ids).size, 9)
  assert.equal(json(dir, '.osint/case.json').counters.j, 9)
})

test('log moves the phase (status running), journals a step or a failure, refuses an unknown phase', async () => {
  const home = casesFolder()
  await run(home, NEW)
  const p = ['-p', 'durand-bakery-example']
  assert.equal((await run(home, ['log', ...p, '--phase', 'collect', 'reading RDAP'])).status, 0)
  assert.equal((await run(home, ['log', ...p, '--phase', 'collect', '--progress', '2/6', 'DNS'])).status, 0)
  assert.equal((await run(home, ['log', ...p, '--phase', 'process', '--fail', 'crt.sh answered 502'])).status, 0)
  const bad = await run(home, ['log', ...p, '--phase', 'dream', 'x'])
  assert.equal(bad.status, 1)
  assert.match(bad.err, /frame, collect, process/)
  const dir = path.join(home, 'durand-bakery-example'), ev = events(dir)
  assert.deepEqual(ev.filter(e => e.kind.startsWith('phase')).map(e => `${e.kind} ${e.phase}`), ['phase.start collect', 'phase.end collect', 'phase.start process'])
  assert.deepEqual(ev.find(e => e.kind === 'progress'), { ...ev.find(e => e.kind === 'progress'), n: 2, of: 6, by: 'agent' })
  const c = readNote(path.join(dir, 'Case.md')).props
  assert.deepEqual([c.status, c.phase], ['running', 'process'])
  assert.match(read(dir, 'Journal.md'), /· step · reading RDAP \^j002[\s\S]*· fail · crt\.sh answered 502 \^j003/)
})

test('a child case inherits the frame and both cases link each other', async () => {
  const home = casesFolder()
  await run(home, [...NEW, '--frame', 'purpose=Check the seller'])
  const r = await run(home, ['new', 'domain', 'cdn.durand-bakery.example', '--question', 'Who hosts the CDN?', '--parent', 'durand-bakery-example', '--from', 'Entities/cdn.durand-bakery.example.md'])
  assert.equal(r.status, 0, r.err)
  const parent = readNote(path.join(home, 'durand-bakery-example', 'Case.md')), child = readNote(path.join(home, 'cdn-durand-bakery-example', 'Case.md'))
  assert.deepEqual([child.props.noisy, child.props.purpose], ['never', 'Check the seller'])
  assert.equal(child.props.parent, 'durand-bakery-example')
  assert.deepEqual(parent.props.children, ['cdn-durand-bakery-example'])
  assert.match(child.body, /Started from \[\[cdn\.durand-bakery\.example\]\] in \[durand-bakery-example\]\(obsidian:\/\/open\?vault=durand-bakery-example&file=Case\)/)
  assert.match(parent.body, /\[cdn-durand-bakery-example\]\(obsidian:\/\/open\?vault=cdn-durand-bakery-example&file=Case\)/)
})

test('status --set blocked needs --why; list --json lists the cases', async () => {
  const home = casesFolder()
  await run(home, NEW)
  assert.match((await run(home, ['status', '-p', 'durand-bakery-example', '--set', 'blocked'])).err, /--why/)
  assert.equal((await run(home, ['status', '-p', 'durand-bakery-example', '--set', 'blocked', '--why', 'waiting for the pasted Lens results'])).status, 0)
  const l = JSON.parse((await run(home, ['list', '--json'])).out)
  assert.deepEqual(l.map(c => [c.slug, c.status]), [['durand-bakery-example', 'blocked']])
})
