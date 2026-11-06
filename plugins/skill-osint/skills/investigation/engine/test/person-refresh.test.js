import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { childSteps } from '../../types/person/engine.js'
import { readNote } from '../lib/vault.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, FIXTURES, json, read, run } from './helpers.js'

test('childSteps: every step of a child\'s Refresh but the noisy ones, said unless the child never runs them', () => {
  const m = { refresh: [{ id: 'a', by: 'engine' }, { id: 'loud', by: 'engine', noisy: true }, { id: 'read', by: 'agent' }] }
  assert.deepEqual(childSteps(m, 'ask'), { only: ['a', 'read'], loud: ['loud'] })
  assert.deepEqual(childSteps(m, 'never'), { only: ['a', 'read'], loud: [] })
  assert.deepEqual(childSteps({}, 'ask'), { only: [], loud: [] })
})

// a copy of the fixtures: the test adds an address to the bakery's home page between two Refreshes
const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-pref-'))
fs.cpSync(FIXTURES, copy, { recursive: true })
const fake = await startFake({ fixtures: copy })
test.after(() => fake.close())
const env = fakeEnv(fake.url, copy)
const P = ['-p', 'jeanne-durand']
const file = v => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'osint-plan-')), 'plan.json'); fs.writeFileSync(f, JSON.stringify(v)); return f }

test('refresh: each child\'s Refresh, its agent steps handed back with its case, then the profile and its What changed', async () => {
  const home = casesFolder(), dir = path.join(home, 'jeanne-durand'), kid = path.join(home, 'durand-bakery-example')
  await run(home, ['new', 'person', 'Jeanne Durand', '--in', 'identifiers=site: durand-bakery.example\n+33 6 39 98 12 34', '--question', 'Are these hers?',
    '--frame', 'purpose=Check the manager before a supply contract', '--frame', 'legal_basis=Legitimate interest — checking a contracting party', '--frame', 'noisy=ask'], env) // the home page is noisy: ask, then --yes
  await run(home, ['person', 'plan', '--file', file([{ line: 'site: durand-bakery.example', why: 'The shop site' }, { line: '+33 6 39 98 12 34', why: 'The contract number' }]), ...P], env)
  await run(home, ['new', 'domain', 'durand-bakery.example', '--question', 'Is the site hers?', '--parent', 'jeanne-durand', '--from', 'Entities/durand-bakery.example.md'], env)
  await run(home, ['domain', 'collect', '--only', 'rdap,home', '--yes', '-p', 'durand-bakery-example'], env)
  await run(home, ['new', 'phone', '+33 6 39 98 12 34', '--title', 'Telephone of Jeanne Durand', '--question', 'Is the number hers?', '--parent', 'jeanne-durand', '--from', 'Entities/+33639981234.md'], env)

  const first = await run(home, ['refresh', ...P, '--json'], env)
  assert.equal(first.status, 0, first.err)
  const out = JSON.parse(first.out)
  assert.deepEqual(out.agent.map(a => a.prompt), ['[phone:refresh-mentions] +33 6 39 98 12 34 (case telephone-of-jeanne-durand)'])
  assert.equal(json(kid, '.osint/case.json').refreshes.length, 1)
  const profile = out.diffs.find(d => d.name === 'profile')
  assert.ok(profile.added.some(x => x.key === 'email:contact@durand-bakery.example'))
  assert.deepEqual(profile.changed.map(x => x.key), ['domain:durand-bakery.example'])

  // the bakery's home page now publishes her address: the child's Refresh finds it, the profile says so
  const page = path.join(copy, 'web', 'durand-bakery.example', 'index.html')
  fs.writeFileSync(page, fs.readFileSync(page, 'utf8').replace('</body>', '<a href="mailto:jeanne@durand-bakery.example">Jeanne</a></body>'))
  const second = JSON.parse((await run(home, ['refresh', ...P, '--json'], env)).out)
  // the home page is noisy: the person's Refresh never reads it, the Journal says how to, after the user's yes
  assert.deepEqual(second.diffs.find(d => d.name === 'profile').added, [])
  assert.match(read(dir, 'Journal.md'), /refresh durand-bakery-example: home not run \(noisy\) — after the user's yes: refresh -p durand-bakery-example --only home --yes/)
  const yes = await run(home, ['refresh', '-p', 'durand-bakery-example', '--only', 'home', '--yes', '--json'], env)
  assert.equal(yes.status, 0, yes.err)
  assert.match(readNote(path.join(kid, 'Case.md')).body, /home: \+1 \(email:jeanne@durand-bakery\.example\)/)
  const third = JSON.parse((await run(home, ['refresh', ...P, '--json'], env)).out)
  assert.deepEqual(third.diffs.find(d => d.name === 'profile').added.map(x => x.key), ['email:jeanne@durand-bakery.example'])
  assert.match(readNote(path.join(dir, 'Case.md')).body, /profile: \+1 \(email:jeanne@durand-bakery\.example\)/)
})

test('refresh goes on past a child gone to the bin or of a type no longer installed', async () => {
  const home = casesFolder(), dir = path.join(home, 'jeanne-durand')
  await run(home, ['new', 'person', 'Jeanne Durand', '--in', 'identifiers=site: durand-bakery.example', '--question', 'Q?',
    '--frame', 'purpose=Check the manager', '--frame', 'legal_basis=Consent — she agreed', '--frame', 'noisy=never'], env)
  await run(home, ['person', 'plan', '--file', file([{ line: 'site: durand-bakery.example', why: 'The shop site' }]), ...P], env)
  await run(home, ['new', 'domain', 'durand-bakery.example', '--question', 'Q?', '--parent', 'jeanne-durand'], env)
  await run(home, ['new', 'domain', 'other-shop.example', '--question', 'Q?', '--parent', 'jeanne-durand'], env)
  fs.renameSync(path.join(home, 'durand-bakery-example'), path.join(os.tmpdir(), `binned-${Date.now()}`))
  const c = path.join(home, 'other-shop-example', 'Case.md')
  fs.writeFileSync(c, fs.readFileSync(c, 'utf8').replace(/^type: domain$/m, 'type: telex'))
  const r = await run(home, ['refresh', ...P, '--json'], env)
  assert.equal(r.status, 0, r.err)
  assert.match(read(dir, 'Journal.md'), /· fail · refresh other-shop-example: /)
  assert.match(read(dir, 'Journal.md'), /profile: 1 identifiers from 1 linked cases/)
})
