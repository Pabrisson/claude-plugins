#!/usr/bin/env node
// media-generator CLI and the dashboard's server. Images, videos and speech through the model routers of providers/,
// voice changes and dubbing through ElevenLabs by video-editor's engine. Everything lives in the folder Claude Code
// runs in ($MEDIA_GENERATOR_DIR overrides it): media/ (one folder per generation), elements/ (the @ references),
// ledger.jsonl (what was spent), settings.json (thresholds, caps, defaults), .cache/ (catalogs, uploads, drafts)
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { appendLedger, money, needsYes, PLANS, readLedger, spentThisMonth } from './lib/cost.js'
import { PROVIDERS, routerOf } from './providers/index.js'

const SELF = fileURLToPath(import.meta.url), ENGINE = path.dirname(SELF)
// the code this process runs: a server started from an older media.mjs gets replaced
const LOADED = fs.statSync(SELF).mtimeMs
const HOME = path.resolve(process.env.MEDIA_GENERATOR_DIR ?? process.cwd())
const PORT = +(process.env.MEDIA_GENERATOR_PORT ?? 41287)
const STUDIO = path.join(ENGINE, 'studio/dist')
const VIDEO = path.join(ENGINE, '../../video-editor/engine/video.mjs')
const KINDS = ['image', 'video', 'audio']

const { values: opt, positionals: [cmd, ...args] } = parseArgs({
  allowPositionals: true,
  options: {
    tool: { type: 'string', short: 't' }, model: { type: 'string', short: 'm' }, prompt: { type: 'string' }, raw: { type: 'boolean' },
    in: { type: 'string', multiple: true }, field: { type: 'string', multiple: true },
    n: { type: 'string' }, duration: { type: 'string' }, ratio: { type: 'string' }, resolution: { type: 'string' },
    quality: { type: 'string' }, sound: { type: 'string' }, seed: { type: 'string' }, voice: { type: 'string' },
    spend: { type: 'string' }, 'accept-unknown': { type: 'boolean' }, force: { type: 'boolean' }, estimate: { type: 'boolean' },
    search: { type: 'string' }, json: { type: 'boolean' }, open: { type: 'boolean' }, space: { type: 'string' },
  },
})

// exit codes: 1 an error, 2 the user's yes is needed (the estimate is printed), 3 no key or no credits left
const die = (msg, code = 1) => { console.error(`error: ${msg}`); process.exit(code) }
const userError = (msg, code = 1) => Object.assign(new Error(msg), { code })
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'))
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n') }
const num = x => (x === undefined || x === '' || x === null ? undefined : Number(x))
const clean = o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''))
const sleep = t => new Promise(ok => setTimeout(ok, t))
const at = (...p) => path.join(HOME, ...p)
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', flac: 'audio/flac',
  ogg: 'audio/ogg', vtt: 'text/vtt', srt: 'text/plain', json: 'application/json', html: 'text/html', js: 'text/javascript', css: 'text/css', woff2: 'font/woff2' }
const mimeOf = f => MIME[path.extname(f).slice(1).toLowerCase()] ?? 'application/octet-stream'
const kindOfFile = f => mimeOf(f).split('/')[0]

// a local file as a data: URL, which the routers accept in place of a public one
// ponytail: inline up to 50 MB; OpenRouter's files API when larger sources matter
function dataUrl(file) {
  const size = fs.statSync(file).size
  if (size > 50e6) throw userError(`${path.basename(file)} is ${Math.round(size / 1e6)} MB: trim it under 50 MB first`)
  return `data:${mimeOf(file)};base64,${fs.readFileSync(file).toString('base64')}`
}
// a video or a voice for the router, which takes them by HTTPS only (a data: URL is refused): served from here at a
// random path through a Cloudflare quick tunnel (no account), opened for one job and closed with it. Its name answers
// on the public DNS some 15 s after cloudflared registers: the job waits for it, the Mac's resolver is not asked
// before (it would cache the miss)
async function tunnel(files) {
  const token = randomBytes(16).toString('hex'), names = files.map((f, i) => `${i + 1}${path.extname(f).toLowerCase()}`)
  const server = http.createServer((req, res) => {
    const i = names.findIndex(n => new URL(req.url, 'http://x').pathname === `/${token}/${n}`)
    return i >= 0 ? sendFile(req, res, files[i]) : reply(res, 404, { error: 'not found' })
  })
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const cf = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${server.address().port}`], { stdio: ['ignore', 'ignore', 'pipe'] })
  const close = () => { cf.kill(); server.close(); server.closeAllConnections() }
  process.once('exit', close)
  try {
    const base = await new Promise((ok, ko) => {
      let log = ''
      const t = setTimeout(() => ko(new Error('the Cloudflare tunnel did not open in 60 s')), 60e3)
      cf.on('error', ko)
      cf.on('exit', code => ko(new Error(`cloudflared stopped (${code}): ${log.trim().split('\n').pop()}`)))
      cf.stderr.on('data', d => {
        log += d
        const url = log.match(/https:\/\/[\w-]+\.trycloudflare\.com/)?.[0]
        if (url && /Registered tunnel connection/.test(log)) { clearTimeout(t); ok(url) }
      })
    })
    const host = new URL(base).host, resolvers = (process.env.MEDIA_GENERATOR_DOH ?? 'https://cloudflare-dns.com/dns-query,https://dns.google/resolve').split(',')
    const resolves = r => fetch(`${r}?name=${host}&type=A`, { headers: { accept: 'application/dns-json' } }).then(x => x.json()).then(j => j.Status === 0 && j.Answer?.length > 0, () => false)
    for (let i = 0; !(await Promise.all(resolvers.map(resolves))).every(Boolean); i++) {
      if (i >= 90) throw new Error(`the tunnel's name ${host} did not resolve in 90 s`)
      await sleep(1000)
    }
    return { urls: names.map(n => `${base}/${token}/${n}`), close }
  } catch (e) { close(); throw e }
}

function probe(file) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file], { encoding: 'utf8' }))
  const v = j.streams.find(s => s.codec_type === 'video')
  return { duration: +(+j.format.duration || 0).toFixed(2), width: v?.width ?? null, height: v?.height ?? null, audio: j.streams.some(s => s.codec_type === 'audio') }
}
const ffmpeg = argv => execFileSync('ffmpeg', ['-y', '-v', 'error', ...argv], { stdio: ['ignore', 'ignore', 'pipe'] })

// ---------- the folder: settings, .gitignore, tools, catalogs ----------

// thresholds and caps in each provider's unit, all unset until the user sets them (Settings, or setup set)
const SETTINGS = {
  openrouter: { threshold: null, cap: null },
  elevenlabs: { threshold: null, cap: null, plan: null },
  defaults: { image: null, video: null, audio: null },
}
const settings = () => {
  const s = fs.existsSync(at('settings.json')) ? readJson(at('settings.json')) : {}
  return Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, { ...v, ...s[k] }]))
}
// the USD price of 1,000 ElevenLabs credits on the user's plan, null without a paid one
const per1000 = () => PLANS[settings().elevenlabs.plan] || null

// git keeps what the user made and cannot make again (media, elements, the ledger, the settings), not the cache
const IGNORE = '# media-generator: the cache is remade, the media, elements, ledger and settings stay\n.cache/\n.trash/\n'
function ensureHome() {
  for (const d of ['media', 'elements', '.cache']) fs.mkdirSync(at(d), { recursive: true })
  const gi = at('.gitignore'), now = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : ''
  if (!now.includes('# media-generator')) fs.writeFileSync(gi, now + (now && !now.endsWith('\n') ? '\n' : '') + (now ? '\n' : '') + IGNORE)
}

