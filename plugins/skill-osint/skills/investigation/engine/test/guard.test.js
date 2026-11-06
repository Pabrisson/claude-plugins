import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, events, FIXTURES, json, read, run } from './helpers.js'

// a copy of the fixtures whose bakery home page says too much: a union in its title, a union section's account linked
const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-guard-'))
fs.cpSync(FIXTURES, copy, { recursive: true })
const page = path.join(copy, 'web', 'durand-bakery.example', 'index.html')
fs.writeFileSync(page, fs.readFileSync(page, 'utf8')
  .replace(/<title>[^<]*<\/title>/, '<title>Boulangerie Durand — section syndicale CGT des boulangers</title>')
  .replace('</body>', '<a href="https://www.instagram.com/section.syndicale.durand">Notre section</a></body>'))
const fake = await startFake({ fixtures: copy })
test.after(() => fake.close())
const env = fakeEnv(fake.url, copy)
const PERSON = ['new', 'person', 'Pierre Gay', '--in', 'identifiers=site: durand-bakery.example', '--question', 'Is the bakery site Pierre Gay\'s?',
  '--frame', 'purpose=Check the manager before a supply contract', '--frame', 'legal_basis=Legitimate interest — checking a contracting party', '--frame', 'noisy=ask']   // the home page is read on the site itself: noisy, so ask + --yes (stage 1)
const CHILD = ['new', 'domain', 'durand-bakery.example', '--question', 'Is it his site?', '--parent', 'pierre-gay', '--from', 'Entities/durand-bakery.example.md']
const P = ['-p', 'pierre-gay'], C = ['-p', 'durand-bakery-example']

test('the CLI refuses an entity or a clue of GDPR article 9 in a person case and below it, the subject\'s name aside; elsewhere nothing changes', async () => {
  const h = casesFolder()
  await run(h, PERSON, env)
  await run(h, CHILD, env)
  const religion = await run(h, ['entity', 'organization', 'Paroisse Saint-Exemple', '--prop', 'religion=catholique', ...P], env)
  assert.equal(religion.status, 1)
  assert.match(religion.err, /refused: religion or belief data \(GDPR article 9, its property religion\) is never recorded in a person case nor in its children \(pierre-gay\)/)
  assert.match((await run(h, ['clue', 'Il est syndiqué à la CGT', '--status', 'read', ...P], env)).err, /refused: trade-union membership data/)
  assert.match((await run(h, ['clue', 'Elle est enceinte', '--status', 'observed', ...C], env)).err, /refused: health data .*\(pierre-gay\)/)
  assert.equal((await run(h, ['clue', 'Pierre Gay tient le site de la boulangerie', '--status', 'observed', ...C], env)).status, 0)
  assert.equal((await run(h, ['entity', 'person', 'Christian Gay', '--prop', 'role=co-gérant', ...C], env)).status, 0)
  assert.deepEqual(fs.readdirSync(path.join(h, 'pierre-gay', 'Clues')), [])
  assert.ok(!fs.existsSync(path.join(h, 'pierre-gay', 'Entities', 'Paroisse Saint-Exemple.md')))
  // a case outside any person case: the guard does not apply
  await run(h, ['new', 'domain', 'other-shop.example', '--question', 'Q?', '--frame', 'noisy=never'], env)
  assert.equal((await run(h, ['clue', 'Le site parle de la section syndicale', '--status', 'read', '-p', 'other-shop-example'], env)).status, 0)
})

