// Kie.ai: one key for the image, video and speech models of many labs, billed in credits (1 credit = $0.005, its
// published rate: costs are kept in USD, as its price API gives them, the credits said beside). Every generation is a
// task (createTask, then recordInfo); its files reach Kie by its own upload, free and kept 24 h: no tunnel.
// $KIE_API_KEY (the plugin's secret); $KIE_BASE, $KIE_UPLOAD_BASE, $KIE_DOCS for the tests' fake server
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { retry429, windowed } from '../lib/limit.js'
import { palette, resolveOptions } from '../lib/options.js'

const base = () => (process.env.KIE_BASE ?? 'https://api.kie.ai').replace(/\/$/, '')
const uploads = () => (process.env.KIE_UPLOAD_BASE ?? 'https://kieai.redpandaai.co').replace(/\/$/, '')
const docs = () => (process.env.KIE_DOCS ?? 'https://docs.kie.ai').replace(/\/$/, '')
const USD = 0.005
const POLL = () => +(process.env.MEDIA_GENERATOR_POLL ?? 4000)
const RETRY = () => +(process.env.MEDIA_GENERATOR_RETRY ?? 10e3)
const sleep = ms => new Promise(ok => setTimeout(ok, ms))

// Kie answers HTTP 200 with its own code in the body
const WHY = { 401: 'the key is refused', 402: 'not enough credits on Kie', 422: 'refused', 429: 'rate limited: 20 new generations per 10 s, tried 5 times', 455: 'Kie is under maintenance', 501: 'the generation failed', 505: 'this feature is off' }
async function call(url, init = {}, key = process.env.KIE_API_KEY) {
  if (!key) throw Object.assign(new Error('no Kie key: /plugin configure skill-video@pabrisson, or KIE_API_KEY'), { status: 401 })
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${key}`, ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...init.headers } })
  const text = await r.text()
  let j = null
  try { j = JSON.parse(text) } catch { /* an HTML error page */ }
  const code = j?.code ?? r.status
  if (!r.ok || code !== 200) throw Object.assign(new Error(`Kie ${new URL(url).pathname}: ${code}${WHY[code] ? ` (${WHY[code]})` : ''} ${j?.msg ?? text.slice(0, 200)}`.trim()), { status: code })
  return j
}
// a read waits out a 429 too; a new generation takes a place in the account's window first
const get = route => retry429(() => call(base() + route), { wait: RETRY() })
const slot = windowed(+(process.env.KIE_RATE ?? 20), +(process.env.KIE_RATE_MS ?? 10e3))
const waiting = progress => () => progress?.('waiting for Kie\'s rate limit (20 new generations per 10 s)…')
const create = (model, input, progress) => retry429(async () => {
  await slot(waiting(progress))
  return (await call(`${base()}/api/v1/jobs/createTask`, { method: 'POST', body: JSON.stringify({ model, input }) })).data.taskId
}, { wait: RETRY(), onWait: waiting(progress) })

// a local file or a data: URL becomes a URL Kie fetches
const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' }
async function upload(src) {
  if (/^https?:/.test(src)) return src
  if (src.startsWith('data:')) {
    const j = await retry429(() => call(`${uploads()}/api/file-base64-upload`, { method: 'POST', body: JSON.stringify({ base64Data: src, uploadPath: 'media-generator' }) }), { wait: RETRY() })
    return j.data.downloadUrl
  }
  const form = () => {
    const f = new FormData()
    f.append('file', new Blob([fs.readFileSync(src)], { type: TYPES[path.extname(src).toLowerCase()] ?? 'application/octet-stream' }), path.basename(src))
    f.append('uploadPath', 'media-generator')
    return f
  }
  return (await retry429(() => call(`${uploads()}/api/file-stream-upload`, { method: 'POST', body: form() }), { wait: RETRY() })).data.downloadUrl
}

// ---------- the models: a list kept by hand next to this file, plus the ones Kie adds (its catalog) ----------

const list = () => JSON.parse(fs.readFileSync(process.env.MEDIA_GENERATOR_KIE_MODELS ?? new URL('./kie-models.json', import.meta.url), 'utf8'))
// the catalog's models' prices: Kie's price rows name no model, each matched by hand
export const CATALOG_PRICES = JSON.parse(fs.readFileSync(new URL('./kie-catalog-prices.json', import.meta.url), 'utf8'))
const CACHE = name => path.join(process.env.MEDIA_GENERATOR_KIE_CACHE ?? path.join(os.homedir(), '.cache/media-generator'), `kie-${name}.json`)
const readCache = name => { try { return JSON.parse(fs.readFileSync(CACHE(name), 'utf8')) } catch { return null } }
const writeCache = (name, v) => { fs.mkdirSync(path.dirname(CACHE(name)), { recursive: true }); fs.writeFileSync(CACHE(name), JSON.stringify(v, null, 1)); return v }
const DAY = 864e5

// the price list, by its rows' words (« bytedance/seedance-2-5, 720p no video »): public, no key, 100 rows a page
async function fetchPrices() {
  const rows = {}
  for (let page = 1, pages = 1; page <= pages; page++) {
    const r = await fetch(`${base()}/client/v1/model-pricing/page`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageNum: page, pageSize: 100, modelDescription: '', interfaceType: '' }), signal: AbortSignal.timeout(15e3) })
    const j = await r.json()
    if (j.code !== 200) throw new Error(`Kie's prices: ${j.code} ${j.msg}`)
    pages = j.data.pages
    for (const x of j.data.records) if (x.interfaceType !== 'chat') rows[x.modelDescription] = { credits: +x.creditPrice, usd: +x.usdPrice, unit: x.creditUnit }
  }
  return { at: new Date().toISOString(), rows }
}