const TOOLS = Object.fromEntries(KINDS.map(k => [k, JSON.parse(fs.readFileSync(path.join(ENGINE, `tools/${k}.json`), 'utf8'))]))
function toolOf(kind, id) {
  if (!KINDS.includes(kind)) throw userError(`the kinds are ${KINDS.join(', ')}`)
  const t = TOOLS[kind].find(x => x.id === id)
  if (!t) throw userError(`no ${kind} tool ${id}: media.mjs tools ${kind}`)
  return t
}
// the router's kind for a tool kind: audio is speech
const routerKind = kind => (kind === 'audio' ? 'speech' : kind)

// every router's models of a kind, their ids prefixed with the router: lists kept by hand, nothing is fetched
async function models(kind) {
  const all = []
  for (const [name, p] of Object.entries(PROVIDERS)) for (const m of await p.models(routerKind(kind))) all.push({ ...m, id: `${name}:${m.model}`, provider: name })
  return all
}
async function modelOf(kind, id) {
  const { name, model } = routerOf(id), m = (await models(kind)).find(x => x.provider === name && x.model === model)
  if (!m) throw userError(`no ${kind} model ${id}: media.mjs models ${kind}`)
  return m
}

// ---------- a request: the tool's prompt, its inputs, the model's settings ----------

// the tool's template with its fields and the user's words; raw takes the prompt as written (edited in the dashboard)
function fill(tool, spec) {
  if (spec.raw) return String(spec.prompt ?? '').trim()
  let text = tool.template || '{prompt}'
  for (const f of tool.fields) text = text.replaceAll(`{${f.key}}`, String(spec.fields?.[f.key] ?? f.default ?? ''))
  return text.replaceAll('{prompt}', spec.prompt ?? '').replace(/\s+/g, ' ').replace(/\s+([.,:;)])/g, '$1').replace(/,\./g, '.').replace(/([.:])\s*\./g, '$1')
    .replace(/\(\s*\)/g, '').replace(/^[\s.,:;]+|[\s,:;]+$/g, '').trim()
}

// the Elements an @name of the prompt cites: their images join the references, the name stays in the words
function mentions(text) {
  const refs = []
  const out = text.replace(/@([\w-]+)/g, (all, name) => {
    const d = at('elements', name)
    if (!fs.existsSync(d)) return all
    refs.push(...fs.readdirSync(d).filter(f => kindOfFile(f) === 'image').sort().map(f => path.join(d, f)))
    return name
  })
  return { text: out, refs }
}

// the first value of a list the model accepts, preferring the wanted ones in order
const pick = (list, ...wanted) => (list?.length ? wanted.find(w => w !== undefined && list.includes(w)) ?? list[0] : undefined)

// the model's ratio closest to an image's (a first frame, an avatar's photo)
function ratioOf(list, file) {
  const s = probe(file), gap = x => { const [a, b] = x.split(':'); return Math.abs(Math.log(a / b / (s.width / s.height))) }
  return (list ?? []).filter(x => /^\d+:\d+$/.test(x)).sort((x, y) => gap(x) - gap(y))[0]
}

// what to send and what to estimate, for a router model
function routerRequest(kind, tool, spec, m, prompt, refsFromMentions) {
  const files = key => spec.inputs?.[key] ?? []
  const p = { ...tool.params, ...spec.params }
  if (kind === 'image') {
    const refs = [...tool.inputs.flatMap(i => files(i.key)), ...refsFromMentions]
    const params = clean({
      n: m.params.n ? Math.min(Math.max(+p.n || 1, m.params.n.min ?? 1), m.params.n.max ?? 1) : undefined,
      resolution: pick(m.params.resolution, p.resolution, '2K', '1K'),
      // an edit keeps its image's ratio unless one is asked
      aspect_ratio: p.aspect_ratio ? pick(m.params.aspect_ratio, p.aspect_ratio) : refs.length ? undefined : pick(m.params.aspect_ratio, '1:1'),
      quality: pick(m.params.quality, p.quality, 'high'), background: p.background ? pick(m.params.background, p.background) : undefined, seed: m.params.seed ? p.seed : undefined,
    })
    if (refs.length > (m.params.references ?? 0)) throw userError(`${m.name} takes ${m.params.references ?? 0} reference images, this asks for ${refs.length}`)
    const size = f => { try { const s = probe(f); return [s.width, s.height] } catch { return [] } }
    return { send: { model: m.model, prompt, refs: refs.map(dataUrl), ...params }, estimate: { n: params.n, resolution: params.resolution, quality: params.quality, refs: refs.length, sizes: refs.map(size) } }
  }
  if (kind === 'video') {
    const video = files('video')[0], source = video ? probe(video) : null, avatar = m.role === 'avatar'
    // an avatar takes its photo as a reference, not as a frame
    const frames = clean({ first_frame: avatar ? undefined : files('first_frame')[0], last_frame: files('last_frame')[0] })
    for (const f of Object.keys(frames)) if (!m.params.frames.includes(f)) throw userError(`${m.name} takes no ${f.replace('_', ' ')}: pick another model`)
    const images = [...(avatar ? files('first_frame') : []), ...files('references'), ...files('sketch'), ...refsFromMentions]
    const refs = [...images.map(f => ({ kind: 'image', file: f })), ...(video ? [{ kind: 'video', file: video }] : []), ...files('audio').map(f => ({ kind: 'audio', file: f }))]
    if (refs.some(r => r.kind !== 'image') && spawnSync('cloudflared', ['--version'], { stdio: 'ignore' }).error) throw userError('a video or a voice reaches OpenRouter through a Cloudflare tunnel: brew install cloudflared (no account)')
    const upscale = m.role === 'upscale', edit = !!video, still = files('first_frame')[0] ?? files('last_frame')[0]
    const params = clean({
      duration: edit ? undefined : pick(m.params.duration, num(p.duration), 5),
      resolution: upscale ? undefined : pick(m.params.resolution, p.resolution, '1080p', '720p'),
      // from an image, its own ratio unless one is asked
      aspect_ratio: edit ? undefined : pick(m.params.aspect_ratio, p.aspect_ratio ?? (still && ratioOf(m.params.aspect_ratio, still)), '16:9'),
      generate_audio: m.params.audio ? p.sound !== false : undefined, seed: m.params.seed ? p.seed : undefined,
      creativity: upscale && m.params.creativity ? (spec.fields?.creativity === 'creative' ? 1 : 0) : undefined,
      upscale_factor: upscale && m.params.factor ? +(spec.fields?.factor ?? 2) : undefined,
    })
    const send = { model: m.model, prompt: upscale && !prompt ? undefined : prompt, frames: Object.fromEntries(Object.entries(frames).map(([k, f]) => [k, dataUrl(f)])),
      // the images inlined, the videos and voices served by a tunnel when the job is submitted
      refs: refs.map(r => (r.kind === 'image' ? { kind: r.kind, url: dataUrl(r.file) } : r)), ...params }
    // a model without durations (an avatar) lasts as long as its voice
    const voice = files('audio')[0]
    return { send, estimate: { duration: source?.duration ?? params.duration ?? (voice ? probe(voice).duration : undefined), resolution: params.resolution ?? `${Math.min(source?.width ?? 1920, source?.height ?? 1080)}p`,
      ratio: params.aspect_ratio, sound: params.generate_audio, input: video ? 'video' : Object.keys(frames).length ? 'image' : 'text',
      images: images.length + Object.keys(frames).length, creativity: spec.fields?.creativity, factor: spec.fields?.factor, width: source?.width, height: source?.height } }
  }
  // speech: a preset voice, or up to 3 clips to clone
  const clips = files('voice_clips')
  if (!prompt) throw userError('write what the voice says (--prompt)')
  const voice = p.voice ?? (clips.length ? undefined : m.params.voices?.[0])
  return { send: { model: m.model, text: prompt, voice, instructions: spec.fields?.instructions || undefined, refs: clips.map(dataUrl) }, estimate: { text: prompt } }
}

