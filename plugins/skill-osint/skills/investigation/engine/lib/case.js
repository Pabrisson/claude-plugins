// The cases folder and one case: its folder (a vault), .osint/case.json, the lock that the engine processes of one
// case share, the ids, the frame, the creation from its type's templates, the folder's .gitignore.
import fs from 'node:fs'
import path from 'node:path'
import { emit } from './events.js'
import { checkInputs, defaults, mainInput, shown } from './inputs.js'
import { CATEGORIES, isMinor, isStreetAddress, pursuitHit, sensitiveHit } from './sensitive.js'
import { labels, template } from './templates.js'
import { typeLabelsOf } from './types.js'
import { evidence, evidenceFile } from './records.js'
import { accepts, fail, fakeApis, isUrl, nowIso, readJson, sleepSync, slugify, writeJson } from './util.js'
import { appendJournal, readNote, writeNote, writeObsidianConfig } from './vault.js'

export function homeDir(env = process.env, cwd = process.cwd()) {
  if (env.OSINT_DIR) return path.resolve(env.OSINT_DIR)
  // inside a private type's folder (the agent editing it): the cases folder that holds it
  const parts = cwd.split(path.sep), i = parts.lastIndexOf('.osint-types')
  if (i > 0) return parts.slice(0, i).join(path.sep) || path.sep
  return fs.existsSync(path.join(cwd, '.osint', 'case.json')) ? path.dirname(cwd) : cwd
}
export function listCases(home) {
  try {
    return fs.readdirSync(home, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && fs.existsSync(path.join(home, d.name, '.osint', 'case.json')))
      .map(d => d.name).sort()
  } catch { return [] }
}
export function caseDir(home, slug) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug ?? '')) fail(`which case? -p <slug> (${listCases(home).join(', ') || 'no case yet'})`)
  const dir = path.join(home, slug)
  if (!fs.existsSync(path.join(dir, '.osint', 'case.json'))) fail(`no case ${slug} in ${home}`)
  return dir
}
export const caseFile = dir => path.join(dir, '.osint', 'case.json')
export const readCase = dir => readJson(caseFile(dir))

// one lock per case (a folder made atomically), re-entrant in this process; a lock older than 30 s is stale
const held = new Map()
export function withLock(dir, fn) {
  const lock = path.join(dir, '.osint', 'lock')
  if (held.has(lock)) { held.set(lock, held.get(lock) + 1); try { return fn() } finally { held.set(lock, held.get(lock) - 1) } }
  for (let i = 0; ; i++) {
    try { fs.mkdirSync(lock); break } catch (e) {
      if (e.code !== 'EEXIST') throw e
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 30e3) { fs.rmSync(lock, { recursive: true, force: true }); continue } } catch {}
      if (i > 800) fail(`the case is locked by another command (${lock})`)
      sleepSync(25)
    }
  }
  held.set(lock, 1)
  try { return fn() } finally { held.delete(lock); fs.rmSync(lock, { recursive: true, force: true }) }
}
export const updateCase = (dir, fn) => withLock(dir, () => { const c = readCase(dir), r = fn(c); writeJson(caseFile(dir), c); return r })
export const nextId = (dir, prefix) => updateCase(dir, c => {
  c.counters[prefix] = (c.counters[prefix] ?? 0) + 1
  return `${prefix}${String(c.counters[prefix]).padStart(prefix === 'j' ? 3 : 2, '0')}`
})
// a case made or refreshed on the fake APIs says so (one Journal line, a flag the print view's footer reads): its
// results are the tests' fixtures, never to be taken for real ones
export function markFake(dir) {
  if (!fakeApis()) return
  journal(dir, 'fake', 'fake APIs')
  updateCase(dir, c => { c.fake_apis = true })
}
export const journal = (dir, kind, text) => withLock(dir, () => { const id = nextId(dir, 'j'); appendJournal(dir, { kind, text, id }); return id })
// a note the engine writes, with its event and the file's mtime after the write: the server's watcher compares it
// with the file's to tell the engine's writes from an edit saved in Obsidian
export const wrote = (dir, rel, by = process.env.OSINT_BY || 'engine') =>
  emit(dir, { kind: 'note.write', path: rel.split(path.sep).join('/'), by, mtime: fs.statSync(path.join(dir, rel)).mtimeMs })
export function writeCaseNote(dir, rel, spec, by) {
  const changed = withLock(dir, () => writeNote(path.join(dir, rel), spec))
  if (changed) wrote(dir, rel, by)
  return changed
}
export function caseLabels(dir) {
  const c = readCase(dir)
  return labels(readNote(path.join(dir, 'Case.md')).props.lang ?? 'en', typeLabelsOf(c.type, path.dirname(dir)))
}

