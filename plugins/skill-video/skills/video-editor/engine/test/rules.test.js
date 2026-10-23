import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { DEFAULTS, effective, listPacks, mergeParams, parsePack } from '../lib/rules.js'

const shipped = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../rules')
const perso = fs.mkdtempSync(path.join(os.tmpdir(), 'video-rules-'))
fs.writeFileSync(path.join(perso, 'shorts.md'), '---\ndescription: my shorts\nparams: {"speed": 1.05}\n---\nbody')
fs.writeFileSync(path.join(perso, 'quiet.md'), '---\ndescription: no transcript\nparams: {"transcribe": false}\n---\n')
const packs = listPacks([['plugin', shipped], ['perso', perso]])

test('frontmatter: inline JSON values, plain strings otherwise', () => {
  const p = parsePack('---\nname: x\ndescription: a: b\nparams: {"speed": 1.2}\n---\n## Body\n')
  assert.equal(p.description, 'a: b')
  assert.deepEqual(p.params, { speed: 1.2 })
  assert.equal(p.body, '## Body\n')
})

test('shipped packs load', () => {
  assert.equal(packs['motion-design'].origin, 'plugin')
  assert.equal(packs['motion-design'].params.max_static, 2)
})

test('a personal pack overrides the shipped one of the same name', () => {
  assert.equal(packs.shorts.origin, 'perso (overrides plugin)')
  assert.equal(mergeParams(packs, ['shorts']).speed, 1.05)
})

test('no pack: engine defaults', () => {
  assert.deepEqual(mergeParams(packs, []), DEFAULTS)
})

test('order: only declared keys win, the last pack wins', () => {
  const p = mergeParams(packs, ['shorts', 'quiet'])
  assert.equal(p.speed, 1.05)
  assert.equal(p.transcribe, false)
  assert.equal(mergeParams(packs, ['quiet', 'motion-design']).transcribe, false)
})

test('unknown pack is refused', () => {
  assert.throws(() => mergeParams(packs, ['nope']), /unknown rules pack: nope/)
})

test('breaths and captions need transcribe, project overrides win', () => {
  const warnings = []
  const p = effective({ params: { transcribe: false, breaths: { sentence: 0.08 }, captions: true }, overrides: {} }, w => warnings.push(w))
  assert.equal(p.breaths, null)
  assert.equal(p.captions, false)
  assert.equal(warnings.length, 2)
  assert.equal(effective({ params: { speed: 1.15 }, overrides: { speed: 1.05 } }).speed, 1.05)
})
