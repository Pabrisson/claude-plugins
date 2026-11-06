// A case's vault: notes whose properties the engine sets key by key and whose managed blocks
// (%% osint:begin <name> %% … %% osint:end <name> %%) it rewrites, the rest of the note left byte for byte; the
// Journal, which only grows; the canvas, whose placed nodes never move; Obsidian's minimal config.
import fs from 'node:fs'
import path from 'node:path'
import { KINDS } from './kinds.js'
import { readJson, writeAtomic, writeJson } from './util.js'
import { frontText, parseFront, propsOf, setFront, splitNote } from './yaml.js'

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const blockRe = name => new RegExp(`%% osint:begin ${esc(name)} %%[^\\n]*\\n([\\s\\S]*?)%% osint:end ${esc(name)} %%`)

export function readNote(file) {
  let text = null
  try { text = fs.readFileSync(file, 'utf8') } catch (e) { if (e.code !== 'ENOENT') throw e }
  if (text == null) return { exists: false, props: {}, body: '', entries: [], text: null }
  const { front, body } = splitNote(text), entries = parseFront(front)
  return { exists: true, props: propsOf(entries), body, entries, text }
}
export function getBlock(body, name) {
  const m = blockRe(name).exec(body)
  return m ? m[1].replace(/\r?\n$/, '') : null
}
export function setBlock(body, name, content) {
  const inner = String(content).replace(/\s+$/, '')
  const block = `%% osint:begin ${name} %%\n${inner ? `${inner}\n` : ''}%% osint:end ${name} %%`
  return blockRe(name).test(body) ? body.replace(blockRe(name), () => block) : `${body.replace(/\s*$/, '')}\n\n${block}\n`
}
// props: only these keys change (undefined drops one); blocks: these blocks are replaced; create: the body of a new
// note. The file is read again just before the rename: an edit saved meanwhile (Obsidian) is merged, never lost.
export function writeNote(file, { props = {}, blocks = {}, create = '' } = {}, hooks = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const old = readNote(file), entries = setFront(old.entries, props)
    let body = old.exists ? old.body : create
    for (const [name, content] of Object.entries(blocks)) body = setBlock(body, name, content)
    const front = frontText(entries)
    const text = `---\n${front}${front ? '\n' : ''}---\n${body}`
    if (old.exists && text === old.text) return false
    hooks.beforeWrite?.()
    const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
    if (now !== old.text) continue
    writeAtomic(file, text)
    return true
  }
  throw new Error(`${file} keeps changing while the engine writes it: try again`)
}

const pad = n => String(n).padStart(2, '0')
export const localDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const localTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
// one line per entry, under a heading per day, with an Obsidian block id that notes cite: [[Journal#^j042]]
export function appendJournal(dir, { at = new Date(), kind, text, id }) {
  const file = path.join(dir, 'Journal.md')
  if (!fs.existsSync(file)) fs.writeFileSync(file, '# Journal\n')
  const have = fs.readFileSync(file, 'utf8'), day = localDate(at)
  const last = [...have.matchAll(/^## (\d{4}-\d{2}-\d{2})\s*$/gm)].at(-1)?.[1]
  const line = `- ${localTime(at)} · ${kind} · ${String(text).replace(/\s*\n\s*/g, ' ').trim()} ^${id}\n`
  fs.appendFileSync(file, (have.endsWith('\n') ? '' : '\n') + (last === day ? '' : `\n## ${day}\n\n`) + line)
}
export function journalIds(dir) {
  try { return new Set([...fs.readFileSync(path.join(dir, 'Journal.md'), 'utf8').matchAll(/\^(j\d+)\s*$/gm)].map(m => m[1])) } catch { return new Set() }
}

// JSON Canvas 1.0: a column per entity kind; a node already there is never moved
const COLUMN = Object.keys(KINDS), W = 260, H = 80, DX = 320, DY = 120
export function addCanvas(dir, { nodes = [], edges = [] }) {
  const file = path.join(dir, 'Graph.canvas'), c = readJson(file, { nodes: [], edges: [] })
  c.nodes ??= []; c.edges ??= []
  let changed = false
  for (const n of nodes) {
    if (c.nodes.some(x => x.id === n.id)) continue
    const col = Math.max(0, COLUMN.indexOf(n.kind)), x = col * DX
    const y = c.nodes.filter(m => m.x === x).length * DY
    c.nodes.push({ id: n.id, type: 'file', file: n.file, x, y, width: W, height: H })
    changed = true
  }
  for (const e of edges) if (!c.edges.some(x => x.id === e.id)) { c.edges.push(e); changed = true }
  if (changed) writeJson(file, c)
  return changed
}
export function writeObsidianConfig(dir) {
  const d = path.join(dir, '.obsidian')
  if (!fs.existsSync(path.join(d, 'app.json'))) writeJson(path.join(d, 'app.json'), { attachmentFolderPath: 'Evidence', alwaysUpdateLinks: true })
  if (!fs.existsSync(path.join(d, 'graph.json'))) writeJson(path.join(d, 'graph.json'), {
    colorGroups: Object.entries(KINDS).map(([k, v]) => ({ query: `tag:#entity/${k}`, color: { a: 1, rgb: parseInt(v.color.slice(1), 16) } })),
  })
}
