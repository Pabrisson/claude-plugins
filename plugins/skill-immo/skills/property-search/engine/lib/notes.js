// The history of a listing's notes, as .diff files: each change of « Mes notes » is a unified diff (git's format, the
// notes as `notes.md`) in <search>/notes/<listing id>/<date>-<by>.diff, and listings.json keeps `notes_history`
// [{ date, by: user|agent|restore, diff: <its path in the search's folder> }], the last 30. A version (the notes before
// a change) is rebuilt by undoing the .diff from the current notes back to it (`versions`), for the dossier's
// « Restaurer ». No dependency: a line diff (the longest common subsequence) and its reverse are enough.
import fs from 'node:fs'
import path from 'node:path'

const KEEP = 30, MERGE_MS = 5 * 60e3, CONTEXT = 3
// ponytail: an O(n·m) table; two texts past 4 M line pairs are diffed as one block replaced (still a right .diff)
const CELLS = 4e6

// the lines of `a` and `b` as kept (' '), removed ('-') and added ('+'), the removed before the added
function ops(a, b) {
  let s = 0, e = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  while (e < a.length - s && e < b.length - s && a.at(-1 - e) === b.at(-1 - e)) e++
  const A = a.slice(s, a.length - e), B = b.slice(s, b.length - e), n = A.length, m = B.length, out = a.slice(0, s).map(x => [' ', x])
  if (n * m > CELLS) out.push(...A.map(x => ['-', x]), ...B.map(x => ['+', x]))
  else {
    // L[i][j]: the longest common subsequence of A[i..] and B[j..]
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
    for (let i = 0, j = 0; i < n || j < m;) {
      if (i < n && j < m && A[i] === B[j]) out.push([' ', A[i++]]), j++
      else if (i < n && (j === m || L[i + 1][j] >= L[i][j + 1])) out.push(['-', A[i++]])
      else out.push(['+', B[j++]])
    }
  }
  return [...out, ...a.slice(a.length - e).map(x => [' ', x])]
}

// The unified diff from the notes `a` to `b` (every line ending with its break, the last one too), 3 lines of context
export function unified(a, b, label = '') {
  const d = ops(a.split('\n'), b.split('\n')), at = []
  for (let k = 0, o = 0, n = 0; k < d.length; k++) { at.push([o, n]); if (d[k][0] !== '+') o++; if (d[k][0] !== '-') n++ }
  const groups = []
  d.forEach(([op], k) => { if (op === ' ') return; const g = groups.at(-1); if (g && k - g[1] <= 2 * CONTEXT) g[1] = k; else groups.push([k, k]) })
  const hunks = groups.map(([first, last]) => {
    const from = Math.max(0, first - CONTEXT), lines = d.slice(from, Math.min(d.length, last + CONTEXT + 1))
    const old = lines.filter(x => x[0] !== '+').length, now = lines.filter(x => x[0] !== '-').length
    const [o, n] = at[from]
    return [`@@ -${old ? o + 1 : o},${old} +${now ? n + 1 : n},${now} @@`, ...lines.map(([op, x]) => op + x)].join('\n')
  })
  return `--- a/notes.md\n+++ b/notes.md${label ? `\t${label}` : ''}\n${hunks.join('\n')}\n`
}

// a box ticked or not is the same line (a box may have been ticked since the change: ticks are no version)
const box = s => s.replace(/^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)\[[xX]\]/, '$1[ ]')
// where `want` lies in `lines` from `from`, the nearest to `near`; -1 if nowhere
function find(lines, want, from, near) {
  const last = lines.length - want.length, fits = p => p >= from && p <= last && want.every((x, j) => box(lines[p + j]) === box(x))
  for (let d = 0; near - d >= from || near + d <= last; d++) {
    if (fits(near - d)) return near - d
    if (fits(near + d)) return near + d
  }
  return -1
}

