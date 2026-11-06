#!/usr/bin/env node
// skill-osint's engine. OSINT cases as Obsidian vaults in the folder the agent runs in ($OSINT_DIR overrides it), one
// folder per case. Commands on a case take -p <slug>. Exit codes: 1 an error or a refusal, 2 the user's yes is needed
// (run again with --yes), 3 a tool is missing (degraded mode).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { caseDir, createCase, homeDir, listCases, logStep, readCase, setStatus, updateCase } from './lib/case.js'
import { context, entities, search, show } from './lib/brain.js'
import { clue, declareClear, entity, evidence, note, reverseVerdict, source } from './lib/records.js'
import { sendList } from './lib/tunnel.js'
import { conclude, hypAdd, hypExclude, hypLr, hypRetain, next, nextDone, ranking, redteam } from './lib/cycle.js'
import { refresh } from './lib/refresh.js'
import { doctor, printDoctor, setup, setupSet, typeReport } from './lib/doctor.js'
import { exportPdf } from './lib/export.js'
import { agentPid, findServer, openUrl, startServer, viaServer } from './lib/server.js'
import { parseLatLon } from './lib/geo.js'
import { maskEvidence } from './lib/media.js'
import { PACKS } from './lib/python.js'
import { parseWhen, recordSun, recordWeather, sunAt, sunDay, weatherDay } from './lib/sun.js'
import { getType, loadEngine, RESERVED_IDS, runTypeCommand, scanTypes } from './lib/types.js'
import { fail, hasBin, INSTALL, nowIso, sha256File } from './lib/util.js'
import { readNote } from './lib/vault.js'
import { runDue, saveSettings, setWatch, settings, watchedCases, when } from './lib/watch.js'
import { watchSteps } from './lib/watch-rules.js'

// `osint.mjs <type> <command> [flags] -p <slug>`: the type's own flags, parsed by its engine.js. A refused private
// type's name comes here too (never a reserved one: that is the engine's command), so that getType says why
const first = process.argv[2], scanned = scanTypes()
if (scanned.types.some(t => t.id === first) || scanned.rejected.some(r => r.id === first && !RESERVED_IDS.includes(first))) {
  const rest = process.argv.slice(4), i = rest.findIndex(a => a === '-p' || a === '--project')
  const slug = i >= 0 ? rest[i + 1] : null, argv = i >= 0 ? [...rest.slice(0, i), ...rest.slice(i + 2)] : rest
  try {
    const home = homeDir(), m = getType(first), { commands = {} } = await loadEngine(m)
    if (commands[process.argv[3]]?.global) await runTypeCommand(home, null, m, process.argv[3], argv)
    else {
      const dir = caseDir(home, slug)
      if (readCase(dir).type !== first) fail(`${slug} is a ${readCase(dir).type} case, not ${first}`)
      await runTypeCommand(home, path.basename(dir), m, process.argv[3], argv)
      if (!process.env.OSINT_BY) updateCase(dir, c => { c.agent_at = nowIso() })
    }
  } catch (e) { if (!e.userError) throw e; console.error(`error: ${e.message}`); process.exit(e.code) }
  process.exit(process.exitCode ?? 0)
}

