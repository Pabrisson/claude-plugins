import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { indexCase } from '../lib/brain.js'
import { hypLrMany } from '../lib/cycle.js'
import { getType } from '../lib/types.js'
import { readNote } from '../lib/vault.js'
import { casesFolder, events, json, NEW, read, run } from './helpers.js'

const P = ['-p', 'durand-bakery-example']
async function withClues() {
  const home = casesFolder(), dir = path.join(home, 'durand-bakery-example')
  await run(home, NEW)
  const cap = path.join(home, 'page.html'); fs.writeFileSync(cap, '<title>Mentions</title>RCS 456 789 122')
  await run(home, ['source', 'https://durand-bakery.example/mentions-legales', '--file', cap, '--reliability', 'B', ...P])
  await run(home, ['clue', 'SIREN 456 789 122 on the legal notice', '--status', 'read', '--sources', 'S01', '--title', 'SIREN on the legal notice', ...P])
  await run(home, ['clue', 'Same bakery style as the agency\'s other sites', '--status', 'observed', '--title', 'Agency style', ...P])
  const file = (name, v) => { const f = path.join(home, name); fs.writeFileSync(f, JSON.stringify(v)); return f }
  return { home, dir, file }
}

test('hyp add needs its refutation first; lr is clamped by the clue; the shares go to the notes and to Case.md', async () => {
  const { home, dir } = await withClues()
  assert.match((await run(home, ['hyp', 'add', 'Boulangerie Durand SARL runs it', '--level', 'owner', ...P])).err, /--refute-if/)
  assert.match((await run(home, ['hyp', 'add', 'X', '--level', 'planet', '--refute-if', 'x', ...P])).err, /owner, infrastructure/)
  assert.equal((await run(home, ['hyp', 'add', 'Boulangerie Durand SARL runs it', '--level', 'owner', '--refute-if', 'the RCS names another company', ...P])).status, 0)
  assert.equal((await run(home, ['hyp', 'add', 'A web agency runs it', '--level', 'owner', '--refute-if', 'the legal notice names the bakery as publisher', ...P])).status, 0)
  assert.equal((await run(home, ['hyp', 'lr', 'H01', '--clue', 'C02', '--lr', '40', '--why', 'style only', ...P])).status, 0)
  const a = json(dir, '.osint/analysis.json')
  assert.deepEqual(a.cells.map(c => [c.clue, c.hyp, c.lr, c.cap]), [['C02', 'H01', 5, 5]])
  assert.match(a.cells[0].journal, /^j\d{3}$/)
  const h1 = readNote(path.join(dir, 'Hypotheses', 'H01 Boulangerie Durand SARL runs it.md'))
  assert.deepEqual([h1.props.status, h1.props.level, h1.props.refute_if], ['active', 'owner', 'the RCS names another company'])
  assert.match(h1.body, /83 %/)
  assert.match(read(dir, 'Case.md'), /%% osint:begin hypotheses %%[\s\S]*\| \[\[H01 Boulangerie Durand SARL runs it\]\] \| owner \| active \| 83 % \|[\s\S]*\| \[\[C02 Agency style\]\] \| C ×5 \|/)
  assert.match(read(dir, 'Case.md'), /\| 17 % \|\n\n\| Clue \|/) // the matrix is a table of its own
  assert.ok(events(dir).some(e => e.kind === 'hyp.rank'))
  const ix = indexCase(home, 'durand-bakery-example')
  assert.equal(ix.analysis.frontier, 'owner')
  assert.equal(ix.analysis.ranked.owner[0].id, 'H01')
})

