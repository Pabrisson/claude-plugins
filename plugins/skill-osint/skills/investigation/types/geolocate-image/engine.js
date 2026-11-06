// The geolocate-image type: where a photo, a video or a Street View capture was taken, by GeoINT's method and tools
// (https://github.com/marouane53/GeoINT, MIT, pinned in lib/python.js): the gut call written before any tool, recon's
// first pass imported into the vault (metadata, text read by OCR to confirm, text and world-prior signals as model
// clues on country hypotheses, crops, the camera, the direct reverse search, the similar images ranked locally),
// street-level sweeps, any other script of the pack, the truth and the scoreboard. Every GeoINT script runs through
// ctx.python: no Google key ever reaches it, and compare.py always runs with --no-check.
import crypto from 'node:crypto'
import fs from 'node:fs'
import { withLock } from '../../engine/lib/case.js'
import path from 'node:path'
import { destination, gameScore, haversineKm, parseLatLon } from '../../engine/lib/geo.js'

const readJ = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const view = (ctx, w) => readJ(ctx.file(`.osint/views/${w}.json`))
const rel = (ctx, abs) => path.relative(ctx.dir, abs).split(path.sep).join('/')
export const point = (lat, lon, props) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: props })
// a view that several commands fill: each one replaces its own group, the others stay
// read, merge, write: under the case's lock, so two commands at once never overwrite each other's group
export const mergeView = (ctx, widget, group, rows) => withLock(ctx.dir, () => mergeViewLocked(ctx, widget, group, rows))
function mergeViewLocked(ctx, widget, group, rows) {
  if (widget === 'map') {
    const v = view(ctx, 'map') ?? { type: 'FeatureCollection', features: [] }
    v.features = [...v.features.filter(f => f.properties?.group !== group), ...rows.map(f => ({ ...f, properties: { ...f.properties, group } }))]
    return ctx.view('map', v)
  }
  const v = view(ctx, widget) ?? { items: [] }
  v.items = [...(v.items ?? []).filter(i => i.group !== group), ...rows.map(i => ({ ...i, group }))]
  ctx.view(widget, v)
}
export const needGut = ctx => { if (!ctx.state().gut) ctx.refuse('write the gut call first, before any tool: geolocate-image gut --file gut.json ("Gut first, written down")') }
// the picture the case studies: the image or the capture given at the start, or the file --file names (a frame, a crop)
export function photoOf(ctx, ref) {
  if (ref) return ctx.evidenceFile(ref)
  const i = ctx.input
  if (i.source === 'video') ctx.refuse('a video: choose its clearest frame first (geolocate-image intake, then --file Evidence/frames/<frame>.jpg)')
  return i.source === 'streetview' ? i.capture : i.image
}

async function intake(ctx) {
  const i = ctx.input
  if (i.source === 'image') return ctx.log(ctx.t('intake_image', { file: path.posix.basename(i.image) }))
  if (i.source === 'streetview') return ctx.log(ctx.t('streetview_read', { file: path.posix.basename(i.capture) }))
  let video = ctx.state().video_file ?? i.video
  if (/^https?:\/\//i.test(video)) {
    ctx.progress(1, 3, 'yt-dlp')
    let got
    // a page without a video: the agent is told what to give instead, no half-evidence, no call stack
    try { got = await ctx.media.download(video) } catch (err) {
      if (err.userError && err.code === 3) throw err
      const why = tail(err.message)
      ctx.fail(ctx.t('no_video', { url: video, error: why }))
      ctx.refuse(`${video}: no video could be downloaded (${why}); nothing was added to Evidence. Download it by hand and give the file (new geolocate-image --file …)`)
    }
    const { file, info } = got
    const src = await ctx.source({ url: video, body: JSON.stringify(info, null, 2), contentType: 'application/json', title: ctx.t('video_page', { title: info.title ?? video }), reliability: 'C' })
    const e = await ctx.evidence(file, { kind: 'original', input: 'video' })
    ctx.media.dropDownload(file)
    const day = /^\d{8}$/.test(info.upload_date ?? '') ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6)}` : '?'
    if (info.uploader || info.upload_date) ctx.clue(ctx.t('video_meta', { who: info.uploader ?? '?', day }), { status: 'read', sources: [src.id] })
    ctx.state({ video_file: e.file, video_source: src.id })
    video = e.file
  }
  ctx.progress(2, 3, 'key frames')
  const r = await ctx.media.frames(video, { max: i.speed === 'deep' ? 40 : 16 })
  mergeView(ctx, 'evidence', 'frames', r.frames.map((f, k) => ({ file: rel(ctx, f.file), kind: 'frame', t: f.t, label: f.t == null ? `frame ${k + 1}` : `${f.t.toFixed(1)} s` })))
  ctx.log(ctx.t('frames', { n: r.frames.length, file: path.posix.basename(video), how: r.how }))
  ctx.progress(3, 3, 'key frames')
}

async function gut(ctx, args, flags) {
  if (ctx.case().python_at) ctx.refuse(`a GeoINT tool already ran (${ctx.case().python_at}): the gut call comes before any tool ("Gut first, written down")`)
  if (ctx.state().gut) ctx.refuse('the gut call is already written (Report.md): it stays as it was, for the calibration')
  let g
  try { g = JSON.parse(fs.readFileSync(flags.file, 'utf8')) } catch (e) { ctx.refuse(`gut --file <gut.json>: ${e.message}`) }
  const ranked = Array.isArray(g?.ranked) ? g.ranked : []
  if (!ranked.length || ranked.some(r => !String(r?.place ?? '').trim() || !(Number(r.p) >= 0))) ctx.refuse('gut --file: { "ranked": [{ "place": "Portugal", "p": 60, "cues": "…" }, …], "region": "…", "would_change": "…" }')
  if (ranked.reduce((s, r) => s + Number(r.p), 0) > 100.5) ctx.refuse('the percentages of the ranked places add up to more than 100')
  if (!String(g.would_change ?? '').trim()) ctx.refuse('"would_change": what would change your mind, written now')
  const data = { at: new Date().toISOString(), ranked: ranked.map(r => ({ place: String(r.place).trim(), p: Number(r.p), cues: String(r.cues ?? '').trim() })), region: String(g.region ?? '').trim() || null, would_change: String(g.would_change).trim() }
  ctx.state({ gut: data })
  ctx.block('Report.md', 'gut', [`## ${ctx.t('gut_title')}`, '', ...data.ranked.map((r, k) => `${k + 1}. **${r.place}** ${r.p} %${r.cues ? ` — ${r.cues}` : ''}`),
    ...(data.region ? ['', `${ctx.t('gut_region')} — ${data.region}`] : []), '', `${ctx.t('gut_would_change')} — ${data.would_change}`].join('\n'))
  ctx.log(`gut call: ${data.ranked.map(r => `${r.place} ${r.p} %`).join(', ')}${data.region ? `; region ${data.region}` : ''}`)
  ctx.view('calibration', { ...(view(ctx, 'calibration') ?? {}), gut: data })
}

