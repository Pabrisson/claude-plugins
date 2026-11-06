// The dashboard's local server: the built dashboard, a JSON API over the cases folder, a Server-Sent Events stream per
// case (the event id is the byte offset in .osint/events.jsonl) and one for the home page, a watcher that turns an edit
// saved in the vault (Obsidian) into a `note.write` by `vault`. Only pages of this machine (Host, Origin) are served.
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { indexCase, summaries, summaryOf } from './brain.js'
import { caseDir, descendants, journal, listCases, parents, readCase, rootOf, updateCase } from './case.js'
import { parseLatLon } from './geo.js'
import { emit, eventsFile, lastEvents, readFrom } from './events.js'
import { printHtml, PRINT_CSP } from './print.js'
import { reverseOf } from './records.js'
import { ENGINES, reverseLinks } from './reverse.js'
import { ENGINE } from './templates.js'
import { cleanCopy } from './media.js'
import { openTunnel, sendList } from './tunnel.js'
import { findType, loadTypes } from './types.js'
import { fail, fakeApis, hasBin, isUrl, nowIso, readJson, safeName, sha256File, VERSION } from './util.js'
import { readNote } from './vault.js'
import { registerVaults } from './obsidian.js'
import { clock, dueCases, keepsServer, saveDeveloper, saveSettings, setWatch, settings, watchedCases } from './watch.js'
import { moveCase, newWorkspace, removeWorkspace, renameWorkspace, useWorkspace, workspaces } from './workspaces.js'

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' }
export const MAX_UPLOAD = 2e9
const uploadsDir = home => path.join(home, '.cache', 'uploads')
// the files of a new case from the dashboard: each comes from POST /api/uploads (never a path of this machine the page
// would name), or is a link for an input that takes one; their upload folders, removed once the engine copied them
function uploadsOf(home, b) {
  const m = loadTypes(home).find(t => t.id === b.type), root = uploadsDir(home) + path.sep, dirs = []
  for (const i of (m?.inputs ?? []).filter(x => x.kind === 'file')) {
    const v = b.inputs?.[i.id]
    if (v == null || v === '' || (i.link && isUrl(v))) continue
    const f = path.resolve(String(v))
    if (!f.startsWith(root) || !fs.existsSync(f)) throw new Error(`${i.id}: a file comes from the dashboard's upload (POST /api/uploads)`)
    dirs.push(path.dirname(f))
  }
  return dirs
}
const reply = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }
function sendFile(res, file, immutable = false, sandbox = false) {
  const st = fs.statSync(file, { throwIfNoEntry: false })
  if (!st?.isFile()) return reply(res, 404, { error: 'not found' })
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': immutable ? 'max-age=31536000, immutable' : 'no-cache', ...(sandbox && { 'Content-Security-Policy': 'sandbox', 'X-Content-Type-Options': 'nosniff' }) })
  fs.createReadStream(file).pipe(res)
}
const readBody = req => new Promise((ok, ko) => { let b = ''; req.on('data', d => { b += d; if (b.length > 1e6) req.destroy() }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}) } catch (e) { ko(e) } }); req.on('error', ko) })

export function runEngine(home, argv, engine) {
  return new Promise(ok => {
    const p = spawn(process.execPath, [engine, ...argv], { cwd: home, env: { ...process.env, OSINT_DIR: home, OSINT_BY: 'dashboard' }, windowsHide: true })
    let out = '', err = ''
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('close', code => ok({ code, out: out.trim(), err: err.trim().replace(/^error: /, '') }))
  })
}
// a file of the vault, never outside it nor in its machine state
function vaultPath(dir, rel) {
  const f = path.resolve(dir, String(rel ?? ''))
  const inside = f.startsWith(dir + path.sep) && !path.relative(dir, f).split(/[\\/]/).some(p => p.startsWith('.'))
  return inside ? f : null
}
const newArgs = (b, home) => {
  const m = loadTypes(home).find(t => t.id === b.type), main = m?.inputs.find(i => i.required) ?? m?.inputs[0]
  const argv = ['new', String(b.type ?? '')]
  const inputs = { ...(b.inputs ?? {}) }, value = main && inputs[main.id] != null ? String(inputs[main.id]) : null
  if (value != null) delete inputs[main.id]
  for (const [k, v] of Object.entries(inputs)) if (v != null && v !== '') argv.push('--in', `${k}=${v}`)
  for (const [k, v] of Object.entries(b.frame ?? {})) if (v != null && v !== '') argv.push('--frame', `${k}=${v}`)
  for (const k of ['question', 'title', 'lang']) if (b[k]) argv.push(`--${k}`, String(b[k]))
  return [...argv, '--json', ...(value != null ? ['--', value] : [])] // after `--`: a value that starts with `-` is no option
}

