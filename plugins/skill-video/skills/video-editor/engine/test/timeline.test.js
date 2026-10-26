import assert from 'node:assert/strict'
import test from 'node:test'
import { alignedWords, audible, keepSegments, makeTimeline, rushGains, silences, stillStretches, windowDb } from '../lib/timeline.js'

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

test('still stretches as they play once cut: the seconds kept and the words left over them', () => {
  const tl = makeTimeline({ fps: 25, speed: 1, segments: [[0, 20]] }, [[4, 6]])
  const words = [{ w: 'on', t0: 3, t1: 3.2 }, { w: 'attend', t0: 4.5, t1: 5 }, { w: 'encore', t0: 12, t1: 12.4 }]
  assert.deepEqual(stillStretches([[2, 7], [10, 11], [11.5, 15]], tl, words, 2), [
    { a: 2, b: 7, kept: 3, said: 'on' },
    { a: 11.5, b: 15, kept: 3.5, said: 'encore' },
  ])
})

// 10 s at 48 kHz: 1 s of a 200 Hz "voice" every 2 s, over seeded noise of the given amplitude (0 to 1)
function talk(noise, voice = 0.3) {
  let seed = 7
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31) * 2 - 1
  return Int16Array.from({ length: 480000 }, (_, i) => 32767 * Math.max(-1, Math.min(1, (i % 96000 < 48000 ? voice * Math.sin(i / 38.2) : 0) + noise * rand())))
}

test('a voice under steady noise has no silence to cut, but still gets transcribed', () => {
  const clean = windowDb(talk(0.001)), noisy = windowDb(talk(0.12)), mute = windowDb(new Int16Array(480000))
  assert.equal(silences(clean).length, 5)
  assert.ok(audible(clean))
  // about 13 dB of signal over noise: no clear pause, yet a voice to hear
  assert.equal(silences(noisy), null)
  assert.ok(audible(noisy))
  assert.equal(audible(mute), false)
  assert.equal(silences(mute), null)
})

test("each rush's voice comes down to the quietest one, a silent rush stays as is", () => {
  const loud = windowDb(talk(0.001)), quiet = windowDb(talk(0.0005, 0.15)), db = Float64Array.from([...loud, ...quiet, ...new Float64Array(1000).fill(-120)])
  const [a, b, c] = rushGains(db, [[0, 10], [10, 20], [20, 30]])
  near(Math.round(20 * Math.log10(a)), -6)
  assert.equal(b, 1)
  assert.equal(c, 1)
  assert.equal(rushGains(db, [[0, 10], [10, 20]]).length, 2)
})

test('a voice read by ElevenLabs: its characters become words, times from first to last letter', () => {
  const chars = [..."Bonjour, d'autres  12\u202f025."]
  const start = chars.map((_, i) => i * 0.1), end = chars.map((_, i) => i * 0.1 + 0.08)
  assert.deepEqual(alignedWords({ characters: chars, character_start_times_seconds: start, character_end_times_seconds: end }), [
    { w: 'Bonjour,', t0: 0, t1: 0.78 },
    { w: "d'autres", t0: 0.9, t1: 1.68 },
    { w: '12\u202f025.', t0: 1.9, t1: 2.58 },
  ])
})