test('exclude: only a text read or a calculation, with a file; the reason cites the clue and the Journal', async () => {
  const { home, dir } = await withClues()
  await run(home, ['hyp', 'add', 'Durand runs it', '--level', 'owner', '--refute-if', 'x', ...P])
  await run(home, ['hyp', 'add', 'An agency runs it', '--level', 'owner', '--refute-if', 'y', ...P])
  assert.match((await run(home, ['hyp', 'exclude', 'H02', '--clue', 'C02', '--why', 'style', ...P])).err, /observed/)
  const r = await run(home, ['hyp', 'exclude', 'H02', '--clue', 'C01', '--why', 'the legal notice names the bakery as publisher', ...P])
  assert.equal(r.status, 0, r.err)
  const h2 = readNote(path.join(dir, 'Hypotheses', 'H02 An agency runs it.md')).props
  assert.equal(h2.status, 'excluded')
  assert.match(h2.reason, /the legal notice names the bakery as publisher — \[\[C01 SIREN on the legal notice\]\] · \[\[Journal#\^j\d{3}\]\]/)
  // the user puts it back in Obsidian: the ranking reads the note
  const f = path.join(dir, 'Hypotheses', 'H02 An agency runs it.md')
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('status: excluded', 'status: active'))
  assert.equal(indexCase(home, 'durand-bakery-example').analysis.ranked.owner.find(h => h.id === 'H02').status, 'active')
})

test('conclude: refused before the red team and without criteria; then the answer, the report and done', async () => {
  const { home, dir, file } = await withClues()
  await run(home, ['hyp', 'add', 'Durand runs it', '--level', 'owner', '--refute-if', 'x', ...P])
  await run(home, ['hyp', 'add', 'An agency runs it', '--level', 'owner', '--refute-if', 'y', ...P])
  await run(home, ['hyp', 'lr', 'H01', '--clue', 'C01', '--lr', '20', '--why', 'the legal notice names the bakery', ...P])
  const c = { answer: 'H01', confidence: { owner: 'high' }, criteria: { owner: 'SIREN read on the legal notice' }, alternatives: [{ hyp: 'H02', test: 'the registrar record names an agency' }], unresolved: ['C02'] }
  assert.match((await run(home, ['conclude', '--file', file('c.json', c), ...P])).err, /red team/)
  assert.equal((await run(home, ['redteam', '--file', file('rt.json', { target: 'H01', refutations: [{ test: 'Is the SIREN another company\'s?', result: 'no: the RCS line names Boulangerie Durand SARL' }], outcome: 'survives' }), ...P])).status, 0)
  assert.match((await run(home, ['conclude', '--file', file('c2.json', { ...c, criteria: {} }), ...P])).err, /criteria/)
  const r = await run(home, ['conclude', '--file', file('c3.json', c), ...P])
  assert.equal(r.status, 0, r.err)
  const p = readNote(path.join(dir, 'Case.md')).props
  assert.deepEqual([p.status, p.answer, p.confidence], ['done', 'Durand runs it', 'high'])
  assert.equal(readNote(path.join(dir, 'Hypotheses', 'H01 Durand runs it.md')).props.status, 'retained')
  const report = read(dir, 'Report.md')
  assert.match(report, /\[\[H01 Durand runs it\]\][\s\S]*owner \| high \| SIREN read on the legal notice[\s\S]*\[\[H02 An agency runs it\]\][\s\S]*the registrar record names an agency[\s\S]*\[\[C02 Agency style\]\][\s\S]*survives/)
  assert.deepEqual(json(dir, '.osint/case.json').conclusion.answer, 'H01')
  assert.ok(events(dir).some(e => e.kind === 'case.status' && e.data.status === 'done'))
})

test('hyp retain changes no share: the red team done before it still counts for conclude', async () => {
  const { home, file } = await withClues()
  await run(home, ['hyp', 'add', 'Durand runs it', '--level', 'owner', '--refute-if', 'x', ...P])
  await run(home, ['hyp', 'add', 'An agency runs it', '--level', 'owner', '--refute-if', 'y', ...P])
  await run(home, ['hyp', 'lr', 'H01', '--clue', 'C01', '--lr', '20', '--why', 'the legal notice names the bakery', ...P])
  await run(home, ['redteam', '--file', file('rt.json', { target: 'H01', refutations: [{ test: 't', result: 'r' }], outcome: 'survives' }), ...P])
  assert.equal((await run(home, ['hyp', 'retain', 'H01', ...P])).status, 0)
  const c = { answer: 'H01', confidence: { owner: 'high' }, criteria: { owner: 'SIREN read on the legal notice' }, alternatives: [{ hyp: 'H02', test: 'the registrar names an agency' }], unresolved: ['C02'] }
  const r = await run(home, ['conclude', '--file', file('c.json', c), ...P])
  assert.equal(r.status, 0, r.err)
})

test('commands run at once in one case lose no likelihood ratio', async () => {
  const { home, dir } = await withClues()
  await run(home, ['hyp', 'add', 'Durand runs it', '--level', 'owner', '--refute-if', 'x', ...P])
  for (let i = 3; i <= 8; i++) await run(home, ['clue', `Clue number ${i}`, '--status', 'read', ...P])
  const done = await Promise.all(['C01', 'C02', 'C03', 'C04', 'C05', 'C06', 'C07', 'C08'].map(c => run(home, ['hyp', 'lr', 'H01', '--clue', c, '--lr', '2', '--why', 'w', ...P])))
  assert.deepEqual(done.map(d => d.status), Array(8).fill(0))
  assert.equal(json(dir, '.osint/analysis.json').cells.length, 8)
})

test('next: the leads in Leads.md as checkboxes; a box ticked in Obsidian stays done when the list changes', async () => {
  const { home, dir, file } = await withClues()
  assert.equal((await run(home, ['next', '--file', file('n.json', [{ label: 'Read the 2019 home page', why: 'the SIREN may differ', minutes: 5, noisy: false }, { label: 'Search the tracker', why: 'other sites', minutes: 3 }]), ...P])).status, 0)
  let leads = read(dir, 'Leads.md')
  assert.match(leads, /- \[ \] \*\*L01\*\* Read the 2019 home page — the SIREN may differ \(5 min\) \^l01/)
  fs.writeFileSync(path.join(dir, 'Leads.md'), leads.replace('- [ ] **L01**', '- [x] **L01**'))
  assert.equal(indexCase(home, 'durand-bakery-example').leads.find(l => l.id === 'L01').done, true)
  await run(home, ['next', '--file', file('n2.json', [{ label: 'Ask the RCS', why: 'confirm', minutes: 2 }]), ...P])
  leads = read(dir, 'Leads.md')
  assert.match(leads, /- \[x\] \*\*L01\*\*/)
  assert.ok(!leads.includes('L02'))
  assert.match(leads, /- \[ \] \*\*L03\*\* Ask the RCS/)
  assert.equal((await run(home, ['next', '--done', 'L03', ...P])).status, 0)
  assert.match(read(dir, 'Leads.md'), /- \[x\] \*\*L03\*\*/)
})

test('hypLrMany caps each ratio by its clue, journals each one and ranks once', async () => {
  const home = casesFolder(), dir = path.join(home, 'durand-bakery-example'), P = ['-p', 'durand-bakery-example']
  await run(home, NEW)
  await run(home, ['clue', 'a model says so', '--status', 'model', ...P])
  await run(home, ['hyp', 'add', 'A', '--level', 'owner', '--refute-if', 'x', ...P])
  await run(home, ['hyp', 'add', 'B', '--level', 'owner', '--refute-if', 'y', ...P])
  const before = events(dir).filter(e => e.kind === 'hyp.rank').length
  hypLrMany(dir, getType('domain'), [{ hyp: 'H01', clue: 'C01', lr: 50, why: 'w' }, { hyp: 'H02', clue: 'C01', lr: 0.01, why: 'w' }])
  assert.deepEqual(json(dir, '.osint/analysis.json').cells.map(c => [c.hyp, c.lr]), [['H01', 3], ['H02', 1 / 3]])
  assert.equal(events(dir).filter(e => e.kind === 'hyp.rank').length, before + 1)
  assert.equal((read(dir, 'Journal.md').match(/· lr · /g) ?? []).length, 2)
})