// the person case a case belongs to: itself when its type is person, else the nearest ancestor of type person (the
// parent chain of Case.md); null outside such a case, or when the chain breaks (a parent deleted, a loop)
export function personRoot(dir) {
  const home = path.dirname(dir), seen = new Set()
  for (let d = dir; d && !seen.has(d) && seen.size < 32;) {
    seen.add(d)
    let p
    try {
      p = readNote(path.join(d, 'Case.md')).props
      if (readCase(d).type === 'person') return { slug: path.basename(d), name: String(p.input ?? '') }
    } catch { return null }
    d = p.parent ? path.join(home, String(p.parent)) : null
  }
  return null
}

const FRAME_KEYS = ['purpose', 'scope', 'person', 'legal_basis', 'image_may_leave', 'noisy']
const bool = (k, v) => (v === true || v === 'true' ? true : v === false || v === 'false' ? false : fail(`--frame ${k}=true|false`))
export function checkFrame(manifest, frame, question) {
  if (!question?.trim()) fail('the frame needs --question "<what the case must answer>"')
  for (const k of Object.keys(frame)) if (!FRAME_KEYS.includes(k)) fail(`unknown frame key ${k} (${FRAME_KEYS.join(', ')})`)
  const want = Object.fromEntries((manifest.frame ?? []).map(f => (typeof f === 'string' ? [f, {}] : [f.id, f])))
  const out = { question: question.trim(), purpose: frame.purpose || null, scope: frame.scope || null }
  if (want.person) {
    out.person = want.person.always ? true : frame.person == null ? false : bool('person', frame.person)
    // a type may propose the basis (company-fr: a public registry); the user's own wins
    const basis = String(frame.legal_basis ?? '').trim() || (out.person ? String(want.person.legal_basis ?? '').trim() : '')
    if (out.person && !basis) fail('a person as subject needs --frame legal_basis="<the GDPR legal basis>"')
    out.legal_basis = out.person ? basis : null
    // a person case is weighed against its purpose: without one, no identifier can say why it is needed
    if (want.person.purpose && !out.purpose) fail('a person case needs --frame purpose="<what the user needs to know about this person, and why>": each identifier is weighed against it')
  }
  if (want.image) {
    if (frame.image_may_leave == null) fail('the frame needs --frame image_may_leave=true|false (no default)')
    out.image_may_leave = bool('image_may_leave', frame.image_may_leave)
  }
  if (want.noisy) {
    if (!['ask', 'never'].includes(frame.noisy)) fail('the frame needs --frame noisy=ask|never (no default)')
    out.noisy = frame.noisy
  }
  return out
}

const asLink = v => (String(v).startsWith('Evidence/') ? `[[${path.posix.basename(String(v))}]]` : v)
const IMAGE = /^Evidence\/.*\.(jpe?g|png|webp|gif|avif|heic|heif)$/i
function summaryBlock(manifest, f, values, L) {
  const yn = v => (v ? L.yes : L.no)
  const frame = [f.noisy && `${L.noisy}: ${L[f.noisy]}`, f.image_may_leave != null && `${L.image_may_leave}: ${yn(f.image_may_leave)}`,
    f.person != null && `${L.person}: ${yn(f.person)}`, f.legal_basis && `${L.legal_basis}: ${f.legal_basis}`].filter(Boolean)
  return [`**${L.question}** — ${f.question}`, f.purpose && `**${L.purpose}** — ${f.purpose}`, f.scope && `**${L.scope}** — ${f.scope}`,
    `**${L.input}** — ${Object.entries(values).map(([k, v]) => `${k}: ${asLink(v)}`).join(' · ')}`, frame.length && `**${L.frame}** — ${frame.join(' · ')}`,
    ...Object.values(values).filter(v => IMAGE.test(String(v))).map(v => `![[${path.posix.basename(String(v))}]]`)]
    .filter(Boolean).join('\n\n')
}
// the case's name: its main input; for a file, its name without the extension; for a link, its last path segment
function nameOf(manifest, values) {
  const i = manifest.inputs.find(x => x.required && values[x.id] != null) ?? manifest.inputs.find(x => values[x.id] != null)
  const v = String(values[i?.id] ?? manifest.id)
  if (i?.kind !== 'file') return v
  if (isUrl(v)) { const u = new URL(v); return path.posix.basename(u.pathname).replace(/\.[^.]+$/, '') || u.hostname }
  return path.parse(v).name.replace(/^E\d{2,}-/, '')
}

