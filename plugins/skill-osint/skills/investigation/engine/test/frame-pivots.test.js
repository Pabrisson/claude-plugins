import assert from 'node:assert/strict'
import test from 'node:test'
import { checkFrame } from '../lib/case.js'
import { basisParts, LEGAL_BASES } from '../lib/inputs.js'
import { normalize } from '../lib/kinds.js'
import { pivotsFor } from '../lib/prompt.js'
import { getType, validateManifest } from '../lib/types.js'

test('a type may propose the legal basis: written when none is given, the user\'s own kept, none proposed still refused', () => {
  const m = { frame: [{ id: 'person', always: true, legal_basis: 'Legitimate interest — public registry data' }] }
  assert.deepEqual(checkFrame(m, {}, 'Who runs it?'), { question: 'Who runs it?', purpose: null, scope: null, person: true, legal_basis: 'Legitimate interest — public registry data' })
  assert.equal(checkFrame(m, { legal_basis: 'Consent — the officer agreed' }, 'Q?').legal_basis, 'Consent — the officer agreed')
  assert.equal(checkFrame(m, { person: 'false' }, 'Q?').person, true)
  assert.throws(() => checkFrame({ frame: ['person'] }, { person: 'true' }, 'Q?'), /legal_basis/)
  assert.deepEqual(checkFrame({ frame: ['person'] }, {}, 'Q?').legal_basis, null)
})

test('pivots: a kind, or a kind whose entity carries a property; the dashboard\'s buttons follow', () => {
  const d = getType('domain')
  assert.deepEqual(validateManifest({ ...d, pivots: ['domain', { kind: 'organization', has: 'siren' }] }), [])
  const e = validateManifest({ ...d, pivots: [{ kind: 'planet', has: 'x' }, { kind: 'organization' }] }).join('\n')
  assert.match(e, /pivots: unknown entity kind planet/)
  assert.match(e, /pivots\.organization\.has/)
  const types = [{ id: 'company-fr', label: 'Company (France)', icon: 'building-2', pivots: [{ kind: 'organization', has: 'siren' }], actions: [] }]
  assert.deepEqual(pivotsFor({ kind: 'organization', value: 'SIREN 456 789 122', path: 'Entities/SIREN 456 789 122.md', props: { siren: '456789122' } }, types), [
    { type: 'company-fr', label: 'New Company (France) case on SIREN 456 789 122', icon: 'building-2', item: { tag: 'pivot:company-fr', text: 'SIREN 456 789 122 — from Entities/SIREN 456 789 122.md' } },
  ])
  assert.deepEqual(pivotsFor({ kind: 'organization', value: 'Exemple Registrar SAS', path: 'x', props: { role: 'registrar' } }, types), [])
  assert.deepEqual(pivotsFor({ kind: 'organization', value: 'y', path: 'x', props: { siren: '' } }, types), [])
  assert.deepEqual(pivotsFor({ kind: 'organization', value: 'y', path: 'x' }, types), [])
  assert.equal(pivotsFor({ kind: 'domain', value: 'a.example', path: 'x' }, [{ id: 'domain', label: 'Domain', icon: 'globe', pivots: ['domain'], actions: [] }]).length, 1)
})

test('a person shared between cases needs the same name and the same month of birth', () => {
  assert.equal(normalize('person', 'Jeanne Durand', { born: '1961-04' }), 'person:jeanne durand 1961-04')
  assert.equal(normalize('person', 'Jeanne Durand', { born: '1961-04-12' }), 'person:jeanne durand 1961-04')
  assert.equal(normalize('person', 'Jeanne Durand'), 'person:jeanne durand')
})

test('basisParts: the proposed basis split for the form\'s select and its detail field', () => {
  assert.ok(LEGAL_BASES.includes('Legitimate interest'))
  assert.deepEqual(basisParts('Legitimate interest — public registry data'), { base: 'Legitimate interest', detail: 'public registry data' })
  assert.deepEqual(basisParts('legitimate interest'), { base: 'Legitimate interest', detail: '' })
  assert.deepEqual(basisParts('my own words'), { base: null, detail: 'my own words' })
  assert.deepEqual(basisParts(null), { base: null, detail: '' })
})
