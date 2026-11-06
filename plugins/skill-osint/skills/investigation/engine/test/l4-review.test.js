// Review L4 (stages 10 to 13): what a received folder may not make this machine run, and the guards' bypasses
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pursuitHit, sensitiveHit } from '../lib/sensitive.js'
import { identify, planItems } from '../../types/person/engine.js'
import { parseMetadata } from '../lib/phones.js'
import { engineProblems } from '../lib/types.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, FIXTURES, json, run } from './helpers.js'

const fake = await startFake({ fixtures: FIXTURES })
test.after(() => fake.close())
const T0 = '2026-11-03T06:00:00.000Z', at = h => new Date(Date.parse(T0) + h * 3600e3).toISOString()
const env = (h = 0) => ({ ...fakeEnv(fake.url, FIXTURES), OSINT_NOW: at(h) })
const SHOP = path.join(FIXTURES, 'osint-types', 'shop-audit')
// a private type whose engine.js leaves a witness in the case's state when it runs
const WITNESS = "export const commands = { collect: { run: ctx => { ctx.state({ ran: true }) } } }\n"
function evil(home, id = 'evil') {
  const dir = path.join(home, '.osint-types', id)
  fs.cpSync(SHOP, dir, { recursive: true })
  const f = path.join(dir, 'type.json'), m = JSON.parse(fs.readFileSync(f, 'utf8'))
  fs.writeFileSync(f, JSON.stringify({ ...m, id, refresh: [{ id: 'checks', by: 'engine', run: 'collect', noisy: false, sends_image: false, paid: false, watch: true, noun: ['check', 'checks'] }] }, null, 2))
  fs.writeFileSync(path.join(dir, 'engine.js'), WITNESS)
  return dir
}
const forge = (home, slug, h) => {
  const f = path.join(home, slug, '.osint', 'case.json'), c = JSON.parse(fs.readFileSync(f, 'utf8'))
  c.watch = { every: '6h', last: null, next: at(0), error: null, ...h }
  fs.writeFileSync(f, JSON.stringify(c))
}

test('1. a watch and its « private_ok » forged in a received folder run nothing: the user\'s yes lives on this machine', async () => {
  const home = casesFolder(), d = evil(home)
  assert.equal((await run(home, ['new', 'evil', 'shop.example', '--title', 'Shop', '--question', 'Q?', '--frame', 'noisy=never'], env())).status, 0)
  // the hash anyone can compute from the folder (what 1.40 kept in case.json)
  const { createHash } = await import('node:crypto'), h = createHash('sha256')
  for (const f of ['type.json', 'engine.js']) { h.update(`${f}\0`); h.update(fs.readFileSync(path.join(d, f))) }
  forge(home, 'shop', { private_ok: h.digest('hex') })
  const r = await run(home, ['watch', '--due', '--json'], env(1))
  assert.equal(r.status, 0, r.err)
  assert.equal(JSON.parse(r.out).passes.length, 0)
  assert.equal(json(home, 'shop/.osint/case.json').state?.evil?.ran, undefined, 'the forged engine ran')
})

test('1. a watch forged on a plugin type does not run either (passive requests to targets someone else chose)', async () => {
  const home = casesFolder()
  assert.equal((await run(home, ['new', 'domain', 'durand-bakery.example', '--question', 'Q?', '--frame', 'noisy=never'], env())).status, 0)
  forge(home, 'durand-bakery-example', {})
  const seen = fake.seen.length
  const r = await run(home, ['watch', '--due', '--json'], env(1))
  assert.equal(JSON.parse(r.out).passes.length, 0)
  assert.equal(fake.seen.length, seen)
  // set here by the user, it runs
  assert.equal((await run(home, ['watch', '-p', 'durand-bakery-example', '--every', '6h'], env(0))).status, 0)
  assert.equal(JSON.parse((await run(home, ['watch', '--due', '--json'], env(7))).out).passes.length, 1)
})

