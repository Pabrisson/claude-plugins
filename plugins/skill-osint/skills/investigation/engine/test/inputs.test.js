import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { checkInputs, shown } from '../lib/inputs.js'

const domain = JSON.parse(fs.readFileSync(new URL('../../types/domain/type.json', import.meta.url), 'utf8'))

test('a field shows only when its `when` holds, and the engine refuses it otherwise', () => {
  const sub = domain.inputs.find(i => i.id === 'subdomains')
  assert.equal(shown(sub, { depth: 'standard' }), true)
  assert.equal(shown(sub, { depth: 'quick' }), false)
  assert.deepEqual(checkInputs(domain, { domain: 'x.example' }).values, { domain: 'x.example', depth: 'standard' })
  assert.deepEqual(checkInputs(domain, { domain: 'x.example', subdomains: 'true' }).values, { domain: 'x.example', depth: 'standard', subdomains: true })
  assert.match(checkInputs(domain, { domain: 'x.example', depth: 'quick', subdomains: 'true' }).error, /subdomains only goes with depth=standard/)
  assert.match(checkInputs(domain, { domain: 'x.example', depth: 'deep' }).error, /one of quick, standard/)
  assert.match(checkInputs(domain, {}).error, /missing input domain/)
  assert.match(checkInputs(domain, { domain: 'x', colour: 'red' }).error, /unknown input colour/)
})

test('chips with multiple: a list from an array or from a,b; each value an option; at least one', () => {
  const opt = v => ({ value: v, label: v.toUpperCase(), icon: 'tag' })
  const m = { id: 't', inputs: [{ id: 'name', kind: 'text', label: 'Name', required: true }, { id: 'cats', kind: 'chips', multiple: true, label: 'Cats', default: ['a', 'b'], options: ['a', 'b', 'c'].map(opt) }] }
  assert.deepEqual(checkInputs(m, { name: 'x' }).values.cats, ['a', 'b'])
  assert.deepEqual(checkInputs(m, { name: 'x', cats: 'c, a,c' }).values.cats, ['c', 'a'])
  assert.deepEqual(checkInputs(m, { name: 'x', cats: ['b'] }).values.cats, ['b'])
  assert.equal(checkInputs(m, { name: 'x', cats: 'a,z' }).error, '--in cats=z: one or more of a, b, c')
  assert.equal(checkInputs(m, { name: 'x', cats: [] }).error, '--in cats: at least one of a, b, c')
})
