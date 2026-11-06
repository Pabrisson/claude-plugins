// The geolocation bench (spec § 13.4). OSINT_LIVE=1 and the user's yes only: it downloads 18 photos of Wikimedia
// Commons, runs one real agent session per photo (claude -p with this plugin) on the real GeoINT pack, scores each
// answer with geolocate-image truth, and writes test/bench/<date>.md (+ .json) against the last run.
//   OSINT_LIVE=1 node test/bench.mjs --first      one photo per category (the first run)
//   OSINT_LIVE=1 node test/bench.mjs              all 18 (after the user's second yes)
//   OSINT_LIVE=1 node test/bench.mjs --prepare    only download and make the pictures
//   [--only "<category>"] [--dir <bench folder>]
import { spawn, spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { stripJpeg } from '../lib/media.js'
import { DENY } from '../lib/net.js'
import { PIN } from '../lib/python.js'
import { ENGINE } from './helpers.js'
import { startProxy } from './proxy.mjs'

const HERE = import.meta.dirname, REPO = path.join(HERE, '..', '..', '..', '..', '..', '..'), UA = 'skill-osint/1.1.0 (+https://github.com/Pabrisson/claude-plugins)'
const { values: opt } = parseArgs({ options: { first: { type: 'boolean' }, prepare: { type: 'boolean' }, only: { type: 'string' }, dir: { type: 'string' } } })
if (!process.env.OSINT_LIVE) { console.error("the bench runs real agent sessions on the real pack: OSINT_LIVE=1, after the user's yes"); process.exit(2) }
const day = new Date().toISOString().slice(0, 10), dir = path.resolve(opt.dir ?? path.join(os.tmpdir(), `osint-bench-${day}`)), inputs = path.join(dir, 'inputs')
fs.mkdirSync(inputs, { recursive: true })
let photos = JSON.parse(fs.readFileSync(path.join(HERE, 'geoloc-bench.json'), 'utf8')).photos
if (opt.only) photos = photos.filter(p => p.category === opt.only)
if (opt.first) photos = photos.filter((p, i, all) => all.findIndex(q => q.category === p.category) === i)

const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
function exec(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) throw new Error(`${bin} ${args.join(' ')}: ${(r.stderr || r.stdout || r.error?.message || '').trim().split('\n').pop()}`)
  return r.stdout
}
// the picture the agent gets: a neutral name, no metadata (EXIF and XMP stripped by the engine's Node code)
async function prepare(p) {
  const out = path.join(inputs, `${p.id}.jpg`)
  if (fs.existsSync(out)) return out
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-bench-')), src = path.join(tmp, p.make === 'video-frame' ? 'video' : 'src.jpg')
  const r = await fetch(p.url, { headers: { 'user-agent': UA } })
  if (r.status !== 200) throw new Error(`${p.url} answered ${r.status}`)
  fs.writeFileSync(src, Buffer.from(await r.arrayBuffer()))
  let jpg = src
  if (p.make === 'video-frame') { jpg = path.join(tmp, 'frame.jpg'); exec('ffmpeg', ['-v', 'error', '-y', '-ss', String(p.t), '-i', src, '-frames:v', '1', '-q:v', '2', jpg]) }
  const clean = path.join(tmp, 'clean.jpg')
  fs.writeFileSync(clean, stripJpeg(fs.readFileSync(jpg)))
  if (p.make === 'screenshot' || p.make === 'streetview') exec(process.env.OSINT_UV || 'uv', ['run', '-q', path.join(HERE, 'bench-make.py'), p.make, clean, out, ...(p.make === 'streetview' ? ['--heading', String(p.heading), '--date', p.date] : [])])
  else fs.copyFileSync(clean, out)
  return out
}
const PROMPT = file => `Où a été prise cette photo ? ${file}
Le cadre est déjà décidé : la question est « où a été prise cette photo », le but est un banc de test de géolocalisation, l'image ne doit pas quitter cette machine, aucune action bruyante, aucune personne visée. Mène l'enquête jusqu'à la conclusion (une seule réponse avec son point, son rayon et sa confiance par niveau) sans me poser de question.`
function session(file, env) {
  return new Promise(ok => {
    const t0 = Date.now(), p = spawn('claude', ['-p', PROMPT(file), '--plugin-dir', path.join(REPO, 'plugins', 'skill-osint'), '--output-format', 'json', '--allowedTools', 'Bash Read Write Edit Glob Grep WebSearch WebFetch Task'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true })
    let out = ''
    p.stdout.on('data', d => (out += d))
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; p.kill() }, 50 * 60e3)
    p.on('close', (code, signal) => { clearTimeout(timer); let j = {}; try { j = JSON.parse(out) } catch {} ok({ code, ms: Date.now() - t0, json: j, interrupted: !!signal && !timedOut }) })
  })
}
// the case a session made for a picture: the geolocate-image case whose E01 has this picture's hash
function caseOf(file) {
  const want = sha(file)
  for (const slug of fs.readdirSync(dir)) {
    const f = path.join(dir, slug, '.osint', 'case.json')
    if (!fs.existsSync(f)) continue
    const c = JSON.parse(fs.readFileSync(f, 'utf8'))
    if (c.type === 'geolocate-image' && c.evidence?.some(e => e.sha256 === want)) return slug
  }
  return null
}
const readCase = slug => JSON.parse(fs.readFileSync(path.join(dir, slug, '.osint', 'case.json'), 'utf8'))
const journalIds = slug => new Set([...fs.readFileSync(path.join(dir, slug, 'Journal.md'), 'utf8').matchAll(/\^(j\d+)/g)].map(m => m[1]))
// a wrong answer announced in high confidence, judged at the level the answer was given
function wrongInHigh(t, radius_m) {
  if (t.answer.confidence !== 'high') return false
  if (t.answer.level === 'country') return t.country_hit === false
  if (t.answer.level === 'region') return t.region_hit === false
  if (t.answer.level === 'street') return t.error_km > 1
  return t.error_km > Math.max(0.2, (radius_m ?? 0) / 1000)
}
const median = v => { const s = v.filter(x => x != null).sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null }
// the mean world-map score counts 0 for a photo without an answer (as GeoINT's scoreboard does)
// a photo whose session the operator stopped by hand (interrupted) measured nothing: left out of every figure
const stat = all => { const rs = all.filter(r => !r.interrupted), known = rs.filter(r => r.country_hit != null)
  return { n: rs.length, interrupted: all.length - rs.length, median_km: median(rs.map(r => r.error_km)), country_rate: known.length ? known.filter(r => r.country_hit).length / known.length : null, mean_score: rs.length ? Math.round(rs.reduce((s, r) => s + (r.score ?? 0), 0) / rs.length) : null, failures: rs.reduce((n, r) => n + r.failures.length, 0) } }