const ROLES = ['candidate', 'excluded', 'sightline', 'pano', 'place']
async function mapCmd(ctx, [sub, role], flags) {
  if (sub === 'clear') { mergeView(ctx, 'map', 'agent', []); return ctx.log("map: the agent's features taken off") }
  if (sub !== 'add' || !ROLES.includes(role)) ctx.refuse(`map add ${ROLES.join('|')} --at lat,lon [--to lat,lon | --bearing <deg> --km <n>] [--radius <m>] [--label …] [--ref H02|C07] | map clear`)
  const at = parseLatLon(flags.at) ?? ctx.refuse('--at <lat>,<lon>')
  const extra = { label: flags.label ?? '', ...(flags.ref && { ref: flags.ref }), ...(flags.date && { date: flags.date }), ...(flags.bearing != null && { heading: Number(flags.bearing) }) }
  let f
  if (role === 'sightline') {
    const to = flags.to ? parseLatLon(flags.to) : flags.bearing != null ? destination(at, Number(flags.bearing), Number(flags.km ?? 2)) : null
    if (!to) ctx.refuse('a sight line: --to lat,lon, or --bearing <deg> [--km 2]')
    f = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[at[1], at[0]], [to[1], to[0]]] }, properties: { role, ...extra } }
  } else f = point(at[0], at[1], { role, ...extra, ...(flags.radius && { radius_m: Number(flags.radius) }) })
  mergeView(ctx, 'map', 'agent', [...(view(ctx, 'map')?.features ?? []).filter(x => x.properties?.group === 'agent'), f])
  ctx.log(`map: ${role} at ${at.join(',')}${flags.label ? ` — ${flags.label}` : ''}`)
}

// ---- recon, compare, sweep: GeoINT's outputs into the vault ----
const G = (ctx, rel) => ctx.file(`.osint/geoint/${rel}`)
const tail = s => String(s ?? '').trim().split('\n').slice(-2).join(' ').slice(0, 240)
const pct = p => `${Math.round(p * 100)} %`
const norm = s => String(s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
const wipe = (ctx, rel) => fs.rmSync(ctx.file(rel), { recursive: true, force: true })
const list = s => String(s ?? '').split(',').map(x => x.trim()).filter(Boolean)
const hashOf = s => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16)

// made once per key, whatever the number of runs: a recon run again rewrites its views and blocks, never a clue twice
export async function once(ctx, key, make) {
  const done = ctx.state().imported ?? {}
  if (done[key]) return done[key]
  const id = await make()
  ctx.state({ imported: { ...(ctx.state().imported ?? {}), [key]: id } })
  return id
}
// the country hypothesis of an ISO code: the one recorded, else one the agent wrote with the same name, else a new one
export function ensureCountry(ctx, iso2, name) {
  const st = ctx.state().countries ?? {}, hyps = ctx.hyps()
  if (st[iso2] && hyps.some(h => h.id === st[iso2])) return st[iso2]
  const id = hyps.find(h => h.level === 'country' && norm(h.title) === norm(name))?.id ?? ctx.hyp({ title: name, level: 'country', refuteIf: ctx.t('country_refute') }).id
  ctx.state({ countries: { ...(ctx.state().countries ?? {}), [iso2]: id } })
  return id
}
// what the direct reverse search (Yandex, Baidu) may send: the picture when it may leave as it is, else its latest
// masked copy; nothing when the frame keeps it here, or when people may show and no masked copy exists
export function revFile(ctx, rel) {
  if (ctx.frame().image_may_leave !== true) return { file: null, why: 'frame' }
  const ok = ctx.sendable(), c = ctx.case()
  if (ok(rel).ok) return { file: rel }
  const id = c.evidence.find(e => e.file === rel)?.id
  const masked = c.evidence.filter(e => e.kind === 'masked' && e.of === id).at(-1)
  return masked && ok(masked.file).ok ? { file: masked.file } : { file: null, why: 'people', id: id ?? path.posix.basename(rel) }
}

// Yandex and Baidu result pages (revimg.py's JSON): each a source whose capture is the result screenshot, the similar
// images' sheets into Evidence, the pages a snapshot (refresh compares them by URL)
export async function importRev(ctx, dirs) {
  const pages = new Map(), lines = [], sheets = [], sources = []
  for (const dir of dirs) {
    const abs = G(ctx, dir)
    for (const f of fs.existsSync(abs) ? fs.readdirSync(abs).filter(n => /_(yandex|baidu)\.json$/.test(n)).sort() : []) {
      const raw = fs.readFileSync(path.join(abs, f), 'utf8'), r = JSON.parse(raw), engine = f.endsWith('_baidu.json') ? 'Baidu' : 'Yandex'
      if (r.error) { lines.push(`- ${ctx.t('step_failed', { step: `${engine} (${f})`, error: r.error })}`); continue }
      const title = ctx.t('rev_results', { engine, file: path.basename(r.image ?? f) })
      const shot = r.screenshot && fs.existsSync(r.screenshot) ? r.screenshot : null
      const sid = await once(ctx, `rev:${hashOf(raw)}`, async () => (await ctx.source({ url: r.url, ...(shot ? { file: shot } : { body: raw, contentType: 'application/json' }), title, reliability: 'F' })).id)
      sources.push(sid)
      lines.push(`- ${title}: ${(r.guess ?? []).join(' · ') || '—'} (${sid})`)
      if (r.similar_sheet && fs.existsSync(r.similar_sheet)) sheets.push({ file: ctx.crop(r.similar_sheet, `rev/${path.basename(r.similar_sheet)}`), kind: 'sheet', label: `${engine}: similar images` })
      for (const l of r.links ?? []) if (l.url) pages.set(l.url, { key: l.url, engine: engine.toLowerCase(), title: l.title ?? '', site: l.site ?? '' })
      for (const x of r.similar ?? []) if (x.from) pages.set(x.from, { key: x.from, engine: engine.toLowerCase(), title: '', site: x.site ?? '' })
    }
  }
  return { items: [...pages.values()], lines, sheets, sources }
}

