import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { blockOf, csv, FICTION, MAJNUM_HEAD, operatorOf, OPERATORS_HEAD, table } from '../../types/phone/engine.js'
import { normalize } from '../lib/kinds.js'
import { DENY, isMessaging } from '../lib/net.js'
import { loadEngine, loadTypes, validateEngine, validateManifest } from '../lib/types.js'
import { readNote } from '../lib/vault.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, events, FIXTURES, json, read, run } from './helpers.js'

const fake = await startFake()
test.after(() => fake.close())
const env = fakeEnv(fake.url)
const NEWP = (number, slug, ...more) => ['new', 'phone', number, '--question', 'Who holds this number?', '--frame', 'noisy=never', '--title', slug, ...more]
const ent = (dir, value) => readNote(path.join(dir, 'Entities', `${value}.md`)).props
const clueOf = (dir, fragment) => {
  // by the clue's text: its file name keeps only the first 60 characters
  const f = fs.readdirSync(path.join(dir, 'Clues')).find(n => readNote(path.join(dir, 'Clues', n)).body.includes(fragment))
  assert.ok(f, `no clue with « ${fragment} »`)
  return readNote(path.join(dir, 'Clues', f)).props
}
const latin1 = rel => fs.readFileSync(path.join(FIXTURES, rel), 'latin1')

test('the phone type is sound: its manifest, its method sections, one engine command; it starts from phone entities', async () => {
  const m = loadTypes().find(t => t.id === 'phone')
  assert.deepEqual(validateManifest(m), [])
  assert.deepEqual(await validateEngine(m), [])
  assert.deepEqual(Object.keys((await loadEngine(m)).commands), ['collect'])
  assert.deepEqual([m.pivots, m.levels.map(l => l.id), m.frame], [['phone'], ['owner', 'line'], ['noisy', 'person']])
  assert.deepEqual(m.refresh.map(s => s.by), ['agent'])
})

test('the ARCEP files: quotes and doubled quotes, a block by its prefix and length, the operator and its SIREN', () => {
  const nums = table(latin1('arcep/uploads/MAJNUM.csv'), MAJNUM_HEAD, 'MAJNUM.csv'), ops = table(latin1('arcep/uploads/identifiants_CE.csv'), OPERATORS_HEAD, 'identifiants_CE.csv')
  assert.deepEqual(blockOf(nums, '0140477000'), { prefix: '0140', code: 'FRTE', territory: 'Métropole', date: '2017-01-01' })
  assert.deepEqual(blockOf(nums, '0508411234'), { prefix: '050841', code: 'SPMT', territory: 'Saint Pierre et Miquelon', date: '2024-04-22' })
  // between 063997 and 063999: 06 39 98, a block kept for fiction
  assert.equal(blockOf(nums, '0639981234'), null)
  assert.ok(FICTION.includes('063998'))
  // one digit short: no range of that length
  assert.equal(blockOf(nums, '014047700'), null)
  assert.deepEqual(blockOf(nums, '3996'), { prefix: '3996', code: 'JAG', territory: 'National', date: '2023-04-27' })
  assert.deepEqual(operatorOf(ops, 'FRTE'), { name: 'Orange', code: 'FRTE', siren: '380129866', rcs: 'Paris', declared: '1998-03-12' })
  assert.equal(operatorOf(ops, 'SPMT').rcs, null)
  assert.equal(operatorOf(ops, 'NONE'), null)
  assert.match(csv(latin1('arcep/uploads/identifiants_CE.csv')).find(r => r[1] === 'MTAR')[4], /^IMMEUBLE "LES ARAVIS" 44 RUE/)
  assert.deepEqual(csv('\uFEFFa;"b;c";""\r\n\r\n1;2;3\n'), [['a', 'b;c', ''], ['1', '2', '3']])
  assert.throws(() => table('A;B\n1;2\n', MAJNUM_HEAD, 'MAJNUM.csv'), /MAJNUM\.csv changed its columns \(A;B\)/)
})