// a bare --journal of `export` (nothing after it, or another option) is its switch: the Journal as an appendix;
// `clue --journal j042` names the entry a clue cites and keeps its value
const ARGV = process.argv.slice(2).map((a, i, all) => (all[0] === 'export' && a === '--journal' && !/^[^-]/.test(all[i + 1] ?? '') ? '--appendix' : a))
let opt, cmd, args
try {
  ({ values: opt, positionals: [cmd, ...args] } = parseArgs({
    args: ARGV,
    allowPositionals: true,
    options: {
      project: { type: 'string', short: 'p' }, json: { type: 'boolean' }, yes: { type: 'boolean' },
      question: { type: 'string' }, lang: { type: 'string' }, title: { type: 'string' }, in: { type: 'string', multiple: true }, frame: { type: 'string', multiple: true },
      parent: { type: 'string' }, from: { type: 'string' }, phase: { type: 'string' }, progress: { type: 'string' }, fail: { type: 'boolean' }, end: { type: 'boolean' },
      every: { type: 'string' }, due: { type: 'boolean' }, pause: { type: 'boolean' }, resume: { type: 'boolean' }, notify: { type: 'string' },
      set: { type: 'string' }, why: { type: 'string' }, open: { type: 'boolean' },
      confidence: { type: 'string' }, sources: { type: 'string' }, entities: { type: 'string' }, aliases: { type: 'string' }, prop: { type: 'string', multiple: true },
      appendix: { type: 'boolean' }, status: { type: 'string' }, where: { type: 'string' }, credibility: { type: 'string' }, constraint: { type: 'boolean' }, journal: { type: 'string' },
      file: { type: 'string' }, level: { type: 'string' }, under: { type: 'string' }, 'refute-if': { type: 'string' }, point: { type: 'string' }, radius: { type: 'string' }, prior: { type: 'string' }, clue: { type: 'string' }, lr: { type: 'string' }, covers: { type: 'string' }, done: { type: 'string' }, all: { type: 'boolean' }, only: { type: 'string' }, network: { type: 'boolean' }, 'no-load': { type: 'boolean' }, kind: { type: 'string' }, shared: { type: 'boolean' }, archive: { type: 'string' }, reliability: { type: 'string' }, text: { type: 'string' }, block: { type: 'string' }, of: { type: 'string' },
      files: { type: 'string' }, minutes: { type: 'string' }, unmasked: { type: 'boolean' }, 'no-people': { type: 'boolean' }, close: { type: 'boolean' }, box: { type: 'string', multiple: true }, people: { type: 'boolean' }, at: { type: 'string' }, date: { type: 'string' }, tz: { type: 'string' }, 'shadow-bearing': { type: 'string' }, ratio: { type: 'string' }, tol: { type: 'string' }, hour: { type: 'string' },
    },
  }))
} catch (e) { console.error(`error: ${e.message}`); process.exit(1) }

const HOME = homeDir()
const kv = list => Object.fromEntries((list ?? []).map(s => {
  const i = s.indexOf('=')
  if (i < 1) fail(`expects key=value: ${s}`)
  return [s.slice(0, i), s.slice(i + 1)]
}))
const out = (data, text) => console.log(opt.json ? JSON.stringify(data, null, 2) : text)
const dir = () => caseDir(HOME, opt.project)

export const COMMANDS = {
  new: async () => {
    const [type, ...rest] = args
    const r = await createCase(HOME, getType(type), { input: rest.join(' ') || undefined, inputs: kv(opt.in), file: opt.file, question: opt.question, frame: kv(opt.frame), title: opt.title, lang: opt.lang, parent: opt.parent, from: opt.from })
    out(r, `case ${r.slug}: ${r.dir}`)
  },
  list: () => {
    const rows = listCases(HOME).map(slug => { const p = readNote(path.join(HOME, slug, 'Case.md')).props; return { slug, type: p.type, status: p.status, phase: p.phase, question: p.question } })
    out(rows, rows.map(r => `${r.slug}  ${r.type} · ${r.status}${r.phase ? ` · ${r.phase}` : ''} — ${r.question}`).join('\n') || `no case in ${HOME}`)
  },
  status: () => {
    const d = dir()
    if (opt.set) return setStatus(d, opt.set, opt.why)
    const p = readNote(path.join(d, 'Case.md')).props, m = getType(readCase(d).type)
    const packs = Object.fromEntries((m.requires?.packs ?? []).map(x => [x.id, { dir: PACKS[x.id]?.dir() ?? null, ready: !!PACKS[x.id]?.ready() }]))
    // the originals are hashed again: one that changed since it was added is said
    const bad = (readCase(d).evidence ?? []).flatMap(e => { const f = path.join(d, e.file); return !fs.existsSync(f) ? [{ id: e.id, file: e.file, problem: 'gone' }] : sha256File(f) !== e.sha256 ? [{ id: e.id, file: e.file, problem: 'changed' }] : [] })
    out({ slug: opt.project, ...p, packs, evidence_problems: bad }, [`${opt.project}: ${p.type} · ${p.status}${p.phase ? ` · ${p.phase}` : ''}`, `question: ${p.question}`, `folder: ${d}`, ...Object.entries(packs).map(([id, x]) => (x.ready ? `pack ${id}: ${x.dir}\nreferences: ${path.join(x.dir, 'references')}` : `pack ${id}: not set up (${PACKS[id]?.setup ?? 'setup'})`)), ...bad.map(b => `warning: ${b.id} ${b.file} ${b.problem === 'gone' ? 'is gone' : 'changed since it was added (sha256 differs): the original must stay intact'}`)].join('\n'))
  },
  log: () => logStep(dir(), getType(readCase(dir()).type), { phase: opt.phase, text: args.join(' '), progress: opt.progress, failed: opt.fail, end: opt.end }),
}