const caseLink = slug => `[${slug}](obsidian://open?vault=${encodeURIComponent(slug)}&file=Case)`
function relatedBlock(dir, L) {
  const p = readNote(path.join(dir, 'Case.md')).props, lines = []
  if (p.parent) lines.push(`- ${L.started_from} ${p.from ? `[[${path.basename(String(p.from), '.md')}]] ` : ''}${L.in} ${caseLink(p.parent)}`)
  for (const c of p.children ?? []) lines.push(`- ${L.child}: ${caseLink(c)}`)
  return lines.length ? `## ${L.related}\n\n${lines.join('\n')}` : ''
}

export async function createCase(home, manifest, { input, inputs = {}, file, question, frame = {}, title, lang = 'en', parent, from } = {}) {
  const main = mainInput(manifest)
  if (input) inputs = { ...inputs, [main.id]: input }
  if (file) {
    const all = { ...defaults(manifest), ...inputs }, slot = manifest.inputs.find(i => i.kind === 'file' && shown(i, all))
    if (!slot) fail(`--file: the ${manifest.id} type takes no file with these inputs`)
    inputs = { ...inputs, [slot.id]: file }
  }
  if (parent) {
    const pp = readNote(path.join(caseDir(home, parent), 'Case.md')).props
    for (const k of ['purpose', 'person', 'legal_basis', 'image_may_leave', 'noisy']) if (frame[k] == null && pp[k] != null) frame = { ...frame, [k]: pp[k] }
  }
  const { values, error } = checkInputs(manifest, inputs)
  if (error) fail(error)
  const files = manifest.inputs.filter(i => i.kind === 'file' && values[i.id] != null)
  const fromParent = new Set()
  for (const i of files) {
    let v = values[i.id]
    if (isUrl(v)) continue
    // a pivot names a file of its parent's Evidence (E01, E01-photo.jpg, photo): the child starts from its own copy
    if (parent && !fs.existsSync(v)) {
      try { v = values[i.id] = path.join(caseDir(home, parent), evidenceFile(caseDir(home, parent), v)); fromParent.add(i.id) } catch (e) { if (!e.userError) throw e }
    }
    if (!fs.statSync(v, { throwIfNoEntry: false })?.isFile()) fail(`--in ${i.id}: no file ${v}`)
    if (i.accept && !accepts(i.accept, v)) fail(`--in ${i.id}: ${path.basename(v)} is not ${i.accept}`)
  }
  const f = checkFrame(manifest, frame, question)
  // a person case and every case below it: never data of GDPR article 9, never a frame that pursues a private person
  const root = manifest.id === 'person' ? { name: values[main.id] } : parent ? personRoot(path.join(home, parent)) : null
  if (root) {
    const said = [f.question, f.purpose, f.scope, ...Object.values(values).flat()].filter(v => typeof v === 'string').join('\n')
    const hit = sensitiveHit({ text: said, ignore: [root.name] })
    if (hit) fail(`refused: ${CATEGORIES[hit.category].label} data (GDPR article 9) is never looked for in a person case nor in its children`)
    // a person's identifiers are never where they live; the entity a child starts from may say they are a minor
    if (manifest.id === 'person') {
      if (String(values.identifiers ?? '').split(/\r?\n/).some(isStreetAddress)) fail('refused: an identifier is a street address — a person case never plans a case on where someone lives')
      const born = parent && from ? readNote(path.join(caseDir(home, parent), String(from))).props.born : null
      if (born && isMinor(born)) fail(`refused: the subject may be a minor (born ${String(born).slice(0, 7)}) — a person case never looks at a minor`)
    }
    const chase = pursuitHit(said)
    if (chase) fail(`refused: « ${chase} » — a person case never helps to find, contact or follow a private person`)
  }
  const name = title || nameOf(manifest, values), base = slugify(name)
  let slug = base
  for (let n = 2; fs.existsSync(path.join(home, slug)); n++) slug = `${base}-${n}`
  const dir = path.join(home, slug), now = nowIso(), L = labels(lang, typeLabelsOf(manifest.id, home)), vars = { ...L, title: name }
  for (const d of ['Entities', 'Clues', 'Hypotheses', 'Sources', 'Evidence', '.osint']) fs.mkdirSync(path.join(dir, d), { recursive: true })
  writeJson(caseFile(dir), { version: 1, slug, type: manifest.id, created: now, input: values, counters: {}, leads: [], relations: [], evidence: [], refreshes: [], state: {}, seen_at: null, agent_at: now, ranked_at: null, redteam_at: null, redteam: null, conclusion: null })
  writeObsidianConfig(dir)
  emit(dir, { kind: 'case.new', text: `${manifest.label}: ${name}`, data: { type: manifest.id, slug } })
  writeJson(path.join(dir, 'Graph.canvas'), { nodes: [], edges: [] })
  wrote(dir, 'Graph.canvas')
  // the files the case starts from, copied into Evidence untouched; a link of an input that takes one stays a link
  for (const i of files) if (!(i.link && isUrl(values[i.id]))) values[i.id] = (await evidence(dir, values[i.id], { kind: 'original', input: i.id, ...(fromParent.has(i.id) && { name: path.basename(values[i.id]).replace(/^E\d{2,}-/, '') }) })).file
  updateCase(dir, c => { c.input = values })
  const shownInput = values[main.id] ?? values[files[0]?.id] ?? name
  const props = { type: manifest.id, status: 'draft', phase: null, question: f.question, purpose: f.purpose, scope: f.scope, lang, input: asLink(shownInput) }
  if ('person' in f) Object.assign(props, { person: f.person, legal_basis: f.legal_basis })
  if ('image_may_leave' in f) props.image_may_leave = f.image_may_leave
  if ('noisy' in f) props.noisy = f.noisy
  Object.assign(props, { parent: parent ?? null, from: from ?? null, children: [], answer: null, confidence: null, created: now.slice(0, 10) })
  writeCaseNote(dir, 'Case.md', { props, blocks: { summary: summaryBlock(manifest, f, values, L) }, create: template('Case.md', manifest.id, vars, home) })
  writeCaseNote(dir, 'Report.md', { props: { type: 'report' }, create: template('Report.md', manifest.id, vars, home) })
  writeCaseNote(dir, 'Leads.md', { props: { type: 'leads' }, create: template('Leads.md', manifest.id, vars, home) })
  journal(dir, 'case', `created (${manifest.id}: ${shownInput}) — ${f.question}`)
  markFake(dir)
  if (parent) {
    const pdir = path.join(home, parent)
    const kids = readNote(path.join(pdir, 'Case.md')).props.children ?? []
    writeCaseNote(pdir, 'Case.md', { props: { children: [...new Set([...kids, slug])] } })
    writeCaseNote(pdir, 'Case.md', { blocks: { related: relatedBlock(pdir, caseLabels(pdir)) } })
    journal(pdir, 'pivot', `child case ${slug} (${manifest.id}: ${shownInput})`)
  }
  writeCaseNote(dir, 'Case.md', { blocks: { related: relatedBlock(dir, L) } })
  writeGitignore(home)
  return { slug, dir }
}

