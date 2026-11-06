// doctor: one line per need of the engine and of each case type — ok, or missing with its install command for this OS
// and what stops working without it; the keys (set or not, never their value); Gemini and Google Vision always off;
// the manifests' mistakes; evidence changed since it was added; a .gitignore that would hide the cases or version the
// cache. --network: one call per free service. setup: install what is missing, one tool at a time, after a yes.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { browserMissing, installBrowser, pdfBrowser } from './browser.js'
import { listCases, readCase } from './case.js'
import { datasetsInfo } from './datasets.js'
import { QUOTAS, quota, request } from './net.js'
import { geoEnv, packDir, packInfo, packReady, PACKS, pin, spawnUv, uvCommand } from './python.js'
import { clickHint } from './server.js'
import { probeTunnel } from './tunnel.js'
import { scanTypes, validateEngine, validateManifest } from './types.js'
import { saveDeveloper, watchLine } from './watch.js'
import { dataDir, fail, findBrowser, hasBin, INSTALL, nowIso, sha256File, writeJson } from './util.js'

export const PROBES = {
  rdap: ['/domain/example.com', 'domain registration (RDAP)'],
  crtsh: ['/?q=example.com&output=json', 'subdomains from certificates (crt.sh)'],
  cdx: ['/cdx/search/cdx?url=example.com&limit=1&output=json', 'archived history (Wayback Machine)'],
  ripestat: ['/data/network-info/data.json?resource=8.8.8.8&sourceapp=skill-osint', 'IP → network and ASN (RIPEstat)'],
  internetdb: ['/8.8.8.8', 'open ports and hostnames (Shodan InternetDB)'],
  nominatim: ['/status?format=json', 'countries and regions of a true location (Nominatim)'],
  openmeteo: ['/v1/archive?latitude=38.5725&longitude=-7.9075&start_date=2024-07-16&end_date=2024-07-16&hourly=cloud_cover', 'past weather (Open-Meteo)'],
  hf: ['/api/models/geolocal/StreetCLIP', 'the model downloads of setup geoint (Hugging Face)'],
  entreprises: ['/search?q=552081317&per_page=1', "French companies (Recherche d'entreprises)"],
  bodacc: ['/api/explore/v2.1/catalog/datasets/annonces-commerciales/records?where=registre%3D%22552081317%22&limit=1', 'French legal notices (BODACC)'],
  gravatar: ['/v3/profiles/973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b', 'public Gravatar profiles (email)'],
  arcep: ['/uploads/identifiants_CE.csv', 'the French block holders (ARCEP)'],
  xon: ['/v1/check-email/test@example.com', 'breach names (XposedOrNot, email)'],
  tor: ['/torbulkexitlist', 'Tor exits (Tor Project list)'],
  aws: ['/ip-ranges.json', 'AWS published ranges'],
  gcp: ['/ipranges/cloud.json', 'Google Cloud published ranges'],
  cloudflare: ['/ips-v4', 'Cloudflare published ranges'],
  geopf: ['/geocodage/reverse?lat=48.8565&lon=2.352&limit=1', 'French addresses (Géoplateforme)'],
  overpass: ['/api/status', 'OpenStreetMap around a point (Overpass)'],
  panoramax: ['/api', 'ground images (Panoramax)'],
  kartaview: ['/2.0/photo/?lat=48.8565&lng=2.352&radius=500', 'ground images (KartaView)'],
  esri: ['/config.maptiles.arcgis.com/waybackconfig.json', 'Esri Wayback releases (links)'],
  raw: ['/WebBreacher/WhatsMyName/main/wmn-data-schema.json', 'datasets from GitHub (WhatsMyName, disposable domains, libphonenumber)'],
}
const KEPT = ['c/Case.md', 'c/Journal.md', 'c/Evidence/E01-x.jpg', 'c/.osint/case.json', 'c/.osint/events.jsonl', 'c/Exports/c-2026-11-03.pdf', '.osint-types/t/type.json', '.osint-types/t/engine.js']

const versionOf = bin => {
  for (const a of ['--version', '-version']) {
    const r = spawnSync(bin, [a], { encoding: 'utf8', windowsHide: true })
    const v = /\d+(?:\.\d+)+/.exec(`${r.stdout ?? ''}\n${r.stderr ?? ''}`)?.[0]
    if (v) return v
  }
  return null
}