// compare.py with --no-check (MegaLoc only: the agent judges each match itself), every reverse-search list of the case
// merged; the top candidates copied into Evidence/crops/compare with the agent's verdicts so far
export async function runCompare(ctx, queries) {
  const lists = fs.existsSync(G(ctx, '.')) ? fs.readdirSync(G(ctx, '.'), { recursive: true }).filter(f => String(f).endsWith('_baidu.json')) : []
  if (!lists.length) { ctx.log(ctx.t('compare_none')); return [`- ${ctx.t('compare_none')}`] }
  const top = ctx.input.speed === 'deep' ? 48 : 24
  const r = await ctx.python('compare.py', ['--root', '.', '--out-dir', 'compare', ...queries.flatMap(q => ['--query', q]), '--top', String(top), '--no-check'], { label: 'compare (MegaLoc, no Gemini)' })
  if (r.code !== 0) { const t = ctx.t('step_failed', { step: 'compare.py', error: tail(r.err || r.out) }); ctx.fail(t); return [`- ${t}`] }
  const c = JSON.parse(fs.readFileSync(G(ctx, 'compare/compare.json'), 'utf8')), verdicts = ctx.case().reverse?.verdicts ?? []
  wipe(ctx, 'Evidence/crops/compare')
  const items = (c.candidates ?? []).filter(x => x.file && fs.existsSync(G(ctx, x.file))).slice(0, top).map(x => {
    const v = verdicts.findLast(y => (x.page && y.page === x.page) || y.candidate === `#${x.rank}`)
    return { file: ctx.crop(G(ctx, x.file), `compare/${String(x.rank).padStart(3, '0')}.jpg`), kind: 'candidate', rank: x.rank, page: x.page || null, site: x.site || null, score: x.score, label: `#${x.rank} ${x.site || 'local'}`, ...(v && { verdict: v.verdict }) }
  })
  mergeView(ctx, 'evidence', 'compare', items)
  const text = ctx.t('compare_ranked', { n: (c.candidates ?? []).length, lists: c.n_lists ?? 0 })
  ctx.log(text)
  return [`- ${text}`]
}

const STEPS = [['meta.py', 'recon/meta/meta.json', false], ['intake.py', 'recon/intake/ocr.json', false], ['textgeo.py', 'recon/textgeo.json', false],
  ['detect.py', 'recon/detect/detect.json', true], ['calib.py', 'recon/calib.json', true], ['prior.py', 'recon/prior/prior.json', true]]

