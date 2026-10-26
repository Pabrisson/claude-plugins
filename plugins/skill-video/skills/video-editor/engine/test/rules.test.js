import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { DEFAULTS, checkEdit, checkLayout, effective, listPacks, mergeParams, paramErrors, parsePack } from '../lib/rules.js'

const shipped = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../rules')
const perso = fs.mkdtempSync(path.join(os.tmpdir(), 'video-rules-'))
fs.writeFileSync(path.join(perso, 'shorts.md'), '---\nextends: shorts\ndescription: my shorts\nparams: {"speed": 1.05}\n---\n- Never a tape stop.\n')
fs.writeFileSync(path.join(perso, 'quiet.md'), '---\ndescription: no transcript\nparams: {"transcribe": false}\n---\n')
fs.writeFileSync(path.join(perso, 'fast-quiet.md'), '---\nextends: quiet\nparams: {"speed": 1.2}\n---\n')
fs.writeFileSync(path.join(perso, 'broken.md'), '---\nparams: {"speed": 1.1,}\n---\n')
fs.writeFileSync(path.join(perso, 'typed.md'), '---\nparams: {"speed": "fast", "graphics": "big", "duration": [75, 30]}\n---\n')
fs.writeFileSync(path.join(perso, 'orphan.md'), '---\nextends: nope\n---\n')
const packs = listPacks([['plugin', shipped], ['perso', perso]])

test('frontmatter: inline JSON values, plain strings otherwise', () => {
  const p = parsePack('---\nname: x\ndescription: a: b\nparams: {"speed": 1.2}\n---\n## Body\n')
  assert.equal(p.description, 'a: b')
  assert.deepEqual(p.params, { speed: 1.2 })
  assert.equal(p.body, '## Body\n')
})

test('shipped packs load, with valid params', () => {
  assert.equal(packs['motion-design'].origin, 'plugin')
  assert.equal(packs['motion-design'].params.max_static, 2)
  for (const pk of Object.values(packs).filter(x => x.origin === 'plugin')) assert.deepEqual(pk.errors, [], pk.name)
})

