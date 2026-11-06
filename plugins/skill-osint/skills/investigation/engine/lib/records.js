// Everything that writes a finding into a case's vault: an entity, a clue, a source (captured and hashed), a piece of
// evidence (copied, hashed, read-only), a free note, a relation between two entities. Each writes its note through
// writeCaseNote, journals what it did and emits its event. The CLI commands and the types' ctx both call these.
import fs from 'node:fs'
import path from 'node:path'
import { canonicalIp } from './cidr.js'
import { caseLabels, journal, nextId, personRoot, readCase, updateCase, withLock, writeCaseNote, wrote } from './case.js'
import { emit } from './events.js'
import { CAPS, KINDS } from './kinds.js'
import { isMessaging, MESSAGING_REFUSAL, request } from './net.js'
import { CATEGORIES, sensitiveHit } from './sensitive.js'
import { safe, template } from './templates.js'
import { extOf, fail, mimeOf, nowIso, readJson, safeName, sha256, sha256File, UserError, writeJson } from './util.js'
import { addCanvas, getBlock, readNote } from './vault.js'

const posix = p => p.split(path.sep).join('/')
export const noteLink = rel => `[[${path.posix.basename(rel, '.md')}]]`
export function findById(dir, folder, id) {
  try { const f = fs.readdirSync(path.join(dir, folder)).find(n => n === `${id}.md` || n.startsWith(`${id} `)); return f ? `${folder}/${f}` : null } catch { return null }
}
const notesOf = (dir, folder) => { try { return fs.readdirSync(path.join(dir, folder)).filter(f => f.endsWith('.md')).map(f => ({ rel: `${folder}/${f}`, ...readNote(path.join(dir, folder, f)) })) } catch { return [] } }
const sourceLink = (dir, id) => { const rel = findById(dir, 'Sources', id); if (!rel) fail(`no source ${id} in this case`); return noteLink(rel) }
export function entityPath(dir, kind, value) {
  for (const rel of [`Entities/${safeName(value)}.md`, `Entities/${safeName(`${value} (${kind})`)}.md`]) {
    const n = readNote(path.join(dir, rel))
    if (n.exists && (!kind || n.props.kind === kind)) return rel
  }
  return null
}
const nodeId = rel => rel.replace(/[^\w.-]+/g, '-').toLowerCase()
const union = (a = [], b = []) => [...new Set([...[].concat(a ?? []), ...[].concat(b ?? [])].map(String))]
const OWN = new Set(['kind', 'value', 'confidence', 'sources', 'aliases', 'tags'])
function factsBlock(props, L) {
  const shown = ([k, v]) => !OWN.has(k) && (Array.isArray(v) ? v.length > 0 : v != null && v !== '' && typeof v !== 'object')
  const rows = Object.entries(props).filter(shown)
  return [`## ${L.facts}`, '', ...rows.map(([k, v]) => `- ${safe(k)}: ${safe([].concat(v).join(', '))}`), ...(props.sources?.length ? ['', `${L.sources}: ${props.sources.join(' · ')}`] : [])].join('\n')
}
function relationsBlock(dir, rel, L) {
  const rows = readCase(dir).relations.filter(r => r.from === rel || r.to === rel)
  if (!rows.length) return ''
  return [`## ${L.relations}`, '', ...rows.map(r => r.from === rel ? `- ${r.label} → ${noteLink(r.to)}${r.source ? ` (${r.source})` : ''}` : `- ${noteLink(r.from)} → ${r.label}${r.source ? ` (${r.source})` : ''}`)].join('\n')
}

// GDPR article 9 (§ 5): what a person case and the cases below it never record. The error names the category and
// carries it (e.sensitive), so that a type's ctx withholds the write and its command goes on (lib/types.js)
// the organizations the case already holds are read as names, like the subject's (« Institut Catholique de Paris »)
const orgNames = dir => notesOf(dir, 'Entities').filter(n => n.props.kind === 'organization').map(n => String(n.props.value ?? ''))
// every string of a value (a verdict, a conclusion, a view's rows), for the guard
export const strings = v => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [])
// what is found again, unchanged: a Journal line, except in a watch pass (its one line says what changed)
const again = (dir, kind, text) => (process.env.OSINT_BY === 'watch' ? null : journal(dir, kind, text))
export function guard(dir, { text = '', props = {} }) {
  const root = personRoot(dir)
  if (!root) return
  const hit = sensitiveHit({ text, props, ignore: [root.name, ...orgNames(dir)] })
  if (hit) throw Object.assign(new UserError(`refused: ${CATEGORIES[hit.category].label} data (GDPR article 9, its ${hit.where}) is never recorded in a person case nor in its children (${root.slug})`), { sensitive: hit.category })
}