// recon's outputs, as GeoINT's table says (spec § 10.4): EXIF → inferred clues; OCR → lines the agent confirms in their
// crop; prior.json and textgeo.json → model clues on country hypotheses (board.py's ingest, capped as model); detect.json
// → crops; calib.json → a computed clue; Yandex/Baidu → sources and a snapshot. A missing output is said, never fatal.
export async function importRecon(ctx, { ml = true, rev = null, why = null, id = null, failed = null } = {}) {
  const R = [], map = [], items = [], cells = [], steps = readJ(G(ctx, 'recon/recon.json'))?.steps ?? {}
  for (const [step, rel, heavy] of STEPS) if ((ml || !heavy) && !fs.existsSync(G(ctx, rel)))
    R.push(`- ${ctx.t('step_failed', { step, error: tail(steps[step.replace('.py', '')]?.error) || failed || 'no output' })}`)
  const d = readJ(G(ctx, 'recon/meta/meta.json'))?.digest, tg = readJ(G(ctx, 'recon/textgeo.json')), pr = readJ(G(ctx, 'recon/prior/prior.json'))
  // every country hypothesis first, so that each signal weighs on all of them ("List the whole category before choosing")
  if (pr && pr.assessment?.informative !== false) for (const c of (pr.combined ?? []).filter(c => c.p >= 0.02).slice(0, 5)) ensureCountry(ctx, c.iso2, c.name)
  for (const c of (tg?.shortlist ?? []).filter(c => c.log_lr > 0).slice(0, 3)) ensureCountry(ctx, c.iso2, c.name)
  const countries = () => ctx.state().countries ?? {}
  if (d) {
    const g = d.gps ?? {}, t = d.time ?? {}, before = R.length, note = async (key, text) => R.push(`- ${text} (${await once(ctx, key, () => ctx.clue(text, { status: 'inferred' }).id)})`)
    if (g.lat != null) {
      const text = ctx.t('exif_gps', { lat: g.lat, lon: g.lon, tag: g.source_tag ?? 'GPS' })
      const cid = await once(ctx, 'exif:gps', () => ctx.clue(text, { status: 'inferred', title: ctx.t('exif_point') }).id)
      map.push(point(g.lat, g.lon, { role: 'place', kind: 'exif', label: ctx.t('exif_point'), ref: cid }))
      R.push(`- ${text} (${cid})`)
    }
    if (t.DateTimeOriginal) {
      const ccs = t.countries_with_this_offset_on_that_date ?? []
      await note('exif:time', ctx.t('exif_time', { time: t.DateTimeOriginal, offset: t.utc_offset ? ctx.t('exif_offset', { offset: t.utc_offset, how: t.utc_offset_source, n: ccs.length, list: ccs.slice(0, 25).join(', ') }) : '' }))
    }
    if (Object.keys(d.camera ?? {}).length) await note('exif:camera', ctx.t('exif_camera', { camera: Object.values(d.camera).join(' · ') }))
    for (const [i, h] of (d.filename_hints ?? []).entries()) await note(`exif:filename:${i}`, ctx.t('exif_filename', { pattern: h.pattern }))
    if (d.provenance?.WARNING) await note('exif:ai', ctx.t('exif_ai', { warning: d.provenance.WARNING }))
    if (R.length === before) R.push(`- ${ctx.t('no_metadata')}`)
  }
  const ocr = readJ(G(ctx, 'recon/intake/ocr.json'))
  if (ocr) {
    R.push(`- ${ocr.items?.length ? ctx.t('ocr_title') : ctx.t('ocr_none')}`, ...(ocr.items ?? []).slice(0, 20).map(i => `  - ${Number(i.conf).toFixed(2)} (${i.pass}) ${i.text}`))
    if (fs.existsSync(G(ctx, 'recon/intake/ocr.png'))) items.push({ file: ctx.crop(G(ctx, 'recon/intake/ocr.png'), 'recon/ocr.png'), kind: 'sheet', label: 'OCR boxes' })
  }
  for (const s of (tg?.signals ?? []).filter(s => s.level === 'country')) {
    const text = ctx.t('text_signal', { clue: s.clue }), cid = await once(ctx, `textgeo:${s.clue}`, () => ctx.clue(text, { status: 'model' }).id)
    for (const [cc, lr] of Object.entries(s.lr ?? {})) if (countries()[cc]) cells.push({ hyp: countries()[cc], clue: cid, lr, why: `textgeo ${s.kind}: ${s.clue}`.slice(0, 200) })
    R.push(`- ${text} (${cid})`)
  }
  if (pr) {
    const sig = pr.signals?.[0]
    if (pr.assessment?.informative === false) R.push(`- ${ctx.t('prior_uninformative', { reasons: (pr.assessment.reasons ?? []).join('; ') })}`)
    else if (sig?.p) {
      const top = (pr.combined ?? []).slice(0, 5).map(c => `${c.name} ${pct(c.p)}`).join(', '), text = ctx.t('prior_signal', { top })
      const cid = await once(ctx, 'prior', () => ctx.clue(text, { status: 'model' }).id)
      // board.py's ingest: p × the number of classes for the model's top 10, the mass left shared by the others
      const n = Number(sig.n_classes) || Object.keys(sig.p).length, best = Object.fromEntries(Object.entries(sig.p).sort((a, b) => b[1] - a[1]).slice(0, 10))
      const floor = Math.max(1e-6, (1 - Object.values(best).reduce((s, p) => s + p, 0)) / Math.max(n - Object.keys(best).length, 1)) * n
      for (const [cc, h] of Object.entries(countries())) cells.push({ hyp: h, clue: cid, lr: best[cc] ? best[cc] * n : floor, why: best[cc] ? `world prior p ${best[cc]} × ${n} classes` : "not in the world prior's top 10" })
      R.push(`- ${text} (${cid})`)
      if (pr.best_guess) map.push(point(pr.best_guess.lat, pr.best_guess.lon, { role: 'place', kind: 'prior', label: ctx.t('prior_guess') }))
      for (const c of (pr.geoclip?.clusters ?? []).slice(0, 3)) map.push(point(c.lat, c.lon, { role: 'place', kind: 'geoclip', label: ctx.t('geoclip_cluster', { near: [c.near?.name, c.near?.country_name].filter(Boolean).join(', ') || `${c.lat},${c.lon}`, mass: Math.round(c.mass * 100) }) }))
    }
  }
  const cb = readJ(G(ctx, 'recon/calib.json'))
  if (cb) {
    const u = cb.uncertainty ?? {}, shaky = (u.vfov_uncertainty ?? 0) > 8 || (u.pitch_uncertainty ?? 0) > 3 || (u.focal_uncertainty ?? 0) > 0.3 * (cb.focal_px ?? 1)
    const text = ctx.t('camera', { hfov: cb.hfov_deg, f35: cb.focal_35mm_equiv, pitch: cb.pitch_deg, dp: u.pitch_uncertainty ?? '?', roll: cb.roll_deg, dr: u.roll_uncertainty ?? '?', row: cb.horizon?.row_at_centre ?? '?' }) + (shaky ? ctx.t('camera_shaky') : '')
    const sheet = fs.existsSync(G(ctx, 'recon/calib.jpg')) ? ctx.crop(G(ctx, 'recon/calib.jpg'), 'recon/calib.jpg') : null
    if (sheet) items.push({ file: sheet, kind: 'sheet', label: 'Camera calibration (horizon in red)' })
    R.push(`- ${text} (${await once(ctx, 'calib', () => ctx.clue(text, { status: 'computed', ...(sheet && { where: 'calib.jpg' }) }).id)})`)
  }
  const dt = readJ(G(ctx, 'recon/detect/detect.json'))
  if (dt) {
    const dets = dt.detections ?? [], count = {}
    for (const x of dets) {
      count[x.cls] = (count[x.cls] ?? 0) + 1
      if (fs.existsSync(G(ctx, `recon/detect/${x.crop}`))) items.push({ file: ctx.crop(G(ctx, `recon/detect/${x.crop}`), `recon/${x.crop}`), kind: 'crop', label: `#${x.id} ${x.cls} ${x.score}`, box: x.box })
    }
    if (fs.existsSync(G(ctx, 'recon/detect/detect_sheet.jpg'))) items.push({ file: ctx.crop(G(ctx, 'recon/detect/detect_sheet.jpg'), 'recon/detect_sheet.jpg'), kind: 'sheet', label: 'Detections' })
    R.push(`- ${dets.length ? ctx.t('detections', { list: Object.entries(count).map(([k, v]) => `${k} ${v}`).join(', ') }) : ctx.t('detections_none')}`)
  }
  if (rev) {
    const got = await importRev(ctx, rev), votes = readJ(G(ctx, `${path.posix.dirname(rev[0])}/intake.json`))?.votes ?? {}
    R.push(...got.lines)
    const labels = [...Object.keys(votes.city ?? {}), ...Object.keys(votes.place ?? {})]
    if (labels.length) {
      const text = ctx.t('rev_labels', { engines: 'Yandex, Baidu', labels: labels.slice(0, 12).join('; ') })
      R.push(`- ${text} (${await once(ctx, 'rev:labels', () => ctx.clue(text, { status: 'model', sources: got.sources }).id)})`)
    }
    items.push(...got.sheets)
    ctx.snapshot('rev', got.items)
  } else if (why) R.push(`- ${why === 'frame' ? ctx.t('rev_skipped_frame') : ctx.t('rev_skipped_people', { e: id })}`)
  if (cells.length) ctx.hypLrMany(cells)
  mergeView(ctx, 'map', 'recon', map)
  mergeView(ctx, 'evidence', 'recon', items)
  return R
}