const proxy = await startProxy({ log: path.join(dir, 'hosts.jsonl') })
const env = { ...process.env, OSINT_DIR: dir, GEO_PROXY: proxy.url, OSINT_NOTIFY: '0' }
delete env.OSINT_BY
// a rerun of one category (--only) replaces its rows in the day's report and keeps the others
const todayJson = path.join(HERE, 'bench', `${day}.json`), kept = opt.only && fs.existsSync(todayJson) ? JSON.parse(fs.readFileSync(todayJson, 'utf8')) : null
const firstRun = kept ? kept.first : !!opt.first
const rows = kept ? kept.rows.filter(r => r.category !== opt.only) : [], hosts = () => fs.existsSync(path.join(dir, 'hosts.jsonl')) ? fs.readFileSync(path.join(dir, 'hosts.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
try {
  for (const p of photos) {
    const file = await prepare(p)
    if (opt.prepare) { console.log(`${p.id}: ${file}`); continue }
    console.log(`${p.id} (${p.category}): session…`)
    const start = new Date().toISOString(), s = await session(file, env), end = new Date().toISOString(), u = s.json.usage ?? {}
    const row = { id: p.id, category: p.category, slug: caseOf(file), minutes: +(s.ms / 60e3).toFixed(1), turns: s.json.num_turns ?? null,
      tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), cost_usd: s.json.total_cost_usd ?? null, failures: [] }
    if (hosts().some(h => h.at >= start && h.at <= end && DENY.has(h.host))) row.failures.push('a Google AI host was called')
    const c = row.slug && readCase(row.slug)
    if (s.interrupted) row.interrupted = 'operator'
    else if (!c?.conclusion) row.failures.push('no conclusion')
    else if (!row.interrupted) {
      const t = spawnSync(process.execPath, [ENGINE, 'geolocate-image', 'truth', `${p.lat},${p.lon}`, '-p', row.slug], { env, encoding: 'utf8', windowsHide: true })
      const tr = readCase(row.slug).state['geolocate-image']?.truth
      if (!tr) row.failures.push(`truth failed: ${t.stderr.trim()}`)
      else {
        const ids = journalIds(row.slug), verdicts = readCase(row.slug).reverse?.verdicts ?? []
        const ev = path.join(dir, row.slug, '.osint', 'views', 'evidence.json'), judged = (fs.existsSync(ev) ? JSON.parse(fs.readFileSync(ev, 'utf8')).items ?? [] : []).filter(i => i.verdict)
        Object.assign(row, { error_km: tr.error_km, score: tr.score, country_hit: tr.country_hit, region_hit: tr.region_hit, level: tr.answer.level, confidence: tr.answer.confidence, verdicts: verdicts.length })
        if (wrongInHigh(tr, c.conclusion.radius_m)) row.failures.push('a wrong answer in high confidence')
        if (verdicts.some(v => v.verdict === 'match' && !ids.has(v.journal))) row.failures.push('a match without its Journal entry')
        if (judged.some(i => !verdicts.some(v => ids.has(v.journal) && ((i.page && v.page === i.page) || v.candidate === `#${i.rank}` || v.file === i.file)))) row.failures.push('a result marked verified without a verdict in the Journal')
      }
    }
    rows.push(row)
    write()   // after each photo: a bench stopped half-way keeps what it measured
  }
} finally { proxy.close() }
if (!opt.prepare) process.exit(write() ? 1 : 0)

function write() {
  const cats = [...new Set(rows.map(r => r.category))], by = Object.fromEntries(cats.map(k => [k, stat(rows.filter(r => r.category === k))])), all = stat(rows)
  const benchDir = path.join(HERE, 'bench'), prevFile = fs.existsSync(benchDir) ? fs.readdirSync(benchDir).filter(f => f.endsWith('.json') && f !== `${day}.json`).sort().at(-1) : null
  const prev = prevFile ? JSON.parse(fs.readFileSync(path.join(benchDir, prevFile), 'utf8')) : null
  // stage 14's gate: on a full bench (18 photos, 9 categories), "little-known monument" has the lowest mean score of the
  // nine AND sits at least 1,000 points (an answer about 330 km off) under the median of the other eight categories' means
  const LITTLE = 'little-known monument', little = by[LITTLE]?.mean_score ?? null, rest = Object.entries(by).filter(([k]) => k !== LITTLE).map(([, v]) => v.mean_score)
  const others = median(rest), gap = little != null && others != null ? others - little : null
  const full = !firstRun && rows.length === 18 && Object.keys(by).length === 9, last = little != null && rest.every(v => v > little)
  const vision = full && last && gap >= 1000
  const f = v => (v == null ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v)), pc = v => (v == null ? '—' : `${Math.round(v * 100)} %`)
  const md = [`# Geolocation bench — ${day}`, '', `GeoINT ${PIN.sha.slice(0, 8)} (${PIN.date.slice(0, 10)}) · ${rows.length} photos (${firstRun ? 'one per category' : 'full'}) · the image stays on this machine`, '',
    '## By category', '', '| Category | Photos | Median error (km) | Country right | Mean score | Failures |', '|---|---|---|---|---|---|',
    ...Object.entries(by).map(([k, v]) => `| ${k} | ${v.n}${v.interrupted ? ` (+${v.interrupted} interrupted)` : ''} | ${f(v.median_km)} | ${pc(v.country_rate)} | ${f(v.mean_score)} | ${v.failures} |`),
    `| **all** | ${all.n}${all.interrupted ? ` (+${all.interrupted} interrupted)` : ''} | ${f(all.median_km)} | ${pc(all.country_rate)} | ${f(all.mean_score)} | ${all.failures} |`, '',
    '## Photos', '', '| Id | Category | Error (km) | Level | Confidence | Score | Judged one by one | Minutes | Turns | Tokens | Failures |', '|---|---|---|---|---|---|---|---|---|---|---|',
    ...rows.map(r => `| ${r.id} | ${r.category} | ${f(r.error_km)} | ${f(r.level)} | ${f(r.confidence)} | ${f(r.score)} | ${f(r.verdicts)} | ${r.minutes} | ${f(r.turns)} | ${r.tokens} | ${r.interrupted ? `interrupted (${r.interrupted})` : r.failures.join('; ') || '—'} |`), '',
    `## Against ${prev ? prevFile.replace('.json', '') : 'the previous run'}`, '',
    ...(prev ? Object.entries(by).map(([k, v]) => { const o = prev.by?.[k]; if (!o) return `- ${k}: new`
      const worse = (o.median_km != null && v.median_km != null && v.median_km > o.median_km * 1.25) || (o.country_rate != null && v.country_rate != null && v.country_rate <= o.country_rate - 0.2)
      return `- ${k}: median ${f(o.median_km)} → ${f(v.median_km)} km, country ${pc(o.country_rate)} → ${pc(v.country_rate)}${worse ? ' — **regression**' : ''}` }) : ['- no previous run']), '',
    '## Bench failures', '', ...(all.failures ? rows.filter(r => r.failures.length).map(r => `- ${r.id}: ${r.failures.join('; ')}`) : ['- none']), '',
    '## Vision option (stage 14)', '', `- little-known monument: mean score ${f(little)} against a median of ${f(others)} for the other eight categories (gap ${f(gap)} points; last of the nine: ${last ? 'yes' : 'no'}; full bench: ${full ? 'yes' : 'no'}) → ${vision ? '**justified**' : 'not justified'}`, '']
  fs.mkdirSync(benchDir, { recursive: true })
  fs.writeFileSync(path.join(benchDir, `${day}.md`), md.join('\n'))
  fs.writeFileSync(path.join(benchDir, `${day}.json`), JSON.stringify({ day, pin: PIN.sha, first: firstRun, rows, by, all, vision, vision_gate: { little, others, gap, last, full } }, null, 1))
  return all.failures > 0
}
