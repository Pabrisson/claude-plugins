// Rule packs: one Markdown file per way of editing (rules/<name>.md), frontmatter + instructions for Claude.
import fs from 'node:fs'
import path from 'node:path'

// engine defaults: a source is transcribed but kept whole, framed centered, no music
export const DEFAULTS = { transcribe: true, face_framing: false, speed: 1, breaths: null, captions: false, music: false, sfx: false }

// the params with a meaning: the engine's, and the numbers `check` measures. Any other key is Claude's alone
const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v)
const bool = [v => typeof v === 'boolean', 'true or false']
const secs = [v => typeof v === 'number' && v > 0, 'seconds above 0']
const range = [v => Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'number' && x >= 0) && v[0] <= v[1], '[min, max] in seconds']
export const PARAMS = {
  transcribe: bool, face_framing: bool, captions: bool, music: bool, sfx: bool, cta: bool, chapters: bool,
  speed: [v => typeof v === 'number' && v >= 0.5 && v <= 2, 'a number from 0.5 to 2'],
  breaths: [v => v === null || (isObject(v) && Object.values(v).every(x => typeof x === 'number' && x >= 0)), '{"sentence": s, "comma": s} or null'],
  graphics: [v => v === 'lead' || v === 'support', '"lead" or "support"'],
  max_static: secs, hook: secs, end_screen: secs, duration: range, shot: range,
  read: [v => isObject(v) && secs[0](v.word) && secs[0](v.min), '{"word": s, "min": s}'],
}

export function paramErrors(params) {
  if (!isObject(params)) return ['params: not a JSON object on one line']
  return Object.entries(params).filter(([k, v]) => PARAMS[k] && !PARAMS[k][0](v)).map(([k, v]) => `${k}: ${JSON.stringify(v)} is not ${PARAMS[k][1]}`)
}

// frontmatter is `key: value` lines, the value inline JSON (a plain string otherwise): no YAML
export function parsePack(text) {
  const m = text.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  const meta = {}
  for (const line of (m?.[1] ?? '').split('\n')) {
    const i = line.indexOf(':')
    if (i < 1) continue
    const v = line.slice(i + 1).trim()
    try { meta[line.slice(0, i).trim()] = JSON.parse(v) } catch { meta[line.slice(0, i).trim()] = v }
  }
  return { ...meta, params: meta.params ?? {}, body: m ? m[2] : text }
}

// dirs: [[origin, dir], …] in rising priority; a pack is named after its file, a later one replaces an earlier one.
// `extends: <name>` starts from that pack (from the one it replaces, for the same name): its params, then its text.
export function listPacks(dirs) {
  const packs = {}
  for (const [origin, dir] of dirs) {
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
      if (!f.endsWith('.md')) continue
      const name = f.slice(0, -3), file = path.join(dir, f), prev = packs[name]
      packs[name] = { ...parsePack(fs.readFileSync(file, 'utf8')), name, file, origin: prev ? `${origin} (overrides ${prev.origin})` : origin, prev }
    }
  }
  const resolve = (pk, seen) => {
    const errors = paramErrors(pk.params), own = { ...pk, params: errors.some(e => e.startsWith('params:')) ? {} : pk.params, errors }
    if (!pk.extends) return own
    const base = pk.extends === pk.name ? pk.prev : packs[pk.extends]
    if (!base || seen.includes(base.file)) return { ...own, errors: [...errors, `extends ${pk.extends}: ${base ? 'a loop' : 'no such pack'}`] }
    const b = resolve(base, [...seen, base.file])
    return { ...own, params: { ...b.params, ...own.params }, body: `${b.body.trimEnd()}\n\nFrom ${pk.file}, these lines win over the ones above:\n\n${pk.body}`, errors: [...b.errors, ...errors] }
  }
  return Object.fromEntries(Object.entries(packs).map(([name, pk]) => [name, resolve(pk, [pk.file])]))
}

// one pack per video: the defaults, then the keys the pack declares
export function mergeParams(packs, name) {
  if (!name) return { ...DEFAULTS }
  const pk = packs[name]
  if (!pk) throw new Error(`unknown rules pack: ${name} (known: ${Object.keys(packs).join(', ') || 'none'})`)
  if (pk.errors.length) throw new Error(`rules pack ${name} (${pk.file}): ${pk.errors.join('; ')}`)
  return { ...DEFAULTS, ...pk.params }
}

// rules.json ({ active, params, overrides }) → the params the engine follows
export function effective(rules, warn = msg => console.warn(`warning: ${msg}`)) {
  const p = { ...DEFAULTS, ...rules.params, ...rules.overrides }
  if (!p.transcribe) {
    if (p.breaths) { warn('breaths needs transcribe: true, ignored'); p.breaths = null }
    if (p.captions) { warn('captions needs transcribe: true, ignored'); p.captions = false }
  }
  return p
}

