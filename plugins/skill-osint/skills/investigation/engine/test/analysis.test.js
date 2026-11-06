import assert from 'node:assert/strict'
import test from 'node:test'
import { alternatives, clamp, conclusionErrors, consistency, exclusionError, frontier, rank } from '../lib/analysis.js'

const near = (a, b) => Math.abs(a - b) < 1e-9

test('shares: softmax of log prior + Σ log LR per level, each LR clamped by what its clue rests on', () => {
  const hyps = [{ id: 'H1', level: 'owner', status: 'active' }, { id: 'H2', level: 'owner', status: 'active' }, { id: 'H3', level: 'owner', status: 'excluded' }]
  const r = rank(hyps, [{ clue: 'C01', hyp: 'H1', lr: 3, status: 'read' }])
  assert.deepEqual(r.owner.map(h => h.id), ['H1', 'H2', 'H3'])
  assert.ok(near(r.owner[0].share, 0.75) && near(r.owner[1].share, 0.25) && r.owner[2].share === 0)
  // a model alone weighs 3 at most, whatever the agent typed
  const m = rank(hyps.slice(0, 2), [{ clue: 'C02', hyp: 'H1', lr: 100, status: 'model' }])
  assert.ok(near(m.owner[0].share, 0.75))
  assert.equal(clamp(0.001, 5), 0.2)
  const p = rank([{ id: 'H1', level: 'owner', status: 'active', prior: 0.9 }, { id: 'H2', level: 'owner', status: 'active', prior: 0.1 }], [])
  assert.ok(near(p.owner[0].share, 0.9))
})

test('the frontier is the finest level with two active hypotheses, else the finest with one', () => {
  const order = ['country', 'region', 'street']
  const r = rank([
    { id: 'H1', level: 'country', status: 'active' }, { id: 'H2', level: 'region', status: 'active' },
    { id: 'H3', level: 'region', status: 'active' }, { id: 'H4', level: 'street', status: 'active' }, { id: 'H5', level: 'street', status: 'excluded' },
  ], [{ clue: 'C1', hyp: 'H2', lr: 50, status: 'read' }])
  assert.equal(frontier(r, order), 'region')
  assert.deepEqual(alternatives(r, 'region', 'H2'), [])
  assert.equal(frontier(rank([{ id: 'H1', level: 'owner', status: 'active' }], []), ['owner']), 'owner')
  assert.equal(frontier({}, ['owner']), null)
  assert.deepEqual([consistency(3), consistency(1), consistency(0.2)], ['C', 'N', 'I'])
})

test('an exclusion needs a text read or a calculation, a file, and half the area it rules out', () => {
  const hyp = { id: 'H2' }, area = { id: 'H3', point: [38.5, -7.9], radius_m: 500 }
  assert.match(exclusionError({ clue: { id: 'C1', status: 'model' }, hyp, fileExists: true }), /models rank, evidence decides/)
  assert.match(exclusionError({ clue: { id: 'C1', status: 'observed' }, hyp, fileExists: true }), /text read or a calculation/)
  assert.match(exclusionError({ clue: { id: 'C1', status: 'read' }, hyp, fileExists: false }), /no file/)
  assert.match(exclusionError({ clue: { id: 'C1', status: 'computed' }, hyp: area, fileExists: true, covers: 0.3 }), /half/)
  assert.equal(exclusionError({ clue: { id: 'C1', status: 'computed' }, hyp: area, fileExists: true, covers: 0.6 }), null)
  assert.equal(exclusionError({ clue: { id: 'C1', status: 'read' }, hyp, fileExists: true }), null)
})

