import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { indexCase, summaries } from '../lib/brain.js'
import { casesFolder, events, FIXTURES, json, read, run } from './helpers.js'

const TYPES = path.join(FIXTURES, 'watch-types')
const T0 = '2026-11-03T06:00:00.000Z'
export const at = h => new Date(Date.parse(T0) + h * 3600e3).toISOString()
// the engine as the agent runs it, the watch's clock set h hours after T0
const env = (h, extra = {}) => ({ OSINT_TYPES: TYPES, OSINT_NOW: at(h), ...extra })
const NEW = (thing, lang = 'en') => ['new', 'watched', thing, '--question', 'Q?', '--frame', 'noisy=ask', '--lang', lang]

test('watch --every keeps the period, the last and the next pass in case.json; off forgets it; other periods are refused', async () => {
  const home = casesFolder(), dir = path.join(home, 'thing-one')
  assert.equal((await run(home, NEW('thing one'), env(0))).status, 0)
  const bad = await run(home, ['watch', '-p', 'thing-one', '--every', '5m'], env(0))
  assert.equal(bad.status, 1)
  assert.match(bad.err, /--every 6h\|12h\|24h\|7d\|off/)
  const r = await run(home, ['watch', '-p', 'thing-one', '--every', '24h', '--json'], env(0))
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(json(dir, '.osint/case.json').watch, { every: '24h', last: null, next: at(24), error: null })
  assert.deepEqual(JSON.parse(r.out).steps, ['quiet'])
  assert.equal(JSON.parse(r.out).server, null, 'OSINT_SERVE=0: the tests never start a server')
  assert.match(read(dir, 'Journal.md'), /· watch · every 24h: quiet — next pass .+ \^j\d{3}/)
  assert.ok(events(dir).some(e => e.kind === 'log' && e.text === 'watch every 24h' && e.by === 'agent'))
  // the same period again writes nothing
  const before = read(dir, 'Journal.md')
  await run(home, ['watch', '-p', 'thing-one', '--every', '24h'], env(1))
  assert.equal(read(dir, 'Journal.md'), before)
  // another period counts from the last pass (none yet: from now)
  await run(home, ['watch', '-p', 'thing-one', '--every', '6h'], env(2))
  assert.equal(json(dir, '.osint/case.json').watch.next, at(8))
  assert.match((await run(home, ['watch', '-p', 'thing-one'], env(2))).out, /^thing-one: every 6h · last none yet · next /)
  const all = JSON.parse((await run(home, ['watch', '--json'], env(2))).out)
  assert.deepEqual([all.on, all.notify, all.cases.map(c => [c.slug, c.every])], [true, true, [['thing-one', '6h']]])
  assert.equal(summaries(home)[0].watch.every, '6h')
  process.env.OSINT_TYPES = TYPES // the in-process read of the type's analysis
  try { assert.equal(indexCase(home, 'thing-one').watch.next, at(8)) } finally { delete process.env.OSINT_TYPES }
  await run(home, ['watch', '-p', 'thing-one', '--every', 'off'], env(3))
  assert.equal(json(dir, '.osint/case.json').watch, null)
  assert.match(read(dir, 'Journal.md'), /· watch · off \^j\d{3}/)
  assert.equal(summaries(home)[0].watch, null)
})

test('a type whose refresh has nothing the watch may run cannot be watched', async () => {
  const home = casesFolder(), types = { OSINT_TYPES: path.join(FIXTURES, 'types') }
  await run(home, ['new', 'needs', 'thing', '--question', 'Q?', '--frame', 'noisy=never'], types)
  const r = await run(home, ['watch', '-p', 'thing', '--every', '24h'], types)
  assert.equal(r.status, 1)
  assert.match(r.err, /a needs case has nothing the watch may run/)
})

