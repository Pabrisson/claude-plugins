// Source ↔ video time, shared by Node and the browser. A source video keeps `segments` (source seconds)
// minus the spec's manual `cut` ranges, played at `speed`. Without a source the timeline is the identity.
// Also the levels of the source's sound that make the segments: its silences, and each rush's speech level; and the
// words of a generated voice.

const ms = x => Math.round(x * 1000) / 1000
const pct = (db, p) => db.toSorted((a, b) => a - b)[Math.floor(db.length * p)]

// the level of mono 16-bit PCM at 48 kHz in 10 ms windows (dBFS)
export function windowDb(pcm) {
  const win = 480, db = new Float64Array(Math.floor(pcm.length / win))
  for (let k = 0; k < db.length; k++) {
    let s = 0
    for (let j = k * win; j < (k + 1) * win; j++) s += pcm[j] * pcm[j]
    db[k] = 10 * Math.log10(s / win / 32768 ** 2 + 1e-12)
  }
  return db
}

// something to hear (a voice, even under noise or music), not a silent or empty track
export const audible = db => db.length > 0 && pct(db, 0.95) > -50

// Silent stretches (≥ 120 ms, in seconds): quieter than 35 dB under the speech level, yet 10 dB over the noise
// floor. null when there is no speech-like contrast (silence, steady noise, a voice over music).
// ponytail: fixed dB knobs tuned on clean voice, expose them in the pack's params if real rooms need it
export function silences(db) {
  if (!db.length) return null
  const floor = pct(db, 0.1), loud = pct(db, 0.95)
  if (loud - floor < 20) return null
  const thr = Math.max(floor + 10, loud - 35), found = []
  let start = -1
  for (let i = 0; i <= db.length; i++) {
    const quiet = i < db.length && db[i] < thr
    if (quiet && start < 0) start = i
    if (!quiet && start >= 0) { if (i - start >= 12) found.push([start / 100, i / 100]); start = -1 }
  }
  return found
}

// The gain that brings each rush's speech ([a, b] source seconds) down to the level of the quietest one (never up:
// no clipping, the mix brings the whole voice up), 20 dB at most; 1 for a rush with nothing to hear.
// ponytail: speech level = 90th percentile of 10 ms windows, LUFS per rush if it misjudges different voices
export function rushGains(db, spans) {
  const levels = spans.map(([a, b]) => {
    const part = db.subarray(Math.floor(a * 100), Math.ceil(b * 100))
    return audible(part) ? pct(part, 0.9) : null
  })
  const low = Math.min(...levels.filter(x => x !== null))
  return levels.map(l => (l === null ? 1 : 10 ** (Math.max(-20, low - l) / 20)))
}

// index of the last value <= x in a sorted array (0 when x is before them all)
function last(arr, x) {
  let lo = 0, hi = arr.length - 1
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1
    if (arr[m] <= x) lo = m
    else hi = m - 1
  }
  return lo
}

// tl: assets/timeline.json ({ fps, speed, segments }) or null without a source
export function makeTimeline(tl, cut = []) {
  if (!tl) return { speed: 1, segments: null, duration: null, toVideo: t => t, toSource: t => t }
  const speed = tl.speed || 1
  // boundaries on the frame grid, so video frames and voice samples stay in sync across joins
  const snap = tl.fps ? t => Math.round(t * tl.fps) / tl.fps : t => t
  let segs = tl.segments
  for (const [c0, c1] of cut) segs = segs.flatMap(([a, b]) => [[a, Math.min(b, c0)], [Math.max(a, c1), b]].filter(([x, y]) => y > x))
  segs = segs.map(([a, b]) => [snap(a), snap(b)]).filter(([a, b]) => b > a)
  if (!segs.length) throw new Error('the cuts remove the whole video')
  const heads = segs.map(s => s[0]), starts = []
  let total = 0
  for (const [a, b] of segs) { starts.push(total); total += b - a }
  return {
    speed,
    segments: segs,
    duration: total / speed,
    // a source time inside a cut lands on the next kept frame
    toVideo(t) {
      const i = last(heads, t), [a, b] = segs[i]
      return (starts[i] + Math.min(Math.max(t - a, 0), b - a)) / speed
    },
    toSource(v) {
      const s = v * speed, i = last(starts, s), [a, b] = segs[i]
      return a + Math.min(Math.max(s - starts[i], 0), b - a)
    },
  }
}

// Kept source segments once each silence [a, b] shrinks to a breath: `sentence` after .!?…, `comma` otherwise.
// Silences at the very start and end go entirely.
export function keepSegments(silences, words, breaths, duration) {
  const segs = []
  let t = 0
  for (const [a, b] of silences) {
    if (words.some(w => w.t0 < a && w.t1 > b)) continue // a stop consonant inside a word, not a pause
    const before = words.findLast(w => w.t0 < a)?.w ?? ''
    const keep = (/[.!?…][»"”)]*$/.test(before) ? breaths.sentence : breaths.comma) ?? 0.05
    const c0 = a <= 0 ? 0 : a + keep / 2, c1 = b >= duration - 0.05 ? duration : b - keep / 2
    if (c1 - c0 < 0.02) continue
    if (c0 > t) segs.push([ms(t), ms(c0)])
    t = c1
  }
  if (duration > t) segs.push([ms(t), ms(duration)])
  return segs
}

// The words of a voice ElevenLabs read, from its timing of each character: `{ w, t0, t1 }` in seconds of the voice.
// A no-break space (12 000) keeps a word whole
export function alignedWords({ characters, character_start_times_seconds: t0, character_end_times_seconds: t1 }) {
  const words = []
  let cur = null
  characters.forEach((c, i) => {
    if (/[^\S\u00a0\u202f]/.test(c)) cur = null
    else if (cur) Object.assign(cur, { w: cur.w + c, t1: ms(t1[i]) })
    else words.push((cur = { w: c, t0: ms(t0[i]), t1: ms(t1[i]) }))
  })
  return words
}

// The source's still stretches [[a, b], …] as they play once cut: the seconds kept of each (video) and the words
// left over them, for the ones kept `min` s or more.
export function stillStretches(freezes, tl, words, min) {
  return freezes.map(([a, b]) => ({
    a, b, kept: ms(tl.toVideo(b) - tl.toVideo(a)),
    said: words.filter(w => w.t1 > a && w.t0 < b && tl.toVideo(w.t1) > tl.toVideo(w.t0)).map(w => w.w).join(' '),
  })).filter(x => x.kept >= min)
}