const clock = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`
const r2 = x => Math.round(x * 100) / 100

// The pack's numbers measured on the edit, before Claude looks at the stills: [[ok, message], …].
// duration, joins (the takes' joins), parts and screen lines in VIDEO seconds; cuts (edit.json) and words in SOURCE
// seconds. A visual change is a join, or a part() or clip() starting or ending: what moves inside them is not seen.
export function checkEdit(p, { duration, cuts, words, screen, joins, parts, scene }) {
  const found = [], of = kind => parts.filter(x => x.kind === kind)
  const say = (ok, msg) => found.push([ok, msg])
  if (p.duration) say(duration >= p.duration[0] && duration <= p.duration[1], `duration: ${r2(duration)} s, the pack wants ${p.duration[0]} to ${p.duration[1]} s`)
  const clipped = cuts.flat().flatMap(t => words.filter(w => t > w.t0 + 0.04 && t < w.t1 - 0.04).map(w => `cut at ${t} s falls inside "${w.w}" (${w.t0} to ${w.t1} s)`))
  if (words.length && cuts.length) say(!clipped.length, clipped.length ? clipped.join('; ') : 'no cut inside a word')
  if (p.hook) {
    const h = of('hook')[0]
    say(h?.t0 <= p.hook, h ? `hook: part('hook') starts at ${r2(h.t0)} s, the pack wants it before ${p.hook} s` : `hook: no part('hook', …) declared, the pack wants it before ${p.hook} s`)
  }
  if (p.cta) {
    const c = of('cta').at(-1), before = duration - (p.end_screen ?? 0) - 5
    say(c?.t1 >= before, c ? `CTA ends at ${r2(c.t1)} s${c.t1 < before ? `, more than 5 s before the ${p.end_screen ? 'end screen' : 'end'}` : ''}` : "CTA: no part('cta', …) declared")
  }
  if (p.end_screen) {
    const e = of('end-screen').at(-1)
    say(!!e && e.t1 >= duration - 0.05 && e.t1 - e.t0 >= p.end_screen - 0.05, `end screen: ${e ? `part('end-screen') from ${r2(e.t0)} to ${r2(e.t1)} s` : "no part('end-screen', …)"}, the pack wants the last ${p.end_screen} s`)
  }
  if (p.max_static) {
    const marks = [0, duration, ...joins, ...parts.flatMap(x => [x.t0, x.t1])].filter(t => t >= 0 && t <= duration).sort((a, b) => a - b)
    const still = marks.slice(1).map((t, i) => [marks[i], t]).filter(([a, b]) => b - a > p.max_static)
    say(!still.length, still.length ? `max_static ${p.max_static} s: no cut, clip or part() starts or ends ${still.map(([a, b]) => `from ${r2(a)} s to ${r2(b)} s (${r2(b - a)} s)`).join(', ')}: check that the picture moves there` : `max_static ${p.max_static} s: a cut, clip or part() at least every ${p.max_static} s`)
  }
  if (p.shot) {
    const clips = of('clip'), off = clips.map((c, i) => [c, Math.min(c.t1, clips[i + 1]?.t0 ?? Infinity) - c.t0]).filter(([, d]) => d < p.shot[0] - 0.05 || d > p.shot[1] + 0.05)
    if (clips.length) say(!off.length, off.length ? off.map(([c, d]) => `clip ${c.id} at ${r2(c.t0)} s lasts ${r2(d)} s (shot: ${p.shot[0]} to ${p.shot[1]} s)`).join('; ') : `every clip lasts ${p.shot[0]} to ${p.shot[1]} s`)
  }
  if (p.read && screen.length) {
    const fast = screen.filter(x => x.v1 - x.v0 < Math.max(p.read.min, p.read.word * x.w.split(/\s+/).length) - 0.05)
    say(!fast.length, fast.length ? fast.map(x => `"${x.w}" is up ${r2(x.v1 - x.v0)} s, ${r2(Math.max(p.read.min, p.read.word * x.w.split(/\s+/).length))} s needed to read it`).join('; ') : 'every text stays up long enough to be read')
  }
  if (p.chapters) {
    const seqs = of('sequence'), short = seqs.filter(x => x.t1 - x.t0 < 10)
    say(seqs.length >= 3, `chapters: ${seqs.length} chapters, YouTube needs 3 or more (one part('sequence') each)`)
    if (seqs.length) say(seqs[0].t0 <= 0.05, `chapters: the first starts at ${r2(seqs[0].t0)} s, YouTube needs 0:00`)
    for (const x of short) say(false, `chapter "${x.name ?? '(no name)'}" lasts ${r2(x.t1 - x.t0)} s, YouTube needs 10 s or more`)
    if (seqs.length) say(true, `chapters for the description:\n${seqs.map(x => `${clock(x.t0)} ${x.name ?? ''}`).join('\n')}`)
  }
  if (p.captions) {
    const has = /\bcaptions\(/.test(scene)
    say(has, has ? 'captions() in the scene' : 'captions: true but the scene never calls captions()')
  }
  return found
}
