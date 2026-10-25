// Source ↔ video time, shared by Node and the browser. A source video keeps `segments` (source seconds)
// minus the spec's manual `cut` ranges, played at `speed`. Without a source the timeline is the identity.

const ms = x => Math.round(x * 1000) / 1000

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

// The source's still stretches [[a, b], …] as they play once cut: the seconds kept of each (video) and the words
// left over them, for the ones kept `min` s or more.
export function stillStretches(freezes, tl, words, min) {
  return freezes.map(([a, b]) => ({
    a, b, kept: ms(tl.toVideo(b) - tl.toVideo(a)),
    said: words.filter(w => w.t1 > a && w.t0 < b && tl.toVideo(w.t1) > tl.toVideo(w.t0)).map(w => w.w).join(' '),
  })).filter(x => x.kept >= min)
}