// ElevenLabs' estimate from video.mjs (the one place its rates live): credits
function elevenArgs(tool, spec) {
  const clip = spec.inputs?.clip?.[0]
  if (!clip) throw userError(`${tool.label} needs a clip (--in clip=<file>)`)
  if (tool.id === 'change-voice') {
    const voice = spec.params?.voice ?? spec.fields?.voice
    if (!voice) throw userError('pick the new voice (--voice <voice_id>, video.mjs voices lists them)')
    return ['voice-change', clip, '--voice', voice, ...(spec.fields?.denoise === 'remove' ? ['--denoise'] : [])]
  }
  const to = String(spec.fields?.to ?? '').split(/[,\s]+/).filter(Boolean)
  if (!to.length) throw userError('say which languages to dub into (--field to=en,es)')
  return ['dub', clip, '--to', to.join(','), '--model', spec.fields?.quality ?? 'dubbing_v1']
}
function videoMjs(argv) {
  if (!fs.existsSync(VIDEO)) throw userError(`video-editor's engine is missing (${VIDEO})`)
  const r = spawnSync(process.execPath, [VIDEO, ...argv], { encoding: 'utf8', cwd: fs.existsSync(HOME) ? HOME : undefined, maxBuffer: 64e6, env: process.env })
  if (r.error) throw r.error
  return r
}
function elevenEstimate(argv) {
  const r = videoMjs([...argv, '--estimate'])
  if (r.status !== 0) throw userError((r.stderr || r.stdout).trim().replace(/^error: /, ''))
  const j = JSON.parse(r.stdout.trim().split('\n').pop())
  return { amount: j.credits, unit: 'credits', known: true, detail: j.detail }
}

// everything about a generation before it runs: the prompt, the model, the request, its estimate
// probe: a price for the tool picker before its inputs and words are there (never run)
async function plan(spec) {
  const tool = toolOf(spec.kind, spec.tool), probing = !!spec.probe
  // the fields left out take their defaults (upscale's creativity, extend's direction…)
  spec = { ...spec, fields: { ...Object.fromEntries(tool.fields.filter(f => f.default !== undefined).map(f => [f.key, String(f.default)])), ...spec.fields } }
  if (!probing) for (const i of tool.inputs) if (!i.optional && !spec.inputs?.[i.key]?.length) throw userError(`${tool.label} needs ${i.label.toLowerCase()} (--in ${i.key}=<file>)`)
  for (const f of Object.values(spec.inputs ?? {}).flat()) if (!fs.existsSync(f)) throw userError(`no such file: ${f}`)
  const { text: prompt, refs } = mentions(fill(tool, spec))
  if (tool.local === 'reframe') return { tool, prompt: '', provider: 'local', model: 'ffmpeg', estimate: { amount: 0, unit: 'usd', known: true, detail: 'local, free' } }
  if (tool.provider === 'elevenlabs') {
    if (probing && !spec.inputs?.clip?.length) return { tool, prompt: '', provider: 'elevenlabs', model: tool.id, estimate: { amount: null, unit: 'credits', known: false, detail: 'per minute of the clip' } }
    const argv = elevenArgs(tool, spec)
    return { tool, prompt: '', provider: 'elevenlabs', model: argv[0] === 'dub' ? argv[argv.indexOf('--model') + 1] : 'eleven_multilingual_sts_v2', argv, estimate: elevenEstimate(argv) }
  }
  if (!prompt && !probing && !['upscale'].includes(tool.id)) throw userError('write a prompt (--prompt "…"), or fill the tool\'s fields (--field key=value)')
  const id = spec.model ?? tool.models?.find(Boolean) ?? settings().defaults[spec.kind]
  const m = id ? await modelOf(spec.kind, id.includes(':') ? id : `openrouter:${id}`) : (await models(spec.kind)).find(x => x.role !== 'edit' && x.role !== 'upscale' && x.role !== 'avatar')
  let request
  // extend: the source's last frame starts the new shot (sequel), or its first frame ends it (prequel)
  if (tool.local === 'extend' && spec.inputs?.video?.length) {
    const prequel = spec.fields?.direction === 'prequel', frame = at('.cache', `frame-${Date.now()}.png`), src = spec.inputs.video[0]
    ffmpeg([...(prequel ? [] : ['-sseof', '-0.1']), '-i', src, '-frames:v', '1', '-update', '1', frame])
    const key = prequel ? 'last_frame' : 'first_frame'
    if (!m.params.frames.includes(key)) throw userError(`${m.name} cannot ${prequel ? 'end on' : 'start from'} a frame: pick another model`)
    request = routerRequest('video', { ...tool, inputs: [] }, { ...spec, inputs: { [key]: [frame] } }, m, prompt, refs)
  } else request = routerRequest(spec.kind, tool.local === 'extend' ? { ...tool, inputs: [] } : tool, spec, m, prompt, refs)
  const { provider } = routerOf(m.id)
  return { tool, prompt, provider: m.provider, model: m.model, name: m.name, request, estimate: provider.estimate(routerKind(spec.kind), m, request.estimate) }
}

// whether this spend may go: the CLI needs --spend (Claude asked the user), the dashboard's click is the yes unless
// a threshold or the cap says otherwise. Throws a code-2 error with the estimate
function gate(p, { spend, acceptUnknown, force, confirm, by }) {
  if (p.provider === 'local') return
  const s = settings()[p.provider] ?? {}, spent = spentThisMonth(readLedger(HOME), p.provider)
  const why = needsYes(p.estimate, s, spent), shown = money(p.estimate.amount, p.estimate.unit, per1000())
  const stop = reason => Object.assign(userError(`${reason}: ${shown} (${p.estimate.detail})`, 2), { estimate: p.estimate, shown, reason })
  if (by === 'dashboard') { if (why && !confirm) throw stop(why); return }
  if (why === 'unknown' && !acceptUnknown) throw stop('unknown cost, the user\'s yes then --accept-unknown')
  if (why === 'cap' && !force) throw stop(`over this month's cap (${p.provider}: ${spent} spent of ${s.cap}), only with the user's explicit yes then --force`)
  if (p.estimate.known && !(spend >= p.estimate.amount * 0.999)) throw stop(`the user's yes first, then --spend ${p.estimate.amount}`)
}

// ---------- a generation: its folder, its run, its ledger line ----------

const mediaDir = id => at('media', id)
const readJob = id => readJson(path.join(mediaDir(id), 'job.json'))
const saveJob = job => writeJson(path.join(mediaDir(job.id), 'job.json'), job)
const alive = pid => { try { return !!pid && (process.kill(pid, 0), true) } catch (e) { return e.code === 'EPERM' } }
const newId = tool => `${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}-${tool}-${randomBytes(2).toString('hex')}`

async function create(spec, gateOpts) {
  ensureHome()
  const p = await plan(spec)
  gate(p, gateOpts)
  const id = newId(p.tool.id), dir = mediaDir(id)
  fs.mkdirSync(dir, { recursive: true })
  // the inputs are copied in: a remix works after the originals moved
  const inputs = {}
  for (const [key, list] of Object.entries(spec.inputs ?? {})) inputs[key] = list.map((f, i) => {
    const name = `in-${key}-${i + 1}${path.extname(f).toLowerCase()}`
    fs.copyFileSync(f, path.join(dir, name))
    return name
  })
  const job = { id, kind: spec.kind, tool: p.tool.id, label: p.tool.label, provider: p.provider, model: p.model, name: p.name ?? p.model, prompt: p.prompt, spec: { ...spec, inputs },
    estimate: p.estimate, actual: null, status: 'queued', by: gateOpts.by, created: new Date().toISOString(), outputs: [] }
  saveJob(job)
  // what run needs and the folder does not keep: the request (data: URLs) and video.mjs's arguments
  writeJson(at('.cache', 'requests', `${id}.json`), { request: p.request?.send ?? null, argv: p.argv ?? null })
  return job
}

