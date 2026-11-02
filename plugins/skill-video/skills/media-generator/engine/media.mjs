#!/usr/bin/env node
// media-generator CLI and the dashboard's server. Images, videos, voices, music and sounds through the model routers of
// providers/; ElevenLabs straight (its voices with their captions, sound effects, music, music for a video, stems, voice
// design and remix, transcripts), its voice changes and dubbing by video-editor's engine.
// Everything lives in the folder Claude Code
// runs in ($MEDIA_GENERATOR_DIR overrides it): media/ (one folder per generation), elements/ (the @ references),
// styles/ (the Library's styles), ledger.jsonl (what was spent), settings.json (thresholds, caps, defaults), .cache/
// (catalogs, uploads, drafts)
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import zlib from 'node:zlib'
import { srt } from './lib/captions.js'
import { appendLedger, money, needsYes, PLANS, readLedger, spentThisMonth } from './lib/cost.js'
import { DIALOGUE_MAX, DIALOGUE_VOICES, fromSnapshot } from './providers/elevenlabs.js'
import { DIRECT, PROVIDERS, routerOf } from './providers/index.js'
import { palette } from './lib/options.js'

const SELF = fileURLToPath(import.meta.url), ENGINE = path.dirname(SELF)
// the code this process runs: a server started from an older media.mjs gets replaced
const LOADED = fs.statSync(SELF).mtimeMs
const HOME = path.resolve(process.env.MEDIA_GENERATOR_DIR ?? process.cwd())
const PORT = +(process.env.MEDIA_GENERATOR_PORT ?? 41287)
const STUDIO = path.join(ENGINE, 'studio/dist')
const VIDEO = path.join(ENGINE, '../../video-editor/engine/video.mjs')
const KINDS = ['image', 'video', 'audio']
// a tool's install command on this OS (macOS, Linux, Windows), the same as video-editor's doctor gives
const byOs = (mac, linux, win) => ({ darwin: mac, win32: win })[process.platform] ?? linux
const INSTALL = {
  node: byOs('brew install node', 'https://nodejs.org/en/download', 'winget install OpenJS.NodeJS.LTS'),
  ffmpeg: byOs('brew install ffmpeg', 'sudo apt install ffmpeg', 'winget install Gyan.FFmpeg'),
  uv: byOs('brew install uv', 'curl -LsSf https://astral.sh/uv/install.sh | sh', 'winget install astral-sh.uv'),
  cloudflared: byOs('brew install cloudflared', 'https://github.com/cloudflare/cloudflared/releases/latest', 'winget install Cloudflare.cloudflared'),
}
// every program started from here hides its window: on Windows, a detached run or server has no console, and each
// ffmpeg, uv or node it starts would otherwise open one of its own
const HIDE = { windowsHide: true }