export function entity(dir, kind, value, { confidence, sources = [], aliases, props = {}, by } = {}) {
  if (!KINDS[kind]) fail(`unknown entity kind ${kind}: ${Object.keys(KINDS).join(', ')}`)
  value = String(value ?? '').trim()
  if (!value) fail('an entity needs a value')
  // the value of a person is a name, never read
  guard(dir, { text: [['person', 'organization'].includes(kind) ? '' : value, ...[].concat(aliases ?? [])].join('\n'), props })
  if (kind === 'ip') value = canonicalIp(value) ?? value
  if (confidence && !['high', 'medium', 'low'].includes(confidence)) fail('--confidence high|medium|low')
  const L = caseLabels(dir), type = readCase(dir).type
  return withLock(dir, () => {
    let rel = `Entities/${safeName(value)}.md`
    const same = readNote(path.join(dir, rel))
    if (same.exists && same.props.kind && same.props.kind !== kind) rel = `Entities/${safeName(`${value} (${kind})`)}.md`
    const n = readNote(path.join(dir, rel)), created = !n.exists
    const merged = union(n.props.sources, sources.map(s => sourceLink(dir, s)))
    const next = { kind, value, confidence: confidence ?? n.props.confidence ?? 'low', sources: merged, tags: union([`entity/${kind}`], n.props.tags), ...(aliases && { aliases: union(n.props.aliases, aliases) }), ...props }
    writeCaseNote(dir, rel, { props: next, blocks: { facts: factsBlock({ ...n.props, ...next }, L) }, create: template('entity.md', type, { ...L, title: value }, path.dirname(dir)) }, by)
    if (created) {
      const id = journal(dir, 'entity', `${kind} ${value}${sources.length ? ` (${sources.join(', ')})` : ''}`)
      emit(dir, { kind: 'entity.add', path: rel, text: `${kind} ${value}`, journal: id, data: { kind, value }, ...(by && { by }) })
      if (addCanvas(dir, { nodes: [{ id: nodeId(rel), file: rel, kind }] })) wrote(dir, 'Graph.canvas', by)
    }
    return { path: rel, created }
  })
}

export function relate(dir, [kindA, valueA], [kindB, valueB], label, source = null) {
  const a = entityPath(dir, kindA, valueA), b = entityPath(dir, kindB, valueB)
  if (!a || !b) fail(`relate needs both entities: ${a ? '' : `${kindA} ${valueA} `}${b ? '' : `${kindB} ${valueB}`}`.trim())
  guard(dir, { text: String(label ?? '') })
  const L = caseLabels(dir)
  const added = updateCase(dir, c => {
    if (c.relations.some(r => r.from === a && r.to === b && r.label === label)) return false
    c.relations.push({ from: a, to: b, label, source }); return true
  })
  if (!added) return
  for (const rel of [a, b]) writeCaseNote(dir, rel, { blocks: { relations: relationsBlock(dir, rel, L) } })
  withLock(dir, () => { if (addCanvas(dir, { edges: [{ id: `${nodeId(a)}--${nodeId(b)}--${label}`, fromNode: nodeId(a), toNode: nodeId(b), label }] })) wrote(dir, 'Graph.canvas') })
}