export async function startServer({ home, port, dist, engine, loaded, run = runEngine, watch: watchOpts = {} }) {
  try { for (const d of fs.readdirSync(uploadsDir(home))) { const f = path.join(uploadsDir(home), d); if (Date.now() - fs.statSync(f).mtimeMs > 864e5) fs.rmSync(f, { recursive: true, force: true }) } } catch {}
  const caseSubs = new Map(), viewSubs = new Map(), homeSubs = new Set()
  const publish = slug => {
    for (const push of caseSubs.get(slug) ?? []) push()
    for (const push of homeSubs) push(slug)
  }
  // one refresh at a time in this server: a Refresh clicked while a watch pass runs waits for it, and the other way
  // round (their snapshots would interleave). ponytail: an agent's own `refresh` at that very moment is not held; the
  // pass claims its case first (watch.js), so at least two passes never run a case twice
  let chain = Promise.resolve()
  // The fake APIs (developer mode, Settings › Development): the OSINT_BASE_* this server was started with, kept apart so
  // that « off » can take them out of process.env (every command this server starts inherits it, the watch included;
  // one already running ends on the old setting) and « on » put them back. Only a server started on bases that all
  // point at this machine has any; nothing a case, a type or a received folder holds can create or turn on one
  const fakeVars = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k.startsWith('OSINT_BASE_') && v))
  const fakeAvailable = Object.values(fakeVars).length > 0 && Object.values(fakeVars).every(v => { try { return new URL(v).hostname === '127.0.0.1' } catch { return false } })
  if (fakeAvailable && process.env.OSINT_DNS) fakeVars.OSINT_DNS = process.env.OSINT_DNS // the fixtures' resolver goes with them
  const fakeUrl = fakeAvailable ? new URL(fakeVars[Object.keys(fakeVars).find(k => k.startsWith('OSINT_BASE_'))]).origin : null
  const developerOn = () => settings(home).developer.on ?? fakeAvailable
  let fakeOn = fakeAvailable, applied
  const useFake = on => {
    if (!fakeAvailable) return
    for (const [k, v] of Object.entries(fakeVars)) if (on) process.env[k] = v; else delete process.env[k]
    fakeOn = on
  }
  // developer mode decides: unset or on, the fakes of a server started on them; off, the real services. The file is
  // read again when the state is asked (`setup set developer.on=…` writes it from the command line)
  const syncFake = () => { const d = developerOn(); if (d !== applied) { applied = d; useFake(d) } }
  syncFake()
  const fakeState = () => { syncFake(); return { developer: developerOn(), fake: fakeAvailable ? fakeOn : fakeApis(), fake_available: fakeAvailable, fake_url: fakeUrl, busy: queued > 0 || (server.watch?.running() ?? false) } }
  let queued = 0 // commands waiting or running in that chain: the dashboard asks before going from fake to real APIs while one runs
  const serial = fn => { queued++; const p = chain.then(fn); chain = p.catch(() => {}); p.then(() => queued--, () => queued--); return p }
  let hint
  const hintOf = () => (hint === undefined ? (hint = clickHint()) : hint)
  const sse = res => { res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' }); res.write(': connected\n\n') }

  // A case's stream covers its investigation: the case and every case below it, each event with its `case`. The id
  // holds each events file's byte offset: « <this case's>;<sub-case>=<offset>;… » (a bare number: this case's alone)
  function caseStream(req, res, slug) {
    sse(res)
    const offsets = new Map(), last = req.headers['last-event-id']
    if (last !== undefined) String(last).split(';').forEach((part, i) => {
      const [k, v] = i === 0 && !part.includes('=') ? [slug, part] : part.split('=')
      if (k && v !== '' && Number.isFinite(Number(v))) offsets.set(k, Number(v))
    })
    const id = () => [offsets.get(slug) ?? 0, ...[...offsets].filter(([k]) => k !== slug).map(([k, v]) => `${k}=${v}`)].join(';')
    const members = new Map() // slug → { push, view }
    const pushOf = s => () => {
      const d = path.join(home, s)
      if (!offsets.has(s)) offsets.set(s, (() => { try { return Math.max(0, fs.statSync(eventsFile(d)).size - 32 * 1024) } catch { return 0 } })())
      const r = readFrom(d, offsets.get(s))
      if (r.reset) res.write('event: reset\ndata: {}\n\n')
      let tree = r.reset
      for (const { offset: o, ev } of r.events) {
        offsets.set(s, o)
        res.write(`id: ${id()}\ndata: ${JSON.stringify({ ...ev, case: s })}\n\n`)
        if (ev.kind === 'note.write' && ev.path === 'Case.md') tree = true // a sub-case added (the parent's children) or moved
      }
      offsets.set(s, r.end)
      if (tree) sync()
    }
    // the members: this case and its descendants now; a sub-case made while the page is open joins
    function sync() {
      const now = new Set([slug, ...descendants(home, slug).map(x => x.slug)])
      for (const [s, m] of members) if (!now.has(s)) { caseSubs.get(s)?.delete(m.push); viewSubs.get(s)?.delete(m.view); members.delete(s) }
      for (const s of now) {
        if (members.has(s)) continue
        // a widget's data changed (.osint/views/<widget>.json): the page reloads that widget
        const m = { push: pushOf(s), view: widget => res.write(`event: view\ndata: ${JSON.stringify({ widget, case: s })}\n\n`) }
        members.set(s, m)
        caseSubs.set(s, (caseSubs.get(s) ?? new Set()).add(m.push)); viewSubs.set(s, (viewSubs.get(s) ?? new Set()).add(m.view))
        m.push()
      }
    }
    sync()
    const ping = setInterval(() => res.write(': ping\n\n'), 25e3)
    req.on('close', () => { clearInterval(ping); for (const [s, m] of members) { caseSubs.get(s)?.delete(m.push); viewSubs.get(s)?.delete(m.view) } })
  }
  function homeStream(req, res) {
    sse(res)
    const push = slug => {
      const live = fs.existsSync(path.join(home, slug, '.osint', 'case.json'))
      res.write(`data: ${JSON.stringify({ slug, summary: live ? summaryOf(home, slug) : null })}\n\n`)
    }
    // the workspaces changed (the dashboard, or the agent's `workspaces` command): every page follows
    push.workspaces = () => res.write(`event: workspaces\ndata: ${JSON.stringify(workspaces(home))}\n\n`)
    homeSubs.add(push)
    const ping = setInterval(() => res.write(': ping\n\n'), 25e3)
    req.on('close', () => { clearInterval(ping); homeSubs.delete(push) })
  }

  // one tunnel per case at most, held by this process: closed at its time, by the user, with its case or with the server
  const tunnels = new Map()
  function closeTunnel(slug, why) {
    const x = tunnels.get(slug)
    if (!x) return false
    tunnels.delete(slug); clearTimeout(x.timer); x.t.close()
    const dir = path.join(home, slug)
    if (!fs.existsSync(path.join(dir, '.osint', 'case.json'))) return true
    const by = {}
    for (const s of x.t.served) { const k = `${path.basename(x.back?.get(s.file) ?? s.file)} → ${s.engine}`; by[k] = (by[k] ?? 0) + 1 }
    const text = `tunnel closed (${why}); served: ${Object.entries(by).map(([k, n]) => `${k} ×${n}`).join(', ') || 'nothing fetched'} (engines told by their user agent)`
    const j = journal(dir, 'tunnel', text)
    updateCase(dir, c => { c.reverse = reverseOf(c); const last = c.reverse.tunnels.at(-1); if (last && !last.closed) Object.assign(last, { closed: nowIso(), served: x.t.served.map(s => ({ at: s.at, file: x.back?.get(s.file) ?? path.relative(dir, s.file).split(path.sep).join('/'), engine: s.engine })), close_journal: j }) })
    emit(dir, { kind: 'tunnel.close', text, journal: j, by: 'dashboard' })
    return true
  }
  const closeAll = why => { for (const s of [...tunnels.keys()]) closeTunnel(s, why) }
  const opening = new Set() // a case's tunnel being opened (up to 150 s): a second open would leave the first one orphaned
  async function openCaseTunnel(slug, dir, { files, minutes = 15, unmasked = false, yes = false } = {}) {
    if (opening.has(slug)) throw Object.assign(new Error('a tunnel is already opening for this case: wait for it (reverse --close to stop it)'), { status: 409, code: 1 })
    opening.add(slug)
    let t
    try {
      const list = sendList(dir, files, { unmasked, yes }), m = Math.min(Math.max(Number(minutes) || 15, 1), 120)
      const copies = []
      for (const x of list) copies.push(await cleanCopy(dir, x.rel)) // never the file as it is: no EXIF, no GPS
      t = await openTunnel(copies.map(x => x.abs))
      if (!fs.existsSync(path.join(dir, '.osint', 'case.json'))) throw new Error('the case was deleted while the tunnel opened: closed')
      return finishOpen(slug, dir, t, list, m, unmasked, new Map(copies.map((c, i) => [c.abs, list[i].rel])))
    } catch (e) { t?.close(); throw e } finally { opening.delete(slug) }
  }
  function finishOpen(slug, dir, t, list, m, unmasked, back) {
    closeTunnel(slug, 'replaced') // the new one is up: the old one never outlives its replacement (before the new record, which close would mark closed)
    const until = new Date(Date.now() + m * 60e3).toISOString()
    const out = list.map((x, i) => ({ file: x.rel, url: t.urls[i], why: x.why, links: reverseLinks(t.urls[i]) }))
    const text = `tunnel opened until ${until.slice(11, 16)} UTC (${m} min) for ${list.map(x => x.rel).join(', ')}${unmasked ? ' — sent unmasked: people visible may reach the engines' : ''}; links for ${ENGINES.map(e => e.label).join(', ')}`
    const j = journal(dir, 'tunnel', text)
    updateCase(dir, c => { c.reverse = reverseOf(c); c.reverse.tunnels.push({ opened: nowIso(), until, files: list.map(x => x.rel), unmasked, journal: j }) })
    emit(dir, { kind: 'tunnel.open', text, journal: j, by: 'dashboard', data: { until, files: out.map(({ file, url }) => ({ file, url })) } })
    tunnels.set(slug, { t, back, files: out, until, timer: setTimeout(() => closeTunnel(slug, 'time is up'), m * 60e3) })
    return { open: true, until, files: out }
  }

  // the watcher: events.jsonl and case.json publish; a note whose mtime no engine note.write carries is an edit saved
  // in the vault (Obsidian, or the agent editing a note's body). The Journal only grows: its changes are not edits
  const timers = new Map()
  const later = (key, fn) => { clearTimeout(timers.get(key)); timers.set(key, setTimeout(() => { timers.delete(key); fn() }, 100)) }
  const noteChanged = (slug, rel, at) => {
    const dir = path.join(home, slug), made = readJson(path.join(dir, '.osint', 'case.json'), null)
    if (!made) return
    const st = fs.statSync(path.join(dir, rel), { throwIfNoEntry: false }), gone = !st
    if (gone && at < Date.parse(made.created)) return // a deletion of the previous vault, the case was made again since
    const mine = !gone && lastEvents(dir, 200).some(e => e.kind === 'note.write' && e.path === rel && e.by !== 'vault' && e.mtime === st.mtimeMs)
    if (mine) return
    emit(dir, { kind: 'note.write', path: rel, by: 'vault', text: `${gone ? 'deleted' : 'edited'} ${rel}`, ...(gone && { deleted: true }) })
  }
  const watcher = fs.watch(home, { recursive: true }, (_, file) => {
    if (!file) return
    const at = Date.now()
    const parts = String(file).split(/[\\/]/), slug = parts[0], rel = parts.slice(1).join('/')
    if (slug === '.osint-settings.json') return later('|workspaces', () => { for (const push of homeSubs) push.workspaces() })
    if (!slug || slug.startsWith('.')) return
    if (rel === '' || rel === '.osint/events.jsonl' || rel === '.osint/case.json') return later(`${slug}|`, () => publish(slug))
    if (rel.startsWith('.osint/views/') && rel.endsWith('.json')) return later(`${slug}|${rel}`, () => { for (const view of viewSubs.get(slug) ?? []) view(path.posix.basename(rel, '.json')) })
    if (rel === 'Journal.md') return
    if (/\.(md|canvas)$/.test(rel) && !parts.slice(1).some(p => p.startsWith('.'))) return later(`${slug}|${rel}`, () => noteChanged(slug, rel, at))
  })
  // Linux: Node's recursive watcher walks a folder that vanished meanwhile (the engine's lock folder) and throws outside any handler
  if (process.platform === 'linux') process.on('uncaughtException', e => { if (e?.code === 'ENOENT' && /recursive_watch/.test(e.stack ?? '') ) return; throw e })

  async function handle(req, res) {
    const { host, origin } = req.headers, port = req.socket.localPort
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host) || (origin && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(origin))) return reply(res, 403, { error: 'forbidden' })
    const url = new URL(req.url, `http://${host}`), p = url.pathname, method = req.method
    if (p === '/__osint') return reply(res, 200, { engine, home, mtime: loaded })
    if (p === '/__osint/quit' && method === 'POST') { res.on('finish', () => { closeAll('server stopped'); process.exit(0) }); return reply(res, 200, {}) }
    if (p === '/__osint/owner' && method === 'POST') { const pid = +url.searchParams.get('pid'); if (!(pid > 1)) return reply(res, 400, { error: 'expects ?pid=<process id>' }); watchOwner(pid, home); return reply(res, 200, {}) }
    if (p === '/api/state') return reply(res, 200, { home, version: VERSION, ...fakeState() })
    if (p === '/api/developer' && method === 'POST') {
      const b = await readBody(req)
      if (typeof b?.on !== 'boolean') return reply(res, 400, { error: 'on: true|false' })
      saveDeveloper(home, b.on); applied = b.on; useFake(b.on)
      return reply(res, 200, fakeState())
    }
    if (p === '/api/fake' && method === 'POST') {
      const b = await readBody(req)
      if (typeof b?.on !== 'boolean') return reply(res, 400, { error: 'on: true|false' })
      if (!fakeAvailable) return reply(res, 409, { error: 'this server was not started on fake APIs: nothing to turn on' })
      if (b.on && !developerOn()) return reply(res, 409, { error: 'developer mode is off: turn it on first (Settings › Development)' })
      useFake(b.on)
      return reply(res, 200, fakeState())
    }
    if (p === '/api/types') return reply(res, 200, loadTypes(home).map(({ dir, ...t }) => t))
    if (p === '/api/events') return homeStream(req, res)
    if (p === '/api/watch') {
      if (method === 'POST') {
        const b = await readBody(req), patch = {}
        for (const k of ['on', 'notify']) if (b[k] !== undefined) {
          if (typeof b[k] !== 'boolean') return reply(res, 400, { error: `${k}: true|false` })
          patch[k] = b[k]
        }
        saveSettings(home, patch)
      }
      return reply(res, 200, { ...settings(home).watch, click_hint: hintOf(), running: server.watch?.running() ?? false, stops: stopsSoon(home), cases: watchedCases(home) })
    }
    if (p === '/api/cases' && method === 'GET') return reply(res, 200, summaries(home))
    if (p === '/api/workspaces') {
      if (method === 'POST') {
        const b = await readBody(req)
        try {
          if (b.new != null) newWorkspace(home, b.new)
          else if (b.use) useWorkspace(home, String(b.slug))
          else if (b.rename != null) renameWorkspace(home, String(b.slug), b.rename)
          else if (b.remove) removeWorkspace(home, String(b.slug))
          else if (b.move) moveCase(home, String(b.move), String(b.slug))
          else return reply(res, 400, { error: 'expects { new: <name> } or { slug, use | rename: <name> | remove | move: <case> }' })
        } catch (e) { if (!e.userError) throw e; return reply(res, 400, { error: e.message }) }
      }
      return reply(res, 200, workspaces(home))
    }
    if (p === '/api/uploads' && method === 'POST') {
      const name = safeName(url.searchParams.get('name') ?? ''), size = Number(req.headers['content-length'])
      if (!/\.[a-z0-9]{2,5}$/i.test(name)) return reply(res, 400, { error: 'expects ?name=<the file name, with its extension>' })
      if (!(size > 0)) return reply(res, 411, { error: 'expects the file as the body, with its Content-Length' })
      if (size > MAX_UPLOAD) return reply(res, 413, { error: `${Math.round(size / 1e6)} MB: the dashboard takes files up to ${MAX_UPLOAD / 1e9} GB; give a bigger one to the agent by its path` })
      const d = path.join(uploadsDir(home), randomBytes(8).toString('hex')), f = path.join(d, name)
      fs.mkdirSync(d, { recursive: true })
      try { await pipeline(req, fs.createWriteStream(f)) } catch (e) { fs.rmSync(d, { recursive: true, force: true }); return reply(res, 400, { error: `upload interrupted: ${e.message}` }) }
      if (fs.statSync(f).size !== size) { fs.rmSync(d, { recursive: true, force: true }); return reply(res, 400, { error: 'upload interrupted' }) }
      return reply(res, 200, { path: f, name, size })
    }
    if (p === '/api/cases' && method === 'POST') {
      const b = await readBody(req)
      let dirs
      try { dirs = uploadsOf(home, b) } catch (e) { return reply(res, 400, { error: e.message }) }
      const r = await runEngine(home, newArgs(b, home), engine)
      for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
      return r.code === 0 ? reply(res, 200, { slug: JSON.parse(r.out).slug }) : reply(res, 400, { error: r.err })
    }
    const m = /^\/api\/cases\/([a-z0-9][a-z0-9-]*)(\/[a-z]+(?:\/[\w-]+)?)?$/.exec(p)
    if (m) {
      const slug = m[1], sub = m[2] ?? ''
      let dir
      try { dir = caseDir(home, slug) } catch { return reply(res, 404, { error: `no case ${slug}` }) }
      // a case with its investigation: the case at its top (root), and below a top case every sub-case's own index
      if (sub === '' && method === 'GET') {
        const up = parents(home), root = rootOf(home, slug, up)
        const subcases = root !== slug ? [] : descendants(home, slug, up).flatMap(d => { try { return [{ ...indexCase(home, d.slug), parent: d.parent, depth: d.depth }] } catch { return [] } })
        return reply(res, 200, { ...indexCase(home, slug), root, subcases })
      }
      // a case goes to .trash with the cases below it
      if (sub === '' && method === 'DELETE') {
        const tree = [slug, ...descendants(home, slug).map(x => x.slug)], at = nowIso().replace(/[:.]/g, '-')
        fs.mkdirSync(path.join(home, '.trash'), { recursive: true })
        for (const s of tree) { closeTunnel(s, 'case deleted'); fs.renameSync(path.join(home, s), path.join(home, '.trash', `${s}-${at}`)) }
        return reply(res, 200, { deleted: tree })
      }
      if (sub === '/tunnel' && method === 'GET') { const x = tunnels.get(slug); return reply(res, 200, x ? { open: true, until: x.until, files: x.files, served: x.t.served.length } : { open: false, cloudflared: hasBin('cloudflared') }) }
      if (sub === '/tunnel' && method === 'POST') {
        try { return reply(res, 200, await openCaseTunnel(slug, dir, await readBody(req))) } catch (e) { return reply(res, e.status ?? (e.userError ? 400 : 500), { error: e.message, code: e.code ?? 1 }) }
      }
      if (sub === '/tunnel' && method === 'DELETE') return reply(res, 200, { closed: closeTunnel(slug, 'closed by the user') })
      if (sub === '/capture' && method === 'POST') {
        const name = safeName(url.searchParams.get('name') ?? 'capture.png'), size = Number(req.headers['content-length'])
        if (!/\.(png|jpe?g|webp|gif)$/i.test(name)) return reply(res, 400, { error: 'a capture is an image: ?name=<name>.png|jpg|webp|gif' })
        if (!(size > 0) || size > 30e6) return reply(res, 413, { error: 'a capture of up to 30 MB, with its Content-Length' })
        const ext = path.extname(name), stem = name.slice(0, -ext.length)
        fs.mkdirSync(path.join(dir, 'Evidence', 'captures'), { recursive: true })
        let n = 1, rel
        do rel = `Evidence/captures/${stem}-${n++}${ext}`; while (fs.existsSync(path.join(dir, rel)))
        await pipeline(req, fs.createWriteStream(path.join(dir, rel)))
        const j = journal(dir, 'capture', `pasted from the dashboard: ${rel} · sha256 ${sha256File(path.join(dir, rel)).slice(0, 12)}`)
        emit(dir, { kind: 'log', text: `capture pasted: ${rel}`, journal: j, by: 'dashboard' })
        return reply(res, 200, { path: rel })
      }
      if (sub === '/truth' && method === 'POST') {
        const b = await readBody(req), ll = parseLatLon(`${b?.lat},${b?.lon}`)
        if (!ll) return reply(res, 400, { error: 'expects { "lat": <decimal degrees>, "lon": <decimal degrees> }' })
        const r = await runEngine(home, ['geolocate-image', 'truth', ll.join(','), '-p', slug], engine)
        return r.code === 0 ? reply(res, 200, readCase(dir).state['geolocate-image']?.truth ?? {}) : reply(res, 400, { error: r.err, code: r.code })
      }
      if (sub === '/events') return caseStream(req, res, slug)
      if (sub === '/note') {
        const f = vaultPath(dir, url.searchParams.get('path'))
        if (!f || !f.endsWith('.md') || !fs.existsSync(f)) return reply(res, 404, { error: 'not found' })
        const n = readNote(f)
        return reply(res, 200, { path: url.searchParams.get('path'), props: n.props, body: n.body, mtime: fs.statSync(f).mtime.toISOString() })
      }
      if (sub === '/file') { const f = vaultPath(dir, url.searchParams.get('path')); return f ? sendFile(res, f, false, true) : reply(res, 404, { error: 'not found' }) }
      if (sub.startsWith('/view/')) return reply(res, 200, readJson(path.join(dir, '.osint', 'views', `${sub.slice(6)}.json`), null))
      // « Open in Obsidian »: the case's investigation registered as vaults when Obsidian can take them (lib/obsidian.js)
      if (sub === '/obsidian' && method === 'POST') {
        const up = parents(home), root = rootOf(home, slug, up), tree = [root, ...descendants(home, root, up).map(x => x.slug)]
        return reply(res, 200, { dir, ...registerVaults([dir, ...tree.filter(s => s !== slug).map(s => path.join(home, s))]) })
      }
      if (sub === '/seen' && method === 'POST') { updateCase(dir, c => { c.seen_at = nowIso() }); return reply(res, 200, {}) }
      if (sub === '/watch' && method === 'POST') {
        const b = await readBody(req)
        try { return reply(res, 200, { watch: setWatch(home, slug, String(b.every ?? ''), { by: 'dashboard' }), stops: stopsSoon(home) }) } catch (e) {
          if (!e.userError) throw e
          return reply(res, 400, { error: e.message })
        }
      }
      if (sub === '/refresh' && method === 'POST') {
        // a refresh runs the type's engine.js: a private type's is the user's (or someone else's) code, run by the agent, never by a click
        const own = findType(readCase(dir).type, home)
        if (own?.private) return reply(res, 403, { error: `the private type ${own.id} runs its engine.js: ask the Agent (Copy prompt), who reads it and runs osint.mjs refresh`, code: 1 })
        let r = await serial(() => run(home, ['refresh', '-p', slug, '--json'], engine)), skipped = []
        if (r.code === 2) { // noisy=ask: the dashboard has no yes to give, so the quiet steps run and the noisy ones are said
          const steps = loadTypes(home).find(t => t.id === readCase(dir).type)?.refresh ?? []
          skipped = steps.filter(x => x.noisy).map(x => x.id)
          r = await serial(() => run(home, ['refresh', '-p', slug, '--only', steps.filter(x => !x.noisy).map(x => x.id).join(','), '--json'], engine))
        }
        if (r.code === 0 && skipped.length) return reply(res, 200, { ...JSON.parse(r.out), skipped })
        return r.code === 0 ? reply(res, 200, JSON.parse(r.out)) : reply(res, 400, { error: r.err, code: r.code })
      }
      if (sub === '/export' && method === 'POST') {
        const r = await runEngine(home, ['export', '-p', slug, '--json', ...(url.searchParams.get('journal') === '1' ? ['--journal'] : [])], engine)
        return r.code === 0 ? reply(res, 200, JSON.parse(r.out)) : reply(res, 400, { error: r.err, code: r.code })
      }
      return reply(res, 404, { error: 'not found' })
    }
    if (p === '/api/entities/shared') { const r = await runEngine(home, ['brain', 'entities', '--all', '--shared', '--json'], engine); return r.code === 0 ? reply(res, 200, JSON.parse(r.out)) : reply(res, 200, []) }
    if (p === '/api/doctor') { const r = await runEngine(home, ['doctor', '--json'], engine); return reply(res, 200, JSON.parse(r.out || '{"lines":[]}')) }
    if (p === '/api/doctor/network' && method === 'POST') { const r = await runEngine(home, ['doctor', '--network', '--json'], engine); return reply(res, 200, JSON.parse(r.out || '{"lines":[]}')) }
    // the print view: one static page per case, what « Print view » opens and `export` prints. Same Host/Origin checks as
    // everything above; its Content-Security-Policy lets the browser load nothing but this server's own images
    const pm = /^\/print\/([a-z0-9][a-z0-9-]*)$/.exec(p)
    if (pm) {
      if (method !== 'GET') return reply(res, 405, { error: 'GET only' })
      if (!listCases(home).includes(pm[1])) return reply(res, 404, { error: `no case ${pm[1]}` })
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': PRINT_CSP, 'X-Frame-Options': 'DENY', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' })
      return res.end(printHtml(home, pm[1], { journal: url.searchParams.get('journal') === '1' }))
    }
    if (p.startsWith('/api/')) return reply(res, 404, { error: 'not found' })
    // the dashboard: its files, else its page (the routes live in the hash and the path)
    const f = path.join(dist, path.normalize(decodeURIComponent(p)).replace(/^([\\/]\.\.)+/, ''))
    if (f.startsWith(dist + path.sep) && fs.statSync(f, { throwIfNoEntry: false })?.isFile()) return sendFile(res, f, p.startsWith('/assets/'))
    return sendFile(res, path.join(dist, 'index.html'))
  }

  const server = http.createServer((req, res) => handle(req, res).catch(e => reply(res, 500, { error: e.message })))
  server.on('close', () => { closeAll('server stopped'); watcher.close() })
  server.closeTunnels = closeAll
  await new Promise(ok => server.listen(port, '127.0.0.1', ok))
  // watch: false — a server that only lives for one command (stage 12's export) runs no pass
  server.watch = watchOpts === false ? null : startWatch({ home, engine, port: server.address().port, serial, run, ...watchOpts })
  server.on('close', () => server.watch?.stop())
  return server
}

