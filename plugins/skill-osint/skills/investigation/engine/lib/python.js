// The GeoINT pack (https://github.com/marouane53/GeoINT, MIT) pinned at one commit under the plugin's data folder, and
// its scripts run by uv in a clean environment: the case's .osint/geoint/ as the working folder (many of its caches
// are relative to it), the heavy caches under dataDir(), Python 3.12, dependencies resolved as of the commit's date,
// and no Google key passed on (GeoINT calls Gemini whenever it finds one: compare.py, triage.py --check).
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { journal, updateCase } from './case.js'
import { emit } from './events.js'
import { dataDir, fail, INSTALL, nowIso, readJson, sha256File, UserError } from './util.js'

export const PIN = { repo: 'https://github.com/marouane53/GeoINT', sha: '18543326daf1b2f5cf81cfd37d603e4d2a315861', date: '2026-10-29T23:30:31Z' }
// OSINT_GEOINT_REPO, OSINT_GEOINT_PIN: the tests' local repository and its commit
export const pin = () => ({ ...PIN, repo: process.env.OSINT_GEOINT_REPO || PIN.repo, sha: process.env.OSINT_GEOINT_PIN || PIN.sha })
export const packDir = () => path.join(dataDir(), 'geoint', pin().sha)
// written by setup geoint: ready once every model loaded and the pack's own tests passed
export const packInfo = () => readJson(path.join(dataDir(), 'geoint', `${pin().sha}.json`), null)
export const packReady = () => !!(packInfo()?.tests_ok && packInfo()?.models_ok) && fs.existsSync(path.join(packDir(), 'scripts', 'recon.py'))
export const PACKS = { geoint: { label: 'the GeoINT pack', dir: packDir, ready: packReady, setup: 'osint.mjs setup geoint' } }
export const DROPPED = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS']
// a Python tool that needs no key (Maigret, Holehe): only what uv and the tool need, and no key, token nor secret at all
// (Maigret's --ai would read OPENAI_API_KEY; it is never passed anyway). GeoINT keeps geoEnv: it needs MAPILLARY_TOKEN.
const KEEP = /^(PATH|Path|PATHEXT|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|SystemRoot|SYSTEMROOT|SystemDrive|ComSpec|TEMP|TMP|TMPDIR|LANG|LC_ALL|LC_CTYPE|XDG_CACHE_HOME|XDG_DATA_HOME|XDG_CONFIG_HOME|UV_CACHE_DIR|UV_TOOL_DIR|UV_TOOL_BIN_DIR|UV_PYTHON_INSTALL_DIR|UV_INDEX_URL|UV_DEFAULT_INDEX|UV_NATIVE_TLS|SSL_CERT_FILE|HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy)$/
export const cleanEnv = env => Object.fromEntries(Object.entries(env).filter(([k]) => KEEP.test(k)))
// OSINT_UV: the tests' stand-in for uv
export const uvBin = () => process.env.OSINT_UV || 'uv'
// the one way to start uv, for GeoINT and for every Python tool a type runs (Maigret, Holehe): [binary, leading
// arguments], or null without uv; an OSINT_UV that is a .mjs or .js runs with this Node (fakes that work on Windows too)
export function uvCommand(env = process.env) {
  const uv = env.OSINT_UV
  if (uv) return fs.existsSync(uv) ? (/\.m?js$/i.test(uv) ? [process.execPath, [uv]] : [uv, []]) : null
  return spawnSync('uv', ['--version'], { stdio: 'ignore', windowsHide: true }).error ? null : ['uv', []]
}

export function geoEnv(cwd) {
  const env = { ...process.env }, data = dataDir()
  for (const k of DROPPED) delete env[k]
  return {
    ...env,
    GEOINT_CACHE: path.join(data, 'geoint-cache'), HF_HOME: path.join(data, 'hf'), TORCH_HOME: path.join(data, 'torch'),
    PLAYWRIGHT_BROWSERS_PATH: path.join(data, 'playwright'), UV_CACHE_DIR: path.join(data, 'uv'),
    UV_PYTHON: '3.12', UV_EXCLUDE_NEWER: pin().date, PYTHONUTF8: '1', UV: uvBin(),
    // GEOINT_PHOTOS: the case's folder (cwd is <case>/.osint/geoint)
    ...(cwd && { GEOINT_PHOTOS: path.dirname(path.dirname(cwd)) }),
  }
}

export function spawnUv(args, { cwd, env, onLine, timeout = 4 * 3600e3 } = {}) {
  return new Promise((ok, ko) => {
    const uv = uvCommand()
    if (!uv) return ko(new UserError(`uv is missing: ${INSTALL.uv}`, 3))
    const p = spawn(uv[0], [...uv[1], ...args], { cwd, env, windowsHide: true })
    let out = '', err = '', buf = ''
    const t = setTimeout(() => p.kill(), timeout)
    p.stdout.on('data', d => {
      out += d
      if (!onLine) return
      buf += d
      for (let i; (i = buf.indexOf('\n')) >= 0;) { onLine(buf.slice(0, i)); buf = buf.slice(i + 1) }
    })
    p.stderr.on('data', d => (err += d))
    p.on('error', e => { clearTimeout(t); ko(e.code === 'ENOENT' ? new UserError(`uv is missing: ${INSTALL.uv}`, 3) : e) })
    p.on('close', code => { clearTimeout(t); ok({ code: code ?? 1, out, err }) })
  })
}

