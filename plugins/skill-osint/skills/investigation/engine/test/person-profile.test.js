import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { belongs, profileRows, profileText } from '../../types/person/engine.js'
import { readNote } from '../lib/vault.js'
import { clueId } from './demo-data.mjs'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, json, read, run } from './helpers.js'

const L = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'types', 'person', 'labels.json'), 'utf8')).en
const t = (k, v = {}) => (L[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => v[n] ?? '')
const E = (kind, value, props = {}) => ({ path: `Entities/${value}.md`, kind, value, props })
const subject = { name: 'Jeanne Durand', born: '1961-04' }
const planned = [
  { key: 'username:durand.bakery', kind: 'username', value: 'durand.bakery', type: 'username', why: 'the shop account', path: 'Entities/durand.bakery.md' },
  { key: 'phone:fr:0639981234', kind: 'phone', value: '+33639981234', type: 'phone', why: 'the contract number', path: 'Entities/+33639981234.md' },
  { key: 'organization:456789122', kind: 'organization', value: 'SIREN 456 789 122', type: 'company-fr', why: 'her company', path: 'Entities/SIREN 456 789 122.md' },
  { key: 'place:coarse:exempleville', kind: 'place', value: 'Exempleville', type: null, why: 'the town', path: 'Entities/Exempleville.md' },
]
const linked = [
  { slug: 'boulangerie-durand-sarl', rel: 'parent', type: 'company-fr', status: 'done', confidence: 'high', from: null, entities: [
    E('organization', 'BOULANGERIE DURAND', { role: 'subject', siren: '456789122', sources: ['[[S01 Registre 456 789 122]]'] }),
    E('person', 'JEANNE DURAND', { role: 'Associé', born: '1980-02' }), E('person', 'Jeanne Durand', { role: 'Gérant', born: '1961-04' }),
    E('place', 'SIRET 456 789 122 00011', { role: 'head office' }) ] },
  { slug: 'durand-bakery-jeanne-durand', rel: 'child', type: 'username', status: 'running', confidence: null, from: 'Entities/durand.bakery.md', entities: [
    E('username', 'durand.bakery', { role: 'subject', sources: ['[[S01 whatsmyname durand.bakery]]'] }),
    E('account', 'https://www.instagram.com/durand.bakery', { state: 'found', sources: ['[[S01 whatsmyname durand.bakery]]'] }),
    E('account', 'https://forum.example/u/durand.bakery', { confidence: 'medium', sources: ['[[S01 whatsmyname durand.bakery]]'] }) ] },
  { slug: 'telephone-de-jeanne-durand', rel: 'child', type: 'phone', status: 'done', confidence: 'medium', from: 'Entities/+33639981234.md', entities: [
    E('phone', '0639981234', { role: 'subject', sources: ['[[S01 Numbering plan]]'] }), E('organization', 'EXEMPLE TELECOM', { role: 'block holder' }) ] },
  { slug: 'durand-bakery-example-2', rel: 'child', type: 'domain', status: 'running', confidence: null, from: 'Entities/durand-bakery.example.md', entities: [
    E('domain', 'durand-bakery.example', { role: 'subject', sources: ['[[S01 RDAP durand-bakery.example]]'] }), E('email', 'contact@durand-bakery.example', { sources: ['[[S02 Home page]]'] }),
    E('tracker', 'G-DURAND123', {}), E('person', 'Jeanne Durand', { role: 'publication director' }) ] },
]
const cells = [
  { key: 'username:durand.bakery', value: 'durand.bakery', case: 'durand-bakery-jeanne-durand', clue: 'C02', clue_path: 'Clues/C02 Instagram et le site se citent.md', status: 'read', lr: 5, cap: 50, why: 'the account and the site cite each other', journal: 'j031' },
  { key: 'phone:fr:0639981234', value: '+33639981234', case: 'telephone-de-jeanne-durand', clue: 'C03', clue_path: 'Clues/C03 Bloc réservé.md', status: 'read', lr: 0.05, cap: 50, why: 'a block attributed to no one', journal: 'j032' },
]

test('profileRows: planned and found identifiers, joined through from or their key, their case, source, confidence and share', () => {
  const rows = profileRows({ subject, planned, linked, cells })
  assert.deepEqual(rows.map(r => [r.kind, r.value, r.planned, r.cases.map(c => `${c.slug}${c.as ? `/${c.as}` : ''}:${c.source ?? '-'}:${c.confidence}`).join(' '), r.confidence, r.share == null ? null : Math.round(r.share * 100)]), [
    ['username', 'durand.bakery', true, 'durand-bakery-jeanne-durand:S01:low', 'low', 83],
    ['account', 'https://forum.example/u/durand.bakery', false, 'durand-bakery-jeanne-durand:S01:medium', 'medium', null],
    ['account', 'https://www.instagram.com/durand.bakery', false, 'durand-bakery-jeanne-durand:S01:low', 'low', null],
    ['email', 'contact@durand-bakery.example', false, 'durand-bakery-example-2:S02:low', 'low', null],
    ['phone', '+33639981234', true, 'telephone-de-jeanne-durand:S01:medium', 'medium', 5],
    ['domain', 'durand-bakery.example', false, 'durand-bakery-example-2/publication director:S01:low', 'low', null],
    ['organization', 'SIREN 456 789 122', true, 'boulangerie-durand-sarl/Gérant:S01:high', 'high', null],
    ['place', 'Exempleville', true, '', null, null],
  ])
  assert.equal(belongs([]), null)
  assert.ok(Math.abs(belongs([{ lr: 100, status: 'inferred' }]) - 0.75) < 1e-9)
})

test('profileText: a table per kind, the cases as Obsidian links, the shares, the identity cells with their Journal entries', () => {
  const rows = profileRows({ subject, planned, linked, cells })
  const md = profileText(rows, { subject, linked, cells, t, journal: 'j040' })
  assert.match(md, /^# Profile — Jeanne Durand\n\nBorn 1961-04 · Linked cases: \[boulangerie-durand-sarl\]\(obsidian:\/\/open\?vault=boulangerie-durand-sarl&file=Case\) \(parent\), /)
  assert.match(md, /· \[\[Journal#\^j040\]\]\n/)
  assert.match(md, /## Usernames\n\n\| Identifier \| Case \| Source \| Confidence \| The subject's \| Why the purpose needs it \|\n\|---\|---\|---\|---\|---\|---\|\n\| \[\[durand\.bakery\]\] \| \[durand-bakery-jeanne-durand\]\(obsidian:\/\/open\?vault=durand-bakery-jeanne-durand&file=Entities%2Fdurand\.bakery\) \| durand-bakery-jeanne-durand S01 \| low \| 83 % \(1 LR\) \| the shop account \|/)
  assert.match(md, /\| \[\[SIREN 456 789 122\]\] \| \[boulangerie-durand-sarl\]\(obsidian:\/\/open\?vault=boulangerie-durand-sarl&file=Entities%2FBOULANGERIE%20DURAND\) \(as Gérant\) \| boulangerie-durand-sarl S01 \| high \| not weighed \| her company \|/)
  assert.match(md, /\| \[\[Exempleville\]\] \| no case: a town alone opens none \|  \|  \| not weighed \| the town \|/)
  assert.match(md, /## Identity\n\n- durand\.bakery ← \[durand-bakery-jeanne-durand\]\(obsidian:\/\/open\?vault=durand-bakery-jeanne-durand&file=Clues%2FC02%20Instagram%20et%20le%20site%20se%20citent\) ×5 \(read, cap 50\) — the account and the site cite each other · \[\[Journal#\^j031\]\]/)
  assert.ok(!md.includes('EXEMPLE TELECOM') && !md.includes('G-DURAND123') && !md.includes('SIRET'))
  // a cell's text with a pipe stays in its column
  assert.match(profileText([{ ...rows[0], why: 'a | b' }], { subject, linked: [], cells: [], t }), /a \\\| b/)
})

// the person case and a domain child on the shop's site, by the real engine and the fake APIs
const fake = await startFake()
test.after(() => fake.close())
const env = fakeEnv(fake.url)
const P = ['-p', 'jeanne-durand'], K = ['-p', 'durand-bakery-example']
const file = v => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'osint-plan-')), 'plan.json'); fs.writeFileSync(f, JSON.stringify(v)); return f }
const ent = (dir, value) => readNote(path.join(dir, 'Entities', `${value}.md`)).props
async function world() {
  const home = casesFolder()
  await run(home, ['new', 'person', 'Jeanne Durand', '--in', 'identifiers=site: durand-bakery.example\nville: Exempleville', '--question', 'Is the bakery site Jeanne Durand\'s?',
    '--frame', 'purpose=Check the manager before a supply contract', '--frame', 'legal_basis=Legitimate interest — checking a contracting party', '--frame', 'noisy=ask'], env) // the home page is read on the site itself (noisy): ask, then --yes
  await run(home, ['person', 'plan', '--file', file([{ line: 'site: durand-bakery.example', why: 'The shop site' }, { line: 'ville: Exempleville', why: 'The head office town' }]), ...P], env)
  await run(home, ['new', 'domain', 'durand-bakery.example', '--question', 'Is the bakery site hers?', '--parent', 'jeanne-durand', '--from', 'Entities/durand-bakery.example.md'], env)
  await run(home, ['domain', 'collect', '--only', 'rdap,home', '--yes', ...K], env)
  return { home, dir: path.join(home, 'jeanne-durand'), kid: path.join(home, 'durand-bakery-example') }
}

test('consolidate: Profile.md, the Identifiers table, the identifiers as entities of the person case, the timeline of the linked cases', async () => {
  const { home, dir } = await world()
  assert.match(read(dir, 'Profile.md'), /no case yet: a pivot is proposed/) // plan wrote a first profile
  const r = await run(home, ['person', 'consolidate', ...P], env)
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /^profile: \d+ identifiers from 1 linked cases · \^j\d{3}$/m)
  const profile = read(dir, 'Profile.md')
  assert.match(profile, /%% osint:begin profile %%\n# Profile — Jeanne Durand/)
  assert.match(profile, /## Domains[\s\S]*\| \[\[durand-bakery\.example\]\] \| \[durand-bakery-example\]\(obsidian:\/\/open\?vault=durand-bakery-example&file=Entities%2Fdurand-bakery\.example\) \|/)
  // what the domain child only found (an address on the shop's site, an account) is a candidate: out of the profile, in its own block
  const [inProfile, inCandidates] = profile.split('%% osint:begin candidates %%')
  assert.ok(!/## Email addresses|contact@durand-bakery\.example|instagram/.test(inProfile), 'a candidate is in the profile')
  assert.match(inCandidates, /## Candidates \(not weighed\)/)
  assert.ok(/contact@durand-bakery\.example/.test(inCandidates) && /instagram\.com-durand\.bakery/.test(inCandidates))
  assert.match(profile, /## Places[\s\S]*\| \[\[Exempleville\]\] \| no case: a town alone opens none \|/)
  const ids = json(dir, '.osint/views/identifiers.json')
  assert.deepEqual(ids.find(x => x.value === 'durand-bakery.example'), { kind: 'domain', value: 'durand-bakery.example', confidence: 'low', belongs: 'not weighed', case: 'durand-bakery-example', source: 'durand-bakery-example S01', why: 'The shop site' })
  assert.ok(!ids.some(x => x.kind === 'account'), 'a candidate is in the identifiers')
  assert.ok(json(dir, '.osint/views/candidates.json').some(x => x.kind === 'account' && x.value === 'https://www.instagram.com/durand.bakery'))
  const ig = ent(dir, 'https---www.instagram.com-durand.bakery')
  assert.deepEqual([ig.kind, ig.role, ig.cases], ['account', 'candidate', ['durand-bakery-example']])
  assert.ok(json(dir, '.osint/case.json').relations.some(x => x.label === 'candidate' && x.to === 'Entities/https---www.instagram.com-durand.bakery.md'))
  assert.ok(!json(dir, '.osint/case.json').relations.some(x => x.label === 'found identifier'))
  const tl = json(dir, '.osint/views/timeline.json')
  assert.ok(tl.some(i => i.label === 'durand-bakery-example · Registered' && i.case === 'durand-bakery-example' && !('ref' in i)))
  assert.ok(tl.some(i => i.kind === 'source' && i.url === 'https://durand-bakery.example/'))
  const shared = JSON.parse((await run(home, ['brain', 'entities', '--all', '--json'], env)).out)
  assert.ok(shared.some(e => e.key === 'domain:durand-bakery.example' && e.cases.length === 2))
})

test('lr: an identifier weighed with a clue of a linked case, capped by its status, replaced when given again; what it refuses', async () => {
  const { home, dir, kid } = await world()
  const trackers = clueId(kid, 'Trackers on the home page'), lr = (...a) => run(home, ['person', 'lr', ...a, ...P], env)
  const r = await lr('durand-bakery.example', '--case', 'durand-bakery-example', '--clue', trackers, '--lr', '100', '--why', 'Her bakery\'s analytics account')
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /^durand-bakery\.example: 98 % the subject's \(1 LR\) · \^j\d{3}$/m)
  assert.match(read(dir, 'Journal.md'), new RegExp(`identity durand-bakery\\.example ← durand-bakery-example ${trackers} ×50 \\(read, cap 50\\) \\(asked 100\\): Her bakery's analytics account`))
  assert.equal(json(dir, '.osint/views/identifiers.json').find(x => x.value === 'durand-bakery.example').belongs, '98 %')
  assert.match(read(dir, 'Profile.md'), /## Identity\n\n- durand-bakery\.example ← \[durand-bakery-example\]\(obsidian:\/\/open\?vault=durand-bakery-example&file=Clues%2FC\d\d%20Trackers/)
  await lr('durand-bakery.example', '--case', 'durand-bakery-example', '--clue', trackers, '--lr', '0.5', '--why', 'Another shop uses the same account')
  assert.equal(json(dir, '.osint/case.json').state.person.cells.length, 1)
  assert.equal(json(dir, '.osint/views/identifiers.json').find(x => x.value === 'durand-bakery.example').belongs, '33 %')
  assert.match((await lr('nobody.example', '--case', 'durand-bakery-example', '--clue', trackers, '--lr', '2', '--why', 'x')).err, /no identifier « nobody\.example » in the profile/)
  assert.match((await lr('durand-bakery.example', '--case', 'elsewhere', '--clue', trackers, '--lr', '2', '--why', 'x')).err, /--case <a linked case: durand-bakery-example>/)
  assert.match((await lr('durand-bakery.example', '--case', 'durand-bakery-example', '--clue', 'C99', '--lr', '2', '--why', 'x')).err, /no clue C99 in durand-bakery-example/)
  assert.match((await lr('durand-bakery.example', '--case', 'durand-bakery-example', '--clue', trackers, '--lr', '0', '--why', 'x')).err, /--lr <a positive number/)
  assert.match((await lr('durand-bakery.example', '--case', 'durand-bakery-example', '--clue', trackers, '--lr', '2')).err, /--why/)
  const union = await lr('durand-bakery.example', '--case', 'durand-bakery-example', '--clue', trackers, '--lr', '2', '--why', 'elle est syndiquée')
  assert.equal(union.status, 1)
  assert.match(union.err, /refused: trade-union membership data/)
})