// The agents this server works for (each `dashboard` or `watch --every` adds its own): once they have all quit it
// stops — unless a case is watched (§ 12.1): it then runs on until « Stop server » in Settings or the end of the
// session. A server nobody registered with (started by hand, the demo, the tests) runs until stopped.
const owners = new Set()
let checking = null
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code !== 'ESRCH' } }
function watchOwner(pid, home) {
  owners.add(pid)
  checking ??= setInterval(() => {
    for (const o of owners) if (!alive(o)) owners.delete(o)
    if (!owners.size && !keepsServer(home)) { console.log('every agent this dashboard server worked for has quit and no case is watched: stopping'); process.exit(0) }
  }, 2000)
}
// the server stops within 2 s: agents opened it, all have quit, and nothing is watched any more
export const stopsSoon = home => !!checking && ![...owners].some(alive) && !keepsServer(home)
// ponytail: known agent names only, as in skill-immo; on Windows (no ps) null, the server runs until logoff
const AGENT = /^(claude|codex|gemini|qwen|copilot|opencode|cursor-agent|goose|amp|crush|droid|kiro-cli|auggie)(-cli|-code)?$/i
export function agentPid() {
  try {
    const procs = new Map(execFileSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8', windowsHide: true }).trim().split('\n').map(l => {
      const [, pid, ppid, comm] = l.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
      return [+pid, { ppid: +ppid, comm }]
    }))
    for (let pid = process.ppid; pid > 1 && procs.has(pid); pid = procs.get(pid).ppid) {
      const name = path.basename(procs.get(pid).comm).replace(/\.exe$/i, '')
      if (AGENT.test(name)) return pid
      if (/^(node|bun|deno|python3?)$/i.test(name)) {
        const script = execFileSync('ps', ['-o', 'args=', '-p', `${pid}`], { encoding: 'utf8', windowsHide: true }).trim().split(/\s+/).slice(1).find(a => !a.startsWith('-')) ?? ''
        if (script.split(/[/\\]/).some(w => AGENT.test(w.replace(/\.(m?js|py)$/i, '')))) return pid
      }
    }
  } catch {}
  return null
}
// the server of this cases folder, started in the background when none runs this very engine; from port up
export async function findServer({ home, port, engine, loaded }) {
  const sleep = t => new Promise(ok => setTimeout(ok, t)), base = n => `http://127.0.0.1:${n}/`
  const ping = n => fetch(base(n) + '__osint').then(r => r.json()).catch(() => null)
  const ports = Array.from({ length: 20 }, (_, i) => port + i), lives = await Promise.all(ports.map(ping))
  let i = lives.findIndex(l => l?.home === home)
  if (i >= 0 && lives[i].engine === engine && lives[i].mtime === loaded) return base(ports[i])
  if (i >= 0) { await fetch(base(ports[i]) + '__osint/quit', { method: 'POST' }).catch(() => {}); await sleep(300); lives[i] = null } else i = 0
  fs.mkdirSync(home, { recursive: true })
  const log = fs.openSync(path.join(home, '.dashboard.log'), 'a')
  for (; i < ports.length; i++) {
    if (lives[i]) continue
    spawn(process.execPath, [engine, 'serve'], { cwd: home, env: { ...process.env, OSINT_DIR: home, OSINT_PORT: `${ports[i]}` }, detached: true, windowsHide: true, stdio: ['ignore', log, log] }).unref()
    let live = null
    for (let k = 0; k < 50 && !(live = await ping(ports[i])); k++) await sleep(100)
    if (live?.home === home) return base(ports[i])
  }
  throw new Error(`the dashboard server did not start on ports ${port}–${port + 19}, see ${path.join(home, '.dashboard.log')}`)
}
// the dashboard server of this folder (started when none runs this engine), asked for what only it can hold (a tunnel);
// the agent that asks becomes one of its owners, so that it stops once the agents have quit
export async function viaServer(home, method, route, body) {
  const engine = path.join(ENGINE, 'osint.mjs'), base = await findServer({ home, port: +(process.env.OSINT_PORT || 41387), engine, loaded: fs.statSync(engine).mtimeMs })
  const owner = agentPid()
  if (owner) await fetch(`${base}__osint/owner?pid=${owner}`, { method: 'POST' }).catch(() => {})
  const r = await fetch(new URL(route.replace(/^\//, ''), base), { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) fail(j.error ?? `the dashboard server answered ${r.status}`, j.code ?? 1)
  return j
}
// Windows PowerShell 5.1 toast (skill-immo's): the XML comes from an env var, nothing needs quoting; its protocol
// activation opens the case's URL on a click. ponytail: the click is checked by the user on Windows, not by the tests
const PS_TOAST = '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;'
  + '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null;'
  + '$x = New-Object Windows.Data.Xml.Dom.XmlDocument; $x.LoadXml($env:OSINT_TOAST);'
  + "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))"
// the text of a notification is a case's input or a third party's words: one line of plain characters (no control
// character, which XML refuses and a terminal would act on), of a bounded length, never starting with a dash (a tool
// would read it as one of its options)
export const plain = (t, max = 240) => {
  const s = String(t).replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim()
  return (s.length > max ? `${s.slice(0, max - 1)}…` : s).replace(/^[-@]/, '· $&')
}
// The commands that show a desktop notification on this OS, tried in turn: macOS terminal-notifier (a click opens the
// case), else osascript; Linux notify-send with an « Open case » action (0.7.10 and later print the action's name when
// it is clicked), else a plain one; Windows a toast. The case's text goes as separate arguments (after `--` for
// notify-send), as AppleScript's argv, or as escaped XML: never through a shell, never into a script's source
export function notifyPlan(title, message, url, platform = process.platform) {
  title = plain(title, 80); message = plain(message)
  const xml = t => String(t).replace(/[<>&"']/g, c => `&#${c.charCodeAt(0)};`)
  const toast = `<toast activationType="protocol" launch="${xml(url)}"><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(message)}</text></binding></visual></toast>`
  // notify-send shows the body as markup (links, bold): the text is escaped so that it shows as it is
  const markup = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
  return {
    darwin: [
      { bin: 'terminal-notifier', args: ['-title', title, '-message', message, '-open', url] },
      { bin: 'osascript', args: ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title (item 1 of argv)', '-e', 'end run', title, message] },
    ],
    win32: [{ bin: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', PS_TOAST], env: { OSINT_TOAST: toast } }],
  }[platform] ?? [
    { bin: 'notify-send', args: ['--app-name=OSINT', '--action=open=Open case', '--', title, markup(message)], open: 'open' },
    { bin: 'notify-send', args: ['--app-name=OSINT', '--', title, markup(message)] },
  ]
}
// a desktop notification, never fatal: the next command when one is missing or refuses its options; OSINT_NOTIFY=0
// turns them off (the tests, the demo). Resolves when the last command tried has ended
export function notify(title, message, url) {
  if (process.env.OSINT_NOTIFY === '0') return Promise.resolve()
  return new Promise(done => {
    const next = ([t, ...rest]) => {
      if (!t) return done()
      let out = '', moved = false
      const fallback = () => { if (!moved) { moved = true; next(rest) } }
      const p = spawn(t.bin, t.args, { env: { ...process.env, ...t.env }, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
      p.stdout.on('data', d => (out += d))
      p.on('error', fallback)
      p.on('close', code => { if (code && !out) fallback(); else { if (t.open && out.trim() === t.open) openUrl(url); done() } })
    }
    next(notifyPlan(title, message, url))
  })
}
// null when a click on a notification opens the case on this machine; else what to install for it
export function clickHint() {
  if (process.platform === 'win32') return null
  if (process.platform === 'darwin') return spawnSync('terminal-notifier', ['-help'], { stdio: 'ignore', windowsHide: true }).error ? 'a click opens Script Editor, not the case: brew install terminal-notifier' : null
  const help = spawnSync('notify-send', ['--help'], { encoding: 'utf8', windowsHide: true })
  if (help.error) return 'no desktop notification on this machine: sudo apt install libnotify-bin'
  return /--action/.test(help.stdout ?? '') ? null : 'a click does not open the case: notify-send 0.7.10 or later (libnotify-bin) does'
}

// The watch in the server (§ 12.1): at its start (a server started again catches up) then every minute, the cases
// that are due get their pass, all in one engine run (`watch --due`: one case at a time, one host's gaps kept from one
// case to the next), never two rounds at once; then a desktop notification per case where something changed. A
// computer that slept fires the timer once, not once per period missed. The timer is this server's: it stops with it.
// ponytail: a pass that never returns holds the watch; kill the run after an hour if a type ever hangs
export function startWatch({ home, engine, port, serial = fn => fn(), run = runEngine, notify: send = notify, now = clock, every = 60e3 }) {
  let busy = null
  const tick = () => {
    if (busy) return busy
    if (!dueCases(home, now()).length) return Promise.resolve(null)
    busy = serial(() => run(home, ['watch', '--due', '--json'], engine)).then(r => {
      if (r.code !== 0) { console.log(`watch: ${r.err}`); return null }
      const out = JSON.parse(r.out), on = settings(home).watch.notify
      for (const p of out.passes) {
        console.log(`watch ${p.slug}: ${p.error ? `the pass failed — ${p.error}` : p.text ?? 'nothing changed'}`)
        if (on && p.text) send('OSINT watch', p.text, `http://127.0.0.1:${port}/#/c/${p.slug}`)
      }
      return out
    }).catch(e => { console.log(`watch: ${e.message}`); return null }).finally(() => { busy = null })
    return busy
  }
  const timer = setInterval(tick, every)
  timer.unref()
  tick()
  return { tick, stop: () => clearInterval(timer), running: () => !!busy }
}

export function openUrl(url) {
  const [bin, ...argv] = { darwin: ['open'], win32: ['cmd', '/c', 'start', ''] }[process.platform] ?? ['xdg-open']
  spawn(bin, [...argv, url], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref()
}