test('a personal pack extending the shipped one of the same name: its params win, its text comes after', () => {
  assert.equal(packs.shorts.origin, 'perso (overrides plugin)')
  assert.equal(packs.shorts.params.speed, 1.05)
  assert.equal(packs.shorts.params.captions, true)
  assert.match(packs.shorts.body, /## When writing the scene[\s\S]*these lines win over the ones above[\s\S]*Never a tape stop/)
  assert.equal(packs['fast-quiet'].params.transcribe, false)
  assert.equal(packs['fast-quiet'].params.speed, 1.2)
})

test('broken params are reported, not applied', () => {
  assert.match(packs.broken.errors[0], /params/)
  assert.deepEqual(packs.broken.params, {})
  assert.deepEqual(packs.typed.errors.map(e => e.split(':')[0]), ['speed', 'graphics', 'duration'])
  assert.match(packs.orphan.errors[0], /extends nope/)
  assert.throws(() => mergeParams(packs, 'broken'), /broken.*params/)
})

test('param types: the engine keys and the ones check reads', () => {
  assert.deepEqual(paramErrors({ speed: 1.15, breaths: null, hook: 2, read: { word: 0.3, min: 1.2 }, lower_thirds: true }), [])
  assert.deepEqual(paramErrors({ breaths: { sentence: 'short' } }).length, 1)
  assert.deepEqual(paramErrors('{"speed": 1.1,}').length, 1)
})

test('one pack per video: the defaults, then its params', () => {
  assert.deepEqual(mergeParams(packs), DEFAULTS)
  assert.equal(mergeParams(packs, 'shorts').speed, 1.05)
  assert.equal(mergeParams(packs, 'quiet').transcribe, false)
  assert.throws(() => mergeParams(packs, 'nope'), /unknown rules pack: nope/)
})

test('breaths and captions need transcribe, project overrides win', () => {
  const warnings = []
  const p = effective({ params: { transcribe: false, breaths: { sentence: 0.08 }, captions: true }, overrides: {} }, w => warnings.push(w))
  assert.equal(p.breaths, null)
  assert.equal(p.captions, false)
  assert.equal(warnings.length, 2)
  assert.equal(effective({ params: { speed: 1.15 }, overrides: { speed: 1.05 } }).speed, 1.05)
})

test("check measures the pack's numbers on the edit", () => {
  const params = { ...DEFAULTS, duration: [30, 75], hook: 2, cta: true, end_screen: 5, max_static: 4, shot: [1, 3], read: { word: 0.3, min: 1.2 }, chapters: true, captions: true }
  const bad = checkEdit(params, {
    duration: 80,
    cuts: [[10.2, 12]],
    words: [{ w: 'bonjour', t0: 10, t1: 10.5 }, { w: 'tous', t0: 12.5, t1: 12.8 }],
    screen: [{ w: 'Trois mots ici', v0: 1, v1: 1.5 }],
    joins: [],
    parts: [
      { kind: 'sequence', t0: 0, t1: 30, name: 'Intro' }, { kind: 'sequence', t0: 30, t1: 35, name: 'Short' },
      { kind: 'hook', t0: 3, t1: 6 }, { kind: 'clip', t0: 40, t1: 40.5, id: 'a' }, { kind: 'clip', t0: 40.5, t1: 45, id: 'b' },
      { kind: 'cta', t0: 50, t1: 52 },
    ],
    scene: 'export default () => {}',
  })
  const failed = bad.filter(([ok]) => !ok).map(([, msg]) => msg).join('\n')
  for (const x of [/80 s.*30 to 75/, /cut at 10\.2 s.*bonjour/, /hook.*3 s/, /CTA ends at 52 s/, /end-screen/, /from 6 s to 30 s/,
    /clip a.*0\.5 s/, /clip b.*4\.5 s/, /Trois mots ici.*0\.5 s/, /2 chapters/, /Short.*5 s/, /captions\(\)/]) assert.match(failed, x)
  const good = checkEdit({ ...DEFAULTS, duration: [30, 75], hook: 2, max_static: 4, chapters: true }, {
    duration: 40, cuts: [[10.6, 12.4]], words: [{ w: 'bonjour', t0: 10, t1: 10.5 }], screen: [], joins: [4, 8, 12, 16, 20, 24, 28, 32, 36],
    parts: [{ kind: 'hook', t0: 0, t1: 2 }, { kind: 'sequence', t0: 0, t1: 12, name: 'Hook' }, { kind: 'sequence', t0: 12, t1: 25, name: 'Why' }, { kind: 'sequence', t0: 25, t1: 40, name: 'How' }],
    scene: '',
  })
  assert.deepEqual(good.filter(([ok]) => !ok), [])
  assert.match(good.map(([, msg]) => msg).join('\n'), /00:00 Hook\n00:12 Why\n00:25 How/)
})

test('on_beat: every cut 0 to 3 frames before a beat or a half-beat of the grid', () => {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3], parts = t => t.map((t0, i) => ({ kind: 'clip', id: `c${i}`, t0, t1: t0 + 0.5 }))
  const run = (cuts, b = beats) => checkEdit({ on_beat: true }, { duration: 3.2, cuts: [], words: [], screen: [], joins: [], parts: parts(cuts), scene: '', beats: b, fps: 30 })
  assert.deepEqual(run([0, 0.95, 1.25, 1.97]).map(([ok]) => ok), [true])
  const [[ok, msg]] = run([0.8, 1.6])
  assert.equal(ok, false)
  assert.match(msg, /cut at 0\.8 s is 2 frame\(s\) after the beat at 0\.75 s; cut at 1\.6 s is 3 frame\(s\) after the beat at 1\.5 s/)
  assert.match(run([1], null)[0][1], /no beat grid/)
})

test('layout: an issue counts when it lasts 0.75 s, each run with its times', () => {
  const at = (v, ...issues) => [v, issues]
  const samples = [at(0, ['zone', '"Bas"']), at(0.25, ['zone', '"Bas"'], ['cut', '"Vol"']), at(0.5, ['zone', '"Bas"']), at(0.75), at(2, ['small', 'the captions']),
    at(2.25, ['small', 'the captions']), at(2.5, ['small', 'the captions'])]
  const lines = checkLayout(samples, 0.25, '9:16')
  assert.deepEqual(lines.map(([ok]) => ok), [false, false])
  assert.match(lines[0][1], /^9:16: "Bas" in the platforms' interface zones from 00:00\.00 to 00:00\.75$/)
  assert.match(lines[1][1], /the captions too small to read on a phone .* from 00:02\.00 to 00:02\.75/)
  // a text cut by its box at rest (the same share shown) counts, a reveal (a new share at every sample) does not
  const clip = checkLayout([0, 0.25, 0.5, 0.75].map(v => at(v, ['clip', '"Bloqué" (82 % shown)'], ['clip', `"Révélé" (${v * 100} % shown)`])), 0.25, '9:16')
  assert.deepEqual(clip.map(([, x]) => x), ['9:16: "Bloqué" (82 % shown) cut by its box (a mask, a window or an overflow hides part of a word or of its letters) from 00:00.00 to 00:01.00'])
  assert.deepEqual(checkLayout([at(0), at(0.25)], 0.25, '16:9'), [[true, "16:9: no text in the platforms' zones, too small, cut by the frame or by its box, or over a face"]])
})