// one docs page's request: its model names, its kind and its input's properties (type, enum, maxItems, required),
// read by indentation: some pages are not strict YAML (Kling 3.0's, 2026-10-31)
export function readSpec(text) {
  const lines = text.split('\n'), props = {}, required = []
  // its kind and lab from its tag (« docs/en/Market/Video Models/Kling »), its name from its title
  const tag = /Market\/(Image|Video|Music|Audio)\s+Models\/([^\n]+)/i.exec(text), kind = tag?.[1]?.toLowerCase(), lab = tag?.[2]?.trim()
  const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim()
  const indent = l => l.length - l.trimStart().length
  // the items of the first « enum: » under line i, within its block
  const enumUnder = i => {
    const out = []
    let e = -1
    for (let j = i + 1; j < lines.length && (!lines[j].trim() || indent(lines[j]) > indent(lines[i])); j++) {
      if (/^\s+enum:\s*$/.test(lines[j])) { if (e >= 0) break; e = indent(lines[j]); continue }
      if (e < 0) continue
      const m = /^(\s+)-\s+'?([^'\s]+)'?\s*$/.exec(lines[j])
      if (m && m[1].length >= e) out.push(m[2])
      else if (lines[j].trim() && indent(lines[j]) <= e) break
    }
    return out
  }
  const i = lines.findIndex(l => /^\s+model:\s*$/.test(l))
  if (i < 0) return null
  const models = enumUnder(i)
  // the input beside the model, before or after it (Nano Banana Pro's page put it first, 2026-10-31)
  const at = lines.findIndex(l => /^\s+input:\s*$/.test(l) && indent(l) === indent(lines[i]))
  if (at < 0) return { kind, lab, title, models, props, required }
  const pi = lines.findIndex((l, j) => j > at && /^\s+properties:\s*$/.test(l)), d = indent(lines[pi]) + 2
  for (let j = pi + 1; j < lines.length; j++) {
    const l = lines[j], n = indent(l)
    if (!l.trim()) continue
    if (n < d) {
      // the input's required keys, then its end
      if (n === d - 2 && /^\s+required:\s*$/.test(l)) for (let k = j + 1; /^\s+-\s+\w/.test(lines[k] ?? ''); k++) required.push(lines[k].trim().slice(2).trim())
      if (n <= indent(lines[at])) break
      continue
    }
    // a key YAML would read as a boolean comes quoted ('n':)
    if (n !== d || !/^\s+'?[\w-]+'?:\s*$/.test(l)) continue
    const key = l.trim().slice(0, -1).replace(/^'|'$/g, ''), own = k => new RegExp(`^\\s{${d + 2}}${k}:\\s*(.+)$`)
    const block = []
    for (let k = j + 1; k < lines.length && (!lines[k].trim() || indent(lines[k]) > d); k++) block.push(lines[k])
    const val = k => block.map(b => own(k).exec(b)?.[1]).find(Boolean)?.replace(/^'|'$/g, '')
    props[key] = { type: val('type'), maxItems: val('maxItems'), default: val('default'), enum: enumUnder(j) }
  }
  return { kind, lab, title, models, props, required }
}

