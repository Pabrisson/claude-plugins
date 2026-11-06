import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { identify, planItems, splitLines } from '../../types/person/engine.js'
import { checkFrame, personRoot } from '../lib/case.js'
import { parseMetadata } from '../lib/phones.js'
import { pivotsFor } from '../lib/prompt.js'
import { loadTypes } from '../lib/types.js'
import { readNote } from '../lib/vault.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, FIXTURES, json, NEW, read, run } from './helpers.js'

const meta = parseMetadata(fs.readFileSync(path.join(FIXTURES, 'raw', 'google', 'libphonenumber', 'master', 'resources', 'PhoneNumberMetadata.xml'), 'utf8'))
const fake = await startFake()
test.after(() => fake.close())
const env = fakeEnv(fake.url)
const file = v => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'osint-plan-')), 'plan.json'); fs.writeFileSync(f, JSON.stringify(v)); return f }
const LINES = 'pseudo: durand.bakery\r\nJeanne@Durand-Bakery.example\n+33 6 39 98 12 34\nemployer: Boulangerie Durand\nville: Exempleville'
const NEWP = (lines = LINES, ...more) => ['new', 'person', 'Jeanne Durand', '--in', `identifiers=${lines}`, '--question', 'Are these identifiers Jeanne Durand\'s?',
  '--frame', 'purpose=Check the manager before a supply contract', '--frame', 'legal_basis=Legitimate interest — checking a contracting party', '--frame', 'noisy=never', ...more]
const WHY = [
  { line: 'pseudo: durand.bakery', why: 'The shop account she says she runs' },
  { line: 'Jeanne@Durand-Bakery.example', why: 'The address given for the contract' },
  { line: '+33 6 39 98 12 34', why: 'The number given for the contract' },
  { line: 'employer: Boulangerie Durand', why: 'The company she would sign for' },
  { line: 'ville: Exempleville', why: 'The town of the head office' },
]
const P = ['-p', 'jeanne-durand']
const ent = (dir, value) => readNote(path.join(dir, 'Entities', `${value}.md`)).props

test('identify: each kind of line, with or without its label, and what it refuses', () => {
  const v = l => { const r = identify(l, { meta, region: 'FR' }); return r.error ? `error: ${r.error}` : [r.as, r.kind, r.value, r.type, r.props.siren ?? ''].join(' ').trim() }
  assert.deepEqual(Object.fromEntries([
    'pseudo: durand.bakery', '@Durand.Bakery', 'jdurand61', 'Jeanne@Durand-Bakery.example', 'courriel : jeanne@durand-bakery.example',
    '06 39 98 12 34', '+33 6 39 98 12 34', 'Tél. : 06 39 98 12 34', 'employer: Boulangerie Durand', 'SIRET 456 789 122 00011', '456 789 122',
    'ville: Exempleville', 'https://www.instagram.com/durand.bakery/', 'https://durand-bakery.example/contact', 'durand-bakery.example', 'site: durand.bakery',
  ].map(l => [l, v(l)])), {
    'pseudo: durand.bakery': 'username username durand.bakery username',
    '@Durand.Bakery': 'username username durand.bakery username',
    'jdurand61': 'username username jdurand61 username',
    'Jeanne@Durand-Bakery.example': 'email email jeanne@durand-bakery.example email',
    // ARCEP gives 06 39 to Mayotte: a number written nationally in that block is +262 (stage 7's parsePhone), so the other fixtures write the fiction number with +33
    'courriel : jeanne@durand-bakery.example': 'email email jeanne@durand-bakery.example email',
    '06 39 98 12 34': 'phone phone +262639981234 phone',
    '+33 6 39 98 12 34': 'phone phone +33639981234 phone',
    'Tél. : 06 39 98 12 34': 'phone phone +262639981234 phone',
    'employer: Boulangerie Durand': 'employer organization Boulangerie Durand company-fr',
    'SIRET 456 789 122 00011': 'employer organization SIREN 456 789 122 company-fr 456789122',
    '456 789 122': 'employer organization SIREN 456 789 122 company-fr 456789122',
    'ville: Exempleville': 'city place Exempleville',
    'https://www.instagram.com/durand.bakery/': 'account account https://www.instagram.com/durand.bakery username',
    'https://durand-bakery.example/contact': 'domain domain durand-bakery.example domain',
    'durand-bakery.example': 'domain domain durand-bakery.example domain',
    'site: durand.bakery': 'domain domain durand.bakery domain',
  })
  assert.match(v('Exempleville'), /error: not recognised: write it « <what>: <value> »/)
  assert.match(v('12 rue des Lilas, Exempleville'), /error: a street address/)
  assert.match(v('ville: 12 bis avenue Foch'), /error: a street address/)
  assert.match(v('employer: 123 456 789'), /error: a SIREN or SIRET whose check digit is wrong/)
  assert.match(v('phone: 12'), /error: not a phone number/)
  assert.match(v('username: a b'), /error: a username has no space nor slash/)
  // without libphonenumber's metadata (offline), a number is kept as written, digits and +
  assert.equal(identify('06 39 98 12 34').value, '0639981234')
  assert.equal(identify('Exempleville', { as: 'city' }).kind, 'place')
})