test('2. a private child of a watched person case runs nothing without the user\'s yes on this machine', async () => {
  const home = casesFolder()
  const w = await run(home, ['new', 'person', 'Jeanne Durand', '--in', 'identifiers=site: durand-bakery.example', '--question', 'Are these hers?', '--frame', 'purpose=Check the manager before a supply contract',
    '--frame', 'legal_basis=Legitimate interest — checking a contracting party', '--frame', 'noisy=ask'], env())
  assert.equal(w.status, 0, w.err)
  evil(home)
  assert.equal((await run(home, ['new', 'evil', 'shop.example', '--title', 'Shop', '--question', 'Q?', '--frame', 'noisy=never', '--parent', 'jeanne-durand'], env())).status, 0, 'child')
  assert.equal((await run(home, ['watch', '-p', 'jeanne-durand', '--every', '6h'], env(0))).status, 0)
  const r = await run(home, ['watch', '--due', '--json'], env(7))
  assert.equal(r.status, 0, r.err)
  assert.equal(json(home, 'shop/.osint/case.json').state?.evil?.ran, undefined, 'the private child ran in the watch')
  const j = fs.readFileSync(path.join(home, 'shop', 'Journal.md'), 'utf8')
  assert.match(j, /watch pass checks: .*never given the user's yes/)
  // the dashboard's Refresh is no yes either
  const d = await run(home, ['refresh', '-p', 'jeanne-durand', '--children'], { ...env(8), OSINT_BY: 'dashboard' })
  assert.equal(json(home, 'shop/.osint/case.json').state?.evil?.ran, undefined, d.err)
})

test('3. the lexical guard holds against the bypasses the review found', () => {
  const bad = {
    getBuiltinModule: "const cp = process.getBuiltinModule('node:child_process')",
    'comment before import': "/**/import cp from 'node:child_process'",
    'comment in import()': "const m = import/**/('node:child_process')",
    'constructor.constructor': "const f = [].constructor.constructor('return 1')",
    'global.fetch': "global.fetch('https://x.example')",
    'fetch/**/(': "fetch/**/('https://x.example')",
    'indirect eval': "(0, eval)('1')",
    'line comment': "// hi\nimport cp from 'node:child_process'",
  }
  for (const [what, src] of Object.entries(bad)) assert.ok(engineProblems(src).length, `not refused: ${what}`)
  // a string or a comment that only mentions them is not a breach
  assert.deepEqual(engineProblems("// uses fetch( nowhere\nconst s = 'a /* b */ c'\nexport const commands = {}"), [])
  assert.deepEqual(engineProblems("import path from 'node:path'\nconst u = 'https://x.example/a//b'\nexport const commands = {}"), [])
})

const cat = (text, opts = {}) => sensitiveHit({ text, ...opts })?.category ?? null

test('5. the fold holds against soft hyphens, no-break spaces, line breaks, zero-width spaces and full-width letters; short one-line synonyms are found', () => {
  for (const [t, want] of [['il est syndi\u00ADqué', 'union'], ['il est\u00A0syndiqué', 'union'], ['trade\nunion member', 'union'], ['syn\u200Bdiqué', 'union'],
    ['ｓｙｎｄｉｑｕé', 'union'], ['elle est en\u00ADceinte', 'health'], ['a cancer survivor', 'health'], ['il est diabétique', 'health'], ['l\'église du village, il y va chaque dimanche', 'religion'],
    ['elle porte le voile', 'religion'], ['he\'s gay', 'sex'], ['il est homo', 'sex'], ['an imam', 'religion'], ['il vote RN', 'politics']])
    assert.equal(cat(t), want, t)
})

test('6. everyday names and phrases are not blocked; an organization\'s own name is not read', () => {
  for (const t of ['Diagnostic immobilier SARL', 'une enceinte Bluetooth', 'European Union member state', 'voted for the board resolution', 'Santé SAS', 'Bernard Dating', 'club de voile'])
    assert.equal(cat(t), null, t)
  for (const n of ['Institut Catholique de Paris', 'Handicap International', 'Militant Records', 'Genetic Gardens Ltd'])
    assert.equal(cat(`${n} (siège)`, { ignore: [n] }), null, n)
  // the name is stripped at word limits only: it never hides a word it merely sits inside
  assert.equal(cat('Santé is gay', { ignore: ['Sant'] }), 'sex')
  assert.equal(cat('syndiqués', { ignore: ['syndi'] }), 'union')
  assert.equal(cat('Elle est enceinte', {}), 'health')
  assert.equal(cat('diagnosed with cancer'), 'health')
  assert.equal(cat('diagnostiqué avec un lupus'), 'health')
})

test('7. pursuit: a former partner, where she lives, an address to find, watching a neighbour', () => {
  for (const t of ['retrouver mon ancienne compagne', 'où habite-t-elle', 'trouver l\'adresse de Julie', 'surveiller ma voisine', 'espionner son compte', 'géolocaliser Paul', 'son domicile', 'her whereabouts', 'mon ancien copain'])
    assert.ok(pursuitHit(t), t)
  for (const t of ['Vérifier la gérante avant un contrat', 'who runs the bakery', 'retrouver le fournisseur'])
    assert.equal(pursuitHit(t), null, t)
})

// ── 4. the writes of a person case that the article 9 guard did not cover ──
const PERSON = ['new', 'person', 'Jeanne Durand', '--in', 'identifiers=site: durand-bakery.example', '--question', 'Are these hers?', '--frame', 'purpose=Check the manager before a supply contract',
  '--frame', 'legal_basis=Legitimate interest — checking a contracting party', '--frame', 'noisy=ask']
const tmp = (name, v) => { const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'osint-l4-')), name); fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v)); return f }
const everything = home => fs.readdirSync(home, { recursive: true, withFileTypes: true }).filter(d => d.isFile() && !/\.(png|jpg)$/.test(d.name)).map(d => path.join(d.parentPath, d.name))
const written = (home, re) => everything(home).some(f => re.test(f) || (/\.(md|json|jsonl|canvas)$/.test(f) && re.test(fs.readFileSync(f, 'utf8'))))