const progress = (job, note) => { job.note = note; saveJob(job); if (!process.env.MEDIA_GENERATOR_QUIET) console.log(note) }

async function run(id) {
  const dir = mediaDir(id), job = readJob(id), reqFile = at('.cache', 'requests', `${id}.json`)
  const { request, argv } = fs.existsSync(reqFile) ? readJson(reqFile) : {}
  Object.assign(job, { status: 'running', pid: process.pid, started: job.started ?? new Date().toISOString() })
  saveJob(job)
  try {
    if (job.provider === 'local') runReframe(dir, job)
    else if (job.provider === 'elevenlabs') runEleven(dir, job, argv)
    else await runRouter(dir, job, request)
    Object.assign(job, { status: 'done', note: null, finished: new Date().toISOString() })
  } catch (e) {
    Object.assign(job, { status: 'failed', error: e.message, note: null, finished: new Date().toISOString() })
  }
  if (job.provider !== 'local') {
    job.actual ??= job.status === 'failed' ? 0 : job.estimate.amount
    appendLedger(HOME, { id, kind: job.kind, tool: job.tool, label: job.label, provider: job.provider, model: job.model, unit: job.estimate.unit,
      estimate: job.estimate.amount, actual: job.actual, actual_known: job.actual_known ?? false, status: job.status, by: job.by,
      ...(job.estimate.unit === 'credits' && per1000() ? { usd: +((job.actual * per1000()) / 1000).toFixed(4) } : {}) })
  }
  delete job.pid
  saveJob(job)
  fs.rmSync(reqFile, { force: true })
  return job
}

