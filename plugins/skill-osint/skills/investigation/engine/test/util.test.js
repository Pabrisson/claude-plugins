import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { accepts, fail, isUrl, readJson, safeName, sha256, slugify, UserError, writeAtomic, writeJson } from '../lib/util.js'

test('slugify keeps ASCII words, drops accents and refuses Windows reserved names', () => {
  assert.equal(slugify('Boulangerie Durand — Évora!'), 'boulangerie-durand-evora')
  assert.equal(slugify('durand-bakery.example'), 'durand-bakery-example')
  assert.equal(slugify('CON'), 'case-con')
  assert.equal(slugify('🙂'), 'case-x')
})

test('safeName keeps Unicode but drops what an OS or an Obsidian link refuses', () => {
  assert.equal(safeName('a/b:c#d^e[f]|g'), 'a-b-c-d-e-f--g')
  assert.equal(safeName('Évora 🙂 café'), 'Évora 🙂 café')
  assert.equal(safeName('nul'), '_nul')
  assert.equal(safeName('  . '), 'untitled')
  assert.equal(safeName('end. '), 'end')
})

test('writeAtomic replaces a file whole, writeJson ends with a newline, readJson falls back on a missing file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-'))
  const f = path.join(dir, 'a', 'b.json')
  writeJson(f, { x: 1 })
  assert.equal(fs.readFileSync(f, 'utf8'), '{\n  "x": 1\n}\n')
  writeAtomic(f, 'two')
  assert.equal(fs.readFileSync(f, 'utf8'), 'two')
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ['b.json'])
  assert.deepEqual(readJson(path.join(dir, 'none.json'), []), [])
  assert.throws(() => readJson(path.join(dir, 'none.json')), { code: 'ENOENT' })
})

test('fail throws a UserError with its exit code', () => {
  assert.throws(() => fail('needs a yes', 2), e => e instanceof UserError && e.code === 2 && e.message === 'needs a yes')
  assert.equal(sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

test('accepts reads an <input accept> list as a browser does: upper-case extensions and HEIC included', () => {
  assert.equal(accepts('image/*', 'IMG_0042.JPG'), true)
  assert.equal(accepts('image/*', 'IMG_0042.HEIC'), true)
  assert.equal(accepts('image/*', 'clip.mov'), false)
  assert.equal(accepts('video/*', 'clip.MOV'), true)
  assert.equal(accepts('.png, .jpg', 'a.jpg'), true)
  assert.equal(accepts('image/png', 'a.jpg'), false)
  assert.deepEqual([isUrl('https://x.example/a.mp4'), isUrl('/tmp/a.mp4'), isUrl('ftp://x.example')], [true, false, false])
})