export function clue(dir, text, { status, where, credibility, constraint = false, sources = [], entities = [], journal: jref, title, by } = {}) {
  if (!CAPS[status]) fail(`--status ${Object.keys(CAPS).join('|')}`)
  const cred = credibility == null ? null : Number(credibility)
  if (cred != null && !(Number.isInteger(cred) && cred >= 1 && cred <= 6)) fail('--credibility 1..6')
  if (!String(text ?? '').trim()) fail('a clue needs its text')
  guard(dir, { text: `${title ?? ''}\n${text}` })
  const L = caseLabels(dir), type = readCase(dir).type
  const ents = entities.map(v => { const rel = entityPath(dir, null, v); if (!rel) fail(`no entity ${v} in this case`); return noteLink(rel) })
  const srcs = sources.map(s => sourceLink(dir, s)), where_ = where ? `[[${where}]]` : null
  const same = notesOf(dir, 'Clues').find(n => n.props.status === status && (n.props.where ?? null) === where_ && (n.props.credibility ?? null) === cred && !!n.props.constraint === !!constraint
    && getBlock(n.body, 'clue')?.split('\n\n![[')[0] === String(text) && union(n.props.entities).sort().join('|') === union(ents).sort().join('|'))
  if (same) { // spec § 5.3: found again = the same clue, with its new sources
    writeCaseNote(dir, same.rel, { props: { sources: union(same.props.sources, srcs) } }, by)
    const j = again(dir, 'clue', `${same.props.id} found again`)
    return { id: same.props.id, path: same.rel, again: true, journal: j }
  }
  const id = nextId(dir, 'C'), name = String(title || text).replace(/\s+/g, ' ').trim().slice(0, 60)
  const rel = `Clues/${id} ${safeName(name)}.md`
  writeCaseNote(dir, rel, {
    props: { id, status, where: where ? `[[${where}]]` : null, credibility: cred, constraint: !!constraint, sources: srcs, entities: ents, journal: jref ?? null },
    blocks: { clue: `${text}${where ? `\n\n![[${where}]]` : ''}` },
    create: template('clue.md', type, { ...L, title: name }, path.dirname(dir)),
  }, by)
  const j = journal(dir, 'clue', `${id} (${status}) ${name}`)
  emit(dir, { kind: 'clue.add', id, path: rel, text: name, journal: j, data: { status }, ...(by && { by }) })
  return { id, path: rel }
}

const htmlTitle = (buf, type) => /html/.test(type ?? '') ? /<title[^>]*>([^<]*)<\/title>/i.exec(buf.toString('utf8'))?.[1].replace(/\s+/g, ' ').trim() || null : null
export async function source(dir, { url, file, body, contentType, archive = 'local', reliability, title, by } = {}) {
  if (url && isMessaging(url)) fail(MESSAGING_REFUSAL)
  if (reliability && !/^[A-F]$/.test(reliability)) fail('--reliability A..F (A completely reliable … F cannot be judged)')
  if (!['local', 'spn', 'none'].includes(archive)) fail('--archive spn|local|none')
  if (!url && !file) fail('a source needs its URL, or --file for a capture')
  let bytes, type = contentType, status = null, finalUrl = url ?? null
  if (file) { bytes = fs.readFileSync(file); type ??= mimeOf(file) }
  else if (body != null) bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body))
  else {
    const r = await request('web', url, { max: 10e6 })
    bytes = r.body; type = r.headers['content-type']; status = r.status; finalUrl = r.url
  }
  const hash = sha256(bytes), same = notesOf(dir, 'Sources').find(n => (n.props.url ?? null) === (url ?? null) && n.props.sha256 === hash)
  if (same) { // spec § 5.2: read again unchanged = the same source, no new note nor capture
    const j = again(dir, 'source', `${same.props.id} read again, unchanged · ${url ?? path.basename(file)} · sha256 ${hash.slice(0, 12)}`)
    return { id: same.props.id, path: same.rel, capture: `Evidence/captures/${same.props.id}${extOf(type, file)}`, sha256: hash, status, body: bytes, contentType: type, url: finalUrl, again: true, journal: j }
  }
  const name = title || htmlTitle(bytes, type) || (url ? new URL(url).hostname : path.basename(file))
  guard(dir, { text: name })   // GDPR article 9: the page's title becomes the note's name
  const id = nextId(dir, 'S'), ext = extOf(type, file), capture = `Evidence/captures/${id}${ext}`
  fs.mkdirSync(path.join(dir, 'Evidence', 'captures'), { recursive: true })
  fs.writeFileSync(path.join(dir, capture), bytes)
  let archived = null
  if (archive === 'spn' && url) {
    try {
      const r = await request('spn', `/save/${url}`, { timeout: 90000, max: 2e6 })
      archived = r.headers['content-location'] ? `https://web.archive.org${r.headers['content-location']}` : r.status < 400 ? `https://web.archive.org/web/${url}` : null
      if (!archived) throw new Error(`answered ${r.status}`)
    } catch (e) { const j = journal(dir, 'fail', `Save Page Now for ${url}: ${e.message} (the local capture stays)`); emit(dir, { kind: 'fail', text: `Save Page Now: ${e.message}`, journal: j }) }
  }
  const rel = `Sources/${id} ${safeName(name)}.md`, L = caseLabels(dir)
  writeCaseNote(dir, rel, {
    props: { id, url: url ?? null, accessed: nowIso(), capture: `[[${id}${ext}]]`, archive: archived, sha256: hash, reliability: reliability ?? null, http_status: status },
    blocks: { source: [url && safe(url), `${L.captured}: ![[${id}${ext}]]`, archived && `${L.archive}: ${archived}`, `sha256: \`${hash}\``].filter(Boolean).join('\n\n') },
    create: template('source.md', readCase(dir).type, { ...L, title: name }, path.dirname(dir)),
  }, by)
  const j = journal(dir, 'source', `${id} ${file ? 'file' : 'GET'} ${url ?? path.basename(file)}${status != null ? ` → ${status}` : ''} · sha256 ${hash.slice(0, 12)}`)
  emit(dir, { kind: 'source.add', id, path: rel, text: name, journal: j, ...(by && { by }) })
  return { id, path: rel, capture, sha256: hash, status, body: bytes, contentType: type, url: finalUrl }
}