test('planItems: a reason for each line, or a drop; nothing passes while one problem is left', () => {
  const lines = splitLines('pseudo: durand.bakery\r\nJeanne@Durand-Bakery.example\npseudo: durand.bakery\n\n06 39 98 12 34\nExempleville\n')
  assert.deepEqual(lines, ['pseudo: durand.bakery', 'Jeanne@Durand-Bakery.example', '06 39 98 12 34', 'Exempleville'])
  const ok = planItems(lines, [
    { line: 'pseudo: durand.bakery', why: 'the shop account' }, { line: 'Jeanne@Durand-Bakery.example', why: 'the contract address' },
    { line: '06 39 98 12 34', drop: 'the purpose needs no phone' }, { line: 'Exempleville', why: 'the head office town', as: 'city' },
    { line: '@durand.bakery', why: 'the same account, written again' }, { line: 'site: durand-bakery.example', why: 'the shop site, added' },
  ], { meta })
  assert.deepEqual(ok.errors, [])
  assert.deepEqual(ok.items.map(i => [i.key, i.why]), [
    ['username:durand.bakery', 'the shop account'], ['email:jeanne@durand-bakery.example', 'the contract address'],
    ['place:coarse:exempleville', 'the head office town'], ['domain:durand-bakery.example', 'the shop site, added'],
  ])
  assert.deepEqual(ok.dropped, [{ line: '06 39 98 12 34', reason: 'the purpose needs no phone' }])
  const bad = planItems(lines, [
    { line: 'pseudo: durand.bakery', why: '' }, { line: 'Jeanne@Durand-Bakery.example', why: 'to learn her religion' },
    { line: '06 39 98 12 34', why: 'x', as: 'fax' },
  ], { meta })
  assert.equal(bad.items.length, 0)
  assert.deepEqual(bad.errors.map(e => e.split(':')[0]), ['« pseudo', '« Jeanne@Durand-Bakery.example »', '« 06 39 98 12 34 »', '« Exempleville »'])
  assert.match(bad.errors.join('\n'), /why does the purpose need it[\s\S]*religion or belief data \(GDPR article 9\)[\s\S]*"as" is one of[\s\S]*Exempleville »: why does/)
  assert.match(planItems(lines, { not: 'a list' }).errors[0], /plan\.json: a list of/)
  // the subject's own name is not a reason to refuse
  assert.deepEqual(planItems(['pseudo: pierre.gay'], [{ line: 'pseudo: pierre.gay', why: 'Pierre Gay\'s shop account' }], { ignore: ['Pierre Gay'] }).errors, [])
})