// a catalog model in the hand list's shape, from its page: its known inputs named for the engine; null when one it
// requires has no engine name (« not wired »)
const KNOWN = { prompt: 'prompt', image_urls: 'images', input_urls: 'images', image_input: 'images', reference_image_urls: 'images', image_url: 'images', input_image: 'images', image: 'images',
  first_frame_url: 'first_frame', last_frame_url: 'last_frame', video_url: 'video', video_urls: 'video', reference_video_urls: 'video', audio_url: 'audio', reference_audio_urls: 'audio',
  resolution: 'resolution', aspect_ratio: 'aspect_ratio', duration: 'duration', generate_audio: 'sound', sound: 'sound', seed: 'seed', num_images: 'n', text: 'text', voice: 'voice', upscale_factor: 'factor', background: 'background' }
const RES = ['360p', '480p', '540p', '720p', '768p', '1080p', '1K', '1.5K', '2K', '4K']
const ratio = r => r.split(':').reduce((a, b) => a / b)
// a title without its lab in front (« Grok Imagine Image 2.0 » → « Image 2.0 »), unless a version follows it (« Qwen 2.1 »)
const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const shorten = (title, lab) => {
  for (const l of [lab, lab.split(' ')[0]]) {
    const rest = title.replace(new RegExp(`^${esc(l)}\\s+`, 'i'), '')
    if (rest !== title) return /^\d/.test(rest) ? title : rest.replace(/^[-–:]\s*/, '')
  }
  return title
}
export function fromSpec(name, spec) {
  const kind = { image: 'image', video: 'video', music: 'speech', audio: 'speech' }[spec.kind]
  if (!kind || spec.required.some(k => !KNOWN[k])) return null
  const p = spec.props, fields = {}, values = {}
  for (const [k, v] of Object.entries(p)) if (KNOWN[k] && !(KNOWN[k] === 'sound' && v.type !== 'boolean')) fields[KNOWN[k]] ??= v.type === 'array' ? `${k}[]` : k
  const res = (p.resolution?.enum ?? []).map(r => ({ r, norm: RES.find(x => x.toLowerCase() === r.toLowerCase()) })).filter(x => x.norm)
  for (const { r, norm } of res) if (r !== norm) (values.resolution ??= {})[norm] = r
  if (p.duration?.type === 'string') values.duration = 'string'
  const ratios = (p.aspect_ratio?.enum ?? []).filter(r => /^\d+(\.\d+)?:\d+(\.\d+)?$/.test(r)).toSorted((a, b) => ratio(a) - ratio(b))
  const durations = (p.duration?.enum ?? []).map(Number).filter(Number.isInteger).toSorted((a, b) => a - b)
  const needs = k => spec.required.includes(Object.keys(p).find(x => KNOWN[x] === k))
  // « GPT Image-2 - Text to Image » under GPT Image: the lab, the name without it; a page of several models names each
  const lab = spec.lab ?? name.split('/')[0], titled = spec.title && spec.models.length === 1 ? shorten(spec.title, lab) : null
  const m = { id: name, lab, name: titled ?? name.split('/').at(-1), kie: name, fields, values, price: [], new: true,
    resolutions: res.length ? res.map(x => x.norm).toSorted((a, b) => RES.indexOf(a) - RES.indexOf(b)) : null, aspect_ratios: ratios.length ? ratios : null, seed: !!p.seed }
  if (kind === 'image') return { ...m, role: !fields.images ? 'create' : needs('images') ? 'edit' : 'both', max_images: 1, references: fields.images ? +(p[Object.keys(p).find(x => KNOWN[x] === 'images')].maxItems ?? 1) : 0, quality: null, background: p.background?.enum.length ? p.background.enum : null }
  if (kind === 'video') return { ...m, role: needs('video') ? (/upscale/.test(name) ? 'upscale' : 'edit') : needs('audio') && needs('images') ? 'avatar' : 'generate',
    durations: durations.length ? durations : null, frames: ['first_frame', 'last_frame'].filter(f => fields[f]), references: fields.images ? +(p[Object.keys(p).find(x => KNOWN[x] === 'images')].maxItems ?? 1) : 0,
    videos: fields.video ? 1 : 0, audios: fields.audio ? 1 : 0, sound: !!fields.sound, follow: false, mix: false, upscale: fields.factor ? { factors: (p.upscale_factor?.enum ?? ['2']).map(Number) } : null }
  return fields.text ? { ...m, role: 'speech', voices: p.voice?.enum.length ? p.voice.enum : null } : null
}