test('4. a person case withholds article 9 text from a source title, an evidence name, a relation, an exclusion, a red team, a conclusion, leads and the plan\'s drops', async () => {
  const home = casesFolder(), P = ['-p', 'jeanne-durand']
  assert.equal((await run(home, PERSON, env())).status, 0)
  const refused = async (argv, what) => { const r = await run(home, argv, env()); assert.notEqual(r.status, 0, `${what} was accepted: ${r.out}`); assert.match(r.err, /GDPR article 9/, what) }
  await refused(['source', ...P, '--file', tmp('page.html', '<html><title>Jeanne Durand est syndiquée à la CGT</title></html>')], 'source')
  await refused(['evidence', ...P, tmp('religion-catholique.txt', 'x')], 'evidence')
  await refused(['next', ...P, '--file', tmp('l.json', [{ label: 'Vérifier sa religion et son orientation sexuelle — elle est enceinte ?', why: 'x' }])], 'next')
  await refused(['redteam', ...P, '--file', tmp('r.json', { target: 'H01', outcome: 'survives', refutations: [{ test: 'syndiquée ?', result: 'oui' }] })], 'redteam')
  assert.ok(!written(home, /CGT|syndiqu|catholique|enceinte|religion et/i), 'refused text reached the vault')
  // the plan: a dropped line that names a category is kept without it
  const plan = await run(home, ['person', 'plan', ...P, '--file', tmp('plan.json', [{ line: 'site: durand-bakery.example', why: 'The shop site' }, { line: 'x', drop: 'she is pregnant' }])], env())
  assert.equal(plan.status, 0, plan.err)
  assert.ok(!written(home, /pregnant/), 'the drop reason reached the vault')
})