// The notes before the change `diff` made, from the notes `text` after it: its lines removed put back, its lines added
// taken out, the context kept as it is now (a box ticked since stays ticked). Throws when the notes no longer hold it.
export function unpatch(text, diff) {
  const lines = text.split('\n'), out = []
  let at = 0
  for (const h of diff.split(/^(?=@@ )/m).slice(1)) {
    const body = h.split('\n').slice(1).filter(x => /^[ +-]/.test(x)), after = body.filter(x => x[0] !== '-').map(x => x.slice(1))
    const start = +/^@@ -\d+(?:,\d+)? \+(\d+)/.exec(h)[1], i = find(lines, after, at, after.length ? start - 1 : start)
    if (i < 0) throw new Error('the notes no longer hold this change')
    out.push(...lines.slice(at, i))
    let k = i
    for (const x of body) {
      if (x[0] === ' ') out.push(lines[k++])
      else if (x[0] === '+') k++
      else out.push(x.slice(1))
    }
    at = i + after.length
  }
  return [...out, ...lines.slice(at)].join('\n')
}

const fileOf = (l, date, by) => `notes/${l.id}/${date.replace(/[:.]/g, '-')}-${by}.diff`
function writeDiff(dir, file, text) {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
  fs.writeFileSync(path.join(dir, file), text)
}
const readDiff = (dir, v) => fs.readFileSync(path.join(dir, v.diff), 'utf8')

// the two texts differ by one box only, `[ ]` against `[x]`
function ticked(a, b) {
  if (a.length !== b.length) return false
  let i = 0
  while (a[i] === b[i]) i++
  return a[i - 1] === '[' && a[i + 1] === ']' && /[ xX]/.test(a[i]) && /[ xX]/.test(b[i]) && a.slice(i + 1) === b.slice(i + 1)
}

// The listing's notes become `text`, the change kept as a .diff in the search's folder `dir`. None for a box ticked or
// unticked (a click undoes it), nor for the first notes (nothing before them); the user's saves less than 5 minutes
// after their last one are that one change, its .diff written again from the notes before the first.
export function setNotes(dir, l, text, by, now = new Date().toISOString()) {
  const before = l.notes ?? '', h = l.notes_history ?? [], last = h.at(-1)
  if (text === before) return
  l.notes = text
  if (ticked(before, text) || (!before.trim() && !h.length)) return
  if (by === 'user' && last?.by === 'user' && Date.parse(now) - Date.parse(last.date) < MERGE_MS) {
    try { return writeDiff(dir, last.diff, unified(unpatch(before, readDiff(dir, last)), text, `${last.date} ${by}`)) } catch { /* a change of its own */ }
  }
  const v = { date: now, by, diff: fileOf(l, now, by) }, kept = [...h, v]
  writeDiff(dir, v.diff, unified(before, text, `${now} ${by}`))
  for (const old of kept.slice(0, -KEEP)) fs.rmSync(path.join(dir, old.diff), { force: true })
  l.notes_history = kept.slice(-KEEP)
}

// The history with each version's notes, as the dossier restores them: the .diff undone from the current notes back,
// newest first; `notes: null` from a .diff that no longer applies (the notes edited by hand in listings.json) back
export function versions(dir, l) {
  const h = l.notes_history ?? [], out = []
  let text = l.notes ?? ''
  for (let i = h.length - 1; i >= 0; i--) {
    try { text = text == null ? null : unpatch(text, readDiff(dir, h[i])) } catch { text = null }
    out[i] = { ...h[i], notes: text }
  }
  return out
}

// A history of copies (before 1.39.0, { date, notes, by }) turned into .diff files, word for word: each copy against
// the next, the last against the current notes. Copies an older engine added after .diff ones are turned the same way,
// the .diff kept. True when `ls` changed (to be written).
export function upgradeNotes(dir, ls) {
  let changed = false
  const copy = v => typeof v?.notes === 'string'
  for (const l of ls) {
    const h = l.notes_history
    if (!h?.some(copy)) continue
    l.notes_history = h.map((v, i) => {
      if (!copy(v)) return v
      const diff = fileOf(l, v.date, v.by)
      writeDiff(dir, diff, unified(v.notes, copy(h[i + 1]) ? h[i + 1].notes : l.notes ?? '', `${v.date} ${v.by}`))
      return { date: v.date, by: v.by, diff }
    })
    changed = true
  }
  return changed
}