// a private type's folder as the user sees it in the cases folder; a plugin type's in full
export const typePath = (home, t) => (t.private ? path.relative(home, t.dir).split(path.sep).join('/') : t.dir)
// a ready type keeps its short notes (stage 3: « verify-media ready (no direct upload) »)
const stateOf = t => (t.refused ? 'refused' : t.ready ? `ready${t.notes?.length ? ` (${t.notes.join(', ')})` : ''}` : `needs ${t.missing.join(', ')}`)
// « domain ready · … · private: shop-audit (.osint-types/shop-audit) »: a private type that is ready says its folder only
export const typesLine = types => [
  ...types.filter(t => !t.private).map(t => `${t.id} ${stateOf(t)}`),
  ...types.filter(t => t.private).map(t => `private: ${t.id}${t.ready ? '' : ` ${stateOf(t)}`} (${t.where})`),
].join(' · ')

// each type's readiness, for doctor and `osint.mjs types`: the tools and keys it needs (their lines go to `add`), the
// mistakes of its manifest and engine.js, its folder; then the refused private folders with why. A private engine.js
// is loaded (to check its commands) only with privateEngines: `types` does, doctor never (a cases folder received
// from someone else runs nothing when the agent checks its tools)
export async function typeReport(home, { add = () => {}, privateEngines = true, seen = new Set(['git']), dataset = () => {} } = {}) {
  const { types, rejected } = scanTypes(home), out = []
  for (const t of types) {
    const missing = [], notes = []
    for (const b of t.requires?.bins ?? []) {
      const ok = hasBin(b.id)
      if (!ok && !b.optional) missing.push(b.id)
      if (!ok && b.optional && b.short) notes.push(b.short)
      if (seen.has(b.id)) continue
      seen.add(b.id)
      add(ok ? 'ok' : 'missing', b.id, ok ? [b.id, versionOf(b.id), b.for && `(${b.for})`].filter(Boolean).join(' ') : `${INSTALL[b.id] ?? 'no install hint'} — ${b.off}`, INSTALL[b.id])
    }
    for (const p of t.requires?.packs ?? []) {
      const P = PACKS[p.id], ok = !!P?.ready()
      if (!ok && !p.optional) missing.push(P?.label ?? p.id)
      if (!ok && p.optional && p.short) notes.push(p.short)
      if (seen.has(`pack:${p.id}`)) continue
      seen.add(`pack:${p.id}`)
      const info = p.id === 'geoint' ? packInfo() : null, broken = info && !(info.tests_ok && info.models_ok)
      add(ok ? 'ok' : 'missing', `${p.id} pack`, ok ? `${p.id} pack ${pin().sha.slice(0, 8)} (${pin().date.slice(0, 10)}) in ${P.dir()}`
        : `${P?.setup ?? 'no setup'}${p.id === 'geoint' ? ' (about 6.8 GB of models, asks first)' : ''}${broken ? ' — the last setup did not finish (models or tests)' : ''} — ${p.off}`, P?.setup)
    }
    for (const k of t.requires?.keys ?? []) {
      if (seen.has(k.id)) continue
      seen.add(k.id)
      add('info', k.id, process.env[k.id] ? 'set' : `not set — ${k.off}; ${k.configure}`)
    }
    for (const d of t.requires?.datasets ?? []) {
      if (seen.has(`dataset:${d.id}`)) continue
      seen.add(`dataset:${d.id}`)
      dataset(d.id, d.label ?? d.id, t.id)
    }
    const errors = [...validateManifest(t), ...(t.private && !privateEngines ? [] : await validateEngine(t))]
    for (const e of errors) add('warning', `type ${t.id}`, `type ${t.id}: ${e}`)
    out.push({ id: t.id, label: t.label, private: t.private, path: t.dir, where: typePath(home, t), ready: !missing.length && !errors.length, missing: [...missing, ...(errors.length ? ['a sound manifest'] : [])], notes, errors, refused: null })
  }
  for (const r of rejected) {
    const where = typePath(home, { private: true, dir: r.dir })
    add('warning', `type ${r.id}`, `private type ${r.id} (${where}) refused: ${[r.why, ...r.errors].join('; ')}`)
    out.push({ id: r.id, label: null, private: true, path: r.dir, where, ready: false, missing: [], notes: [], errors: r.errors, refused: r.why })
  }
  return out
}

