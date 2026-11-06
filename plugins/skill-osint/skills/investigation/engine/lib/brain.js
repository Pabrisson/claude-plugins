// A case's second brain as the dashboard and the agent read it: every note with its properties, links, blocks and
// backlinks, the analysis, the leads; and one summary per case for the home page.
import fs from 'node:fs'
import path from 'node:path'
import { descendants, listCases, parents, readCase, rootOf } from './case.js'
import { cluesOf, hypsOf, leadsOf, ranking } from './cycle.js'
import { lastEvents } from './events.js'
import { haversineKm } from './geo.js'
import { normalize, placePoint, samePlace } from './kinds.js'
import { reverseOf } from './records.js'
import { findType, getType } from './types.js'
import { fail, readJson } from './util.js'
import { readNote } from './vault.js'

export function vaultFiles(dir) {
  const out = []
  const walk = rel => {
    for (const d of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      if (d.name.startsWith('.') || d.name.endsWith('.tmp')) continue
      const r = rel ? `${rel}/${d.name}` : d.name
      if (d.isDirectory()) walk(r); else out.push(r)
    }
  }
  walk('')
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}
const LINK = /(!?)\[\[([^\]|#^\n]*)(#\^?[^\]|\n]*)?(?:\|[^\]\n]*)?\]\]/g
export const linksOf = text => [...String(text).matchAll(LINK)].map(m => ({ target: m[2].trim(), anchor: m[3] ? m[3].slice(1) : null, embed: m[1] === '!' }))
// Obsidian's resolution: a path from the vault's root (with or without .md), else the file of that name
export function resolver(files) {
  const byPath = new Map(), byName = new Map()
  for (const f of files) {
    const lower = f.toLowerCase(), noExt = lower.replace(/\.md$/, '')
    byPath.set(lower, f); byPath.set(noExt, f)
    for (const n of [path.posix.basename(lower), path.posix.basename(noExt)]) if (!byName.has(n)) byName.set(n, f)
  }
  return target => {
    if (!target) return null
    const t = target.replace(/\\/g, '/').toLowerCase()
    return byPath.get(t) ?? byPath.get(`${t}.md`) ?? byName.get(path.posix.basename(t)) ?? null
  }
}
const excerptOf = body => (body.split(/\r?\n/).map(l => l.trim()).find(l => l && !l.startsWith('#') && !l.startsWith('%%')) ?? '').slice(0, 160)

export const newCount = c => (c.refreshes ?? []).filter(r => !c.seen_at || r.at > c.seen_at).reduce((n, r) => n + (r.added ?? 0), 0)
export function analysisOf(dir) {
  // a case whose type is not loaded (a private type removed, or refused while it is being edited) still opens: no ranking
  const m = findType(readCase(dir).type, path.dirname(dir))
  if (!m) return { ranked: {}, frontier: null, cells: [], exclusions: [] }
  const r = ranking(dir, m)
  return { ranked: r.ranked, frontier: r.frontier, cells: r.cells, exclusions: r.exclusions }
}

export function indexCase(home, slug) {
  const dir = path.join(home, slug), files = vaultFiles(dir), resolve = resolver(files), notes = [], backlinks = {}
  const back = (to, b) => { if (to && to !== b.from) (backlinks[to] ??= []).push(b) }
  for (const f of files.filter(x => x.endsWith('.md'))) {
    const st = fs.statSync(path.join(dir, f)), n = readNote(path.join(dir, f))
    const links = [...linksOf(n.body), ...linksOf(JSON.stringify(n.props))].map(l => ({ ...l, path: l.target === '' ? f : resolve(l.target) }))
    notes.push({
      path: f, title: /^# (.+)$/m.exec(n.body)?.[1].trim() ?? path.posix.basename(f, '.md'), folder: f.includes('/') ? f.split('/')[0] : '',
      props: n.props, tags: [].concat(n.props.tags ?? []).map(String), links,
      blocks: [...n.body.matchAll(/\^([\w-]+)\s*$/gm)].map(m => m[1]), headings: [...n.body.matchAll(/^#{1,6} (.+)$/gm)].map(m => m[1].trim()),
      mtime: st.mtime.toISOString(), size: st.size, excerpt: excerptOf(n.body),
    })
    const lines = (n.text ?? '').split(/\r?\n/)
    lines.forEach((line, i) => { for (const l of linksOf(line)) back(l.target === '' ? null : resolve(l.target), { from: f, line: i + 1, text: line.trim().slice(0, 200) }) })
  }
  const c = readCase(dir), leads = leadsOf(dir), props = notes.find(n => n.path === 'Case.md')?.props ?? {}
  const count = folder => notes.filter(n => n.folder === folder).length
  return {
    slug, dir, type: c.type, props, notes, files, backlinks, analysis: analysisOf(dir), leads, relations: c.relations,
    evidence: c.evidence, reverse: reverseOf(c), conclusion: c.conclusion, watch: c.watch ?? null, last: lastActivity(dir),
    counts: { entities: count('Entities'), sources: count('Sources'), clues: count('Clues'), hypotheses: count('Hypotheses'), leads_open: leads.filter(l => !l.done).length, new: newCount(c) },
  }
}

// the case's last activity for a person: the engine's own note writes are not news, an edit in the vault is
export const lastActivity = dir => lastEvents(dir, 40).reverse().find(e => !(e.kind === 'note.write' && e.by !== 'vault')) ?? null
const IMAGE = /\.(jpe?g|png|webp|gif|avif)$/i
const countMd = (dir, folder) => { try { return fs.readdirSync(path.join(dir, folder)).filter(f => f.endsWith('.md')).length } catch { return 0 } }
export function summaryOf(home, slug) {
  const dir = path.join(home, slug), c = readCase(dir), p = readNote(path.join(dir, 'Case.md'))
  let thumb = null
  try { thumb = fs.readdirSync(path.join(dir, 'Evidence')).filter(f => IMAGE.test(f)).sort()[0] ?? null } catch {}
  return {
    slug, type: c.type, title: /^# (.+)$/m.exec(p.body)?.[1].trim() ?? slug, status: p.props.status, phase: p.props.phase,
    confidence: p.props.confidence ?? null, answer: p.props.answer ?? null, created: c.created, last: lastActivity(dir),
    thumb: thumb && `Evidence/${thumb}`, parent: p.props.parent ?? null, children: p.props.children ?? [], new: newCount(c), watch: c.watch ?? null, workspace: c.workspace ?? 'default',
    counts: { entities: countMd(dir, 'Entities'), sources: countMd(dir, 'Sources'), leads_open: leadsOf(dir).filter(l => !l.done).length },
  }
}
export const summaries = home => listCases(home).map(slug => summaryOf(home, slug))

const fold = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const pct = x => `${Math.round(x * 100)} %`

export function context(home, slug) {
  const dir = path.join(home, slug), ix = indexCase(home, slug), p = ix.props, c = readCase(dir), m = getType(c.type, home)
  const r = ranking(dir, m), lines = []
  lines.push(`# ${slug} — ${m.label}: ${p.input}`, `question: ${p.question}`,
    // the phases and the [<type>:<action>] items are sections of this file, a plugin type's or a private one's
    `method: ${path.join(m.dir, 'method.md')}${m.private ? ' (a private type of this cases folder)' : ''}`)
  const frame = ['purpose', 'scope', 'noisy', 'image_may_leave', 'person', 'legal_basis'].filter(k => p[k] != null && p[k] !== '').map(k => `${k}: ${p[k]}`)
  if (frame.length) lines.push(`frame: ${frame.join(' · ')}`)
  lines.push(`status: ${p.status} · phase: ${p.phase ?? '—'}${p.answer ? ` · answer: ${p.answer} (${p.confidence})` : ''}`)
  // edited in the vault since the agent's last command: a vault event (the dashboard's watcher saw it), or a note
  // whose mtime no engine write carries (edited while no server watched)
  const since = c.agent_at ?? c.created, events = lastEvents(dir, 400)
  const engineMtimes = new Set(events.filter(e => e.kind === 'note.write' && e.by !== 'vault').map(e => `${e.path}|${e.mtime}`))
  const edited = [...new Set([
    ...events.filter(e => e.kind === 'note.write' && e.by === 'vault' && e.t > since).map(e => e.path),
    ...ix.notes.filter(n => n.path !== 'Journal.md' && n.mtime > since && !engineMtimes.has(`${n.path}|${fs.statSync(path.join(dir, n.path)).mtimeMs}`)).map(n => n.path),
  ])]
  const section = edited.length ? ['', "**Edited in the vault since the agent's last command:**", ...edited.slice(0, 12).map(x => `- ${x}`), ...(edited.length > 12 ? [`- … +${edited.length - 12} more`] : [])] : []
  lines.push(...section) // right after the status: a cap never cuts it
  const hyps = hypsOf(dir)
  if (hyps.length) {
    lines.push('', `hypotheses (frontier: ${r.frontier ?? '—'}):`)
    for (const [level, hs] of Object.entries(r.ranked)) for (const h of hs.slice(0, 4)) lines.push(`- ${h.id} ${hyps.find(x => x.id === h.id)?.title} — ${level}, ${h.status}, ${pct(h.share)}`)
  }
  const ents = ix.notes.filter(n => n.folder === 'Entities').map(n => ({ n, w: (ix.backlinks[n.path]?.length ?? 0) + [].concat(n.props.sources ?? []).length }))
    .sort((a, b) => b.w - a.w).slice(0, 10)
  if (ents.length) lines.push('', 'key entities:', ...ents.map(({ n }) => `- ${n.props.kind} ${n.props.value}${n.props.confidence ? ` (${n.props.confidence})` : ''}`))
  const open = leadsOf(dir).filter(l => !l.done)
  if (open.length) lines.push('', 'open leads:', ...open.slice(0, 6).map(l => `- ${l.id} ${l.label}${l.why ? ` — ${l.why}` : ''}`))
  const used = new Set(r.cells.map(x => x.clue)), loose = cluesOf(dir).filter(x => !used.has(x.id))
  if (loose.length) lines.push('', 'clues not weighed yet:', ...loose.slice(0, 6).map(x => `- ${x.id} (${x.status}) ${x.title}`))
  const journal = fs.readFileSync(path.join(dir, 'Journal.md'), 'utf8').split('\n').filter(l => l.startsWith('- ')).slice(-10)
  lines.push('', 'last Journal entries:', ...journal)
  const changed = c.refreshes.at(-1)
  if (changed) lines.push('', `last refresh ${changed.at.slice(0, 16)}: ${changed.added} added, ${changed.removed} removed, ${changed.changed} changed`)
  if (p.parent || (p.children ?? []).length) lines.push('', `related: ${[p.parent && `parent ${p.parent}`, ...(p.children ?? []).map(x => `child ${x}`)].filter(Boolean).join(', ')}`)
  // one investigation: the case at its top, and every case below this one (brain context -p <sub-case> for its details)
  const up = parents(home), root = rootOf(home, slug, up), below = descendants(home, slug, up)
  if (root !== slug) lines.push(`investigation: ${root} (its top case; brain context -p ${root} sums up all of it)`)
  if (below.length) {
    lines.push('', 'sub-cases (part of this investigation; brain search and brain entities -p cover them too):')
    for (const b of below) {
      const q = readNote(path.join(home, b.slug, 'Case.md')).props
      lines.push(`${'  '.repeat(b.depth - 1)}- ${b.slug} (${q.type}, ${q.status}${q.phase ? ` · ${q.phase}` : ''}, under ${b.parent})${q.answer ? `: ${q.answer} (${q.confidence ?? '—'})` : ''} — ${q.question}`)
    }
  }
  return lines.join('\n')
}

// -p <slug>: that case and the cases below it (one investigation); --all: every case of the folder
const scope = (home, slug, all) => (all ? listCases(home) : [slug, ...descendants(home, slug).map(x => x.slug)])
export function search(home, q, { slug, all, kind } = {}) {
  const terms = fold(q).split(/\s+/).filter(Boolean)
  if (!terms.length) fail('brain search "<words>"')
  const out = []
  for (const s of scope(home, slug, all)) {
    const dir = path.join(home, s)
    for (const f of vaultFiles(dir).filter(x => x.endsWith('.md'))) {
      const n = readNote(path.join(dir, f))
      if (kind && f.split('/')[0] !== kind && n.props.kind !== kind) continue
      const title = fold(/^# (.+)$/m.exec(n.body)?.[1] ?? f), props = fold(JSON.stringify(n.props)), body = fold(n.body)
      if (!terms.every(t => title.includes(t) || props.includes(t) || body.includes(t))) continue
      const score = terms.reduce((x, t) => x + (title.includes(t) ? 3 : 0) + (props.includes(t) ? 2 : 0) + (body.includes(t) ? 1 : 0), 0)
      const lines = (n.text ?? '').split(/\r?\n/), i = lines.findIndex(l => terms.some(t => fold(l).includes(t)))
      out.push({ slug: s, path: f, line: i + 1, text: (lines[i] ?? '').trim().slice(0, 160), score })
    }
  }
  return out.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
}

export function show(home, slug, ref) {
  const dir = path.join(home, slug), files = vaultFiles(dir)
  const j = /^Journal#\^(j\d+)$/.exec(ref ?? '')
  if (j) {
    const line = fs.readFileSync(path.join(dir, 'Journal.md'), 'utf8').split('\n').find(l => l.endsWith(`^${j[1]}`))
    if (!line) fail(`no Journal entry ${j[1]}`)
    return { journal: { id: j[1], line } }
  }
  const byId = /^[CHSE]\d{2,}$/.test(ref ?? '') && files.find(f => /^(Clues|Hypotheses|Sources)\//.test(f) && path.posix.basename(f).startsWith(`${ref} `))
  const rel = byId || resolver(files)(ref) || files.find(f => f.endsWith('.md') && fold(/^# (.+)$/m.exec(readNote(path.join(dir, f)).body)?.[1] ?? '') === fold(ref))
  if (!rel || !rel.endsWith('.md')) fail(`no note ${ref} in ${slug} (an id like C03, a path, a title, or Journal#^j042)`)
  const ix = indexCase(home, slug), n = readNote(path.join(dir, rel))
  return { path: rel, props: n.props, body: n.body, backlinks: ix.backlinks[rel] ?? [], links: ix.notes.find(x => x.path === rel)?.links ?? [] }
}

// shared: found in two investigations or more (a case and its own sub-cases are one investigation)
export function entities(home, { slug, all, kind, shared } = {}) {
  const groups = new Map(), propsOf = new Map(), up = parents(home)
  for (const s of scope(home, slug, all)) {
    const dir = path.join(home, s)
    for (const f of vaultFiles(dir).filter(x => x.startsWith('Entities/') && x.endsWith('.md'))) {
      const p = readNote(path.join(dir, f)).props
      if (!p.kind || (kind && p.kind !== kind)) continue
      const key = normalize(p.kind, p.value, p)
      const g = groups.get(key) ?? { key, kind: p.kind, value: p.value, cases: [] }
      if (!g.cases.some(c => c.slug === s)) g.cases.push({ slug: s, path: f, root: rootOf(home, s, up) })
      groups.set(key, g)
      if (!propsOf.has(key)) propsOf.set(key, p)
    }
  }
  return mergePlaces([...groups.values()], propsOf).filter(g => !shared || new Set(g.cases.map(c => c.root)).size >= 2).sort((a, b) => a.key.localeCompare(b.key))
}
// § 2.7 for places: the places with an OpenStreetMap id stay as their key groups them; then each place without one
// joins the nearest kept place within 100 m (kinds.samePlace). A place that joined another never pulls a third one in:
// no chain of 100 m steps. A coarse place has no point and stays alone.
function mergePlaces(list, propsOf) {
  const places = list.filter(g => g.kind === 'place'), kept = []
  const withId = places.filter(g => propsOf.get(g.key)?.osm), without = places.filter(g => !propsOf.get(g.key)?.osm)
  for (const g of [...withId, ...without]) {
    const p = propsOf.get(g.key), at = placePoint(p)
    const host = p?.osm || !at ? null : kept.filter(k => samePlace(propsOf.get(k.key), p))
      .sort((a, b) => haversineKm(placePoint(propsOf.get(a.key)) ?? at, at) - haversineKm(placePoint(propsOf.get(b.key)) ?? at, at))[0]
    if (!host) { kept.push(g); continue }
    for (const c of g.cases) if (!host.cases.some(x => x.slug === c.slug)) host.cases.push(c)
  }
  return [...list.filter(g => g.kind !== 'place'), ...kept]
}
