// lib/types.js — the case types: one folder each under the skill's types/ (type.json, method.md, engine.js,
// templates/, labels.json), their manifest check, engine.js and the ctx their commands get.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { caseLabels, homeDir, journal, listCases, personRoot, readCase, updateCase, withLock, writeCaseNote } from './case.js'
import { hypAdd, hypLrMany, hypsOf } from './cycle.js'
import { emit } from './events.js'
import { KINDS } from './kinds.js'
import { cleanCopy, dropDownload, frames, imageSize, ytdlp } from './media.js'
import { request, resolver } from './net.js'
import { casePython } from './python.js'
import { clue, declareClear, entity, evidence, evidenceFile, guard, relate, reverseOf, source, strings } from './records.js'
import { sendable } from './reverse.js'
import { CATEGORIES } from './sensitive.js'
import { snapshot } from './refresh.js'
import { viaServer } from './server.js'
import { fill, labels, privateTypesDir, typesDir } from './templates.js'
import { fail, readJson, safeName, UserError, writeJson } from './util.js'
import { readNote } from './vault.js'
import { approvedHash, digestOf, typeDigest, unattended } from './watch-ok.js'

// the ids a private type may not take: the engine's commands (`osint.mjs <type> …` is tried before them) and the
// tags of the dashboard's prompts ([lead:L07], [pivot:domain]…). A test checks that the usage line's commands are here
export const RESERVED_IDS = [
  'brain', 'clue', 'conclude', 'dashboard', 'doctor', 'entity', 'evidence', 'export', 'hyp', 'list', 'log', 'new', 'next',
  'note', 'redteam', 'refresh', 'reverse', 'serve', 'setup', 'source', 'status', 'sun', 'types', 'vision', 'watch', 'weather', 'workspaces',
  'install', 'lead', 'pivot', 'question', 'reverse-results',
]
const byId = (a, b) => a.id.localeCompare(b.id)
// a name as a file system sees it: Windows and macOS fold the case, drop a trailing dot or space; NFKC folds the
// full-width and compatibility letters (a folder « ｄomain » is the plugin's domain on such a system)
const spelled = n => n.normalize('NFKC').toLowerCase().replace(/[. ]+$/, '')
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/
const entries = dir => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => !d.name.startsWith('.')).sort((a, b) => (a.name < b.name ? -1 : 1)) } catch { return [] } }
const folders = dir => entries(dir).filter(d => d.isDirectory()).map(d => d.name)
const inside = (root, file) => { const r = path.relative(root, file); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)) }
// the links of a folder that leave it (a private type is a folder of the cases folder, nothing it points to elsewhere)
function linksOut(dir, depth = 0, root = fs.realpathSync(dir)) {
  const out = []
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, d.name)
    if (d.isSymbolicLink()) { let t = null; try { t = fs.realpathSync(f) } catch {} if (!t || !inside(root, t)) out.push(path.relative(root, f).split(path.sep).join('/')) } else if (d.isDirectory() && depth < 4) out.push(...linksOut(f, depth + 1, root))
  }
  return out
}