export async function doctor(home, { network = false, dist } = {}) {
  const lines = [], add = (status, name, text, fix) => lines.push({ status, name, text, ...(fix && { fix }) })
  const node = +process.versions.node.split('.')[0] >= 22
  add(node ? 'ok' : 'MISSING', 'node', node ? `node ${process.versions.node}` : `node 22 or later: ${INSTALL.node}`, INSTALL.node)
  const built = fs.existsSync(path.join(dist, 'index.html'))
  add(built ? 'ok' : 'MISSING', 'dashboard', built ? 'dashboard built' : `the dashboard is not built: npm run build in plugins-src/skill-osint/dashboard`)
  const git = hasBin('git')
  add(git ? 'ok' : 'missing', 'git', git ? 'git' : `${INSTALL.git} — the .gitignore checks are skipped`, INSTALL.git)
  // the datasets this folder keeps (lib/datasets.js): what each holds, the day it was downloaded, its size
  const kept = Object.fromEntries(datasetsInfo(home).map(m => [m.id, m]))
  const dsLine = (id, label, type) => {
    const m = kept[id]
    if (!m) return add('info', id, `${label}: not downloaded yet — the first ${type} case fetches it`)
    add('ok', id, `${label}: ${m.about ? `${m.about}, ` : ''}${String(m.at).slice(0, 10)} (${Math.max(1, Math.round(m.size / 1024))} KB)`)
  }
  const seen = new Set(['git'])
  const types = await typeReport(home, { add, privateEngines: false, seen, dataset: dsLine })
  // stage 2's browser line: only when a type needs the GeoINT pack
  const geoint = scanTypes(home).types.some(t => (t.requires?.packs ?? []).some(p => p.id === 'geoint'))
  // a dataset in the cache that no installed type declares (a type removed since, an older version): listed too
  for (const id of Object.keys(kept)) if (!seen.has(`dataset:${id}`)) dsLine(id, id)
  if (geoint) {
    const b = findBrowser().find(x => x.kind === 'chrome' || x.kind === 'pack')
    add(b ? 'ok' : 'missing', 'browser', b ? `browser for direct reverse search (${b.name})` : 'osint.mjs setup geoint installs Chromium — Yandex and Baidu direct upload is off', 'osint.mjs setup geoint')
  }
  if (types.some(t => t.id === 'email')) add('info', 'holehe', 'email account-probe runs holehe@latest by uv on the user\'s yes only (GPLv3, unmaintained since 2024, never bundled): its hits are inferred clues')
  add('info', 'gemini', 'off (the agent checks matches)')
  add('info', 'google vision', 'off (the agent recognises landmarks)')
  add('info', 'types', typesLine(types))
  // the watch: is a server of this folder running its passes? (one per folder, from OSINT_PORT up)
  const from = +(process.env.OSINT_PORT || 41387)
  const lives = await Promise.all(Array.from({ length: 20 }, (_, i) => fetch(`http://127.0.0.1:${from + i}/__osint`, { signal: AbortSignal.timeout(1000) }).then(r => r.json()).catch(() => null)))
  add('info', 'watch', watchLine(home, { up: lives.some(l => l?.home === home), hint: clickHint() }))
  for (const slug of listCases(home)) for (const e of readCase(path.join(home, slug)).evidence ?? []) {
    const f = path.join(home, slug, e.file)
    if (!fs.existsSync(f)) add('warning', 'evidence', `${slug}: ${e.id} ${e.file} is gone`)
    else if (sha256File(f) !== e.sha256) add('warning', 'evidence', `${slug}: ${e.id} ${e.file} changed since it was added (sha256 differs): the original must stay intact`)
  }
  if (git && fs.existsSync(path.join(home, '.gitignore'))) {
    const check = files => spawnSync('git', ['-C', home, 'check-ignore', '--no-index', ...files], { encoding: 'utf8', windowsHide: true })
    const ignored = check(KEPT)
    if (ignored.status === 0) add('warning', 'gitignore', `git ignores ${ignored.stdout.trim().split('\n').join(', ')}: the cases must stay versioned, fix ${path.join(home, '.gitignore')}`)
    if (check(['.cache/x.json', 'c/.osint/cache/x']).status === 1) add('warning', 'gitignore', `git would version the cache: add the skill's lines to ${path.join(home, '.gitignore')}`)
  }
  // the PDF export prints with a Chromium-family browser; without one, Print view prints from any browser
  const pdf = pdfBrowser()
  add(pdf ? 'info' : 'missing', 'pdf export', pdf ? pdf.name : browserMissing(), pdf || process.env.OSINT_BROWSER ? undefined : installBrowser())
  add('info', 'cases', `${home} (${listCases(home).length})`)
  if (network) {
  for (const [service, [probe, what]] of Object.entries(PROBES)) {
    // a free API with a daily limit (XposedOrNot): the probe is one of its calls, and is skipped when the quota is used
    if (QUOTAS[service]) {
      const q = quota(home, service)
      if (!q.ok) { add('info', service, `${service}: not probed, its quota is used (${q.limit}, the next call after ${q.next})`); continue }
    }
    try {
      const r = await request(service, probe, { timeout: 30000, max: 2e6 })
      add(r.status < 500 ? 'ok' : 'missing', service, `${service} ${r.status} · ${r.ms} ms`)
    } catch (e) { add('missing', service, `${service}: ${e.message} — ${what} is off`) }
  }
    // the Mapillary token, in a header (never in the URL, which the Journal and caches keep)
    if (process.env.MAPILLARY_TOKEN) {
      try {
        const r = await request('mapillary', '/images?bbox=2.2940,48.8580,2.2950,48.8590&fields=id&limit=1', { headers: { authorization: `OAuth ${process.env.MAPILLARY_TOKEN}` }, timeout: 20000 })
        add(r.status === 200 ? 'ok' : 'missing', 'mapillary', r.status === 200 ? `mapillary token accepted · ${r.ms} ms` : `the token is refused (${r.status}) — Mapillary panoramas skipped; /plugin configure skill-osint@pabrisson`)
      } catch (e) { add('missing', 'mapillary', `${e.message} — Mapillary panoramas skipped`) }
    }
    if (hasBin('cloudflared')) {
      try { const t = await probeTunnel(); add('ok', 'tunnel', `tunnel: a file served and read back from outside · ${t.ms} ms`) } catch (e) { add('missing', 'tunnel', `${e.message} — reverse image search by link is off`) }
    }
  }
  return { lines, types, home }
}
export function printDoctor({ lines }) {
  for (const l of lines) {
    if (l.status === 'ok') console.log(`ok      ${l.text}`)
    else if (l.status === 'MISSING' || l.status === 'missing') console.log(`${l.status} ${l.name}: ${l.text}`)
    else if (l.status === 'warning') console.log(`warning: ${l.text}`)
    else console.log(`${l.name}: ${l.text}`)
  }
}

