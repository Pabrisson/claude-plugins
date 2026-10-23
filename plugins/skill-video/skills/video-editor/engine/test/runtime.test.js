import assert from 'node:assert/strict'
import test from 'node:test'
import { shownTexts } from '../lib/actors.js'
import { actorSpan, logical, resolveActors, styleOf } from '../lib/runtime.js'

test('logical canvas: short side 1080, source keeps its ratio', () => {
  assert.deepEqual(logical('9:16'), [1080, 1920])
  assert.deepEqual(logical('source', { width: 3840, height: 2160 }), [1920, 1080])
  assert.deepEqual(logical('source', { width: 1080, height: 1350 }), [1080, 1350])
})

test("an actor's own format override merges on it, or hides it", () => {
  const actors = [
    { id: 'a', type: 'text', text: 'x', y: 300, formats: { '1:1': { fit: false, y: 120 } } },
    { id: 'b', type: 'chip', formats: { '1:1': { hidden: true } } },
  ]
  const r = resolveActors(actors, '1:1')
  assert.equal(r.length, 1)
  assert.equal(r[0].y, 120)
  assert.equal(r[0].fit, false)
  assert.equal(resolveActors(actors, '9:16').length, 2)
})

test('style: missing fields come from the engine defaults', () => {
  const s = styleOf({ creator: { name: 'Pab' }, look: { palette: { accent: '#f00' } } })
  assert.equal(s.creator.name, 'Pab')
  assert.equal(s.creator.lang, 'fr')
  assert.equal(s.look.palette.accent, '#f00')
  assert.equal(s.look.palette.ink, '#171512')
})

test('an actor stays on screen through its exit', () => {
  assert.deepEqual(actorSpan({ from: 2, to: 5 }, t => t / 2, 30), [1, 2.8])
  assert.deepEqual(actorSpan({ from: 2 }, t => t, 30), [2, 30])
})

test('on-screen texts for the transcript without speech', () => {
  const num = (n, d) => n.toFixed(d).replace('.', ',')
  assert.deepEqual(shownTexts({ type: 'text', text: 'Un moteur *maison*' }, {}, num), ['Un moteur maison'])
  assert.deepEqual(shownTexts({ type: 'counter', value: [0, 12.5], decimals: 1, prefix: '×' }, {}, num), ['×12,5'])
  assert.deepEqual(shownTexts({ type: 'cta' }, { name: 'Pab', cta: { button: "S'abonner" } }, num), ['Pab', "S'abonner"])
})