async function runRouter(dir, job, request) {
  const { provider } = routerOf(`${job.provider}:${job.model}`)
  if (job.kind === 'image') {
    progress(job, `generating with ${job.name}…`)
    const r = await provider.image(request)
    job.outputs = r.files.map((f, i) => {
      const name = `out-${i + 1}.${(f.type.split('/')[1] ?? 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg')}`
      fs.writeFileSync(path.join(dir, name), f.data)
      return name
    })
    if (r.cost != null) Object.assign(job, { actual: r.cost, actual_known: true })
    return
  }
  if (job.kind === 'audio') {
    progress(job, `speaking with ${job.name}…`)
    let r
    try { r = await provider.speech(request) } catch (e) {
      // some voices only answer raw PCM (16-bit, at the rate it says): wrapped into an MP3 here
      if (!/pcm|format/i.test(e.message)) throw e
      r = await provider.speech({ ...request, format: 'pcm' })
      fs.writeFileSync(path.join(dir, 'out.pcm'), r.data)
      ffmpeg(['-f', 's16le', '-ar', `${r.rate}`, '-ac', `${r.channels}`, '-i', path.join(dir, 'out.pcm'), '-b:a', '192k', path.join(dir, 'out.mp3')])
      fs.rmSync(path.join(dir, 'out.pcm'))
    }
    if (r.format === 'mp3') fs.writeFileSync(path.join(dir, 'out.mp3'), r.data)
    job.outputs = ['out.mp3']
    if (r.generation) progress(job, 'reading its cost…')
    const cost = r.generation ? await provider.generationCost(r.generation) : null
    if (cost != null) Object.assign(job, { actual: cost, actual_known: true })
    return
  }
  // a video: submitted once (its id kept, so a run that stopped resumes the polling), then polled. Its videos and
  // voices go through a tunnel, open from the submission to the job's end
  // ponytail: a resumed run opens no tunnel again; the router fetched the files once the job started
  let t = null
  try {
    if (!job.job) {
      const local = request.refs.filter(r => r.file)
      if (local.length) {
        progress(job, `opening a tunnel for ${job.name} to fetch the ${[...new Set(local.map(r => r.kind))].join(' and ')}…`)
        t = await tunnel(local.map(r => r.file))
      }
      job.job = await provider.video({ ...request, refs: request.refs.map(r => (r.file ? { kind: r.kind, url: t.urls[local.indexOf(r)] } : r)) })
      progress(job, `submitted to ${job.name} (${job.job.id})`)
    }
    for (let wait = 0; ; wait++) {
      const s = await provider.poll(job.job)
      if (s.status === 'completed') {
        job.outputs = []
        for (const [i, url] of s.urls.entries()) {
          const name = s.urls.length > 1 ? `out-${i + 1}.mp4` : 'out.mp4'
          fs.writeFileSync(path.join(dir, name), await provider.download(url))
          job.outputs.push(name)
        }
        if (s.cost != null) Object.assign(job, { actual: s.cost, actual_known: true })
        break
      }
      if (['failed', 'cancelled', 'expired'].includes(s.status)) throw new Error(s.error ?? `the job ${s.status}`)
      progress(job, `${s.status === 'pending' ? 'queued' : 'rendering'} on ${job.name}, ${Math.round((Date.now() - Date.parse(job.started)) / 1000)} s`)
      await sleep(+(process.env.MEDIA_GENERATOR_POLL ?? 8000))
    }
  } finally {
    if (t) { t.close(); progress(job, 'tunnel closed') }
  }
  // extend: the new shot joined to the source, after it (sequel) or before it (prequel), at the source's size
  if (job.tool === 'extend') {
    const src = path.join(dir, job.spec.inputs.video[0]), made = path.join(dir, job.outputs[0]), s = probe(src)
    const [a, b] = job.spec.fields?.direction === 'prequel' ? [made, src] : [src, made]
    const both = [a, b].every(f => probe(f).audio)
    const scale = i => `[${i}:v]scale=${s.width}:${s.height}:force_original_aspect_ratio=decrease,pad=${s.width}:${s.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`
    ffmpeg(['-i', a, '-i', b, '-filter_complex', `${scale(0)};${scale(1)};[v0]${both ? '[0:a]' : ''}[v1]${both ? '[1:a]' : ''}concat=n=2:v=1:a=${both ? 1 : 0}[v]${both ? '[a]' : ''}`,
      '-map', '[v]', ...(both ? ['-map', '[a]'] : []), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', path.join(dir, 'extended.mp4')])
    job.outputs = ['extended.mp4', ...job.outputs]
  }
}

// reframe: a fixed crop to the new ratio, centered on the point the user picked (0 left … 1 right, or top … bottom)
// ponytail: no subject tracking; video-editor's face framing when moving subjects need it
function runReframe(dir, job) {
  const src = path.join(dir, job.spec.inputs.video[0]), s = probe(src)
  const [a, b] = String(job.spec.fields?.ratio ?? '9:16').split(':').map(Number), r = a / b, focus = Math.min(1, Math.max(0, +(job.spec.fields?.focus ?? 0.5)))
  const even = x => Math.floor(x / 2) * 2
  const [w, h] = s.width / s.height > r ? [even(s.height * r), even(s.height)] : [even(s.width), even(s.width / r)]
  const x = Math.round(Math.min(Math.max(focus * s.width - w / 2, 0), s.width - w)), y = Math.round(Math.min(Math.max(focus * s.height - h / 2, 0), s.height - h))
  progress(job, `reframing to ${a}:${b}…`)
  ffmpeg(['-i', src, '-vf', `crop=${w}:${h}:${s.width / s.height > r ? x : 0}:${s.width / s.height > r ? 0 : y}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'copy', path.join(dir, 'out.mp4')])
  job.outputs = ['out.mp4']
}

// voice change and dubbing: video.mjs does the work and says what it spent
function runEleven(dir, job, argv) {
  progress(job, argv[0] === 'dub' ? 'dubbing with ElevenLabs…' : 'changing the voice with ElevenLabs…')
  const clip = path.join(dir, job.spec.inputs.clip[0]), out = argv[0] === 'dub' ? dir : path.join(dir, `out${path.extname(clip)}`)
  const r = videoMjs([argv[0], clip, ...argv.slice(2), '--out', out, '--spend', String(job.estimate.amount)])
  if (!process.env.MEDIA_GENERATOR_QUIET) process.stdout.write(r.stdout)
  if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').pop().replace(/^error: /, ''))
  const spent = r.stdout.match(/spent: (\d+) credits/)
  if (spent) Object.assign(job, { actual: +spent[1], actual_known: true })
  job.outputs = fs.readdirSync(dir).filter(f => /^(out|dub-)/.test(f)).sort()
}

// ---------- commands ----------

function specFromArgs(kind) {
  const inputs = {}
  for (const x of opt.in ?? []) {
    const i = x.indexOf('=')
    if (i < 1) die('--in takes <input>=<file>, the tool\'s inputs (media.mjs tools)')
    ;(inputs[x.slice(0, i)] ??= []).push(path.resolve(x.slice(i + 1)))
  }
  const fields = Object.fromEntries((opt.field ?? []).map(x => { const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1)] }))
  const params = clean({ n: num(opt.n), duration: num(opt.duration), aspect_ratio: opt.ratio, resolution: opt.resolution, quality: opt.quality,
    sound: opt.sound === undefined ? undefined : opt.sound !== 'off', seed: num(opt.seed), voice: opt.voice })
  return { kind, tool: opt.tool ?? (kind === 'audio' ? 'voice' : 'free'), model: opt.model, prompt: opt.prompt ?? args.join(' '), raw: opt.raw, fields, inputs, params }
}

// image | video | audio: plan, ask (exit 2 without --spend), then run to the end
async function generate(kind) {
  const spec = specFromArgs(kind)
  try {
    if (opt.estimate) {
      const p = await plan(spec)
      return console.log(JSON.stringify({ tool: p.tool.id, provider: p.provider, model: p.model, prompt: p.prompt, estimate: p.estimate, shown: money(p.estimate.amount, p.estimate.unit, per1000()) }))
    }
    const job = await create(spec, { spend: num(opt.spend), acceptUnknown: opt['accept-unknown'], force: opt.force, by: 'claude' })
    console.log(`${job.label} · ${job.name} · ${money(job.estimate.amount, job.estimate.unit, per1000())} → media/${job.id}`)
    const done = await run(job.id)
    if (done.status === 'failed') die(`${done.error} (media/${done.id}, ${money(done.actual, done.estimate.unit)} spent)`, /402|no credits|key/i.test(done.error) ? 3 : 1)
    console.log(`done: ${done.outputs.map(f => path.join(mediaDir(done.id), f)).join(', ')}`)
    console.log(`cost: ${money(done.actual, done.estimate.unit, per1000())}${done.actual_known ? '' : ' (estimated)'}`)
  } catch (e) {
    if (e.code === 2) { console.log(JSON.stringify({ estimate: e.estimate, shown: e.shown, reason: e.reason })); die(e.message, 2) }
    die(e.message, e.status === 401 || e.status === 402 ? 3 : e.code ?? 1)
  }
}

async function cmdModels(kind = 'video') {
  const list = (await models(kind)).filter(m => !opt.search || `${m.id} ${m.name}`.toLowerCase().includes(opt.search.toLowerCase()))
  if (opt.json) return console.log(JSON.stringify(list.map(({ pricing, ...m }) => m)))
  for (const m of list) {
    const p = m.params, caps = [m.role !== 'create' && m.role !== 'generate' && m.role, p.duration && `${p.duration[0]}–${p.duration.at(-1)} s`, p.resolution?.join('/'),
      p.frames?.length && p.frames.join('+'), p.audio && 'audio', p.n && p.n.max > 1 && `up to ${p.n.max}`, p.references && `${p.references} refs`, p.voices && `${p.voices.length} voices`].filter(Boolean)
    console.log(`${m.id}  ${m.name}${caps.length ? `  [${caps.join(', ')}]` : ''}`)
  }
  console.log(`${list.length} ${kind} models (the engine's list, providers/openrouter-models.json)`)
}

function cmdTools(kind) {
  for (const k of kind ? [kind] : KINDS) {
    const list = TOOLS[k].filter(t => !opt.search || `${t.id} ${t.label} ${t.group} ${t.description}`.toLowerCase().includes(opt.search.toLowerCase()))
    if (opt.json) { console.log(JSON.stringify(list)); continue }
    for (const t of list) {
      const ins = t.inputs.map(i => `--in ${i.key}=<${i.kind}>${i.optional ? '?' : ''}`).join(' '), fields = t.fields.map(f => `--field ${f.key}=${f.options ? f.options.join('|') : `<${f.type}>`}`).join(' ')
      console.log(`${k} ${t.id} (${t.mode}, ${t.group}): ${t.description}${ins ? `\n    ${ins}` : ''}${fields ? `\n    ${fields}` : ''}${t.models ? `\n    models: ${t.models.join(', ')}` : ''}`)
    }
  }
}

// draft: Claude's prompt for the dashboard's composer (Copy prompt), shown with a Reload bar; nothing is generated
function draft() {
  const space = opt.space ?? 'video'
  if (!KINDS.includes(space)) die(`--space is one of ${KINDS.join(', ')}`)
  if (opt.tool) toolOf(space, opt.tool)
  const file = at('.cache', 'drafts.json'), all = fs.existsSync(file) ? readJson(file) : {}
  all[space] = clean({ tool: opt.tool, model: opt.model, prompt: opt.prompt ?? args.join(' '), fields: Object.fromEntries((opt.field ?? []).map(x => { const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1)] })), at: new Date().toISOString() })
  writeJson(file, all)
  console.log(`draft for ${space} written: the open dashboard shows it with a Reload bar`)
}

function jobs(id) {
  if (id) return console.log(JSON.stringify(readJob(id), null, 2))
  const list = fs.existsSync(at('media')) ? fs.readdirSync(at('media')).filter(d => fs.existsSync(path.join(mediaDir(d), 'job.json'))).sort().reverse().slice(0, 20) : []
  for (const d of list) {
    const j = readJob(d)
    console.log(`${j.id}  ${j.status}${j.note ? ` (${j.note})` : ''}  ${j.label} · ${j.name} · ${money(j.actual ?? j.estimate.amount, j.estimate.unit)}${j.error ? `  ${j.error}` : ''}`)
  }
  if (!list.length) console.log('no generation yet')
}

async function balances() {
  const out = {}
  for (const [name, p] of Object.entries(PROVIDERS)) out[name] = p.key() ? await p.balance().catch(e => ({ error: e.message })) : { error: 'no key' }
  if (process.env.ELEVENLABS_API_KEY && fs.existsSync(VIDEO)) {
    const r = videoMjs(['credits', '--json'])
    out.elevenlabs = r.status === 0 ? JSON.parse(r.stdout.trim().split('\n').pop()) : { error: (r.stderr || r.stdout).trim() }
  } else out.elevenlabs = { error: 'no key' }
  return out
}

async function credits() {
  const b = await balances(), ledger = readLedger(HOME), s = settings(), usd = per1000()
  const or = b.openrouter
  console.log(or.error ? `openrouter: ${or.error}` : `openrouter: ${or.account_left != null ? `$${or.account_left} left on the account, ` : ''}${or.key_left != null ? `$${or.key_left.toFixed(2)} left on this key` : 'no limit on this key'}${or.month != null ? `, $${or.month.toFixed(2)} used this month` : ''}`)
  const el = b.elevenlabs
  console.log(el.error ? `elevenlabs: ${el.error}` : `elevenlabs: ${money(el.left, 'credits', usd)} left of ${el.limit}${el.reset ? `, renewed on ${el.reset}` : ''}`)
  for (const p of ['openrouter', 'elevenlabs']) {
    const spent = spentThisMonth(ledger, p), cap = s[p].cap
    console.log(`${p} this month here: ${money(spent, p === 'openrouter' ? 'usd' : 'credits', usd)}${cap != null ? ` of a ${money(cap, p === 'openrouter' ? 'usd' : 'credits', usd)} cap` : ''}`)
  }
  for (const e of ledger.slice(-10)) console.log(`  ${e.at.slice(0, 16).replace('T', ' ')}  ${e.label} · ${e.model}  ${money(e.actual, e.unit, usd)}${e.actual_known ? '' : ' (est.)'}  ${e.status} · ${e.by}`)
}

// setup [set <section>.<key>=<value|none>…]: the thresholds, caps, ElevenLabs' price and default models
function setup(sub, ...rest) {
  const s = settings()
  if (sub === 'set') {
    for (const kv of rest) {
      const [k, v] = [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)], [sec, key] = k.split('.')
      if (!SETTINGS[sec] || !(key in SETTINGS[sec])) die(`setup set: ${k} is not one of ${Object.entries(SETTINGS).flatMap(([a, o]) => Object.keys(o).map(b => `${a}.${b}`)).join(', ')}`)
      s[sec][key] = v === 'none' || v === '' ? null : sec === 'defaults' ? v
        : key === 'plan' ? (v in PLANS ? v : die(`setup set: elevenlabs.plan is one of ${Object.keys(PLANS).join(', ')}, or none`))
        : Number.isFinite(+v) && +v >= 0 ? +v : die(`setup set: ${k} is a number, or none`)
    }
    ensureHome()
    writeJson(at('settings.json'), s)
  } else if (sub) die('usage: setup [set openrouter.threshold=<usd> openrouter.cap=<usd> elevenlabs.threshold=<credits> elevenlabs.cap=<credits> elevenlabs.plan=<${Object.keys(PLANS).join('|')}> defaults.video=<model>…]')
  for (const [sec, o] of Object.entries(s)) console.log(`${sec}: ${Object.entries(o).map(([k, v]) => `${k} ${v ?? 'not set'}`).join(' · ')}`)
}

// elements [add <name> <files…> | remove <name>]: the people, products and places a prompt cites with @name
function elements(sub, name, ...files) {
  if (sub === 'add') {
    if (!/^[\w-]+$/.test(name ?? '') || !files.length) die('usage: elements add <name> <images…> (letters, digits, - and _)')
    ensureHome()
    fs.mkdirSync(at('elements', name), { recursive: true })
    for (const f of files) fs.copyFileSync(f, at('elements', name, path.basename(f)))
  } else if (sub === 'remove') fs.rmSync(at('elements', name ?? '-'), { recursive: true, force: true })
  const list = fs.existsSync(at('elements')) ? fs.readdirSync(at('elements')).filter(d => fs.statSync(at('elements', d)).isDirectory()) : []
  for (const d of list) console.log(`@${d}: ${fs.readdirSync(at('elements', d)).length} images`)
  if (!list.length) console.log('no element yet: elements add <name> <images…>')
}

function doctor() {
  const has = bin => !spawnSync(bin, ['-version'], { stdio: 'ignore' }).error
  const checks = [['node 22 or later', +process.versions.node.split('.')[0] >= 22, 'brew install node'], ['ffmpeg and ffprobe', has('ffmpeg') && has('ffprobe'), 'brew install ffmpeg'],
    ['the dashboard is built', fs.existsSync(path.join(STUDIO, 'index.html')), 'npm run build in plugins-src/skill-video/media-studio']]
  for (const [name, ok, fix] of checks) console.log(`${ok ? 'ok     ' : 'MISSING'} ${name}${ok ? '' : `: ${fix}`}`)
  // optional: only a video or a voice sent to OpenRouter needs it, the rest works without
  console.log(has('cloudflared') ? 'ok      cloudflared (videos and voices sent to OpenRouter by a tunnel)'
    : 'missing cloudflared: brew install cloudflared (no account), for a video or a voice sent to OpenRouter (video edits, upscale, talking avatar); everything else works')
  console.log(process.env.OPENROUTER_API_KEY ? 'openrouter: key set' : 'openrouter: no key, nothing can be generated; the plugin\'s secret: /plugin configure skill-video@pabrisson')
  console.log(process.env.OPENROUTER_MANAGEMENT_KEY ? 'openrouter management key: set (the account\'s balance)' : 'openrouter management key: not set (the key\'s own limit only)')
  console.log(process.env.ELEVENLABS_API_KEY ? 'elevenlabs: key set (change voice, translate)' : 'elevenlabs: no key, no voice change or translation')
  const s = settings()
  console.log(`limits: ${['openrouter', 'elevenlabs'].map(p => `${p} threshold ${s[p].threshold ?? 'none'}, cap ${s[p].cap ?? 'none'}`).join(' · ')}`)
  console.log(`folder: ${HOME}`)
  if (fs.existsSync(at('media'))) {
    const kept = spawnSync('git', ['-C', HOME, 'check-ignore', '--no-index', 'media/x', 'elements/x', 'ledger.jsonl', 'settings.json'], { encoding: 'utf8' })
    if (kept.status === 0) console.log(`warning: git ignores ${kept.stdout.trim().split('\n').join(', ')}: the media and the ledger must stay versioned, fix ${at('.gitignore')}`)
  }
  if (checks.some(c => !c[1])) process.exit(1)
}

// ---------- the dashboard's server ----------

const reply = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const readBody = req => new Promise((ok, ko) => { let s = ''; req.on('data', c => { s += c; if (s.length > 5e6) ko(new Error('body too large')) }); req.on('end', () => ok(s ? JSON.parse(s) : {})); req.on('error', ko) })
const inside = (root, file) => { const f = path.resolve(file); return f === root || f.startsWith(root + path.sep) ? f : null }
function sendFile(req, res, file) {
  const size = fs.statSync(file).size, range = req.headers.range?.match(/bytes=(\d*)-(\d*)/)
  if (range) {
    const start = +range[1] || 0, end = range[2] ? +range[2] : size - 1
    res.writeHead(206, { 'content-type': mimeOf(file), 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 })
    return fs.createReadStream(file, { start, end }).pipe(res)
  }
  res.writeHead(200, { 'content-type': mimeOf(file), 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'no-cache' })
  fs.createReadStream(file).pipe(res)
}

// a generation started from the dashboard runs in its own process: it finishes even if the page or the server goes
const startRun = id => spawn(process.execPath, [SELF, 'run', id], { cwd: HOME, env: { ...process.env, MEDIA_GENERATOR_DIR: HOME, MEDIA_GENERATOR_QUIET: '1' }, detached: true, stdio: 'ignore' }).unref()

function mediaList() {
  if (!fs.existsSync(at('media'))) return []
  return fs.readdirSync(at('media')).filter(d => fs.existsSync(path.join(mediaDir(d), 'job.json'))).sort().reverse().map(d => {
    const j = readJob(d)
    // a run that stopped (machine asleep, process killed) is resumed: its video job id was kept
    if (j.status === 'running' && !alive(j.pid)) { j.status = 'queued'; saveJob(j); startRun(j.id) }
    const { spec, ...rest } = j
    return { ...rest, fields: spec.fields, params: spec.params, inputs: spec.inputs, raw_prompt: spec.prompt, raw: !!spec.raw }
  })
}

let balanceCache = { at: 0, value: null }

// the fake APIs a dev or test server was started on ($OPENROUTER_BASE, $ELEVENLABS_BASE): the header's toggle turns
// them off (the real APIs, with the server's keys) and on again, for this server and the runs it starts
const FAKE = Object.fromEntries(['OPENROUTER_BASE', 'ELEVENLABS_BASE'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
const fakeState = () => ({ on: Object.keys(FAKE).some(k => process.env[k]), bases: Object.values(FAKE) })
function useFake(on) {
  for (const [k, v] of Object.entries(FAKE)) if (on) process.env[k] = v; else delete process.env[k]
  // the balances differ from one to the other
  balanceCache = { at: 0, value: null }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://x'), p = url.pathname, post = req.method === 'POST'
  if (p === '/__media-generator') return reply(res, 200, { home: HOME, engine: ENGINE, mtime: LOADED })
  if (p === '/__media-generator/owner' && post) { watchOwner(+url.searchParams.get('pid')); return reply(res, 200, { ok: true }) }
  if (p === '/__media-generator/quit' && post) { reply(res, 200, { ok: true }); return setTimeout(() => process.exit(0), 50) }
  if (p === '/api/state') {
    const drafts = fs.existsSync(at('.cache', 'drafts.json')) ? readJson(at('.cache', 'drafts.json')) : {}
    return reply(res, 200, { home: HOME, settings: settings(), keys: { openrouter: !!process.env.OPENROUTER_API_KEY, management: !!process.env.OPENROUTER_MANAGEMENT_KEY, elevenlabs: !!process.env.ELEVENLABS_API_KEY },
      fake: fakeState(),
      media: mediaList(), drafts, plans: PLANS, month: Object.fromEntries(['openrouter', 'elevenlabs'].map(x => [x, spentThisMonth(readLedger(HOME), x)])) })
  }
  if (p === '/api/tools') return reply(res, 200, TOOLS)
  if (p === '/api/models') {
    const kind = url.searchParams.get('kind')
    return reply(res, 200, (await models(kind)).map(({ pricing, ...m }) => m))
  }
  if (p === '/api/balances') {
    if (Date.now() - balanceCache.at > 60e3 || url.searchParams.has('refresh')) balanceCache = { at: Date.now(), value: await balances() }
    return reply(res, 200, balanceCache.value)
  }
  if (p === '/api/ledger') return reply(res, 200, readLedger(HOME))
  if (p === '/api/fake' && post) {
    if (!Object.keys(FAKE).length) return reply(res, 400, { error: 'this server runs on the real APIs: no fake to turn on' })
    useFake(!!(await readBody(req)).on)
    return reply(res, 200, fakeState())
  }
  if (p === '/api/estimate' && post) {
    const spec = await readBody(req)
    try {
      const pl = await plan(spec), s = settings()
      return reply(res, 200, { model: pl.model, provider: pl.provider, prompt: pl.prompt, estimate: pl.estimate, shown: money(pl.estimate.amount, pl.estimate.unit, per1000()),
        needs: pl.provider === 'local' ? null : needsYes(pl.estimate, s[pl.provider], spentThisMonth(readLedger(HOME), pl.provider)) })
    } catch (e) { return reply(res, 400, { error: e.message }) }
  }
  if (p === '/api/generate' && post) {
    const { confirm, ...spec } = await readBody(req)
    try {
      const job = await create(spec, { by: 'dashboard', confirm })
      startRun(job.id)
      return reply(res, 200, { id: job.id })
    } catch (e) { return reply(res, e.code === 2 ? 409 : 400, { error: e.message, needs: e.reason, estimate: e.estimate, shown: e.shown }) }
  }
  if (p === '/api/upload' && post) {
    ensureHome()
    const name = path.basename(url.searchParams.get('name') ?? 'file').replace(/[^\w.-]/g, '_'), file = at('.cache', 'uploads', `${Date.now()}-${name}`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await pipeline(req, fs.createWriteStream(file))
    return reply(res, 200, { path: file })
  }
  // a frame of a video, to draw on (Sketch) or to pick a point on (Reframe)
  if (p === '/api/frame' && post) {
    const { path: file, last } = await readBody(req), src = inside(HOME, file)
    if (!src) return reply(res, 403, { error: 'outside the folder' })
    const out = at('.cache', 'uploads', `${Date.now()}-frame.png`)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    ffmpeg([...(last ? ['-sseof', '-0.1'] : []), '-i', src, '-frames:v', '1', '-update', '1', out])
    return reply(res, 200, { path: out })
  }
  // a video sent as an input, cut to the part and the area kept (Edit reference): a new file, the original stays.
  // crop is { x, y, w, h } in fractions of the frame
  if (p === '/api/cut' && post) {
    const { path: file, start = 0, end, crop } = await readBody(req), src = inside(HOME, file)
    if (!src) return reply(res, 403, { error: 'outside the folder' })
    const s = probe(src), from = Math.max(0, +start), to = Math.min(s.duration, +(end ?? s.duration))
    if (!(to - from >= 0.1)) return reply(res, 400, { error: 'the cut keeps less than 0.1 s' })
    const even = x => Math.max(2, Math.floor(x / 2) * 2), clamp = (x, max) => Math.min(Math.max(0, x || 0), max)
    const w = crop && even(clamp(crop.w, 1) * s.width), h = crop && even(clamp(crop.h, 1) * s.height)
    const vf = crop ? ['-vf', `crop=${w}:${h}:${Math.round(clamp(crop.x * s.width, s.width - w))}:${Math.round(clamp(crop.y * s.height, s.height - h))}`] : []
    const out = at('.cache', 'uploads', `${Date.now()}-${path.basename(src, path.extname(src)).replace(/^\d+-/, '')}-cut.mp4`)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    ffmpeg(['-ss', `${from}`, '-i', src, '-t', `${to - from}`, ...vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', out])
    return reply(res, 200, { path: out })
  }
  // a file dropped on the page, just sent: it moves to the library as a result of its own, free, nothing in the ledger
  if (p === '/api/import' && post) {
    const src = inside(at('.cache', 'uploads'), (await readBody(req)).path ?? '')
    if (!src || !fs.existsSync(src)) return reply(res, 403, { error: 'only a file just sent goes to the library' })
    const kind = kindOfFile(src), name = path.basename(src).replace(/^\d+-/, '')
    if (!KINDS.includes(kind)) return reply(res, 400, { error: `${name} is not an image, a video or a sound` })
    const id = newId('import'), now = new Date().toISOString()
    fs.mkdirSync(mediaDir(id), { recursive: true })
    fs.renameSync(src, path.join(mediaDir(id), name))
    saveJob({ id, kind, tool: 'import', label: 'Imported', provider: 'local', model: 'file', name, prompt: '', spec: { kind, tool: 'import', prompt: '', fields: {}, inputs: {}, params: {} },
      estimate: { amount: 0, unit: 'usd', known: true, detail: 'imported, free' }, actual: 0, actual_known: true, status: 'done', by: 'dashboard', created: now, finished: now, outputs: [name] })
    return reply(res, 200, { id, kind })
  }
  if (p.startsWith('/api/media/') && post) {
    const [, , , id, action] = p.split('/'), dir = mediaDir(path.basename(id))
    if (!fs.existsSync(dir)) return reply(res, 404, { error: 'no such generation' })
    if (action === 'favorite') { const j = readJob(id); j.favorite = !j.favorite; saveJob(j) }
    else if (action === 'delete') { fs.mkdirSync(at('.trash'), { recursive: true }); fs.renameSync(dir, at('.trash', id)) }
    else return reply(res, 404, { error: 'unknown action' })
    return reply(res, 200, { ok: true })
  }
  if (p === '/api/settings' && post) {
    const body = await readBody(req), s = settings()
    for (const sec of Object.keys(SETTINGS)) for (const k of Object.keys(SETTINGS[sec])) if (body[sec] && k in body[sec]) {
      const v = body[sec][k]
      s[sec][k] = v === null || v === '' ? null : sec === 'defaults' ? String(v) : k === 'plan' ? (v in PLANS ? v : s[sec][k]) : Number.isFinite(+v) && +v >= 0 ? +v : s[sec][k]
    }
    ensureHome()
    writeJson(at('settings.json'), s)
    return reply(res, 200, s)
  }
  if (p === '/api/voices') {
    const r = videoMjs(['voices', '--json'])
    return r.status === 0 ? reply(res, 200, JSON.parse(r.stdout.trim().split('\n').pop())) : reply(res, 400, { error: (r.stderr || r.stdout).trim().replace(/^error: /, '') })
  }
  if (p === '/api/voice-clone' && post) {
    const { name, paths } = await readBody(req)
    // a recording from the browser (webm) becomes an MP3 first
    const files = paths.map(f => inside(HOME, f)).filter(Boolean).map(f => {
      if (!/\.webm$/i.test(f)) return f
      const mp3 = f.replace(/\.webm$/i, '.mp3')
      ffmpeg(['-i', f, '-b:a', '192k', mp3])
      return mp3
    })
    const r = videoMjs(['voice-clone', name, ...files])
    return r.status === 0 ? reply(res, 200, { ok: true, out: r.stdout.trim() }) : reply(res, 400, { error: (r.stderr || r.stdout).trim().replace(/^error: /, '') })
  }
  if (p === '/api/elements') {
    if (post) {
      const { name, paths, remove } = await readBody(req)
      if (!/^[\w-]+$/.test(name ?? '')) return reply(res, 400, { error: 'a name of letters, digits, - and _' })
      if (remove) fs.rmSync(at('elements', name), { recursive: true, force: true })
      else {
        ensureHome()
        fs.mkdirSync(at('elements', name), { recursive: true })
        for (const f of paths ?? []) if (inside(HOME, f)) fs.copyFileSync(f, at('elements', name, path.basename(f).replace(/^\d+-/, '')))
      }
    }
    const list = fs.existsSync(at('elements')) ? fs.readdirSync(at('elements')).filter(d => fs.statSync(at('elements', d)).isDirectory()) : []
    return reply(res, 200, list.map(name => ({ name, files: fs.readdirSync(at('elements', name)).map(f => at('elements', name, f)) })))
  }
  // the folder's files for the page: media, elements, uploads
  if (p === '/files') {
    const f = inside(HOME, url.searchParams.get('path') ?? '')
    return f && fs.existsSync(f) && fs.statSync(f).isFile() ? sendFile(req, res, f) : reply(res, 404, { error: 'not found' })
  }
  if (!fs.existsSync(path.join(STUDIO, 'index.html'))) return reply(res, 503, { error: `the dashboard is not built (${STUDIO})` })
  const f = inside(STUDIO, path.join(STUDIO, decodeURIComponent(p)))
  return sendFile(req, res, f && fs.existsSync(f) && fs.statSync(f).isFile() ? f : path.join(STUDIO, 'index.html'))
}

function serve() {
  http.createServer((req, res) => handle(req, res).catch(e => reply(res, 500, { error: e.message })))
    .listen(PORT, '127.0.0.1', () => console.log(`media-generator server on http://127.0.0.1:${PORT}/ for ${HOME}`))
}

// the Claude processes the server works for (each `studio` adds its own): it quits once they have all quit, like
// video-editor's studio. A server nobody registered with (started by hand, the tests) runs until stopped
const owners = new Set()
function watchOwner(pid) {
  if (!pid) return
  if (!owners.size) setInterval(() => {
    for (const o of owners) if (!alive(o)) owners.delete(o)
    if (!owners.size) { console.log('every Claude this server worked for has quit: stopping'); process.exit(0) }
  }, 2000)
  owners.add(pid)
}
// the Claude Code this command runs under: the nearest ancestor named claude, null outside one
// ponytail: null on Windows (no ps -o), its server then runs until stopped
function claudePid() {
  try {
    const procs = new Map(execFileSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8' }).trim().split('\n').map(l => {
      const [, pid, ppid, comm] = l.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
      return [+pid, { ppid: +ppid, comm }]
    }))
    for (let pid = process.ppid; pid > 1 && procs.has(pid); pid = procs.get(pid).ppid) if (/^claude$/i.test(path.basename(procs.get(pid).comm))) return pid
  } catch {}
  return null
}
// one server per folder, from PORT up; reused when it runs this very engine, replaced when older
async function findServer() {
  const base = port => `http://127.0.0.1:${port}/`, ping = port => fetch(base(port) + '__media-generator').then(r => r.json()).catch(() => null)
  const ports = Array.from({ length: 20 }, (_, i) => PORT + i), lives = await Promise.all(ports.map(ping))
  let i = lives.findIndex(l => l?.home === HOME)
  if (i >= 0 && lives[i].engine === ENGINE && lives[i].mtime === LOADED) return base(ports[i])
  if (i >= 0) { await fetch(base(ports[i]) + '__media-generator/quit', { method: 'POST' }).catch(() => {}); await sleep(300); lives[i] = null } else i = 0
  ensureHome()
  const log = fs.openSync(at('.cache', 'server.log'), 'a')
  for (; i < ports.length; i++) {
    if (lives[i]) continue
    spawn(process.execPath, [SELF, 'serve'], { cwd: HOME, env: { ...process.env, MEDIA_GENERATOR_DIR: HOME, MEDIA_GENERATOR_PORT: `${ports[i]}` }, detached: true, stdio: ['ignore', log, log] }).unref()
    let live = null
    for (let k = 0; k < 50 && !(live = await ping(ports[i])); k++) await sleep(100)
    if (live?.home === HOME) return base(ports[i])
  }
  die(`the server did not start on ports ${PORT}–${PORT + 19}, see ${at('.cache', 'server.log')}`)
}
async function studio() {
  if (!fs.existsSync(path.join(STUDIO, 'index.html'))) die(`the dashboard is not built (${STUDIO})`)
  const url = await findServer(), owner = claudePid()
  if (owner) await fetch(url + `__media-generator/owner?pid=${owner}`, { method: 'POST' }).catch(() => {})
  console.log(`dashboard: ${url}`)
  if (opt.open) spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref()
}

const commands = {
  doctor, setup: () => setup(...args), studio, serve, draft, credits, jobs: () => jobs(args[0]), elements: () => elements(...args),
  models: () => cmdModels(args[0]), tools: () => cmdTools(args[0]),
  image: () => generate('image'), video: () => generate('video'), audio: () => generate('audio'),
  run: async () => { const j = await run(args[0]); console.log(`${j.status}: ${j.outputs.join(', ') || j.error}`) },
  // ElevenLabs' voices of the account, and a clone of a voice from recordings: video-editor's engine does it
  voices: () => relay(['voices', ...args, ...(opt.json ? ['--json'] : [])]), 'voice-clone': () => relay(['voice-clone', ...args]),
}
function relay(argv) {
  const r = videoMjs(argv)
  process.stdout.write(r.stdout)
  process.stderr.write(r.stderr)
  process.exit(r.status ?? 1)
}
if (!commands[cmd]) die(`usage: media.mjs <${Object.keys(commands).join(' | ')}>`)
await commands[cmd]()