// the models Kie lists that the hand list lacks, from its docs pages (each read once, then kept); its prices
async function fetchCatalog(hand, before) {
  const known = new Set(Object.values(hand).flat().flatMap(m => (typeof m.kie === 'string' ? [m.kie] : Object.values(m.kie ?? {}).map(v => v.model ?? v))))
  const paths = await fetch(`${base()}/api/v1/playground/model-paths`, { signal: AbortSignal.timeout(15e3) }).then(r => r.json()).then(j => j.data ?? [])
  const index = await fetch(`${docs()}/llms.txt`, { signal: AbortSignal.timeout(15e3) }).then(r => r.text())
  const pages = { ...before?.pages }
  const urls = [...new Set(index.match(/https?:\/\/[^\s)]+\.md/g) ?? [])].filter(u => !u.includes('/cn/') && /\/(market|veo3-api|runway-api)\//.test(u) && !/\/(chat|claude|codex|gemini|grok|deepseek|kimi|common)\//.test(u))
  // each page read once (again when kept before its title was: 2026-10-31)
  for (const u of urls.filter(u => !pages[u] || !('title' in pages[u]))) {
    const spec = await fetch(u, { signal: AbortSignal.timeout(15e3) }).then(r => (r.ok ? r.text() : '')).then(readSpec).catch(() => null)
    pages[u] = spec ?? { models: [], title: null }
  }
  const out = { image: [], video: [], speech: [], unwired: [] }
  for (const name of paths.filter(n => !known.has(n) && !n.startsWith('elevenlabs/'))) {
    const spec = Object.values(pages).find(s => s.models?.includes(name))
    if (!spec) continue
    const m = fromSpec(name, spec)
    if (!m) { if (['image', 'video', 'music', 'audio'].includes(spec.kind)) out.unwired.push(name); continue }
    out[m.role === 'speech' ? 'speech' : spec.kind === 'image' ? 'image' : 'video'].push(m)
  }
  return { at: new Date().toISOString(), pages, ...out }
}

let catalog = null, prices = null, pending = { prices: null, catalog: null }
const old = c => !c || Date.now() - Date.parse(c.checked ?? c.at) > DAY
// one of them read again when over a day old; a failed read keeps what was there and waits a day (this process),
// forced it says why
function freshen(name, force) {
  if (name === 'prices') prices ??= readCache('prices')
  else catalog ??= readCache('catalog')
  if (!force && !old(name === 'prices' ? prices : catalog)) return Promise.resolve()
  pending[name] ??= (name === 'prices' ? fetchPrices() : fetchCatalog(list(), catalog)).then(v => {
    if (name === 'prices') prices = writeCache('prices', v)
    else catalog = writeCache('catalog', v)
  }, e => {
    if (force) throw e
    if (name === 'prices') prices = { rows: {}, ...prices, checked: new Date().toISOString() }
    else catalog = { image: [], video: [], speech: [], unwired: [], ...catalog, checked: new Date().toISOString() }
  }).finally(() => { pending[name] = null })
  return pending[name]
}
// the prices before any list (7 short reads); the catalog reads a page of docs per new model (45 s the first time,
// 2026-10-31): the dashboard's server reads it behind (at its start, then once a day), a command only on --refresh
const serving = () => process.argv[2] === 'serve'