const list = s => (s ? String(s).split(',').map(x => x.trim()).filter(Boolean) : [])
Object.assign(COMMANDS, {
  entity: () => { const [kind, ...v] = args; const r = entity(dir(), kind, v.join(' '), { confidence: opt.confidence, sources: list(opt.sources), aliases: opt.aliases ? list(opt.aliases) : undefined, props: kv(opt.prop) }); out(r, `${r.created ? 'added' : 'updated'} ${r.path}`) },
  clue: () => { const r = clue(dir(), args.join(' '), { status: opt.status, where: opt.where, credibility: opt.credibility, constraint: opt.constraint, sources: list(opt.sources), entities: list(opt.entities), journal: opt.journal, title: opt.title }); out(r, `${r.id}: ${r.path}`) },
  source: async () => { const r = await source(dir(), { url: args[0], file: opt.file, archive: opt.archive, reliability: opt.reliability, title: opt.title }); out({ ...r, body: undefined }, `${r.id}: ${r.path} (sha256 ${r.sha256.slice(0, 12)})`) },
  evidence: async () => {
    if (args[0] === 'mask') { const r = await maskEvidence(dir(), args[1], { boxes: opt.box ?? [], people: opt.people }); return out(r, `${r.id}: ${r.file} — ${r.boxes.length} boxes painted out (${r.tool})`) }
    const r = await evidence(dir(), args.join(' '), { of: opt.of })
    out(r, `${r.id}: ${r.file} (sha256 ${r.sha256.slice(0, 12)})`)
  },
  reverse: async () => {
    const d = dir(), slug = path.basename(d)
    if (args[0] === 'verdict') { const r = reverseVerdict(d, readFileJson(opt.file)); return out(r, r.map(v => `${v.candidate}: ${v.verdict}${v.clue ? ` → ${v.clue}` : ''}`).join('\n')) }
    if (opt.close) { const r = await viaServer(HOME, 'DELETE', `/api/cases/${slug}/tunnel`); return out(r, r.closed ? 'tunnel closed' : 'no tunnel was open') }
    const refs = list(opt.files)
    if (opt['no-people']) declareClear(d, refs)
    sendList(d, refs, { unmasked: !!opt.unmasked, yes: !!opt.yes })   // the frame and the files, refused before any server starts
    if (!hasBin('cloudflared')) fail(`reverse search by link needs cloudflared: ${INSTALL.cloudflared} (no account); Yandex and Baidu work without it (geolocate-image recon)`, 3)
    const r = await viaServer(HOME, 'POST', `/api/cases/${slug}/tunnel`, { files: refs, minutes: opt.minutes ? Number(opt.minutes) : 15, unmasked: !!opt.unmasked, yes: !!opt.yes })
    out(r, [`tunnel open until ${r.until.slice(11, 16)} UTC: ${r.files.length} file${r.files.length > 1 ? 's' : ''}`, ...r.files.flatMap(f => [f.file, ...f.links.map(l => `  ${l.label.padEnd(12)} ${l.url}`)]),
      'open each link in a browser, one picture at a time; reverse --close when done'].join('\n'))
  },
  note: () => { const text = opt.file ? fs.readFileSync(opt.file, 'utf8') : opt.text; if (text == null) fail('note <path> --file <file> | --text <text>'); out(note(dir(), args[0], { text, block: opt.block }), `wrote ${args[0]}`) },
})