// What a private engine.js may import, and the calls it may not make. A lexical check of the source (comments
// removed, strings kept), before the file is run: it keeps an accidental or an obvious breach out (a type that imports
// the plugin's files, writes files or runs a shell by itself, reaches the network without ctx.fetch). It is NOT a
// sandbox: JavaScript can always spell what a word list does not name, and the engine.js of a private type runs with
// the engine's rights. What protects the user is that the watch and the dashboard run it only for the code the user
// approved on this machine (lib/watch-ok.js), and that they read it first (SKILL.md says so)
export const PRIVATE_IMPORTS = ['node:path', 'node:url', 'node:util', 'node:crypto', 'node:buffer', 'node:string_decoder', 'node:querystring', 'node:zlib', 'node:events', 'node:assert', 'node:timers/promises']
// the source without its comments: strings and templates kept whole, `/**/import(` and `// …` cannot hide a call
// ponytail: a regex literal holding a quote can fool it (the next quote opens a « string »); a real parser if it matters
const stripComments = source => source.replace(/(['"`])(?:\\[\s\S]|(?!\1)[^\\])*\1|\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*/g, m => (m[0] === '/' ? ' ' : m))
export function engineProblems(raw) {
  const out = [], seen = new Set(), source = stripComments(raw)
  for (const m of source.matchAll(/(?:^|[\n;}])[ \t]*(?:import|export)\b\s*(?:[^'"`;]*?\bfrom\s*)?(['"])([^'"\n]+)\1/g)) {
    if (!PRIVATE_IMPORTS.includes(m[2]) && !seen.has(m[2])) { seen.add(m[2]); out.push(`imports ${m[2]} (a private type imports node: built-ins only: ${PRIVATE_IMPORTS.map(x => x.slice(5)).join(', ')}; everything else goes through ctx)`) }
  }
  const rules = [
    [/\bimport\s*\(/, 'uses import() (a dynamic import can load anything)'],
    [/\brequire\s*\(|\bcreateRequire\b/, 'uses require (node: imports only)'],
    [/(?<![\w$.])fetch\s*\(/, 'calls fetch() (the network goes through ctx.fetch, which keeps the guards, the rates and the Journal)'],
    [/\b(?:WebSocket|XMLHttpRequest)\b/, 'uses a raw network API (ctx.fetch only)'],
    [/\beval\b|\bnew\s+Function\b|(?<![\w$.])Function\s*\(|\bconstructor\s*\.\s*constructor\b/, 'builds code at run time (eval, Function)'],
    [/\bglobalThis\b|\bglobal\b/, 'uses globalThis or global (ctx only)'],
    [/\bprocess\s*\.\s*(?:binding|dlopen|mainModule|_linkedBinding)\b|\bgetBuiltinModule\b/, 'reaches into the process internals (getBuiltinModule, binding)'],
  ]
  for (const [re, why] of rules) if (re.test(source)) out.push(why)
  return out
}
const sourceRefusal = source => {
  const p = engineProblems(source)
  return p.length ? `its engine.js is not for a private type: ${p.join('; ')}` : null
}
const privateEngineRefusal = m => {
  const f = path.join(m.dir, 'engine.js')
  return fs.existsSync(f) ? sourceRefusal(fs.readFileSync(f, 'utf8')) : null
}

// the case types: the plugin's (types/), then the cases folder's own (.osint-types/), each with its `dir` and
// `private`. A private folder never replaces nor changes a plugin type: one named like a plugin type, an engine
// command or a prompt tag, or whose manifest does not hold, is refused with why, and the others load all the same.
// Nothing here runs a private type's code: it reads its type.json and the text of its engine.js
// ponytail: the manifests are read again on every call (a few small files); memoize per process if it ever shows
export function scanTypes(home = homeDir()) {
  const pdir = typesDir(), odir = privateTypesDir(home)
  const plugin = folders(pdir).filter(n => fs.existsSync(path.join(pdir, n, 'type.json')))
    .map(n => ({ ...readJson(path.join(pdir, n, 'type.json')), dir: path.join(pdir, n), private: false })).sort(byId)
  const own = [], rejected = []
  // .osint-types itself may not be a link out of the cases folder
  let root = null
  try {
    if (fs.lstatSync(odir).isSymbolicLink() && !inside(fs.realpathSync(home), fs.realpathSync(odir))) {
      rejected.push({ id: '.osint-types', dir: odir, why: '.osint-types is a symbolic link out of the cases folder: a private type is a folder of the cases folder', errors: [] })
      return { types: plugin, rejected }
    }
    root = fs.realpathSync(odir)
  } catch { root = null }
  for (const d of root ? entries(odir).filter(x => x.isDirectory() || x.isSymbolicLink()) : []) {
    const name = d.name, dir = path.join(odir, name), refuse = (why, errors = []) => rejected.push({ id: name, dir, why, errors })
    const key = spelled(name), plug = plugin.find(t => spelled(t.id) === key)
    if (plug) { refuse(`${plug.id} is a plugin type's id: rename the folder and its "id"`); continue }
    const res = RESERVED_IDS.find(x => x === key)
    if (res) { refuse(`${res} is an engine command or a prompt tag: rename the folder and its "id"`); continue }
    if (WINDOWS_RESERVED.test(key.split('.')[0])) { refuse(`Windows reserves the name ${name}: rename the folder and its "id"`); continue }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) { refuse('the folder name is the type id: lowercase letters, digits and dashes'); continue }
    if (d.isSymbolicLink()) { refuse('a symbolic link: a private type is a real folder of the cases folder'); continue }
    const out = linksOut(dir)
    if (out.length) { refuse(`${out[0]} is a symbolic link out of the type's folder`); continue }
    let m
    try { m = { ...readJson(path.join(dir, 'type.json')), dir, private: true } } catch (e) {
      refuse(e.code === 'ENOENT' ? 'no type.json' : `type.json: ${e.message}`)
      continue
    }
    // a manifest half written by hand may not even have the shape validateManifest walks
    let errors
    try { errors = validateManifest(m) } catch (e) { errors = [`not the shape of a manifest (${e.message})`] }
    if (errors.length) { refuse('its manifest does not hold', errors); continue }
    const bad = privateEngineRefusal(m)
    if (bad) { refuse(bad); continue }
    own.push(m)
  }
  return { types: [...plugin, ...own.sort(byId)], rejected }
}
export { typeDigest }
export const loadTypes = (home = homeDir()) => scanTypes(home).types
export const findType = (id, home = homeDir()) => loadTypes(home).find(t => t.id === id) ?? null
export function getType(id, home = homeDir()) {
  const { types, rejected } = scanTypes(home), t = types.find(x => x.id === id)
  if (t) return t
  const r = rejected.find(x => x.id === id)
  return fail(r ? `the private type ${id} is refused (${r.dir}): ${[r.why, ...r.errors].join('; ')}` : `unknown case type ${id}: ${types.map(x => x.id).join(', ')}`)
}
// a type's own words (labels.json), from its folder wherever it is
export const typeLabelsOf = (id, home = homeDir()) => {
  const t = findType(id, home)
  return t ? readJson(path.join(t.dir, 'labels.json'), {}) : {}
}

export const WIDGETS = ['brain', 'graph', 'canvas', 'map', 'evidence', 'hypotheses', 'sources', 'timeline', 'table', 'calibration']
export const INPUT_KINDS = ['text', 'url', 'file', 'select', 'chips', 'toggle']
export function validateManifest(m) {
  const e = [], str = (v, k) => { if (typeof v !== 'string' || !v.trim()) e.push(`${k}: a non-empty string`) }
  if (m.id !== path.basename(m.dir)) e.push(`id ${m.id}: must be its folder's name (${path.basename(m.dir)})`)
  for (const k of ['label', 'icon', 'description']) str(m[k], k)
  const ids = (m.inputs ?? []).map(i => i.id)
  if (!ids.length) e.push('inputs: at least one')
  for (const i of m.inputs ?? []) {
    str(i.id, 'inputs[].id'); str(i.label, `inputs.${i.id}.label`)
    if (!INPUT_KINDS.includes(i.kind)) e.push(`inputs.${i.id}.kind: ${INPUT_KINDS.join('|')}`)
    if (['select', 'chips'].includes(i.kind)) {
      if (!i.options?.length) e.push(`inputs.${i.id}.options: at least one`)
      for (const o of i.options ?? []) { str(o.value, `inputs.${i.id}.options[].value`); str(o.label, `inputs.${i.id}.options.${o.value}.label`); str(o.icon, `inputs.${i.id}.options.${o.value}.icon (every chip carries an icon)`) }
    }
    if (i.multiple && (i.kind !== 'chips' || (i.default !== undefined && (!Array.isArray(i.default) || i.default.some(d => !(i.options ?? []).some(o => o.value === d))))))
      e.push(`inputs.${i.id}.multiple: chips only, with a default that lists option values`)
    for (const k of Object.keys(i.when ?? {})) if (!ids.includes(k) || k === i.id) e.push(`inputs.${i.id}.when: unknown input ${k}`)
  }
  for (const f of m.frame ?? []) { const id = typeof f === 'string' ? f : f?.id; if (!['person', 'image', 'noisy'].includes(id)) e.push(`frame: person|image|noisy, not ${id}`) }
  if (!m.levels?.length) e.push('levels: at least one')
  for (const l of m.levels ?? []) { str(l.id, 'levels[].id'); str(l.label, `levels.${l.id}.label`); for (const k of ['high', 'medium', 'low']) str(l.criteria?.[k], `levels.${l.id}.criteria.${k}`) }
  // a level may be capped: its confidence never goes above max.confidence, unless the type's state sets max.unless
  for (const l of (m.levels ?? []).filter(x => x.max !== undefined)) {
    if (!['medium', 'low'].includes(l.max?.confidence)) e.push(`levels.${l.id}.max.confidence: medium|low (the highest confidence the level may reach)`)
    if (l.max?.unless !== undefined && !/^[a-z][a-z0-9_]*$/.test(String(l.max.unless))) e.push(`levels.${l.id}.max.unless: the name of a true/false flag of the type's state (snake_case)`)
    str(l.max?.why, `levels.${l.id}.max.why`)
  }
  if (!m.phases?.length) e.push('phases: at least one')
  for (const p of m.phases ?? []) { str(p.id, 'phases[].id'); str(p.label, `phases.${p.id}.label`) }
  for (const v of m.views ?? []) {
    if (!WIDGETS.includes(v.widget)) e.push(`views: unknown widget ${v.widget} (${WIDGETS.join(', ')})`)
    if (v.widget === 'table' && (!(KINDS[v.kind] || v.view) || !v.columns?.length)) e.push('views.table: a "kind" of entity (or a "view" the type writes) and its "columns"')
  }
  for (const a of m.actions ?? []) {
    for (const k of ['id', 'label', 'icon', 'prompt']) str(a[k], `actions.${a.id}.${k}`)
    if (!/^(case|hyp|evidence|entity:[a-z]+)$/.test(a.target ?? '') || (a.target.startsWith('entity:') && !KINDS[a.target.slice(7)])) e.push(`actions.${a.id}.target: case|hyp|evidence|entity:<kind>`)
    if (typeof a.noisy !== 'boolean') e.push(`actions.${a.id}.noisy: true|false`)
    if (!(a.minutes > 0)) e.push(`actions.${a.id}.minutes: a positive estimate`)
  }
  // a pivot: an entity kind ("domain"), or a kind whose entity must carry a property ({ "kind": "organization", "has": "siren" })
  for (const p of m.pivots ?? []) {
    const k = typeof p === 'string' ? p : p?.kind
    if (!KINDS[k]) e.push(`pivots: unknown entity kind ${k}`)
    else if (typeof p !== 'string' && !(typeof p.has === 'string' && p.has)) e.push(`pivots.${k}.has: the property the entity must carry ("siren")`)
  }
  for (const s of m.refresh ?? []) {
    str(s.id, 'refresh[].id')
    if (s.by === 'engine') str(s.run, `refresh.${s.id}.run`)
    else if (s.by === 'agent') str(s.section, `refresh.${s.id}.section`)
    else e.push(`refresh.${s.id}.by: engine|agent`)
    // § 3.1: what the step does (noisy, sends an image, costs) and whether the watch runs it (§ 12.1); the engine
    // enforces the same rule itself (lib/watch-rules.js, watchable)
    for (const k of ['noisy', 'sends_image', 'paid', 'watch']) if (s[k] !== undefined && typeof s[k] !== 'boolean') e.push(`refresh.${s.id}.${k}: true|false`)
    if (s.watch === true && s.by !== 'engine') e.push(`refresh.${s.id}.watch: only an engine step can be watched`)
    if (s.watch === true && (s.noisy === true || s.sends_image === true || s.paid === true)) e.push(`refresh.${s.id}.watch: never true for a step that is noisy, sends an image or costs`)
    if (s.noun !== undefined && !(Array.isArray(s.noun) && s.noun.length === 2 && s.noun.every(x => typeof x === 'string' && x.trim()))) e.push(`refresh.${s.id}.noun: ["one", "many"] (what the watch's notification counts)`)
  }
  const mfile = path.join(m.dir, 'method.md')
  if (!fs.existsSync(mfile)) e.push('method.md: missing')
  else {
    const sections = new Set([...fs.readFileSync(mfile, 'utf8').matchAll(/^## ([\w-]+)\s*$/gm)].map(x => x[1]))
    const need = [...(m.phases ?? []).map(p => p.id), ...(m.actions ?? []).map(a => a.id), ...(m.refresh ?? []).filter(s => s.by === 'agent').map(s => s.section)]
    for (const s of need) if (!sections.has(s)) e.push(`method.md: no section "## ${s}"`)
  }
  return e
}
// A private type's engine.js is read once: the bytes that are checked (lexically), hashed and run are the same ones
// (imported from a data: URL, so a file swapped in between runs nothing). Under the watch or a dashboard click the
// code runs only for the hash the user approved on this machine (watch-ok.js): the case's folder cannot say it
export async function loadEngine(m) {
  const f = path.join(m.dir, 'engine.js')
  if (!m.private) return import(pathToFileURL(f).href)
  const typeJson = fs.readFileSync(path.join(m.dir, 'type.json')), code = fs.readFileSync(f)
  const bad = sourceRefusal(code.toString('utf8'))
  if (bad) fail(`the private type ${m.id}: ${bad}`)
  if (unattended()) {
    const home = path.dirname(path.dirname(m.dir)), ok = approvedHash(home, m.id)
    if (ok !== digestOf(typeJson, code)) fail(`the private type ${m.id} ${ok ? 'changed since the user\'s yes' : 'was never given the user\'s yes'} on this machine: its engine.js does not run unattended until then (osint.mjs watch --every <period> -p <case> --yes, after reading it)`)
  }
  return import(`data:text/javascript;base64,${code.toString('base64')}`)
}
export async function validateEngine(m) {
  const steps = (m.refresh ?? []).filter(s => s.by === 'engine')
  if (!fs.existsSync(path.join(m.dir, 'engine.js'))) return steps.map(s => `refresh.${s.id}: no engine.js`)
  // a private type's engine.js, mid-edit, may not even load: said, never thrown (the other types are checked too)
  let commands
  try { ({ commands = {} } = await loadEngine(m)) } catch (e) { return [`engine.js does not load: ${e.message}`] }
  return steps.filter(s => !commands[s.run.split(' ')[0]]).map(s => `refresh.${s.id}: no command ${s.run.split(' ')[0]} in engine.js`)
}

// a private type never gives the user's yes nor the « people visible » on its own: its tunnel call carries neither
export const tunnelOpts = (manifest, opts = {}) => (manifest.private ? { ...opts, yes: false, unmasked: false } : opts)
const deepFreeze = o => { for (const v of Object.values(o)) if (v && typeof v === 'object') deepFreeze(v); return Object.freeze(o) }

// fresh (a refresh): the cache is never read, what changed is the point
export function makeCtx(home, slug, manifest, { diffs = [], fresh = false, agent = [] } = {}) {
  const dir = path.join(home, slug), c = readCase(dir), L = caseLabels(dir)
  const props = readNote(path.join(dir, 'Case.md')).props, lang = props.lang ?? 'en'
  const views = path.join(dir, '.osint', 'views')
  // a write the guard refuses (GDPR article 9) is withheld: the Journal says its kind and the category, never the
  // value; a relation to an entity withheld in this command is skipped; the command goes on
  const root = personRoot(dir), withheld = new Set(), key = (kind, value) => `${kind}:${String(value ?? '').trim()}`
  const hold = (what, e) => {
    if (!e.sensitive) throw e
    return emit(dir, { kind: 'log', text: `withheld ${what} — GDPR article 9`, journal: journal(dir, 'withheld', `${what}: ${CATEGORIES[e.sensitive].label} data (GDPR article 9) is never recorded in a person case nor in its children`) })
  }
  // the text of a log line, a block or a view is checked too: held (what the Journal says), never reproduced
  const held = (what, text) => { try { guard(dir, { text }) } catch (e) { return hold(what, e) ?? true } }
  const abs = rel => (path.isAbsolute(String(rel)) ? String(rel) : path.join(dir, ...String(rel).split('/')))
  const ctx = {
    dir, slug, manifest: manifest.private ? deepFreeze(structuredClone(manifest)) : manifest, input: c.input, lang, noisy: props.noisy, person: props.person === true,
    t: (key, vars = {}) => fill(L[key] ?? key, vars),
    state: patch => (patch ? updateCase(dir, x => { x.state[manifest.id] = { ...(x.state[manifest.id] ?? {}), ...patch } }) : readCase(dir).state[manifest.id] ?? {}),
    guarded: root?.slug ?? null,
    entity: (kind, value, opts) => {
      try { return entity(dir, kind, value, opts) } catch (e) { hold(`an entity (${kind})`, e); withheld.add(key(kind, value)); return { path: null, created: false, withheld: true } }
    },
    clue: (text, opts) => {
      try { return clue(dir, text, opts) } catch (e) { hold('a clue', e); return { id: null, path: null, withheld: true } }
    },
    // a page whose title names article 9 data is kept, its note named « S03 (withheld) »
    source: opts => source(dir, opts).catch(e => { if (!e.sensitive) throw e; hold('a source title', e); return source(dir, { ...opts, title: '(withheld)' }) }),
    evidence: (f, opts) => evidence(dir, f, opts),
    hyp: opts => hypAdd(dir, manifest, opts),
    relate: (a, b, label, src) => {
      if (withheld.has(key(...a)) || withheld.has(key(...b))) return undefined
      try { return relate(dir, a, b, label, src) } catch (e) { return hold('a relation', e) }
    },
    log: text => held('a log line', text) || emit(dir, { kind: 'log', text, journal: journal(dir, 'step', text) }),
    progress: (n, of, text) => emit(dir, { kind: 'progress', n, of, text }),
    fail: text => held('a failure line', text) || emit(dir, { kind: 'fail', text, journal: journal(dir, 'fail', text) }),
    // stop the command with a message for the agent (exit code 1, or 2 when the user's yes is needed)
    refuse: (message, code = 1) => fail(message, code),
    async fetch(service, pathOrUrl, opts = {}) {
      const { quiet: asked, ...rest } = opts, quiet = asked || process.env.OSINT_BY === 'watch' // quiet: no Journal line (a watch pass is always quiet: a line per call, every few hours, is noise); follow: false: a redirection comes back as it is
      const r = await request(service, pathOrUrl, { cacheDir: path.join(dir, '.osint', 'cache'), ...rest, ...(fresh && { cacheHours: 0 }) })
      if (quiet) return r
      const what = service === 'web' ? pathOrUrl : `${service} ${pathOrUrl}`
      return { ...r, journal: journal(dir, 'query', `${opts.method ?? 'GET'} ${what} → ${r.status}${r.cached ? ' (cache)' : ''} · ${r.ms} ms`) }
    },
    // an engine step may hand agent steps back to the Refresh that runs it (a person's Refresh: its children's)
    agentSteps: items => { agent.push(...items) },
    snapshot: (name, items) => { const d = snapshot(dir, name, items); diffs.push(d); return d },
    view: (widget, data) => { if (!held(`a view (${widget})`, strings(data).join('\n'))) writeJson(path.join(views, `${widget}.json`), data) },
    timeline: items => held('a timeline', strings(items).join('\n')) || withLock(dir, () => {
      const f = path.join(views, 'timeline.json'), have = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : []
      const key = i => `${String(i.date).slice(0, 10)}|${i.label}`, seen = new Set(have.map(key))
      writeJson(f, [...have, ...items.filter(i => i?.date && !seen.has(key(i)))].sort((a, b) => String(a.date).localeCompare(String(b.date))))
    }),
    resolver,
    home,
    python: (script, args, opts) => casePython(dir, script, args, opts),
    media: {
      frames: (rel, opts) => frames(abs(rel), path.join(dir, 'Evidence', 'frames'), opts),
      download: url => ytdlp(url, path.join(dir, '.osint', 'cache', 'yt-dlp')),
      dropDownload,
      imageSize: rel => imageSize(fs.readFileSync(abs(rel))),
    },
    hyps: () => hypsOf(dir),
    hypLrMany: cells => hypLrMany(dir, manifest, cells),
    file: abs,
    // a crop or a sheet a tool made, into Evidence/crops (what the engine makes again: ignored by git)
    crop(from, name) {
      const rel = `Evidence/crops/${String(name).split('/').map(safeName).join('/')}`
      fs.mkdirSync(path.dirname(abs(rel)), { recursive: true })
      fs.rmSync(abs(rel), { force: true })   // a crop made again replaces the old one, even a read-only copy
      fs.copyFileSync(from, abs(rel))
      try { fs.chmodSync(abs(rel), 0o644) } catch {}
      return rel
    },
    block: (rel, name, text) => held(`a block (${rel})`, text) || writeCaseNote(dir, rel, { blocks: { [name]: text } }),
    frame: () => readNote(path.join(dir, 'Case.md')).props,
    case: () => readCase(dir),
    homeCtx: () => makeHomeCtx(home, manifest),
    tunnel: (refs, opts = {}) => viaServer(home, 'POST', `/api/cases/${slug}/tunnel`, { files: refs, ...tunnelOpts(manifest, opts) }),
    evidenceFile: ref => evidenceFile(dir, ref),
    // the file as it may leave: a copy without its metadata (EXIF, GPS), one Journal line; exit code 3 when it cannot be cleaned
    sendCopy: rel => cleanCopy(dir, rel),
    declareClear: refs => declareClear(dir, refs),
    sendable: () => { const c = readCase(dir), r = reverseOf(c); return rel => sendable(rel, { evidence: c.evidence, clear: r.clear }) },
  }
  // a private type's ctx cannot be changed from its engine.js (the engine's own calls keep using the real one)
  return manifest.private ? Object.freeze(ctx) : ctx
}

// what a command about every case of a type (a scoreboard) works with: no case, no Journal
export function makeHomeCtx(home, manifest) {
  const L = labels('en', typeLabelsOf(manifest.id, home))
  return {
    home, manifest, t: (key, vars = {}) => fill(L[key] ?? key, vars),
    cases: () => listCases(home).map(slug => ({ slug, dir: path.join(home, slug) })).filter(c => readCase(c.dir).type === manifest.id)
      .map(c => ({ ...c, props: readNote(path.join(c.dir, 'Case.md')).props, case: readCase(c.dir), hyps: hypsOf(c.dir) })),
    view: (slug, widget, data) => writeJson(path.join(home, slug, '.osint', 'views', `${widget}.json`), data),
  }
}

export async function runTypeCommand(home, slug, manifest, name, argv, { diffs = [], fresh = false, agent = [] } = {}) {
  const { commands = {} } = await loadEngine(manifest), spec = commands[name]
  if (!spec) fail(`${manifest.id}: ${Object.keys(commands).join(', ') || 'no command'}`)
  let positionals = argv, values = {}
  if (!spec.raw) {
    const options = { yes: { type: 'boolean' }, ...Object.fromEntries(Object.entries(spec.flags ?? {}).map(([k, t]) => [k, { type: t }])) } // --yes: the user's yes to a noisy step, every command takes it
    try { ({ positionals, values } = parseArgs({ args: argv, allowPositionals: true, options })) } catch (e) { fail(`${manifest.id} ${name}: ${e.message}`) }
  }
  if (spec.global) return spec.run(makeHomeCtx(home, manifest), positionals, values)
  const dir = path.join(home, slug), t0 = Date.now(), line = [manifest.id, name, ...argv].join(' ')
  // (a watch pass writes no `cmd` line: its one line says what changed; the events file keeps the command)
  const j = process.env.OSINT_BY === 'watch' ? undefined : journal(dir, 'cmd', line)
  emit(dir, { kind: 'cmd.start', text: line, ...(j && { journal: j }) })
  let code = 0
  try { await spec.run(makeCtx(home, slug, manifest, { diffs, fresh, agent }), positionals, values) } catch (e) {
    // a network or service error is the user's to read, not a stack: one Journal line, exit 1 (a bug of this code keeps its stack)
    if (!e.userError && !(e instanceof TypeError || e instanceof ReferenceError || e instanceof SyntaxError || e instanceof RangeError)) {
      const msg = `${manifest.id} ${name}: ${e.message}`, jf = journal(dir, 'fail', msg)
      emit(dir, { kind: 'fail', text: msg, journal: jf })
      e = new UserError(msg, 1)
    }
    code = e.code ?? 1; throw e
  } finally {
    emit(dir, { kind: 'cmd.end', text: line, data: { code, ms: Date.now() - t0 } })
  }
}