test('a type\'s write of GDPR article 9 data in a child is withheld, said without its value; the command goes on', async () => {
  const h = casesFolder(), dir = path.join(h, 'durand-bakery-example')
  await run(h, PERSON, env)
  await run(h, CHILD, env)
  const r = await run(h, ['domain', 'collect', '--only', 'home', '--yes', ...C], env)
  assert.equal(r.status, 0, r.err)
  const clues = fs.readdirSync(path.join(dir, 'Clues')).join('\n')
  assert.doesNotMatch(clues, /syndica/i)
  assert.match(clues, /Trackers on the home page/)
  assert.ok(!fs.existsSync(path.join(dir, 'Entities', 'https---www.instagram.com-section.syndicale.durand.md')))
  assert.ok(fs.existsSync(path.join(dir, 'Entities', 'https---www.instagram.com-durand.bakery.md')))
  assert.ok(!json(dir, '.osint/case.json').relations.some(x => /syndicale/.test(x.to)))
  const withheld = read(dir, 'Journal.md').split('\n').filter(l => l.includes('· withheld ·')).join('\n')
  assert.match(withheld, /a clue: trade-union membership data \(GDPR article 9\) is never recorded in a person case nor in its children/)
  assert.match(withheld, /an entity \(account\): trade-union membership data/)
  assert.doesNotMatch(withheld, /syndica|instagram/i)
  assert.ok(events(dir).some(e => e.kind === 'log' && e.text === 'withheld an entity (account) — GDPR article 9'))
})

test('a username child of a person case never looks at dating, health, political or adult sites', async () => {
  const h = casesFolder(), dir = path.join(h, 'durand-bakery')
  await run(h, PERSON, env)
  assert.equal((await run(h, ['new', 'username', 'durand.bakery', '--question', 'Q?', '--parent', 'pierre-gay', '--in', 'categories=social,political,dating,coding'], env)).status, 0)
  const r = await run(h, ['username', 'check', '-p', 'durand-bakery'], env)
  assert.equal(r.status, 0, r.err)
  assert.match(read(dir, 'Journal.md'), /whatsmyname: skipped the political, dating categories — a person case never looks there \(GDPR article 9\)/)
  const capture = fs.readdirSync(path.join(dir, 'Evidence', 'captures')).find(f => f.startsWith('S01'))
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'Evidence', 'captures', capture), 'utf8')).categories, ['social', 'coding'])
})

test('the guard holds on every way in: --yes, a free note, a hypothesis, a pivot child, a refresh; a name is never a hit', async () => {
  const h = casesFolder(), dir = path.join(h, 'pierre-gay')
  await run(h, PERSON, env)
  await run(h, CHILD, env)
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'osint-guard-')), 'n.md')
  fs.writeFileSync(f, 'Il est syndiqué à la CGT')
  const refused = async (argv, what) => { const r = await run(h, argv, env); assert.equal(r.status, 1, `${what}: ${r.out}`); assert.match(r.err, /refused: .* \(GDPR article 9/, what) }
  await refused(['clue', 'Elle est enceinte', '--status', 'read', '--yes', ...P], '--yes on a clue')
  await refused(['entity', 'account', 'https://x.example/u/section.syndicale', '--yes', ...P], '--yes on an entity')
  await refused(['note', 'Profile.md', '--file', f, ...P], 'a free note')
  await refused(['hyp', 'add', 'Il est de religion musulmane', '--level', 'identity', '--refute-if', 'x', ...P], 'a hypothesis')
  // a child opened by a pivot, a question that seeks article 9 data or a person to follow: refused before any folder is made
  const before = fs.readdirSync(h).sort().join()
  for (const q of ['Est-il syndiqué ?', 'Où habite-t-il ?  Suivre ses déplacements'])
    assert.equal((await run(h, ['new', 'domain', 'x-shop.example', '--question', q, '--parent', 'pierre-gay', '--from', 'Entities/durand-bakery.example.md'], env)).status, 1, q)
  assert.equal(fs.readdirSync(h).sort().join(), before)
  // a refresh, whose collection finds the union's account: withheld, not written
  assert.equal((await run(h, ['refresh', '--yes', ...C], env)).status, 0)
  assert.ok(!fs.existsSync(path.join(h, 'durand-bakery-example', 'Entities', 'https---www.instagram.com-section.syndicale.durand.md')))
  assert.deepEqual(fs.readdirSync(path.join(dir, 'Clues')), [])
})