// a package manager command we may run (no shell, no sudo, no pipe); anything else is the user's to run
export function installPlan(tool, { has = hasBin, cmd = INSTALL[tool] } = {}) {
  if (!cmd) return { action: 'unknown' }
  if (has(tool)) return { action: 'have', cmd }
  const m = /^(brew|winget) install ([\w.@/+-]+)$/.exec(cmd)
  return m ? { action: 'run', cmd, bin: m[1], args: ['install', m[2]] } : { action: 'manual', cmd }
}
// `setup set developer.on=on|off|none`: the folder's developer mode (Settings › Development)
export function setupSet(home, pairs) {
  const [pair, ...more] = pairs, m = /^developer\.on=(on|off|none)$/.exec(pair ?? '')
  if (!m || more.length) fail('usage: setup set developer.on=<on|off|none> (none: on for a server started on fake APIs, off for the others)')
  saveDeveloper(home, m[1] === 'none' ? null : m[1] === 'on')
  console.log(`ok developer.on = ${m[1]}`)
}
export async function setup(tool, { yes } = {}) {
  if (tool === 'geoint') return setupGeoint({ yes })
  if (!tool) {
    for (const [t, cmd] of Object.entries(INSTALL)) console.log(`${hasBin(t) ? 'ok     ' : 'missing'} ${t}${hasBin(t) ? '' : `: ${cmd}`}`)
    console.log(packReady() ? 'ok      geoint' : 'missing geoint: osint.mjs setup geoint (about 6.8 GB of models, asks first)')
    return
  }
  const p = installPlan(tool)
  if (p.action === 'unknown') fail(`unknown tool ${tool}: ${Object.keys(INSTALL).join(', ')}`)
  if (p.action === 'have') return console.log(`ok ${tool} is installed`)
  if (p.action === 'manual') { console.log(`run it yourself: ${p.cmd}`); process.exitCode = 3; return }
  if (!yes) fail(`will run: ${p.cmd} — the user's yes, then setup ${tool} --yes`, 2)
  execFileSync(p.bin, p.args, { stdio: 'inherit', windowsHide: true })
  if (!hasBin(tool)) fail(`${tool} is still not on the PATH after ${p.cmd}: open a new terminal, or install it by hand`, 3)
  console.log(`ok ${tool} installed`)
}

