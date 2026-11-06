import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { indexCase } from '../lib/brain.js'
import { sha256File } from '../lib/util.js'
import { readNote } from '../lib/vault.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, events, FIXTURES, json, NEW, read, run } from './helpers.js'

const fake = await startFake()
test.after(() => fake.close())
const P = ['-p', 'durand-bakery-example']
async function newCase() { const home = casesFolder(); await run(home, NEW); return { home, dir: path.join(home, 'durand-bakery-example') } }

test('source by URL: the page captured and hashed, its note with the Admiralty grade, the host meant recorded', async () => {
  const { home, dir } = await newCase()
  const r = await run(home, ['source', 'https://durand-bakery.example/', '--reliability', 'B', ...P], fakeEnv(fake.url))
  assert.equal(r.status, 0, r.err)
  const n = readNote(path.join(dir, 'Sources', 'S01 Boulangerie Durand — pains et viennoiseries.md')).props
  assert.deepEqual([n.id, n.url, n.reliability, n.http_status, n.capture], ['S01', 'https://durand-bakery.example/', 'B', 200, '[[S01.html]]'])
  assert.equal(n.sha256, sha256File(path.join(dir, 'Evidence', 'captures', 'S01.html')))
  assert.match(read(dir, 'Journal.md'), /· source · S01 GET https:\/\/durand-bakery\.example\/ → 200 · sha256 [0-9a-f]{12}/)
  assert.ok(fake.seen.some(s => s.host === 'durand-bakery.example'))
  assert.ok(events(dir).some(e => e.kind === 'source.add' && e.id === 'S01'))
})

test('source --file hashes a capture the agent saved; --archive spn asks the Wayback Machine', async () => {
  const { home, dir } = await newCase()
  const cap = path.join(home, 'lens.png'); fs.writeFileSync(cap, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  assert.equal((await run(home, ['source', 'https://lens.google.com/search?p=x', '--file', cap, '--title', 'Lens results', ...P])).status, 0)
  const s = readNote(path.join(dir, 'Sources', 'S01 Lens results.md')).props
  assert.equal(s.sha256, sha256File(cap))
  assert.equal((await run(home, ['source', 'https://durand-bakery.example/', '--archive', 'spn', ...P], fakeEnv(fake.url))).status, 0)
  assert.match(String(readNote(path.join(dir, 'Sources', 'S02 Boulangerie Durand — pains et viennoiseries.md')).props.archive), /^https:\/\/web\.archive\.org\//)
})

test('entity: one note per value, sources merged, the user\'s tags kept, names any OS takes and links that resolve', async () => {
  const { home, dir } = await newCase()
  await run(home, ['source', 'https://durand-bakery.example/', ...P], fakeEnv(fake.url))
  assert.equal((await run(home, ['entity', 'domain', 'durand-bakery.example', '--sources', 'S01', '--prop', 'role=main', ...P])).status, 0)
  const f = path.join(dir, 'Entities', 'durand-bakery.example.md')
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('  - entity/domain', '  - entity/domain\n  - mine'))
  assert.equal((await run(home, ['entity', 'domain', 'durand-bakery.example', '--confidence', 'high', ...P])).status, 0)
  const p = readNote(f).props
  assert.deepEqual([p.kind, p.value, p.confidence, p.role, p.tags, p.sources], ['domain', 'durand-bakery.example', 'high', 'main', ['entity/domain', 'mine'], ['[[S01 Boulangerie Durand — pains et viennoiseries]]']])
  assert.equal(events(dir).filter(e => e.kind === 'entity.add').length, 1)
  assert.equal(JSON.parse(read(dir, 'Graph.canvas')).nodes.length, 1)
  assert.equal((await run(home, ['entity', 'account', 'a/b:c#d [x]', ...P])).status, 0)
  assert.ok(fs.existsSync(path.join(dir, 'Entities', 'a-b-c-d -x-.md')))
  assert.equal((await run(home, ['entity', 'account', 'durand-bakery.example', ...P])).status, 0)
  assert.ok(fs.existsSync(path.join(dir, 'Entities', 'durand-bakery.example (account).md')))
  fs.writeFileSync(path.join(dir, 'Case.md'), fs.readFileSync(path.join(dir, 'Case.md'), 'utf8') + '\nSee [[a-b-c-d -x-]].\n')
  assert.ok(indexCase(home, 'durand-bakery-example').backlinks['Entities/a-b-c-d -x-.md'])
  assert.equal((await run(home, ['entity', 'planet', 'Mars', ...P])).status, 1)
})

test('clue: an id, its status, where it was seen, the entities it is about; an unknown status is refused', async () => {
  const { home, dir } = await newCase()
  await run(home, ['entity', 'organization', 'Boulangerie Durand SARL', ...P])
  const r = await run(home, ['clue', 'RCS Exempleville 456 789 122 in the footer', '--status', 'read', '--credibility', '2', '--entities', 'Boulangerie Durand SARL', '--title', 'SIREN in the footer', ...P])
  assert.equal(r.status, 0, r.err)
  const c = readNote(path.join(dir, 'Clues', 'C01 SIREN in the footer.md'))
  assert.deepEqual([c.props.id, c.props.status, c.props.credibility, c.props.constraint, c.props.entities], ['C01', 'read', 2, false, ['[[Boulangerie Durand SARL]]']])
  assert.match(c.body, /RCS Exempleville 456 789 122 in the footer/)
  assert.equal((await run(home, ['clue', 'x', '--status', 'certain', ...P])).status, 1)
})

test('evidence: the original copied untouched, hashed, read-only, listed in case.json', async () => {
  const { home, dir } = await newCase()
  const src = path.join(home, 'photo.jpg'); fs.writeFileSync(src, 'jpeg bytes')
  assert.equal((await run(home, ['evidence', src, ...P])).status, 0)
  const f = path.join(dir, 'Evidence', 'E01-photo.jpg')
  assert.equal(fs.readFileSync(f, 'utf8'), 'jpeg bytes')
  assert.equal(json(dir, '.osint/case.json').evidence[0].sha256, sha256File(src))
  if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o222, 0)
})