test('collect: the numbering plan, then the ARCEP block holder — an inferred clue, numbers being ported', async () => {
  const home = casesFolder(), dir = path.join(home, 'arcep')
  assert.equal((await run(home, NEWP('01 40 47 70 00', 'arcep'), env)).status, 0)
  const r = await run(home, ['phone', 'collect', '-p', 'arcep'], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(events(dir).filter(e => e.kind === 'fail'), [])
  assert.match(r.out, /^\+33140477000 · FR · fixed-line$/m)
  assert.match(r.out, /^ {2}"\+33 \(0\)1 40 47 70 00"$/m)
  const n = ent(dir, '+33140477000')
  assert.deepEqual([n.kind, n.country, n.line_type, n.valid, n.national, n.block, n.block_holder, n.territory], ['phone', 'FR', 'fixed-line', true, '01 40 47 70 00', '0140', 'Orange', 'Métropole'])
  assert.ok(n.writings.includes('+33 1 40 47 70 00') && n.writings.includes('0140477000'))
  assert.equal(normalize('phone', n.value), 'phone:fr:0140477000')
  const o = ent(dir, 'Orange')
  assert.deepEqual([o.kind, o.siren, o.arcep_code, o.role], ['organization', '380129866', 'FRTE', 'block holder'])
  assert.equal(clueOf(dir, '01 40 47 70 00: fixed line, France').status, 'read')
  assert.equal(clueOf(dir, 'Block 01 40 attributed by the ARCEP to Orange (FRTE) on 2017-01-01').status, 'inferred')
  assert.equal(clueOf(dir, 'Read in the numbering plan of France (FR)').status, 'inferred')
  assert.ok(json(dir, '.osint/case.json').relations.some(x => x.label === 'block attributed to'))
  assert.ok(json(dir, '.osint/views/timeline.json').some(i => i.label === 'Block attributed to Orange' && i.date === '2017-01-01'))
  assert.equal(json(dir, '.osint/views/writings.json')[0].writing, '01 40 47 70 00')
  assert.ok(!fake.seen.some(x => DENY.has(x.host) || isMessaging(`https://${x.host}${x.path}`)))
})

test('a block kept for fiction, a number outside the French plan, a country given, and what is no phone number', async () => {
  const home = casesFolder(), f = path.join(home, 'fiction')
  await run(home, NEWP('06 39 98 12 34', 'fiction'), env)
  assert.equal((await run(home, ['phone', 'collect', '-p', 'fiction'], env)).status, 0)
  const n = ent(f, '+262639981234')
  assert.deepEqual([n.valid, n.line_type, n.country, n.fiction], [false, 'unknown', 'RE', true])
  assert.equal(clueOf(f, 'Block kept by the ARCEP for works of fiction: 06 39 98 12 34 reaches nobody').status, 'read')
  assert.equal(clueOf(f, 'fits no range of the numbering plan of Réunion').status, 'read')
  assert.ok(!fs.readdirSync(path.join(f, 'Entities')).some(x => /block holder/.test(fs.readFileSync(path.join(f, 'Entities', x), 'utf8'))))
  const before = fake.seen.filter(x => x.service === 'arcep').length
  await run(home, NEWP('+1 201 555 0123', 'us'), env)
  assert.equal((await run(home, ['phone', 'collect', '-p', 'us'], env)).status, 0)
  assert.equal(fake.seen.filter(x => x.service === 'arcep').length, before)
  assert.match(read(path.join(home, 'us'), 'Journal.md'), /\+12015550123 is outside the French numbering plan: no ARCEP lookup/)
  assert.deepEqual([ent(path.join(home, 'us'), '+12015550123').country, ent(path.join(home, 'us'), '+12015550123').line_type], ['US', 'fixed-line-or-mobile'])
  await run(home, NEWP('020 7946 0123', 'london', '--in', 'country=GB'), env)
  assert.equal((await run(home, ['phone', 'collect', '-p', 'london'], env)).status, 0)
  assert.equal(clueOf(path.join(home, 'london'), 'Read in the numbering plan of United Kingdom (GB)').status, 'inferred')
  await run(home, NEWP('call me maybe', 'nope'), env)
  const bad = await run(home, ['phone', 'collect', '-p', 'nope'], env)
  assert.equal(bad.status, 1)
  assert.match(bad.err, /not a phone number/)
})

test('the ARCEP unreachable, or a file whose columns changed: the plan is still read, the ARCEP step is noted as failed', async () => {
  for (const [what, spoil] of [['unreachable', dir => fs.rmSync(path.join(dir, 'arcep'), { recursive: true })],
    ['columns changed', dir => fs.writeFileSync(path.join(dir, 'arcep', 'uploads', 'MAJNUM.csv'), 'A;B\n1;2\n')]]) {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-fx-'))
    fs.cpSync(FIXTURES, copy, { recursive: true })
    spoil(copy)
    const f2 = await startFake({ fixtures: copy }), env2 = fakeEnv(f2.url, copy)
    try {
      const home = casesFolder(), dir = path.join(home, 'arcep')
      await run(home, NEWP('01 40 47 70 00', 'arcep'), env2)
      const r = await run(home, ['phone', 'collect', '-p', 'arcep'], env2)
      assert.equal(r.status, 0, `${what}: ${r.err}`)
      const fails = events(dir).filter(e => e.kind === 'fail').map(e => e.text)
      assert.deepEqual(fails.map(t => t.split(':')[0]), ['arcep'], what)
      if (what === 'columns changed') assert.match(fails[0], /MAJNUM\.csv changed its columns/)
      assert.equal(ent(dir, '+33140477000').line_type, 'fixed-line', what)
      assert.ok(!fs.existsSync(path.join(dir, 'Entities', 'Orange.md')), what)
    } finally { f2.close() }
  }
})

test('doctor: the phone datasets, what each holds, once a case fetched them; the network check knows the ARCEP', async () => {
  const home = casesFolder(), line = (d, name) => d.lines.find(l => l.name === name)
  let d = JSON.parse((await run(home, ['doctor', '--json'], env)).out)
  for (const id of ['libphonenumber', 'arcep-majnum', 'arcep-operators']) {
    assert.equal(line(d, id).status, 'info', id)
    assert.match(line(d, id).text, /: not downloaded yet — the first phone case fetches it$/, id)
  }
  await run(home, NEWP('01 40 47 70 00', 'arcep'), env)
  await run(home, ['phone', 'collect', '-p', 'arcep'], env)
  d = JSON.parse((await run(home, ['doctor', '--json'], env)).out)
  assert.match(line(d, 'libphonenumber').text, /^libphonenumber metadata \(Apache-2\.0\): 254 territories, \d{4}-\d\d-\d\d \(\d+ KB\)$/)
  assert.match(line(d, 'arcep-majnum').text, /^ARCEP numbering register \(MAJNUM\): \d+ blocks, \d{4}-\d\d-\d\d \(\d+ KB\)$/)
  assert.match(line(d, 'arcep-operators').text, /^ARCEP operators \(identifiants CE\): \d+ operators, \d{4}-\d\d-\d\d \(\d+ KB\)$/)
  assert.equal(line(d, 'arcep-majnum').status, 'ok')
  assert.ok(d.types.find(t => t.id === 'phone').ready)
  assert.match((await run(home, ['doctor'], env)).out, /^ok {6}ARCEP operators \(identifiants CE\): \d+ operators, /m)
})

test('a hostile operator name in the ARCEP file reaches no note as markdown, a link, an image or a line break', async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-fx-'))
  fs.cpSync(FIXTURES, copy, { recursive: true })
  const f = path.join(copy, 'arcep', 'uploads', 'identifiants_CE.csv')
  fs.writeFileSync(f, fs.readFileSync(f, 'latin1').replace('Orange;FRTE', '"Evil [[Case]] <img src=x> ![a](http://evil.example/p.png) `x` %% osint:end clue %%";FRTE'), 'latin1')
  const f2 = await startFake({ fixtures: copy }), env2 = fakeEnv(f2.url, copy)
  try {
    const home = casesFolder(), dir = path.join(home, 'evil')
    await run(home, NEWP('01 40 47 70 00', 'evil'), env2)
    const r = await run(home, ['phone', 'collect', '-p', 'evil'], env2)
    assert.equal(r.status, 0, r.err)
    const notes = [...fs.readdirSync(path.join(dir, 'Clues')).map(n => path.join(dir, 'Clues', n)), ...fs.readdirSync(path.join(dir, 'Entities')).map(n => path.join(dir, 'Entities', n)), ...fs.readdirSync(path.join(dir, 'Sources')).map(n => path.join(dir, 'Sources', n))]
    for (const n of notes) {
      const t = fs.readFileSync(n, 'utf8')
      assert.doesNotMatch(t, /!\[a\]|<img/, n)
      assert.equal(t.match(/%% osint:begin /g)?.length ?? 0, t.match(/%% osint:end /g)?.length ?? 0, n)
      assert.ok(!/Evil[^\n]*%%/.test(t.replace(/\\%/g, '')), n)
    }
    assert.ok(fs.readdirSync(path.join(dir, 'Entities')).some(n => n.startsWith('Evil Case')))
  } finally { f2.close() }
})