export function logStep(dir, manifest, { phase, text, progress, failed, end }) {
  const p = readNote(path.join(dir, 'Case.md')).props, ids = manifest.phases.map(x => x.id)
  if (phase && !ids.includes(phase)) fail(`unknown phase ${phase}: ${ids.join(', ')}`)
  if (phase && phase !== p.phase) {
    if (p.phase) emit(dir, { kind: 'phase.end', phase: p.phase, by: 'agent' })
    emit(dir, { kind: 'phase.start', phase, by: 'agent' })
    writeCaseNote(dir, 'Case.md', { props: { phase, status: p.status === 'draft' ? 'running' : p.status } }, 'agent')
  }
  const at = phase ?? p.phase
  if (end) { emit(dir, { kind: 'phase.end', phase: at, by: 'agent' }); return }
  if (progress) {
    const [n, of] = String(progress).split('/').map(Number)
    if (!(n >= 0 && of > 0)) fail('--progress n/N')
    emit(dir, { kind: 'progress', phase: at, n, of, text, by: 'agent' })
    return
  }
  if (!text) return
  const id = journal(dir, failed ? 'fail' : 'step', text)
  emit(dir, { kind: failed ? 'fail' : 'log', phase: at, text, journal: id, by: 'agent' })
}

export function setStatus(dir, status, why) {
  if (!['blocked', 'running'].includes(status)) fail('--set blocked|running')
  if (status === 'blocked' && !why) fail('--set blocked needs --why "<what the agent waits for>"')
  writeCaseNote(dir, 'Case.md', { props: { status, blocked_why: status === 'blocked' ? why : undefined } }, 'agent')
  const id = journal(dir, 'status', status === 'blocked' ? `blocked: ${why}` : 'running')
  emit(dir, { kind: 'case.status', text: status === 'blocked' ? `blocked: ${why}` : 'running', data: { status }, journal: id, by: 'agent' })
}

export const GITIGNORE = `# skill-osint: what the engine makes again. Git keeps every case: its notes, Evidence (originals and captures),
# the Journal, .osint/case.json, analysis.json, events.jsonl, the views and the collection snapshots.
.cache/
.trash/
.dashboard.log
*/.osint/cache/
*/.osint/geoint/
*/.osint/lock/
*/Evidence/crops/
*/Evidence/frames/
*/.obsidian/workspace*.json
.DS_Store
`
export function writeGitignore(home) {
  const file = path.join(home, '.gitignore'), have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  if (have?.includes('# skill-osint:')) return
  fs.writeFileSync(file, have == null ? GITIGNORE : `${have.replace(/\n*$/, '\n\n')}${GITIGNORE}`)
}