// what setup geoint downloads: GeoINT's own figure for the models, then the Python environments (torch…) measured at
// the first real install (task 17, step 1) and written here; Chromium only without Chrome
export const MODELS_GB = 6.8
export const ENV_GB = 6
const CHROMIUM_GB = 0.15
const gb = n => `${n.toFixed(1)} GB`
export function setupPlan({ free, chrome, repo, sha, date, dir }) {
  const need = MODELS_GB + ENV_GB + (chrome ? 0 : CHROMIUM_GB)
  const lines = [
    'setup geoint will:',
    `- clone ${repo} at ${sha.slice(0, 8)} (${date.slice(0, 10)}, MIT) into ${dir}, never changed afterwards`,
    `- download about ${gb(MODELS_GB)} of models (StreetCLIP + GeoCLIP 3.5 GB, MegaLoc 1.7 GB, OWLv2 0.6 GB, GeoCalib 0.1 GB, and smaller ones), downloads resume if stopped`,
    `- install Python 3.12 and the scripts' packages with uv (torch included, about ${gb(ENV_GB)})`,
    ...(chrome ? [] : [`- install Chromium (about ${gb(CHROMIUM_GB)}) for the direct Yandex and Baidu search: there is no Chrome on this machine`]),
    "- StreetCLIP's weights are CC BY-NC 4.0: non-commercial use only",
    `- free space: ${gb(free / 1e9)} available, ${gb(need)} needed`,
  ]
  return { lines, need, ok: free / 1e9 >= need }
}
const dirSize = d => {
  let n = 0
  const walk = p => { let es; try { es = fs.readdirSync(p, { withFileTypes: true }) } catch { return } for (const e of es) { const f = path.join(p, e.name); if (e.isDirectory()) walk(f); else if (e.isFile()) try { n += fs.statSync(f).size } catch {} } }
  walk(d)
  return n
}
const freeBytes = d => { for (let p = d; ; p = path.dirname(p)) { try { const s = fs.statfsSync(p); return s.bavail * s.bsize } catch { if (path.dirname(p) === p) return Infinity } } }