const manifestOf = () => getType(readCase(dir()).type)
const readFileJson = f => { if (!f) fail('--file <a JSON file>'); try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { fail(`${f}: ${e.message}`) } }
Object.assign(COMMANDS, {
  hyp: () => {
    const [sub, ...rest] = args, m = manifestOf()
    if (sub === 'add') return out(hypAdd(dir(), m, { title: rest.join(' '), level: opt.level, under: opt.under, refuteIf: opt['refute-if'], point: opt.point, radius: opt.radius, prior: opt.prior }), 'added')
    if (sub === 'lr') return void hypLr(dir(), m, { hyp: rest[0], clue: opt.clue, lr: opt.lr, why: opt.why })
    if (sub === 'exclude') return void hypExclude(dir(), m, { hyp: rest[0], clue: opt.clue, why: opt.why, covers: opt.covers })
    if (sub === 'retain') return void hypRetain(dir(), m, rest[0])
    if (sub === 'list' || !sub) { const r = ranking(dir(), m); return out(r, Object.entries(r.ranked).map(([l, hs]) => `${l}${l === r.frontier ? ' (frontier)' : ''}\n${hs.map(h => `  ${h.id} ${h.status} ${Math.round(h.share * 100)} %`).join('\n')}`).join('\n') || 'no hypothesis yet') }
    fail('hyp add|lr|exclude|retain|list')
  },
  redteam: () => redteam(dir(), readFileJson(opt.file)),
  conclude: () => conclude(dir(), manifestOf(), readFileJson(opt.file)),
  next: () => (opt.done ? nextDone(dir(), opt.done) : next(dir(), readFileJson(opt.file))),
})

COMMANDS.brain = () => {
  const [sub, ...rest] = args
  if (sub === 'context') return console.log(context(HOME, path.basename(dir())))
  if ((sub === 'search' || sub === 'entities') && !opt.all && !opt.project) fail(`brain ${sub}${sub === 'search' ? ' "<words>"' : ''} -p <slug> | --all`)
  if (sub === 'search') {
    const r = search(HOME, rest.join(' '), { slug: opt.all ? null : opt.project, all: opt.all, kind: opt.kind })
    return out(r, r.map(x => `${x.slug}/${x.path}:${x.line}: ${x.text}`).join('\n') || 'nothing found')
  }
  if (sub === 'show') {
    const r = show(HOME, path.basename(dir()), rest.join(' '))
    if (r.journal) return out(r, r.journal.line)
    return out(r, `${r.path}\n${JSON.stringify(r.props, null, 2)}\n\n${r.body}\nbacklinks:\n${r.backlinks.map(b => `- ${b.from}:${b.line} ${b.text}`).join('\n') || '- none'}`)
  }
  if (sub === 'entities') {
    const r = entities(HOME, { slug: opt.all ? null : opt.project, all: opt.all, kind: opt.kind, shared: opt.shared })
    return out(r, r.map(e => `${e.kind} ${e.value} — ${e.cases.map(c => c.slug).join(', ')}`).join('\n') || 'no entity')
  }
  fail('brain context|search|show|entities')
}

COMMANDS.refresh = async () => {
  const r = await refresh(HOME, path.basename(dir()), { only: opt.only ? list(opt.only) : null, yes: opt.yes })
  out(r, [...r.diffs.map(d => `${d.name}: ${d.first ? 'first collection' : `+${d.added.length} −${d.removed.length} ~${d.changed.length}`}`), ...r.agent.map(a => `agent step: ${a.prompt}`)].join('\n') || 'nothing to refresh')
}

