// Rule packs: one Markdown file per way of editing (rules/<name>.md), frontmatter + instructions for Claude.
import fs from 'node:fs'
import path from 'node:path'

// engine defaults: a source is transcribed but kept whole, framed centered, no music
export const DEFAULTS = { transcribe: true, face_framing: false, speed: 1, breaths: null, captions: false, music: false, sfx: false }

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

// dirs: [[origin, dir], …] in rising priority; a pack is named after its file, a later one replaces an earlier one
export function listPacks(dirs) {
  const packs = {}
  for (const [origin, dir] of dirs) {
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []) {
      if (!f.endsWith('.md')) continue
      const name = f.slice(0, -3), file = path.join(dir, f)
      packs[name] = { ...parsePack(fs.readFileSync(file, 'utf8')), name, file, origin: packs[name] ? `${origin} (overrides ${packs[name].origin})` : origin }
    }
  }
  return packs
}

// defaults < packs in the chosen order: only the keys a pack declares win, the last pack wins
export function mergeParams(packs, active) {
  const missing = active.filter(n => !packs[n])
  if (missing.length) throw new Error(`unknown rules pack: ${missing.join(', ')} (known: ${Object.keys(packs).join(', ') || 'none'})`)
  return Object.assign({}, DEFAULTS, ...active.map(n => packs[n].params))
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
