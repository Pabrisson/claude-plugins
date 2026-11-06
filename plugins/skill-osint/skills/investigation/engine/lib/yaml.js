// The frontmatter of an Obsidian note: a flat map of properties. parseFront keeps each entry with its own lines, so
// that setFront rewrites only the keys it changes and leaves the others byte for byte (a comment, a nested map, a |
// block, a list written inline). The engine writes scalars and lists only.

export function splitNote(text) {
  const t = text.replace(/^﻿/, '')
  const m = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/.exec(t)
  return m ? { front: m[1] ?? '', body: t.slice(m[0].length), had: true } : { front: '', body: t, had: false }
}

export function parseFront(front) {
  const entries = []
  for (const line of front === '' ? [] : front.split(/\r?\n/)) {
    const m = /^(?![\s#-])([^:]+?):(?:[ \t]+(.*))?$/.exec(line)
    if (m) entries.push({ key: m[1].trim().replace(/^(["'])(.*)\1$/, '$2'), inline: m[2] ?? '', lines: [line] })
    else if (entries.length && entries.at(-1).key != null) entries.at(-1).lines.push(line)
    else entries.push({ key: null, lines: [line] })
  }
  for (const e of entries) if (e.key != null) e.value = valueOf(e)
  return entries
}

function valueOf({ inline, lines }) {
  const rest = lines.slice(1).filter(l => l.trim() && !/^\s*#/.test(l))
  if (!rest.length) return flow(inline)
  if (inline.trim() === '' && rest.every(l => /^\s*-(\s|$)/.test(l))) return rest.map(l => scalar(l.replace(/^\s*-\s?/, '')))
  // a structure this reader does not take: kept as it is
  return { raw: lines.join('\n') }
}
function flow(s) {
  const t = s.trim()
  if (t.startsWith('[') && t.endsWith(']')) return splitFlow(t.slice(1, -1)).map(scalar)
  if (t.startsWith('{') || /^[|>][+-]?\d*$/.test(t)) return { raw: t }
  return scalar(t)
}
function splitFlow(s) {
  const out = []
  let cur = '', q = null
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null } else if (ch === '"' || ch === "'") { q = ch; cur += ch } else if (ch === ',') { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out.filter(x => x.trim() !== '')
}
function scalar(s) {
  const t = s.trim()
  let m
  if ((m = /^"((?:[^"\\]|\\.)*)"/.exec(t))) { try { return JSON.parse(`"${m[1]}"`) } catch { return m[1] } }
  if ((m = /^'((?:[^']|'')*)'/.exec(t))) return m[1].replace(/''/g, "'")
  const v = t.replace(/[ \t]+#.*$/, '')
  if (v === '' || v === '~' || v === 'null') return null
  if (v === 'true' || v === 'false') return v === 'true'
  if (/^-?\d+(\.\d+)?$/.test(v) && !/^-?0\d/.test(v)) return Number(v)
  return v
}

const PLAIN = /^[^\s\-?:,[\]{}#&*!|>'"%@`][^:#\n]*$/
const AMBIGUOUS = /^(true|false|null|~|yes|no|on|off|-?\d+(\.\d+)?([eE][-+]?\d+)?)$/i
// a value as YAML: plain when it reads back the same, else double-quoted (JSON's escapes are YAML's)
export function quote(v) {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const s = String(v)
  return PLAIN.test(s) && !AMBIGUOUS.test(s) && s === s.trim() ? s : JSON.stringify(s)
}
export function entryLines(key, v) {
  const k = /^[^\s#:'"-][^:]*$/.test(key) && key === key.trim() ? key : JSON.stringify(key)
  if (Array.isArray(v)) return v.length ? [`${k}:`, ...v.map(x => `  - ${quote(x) ?? ''}`.trimEnd())] : [`${k}: []`]
  const q = quote(v)
  return [q == null ? `${k}:` : `${k}: ${q}`]
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
export function setFront(entries, changes) {
  const out = entries.map(e => ({ ...e, lines: [...e.lines] }))
  for (const [key, v] of Object.entries(changes)) {
    const i = out.findIndex(e => e.key === key)
    if (v === undefined) { if (i >= 0) out.splice(i, 1); continue }
    if (i >= 0 && same(out[i].value, v)) continue
    const e = { key, value: v, lines: entryLines(key, v) }
    // a comment that followed the old entry stays after the new one
    if (i >= 0) { e.lines.push(...out[i].lines.slice(1).filter(l => /^\s*#/.test(l))); out[i] = e } else out.push(e)
  }
  return out
}
export const propsOf = entries => Object.fromEntries(entries.filter(e => e.key != null).map(e => [e.key, e.value]))
export const frontText = entries => entries.flatMap(e => e.lines).join('\n')
