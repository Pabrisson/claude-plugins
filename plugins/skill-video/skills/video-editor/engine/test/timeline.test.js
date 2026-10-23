import assert from 'node:assert/strict'
import test from 'node:test'
import { keepSegments, makeTimeline } from '../lib/timeline.js'

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`)

test('identity without a source', () => {
  const tl = makeTimeline(null)
  assert.equal(tl.toVideo(12.3), 12.3)
  assert.equal(tl.toSource(4), 4)
})

test('round trip across cuts and speed', () => {
  const tl = makeTimeline({ speed: 2, segments: [[1, 3], [5, 6]] })
  near(tl.duration, 1.5)
  near(tl.toVideo(2), 0.5)
  near(tl.toVideo(5.5), 1.25)
  for (const t of [1, 2.5, 5, 5.9]) near(tl.toSource(tl.toVideo(t)), t)
})

test('a time inside a cut lands on the next kept frame', () => {
  const tl = makeTimeline({ speed: 1, segments: [[1, 3], [5, 6]] })
  near(tl.toVideo(4), 2)
  near(tl.toVideo(0), 0)
  near(tl.toVideo(99), 3)
})

test('manual cuts split and trim segments, snapped to frames', () => {
  const tl = makeTimeline({ fps: 10, speed: 1, segments: [[0, 10]] }, [[2.04, 3.01], [9.5, 12]])
  assert.deepEqual(tl.segments, [[0, 2], [3, 9.5]])
  assert.throws(() => makeTimeline({ segments: [[0, 1]] }, [[0, 1]]))
})

test('silences shrink to a breath chosen by punctuation', () => {
  const words = [{ w: 'Bonjour.', t0: 1, t1: 1.5 }, { w: 'Alors,', t0: 3, t1: 3.4 }, { w: 'voilà', t0: 4, t1: 4.5 }]
  const segs = keepSegments([[0, 1], [1.5, 3], [3.4, 4], [4.5, 6]], words, { sentence: 0.2, comma: 0.1 }, 6)
  assert.deepEqual(segs, [[0.95, 1.6], [2.9, 3.45], [3.95, 4.55]])
})

test('a silence inside a word is kept', () => {
  const words = [{ w: 'aptitude', t0: 1, t1: 2 }]
  assert.deepEqual(keepSegments([[1.4, 1.6]], words, { sentence: 0.08, comma: 0.05 }, 3), [[0, 3]])
})