const { values: opt, positionals: [cmd, ...args] } = parseArgs({
  allowPositionals: true,
  options: {
    tool: { type: 'string', short: 't' }, model: { type: 'string', short: 'm' }, prompt: { type: 'string' }, raw: { type: 'boolean' },
    in: { type: 'string', multiple: true }, field: { type: 'string', multiple: true },
    n: { type: 'string' }, batch: { type: 'string' }, duration: { type: 'string' }, ratio: { type: 'string' }, resolution: { type: 'string' },
    quality: { type: 'string' }, sound: { type: 'string' }, seed: { type: 'string' }, voice: { type: 'string' }, option: { type: 'string', multiple: true }, line: { type: 'string', multiple: true }, shot: { type: 'string', multiple: true }, say: { type: 'string', multiple: true }, 'from-draft': { type: 'string' },
    spend: { type: 'string' }, 'accept-unknown': { type: 'boolean' }, force: { type: 'boolean' }, estimate: { type: 'boolean' },
    search: { type: 'string' }, json: { type: 'boolean' }, open: { type: 'boolean' }, space: { type: 'string' }, words: { type: 'string' }, for: { type: 'string' },
    type: { type: 'string' }, colors: { type: 'string' }, font: { type: 'string' }, workspace: { type: 'string' }, frame: { type: 'string' }, 'keyframe-model': { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, language: { type: 'string' }, verify: { type: 'string' }, from: { type: 'string', multiple: true }, drop: { type: 'string', multiple: true }, refresh: { type: 'boolean' }, take: { type: 'string' },
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
  const cf = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${server.address().port}`], { ...HIDE, stdio: ['ignore', 'ignore', 'pipe'] })
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

// once per version of a file (its path, time and size): the dashboard asks an estimate at every change, and each
// ffprobe (about 0.13 s) holds the whole server
const probed = new Map()
function probe(file) {
  const st = fs.statSync(file), key = `${file}:${st.mtimeMs}:${st.size}`
  if (probed.has(key)) return { ...probed.get(key) }
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,avg_frame_rate', '-of', 'json', file], { ...HIDE, encoding: 'utf8' }))
  const v = j.streams.find(s => s.codec_type === 'video'), [a, b] = String(v?.avg_frame_rate ?? '0/1').split('/').map(Number)
  probed.set(key, { duration: +(+j.format.duration || 0).toFixed(2), width: v?.width ?? null, height: v?.height ?? null, fps: b ? +(a / b).toFixed(3) : null, audio: j.streams.some(s => s.codec_type === 'audio') })
  return { ...probed.get(key) }
}
const ffmpeg = argv => execFileSync('ffmpeg', ['-y', '-v', 'error', ...argv], { ...HIDE, stdio: ['ignore', 'ignore', 'pipe'] })

// ---------- the folder: settings, .gitignore, tools, catalogs ----------

// thresholds and caps in each provider's unit, all unset until the user sets them (Settings, or setup set)
const SETTINGS = {
  // the one router that generates: kie or openrouter (Settings' Router); unset, Kie, whatever keys are set
  router: { active: null },
  openrouter: { threshold: null, cap: null },
  kie: { threshold: null, cap: null },
  elevenlabs: { threshold: null, cap: null, plan: null },
  defaults: { image: null, video: null, audio: null },
  // the dashboard's developer mode (Settings › Development): unset, on for a server started on fake APIs
  developer: { on: null },
  // the workspace new generations join (workspaces use, the dashboard's header)
  workspace: { current: 'default' },
}
// the fake APIs a dev or test server was started on ($OPENROUTER_BASE, $ELEVENLABS_BASE, $KIE_BASE…), as they were then
const FAKE = Object.fromEntries(['OPENROUTER_BASE', 'ELEVENLABS_BASE', 'KIE_BASE', 'KIE_UPLOAD_BASE', 'KIE_DOCS'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
const settings = () => {
  const s = fs.existsSync(at('settings.json')) ? readJson(at('settings.json')) : {}
  const out = Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, { ...v, ...s[k] }]))
  out.router.active ??= 'kie'
  out.developer.on ??= Object.keys(FAKE).length > 0
  return out
}
// the USD price of 1,000 ElevenLabs credits on the user's plan, null without a paid one
const per1000 = () => PLANS[settings().elevenlabs.plan] || null

// git keeps what the user made and cannot make again (media, elements, styles, workspaces, the ledger, the settings),
// not the cache
const IGNORE = '# media-generator: the cache is remade, the media, elements, styles, workspaces, ledger and settings stay\n.cache/\n.trash/\n'
function ensureHome() {
  for (const d of ['media', 'elements', '.cache']) fs.mkdirSync(at(d), { recursive: true })
  const gi = at('.gitignore'), now = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : ''
  if (!now.includes('# media-generator')) fs.writeFileSync(gi, now + (now && !now.endsWith('\n') ? '\n' : '') + (now ? '\n' : '') + IGNORE)
  // the Default workspace is there from the start, empty
  if (!fs.existsSync(wsFile('default'))) writeJson(wsFile('default'), { name: 'Default workspace', created: new Date().toISOString(), elements: [], timeline: TIMELINE })
}

const TOOLS = Object.fromEntries(KINDS.map(k => [k, JSON.parse(fs.readFileSync(path.join(ENGINE, `tools/${k}.json`), 'utf8'))]))
// a name as a file's or a folder's: a workspace, a style preset's sample
const slugOf = name => String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/^(con|prn|aux|nul|com\d|lpt\d)$/, '$1-1') || 'workspace'
const PREVIEWS = path.join(ENGINE, 'tools', 'previews')
const LISTS = {}
// a field's options may name a list of tools/ shared by several tools (the styles), and its default one of its labels;
// a preset's sample, when shipped: tools/previews/<list>/<its label as a slug>.webp (a look) or .m4a (a sound)
for (const f of Object.values(TOOLS).flat().flatMap(t => t.fields)) if (typeof f.options === 'string') {
  const list = f.options
  f.options = LISTS[list] ??= JSON.parse(fs.readFileSync(path.join(ENGINE, `tools/${list}.json`), 'utf8')).map(o => {
    const file = ['webp', 'm4a'].map(x => `${list}/${slugOf(o.label)}.${x}`).find(x => fs.existsSync(path.join(PREVIEWS, x)))
    return file ? { ...o, preview: `/previews/${file}` } : o
  })
  f.default = f.options.find(o => o.label === f.default)?.value ?? f.default
}
function toolOf(kind, id) {
  if (!KINDS.includes(kind)) throw userError(`the kinds are ${KINDS.join(', ')}`)
  const t = TOOLS[kind].find(x => x.id === id)
  if (!t) throw userError(`no ${kind} tool ${id}: media.mjs tools ${kind}`)
  return t
}
// the tools done on this machine, by their local, and what does the work: free, no router
const LOCAL = { reframe: 'ffmpeg', fps: 'ffmpeg', hdr: 'ffmpeg', depth: 'Depth Anything V2 Small', matte: 'BiRefNet lite' }
const hasBin = bin => !spawnSync(bin, [/^ff/.test(bin) ? '-version' : '--version'], { ...HIDE, stdio: 'ignore' }).error
// the tools whose prompt is the user's words (a style at most after them): never sent without them
const CUSTOM = ['free', 'free-edit']
// the video model that carries a keyframe through a shot, and the image model that makes it unless asked (2026-10-31:
// Seedream 5.0 Flash, $0.018, at the video's ratio)
const ALEPH = 'runway/aleph-2', KEYFRAME_MODEL = 'bytedance-seed/seedream-5-0-flash'
// the router's kind for a tool kind: audio is speech
const routerKind = kind => (kind === 'audio' ? 'speech' : kind)

// the router that generates, one at a time
const active = () => (PROVIDERS[settings().router.active] ? settings().router.active : 'kie')
// a tool's models on the active router: its own list for that router when it has one (tools/*.json "kie"), else its
// list, the models the router lacks left out by models(); each recommended one with why (the tool's own reason, else
// tools/why.json's)
const WHY = JSON.parse(fs.readFileSync(path.join(ENGINE, 'tools/why.json'), 'utf8'))
const kindOfTool = tool => KINDS.find(k => TOOLS[k].includes(tool))
const toolModels = tool => {
  const models = tool[active()]?.models ?? tool.models, kind = kindOfTool(tool)
  return { models, also: tool[active()]?.also ?? tool.also, why: Object.fromEntries((models ?? []).map(id => [id, tool.why?.[id] ?? WHY[kind]?.[id]]).filter(([, w]) => w)) }
}

// the active router's models of a kind (or another router's: Settings › Development), their ids prefixed with the router: its list kept by hand, plus the new models
// of its catalog (checked once a day). Audio: ElevenLabs' own models first, straight from it: its voices (its key), and
// then none of a router's ElevenLabs voices (without its key, the router's stay); its sounds, music, voice design and
// transcripts, listed whatever the key
async function models(kind, name = active()) {
  const own = (await PROVIDERS[name].models(routerKind(kind))).map(m => ({ ...m, id: `${name}:${m.model}`, provider: name }))
  if (kind !== 'audio') return own
  const direct = (await DIRECT.elevenlabs.models('speech').catch(() => [])).map(m => ({ ...m, id: `elevenlabs:${m.model}`, provider: 'elevenlabs' }))
  const speaks = direct.some(m => m.role === 'speech')
  return [...direct, ...own.filter(m => !(speaks && m.role === 'speech' && m.model.startsWith('elevenlabs/')))]
}
// a model of another router (a remix, a default set before a switch) runs on the active one when it has it
async function modelOf(kind, id) {
  const { name, model, provider } = routerOf(id), all = await models(kind), m = all.find(x => x.model === model)
  if (!m && name === 'elevenlabs') throw userError(`ElevenLabs' ${model} needs its key (/plugin configure skill-video@pabrisson): media.mjs models audio`)
  if (!m) throw userError(`no ${kind} model ${model} on ${PROVIDERS[active()].label}${name !== active() ? ` (it is ${provider.label}'s): pick another, or switch the router in Settings` : ''}: media.mjs models ${kind}`)
  return m
}

// ---------- a request: the tool's prompt, its inputs, the model's settings ----------

// where an input's images reach the model, as the prompt names them: an image model gets every input in order (« the
// second image », « images 2 to 4 »), a video model its references and sketch apart from its frames (« reference
// images 1 to 2 »). The dashboard's places does the same
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']
const counted = (kind, tool) => tool.inputs.filter(i => (kind === 'image' ? ['image', 'sketch', 'mask'].includes(i.kind) : ['references', 'sketch'].includes(i.key)))
const placeOf = (kind, at, n) => {
  const noun = kind === 'image' ? 'image' : 'reference image'
  return n === 1 ? `the ${ORDINALS[at - 1] ?? `#${at}`} ${noun}` : `${noun}s ${at} to ${at + n - 1}`
}
function places(kind, tool, inputs) {
  const out = {}
  let at = 1
  for (const i of counted(kind, tool)) {
    const n = inputs?.[i.key]?.length ?? 0
    if (n) out[i.key] = placeOf(kind, at, n)
    at += n
  }
  return out
}

// the tool's template with its fields, its inputs' places and the user's words; raw takes the prompt as written (edited
// in the dashboard). A field's phrase wraps a value ("shot on {}"), an input's its place, so an empty one (Auto, no
// file) leaves nothing; the punctuation left by empty ones folds into one mark (the dashboard's fill does the same)
function fill(tool, spec) {
  if (spec.raw) return String(spec.prompt ?? '').trim()
  let text = tool.template || '{prompt}'
  for (const f of tool.fields) {
    const v = String(spec.fields?.[f.key] ?? f.default ?? '')
    text = text.replaceAll(`{${f.key}}`, v && f.phrase ? f.phrase.replace('{}', v) : v)
  }
  const at = places(spec.kind, tool, spec.inputs)
  for (const i of tool.inputs) if (i.phrase) text = text.replaceAll(`{${i.key}}`, at[i.key] ? i.phrase.replace('{}', at[i.key]) : '')
  return text.replaceAll('{prompt}', spec.prompt ?? '').replace(/\s+/g, ' ').replace(/\(\s*\)/g, '').replace(/ {2,}/g, ' ').replace(/\s+([.,:;)])/g, '$1')
    .replace(/[.,:;]{2,}/g, m => (m.includes('.') ? '.' : m[0])).replace(/^[\s.,:;]+|[\s,:;]+$/g, '').trim()
}
// an option is a value, or { value, label, group, note }; a label given for a value stands for it (light=Silhouette)
const optionValue = (f, v) => f.options?.find(o => typeof o === 'object' && o.label?.toLowerCase() === String(v).toLowerCase())?.value ?? v
// the fields as a prompt takes them: their defaults (upscale's creativity, extend's direction…), an element as @name, an
// option's label as its value, a style of the Library as its words with its images apart (looks), or only its words in
// a keyframe (its images made it)
function prepared(tool, spec, keyframe = false) {
  const fields = { ...Object.fromEntries(tool.fields.filter(f => f.default !== undefined).map(f => [f.key, String(f.default)])), ...spec.fields }, looks = []
  for (const f of tool.fields) {
    const s = f.type === 'style' && savedStyle(fields[f.key])
    if (s && (s.for ?? null) !== (f.for ?? null)) throw userError(`${s.name} is a ${s.for ?? 'visual'} style: ${f.label} takes a ${f.for ?? 'visual'} style (media.mjs styles)`)
    if (s) keyframe ? (fields[f.key] = s.words || s.name) : (looks.push(...s.files), (fields[f.key] = s.text))
    else if (f.type === 'element' && String(fields[f.key] ?? '').trim()) fields[f.key] = elementFields(f, fields[f.key])
    else if (fields[f.key] != null) fields[f.key] = optionValue(f, fields[f.key])
  }
  return { fields, looks }
}

// ---------- the Library: Elements and styles, cited with @name ----------

// an Element's type says what its images are to the model; a voice (spoken) and a singer (sung) hold clips, picked in
// Audio's fields, never in words. One made before the types is « other »
const TYPES = ['character', 'outfit', 'object', 'location', 'pose', 'brand', 'voice', 'singer', 'other']
const heard = type => type === 'voice' || type === 'singer'
const NAME = /^(?!(?:con|prn|aux|nul|com\d|lpt\d)$)[\w-]+$/i
// an Element (elements/<name>/): its images (a voice's clips) and element.json: its type, its words, a brand's colors and
// typeface, a voice's ElevenLabs id once it is on the account, a singer's Suno persona or voice, a character's own voice
// (a voice of the Library)
function element(name) {
  const d = at('elements', String(name ?? ''))
  if (!NAME.test(name ?? '') || !fs.existsSync(d) || !fs.statSync(d).isDirectory()) return null
  const meta = fs.existsSync(path.join(d, 'element.json')) ? readJson(path.join(d, 'element.json')) : {}
  const type = TYPES.includes(meta.type) ? meta.type : 'other'
  const files = fs.readdirSync(d).filter(f => kindOfFile(f) === (heard(type) ? 'audio' : 'image')).sort().map(f => path.join(d, f))
  // a singer from a song keeps its cover as its picture
  const cover = heard(type) && fs.existsSync(path.join(d, 'cover.jpg')) ? path.join(d, 'cover.jpg') : null
  return { name, type, words: meta.words ?? '', colors: meta.colors ?? [], font: meta.font ?? '', voice_id: meta.voice_id ?? null, voice: meta.voice ?? null, suno: meta.suno ?? null, cover, files }
}
const elementList = () => (fs.existsSync(at('elements')) ? fs.readdirSync(at('elements')).sort().map(element).filter(Boolean) : [])

// a file copied into an Element's or a style's folder: a result keeps its job in its name (each job has its out-1.png),
// an upload loses its time stamp; the same file again is skipped, another of the same name gets -2, -3…
function copyIn(dir, f) {
  const job = inside(at('media'), f) && path.basename(path.dirname(f))
  let name = job ? `${job}-${path.basename(f)}` : path.basename(f).replace(/^\d+-/, '')
  const { name: base, ext } = path.parse(name), size = fs.statSync(f).size
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) {
    if (fs.statSync(path.join(dir, name)).size === size) return
    name = `${base}-${i}${ext}`
  }
  fs.copyFileSync(f, path.join(dir, name))
}
// the results of generations (--from <id>, several, or ids joined by commas) of one medium
function outputsOf(ids, kind) {
  return (ids ?? []).flatMap(x => x.split(',')).map(x => path.basename(x.trim())).filter(Boolean).flatMap(id => {
    const j = fs.existsSync(path.join(mediaDir(id), 'job.json')) ? readJob(id) : null
    if (!j) throw userError(`no generation ${id} (media.mjs jobs)`)
    if (j.status !== 'done') throw userError(`${id} is ${j.status}, not done`)
    const files = j.outputs.filter(f => kindOfFile(f) === kind).map(f => path.join(mediaDir(id), f))
    if (!files.length) throw userError(`${id} made no ${kind}`)
    return files
  })
}

// adds files to an Element (made when new) and sets what is given: its type, words, a brand's colors and typeface;
// from: generations whose results join it; drop: file names taken out
// the References tool that makes more views of an Element of a type
const REF_TOOLS = { character: 'character', outfit: 'outfit', object: 'object', location: 'location', pose: 'pose' }
function saveElement(name, { type, words, colors, font, voice, files = [], from = [], drop = [], workspace: ws }) {
  if (!NAME.test(name ?? '')) throw userError('an Element\'s name is letters, digits, - and _')
  const now = element(name), t = type ?? now?.type ?? 'other'
  if (!TYPES.includes(t)) throw userError(`the types are ${TYPES.join(', ')}`)
  const want = heard(t) ? 'audio' : 'image', all = [...files, ...outputsOf(from, want)]
  const odd = all.find(f => kindOfFile(f) !== want)
  if (odd) throw userError(`${path.basename(odd)} is not ${want === 'audio' ? `a sound: a ${t} takes clips` : 'an image'}`)
  if (!now && !all.length) throw userError(`a new Element takes ${want === 'audio' ? `a ${t === 'singer' ? 'sung' : 'voice'} clip` : 'an image'} or more`)
  // a character's own voice: a voice of the Library ('' takes it off), heard when it speaks (Kling 4.0)
  const own = voice === undefined ? now?.voice ?? undefined : String(voice).replace(/^@/, '') || undefined
  if (own && t !== 'character') throw userError('only a character has a voice of its own')
  if (own && element(own)?.type !== 'voice') throw userError(`no voice @${own} in the Library (elements add ${own} <clips…> --type voice)`)
  // an Element of images has 2 at least: Kling takes 2 to 4 views of each, and every model reads it better
  const kept = new Set([...(now?.files ?? []).map(f => path.basename(f)), ...all.map(f => path.basename(f))].filter(f => !drop.map(d => path.basename(d)).includes(f)))
  if (want === 'image' && kept.size < 2) {
    const tool = REF_TOOLS[t]
    throw userError(`an Element takes 2 images at least, @${name} would have ${kept.size}: ${tool ? `make another view from it with ${tool} (media.mjs image --tool ${tool} --in references=<its image>, its estimate then the user's yes), then add it (--from <that generation>)` : 'add a second one (another version or angle)'}`)
  }
  ensureHome()
  const d = at('elements', name)
  fs.mkdirSync(d, { recursive: true })
  for (const f of all) copyIn(d, f)
  for (const f of drop) fs.rmSync(path.join(d, path.basename(f)), { force: true })
  writeJson(path.join(d, 'element.json'), clean({ type: t, words: (words ?? now?.words ?? '').trim(),
    ...(t === 'brand' ? { colors: colors ?? now?.colors ?? [], font: (font ?? now?.font ?? '').trim() } : {}), voice_id: now?.voice_id ?? undefined, suno: now?.suno ?? undefined, voice: own }))
  // a new one is linked to the workspace asked (null: none), else the current one
  const to = ws === undefined ? currentWorkspace() : ws
  if (!now && to && workspace(to)) saveWorkspace(to, { elements: [...workspace(to).elements, name] })
  return element(name)
}

// a voice of the Library on the ElevenLabs account (an instant clone), for Change voice: its id kept with it
function voiceToEleven(name) {
  const v = element(name)
  if (v?.type !== 'voice') throw userError(`@${name} is not a voice of the Library`)
  const r = videoMjs(['voice-clone', name, ...v.files])
  if (r.status !== 0) throw userError((r.stderr || r.stdout).trim().split('\n').pop().replace(/^error: /, ''))
  const id = r.stdout.match(/voice: (\S+)/)?.[1]
  if (!id) throw userError('ElevenLabs gave no voice id')
  const f = at('elements', name, 'element.json')
  writeJson(f, { ...(fs.existsSync(f) ? readJson(f) : {}), voice_id: id })
  return element(name)
}

// a voice designed or remixed by ElevenLabs (Design a voice, Remix a voice), one of its previews, kept: made a voice of
// the account (free, no clone) and of the Library, its preview its clip
async function keepVoice(id, file, name) {
  const job = fs.existsSync(path.join(mediaDir(id ?? '-'), 'job.json')) ? readJob(id) : null, v = job?.voices?.find(x => x.file === file)
  if (!v) throw userError(`${file} is not a voice of ${id}: a result of Design a voice or Remix a voice (preview-1.mp3 to preview-3.mp3)`)
  if (!NAME.test(name ?? '')) throw userError('a voice\'s name is letters, digits, - and _')
  if (element(name)) throw userError(`@${name} is in the Library already: another name`)
  const words = String(job.spec.fields?.description ?? '').trim()
  const { voice_id } = await DIRECT.elevenlabs.keepVoice({ name, description: words || name, generated_voice_id: v.generated_voice_id })
  saveElement(name, { type: 'voice', words, files: [path.join(mediaDir(id), file)], workspace: job.workspaces?.[0] })
  const f = at('elements', name, 'element.json')
  writeJson(f, { ...readJson(f), voice_id })
  return element(name)
}

// how the prompt names an Element: what it is and where its images are, then its words
const CITED = {
  character: w => `the character in ${w}`, outfit: w => `the outfit in ${w}`, object: w => `the object in ${w}`, location: w => `the place in ${w}`,
  pose: w => `the pose in ${w}: only its body pose, never its face, clothes or place`, brand: w => `the brand in ${w}: its logo reproduced exactly`, other: w => `shown in ${w}`,
}
function cite(el, where) {
  const brand = el.type === 'brand' ? [el.colors.length && `its colors ${el.colors.join(', ')}`, el.font && `the typeface ${el.font}`] : []
  return [CITED[el.type](where), ...brand, el.words].filter(Boolean).join(', ')
}
// the Elements an @name cites, in order: their images join the references after the tool's (from: the place of the
// first), the name reads as what they are and where (« Lulu (the character in images 2 to 3) »), once; a voice, a style
// (picked in a Style field) or an unknown name stays as written. keyframe: they are in the keyframe, named so
function mentions(text, kind, from, keyframe = false) {
  const refs = [], done = new Set()
  const out = text.replace(/@([\w-]+)/g, (all, name) => {
    if (done.has(name)) return name
    const el = element(name)
    if (!el || heard(el.type) || !el.files.length) return all
    // in a keyframe already: « Papi (the character in the keyframe, …) », its images not sent again
    const where = keyframe ? 'the keyframe' : placeOf(kind, from + refs.length, el.files.length)
    if (!keyframe) refs.push(...el.files)
    done.add(name)
    return `${name} (${cite(el, where)})`
  })
  return { text: out, refs }
}

// the @Elements of a prompt as Kling's named elements: each name (letters, digits, _) cited as is, its words and 2 to 4
// images; an Element of one image, too many, or Elements beside a frame where the model takes none, said before sending
function klingElements(text, m, spec) {
  const elements = [], voices = [], seen = new Map()
  const out = text.replace(/@([\w-]+)/g, (all, name) => {
    const el = element(name)
    // a voice of the Library, cited the same on Kling 4.0 (its voices)
    if (el?.type === 'voice' && el.files.length && m.params.named_voices) {
      if (!seen.has(name)) (seen.set(name, name.replace(/-/g, '_').slice(0, 20)), voices.push({ name: seen.get(name), file: el.files[0] }))
      return `@${seen.get(name)}`
    }
    if (!el || heard(el.type) || !el.files.length) return all
    if (!seen.has(name)) {
      if (el.files.length < 2) throw userError(`@${name} has 1 image: ${m.name} takes 2 to 4 views of an Element. ${REF_TOOLS[el.type] ? `Make another with media.mjs image --tool ${REF_TOOLS[el.type]} --in references=<its image> (its estimate, then the user's yes), then media.mjs elements set ${name} --from <that generation>` : `Add a second image: media.mjs elements set ${name} <file>`}`)
      seen.set(name, name.replace(/-/g, '_').slice(0, 20))
      // a character's own voice (Kling 4.0's voice_url), its first clip
      const voice = m.params.element_voice && el.type === 'character' && el.voice ? element(el.voice)?.files[0] : undefined
      const vs = m.params.element_voice_seconds, long = voice && vs ? probe(voice).duration ?? 0 : null
      if (long != null && (long < vs[0] - 0.05 || long > vs[1] + 0.05)) throw userError(`${m.name} takes a character's voice of ${vs[0]} to ${vs[1]} s: @${el.voice}'s first clip is ${long.toFixed(1)} s`)
      elements.push({ name: seen.get(name), words: el.words, type: el.type, files: el.files.slice(0, 4), ...(voice ? { voice } : {}) })
    }
    return `@${seen.get(name)}`
  })
  if (elements.length > m.params.elements) throw userError(`${m.name} takes ${m.params.elements} Elements, this cites ${elements.length}`)
  if (voices.length > m.params.named_voices) throw userError(`${m.name} takes ${m.params.named_voices} voices, this cites ${voices.length}`)
  if (elements.length && !m.params.elements_with_frames && ['first_frame', 'last_frame'].some(k => spec.inputs?.[k]?.length))
    throw userError(`${m.name} takes no Element with a first or last frame: remove the frame or the @names`)
  return { text: out, elements, voices }
}

// an element field's value: a name of the Library (with or without its @), of a type the field takes, written @name so
// the prompt cites it like the user's own words
function elementField(f, v) {
  const name = String(v).trim().replace(/^@/, ''), el = element(name)
  if (!el || heard(el.type) || !el.files.length) throw userError(`${f.label}: no element @${name} in the Library (media.mjs elements)`)
  if (f.types && !f.types.includes(el.type)) throw userError(`${f.label}: @${name} is ${el.type === 'other' ? 'untyped' : `${/^[aeiou]/.test(el.type) ? 'an' : 'a'} ${el.type}`}, this takes ${f.types.join(' or ')}`)
  return `@${name}`
}

// a field of several Elements (Object swap's « With »: @Papi, @Coat): each checked, worded by its type when the field
// says how (a place « as the setting », a pose « the pose of »), joined
function elementFields(f, v) {
  const names = f.multiple ? String(v).split(/[\s,]+/).filter(Boolean) : [v]
  return names.map(n => { const at = elementField(f, n); return (f.by_type?.[element(at.slice(1)).type] ?? '{}').replace('{}', at) }).join(', ')
}

// a style of the Library (styles/<name>/): its images go last among the references, and the prompt cites them by
// their place with the words on its look. A name, never a preset's value (those are sentences). A sound style (for
// music, a voice or a sound) is its words alone, sent as they are
const SOUND_STYLES = ['music', 'voice', 'sound']
function savedStyle(name) {
  const d = at('styles', String(name ?? ''))
  if (!NAME.test(name ?? '') || !fs.existsSync(d)) return null
  const { words = '', for: family } = fs.existsSync(path.join(d, 'style.json')) ? readJson(path.join(d, 'style.json')) : {}
  if (SOUND_STYLES.includes(family)) return { name, for: family, files: [], words, text: words }
  const files = fs.readdirSync(d).filter(f => kindOfFile(f) === 'image').sort().map(f => path.join(d, f))
  const [its, img] = files.length === 1 ? ['its', 'reference image'] : ['their', `${files.length} reference images`]
  return { name, files, words, text: `the last ${img}: ${its} medium, palette, line work, texture and light, never ${its} subject or content${words ? ` (${words})` : ''}` }
}
const savedStyles = () => (fs.existsSync(at('styles')) ? fs.readdirSync(at('styles')).sort().map(savedStyle).filter(s => s?.files.length || s?.for) : [])

// ---------- workspaces: a project's media and Elements, and its timeline ----------

// workspaces/<slug>/workspace.json: its name, the Elements linked by hand, its timeline. Its media say it themselves
// (job.json's workspaces), so one can be in several and a deleted one leaves nothing behind. The timeline's tracks go
// top to bottom (the first video track covers the ones under it, the last one is the main track, its shots end to end);
// a clip plays a file of a generation (job, file) from in to out, at a time on the timeline (seconds), so a moved
// folder keeps it; placed: the results already laid there by a Bridge shot or a take; rev: one more at each save, so a
// page holding an older copy takes the new one instead of writing over it
const TIMELINE = { ratio: null, tracks: [{ id: 'v1', kind: 'video' }, { id: 'a1', kind: 'audio' }], clips: [], placed: [], rev: 0 }
// a clip's file: its generation's folder and the file's name (a clip saved before kept a whole path)
const clipFile = c => path.join(mediaDir(path.basename(String(c.job ?? ''))), path.basename(String(c.file ?? c.path ?? '')))
// the frames of a video's strip on the timeline
const STRIP = 20
const RATIOS = { '16:9': [1280, 720], '9:16': [720, 1280], '1:1': [720, 720], '4:5': [720, 900] }
const SLUG = /^[a-z0-9-]+$/
const wsFile = slug => at('workspaces', slug, 'workspace.json')
function workspace(slug) {
  if (!SLUG.test(slug ?? '') || !fs.existsSync(wsFile(slug))) return null
  const w = readJson(wsFile(slug)), t = { ...TIMELINE, ...w.timeline }
  return { slug, name: w.name ?? slug, created: w.created, elements: (w.elements ?? []).filter(n => element(n)),
    timeline: { ...t, clips: t.clips.map(c => ({ ...c, file: path.basename(c.file ?? c.path), path: clipFile(c) })) } }
}
const workspaceList = () => (fs.existsSync(at('workspaces')) ? fs.readdirSync(at('workspaces')).sort().map(workspace).filter(Boolean) : [])
const currentWorkspace = () => (workspace(settings().workspace.current) ? settings().workspace.current : 'default')
const saveWorkspace = (slug, patch) => {
  const { slug: _, ...w } = workspace(slug)
  writeJson(wsFile(slug), { ...w, timeline: { ...w.timeline, clips: w.timeline.clips.map(({ path: _p, ...c }) => c) }, ...patch })
}
function useWorkspace(slug) {
  if (!workspace(slug)) throw userError(`no workspace ${slug} (media.mjs workspaces)`)
  const s = settings()
  s.workspace.current = slug
  writeJson(at('settings.json'), s)
}
function newWorkspace(name) {
  name = String(name ?? '').trim()
  if (!name || name.length > 60) throw userError('a workspace\'s name is 1 to 60 characters')
  ensureHome()
  let slug = slugOf(name)
  for (let i = 2; fs.existsSync(wsFile(slug)); i++) slug = `${slugOf(name)}-${i}`
  writeJson(wsFile(slug), { name, created: new Date().toISOString(), elements: [], timeline: TIMELINE })
  return slug
}
// the generations of the folder, each read once
const allJobs = () => (fs.existsSync(at('media')) ? fs.readdirSync(at('media')).filter(d => fs.existsSync(path.join(mediaDir(d), 'job.json'))).map(readJob) : [])
// a generation joins or leaves a workspace
function member(slug, ids, on) {
  for (const id of ids ?? []) {
    if (!fs.existsSync(path.join(mediaDir(path.basename(id)), 'job.json'))) throw userError(`no generation ${id} (media.mjs jobs)`)
    const j = readJob(path.basename(id)), list = (j.workspaces ?? []).filter(s => s !== slug)
    j.workspaces = on ? [...list, slug] : list
    saveJob(j)
  }
}
// a workspace goes, never its media: they only leave it (a new workspace of the same name starts empty)
function removeWorkspace(slug) {
  if (slug === 'default') throw userError('the Default workspace stays')
  for (const j of allJobs().filter(j => j.workspaces?.includes(slug))) member(slug, [j.id], false)
  fs.rmSync(at('workspaces', slug), { recursive: true, force: true })
  if (settings().workspace.current === slug) useWorkspace('default')
}
// the Elements of a workspace: linked by hand, or cited by one of its generations (@name, an element field)
function linkedElements(slug, jobs = allJobs()) {
  const names = new Set(workspace(slug).elements)
  for (const j of jobs.filter(j => j.workspaces?.includes(slug))) {
    for (const m of String(j.spec?.prompt ?? '').matchAll(/@([\w-]+)/g)) names.add(m[1])
    const tool = TOOLS[j.kind]?.find(t => t.id === j.tool)
    for (const f of tool?.fields.filter(f => f.type === 'element') ?? []) if (j.spec?.fields?.[f.key]) names.add(String(j.spec.fields[f.key]).replace(/^@/, ''))
  }
  return [...names].filter(n => element(n)).sort()
}

// a timeline from the page, kept only as it should be: known tracks, files of the folder, times in order
function cleanTimeline(t) {
  const tracks = (Array.isArray(t?.tracks) ? t.tracks : []).filter(x => NAME.test(x?.id ?? '') && ['video', 'audio'].includes(x.kind)).map(x => clean({ id: x.id, kind: x.kind, off: x.off ? true : undefined }))
  const fin = x => Number.isFinite(+x) && +x >= 0
  const clips = (Array.isArray(t?.clips) ? t.clips : []).filter(c => NAME.test(c?.id ?? '') && NAME.test(c?.job ?? '') && tracks.some(x => x.id === c.track) && fs.existsSync(clipFile(c)) && fin(c.at) && fin(c.in) && fin(c.out) && +c.out > +c.in)
    .map(c => clean({ id: c.id, track: c.track, job: c.job, file: path.basename(clipFile(c)), at: +c.at, in: +c.in, out: +c.out, volume: fin(c.volume) ? Math.min(2, +c.volume) : undefined, dur: fin(c.dur) ? +c.dur : undefined }))
  return { ratio: t?.ratio in RATIOS ? t.ratio : null, tracks, clips, placed: (Array.isArray(t?.placed) ? t.placed : []).map(String) }
}
// what a timeline plays: the clips of tracks left on, each with its track's kind and place from the top
function liveClips(t) {
  return t.clips.flatMap(c => {
    const i = t.tracks.findIndex(x => x.id === c.track), tr = t.tracks[i]
    return tr && !tr.off ? [{ ...c, kind: tr.kind, layer: i, len: +(c.out - c.in).toFixed(3), still: kindOfFile(c.path) === 'image' }] : []
  }).sort((a, b) => a.at - b.at)
}
// its format: the one set, else the closest to its first video clip's
function ratioFor(t, clips = liveClips(t)) {
  if (t.ratio) return t.ratio
  const first = clips.find(c => c.kind === 'video')
  const s = first && probe(first.path), gap = r => Math.abs(Math.log(RATIOS[r][0] / RATIOS[r][1] / (s.width / s.height)))
  return s?.width ? Object.keys(RATIOS).sort((a, b) => gap(a) - gap(b))[0] : '16:9'
}
const secs = x => x.toFixed(2)
const trackName = (t, tr) => {
  const same = t.tracks.filter(x => x.kind === tr.kind)
  return tr.kind === 'video' ? `V${same.length - same.indexOf(tr)}` : `A${same.indexOf(tr) + 1}`
}
// the edit in words, for video-editor (Copy prompt, EDIT.md, workspaces show): every clip's times, file and sound
function editText(slug, file = c => c.path) {
  const w = workspace(slug), t = w.timeline, clips = liveClips(t)
  if (!clips.length) return null
  const total = Math.max(...clips.map(c => c.at + c.len)), video = t.tracks.filter(x => x.kind === 'video' && !x.off)
  const lines = [
    `Make a video from my media-generator workspace "${w.name}", following its timeline exactly: ${ratioFor(t, clips)}, ${secs(total)} s.`,
    'Times are seconds on the timeline; a clip\'s source range is in its own file\'s seconds. Every file is a clip (edit.json\'s media), there is no speech source to transcribe. Gaps are black and silent.',
  ]
  for (const tr of t.tracks.filter(x => !x.off)) {
    const mine = clips.filter(c => c.track === tr.id)
    if (!mine.length) continue
    const under = video.indexOf(tr) < video.length - 1 ? `, over ${trackName(t, video.at(-1))}` : video.length > 1 ? ', the base' : ''
    lines.push('', `${trackName(t, tr)} (${tr.kind}${tr.kind === 'video' ? under : ''}):`)
    for (const c of mine) {
      const vol = c.volume ?? 1, sound = c.still ? 'a still' : tr.kind === 'audio' ? `volume ${Math.round(vol * 100)} %` : !probe(c.path).audio ? 'no sound' : vol ? `its sound at ${Math.round(vol * 100)} %` : 'its sound muted'
      lines.push(`- ${secs(c.at)}–${secs(c.at + c.len)}  ${file(c)}${c.still ? '' : `, source ${secs(c.in)}–${secs(c.out)}`}, ${sound}`)
    }
  }
  lines.push('', 'Keep these cuts, their order and their timings; ask me before changing any.')
  return lines.join('\n')
}
// a .zip of files as they are (stored: media are compressed already), streamed to the page
// ponytail: no ZIP64, so 4 GB in all at most; add it when a workspace outgrows that
async function sendZip(res, name, entries) {
  const d = new Date(), dos = ((((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) << 16 | (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) >>> 0
  res.writeHead(200, { 'content-type': 'application/zip', 'content-disposition': `attachment; filename="${encodeURIComponent(name)}.zip"` })
  const write = b => new Promise(ok => (res.write(b) ? ok() : res.once('drain', ok)))
  const central = []
  let offset = 0
  for (const e of entries) {
    let crc = 0
    if (e.data) crc = zlib.crc32(e.data)
    else for await (const c of fs.createReadStream(e.file)) crc = zlib.crc32(c, crc)
    const size = e.data ? e.data.length : fs.statSync(e.file).size, n = Buffer.from(e.name)
    // the fields both headers share: version 2.0, UTF-8 names, stored, the time, the CRC, both sizes, the name's length
    const common = Buffer.alloc(26)
    common.writeUInt16LE(20, 0); common.writeUInt16LE(0x0800, 2); common.writeUInt32LE(dos, 6); common.writeUInt32LE(crc >>> 0, 10)
    common.writeUInt32LE(size, 14); common.writeUInt32LE(size, 18); common.writeUInt16LE(n.length, 22)
    const sig = x => { const b = Buffer.alloc(4); b.writeUInt32LE(x); return b }
    await write(Buffer.concat([sig(0x04034b50), common, n]))
    if (e.data) await write(e.data)
    else for await (const c of fs.createReadStream(e.file)) await write(c)
    // the central entry: made by 2.0, the same fields, then no extra, comment, disk or attributes, and where it starts
    const where = Buffer.alloc(16)
    where.writeUInt32LE(offset, 12)
    central.push(Buffer.concat([sig(0x02014b50), Buffer.from([20, 0]), common.subarray(0, 24), where, n]))
    offset += 30 + n.length + size
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  await write(cd)
  res.end(end)
}
// a workspace's files in the zip, under its name: its media by medium, its Elements, and with edit its timeline and the
// edit in words
function zipEntries(slug, edit) {
  const w = workspace(slug), root = w.name.replace(/[/\\:*?"<>|]/g, '-'), jobs = allJobs()
  const DIRS = { image: 'images', video: 'videos', audio: 'audio' }, entries = [], named = new Map()
  for (const j of jobs.filter(j => j.workspaces?.includes(slug) && j.status === 'done'))
    for (const o of j.outputs) {
      const k = kindOfFile(o), file = path.join(mediaDir(j.id), o)
      if (DIRS[k] && fs.existsSync(file)) (named.set(file, `${DIRS[k]}/${j.id}-${o}`), entries.push({ name: `${root}/${DIRS[k]}/${j.id}-${o}`, file }))
    }
  for (const name of linkedElements(slug, jobs)) for (const f of fs.readdirSync(at('elements', name))) entries.push({ name: `${root}/elements/${name}/${f}`, file: at('elements', name, f) })
  if (edit) {
    const t = w.timeline, rel = c => `../${named.get(c.path) ?? path.relative(HOME, c.path).split(path.sep).join('/')}`
    entries.push({ name: `${root}/edit/timeline.json`, data: Buffer.from(JSON.stringify({ ...t, clips: t.clips.map(c => ({ ...c, file: rel(c) })) }, null, 2) + '\n') })
    const text = editText(slug, rel)
    if (text) entries.push({ name: `${root}/edit/EDIT.md`, data: Buffer.from(`# ${w.name}: the edit\n\nThe files are named from this folder (edit/).\n\n${text}\n`) })
  }
  return { root, entries }
}

// the first value of a list the model accepts, preferring the wanted ones in order
const pick = (list, ...wanted) => (list?.length ? wanted.find(w => w !== undefined && list.includes(w)) ?? list[0] : undefined)

// the model's ratio closest to an image's (a first frame, an avatar's photo)
function ratioOf(list, file) {
  const s = probe(file), gap = x => { const [a, b] = x.split(':'); return Math.abs(Math.log(a / b / (s.width / s.height))) }
  return (list ?? []).filter(x => /^\d+:\d+$/.test(x)).sort((x, y) => gap(x) - gap(y))[0]
}

// a source video the model would refuse as too small (Seedance 2.5 wants 407,696 pixels: a 848×480 480p has 407,040,
// 2026-10-30), scaled up just enough, its ratio kept
function atLeast(file, pixels) {
  const s = probe(file)
  if (!pixels || !s.width || s.width * s.height >= pixels) return file
  const k = Math.sqrt(pixels / (s.width * s.height)), even = x => Math.ceil((x * k) / 2) * 2
  const out = at('.cache', `min-${createHash('sha1').update(JSON.stringify([file, fs.statSync(file).mtimeMs, pixels])).digest('hex').slice(0, 12)}.mp4`)
  if (!fs.existsSync(out)) (fs.mkdirSync(path.dirname(out), { recursive: true }), ffmpeg(['-i', file, '-vf', `scale=${even(s.width)}:${even(s.height)}:flags=lanczos`, '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'copy', out]))
  return out
}

// expand's canvas: the image with margins (top, right, bottom, left: a share of its height or width, the frame up to 3
// times the image each way) in flat gray, at most 2048 px on its long side
function expandCanvas(file, fields) {
  const [t, r, b, l] = ['top', 'right', 'bottom', 'left'].map(k => Math.min(2, Math.max(0, +fields?.[k] || 0)))
  if (!(t + r + b + l)) throw userError('drag the frame wider or taller first (--field left=0.25 --field right=0.25: a share of the image on each side)')
  const s = probe(file), even = x => Math.ceil(x / 2) * 2
  const w = even(s.width * Math.min(3, 1 + l + r)), h = even(s.height * Math.min(3, 1 + t + b))
  const x = Math.min(Math.round(s.width * l), w - s.width), y = Math.min(Math.round(s.height * t), h - s.height)
  // the same frame of the same file is made once: the dashboard asks an estimate at every change
  const out = at('.cache', `expand-${createHash('sha1').update(JSON.stringify([file, fs.statSync(file).mtimeMs, w, h, x, y])).digest('hex').slice(0, 12)}.png`)
  if (fs.existsSync(out)) return out
  fs.mkdirSync(path.dirname(out), { recursive: true })
  ffmpeg(['-i', file, '-vf', `pad=${w}:${h}:${x}:${y}:color=0x808080,scale='if(gte(iw,ih),min(2048,iw),-2)':'if(gte(iw,ih),-2,min(2048,ih))'`, '-frames:v', '1', '-update', '1', out])
  return out
}

// what to send and what to estimate, for a router model
function routerRequest(kind, tool, spec, m, prompt, refsFromMentions) {
  const files = key => spec.inputs?.[key] ?? []
  const p = { ...tool.params, ...spec.params }
  // a voice style preset on a model that reads audio tags (ElevenLabs v3, v4: they take no « how it sounds ») goes as
  // its tags before the words, before each line of a dialogue
  const said = tool.fields.find(f => f.key === 'instructions'), cue = m.params?.tags && said?.options?.find?.(o => o.value === optionValue(said, spec.fields?.instructions ?? ''))?.tags
  if (cue) {
    prompt &&= `${cue} ${prompt}`
    p.dialogue &&= p.dialogue.map(l => (String(l.text ?? '').trim() ? { ...l, text: `${cue} ${l.text}` } : l))
  }
  if (m.provider === 'elevenlabs') return m.role === 'speech' ? elevenRequest(m, prompt, p, !!spec.probe) : elevenAudio(spec, m, p, !!spec.probe)
  // the model's own settings (its Options), checked; sent only when some are asked
  const options = optionValues(m, p.options), own = Object.keys(options).length ? { options } : {}
  if (kind === 'image') {
    const refs = [...tool.inputs.filter(i => i.kind !== 'matte').flatMap(i => files(i.key)), ...refsFromMentions]
    const params = clean({
      n: m.params.n ? Math.min(Math.max(+p.n || 1, m.params.n.min ?? 1), m.params.n.max ?? 1) : undefined,
      resolution: pick(m.params.resolution, p.resolution, '2K', '1K'),
      // an edit asks its image's ratio (the closest the model takes) unless another is asked: left to itself, Nano Banana
      // Pro answered a 16:9 frame in a 1:1 crop (2026-10-30)
      aspect_ratio: p.aspect_ratio ? pick(m.params.aspect_ratio, p.aspect_ratio) : files('image')[0] ? ratioOf(m.params.aspect_ratio, files('image')[0]) : refs.length ? undefined : pick(m.params.aspect_ratio, '1:1'),
      quality: pick(m.params.quality, p.quality, 'high'), background: p.background ? pick(m.params.background, p.background) : undefined, seed: m.params.seed ? p.seed : undefined,
    })
    if (refs.length > (m.params.references ?? 0)) throw userError(`${m.name} takes ${m.params.references ?? 0} reference images, this asks for ${refs.length}`)
    const size = f => { try { const s = probe(f); return [s.width, s.height] } catch { return [] } }
    return { send: { model: m.model, prompt, refs: refs.map(dataUrl), ...params, ...own }, estimate: { n: params.n, resolution: params.resolution, quality: params.quality, ratio: params.aspect_ratio, text: prompt?.length, refs: refs.length, sizes: refs.map(size) } }
  }
  if (kind === 'video') {
    if (p.draft_of) return draftFinal(m, p, own)
    const video = files('video')[0], source = video ? probe(video) : null, avatar = m.role === 'avatar'
    // an avatar takes its photo as a reference, not as a frame
    const frames = clean({ first_frame: avatar ? undefined : files('first_frame')[0], last_frame: files('last_frame')[0] })
    for (const f of Object.keys(frames)) if (!m.params.frames.includes(f)) throw userError(`${m.name} takes no ${f.replace('_', ' ')}: pick another model`)
    const images = [...(avatar ? files('first_frame') : []), ...files('references'), ...files('sketch'), ...refsFromMentions]
    if (m.params.references != null && images.length > m.params.references) throw userError(`${m.name} takes ${m.params.references} reference images, this asks for ${images.length}`)
    // with a frame, OpenRouter keeps the frames and drops the reference images (Seedance on Kie refuses both): never
    // sent for nothing, unless the model takes both (Kling's elements beside its frames)
    // a model's reference videos and sounds (omni references: Kling 4.0, Seedance, Wan 3.0, Hailuo 3, Vidu Q4), beside the
    // video an edit changes, each as long as the model takes them
    const refVideos = files('ref_videos'), refAudios = files('ref_audios'), videos = refVideos.length + (video ? 1 : 0)
    if (refVideos.length && videos > (m.params.videos ?? 0)) throw userError(`${m.name} takes ${m.params.videos ?? 0} video${m.params.videos === 1 ? '' : 's'}${video ? ', the one it edits included' : ''}, this has ${videos}`)
    if (refAudios.length > (m.params.audios ?? 0)) throw userError(`${m.name} takes ${m.params.audios ?? 0} reference sounds, this has ${refAudios.length}`)
    const rs = m.params.ref_seconds, longOf = f => probe(f).duration ?? 0, refSeconds = refVideos.reduce((n, f) => n + longOf(f), 0)
    for (const [what, list] of rs ? [['video', refVideos], ['sound', refAudios]] : []) {
      const long = list.map(longOf), out = long.findIndex(d => d < rs.each[0] - 0.05 || d > rs.each[1] + 0.05)
      if (out >= 0) throw userError(`${m.name} takes reference ${what}s of ${rs.each[0]} to ${rs.each[1]} s, ${path.basename(list[out])} is ${long[out].toFixed(1)} s: cut it`)
      if (rs.total && long.reduce((n, d) => n + d, 0) > rs.total + 0.05) throw userError(`${m.name} takes ${rs.total} s of reference ${what}s in all, these last ${long.reduce((n, d) => n + d, 0).toFixed(1)} s`)
    }
    if (!avatar && !m.params.mix && (images.length || refVideos.length || refAudios.length) && (Object.keys(frames).length || files('mid_frames').length)) throw userError(`a first, middle or last frame and references do not go together on ${m.name}: remove one or the other; a Library style's images are references too`)
    const refs = [...images.map(f => ({ kind: 'image', file: f })), ...(video ? [{ kind: 'video', file: atLeast(video, m.params.min_pixels), source: true }] : []), ...refVideos.map(f => ({ kind: 'video', file: f })),
      ...files('audio').map(f => ({ kind: 'audio', file: f })), ...refAudios.map(f => ({ kind: 'audio', file: f }))]
    if (video && m.params.videos === 0 && !['edit', 'upscale'].includes(m.role)) throw userError(`${m.name} takes no video: pick another model`)
    // Kie takes the files by its own upload; OpenRouter fetches them through a tunnel
    if (refs.some(r => r.kind !== 'image') && !PROVIDERS[m.provider].upload && !hasBin('cloudflared')) throw userError(`a video or a voice reaches OpenRouter through a Cloudflare tunnel: ${INSTALL.cloudflared} (no account)`)
    const upscale = m.role === 'upscale', edit = !!video, still = files('first_frame')[0] ?? files('last_frame')[0]
    // a keyframe (Aleph 2): an edited frame at its time in the video, 5 MB at most as a data: URI
    const keyframe = files('keyframe')[0]
    if (keyframe && !(+p.frame >= 0 && +p.frame <= source.duration)) throw userError(`the keyframe's time (--frame) is in the video: 0 to ${source.duration.toFixed(1)} s`)
    if (keyframe && fs.statSync(keyframe).size > 5e6) throw userError('a keyframe is 5 MB at most')
    // a model that makes videos (Seedance, Kling 4.0) given one remakes it at the source's length, sent: OpenRouter's 5 s
    // default made a new 5 s video, and its -1 (« follow the video ») is refused; from its shortest duration up
    // (2026-10-31). Seedance 2.5 edits only with -1: sent anyway, for the day OpenRouter takes it
    // (github.com/OpenRouterTeam/typescript-sdk/issues/1096)
    const lengths = edit && (m.model.startsWith('bytedance/') || m.params.videos > 0) && m.params.duration?.length ? [Math.min(...m.params.duration), Math.max(...m.params.duration)] : null
    if (lengths && (source.duration < lengths[0] - 0.05 || source.duration > lengths[1] + 0.05))
      throw userError(`${m.name} takes a video of ${lengths[0]} to ${lengths[1]} s, this one is ${source.duration.toFixed(1)} s: trim or extend it`)
    const params = clean({
      // a model that follows its video (Seedance on Kie) gets -1, the source's own length
      // a video a voice drives (Wan 2.7, a talking avatar on a model of lengths) lasts as long as it, unless asked
      duration: edit ? (m.params.follow || (lengths && m.model === 'bytedance/seedance-2.5') ? -1 : lengths ? pick(m.params.duration, Math.round(source.duration)) : undefined)
        : pick(m.params.duration, num(p.duration) ?? (files('audio')[0] && m.params.duration?.length ? Math.min(Math.max(Math.round(probe(files('audio')[0]).duration), Math.min(...m.params.duration)), Math.max(...m.params.duration)) : undefined), 5),
      resolution: upscale ? undefined : pick(m.params.resolution, p.resolution, '1080p', '720p'),
      // from an image, its own ratio unless one is asked
      aspect_ratio: edit ? undefined : pick(m.params.aspect_ratio, p.aspect_ratio ?? (still && ratioOf(m.params.aspect_ratio, still)), '16:9'),
      generate_audio: m.params.audio ? p.sound !== false : undefined, seed: m.params.seed ? p.seed : undefined,
      creativity: upscale && m.params.creativity ? (spec.fields?.creativity === 'creative' ? 1 : 0) : undefined,
      upscale_factor: upscale && m.params.factor ? +(spec.fields?.factor ?? 2) : undefined,
    })
    // its own editors: the shots' seconds make its length, a draft is 480p
    const ed = videoEditors(m, spec, p, options, params.duration)
    if (ed.duration) params.duration = ed.duration
    if (ed.resolution) params.resolution = ed.resolution
    const send = { model: m.model, ...own, ...ed.send, prompt: upscale && !prompt ? undefined : prompt, frames: Object.fromEntries(Object.entries(frames).map(([k, f]) => [k, dataUrl(f)])),
      // the images inlined, the videos and voices served by a tunnel when the job is submitted
      refs: refs.map(r => (r.kind === 'image' ? { kind: r.kind, url: dataUrl(r.file) } : r)), ...params,
      ...(keyframe ? { keyframes: [{ uri: dataUrl(keyframe), seconds: +p.frame }] } : {}) }
    // a model without durations (an avatar) lasts as long as its voice
    const voice = files('audio')[0]
    // its frames made from the sound's length (Wan 2.2 Speech to Video: 2.5 to 7.5 s)
    const af = m.params.audio_frames, frameCount = af && voice && Math.min(af.max, Math.max(af.min, Math.round((probe(voice).duration * af.fps) / af.step) * af.step))
    if (af && voice && probe(voice).duration > af.max / af.fps + 0.05) throw userError(`${m.name} moves ${af.max / af.fps} s at most: this sound lasts ${probe(voice).duration.toFixed(1)} s, cut it`)
    if (af && voice) send.audio_seconds = probe(voice).duration
    // the sound a talking head takes (OmniHuman 2.0: 4 s at least, Kie's 400 otherwise, 2026-11-01)
    const as = m.params.audio_seconds, said = as && voice ? probe(voice).duration : null
    if (said != null && (said < (as.min ?? 0) - 0.05 || said > (as.max ?? Infinity) + 0.05)) throw userError(`${m.name} takes a sound of ${as.min ? `${as.min} to ` : 'up to '}${as.max} s: this one lasts ${said.toFixed(1)} s`)
    // (a lip sync lasts as long as its voice, the video trimmed or looped)
    return { send, estimate: { duration: (frameCount ? frameCount / af.fps : undefined) ?? (params.duration > 0 ? params.duration : undefined) ?? (m.params.follows_audio && voice ? probe(voice).duration : undefined) ?? source?.duration ?? (voice ? probe(voice).duration : undefined), resolution: params.resolution ?? `${Math.min(source?.width ?? 1920, source?.height ?? 1080)}p`,
      ratio: params.aspect_ratio, sound: params.generate_audio, input: video || refVideos.length ? 'video' : Object.keys(frames).length ? 'image' : 'text',
      images: images.length + Object.keys(frames).length, creativity: spec.fields?.creativity, factor: spec.fields?.factor, width: source?.width, height: source?.height,
      source_duration: source?.duration ?? (refVideos.length ? refSeconds : undefined), min_pixels: m.params.min_pixels } }
  }
  // music, sounds and what follows from them: their own request
  if (m.role !== 'speech') return audioRequest(tool, spec, m, options)
  // speech: a preset voice, or up to 3 clips to clone; a dialogue's lines (Gemini on Kie: two voices)
  const clips = files('voice_clips'), lines = (p.dialogue ?? []).filter(l => String(l.text ?? '').trim())
  if (lines.length) {
    if (!m.params.dialogue) throw userError(`${m.name} speaks one voice: a dialogue goes to Eleven v4 or v3, or Gemini TTS on Kie`)
    const voices = new Set(lines.map(l => l.voice ?? ''))
    if (voices.size > m.params.speakers) throw userError(`${m.name} takes ${m.params.speakers} voices in a dialogue, this one has ${voices.size}`)
    const text = lines.map(l => l.text).join('\n')
    return { send: { model: m.model, text, dialogue: lines.map(l => ({ voice: l.voice || m.params.voices?.[0], text: l.text })), instructions: spec.fields?.instructions || undefined, ...own }, estimate: { text } }
  }
  if (!prompt && !spec.probe) throw userError('write what the voice says (--prompt)')
  if (clips.length && m.params.clone === false) throw userError(`${m.name} clones no voice here: pick one of its voices (--voice), or switch the router to OpenRouter in Settings`)
  const voice = p.voice ?? (clips.length ? undefined : m.params.voices?.[0])
  return { send: { model: m.model, text: prompt, voice, instructions: spec.fields?.instructions || undefined, refs: clips.map(dataUrl), ...own }, estimate: { text: prompt } }
}

// ---------- music and sounds: Suno on Kie, Lyria on OpenRouter ----------

// a song Suno made, found by its file: its task's id and its take's (an extend, a section, the stems, its WAV… go by
// them). A file copied elsewhere (a remix's input) is found by its bytes. With voices, a take's voice taken apart (the
// Singer tool's voice-1.mp3) counts as its take: a persona is made from it
function sunoOf(file, voices = false) {
  const take = (job, name) => {
    const t = job?.suno?.tracks?.find(x => x.file === name || (voices && x.voice === name))
    return t && { task_id: job.suno.task_id, ...t, job: job.id }
  }
  const dir = path.dirname(path.resolve(file)), id = path.basename(dir)
  if (path.dirname(dir) === at('media') && fs.existsSync(path.join(dir, 'job.json'))) {
    const hit = take(readJob(id), path.basename(file))
    if (hit) return hit
  }
  const size = fs.statSync(file).size, hash = f => createHash('sha1').update(fs.readFileSync(f)).digest('hex'), mine = hash(file)
  for (const j of allJobs().filter(j => j.suno?.tracks))
    for (const t of j.suno.tracks)
      for (const name of [t.file, voices && t.voice].filter(Boolean)) {
        const f = path.join(mediaDir(j.id), name)
        if (fs.existsSync(f) && fs.statSync(f).size === size && hash(f) === mine) return { task_id: j.suno.task_id, ...t, job: j.id }
      }
  return null
}
// a stem of a Stems job: its task (MIDI is made from it) and the stem's id when Suno gave one by its name
function stemOf(file) {
  const dir = path.dirname(path.resolve(file)), job = fs.existsSync(path.join(dir, 'job.json')) ? readJob(path.basename(dir)) : null
  if (job?.tool !== 'stems' || !job.suno?.task_id) return null
  // its file is named by Kie after the stem's id and group (<id>_Vocals.mp3, 2026-10-31): by its id first, its group
  // then only as its whole name (Backing_Vocals is not Vocals, 2026-11-01); one instrument taken out is named by its take
  // (Drum_Kit-1.mp3 the instrument alone, without-Drum_Kit-1.mp3 the song without it)
  const norm = k => String(k).toLowerCase().replace(/\s+/g, '_')
  const name = path.parse(file).name.toLowerCase(), list = job.suno.data?.origin_data ?? [], n = +name.match(/-(\d+)$/)?.[1]
  const item = n && list[n - 1]?.extract ? list[n - 1][name.startsWith('without-') ? 'remove' : 'extract']
    : list.find(x => x.id && name.includes(norm(x.id))) ?? list.find(x => [x.stem_type_group_name, x.stem_name].some(k => k && name === norm(k)))
  return { task_id: job.suno.task_id, audio_id: item?.id }
}
// a WAV made here already from this track (each WAV job keeps its tracks' ids in job.wav)
function wavMade({ task_id, audio_id }) {
  for (const j of allJobs()) for (const w of j.wav ?? [])
    if (w.task_id === task_id && w.audio_id === audio_id && fs.existsSync(path.join(mediaDir(j.id), w.file))) return path.join(mediaDir(j.id), w.file)
  return null
}
// a singer of the Library: a persona of a song, or a voice of one's own made a Suno voice
function singerOf(value) {
  const name = String(value ?? '').trim().replace(/^@/, '')
  if (!name) return {}
  const v = element(name)
  if (v?.type !== 'singer' || !(v.suno?.persona_id || v.suno?.voice_id)) throw userError(v?.type === 'singer' ? `@${name} sings with Suno once its phrase is recorded (Library › Elements, or elements suno ${name})` : `@${name} is not a singer of the Library: Make a singer from a Suno song, or add one from sung clips (elements add ${name} <clips…> --type singer)`)
  return v.suno.persona_id ? { persona_id: v.suno.persona_id, persona_model: 'style_persona' } : { persona_id: v.suno.voice_id, persona_model: 'voice_persona' }
}
// where a sound sings the most, for Suno's persona (10 to 30 s): its silences found by ffmpeg, the window of 30 s (or
// all of it) holding the most voice. ponytail: 1 s steps, a song of a few minutes at most
function sungWindow(file) {
  const total = probe(file).duration, len = Math.min(30, total)
  if (total < 10) throw userError(`a singer is made from 10 s of singing at least: ${path.basename(file)} lasts ${total.toFixed(1)} s`)
  const log = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-35dB:d=0.4', '-f', 'null', '-'], { ...HIDE, encoding: 'utf8' }).stderr ?? ''
  const starts = [...log.matchAll(/silence_start: ([\d.]+)/g)].map(m => +m[1]), ends = [...log.matchAll(/silence_end: ([\d.]+)/g)].map(m => +m[1])
  const quiet = starts.map((s, i) => [s, ends[i] ?? total])
  const sung = a => len - quiet.reduce((n, [x, y]) => n + Math.max(0, Math.min(a + len, y) - Math.max(a, x)), 0)
  let best = 0
  for (let a = 1; a + len <= total + 1e-6; a++) if (sung(a) > sung(best)) best = a
  return { start: best, end: Math.round((best + len) * 10) / 10, sung: Math.round(sung(best) * 10) / 10 }
}
const seconds = (v, what) => {
  const n = String(v ?? '').trim() === '' ? undefined : Number(v)
  if (n !== undefined && !(Number.isFinite(n) && n >= 0)) throw userError(`${what} is a time in seconds`)
  return n
}
// what a music, sound or audio tool asks, checked, in the engine's words (the router names them its own way)
const CUSTOM_ONLY = ['vocal_gender', 'style_weight', 'weirdness_constraint', 'audio_weight', 'variety']
function audioRequest(tool, spec, m, options) {
  const f = spec.fields ?? {}, files = k => spec.inputs?.[k] ?? [], probing = !!spec.probe, action = tool.action
  const sung = (f.vocals ?? 'sung') !== 'instrumental', words = k => String(f[k] ?? '').trim()
  const send = (input, attached = {}, opts = options) => ({ send: { model: m.model, action, input, files: attached, options: opts, seed: spec.params?.seed },
    estimate: { action, type: input.type, text: input.prompt ?? '' } })
  const clip = files('clip')[0] ?? files('clips')[0]
  // a song Suno made, for the tools that work on its takes
  const suno = () => {
    if (!clip) return probing ? { task_id: 'probe', audio_id: 'probe', duration: 120 } : null
    const s = sunoOf(clip, action === 'persona')
    if (!s && !probing) throw userError(`${tool.label} works on a song Suno made here (a Music result, an extend, a cover…): ${path.basename(clip)} is not one${action === 'stems' ? '; ElevenLabs splits any song (--model eleven_stem_separation)' : ''}`)
    return s ?? { task_id: 'probe', audio_id: 'probe' }
  }
  const limit = (k, n) => { if (words(k).length > n) throw userError(`${k} is ${n} characters at most, this one has ${words(k).length}`) }
  limit('title', 80); limit('style', 1000); limit('lyrics', 5000); limit('full_lyrics', 5000)
  const length = num(f.length) || undefined
  if (length && (length < 10 || length > 360)) throw userError('a length is 10 to 360 s (0: its own)')
  if (action === 'music') {
    // Describe: the description, then the style picked (Write sends the style as Suno's own)
    const described = () => [words('description'), words('style') && `Style: ${words('style')}`].filter(Boolean).join('\n')
    const describe = (f.mode ?? 'describe') !== 'write', refs = files('references'), vids = files('ref_videos'), sounds = files('ref_audios')
    if (m.role !== 'music') throw userError(`${m.name} makes no music`)
    if (m.provider === 'openrouter') {
      // Lyria: one prompt (the words, or the title, style and lyrics written out), images beside
      if (vids.length || sounds.length) throw userError(`${m.name} takes images only beside its words: a video or a sound goes to Suno on Kie`)
      const prompt = describe ? described() : [words('title') && `Title: ${words('title')}`, words('style') && `Style: ${words('style')}`, !sung ? 'Instrumental, no vocals.' : words('lyrics') && `Lyrics:\n${words('lyrics')}`].filter(Boolean).join('\n')
      if (!prompt && !probing) throw userError(describe ? 'describe the song (--field description="…")' : 'give its style or its lyrics (--field style="…", --field lyrics="…")')
      return { send: { model: m.model, action, input: { prompt: prompt + (describe && !sung ? ' Instrumental, no vocals.' : '') }, files: { references: refs.map(dataUrl) }, options, seed: spec.params?.seed }, estimate: { action } }
    }
    if (describe) {
      if (!probing && !described() && !refs.length && !vids.length && !sounds.length) throw userError('describe the song (--field description="…") or give it images, a video or a sound (--in references=…, ref_videos=…, ref_audios=…)')
      if (described().length > 3000) throw userError(`a description and its style are 3,000 characters at most, these have ${described().length}`)
      if (refs.length > 5 || vids.length > 1 || sounds.length > 1) throw userError('Describe takes 5 images, 1 video and 1 sound at most')
      for (const s of sounds) { const d = probe(s).duration; if (d < 6) throw userError(`a sound for Suno lasts 6 s at least, ${path.basename(s)} is ${d.toFixed(1)} s`) }
      const opts = Object.fromEntries(Object.entries(options).filter(([k]) => !CUSTOM_ONLY.includes(k)))
      return send({ custom_mode: false, instrumental: !sung, prompt: described() || undefined, ...(sung ? singerOf(f.singer) : {}) }, { image_urls: refs, video_urls: vids, audio_urls: sounds }, opts)
    }
    if (!probing && !words('title')) throw userError('a song written has its title (--field title="…")')
    if (!probing && !words('style') && !(sung && words('lyrics')) && !options.negative_tags) throw userError('give its style or its lyrics (--field style="…", --field lyrics="…")')
    return send({ custom_mode: true, instrumental: !sung, title: words('title') || 'Untitled', style: words('style') || undefined, lyrics: sung ? words('lyrics') || undefined : undefined, duration: length, ...(sung ? singerOf(f.singer) : {}) })
  }
  // a singer made by AI: a short song sung solo in the voice described (Suno writes its words), each take's voice then
  // taken apart from the music (Suno's split, runAudio)
  if (action === 'singer_song') {
    if (!probing && !words('voice')) throw userError('describe the voice (--field voice="a warm, breathy female pop voice")')
    if (words('name') && !NAME.test(words('name'))) throw userError('the singer\'s name is letters, digits, - and _ (--field name=nova)')
    const prompt = `A short song sung solo by ${words('voice') || 'a singer'}${words('style') ? `, ${words('style')}` : ''}. The voice stays in front the whole time, clear and dry, over a sparse accompaniment.`
    const r = send({ custom_mode: false, instrumental: false, prompt }, {}, Object.fromEntries(Object.entries(options).filter(([k]) => !CUSTOM_ONLY.includes(k))))
    r.send.action = r.estimate.action = 'music'
    r.send.then = 'vocals'
    return r
  }
  if (action === 'sounds') {
    const said = String(spec.prompt ?? '').trim(), prompt = said && [said, words('style')].filter(Boolean).join(', ')
    if (!prompt && !probing) throw userError('say what it sounds like (--prompt "…")')
    if (prompt.length > 500) throw userError(`a sound is described in 500 characters at most, this has ${prompt.length}`)
    const { sound_tempo, ...rest } = options
    return send({ prompt: prompt || undefined }, {}, { ...rest, ...(sound_tempo ? { sound_tempo } : {}) })
  }
  const from = seconds(f.from, 'From'), source = clip && kindOfFile(clip) === 'audio' ? probe(clip).duration : null
  // a sound Suno takes whole (not one of its own takes): 6 s at least (Kie's 413, free, 2026-10-31)
  const whole = ['cover', 'add_vocals', 'add_instrumental', 'mashup'].includes(action) || (action === 'extend' && clip && !sunoOf(clip))
  for (const s of whole ? [...files('clip'), ...files('clips')] : []) if (probe(s).duration < 6) throw userError(`Suno takes a sound of 6 s at least: ${path.basename(s)} lasts ${probe(s).duration.toFixed(1)} s`)
  if (from != null && source != null && from > source) throw userError(`From is inside the song: 0 to ${source.toFixed(0)} s`)
  const lyrics = sung ? words('lyrics') || undefined : undefined, singer = sung ? singerOf(f.singer) : {}
  if (action === 'extend') {
    const s = clip && sunoOf(clip), at_ = from ?? Math.floor(source ?? s?.duration ?? 0)
    const common = { continue_at: at_ || undefined, style: words('style') || undefined, title: words('title') || undefined, lyrics, instrumental: !sung, ...singer }
    // a take of Suno's goes on by its id, any other sound is sent whole
    if (s) return send({ audio_id: s.audio_id, ...common })
    const r = send({ ...common, title: common.title ?? 'Untitled' }, clip ? { upload_url: clip } : {})
    r.send.action = r.estimate.action = 'upload_extend'
    return r
  }
  if (action === 'cover') {
    if (!probing && !words('style') && !lyrics) throw userError('say the style it is sung in, or its new words (--field style="…")')
    return send({ instrumental: !sung, style: words('style') || undefined, lyrics, title: words('title') || 'Cover', ...singer }, clip ? { upload_url: clip } : {})
  }
  if (action === 'add_vocals' || action === 'add_instrumental') {
    if (!probing && (!words('title') || !words('style'))) throw userError(`${tool.label} needs a title and a style (--field title="…" --field style="…")`)
    if (action === 'add_vocals' && !probing && !words('lyrics')) throw userError('give the words to sing (--field lyrics="…")')
    // Kie refuses these without words to avoid (« Please enter negativeTags », 2026-10-31): the user's, else a neutral one
    const { negative_tags = 'noise, distortion', ...rest } = options
    const input = action === 'add_vocals' ? { title: words('title'), style: words('style'), lyrics: words('lyrics') || undefined, negative_tags } : { title: words('title'), tags: words('style'), negative_tags }
    return send(input, clip ? { upload_url: clip } : {}, rest)
  }
  if (action === 'mashup') {
    const two = files('clips')
    if (!probing && two.length !== 2) throw userError(`a mashup takes two songs, this has ${two.length}`)
    if (!probing && (!words('title') || !words('style'))) throw userError('a mashup needs a title and a style (--field title="…" --field style="…")')
    return send({ title: words('title') || undefined, style: words('style') || undefined, lyrics: words('lyrics') || undefined, duration: length, ...(words('lyrics') ? singerOf(f.singer) : {}) }, { upload_url_list: two })
  }
  if (action === 'midi') {
    const s = clip ? stemOf(clip) : probing ? { task_id: 'probe' } : null
    if (!s) throw userError(`MIDI is made from a stem of the Stems tool: ${path.basename(clip ?? '')} is not one`)
    return send({ task_id: s.task_id, audio_id: s.audio_id })
  }
  // WAV: each Suno take or stem given, one task each (All in WAV sends every track of a result), named after its file
  if (action === 'wav') {
    const each = [...files('clip'), ...files('clips')].map(c => {
      const t = stemOf(c) ?? sunoOf(c)
      if (!t?.audio_id) throw userError(`WAV is made from a song Suno made here or one of its stems: ${path.basename(c)} is not one`)
      // Kie names a stem <its id>_Vocals: the WAV is Vocals.wav; one made here already is copied, free (Kie makes each
      // track's WAV once, then answers « Wav record already exists », 2026-11-01)
      return { task_id: t.task_id, audio_id: t.audio_id, name: path.parse(c).name.replace(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}_/i, ''), from: wavMade(t) }
    })
    if (!each.length && !probing) throw userError('WAV takes a song Suno made here or its stems (--in clip=<file>, several at once)')
    const out = send({ task_id: each[0]?.task_id ?? 'probe', audio_id: each[0]?.audio_id ?? 'probe' })
    if (each.length) out.send.each = each
    return out
  }
  // the tools on a song Suno made: its section, its stems, its timed words, its video, a singer from it
  const s = suno(), ids = { task_id: s.task_id, audio_id: s.audio_id }
  if (action === 'replace') {
    const a = seconds(f.start, 'From'), b = seconds(f.end, 'To')
    if (!probing && (a == null || b == null)) throw userError('say the part to replace (--field start=30 --field end=45)')
    if (!probing && b - a < 10) throw userError(`a section lasts 10 s at least, this one ${(b - a).toFixed(1)} s`)
    if (!probing && s.duration && b > s.duration + 0.5) throw userError(`the song lasts ${Math.round(s.duration)} s`)
    if (!probing && !words('change')) throw userError('say what changes in it (--field change="…")')
    return send({ ...ids, prompt: words('change') || undefined, tags: words('style') || s.tags || undefined, title: s.title || 'Untitled', infill_start_s: a, infill_end_s: b,
      full_lyrics: words('full_lyrics') || s.lyrics || undefined, lyrics: words('lyrics') || undefined, ...singerOf(f.singer) })
  }
  if (action === 'stems') {
    const type = f.split ?? 'separate_vocal'
    if (!['separate_vocal', 'split_stem', 'split_stem_advanced'].includes(type)) throw userError('split is separate_vocal, split_stem or split_stem_advanced')
    return send({ ...ids, type, ...(type === 'split_stem_advanced' ? { stem_name: f.instrument || 'Lead Vocal' } : {}) })
  }
  if (action === 'video') return send({ ...ids, author: words('author').slice(0, 50) || undefined, domain_name: words('domain_name').slice(0, 50) || undefined })
  if (action === 'persona') {
    // where it sings: as asked, else found in the clip (a take's voice alone says it best)
    const found = !probing && clip && (f.start == null || f.start === '' || f.end == null || f.end === '') ? sungWindow(clip) : null
    const a = found ? found.start : seconds(f.start, 'From'), b = found ? found.end : seconds(f.end, 'To'), name = words('name')
    if (!probing && !NAME.test(name)) throw userError('the singer\'s name is letters, digits, - and _ (--field name=Nova)')
    if (!probing && element(name)) throw userError(`@${name} is in the Library already: another name`)
    if (!probing && !words('description')) throw userError('describe the voice (--field description="…")')
    if (!probing && !(b - a >= 10 && b - a <= 30.05)) throw userError(`Suno makes a singer from 10 to 30 s where it sings (--field start=20 --field end=40), this is ${(b - a).toFixed(1)} s`)
    // its style: the take's, 256 characters at most (Kie's 400 beyond, 2026-11-01), cut at a comma
    const tags = String(s.tags ?? ''), style = tags.length <= 256 ? tags : tags.slice(0, Math.max(tags.lastIndexOf(',', 256), 0) || 256)
    return send({ ...ids, name: name || undefined, description: words('description')?.slice(0, 200) || undefined, vocal_start: a, vocal_end: b, style: style || undefined })
  }
  return send(ids)
}

// a video model's own editors, checked: Kling's shots (their seconds its length), the middle frames (Kling 4.0's in
// order, Grok's each at its time), OmniHuman's masks of who speaks, Grok's loop (a first frame and no last), Seedance
// 2.5's draft (480p, its final made from it later)
function videoEditors(m, spec, p, options, duration) {
  const files = k => spec.inputs?.[k] ?? [], mp = m.params, send = {}, out = { send }
  const shots = (p.shots ?? []).filter(x => String(x.prompt ?? '').trim())
  if (shots.length) {
    const sh = mp.shots
    if (!sh) throw userError(`${m.name} takes no shots of its own: Kling 3.0 and Kling 3.0 Omni on Kie do`)
    if (shots.length > sh.max) throw userError(`${m.name} takes ${sh.max} shots at most, this has ${shots.length}`)
    if (shots.some(x => !(Number.isInteger(+x.duration) && +x.duration >= sh.each[0] && +x.duration <= sh.each[1]))) throw userError(`a shot lasts ${sh.each[0]} to ${sh.each[1]} s, in whole seconds`)
    const total = shots.reduce((n, x) => n + +x.duration, 0)
    // its lengths said as they are: a range, or the few it makes
    const lengths = (mp.duration ?? []).filter(d => d <= sh.total), range = lengths.every((d, i) => !i || d === lengths[i - 1] + 1)
    if (total > sh.total || (lengths.length && !lengths.includes(total))) throw userError(`the shots last ${total} s: ${m.name} makes ${range ? `${lengths[0] ?? 1} to ${lengths.at(-1) ?? sh.total} s` : `${lengths.slice(0, -1).join(', ')} or ${lengths.at(-1)} s`}`)
    if (options.prefer_multi_shots) throw userError('Smart shots or your own shots, not both')
    send.shots = shots.map(x => ({ prompt: x.prompt, duration: +x.duration }))
    out.duration = total
  }
  const mids = files('mid_frames')
  if (mids.length) {
    const mf = mp.mid_frames, length = out.duration ?? duration ?? 5
    if (!mf) throw userError(`${m.name} takes no middle frames: Kling 4.0 and Grok Imagine Video on Kie do`)
    if (mids.length > mf.max) throw userError(`${m.name} takes ${mf.max} middle frames at most, this has ${mids.length}`)
    // Kling 4.0: its length caps all its frames, first and last included (3 s → 4 … 9 s and more → 10, Kie's docs)
    const all = mids.length + files('first_frame').length + files('last_frame').length, cap = mf.total && Math.min(mf.total, Math.floor(length) + 1)
    if (cap && all > cap) throw userError(`${m.name} takes ${cap} frames at ${length} s, first and last included: this has ${all}. Make it longer or drop ${all - cap}`)
    const times = (p.mid_times ?? []).map(Number)
    if (mf.timed) {
      if (times.length !== mids.length || times.some(t => !(t > 0 && t < length))) throw userError(`each middle frame has its time, inside the video's ${length} s (--in mid_frames=<file>@<seconds>)`)
      if (times.some((t, i) => i && t - times[i - 1] < 1 / 3)) throw userError('the middle frames go in order, a third of a second apart at least')
    }
    send.mid_frames = mids.map((f, i) => ({ url: dataUrl(f), ...(mf.timed ? { at: times[i] } : {}) }))
  }
  const masks = files('speaker_masks')
  if (masks.length) {
    if (!mp.masks) throw userError(`${m.name} takes no mask of who speaks: OmniHuman 1.5 on Kie does`)
    if (masks.length > mp.masks) throw userError(`${m.name} takes ${mp.masks} masks at most`)
    send.masks = masks.map(dataUrl)
  }
  if (options.loop && (!files('first_frame').length || files('last_frame').length)) throw userError('a loop starts and ends on its first frame: give a first frame, no last one')
  if (options.draft) out.resolution = '480p'
  return out
}

// Seedance 2.5's final from its draft (--from-draft <generation>, within 7 days): the draft's own task, at 1080p, its
// length; Kie lists no price of its own for it: estimated at the 1080p rate, said unknown
function draftFinal(m, p, own) {
  const d = m.params.draft && fs.existsSync(path.join(mediaDir(p.draft_of), 'job.json')) ? readJob(p.draft_of) : null
  if (!m.params.draft) throw userError(`${m.name} makes no final from a draft: Seedance 2.5 on Kie does`)
  if (!d || d.model !== m.model || d.provider !== m.provider || !d.spec.params?.options?.draft) throw userError(`${p.draft_of} is not a draft of ${m.name} (media.mjs jobs)`)
  if (d.status !== 'done' || !d.job?.id) throw userError(`the draft ${p.draft_of} is not done`)
  if (Date.now() - Date.parse(d.created) > 7 * 864e5) throw userError('a draft makes its final within 7 days: this one is older, make it again')
  const { draft, ...kept } = own.options ?? {}
  return { send: { model: m.model, draft_of: d.job.id, refs: [], ...(Object.keys(kept).length ? { options: kept } : {}) },
    estimate: { duration: d.spec.params?.duration ?? 5, resolution: '1080p', input: 'text', final: true } }
}

// a model's options (model.params.options: sliders, switches, choices, selects, numbers, words), each checked and cast;
// a choice given by its value or its label (--option stability=Natural)
function optionValues(m, asked) {
  const list = m.params.options ?? [], out = {}, is = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
  for (const [k, raw] of Object.entries(asked ?? {})) {
    if (raw === undefined || raw === null || raw === '') continue
    const o = list.find(x => x.key === k)
    if (!o) throw userError(`${m.name} has no option ${k}${list.length ? ` (its options: ${list.map(x => x.key).join(', ')})` : ''}`)
    if (o.type === 'slider' || o.type === 'number') {
      const v = Number(raw)
      if (!Number.isFinite(v) || (o.min != null && v < o.min) || (o.max != null && v > o.max)) throw userError(`${o.label} (${k}) is a number${o.min != null ? ` from ${o.min} to ${o.max}` : ''}`)
      out[k] = v
    } else if (o.type === 'switch') {
      if (![true, false, 'true', 'false', 'on', 'off'].includes(raw)) throw userError(`${o.label} (${k}) is on or off`)
      out[k] = raw === true || raw === 'true' || raw === 'on'
    } else if (o.values) {
      const hit = o.values.find(x => (typeof x === 'object' ? [x.value, x.label] : [x]).some(y => is(y, raw)))
      if (hit === undefined) throw userError(`${o.label} (${k}) is one of ${o.values.map(x => (typeof x === 'object' ? x.label : x)).join(', ')}`)
      out[k] = typeof hit === 'object' ? hit.value : hit
    } else if (o.type === 'file') {
      if (!fs.existsSync(String(raw))) throw userError(`${o.label} (${k}): no such file ${raw}`)
      out[k] = path.resolve(String(raw))
    } else {
      // a palette checked now: 3 to 10 #hex colors
      if (o.transform === 'palette') try { palette(raw) } catch (e) { throw userError(e.message) }
      out[k] = String(raw)
    }
  }
  return out
}

// a voice of the Library (@name) for ElevenLabs: its id once it is on the account, else it goes there when the job runs
function elevenVoice(voice) {
  if (!String(voice).startsWith('@')) return voice
  const v = element(voice.slice(1))
  if (v?.type !== 'voice' || !v.files.length) throw userError(`no voice ${voice} in the Library (media.mjs elements)`)
  return v.voice_id ?? voice
}
// ElevenLabs straight: one voice of the account or of the Library, or a dialogue's lines, each its voice (--line
// "<voice>: <words>", Eleven v4 and v3); its options; priced on its characters (a probe, the model list's price, before
// the voice is picked)
function elevenRequest(m, prompt, p, probing) {
  const options = optionValues(m, p.options), seed = p.seed, lines = (p.dialogue ?? []).filter(l => String(l.text ?? '').trim())
  if (lines.length) {
    if (!m.params.dialogue) throw userError(`${m.name} speaks one voice: a dialogue goes to Eleven v4 or v3 (--model eleven_v4)`)
    if (!probing && lines.some(l => !l.voice)) throw userError('each line of a dialogue has its voice (--line "<voice_id or @name>: <words>")')
    const chars = lines.reduce((n, l) => n + l.text.length, 0), voices = new Set(lines.map(l => l.voice))
    if (chars > DIALOGUE_MAX) throw userError(`a dialogue reads reliably up to ${DIALOGUE_MAX} characters, this one has ${chars}: split it in two`)
    if (voices.size > DIALOGUE_VOICES) throw userError(`a dialogue takes ${DIALOGUE_VOICES} voices at most, this one has ${voices.size}`)
    return { send: { model: m.model, dialogue: lines.map(l => ({ voice: l.voice && elevenVoice(l.voice), text: l.text })), options, seed }, estimate: { text: chars } }
  }
  if (!prompt && !probing) throw userError('write what the voice says (--prompt), or a dialogue\'s lines (--line "<voice>: <words>")')
  if (!p.voice && !probing) throw userError('pick a voice (--voice <voice_id>: media.mjs voices lists them; or --voice @<a voice of the Library>)')
  if (m.params.max_chars && prompt.length > m.params.max_chars) throw userError(`${m.name} reads ${m.params.max_chars} characters at a time, this text has ${prompt.length}: split it`)
  return { send: { model: m.model, text: prompt, voice: p.voice && elevenVoice(p.voice), options, seed }, estimate: { text: prompt.length } }
}

// a sound cut once to what ElevenLabs takes of it (a music reference: 30 s), or a video's sound alone (a transcript, an
// alignment), as an MP3 in the cache
function soundPart(file, seconds) {
  const s = probe(file)
  if (!s.width && !(seconds && s.duration > seconds)) return file
  if (!s.audio) throw userError(`${path.basename(file)} has no sound`)
  const out = at('.cache', `sound-${createHash('sha1').update(JSON.stringify([file, fs.statSync(file).mtimeMs, seconds])).digest('hex').slice(0, 12)}.mp3`)
  if (!fs.existsSync(out)) (fs.mkdirSync(path.dirname(out), { recursive: true }), ffmpeg(['-i', file, '-vn', ...(seconds ? ['-t', String(seconds)] : []), '-b:a', '192k', out]))
  return out
}

// Write's lyrics as Eleven Music's plan: a [Name] line opens a section, the lines under it its words (30 at most, 200
// characters each), the style on each; the length asked shared by their lines, else 4 s a line (10 s at least, 2 min at
// most a section), an instrumental 30 s. v1 takes sections, v2 and v2.5 chunks
// ponytail: 4 s a sung line is a guess; the free plan endpoint (/v1/music/plan) paces them better, but rewrites the words
function musicPlan(model, lyrics, style, sung, length) {
  const styles = style.split(',').map(s => s.trim()).filter(Boolean), sections = []
  for (const line of (sung ? lyrics : '').split('\n').map(l => l.trim()).filter(Boolean)) {
    const head = /^\[(.+)\]$/.exec(line)
    if (head || !sections.length) sections.push({ name: head ? head[1].slice(0, 100) : 'Verse', lines: [] })
    if (!head) sections.at(-1).lines.push(line.slice(0, 200))
  }
  if (!sections.length) sections.push({ name: sung ? 'Verse' : 'Instrumental', lines: [] })
  const long = sections.find(s => s.lines.length > 30)
  if (long) throw userError(`[${long.name}] has ${long.lines.length} lines, a section takes 30: open another one ([Verse 2]…)`)
  if (length > 120 * sections.length) throw userError(`a section lasts 2 min at most: ${length} s takes ${Math.ceil(length / 120)} sections ([Verse], [Chorus]…)`)
  const weight = s => Math.max(s.lines.length, 2), sum = sections.reduce((n, s) => n + weight(s), 0), own = s => (s.lines.length ? Math.max(10, s.lines.length * 4) : 30)
  const ms = sections.map(s => Math.round(Math.min(120, Math.max(3, length ? (length * weight(s)) / sum : own(s))) * 1000))
  const avoid = sung ? [] : ['vocals', 'singing']
  const plan = model === 'music_v1'
    ? { positive_global_styles: [...styles, ...(sung ? [] : ['instrumental'])], negative_global_styles: avoid, sections: sections.map((s, i) => ({ section_name: s.name, positive_local_styles: [], negative_local_styles: [], duration_ms: ms[i], lines: s.lines })) }
    : { chunks: sections.map((s, i) => ({ text: [`[${s.name}]`, ...s.lines].join('\n'), duration_ms: ms[i], positive_styles: [...styles, ...(sung ? [] : ['instrumental'])], negative_styles: avoid })) }
  return { plan, seconds: ms.reduce((a, b) => a + b, 0) / 1000 }
}

// ElevenLabs beyond speech: a sound effect, music (Describe's words, Write's sections as its plan, a sound as
// reference), music for a video, a song's stems, a voice designed or remixed, a transcript or a text's words timed
function elevenAudio(spec, m, p, probing) {
  const options = optionValues(m, p.options), f = spec.fields ?? {}, files = k => spec.inputs?.[k] ?? [], words = k => String(f[k] ?? '').trim()
  const go = (action, send, estimate = {}) => ({ send: { model: m.model, action, options, ...(p.seed != null ? { seed: p.seed } : {}), ...send }, estimate })
  if (m.role === 'sound') {
    const said = String(spec.prompt ?? '').trim(), text = said && [said, words('style')].filter(Boolean).join(', ')
    if (!text && !probing) throw userError('say what it sounds like (--prompt "…")')
    return go('sound', { text }, { seconds: options.duration_seconds || 0 })
  }
  if (m.role === 'music') {
    const describe = (f.mode ?? 'describe') !== 'write', sung = (f.vocals ?? 'sung') !== 'instrumental'
    if (files('references').length || files('ref_videos').length) throw userError(`${m.name} takes words and a sound: images and a video go to Suno on Kie`)
    if (words('singer') && !probing) throw userError(`${m.name} sings in no singer of the Library: Suno on Kie does`)
    if (describe) {
      const prompt = [words('description'), words('style')].filter(Boolean).join('. '), ref = files('ref_audios')[0], length = options.length ?? 30
      if (!prompt && !probing) throw userError('describe the music (--field description="…")')
      if (ref && m.model === 'music_v1') throw userError('a sound as reference goes to Eleven Music v2 or v2.5 (--model music_v2_5)')
      if (length && length < 3) throw userError('Eleven Music makes 3 s at least (--option length=3 to 600, 0: its own)')
      const reference = ref && !probing ? { file: soundPart(ref, 30), seconds: Math.min(30, probe(ref).duration) } : undefined
      return go('compose', { prompt: prompt || undefined, length: length || undefined, instrumental: !sung, reference }, { seconds: length, reference: ref ? Math.min(30, probe(ref).duration) : 0 })
    }
    if (!words('style') && !probing) throw userError(`${m.name} plays its sections in a style: say it (--field style="…")`)
    const { plan, seconds } = musicPlan(m.model, words('lyrics'), words('style'), sung, +f.length || options.length || 0)
    return go('compose', { plan }, { seconds })
  }
  if (m.role === 'video-music') {
    const video = files('video')[0], s = video && probe(video)
    if (s && s.duration > 600) throw userError(`${m.name} takes a video of 10 min at most, this one lasts ${Math.round(s.duration)} s: cut it`)
    if (video && fs.statSync(video).size > 200e6) throw userError(`${m.name} takes 200 MB at most: export the video lighter`)
    const tags = words('style').split(',').map(x => x.trim()).filter(Boolean).slice(0, 10)
    return go('video_music', { video, description: words('description') || undefined, tags }, { seconds: s?.duration ?? 0 })
  }
  if (m.role === 'stems') {
    const split = f.split ?? 'separate_vocal'
    // its Tracks option, else Split as Suno's (the command line's --field split)
    if (split === 'split_stem_advanced' && !options.stem_variation_id) throw userError(`one instrument taken out is Suno's (on Kie): ${m.name} gives the voice and the music, or 6 tracks (--option stem_variation_id=six_stems_v1)`)
    const file = files('clip')[0], variation = options.stem_variation_id ?? (split === 'split_stem' ? 'six_stems_v1' : 'two_stems_v1')
    return go('stems', { file, variation }, { seconds: file ? probe(file).duration : 0, variation })
  }
  if (m.role === 'design' || m.role === 'remix') {
    const text = words('text'), ref = files('reference')[0]
    if (!words('description') && !probing) throw userError(m.role === 'design' ? 'describe the voice (--field description="…")' : 'say what changes (--field description="older, a British accent")')
    if (text && (text.length < 100 || text.length > 1000)) throw userError(`what it says is 100 to 1,000 characters, this has ${text.length}: or none, and it writes its own`)
    if (ref && m.model !== 'eleven_ttv_v3') throw userError('a reference clip goes to Voice Design v3 (--model eleven_ttv_v3)')
    if (m.role === 'design') return go('design', { description: words('description'), text: text || undefined, reference: ref }, { chars: text.length })
    if (!p.voice && !probing) throw userError('pick the voice to remix (--voice <voice_id>: media.mjs voices lists them; or --voice @<a voice of the Library>)')
    return go('remix', { voice: p.voice && elevenVoice(p.voice), description: words('description'), text: text || undefined }, { chars: text.length })
  }
  // a transcript, or the words given timed (forced alignment): a video sends its sound alone
  const clip = files('clip')[0], text = words('text')
  const keyterms = words('keyterms').split(',').map(x => x.trim()).filter(k => k && k.length < 50 && k.split(/\s+/).length <= 5)
  return go(text ? 'align' : 'transcribe', { file: clip && !probing ? soundPart(clip) : clip, text: text || undefined, keyterms }, { seconds: clip ? probe(clip).duration : 0, align: !!text })
}

// ElevenLabs' estimate from video.mjs (the one place its rates live): credits
function elevenArgs(tool, spec) {
  const clip = spec.inputs?.clip?.[0]
  if (!clip) throw userError(`${tool.label} needs a clip (--in clip=<file>)`)
  // the Voice Isolator: the voice alone, a video's back on it
  if (tool.id === 'isolate-voice') return ['isolate', clip]
  if (tool.id === 'change-voice') {
    let voice = spec.params?.voice ?? spec.fields?.voice
    if (!voice) throw userError('pick the new voice (--voice <voice_id>, media.mjs voices lists them, or --voice @<a voice of the Library>)')
    // a voice of the Library: its ElevenLabs id once it is on the account, else it goes there when the job runs
    if (String(voice).startsWith('@')) {
      const v = element(voice.slice(1))
      if (v?.type !== 'voice' || !v.files.length) throw userError(`no voice ${voice} in the Library (media.mjs elements)`)
      voice = v.voice_id ?? voice
    }
    return ['voice-change', clip, '--voice', voice, ...(spec.fields?.denoise === 'remove' ? ['--denoise'] : [])]
  }
  const to = String(spec.fields?.to ?? '').split(/[,\s]+/).filter(Boolean)
  if (!to.length) throw userError('say which languages to dub into (--field to=en,es)')
  return ['dub', clip, '--to', to.join(','), '--model', spec.fields?.quality ?? 'dubbing_v1']
}
function videoMjs(argv) {
  if (!fs.existsSync(VIDEO)) throw userError(`video-editor's engine is missing (${VIDEO})`)
  const r = spawnSync(process.execPath, [VIDEO, ...argv], { ...HIDE, encoding: 'utf8', cwd: fs.existsSync(HOME) ? HOME : undefined, maxBuffer: 64e6, env: process.env })
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
  // a tool of one router only (Lip sync: Kie's Volcengine)
  if (tool.routers && !tool.routers.includes(active())) throw userError(`${tool.label} runs on ${tool.routers.map(r => PROVIDERS[r].label).join(' or ')} only: switch the router in Settings (media.mjs setup set router.active=${tool.routers[0]})`)
  // a keyframe made (--in keyframe, at --frame): Aleph 2 takes the video and it alone, the tool's short prompt naming
  // the keyframe and the Elements by their words; their images, the painted area and the references made the keyframe.
  // It carries the change: the Element or photos it was made with are not asked again (the user's own keyframe)
  const kf = spec.kind === 'video' && !!tool.keyframe && !!spec.inputs?.keyframe?.length
  // a References tool makes anyone without words or photos
  if (!probing && !kf && tool.one_of && !tool.one_of.some(k => spec.inputs?.[k]?.length || String(spec.fields?.[k] ?? '').trim())) {
    const [f, i] = [tool.fields.find(x => tool.one_of.includes(x.key)), tool.inputs.find(x => tool.one_of.includes(x.key))]
    throw userError(`${tool.label}: ${f.type === 'element' ? `pick an element of the Library (--field ${f.key}=@<name>, several: "@a, @b")` : `describe it (--field ${f.key}="…")`} or add ${i.label.toLowerCase()} (--in ${i.key}=<file>)`)
  }
  // a field the tool cannot go without (Object swap's element)
  for (const f of tool.fields) if (f.required && !probing && !kf && !String(spec.fields?.[f.key] ?? f.default ?? '').trim())
    throw userError(`${tool.label} needs ${f.label.toLowerCase()} (${f.type === 'element' ? `--field ${f.key}=@<element>, media.mjs elements` : `--field ${f.key}=…`})`)
  const { fields, looks } = prepared(tool, spec, kf)
  spec = { ...spec, fields }
  // a video's lines, spoken with the lips in sync (Kling 4.0, Veo, Seedance…): who says what, in which voice, written
  // after the words (--say "@Papi: Hello", "@Papi (@Narrator): Hello", "(@Narrator): Hello" off screen)
  const lines = spec.kind === 'video' && !kf ? (spec.params?.lines ?? []).filter(l => String(l.text ?? '').trim()) : []
  const said = l => `${l.who ? `${l.who}${l.voice ? `, in the voice of ${l.voice},` : ''} says` : l.voice ? `${l.voice} says off screen` : 'A voice says'}: "${String(l.text).trim()}"`
  if (lines.length) spec = { ...spec, prompt: [String(spec.prompt ?? '').trim(), ...lines.map(said)].filter(Boolean).join(' ') }
  if (!probing) for (const i of tool.inputs) if (!i.optional && !(kf && i.kind !== 'video') && !spec.inputs?.[i.key]?.length) throw userError(`${tool.label} needs ${i.label.toLowerCase()} (--in ${i.key}=<file>)`)
  for (const f of Object.values(spec.inputs ?? {}).flat()) if (!fs.existsSync(f)) throw userError(`no such file: ${f}`)
  // the @names of an image or a video prompt (a voice's text is read as written): their images after the tool's
  const filled = fill(kf ? { ...tool, template: tool.keyframe.apply } : tool, spec)
  let { text: prompt, refs } = spec.kind === 'audio' ? { text: filled, refs: [] }
    : mentions(filled, spec.kind, 1 + counted(spec.kind, tool).reduce((n, i) => n + (spec.inputs?.[i.key]?.length ?? 0), 0), kf)
  const cited = refs.length
  // a probe prices the tool before its files: a style's images would only trip the model's count
  if (!probing) refs.push(...looks)
  if (kf) spec = { ...spec, inputs: { video: spec.inputs.video, keyframe: spec.inputs.keyframe } }
  if (LOCAL[tool.local]) {
    if (['depth', 'matte'].includes(tool.local) && !probing && !hasBin('uv')) throw userError(`${tool.label} runs a model on this machine with uv: brew install uv, then media.mjs setup vision`)
    return { tool, prompt: '', provider: 'local', model: LOCAL[tool.local], estimate: { amount: 0, unit: 'usd', known: true, detail: 'local, free' } }
  }
  if (tool.provider === 'elevenlabs') {
    if (probing && !spec.inputs?.clip?.length) return { tool, prompt: '', provider: 'elevenlabs', model: tool.id, estimate: { amount: null, unit: 'credits', known: false, detail: 'per minute of the clip' } }
    const argv = elevenArgs(tool, spec)
    return { tool, prompt: '', provider: 'elevenlabs', model: { dub: argv[argv.indexOf('--model') + 1], isolate: 'voice_isolator' }[argv[0]] ?? 'eleven_multilingual_sts_v2', argv, estimate: elevenEstimate(argv) }
  }
  if (!prompt && !probing && tool.template && !['upscale'].includes(tool.id) && !spec.params?.dialogue?.length && !spec.params?.shots?.length && !spec.params?.draft_of) throw userError('write a prompt (--prompt "…"), or fill the tool\'s fields (--field key=value)')
  // the user's words are optional beside a tool's own prompt, the whole prompt of Custom and Custom edit
  if (CUSTOM.includes(tool.id) && !spec.raw && !String(spec.prompt ?? '').trim() && !probing && !spec.params?.shots?.length && !spec.params?.draft_of) throw userError('write a prompt (--prompt "…"): Custom has no prompt of its own')
  // the model asked, else the tool's first one this router has, else the default (when this router has it)
  const all = await models(spec.kind), has = x => x && all.some(y => y.model === routerOf(x).model)
  const id = spec.model ?? toolModels(tool).models?.find(has) ?? [settings().defaults[spec.kind]].find(has)
  if (!id && toolModels(tool).models?.length) throw userError(`${tool.label} has no model on ${PROVIDERS[active()].label}: pick one (--model, media.mjs models ${spec.kind}), or switch the router in Settings`)
  const m = id ? await modelOf(spec.kind, id) : all.find(x => x.role !== 'edit' && x.role !== 'upscale' && x.role !== 'avatar')
  if (lines.length && !m.params.audio) throw userError(`${m.name} makes no sound: its lines need a model with sound`)
  if (lines.some(l => l.voice) && !m.params.named_voices) throw userError(`${m.name} takes no voice of its own for a line: Kling 4.0 on Kie does`)
  // a voice of the Library (--voice @name) on a model that clones: its clips are cloned, its words say how it sounds
  // (ElevenLabs takes it whole, by its id)
  if (spec.kind === 'audio' && m.provider !== 'elevenlabs' && String(spec.params?.voice ?? '').startsWith('@')) {
    const v = element(spec.params.voice.slice(1)), { voice, ...params } = spec.params
    if (v?.type !== 'voice' || !v.files.length) throw userError(`no voice ${voice} in the Library (media.mjs elements)`)
    spec = { ...spec, params, inputs: { ...spec.inputs, voice_clips: v.files.slice(0, 3) }, fields: { ...spec.fields, instructions: spec.fields?.instructions || v.words || undefined } }
  }
  // a keyframe goes to Aleph 2 only (its passthrough keyframes); a tool whose images Aleph cannot take needs one there
  if (kf && m.model !== ALEPH) throw userError(`a keyframe goes to Aleph 2 (--model ${ALEPH}), not ${m.name}`)
  // Kling's named elements (on Kie): a cited @Element goes whole, its name kept in the prompt, not as reference images
  // (and in its shots, each rewritten the same)
  const shotTexts = (spec.params?.shots ?? []).map(x => String(x.prompt ?? ''))
  const named = spec.kind === 'video' && m.params.elements && !kf ? klingElements([filled, ...shotTexts].join('\n\u0000\n'), m, spec) : null
  if (named && shotTexts.length) {
    const [text, ...shots] = named.text.split('\n\u0000\n')
    Object.assign(named, { text })
    spec = { ...spec, params: { ...spec.params, shots: spec.params.shots.map((x, i) => ({ ...x, prompt: shots[i] })) } }
  }
  if (named?.elements.length || named?.voices.length) { prompt = named.text; refs.splice(0, cited) }
  // a model that takes one image of its subject (Wan 2.2 Animate Replace, no prompt): each cited Element's main view
  if (m.params.element_views === 1 && cited) refs.splice(0, cited, ...[...new Set([...filled.matchAll(/@([\w-]+)/g)].map(x => x[1]))].map(element).filter(el => el && !heard(el.type) && el.files.length).map(el => el.files[0]))
  // voices of their own (Kling 4.0), each a clip and the name the words cite it by (@Narrator), beside the Library's
  const fileVoices = (spec.inputs?.ref_voices ?? []).map((f, i) => ({ name: String(spec.params?.voice_names?.[i] || path.parse(f).name.replace(/^\d+-/, '')).replace(/[^\w]/g, '_').slice(0, 20), file: f }))
  if (fileVoices.length && !m.params.named_voices) throw userError(`${m.name} takes no voice of its own: Kling 4.0 on Kie does`)
  const voices = [...(named?.voices ?? []), ...fileVoices]
  if (voices.length > (m.params.named_voices ?? 0) && fileVoices.length) throw userError(`${m.name} takes ${m.params.named_voices} voices, this has ${voices.length}`)
  const materials = (spec.inputs?.references?.length ?? 0) + (spec.inputs?.ref_videos?.length ?? 0) + (spec.inputs?.video?.length ?? 0) + (named?.elements.length ?? 0) + voices.length
  if (m.params.materials && materials > m.params.materials) throw userError(`${m.name} takes ${m.params.materials} references in all (images, videos, Elements and voices), this has ${materials}`)
  if (!kf && !probing && tool.keyframe?.required && m.model === ALEPH)
    throw userError(`${tool.label} on Aleph 2 takes a keyframe: --frame <seconds> makes it from the video, then --in keyframe=<it> --frame <seconds>`)
  // the tool's price before its keyframe: its Elements' images will go to the keyframe, not to Aleph
  if (probing && tool.keyframe && m.model === ALEPH) refs.splice(0)
  // Lip sync on a model that starts from an image (a talking head): the video's frame at --frame (its first by default);
  // on one that remakes a shot (Seedance 2.0): the video and the voice as its references, as long as the voice
  if (tool.id === 'lip-sync' && spec.inputs?.video?.length && m.role !== 'edit') {
    const video = spec.inputs.video[0], voice = spec.inputs.audio ?? [], at_ = +(spec.params?.frame ?? 0)
    if (!(at_ >= 0 && at_ <= probe(video).duration)) throw userError(`--frame is a time in the video: 0 to ${probe(video).duration.toFixed(1)} s`)
    spec = m.role === 'avatar' ? { ...spec, inputs: { first_frame: [frameAt(video, at_)], audio: voice } }
      : { ...spec, inputs: { ref_videos: [video], ref_audios: voice }, params: { ...spec.params, duration: voice[0] ? Math.round(probe(voice[0]).duration) : undefined } }
  }
  // a model that takes a reference sound or frames, not both (Seedance on Kie: « mutually exclusive », 2026-10-31): the
  // image a sound drives goes as a reference, its ratio kept
  if (spec.kind === 'video' && m.params.sound_or_frames && spec.inputs?.audio?.length && spec.inputs?.first_frame?.length) {
    const { first_frame, ...rest } = spec.inputs
    spec = { ...spec, inputs: { ...rest, references: [...(rest.references ?? []), ...first_frame] }, params: { ...spec.params, aspect_ratio: spec.params?.aspect_ratio ?? ratioOf(m.params.aspect_ratio, first_frame[0]) } }
  }
  let request
  try {
    // extend: the source's last frame starts the new shot (sequel), or its first frame ends it (prequel)
    if (tool.local === 'extend' && spec.inputs?.video?.length) {
      const prequel = spec.fields?.direction === 'prequel', frame = at('.cache', `frame-${Date.now()}.png`), src = spec.inputs.video[0]
      ffmpeg([...(prequel ? [] : ['-sseof', '-0.1']), '-i', src, '-frames:v', '1', '-update', '1', frame])
      const key = prequel ? 'last_frame' : 'first_frame'
      if (!m.params.frames.includes(key)) throw userError(`${m.name} cannot ${prequel ? 'end on' : 'start from'} a frame: pick another model`)
      request = routerRequest('video', { ...tool, inputs: [] }, { ...spec, inputs: { [key]: [frame] } }, m, prompt, refs)
    } else if (tool.local === 'expand' && spec.inputs?.image?.length) {
      // expand: the image on its larger frame, the margins flat gray for the model to fill, at its closest ratio
      const canvas = expandCanvas(spec.inputs.image[0], spec.fields)
      request = routerRequest('image', tool, { ...spec, inputs: { ...spec.inputs, image: [canvas] }, params: { ...spec.params, aspect_ratio: spec.params?.aspect_ratio ?? ratioOf(m.params.aspect_ratio, canvas) } }, m, prompt, refs)
    } else request = routerRequest(spec.kind, tool.local === 'extend' ? { ...tool, inputs: [] } : tool, spec, m, prompt, refs)
  } catch (e) {
    // too many images for this model: the tool's model that takes them (a painted frame on Clean up goes to Seedance)
    const want = +e.message.match(/this asks for (\d+)/)?.[1]
    const fit = want && (await models(spec.kind)).find(x => toolModels(tool).models?.includes(x.model) && x.model !== m.model && (x.params.references ?? Infinity) >= want)
    if (fit) e.message += `: ${fit.name} takes them (--model ${fit.model})`
    throw e
  }
  if (named?.elements.length) request.send.elements = named.elements.map(e => ({ ...e, files: e.files.map(dataUrl), ...(e.voice ? { voice: dataUrl(e.voice) } : {}) }))
  // Kling 4.0's voices of the Library, each its first clip
  if (voices.length) request.send.voices = voices.map(v => ({ name: v.name, file: dataUrl(v.file) }))
  const { provider } = routerOf(m.id)
  const estimate = provider.estimate(routerKind(spec.kind), m, request.estimate)
  // the Singer tool: the song, then each of its 2 takes' voice taken apart
  if (request.send.then === 'vocals') {
    const split = provider.estimate('speech', await modelOf('audio', 'suno/stems'), { action: 'stems', type: 'separate_vocal' })
    Object.assign(estimate, estimate.amount != null && split.amount != null
      ? { amount: Math.round((estimate.amount + 2 * split.amount) * 1e4) / 1e4, credits: estimate.credits != null && split.credits != null ? estimate.credits + 2 * split.credits : undefined, detail: `the song (${estimate.detail}) + its 2 voices taken apart (${split.detail} each)` }
      : { amount: null, known: false, detail: 'Kie\'s price list not read yet' })
  }
  // WAV: one task per track not made here yet
  const each = request.send.each
  if (each && estimate.amount != null) {
    const n = each.filter(t => !t.from).length, have = each.length - n
    Object.assign(estimate, { amount: Math.round(estimate.amount * n * 1e4) / 1e4, credits: estimate.credits != null ? Math.round(estimate.credits * n * 100) / 100 : undefined,
      detail: `${n} track${n === 1 ? '' : 's'} × ${estimate.detail}${have ? `, ${have} made here already (copied, free)` : ''}` })
  }
  // a voice priced before its text (the tool list's price): by its characters, none to count yet
  if (probing && m.role === 'speech' && !request.estimate?.text) Object.assign(estimate, { amount: null, known: false, detail: 'per character of its text' })
  // a draft's final: priced at the model's rate, said unknown (Kie lists no price of its own for it)
  if (request.send.draft_of) Object.assign(estimate, { known: false, detail: `Kie lists no price for a draft's final: about ${estimate.credits ?? '?'} credits at its 1080p rate` })
  return { tool, prompt, provider: m.provider, model: m.model, name: m.name, request, estimate }
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

// a batch: the same generation 1 to 4 times, each a job of its own; its yes, threshold and cap go by the total
const batchOf = spec => (spec.batch == null ? 1 : Math.min(4, Math.max(1, Math.round(+spec.batch) || 1)))
const times = (p, n) => (n === 1 ? p : { ...p, estimate: { ...p.estimate, amount: p.estimate.amount == null ? null : +(p.estimate.amount * n).toFixed(6), detail: `${n} × ${p.estimate.detail}` } })

// a References tool's sheets, picked by label in the catalog's order (--field sheets="Body turnaround, Face close-up")
function sheetsOf(tool, spec) {
  const f = tool.fields.find(x => x.type === 'sheets')
  if (!f) return null
  const want = String(spec.fields?.[f.key] ?? f.default ?? '').split(',').map(s => s.trim().toLowerCase())
  const list = f.options.filter(o => want.includes(o.label.toLowerCase()))
  if (!list.length) throw userError(`pick one sheet or more (--field ${f.key}="${f.options.map(o => o.label).join(', ')}")`)
  return { f, list }
}
// a gray image standing for a sheet not made yet: the estimate counts it as the reference it will be
function standIn() {
  const f = at('.cache', 'stand-in.png')
  if (!fs.existsSync(f)) (fs.mkdirSync(path.dirname(f), { recursive: true }), ffmpeg(['-f', 'lavfi', '-i', 'color=gray:s=1024x1024', '-frames:v', '1', '-update', '1', f]))
  return f
}
// the jobs a generation makes, each with its plan: a batch's takes of one, or a References tool's sheets at their own
// ratio, the first alone, the others after it to match its image
// a frame of a video at t seconds, made once
function frameAt(file, t) {
  const out = at('.cache', `frame-${createHash('sha1').update(JSON.stringify([file, fs.statSync(file).mtimeMs, t])).digest('hex').slice(0, 12)}.png`)
  if (!fs.existsSync(out)) (fs.mkdirSync(path.dirname(out), { recursive: true }), ffmpeg(['-ss', String(t), '-i', file, '-frames:v', '1', '-update', '1', out]))
  if (!fs.existsSync(out)) throw userError(`no frame at ${t} s in ${path.basename(file)}`)
  return out
}
// a video edit's keyframe (--frame <s>, no keyframe yet): the frame at s edited as an image, by the image tool the video
// tool names (the same fields) or by Custom edit on its frame prompt, the frame first and the tool's other images after
// it; on Seedream 5.0 Flash unless --keyframe-model. Its job remembers the video; Aleph 2 then carries it through the
// shot (--in keyframe=<it> --frame <s>)
function keyframeStep(spec) {
  const tool = spec.kind === 'video' && toolOf('video', spec.tool), k = tool?.keyframe, t = spec.params?.frame
  if (!k || t == null || spec.inputs?.keyframe?.length) return spec
  const video = spec.inputs?.video?.[0]
  if (!video) { if (spec.probe) return spec; throw userError(`${tool.label} needs its video first (--in video=<file>)`) }
  const length = probe(video).duration
  if (!(t >= 0 && t <= length)) throw userError(`--frame is a time in the video: 0 to ${length.toFixed(1)} s`)
  const frame = frameAt(video, t), { video: _, keyframe: __, ...rest } = spec.inputs
  const base = { kind: 'image', model: spec.params.keyframe_model ?? KEYFRAME_MODEL, params: {}, workspace: spec.workspace, probe: spec.probe, keyframe: { tool: tool.id, video, at: t } }
  const defaults = Object.fromEntries(tool.fields.filter(f => f.default !== undefined).map(f => [f.key, String(f.default)]))
  if (k.tool) return { ...base, tool: k.tool, prompt: spec.prompt, fields: { ...defaults, ...spec.fields }, inputs: { image: [frame], ...(rest.references ? { references: rest.references } : {}) } }
  const syn = { ...tool, template: k.template, inputs: [{ key: 'image', kind: 'image' }, ...tool.inputs.filter(i => i.kind !== 'video')] }
  const prompt = fill(syn, { ...spec, kind: 'image', fields: prepared(tool, spec).fields, inputs: { image: [frame], ...rest } })
  return { ...base, tool: 'free-edit', raw: true, prompt, fields: {}, inputs: { image: [frame], references: syn.inputs.slice(1).flatMap(i => rest[i.key] ?? []) } }
}
async function plans(spec) {
  spec = keyframeStep(spec)
  const tool = toolOf(spec.kind, spec.tool), sheets = sheetsOf(tool, spec)
  if (!sheets) { const p = await plan(spec); return Array.from({ length: batchOf(spec) }, () => ({ spec, p })) }
  return Promise.all(sheets.list.map(async (o, k) => {
    const one = { ...spec, batch: undefined, fields: { ...spec.fields, [sheets.f.key]: o.label }, params: { aspect_ratio: o.ratio, ...spec.params } }
    const after = k > 0 && !spec.probe
    return { spec: one, after, p: await plan(after ? { ...one, inputs: { ...one.inputs, sheet: [standIn()] } } : one) }
  }))
}
// what they cost together: a batch's n times one, sheets added up
function total(list) {
  if (list.every(x => x.p === list[0].p)) return times(list[0].p, list.length)
  const amounts = list.map(x => x.p.estimate.amount)
  return { ...list[0].p, estimate: { ...list[0].p.estimate, amount: amounts.includes(null) ? null : +amounts.reduce((a, b) => a + b, 0).toFixed(6),
    known: list.every(x => x.p.estimate.known), detail: list.map(x => x.p.estimate.detail).join(' + ') } }
}

async function create(spec, gateOpts) {
  ensureHome()
  // the workspace it joins: the one asked for, else the current one
  if (spec.workspace && !workspace(spec.workspace)) throw userError(`no workspace ${spec.workspace} (media.mjs workspaces)`)
  const ws = spec.workspace ?? currentWorkspace()
  const list = await plans(spec)
  gate(total(list), gateOpts)
  let first = null
  return list.map(({ spec: one, p, after }, k) => {
    const { batch, ...kept } = one
    const id = newId(p.tool.id), dir = mediaDir(id)
    first ??= id
    fs.mkdirSync(dir, { recursive: true })
    // the inputs are copied in: a remix works after the originals moved
    const inputs = {}
    for (const [key, list] of Object.entries(kept.inputs ?? {})) inputs[key] = list.map((f, i) => {
      const name = `in-${key}-${i + 1}${path.extname(f).toLowerCase()}`
      fs.copyFileSync(f, path.join(dir, name))
      return name
    })
    const job = { id, kind: kept.kind, tool: p.tool.id, label: p.tool.label, provider: p.provider, model: p.model, name: p.name ?? p.model, prompt: p.prompt, spec: { ...kept, inputs },
      estimate: p.estimate, actual: null, status: 'queued', by: gateOpts.by, created: new Date().toISOString(), outputs: [], workspaces: [ws], ...(after ? { after: first } : {}) }
    saveJob(job)
    // what run needs and the folder does not keep: the request (data: URLs) and video.mjs's arguments; a batch's
    // seed goes up by one a job, or its takes would all be the same. A sheet after the first is planned when it runs
    const send = p.request?.send && typeof p.request.send.seed === 'number' ? { ...p.request.send, seed: p.request.send.seed + k } : p.request?.send
    writeJson(at('.cache', 'requests', `${id}.json`), { request: after ? null : send ?? null, argv: p.argv ?? null })
    return job
  })
}

const progress = (job, note) => { job.note = note; saveJob(job); if (!process.env.MEDIA_GENERATOR_QUIET) console.log(note) }

async function run(id) {
  const dir = mediaDir(id), job = readJob(id), reqFile = at('.cache', 'requests', `${id}.json`)
  let { request, argv } = fs.existsSync(reqFile) ? readJson(reqFile) : {}
  Object.assign(job, { status: 'running', pid: process.pid, started: job.started ?? new Date().toISOString() })
  saveJob(job)
  try {
    if (job.after) request = await matchFirst(dir, job)
    if (job.provider === 'local') await runLocal(dir, job)
    else if (argv) runEleven(dir, job, argv)
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

// a sheet after the first of its set: it waits for the first one's image, takes it as the sheet to match (kept in its
// folder, so a remix redoes this sheet alone against it), then is planned with it
async function matchFirst(dir, job) {
  progress(job, 'waiting for the first sheet…')
  for (;;) {
    const first = fs.existsSync(path.join(mediaDir(job.after), 'job.json')) ? readJob(job.after) : null
    if (!first) throw new Error('the first sheet of this set is gone')
    if (first.status === 'failed') throw new Error(`the first sheet failed: ${first.error}`)
    if (first.status === 'done') {
      const img = first.outputs.find(f => kindOfFile(f) === 'image')
      if (!img) throw new Error('the first sheet made no image')
      job.spec.inputs.sheet = [`in-sheet-1${path.extname(img)}`]
      fs.copyFileSync(path.join(mediaDir(first.id), img), path.join(dir, job.spec.inputs.sheet[0]))
      const p = await plan({ ...job.spec, inputs: Object.fromEntries(Object.entries(job.spec.inputs).map(([k, l]) => [k, l.map(f => path.join(dir, f))])) })
      job.prompt = p.prompt
      saveJob(job)
      return p.request.send
    }
    await sleep(+(process.env.MEDIA_GENERATOR_POLL ?? 1000))
  }
}

// a song, a sound, its extras: its files saved by what they are (Suno's takes out-1 and out-2, their covers, a stem by
// its name), Suno's ids kept with the job for what follows from it; its words written beside (lyrics.txt, a timed
// lyrics.srt); a singer goes to the Library
async function runAudio(dir, job, request, provider) {
  // WAV: one task per track, its cost counted as it goes (a failure stops it, what was spent stays in the ledger); a
  // track made here already is copied; each track's ids kept (job.wav) so that it is never asked twice
  if (request.each) {
    const { each, ...one } = request
    Object.assign(job, { outputs: [], wav: [] })
    let asked = 0
    for (const [i, t] of each.entries()) {
      const file = `${t.name}.wav`
      progress(job, `WAV ${i + 1} of ${each.length} (${t.name})…`)
      // made meanwhile by another job: copied too
      const from = t.from && fs.existsSync(t.from) ? t.from : wavMade(t)
      if (from) fs.copyFileSync(from, path.join(dir, file))
      else {
        let r
        asked++
        try { r = await provider.audio({ ...one, input: { task_id: t.task_id, audio_id: t.audio_id } }, { progress: m => progress(job, m) }) }
        catch (e) { throw new Error(`${t.name}: ${e.message}${/already exists/i.test(e.message) ? ' (Kie made its WAV before, not in this folder: it gives no way to fetch it again)' : ''}`) }
        const f = r.files.find(x => x.data || x.url)
        if (!f) throw new Error(`no WAV came back for ${t.name}`)
        fs.writeFileSync(path.join(dir, file), f.data ?? await provider.download(f.url))
        if (r.cost != null) Object.assign(job, { actual: Math.round(((job.actual ?? 0) + r.cost) * 1e4) / 1e4, actual_known: true })
      }
      job.outputs.push(file)
      job.wav.push({ file, task_id: t.task_id, audio_id: t.audio_id })
      saveJob(job)
    }
    // all copied: nothing spent
    if (!asked) Object.assign(job, { actual: 0, actual_known: true })
    return
  }
  // a voice of the Library to remix, not on the ElevenLabs account yet: it goes there first (its paid plans)
  if (job.provider === 'elevenlabs' && String(request.voice ?? '').startsWith('@')) {
    progress(job, `putting ${request.voice} on ElevenLabs…`)
    request = { ...request, voice: voiceToEleven(request.voice.slice(1)).voice_id }
  }
  progress(job, `${job.label.toLowerCase()} with ${job.name}…`)
  const r = await provider.audio(request, { progress: m => progress(job, m) })
  // what the job keeps for what follows (ElevenLabs: a designed voice's ids, a song's id)
  if (r.keep) Object.assign(job, r.keep)
  const names = new Map()
  job.outputs = []
  for (const f of r.files) {
    if (!f.data && !f.url) continue
    const ext = f.ext ?? (path.extname(new URL(f.url).pathname).slice(1).toLowerCase() || 'mp3')
    let name = `${f.name}.${ext}`
    fs.writeFileSync(path.join(dir, name), f.data ?? await provider.download(f.url))
    // raw PCM (16-bit, 24 kHz) made an MP3
    if (ext === 'pcm') (ffmpeg(['-f', 's16le', '-ar', '24000', '-ac', '1', '-i', path.join(dir, name), '-b:a', '192k', path.join(dir, `${f.name}.mp3`)]), fs.rmSync(path.join(dir, name)), (name = `${f.name}.mp3`))
    names.set(f.name, name)
    job.outputs.push(name)
  }
  // the sound first, its covers after
  job.outputs.sort((a, b) => (kindOfFile(a) === 'image') - (kindOfFile(b) === 'image'))
  if (r.task_id) job.suno = { task_id: r.task_id, tracks: r.tracks?.map(t => ({ ...t, file: names.get(t.file) ?? t.file })) ?? null, data: r.data ?? null }
  // the Singer tool: each take's voice taken apart (Suno's split: voice-1.mp3 beside out-1.mp3), the music dropped; a
  // take whose split fails keeps its song and says why
  let more = 0
  if (request.then === 'vocals') {
    const split = await modelOf('audio', 'suno/stems'), failed = []
    for (const [i, t] of (job.suno?.tracks ?? []).entries()) {
      try {
        progress(job, `taking the voice of take ${i + 1} apart…`)
        const s = await provider.audio({ model: split.model, action: 'stems', input: { task_id: job.suno.task_id, audio_id: t.audio_id, type: 'separate_vocal' } }, { progress: m => progress(job, m) })
        const v = s.files.find(f => /vocal/i.test(f.name) && !/instrumental/i.test(f.name)) ?? s.files[0]
        if (!v) throw new Error('no voice came back')
        const name = `voice-${i + 1}.mp3`
        fs.writeFileSync(path.join(dir, name), v.data ?? await provider.download(v.url))
        Object.assign(t, { voice: name })
        job.outputs.splice(job.outputs.indexOf(t.file) + 1, 0, name)
        more += s.cost ?? 0
      } catch (e) { failed.push(`take ${i + 1}: ${e.message}`) }
    }
    if (failed.length) job.note = `its voice could not be taken apart (${failed.join('; ')})`
  }
  const said = [...new Set(r.tracks?.map(t => t.lyrics).filter(Boolean) ?? [])]
  if (r.data?.lyrics) said.push(r.data.lyrics)
  if (said.length) (fs.writeFileSync(path.join(dir, 'lyrics.txt'), said.join('\n\n---\n\n') + '\n'), job.outputs.push('lyrics.txt'))
  // the words with their times: as Suno gives them (lyrics.json) and as captions (lyrics.srt)
  if (request.action === 'timings') {
    const words = [r.data?.aligned_words, r.data?.alignedWords, r.data?.data?.aligned_words].find(Array.isArray) ?? []
    writeJson(path.join(dir, 'lyrics.json'), r.data ?? {})
    const t = s => new Date(Math.max(0, +s || 0) * 1000).toISOString().slice(11, 23).replace('.', ',')
    const lines = words.map(w => ({ text: String(w.word ?? w.text ?? '').trim(), a: w.start_s ?? w.startS, b: w.end_s ?? w.endS })).filter(w => w.text)
    fs.writeFileSync(path.join(dir, 'lyrics.srt'), lines.map((w, i) => `${i + 1}\n${t(w.a)} --> ${t(w.b)}\n${w.text}\n`).join('\n'))
    job.outputs = ['lyrics.srt', 'lyrics.json']
  }
  // a singer of the Library: the part where it sings alone, and its persona
  if (request.action === 'persona') {
    const id = [r.data?.personaId, r.data?.persona_id, r.data?.id].find(x => typeof x === 'string')
    if (!id) throw new Error(`Suno gave no persona id: ${JSON.stringify(r.data).slice(0, 200)}`)
    // its clip: where it sings (as asked, or as found), from the clip given (a take's voice alone, or the take)
    const src = path.join(dir, job.spec.inputs.clip[0]), clip = path.join(dir, 'singer.mp3'), { name, description } = job.spec.fields
    ffmpeg(['-ss', String(request.input.vocal_start), '-to', String(request.input.vocal_end), '-i', src, '-b:a', '192k', clip])
    saveElement(name, { type: 'singer', words: description, files: [clip], workspace: job.workspaces?.[0] })
    const f = at('elements', name, 'element.json')
    writeJson(f, { ...readJson(f), suno: { persona_id: id } })
    // its picture: its song's cover (out-2.mp3's is cover-2.jpeg)
    const take = sunoOf(src, true), n = take?.file.match(/^out-(\d+)\./)?.[1]
    const cover = n && readJob(take.job).outputs.find(o => o.startsWith(`cover-${n}.`))
    if (cover) fs.copyFileSync(path.join(mediaDir(take.job), cover), at('elements', name, 'cover.jpg'))
    // kept with the job too: the singer can be made again from it
    job.suno = { task_id: null, tracks: null, data: { persona_id: id } }
    job.outputs = ['singer.mp3']
    job.element = name
  }
  // its data alone (a stem's MIDI: its notes)
  if (!job.outputs.length && r.data && Object.keys(r.data).length) (writeJson(path.join(dir, 'notes.json'), r.data), job.outputs.push('notes.json'))
  if (!job.outputs.length) throw new Error(`${job.name} made no file: ${JSON.stringify(r.data ?? {}).slice(0, 200)}`)
  const cost = r.cost ?? (r.generation ? await provider.generationCost(r.generation) : null)
  if (cost != null) Object.assign(job, { actual: Math.round((cost + more) * 1e4) / 1e4, actual_known: true })
}

async function runRouter(dir, job, request) {
  const { provider } = routerOf(`${job.provider}:${job.model}`)
  if (job.kind === 'image') {
    progress(job, `generating with ${job.name}…`)
    const r = await provider.image(request, { progress: m => progress(job, m) })
    job.outputs = r.files.map((f, i) => {
      const name = `out-${i + 1}.${(f.type.split('/')[1] ?? 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg')}`
      fs.writeFileSync(path.join(dir, name), f.data)
      return name
    })
    if (r.cost != null) Object.assign(job, { actual: r.cost, actual_known: true })
    // an inpaint keeps the original outside the painted area: the model's own image stays beside as model-1.png
    const matte = job.spec.inputs?.matte?.[0]
    if (toolOf(job.kind, job.tool).local === 'paste' && matte && job.spec.fields?.outside !== 'model') {
      progress(job, 'laying the painted area on the original…')
      job.outputs = job.outputs.map((name, i) => {
        const made = `model-${i + 1}${path.extname(name)}`
        fs.renameSync(path.join(dir, name), path.join(dir, made))
        paste(path.join(dir, job.spec.inputs.image[0]), path.join(dir, made), path.join(dir, matte), path.join(dir, `out-${i + 1}.png`))
        return `out-${i + 1}.png`
      })
    }
    return
  }
  if (job.kind === 'audio' && request.action) return runAudio(dir, job, request, provider)
  if (job.kind === 'audio') {
    // ElevenLabs: a voice of the Library not on the account yet goes there first (its paid plans), its id kept with it
    if (job.provider === 'elevenlabs') {
      const onAccount = v => (String(v).startsWith('@') ? (progress(job, `putting ${v} on ElevenLabs…`), voiceToEleven(v.slice(1)).voice_id) : v)
      request = { ...request, ...(request.voice ? { voice: onAccount(request.voice) } : {}), ...(request.dialogue ? { dialogue: request.dialogue.map(l => ({ ...l, voice: onAccount(l.voice) })) } : {}) }
    }
    progress(job, `speaking with ${job.name}…`)
    let r
    const told = { progress: m => progress(job, m) }
    try { r = await provider.speech(request, told) } catch (e) {
      // some voices only answer raw PCM (16-bit, at the rate it says): wrapped into an MP3 here
      if (job.provider === 'elevenlabs' || !/pcm|format/i.test(e.message)) throw e
      r = await provider.speech({ ...request, format: 'pcm' }, told)
      fs.writeFileSync(path.join(dir, 'out.pcm'), r.data)
      ffmpeg(['-f', 's16le', '-ar', `${r.rate}`, '-ac', `${r.channels}`, '-i', path.join(dir, 'out.pcm'), '-b:a', '192k', path.join(dir, 'out.mp3')])
      fs.rmSync(path.join(dir, 'out.pcm'))
    }
    if (r.format === 'mp3') fs.writeFileSync(path.join(dir, 'out.mp3'), r.data)
    else if (r.format !== 'pcm') {
      // a WAV or another file (Kie): made an MP3 like the others
      fs.writeFileSync(path.join(dir, `out-raw.${r.format}`), r.data)
      ffmpeg(['-i', path.join(dir, `out-raw.${r.format}`), '-b:a', '192k', path.join(dir, 'out.mp3')])
      fs.rmSync(path.join(dir, `out-raw.${r.format}`))
    }
    job.outputs = ['out.mp3']
    // its words' times (ElevenLabs): its captions beside
    if (r.words?.length) (fs.writeFileSync(path.join(dir, 'captions.srt'), srt(r.words)), job.outputs.push('captions.srt'))
    if (r.generation) progress(job, 'reading its cost…')
    const cost = r.cost ?? (r.generation ? await provider.generationCost(r.generation) : null)
    if (cost != null) Object.assign(job, { actual: cost, actual_known: true })
    return
  }
  // a video: submitted once (its id kept, so a run that stopped resumes the polling), then polled. Its videos and
  // voices go through a tunnel, open from the submission to the job's end
  // ponytail: a resumed run opens no tunnel again; the router fetched the files once the job started
  let t = null
  try {
    if (!job.job) {
      // the router's own upload takes the files (Kie), else a tunnel serves them (OpenRouter)
      const local = provider.upload ? [] : request.refs.filter(r => r.file)
      if (provider.upload && request.refs.some(r => r.file)) progress(job, `sending the files to ${PROVIDERS[job.provider].label}…`)
      if (local.length) {
        progress(job, `opening a tunnel for ${job.name} to fetch the ${[...new Set(local.map(r => r.kind))].join(' and ')}…`)
        t = await tunnel(local.map(r => r.file))
      }
      job.job = await provider.video({ ...request, refs: request.refs.map(r => (r.file && t ? { kind: r.kind, url: t.urls[local.indexOf(r)] } : r)) }, { progress: m => progress(job, m) })
      progress(job, `submitted to ${job.name} (${job.job.id})`)
    }
    for (let wait = 0; ; wait++) {
      const s = await provider.poll(job.job)
      if (s.status === 'completed') {
        job.outputs = []
        // its own format (Seedance's MOV), else MP4; the last frame beside when asked
        const ext = url => { const e = path.extname(new URL(url, 'http://x').pathname).toLowerCase(); return ['.mp4', '.mov', '.webm'].includes(e) ? e : '.mp4' }
        for (const [i, url] of s.urls.entries()) {
          const name = s.urls.length > 1 ? `out-${i + 1}${ext(url)}` : `out${ext(url)}`
          fs.writeFileSync(path.join(dir, name), await provider.download(url))
          job.outputs.push(name)
        }
        for (const [what, url] of Object.entries(s.extra ?? {})) {
          const name = `${what}${path.extname(new URL(url, 'http://x').pathname) || '.jpg'}`
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

// a tool done on this machine: reframe, FPS boost, SDR to HDR (ffmpeg), depth map and background removal (vision.py)
async function runLocal(dir, job) {
  const local = toolOf(job.kind, job.tool).local, f = job.spec.fields ?? {}
  if (local === 'reframe') return runReframe(dir, job)
  const src = path.join(dir, job.spec.inputs.video[0]), s = probe(src), out = path.join(dir, 'out.mp4')
  if (local === 'fps') {
    // frames made between the existing ones by motion; a slow motion plays them at the source's rate, without its sound
    const fps = s.fps || 30, slow = +(/^slow(\d)$/.exec(f.target ?? '')?.[1] ?? 0), to = slow ? fps * slow : +(f.target ?? 60)
    if (!slow && to <= fps) throw new Error(`the video is already ${fps} fps`)
    progress(job, slow ? `making a ×${slow} slow motion…` : `making ${to} fps from ${fps}…`)
    // the last frame held a second more: minterpolate drops the tail it has nothing to interpolate towards; cut back to
    // the length it must have
    const mi = `tpad=stop_mode=clone:stop_duration=1,minterpolate=fps=${to}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`
    ffmpeg(['-i', src, '-vf', slow ? `${mi},setpts=${slow}*PTS,fps=${fps}` : mi, '-t', String(s.duration * (slow || 1)), ...(slow ? ['-an'] : ['-c:a', 'aac']), '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', out])
  } else if (local === 'hdr') {
    // HDR10: the SDR picture in BT.2020, its white at 203 nits (BT.2408) and its highlights stretched up to the peak by
    // a curve from half its light up, PQ-encoded. ponytail: one curve per channel, a model's inverse tone mapping if
    // highlights' colors matter
    const peak = Math.min(4000, Math.max(400, +f.peak || 1000)), L = 'pow(val/65535,2.4)', N = `(203*${L}+${peak - 203}*pow(max(0,(${L}-0.5)/0.5),2))/10000`
    const pq = `pow((0.8359375+18.8515625*pow(${N},0.1593017578125))/(1+18.6875*pow(${N},0.1593017578125)),78.84375)*65535`
    progress(job, `making an HDR10 video, highlights up to ${peak} nits…`)
    ffmpeg(['-i', src, '-vf', `zscale=pin=bt709:p=bt2020:tin=bt709:t=bt709:min=bt709:rin=tv:r=pc,format=gbrp16le,lutrgb=r='${pq}':g='${pq}':b='${pq}',zscale=pin=bt2020:p=bt2020:tin=smpte2084:t=smpte2084:min=gbr:m=bt2020nc:rin=pc:r=tv,format=yuv420p10le`,
      '-c:v', 'libx265', '-crf', '18', '-preset', 'medium', '-tag:v', 'hvc1', '-x265-params',
      `log-level=error:colorprim=bt2020:transfer=smpte2084:colormatrix=bt2020nc:hdr10=1:repeat-headers=1:max-cll=${peak},203:master-display=G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(10000000,1)`,
      '-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-c:a', 'aac', out])
  } else {
    const bg = f.background ?? 'transparent', base = path.join(dir, 'out')
    await vision(job, local === 'depth' ? ['depth', src, out, '--near', f.near ?? 'white'] : ['matte', src, base, '--background', bg])
    job.outputs = local === 'matte' && bg === 'transparent' ? ['out.webm', 'out.mov'] : ['out.mp4']
    return
  }
  job.outputs = ['out.mp4']
}

// vision.py (uv, ONNX models fetched once into ~/.cache/media-generator): its « frame 12/96 » lines become the job's note
const VISION = path.join(ENGINE, 'vision.py')
const VISION_DIR = process.env.MEDIA_GENERATOR_VISION_DIR ?? path.join(os.homedir(), '.cache', 'media-generator', 'models')
function vision(job, argv) {
  return new Promise((ok, ko) => {
    const p = spawn('uv', ['run', '--quiet', VISION, ...argv], { ...HIDE, stdio: ['ignore', 'pipe', 'pipe'] })
    let err = '', last = 0
    p.stdout.on('data', d => {
      const line = String(d).trim().split('\n').pop()
      if (Date.now() - last > 1000 || /^(fetch|load)/.test(line)) { last = Date.now(); progress(job, line) }
    })
    p.stderr.on('data', d => { err += d })
    p.on('error', e => ko(e.code === 'ENOENT' ? new Error(`uv is missing: ${INSTALL.uv}`) : e))
    p.on('exit', code => (code === 0 ? ok() : ko(new Error(err.trim().split('\n').pop() || `vision.py stopped (${code})`))))
  })
}

// inpaint: the model's image (asked at the original's closest ratio, so it holds the whole picture) brought to the
// original's size and laid on it only inside the painted area (the matte, white where painted, never sent), its edge
// feathered and grown a little so the seam falls outside it: the rest keeps the original's pixels
function paste(original, made, matte, out) {
  const s = probe(original), soft = Math.max(2, Math.round(Math.max(s.width, s.height) / 150))
  ffmpeg(['-i', original, '-i', made, '-i', matte, '-filter_complex',
    `[1:v]scale=${s.width}:${s.height},format=rgba[m];` +
    `[2:v]scale=${s.width}:${s.height},format=gray,gblur=sigma=${soft},lut=y='min(255,val*2.5)'[a];[m][a]alphamerge[p];[0:v]format=rgba[o];[o][p]overlay=format=rgb`,
    '-frames:v', '1', '-update', '1', out])
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
  // a Library voice not on the account yet: cloned there first (ElevenLabs' paid plans), its id kept with it
  const v = argv.indexOf('--voice')
  if (v > 0 && argv[v + 1].startsWith('@')) {
    progress(job, `putting ${argv[v + 1]} on ElevenLabs…`)
    argv = argv.with(v + 1, voiceToEleven(argv[v + 1].slice(1)).voice_id)
  }
  progress(job, { dub: 'dubbing with ElevenLabs…', isolate: 'isolating the voice with ElevenLabs…' }[argv[0]] ?? 'changing the voice with ElevenLabs…')
  // a sound comes back as an MP3 (a video's sound as the video, its voice alone)
  const clip = path.join(dir, job.spec.inputs.clip[0]), out = argv[0] === 'dub' ? dir : path.join(dir, `out${kindOfFile(clip) === 'audio' ? '.mp3' : path.extname(clip)}`)
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
  // a middle frame at its time (Grok): --in mid_frames=<file>@<seconds>
  const mid_times = [], voice_names = []
  for (const x of opt.in ?? []) {
    const i = x.indexOf('=')
    if (i < 1) die('--in takes <input>=<file>, the tool\'s inputs (media.mjs tools)')
    let [key, file] = [x.slice(0, i), x.slice(i + 1)]
    const t = key === 'mid_frames' && /@(\d+(\.\d+)?)$/.exec(file)
    if (t) [file, mid_times[(inputs.mid_frames ?? []).length]] = [file.slice(0, t.index), +t[1]]
    // a voice of one's own and its name (Kling 4.0): --in ref_voices=<file>@<Name>
    const v = key === 'ref_voices' && /@(\w{1,20})$/.exec(file)
    if (v) [file, voice_names[(inputs.ref_voices ?? []).length]] = [file.slice(0, v.index), v[1]]
    ;(inputs[key] ??= []).push(path.resolve(file))
  }
  const fields = Object.fromEntries((opt.field ?? []).map(x => { const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1)] }))
  // a model's options (--option key=value), a dialogue's lines (--line "<voice>: <words>")
  const pair = (x, sep, what) => { const i = x.indexOf(sep); if (i < 1) die(what); return [x.slice(0, i).trim(), x.slice(i + sep.length).trim()] }
  const options = opt.option && Object.fromEntries(opt.option.map(x => pair(x, '=', '--option takes <key>=<value>, the model\'s options (media.mjs models audio --json)')))
  const dialogue = opt.line?.map(x => { const [voice, text] = pair(x, ':', '--line takes "<voice_id or @name>: <words>"'); return { voice, text } })
  // a video's lines: --say "<@who>[ (<@voice>)]: <words>", in order
  const lines = opt.say?.map(x => { const [head, text] = pair(x, ':', '--say takes "<@who> (<@voice>): <words>"'); const [, who, voice] = /^\s*(@[\w-]+)?\s*(?:\((@[\w-]+)\))?\s*$/.exec(head) ?? die('--say takes "<@who> (<@voice>): <words>"'); return clean({ who, voice, text }) })
  // Kling's shots: --shot "<seconds>: <words>", in order
  const shots = opt.shot?.map(x => { const [duration, prompt] = pair(x, ':', '--shot takes "<seconds>: <words>"'); return { duration: +duration, prompt } })
  const params = clean({ n: num(opt.n), duration: num(opt.duration), aspect_ratio: opt.ratio, resolution: opt.resolution, quality: opt.quality,
    sound: opt.sound === undefined ? undefined : opt.sound !== 'off', seed: num(opt.seed), voice: opt.voice, options, dialogue, shots, lines,
    mid_times: mid_times.length ? mid_times : undefined, voice_names: voice_names.length ? voice_names : undefined, draft_of: opt['from-draft'],
    frame: num(opt.frame), keyframe_model: opt['keyframe-model'] })
  return { kind, tool: opt.tool ?? (kind === 'audio' ? 'voice' : 'free'), model: opt.model, prompt: opt.prompt ?? args.join(' '), raw: opt.raw, fields, inputs, params, batch: num(opt.batch), workspace: opt.workspace }
}

// image | video | audio: plan, ask (exit 2 without --spend), then run to the end
async function generate(kind) {
  const spec = specFromArgs(kind)
  try {
    if (opt.estimate) {
      const p = total(await plans(spec))
      return console.log(JSON.stringify({ tool: p.tool.id, provider: p.provider, model: p.model, prompt: p.prompt, estimate: p.estimate, shown: money(p.estimate.amount, p.estimate.unit, per1000()) }))
    }
    const jobs = await create(spec, { spend: num(opt.spend), acceptUnknown: opt['accept-unknown'], force: opt.force, by: 'claude' })
    for (const job of jobs) console.log(`${job.label} · ${job.name} · ${money(job.estimate.amount, job.estimate.unit, per1000())} → media/${job.id}`)
    // a batch's jobs run side by side
    const all = await Promise.all(jobs.map(j => run(j.id)))
    for (const done of all.filter(j => j.status === 'done')) {
      console.log(`done: ${done.outputs.map(f => path.join(mediaDir(done.id), f)).join(', ')}`)
      console.log(done.provider === 'local' ? 'cost: free (done here)' : `cost: ${money(done.actual, done.estimate.unit, per1000())}${done.actual_known ? '' : ' (estimated)'}`)
    }
    const failed = all.filter(j => j.status === 'failed')
    if (failed.length) die(failed.map(f => `${f.error} (media/${f.id}, ${money(f.actual, f.estimate.unit)} spent)`).join('\n'), failed.some(f => /402|no credits|key/i.test(f.error)) ? 3 : 1)
  } catch (e) {
    if (e.code === 2) { console.log(JSON.stringify({ estimate: e.estimate, shown: e.shown, reason: e.reason })); die(e.message, 2) }
    die(e.message, e.status === 401 || e.status === 402 ? 3 : e.code ?? 1)
  }
}

async function cmdModels(kind = 'video') {
  if (opt.refresh) {
    const label = PROVIDERS[active()].label
    const r = await PROVIDERS[active()].refresh().catch(e => die(`${label}'s catalog could not be read: ${e.message}`))
    const found = Object.values(r.added).flat().filter(m => m.found)
    console.error(found.length ? `${found.length} new model${found.length > 1 ? 's' : ''} from ${label}'s catalog: ${found.map(m => m.name).join(', ')}` : `${label}'s catalog: nothing new`)
  }
  const list = (await models(kind)).filter(m => !opt.search || `${m.id} ${m.name}`.toLowerCase().includes(opt.search.toLowerCase()))
  if (opt.json) return console.log(JSON.stringify(list.map(({ pricing, ...m }) => m)))
  for (const m of list) {
    const p = m.params, caps = [m.role !== 'create' && m.role !== 'generate' && m.role, p.duration && `${p.duration[0]}–${p.duration.at(-1)} s`, p.resolution?.join('/'),
      p.frames?.length && p.frames.join('+'), p.audio && 'audio', p.n && p.n.max > 1 && `up to ${p.n.max}`, p.references && `${p.references} refs`, p.voices && `${p.voices.length} voices`, p.dialogue && 'dialogue', p.tags && 'audio tags', p.shots && `${p.shots.max} shots`, p.mid_frames && `${p.mid_frames.max} middle frames${p.mid_frames.timed ? ' at their times' : ''}`, p.masks && 'masks of who speaks', p.named_voices && `${p.named_voices} Library voices`, p.draft && 'draft then final', p.options?.length && `options ${p.options.map(o => o.key).join(' ')}`].filter(Boolean)
    console.log(`${m.id}  ${m.name}${caps.length ? `  [${caps.join(', ')}]` : ''}${m.new ? `  new, from the catalog${m.from ? `, ${m.from}` : ''}` : ''}`)
  }
  const added = list.filter(m => m.new).length, direct = list.filter(m => m.provider === 'elevenlabs').length
  if (direct) console.log(`${direct} ElevenLabs models, straight from ElevenLabs (its key, its credits${fromSnapshot ? '; the key lacks models_read: the engine\'s copy of its list' : ''}); options: --option key=value, a dialogue: --line "<voice>: <words>"`)
  console.log(`${list.length - direct} ${kind} models on ${PROVIDERS[active()].label}, the active router (the engine's list, providers/${active()}-models.json${added ? `, plus ${added} new from its catalog: their references unknown, ${active() === 'kie' ? 'priced by providers/kie-catalog-prices.json' : 'priced as listed'}` : ''})`)
}

// how a field is given on the command line: an option's label (Auto for an empty one), several in order, words. A long
// list already printed above (the 82 preset styles…) points at it instead: the output stays short in Claude's context
function fieldHelp(f, seen, where) {
  let list = f.options?.map(o => (typeof o === 'object' ? o.label ?? o.value : o) || 'Auto').join('|')
  if (seen && list?.length > 120) {
    if (seen.has(list)) list = `<the ${f.options.length} choices of ${seen.get(list)} above>`
    else seen.set(list, `${where}'s ${f.key}`)
  }
  if (f.type === 'multi') return `--field ${f.key}="<one>, then <another>" (${list})`
  if (f.type === 'sheets') return `--field ${f.key}="<one>, <another>" (${list}; default ${f.default})`
  if (f.type === 'light') return `--field ${f.key}=<the light in words>${list ? `|${list}` : ''}`
  if (f.type === 'margin') return `--field ${f.key}=<0–2, a share of the image>`
  if (f.type === 'style') return `--field ${f.key}=${list}|<a style of the Library>`
  if (f.type === 'element') return `--field ${f.key}=@<element: ${(f.types ?? TYPES).join('|')}>`
  if (f.type === 'camera') return `--field ${f.key}=<where the camera goes, in words>|${list}`
  if (f.type === 'recolors') return `--field ${f.key}="<item> becomes <color>; …" (up to ${f.max ?? 3})`
  return `--field ${f.key}=${list || `<${f.type}>`}`
}

function cmdTools(kind) {
  const seen = new Map()
  for (const k of kind ? [kind] : KINDS) {
    const list = TOOLS[k].filter(t => !opt.search || `${t.id} ${t.label} ${t.group} ${t.description}`.toLowerCase().includes(opt.search.toLowerCase()))
    if (opt.json) { console.log(JSON.stringify(list)); continue }
    for (const t of list) {
      const ins = t.inputs.map(i => `--in ${i.key}=<${i.kind}>${i.optional ? '?' : ''}`).join(' '), fields = t.fields.map(f => fieldHelp(f, seen, `${k} ${t.id}`)).join(' ')
      const { models: ms, also, why } = toolModels(t)
      // the same recommended models as a tool above: named once, pointed at after
      let rec = ms && ms.map(m => `${m}${why[m] ? ` (${why[m]})` : ''}`).join(', ')
      if (rec && seen.has(rec)) rec = `the same as ${seen.get(rec)}`
      else if (rec) seen.set(rec, `${k} ${t.id}`)
      console.log(`${k} ${t.id} (${t.mode}, ${t.group}${t.routers ? `, ${t.routers.map(r => PROVIDERS[r].label).join(' or ')} only` : ''}): ${t.description}${ins ? `\n    ${ins}` : ''}${fields ? `\n    ${fields}` : ''}${rec ? `\n    models: ${rec}` : ''}${also ? `\n    also: ${also.join(', ')}` : ''}`)
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

// Suno's help with the words (Kie): lyrics written from a theme (2 versions) or a style written out richer. Priced and in
// the ledger like a generation; the dashboard's click is the yes, the CLI's --spend
async function assist(what, text, gateOpts) {
  if (!['lyrics', 'boost'].includes(what)) throw userError('assist writes lyrics or boosts a style')
  if (active() !== 'kie') throw userError('Write lyrics and Boost style are Suno\'s, on Kie: switch the router in Settings')
  const t = String(text ?? '').trim()
  if (!t) throw userError(what === 'lyrics' ? 'say what the song is about' : 'write a style first')
  if (what === 'lyrics' && t.length > 200) throw userError(`a theme is 200 characters at most, this one has ${t.length}`)
  const m = await modelOf('audio', 'suno/extras'), label = what === 'lyrics' ? 'Write lyrics' : 'Boost style'
  const estimate = PROVIDERS.kie.estimate('speech', m, { action: what })
  if (gateOpts.estimate) return { estimate, shown: money(estimate.amount, estimate.unit) }
  gate({ provider: 'kie', estimate }, gateOpts)
  const id = newId(what === 'lyrics' ? 'write-lyrics' : 'boost-style'), line = { id, kind: 'audio', tool: what === 'lyrics' ? 'write-lyrics' : 'boost-style', label, provider: 'kie', model: m.model, unit: 'usd', estimate: estimate.amount, by: gateOpts.by }
  try {
    const r = await PROVIDERS.kie.audio({ model: m.model, action: what, input: what === 'lyrics' ? { prompt: t } : { content: t } })
    // the versions Suno wrote, or the style it gave back (its key is not documented: the longest text of its answer)
    const texts = what === 'lyrics' ? (r.data?.lyricsData ?? r.data?.data ?? []).map(x => ({ title: x.title ?? '', text: x.text ?? '' })).filter(x => x.text)
      : [r.texts?.[0] ?? Object.values(r.data ?? {}).filter(v => typeof v === 'string').sort((a, b) => b.length - a.length)[0]].filter(Boolean).map(text => ({ title: '', text }))
    appendLedger(HOME, { ...line, actual: r.cost ?? estimate.amount, actual_known: r.cost != null, status: 'done' })
    if (!texts.length) throw new Error(`Suno wrote nothing: ${JSON.stringify(r.data).slice(0, 200)}`)
    return { texts, cost: r.cost }
  } catch (e) {
    if (!/^Suno wrote nothing/.test(e.message)) appendLedger(HOME, { ...line, actual: 0, actual_known: false, status: 'failed' })
    throw e
  }
}

// a singer of the Library made a Suno voice (free): Suno gives a phrase to sing in it, from the part where it sings
// (--start, --end, --language); its recording (--verify) proves it is the same voice, then Suno makes it a voice
async function sunoVoice(name, { start, end, language, verify } = {}) {
  const v = element(name)
  if (v?.type !== 'singer' || !v.files.length) throw userError(`no singer @${name} in the Library: add its sung clips (elements add ${name} <clips…> --type singer)`)
  if (active() !== 'kie') throw userError('a Suno voice is made on Kie: switch the router in Settings')
  const f = at('elements', name, 'element.json'), meta = () => (fs.existsSync(f) ? readJson(f) : {})
  if (!verify) {
    // where it sings: as asked, else found (30 s holding the most voice), else all of a short clip
    const long = probe(v.files[0]).duration, found = start == null && end == null && long >= 10 ? sungWindow(v.files[0]) : null
    const a = found?.start ?? seconds(start, 'start') ?? 0, b = found?.end ?? seconds(end, 'end') ?? Math.min(long, a + 30)
    if (b <= a || b > long + 0.05) throw userError(`the part it sings is inside its first clip: 0 to ${long.toFixed(1)} s`)
    const r = await PROVIDERS.kie.audio({ model: 'suno/extras', action: 'phrase', input: { vocal_start_s: a, vocal_end_s: b, ...(language ? { language } : {}) }, files: { voice_url: v.files[0] } })
    const phrase = [r.data?.phrase, r.data?.validationPhrase, r.data?.validation_phrase, r.data?.text].find(x => typeof x === 'string')
    if (!phrase) throw userError(`Suno gave no phrase: ${JSON.stringify(r.data).slice(0, 200)}`)
    writeJson(f, { ...meta(), suno: { ...meta().suno, pending: { task_id: r.task_id, phrase } } })
    return { phrase, task_id: r.task_id }
  }
  const pending = meta().suno?.pending
  if (!pending) throw userError(`ask @${name}'s phrase first (elements suno ${name} --start <s> --end <s>)`)
  if (!fs.existsSync(verify)) throw userError(`no such file: ${verify}`)
  // a recording from the browser (webm) becomes an MP3 first
  let file = path.resolve(verify)
  if (/\.webm$/i.test(file)) { const mp3 = file.replace(/\.webm$/i, '.mp3'); ffmpeg(['-i', file, '-b:a', '192k', mp3]); file = mp3 }
  const r = await PROVIDERS.kie.audio({ model: 'suno/extras', action: 'voice', input: { task_id: pending.task_id, voice_name: name, ...(v.words ? { description: v.words.slice(0, 200) } : {}) }, files: { verify_url: file } })
  const id = [r.data?.voiceId, r.data?.voice_id, r.data?.personaId, r.data?.id].find(x => typeof x === 'string')
  if (!id) throw userError(`Suno made no voice: ${JSON.stringify(r.data).slice(0, 200)}`)
  writeJson(f, { ...meta(), suno: { voice_id: id } })
  return element(name)
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
  const kie = b.kie
  console.log(kie.error ? `kie: ${kie.error}` : `kie: ${kie.credits} credits left (${money(kie.account_left, 'usd')})`)
  const el = b.elevenlabs
  console.log(el.error ? `elevenlabs: ${el.error}` : `elevenlabs: ${money(el.left, 'credits', usd)} left of ${el.limit}${el.reset ? `, renewed on ${el.reset}` : ''}`)
  console.log(`active router: ${PROVIDERS[active()].label}`)
  for (const p of ['openrouter', 'kie', 'elevenlabs']) {
    const spent = spentThisMonth(ledger, p), cap = s[p].cap
    const unit = p === 'elevenlabs' ? 'credits' : 'usd'
    console.log(`${p} this month here: ${money(spent, unit, usd)}${cap != null ? ` of a ${money(cap, unit, usd)} cap` : ''}`)
  }
  for (const e of ledger.slice(-10)) console.log(`  ${e.at.slice(0, 16).replace('T', ' ')}  ${e.label} · ${e.model}  ${money(e.actual, e.unit, usd)}${e.actual_known ? '' : ' (est.)'}  ${e.status} · ${e.by}`)
}

// setup [set <section>.<key>=<value|none>…]: the thresholds, caps, ElevenLabs' price and default models
function setup(sub, ...rest) {
  const s = settings()
  if (sub === 'vision') {
    if (!hasBin('uv')) die(`uv is missing: ${INSTALL.uv}`)
    const r = spawnSync('uv', ['run', '--quiet', VISION, 'fetch'], { ...HIDE, stdio: 'inherit' })
    if (r.status !== 0) die('the vision models could not be fetched')
    return
  }
  if (sub === 'set') {
    for (const kv of rest) {
      const [k, v] = [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)], [sec, key] = k.split('.')
      if (sec === 'workspace') die('setup set: the workspace changes with media.mjs workspaces use <slug>')
      if (!SETTINGS[sec] || !(key in SETTINGS[sec])) die(`setup set: ${k} is not one of ${Object.entries(SETTINGS).flatMap(([a, o]) => Object.keys(o).map(b => `${a}.${b}`)).join(', ')}`)
      s[sec][key] = sec === 'router' ? (PROVIDERS[v] ? v : die(`setup set: router.active is one of ${Object.keys(PROVIDERS).join(', ')}`))
        : v === 'none' || v === '' ? null : sec === 'developer' ? (v === 'on' || v === 'off' ? v === 'on' : die('setup set: developer.on is on, off or none'))
        : sec === 'defaults' ? v
        : key === 'plan' ? (v in PLANS ? v : die(`setup set: elevenlabs.plan is one of ${Object.keys(PLANS).join(', ')}, or none`))
        : Number.isFinite(+v) && +v >= 0 ? +v : die(`setup set: ${k} is a number, or none`)
    }
    ensureHome()
    writeJson(at('settings.json'), s)
  } else if (sub) die('usage: setup [vision | set router.active=<openrouter|kie> openrouter.threshold=<usd> openrouter.cap=<usd> kie.threshold=<usd> kie.cap=<usd> elevenlabs.threshold=<credits> elevenlabs.cap=<credits> elevenlabs.plan=<${Object.keys(PLANS).join('|')}> defaults.video=<model> developer.on=<on|off>…]')
  for (const [sec, o] of Object.entries(s)) console.log(`${sec}: ${Object.entries(o).map(([k, v]) => `${k} ${v ?? 'not set'}`).join(' · ')}`)
}

// elements [add|set <name> [<files…>] | show <name> | remove <name> | elevenlabs <name> | suno <name>]: the characters, outfits,
// objects, places, poses, brands and voices of the Library. add makes one or adds to it, set changes one; both take
// --type, --words, --colors "#hex,#hex" and --font (a brand), --from <generation> (its results) and --drop <file>
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
async function elements(sub, name, ...files) {
  const usage = `usage: elements [add|set <name> [<files…>] [--type ${TYPES.join('|')}] [--words "…"] [--colors "#hex,#hex"] [--font "…"] [--voice @<voice>] [--from <generation>] [--drop <file>] [--workspace <slug>|none] | suno <name> [--start <s> --end <s> --language <code> | --verify <recording>] | keep <name> --from <generation> [--take 1|2|3] | show <name> | remove <name> | elevenlabs <name>]`
  try {
    if (sub === 'add' || sub === 'set') {
      if (sub === 'set' && !element(name)) throw userError(`no Element @${name}: elements add ${name} <files…>`)
      saveElement(name, { type: opt.type, words: opt.words, colors: opt.colors?.split(/[,\s]+/).filter(Boolean), font: opt.font, voice: opt.voice, files: files.map(f => path.resolve(f)), from: opt.from, drop: opt.drop,
        workspace: opt.workspace === 'none' ? null : opt.workspace })
    } else if (sub === 'suno') {
      const r = await sunoVoice(name, { start: opt.start, end: opt.end, language: opt.language, verify: opt.verify })
      return console.log(r.phrase ? `sing or say this in the same voice, record it, then: elements suno ${name} --verify <recording>\n${r.phrase}` : `@${name} is a Suno singer: Music's Singer field takes it (--field singer=@${name})`)
    } else if (sub === 'keep') {
      // a preview of Design a voice or Remix a voice kept as a voice of the account and of the Library
      if (!opt.from?.length) die(usage)
      await keepVoice(String(opt.from[0]).split(/[\\/]/).filter(Boolean).pop(), `preview-${num(opt.take) ?? 1}.mp3`, name)
    } else if (sub === 'show') {
      const el = element(name)
      if (!el) throw userError(`no Element @${name}`)
      return console.log(JSON.stringify(el, null, 2))
    } else if (sub === 'remove') fs.rmSync(at('elements', name ?? '-'), { recursive: true, force: true })
    else if (sub === 'elevenlabs') voiceToEleven(name)
    else if (sub) die(usage)
  } catch (e) { die(e.message) }
  const list = elementList()
  for (const el of list) console.log(`@${el.name}: ${el.type}, ${plural(el.files.length, heard(el.type) ? 'clip' : 'image')}${el.colors.length ? ` · ${el.colors.join(' ')}` : ''}${el.words ? ` · ${el.words}` : ''}${el.voice ? ` · speaks as @${el.voice}` : ''}${el.voice_id ? ` · ElevenLabs ${el.voice_id}` : ''}`)
  if (!list.length) console.log('no element yet: elements add <name> <images…> --type character')
}

// styles [add|set <name> [<images…>] [--words "…"] [--from <generation>] [--drop <file>] | add|set <name> --for
// music|voice|sound --words "…" | show <name> | remove <name>]: the Library's styles, a look taken from images, or a
// sound in words (for music, a voice or a sound effect)
function styles(sub, name, ...files) {
  try {
    const all = [...files.map(f => path.resolve(f)), ...outputsOf(opt.from, 'image')]
    if (sub === 'add') {
      if (!NAME.test(name ?? '') || (!all.length && !opt.for)) die('usage: styles add <name> <images…> [--words "the look in words"] [--from <generation>], or styles add <name> --for music|voice|sound --words "the sound in words" (letters, digits, - and _)')
      addStyle(name, all, opt.words, [], opt.for)
    } else if (sub === 'set') {
      if (!savedStyle(name)) throw userError(`no style ${name}: styles add ${name} <images…>`)
      addStyle(name, all, opt.words, opt.drop)
    } else if (sub === 'show') {
      const s = savedStyle(name)
      if (!s) throw userError(`no style ${name}`)
      return console.log(JSON.stringify(s, null, 2))
    } else if (sub === 'remove') fs.rmSync(at('styles', name ?? '-'), { recursive: true, force: true })
    else if (sub) die('usage: styles [add|set <name> [<images…>] [--words "…"] [--from <generation>] [--drop <file>] | add <name> --for music|voice|sound --words "…" | show <name> | remove <name>]')
  } catch (e) { die(e.message) }
  const list = savedStyles()
  for (const s of list) console.log(`${s.name}: ${s.for ? `${s.for} style` : plural(s.files.length, 'image')}${s.words ? ` · ${s.words}` : ''}`)
  if (!list.length) console.log('no style yet: styles add <name> <images…> [--words "…"], or styles add <name> --for music|voice|sound --words "…"')
}
// family: a sound style's (music, voice, sound), kept once made; a visual style has none
function addStyle(name, files, words, drop = [], family) {
  const was = savedStyle(name), kind = family ?? was?.for
  if (family && !SOUND_STYLES.includes(family)) throw userError(`a sound style is for ${SOUND_STYLES.join(', ')} (--for music)`)
  if (was && family && was.for !== family) throw userError(`${name} is already a ${was.for ?? 'visual'} style: pick another name`)
  if (kind && files.length) throw userError(`${name} is a ${kind} style: its words alone, no image`)
  const text = (words ?? was?.words ?? '').trim()
  if (kind && !text) throw userError(`a ${kind} style is its words: --words "…"`)
  ensureHome()
  const d = at('styles', name)
  fs.mkdirSync(d, { recursive: true })
  for (const f of files) copyIn(d, f)
  for (const f of drop) fs.rmSync(path.join(d, path.basename(f)), { force: true })
  // more images keep the words already written, unless new ones come
  writeJson(path.join(d, 'style.json'), { words: text, ...(kind ? { for: kind } : {}) })
}

// workspaces [list | new <name> | use <slug> | rename <slug> <name> | add <slug> <generations…> | drop <slug>
// <generations…> | show <slug> [--json] | remove <slug>]: a project's media, Elements and timeline. New generations
// join the current one (--workspace <slug> picks another for one)
function workspaces(sub, slug, ...rest) {
  const usage = 'usage: workspaces [list | new <name> | use <slug> | rename <slug> <name> | add|drop <slug> <generations…> | show <slug> [--json] | remove <slug>]'
  try {
    ensureHome()
    if (sub === 'new') return (useWorkspace(slug = newWorkspace([slug, ...rest].join(' '))), console.log(`workspace ${slug} made, and current`))
    if (sub && sub !== 'list' && !workspace(slug)) throw userError(slug ? `no workspace ${slug}` : usage)
    if (sub === 'use') useWorkspace(slug)
    else if (sub === 'rename') saveWorkspace(slug, { name: rest.join(' ').trim() || die(usage) })
    else if (sub === 'add' || sub === 'drop') member(slug, rest, sub === 'add')
    else if (sub === 'remove') removeWorkspace(slug)
    else if (sub === 'show') {
      const w = workspace(slug), jobs = allJobs().filter(j => j.workspaces?.includes(slug) && j.status === 'done').sort((a, b) => a.id.localeCompare(b.id))
      const files = jobs.flatMap(j => j.outputs.map(o => ({ id: j.id, label: j.label, file: path.join(mediaDir(j.id), o) })))
      if (opt.json) return console.log(JSON.stringify({ ...w, linked: linkedElements(slug), files }, null, 2))
      console.log(`${w.name} (${slug}${slug === currentWorkspace() ? ', current' : ''}): ${plural(files.length, 'file')}`)
      for (const f of files) console.log(`  ${f.file}  ${f.label}`)
      const linked = linkedElements(slug)
      if (linked.length) console.log(`elements: ${linked.map(n => `@${n}`).join(' ')}`)
      return console.log(editText(slug) ?? 'the timeline is empty')
    } else if (sub && sub !== 'list') die(usage)
  } catch (e) { die(e.message) }
  const now = currentWorkspace(), jobs = allJobs()
  for (const w of workspaceList()) console.log(`${w.slug === now ? '*' : ' '} ${w.slug}  ${w.name} · ${plural(jobs.filter(j => j.workspaces?.includes(w.slug)).length, 'generation')} · ${plural(w.timeline.clips.length, 'clip')} on its timeline`)
}

function doctor() {
  const has = hasBin
  const checks = [['node 22 or later', +process.versions.node.split('.')[0] >= 22, INSTALL.node], ['ffmpeg and ffprobe', has('ffmpeg') && has('ffprobe'), INSTALL.ffmpeg],
    ['the dashboard is built', fs.existsSync(path.join(STUDIO, 'index.html')), 'npm run build in plugins-src/skill-video/media-studio']]
  for (const [name, ok, fix] of checks) console.log(`${ok ? 'ok     ' : 'MISSING'} ${name}${ok ? '' : `: ${fix}`}`)
  // optional: only a video or a voice sent to OpenRouter needs it, the rest works without
  console.log(has('cloudflared') ? 'ok      cloudflared (videos and voices sent to OpenRouter by a tunnel)'
    : `missing cloudflared: ${INSTALL.cloudflared} (no account), for a video or a voice sent to OpenRouter (video edits, upscale, talking avatar); everything else works`)
  // optional too: Depth map and Remove background run ONNX models here, fetched once (vision.py)
  const fetched = fs.existsSync(path.join(VISION_DIR, 'depth-anything-v2-small.onnx')) && fs.existsSync(path.join(VISION_DIR, 'birefnet-lite.onnx'))
  console.log(!has('uv') ? `missing uv: ${INSTALL.uv}, for Depth map and Remove background (run here, free); everything else works`
    : fetched ? 'ok      uv and the vision models (Depth map, Remove background)'
      : 'ok      uv; the vision models are not fetched yet: media.mjs setup vision (330 MB, once), or at their first use')
  console.log(process.env.OPENROUTER_API_KEY ? 'openrouter: key set' : 'openrouter: no key, nothing can be generated; the plugin\'s secret: /plugin configure skill-video@pabrisson')
  console.log(process.env.OPENROUTER_MANAGEMENT_KEY ? 'openrouter management key: set (the account\'s balance)' : 'openrouter management key: not set (the key\'s own limit only)')
  console.log(process.env.KIE_API_KEY ? 'kie: key set' : 'kie: no key (the default router: with OpenRouter\'s key alone, switch the router in Settings › Router)')
  console.log(`active router: ${PROVIDERS[active()].label}${PROVIDERS[active()].key() ? '' : ', without its key: nothing can be generated'}`)
  console.log(process.env.ELEVENLABS_API_KEY ? 'elevenlabs: key set (Voice and dialogues straight from ElevenLabs, change voice, translate, sound effects, music, voice design, transcripts)' : 'elevenlabs: no key, no voice change or translation (the routers\' ElevenLabs voices stay)')
  const s = settings()
  console.log(`limits: ${['openrouter', 'kie', 'elevenlabs'].map(p => `${p} threshold ${s[p].threshold ?? 'none'}, cap ${s[p].cap ?? 'none'}`).join(' · ')}`)
  console.log(`folder: ${HOME}`)
  if (fs.existsSync(at('media'))) {
    const kept = spawnSync('git', ['-C', HOME, 'check-ignore', '--no-index', 'media/x', 'elements/x', 'styles/x', 'workspaces/x', 'ledger.jsonl', 'settings.json'], { ...HIDE, encoding: 'utf8' })
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
const startRun = id => spawn(process.execPath, [SELF, 'run', id], { cwd: HOME, env: { ...process.env, MEDIA_GENERATOR_DIR: HOME, MEDIA_GENERATOR_QUIET: '1' }, detached: true, ...HIDE, stdio: 'ignore' }).unref()

// what each result's files are, measured once: their size and length (the bin's filters, a clip's length)
let metaCache = null
function metaOf(job) {
  const file = at('.cache', 'meta.json'), out = {}
  metaCache ??= fs.existsSync(file) ? readJson(file) : {}
  let changed = false
  for (const o of job.outputs) {
    const key = `${job.id}/${o}`
    if (!(key in metaCache)) {
      try { const s = probe(path.join(mediaDir(job.id), o)); metaCache[key] = clean({ w: s.width, h: s.height, dur: s.duration || undefined }) } catch { metaCache[key] = {} }
      changed = true
    }
    out[o] = metaCache[key]
  }
  if (changed) writeJson(file, metaCache)
  return out
}

function mediaList() {
  if (!fs.existsSync(at('media'))) return []
  return fs.readdirSync(at('media')).filter(d => fs.existsSync(path.join(mediaDir(d), 'job.json'))).sort().reverse().map(d => {
    const j = readJob(d)
    // a run that stopped (machine asleep, process killed) is resumed: its video job id was kept
    if (j.status === 'running' && !alive(j.pid)) { j.status = 'queued'; saveJob(j); startRun(j.id) }
    const { spec, ...rest } = j
    // place: where a Bridge shot or a take goes on its workspace's timeline once done
    return { ...rest, fields: spec.fields, params: spec.params, inputs: spec.inputs, raw_prompt: spec.prompt, raw: !!spec.raw, place: spec.place, meta: j.status === 'done' ? metaOf(j) : undefined }
  })
}

let balanceCache = { at: 0, value: null }

// the fake APIs (FAKE): the header's toggle, shown in developer mode, turns them off (the real APIs, with the server's
// keys) and on again, for this server and the runs it starts; developer mode turned on turns them on, off turns them off
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
    return reply(res, 200, { home: HOME, settings: settings(), keys: { openrouter: !!process.env.OPENROUTER_API_KEY, management: !!process.env.OPENROUTER_MANAGEMENT_KEY, kie: !!process.env.KIE_API_KEY, elevenlabs: !!process.env.ELEVENLABS_API_KEY },
      fake: fakeState(), router: active(), catalog: PROVIDERS[active()].catalogInfo(),
      media: mediaList(), drafts, styles: savedStyles(), elements: elementList(), plans: PLANS,
      workspaces: (jobs => workspaceList().map(w => ({ ...w, linked: linkedElements(w.slug, jobs) })))(allJobs()), month: Object.fromEntries(['openrouter', 'kie', 'elevenlabs'].map(x => [x, spentThisMonth(readLedger(HOME), x)])) })
  }
  // the tools with the active router's model lists
  if (p === '/api/tools') return reply(res, 200, Object.fromEntries(Object.entries(TOOLS).map(([k, list]) => [k, list.filter(t => !t.routers || t.routers.includes(active())).map(t => ({ ...t, ...toolModels(t) }))])))
  // Settings' « Update the list »: the active router's catalog read now, what it adds
  if (p === '/api/models/refresh' && post) return reply(res, 200, await PROVIDERS[active()].refresh())
  if (p === '/api/models') {
    const kind = url.searchParams.get('kind'), router = url.searchParams.get('router')
    return reply(res, 200, (await models(kind, PROVIDERS[router] ? router : active())).map(({ pricing, ...m }) => m))
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
      const pl = total(await plans(spec)), s = settings()
      return reply(res, 200, { model: pl.model, provider: pl.provider, prompt: pl.prompt, estimate: pl.estimate, shown: money(pl.estimate.amount, pl.estimate.unit, per1000()),
        needs: pl.provider === 'local' ? null : needsYes(pl.estimate, s[pl.provider], spentThisMonth(readLedger(HOME), pl.provider)) })
    } catch (e) { return reply(res, 400, { error: e.message }) }
  }
  if (p === '/api/generate' && post) {
    const { confirm, ...spec } = await readBody(req)
    try {
      const jobs = await create(spec, { by: 'dashboard', confirm })
      for (const j of jobs) startRun(j.id)
      return reply(res, 200, { id: jobs[0].id, ids: jobs.map(j => j.id) })
    } catch (e) { return reply(res, e.code === 2 ? 409 : 400, { error: e.message, needs: e.reason, estimate: e.estimate, shown: e.shown }) }
  }
  if (p === '/api/upload' && post) {
    ensureHome()
    const name = path.basename(url.searchParams.get('name') ?? 'file').replace(/[^\w.-]/g, '_'), file = at('.cache', 'uploads', `${Date.now()}-${name}`)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    await pipeline(req, fs.createWriteStream(file))
    return reply(res, 200, { path: file })
  }
  // a frame of a video, to draw or paint on (Sketch, mask): its first, its last (last) or the one at t seconds
  if (p === '/api/frame' && post) {
    const { path: file, last, t } = await readBody(req), src = inside(HOME, file)
    if (!src) return reply(res, 403, { error: 'outside the folder' })
    const out = at('.cache', 'uploads', `${Date.now()}-frame.png`)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    const grab = argv => (ffmpeg([...argv, '-update', '1', out]), fs.existsSync(out))
    // the last frame: every frame of the last second written over the same file (a picture that stops before its sound
    // has none at its end); a time past the picture's end takes it too
    const lastFrame = () => grab(['-sseof', '-1', '-i', src])
    if (!(last ? lastFrame() : grab([...(t > 0 ? ['-ss', `${+t}`] : []), '-i', src, '-frames:v', '1']) || lastFrame())) return reply(res, 400, { error: 'no frame in this file' })
    return reply(res, 200, { path: out })
  }
  // a video sent as an input, cut to the part and the area kept (Edit reference, a clip of the timeline): a new file, the
  // original stays; a sound alone is cut to an .mp3. crop is { x, y, w, h } in fractions of the frame
  if (p === '/api/cut' && post) {
    const { path: file, start = 0, end, crop } = await readBody(req), src = inside(HOME, file)
    if (!src) return reply(res, 403, { error: 'outside the folder' })
    const s = probe(src), from = Math.max(0, +start), to = Math.min(s.duration, +(end ?? s.duration))
    if (!(to - from >= 0.1)) return reply(res, 400, { error: 'the cut keeps less than 0.1 s' })
    const even = x => Math.max(2, Math.floor(x / 2) * 2), clamp = (x, max) => Math.min(Math.max(0, x || 0), max)
    const w = crop && even(clamp(crop.w, 1) * s.width), h = crop && even(clamp(crop.h, 1) * s.height)
    const vf = crop ? ['-vf', `crop=${w}:${h}:${Math.round(clamp(crop.x * s.width, s.width - w))}:${Math.round(clamp(crop.y * s.height, s.height - h))}`] : []
    const sound = !s.width, out = at('.cache', 'uploads', `${Date.now()}-${path.basename(src, path.extname(src)).replace(/^\d+-/, '')}-cut.${sound ? 'mp3' : 'mp4'}`)
    fs.mkdirSync(path.dirname(out), { recursive: true })
    ffmpeg(['-ss', `${from}`, '-i', src, '-t', `${to - from}`, ...(sound ? ['-vn', '-b:a', '192k'] : [...vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac']), out])
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
      estimate: { amount: 0, unit: 'usd', known: true, detail: 'imported, free' }, actual: 0, actual_known: true, status: 'done', by: 'dashboard', created: now, finished: now, outputs: [name],
      workspaces: [currentWorkspace()] })
    return reply(res, 200, { id, kind })
  }
  // a result's files as one .zip (Download all: a Stems' tracks, a song's takes and covers…)
  const zipOf = p.match(/^\/api\/media\/([\w-]+)\/zip$/)
  if (zipOf && !post) {
    const id = zipOf[1], dir = mediaDir(id)
    if (!fs.existsSync(path.join(dir, 'job.json'))) return reply(res, 404, { error: 'no such generation' })
    const entries = readJob(id).outputs.filter(o => fs.existsSync(path.join(dir, o))).map(o => ({ name: `${id}/${o}`, file: path.join(dir, o) }))
    return await sendZip(res, id, entries).catch(() => res.destroy())
  }
  if (p.startsWith('/api/media/') && post) {
    const [, , , id, action] = p.split('/'), dir = mediaDir(path.basename(id))
    if (!fs.existsSync(dir)) return reply(res, 404, { error: 'no such generation' })
    if (action === 'favorite') { const j = readJob(id); j.favorite = !j.favorite; saveJob(j) }
    else if (action === 'delete') { fs.mkdirSync(at('.trash'), { recursive: true }); fs.renameSync(dir, at('.trash', id)) }
    else return reply(res, 404, { error: 'unknown action' })
    return reply(res, 200, { ok: true })
  }
  // Suno's help with the words, and a singer of the Library made a Suno voice
  if (p === '/api/assist' && post) {
    const { what, text, confirm } = await readBody(req)
    try { return reply(res, 200, await assist(what, text, { by: 'dashboard', confirm })) } catch (e) { return reply(res, e.code === 2 ? 409 : 400, { error: e.message, ...(e.code === 2 ? { needs: e.reason, shown: e.shown } : {}) }) }
  }
  // where a sound sings the most (Make a singer's window)
  if (p === '/api/sung' && post) {
    const { path: file } = await readBody(req), src = file && inside(HOME, file)
    if (!src) return reply(res, 403, { error: 'outside the folder' })
    try { return reply(res, 200, { ...sungWindow(src), duration: probe(src).duration }) } catch (e) { return reply(res, 400, { error: e.message }) }
  }
  // recordings cleaned before they make an Element (a singer of one's own): each an Isolate voice job of the Library,
  // run here and waited for; the threshold asks first (409)
  if (p === '/api/clean' && post) {
    const { paths = [], confirm } = await readBody(req), files = paths.map(f => inside(HOME, f)).filter(Boolean), out = []
    try {
      for (const f of files) {
        const [job] = await create({ kind: 'audio', tool: 'isolate-voice', inputs: { clip: [f] } }, { by: 'dashboard', confirm })
        const done = await run(job.id)
        if (done.status !== 'done') throw userError(`${path.basename(f)}: ${done.error}`)
        out.push(path.join(mediaDir(done.id), done.outputs[0]))
      }
      return reply(res, 200, { paths: out })
    } catch (e) { return reply(res, e.code === 2 ? 409 : 400, { error: e.message, needs: e.reason, shown: e.shown }) }
  }
  if (p === '/api/elements/suno' && post) {
    const { name, start, end, language, verify } = await readBody(req)
    try { return reply(res, 200, await sunoVoice(name, { start, end, language, verify: verify && inside(HOME, verify) })) } catch (e) { return reply(res, 400, { error: e.message }) }
  }
  if (p === '/api/settings' && post) {
    const body = await readBody(req), s = settings(), was = s.developer.on
    for (const sec of Object.keys(SETTINGS).filter(x => x !== 'workspace')) for (const k of Object.keys(SETTINGS[sec])) if (body[sec] && k in body[sec]) {
      const v = body[sec][k]
      s[sec][k] = sec === 'router' ? (PROVIDERS[v] ? v : s[sec][k]) : v === null || v === '' ? null : sec === 'developer' ? !!v : sec === 'defaults' ? String(v) : k === 'plan' ? (v in PLANS ? v : s[sec][k]) : Number.isFinite(+v) && +v >= 0 ? +v : s[sec][k]
    }
    ensureHome()
    writeJson(at('settings.json'), s)
    // developer mode turned on or off: the fake APIs with it
    if (Object.keys(FAKE).length && settings().developer.on !== was) useFake(settings().developer.on)
    // another router: its balance in the header
    balanceCache = { at: 0, value: null }
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
  // a preview of Design a voice or Remix a voice kept: a voice of the account and of the Library
  if (p === '/api/keep-voice' && post) {
    const { id, file, name } = await readBody(req)
    try { return reply(res, 200, await keepVoice(id, file, name)) } catch (e) { return reply(res, 400, { error: e.message }) }
  }
  // the Library's Elements: made or changed from the page (a path inside the folder: an upload, a result), removed, a
  // voice put on the ElevenLabs account
  if (p === '/api/elements') {
    if (post) {
      const { name, paths, remove, elevenlabs, type, words, colors, font, voice, drop, workspace: ws } = await readBody(req)
      if (!NAME.test(name ?? '')) return reply(res, 400, { error: 'a name of letters, digits, - and _' })
      try {
        if (remove) fs.rmSync(at('elements', name), { recursive: true, force: true })
        else if (elevenlabs) voiceToEleven(name)
        else saveElement(name, { type, words, colors, font, voice, drop, workspace: ws, files: (paths ?? []).map(f => inside(HOME, f)).filter(Boolean) })
      } catch (e) { return reply(res, 400, { error: e.message }) }
    }
    return reply(res, 200, elementList())
  }
  if (p === '/api/styles' && post) {
    const { name, paths, words, drop, remove, for: family } = await readBody(req)
    if (!NAME.test(name ?? '')) return reply(res, 400, { error: 'a name of letters, digits, - and _' })
    if (remove) fs.rmSync(at('styles', name), { recursive: true, force: true })
    else {
      const files = (paths ?? []).filter(f => inside(HOME, f) && kindOfFile(f) === 'image')
      if (!files.length && !family && !savedStyle(name)) return reply(res, 400, { error: 'a style takes one image or more' })
      try { addStyle(name, files, words, drop, family) } catch (e) { return reply(res, 400, { error: e.message }) }
    }
    return reply(res, 200, savedStyles())
  }
  // the workspaces: made (it becomes the current one), picked, renamed, removed; media join or leave one, Elements are
  // linked or unlinked, its timeline saved
  if (p === '/api/workspaces' && post) {
    const b = await readBody(req)
    try {
      if (b.new != null) useWorkspace(newWorkspace(b.new))
      else {
        if (!workspace(b.slug)) throw userError(`no workspace ${b.slug}`)
        if (b.use) useWorkspace(b.slug)
        if (b.name != null) { if (!String(b.name).trim()) throw userError('a workspace needs a name'); saveWorkspace(b.slug, { name: String(b.name).trim().slice(0, 60) }) }
        if (b.add) member(b.slug, b.add, true)
        if (b.drop) member(b.slug, b.drop, false)
        if (b.link || b.unlink) saveWorkspace(b.slug, { elements: [...new Set([...workspace(b.slug).elements, ...(b.link ?? []).filter(n => element(n))])].filter(n => !(b.unlink ?? []).includes(n)) })
        if (b.timeline) {
          // a copy older than the saved one: the page takes the saved one instead
          const now = workspace(b.slug).timeline
          if (b.rev != null && b.rev !== now.rev) return reply(res, 409, { error: 'the timeline changed in another window', timeline: now })
          saveWorkspace(b.slug, { timeline: { ...cleanTimeline(b.timeline), rev: now.rev + 1 } })
        }
        if (b.remove) removeWorkspace(b.slug)
      }
    } catch (e) { return reply(res, 400, { error: e.message }) }
    return reply(res, 200, { current: currentWorkspace(), workspaces: workspaceList() })
  }
  // a workspace's edit in words (Copy prompt for video-editor), and the whole of it as a .zip
  const wsRoute = p.match(/^\/api\/workspaces\/([a-z0-9-]+)\/(edit|zip)$/)
  if (wsRoute) {
    const [, slug, what] = wsRoute
    if (!workspace(slug)) return reply(res, 404, { error: `no workspace ${slug}` })
    try {
      if (what === 'edit') {
        const text = editText(slug)
        return reply(res, 200, { text: text && `${text}\nThe timeline as data: ${wsFile(slug)} (timeline).` })
      }
      if (what === 'zip') {
        const { root, entries } = zipEntries(slug, url.searchParams.has('edit'))
        // once it streams, a failure can only cut it short
        return await sendZip(res, root, entries).catch(() => res.destroy())
      }
    } catch (e) { return reply(res, 400, { error: e.message }) }
  }
  // a file's picture on the timeline, made once: a video's frames side by side (STRIP of them over its length), a
  // sound's waveform (white, the page tints it)
  if (p === '/api/strip' || p === '/api/wave') {
    const src = inside(HOME, url.searchParams.get('path') ?? '')
    if (!src || !fs.existsSync(src)) return reply(res, 404, { error: 'not found' })
    const out = at('.cache', 'strips', `${createHash('sha1').update(`${p}${src}${fs.statSync(src).mtimeMs}`).digest('hex').slice(0, 16)}.png`)
    if (!fs.existsSync(out)) {
      fs.mkdirSync(path.dirname(out), { recursive: true })
      try {
        if (p === '/api/strip') ffmpeg(['-i', src, '-vf', `fps=${STRIP / (probe(src).duration || 1)},scale=-2:48,tile=${STRIP}x1`, '-frames:v', '1', out])
        else ffmpeg(['-i', src, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=2000x120:colors=white', '-frames:v', '1', out])
      } catch { return reply(res, 400, { error: 'no picture of this file' }) }
    }
    return sendFile(req, res, out)
  }
  // the style presets' samples, shipped with the engine
  if (p.startsWith('/previews/')) {
    const f = inside(PREVIEWS, path.join(PREVIEWS, decodeURIComponent(p.slice('/previews/'.length))))
    return f && fs.existsSync(f) && fs.statSync(f).isFile() ? sendFile(req, res, f) : reply(res, 404, { error: 'not found' })
  }
  // the folder's files for the page: media, elements, styles, uploads
  if (p === '/files') {
    const f = inside(HOME, url.searchParams.get('path') ?? '')
    return f && fs.existsSync(f) && fs.statSync(f).isFile() ? sendFile(req, res, f) : reply(res, 404, { error: 'not found' })
  }
  if (!fs.existsSync(path.join(STUDIO, 'index.html'))) return reply(res, 503, { error: `the dashboard is not built (${STUDIO})` })
  const f = inside(STUDIO, path.join(STUDIO, decodeURIComponent(p)))
  return sendFile(req, res, f && fs.existsSync(f) && fs.statSync(f).isFile() ? f : path.join(STUDIO, 'index.html'))
}

function serve() {
  ensureHome()
  // a server started on fake APIs uses them in developer mode only
  if (Object.keys(FAKE).length) useFake(settings().developer.on)
  http.createServer((req, res) => handle(req, res).catch(e => reply(res, 500, { error: e.message })))
    .listen(PORT, '127.0.0.1', () => console.log(`media-generator server on http://127.0.0.1:${PORT}/ for ${HOME}`))
  // every router's catalog read again at each start, the page not waiting for it (then once a day, or Settings' « Update
  // the list »); a router that cannot be read keeps its last one
  for (const p of Object.values(PROVIDERS)) p.refresh?.().then(r => {
    const found = Object.values(r.added).flat().filter(m => m.found)
    if (found.length) console.log(`${p.label}: ${found.length} new model${found.length > 1 ? 's' : ''} (${found.map(m => m.name).join(', ')})`)
  }, e => console.error(`${p.label}: its catalog could not be read (${e.message}), the last one kept`))
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
    const procs = new Map(execFileSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { ...HIDE, encoding: 'utf8' }).trim().split('\n').map(l => {
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
    spawn(process.execPath, [SELF, 'serve'], { cwd: HOME, env: { ...process.env, MEDIA_GENERATOR_DIR: HOME, MEDIA_GENERATOR_PORT: `${ports[i]}` }, detached: true, ...HIDE, stdio: ['ignore', log, log] }).unref()
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
  if (opt.open) spawn(process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open', [url], { detached: true, ...HIDE, stdio: 'ignore' }).on('error', () => {}).unref()
}

const commands = {
  doctor, setup: () => setup(...args), studio, serve, draft, credits, jobs: () => jobs(args[0]), elements: () => elements(...args), styles: () => styles(...args), workspaces: () => workspaces(...args),
  models: () => cmdModels(args[0]), tools: () => cmdTools(args[0]),
  image: () => generate('image'), video: () => generate('video'), audio: () => generate('audio'),
  run: async () => { const j = await run(args[0]); console.log(`${j.status}: ${j.outputs.join(', ') || j.error}`) },
  // Suno's help with the words: lyrics from a theme, a style written out richer (priced: --estimate, then --spend)
  lyrics: () => cliAssist('lyrics'), boost: () => cliAssist('boost'),
  // ElevenLabs' voices of the account, and a clone of a voice from recordings: video-editor's engine does it
  voices: () => relay(['voices', ...args, ...(opt.json ? ['--json'] : [])]), 'voice-clone': () => relay(['voice-clone', ...args]),
}
function relay(argv) {
  const r = videoMjs(argv)
  process.stdout.write(r.stdout)
  process.stderr.write(r.stderr)
  process.exit(r.status ?? 1)
}
async function cliAssist(what) {
  try {
    const r = await assist(what, opt.prompt ?? args.join(' '), { by: 'claude', spend: num(opt.spend), estimate: opt.estimate })
    if (r.shown) return console.log(JSON.stringify(r))
    for (const [i, x] of r.texts.entries()) console.log(`${r.texts.length > 1 ? `--- version ${i + 1}${x.title ? `: ${x.title}` : ''}\n` : ''}${x.text}`)
  } catch (e) { die(e.message, e.code === 2 ? 2 : 1) }
}
if (!commands[cmd]) die(`usage: media.mjs <${Object.keys(commands).join(' | ')}>`)
await commands[cmd]()
