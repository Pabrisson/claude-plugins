import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, events, FIXTURES, json, read, run } from './helpers.js'

const fake = await startFake({ fixtures: FIXTURES })
test.after(() => fake.close())
const T0 = '2026-11-03T06:00:00.000Z', at = h => new Date(Date.parse(T0) + h * 3600e3).toISOString()
const env = (h = 0) => ({ ...fakeEnv(fake.url, FIXTURES), OSINT_NOW: at(h) })
const P = ['-p', 'jeanne-durand']
const file = v => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'osint-plan-')), 'plan.json'); fs.writeFileSync(f, JSON.stringify(v)); return f }
const edit = (home, slug, from, to) => { const f = path.join(home, slug, 'Case.md'); const t = fs.readFileSync(f, 'utf8'); assert.ok(t.includes(from), from); fs.writeFileSync(f, t.replace(from, to)) }

async function person(frame = {}) {
  const home = casesFolder()
  const r = await run(home, ['new', 'person', 'Jeanne Durand', '--in', 'identifiers=site: durand-bakery.example\n+33 6 39 98 12 34', '--question', 'Are these hers?',
    '--frame', `purpose=${frame.purpose ?? 'Check the manager before a supply contract'}`, '--frame', 'legal_basis=Legitimate interest — checking a contracting party', '--frame', 'noisy=ask'], env())
  assert.equal(r.status, 0, r.err)
  await run(home, ['person', 'plan', '--file', file([{ line: 'site: durand-bakery.example', why: 'The shop site' }, { line: '+33 6 39 98 12 34', why: 'The contract number' }]), ...P], env())
  await run(home, ['new', 'domain', 'durand-bakery.example', '--question', 'Is the site hers?', '--parent', 'jeanne-durand', '--from', 'Entities/durand-bakery.example.md'], env())
  await run(home, ['new', 'phone', '+33 6 39 98 12 34', '--title', 'Telephone of Jeanne Durand', '--question', 'Is the number hers?', '--parent', 'jeanne-durand', '--from', 'Entities/+33639981234.md'], env())
  return home
}

test('a person case is watched within its frame: its children\'s watched steps only, never a noisy step, an agent step nor --yes', async () => {
  const home = await person(), kid = path.join(home, 'durand-bakery-example')
  const r = await run(home, ['watch', ...P, '--every', '6h'], env())
  assert.equal(r.status, 0, r.err)
  const mark = events(kid).length
  const due = await run(home, ['watch', '--due', '--json'], env(7))
  assert.equal(due.status, 0, due.err)
  const [pass] = JSON.parse(due.out).passes
  assert.equal(pass.slug, 'jeanne-durand')
  const ran = events(kid).slice(mark).filter(e => e.kind === 'cmd.start').map(e => e.text)
  assert.deepEqual(ran.sort(), ['domain collect --only crt', 'domain collect --only dns', 'domain collect --only host', 'domain collect --only rdap', 'domain collect --only wayback'])
  assert.ok(ran.every(t => !/--yes|home/.test(t)))
  assert.deepEqual(events(kid).slice(mark).filter(e => e.by !== 'watch'), [])
  // the phone's only step is the agent's: the watch hands nothing to an agent
  assert.deepEqual(json(home, 'jeanne-durand/.osint/case.json').refreshes.at(-1).by, 'watch')
})

test('a person case is watched only within its frame: no purpose, no legal basis, a private person pursued, an article 9 category: refused, now and at the pass', async () => {
  for (const [what, from, to, want] of [
    ['a purpose that pursues her', 'Check the manager before a supply contract', 'to track her movements everywhere', /never watched to find, contact or follow a private person/],
    ['a purpose that names a belief', 'Check the manager before a supply contract', 'to know her religion', /religion or belief data \(GDPR article 9\)/],
    ['no legal basis', 'Legitimate interest — checking a contracting party', '', /no legal basis/],
  ]) {
    const home = await person()
    edit(home, 'jeanne-durand', from, to)
    const r = await run(home, ['watch', ...P, '--every', '6h'], env())
    assert.equal(r.status, 1, what)
    assert.match(r.err, want, what)
    assert.equal(json(home, 'jeanne-durand/.osint/case.json').watch ?? null, null, what)
  }
  // watched while the frame was sound, the frame then edited: the pass queries nothing and says why
  const home = await person(), kid = path.join(home, 'durand-bakery-example')
  assert.equal((await run(home, ['watch', ...P, '--every', '6h'], env())).status, 0)
  edit(home, 'jeanne-durand', 'Check the manager before a supply contract', 'to know her religion')
  const mark = events(kid).length
  const [pass] = JSON.parse((await run(home, ['watch', '--due', '--json'], env(7))).out).passes
  assert.match(pass.error, /GDPR article 9/)
  assert.deepEqual(events(kid).slice(mark).filter(e => e.kind === 'cmd.start'), [])
  assert.match(read(home, 'jeanne-durand/Journal.md'), /· fail · watch pass: not watched any more/)
})

// the shipped person type next to the watch's test type, to see what a person's watch runs in a child that has steps
// of every kind (its engine.js is the shipped one: the copy only re-exports it)
function mixedTypes() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-types-')), shipped = path.join(FIXTURES, '..', '..', '..', 'types', 'person')
  fs.cpSync(shipped, path.join(dir, 'person'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'person', 'engine.js'), `export * from ${JSON.stringify(path.join(shipped, 'engine.js'))}\n`)
  fs.cpSync(path.join(FIXTURES, 'watch-types', 'watched'), path.join(dir, 'watched'), { recursive: true })
  return dir
}

test('a person\'s watch runs a child\'s watched steps only: not one that sends an image, costs, is noisy, was left unmarked or is the child\'s to ask', async () => {
  const home = casesFolder(), types = mixedTypes(), kid = path.join(home, 'thing-one')
  const e = (h = 0) => ({ OSINT_TYPES: types, OSINT_NOW: at(h), OSINT_WATCH_ITEMS: JSON.stringify(Object.fromEntries(['quiet', 'manual', 'unmarked', 'loud', 'image', 'cost', 'sneaky'].map(s => [s, [{ key: s }]]))) })
  assert.equal((await run(home, ['new', 'person', 'Jeanne Durand', '--in', 'identifiers=site: thing.example', '--question', 'Q?', '--frame', 'purpose=Check the manager', '--frame', 'legal_basis=Consent — she agreed', '--frame', 'noisy=ask'], e())).status, 0)
  const c = await run(home, ['new', 'watched', 'thing one', '--question', 'Q?', '--frame', 'noisy=ask', '--parent', 'jeanne-durand'], e())
  assert.equal(c.status, 0, c.err)
  assert.equal((await run(home, ['watch', ...P, '--every', '6h'], e())).status, 0)
  const mark = events(kid).length
  const due = await run(home, ['watch', '--due', '--json'], e(7))
  assert.equal(due.status, 0, due.err)
  assert.equal(JSON.parse(due.out).passes[0].error, null)
  assert.deepEqual(events(kid).slice(mark).filter(x => x.kind === 'cmd.start').map(x => x.text), ['watched collect --step quiet'])
  // a Refresh by the user still runs the child's other steps (not the noisy ones): the watch is the narrower one
  const user = await run(home, ['refresh', ...P, '--json'], e(8))
  assert.equal(user.status, 0, user.err)
  assert.ok(events(kid).some(x => x.kind === 'cmd.start' && x.text === 'watched collect --step image'))
})