test('4. a type\'s ctx holds a source title, a log line and a block that name article 9 data: the Journal says the category, never the text', async () => {
  const home = casesFolder()
  assert.equal((await run(home, PERSON, env())).status, 0)
  const { makeCtx, getType } = await import('../lib/types.js')
  const ctx = makeCtx(home, 'jeanne-durand', getType('person', home))
  const s = await ctx.source({ file: tmp('p.html', '<title>Elle est syndiquée</title>'), archive: 'none' })
  assert.match(s.path, /^Sources\/S01 \(withheld\)\.md$/)
  ctx.log('she is pregnant')
  ctx.block('Profile.md', 'profile', 'il est syndiqué')
  assert.ok(!written(home, /syndiqu|pregnant/i))
  assert.match(fs.readFileSync(path.join(home, 'jeanne-durand', 'Journal.md'), 'utf8'), /withheld · a log line: health data \(GDPR article 9\)/)
})

test('7. new person refuses a street address among its identifiers and a subject who may be a minor (--from carrying born)', async () => {
  const home = casesFolder()
  const bad = await run(home, ['new', 'person', 'Jeanne Durand', '--in', 'identifiers=site: durand-bakery.example\n12 rue de la Paix, 69002 Lyon', '--question', 'Are these hers?', '--frame', 'purpose=Check the manager before a supply contract',
    '--frame', 'legal_basis=Legitimate interest — checking a contracting party', '--frame', 'noisy=ask'], env())
  assert.notEqual(bad.status, 0)
  assert.match(bad.err, /street address/)
  assert.ok(!written(home, /rue de la Paix/))
  assert.equal((await run(home, PERSON, env())).status, 0)
  // a parent case whose entity carries a birth month under 18: its child person case is refused
  fs.writeFileSync(path.join(home, 'jeanne-durand', 'Entities', 'kid.md'), '---\nkind: person\nvalue: Kid Durand\nborn: 2015-03\n---\n')
  const kid = await run(home, ['new', 'person', 'Kid Durand', '--in', 'identifiers=kidd', '--question', 'Q?', '--parent', 'jeanne-durand', '--from', 'Entities/kid.md', '--frame', 'purpose=Check', '--frame', 'legal_basis=x'], env())
  assert.notEqual(kid.status, 0)
  assert.match(kid.err, /minor/)
})

const meta = parseMetadata(fs.readFileSync(path.join(FIXTURES, 'raw', 'google', 'libphonenumber', 'master', 'resources', 'PhoneNumberMetadata.xml'), 'utf8'))
test('8. one French number, written 06… or +33 6…, is one identifier (even where ARCEP puts 0639 in Mayotte); no country is guessed', () => {
  const lines = ['06 39 98 12 34', '+33 6 39 98 12 34', '+262 639 98 12 34']
  const ok = planItems(lines, lines.map(line => ({ line, why: 'the contract number' })), { meta, region: 'FR' })
  assert.deepEqual(ok.errors, [])
  assert.equal(ok.items.length, 1, ok.items.map(i => i.value).join(' | '))
  assert.match(ok.items[0].key, /^phone:fr:0639981234$/)
  assert.equal(planItems(['0612345678', '+33 6 12 34 56 78'], [{ line: '0612345678', why: 'x' }, { line: '+33 6 12 34 56 78', why: 'x' }], { meta, region: 'FR' }).items.length, 1)
  // without a language or a country, a number without its country code is refused, whatever the region the engine would have chosen
  const uk = identify('07700 900123', { meta })
  assert.match(uk.error, /country code/)
  assert.equal(identify('07700 900123', { meta, region: 'GB' }).value, '+447700900123')
  // in French (region FR) an invalid national number is refused too
  assert.match(identify('phone: 06 12', { meta, region: 'FR' }).error, /not a possible number|not a phone/)
})