// the hand list's entry, or the catalog's, for a model id
function entry(kind, id) {
  const m = list()[kind]?.find(x => x.id === id) ?? catalog?.[kind]?.find(x => x.id === id)
  if (!m) throw new Error(`no ${kind} model ${id} on Kie: media.mjs models ${kind === 'speech' ? 'audio' : kind}`)
  return m
}
// the Kie model of a mode, and that mode's own constants: a missing mode falls back frames → refs → text
const FALLBACK = { frames: ['frames', 'refs', 'text'], refs: ['refs', 'text'], video: ['video'], avatar: ['avatar', 'refs', 'text'], text: ['text', 'refs'] }
function kieModel(m, mode) {
  if (typeof m.kie === 'string') return { model: m.kie, set: {} }
  const v = FALLBACK[mode].map(k => m.kie[k]).find(Boolean)
  if (!v) throw new Error(`${m.name} on Kie takes no ${mode === 'video' ? 'video' : mode === 'text' ? 'prompt alone' : mode}`)
  return typeof v === 'string' ? { model: v, set: {} } : { model: v.model, set: v.set ?? {} }
}
// the engine's values under the model's input keys: « key[] » takes a list, the rest one value, cast as it says
export function build(m, mode, vals) {
  const { model, set } = kieModel(m, mode), input = { ...m.set, ...set }
  for (const [name, v] of Object.entries(vals)) {
    const key = m.fields?.[name], rule = m.values?.[name]
    if (!key || v == null || v === '' || (Array.isArray(v) && !v.length)) continue
    const cast = x => (rule === 'string' ? String(x) : rule === 'number' ? +x : rule && typeof rule === 'object' ? (rule[x] ?? x) : x)
    if (key.endsWith('[]')) input[key.slice(0, -2)] = [...(input[key.slice(0, -2)] ?? []), ...[v].flat().map(cast)]
    else input[key] = cast([v].flat()[0])
  }
  // a model that wants each input named in its prompt (Kling 4.0's @image_1, HappyHorse's [Image 1]): the names the
  // prompt lacks added at its end
  const names = Object.entries(m.cite ?? {}).flatMap(([name, t]) => (m.fields?.[name] ? [vals[name]].flat().filter(Boolean).map((_, i) => t.replace('{n}', i + 1)) : []))
  const missing = names.filter(t => !String(input.prompt ?? '').includes(t))
  if (m.fields?.prompt && missing.length) input[m.fields.prompt] = `${input[m.fields.prompt] ?? ''} (${missing.join(', ')})`.trim()
  return { model, input }
}
const modeOf = (kind, m, has) => (kind === 'image' ? (has.images ? 'refs' : 'text')
  : has.video ? 'video' : m.role === 'avatar' ? 'avatar' : has.frames ? 'frames' : has.images ? 'refs' : 'text')

// ---------- prices: the price API's rows, picked by the request's settings ----------

// how much of a row this request is: seconds, images, characters or tokens (Gemini speech ≈ 25 audio tokens a
// second, 1.5 s + 14 characters a second: OpenRouter's measure, 2026-10-31)
function amountOf(row, desc, est, rule) {
  const chars = typeof est.text === 'string' ? est.text.length : est.text ?? 0
  // an edit priced before its video is chosen: 5 s, like a new shot; a model whose length isn't asked: Kie's default,
  // said by its rule (Grok's 6 s)
  if (/second/.test(row.unit)) return (est.duration ?? est.source_duration ?? rule.seconds ?? 5) + (rule.in && est.input === 'video' ? est.source_duration ?? 0 : 0)
  // an input image's row (Qwen Image 3.0's) counts the images sent
  if (/image/.test(row.unit)) return /, input,/.test(desc) ? est.refs ?? est.images ?? 1 : est.n ?? 1
  if (/1000 char/.test(row.unit)) return chars / 1000
  if (/million tokens/.test(row.unit)) return (/input/i.test(desc) ? chars / 4 : 25 * (1.5 + chars / 14)) / 1e6
  return 1
}
export function estimateKie(kind, m, est, rows = prices?.rows ?? {}) {
  if (!m.pricing?.length) return { amount: null, unit: 'usd', known: false, detail: CATALOG_PRICES.none[m.model] ?? (m.new ? 'new on Kie: its price is not in the list yet' : 'no price on Kie\'s list') }
  const mode = modeOf(kind, m, { images: (est.refs ?? est.images ?? 0) > 0, video: est.input === 'video', frames: est.input === 'image' })
  const ctx = { ...est, mode, input: mode === 'video' ? 'video' : mode === 'text' ? 'text' : 'image' }
  const rule = m.pricing.find(r => Object.entries(r.when ?? {}).every(([k, v]) => String(ctx[k]) === String(v)))
  const descs = [rule?.row].flat().filter(Boolean)
  if (!rule || descs.some(d => !rows[d])) return { amount: null, unit: 'usd', known: false, detail: rule ? 'Kie\'s price list not read yet' : 'no price for these settings' }
  let usd = 0, credits = 0
  const parts = descs.map(d => {
    const r = rows[d], q = amountOf(r, d, ctx, rule)
    usd += r.usd * q
    credits += r.credits * q
    return /second/.test(r.unit) ? `${r.credits} credits/s × ${+q.toFixed(2)} s` : /image/.test(r.unit) ? `${r.credits} credits × ${q}` : `${r.credits} credits ${r.unit}`
  })
  return { amount: Math.round(usd * 1e4) / 1e4, unit: 'usd', known: true, credits: Math.round(credits * 100) / 100, detail: `${parts.join(' + ')} = ${Math.round(credits * 100) / 100} credits` }
}