test('evidence from a URL keeps the address; status hashes the originals again and says one that changed', async () => {
  const { home, dir } = await newCase()
  assert.equal((await run(home, ['evidence', 'https://durand-bakery.example/', ...P], fakeEnv(fake.url))).status, 0)
  assert.equal(json(dir, '.osint/case.json').evidence[0].url, 'https://durand-bakery.example/')
  assert.deepEqual(JSON.parse((await run(home, ['status', '--json', ...P])).out).evidence_problems, [])
  const f = path.join(dir, json(dir, '.osint/case.json').evidence[0].file)
  fs.chmodSync(f, 0o644); fs.writeFileSync(f, 'tampered')
  const s = await run(home, ['status', ...P])
  assert.match(s.out, /warning: E01 .* changed since it was added/)
  assert.deepEqual(JSON.parse((await run(home, ['status', '--json', ...P])).out).evidence_problems.map(x => x.problem), ['changed'])
})

test('note writes the agent\'s block and never outside the vault nor in its machine state', async () => {
  const { home, dir } = await newCase()
  assert.equal((await run(home, ['note', 'Report.md', '--text', 'Draft of the summary.', ...P])).status, 0)
  assert.match(read(dir, 'Report.md'), /%% osint:begin agent %%\nDraft of the summary\.\n%% osint:end agent %%/)
  for (const bad of ['../x.md', '.osint/x.md', 'Evidence/x.txt']) assert.equal((await run(home, ['note', bad, '--text', 'x', ...P])).status, 1, bad)
})

test('a source read again unchanged stays the same source; a clue found again is the same clue and gains its new sources', async () => {
  const { home, dir } = await newCase()
  for (let i = 0; i < 2; i++) assert.equal((await run(home, ['source', 'https://durand-bakery.example/', ...P], fakeEnv(fake.url))).status, 0)
  assert.deepEqual(fs.readdirSync(path.join(dir, 'Sources')).filter(f => f.endsWith('.md')).length, 1)
  assert.equal(fs.readdirSync(path.join(dir, 'Evidence', 'captures')).length, 1)
  assert.match(read(dir, 'Journal.md'), /read again, unchanged/)
  const s2 = path.join(home, 'b.txt'); fs.writeFileSync(s2, 'b'); await run(home, ['source', 'https://example.org/b', '--file', s2, ...P])
  const a = ['clue', 'Registrar is OVH', '--status', 'read', ...P]
  assert.equal((await run(home, [...a, '--sources', 'S01'])).status, 0)
  assert.equal((await run(home, [...a, '--sources', 'S02'])).status, 0)
  const clues = fs.readdirSync(path.join(dir, 'Clues'))
  assert.equal(clues.length, 1)
  assert.deepEqual(readNote(path.join(dir, 'Clues', clues[0])).props.sources.length, 2)
  assert.match(read(dir, 'Journal.md'), /found again/)
})

test('an entity\'s facts are escaped: a property a third party wrote never loads an image nor links', async () => {
  const { home, dir } = await newCase()
  assert.equal((await run(home, ['entity', 'account', 'https://x.example/a', '--prop', 'site=![p](http://evil.example/p.png) [[Journal]]', ...P])).status, 0)
  const body = readNote(path.join(dir, 'Entities', 'https---x.example-a.md')).body
  assert.ok(!/(?<!\\)!\[/.test(body) && !/(?<!\\)\[\[Journal/.test(body), body)
})