const SKIP = /(^|\/)(\.geo-cache|thumbs|__pycache__)(\/|$)|\.(part|tmp)$/
function tree(root) {
  const out = new Map()
  const walk = rel => {
    let ents
    try { ents = fs.readdirSync(path.join(root, rel), { withFileTypes: true }) } catch { return }
    for (const d of ents) {
      const r = rel ? `${rel}/${d.name}` : d.name
      if (SKIP.test(r)) continue
      if (d.isDirectory()) walk(r)
      else { const st = fs.statSync(path.join(root, r)); out.set(r, `${st.mtimeMs}:${st.size}`) }
    }
  }
  walk('')
  return out
}
const lastLines = s => String(s).trim().split('\n').slice(-2).join(' ').slice(0, 300)
const shortPath = (dir, a) => (path.isAbsolute(String(a)) && String(a).startsWith(dir + path.sep) ? path.relative(dir, a).split(path.sep).join('/') : a)

// a GeoINT script for a case. Refused without the pack (code 3), with a config.local.json in it (the file that can
// name a Gemini key) or with a name that is not one of its scripts. Journaled with the files it made and their hashes
// (.osint/runs.jsonl keeps the whole list); progress from its output lines (onLine) or from step files appearing
// (watch). The first tool marks the case (python_at): the gut call is written before any tool.
export async function casePython(dir, script, args = [], { onLine, watch = [], label, tool = true } = {}) {
  if (!packReady()) fail('the GeoINT pack is not set up: osint.mjs setup geoint (about 6.8 GB of models, asks first)', 3)
  const pack = packDir(), cfg = path.join(pack, 'config.local.json')
  if (fs.existsSync(cfg)) fail(`${cfg} exists: the pack stays as pinned (that file can name a Gemini key); remove it`)
  if (!/^[\w-]+\.py$/.test(script) || !fs.existsSync(path.join(pack, 'scripts', script))) fail(`no GeoINT script ${script} in ${path.join(pack, 'scripts')}`)
  const cwd = path.join(dir, '.osint', 'geoint')
  fs.mkdirSync(cwd, { recursive: true })
  const name = label ?? script, before = tree(cwd), t0 = Date.now(), line = [script, ...args.map(a => shortPath(dir, a))].join(' ')
  if (tool) updateCase(dir, c => { c.python_at ??= nowIso() })
  emit(dir, { kind: 'progress', text: `GeoINT ${name}…` })
  let seen = 0
  const poll = watch.length ? setInterval(() => {
    const done = watch.filter(f => fs.existsSync(path.join(cwd, f)))
    if (done.length !== seen) { seen = done.length; emit(dir, { kind: 'progress', n: done.length, of: watch.length, text: `${name}: ${done.map(f => path.posix.basename(f)).join(', ')}` }) }
  }, 1000) : null
  let r
  try { r = await spawnUv(['run', '-q', path.join(pack, 'scripts', script), ...args], { cwd, env: geoEnv(cwd), onLine }) } finally { if (poll) clearInterval(poll) }
  if (watch.length) emit(dir, { kind: 'progress', n: watch.filter(f => fs.existsSync(path.join(cwd, f))).length, of: watch.length, text: `${name}: done` })
  const after = tree(cwd), produced = [...after].filter(([k, v]) => before.get(k) !== v).map(([k]) => ({ rel: k, sha256: sha256File(path.join(cwd, k)) }))
  const ms = Date.now() - t0, list = produced.slice(0, 12).map(p => `${p.rel} ${p.sha256.slice(0, 12)}`).join(', ')
  const j = journal(dir, r.code === 0 ? 'run' : 'fail', `${line} → exit ${r.code} in ${Math.round(ms / 1000)} s; ${produced.length} files${produced.length ? `: ${list}${produced.length > 12 ? `, +${produced.length - 12} (.osint/runs.jsonl)` : ''}` : ''}${r.code ? ` — ${lastLines(r.err || r.out)}` : ''}`)
  fs.appendFileSync(path.join(dir, '.osint', 'runs.jsonl'), JSON.stringify({ at: nowIso(), script, args: args.map(a => shortPath(dir, a)), code: r.code, ms, produced, journal: j }) + '\n')
  if (r.code !== 0) emit(dir, { kind: 'fail', text: `${script} exited ${r.code}: ${lastLines(r.err || r.out)}`, journal: j })
  return { ...r, ms, produced, journal: j, cwd }
}