export async function setupGeoint({ yes } = {}) {
  const p = pin(), target = packDir(), data = dataDir()
  if (packReady()) return console.log(`ok geoint pack ${p.sha.slice(0, 8)} (${p.date.slice(0, 10)}) in ${target}`)
  if (!hasBin('git')) fail(`setup geoint needs git: ${INSTALL.git}`, 3)
  if (!uvCommand()) fail(`setup geoint needs uv: ${INSTALL.uv}`, 3)
  const chrome = findBrowser().some(b => b.kind === 'chrome'), plan = setupPlan({ free: freeBytes(data), chrome, ...p, dir: target })
  if (!plan.ok) fail([...plan.lines, `not enough free space under ${data}: free some, or set OSINT_DATA to a bigger disk`].join('\n'))
  if (!yes) fail([...plan.lines, "the user's yes, then: osint.mjs setup geoint --yes"].join('\n'), 2)
  const git = (...a) => execFileSync('git', a, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  fs.mkdirSync(path.dirname(target), { recursive: true })
  if (!fs.existsSync(path.join(target, '.git'))) {
    const tmp = `${target}.part`
    fs.rmSync(tmp, { recursive: true, force: true })
    console.log(`cloning ${p.repo}…`)
    git('clone', '--quiet', p.repo, tmp)
    git('-C', tmp, 'checkout', '--quiet', p.sha)
    fs.renameSync(tmp, target)
  }
  const head = git('-C', target, 'rev-parse', 'HEAD')
  if (head !== p.sha) fail(`${target} is at ${head}, not the pinned ${p.sha}: remove that folder, then setup geoint --yes again`)
  const dirty = git('-C', target, 'status', '--porcelain')
  if (dirty) fail(`${target} was changed (${dirty.split('\n')[0].trim()}…): the pack stays as pinned; remove that folder, then setup geoint --yes again`)
  const env = geoEnv(), work = path.join(data, 'geoint-work')
  fs.mkdirSync(work, { recursive: true })
  if (!chrome) {
    console.log('installing Chromium for the direct Yandex and Baidu search…')
    const r = await spawnUv(['tool', 'run', 'playwright', 'install', 'chromium'], { env })
    if (r.code) fail(`Chromium did not install: ${r.err.trim().split('\n').pop()}`)
  }
  console.log(`loading every model once (about ${gb(MODELS_GB)} on the first run; downloads resume if stopped)…`)
  const watched = ['hf', 'torch', 'uv'].map(d => path.join(data, d)), t0 = Date.now()
  const tick = setInterval(() => console.log(`  ${gb(watched.reduce((s, d) => s + dirSize(d), 0) / 1e9)} downloaded · ${Math.round((Date.now() - t0) / 1000)} s`), 15000)
  let models
  try { models = await spawnUv(['run', '-q', path.join(target, 'scripts', 'doctor.py'), '--models', '--json'], { cwd: work, env }) } finally { clearInterval(tick) }
  let report = null
  try { report = JSON.parse(models.out) } catch {}
  const failed = (report?.checks ?? []).filter(c => c.status === 'FAIL'), models_ok = models.code === 0 && !!report && !failed.length
  console.log("running the pack's tests…")
  const results = []
  for (const t of [['tests/test_tools.py'], ['tests/test_runtime.py'], ['python', '-m', 'unittest', 'tests/test_photo_session.py']]) {
    const r = await spawnUv(['run', '-q', ...(t[0] === 'python' ? t : [path.join(target, t[0])])], { cwd: target, env })
    results.push({ test: t.join(' '), code: r.code, tail: (r.err || r.out).trim().split('\n').slice(-3).join(' ') })
  }
  const tests_ok = results.every(r => r.code === 0)
  const sizes = { models_gb: +((dirSize(path.join(data, 'hf')) + dirSize(path.join(data, 'torch'))) / 1e9).toFixed(2), env_gb: +(dirSize(path.join(data, 'uv')) / 1e9).toFixed(2), pack_mb: +(dirSize(target) / 1e6).toFixed(1) }
  writeJson(path.join(data, 'geoint', `${p.sha}.json`), { sha: p.sha, date: p.date, repo: p.repo, installed_at: nowIso(), models_ok, failed: failed.map(c => `${c.name}: ${c.detail}`), tests_ok, tests: results, sizes })
  console.log(`measured: models ${sizes.models_gb} GB, Python environments ${sizes.env_gb} GB, pack ${sizes.pack_mb} MB`)
  if (!models_ok) fail(`some models did not load: ${failed.map(c => `${c.name}: ${c.detail}`).join('; ') || models.err.trim().split('\n').pop()} — setup geoint --yes again (downloads resume)`)
  if (!tests_ok) fail(`the pack's tests failed: ${results.filter(r => r.code).map(r => `${r.test}: ${r.tail}`).join('; ')}`)
  console.log(`ok geoint pack ${p.sha.slice(0, 8)} (${p.date.slice(0, 10)}) in ${target}: its models load and its tests pass`)
}