test('the frame of a person case: the purpose and the legal basis are required, the subject followed or sensitive data refused', async () => {
  const m = { frame: [{ id: 'person', always: true, purpose: true }, 'noisy'] }
  assert.throws(() => checkFrame(m, { legal_basis: 'Consent', noisy: 'never' }, 'Q?'), /a person case needs --frame purpose=/)
  assert.equal(checkFrame(m, { legal_basis: 'Consent', noisy: 'never', purpose: 'p' }, 'Q?').purpose, 'p')
  const home = casesFolder()
  const without = (k) => NEWP().filter((a, i, all) => !(a.startsWith(`${k}=`) || all[i + 1]?.startsWith(`${k}=`)))
  assert.match((await run(home, without('purpose'), env)).err, /a person case needs --frame purpose=/)
  assert.match((await run(home, without('legal_basis'), env)).err, /legal_basis/)
  const religion = await run(home, ['new', 'person', 'Jeanne Durand', '--in', 'identifiers=pseudo: durand.bakery', '--question', 'Quelle est sa religion ?',
    '--frame', 'purpose=x', '--frame', 'legal_basis=Consent', '--frame', 'noisy=never'], env)
  assert.equal(religion.status, 1)
  assert.match(religion.err, /refused: religion or belief data \(GDPR article 9\) is never looked for in a person case nor in its children/)
  const ex = await run(home, ['new', 'person', 'Julie Martin', '--in', 'identifiers=pseudo: julie.m', '--question', 'Trouve où habite mon ex',
    '--frame', 'purpose=la revoir', '--frame', 'legal_basis=Consent', '--frame', 'noisy=never'], env)
  assert.equal(ex.status, 1)
  assert.match(ex.err, /refused: « (mon ex|ou habite|ou elle habite) » — a person case never helps to find, contact or follow a private person/)
  assert.deepEqual(fs.readdirSync(home).filter(n => !n.startsWith('.')), [])
})

test('a child of a person case inherits its frame, purpose included, and its guard; personRoot finds the person above', async () => {
  const home = casesFolder()
  assert.equal((await run(home, NEWP(), env)).status, 0)
  const kid = await run(home, ['new', 'domain', 'durand-bakery.example', '--question', 'Is the site hers?', '--parent', 'jeanne-durand', '--from', 'Entities/durand-bakery.example.md'], env)
  assert.equal(kid.status, 0, kid.err)
  const c = readNote(path.join(home, 'durand-bakery-example', 'Case.md')).props
  assert.deepEqual([c.person, c.legal_basis, c.noisy, c.purpose], [true, 'Legitimate interest — checking a contracting party', 'never', 'Check the manager before a supply contract'])
  assert.equal(personRoot(path.join(home, 'durand-bakery-example')).slug, 'jeanne-durand')
  assert.deepEqual(personRoot(path.join(home, 'jeanne-durand')), { slug: 'jeanne-durand', name: 'Jeanne Durand' })
  const health = await run(home, ['new', 'domain', 'other.example', '--question', 'Est-elle enceinte ?', '--parent', 'jeanne-durand'], env)
  assert.match(health.err, /refused: health data/)
  await run(home, NEW, env)
  assert.equal(personRoot(path.join(home, 'durand-bakery-example-2')), null)
})