// an original or a file derived from one (a masked copy): copied untouched, hashed, read-only, listed in case.json with
// its kind, the form input it came from and, for a mask, its boxes
export async function evidence(dir, fileOrUrl, { of = null, by, kind, name: given, input, boxes } = {}) {
  let bytes = null, name
  const url = /^https?:\/\//i.test(fileOrUrl) ? fileOrUrl : null // the address of a downloaded original stays in case.json
  if (url) {
    const r = await request('web', fileOrUrl, { max: 200e6, timeout: 120000 })
    if (r.status >= 400) fail(`${fileOrUrl} answered ${r.status}`)
    bytes = r.body
    name = path.posix.basename(new URL(fileOrUrl).pathname) || 'download'
    // a link without a known extension (a portal's …/photo.jpg_DATEMAJ_…): its Content-Type's, within safeName's 120
    // characters, so the file opens as what it is
    const ext = extOf(r.headers['content-type'])
    if (mimeOf(name) === 'application/octet-stream' && ext !== '.bin') name = `${name.slice(0, 120 - ext.length)}${ext}`
  } else {
    if (!fs.existsSync(fileOrUrl)) fail(`no file ${fileOrUrl}`)
    name = path.basename(fileOrUrl)
  }
  guard(dir, { text: given ?? name })   // GDPR article 9: the file's name
  const id = nextId(dir, 'E'), rel = `Evidence/${id}-${safeName(given ?? name)}`, hash = bytes ? sha256(bytes) : sha256File(fileOrUrl)
  fs.mkdirSync(path.join(dir, 'Evidence'), { recursive: true })
  if (bytes) fs.writeFileSync(path.join(dir, rel), bytes)
  else fs.copyFileSync(fileOrUrl, path.join(dir, rel))
  try { fs.chmodSync(path.join(dir, rel), 0o444) } catch {}
  updateCase(dir, c => { c.evidence.push({ id, file: rel, sha256: hash, of, kind: kind ?? (of ? 'derived' : 'original'), ...(url && { url }), ...(input && { input }), ...(boxes && { boxes }), added: nowIso() }) })
  const j = journal(dir, 'evidence', `${id} ${given ?? name} · sha256 ${hash.slice(0, 12)}${of ? ` (of ${of})` : ''}`)
  emit(dir, { kind: 'evidence.add', id, path: rel, text: given ?? name, journal: j, ...(by && { by }) })
  return { id, file: rel, sha256: hash }
}

export function note(dir, rel, { text, block = 'agent', by = 'agent' } = {}) {
  const r = posix(String(rel ?? ''))
  if (!r.endsWith('.md') || path.isAbsolute(r) || r.split('/').some(p => p === '..' || p.startsWith('.')) || r.startsWith('Evidence/')) fail(`a note of the vault (a .md path, not under .osint, Evidence or outside): ${rel}`)
  if (!/^[\w-]+$/.test(block)) fail('--block <name>')
  guard(dir, { text: String(text ?? '') })
  writeCaseNote(dir, r, { blocks: { [block]: String(text ?? '') }, create: `# ${path.posix.basename(r, '.md')}\n` }, by)
  journal(dir, 'note', r)
  return { path: r }
}