const SELF = fileURLToPath(import.meta.url), LOADED = fs.statSync(SELF).mtimeMs
const PORT = +(process.env.OSINT_PORT || 41387), DIST = path.join(path.dirname(SELF), 'dashboard', 'dist')
// the folder's dashboard server, started in the background when none runs this engine; the agent that asks becomes one
// of its owners (the server stops once they have all quit, unless a case is watched)
async function ensureServer() {
  const base = await findServer({ home: HOME, port: PORT, engine: SELF, loaded: LOADED }), owner = agentPid()
  if (owner) await fetch(`${base}__osint/owner?pid=${owner}`, { method: 'POST' }).catch(() => {})
  return base
}
Object.assign(COMMANDS, {
  serve: async () => {
    const server = await startServer({ home: HOME, port: PORT, dist: DIST, engine: SELF, loaded: LOADED })
    // a tunnel never outlives its server, whatever stops it
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.once(sig, () => { server.closeTunnels('server stopped'); process.exit(0) })
    process.once('exit', () => server.closeTunnels('server stopped'))
    console.log(`dashboard server on http://127.0.0.1:${PORT}/ for ${HOME}`)
    await new Promise(() => {})
  },
  dashboard: async () => {
    if (!fs.existsSync(path.join(DIST, 'index.html'))) fail(`the dashboard is not built (${DIST}): npm run build in plugins-src/skill-osint/dashboard`)
    const base = await ensureServer()
    const url = opt.project ? `${base}#/c/${caseDir(HOME, opt.project).split(/[\\/]/).pop()}` : base
    console.log(`dashboard: ${url}`)
    if (opt.open) openUrl(url)
  },
})

Object.assign(COMMANDS, {
  // the case's print view as a PDF in <slug>/Exports/, its SHA-256 in the Journal; exit 3 when no browser is here
  export: async () => {
    if (opt.journal !== undefined) fail(`export --journal takes no value (the Journal as an appendix), not « ${opt.journal} »: export -p <slug> --journal`)
    const r = await exportPdf(HOME, opt.project, { journal: !!opt.appendix, dist: DIST, engine: SELF, loaded: LOADED })
    out(r, `exported ${r.file} with ${r.browser} · sha256 ${r.sha256}`)
  },
})

// every type with its folder and what it lacks; a private engine.js is loaded (to check its commands) unless --no-load
COMMANDS.types = async () => {
  const r = await typeReport(HOME, { privateEngines: !opt['no-load'] })
  const head = t => (t.refused ? `refused ${t.id} (private): ${t.refused}`
    : `${t.ready ? 'ok     ' : 'missing'} ${t.id}${t.private ? ' (private)' : ''}${t.ready ? '' : `: needs ${t.missing.join(', ')}`}`)
  out(r, r.map(t => [`${head(t)} — ${t.where}`, ...t.errors.map(e => `        ${e}`)].join('\n')).join('\n'))
}

const onOff = v => (v === 'on' ? true : v === 'off' ? false : fail('--notify on|off'))
const lastNext = w => `last ${w.last ? when(w.last) : 'none yet'} · next ${when(w.next)}${w.error ? ` · the last pass failed: ${w.error}` : ''}`
COMMANDS.watch = async () => {
  if (opt.pause && opt.resume) fail('--pause or --resume, not both')
  if (opt.due) {
    const r = await runDue(HOME)
    return out(r, r.passes.map(p => `${p.slug}: ${p.error ? `the pass failed — ${p.error}` : p.text ?? 'nothing changed'}`).join('\n') || 'no case is due')
  }
  if (opt.pause || opt.resume || opt.notify) {
    const s = saveSettings(HOME, { ...(opt.pause && { on: false }), ...(opt.resume && { on: true }), ...(opt.notify && { notify: onOff(opt.notify) }) }).watch
    return out(s, `watch: ${s.on ? 'on' : 'paused (each case keeps its period)'} · notifications ${s.notify ? 'on' : 'off'}`)
  }
  if (opt.every) {
    const d = dir(), slug = path.basename(d), w = setWatch(HOME, slug, opt.every, { yes: opt.yes })
    if (!w) return out({ watch: null, steps: [], server: null }, `${slug}: not watched`)
    const steps = watchSteps(getType(readCase(d).type, HOME)).map(s => s.id)
    // the passes need the dashboard server: started now for the agent who asked (not from the server itself, the tests, the demo)
    const server = process.env.OSINT_SERVE === '0' || process.env.OSINT_BY ? null : await ensureServer()
    return out({ watch: w, steps, server }, `${slug}: watched every ${w.every} (${steps.join(', ')}), next pass ${when(w.next)} · ${server ? `the dashboard server ${server} runs it and stays on for it` : 'no dashboard server started: osint.mjs dashboard starts it'}`)
  }
  if (opt.project) {
    const d = dir(), slug = path.basename(d), w = readCase(d).watch ?? null
    return out(w, w ? `${slug}: every ${w.every} · ${lastNext(w)}` : `${slug}: not watched`)
  }
  const s = settings(HOME).watch, all = watchedCases(HOME)
  out({ ...s, cases: all }, [`watch: ${s.on ? 'on' : 'paused'} · notifications ${s.notify ? 'on' : 'off'}`, ...(all.length ? all.map(w => `${w.slug}  every ${w.every} · ${lastNext(w)}`) : ['no case watched'])].join('\n'))
}