test('9. what a child only found is a candidate, out of the profile, until a likelihood ratio above 1 is recorded; a mail provider is no candidate', async () => {
  const { profileRows } = await import('../../types/person/engine.js')
  const subject = { name: 'Jeanne Durand', born: null }
  const E = (kind, value, props = {}) => ({ path: `Entities/${value}.md`, kind, value, props })
  const linked = [
    { slug: 'gmail', rel: 'child', type: 'email', status: 'done', entities: [E('email', 'jeanne@gmail.com', { role: 'subject' }), E('domain', 'gmail.com', { role: 'email domain', mail_provider: 'Google' }), E('account', 'https://x.example/jd', {}), E('username', 'jd', {}), E('username', 'jeanne', { role: 'local part of an address' })] },
    { slug: 'site', rel: 'child', type: 'domain', status: 'done', entities: [E('domain', 'shop.example', { role: 'subject' }), E('email', 'colleague@shop.example', {})] },
  ]
  const planned = [{ key: 'email:jeanne@gmail.com', kind: 'email', value: 'jeanne@gmail.com', type: 'email', why: 'x', path: 'Entities/jeanne@gmail.com.md' }]
  const rows = profileRows({ subject, planned, linked, cells: [] })
  assert.deepEqual(rows.filter(r => r.candidate).map(r => r.value).sort(), ['colleague@shop.example', 'https://x.example/jd', 'jd'])
  assert.ok(!rows.some(r => r.value === 'gmail.com'), 'the mail provider is a candidate')
  assert.ok(rows.filter(r => !r.candidate).every(r => ['jeanne@gmail.com', 'shop.example'].includes(r.value)))
  // a ratio above 1 promotes it; below 1 does not
  const cell = (key, lr) => ({ key, lr, clue: 'C01', status: 'read' })
  assert.ok(!profileRows({ subject, planned, linked, cells: [cell('email:colleague@shop.example', 5)] }).find(r => r.value === 'colleague@shop.example').candidate)
  assert.ok(profileRows({ subject, planned, linked, cells: [cell('email:colleague@shop.example', 0.5)] }).find(r => r.value === 'colleague@shop.example').candidate)
})

test('10. a watch that finds nothing new accumulates nothing: no snapshot file, at most one Journal line, Case.md untouched', async () => {
  const home = casesFolder(), dir = path.join(home, 'durand-bakery-example')
  assert.equal((await run(home, ['new', 'domain', 'durand-bakery.example', '--question', 'Q?', '--frame', 'noisy=never'], env())).status, 0)
  assert.equal((await run(home, ['watch', '-p', 'durand-bakery-example', '--every', '6h'], env(0))).status, 0)
  const state = () => ({
    files: fs.readdirSync(path.join(dir, '.osint', 'collect'), { recursive: true }).filter(f => f.endsWith('.json')).length,
    journal: fs.readFileSync(path.join(dir, 'Journal.md'), 'utf8').split('\n').filter(l => l.startsWith('- ')).length,
    note: fs.readFileSync(path.join(dir, 'Case.md'), 'utf8'),
    refreshes: json(dir, '.osint/case.json').refreshes.length,
  })
  for (const h of [7, 14]) assert.equal((await run(home, ['watch', '--due', '--json'], env(h))).status, 0)
  const a = state()
  for (const h of [21, 28]) assert.equal((await run(home, ['watch', '--due', '--json'], env(h))).status, 0)
  const b = state()
  assert.equal(b.files, a.files, 'a snapshot file per pass')
  assert.ok(b.journal - a.journal <= 1, `${b.journal - a.journal} Journal lines for 2 empty passes`)
  assert.equal(b.note, a.note, 'Case.md rewritten')
  assert.equal(b.refreshes, a.refreshes, 'case.json grows a pass entry per pass')
})

test('13. export --journal with a value is refused, not ignored', async () => {
  const home = casesFolder()
  assert.equal((await run(home, ['new', 'domain', 'durand-bakery.example', '--question', 'Q?', '--frame', 'noisy=never'], env())).status, 0)
  const r = await run(home, ['export', '-p', 'durand-bakery-example', '--journal', 'foo'], env())
  assert.equal(r.status, 1)
  assert.match(r.err, /--journal takes no value/)
})
