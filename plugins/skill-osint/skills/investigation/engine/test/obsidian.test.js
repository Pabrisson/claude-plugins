import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { registerVaults } from '../lib/obsidian.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'osint-obsidian-'))
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'))

test('Obsidian closed: the investigation is registered once, its other settings kept; a folder inside a vault is known', () => {
  const d = tmp(), file = path.join(d, 'obsidian.json'), a = path.join(d, 'a'), b = path.join(d, 'b')
  fs.writeFileSync(file, JSON.stringify({ vaults: { '0123456789abcdef': { path: path.join(d, 'old'), ts: 1 } }, frame: 'native' }))
  assert.deepEqual(registerVaults([a, b], { file, running: () => false }), { ok: true, added: 2 })
  const c = read(file), ids = Object.keys(c.vaults)
  assert.equal(c.frame, 'native')
  assert.equal(ids.length, 3)
  assert.ok(ids.every(i => /^[0-9a-f]{16}$/.test(i)))
  assert.deepEqual(Object.values(c.vaults).map(v => v.path).sort(), [a, b, path.join(d, 'old')].sort())
  assert.deepEqual(registerVaults([b, a], { file, running: () => { throw new Error('not asked when all are known') } }), { ok: true, added: 0 })
  assert.deepEqual(registerVaults([path.join(d, 'old', 'sub')], { file, running: () => true }), { ok: true, added: 0 })
})

test('Obsidian running: nothing written; not known, or known but its sub-cases not yet', () => {
  const d = tmp(), file = path.join(d, 'obsidian.json'), a = path.join(d, 'a')
  fs.writeFileSync(file, '{"vaults":{}}')
  assert.deepEqual(registerVaults([a], { file, running: () => true }), { ok: false, running: true })
  assert.equal(fs.readFileSync(file, 'utf8'), '{"vaults":{}}')
  fs.writeFileSync(file, JSON.stringify({ vaults: { '0123456789abcdef': { path: a, ts: 1 } } }))
  assert.deepEqual(registerVaults([a, path.join(d, 'b')], { file, running: () => true }), { ok: true, running: true })
})

test('no Obsidian config here, or an unreadable one: nothing written, the dashboard explains', () => {
  const d = tmp(), file = path.join(d, 'obsidian.json')
  assert.deepEqual(registerVaults([d], { file: null }), { ok: false, missing: true })
  fs.writeFileSync(file, '{not json')
  assert.deepEqual(registerVaults([d], { file, running: () => false }), { ok: false })
  assert.equal(fs.readFileSync(file, 'utf8'), '{not json')
})
