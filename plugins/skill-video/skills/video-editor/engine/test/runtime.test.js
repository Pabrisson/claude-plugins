import assert from 'node:assert/strict'
import test from 'node:test'
import { DRAW, shownTexts } from '../lib/actors.js'
import { actorSpan, createActors, logical, resolveActors, styleOf } from '../lib/runtime.js'

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

test('on-screen texts for the transcript without speech, each while it shows', () => {
  const num = (n, d) => n.toFixed(d).replace('.', ',')
  const lines = (a, creator = {}) => shownTexts(a, creator, num, 10).map(x => [x.w, x.t0, x.t1])
  assert.deepEqual(lines({ type: 'text', text: 'Un moteur *maison*', from: 2 }), [['Un moteur maison', 2, 10]])
  assert.deepEqual(lines({ type: 'counter', value: [0, 12.5], decimals: 1, prefix: '×', to: 4 }), [['×12,5', 0, 4]])
  assert.deepEqual(lines({ type: 'cta' }, { name: 'Pab', cta: { button: "S'abonner" } }), [['Pab', 0, 10], ["S'abonner", 0, 10]])
  // a text the keys change: each one from its key to the next (a key before the start applies at once)
  const keyed = { type: 'chip', text: 'Avant', from: 1, to: 5, keys: [[0, { text: 'Tout de suite' }], [3, { text: 'Après', x: 2 }], [4, { x: 9 }]] }
  assert.deepEqual(lines(keyed), [['Tout de suite', 1, 3], ['Après', 3, 5]])
})

test("an arrow's a and b are points of the canvas unless it sets x, y", async () => {
  const job = { style: styleOf({}), logical: [1080, 1920], primaryLogical: [1080, 1920], size: [1080, 1920], format: '9:16', primary: '9:16' }
  const actors = await createActors([{ id: 'a', type: 'arrow', a: [100, 100], b: [300, 100] }, { id: 't', type: 'text', text: 'x' }], job, { toVideo: t => t }, { image: async () => null })
  assert.deepEqual(actors.live(1).map(a => [a.x, a.y]), [[0, 0], [540, 960]])
})

test("a bar's label takes labelColor", () => {
  // a 2D context that keeps each text written, with its color
  const said = [], ctx = new Proxy({ measureText: s => ({ width: s.length * 10 }), fillText(s) { said.push([s, this.fillStyle]) } }, { get: (o, k) => (k in o ? o[k] : () => {}) })
  DRAW.bar({ ctx, color: c => c, num: n => String(n), age: 5, k: 1, depth: 1 }, { label: 'CPU', labelColor: 'white', value: 0.5 })
  assert.deepEqual(said, [['CPU', 'white'], ['50', 'accent'], ['%', 'accent']])
})