// ---------- the tasks ----------

// Kling 4.0's element tag by the Library's type
const TAGS = { character: 'character', outfit: 'costume', object: 'prop', brand: 'prop', location: 'scene', pose: 'others', other: 'others' }
const STATUS = { waiting: 'pending', queuing: 'pending', generating: 'in_progress', success: 'completed', fail: 'failed' }
async function status(id) {
  const d = (await get(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(id)}`)).data
  const result = (() => { try { return d.resultJson ? JSON.parse(d.resultJson) : d.response ?? {} } catch { return {} } })()
  // the last frame, when asked (return_last_frame)
  return { status: STATUS[d.state] ?? d.state, urls: result.resultUrls ?? [], extra: result.lastFrameUrl ? { 'last-frame': result.lastFrameUrl } : {}, cost: d.creditsConsumed != null ? Math.round(d.creditsConsumed * USD * 1e4) / 1e4 : null,
    credits: d.creditsConsumed ?? null, error: d.state === 'fail' ? `${d.failMsg || 'the generation failed'}${d.failCode ? ` (${d.failCode})` : ''}` : null }
}
// an image or a voice: its task followed here till its files
async function finish(id, progress) {
  for (;;) {
    const s = await status(id)
    if (s.status === 'completed') return s
    if (s.status === 'failed') throw new Error(s.error)
    progress?.(`${s.status === 'pending' ? 'queued' : 'generating'} on Kie (${id})`)
    await sleep(POLL())
  }
}
const download = async url => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Kie's file ${url}: ${r.status}`)
  return Buffer.from(await r.arrayBuffer())
}
const extOf = url => path.extname(new URL(url).pathname).slice(1).toLowerCase()

// a model's options into its input, by the names its docs give them: a palette as its shares, a file uploaded, a list
// of one when it takes a list; loop is Grok's (its first frame as loop_url), handled with the frames
async function withOptions(m, input, options = {}) {
  const list = resolveOptions(m.options)
  for (const [k, v] of Object.entries(options)) {
    const o = list.find(x => x.key === k)
    if (!o || k === 'loop') continue
    const value = o.transform === 'palette' ? palette(v) : o.type === 'file' ? await upload(v) : v
    input[k] = o.wrap ? [value] : value
  }
  return input
}