// the file as it leaves (no EXIF, no GPS): a copy under .osint/cache/send, the Journal says what went to Yandex and Baidu
async function sentCopy(ctx, rel) {
  const copy = await ctx.sendCopy(rel)
  ctx.log(ctx.t('rev_sent', { file: rel }))
  return copy.abs
}

async function recon(ctx, args, flags) {
  needGut(ctx)
  const photo = photoOf(ctx, flags.file), ml = !flags['no-ml']
  if (flags['no-people']) ctx.declareClear([photo])
  const send = revFile(ctx, photo)
  ctx.state({ photo })
  // a run again starts clean: what a failed step left is not imported twice
  wipe(ctx, '.osint/geoint/recon'); wipe(ctx, 'Evidence/crops/recon'); wipe(ctx, 'Evidence/crops/rev')
  const argv = [ctx.file(photo), '--out-dir', 'recon', '--skip', 'compare', '--no-rev', ...(ml ? [] : ['--no-ml'])]
  const r = await ctx.python('recon.py', argv, { label: 'recon', watch: STEPS.filter(([, , heavy]) => ml || !heavy).map(([, rel]) => rel) })
  const failed = r.code === 0 ? null : tail(r.err || r.out)
  if (failed) ctx.fail(ctx.t('step_failed', { step: 'recon.py', error: failed }))
  // recon.py keeps the original for its local tools (EXIF, calibration) and never sends it (--no-rev): what goes to Yandex
  // and Baidu is a copy without its metadata, of the picture or of its masked copy
  let rev = null
  if (send.file) {
    const copy = await sentCopy(ctx, send.file)
    const m = await ctx.python('intake.py', [copy, '--out-dir', 'recon/sent', '--no-ocr', '--no-compare'], { label: 'reverse search' })
    if (m.code === 0) rev = ['recon/sent/rev']
    else ctx.fail(ctx.t('step_failed', { step: 'intake.py', error: tail(m.err || m.out) }))
  }
  const R = await importRecon(ctx, { ml, rev, why: send.why, id: send.id, failed })
  if (rev) R.push(...(await runCompare(ctx, [ctx.file(photo)])))
  ctx.block('Report.md', 'recon', [`## ${ctx.t('recon_title')}`, '', ...R].join('\n'))
  ctx.log(`recon imported: ${R.length} lines in Report.md (recon block); the run's own page: .osint/geoint/recon/recon.md`)
}

async function compare(ctx, args, flags) {
  needGut(ctx)
  const photo = flags.file ? ctx.evidenceFile(flags.file) : ctx.state().photo ?? photoOf(ctx)
  await runCompare(ctx, [ctx.file(photo), ...list(flags.query).map(q => ctx.file(ctx.evidenceFile(q)))])
}

async function sweep(ctx, [sub], flags) {
  needGut(ctx)
  if (sub === 'index') {
    const manifests = list(flags.manifest)
    if (!manifests.length) ctx.refuse('sweep index --manifest town.jsonl[,other.jsonl] [--name town] (a manifest: geolocate-image run pano.py list --provider … --near lat,lon --radius 3000 --out town.jsonl)')
    for (const m of manifests) if (!fs.existsSync(path.resolve(G(ctx, '.'), m))) ctx.refuse(`no manifest ${m} in ${G(ctx, '.')}`)
    const r = await ctx.python('sweep.py', ['index', '--manifest', ...manifests, ...(flags.name ? ['--name', flags.name] : [])], {
      label: 'sweep index', onLine: line => { const m = /^\s*(\d+)\/(\d+) panoramas/.exec(line); if (m) ctx.progress(Number(m[1]), Number(m[2]), line.trim()) },
    })
    if (r.code !== 0) ctx.refuse(`sweep.py index exited ${r.code}: ${tail(r.err || r.out)}`)
    return ctx.log(r.out.split('\n').find(l => l.startsWith('done:')) ?? `index ${flags.name ?? path.parse(manifests[0]).name} ready`)
  }
  if (sub !== 'rank') ctx.refuse('sweep index --manifest town.jsonl | sweep rank --index town[,other] [--file E01] [--top 40]')
  const names = list(flags.index)
  if (!names.length) ctx.refuse('sweep rank --index town[,other]: the indexes sweep index built')
  const photo = flags.file ? ctx.evidenceFile(flags.file) : ctx.state().photo ?? photoOf(ctx), tag = names.join('+'), out = `sweep/${tag.replace(/[^\w+-]+/g, '-')}`
  wipe(ctx, `.osint/geoint/${out}`)
  const r = await ctx.python('sweep.py', ['rank', '--index', ...names, '--query', ctx.file(photo), '--out-dir', out, '--top', String(flags.top ?? 40)], { label: 'sweep rank' })
  if (r.code !== 0) ctx.refuse(`sweep.py rank exited ${r.code}: ${tail(r.err || r.out)}`)
  const ranked = readJ(G(ctx, `${out}/ranked.json`)) ?? [], clusters = readJ(G(ctx, `${out}/clusters.json`)) ?? [], best = ranked[0]
  mergeView(ctx, 'map', `sweep:${tag}`, [
    ...ranked.slice(0, 20).map(x => point(x.lat, x.lon, { role: 'pano', kind: x.provider, label: `#${x.rank} ${x.key}`, heading: x.best_bearing, ...(x.date && { date: x.date }), ...(x.link && { url: x.link }) })),
    ...clusters.slice(0, 3).map(c => point(c.center[0], c.center[1], { role: 'place', kind: 'cluster', radius_m: Math.max(c.radius_m, 25), label: ctx.t('sweep_cluster', { n: c.n, r: c.radius_m, lat: c.center[0], lon: c.center[1] }) })),
  ])
  const sheet = fs.existsSync(G(ctx, `${out}/top.jpg`)) ? ctx.crop(G(ctx, `${out}/top.jpg`), `sweep/${tag}-top.jpg`) : null
  mergeView(ctx, 'evidence', `sweep:${tag}`, sheet ? [{ file: sheet, kind: 'sheet', label: `Sweep ${names.join(', ')}: best panoramas` }] : [])
  if (!best) return ctx.log(`sweep ${tag}: nothing ranked`)
  const text = ctx.t('sweep_ranked', { index: names.join(', '), n: ranked.length, key: best.key, date: best.date || '?', lat: best.lat, lon: best.lon, brg: best.best_bearing })
  await once(ctx, `sweep:${tag}:${hashOf(fs.readFileSync(G(ctx, `${out}/ranked.json`), 'utf8'))}`, () => ctx.clue(text, { status: 'model', ...(sheet && { where: path.posix.basename(sheet) }) }).id)
  ctx.log(text)
}

