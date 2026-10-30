#!/usr/bin/env node
// media-generator CLI and the dashboard's server. Images, videos and speech through the model routers of providers/,
// voice changes and dubbing through ElevenLabs by video-editor's engine. Everything lives in the folder Claude Code
// runs in ($MEDIA_GENERATOR_DIR overrides it): media/ (one folder per generation), elements/ (the @ references),
// styles/ (the Library's styles), ledger.jsonl (what was spent), settings.json (thresholds, caps, defaults), .cache/
// (catalogs, uploads, drafts)
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import zlib from 'node:zlib'
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
    n: { type: 'string' }, batch: { type: 'string' }, duration: { type: 'string' }, ratio: { type: 'string' }, resolution: { type: 'string' },
    quality: { type: 'string' }, sound: { type: 'string' }, seed: { type: 'string' }, voice: { type: 'string' },
    spend: { type: 'string' }, 'accept-unknown': { type: 'boolean' }, force: { type: 'boolean' }, estimate: { type: 'boolean' },
    search: { type: 'string' }, json: { type: 'boolean' }, open: { type: 'boolean' }, space: { type: 'string' }, words: { type: 'string' },
    type: { type: 'string' }, colors: { type: 'string' }, font: { type: 'string' }, workspace: { type: 'string' }, from: { type: 'string', multiple: true }, drop: { type: 'string', multiple: true },
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
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,avg_frame_rate', '-of', 'json', file], { encoding: 'utf8' }))
  const v = j.streams.find(s => s.codec_type === 'video'), [a, b] = String(v?.avg_frame_rate ?? '0/1').split('/').map(Number)
  return { duration: +(+j.format.duration || 0).toFixed(2), width: v?.width ?? null, height: v?.height ?? null, fps: b ? +(a / b).toFixed(3) : null, audio: j.streams.some(s => s.codec_type === 'audio') }
}
const ffmpeg = argv => execFileSync('ffmpeg', ['-y', '-v', 'error', ...argv], { stdio: ['ignore', 'ignore', 'pipe'] })

// ---------- the folder: settings, .gitignore, tools, catalogs ----------