test('the folder\'s switch and notifications: --pause keeps each period, --resume, --notify on|off', async () => {
  const home = casesFolder()
  await run(home, NEW('thing one'), env(0))
  await run(home, ['watch', '-p', 'thing-one', '--every', '24h'], env(0))
  const r = await run(home, ['watch', '--pause'], env(0))
  assert.match(r.out, /^watch: paused \(each case keeps its period\) · notifications on/)
  assert.deepEqual(json(home, '.osint-settings.json'), { watch: { on: false, notify: true } })
  assert.match((await run(home, ['watch'], env(0))).out, /^watch: paused · notifications on\nthing-one {2}every 24h/)
  await run(home, ['watch', '--resume', '--notify', 'off'], env(0))
  assert.deepEqual(json(home, '.osint-settings.json').watch, { on: true, notify: false })
  assert.equal(json(path.join(home, 'thing-one'), '.osint/case.json').watch.every, '24h')
  assert.equal((await run(home, ['watch', '--notify', 'maybe'], env(0))).status, 1)
  assert.equal((await run(home, ['watch', '--pause', '--resume'], env(0))).status, 1)
})

const ITEMS = quiet => ({ OSINT_WATCH_ITEMS: JSON.stringify({ quiet, manual: [{ key: 'm' }], unmarked: [{ key: 'u' }], loud: [{ key: 'l' }], image: [{ key: 'i' }], cost: [{ key: 'c' }], sneaky: [{ key: 's' }] }) })

test('a pass runs only what the watch may run, writes What changed by watch, and sets the next pass', async () => {
  const home = casesFolder(), dir = path.join(home, 'thing-one')
  await run(home, NEW('thing one', 'fr'), env(0))
  // the first collection: a Refresh by the agent, with the user's yes for the noisy steps
  assert.equal((await run(home, ['refresh', '-p', 'thing-one', '--yes'], env(0, ITEMS([{ key: 'a' }])))).status, 0)
  await run(home, ['watch', '-p', 'thing-one', '--every', '24h'], env(0))
  // not due yet
  assert.deepEqual(JSON.parse((await run(home, ['watch', '--due', '--json'], env(23, ITEMS([{ key: 'a' }, { key: 'b' }])))).out), { passes: [] })
  const mark = events(dir).length
  const r = await run(home, ['watch', '--due', '--json'], env(25, ITEMS([{ key: 'a' }, { key: 'b' }, { key: 'c' }])))
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(JSON.parse(r.out).passes, [{ slug: 'thing-one', added: 2, removed: 0, changed: 0, text: 'thing one: 2 new things', error: null }])
  const ev = events(dir).slice(mark)
  // never a noisy step, one that sends an image, one that costs, one nobody declared watch: true, and never --yes
  assert.deepEqual(ev.filter(e => e.kind === 'cmd.start').map(e => e.text), ['watched collect --step quiet'])
  assert.deepEqual(ev.filter(e => e.by !== 'watch'), [], 'every event of a pass is by watch')
  const c = json(dir, '.osint/case.json')
  assert.deepEqual(c.watch, { every: '24h', last: at(25), next: at(49), error: null })
  assert.deepEqual([c.refreshes.at(-1).by, c.refreshes.at(-1).added], ['watch', 2])
  assert.match(read(dir, 'Case.md'), /## Ce qui a changé — .+ · veille\n\n- quiet: \+2 \(b, c\)/)
  assert.match(read(dir, 'Journal.md'), /· watch · What changed: quiet: \+2 \(b, c\) \^j\d{3}/)
  assert.equal(summaries(home)[0].new, 2)
  // the folder's switch off: nothing runs, however late
  await run(home, ['watch', '--pause'], env(25))
  assert.deepEqual(JSON.parse((await run(home, ['watch', '--due', '--json'], env(80))).out), { passes: [] })
})

test('a server off for days: one pass for the missed ones, then the next a period after it', async () => {
  const home = casesFolder(), dir = path.join(home, 'thing-one')
  await run(home, NEW('thing one'), env(0))
  await run(home, ['watch', '-p', 'thing-one', '--every', '24h'], env(0))
  const r = await run(home, ['watch', '--due', '--json'], env(100, ITEMS([{ key: 'a' }])))
  assert.equal(r.status, 0, r.err)
  assert.equal(JSON.parse(r.out).passes.length, 1)
  assert.equal(json(dir, '.osint/case.json').watch.next, at(124))
  assert.match(read(dir, 'Journal.md'), /· watch · 4 passes were due since .+ \(the server was off\): one pass for them/)
  assert.deepEqual(JSON.parse((await run(home, ['watch', '--due', '--json'], env(101))).out).passes, [])
})

test('cases one after another; a pass that breaks is noted, its next pass set, the other cases still watched', async () => {
  const home = casesFolder()
  for (const t of ['thing one', 'thing two']) {
    await run(home, NEW(t), env(0))
    await run(home, ['watch', '-p', t.replace(' ', '-'), '--every', '6h'], env(0))
  }
  const r = await run(home, ['watch', '--due', '--json'], env(7, { ...ITEMS([{ key: 'a' }]), OSINT_WATCH_THROW: 'thing one' }))
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(JSON.parse(r.out).passes.map(p => [p.slug, p.error]), [['thing-one', 'quiet: watched collect: thing one broke'], ['thing-two', null]])
  const one = path.join(home, 'thing-one')
  assert.deepEqual(json(one, '.osint/case.json').watch, { every: '6h', last: at(7), next: at(13), error: 'quiet: watched collect: thing one broke' })
  assert.match(read(one, 'Journal.md'), /· fail · .*thing one broke/)
  // a case whose type is no longer the one the user armed (swapped in its case.json): not run
  const f = path.join(home, 'thing-two', '.osint', 'case.json')
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), type: 'gone' }))
  const r2 = JSON.parse((await run(home, ['watch', '--due', '--json'], env(14, ITEMS([{ key: 'a' }])))).out).passes
  assert.deepEqual(r2.map(p => p.slug), ['thing-one'])
  assert.equal(r2[0].error, null)
  // a case moved to the trash is no longer watched
  fs.renameSync(path.join(home, 'thing-two'), path.join(home, '.trash-thing-two'))
  assert.deepEqual(JSON.parse((await run(home, ['watch', '--json'], env(14))).out).cases.map(c => c.slug), ['thing-one'])
})