const evidenceFiles = dir => {
  const out = []
  const walk = rel => {
    let es
    try { es = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }) } catch { return }
    for (const d of es) { if (d.name.startsWith('.')) continue; const r = `${rel}/${d.name}`; if (d.isDirectory()) walk(r); else out.push(r) }
  }
  walk('Evidence')
  return out.sort()
}
// a file of Evidence by its id (E02), its name with or without the extension, or its path
export function evidenceFile(dir, ref) {
  const r = String(ref ?? '').trim().replace(/\\/g, '/'), byId = readCase(dir).evidence.find(e => e.id === r.toUpperCase())
  if (byId) return byId.file
  const files = evidenceFiles(dir), base = path.posix.basename(r), stem = base.replace(/\.[^.]+$/, '')
  return files.find(f => f === r) ?? files.find(f => path.posix.basename(f) === base) ?? files.find(f => path.posix.basename(f).replace(/\.[^.]+$/, '') === stem)
    ?? fail(`no file ${ref} in Evidence (an id such as E01, a file name, or its path)`)
}
export const reverseOf = c => ({ clear: {}, verdicts: [], tunnels: [], ...(c.reverse ?? {}) })
// the agent looked at these files and saw no person: they may leave (reverse, recon) when the frame allows it
export function declareClear(dir, refs) {
  const files = [...new Set((refs ?? []).map(r => evidenceFile(dir, r)))]
  if (!files.length) fail('--files: the files the agent looked at')
  const j = journal(dir, 'people', `looked at by the agent, no person: ${files.join(', ')}`)
  updateCase(dir, c => { c.reverse = reverseOf(c); for (const f of files) c.reverse.clear[f] = { at: nowIso(), journal: j } })
  return files
}
// the agent's verdicts on reverse-search results, judged one image at a time at full size: each goes to the Journal; a
// match becomes an observed clue that cites its verdict, a constraint when it rests on three invariant features or more
export function reverseVerdict(dir, list) {
  if (!Array.isArray(list) || !list.length) fail('reverse verdict --file: a JSON list of { "candidate", "verdict": "match|no match|unsure", "reason", "compared": [...] }')
  const out = []
  for (const v of list) {
    if (!String(v?.candidate ?? '').trim()) fail('each verdict names its "candidate" (a rank such as #3, a page URL or a file)')
    if (!['match', 'no match', 'unsure'].includes(v.verdict)) fail(`${v.candidate}: "verdict" is match, no match or unsure`)
    if (!String(v.reason ?? '').trim()) fail(`${v.candidate}: write the "reason"`)
    const compared = [].concat(v.compared ?? []).map(String).filter(s => s.trim())
    if (v.verdict === 'match' && !compared.length) fail(`${v.candidate}: a match lists the features "compared" (fixed ones: structure, skyline, signs), judged one image at a time at full size`)
  }
  for (const v of list) {
    const compared = [].concat(v.compared ?? []).map(String).filter(s => s.trim())
    const j = journal(dir, 'verdict', `${v.candidate} — ${v.verdict}: ${v.reason}${compared.length ? ` (compared: ${compared.join(', ')})` : ''}`)
    const file = v.file ? evidenceFile(dir, v.file) : null
    const id = v.verdict === 'match' ? clue(dir, `${v.reason} — ${compared.join(', ')}`, { status: 'observed', constraint: compared.length >= 3, journal: j, title: `Match ${v.candidate}`.slice(0, 60), ...(file && { where: path.posix.basename(file) }) }).id : null
    out.push({ at: nowIso(), candidate: v.candidate, page: v.page ?? (/^https?:\/\//.test(v.candidate) ? v.candidate : null), file, verdict: v.verdict, reason: v.reason, compared, journal: j, clue: id })
  }
  updateCase(dir, c => { c.reverse = reverseOf(c); c.reverse.verdicts.push(...out) })
  // the evidence view shows each verdict on its candidate
  const f = path.join(dir, '.osint', 'views', 'evidence.json')
  if (fs.existsSync(f)) {
    const view = readJson(f)
    for (const it of view.items ?? []) { const m = out.findLast(x => (x.page && x.page === it.page) || (x.file && x.file === it.file) || x.candidate === `#${it.rank}`); if (m) it.verdict = m.verdict }
    writeJson(f, view)
  }
  emit(dir, { kind: 'log', text: `${out.length} verdicts, ${out.filter(x => x.verdict === 'match').length} match`, journal: out.at(-1).journal })
  return out
}