// thresholds and caps in each provider's unit, all unset until the user sets them (Settings, or setup set)
const SETTINGS = {
  openrouter: { threshold: null, cap: null },
  elevenlabs: { threshold: null, cap: null, plan: null },
  defaults: { image: null, video: null, audio: null },
  // the workspace new generations join (workspaces use, the dashboard's header)
  workspace: { current: 'default' },
}
const settings = () => {
  const s = fs.existsSync(at('settings.json')) ? readJson(at('settings.json')) : {}
  return Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, { ...v, ...s[k] }]))
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
// a field's options may name a list of tools/ shared by several tools (the styles), and its default one of its labels
for (const f of Object.values(TOOLS).flat().flatMap(t => t.fields)) if (typeof f.options === 'string') {
  f.options = JSON.parse(fs.readFileSync(path.join(ENGINE, `tools/${f.options}.json`), 'utf8'))
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
const hasBin = bin => !spawnSync(bin, [bin === 'uv' ? '--version' : '-version'], { stdio: 'ignore' }).error
// the tools whose prompt is the user's words (a style at most after them): never sent without them
const CUSTOM = ['free', 'free-edit']
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

// ---------- the Library: Elements and styles, cited with @name ----------

// an Element's type says what its images are to the model; a voice holds clips, picked as Audio's voice, never in words.
// One made before the types is « other »
const TYPES = ['character', 'outfit', 'object', 'location', 'pose', 'brand', 'voice', 'other']
const NAME = /^[\w-]+$/
// an Element (elements/<name>/): its images (a voice's clips) and element.json: its type, its words, a brand's colors and
// typeface, a voice's ElevenLabs id once it is on the account
function element(name) {
  const d = at('elements', String(name ?? ''))
  if (!NAME.test(name ?? '') || !fs.existsSync(d) || !fs.statSync(d).isDirectory()) return null
  const meta = fs.existsSync(path.join(d, 'element.json')) ? readJson(path.join(d, 'element.json')) : {}
  const type = TYPES.includes(meta.type) ? meta.type : 'other'
  const files = fs.readdirSync(d).filter(f => kindOfFile(f) === (type === 'voice' ? 'audio' : 'image')).sort().map(f => path.join(d, f))
  return { name, type, words: meta.words ?? '', colors: meta.colors ?? [], font: meta.font ?? '', voice_id: meta.voice_id ?? null, files }
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
function saveElement(name, { type, words, colors, font, files = [], from = [], drop = [], workspace: ws }) {
  if (!NAME.test(name ?? '')) throw userError('an Element\'s name is letters, digits, - and _')
  const now = element(name), t = type ?? now?.type ?? 'other'
  if (!TYPES.includes(t)) throw userError(`the types are ${TYPES.join(', ')}`)
  const want = t === 'voice' ? 'audio' : 'image', all = [...files, ...outputsOf(from, want)]
  const odd = all.find(f => kindOfFile(f) !== want)
  if (odd) throw userError(`${path.basename(odd)} is not ${want === 'audio' ? 'a sound: a voice takes clips' : 'an image'}`)
  if (!now && !all.length) throw userError(`a new Element takes ${want === 'audio' ? 'a voice clip' : 'an image'} or more`)
  ensureHome()
  const d = at('elements', name)
  fs.mkdirSync(d, { recursive: true })
  for (const f of all) copyIn(d, f)
  for (const f of drop) fs.rmSync(path.join(d, path.basename(f)), { force: true })
  writeJson(path.join(d, 'element.json'), clean({ type: t, words: (words ?? now?.words ?? '').trim(),
    ...(t === 'brand' ? { colors: colors ?? now?.colors ?? [], font: (font ?? now?.font ?? '').trim() } : {}), voice_id: t === 'voice' ? now?.voice_id : undefined }))
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
// (picked in a Style field) or an unknown name stays as written
function mentions(text, kind, from) {
  const refs = [], done = new Set()
  const out = text.replace(/@([\w-]+)/g, (all, name) => {
    if (done.has(name)) return name
    const el = element(name)
    if (!el || el.type === 'voice' || !el.files.length) return all
    const where = placeOf(kind, from + refs.length, el.files.length)
    refs.push(...el.files)
    done.add(name)
    return `${name} (${cite(el, where)})`
  })
  return { text: out, refs }
}

// an element field's value: a name of the Library (with or without its @), of a type the field takes, written @name so
// the prompt cites it like the user's own words
function elementField(f, v) {
  const name = String(v).trim().replace(/^@/, ''), el = element(name)
  if (!el || el.type === 'voice' || !el.files.length) throw userError(`${f.label}: no element @${name} in the Library (media.mjs elements)`)
  if (f.types && !f.types.includes(el.type)) throw userError(`${f.label}: @${name} is ${el.type === 'other' ? 'untyped' : `${/^[aeiou]/.test(el.type) ? 'an' : 'a'} ${el.type}`}, this takes ${f.types.join(' or ')}`)
  return `@${name}`
}

// a style of the Library (styles/<name>/): its images go last among the references, and the prompt cites them by
// their place with the words on its look. A name, never a preset's value (those are sentences)
function savedStyle(name) {
  const d = at('styles', String(name ?? ''))
  if (!NAME.test(name ?? '') || !fs.existsSync(d)) return null
  const files = fs.readdirSync(d).filter(f => kindOfFile(f) === 'image').sort().map(f => path.join(d, f))
  const words = fs.existsSync(path.join(d, 'style.json')) ? readJson(path.join(d, 'style.json')).words ?? '' : ''
  const [its, img] = files.length === 1 ? ['its', 'reference image'] : ['their', `${files.length} reference images`]
  return { name, files, words, text: `the last ${img}: ${its} medium, palette, line work, texture and light, never ${its} subject or content${words ? ` (${words})` : ''}` }
}
const savedStyles = () => (fs.existsSync(at('styles')) ? fs.readdirSync(at('styles')).sort().map(savedStyle).filter(s => s?.files.length) : [])

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
const slugOf = name => String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'workspace'
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
    const t = w.timeline, rel = c => `../${named.get(c.path) ?? path.relative(HOME, c.path)}`
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
    return { send: { model: m.model, prompt, refs: refs.map(dataUrl), ...params }, estimate: { n: params.n, resolution: params.resolution, quality: params.quality, refs: refs.length, sizes: refs.map(size) } }
  }
  if (kind === 'video') {
    const video = files('video')[0], source = video ? probe(video) : null, avatar = m.role === 'avatar'
    // an avatar takes its photo as a reference, not as a frame
    const frames = clean({ first_frame: avatar ? undefined : files('first_frame')[0], last_frame: files('last_frame')[0] })
    for (const f of Object.keys(frames)) if (!m.params.frames.includes(f)) throw userError(`${m.name} takes no ${f.replace('_', ' ')}: pick another model`)
    const images = [...(avatar ? files('first_frame') : []), ...files('references'), ...files('sketch'), ...refsFromMentions]
    if (m.params.references != null && images.length > m.params.references) throw userError(`${m.name} takes ${m.params.references} reference images, this asks for ${images.length}`)
    // with a frame, OpenRouter keeps the frames and drops the reference images: never sent for nothing
    if (!avatar && images.length && Object.keys(frames).length) throw userError('a first or last frame and reference images do not go together (OpenRouter keeps the frames, drops the references): remove one or the other; a Library style\'s images are references too')
    const refs = [...images.map(f => ({ kind: 'image', file: f })), ...(video ? [{ kind: 'video', file: atLeast(video, m.params.min_pixels) }] : []), ...files('audio').map(f => ({ kind: 'audio', file: f }))]
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
  // a voice of the Library (--voice @name): its clips are cloned, its words say how it sounds
  if (spec.kind === 'audio' && spec.tool === 'voice' && String(spec.params?.voice ?? '').startsWith('@')) {
    const v = element(spec.params.voice.slice(1)), { voice, ...params } = spec.params
    if (v?.type !== 'voice' || !v.files.length) throw userError(`no voice ${voice} in the Library (media.mjs elements)`)
    spec = { ...spec, params, inputs: { ...spec.inputs, voice_clips: v.files.slice(0, 3) }, fields: { ...spec.fields, instructions: spec.fields?.instructions || v.words || undefined } }
  }
  // a References tool makes anyone without words or photos
  if (!probing && tool.one_of && !tool.one_of.some(k => spec.inputs?.[k]?.length || String(spec.fields?.[k] ?? '').trim())) {
    const [f, i] = [tool.fields.find(x => tool.one_of.includes(x.key)), tool.inputs.find(x => tool.one_of.includes(x.key))]
    throw userError(`${tool.label}: describe it (--field ${f.key}="…") or add ${i.label.toLowerCase()} (--in ${i.key}=<file>)`)
  }
  // a field the tool cannot go without (Object swap's element)
  for (const f of tool.fields) if (f.required && !probing && !String(spec.fields?.[f.key] ?? f.default ?? '').trim())
    throw userError(`${tool.label} needs ${f.label.toLowerCase()} (${f.type === 'element' ? `--field ${f.key}=@<element>, media.mjs elements` : `--field ${f.key}=…`})`)
  // the fields left out take their defaults (upscale's creativity, extend's direction…)
  const fields = { ...Object.fromEntries(tool.fields.filter(f => f.default !== undefined).map(f => [f.key, String(f.default)])), ...spec.fields }
  // a style of the Library: its words in the prompt, its images after the other references
  const looks = []
  for (const f of tool.fields) {
    const s = f.type === 'style' && savedStyle(fields[f.key])
    if (s) { looks.push(...s.files); fields[f.key] = s.text } else if (f.type === 'element' && String(fields[f.key] ?? '').trim()) fields[f.key] = elementField(f, fields[f.key])
    else if (fields[f.key] != null) fields[f.key] = optionValue(f, fields[f.key])
  }
  spec = { ...spec, fields }
  if (!probing) for (const i of tool.inputs) if (!i.optional && !spec.inputs?.[i.key]?.length) throw userError(`${tool.label} needs ${i.label.toLowerCase()} (--in ${i.key}=<file>)`)
  for (const f of Object.values(spec.inputs ?? {}).flat()) if (!fs.existsSync(f)) throw userError(`no such file: ${f}`)
  // the @names of an image or a video prompt (a voice's text is read as written): their images after the tool's
  const filled = fill(tool, spec)
  const { text: prompt, refs } = spec.kind === 'audio' ? { text: filled, refs: [] }
    : mentions(filled, spec.kind, 1 + counted(spec.kind, tool).reduce((n, i) => n + (spec.inputs?.[i.key]?.length ?? 0), 0))
  // a probe prices the tool before its files: a style's images would only trip the model's count
  if (!probing) refs.push(...looks)
  if (LOCAL[tool.local]) {
    if (['depth', 'matte'].includes(tool.local) && !probing && !hasBin('uv')) throw userError(`${tool.label} runs a model on this machine with uv: brew install uv, then media.mjs setup vision`)
    return { tool, prompt: '', provider: 'local', model: LOCAL[tool.local], estimate: { amount: 0, unit: 'usd', known: true, detail: 'local, free' } }
  }
  if (tool.provider === 'elevenlabs') {
    if (probing && !spec.inputs?.clip?.length) return { tool, prompt: '', provider: 'elevenlabs', model: tool.id, estimate: { amount: null, unit: 'credits', known: false, detail: 'per minute of the clip' } }
    const argv = elevenArgs(tool, spec)
    return { tool, prompt: '', provider: 'elevenlabs', model: argv[0] === 'dub' ? argv[argv.indexOf('--model') + 1] : 'eleven_multilingual_sts_v2', argv, estimate: elevenEstimate(argv) }
  }
  if (!prompt && !probing && !['upscale'].includes(tool.id)) throw userError('write a prompt (--prompt "…"), or fill the tool\'s fields (--field key=value)')
  // the user's words are optional beside a tool's own prompt, the whole prompt of Custom and Custom edit
  if (CUSTOM.includes(tool.id) && !spec.raw && !String(spec.prompt ?? '').trim() && !probing) throw userError('write a prompt (--prompt "…"): Custom has no prompt of its own')
  const id = spec.model ?? tool.models?.find(Boolean) ?? settings().defaults[spec.kind]
  const m = id ? await modelOf(spec.kind, id.includes(':') ? id : `openrouter:${id}`) : (await models(spec.kind)).find(x => x.role !== 'edit' && x.role !== 'upscale' && x.role !== 'avatar')
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
    const fit = want && (await models(spec.kind)).find(x => tool.models?.includes(x.model) && x.model !== m.model && (x.params.references ?? Infinity) >= want)
    if (fit) e.message += `: ${fit.name} takes them (--model ${fit.model})`
    throw e
  }
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
async function plans(spec) {
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
const VISION_DIR = process.env.MEDIA_GENERATOR_VISION_DIR ?? path.join(process.env.HOME ?? '', '.cache/media-generator/models')
function vision(job, argv) {
  return new Promise((ok, ko) => {
    const p = spawn('uv', ['run', '--quiet', VISION, ...argv], { stdio: ['ignore', 'pipe', 'pipe'] })
    let err = '', last = 0
    p.stdout.on('data', d => {
      const line = String(d).trim().split('\n').pop()
      if (Date.now() - last > 1000 || /^(fetch|load)/.test(line)) { last = Date.now(); progress(job, line) }
    })
    p.stderr.on('data', d => { err += d })
    p.on('error', e => ko(e.code === 'ENOENT' ? new Error('uv is missing: brew install uv') : e))
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
  const list = (await models(kind)).filter(m => !opt.search || `${m.id} ${m.name}`.toLowerCase().includes(opt.search.toLowerCase()))
  if (opt.json) return console.log(JSON.stringify(list.map(({ pricing, ...m }) => m)))
  for (const m of list) {
    const p = m.params, caps = [m.role !== 'create' && m.role !== 'generate' && m.role, p.duration && `${p.duration[0]}–${p.duration.at(-1)} s`, p.resolution?.join('/'),
      p.frames?.length && p.frames.join('+'), p.audio && 'audio', p.n && p.n.max > 1 && `up to ${p.n.max}`, p.references && `${p.references} refs`, p.voices && `${p.voices.length} voices`].filter(Boolean)
    console.log(`${m.id}  ${m.name}${caps.length ? `  [${caps.join(', ')}]` : ''}`)
  }
  console.log(`${list.length} ${kind} models (the engine's list, providers/openrouter-models.json)`)
}

// how a field is given on the command line: an option's label (Auto for an empty one), several in order, words
function fieldHelp(f) {
  const list = f.options?.map(o => (typeof o === 'object' ? o.label ?? o.value : o) || 'Auto').join('|')
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
  for (const k of kind ? [kind] : KINDS) {
    const list = TOOLS[k].filter(t => !opt.search || `${t.id} ${t.label} ${t.group} ${t.description}`.toLowerCase().includes(opt.search.toLowerCase()))
    if (opt.json) { console.log(JSON.stringify(list)); continue }
    for (const t of list) {
      const ins = t.inputs.map(i => `--in ${i.key}=<${i.kind}>${i.optional ? '?' : ''}`).join(' '), fields = t.fields.map(fieldHelp).join(' ')
      console.log(`${k} ${t.id} (${t.mode}, ${t.group}): ${t.description}${ins ? `\n    ${ins}` : ''}${fields ? `\n    ${fields}` : ''}${t.models ? `\n    models: ${t.models.join(', ')}` : ''}${t.also ? `\n    also: ${t.also.join(', ')}` : ''}`)
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
  if (sub === 'vision') {
    if (!hasBin('uv')) die('uv is missing: brew install uv')
    const r = spawnSync('uv', ['run', '--quiet', VISION, 'fetch'], { stdio: 'inherit' })
    if (r.status !== 0) die('the vision models could not be fetched')
    return
  }
  if (sub === 'set') {
    for (const kv of rest) {
      const [k, v] = [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)], [sec, key] = k.split('.')
      if (sec === 'workspace') die('setup set: the workspace changes with media.mjs workspaces use <slug>')
      if (!SETTINGS[sec] || !(key in SETTINGS[sec])) die(`setup set: ${k} is not one of ${Object.entries(SETTINGS).flatMap(([a, o]) => Object.keys(o).map(b => `${a}.${b}`)).join(', ')}`)
      s[sec][key] = v === 'none' || v === '' ? null : sec === 'defaults' ? v
        : key === 'plan' ? (v in PLANS ? v : die(`setup set: elevenlabs.plan is one of ${Object.keys(PLANS).join(', ')}, or none`))
        : Number.isFinite(+v) && +v >= 0 ? +v : die(`setup set: ${k} is a number, or none`)
    }
    ensureHome()
    writeJson(at('settings.json'), s)
  } else if (sub) die('usage: setup [vision | set openrouter.threshold=<usd> openrouter.cap=<usd> elevenlabs.threshold=<credits> elevenlabs.cap=<credits> elevenlabs.plan=<${Object.keys(PLANS).join('|')}> defaults.video=<model>…]')
  for (const [sec, o] of Object.entries(s)) console.log(`${sec}: ${Object.entries(o).map(([k, v]) => `${k} ${v ?? 'not set'}`).join(' · ')}`)
}

// elements [add|set <name> [<files…>] | show <name> | remove <name> | elevenlabs <name>]: the characters, outfits,
// objects, places, poses, brands and voices of the Library. add makes one or adds to it, set changes one; both take
// --type, --words, --colors "#hex,#hex" and --font (a brand), --from <generation> (its results) and --drop <file>
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`
function elements(sub, name, ...files) {
  const usage = `usage: elements [add|set <name> [<files…>] [--type ${TYPES.join('|')}] [--words "…"] [--colors "#hex,#hex"] [--font "…"] [--from <generation>] [--drop <file>] [--workspace <slug>|none] | show <name> | remove <name> | elevenlabs <name>]`
  try {
    if (sub === 'add' || sub === 'set') {
      if (sub === 'set' && !element(name)) throw userError(`no Element @${name}: elements add ${name} <files…>`)
      saveElement(name, { type: opt.type, words: opt.words, colors: opt.colors?.split(/[,\s]+/).filter(Boolean), font: opt.font, files: files.map(f => path.resolve(f)), from: opt.from, drop: opt.drop,
        workspace: opt.workspace === 'none' ? null : opt.workspace })
    } else if (sub === 'show') {
      const el = element(name)
      if (!el) throw userError(`no Element @${name}`)
      return console.log(JSON.stringify(el, null, 2))
    } else if (sub === 'remove') fs.rmSync(at('elements', name ?? '-'), { recursive: true, force: true })
    else if (sub === 'elevenlabs') voiceToEleven(name)
    else if (sub) die(usage)
  } catch (e) { die(e.message) }
  const list = elementList()
  for (const el of list) console.log(`@${el.name}: ${el.type}, ${plural(el.files.length, el.type === 'voice' ? 'clip' : 'image')}${el.colors.length ? ` · ${el.colors.join(' ')}` : ''}${el.words ? ` · ${el.words}` : ''}${el.voice_id ? ` · ElevenLabs ${el.voice_id}` : ''}`)
  if (!list.length) console.log('no element yet: elements add <name> <images…> --type character')
}

// styles [add|set <name> [<images…>] [--words "…"] [--from <generation>] [--drop <file>] | show <name> | remove <name>]:
// the Library's styles, their look taken from images
function styles(sub, name, ...files) {
  try {
    const all = [...files.map(f => path.resolve(f)), ...outputsOf(opt.from, 'image')]
    if (sub === 'add') {
      if (!NAME.test(name ?? '') || !all.length) die('usage: styles add <name> <images…> [--words "the look in words"] [--from <generation>] (letters, digits, - and _)')
      addStyle(name, all, opt.words)
    } else if (sub === 'set') {
      if (!savedStyle(name)) throw userError(`no style ${name}: styles add ${name} <images…>`)
      addStyle(name, all, opt.words, opt.drop)
    } else if (sub === 'show') {
      const s = savedStyle(name)
      if (!s) throw userError(`no style ${name}`)
      return console.log(JSON.stringify(s, null, 2))
    } else if (sub === 'remove') fs.rmSync(at('styles', name ?? '-'), { recursive: true, force: true })
    else if (sub) die('usage: styles [add|set <name> [<images…>] [--words "…"] [--from <generation>] [--drop <file>] | show <name> | remove <name>]')
  } catch (e) { die(e.message) }
  const list = savedStyles()
  for (const s of list) console.log(`${s.name}: ${plural(s.files.length, 'image')}${s.words ? ` · ${s.words}` : ''}`)
  if (!list.length) console.log('no style yet: styles add <name> <images…> [--words "…"]')
}
function addStyle(name, files, words, drop = []) {
  ensureHome()
  const d = at('styles', name)
  fs.mkdirSync(d, { recursive: true })
  for (const f of files) copyIn(d, f)
  for (const f of drop) fs.rmSync(path.join(d, path.basename(f)), { force: true })
  // more images keep the words already written, unless new ones come
  writeJson(path.join(d, 'style.json'), { words: (words ?? savedStyle(name)?.words ?? '').trim() })
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
  const has = bin => !spawnSync(bin, ['-version'], { stdio: 'ignore' }).error
  const checks = [['node 22 or later', +process.versions.node.split('.')[0] >= 22, 'brew install node'], ['ffmpeg and ffprobe', has('ffmpeg') && has('ffprobe'), 'brew install ffmpeg'],
    ['the dashboard is built', fs.existsSync(path.join(STUDIO, 'index.html')), 'npm run build in plugins-src/skill-video/media-studio']]
  for (const [name, ok, fix] of checks) console.log(`${ok ? 'ok     ' : 'MISSING'} ${name}${ok ? '' : `: ${fix}`}`)
  // optional: only a video or a voice sent to OpenRouter needs it, the rest works without
  console.log(has('cloudflared') ? 'ok      cloudflared (videos and voices sent to OpenRouter by a tunnel)'
    : 'missing cloudflared: brew install cloudflared (no account), for a video or a voice sent to OpenRouter (video edits, upscale, talking avatar); everything else works')
  // optional too: Depth map and Remove background run ONNX models here, fetched once (vision.py)
  const fetched = fs.existsSync(path.join(VISION_DIR, 'depth-anything-v2-small.onnx')) && fs.existsSync(path.join(VISION_DIR, 'birefnet-lite.onnx'))
  console.log(!has('uv') ? 'missing uv: brew install uv, for Depth map and Remove background (run here, free); everything else works'
    : fetched ? 'ok      uv and the vision models (Depth map, Remove background)'
      : 'ok      uv; the vision models are not fetched yet: media.mjs setup vision (330 MB, once), or at their first use')
  console.log(process.env.OPENROUTER_API_KEY ? 'openrouter: key set' : 'openrouter: no key, nothing can be generated; the plugin\'s secret: /plugin configure skill-video@pabrisson')
  console.log(process.env.OPENROUTER_MANAGEMENT_KEY ? 'openrouter management key: set (the account\'s balance)' : 'openrouter management key: not set (the key\'s own limit only)')
  console.log(process.env.ELEVENLABS_API_KEY ? 'elevenlabs: key set (change voice, translate)' : 'elevenlabs: no key, no voice change or translation')
  const s = settings()
  console.log(`limits: ${['openrouter', 'elevenlabs'].map(p => `${p} threshold ${s[p].threshold ?? 'none'}, cap ${s[p].cap ?? 'none'}`).join(' · ')}`)
  console.log(`folder: ${HOME}`)
  if (fs.existsSync(at('media'))) {
    const kept = spawnSync('git', ['-C', HOME, 'check-ignore', '--no-index', 'media/x', 'elements/x', 'styles/x', 'workspaces/x', 'ledger.jsonl', 'settings.json'], { encoding: 'utf8' })
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
      media: mediaList(), drafts, styles: savedStyles(), elements: elementList(), plans: PLANS,
      workspaces: (jobs => workspaceList().map(w => ({ ...w, linked: linkedElements(w.slug, jobs) })))(allJobs()), month: Object.fromEntries(['openrouter', 'elevenlabs'].map(x => [x, spentThisMonth(readLedger(HOME), x)])) })
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
    for (const sec of Object.keys(SETTINGS).filter(x => x !== 'workspace')) for (const k of Object.keys(SETTINGS[sec])) if (body[sec] && k in body[sec]) {
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
  // the Library's Elements: made or changed from the page (a path inside the folder: an upload, a result), removed, a
  // voice put on the ElevenLabs account
  if (p === '/api/elements') {
    if (post) {
      const { name, paths, remove, elevenlabs, type, words, colors, font, drop, workspace: ws } = await readBody(req)
      if (!NAME.test(name ?? '')) return reply(res, 400, { error: 'a name of letters, digits, - and _' })
      try {
        if (remove) fs.rmSync(at('elements', name), { recursive: true, force: true })
        else if (elevenlabs) voiceToEleven(name)
        else saveElement(name, { type, words, colors, font, drop, workspace: ws, files: (paths ?? []).map(f => inside(HOME, f)).filter(Boolean) })
      } catch (e) { return reply(res, 400, { error: e.message }) }
    }
    return reply(res, 200, elementList())
  }
  if (p === '/api/styles' && post) {
    const { name, paths, words, drop, remove } = await readBody(req)
    if (!NAME.test(name ?? '')) return reply(res, 400, { error: 'a name of letters, digits, - and _' })
    if (remove) fs.rmSync(at('styles', name), { recursive: true, force: true })
    else {
      const files = (paths ?? []).filter(f => inside(HOME, f) && kindOfFile(f) === 'image')
      if (!files.length && !savedStyle(name)) return reply(res, 400, { error: 'a style takes one image or more' })
      addStyle(name, files, words, drop)
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
  doctor, setup: () => setup(...args), studio, serve, draft, credits, jobs: () => jobs(args[0]), elements: () => elements(...args), styles: () => styles(...args), workspaces: () => workspaces(...args),
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