Object.assign(COMMANDS, {
  doctor: async () => {
    const r = await doctor(HOME, { network: opt.network, dist: DIST })
    if (opt.json) console.log(JSON.stringify(r, null, 2)); else printDoctor(r)
    if (r.lines.some(l => l.status === 'MISSING')) process.exitCode = 1
  },
  setup: () => (args[0] === 'set' ? setupSet(HOME, args.slice(1)) : setup(args[0], { yes: opt.yes })),
})

const where = () => parseLatLon(opt.at) ?? fail('--at <lat>,<lon> in decimal degrees')
Object.assign(COMMANDS, {
  sun: async () => {
    const at = where(), w = parseWhen(opt.date, opt.tz), m = { bearing: opt['shadow-bearing'], ratio: opt.ratio }
    const r = w.at ? sunAt(at, w.at, m) : sunDay(at, w.day, w.tz, { ...m, tol: opt.tol ?? 5 })
    if (opt.project && !w.at && !r.fits) fail('-p records a computed clue: give a time, or the measured --shadow-bearing or --ratio')
    const rec = opt.project ? await recordSun(dir(), r) : null
    const text = w.at
      ? `${r.at} at ${r.lat},${r.lon}: azimuth ${r.azimuth}°, elevation ${r.elevation}°, shadow bearing ${r.shadow_bearing}°, shadow ratio ${r.shadow_ratio ?? '—'}${r.bearing_off != null ? `; measured ${r.measured_bearing}°, off by ${r.bearing_off}°` : ''}${r.ratio_off_pct != null ? `; measured ratio ${r.measured_ratio}, off by ${r.ratio_off_pct} %` : ''}`
      : [...r.rows.map(x => `${x.local} ${r.tz}  azimuth ${x.azimuth}°  elevation ${x.elevation}°  shadow ${x.shadow_bearing}° ×${x.shadow_ratio ?? '—'}`), ...(r.fits ? [`fits: ${r.fits.join(', ') || 'no time of that day'}`] : [])].join('\n')
    out({ ...r, ...(rec && { recorded: rec }) }, `${text}${rec ? `\nrecorded: ${rec.source}, ${rec.clue}` : ''}`)
  },
  weather: async () => {
    const w = await weatherDay(where(), opt.date)
    const rec = opt.project ? await recordWeather(dir(), w, opt.hour != null ? Number(opt.hour) : fail('-p records the weather of one hour: --hour 14 (UTC)')) : null
    out({ ...w, body: undefined, ...(rec && { recorded: rec }) }, [...w.rows.map(x => `${x.utc.slice(11, 16)} UTC  cloud ${x.cloud_cover} %  sun ${x.sunshine_min} min  rain ${x.precipitation_mm} mm  snow ${x.snowfall_cm} cm  ${x.temperature_c} °C  WMO ${x.weather_code}`), ...(rec ? [`recorded: ${rec.source}, ${rec.clue}`] : [])].join('\n'))
  },
})

try {
  if (!COMMANDS[cmd]) fail(`usage: osint.mjs <${Object.keys(COMMANDS).join(' | ')}> [-p <slug>]`)
  await COMMANDS[cmd]()
  // the agent's last command, for « edited in the vault since »; the dashboard's own runs do not count
  if (opt.project && cmd !== 'new' && !process.env.OSINT_BY) updateCase(dir(), c => { c.agent_at = nowIso() })
} catch (e) {
  if (!e.userError) throw e
  console.error(`error: ${e.message}`)
  process.exit(e.code)
}