test('plan: each identifier an entity with its reason, the subject with the birth month of the entity it came from, one proposal each', async () => {
  const home = casesFolder(), dir = path.join(home, 'jeanne-durand')
  // the parent: a domain case whose subject is the shop's site, and Jeanne Durand read there, born 1961-04
  await run(home, NEW, env)
  await run(home, ['domain', 'collect', '--only', 'rdap', '-p', 'durand-bakery-example'], env)
  await run(home, ['entity', 'person', 'Jeanne Durand', '--prop', 'born=1961-04', '--prop', 'role=publication director', '-p', 'durand-bakery-example'], env)
  assert.equal((await run(home, NEWP(`${LINES}\nsite: durand-bakery.example`, '--parent', 'durand-bakery-example', '--from', 'Entities/Jeanne Durand.md'), env)).status, 0)
  const r = await run(home, ['person', 'plan', '--file', file([...WHY, { line: 'site: durand-bakery.example', why: 'The shop site' }]), ...P], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(r.out.trim().split('\n'), [
    '[pivot:username] durand.bakery — from Entities/durand.bakery.md',
    '[pivot:email] jeanne@durand-bakery.example — from Entities/jeanne@durand-bakery.example.md',
    '[pivot:phone] +33639981234 — from Entities/+33639981234.md',
    '[pivot:company-fr] Boulangerie Durand — from Entities/Boulangerie Durand.md',
    'Exempleville: kept as an identifier — a town alone opens no case (place needs an address or coordinates)',
    'durand-bakery.example: already in durand-bakery-example (parent)',
    r.out.trim().split('\n').at(-1),
  ])
  assert.match(r.out, /^plan: 6 identifiers, 0 dropped · \^j\d{3}$/m)
  assert.deepEqual([ent(dir, 'Jeanne Durand').role, ent(dir, 'Jeanne Durand').born], ['subject', '1961-04'])
  assert.deepEqual([ent(dir, '+33639981234').kind, ent(dir, '+33639981234').why, ent(dir, '+33639981234').case_type], ['phone', 'The number given for the contract', 'phone'])
  assert.equal(ent(dir, 'Boulangerie Durand').kind, 'organization')
  const c = json(dir, '.osint/case.json')
  assert.deepEqual(c.state.person.identifiers.map(i => i.type), ['username', 'email', 'phone', 'company-fr', null, 'domain'])
  assert.equal(c.relations.filter(x => x.label === 'identifier' && x.from === 'Entities/Jeanne Durand.md').length, 6)
  // the subject is the same person as in the parent: one shared entity
  const shared = JSON.parse((await run(home, ['brain', 'entities', '--all', '--shared', '--json'], env)).out)
  assert.ok(shared.some(e => e.key === 'person:jeanne durand 1961-04' && e.cases.length === 2))
  // Next actions: each identifier pivots to its type; an employer by name has the person type's own action
  const types = loadTypes(), on = (value, props = {}) => pivotsFor({ kind: ent(dir, value).kind, value, path: `Entities/${value}.md`, props }, types).map(p => p.type)
  assert.ok(on('durand.bakery').includes('username') && on('+33639981234').includes('phone'))
  assert.ok(!on('Exempleville', { coarse: true }).includes('place')) // a town: no coordinates, no place case
  assert.ok(on('Jeanne Durand').includes('person'))
  assert.ok(!on('Boulangerie Durand').includes('company-fr'))
  assert.ok(types.find(t => t.id === 'person').actions.some(a => a.target === 'entity:organization' && a.prompt.startsWith('[pivot:company-fr]')))
})

test('plan refuses, writing nothing: no file, a line without its reason, a minor, a reason that targets sensitive data', async () => {
  const home = casesFolder(), dir = path.join(home, 'jeanne-durand')
  await run(home, NEWP(), env)
  assert.match((await run(home, ['person', 'plan', ...P], env)).err, /person plan --file plan\.json/)
  const missing = await run(home, ['person', 'plan', '--file', file(WHY.slice(1)), ...P], env)
  assert.equal(missing.status, 1)
  assert.match(missing.err, /the plan is refused, nothing was written:\n- « pseudo: durand\.bakery »: why does the purpose need it\?/)
  assert.deepEqual(fs.readdirSync(path.join(dir, 'Entities')), [])
  // a subject who may be a minor, by the birth month of the entity the case came from
  await run(home, NEW, env)
  await run(home, ['entity', 'person', 'Léa Exemple', '--prop', 'born=2010-05', '-p', 'durand-bakery-example'], env)
  // (the case is refused as it is made: its --from entity carries the birth month)
  const minor = await run(home, ['new', 'person', 'Léa Exemple', '--in', 'identifiers=pseudo: lea.example', '--question', 'Q?', '--frame', 'purpose=p', '--frame', 'legal_basis=Consent', '--frame', 'noisy=never',
    '--parent', 'durand-bakery-example', '--from', 'Entities/Léa Exemple.md'], env)
  assert.equal(minor.status, 1)
  assert.match(minor.err, /the subject may be a minor \(born 2010-05\)/)
})

test('offline, the plan still runs: phone numbers kept as written, the Journal says why', async () => {
  const home = casesFolder(), dir = path.join(home, 'jeanne-durand'), off = { ...env, OSINT_BASE_RAW: 'http://127.0.0.1:9/raw' }
  await run(home, NEWP(), off)
  const r = await run(home, ['person', 'plan', '--file', file(WHY), ...P], off)
  assert.equal(r.status, 0, r.err)
  assert.equal(ent(dir, '+33639981234').kind, 'phone')
  assert.match(read(dir, 'Journal.md'), /libphonenumber metadata unavailable \(.*\): phone numbers kept as written/)
})