export default {
  id: 'kie',
  label: 'Kie.ai',
  unit: 'usd',
  key: () => !!process.env.KIE_API_KEY,
  // the files go by Kie's upload, not by a tunnel
  upload,

  async refresh() {
    const before = new Set(['image', 'video', 'speech'].flatMap(k => (catalog ?? readCache('catalog'))?.[k]?.map(m => m.id) ?? []))
    await Promise.all([freshen('prices', true), freshen('catalog', true)])
    const added = Object.fromEntries(['image', 'video', 'speech'].map(k => [k, catalog[k].map(m => ({ id: `kie:${m.id}`, name: m.name, found: !before.has(m.id) }))]))
    return { at: catalog.at, added, unwired: catalog.unwired ?? [], prices: Object.keys(prices?.rows ?? {}).length }
  },
  catalogInfo() {
    const c = catalog ?? readCache('catalog'), p = prices ?? readCache('prices')
    return { at: c?.at ?? null, added: c ? c.image.length + c.video.length + c.speech.length : 0, prices_at: p?.at ?? null }
  },

  async models(kind) {
    await freshen('prices')
    catalog ??= readCache('catalog')
    if (serving()) freshen('catalog').catch(() => {})
    const hand = list()[kind]
    if (!hand) throw new Error(`no ${kind} models on Kie`)
    const ids = new Set(hand.map(m => m.id))
    return [...hand, ...(catalog?.[kind] ?? []).filter(m => !ids.has(m.id))].map(m => ({
      ...(m.new ? { new: true, from: null } : {}), ...(m.note ? { note: m.note } : {}),
      model: m.id, name: `${m.lab}: ${m.name}`, lab: m.lab, kind, role: m.role,
      params: kind === 'image'
        ? { resolution: m.resolutions, aspect_ratio: m.aspect_ratios, n: { min: 1, max: m.max_images ?? 1 }, references: m.references ?? 0, seed: !!m.seed, quality: m.quality ?? null, background: m.background ?? null, options: resolveOptions(m.options) }
        : kind === 'video'
          ? { resolution: m.resolutions, aspect_ratio: m.aspect_ratios, duration: m.durations, frames: m.frames ?? [], references: m.references ?? null, audio: !!m.sound, seed: !!m.seed,
            creativity: false, factor: !!m.upscale, factors: m.upscale?.factors ?? null, min_pixels: null, mix: !!m.mix, follow: !!m.follow, videos: m.videos ?? 0, audios: m.audios ?? 0,
            // Kling's named elements: how many, and whether they go with a frame
            elements: m.elements?.max ?? 0, elements_with_frames: m.elements?.frames !== false,
            // its editors: Kling's shots, middle frames (Grok's at their times), OmniHuman's masks of who speaks, Kling
            // 4.0's voices of the Library, Seedance 2.5's draft then its final
            shots: m.shots ?? null, mid_frames: m.mid_frames ?? null, masks: m.masks?.max ?? 0, named_voices: m.named_voices?.max ?? 0, draft: !!m.draft,
            options: resolveOptions(m.options) }
          : { voices: m.voices ?? null, clone: false, dialogue: m.dialogue === 'gemini', speakers: m.dialogue === 'gemini' ? 2 : 0, options: resolveOptions(m.options) },
      pricing: m.price?.length ? m.price : CATALOG_PRICES.models[m.id] ?? [],
    }))
  },

  estimate: (kind, m, req) => estimateKie(kind, m, req),

  async image({ model, prompt, refs = [], n, resolution, aspect_ratio, quality, background, seed, options }, { progress } = {}) {
    const m = entry('image', model), images = await Promise.all(refs.map(upload))
    const { model: name, input } = build(m, modeOf('image', m, { images: images.length }), { prompt, images, resolution, aspect_ratio, quality, background, seed, n: n > 1 ? n : undefined })
    const s = await finish(await create(name, await withOptions(m, input, options), progress), progress)
    return { files: await Promise.all(s.urls.map(async u => ({ data: await download(u), type: `image/${extOf(u).replace('jpg', 'jpeg') || 'png'}` }))), cost: s.cost }
  },

  // refs: images as data: URLs, videos and voices as files; all uploaded first
  async video({ model, prompt, frames = {}, refs = [], elements = [], duration, resolution, aspect_ratio, generate_audio, seed, upscale_factor, options = {}, shots, mid_frames = [], masks = [], voices = [], draft_of }, { progress } = {}) {
    const m = entry('video', model)
    // Seedance 2.5's final, from its draft: the draft's task and the final's resolution, nothing else
    if (draft_of) return { id: await create(m.draft.model, await withOptions(m, { draft_task_id: draft_of, resolution: m.draft.resolution }, Object.fromEntries(Object.entries(options).filter(([k]) => ['output_format', 'return_last_frame'].includes(k)))), progress) }
    const up = r => upload(r.url ?? r.file), of = kind => Promise.all(refs.filter(r => r.kind === kind).map(up))
    const [images, video, audio] = await Promise.all([of('image'), of('video'), of('audio')])
    let first_frame = frames.first_frame && await upload(frames.first_frame), last_frame = frames.last_frame && await upload(frames.last_frame)
    // Grok's loop: its first frame starts and ends the video, sent as loop_url alone
    const loop = options.loop && first_frame
    if (loop) [first_frame, last_frame] = [undefined, undefined]
    // middle frames go to the keyframe mode (Kling 4.0's keyframe-to-video), first frame or not
    const mode = modeOf('video', m, { video: video.length, frames: frames.first_frame || frames.last_frame || (m.mid_frames && mid_frames.length), images: images.length })
    const { model: name, input } = build(m, mode, { prompt, first_frame, last_frame, images, video, audio, duration, resolution, aspect_ratio, sound: generate_audio, seed, factor: upscale_factor })
    if (loop) input.loop_url = await upload(frames.first_frame)
    // the cited Elements, each whole: its name in the prompt, its words, its 2 to 4 images (Kling 4.0 a tag too)
    const el = m.elements
    if (el && elements.length) input[el.key] = await Promise.all(elements.map(async e => ({ name: e.name, description: (e.words || e.name).slice(0, 100),
      [el.images]: await Promise.all(e.files.map(upload)), ...(el.tag ? { tag: TAGS[e.type] ?? 'others' } : {}) })))
    // Kling's shots: each its words and seconds, the length their sum
    if (m.shots && shots?.length) Object.assign(input, { [m.shots.flag]: true, [m.shots.key]: shots.map(x => ({ prompt: x.prompt, duration: x.duration })) })
    // the middle frames, in order (Kling 4.0, cited @keyframe_n) or each at its time (Grok)
    if (m.mid_frames && mid_frames.length) {
      const urls = await Promise.all(mid_frames.map(f => upload(f.url ?? f.file)))
      input[m.mid_frames.key] = m.mid_frames.timed ? urls.map((url, i) => ({ url, timestamp_s: Math.round(mid_frames[i].at) })) : urls
      // each cited in the prompt when the model wants it (@keyframe_1…), added at its end when it lacks one
      const cites = m.mid_frames.cite ? urls.map((_, i) => m.mid_frames.cite.replace('{n}', i + 1)).filter(t => !String(input.prompt ?? '').includes(t)) : []
      if (cites.length) input.prompt = `${input.prompt ?? ''} (${cites.join(', ')})`.trim()
    }
    // OmniHuman's masks: who in the photo speaks
    if (m.masks && masks.length) input[m.masks.key] = await Promise.all(masks.map(upload))
    // Kling 4.0's voices of the Library, cited @name
    if (m.named_voices && voices.length) input[m.named_voices.key] = await Promise.all(voices.map(async v => ({ name: v.name, audio_url: await upload(v.file) })))
    return { id: await create(name, await withOptions(m, input, options), progress) }
  },
  poll: job => status(job.id),
  download,

  async speech({ model, text, voice, refs = [], instructions, dialogue, options }, { progress } = {}) {
    const m = entry('speech', model)
    // Gemini's clone on Kie also wants the person's recorded consent: not offered
    if (refs.length) throw Object.assign(new Error(`${m.name} on Kie clones no voice: pick a preset voice, or switch the router to OpenRouter in Settings`), { status: 400 })
    // Gemini: one speaker or two, a voice each, its turns in order, « how it sounds » as each turn's style
    const lines = dialogue?.length ? dialogue : [{ voice, text }], speakers = [...new Set(lines.map(l => l.voice ?? ''))]
    const id = v => `Speaker ${speakers.indexOf(v ?? '') + 1}`
    const { model: name, input } = m.dialogue === 'gemini'
      ? { model: kieModel(m, 'text').model, input: { ...m.set, speakers: speakers.map(v => ({ speaker_id: id(v), ...(v ? { voice_name: v } : {}) })),
        dialogue_turns: lines.map(l => ({ speaker_id: id(l.voice), text: l.text, ...(instructions ? { style: instructions } : {}) })) } }
      : build(m, 'text', { text, voice })
    await withOptions(m, input, options)
    const s = await finish(await create(name, input, progress), progress)
    return { data: await download(s.urls[0]), format: extOf(s.urls[0]) || 'mp3', cost: s.cost }
  },

  async balance() {
    const credits = (await get('/api/v1/chat/credit')).data
    return { unit: 'usd', credits, account_left: Math.round(credits * USD * 100) / 100, key_left: null, key_limit: null, month: null }
  },
}