test('two rounds at once (the server\'s and the agent\'s): the case gets one pass, not two', async () => {
  const home = casesFolder(), dir = path.join(home, 'thing-one')
  await run(home, NEW('thing one'), env(0))
  await run(home, ['watch', '-p', 'thing-one', '--every', '6h'], env(0))
  const rounds = await Promise.all([1, 2, 3].map(() => run(home, ['watch', '--due', '--json'], env(7, ITEMS([{ key: 'a' }])))))
  assert.deepEqual(rounds.map(r => r.status), [0, 0, 0])
  assert.equal(rounds.reduce((n, r) => n + JSON.parse(r.out).passes.length, 0), 1)
  assert.equal(json(dir, '.osint/case.json').refreshes.filter(r => r.by === 'watch').length, 1)
  assert.equal(json(dir, '.osint/case.json').watch.next, at(13))
})

test('doctor\'s watch line: how many cases, the soonest pass, the notifications, whether a server runs them', async () => {
  const home = casesFolder()
  const line = async () => JSON.parse((await run(home, ['doctor', '--json'], env(0))).out).lines.find(l => l.name === 'watch').text
  assert.equal(await line(), 'no case watched')
  for (const [t, every] of [['thing one', '24h'], ['thing two', '6h']]) {
    await run(home, NEW(t), env(0))
    await run(home, ['watch', '-p', t.replace(' ', '-'), '--every', every], env(0))
  }
  assert.match(await line(), /^2 cases \(thing-two every 6h, next .+\) · notifications on( \(.+\))? · no dashboard server runs them: osint\.mjs dashboard starts it$/)
  await run(home, ['watch', '--notify', 'off'], env(0))
  assert.match(await line(), /· notifications off ·/)
  await run(home, ['watch', '--pause'], env(0))
  assert.match(await line(), /^paused — 2 cases keep their period; watch --resume \(or Settings\) turns it back on$/)
  assert.match((await run(home, ['doctor'], env(0))).out, /^watch: paused — 2 cases/m)
})