// ---- run, refresh, truth, scoreboard ----
// scripts whose work enters the vault through their own command, and the pack's own bookkeeping
const DEDICATED = { 'recon.py': 'geolocate-image recon', 'compare.py': 'geolocate-image compare (always --no-check)', 'board.py': 'hyp add|lr|exclude|retain (the case is the board)', 'photo_session.py': 'the case itself (new, conclude, geolocate-image truth)', 'bench.py': "the plugin's own bench (test/bench.mjs)" }
// the options of the image-sending scripts that take a value: their other plain arguments are pictures
const VALUED = new Set(['--out-dir', '--engines', '--exclude', '--proxy', '--query', '--text-engines', '--similar-pages', '--similar-sheet', '--box', '--max-variants'])
const picturesOf = args => args.filter((a, i) => !a.startsWith('-') && !VALUED.has(args[i - 1]))
// the pictures a call sends out of this machine: revimg.py its images (a keyword search alone sends none), intake.py
// its photo unless --no-rev
export const SENDS = { 'revimg.py': args => picturesOf(args), 'intake.py': args => (args.includes('--no-rev') ? [] : picturesOf(args).slice(0, 1)) }

async function runScript(ctx, argv) {
  needGut(ctx)
  let [script, ...args] = argv
  if (!script) ctx.refuse('run <script.py> [args…]: any script of the GeoINT pack (status -p names its folder)')
  if (!script.endsWith('.py')) script += '.py'
  if (script.startsWith('_')) ctx.refuse(`${script} is a module of the pack, not a tool`)
  if (DEDICATED[script]) ctx.refuse(`${script} has its own command: ${DEDICATED[script]}`)
  if (script === 'sweep.py' && ['index', 'rank'].includes(args[0])) ctx.refuse(`sweep.py ${args[0]} has its own command: geolocate-image sweep ${args[0]}`)
  if (script === 'clues.py' && args[0] === 'update') ctx.refuse('clues.py update changes the pack: it stays as pinned, never run it')
  if (script === 'triage.py' && args.includes('--check')) ctx.refuse('triage.py --check asks Gemini: the agent judges each match itself, one image at a time, at full size')
  const noPeople = args.includes('--no-people')
  args = args.filter(a => a !== '--no-people')
  const out = SENDS[script]?.(args) ?? []
  if (out.length) {
    const may = ctx.frame().image_may_leave
    if (may !== true) ctx.refuse(`${script} would send ${out.join(', ')} out of this machine: the frame keeps the image on this machine (image_may_leave: ${may ?? 'not set'})`)
    const rels = out.map(p => { try { return ctx.evidenceFile(p) } catch { return ctx.refuse(`${p}: only a file of the case's Evidence folder may leave (an id such as E02, or Evidence/…)`) } })
    if (noPeople) ctx.declareClear(rels)
    const ok = ctx.sendable()
    for (const rel of rels) { const s = ok(rel); if (!s.ok) ctx.refuse(`${rel}: ${s.why}`) }
    const copies = []
    for (const rel of rels) copies.push(await sentCopy(ctx, rel))
    args = args.map(a => (out.includes(a) ? copies[out.indexOf(a)] : a))
  }
  if (script === 'intake.py' && !args.includes('--no-compare')) args.push('--no-compare')   // its own compare.py would run without --no-check
  // an Evidence path, or an evidence id (E01), becomes the file's absolute path: the script runs in .osint/geoint
  args = args.map(a => (/^Evidence\//.test(a) ? ctx.file(a) : /^E\d{2,}$/i.test(a) ? (() => { try { return ctx.file(ctx.evidenceFile(a)) } catch { return a } })() : a))
  const r = await ctx.python(script, args, { label: script })
  if (r.out.trim()) console.log(r.out.trim())
  if (r.code !== 0) ctx.refuse(`${script} exited ${r.code}: ${tail(r.err || r.out)}`)
}

// refresh: the picture recon searched, sent again to Yandex and Baidu when the frame and the masks allow it
async function revAgain(ctx) {
  const photo = ctx.state().photo
  if (!photo) return ctx.log(ctx.t('rev_no_photo'))
  const send = revFile(ctx, photo)
  if (!send.file) return ctx.log(send.why === 'frame' ? ctx.t('rev_skipped_frame') : ctx.t('rev_skipped_people', { e: send.id }))
  const out = `rev/${new Date().toISOString().slice(0, 10)}`
  wipe(ctx, `.osint/geoint/${out}`)
  const r = await ctx.python('intake.py', [await sentCopy(ctx, send.file), '--out-dir', out, '--no-ocr', '--no-compare'], { label: 'Yandex and Baidu again' })
  if (r.code !== 0) return ctx.fail(ctx.t('step_failed', { step: 'intake.py', error: tail(r.err || r.out) }))
  const got = await importRev(ctx, [`${out}/rev`])
  ctx.snapshot('rev', got.items)
  mergeView(ctx, 'evidence', 'rev', got.sheets)
  await runCompare(ctx, [ctx.file(photo)])
  ctx.log(ctx.t('rev_pages', { n: got.items.length }))
}

// the retained answer's point, else the nearest one up its line of hypotheses (a street's, a region's)
export function retainedPoint(ctx) {
  const c = ctx.case().conclusion, hyps = ctx.hyps(), seen = new Set()
  for (let h = c && hyps.find(x => x.id === c.answer); h && !seen.has(h.id); h = hyps.find(x => x.id === h.parent)) {
    seen.add(h.id)
    if (Array.isArray(h.point)) return h.point
  }
  return null
}
// the providers pano.py lists by area; the point-lookup ones (Yandex, Naver, Kakao, Mapy, Já) would sample a grid
const LISTED = ['google', 'apple', 'bing', 'kartaview', 'panoramax', 'mapillary']
async function panos(ctx) {
  const at = retainedPoint(ctx), R = 300
  if (!at) return ctx.log(ctx.t('refresh_no_point'))
  const ll = at.join(',')
  await ctx.python('pano.py', ['coverage', ll, '--radius', String(R), '--out', 'panos/coverage.json'], { label: 'street-level coverage' })
  const providers = Object.entries(readJ(G(ctx, 'panos/coverage.json'))?.providers ?? {}).filter(([p, v]) => v.n > 0 && LISTED.includes(p)).map(([p]) => p)
  const rows = []
  for (const p of providers) {
    await ctx.python('pano.py', ['list', '--provider', p, '--near', ll, '--radius', String(R), '--out', `panos/${p}.jsonl`], { label: `${p} panoramas` })
    try { rows.push(...fs.readFileSync(G(ctx, `panos/${p}.jsonl`), 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l))) } catch {}
  }
  ctx.snapshot('panos', rows.map(r => ({ key: `${r.provider}:${r.id}`, date: r.date ?? '', lat: r.lat, lon: r.lon })))
  mergeView(ctx, 'map', 'panos', rows.map(r => point(r.lat, r.lon, { role: 'pano', kind: r.provider, label: `${r.provider} ${r.date ?? ''}`.trim(), heading: r.heading, ...(r.date && { date: r.date }), ...(r.link && { url: r.link }) })))
  ctx.log(ctx.t('panos_found', { n: rows.length, r: R, providers: providers.join(', ') || '—' }))
}

// a point's country and region by Nominatim (1 request a second, cached in the case): ISO 3166-2 at the levels it gives
async function placeOf(ctx, [lat, lon]) {
  const r = await ctx.fetch('nominatim', `/reverse?lat=${+lat.toFixed(4)}&lon=${+lon.toFixed(4)}&format=jsonv2&zoom=10&accept-language=en`, { timeout: 20000 })
  const a = r.status === 200 ? JSON.parse(r.body.toString('utf8')).address ?? {} : {}
  return { country: a.country ?? null, country_code: a.country_code ? a.country_code.toUpperCase() : null, lvl4: a['ISO3166-2-lvl4'] ?? null, lvl6: a['ISO3166-2-lvl6'] ?? null,
    name: a.state ?? a.region ?? a.county ?? null, place: [a.city ?? a.town ?? a.village ?? a.county, a.country].filter(Boolean).join(', ') || null }
}
const regionOf = p => p.lvl4 ?? p.lvl6 ?? p.name ?? null
// the same region: by ISO 3166-2 at a level both places have, else by name; unknown when either has none
export function sameRegion(a, b) {
  for (const k of ['lvl4', 'lvl6', 'name']) if (a?.[k] && b?.[k]) return norm(a[k]) === norm(b[k])
  return null
}
// the names a gut call may give a country: its code, Nominatim's English name, its name in English and in the case's language
function countryNames(code, lang, also) {
  const out = new Set([norm(code), norm(also)])
  for (const l of new Set(['en', lang])) { try { out.add(norm(new Intl.DisplayNames([l], { type: 'region' }).of(code))) } catch {} }
  return out
}
const word = (ctx, v) => ctx.t(v == null ? 'unknown' : v ? 'hit' : 'miss')

async function truth(ctx, argv) {
  const ll = parseLatLon(argv[0]) ?? ctx.refuse('truth <lat>,<lon>: the true location in decimal degrees (38.5728,-7.9076)')
  const c = ctx.case().conclusion ?? ctx.refuse('conclude first: the truth is scored against the answer (conclude --file)')
  const hyps = ctx.hyps(), ans = hyps.find(h => h.id === c.answer) ?? ctx.refuse(`no hypothesis ${c.answer}`), line = []
  for (let h = ans; h && !line.includes(h); h = hyps.find(x => x.id === h.parent)) line.push(h)
  const pt = retainedPoint(ctx), iso = Object.entries(ctx.state().countries ?? {}).find(([, id]) => line.some(h => h.id === id))?.[0] ?? null
  const real = await placeOf(ctx, ll), said = pt ? await placeOf(ctx, pt) : null
  const km = pt ? haversineKm(pt, ll) : null, gut = ctx.state().gut ?? null
  const names = real.country_code ? countryNames(real.country_code, ctx.lang, real.country) : new Set()
  const rank = gut ? gut.ranked.findIndex(r => names.has(norm(r.place))) + 1 : 0, code = said?.country_code ?? iso
  const rec = {
    lat: ll[0], lon: ll[1], at: new Date().toISOString(), error_km: km == null ? null : Math.round(km * 1000) / 1000, score: km == null ? null : gameScore(km),
    country: real.country, country_code: real.country_code, region: regionOf(real),
    answer: { hyp: ans.id, title: ans.title, point: pt, level: ans.level, confidence: ctx.frame().confidence ?? null, country_code: code, region: said ? regionOf(said) : null },
    country_hit: code && real.country_code ? code === real.country_code : null, region_hit: said ? sameRegion(said, real) : null,
    gut_hit: gut ? rank === 1 : null, gut_rank: rank || null,
  }
  ctx.state({ truth: rec })
  const text = ctx.t('truth_line', { lat: ll[0], lon: ll[1], place: real.place ?? '—', km: km == null ? '—' : km.toFixed(2), score: rec.score ?? '—',
    country: word(ctx, rec.country_hit), region: word(ctx, rec.region_hit), gut: word(ctx, rec.gut_hit), confidence: rec.answer.confidence ?? '—' })
  ctx.block('Report.md', 'truth', `## ${ctx.t('truth_title')}\n\n${text}`)
  ctx.view('calibration', { gut: null, scoreboard: null, ...(view(ctx, 'calibration') ?? {}), truth: rec })
  mergeView(ctx, 'map', 'truth', [point(ll[0], ll[1], { role: 'place', kind: 'truth', label: ctx.t('truth_title') })])
  ctx.log(text)
  const board = writeScoreboard(ctx.homeCtx())
  console.log(`${text}\nscoreboard: ${board.cases} scored cases, median error ${board.median_km ?? '—'} km`)
}

const median = v => { const s = [...v].sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null }
const r3 = v => (v == null ? null : Math.round(v * 1000) / 1000)
const share = (xs, f) => (xs.length ? r3(xs.filter(f).length / xs.length) : null)
const rate = xs => share(xs.filter(x => x != null), Boolean)
export const THRESHOLDS = [1, 25, 200, 750, 2500]
// GeoINT's scoreboard (photo_session.py scoreboard) over the folder's geolocate-image cases with a truth
export function scoreboardOf(cases) {
  const rows = cases.map(c => ({ slug: c.slug, t: c.case.state?.['geolocate-image']?.truth })).filter(x => x.t)
    .map(({ slug, t }) => ({ slug, error_km: t.error_km, score: t.score, confidence: t.answer?.confidence ?? null, country_hit: t.country_hit, gut_hit: t.gut_hit }))
  const km = rows.map(r => r.error_km).filter(v => v != null), scored = rows.filter(r => r.score != null)
  const by = Object.fromEntries(['high', 'medium', 'low'].map(k => {
    const e = rows.filter(r => r.confidence === k && r.error_km != null).map(r => r.error_km)
    return [k, { n: e.length, median_km: r3(median(e)), within_25: share(e, v => v <= 25), within_200: share(e, v => v <= 200) }]
  }))
  return { at: new Date().toISOString(), cases: rows.length, median_km: r3(median(km)), mean_score: scored.length ? Math.round(scored.reduce((s, r) => s + r.score, 0) / scored.length) : null,
    within: Object.fromEntries(THRESHOLDS.map(k => [String(k), share(km, v => v <= k)])), country_rate: rate(rows.map(r => r.country_hit)), gut_country_rate: rate(rows.map(r => r.gut_hit)), by_confidence: by, rows }
}
// the board in every geolocate-image case's calibration view (the dashboard shows it on each)
export function writeScoreboard(home) {
  const cases = home.cases(), board = scoreboardOf(cases)
  for (const c of cases) home.view(c.slug, 'calibration', { gut: null, truth: null, ...(readJ(path.join(c.dir, '.osint', 'views', 'calibration.json')) ?? {}), scoreboard: board })
  return board
}
async function scoreboardCmd(home) {
  const b = writeScoreboard(home), p = v => (v == null ? '—' : `${Math.round(v * 100)} %`)
  console.log([`${b.cases} scored geolocate-image cases · median error ${b.median_km ?? '—'} km · mean world-map score ${b.mean_score ?? '—'}`,
    `within ${THRESHOLDS.map(k => `${k} km ${p(b.within[k])}`).join(' · ')}`, `country right ${p(b.country_rate)} · gut call's country right ${p(b.gut_country_rate)}`,
    ...Object.entries(b.by_confidence).map(([k, v]) => `stated ${k}: ${v.n} cases, median ${v.median_km ?? '—'} km, within 25 km ${p(v.within_25)}, within 200 km ${p(v.within_200)}`)].join('\n'))
}

export const commands = {
  intake: { help: 'a video: key frames (ffmpeg), by link through yt-dlp; a Street View capture: read its date and compass', flags: {}, run: intake },
  gut: { help: 'the gut call, before any tool: --file gut.json ({ ranked: [{ place, p, cues }], region, would_change })', flags: { file: 'string' }, run: gut },
  map: { help: 'map add candidate|excluded|sightline|pano|place --at lat,lon […] | map clear', flags: { at: 'string', to: 'string', bearing: 'string', km: 'string', radius: 'string', label: 'string', ref: 'string', date: 'string' }, run: mapCmd },
  recon: { help: "GeoINT's first pass (recon.py) imported: metadata, text, world prior, camera, detections, Yandex and Baidu when the frame allows, then compare --no-check; --no-people: you looked and saw nobody; --no-ml: no local model; --file: a frame or a crop", flags: { file: 'string', 'no-people': 'boolean', 'no-ml': 'boolean' }, run: recon },
  compare: { help: 'compare.py --no-check: every reverse-search list ranked locally with MegaLoc; --query crop1,crop2 adds queries', flags: { file: 'string', query: 'string' }, run: compare },
  sweep: { help: 'sweep index --manifest town.jsonl [--name town] | sweep rank --index town[,other] [--file E01] [--top 40]', flags: { manifest: 'string', name: 'string', index: 'string', file: 'string', top: 'string' }, run: sweep },
  run: { help: 'run <script.py> [args…]: any other script of the GeoINT pack in the case\'s working folder; a picture it sends must be an Evidence file, masked or declared clear (--no-people)', raw: true, run: runScript },
  rev: { help: 'refresh step: Yandex and Baidu again on the picture recon searched (a snapshot by page URL), then compare', flags: {}, run: revAgain },
  panos: { help: "refresh step: panoramas within 300 m of the retained answer's point (a snapshot by provider and id)", flags: {}, run: panos },
  truth: { help: 'truth <lat>,<lon>: the true location scored against the answer (error, world-map score, country and region, the gut call)', raw: true, run: truth },
  scoreboard: { help: 'every geolocate-image case of the folder with a truth: median error, shares within 1/25/200/750/2500 km, country rate, calibration by stated confidence', global: true, flags: {}, run: scoreboardCmd },
}