test('a conclusion: one hypothesis, after the red team, cited, with its tests, criteria and constraints', () => {
  const hyps = [{ id: 'H1', level: 'owner', status: 'active' }, { id: 'H2', level: 'owner', status: 'active' }]
  const clues = [{ id: 'C1', status: 'read', constraint: false, sources: ['[[S01 RDAP]]'], journal: null }, { id: 'C2', status: 'observed', constraint: false, sources: [], journal: null }]
  const base = {
    conclusion: { answer: 'H1', confidence: { owner: 'high' }, criteria: { owner: 'SIREN read on the site, RCS confirms' }, alternatives: [{ hyp: 'H2', test: 'the registrar record names the agency' }], unresolved: [] },
    hyps, cells: [{ clue: 'C1', hyp: 'H1', lr: 20, status: 'read' }], clues, exclusions: [], journalIds: new Set(['j001']),
    levels: [{ id: 'owner' }], redteam: { target: 'H1', outcome: 'survives' }, redteamAt: '2026-11-03T10:05:00Z', rankedAt: '2026-11-03T10:00:00Z',
  }
  assert.deepEqual(conclusionErrors(base), [])
  assert.match(conclusionErrors({ ...base, redteamAt: '2026-11-03T09:00:00Z' })[0], /red team after the last ranking change/)
  assert.match(conclusionErrors({ ...base, redteam: { target: 'H1', outcome: 'refuted' } })[0], /refuted/)
  assert.match(conclusionErrors({ ...base, cells: [...base.cells, { clue: 'C2', hyp: 'H1', lr: 2, status: 'observed' }] })[0], /never fabricate verification: C2/)
  assert.match(conclusionErrors({ ...base, conclusion: { ...base.conclusion, radius_m: 50 } })[0], /two independent constraints/)
  assert.match(conclusionErrors({ ...base, conclusion: { ...base.conclusion, criteria: {} } })[0], /criteria/)
  assert.match(conclusionErrors({ ...base, conclusion: { ...base.conclusion, alternatives: [{ hyp: 'H2', test: '' }] } })[0], /the test/)
  assert.match(conclusionErrors({ ...base, conclusion: { ...base.conclusion, answer: 'H9' } }).join('\n'), /no hypothesis H9/)
})

test('a level its manifest caps: a confidence above the cap is refused, unless the type\'s state lifts it', () => {
  const hyps = [{ id: 'H1', level: 'integrity', status: 'active' }, { id: 'H2', level: 'integrity', status: 'active' }]
  const clues = [{ id: 'C1', status: 'read', constraint: false, sources: ['[[S01 C2PA]]'], journal: null }]
  const levels = [{ id: 'integrity', max: { confidence: 'medium', unless: 'c2pa_valid', why: 'signs of editing or generation are clues, never a verdict' } }]
  const base = {
    conclusion: { answer: 'H1', confidence: { integrity: 'high' }, criteria: { integrity: 'a signed manifest says so' }, alternatives: [{ hyp: 'H2', test: 'the manifest is not valid' }], unresolved: [] },
    hyps, cells: [{ clue: 'C1', hyp: 'H1', lr: 20, status: 'read' }], clues, exclusions: [], journalIds: new Set(),
    levels, redteam: { target: 'H1', outcome: 'survives' }, redteamAt: '2026-11-03T10:05:00Z', rankedAt: '2026-11-03T10:00:00Z',
  }
  assert.deepEqual(conclusionErrors(base), ['confidence integrity: at most medium — signs of editing or generation are clues, never a verdict'])
  assert.equal(conclusionErrors({ ...base, state: { c2pa_valid: false } }).length, 1)
  assert.equal(conclusionErrors({ ...base, state: { c2pa_valid: 'yes' } }).length, 1)
  assert.deepEqual(conclusionErrors({ ...base, state: { c2pa_valid: true } }), [])
  assert.deepEqual(conclusionErrors({ ...base, conclusion: { ...base.conclusion, confidence: { integrity: 'medium' } } }), [])
  const low = [{ id: 'integrity', max: { confidence: 'low', why: 'never more than a hunch' } }]
  assert.match(conclusionErrors({ ...base, levels: low, state: { c2pa_valid: true }, conclusion: { ...base.conclusion, confidence: { integrity: 'medium' } } })[0], /at most low — never more than a hunch/)
})
