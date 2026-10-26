#!/usr/bin/env node
// video-editor CLI. Every time read or written here is in SOURCE seconds (identical to video seconds without a source).
// Project commands work on the current directory, or on --project <slug|path>.
import { execFileSync, execSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { shownTexts } from './lib/actors.js'
import { description, speechCues, srt, vtt } from './lib/deliver.js'
import { joinChunks } from './lib/join.js'
import { PARAMS, checkEdit, checkLayout, effective, listPacks, mergeParams, paramErrors } from './lib/rules.js'
import { FORMATS, STYLE, logical, resolveActors, styleOf } from './lib/runtime.js'
import { alignedWords, audible, keepSegments, makeTimeline, rushGains, silences, stillStretches, windowDb } from './lib/timeline.js'

const SELF = fileURLToPath(import.meta.url)
// the code this process runs: a studio server started from an older video.mjs gets replaced
const LOADED = fs.statSync(SELF).mtimeMs
const ENGINE = path.dirname(SELF)
// the projects folder: $VIDEO_EDITOR_DIR, else the folder Claude Code runs in (the parent, when run inside a video)
const HOME = (() => {
  if (process.env.VIDEO_EDITOR_DIR) return path.resolve(process.env.VIDEO_EDITOR_DIR)
  for (let d = process.cwd(); d !== path.dirname(d); d = path.dirname(d)) if (fs.existsSync(path.join(d, 'source/project.json'))) return path.dirname(d)
  return process.cwd()
})()
const RATE = 48000
// the sound effects: the catalog's kinds (sfx.json) with the old names each stands for, and the projects folder's
// library, which every video plays (its own assets/sound/ overrides it)
const CATALOG = JSON.parse(fs.readFileSync(path.join(ENGINE, 'sfx.json'), 'utf8'))
const KIND = Object.fromEntries(Object.entries(CATALOG).flatMap(([k, e]) => [[k, k], ...e.aliases.map(a => [a, k])]))
const LIBRARY = path.join(HOME, '.sound')
// the projects folder's .gitignore, written by init when there is none: git keeps the style, the packs, the sound
// library and every video's source, rushes, clips, music and effects; only what the engine makes again is left out
const GITIGNORE = `# What the engine makes again. Everything else is kept: the style (.style/), the rule packs (.rules/), the sound
# library (.sound/) and each video's source/, rushes and clips, music and effects (assets/) and versions (files/).
.cache/
output/
stills/
__pycache__/
.studio.log
*.log
.DS_Store
`
// what git must keep, to check against the .gitignore: the rushes, the clips, the music and the effects
const KEPT = ['.sound/whoosh.wav', 'video/assets/source.mp4', 'video/assets/clips/clip.mp4', 'video/assets/sound/music.mp3', 'video/assets/sound/whoosh.mp3']
const PORT = +(process.env.VIDEO_EDITOR_PORT || 41187)
// the review studio, built from plugins-src/skill-video/studio and served as is
const STUDIO = path.join(ENGINE, 'studio/dist')
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
  '.wav': 'audio/wav', '.wasm': 'application/wasm',
}
const REVIEW_ABOUT = 'Review studio feedback on ONE version of the video (video field). type: comment or cut. t0/t1: VIDEO seconds of that version; s0/s1: SOURCE seconds (absent without a source). words: what is said, or shown, in the range; from: "transcript" when the comment was made on a selection of the transcript. fix: {from, to}, a line of what the video shows that the user corrected in the transcript. images: attached frames or pictures, with their size and ratio. visuals: what the comment is about in the picture, a part() of the scene ({kind, t0, t1, …data}, VIDEO seconds) or every part of a kind ({kind}). sounds: what the comment is about in the sound, a whole track (voice, music, fx, clips) or a cue of the scene ({kind, t, …data}, t in VIDEO seconds). format: the format it was made on. Claude answers each comment in reply and sets resolved: true.'

// codecs WebCodecs can put in an MP4. The resolutions' bitrates are H.264's: the others need less for the same look.
const CODECS = {
  h264: { label: 'H.264', factor: 1, ext: 'h264', input: ['-f', 'h264'], codec: l => `avc1.6400${l.avc}` },
  hevc: { label: 'HEVC (H.265)', factor: 0.7, ext: 'h265', input: ['-f', 'hevc'], tag: ['-tag:v', 'hvc1'], codec: l => `hvc1.1.6.L${l.hevc}.B0` },
  av1: { label: 'AV1', factor: 0.6, ext: 'ivf', codec: l => `av01.0.${l.av1}M.08` },
  vp9: { label: 'VP9', factor: 0.7, ext: 'ivf', codec: l => `vp09.00.${l.vp9}.08` },
}
// coding level by frame size and rate (16×16 macroblocks), from 720p30 up to 4K60
const LEVELS = [
  { mbs: 3600, rate: 108000, avc: '1f', hevc: 93, av1: '05', vp9: 31 },
  { mbs: 8192, rate: 245760, avc: '28', hevc: 120, av1: '08', vp9: 40 },
  { mbs: 8704, rate: 522240, avc: '2a', hevc: 123, av1: '09', vp9: 41 },
  { mbs: 36864, rate: 983040, avc: '33', hevc: 153, av1: '13', vp9: 51 },
  { mbs: 36864, rate: 2073600, avc: '34', hevc: 156, av1: '14', vp9: 52 },
]

const { values: opt, positionals: [cmd, ...args] } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: 'string', short: 'p' },
    formats: { type: 'string' },
    renders: { type: 'string' },
    source: { type: 'string', multiple: true },
    rules: { type: 'string' },
    fps: { type: 'string' },
    codec: { type: 'string' },
    format: { type: 'string' },
    type: { type: 'string' },
    workers: { type: 'string' },
    variants: { type: 'string' },
    at: { type: 'string' },
    blur: { type: 'string' },
    length: { type: 'string' },
    name: { type: 'string' },
    local: { type: 'boolean' },
    here: { type: 'boolean' },
    draft: { type: 'boolean' },
    force: { type: 'boolean' },
    open: { type: 'boolean' },
  },
})

const die = msg => { console.error(`error: ${msg}`); process.exit(1) }
// the value for this OS: macOS, Linux (and any other), Windows
const byOs = (mac, linux, win) => ({ darwin: mac, win32: win })[process.platform] ?? linux
const list = s => (s ?? '').split(',').map(x => x.trim()).filter(Boolean)
const even = x => Math.floor(x / 2) * 2
const ms = x => Math.round(x * 1000) / 1000
const clock = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(2).padStart(5, '0')}`
const secs = t => ((Date.now() - t) / 1000).toFixed(1)
const today = () => new Date().toISOString().slice(0, 10)
const ratio = f => f.replace(':', 'x')
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'))
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n')
const hash = s => createHash('sha1').update(s).digest('hex')
const run = (bin, argv, input) => execFileSync(bin, argv, { input, stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'], maxBuffer: Infinity })
const out = (bin, argv) => execFileSync(bin, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
// the log of an ffmpeg pass that only analyzes (its filters print to stderr)
const ffmpegLog = argv => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...argv], { encoding: 'utf8', maxBuffer: Infinity })
  if (r.status) die(`ffmpeg: ${r.stderr.trim().split('\n').at(-1)}`)
  return r.stderr
}

// .cache/progress.json: what is being done on the video, for the studio while there is nothing to review yet. The
// commands log their steps (with done/total when they count), Claude its own with `status`:
// { updated, steps: [{ id, label, by: engine|claude, state: running|done|failed, t0, t1, done, total }] }, the last 60.
// ponytail: read-modify-write without a lock, two commands writing at the same instant may lose a line
const now = () => new Date().toISOString()
function logSteps(dir, change) {
  const file = path.join(dir, '.cache/progress.json')
  let steps = []
  try { steps = readJson(file).steps } catch {}
  change(steps)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  writeJson(file, { updated: now(), steps: steps.slice(-60) })
}
// the steps this process started and has not ended: done when it exits well, failed when it dies
const open = new Map()
process.on('exit', code => {
  // (not in a folder gone meanwhile: a failed init removes its own)
  for (const [id, dir] of open) if (fs.existsSync(dir)) logSteps(dir, steps => Object.assign(steps.find(x => x.id === id) ?? {}, { state: code ? 'failed' : 'done', t1: now() }))
})
function step(dir, label) {
  const id = `${process.pid}-${Date.now()}-${open.size}`, set = o => logSteps(dir, steps => Object.assign(steps.find(x => x.id === id) ?? {}, o))
  logSteps(dir, steps => steps.push({ id, label, by: 'engine', state: 'running', t0: now() }))
  open.set(id, dir)
  return { tick: (done, total) => set({ done, total }), end: () => (open.delete(id), set({ state: 'done', t1: now() })) }
}

const packs = () => listPacks([['plugin', path.join(ENGINE, '../rules')], ['perso', path.join(HOME, '.rules')]])
// --rules and rules use: one pack per video, or none
const onePack = v => list(v).length > 1 ? die(`one pack per video, not ${v}`) : !v || v === 'none' ? [] : [v.trim()]

// the review draft (render --draft): the main format in 720p, H.264, sharp, never delivered
const DRAFT = { description: 'review draft', short: 720, video_kbps: [5000, 7500], audio_kbps: 160 }

// engine/renders.json, then the projects folder's .renders.json field by field, and the draft
function renders() {
  const base = readJson(path.join(ENGINE, 'renders.json')), own = path.join(HOME, '.renders.json')
  const mine = fs.existsSync(own) ? readJson(own) : {}
  return { ...Object.fromEntries(Object.keys({ ...base, ...mine }).map(k => [k, { ...base[k], ...mine[k] }])), draft: DRAFT }
}

// a render is a resolution (renders.json: 1080p…), named after its short side
function renderShort(type) {
  const t = renders()[type]
  if (!t) throw new Error(`unknown resolution ${type}`)
  return t.short
}

function encoderFor(p, type, [w, h]) {
  // video_kbps: YouTube's recommended upload bitrates, [≤ 30 fps, > 30 fps]
  const family = type === 'draft' ? 'h264' : p.codec ?? 'h264', c = CODECS[family], v = renders()[type].video_kbps, kbps = Array.isArray(v) ? v[p.fps > 30 ? 1 : 0] : v
  const mbs = Math.ceil(w / 16) * Math.ceil(h / 16), level = LEVELS.find(l => mbs <= l.mbs && mbs * p.fps <= l.rate) ?? LEVELS.at(-1)
  // closed GOP of half a second (YouTube's recommendation), every chunk starts on a keyframe
  return { family, codec: c.codec(level), bitrate: Math.round(kbps * 1000 * c.factor), gop: Math.max(1, Math.round(p.fps / 2)) }
}

function projectDir(required = true) {
  const dir = opt.project ? path.resolve(HOME, opt.project) : process.cwd()
  if (fs.existsSync(path.join(dir, 'source/project.json'))) return dir
  if (required) die(`not a video-editor project: ${dir} (cd into it or pass --project <slug>)`)
  return null
}

const pick = (value, all, what) => {
  const chosen = !value || value === 'all' ? all : list(value)
  const bad = chosen.filter(x => !all.includes(x))
  if (bad.length) die(`--${what}: ${bad.join(', ')} is not one of this project's (${all.join(', ')})`)
  return chosen
}

function probe(file) {
  const j = JSON.parse(out('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]))
  const v = j.streams.find(s => s.codec_type === 'video')
  if (!v) die(`no video stream in ${file}`)
  // phones store portrait as landscape + rotation; ffmpeg applies it when decoding
  const turned = Math.abs(v.side_data_list?.find(d => 'rotation' in d)?.rotation ?? 0) % 180 === 90
  const [n, d] = (v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : v.r_frame_rate).split('/')
  return {
    width: turned ? v.height : v.width,
    height: turned ? v.width : v.height,
    fps: n / d,
    duration: ms(+j.format.duration),
    audio: j.streams.some(s => s.codec_type === 'audio'),
  }
}

// A rush and the part of it the video keeps: `file.mp4#t=750,840` or `#t=12:30,14:10` (a W3C media fragment: from,
// to; `#t=750` runs to the end). Only that part is copied, framed and transcribed: an hour of podcast for one clip.
const secsOf = x => x.split(':').reduce((a, b) => a * 60 + +b, 0)
function rushOf(spec) {
  const m = spec.match(/^(.*)#t=([\d:.]*)(?:,([\d:.]+))?$/)
  const r = m ? { src: m[1], from: m[2] ? secsOf(m[2]) : 0, to: m[3] ? secsOf(m[3]) : null } : { src: spec, from: 0, to: null }
  if (!(r.from >= 0) || (r.to !== null && !(r.to > r.from))) die(`${spec}: the range is #t=<from>,<to> in seconds or mm:ss, <to> after <from>`)
  return r
}

function fetchSource(spec, dest) {
  const { src, from, to } = rushOf(spec), part = from > 0 || to !== null
  if (/^https?:\/\//.test(src)) {
    return run('uvx', ['yt-dlp', '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4',
      ...(part ? ['--download-sections', `*${from}-${to ?? 'inf'}`, '--force-keyframes-at-cuts'] : []), '-o', dest.replace(/\.mp4$/, '.%(ext)s'), src])
  }
  if (!part && /\.mp4$/i.test(src)) return fs.copyFileSync(src, dest, fs.constants.COPYFILE_FICLONE)
  const io = ['-y', '-v', 'error', ...(from ? ['-ss', `${from}`] : []), ...(to !== null ? ['-to', `${to}`] : []), '-i', src, '-map', '0:v:0', '-map', '0:a:0?']
  const encode = ['-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k', dest]
  // a stream copy cuts on keyframes: a part is encoded, so it starts on its very frame
  if (part) return run('ffmpeg', [...io, ...encode])
  try { run('ffmpeg', [...io, '-c', 'copy', dest]) }
  catch { run('ffmpeg', [...io, ...encode]) }
}

// Several rushes become one source, end to end in the given order: each one fitted (letterboxed) into the frame and
// rate of the first, cut to whole frames so the joins fall exactly, its sound at 48 kHz stereo (silence when it has
// none). Returns where each one starts in the joined source.
// ponytail: always re-encoded by the concat filter, a stream copy would do when every rush already matches the first
function joinSources(list, dest) {
  const rushes = list.map((src, i) => {
    const file = path.join(path.dirname(dest), `rush-${i + 1}.mp4`)
    fetchSource(src, file)
    return { from: src, file, ...probe(file) }
  })
  const { width: w, height: h, fps } = rushes[0], sound = rushes.some(r => r.audio)
  let at = 0
  const graph = rushes.map((r, i) => {
    Object.assign(r, { at, frames: Math.max(1, Math.round(r.duration * fps)) })
    at += r.frames / fps
    const samples = Math.round((r.frames / fps) * RATE)
    return `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p,tpad=stop_mode=clone:stop_duration=1,trim=end_frame=${r.frames}[v${i}];` +
      (!sound ? '' : r.audio ? `[${i}:a]aresample=${RATE},aformat=channel_layouts=stereo,apad,atrim=end_sample=${samples}[a${i}];` : `anullsrc=r=${RATE}:cl=stereo,atrim=end_sample=${samples}[a${i}];`)
  }).join('') + rushes.map((_, i) => `[v${i}]${sound ? `[a${i}]` : ''}`).join('') + `concat=n=${rushes.length}:v=1:a=${sound ? 1 : 0}[v]${sound ? '[a]' : ''}`
  run('ffmpeg', ['-y', '-v', 'error', ...rushes.flatMap(r => ['-i', r.file]), '-filter_complex', graph, '-map', '[v]', ...(sound ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '320k'] : []),
    '-c:v', 'libx264', '-crf', '16', '-preset', 'fast', '-pix_fmt', 'yuv420p', dest])
  for (const r of rushes) fs.rmSync(r.file)
  return rushes.map(r => ({ from: r.from, at: ms(r.at), duration: ms(r.frames / fps) }))
}

// the scale filter that brings a frame's short side down to `need` (never up)
const shrinkTo = ({ width: w, height: h }, need) => (Math.min(w, h) > need ? (w < h ? `,scale=${need}:-2` : `,scale=-2:${need}`) : '')

function centerCrop({ width: w, height: h }, r) {
  const cw = even(Math.min(w, h * r)), ch = even(Math.min(h, w / r))
  return [even((w - cw) / 2), even((h - ch) / 2), cw, ch]
}

// source/edit.json: the data the engine reads besides the scene (duration without a source, cut, poster, media, music)
const mediaFile = (dir, m) => path.resolve(dir, String(m.src).replace(/^~(?=\/)/, os.homedir()))
const loadEdit = dir => {
  const file = path.join(dir, 'source/edit.json')
  return fs.existsSync(file) ? readJson(file) : {}
}

// the optional actors: every actors/*.json (an array, or one actor) when the project has an actors/ folder
function loadActors(dir) {
  const root = path.join(dir, 'actors')
  if (!fs.existsSync(root)) return null
  return fs.readdirSync(root).filter(x => x.endsWith('.json')).sort().flatMap(x => [readJson(path.join(root, x))].flat())
}

// mono 16-bit PCM of a wav written by ffmpeg -bitexact (plain RIFF, fmt, data)
function readWav(file) {
  const buf = fs.readFileSync(file), i = buf.indexOf('data') + 8
  return new Int16Array(buf.buffer.slice(buf.byteOffset + i, buf.byteOffset + buf.length - ((buf.length - i) % 2)))
}

// the source's sound, mono 48 kHz: the transcript, the silences, the voice and sync read it
function sourceWav(dir) {
  const wav = path.join(dir, 'assets/source.wav')
  if (opt.force || !fs.existsSync(wav)) run('ffmpeg', ['-y', '-v', 'error', '-i', path.join(dir, 'assets/source.mp4'), '-vn', '-ac', '1', '-ar', `${RATE}`, '-c:a', 'pcm_s16le', '-bitexact', '-map_metadata', '-1', wav])
  return wav
}

// ElevenLabs' API, with the key of $ELEVENLABS_API_KEY (the plugin's secret, exported by its SessionStart hook), for
// what the user chose for the video (source/elevenlabs.json): the transcript by Scribe v2 (it sends the source's
// sound), the voice-over (the narration's text), the music and the sound effects. JSON, or the audio it made
async function eleven(route, init = {}) {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) die('no ElevenLabs key (the plugin\'s secret, /plugin configure skill-video@pabrisson, or ELEVENLABS_API_KEY): the transcript stays with Whisper, no voice-over, and the kit makes the sound')
  const r = await fetch(`https://api.elevenlabs.io${route}`, { ...init, headers: { 'xi-api-key': key, ...init.headers } })
  if (!r.ok) die(`ElevenLabs ${route.split('?')[0]}: ${r.status} ${await r.text()}`)
  return /json/.test(r.headers.get('content-type') ?? '') ? r.json() : Buffer.from(await r.arrayBuffer())
}

// Scribe v2 on the source's sound (16 kHz FLAC: a tenth of the WAV to upload), the vocabulary as its keyterms (under
// 50 characters and 5 words each), in whisper's shape
// ponytail: one synchronous request, its webhook when a long source outlasts fetch's 300 s wait for an answer
async function scribe(wav, lang, cache, vocabulary) {
  const flac = path.join(cache, 'scribe.flac'), form = new FormData()
  run('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-ar', '16000', '-c:a', 'flac', flac])
  for (const [k, v] of Object.entries({ model_id: 'scribe_v2', language_code: lang, timestamps_granularity: 'word', tag_audio_events: 'false' })) form.append(k, v)
  for (const k of vocabulary.filter(k => k.length < 50 && k.split(/\s+/).length <= 5)) form.append('keyterms', k)
  form.append('file', await fs.openAsBlob(flac), 'source.flac')
  const j = await eleven('/v1/speech-to-text', { method: 'POST', body: form })
  fs.rmSync(flac)
  return j.words.filter(w => w.type === 'word').map(w => ({ word: w.text, start: w.start, end: w.end }))
}

// source/elevenlabs.json, like the style but per video: what ElevenLabs makes for it, chosen with the user at its
// start (elevenlabs set). null until then
const ELEVEN = { transcript: false, voice: false, music: false, sfx: false }
const elevenOf = dir => {
  const file = path.join(dir, 'source/elevenlabs.json')
  return fs.existsSync(file) ? { ...ELEVEN, ...readJson(file) } : null
}
// what a command may ask ElevenLabs for: the user's choice for this video, else stop before spending a credit
const chosen = (dir, what) => {
  const e = elevenOf(dir)
  if (!e) die('ElevenLabs is not chosen for this video yet: ask the user (the ElevenLabs questions), then elevenlabs set')
  if (!e[what]) die(`${what} by ElevenLabs is off for this video (source/elevenlabs.json): ${what === 'voice' ? 'no voice-over' : 'the kit makes it'}`)
  return e[what]
}

// whisper.py: Whisper large-v3-turbo (mlx-whisper on Apple Silicon, faster-whisper elsewhere) with the style's
// vocabulary (names, brands) as the prompt of every window; or Scribe v2
async function transcribe(wav, lang, cache, vocabulary, withScribe) {
  fs.mkdirSync(cache, { recursive: true })
  let found
  if (withScribe) {
    console.log(`transcribing with ElevenLabs Scribe v2${vocabulary.length ? `, keyterms: ${vocabulary.join(', ')}` : ''}…`)
    found = await scribe(wav, lang, cache, vocabulary)
  } else {
    console.log(`transcribing with Whisper large-v3-turbo (the first run downloads the model, ~1.6 GB)${vocabulary.length ? `, vocabulary: ${vocabulary.join(', ')}` : ''}…`)
    run('uv', ['run', '--quiet', path.join(ENGINE, 'whisper.py'), wav, path.join(cache, 'whisper.json'), lang, vocabulary.join(', ')])
    found = readJson(path.join(cache, 'whisper.json')).segments.flatMap(s => s.words ?? [])
  }
  const words = []
  for (const w of found) {
    const text = w.word.trim(), prev = words.at(-1)
    // whisper splits elisions and compounds: d + 'autres, vingt + -trois
    if (prev && /^['’-]/.test(text)) Object.assign(prev, { w: prev.w + text, t1: ms(w.end) })
    else if (text) words.push({ w: text, t0: ms(w.start), t1: ms(w.end) })
  }
  return words
}

function wordsMd(words, slug) {
  if (!words.length) return `# Transcript: ${slug}\n\nNo speech found. The transcript will be the video's on-screen content, written by stills and render.\n`
  const lines = [[]]
  for (const w of words) {
    lines.at(-1).push(w)
    if (/[.!?…][»"”)]*$/.test(w.w)) lines.push([])
  }
  return `# Transcript: ${slug}\n\nTimes are SOURCE seconds.\n\n` +
    lines.filter(l => l.length).map(l => `- **${clock(l[0].t0)}** ${l.map(w => w.w).join(' ')}`).join('\n') + '\n'
}

// Without speech the transcript is what the video shows, one line per moment, in SOURCE seconds: the lines the scene
// declares with say(), else the readable texts sampled 4 times a second plus the actors' texts (their canvas is not
// sampled) as the main format shows them. Rewritten by stills and render, so the studio and the Copy prompt follow.
async function screenTranscript(dir, page, base, j) {
  const f = rel => path.join(dir, rel), p = readJson(f('source/project.json')), cur = fs.existsSync(f('assets/words.json')) ? readJson(f('assets/words.json')) : []
  if (!j.params.transcribe || cur.some(w => !w.screen)) return
  const tl = makeTimeline(j.timeline)
  await openPage(page, `${base}render?format=${encodeURIComponent(j.format)}&type=`, j)
  let lines = (await page.evaluate(() => window.says())).map(x => [x.v0, x.v1, x.w])
  const said = lines.length > 0
  if (!said) {
    // each sample's texts, in reading order, are the screen's line; texts coming in one by one, or leaving, keep it
    // one moment
    const step = 0.25, runs = []
    for (const [v, texts] of await page.evaluate(st => window.sampleTexts(st), step)) {
      const last = runs.at(-1)
      if (!texts.length) continue
      if (last && v - last[1] <= step * 1.5 && (texts.every(x => last[2].includes(x)) || last[2].every(x => texts.includes(x)))) {
        last[1] = v + step
        if (texts.length > last[2].length) last[2] = texts
      } else runs.push([v, v + step, texts])
    }
    // a moment up less than half a second is a passing state (a counter counting), not something to read
    lines = runs.filter(([a, b]) => b - a >= 0.5).map(([a, b, texts]) => [a, b, texts.join(' · ')])
  }
  const fmt = {}, num = (n, d) => (fmt[d] ??= new Intl.NumberFormat(j.style.creator.lang, { minimumFractionDigits: d, maximumFractionDigits: d })).format(n)
  // the actors' times are SOURCE seconds: without a source, the scene's own length (a cut does not shorten it)
  const end = p.source?.duration ?? j.scene.duration
  // the end of a line just before a cut is the cut's start, not its end (both are the same video instant)
  const words = lines.map(([a, b, w]) => ({ w, t0: ms(tl.toSource(a)), t1: ms(tl.toSource(Math.min(b, j.duration) - 0.001) + 0.001), screen: true }))
    .concat(said ? [] : resolveActors(j.actors ?? [], j.format).flatMap(a => shownTexts(a, j.style.creator, num, end)).map(x => ({ ...x, screen: true })))
    .sort((a, b) => a.t0 - b.t0)
  writeJson(f('assets/words.json'), words)
  fs.writeFileSync(f('files/words.md'), `# Transcript: ${p.slug}\n\nNo speech: what the video shows, moment by moment (SOURCE seconds).\n\n` +
    words.map(w => `- **${clock(w.t0)} → ${clock(w.t1)}** ${w.w}`).join('\n') + '\n')
}

// the voice's cleanup: no rumble under 80 Hz, a light denoise that follows the room's noise, a gentle compression
// that evens loud and soft words, its gain made up (the rough cut keeps the source's level; the mix sets its own)
const VOICE = ['highpass=f=80', 'afftdn=nr=10:nf=-50:tn=1', 'acompressor=threshold=-24dB:ratio=3:attack=5:release=120:makeup=2.5']

// voice.wav: the kept segments joined with 8 ms fades (no click at the joins), each rush brought to the level of the
// quietest one (several rushes), then cleaned and sped up by atempo. Each segment keeps its exact length, padded
// with silence where the audio track ends before the picture.
function buildVoice(dir, tl) {
  const pcm = readWav(path.join(dir, 'assets/source.wav')), fade = RATE * 0.008, files = readJson(path.join(dir, 'source/project.json')).source.files ?? []
  const gains = files.length > 1 ? rushGains(windowDb(pcm), files.map(x => [x.at, x.at + x.duration])) : [1], starts = files.map(x => Math.round(x.at * RATE))
  const parts = tl.segments.map(([a, b]) => {
    const [s0, s1] = [Math.round(a * RATE), Math.round(b * RATE)], seg = new Float32Array(s1 - s0)
    // the rush of each sample: a segment may run across a join
    for (let i = 0, r = Math.max(0, starts.findLastIndex(s => s <= s0)); i < seg.length; i++) {
      while (r + 1 < starts.length && s0 + i >= starts[r + 1]) r++
      seg[i] = ((pcm[s0 + i] ?? 0) / 32768) * gains[r]
    }
    for (let i = 0; i < Math.min(fade, seg.length / 2); i++) {
      seg[i] *= i / fade
      seg[seg.length - 1 - i] *= i / fade
    }
    return Buffer.from(seg.buffer)
  })
  const file = path.join(dir, 'assets/voice.wav')
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'f32le', '-ar', `${RATE}`, '-ac', '1', '-i', 'pipe:0',
    '-af', [...VOICE, ...(tl.speed !== 1 ? [`atempo=${tl.speed}`] : [])].join(','), '-c:a', 'pcm_s16le', file], Buffer.concat(parts))
  return file
}

// face_framing: MediaPipe's face detector in Chrome, 5 times a second, smoothed over about a second.
// assets/frames.json: { fps, faces: [[source s, x, y of the eyes, face height]] } in source pixels; [] when no face.
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
async function detectFaces(dir, p) {
  if (!fs.existsSync(path.join(ENGINE, 'node_modules/@mediapipe/tasks-vision'))) {
    console.log('face_framing: installing @mediapipe/tasks-vision in the engine…')
    // through the shell: npm is npm.cmd on Windows
    execSync('npm install --no-audit --no-fund', { cwd: ENGINE, stdio: 'inherit' })
  }
  const model = path.join(ENGINE, 'models/blaze_face_short_range.tflite')
  if (!fs.existsSync(model)) {
    console.log('face_framing: downloading the face model (230 KB)…')
    const r = await fetch(FACE_MODEL)
    if (!r.ok) die(`could not download ${FACE_MODEL}: ${r.status}`)
    fs.mkdirSync(path.dirname(model), { recursive: true })
    fs.writeFileSync(model, Buffer.from(await r.arrayBuffer()))
  }
  const started = Date.now(), src = p.source, step = Math.max(1, Math.round(src.fps / 5))
  const count = fs.readdirSync(path.join(dir, 'frames/cam')).length, frames = []
  for (let n = 1; n <= count; n += step) frames.push(n)
  const found = await withChrome(p.slug, 1, async ([page], base) => {
    await openPage(page, `${base}face`)
    return page.evaluate(([fr, w]) => window.detect(fr, w), [frames, src.width])
  })
  // a frame without a face keeps the last one seen; then a centered moving average
  let last = found.find(Boolean)
  const raw = last ? found.map(x => (last = x ?? last)) : []
  const faces = raw.map((x, i) => {
    const win = raw.slice(Math.max(0, i - 3), i + 4), avg = k => ms(win.reduce((a, w) => a + w[k], 0) / win.length)
    return [ms((frames[i] - 1) / src.fps), avg(1), avg(2), avg(3)]
  })
  writeJson(path.join(dir, 'assets/frames.json'), { fps: src.fps / step, faces })
  console.log(`face_framing: ${found.filter(Boolean).length}/${found.length} samples with a face in ${secs(started)} s${faces.length ? '' : ' (none: centered crop)'}`)
}

// the runtime never decodes video: camera frames are JPEGs at the source rate, as large as the largest render needs
function extractFrames(dir, p) {
  const dest = path.join(dir, 'frames/cam')
  if (!opt.force && fs.existsSync(dest) && fs.readdirSync(dest).length) return
  const started = Date.now(), need = Math.max(...p.renders.map(t => renderShort(t))), s = step(dir, 'Extracting the camera frames')
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  run('ffmpeg', ['-y', '-v', 'error', '-i', path.join(dir, 'assets/source.mp4'), '-vf', `fps=${p.source.fps}${shrinkTo(p.source, need)}`, '-q:v', '3', path.join(dest, '%05d.jpg')])
  s.end()
  console.log(`camera frames: ${fs.readdirSync(dest).length} in ${secs(started)} s`)
}

// clips of edit.json's media as JPEG frames at the project rate, as large as the largest render needs (or `width` px
// wide), with their sound (audio.wav) when they have one; kept while the clip and its cut stay the same
function extractMedia(dir, media, p) {
  const need = Math.max(...p.renders.map(t => renderShort(t)))
  for (const [id, m] of Object.entries(media ?? {})) {
    if (!/^[\w-]+$/.test(id)) die(`media id ${id}: letters, digits, - and _ only`)
    const src = mediaFile(dir, m)
    if (!fs.existsSync(src)) die(`media ${id}: ${src} not found`)
    const dest = path.join(dir, '.cache/media', id), metaFile = path.join(dest, 'meta.json'), synced = m.sync != null && p.source
    // a synced media (sync: the second of its file at the source's 0) covers the source, its sound is the source's
    const [from, dur] = synced ? [Math.max(0, m.sync), p.source.duration - Math.max(0, -m.sync)] : [m.from ?? 0, m.dur ?? null]
    const want = { src, mtime: fs.statSync(src).mtimeMs, from, dur, sync: synced ? m.sync : null, fps: p.fps, width: m.width ?? null, short: need }
    if (fs.existsSync(metaFile) && JSON.stringify(readJson(metaFile).want) === JSON.stringify(want)) continue
    fs.rmSync(dest, { recursive: true, force: true })
    fs.mkdirSync(dest, { recursive: true })
    const info = probe(src), cut = ['-ss', `${want.from}`, ...(want.dur ? ['-t', `${want.dur}`] : []), '-i', src]
    run('ffmpeg', ['-y', '-v', 'error', ...cut, '-vf', `fps=${p.fps}${m.width ? `,scale=${m.width}:-2` : shrinkTo(info, need)}`, '-q:v', '4', path.join(dest, '%05d.jpg')])
    if (info.audio && !synced) run('ffmpeg', ['-y', '-v', 'error', ...cut, '-vn', '-ac', '2', '-ar', `${RATE}`, '-c:a', 'pcm_s16le', '-bitexact', '-map_metadata', '-1', path.join(dest, 'audio.wav')])
    const v = probe(path.join(dest, '00001.jpg'))
    writeJson(metaFile, { want, count: fs.readdirSync(dest).filter(x => x.endsWith('.jpg')).length, fps: p.fps, ar: v.width / v.height })
  }
}

function readMedia(dir) {
  const root = path.join(dir, '.cache/media')
  if (!fs.existsSync(root)) return {}
  return Object.fromEntries(fs.readdirSync(root).filter(id => fs.existsSync(path.join(root, id, 'meta.json')))
    .map(id => { const m = readJson(path.join(root, id, 'meta.json')); return [id, { count: m.count, fps: m.fps, ar: m.ar, from: m.want.from, sync: m.want.sync ?? null }] }))
}

// everything a page needs to draw one format: sizes, timeline, transcript, faces, style, rules, actors, encoder (when
// rendering). The thumbnail is drawn in 16:9 whatever the project's formats
function buildJob(dir, format, type, thumbnail = false) {
  const f = rel => path.join(dir, rel), p = readJson(f('source/project.json')), edit = loadEdit(dir)
  if (!fs.existsSync(f('source/scene.js'))) throw new Error('no source/scene.js yet (see references/scene-format.md)')
  if (!p.formats.includes(format) && !(thumbnail && format === '16:9')) throw new Error(`format ${format} is not one of this project's (${p.formats.join(', ')})`)
  const params = effective(readJson(f('source/rules.json')), () => {}), style = styleOf(readJson(f('source/style.json')))
  const src = p.source, [lw, lh] = logical(format, src), short = type ? renderShort(type) : 720
  const size = [even((lw * short) / 1080), even((lh * short) / 1080)]
  let timeline = null, duration = edit.duration
  if (src) {
    if (!fs.existsSync(f('assets/timeline.json'))) throw new Error('run prepare first')
    const tl = makeTimeline(readJson(f('assets/timeline.json')), edit.cut)
    timeline = { speed: tl.speed, segments: tl.segments }
    duration = tl.duration
  } else if (duration > 0 && edit.cut?.length) {
    // no source: the scene's own time plays the source's part, and a cut removes a range of it
    const tl = makeTimeline({ fps: p.fps, speed: 1, segments: [[0, duration]] }, edit.cut)
    timeline = { speed: 1, segments: tl.segments }
    duration = tl.duration
  }
  if (!(duration > 0)) throw new Error('set "duration" (seconds) in source/edit.json: without a source video, it gives the length')
  const frames = src && fs.existsSync(f('frames/cam')) ? fs.readdirSync(f('frames/cam')).filter(x => x.endsWith('.jpg')).length : 0
  if (src && !frames) throw new Error('no camera frames: run prepare')
  const css = f('source/scene.css'), mtime = Math.max(...['source/scene.js', 'source/scene.css'].map(x => fs.statSync(f(x), { throwIfNoEntry: false })?.mtimeMs ?? 0))
  return {
    slug: p.slug, format, formats: p.formats, primary: p.formats[0], logical: [lw, lh], primaryLogical: logical(p.formats[0], src), resolution: type, size, fps: p.fps, duration,
    timeline, source: src && { width: src.width, height: src.height, fps: src.fps, frames },
    words: params.transcribe && fs.existsSync(f('assets/words.json')) ? readJson(f('assets/words.json')) : [],
    faces: params.face_framing && fs.existsSync(f('assets/frames.json')) ? readJson(f('assets/frames.json')).faces : null,
    style, params, media: readMedia(dir), actors: loadActors(dir), scene: { css: fs.existsSync(css), mtime: Math.round(mtime), duration: src ? null : edit.duration },
    encoder: type ? encoderFor(p, type, size) : null,
    thumbnail,
    // motion blur: sub-frames averaged per frame (render --blur N), 1 = sharp (stills, drafts)
    blur: type && type !== 'draft' ? Math.max(1, Math.min(16, Math.round(+opt.blur || 1))) : 1,
  }
}

// What a render depends on. A scene is code, so it covers all it can read: the engine, the job, every file of
// source/, actors/ and assets/ (names and dates). Not the sound (sound.py), nor what the scene sees through the job
// (edit.json, words.json), nor what never reaches the picture (the versions in project.json, the mix's levels, the
// review's drawings, Python's bytecode of sound.py, its effects in assets/sound/).
function sceneKey(dir, job) {
  // names with / on every OS (Windows lists them with \)
  const files = root => (fs.existsSync(root) ? fs.readdirSync(root, { recursive: true }).map(x => x.replaceAll(path.sep, '/')).filter(x => !/\.wav$|^(edit|words|project|mix)\.json$|^sound\.py$|^sound\/|^review\/|__pycache__/.test(x)).sort().map(x => [x, fs.statSync(path.join(root, x)).mtimeMs]) : [])
  const engine = ['lib/page.js', 'lib/kit.js', 'lib/runtime.js', 'lib/actors.js', 'lib/paper.js', 'lib/timeline.js', 'page/render.html'].map(x => fs.readFileSync(path.join(ENGINE, x), 'utf8')).join()
  // the motion blur is how it is rendered, not what: the chunks' keys add it
  return hash(engine + JSON.stringify([{ ...job, blur: null }, ...['source', 'actors', 'assets'].map(x => files(path.join(dir, x)))]))
}

// Chunks of ~2 s on keyframes, under the scene's key: nothing changed, the chunk is kept; anything changed, all
// render again
function chunkPlan(dir, job) {
  const key = sceneKey(dir, job), total = Math.round(job.duration * job.fps), size = job.encoder.gop * Math.max(1, Math.round((2 * job.fps) / job.encoder.gop)), plan = []
  for (let a = 0; a < total; a += size) plan.push({ a, b: Math.min(total, a + size), key: hash(`${key}${job.blur}${a}`) })
  return Object.assign(plan, { key })
}

// render --draft: the main format (or --format) in the draft resolution; otherwise --format and --type, all by default
const renderSet = p => opt.draft ? [pick(opt.format ?? p.formats[0], p.formats, 'format'), ['draft']] : [pick(opt.format, p.formats, 'format'), pick(opt.type, p.renders, 'type')]

async function playwright() {
  if (!fs.existsSync(path.join(ENGINE, 'node_modules/playwright-core'))) {
    console.log('first run: installing playwright-core in the engine…')
    execSync('npm install --omit=optional --no-audit --no-fund', { cwd: ENGINE, stdio: 'inherit' })
  }
  return import('playwright-core')
}

// Headless system Chrome (it has the H.264 encoder Chromium lacks) with the HTML-in-canvas API, no frame rate cap;
// one context per worker, pages served by a private server that also takes their output.
const CHROME_FIX = byOs('brew install --cask google-chrome', 'https://www.google.com/chrome/', 'winget install Google.Chrome')
// where Playwright's chrome channel finds it
const hasChrome = () => byOs(['/Applications/Google Chrome.app'], ['/opt/google/chrome/chrome'], [process.env.LOCALAPPDATA, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)']]
  .filter(Boolean).map(d => path.join(d, 'Google/Chrome/Application/chrome.exe'))).some(f => fs.existsSync(f))
const needChrome = () => !hasChrome() && die(`Google Chrome is needed: ${CHROME_FIX}`)
// a page's errors and warnings go to the terminal
const watch = page => {
  page.on('pageerror', e => console.error(`page: ${e.message}`))
  page.on('console', m => ['warning', 'error'].includes(m.type()) && !/Failed to load resource/.test(m.text()) && console.warn(`page: ${m.text()}`))
  return page
}

async function withChrome(slug, n, fn) {
  needChrome()
  const { chromium } = await playwright()
  const server = http.createServer((req, res) => handle(req, res, true).catch(e => reply(res, 500, { error: e.message })))
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--enable-blink-features=CanvasDrawElement', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--force-color-profile=srgb',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  })
  try {
    const pages = await Promise.all(Array.from({ length: n }, async () => watch(await (await browser.newContext()).newPage())))
    return await fn(pages, `http://127.0.0.1:${server.address().port}/${slug ?? '__blank'}/`)
  } finally {
    await browser.close()
    server.close()
  }
}

// the viewport covers the stage: Chrome does not paint what lies outside it
async function openPage(page, url, j) {
  if (j) await page.setViewportSize({ width: j.logical[0], height: j.logical[1] })
  await page.goto(url)
  await page.waitForFunction(() => window.ready || window.bootError, null, { timeout: 180000 })
  const err = await page.evaluate(() => window.bootError)
  if (err) throw new Error(err)
}

// the shared GPU process saturates around 3 pages (measured on an M2 Max: 185, 247, 277, 270 fps for 1 to 4)
const workers = () => +opt.workers || Math.min(3, Math.max(1, Math.floor(os.availableParallelism() / 2)))

function about(slug, p, active) {
  const src = p.source
  return `---
status: "init"
updated: "${today()}"
formats: ${JSON.stringify(p.formats)}
renders: ${JSON.stringify(p.renders)}
fps: ${ms(p.fps)}
codec: "${p.codec}"
rules: ${JSON.stringify(active)}
---
# ${slug}

## Hook

## Sources
${!src ? '- No source video: made from scratch in motion design'
    : src.files ? `${src.files.map((x, i) => `- Video ${i + 1}: ${x.from} (from ${x.at} s of the source, ${x.duration} s)`).join('\n')}\n- Joined end to end: ${src.width}×${src.height}, ${src.duration} s`
    : `- Video: ${src.from} (${src.width}×${src.height}, ${src.duration} s)`}

## Chiffres clés

## État
- ${today()}: project created.

## Beats
`
}

function init(slug) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug ?? '')) die('usage: init <slug> --formats 9:16,1:1 --renders 1080p,720p [--fps 30] [--codec h264] [--source <file|url>[#t=from,to] …] [--rules <pack>|none]')
  if (opt.fps && !(+opt.fps > 0 && +opt.fps <= 120)) die('--fps: frames per second, e.g. 24, 25, 30, 50 or 60')
  if (opt.codec && !CODECS[opt.codec]) die(`--codec: one of ${Object.keys(CODECS).join(', ')}`)
  const dir = path.join(HOME, slug)
  if (fs.existsSync(dir)) die(`${dir} already exists`)
  const formats = list(opt.formats), types = list(opt.renders), known = renders(), sources = opt.source ?? []
  if (!formats.length || formats.some(f => !FORMATS[f] && !(f === 'source' && sources.length))) die(`--formats: one or more of ${Object.keys(FORMATS).join(', ')}, source (with --source)`)
  if (!types.length || types.some(t => !known[t] || t === 'draft')) die(`--renders: one or more of ${Object.keys(known).filter(t => t !== 'draft').join(', ')}`)
  const active = onePack(opt.rules)
  let params
  try { params = mergeParams(packs(), active[0]) } catch (e) { die(e.message) }
  for (const s of sources) if (!/^https?:\/\//.test(s) && !fs.existsSync(rushOf(s).src)) die(`source not found: ${rushOf(s).src}`)

  for (const d of ['assets/images', 'assets/logos', 'assets/review', 'files/reviews', 'output', 'source', 'stills']) fs.mkdirSync(path.join(dir, d), { recursive: true })
  if (!fs.existsSync(path.join(HOME, '.gitignore'))) fs.writeFileSync(path.join(HOME, '.gitignore'), GITIGNORE)
  let source = null
  if (sources.length) {
    const file = path.join(dir, 'assets/source.mp4')
    let files
    const s = step(dir, sources.length > 1 ? `Joining ${sources.length} rushes` : 'Copying the source')
    try {
      if (sources.length === 1) fetchSource(sources[0], file)
      else files = joinSources(sources, file)
      s.end()
    } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); die(`could not get the source: ${e.message}`) }
    source = { from: sources.join(' + '), ...probe(file), ...(files && { files }) }
  }
  // output frame rate: asked at the start, else the source's, else 30
  const p = { slug, formats, renders: types, fps: opt.fps ? +opt.fps : source?.fps ?? 30, codec: opt.codec ?? 'h264', source, created: new Date().toISOString() }
  writeJson(path.join(dir, 'source/project.json'), p)
  // frozen copies: a later change of style or pack never touches this project
  // the whole style folder: style.json, fonts/, the avatar… (their paths in style.json are relative to it, then to source/)
  const style = path.join(HOME, '.style')
  // (not site/, the screenshots of the brand's site: they stay in .style/)
  if (fs.existsSync(path.join(style, 'style.json'))) fs.cpSync(style, path.join(dir, 'source'), { recursive: true, filter: f => f !== path.join(style, 'site') })
  else { writeJson(path.join(dir, 'source/style.json'), {}); console.warn(`warning: no style yet (${style}/style.json): run the setup interview; engine defaults used`) }
  fs.writeFileSync(path.join(dir, 'source/STYLE.md'), styleMd(readJson(path.join(dir, 'source/style.json'))))
  writeJson(path.join(dir, 'source/rules.json'), { active, params, overrides: {} })
  writeJson(path.join(dir, 'source/edit.json'), { cut: [] })
  fs.writeFileSync(path.join(dir, 'About.md'), about(slug, p, active))
  step(dir, 'Project created').end()

  console.log(`project: ${dir}`)
  console.log(`formats: ${formats.join(', ')} · renders: ${types.join(', ')} · ${ms(p.fps)} fps · ${CODECS[p.codec].label} · rules: ${active.join(', ') || 'none'}`)
  for (const [i, x] of (source?.files ?? []).entries()) console.log(`video ${i + 1}: ${x.from} from ${x.at} s of the source (${x.duration} s)`)
  console.log(source ? `source: ${source.width}×${source.height}, ${ms(source.fps)} fps, ${source.duration} s${source.audio ? '' : ', no audio'}. Next: prepare, then rough` : 'no source: set duration in source/edit.json, write source/scene.js, then stills and render')
}

async function prepare() {
  const dir = projectDir(), f = rel => path.join(dir, rel), p = readJson(f('source/project.json'))
  const params = effective(readJson(f('source/rules.json')))
  if (params.shots) scanShots(dir, p)
  else fs.rmSync(f('files/shots.md'), { force: true })
  if (!p.source) {
    if (!params.shots) die('this project has no source video and its pack scans no clips: nothing to prepare')
    return
  }
  const { creator } = styleOf(readJson(f('source/style.json')))

  // the levels decide the silences to cut; the transcript only needs something to hear (a voice under noise or
  // music has no clear pause, yet words)
  const db = p.source.audio ? windowDb(readWav(sourceWav(dir))) : null, quiet = db && silences(db)

  // a voice-over's words are the narration's (voice), never transcribed
  let words = []
  if (!params.transcribe && !p.source.voice) for (const x of ['assets/words.json', 'files/words.md']) fs.rmSync(f(x), { force: true })
  else if ((!opt.force || p.source.voice) && fs.existsSync(f('assets/words.json'))) words = readJson(f('assets/words.json')).filter(w => !w.screen)
  else {
    if (db && audible(db)) {
      const s = step(dir, 'Transcribing the speech')
      words = await transcribe(f('assets/source.wav'), creator.lang, f('.cache'), creator.vocabulary, !!elevenOf(dir)?.transcript)
      s.end()
    }
    writeJson(f('assets/words.json'), words)
    fs.writeFileSync(f('files/words.md'), wordsMd(words, p.slug))
  }

  const { duration, fps } = p.source
  if (params.breaths && words.length && !quiet) console.warn('warning: no clear pause between the words (noise or music under the voice): breaths not applied, cut by hand in source/edit.json')
  const segments = params.breaths && quiet && words.length ? keepSegments(quiet, words, params.breaths, duration) : [[0, duration]]
  writeJson(f('assets/timeline.json'), { fps, speed: params.speed, segments })
  const tl = makeTimeline(readJson(f('assets/timeline.json')), loadEdit(dir).cut)
  extractFrames(dir, p)

  if (params.face_framing && !p.source.voice) {
    if (opt.force || !fs.existsSync(f('assets/frames.json'))) {
      const s = step(dir, 'Framing the face')
      await detectFaces(dir, p)
      s.end()
    }
  } else fs.rmSync(f('assets/frames.json'), { force: true })

  // freezes: where the picture stays still (a screen recording waiting), as it plays once cut, with what is said
  if (params.freezes) {
    if (opt.force || !fs.existsSync(f('assets/freezes.json'))) {
      const log = ffmpegLog(['-i', f('assets/source.mp4'), '-vf', 'scale=320:-2,freezedetect=n=0.003:d=1', '-an', '-f', 'null', '-'])
      const ends = [...log.matchAll(/freeze_end: ([\d.]+)/g)].map(m => +m[1])
      writeJson(f('assets/freezes.json'), [...log.matchAll(/freeze_start: ([\d.]+)/g)].map((m, i) => [ms(+m[1]), ms(ends[i] ?? duration)]))
    }
    const still = stillStretches(readJson(f('assets/freezes.json')), tl, words, params.freezes)
    fs.writeFileSync(f('files/freezes.md'), `# Still screen: ${p.slug}\n\nWhere the picture stays still for ${params.freezes} s or more once cut (SOURCE seconds, as of the last prepare),\nwith what is said over it.\n\n` +
      (still.map(x => `- **${clock(x.a)} → ${clock(x.b)}** ${x.kept} s kept, ${x.said ? `said: "${x.said}"` : 'nothing said'}`).join('\n') || '- (none)') + '\n')
    console.log(`still screen: ${still.length} stretch(es) of ${params.freezes} s or more → files/freezes.md`)
  } else fs.rmSync(f('files/freezes.md'), { force: true })
  console.log(`transcript: ${!params.transcribe ? 'off (rules)' : words.length ? `${words.length} words → files/words.md` : 'no speech found'}`)
  console.log(`timeline: ${tl.segments.length} segment(s), ${duration} s → ${ms(tl.duration)} s (speed ×${tl.speed}). Next: rough`)
}

// voice: source/voice.txt read by the voice of source/elevenlabs.json (eleven_v4) becomes the source: its sound over a
// black picture of the main format, its words timed by the voice itself. Again after a change of the text: every time
// moves, files/words.md gives the new ones
async function voiceOver() {
  const dir = projectDir(), f = rel => path.join(dir, rel), p = readJson(f('source/project.json'))
  if (p.source && !p.source.voice) die('this video has a source with its own sound: a voice-over is for a video without one')
  const id = chosen(dir, 'voice'), text = fs.existsSync(f('source/voice.txt')) ? fs.readFileSync(f('source/voice.txt'), 'utf8').trim() : ''
  if (!text) die('write the narration in source/voice.txt first')
  const s = step(dir, 'Recording the voice-over'), { creator } = styleOf(readJson(f('source/style.json')))
  const j = await eleven(`/v1/text-to-speech/${encodeURIComponent(id)}/with-timestamps`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, model_id: 'eleven_v4', language_code: creator.lang }),
  })
  fs.writeFileSync(f('assets/voice.mp3'), Buffer.from(j.audio_base64, 'base64'))
  const [w, h] = logical(p.formats[0])
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=black:s=${w}x${h}:r=${p.fps}`, '-i', f('assets/voice.mp3'), '-shortest',
    '-c:v', 'libx264', '-tune', 'stillimage', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k', f('assets/source.mp4')])
  p.source = { from: `voice-over (ElevenLabs ${id})`, voice: true, ...probe(f('assets/source.mp4')) }
  writeJson(f('source/project.json'), p)
  // what was made from the previous voice
  for (const x of ['assets/source.wav', 'assets/timeline.json', 'frames/cam']) fs.rmSync(f(x), { recursive: true, force: true })
  const words = alignedWords(j.alignment ?? j.normalized_alignment)
  writeJson(f('assets/words.json'), words)
  fs.writeFileSync(f('files/words.md'), wordsMd(words, p.slug))
  s.end()
  console.log(`voice-over: ${words.length} words, ${p.source.duration} s → files/words.md. Next: prepare, then rough`)
}

// voices [<search>]: the voices of the ElevenLabs account, with their labels and languages, to pick the voice-over's
async function voices(search) {
  const j = await eleven(`/v2/voices?page_size=100${search ? `&search=${encodeURIComponent(search)}` : ''}`)
  for (const v of j.voices) {
    const langs = [...new Set((v.verified_languages ?? []).map(l => l.language))]
    console.log(`${v.voice_id}  ${v.name} [${v.category}] ${Object.values(v.labels ?? {}).join(', ')}${langs.length ? ` · ${langs.join('/')}` : ''}${v.description ? ` — ${v.description}` : ''}`)
  }
  console.log(j.voices.length ? (j.has_more ? 'more voices: narrow with voices <search>' : '') : 'no voice found')
}

// music "<prompt>" --length <s>: an instrumental track made by ElevenLabs, into assets/sound/music.mp3 (or --name)
// for sound.py's load(). An existing file is made again only with --force: each one costs credits
async function music(prompt) {
  const dir = projectDir(), name = opt.name ?? 'music', rel = `assets/sound/${name}.mp3`, file = path.join(dir, rel), length = +opt.length
  if (!prompt?.trim() || !/^[\w-]+$/.test(name) || !(length >= 3 && length <= 600)) die('usage: music "<prompt>" --length <3 to 600 s> [--name <name>] [--force] -p <slug>')
  chosen(dir, 'music')
  if (fs.existsSync(file) && !opt.force) die(`${rel} exists: --force makes it again (it costs credits), --name makes another`)
  const s = step(dir, 'Composing the music (ElevenLabs)')
  const audio = await eleven('/v1/music', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, music_length_ms: Math.round(length * 1000), force_instrumental: true, model_id: 'music_v2_5' }) })
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, audio)
  s.end()
  console.log(`music: ${rel} (${ms(+out('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]))} s). In sound.py: load('${rel}')`)
}

// the files of a sound in folder d, its takes in order (whoosh, whoosh-2…), as audio.py's takes() finds them
const takesIn = (d, name) => (fs.existsSync(d) ? fs.readdirSync(d) : []).filter(x => x.startsWith(name) && new RegExp(`^${name}(-\\d+)?\\.(wav|mp3|m4a|flac|ogg|aiff?)$`, 'i').test(x))
  .sort((a, b) => +(a.match(/-(\d+)\.\w+$/)?.[1] ?? 1) - +(b.match(/-(\d+)\.\w+$/)?.[1] ?? 1))
// where play() finds the sound of a cue kind, as audio.py does: the video's assets/sound/, then the library, each by
// the kind's own name, then by the catalog's kind it is an alias of. [label, takes], or null
function effectSource(dir, kind) {
  for (const [d, label] of [[path.join(dir, 'assets/sound'), 'assets/sound'], [LIBRARY, '.sound']])
    for (const n of new Set([kind, KIND[kind] ?? kind])) {
      const t = takesIn(d, n)
      if (t.length) return [`${label}/${t[0]}${t.length > 1 ? ` (${t.length} takes)` : ''}`, t]
    }
  return null
}

// the sounds a library folder has: their names, the takes of each counted once (whoosh, whoosh-2… is whoosh)
const soundsIn = d => [...new Set((fs.existsSync(d) ? fs.readdirSync(d) : []).map(x => x.match(/^(.+?)(-\d+)?\.(wav|mp3|m4a|flac|ogg|aiff?)$/i)?.[1]).filter(Boolean))]

// sfx <name>… --local | sfx <name> ["<prompt>"] [--length <s>]: sounds into the projects folder's library (.sound/),
// which every video of the folder plays; --here into this video's assets/sound/, which overrides it. A kind of the
// catalog (sfx.json) or a sound of the project's own, any name, as many as the videos need. --local synthesizes them
// (sfx.py: the folder's own designs in its sfx.py, else the kit's; three takes each, no credit); ElevenLabs makes one
// from the catalog's prompt, or the one given (a sound of the project's own needs it), at the catalog's length (1 s
// for the others). A sound already there is made again only with --force
async function sfx(...items) {
  const usage = 'usage: sfx <name>… --local [--here] [--force] [-p <slug>] | sfx <name> ["<prompt>"] [--length <0.5 to 30 s>] [--here] [--force] -p <slug>'
  const dir = opt.local && !opt.here ? projectDir(false) : projectDir(), target = opt.here ? path.join(dir, 'assets/sound') : LIBRARY
  const kinds = (opt.local ? items : items.slice(0, 1)).map(k => KIND[k] ?? (/^[a-z][\w-]*$/i.test(k) && !/-\d+$/.test(k) ? k : die(`sfx: ${k}: a name of letters, digits, _ and - (not ending in -<number>, the takes' mark)`)))
  if (!kinds.length) die(usage)
  if (!opt.local) chosen(dir, 'sfx')
  const rel = d => path.relative(HOME, d)
  for (const k of kinds) {
    const there = takesIn(target, k)
    if (there.length && !opt.force) die(`${rel(target)}/${there[0]} exists: --force makes ${k} again${opt.local ? '' : ' (it costs credits)'}${opt.here ? '' : ', --here makes one for this video only'}`)
  }
  const clear = k => takesIn(target, k).forEach(x => fs.rmSync(path.join(target, x)))
  fs.mkdirSync(target, { recursive: true })
  if (opt.local) {
    const s = dir && step(dir, `Sound effects ${kinds.join(', ')} (kit)`)
    kinds.forEach(clear)
    run('uv', ['run', '--quiet', path.join(ENGINE, 'sfx.py'), ...kinds, '--out', target])
    s?.end()
    return console.log(`sfx: ${kinds.map(k => `${rel(target)}/${takesIn(target, k).join(', ')}`).join(' · ')}${opt.here ? ', for this video only' : ', for every video of the folder'}`)
  }
  const [k] = kinds, prompt = items[1] ?? CATALOG[k]?.prompt, length = +(opt.length ?? CATALOG[k]?.dur ?? 1)
  if (!prompt?.trim()) die(`sfx: ${k} is a sound of the project's own: describe it, sfx ${k} "<the sound, not the picture>" [--length <s>] -p ${path.basename(dir)}`)
  if (!(length >= 0.5 && length <= 30)) die(usage)
  const s = step(dir, `Sound effect "${k}" (ElevenLabs)`)
  const audio = await eleven('/v1/sound-generation', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: prompt, duration_seconds: length }) })
  clear(k)
  const file = path.join(target, `${k}.mp3`)
  fs.writeFileSync(file, audio)
  s.end()
  console.log(`sfx: ${rel(file)} (${ms(+out('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]))} s)${opt.here ? ', for this video only' : ', for every video of the folder'}`)
}

// sounds [-p <slug>]: the catalog and the project's own sounds, what the library has; on a video, the kinds its cues
// use (stills saves them), each with where its sound comes from, and how to make the missing ones
function sounds() {
  const dir = projectDir(!!opt.project)
  if (!dir) {
    for (const [k, e] of Object.entries(CATALOG)) {
      const t = takesIn(LIBRARY, k)
      console.log(`${k}: ${e.about} (${e.dur} s${e.stretch ? ', fits its dur' : ''}). ${t.length ? `.sound/${t.join(', ')}` : 'not in the library'}. Also: ${e.aliases.join(', ')}`)
    }
    const own = soundsIn(LIBRARY).filter(k => !CATALOG[k])
    return console.log(`${own.length ? `the project's own sounds: ${own.join(', ')}\n` : ''}library: ${LIBRARY}`)
  }
  const file = path.join(dir, '.cache/cues.json'), code = fs.existsSync(path.join(dir, 'source/sound.py')) ? fs.readFileSync(path.join(dir, 'source/sound.py'), 'utf8') : ''
  if (!fs.existsSync(file)) die('run stills first: they save the cues of the scene')
  const uses = {}, missing = [], own = []
  for (const c of readJson(file)) {
    const k = KIND[c.kind] ?? c.kind
    uses[k] ??= {}
    uses[k][c.kind] = (uses[k][c.kind] ?? 0) + 1
  }
  for (const [k, names] of Object.entries(uses)) {
    const count = Object.values(names).reduce((a, b) => a + b), also = Object.entries(names).filter(([n]) => n !== k).map(([n, c]) => `${n} ×${c}`).join(', ')
    const from = [...new Set(Object.keys(names).map(n => effectSource(dir, n)?.[0] ?? (named(code, n) ? 'placed by sound.py' : 'missing')))]
    if (from.includes('missing')) (CATALOG[k] ? missing : own).push(k)
    console.log(`${k} ×${count}${also ? ` (${also})` : ''}${CATALOG[k] ? '' : ' (its own)'}: ${from.join(' · ')}`)
  }
  if (!missing.length && !own.length) return console.log('every cue has its sound')
  const slug = path.basename(dir)
  if (missing.length) console.log(`missing: ${missing.join(', ')}. ${elevenOf(dir)?.sfx
    ? `ElevenLabs (credits sfx=${missing.map(k => CATALOG[k].dur).join(',')}): ${missing.map(k => `video.mjs sfx ${k} -p ${slug}`).join(' ; ')}`
    : `The kit: video.mjs sfx ${missing.join(' ')} --local`}`)
  if (own.length) console.log(`to make, sounds of its own: ${own.join(', ')}. Design each in sound.py, or as \`def <name>(rng)\` in .sound/sfx.py then video.mjs sfx <name> --local (every video of the folder can play it)${elevenOf(dir)?.sfx ? `, or ElevenLabs: video.mjs sfx <name> "<the sound>" -p ${slug}` : ''}`)
}

// whether sound.py names a kind of cue in a string: it places that kind itself
const named = (code, k) => new RegExp(`['"]${k.replace(/\W/g, '\\$&')}['"]`).test(code)

// elevenlabs [set <key>=<value>…]: what ElevenLabs makes for this video (source/elevenlabs.json): transcript (Scribe
// v2), voice (the voice-over's voice id, or false), music, sfx. A key left out keeps its value, false at first
function elevenlabs(sub, ...rest) {
  const dir = projectDir(), file = path.join(dir, 'source/elevenlabs.json')
  if (sub === 'set' && rest.length && rest.every(x => /^\w+=/.test(x))) {
    const e = { ...ELEVEN, ...elevenOf(dir) }
    for (const x of rest) {
      const [k, ...v] = x.split('='), val = v.join('=')
      if (!(k in ELEVEN)) die(`elevenlabs set: ${k} is not one of ${Object.keys(ELEVEN).join(', ')}`)
      if (k === 'voice') e.voice = val === 'false' || !val ? false : val
      else if (val === 'true' || val === 'false') e[k] = val === 'true'
      else die(`elevenlabs set: ${k} is true or false`)
    }
    const { source } = readJson(path.join(dir, 'source/project.json'))
    if (e.voice && source && !source.voice) die('elevenlabs set: voice is for a video without speech, its voice-over becomes the source')
    writeJson(file, e)
  } else if (sub) die('usage: elevenlabs [set transcript=true|false voice=<voice_id>|false music=true|false sfx=true|false] -p <slug>')
  const e = elevenOf(dir)
  console.log(!e ? 'elevenlabs: not chosen for this video yet' : `elevenlabs: ${Object.entries(e).map(([k, v]) => `${k} ${v === true ? 'on' : v || 'off'}`).join(' · ')}`)
}

// credits [transcript=<s>] [voice=<characters>] [music=<s>] [sfx=<s>|auto,…]: what ElevenLabs would charge, at its
// public rates (the transcript costs 20 % more with keyterms, a vocabulary in the style), then what the account has
// left; with nothing, only what it has left
// ponytail: rates of the pricing page and the docs on 2026-10-26, to update here when ElevenLabs changes them
const CREDITS = { transcript: 330 / 60, keyterms: 1.2, voice: 1, music: 900 / 60, sfx: 40, sfx_auto: 200 }
async function credits(...items) {
  const want = Object.fromEntries(items.map(x => x.split('=')))
  const num = k => (want[k] === undefined ? 0 : +want[k] >= 0 ? +want[k] : die(`credits: ${k} is a number`))
  const sfx = (want.sfx ?? '').split(',').filter(Boolean).map(x => (x === 'auto' ? x : +x >= 0.5 && +x <= 30 ? +x : die('credits: sfx lists each effect\'s seconds (0.5 to 30), or auto')))
  if (Object.keys(want).some(k => !['transcript', 'voice', 'music', 'sfx'].includes(k))) die('usage: credits [transcript=<s>] [voice=<characters>] [music=<s>] [sfx=<s>|auto,…] [-p <slug>]')
  const styleFile = opt.project ? path.join(projectDir(), 'source/style.json') : path.join(HOME, '.style/style.json')
  const keyterms = fs.existsSync(styleFile) && styleOf(readJson(styleFile)).creator.vocabulary.length > 0
  const lines = [
    want.transcript && [`transcript (Scribe v2, ${num('transcript')} s${keyterms ? ', keyterms +20 %' : ''})`, num('transcript') * CREDITS.transcript * (keyterms ? CREDITS.keyterms : 1)],
    want.voice && [`voice-over (${num('voice')} characters)`, num('voice') * CREDITS.voice],
    want.music && [`music (${num('music')} s)`, num('music') * CREDITS.music],
    sfx.length && [`sound effects (${sfx.map(x => (x === 'auto' ? x : `${x} s`)).join(', ')})`, sfx.reduce((a, x) => a + (x === 'auto' ? CREDITS.sfx_auto : x * CREDITS.sfx), 0)],
  ].filter(Boolean)
  const total = lines.reduce((a, [, n]) => a + Math.ceil(n), 0)
  for (const [what, n] of lines) console.log(`${what}: ${Math.ceil(n)} credits`)
  if (lines.length) console.log(`total: about ${total} credits (ElevenLabs' rates of 2026-10-26; each regeneration costs as much again)`)
  // the account's credits left: its subscription (the key's user_read permission), never a reason to stop
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return
  const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': key } }).catch(e => ({ ok: false, status: e.message, json: async () => ({}) }))
  const j = await r.json().catch(() => ({}))
  if (!r.ok) return console.log(`account: credits left unknown (${j.detail?.message ?? `ElevenLabs answered ${r.status}`})`)
  const left = j.character_limit - j.character_count, reset = j.next_character_count_reset_unix
  console.log(`account: ${left} credits left of ${j.character_limit}${reset ? `, renewed on ${new Date(reset * 1000).toISOString().slice(0, 10)}` : ''}${total > left ? ': not enough for this estimate' : ''}`)
}

// shots: where each clip of edit.json's media cuts to a new shot (seconds of its file), to pick their from and dur
function scanShots(dir, p) {
  const f = rel => path.join(dir, rel), cache = fs.existsSync(f('assets/shots.json')) ? readJson(f('assets/shots.json')) : {}
  const files = new Map(Object.values(loadEdit(dir).media ?? {}).map(m => [mediaFile(dir, m), m.src]))
  if (!files.size) return console.log('shots: no clip in edit.json media yet')
  const started = Date.now(), lines = []
  for (const [file, src] of files) {
    if (!fs.existsSync(file)) die(`media ${src}: ${file} not found`)
    const mtime = fs.statSync(file).mtimeMs
    if (opt.force || cache[file]?.mtime !== mtime) {
      // ponytail: one scene threshold (0.3) for every footage, a param when soft cuts go unseen
      const log = ffmpegLog(['-i', file, '-vf', "scale=320:-2,select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-'])
      cache[file] = { mtime, duration: probe(file).duration, cuts: [...log.matchAll(/pts_time:([\d.]+)/g)].map(m => ms(+m[1])) }
    }
    const marks = [0, ...cache[file].cuts, cache[file].duration]
    lines.push(`## ${src} (${cache[file].duration} s)`, ...marks.slice(1).map((t, i) => `- ${clock(marks[i])} → ${clock(t)} (${ms(t - marks[i])} s)`), '')
  }
  writeJson(f('assets/shots.json'), cache)
  fs.writeFileSync(f('files/shots.md'), `# Shots: ${p.slug}\n\nThe shots of each file of edit.json's media, in seconds of the file: take a media's \`from\` and \`dur\` inside one\nshot.\n\n${lines.join('\n')}`)
  console.log(`shots: ${lines.filter(l => l.startsWith('- ')).length} shots in ${files.size} file(s) → files/shots.md (${secs(started)} s)`)
}

function rough() {
  const dir = projectDir(), f = rel => path.join(dir, rel), p = readJson(f('source/project.json'))
  if (!p.source) die('rough needs a source video')
  if (!fs.existsSync(f('assets/timeline.json'))) die('run prepare first')
  const started = Date.now()
  step(dir, 'Rough cut')
  const tl = makeTimeline(readJson(f('assets/timeline.json')), loadEdit(dir).cut)
  const { fps } = p.source, [fw, fh] = logical(p.formats[0], p.source), k = 720 / Math.min(fw, fh)
  const [cx, cy, cw, ch] = centerCrop(p.source, fw / fh)
  // segments sit on the frame grid: half a frame of margin picks exactly their frames
  const half = 0.5 / fps
  const keep = tl.segments.map(([a, b]) => `between(t,${a - half},${b - half})`).join('+')
  const vf = `select='${keep}',setpts=N/(${fps * tl.speed}*TB),crop=${cw}:${ch}:${cx}:${cy},scale=${even(fw * k)}:${even(fh * k)},fps=${p.fps}`
  const voice = p.source.audio ? buildVoice(dir, tl) : null
  const file = f(`output/${p.slug}-rough.mp4`)
  run('ffmpeg', ['-y', '-v', 'error', '-i', f('assets/source.mp4'), ...(voice ? ['-i', voice] : []),
    '-vf', vf, '-map', '0:v:0', ...(voice ? ['-map', '1:a', '-c:a', 'aac', '-b:a', '160k'] : ['-an']),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-shortest', file])
  const v = addVersion(dir, p, { rough: true, duration: ms(tl.duration), files: { [p.formats[0]]: path.basename(file) }, timeline: { speed: tl.speed, segments: tl.segments } })
  keepPreview(dir, v, p.formats[0], file)
  console.log(`rough cut v${v}: ${file} (${p.formats[0]}, ${ms(p.fps)} fps, ${clock(tl.duration)}, built in ${secs(started)} s)`)
}

// what a page needs before drawing: the scene, and the clips as frames
function readyToDraw(dir) {
  const p = readJson(path.join(dir, 'source/project.json'))
  if (!fs.existsSync(path.join(dir, 'source/scene.js'))) die('write source/scene.js first (see references/scene-format.md)')
  extractMedia(dir, loadEdit(dir).media, p)
  return p
}

const job = (dir, format, type, thumbnail) => {
  try { return buildJob(dir, format, type, thumbnail) } catch (e) { die(e.message) }
}

// the scene's sound cues (video seconds), the same in every format, for sound.py, and where its media clips play,
// for their own sound. The files only change with them, so the mix is not rebuilt for nothing. Its parts (the
// studio's Clip tab) go next to them
async function saveCues(dir, page) {
  fs.mkdirSync(path.join(dir, '.cache'), { recursive: true })
  for (const [name, list] of [['cues', await page.evaluate(() => window.cues())], ['clips', await page.evaluate(() => window.clips())]]) {
    const file = path.join(dir, `.cache/${name}.json`)
    if (!fs.existsSync(file) || JSON.stringify(list) !== JSON.stringify(readJson(file))) writeJson(file, list)
  }
  writeJson(path.join(dir, '.cache/parts.json'), await page.evaluate(() => window.parts()))
}

async function stills() {
  const dir = projectDir(), p = readyToDraw(dir), started = Date.now()
  const formats = opt.format ? pick(opt.format, p.formats, 'format') : [p.formats[0]]
  const given = args.map(Number), n = +(opt.variants ?? 0)
  if (given.some(t => !(t >= 0)) || (opt.variants && !(n >= 2 && given.length === 1))) die('usage: stills [source seconds…] [--format f|all] | stills <source seconds> --variants N')
  step(dir, n ? `${n} variants` : `Stills ${formats.join(', ')}`)
  await withChrome(p.slug, formats.length, async (pages, base) => {
    await screenTranscript(dir, pages[0], base, job(dir, p.formats[0], ''))
    await Promise.all(formats.map(async (fmt, i) => {
      const j = job(dir, fmt, ''), tl = makeTimeline(j.timeline), sub = `stills/${ratio(fmt)}`, url = `${base}render?format=${encodeURIComponent(fmt)}&type=`
      if (n) {
        // variations: the same instant with the scene's `variant` at 1…N (a page load each), numbered on one sheet
        const v = Math.min(tl.toVideo(given[0]), j.duration - 1 / j.fps), shots = []
        fs.rmSync(path.join(dir, sub, 'variants'), { recursive: true, force: true })
        for (let k = 1; k <= n; k++) {
          const shot = { v, file: `${sub}/variants/${k}.jpg`, label: `#${k}` }
          await openPage(pages[i], `${url}&variant=${k}`, j)
          await pages[i].evaluate(s => window.renderStills(s), [shot])
          shots.push({ ...shot, src: `project/${shot.file}?t=${Date.now()}` })
        }
        await pages[i].evaluate(([s, c]) => window.renderStills(s, c), [shots, `${sub}/variants/contact.jpg`])
        return console.log(`${fmt}: ${n} variants → ${path.join(dir, sub, 'variants/contact.jpg')}`)
      }
      await openPage(pages[i], url, j)
      if (fmt === p.formats[0]) await saveCues(dir, pages[i])
      // no times given: one image per beat of the timeline
      const times = given.length ? given : (await pages[i].evaluate(() => window.beats())).map(v => ms(tl.toSource(v)))
      fs.mkdirSync(path.join(dir, sub), { recursive: true })
      for (const x of fs.readdirSync(path.join(dir, sub))) if (/^t[\d.]+\.jpg$/.test(x)) fs.rmSync(path.join(dir, sub, x))
      const shots = times.map(s => {
        const v = Math.min(tl.toVideo(s), j.duration - 1 / j.fps)
        return { v, file: `${sub}/t${s.toFixed(2).padStart(5, '0')}.jpg`, label: p.source ? `${s.toFixed(2)} s source · ${v.toFixed(2)} s` : `${s.toFixed(2)} s` }
      })
      await pages[i].evaluate(([s, c]) => window.renderStills(s, c), [shots, `${sub}/contact.jpg`])
      console.log(`${fmt}: ${shots.length} stills → ${path.join(dir, sub, 'contact.jpg')}`)
    }))
  })
  console.log(`stills done in ${secs(started)} s`)
}

async function render() {
  const dir = projectDir(), f = rel => path.join(dir, rel), p = readyToDraw(dir)
  const [formats, types] = renderSet(p), n = workers(), started = Date.now()
  fs.mkdirSync(f('.cache/render'), { recursive: true })
  await withChrome(p.slug, n, async (pages, base) => {
    await screenTranscript(dir, pages[0], base, job(dir, p.formats[0], ''))
    for (const fmt of formats) for (const type of types) {
      const t0 = Date.now(), j = job(dir, fmt, type), c = CODECS[j.encoder.family], prefix = `${ratio(fmt)}-${type}-`
      const plan = chunkPlan(dir, j), name = x => `.cache/render/${prefix}${String(x.a).padStart(6, '0')}-${x.key.slice(0, 16)}.${c.ext}`
      const todo = plan.filter(x => !fs.existsSync(f(name(x)))), count = todo.length, hw = new Set()
      const url = `${base}render?format=${encodeURIComponent(fmt)}&type=${type}`, s = step(dir, `Rendering ${fmt} ${type}`)
      let rendered = 0
      s.tick(0, count)
      await Promise.all(pages.slice(0, Math.min(n, todo.length)).map(async (page, i) => {
        await openPage(page, url, j)
        for (let x; (x = todo.shift());) {
          try {
            hw.add(await page.evaluate(([a, b, file]) => window.renderChunk(a, b, file), [x.a, x.b, name(x)]))
          } catch (e) {
            // under load Chrome may lose a page: its chunk goes back to the list, for a new page (twice at most)
            if (!/Target crashed/.test(e.message) || (x.crashes = (x.crashes ?? 0) + 1) > 2) throw e
            console.warn(`${fmt} ${type}: Chrome lost a page at frame ${x.a}, rendering that chunk again`)
            todo.push(x)
            pages[i] = page = watch(await page.context().newPage())
            await openPage(page, url, j)
            continue
          }
          s.tick(++rendered, count)
        }
      }))
      // cached chunks mean the same scene, so the same cues
      if (!fs.existsSync(f('.cache/parts.json')) || (count && fmt === p.formats[0])) {
        if (!count) await openPage(pages[0], url, j)
        await saveCues(dir, pages[0])
      }
      // chunks of older edits go; the others join into one stream, then one MP4
      const keep = new Set(plan.map(x => path.basename(name(x))))
      for (const x of fs.readdirSync(f('.cache/render'))) if (x.startsWith(prefix) && !keep.has(x)) fs.rmSync(f(`.cache/render/${x}`))
      const stream = f(`.cache/render/${p.slug}-${ratio(fmt)}-${type}.${c.ext}`), head = Buffer.alloc(c.ext === 'ivf' ? 32 : 0)
      if (c.ext === 'ivf') {
        head.write('DKIF', 0)
        head.writeUInt16LE(32, 6)
        head.write(j.encoder.family === 'av1' ? 'AV01' : 'VP90', 8)
        head.writeUInt16LE(j.size[0], 12)
        head.writeUInt16LE(j.size[1], 14)
        head.writeUInt32LE(Math.round(j.fps * 1000), 16)
        head.writeUInt32LE(1000, 20)
        head.writeUInt32LE(plan.at(-1).b, 24)
      }
      joinChunks(stream, plan.map(x => f(name(x))), head)
      // a raw stream has no timestamps: -r on the input sets them (Chrome's own stream timing is not usable)
      run('ffmpeg', ['-y', '-v', 'error', ...(c.input ? [...c.input, '-r', `${j.fps}`] : []), '-i', stream, '-c', 'copy', ...(c.tag ?? []), '-movflags', '+faststart', f(`.cache/render/${p.slug}-${ratio(fmt)}-${type}.mp4`)])
      // the scene it shows, so final knows a render older than the scene
      fs.writeFileSync(f(`.cache/render/${p.slug}-${ratio(fmt)}-${type}.key`), plan.key)
      fs.rmSync(stream)
      const frames = plan.at(-1).b, took = (Date.now() - t0) / 1000
      s.end()
      console.log(`${fmt} ${type}: ${j.size.join('×')} ${c.label} ${[...hw].join('/') || 'cached'}${j.blur > 1 ? `, motion blur ×${j.blur}` : ''}, ${frames} frames, ${count}/${plan.length} chunks rendered in ${took.toFixed(1)} s` + (count ? ` (${Math.round((frames * count) / plan.length / took)} fps, ${Math.min(n, count)} workers)` : ''))
    }
  })
  console.log(`render done in ${secs(started)} s. Next: final${opt.draft ? ' --draft' : ''}`)
}

// assets/mix.wav: the edited voice, the music of edit.json, the scene's cues (.cache/cues.json, from render) and the
// sound of its media clips (.cache/clips.json), mixed by audio.py (uv runs it with numpy). Rebuilt when one of its
// inputs changed, the effects of the library included; null when there is nothing to hear.
function mix(dir, force) {
  const f = rel => path.resolve(dir, rel), file = f('assets/mix.wav')
  const inputs = ['source/sound.py', 'source/edit.json', 'source/style.json', 'assets/timeline.json', 'assets/source.wav', '.cache/cues.json', '.cache/clips.json', path.join(ENGINE, 'audio.py'), path.join(ENGINE, 'sfx.json'),
    ...[f('assets/sound'), LIBRARY].flatMap(d => (fs.existsSync(d) ? fs.readdirSync(d).map(x => path.join(d, x)) : []))]
  if (!force && fs.existsSync(file) && fs.existsSync(f('assets/mix.json')) && fs.statSync(file).mtimeMs >= Math.max(...inputs.map(x => fs.statSync(f(x), { throwIfNoEntry: false })?.mtimeMs ?? 0))) return file
  const plan = audioPlan(dir)
  if (!plan.voice && !plan.sound && !plan.clips.length) return fs.rmSync(file, { force: true }), null
  writeJson(f('.cache/audio-plan.json'), plan)
  run('uv', ['run', '--quiet', path.join(ENGINE, 'audio.py'), f('.cache/audio-plan.json')])
  return file
}

// what audio.py mixes, every time in video seconds: the voice, source/sound.py (written for the video), the scene's
// cues and the spoken words for it to follow, the pieces of media the scene plays with their volume (edit.json), and
// the library play() takes the effects from
function audioPlan(dir) {
  const f = rel => path.join(dir, rel), p = readJson(f('source/project.json')), j = job(dir, p.formats[0], ''), tl = makeTimeline(j.timeline), s = j.style.sound, segs = j.timeline?.segments
  const words = j.words.filter(w => !w.screen && (!segs || segs.some(([a, b]) => w.t1 > a && w.t0 < b))).map(w => ({ w: w.w, v0: ms(tl.toVideo(w.t0)), v1: ms(tl.toVideo(w.t1)) }))
  const media = loadEdit(dir).media ?? {}, wav = id => f(`.cache/media/${id}/audio.wav`)
  extractMedia(dir, media, p)
  const clips = (fs.existsSync(f('.cache/clips.json')) ? readJson(f('.cache/clips.json')) : [])
    .filter(c => media[c.id] && media[c.id].volume !== 0 && fs.existsSync(wav(c.id))).map(c => ({ ...c, wav: wav(c.id), gain: media[c.id].volume ?? 1 }))
  return {
    duration: j.duration, voice: p.source?.audio ? buildVoice(dir, tl) : null,
    sound: fs.existsSync(f('source/sound.py')) ? f('source/sound.py') : null, variant: 0,
    cues: fs.existsSync(f('.cache/cues.json')) ? readJson(f('.cache/cues.json')) : [], words, clips,
    levels: { music: s.music, sfx: s.sfx, duck: s.duck }, library: LIBRARY, out: f('assets/mix.wav'),
  }
}

// audio, or sound variations: --at <source s> --variants N renders 8 s of the mix with sound.py's v.variant at 1…N
// into stills/sound/<n>.wav
function audio() {
  const dir = projectDir(), started = Date.now(), n = +(opt.variants ?? 0)
  step(dir, n ? `${n} sound variants` : 'Mixing the sound')
  if (!opt.variants) {
    const file = mix(dir, true)
    return console.log(file ? `audio done in ${secs(started)} s. Next: final` : 'no voice, no source/sound.py and no media sound: the video stays silent')
  }
  const plan = audioPlan(dir), tl = makeTimeline(job(dir, readJson(path.join(dir, 'source/project.json')).formats[0], '').timeline)
  if (!(n >= 2) || opt.at === undefined || !plan.sound) die('usage: audio --at <source seconds> --variants N (source/sound.py reads v.variant)')
  const at = ms(tl.toVideo(+opt.at)), file = path.join(dir, '.cache/audio-plan.json')
  writeJson(file, plan)
  fs.rmSync(path.join(dir, 'stills/sound'), { recursive: true, force: true })
  fs.mkdirSync(path.join(dir, 'stills/sound'), { recursive: true })
  for (let k = 1; k <= n; k++) run('uv', ['run', '--quiet', path.join(ENGINE, 'audio.py'), file, '--variant', `${k}`, '--at', `${at}`, '--out', path.join(dir, `stills/sound/${k}.wav`)])
  console.log(`${n} sound variants (8 s from ${at} s) in ${secs(started)} s: ${path.join(dir, 'stills/sound')}`)
}

// The mix as AAC. The encoder can push the true peak up to about 1 dB over the mix's: the gain goes down 0.5 dB at a
// time until the file itself is under -1 dBTP (ebur128's meter), 3 dB at most
function encodeAudio(wav, aac, kbps, file) {
  for (let gain = 0; ; gain -= 0.5) {
    run('ffmpeg', ['-y', '-v', 'error', '-i', wav, ...(gain ? ['-af', `volume=${gain}dB`] : []), '-c:a', aac, '-b:a', `${kbps}k`, '-ar', '48000', '-ac', '2', file])
    const peak = +ffmpegLog(['-i', file, '-af', 'ebur128=peak=true', '-f', 'null', '-']).match(/True peak:\s+Peak:\s+(\S+)/)?.[1]
    if (!(peak > -1) || gain <= -3) {
      if (gain) console.log(`audio ${kbps} kbps: ${-gain} dB down, true peak ${peak} dBTP (AAC overshoots the mix's peak)`)
      return file
    }
  }
}

// each render with its sound (mix.wav, rebuilt when stale), then a new version. The delivery (all the renders) also
// gets the posters, the subtitles and the description; a draft (--draft) is the main format alone, to review
function final() {
  const dir = projectDir(), f = rel => path.join(dir, rel), p = readJson(f('source/project.json')), edit = loadEdit(dir)
  const j = job(dir, p.formats[0], ''), tl = makeTimeline(j.timeline), started = Date.now(), draft = !!opt.draft
  const formats = draft ? renderSet(p)[0] : p.formats, types = draft ? ['draft'] : p.renders
  step(dir, draft ? 'Making the draft version' : 'Delivering the video')
  const audio = mix(dir)
  // AAC once per bitrate (Apple's encoder when ffmpeg has it: ten times faster), then every file is a copy
  const aac = out('ffmpeg', ['-hide_banner', '-encoders']).includes(' aac_at ') ? 'aac_at' : 'aac', tracks = {}
  const track = kbps => (tracks[kbps] ??= encodeAudio(audio, aac, kbps, f(`.cache/audio-${kbps}.m4a`)))
  const files = {}, made = []
  for (const fmt of formats) for (const type of types) {
    const video = f(`.cache/render/${p.slug}-${ratio(fmt)}-${type}.mp4`), key = f(`.cache/render/${p.slug}-${ratio(fmt)}-${type}.key`), again = `render${draft ? ' --draft' : ''}`
    if (!fs.existsSync(video)) die(`no render for ${fmt} ${type}: run ${again} first`)
    if (!fs.existsSync(key) || fs.readFileSync(key, 'utf8') !== sceneKey(dir, job(dir, fmt, type))) console.warn(`warning: ${fmt} ${type} was rendered before the last change of the scene: run ${again} again`)
    const file = f(`output/${p.slug}-${ratio(fmt)}-${type}.mp4`)
    run('ffmpeg', ['-y', '-v', 'error', '-i', video, ...(audio ? ['-i', track(renders()[type].audio_kbps), '-map', '0:v', '-map', '1:a', '-shortest'] : ['-an']),
      '-c', 'copy', '-movflags', '+faststart', file])
    files[fmt] ??= path.basename(file)
    made.push(file)
  }
  const parts = fs.existsSync(f('.cache/parts.json')) ? readJson(f('.cache/parts.json')) : []
  if (!draft) made.push(...deliver(dir, p, j, tl, edit, files, parts))
  const v = addVersion(dir, p, { ...(draft && { draft: true }), duration: ms(j.duration), files, timeline: j.timeline })
  // what the studio's sound panel shows of this version: the cues and each track's level (audio.py's mix.json)
  if (audio) {
    fs.mkdirSync(f('files/sound'), { recursive: true })
    fs.writeFileSync(f(`files/sound/v${v}.json`), JSON.stringify({ cues: fs.existsSync(f('.cache/cues.json')) ? readJson(f('.cache/cues.json')) : [], ...readJson(f('assets/mix.json')) }))
  }
  // and its Clip tab: the scene's parts, the takes kept from the source, and per format a strip of thumbnails
  // (one every `every` s, `cols` per row of the sheet)
  const every = Math.max(0.5, j.duration / 400), count = Math.ceil(j.duration / every), cols = 10, strips = {}
  fs.mkdirSync(f('files/video'), { recursive: true })
  for (const fmt of formats) {
    const [a, b] = fmt.split(':').map(Number), w = 2 * Math.round((72 * a) / b), file = `files/video/v${v}-${ratio(fmt)}.jpg`
    run('ffmpeg', ['-y', '-v', 'error', '-i', f(`output/${files[fmt]}`), '-vf', `fps=1/${every},scale=${w}:144,tile=${cols}x${Math.ceil(count / cols)}`, '-frames:v', '1', '-q:v', '5', f(file)])
    strips[fmt] = { file, every, count, cols, w, h: 144 }
  }
  const takes = p.source ? (j.timeline?.segments ?? [[0, j.duration]]).map(([a, b], i) => ({ kind: 'take', t0: ms(tl.toVideo(a)), t1: ms(tl.toVideo(b - 0.001)), name: `take ${i + 1}`, source: [a, b] })) : []
  fs.writeFileSync(f(`files/video/v${v}.json`), JSON.stringify({ parts: [...takes, ...parts], strips }))
  // its preview, from its smallest render: no 4K to decode when a 1080p is there
  const small = types.reduce((a, b) => (renderShort(a) <= renderShort(b) ? a : b))
  keepPreview(dir, v, formats[0], f(`output/${p.slug}-${ratio(formats[0])}-${small}.mp4`))
  console.log(made.join('\n'))
  console.log(`final v${v}${draft ? ' (draft)' : ''} in ${secs(started)} s (${audio ? path.basename(audio) : 'no audio'}). Reload the studio`)
}

// what goes with the MP4s of a delivery: a poster per format, the subtitles (SRT and WebVTT, the same for every
// format) and the description to paste under the video
function deliver(dir, p, j, tl, edit, files, parts) {
  const f = rel => path.join(dir, rel), made = []
  const at = edit.poster != null ? tl.toVideo(edit.poster) : Math.min(1.5, j.duration / 2)
  for (const fmt of p.formats) {
    const poster = f(`output/${p.slug}-${ratio(fmt)}-poster.jpg`)
    run('ffmpeg', ['-y', '-v', 'error', '-ss', `${at}`, '-i', f(`output/${files[fmt]}`), '-frames:v', '1', '-q:v', '2', poster])
    made.push(poster)
  }
  // the speech as it is heard (kept words, on video time), or the lines of what the video shows
  const segs = j.timeline?.segments, spoken = j.words.filter(w => !w.screen && (!segs || segs.some(([a, b]) => w.t1 > a && w.t0 < b)))
  const cues = spoken.length ? speechCues(spoken.map(w => ({ w: w.w, v0: tl.toVideo(w.t0), v1: tl.toVideo(w.t1) })))
    : j.words.filter(w => w.screen).map(w => ({ v0: tl.toVideo(w.t0), v1: tl.toVideo(w.t1), text: w.w })).filter(c => c.v1 > c.v0)
  for (const [ext, write] of [['srt', srt], ['vtt', vtt]]) {
    const file = f(`output/${p.slug}.${ext}`)
    if (cues.length) fs.writeFileSync(file, write(cues)), made.push(file)
    else fs.rmSync(file, { force: true })
  }
  const text = description(fs.readFileSync(f('About.md'), 'utf8'), parts), file = f(`output/${p.slug}-description.txt`)
  if (text) fs.writeFileSync(file, text + '\n'), made.push(file)
  else fs.rmSync(file, { force: true })
  return made
}

// every reviewable render is a new version, with its own feedback file (files/reviews/vN.json);
// its timeline is kept so the studio maps that version's times back to the source
function addVersion(dir, p, version) {
  const v = (p.versions?.length ?? 0) + 1
  p.versions = [...(p.versions ?? []), { v, rendered: new Date().toISOString(), ...version }]
  writeJson(path.join(dir, 'source/project.json'), p)
  return v
}

// the next render overwrites output/: the studio compares with the earlier versions through their preview, the main
// format in 720p at most (files/versions/vN-<ratio>.mp4)
function keepPreview(dir, v, fmt, video) {
  const file = path.join(dir, `files/versions/v${v}-${ratio(fmt)}.mp4`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  run('ffmpeg', ['-y', '-v', 'error', '-i', video, '-map', '0:v:0', '-map', '0:a?', '-vf', "scale='trunc(iw*min(1,720/min(iw,ih))/2)*2':-2",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', `${DRAFT.audio_kbps}k`, '-movflags', '+faststart', file])
}

// status "<what Claude does now>": a step of Claude's own (the brief, the direction, the scene, a review pass…), shown
// in the studio until the next one
function status(...words) {
  const dir = projectDir(), label = words.join(' ').trim()
  if (!label) die('usage: status "<what you are doing now>" -p <slug>')
  logSteps(dir, steps => {
    for (const x of steps) if (x.by === 'claude' && x.state === 'running') Object.assign(x, { state: 'done', t1: now() })
    steps.push({ id: `${process.pid}-${Date.now()}`, label, by: 'claude', state: 'running', t0: now() })
  })
  console.log(`status: ${label}`)
}

// thumbnail [--at <source s>]: the YouTube thumbnail, 1280×720 (output/<slug>-thumbnail.jpg). The scene draws it in
// 16:9 when it receives `thumbnail: true`, at the poster's time by default (scene-format.md)
async function thumbnail() {
  const dir = projectDir(), f = rel => path.join(dir, rel), p = readyToDraw(dir), edit = loadEdit(dir), j = job(dir, '16:9', '', true), tl = makeTimeline(j.timeline)
  step(dir, 'Thumbnail')
  const s = opt.at ?? edit.poster, v = Math.min(s != null ? tl.toVideo(+s) : Math.min(1.5, j.duration / 2), j.duration - 1 / j.fps)
  await withChrome(p.slug, 1, async ([page], base) => {
    await openPage(page, `${base}render?format=16%3A9&type=&thumbnail=1`, j)
    await page.evaluate(shots => window.renderStills(shots), [{ v, file: 'stills/thumbnail.jpg' }])
  })
  fs.copyFileSync(f('stills/thumbnail.jpg'), f(`output/${p.slug}-thumbnail.jpg`))
  console.log(`thumbnail: ${f(`output/${p.slug}-thumbnail.jpg`)} (1280×720, ${Math.round(fs.statSync(f('stills/thumbnail.jpg')).size / 1024)} KB, at ${ms(v)} s)`)
}

// fix <source s> "<text>": the spoken word at that time (a Text fix on the speech, in the studio) now reads text, ""
// removes it; the captions, the subtitles and files/words.md follow
function fixWord(at, text) {
  const dir = projectDir(), f = rel => path.join(dir, rel), t = +at
  if (!(t >= 0) || text === undefined || !fs.existsSync(f('assets/words.json'))) die('usage: fix <source seconds> "<text>" -p <slug> (after prepare: it fixes the transcript)')
  const words = readJson(f('assets/words.json')), spoken = words.filter(w => !w.screen)
  const w = spoken.reduce((a, x) => (!a || Math.abs(x.t0 - t) < Math.abs(a.t0 - t) ? x : a), null)
  if (!w || Math.abs(w.t0 - t) > 0.5) die(`no spoken word at ${t} s (files/words.md gives their times)`)
  const was = w.w
  if (text.trim()) w.w = text.trim()
  else words.splice(words.indexOf(w), 1)
  writeJson(f('assets/words.json'), words)
  fs.writeFileSync(f('files/words.md'), wordsMd(words.filter(x => !x.screen), readJson(f('source/project.json')).slug))
  console.log(`fix: "${was}" at ${w.t0} s ${text.trim() ? `now reads "${w.w}"` : 'removed'}. Render again for the captions`)
}

// sync <media>: where a media of edit.json (a second camera, another mic) sits in the source, found by their sound.
// Its `sync` (the second of its file at the source's 0) makes clip() show it in step with the source, cuts and speed
// included
function syncMedia(id) {
  const dir = projectDir(), p = readJson(path.join(dir, 'source/project.json')), edit = loadEdit(dir), m = edit.media?.[id]
  if (!m) die(`usage: sync <media id> -p <slug> (media of source/edit.json: ${Object.keys(edit.media ?? {}).join(', ') || 'none'})`)
  if (!p.source?.audio) die('sync needs a source video with sound')
  step(dir, `Syncing ${id} by its sound`)
  const { sync, r } = JSON.parse(out('uv', ['run', '--quiet', path.join(ENGINE, 'audio.py'), '--sync', sourceWav(dir), mediaFile(dir, m)]))
  if (r < 0.7) die(`media ${id}: its sound does not match the source's (r ${r}): another moment, or no sound to compare`)
  edit.media[id] = { ...m, sync }
  writeJson(path.join(dir, 'source/edit.json'), edit)
  console.log(`media ${id}: sync ${sync} (r ${r}), ${sync >= 0 ? `the source starts ${sync} s into its file` : `its file starts ${-sync} s into the source`}. clip('${id}') now follows the source`)
}

// beats <track | bpm> [--at <video s>]: the music's grid in VIDEO seconds, measured on a track (placed at --at in the
// video, 0 by default) or laid out from a tempo; files/beats.md to read it, files/beats.json for check's on_beat
function beatGrid(what) {
  const dir = projectDir(), f = rel => path.join(dir, rel), p = readJson(f('source/project.json')), edit = loadEdit(dir), at = +(opt.at ?? 0)
  // the video's length before any scene (the grid comes first): the source as its timeline keeps it, or edit.json's
  const tl = p.source ? fs.existsSync(f('assets/timeline.json')) && makeTimeline(readJson(f('assets/timeline.json')), edit.cut)
    : edit.duration > 0 && makeTimeline({ fps: p.fps, speed: 1, segments: [[0, edit.duration]] }, edit.cut)
  const j = { duration: tl ? tl.duration : p.source?.duration ?? die('set "duration" (seconds) in source/edit.json first: the grid runs over the video') }
  step(dir, /^\d+(\.\d+)?$/.test(what ?? '') ? `Beat grid at ${what} bpm` : 'Measuring the beats')
  let bpm, times, down = 0, from
  if (/^\d+(\.\d+)?$/.test(what ?? '')) {
    bpm = +what
    times = Array.from({ length: Math.floor(((j.duration - at) * bpm) / 60) + 1 }, (_, i) => (i * 60) / bpm)
    from = `${bpm} bpm`
  } else {
    const file = path.resolve(dir, what ?? '')
    if (!what || !fs.existsSync(file)) die('usage: beats <track file | bpm> [--at <video seconds>] -p <slug>')
    ;({ bpm, beats: times, downbeat: down } = JSON.parse(out('uv', ['run', '--quiet', path.join(ENGINE, 'audio.py'), '--beats', file])))
    from = path.relative(dir, file)
  }
  // each beat with its bar (4/4 from the downbeat; a pickup before it is bar 0)
  const grid = times.map((t, i) => ({ t: ms(t + at), bar: Math.floor((i - down) / 4) + 1 })).filter(x => x.t >= 0 && x.t <= j.duration)
  writeJson(f('files/beats.json'), { from, bpm, at, beats: grid.map(x => x.t) })
  const bars = Object.groupBy(grid, x => x.bar)
  fs.writeFileSync(f('files/beats.md'), `# Beats: ${p.slug}\n\n${from}: ${ms(bpm)} bpm, a beat every ${ms(60 / bpm)} s, a bar every ${ms(240 / bpm)} s (4/4). VIDEO seconds${at ? `, the track from ${at} s` : ''}.\n\n` +
    Object.entries(bars).map(([n, xs]) => `- bar ${n}: ${xs.map(x => clock(x.t)).join(' · ')}`).join('\n') + '\n')
  console.log(`beats: ${ms(bpm)} bpm, ${grid.length} beats in ${Object.keys(bars).length} bars → files/beats.md`)
}

// the encoders this Chrome has, at 1080p30
async function codecs() {
  const found = await withChrome(null, 1, async ([page], base) => {
    await page.goto(base)
    return page.evaluate(async list => {
      const out = {}
      for (const [id, codec] of list) {
        const cfg = { codec, width: 1920, height: 1080, bitrate: 8e6, framerate: 30 }
        if (id === 'h264') cfg.avc = { format: 'annexb' }
        if (id === 'hevc') cfg.hevc = { format: 'annexb' }
        out[id] = (await VideoEncoder.isConfigSupported({ ...cfg, hardwareAcceleration: 'prefer-hardware' })).supported ? 'hardware'
          : (await VideoEncoder.isConfigSupported({ ...cfg, hardwareAcceleration: 'prefer-software' })).supported ? 'software' : null
      }
      return out
    }, Object.entries(CODECS).map(([id, c]) => [id, c.codec(LEVELS[1])]))
  })
  for (const [id, how] of Object.entries(found)) console.log(`${id.padEnd(5)} ${CODECS[id].label.padEnd(13)} ${how ? `${how}${how === 'software' ? ' (slower)' : ''}` : 'not available'}${id === 'h264' ? ' · default' : ''}`)
}

function projectInfo(dir) {
  const f = rel => path.join(dir, rel), p = readJson(f('source/project.json')), rules = readJson(f('source/rules.json'))
  const video = file => {
    try {
      const st = fs.statSync(f(`output/${file}`))
      return { file, url: `video/${encodeURIComponent(file)}?t=${Math.round(st.mtimeMs)}`, size: st.size, mtime: st.mtime }
    } catch { return null }
  }
  // the version's preview, only while it is on disk (keepPreview): null for a version made before them, or deleted
  const preview = v => {
    for (const format of Object.keys(v.files)) {
      const rel = `files/versions/v${v.v}-${ratio(format)}.mp4`, st = fs.statSync(f(rel), { throwIfNoEntry: false })
      if (st) return { format, url: `project/${rel}?t=${Math.round(st.mtimeMs)}` }
    }
    return null
  }
  return {
    slug: p.slug,
    dir,
    formats: p.formats,
    fps: p.fps,
    // its label (H.264, HEVC (H.265)…), for the studio's header
    codec: CODECS[p.codec ?? 'h264'].label,
    source: !!p.source,
    rules: rules.active,
    // null: no transcript (turned off by a pack, or not made yet)
    words: effective(rules, () => {}).transcribe && fs.existsSync(f('assets/words.json')) ? readJson(f('assets/words.json')) : null,
    versions: (p.versions ?? []).map(v => ({ ...v, files: Object.fromEntries(Object.entries(v.files).map(([k, file]) => [k, video(file)])), preview: preview(v) })),
  }
}

function saveReview(dir, n, comments) {
  const p = readJson(path.join(dir, 'source/project.json')), ver = p.versions?.find(x => x.v === n)
  if (!ver || !Array.isArray(comments)) return false
  const file = path.join(dir, `files/reviews/v${n}.json`), video = Object.values(ver.files)[0]
  const st = fs.statSync(path.join(dir, 'output', video))
  // Claude answers in the file: a studio tab opened before that (it has no reply) must not undo the answer
  const answered = Object.fromEntries((fs.existsSync(file) ? readJson(file).comments : []).filter(c => c.reply).map(c => [c.id, c]))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  writeJson(file, {
    kind: 'video-review', v: 1, about: REVIEW_ABOUT, slug: p.slug, version: `v${n}`,
    video: { file: video, size: st.size, mtime: st.mtime },
    comments: comments.map(c => answered[c.id] && !c.reply ? { ...c, reply: answered[c.id].reply, resolved: answered[c.id].resolved } : c),
  })
  return true
}

const reply = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }

const readBody = (req, max = 30e6) => new Promise((ok, ko) => {
  const chunks = []
  let size = 0
  req.on('data', c => { if ((size += c.length) > max) { ko(new Error('body too large')); req.destroy() } else chunks.push(c) })
  req.on('end', () => ok(Buffer.concat(chunks)))
  req.on('error', ko)
})

// files with Range support: the player seeks in the video by byte ranges
function sendFile(req, res, file) {
  const st = file && fs.statSync(file, { throwIfNoEntry: false })
  if (!st?.isFile()) return reply(res, 404, { error: 'not found' })
  const type = MIME[path.extname(file)] ?? 'application/octet-stream', size = st.size
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  if (!m) {
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' })
    return fs.createReadStream(file).pipe(res)
  }
  const start = m[1] ? +m[1] : size - +m[2], end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1
  if (start < 0 || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end() }
  res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' })
  fs.createReadStream(file, { start, end }).pipe(res)
}

const inside = (root, rel) => {
  const file = path.resolve(root, rel)
  return file.startsWith(root + path.sep) ? file : ''
}

// the videos of the projects folder, by name
const videos = () => fs.readdirSync(HOME).filter(x => /^[a-z0-9][a-z0-9-]*$/.test(x) && fs.existsSync(path.join(HOME, x, 'source/project.json'))).sort()

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// /<slug>/ the studio · api/… its JSON API · video/<file> output/ · review/<file> assets/review/ ·
// render and preview: the engine pages, reading engine/… and project/… · out: what a render page writes (render server only)
async function handle(req, res, write = false) {
  const { host, origin } = req.headers, port = req.socket.localPort
  // DNS rebinding and cross-site requests: only pages from this machine
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host) || (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))) return reply(res, 403, { error: 'forbidden' })
  const url = new URL(req.url, `http://${host}`), post = req.method === 'POST'
  if (url.pathname === '/__video-editor') return reply(res, 200, { engine: ENGINE, home: HOME, mtime: LOADED })
  if (url.pathname === '/__video-editor/quit' && post) { res.on('finish', () => process.exit(0)); return reply(res, 200, {}) }
  if (url.pathname === '/__video-editor/owner' && post) {
    const pid = +url.searchParams.get('pid')
    if (!Number.isInteger(pid) || pid < 2) return reply(res, 400, { error: 'expects ?pid=<process id>' })
    watchOwner(pid)
    return reply(res, 200, {})
  }
  if (url.pathname === '/__blank/') { res.writeHead(200, { 'Content-Type': MIME['.html'] }); return res.end('<!doctype html><title>blank</title>') }

  // the root opens the first video of the folder
  if (url.pathname === '/') {
    const [first] = videos()
    if (!first) return reply(res, 404, { error: `no video in ${HOME}` })
    res.writeHead(302, { Location: `/${first}/` })
    return res.end()
  }

  const [slug, ...rest] = url.pathname.slice(1).split('/').map(decodeURIComponent)
  const dir = path.join(HOME, slug)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || !fs.existsSync(path.join(dir, 'source/project.json'))) return reply(res, 404, { error: `no project ${slug}` })
  if (!rest.length) { res.writeHead(302, { Location: `/${slug}/` }); return res.end() }

  const sub = rest.join('/'), m = sub.match(/^api\/reviews\/v(\d+)$/)
  if (sub === 'api/project') return reply(res, 200, projectInfo(dir))
  // the project's pack as `rules show` prints it, for the studio's header: its text, and the params in effect
  if (sub === 'api/rules') {
    const r = readJson(path.join(dir, 'source/rules.json')), all = packs()
    return reply(res, 200, {
      params: effective(r, () => {}),
      overrides: r.overrides ?? {},
      packs: r.active.map(name => ({ name, description: all[name]?.description ?? null, origin: all[name]?.origin ?? null, file: all[name]?.file ?? null, body: all[name]?.body.trim() ?? null })),
    })
  }
  // the progress log, the file Claude changed last (the work goes on between two logged steps), and when the project
  // started: the total time, even once the log has dropped its first steps
  if (sub === 'api/progress') {
    let log = { updated: null, steps: [] }
    try { log = readJson(path.join(dir, '.cache/progress.json')) } catch {}
    log.started = readJson(path.join(dir, 'source/project.json')).created ?? null
    const touched = ['About.md', ...fs.readdirSync(path.join(dir, 'source'), { recursive: true }).map(x => `source/${x.replaceAll(path.sep, '/')}`)]
      .filter(x => !/__pycache__|^source\/(project|rules|style)\.json$|^source\/STYLE\.md$/.test(x))
      .map(x => [x, fs.statSync(path.join(dir, x), { throwIfNoEntry: false })]).filter(([, st]) => st?.isFile())
      .reduce((a, b) => (!a || b[1].mtimeMs > a[1].mtimeMs ? b : a), null)
    return reply(res, 200, { ...log, touched: touched && { file: touched[0], mtime: touched[1].mtime } })
  }
  // the other videos of the folder, for the studio's switcher
  if (sub === 'api/projects') {
    return reply(res, 200, videos().map(x => {
      const p = readJson(path.join(HOME, x, 'source/project.json')), last = p.versions?.at(-1)
      const poster = `${x}-${ratio(p.formats[0])}-poster.jpg`
      return { slug: x, versions: p.versions?.length ?? 0, rendered: last?.rendered ?? null, duration: last?.duration ?? null, poster: fs.existsSync(path.join(HOME, x, 'output', poster)) ? poster : null }
    }))
  }
  if (sub === 'api/job') {
    try { return reply(res, 200, buildJob(dir, url.searchParams.get('format'), url.searchParams.get('type') ?? '', url.searchParams.get('thumbnail') === '1')) } catch (e) { return reply(res, 400, { error: e.message }) }
  }
  if (m) {
    const file = path.join(dir, `files/reviews/v${m[1]}.json`)
    if (!post) return reply(res, 200, fs.existsSync(file) ? readJson(file) : { version: `v${m[1]}`, comments: [] })
    return saveReview(dir, +m[1], JSON.parse(await readBody(req)).comments) ? reply(res, 200, { ok: true }) : reply(res, 400, { error: 'unknown version, or no comments array' })
  }
  if (sub === 'api/review-image' && post) {
    const id = url.searchParams.get('id') ?? '', png = await readBody(req)
    if (!/^[a-z0-9]{4,40}$/.test(id) || !png.subarray(0, 8).equals(PNG)) return reply(res, 400, { error: 'expects ?id=<a-z0-9> and a PNG body' })
    const rel = `assets/review/frame-${id}.png`
    fs.mkdirSync(path.join(dir, 'assets/review'), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), png)
    return reply(res, 200, { path: rel })
  }
  if (sub === 'out' && post && write) {
    const rel = url.searchParams.get('file') ?? ''
    if (!/^(\.cache\/render|stills)\/[\w.\-/]+$/.test(rel) || rel.includes('..')) return reply(res, 400, { error: `cannot write ${rel}` })
    const file = path.join(dir, rel), body = await readBody(req, 2e9)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, body)
    return reply(res, 200, { ok: true })
  }
  if (['render', 'preview', 'face'].includes(sub)) return sendFile(req, res, path.join(ENGINE, `page/${sub}.html`))
  if (rest[0] === 'engine') return sendFile(req, res, inside(ENGINE, rest.slice(1).join('/')))
  if (rest[0] === 'project') return sendFile(req, res, inside(dir, rest.slice(1).join('/')))
  if (rest[0] === 'video' && rest.length === 2) return sendFile(req, res, path.join(dir, 'output', path.basename(rest[1])))
  if (rest[0] === 'review' && rest.length === 2) return sendFile(req, res, path.join(dir, 'assets/review', path.basename(rest[1])))
  const file = path.resolve(STUDIO, sub || 'index.html')
  sendFile(req, res, file.startsWith(STUDIO + path.sep) && fs.existsSync(file) ? file : path.join(STUDIO, 'index.html'))
}

function serve() {
  http.createServer((req, res) => handle(req, res).catch(e => reply(res, 500, { error: e.message })))
    .listen(PORT, '127.0.0.1', () => console.log(`studio server on http://127.0.0.1:${PORT}/ for ${HOME}`))
}

// the Claude processes the server works for (each `studio` or `preview` adds its own): it quits once they have all
// quit. A server nobody registered with (started by hand, the tests) runs until stopped
const owners = new Set()
function watchOwner(pid) {
  if (!owners.size) setInterval(() => {
    for (const o of owners) try { process.kill(o, 0) } catch (e) { if (e.code === 'ESRCH') owners.delete(o) }
    if (!owners.size) { console.log('every Claude this studio server worked for has quit: stopping'); process.exit(0) }
  }, 2000)
  owners.add(pid)
}

// the Claude Code (or Claude app) this command runs under: the nearest ancestor named claude, null outside one
// ponytail: null on Windows (no ps -o), its server runs until Windows logs off; Get-CimInstance Win32_Process if that bothers
function claudePid() {
  try {
    const procs = new Map(execFileSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8' }).trim().split('\n').map(l => {
      const [, pid, ppid, comm] = l.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
      return [+pid, { ppid: +ppid, comm }]
    }))
    for (let pid = process.ppid; pid > 1 && procs.has(pid); pid = procs.get(pid).ppid)
      if (/^claude$/i.test(path.basename(procs.get(pid).comm))) return pid
  } catch {}
  return null
}

// the studio server, which stops once the Claude that asked for it has quit
async function ensureServer() {
  const url = await findServer(), owner = claudePid()
  if (owner) await fetch(url + `__video-editor/owner?pid=${owner}`, { method: 'POST' }).catch(() => {})
  return url
}

// the studio server in the background: reused when it runs this very engine (same file, same version) for this projects folder
// one server per projects folder, side by side from PORT up: another folder's server keeps its port
async function findServer() {
  const sleep = t => new Promise(ok => setTimeout(ok, t)), base = port => `http://127.0.0.1:${port}/`
  const ping = port => fetch(base(port) + '__video-editor').then(r => r.json()).catch(() => null)
  const ports = Array.from({ length: 20 }, (_, i) => PORT + i), lives = await Promise.all(ports.map(ping))
  let i = lives.findIndex(l => l?.home === HOME)
  if (i >= 0 && lives[i].engine === ENGINE && lives[i].mtime === LOADED) return base(ports[i])
  // this folder's server from another engine (or an older one) gives its port to this one
  if (i >= 0) {
    await fetch(base(ports[i]) + '__video-editor/quit', { method: 'POST' }).catch(() => {})
    await sleep(300)
    lives[i] = null
  } else i = 0
  fs.mkdirSync(HOME, { recursive: true })
  const log = fs.openSync(path.join(HOME, '.studio.log'), 'a')
  // a port taken by something that is not a studio fails to start: the next one is tried
  for (; i < ports.length; i++) {
    if (lives[i]) continue
    spawn(process.execPath, [SELF, 'serve'], { cwd: HOME, env: { ...process.env, VIDEO_EDITOR_DIR: HOME, VIDEO_EDITOR_PORT: `${ports[i]}` }, detached: true, windowsHide: true, stdio: ['ignore', log, log] }).unref()
    let live = null
    for (let k = 0; k < 50 && !(live = await ping(ports[i])); k++) await sleep(100)
    if (live?.home === HOME) return base(ports[i])
  }
  die(`the studio server did not start on ports ${PORT}–${PORT + 19}, see ${path.join(HOME, '.studio.log')}`)
}

// one studio per project: the server only serves projects of the projects folder
function servedProject() {
  const dir = projectDir()
  if (path.dirname(dir) !== HOME) die(`the studio serves the projects of ${HOME} only`)
  return dir
}

async function studio() {
  if (!fs.existsSync(path.join(STUDIO, 'index.html'))) die(`the studio is not built (${STUDIO})`)
  const dir = servedProject(), url = `${await ensureServer()}${path.basename(dir)}/`
  console.log(`studio: ${url}`)
  if (opt.open) openUrl(url)
}

// a URL in the default browser, or in Chrome; never fatal, the URL is printed anyway
function openUrl(url, chrome = false) {
  const [bin, ...argv] = byOs(['open', ...(chrome ? ['-a', 'Google Chrome'] : [])], [chrome ? 'google-chrome' : 'xdg-open'], ['cmd', '/c', 'start', ...(chrome ? ['chrome'] : [])])
  spawn(bin, [...argv, url], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref()
}

// the live debug page in a visible Chrome: the same scene, no encoding, R reloads it
async function preview() {
  const dir = servedProject(), p = readyToDraw(dir), format = opt.format ?? p.formats[0]
  pick(format, p.formats, 'format')
  job(dir, format, '')
  const url = `${await ensureServer()}${p.slug}/preview?format=${encodeURIComponent(format)}`
  openUrl(url, true)
  console.log(`preview: ${url}`)
}

// the projects folder's .style/style.json is the truth; STYLE.md, its readable form, is regenerated here (never edited by hand)
function styleMd(raw) {
  const s = styleOf(raw), c = s.creator, l = s.look, snd = s.sound
  return `# Style${c.name ? ` of ${c.name}` : ''}

Generated by \`video.mjs style\` on ${today()} from style.json: change it with \`style set\` or \`style note\`.
A project keeps the copy taken at its init (source/style.json, source/STYLE.md).

## Who
- ${c.name || '(no name)'}${c.handle ? ` (${c.handle})` : ''}, language \`${c.lang}\`: captions, titles and CTA are written in it
- Niche: ${c.niche || '-'} · audience: ${c.audience || '-'}
- CTA: ${c.cta.sub || '-'} · button "${c.cta.button}", then "${c.cta.done}"${c.avatar ? ` · avatar ${c.avatar}` : ''}
${c.vocabulary.length ? `- Vocabulary of the transcript: ${c.vocabulary.join(', ')}\n` : ''}
## Look
- Palette: ${Object.entries(l.palette).map(([k, v]) => `${k} \`${v}\``).join(', ')} (each one is \`var(--name)\` in the scene)
- Font: ${l.font}${Object.keys(l.fonts).length ? ` (files: ${Object.entries(l.fonts).map(([f, file]) => `${f} ${file}`).join(', ')})` : ''}
${l.symbols.length ? `- Symbols of the brand:\n${l.symbols.map(x => `  - ${x}\n`).join('')}` : ''}${raw?.look?.paper ? `- Paper look: grain ${l.paper.grain}, relief ${l.paper.relief}, depth ${l.paper.depth}\n` : ''}- Captions: ${l.captions.size} px

## Sound
- Under a voice: music bed at ${snd.music} LUFS, ×${snd.duck} while it speaks; effects at ${snd.sfx} LUFS
- Without a voice, source/sound.py sets its own balance; every mix ends at -14 LUFS
- The mood and the sound identity are in the notes

## Notes: what the user asked for, in every video
${s.notes.length ? s.notes.map(n => `- ${n}`).join('\n') : '- (none yet)'}
`
}

// style [show] | style set a.b=value … | style note "text": the value is JSON when it parses (numbers, arrays), else text.
// The projects folder's style, or with -p the copy a project froze at its init (source/)
function style(sub, ...rest) {
  const dir = opt.project ? path.join(projectDir(), 'source') : path.join(HOME, '.style'), file = path.join(dir, 'style.json'), s = fs.existsSync(file) ? readJson(file) : {}
  if (sub === 'set' && rest.length && rest.every(x => /^[\w.]+=/.test(x))) {
    for (const x of rest) {
      const [key, ...v] = x.split('='), keys = key.split('.'), last = keys.pop()
      if (!((keys[0] ?? last) in STYLE)) die(`style set: ${key} is not in the style (${Object.keys(STYLE).join(', ')}), see references/style-schema.md`)
      let o = s
      for (const k of keys) o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {}
      try { o[last] = JSON.parse(v.join('=')) } catch { o[last] = v.join('=') }
    }
  } else if (sub === 'note' && rest.length) s.notes = [...(s.notes ?? []), rest.join(' ')]
  else if (sub && sub !== 'show') die('usage: style [show] | style set <path>=<value> [<path>=<value>…] | style note "<text>"')
  else if (!fs.existsSync(file)) return console.log(`no style yet (${file}): run the setup interview`)
  fs.mkdirSync(dir, { recursive: true })
  writeJson(file, s)
  fs.writeFileSync(path.join(dir, 'STYLE.md'), styleMd(s))
  console.log(`${path.join(dir, 'STYLE.md')}\n\n${styleMd(s)}`)
}

// before init (the starting questions): size, rate, length and matching format of a file (ffprobe) or a URL (yt-dlp, no download)
function probeSource(spec) {
  const src = spec && rushOf(spec).src, url = /^https?:\/\//.test(src ?? '')
  if (!url && !fs.existsSync(src ?? '')) die(`usage: probe <file|url> (${src ?? 'nothing given'} not found)`)
  let s
  try {
    s = url
      ? (([w, h, fps, d]) => ({ width: +w, height: +h, fps: +fps, duration: +d }))(out('uvx', ['yt-dlp', '--no-warnings', '--no-playlist', '--print', '%(width)s %(height)s %(fps)s %(duration)s', src]).trim().split('\n')[0].split(' '))
      : probe(src)
  } catch { die(`cannot read the video ${src}`) }
  const format = Object.keys(FORMATS).find(k => Math.abs(FORMATS[k][0] / FORMATS[k][1] - s.width / s.height) < 0.01) ?? null
  console.log(JSON.stringify({ ...s, format }))
}

// runs in the page: what it paints, weighted by how much of it, and every inline SVG with its colors computed
// (classes and currentColor do not survive in a file of its own)
async function seeLook() {
  const hex = c => {
    const m = c?.match(/[\d.]+/g)
    return m?.length >= 3 && (m[3] === undefined || +m[3] >= 0.5) ? '#' + m.slice(0, 3).map(x => Math.round(+x).toString(16).padStart(2, '0')).join('') : null
  }
  const add = (m, k, w) => k && (m[k] = (m[k] ?? 0) + w)
  const share = m => {
    const all = Object.values(m).reduce((a, b) => a + b, 0)
    return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([k, v]) => [k, Math.round((1000 * v) / all) / 10])
  }
  const H = document.documentElement.scrollHeight, bg = {}, text = {}, shapes = {}, fonts = {}, images = []
  // the backgrounds as seen: a grid of points on every screen, each one taking the first painted box under it
  const page = hex(getComputedStyle(document.body).backgroundColor) ?? hex(getComputedStyle(document.documentElement).backgroundColor) ?? '#ffffff'
  const under = e => {
    for (; e; e = e.parentElement) {
      const cs = getComputedStyle(e)
      if (/^(IMG|VIDEO|CANVAS|PICTURE)$/.test(e.tagName) || /url\(/.test(cs.backgroundImage)) return 'image'
      const c = hex(cs.backgroundColor) ?? hex(cs.backgroundImage.match(/rgba?\([^)]+\)/)?.[0])
      if (c) return c
    }
    return page
  }
  for (let y = 0; y < H; y += innerHeight) {
    scrollTo(0, y)
    await new Promise(ok => requestAnimationFrame(() => requestAnimationFrame(ok)))
    for (let i = 0; i < 24; i++) for (let j = 0; j < 15; j++) add(bg, under(document.elementFromPoint(((i + 0.5) * innerWidth) / 24, ((j + 0.5) * innerHeight) / 15)), 1)
  }
  scrollTo(0, 0)
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el), area = r.width * r.height
    if (!area || cs.visibility === 'hidden' || +cs.opacity < 0.1) continue
    if (el instanceof SVGElement) {
      if (el instanceof SVGGeometryElement) add(shapes, hex(cs.fill), 1), add(shapes, hex(cs.stroke), 1)
      continue
    }
    const chars = [...el.childNodes].reduce((n, x) => n + (x.nodeType === 3 ? x.textContent.trim().length : 0), 0)
    if (chars) add(text, hex(cs.color), chars), add(fonts, `${cs.fontFamily.split(',')[0].replace(/["']/g, '').trim()} ${cs.fontWeight}`, chars)
    const img = el.tagName === 'IMG' ? el.currentSrc : cs.backgroundImage.match(/url\("?([^")]+)"?\)/)?.[1]
    if (img && area > 40000) images.push({ src: new URL(img, location.href).href, w: Math.round(r.width), h: Math.round(r.height) })
  }
  const svgs = []
  for (const s of document.querySelectorAll('svg')) {
    const r = s.getBoundingClientRect()
    if (r.width < 8 || r.height < 8 || s.parentElement.closest('svg')) continue
    const c = s.cloneNode(true), from = [...s.querySelectorAll('*')], to = [...c.querySelectorAll('*')]
    from.forEach((e, i) => {
      if (!(e instanceof SVGGeometryElement || e.tagName === 'text')) return
      const cs = getComputedStyle(e)
      to[i].setAttribute('style', `fill:${cs.fill};stroke:${cs.stroke};stroke-width:${cs.strokeWidth};opacity:${cs.opacity}`)
    })
    // a sprite: <use> points at a symbol elsewhere in the page
    for (const u of c.querySelectorAll('use')) {
      const ref = u.getAttribute('href') ?? u.getAttribute('xlink:href'), t = ref?.startsWith('#') && document.querySelector(ref)
      if (t && !c.querySelector(ref)) c.prepend(t.cloneNode(true))
    }
    c.querySelectorAll('script').forEach(e => e.remove())
    for (const e of [c, ...c.querySelectorAll('*')]) for (const a of [...e.attributes]) if (/^on/i.test(a.name)) e.removeAttribute(a.name)
    c.removeAttribute('class')
    c.removeAttribute('style')
    c.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    if (!c.getAttribute('viewBox')) c.setAttribute('viewBox', `0 0 ${r.width} ${r.height}`)
    c.setAttribute('width', Math.round(r.width))
    c.setAttribute('height', Math.round(r.height))
    if (!svgs.some(x => x.html === c.outerHTML)) svgs.push({ html: c.outerHTML, w: Math.round(r.width), h: Math.round(r.height) })
  }
  return { title: document.title, height: H, backgrounds: share(bg), text: share(text), shapes: share(shapes), fonts: share(fonts), images: images.slice(0, 30), svgs: svgs.slice(0, 80) }
}

// a site's look, seen rather than read: one screenshot per screen, the colors it paints (backgrounds by area, text by
// characters, SVG shapes by count), its fonts, and its inline SVGs as files plus svgs.jpg to see them. Into .style/site/
// (the style's brand), or the project's assets/site/ with -p
async function site(url) {
  if (!/^(https?|file):\/\//.test(url ?? '')) die('usage: site <url> [-p <slug>]')
  const dir = opt.project ? path.join(projectDir(), 'assets/site') : path.join(HOME, '.style/site')
  if (opt.project) step(projectDir(), `Looking at ${new URL(url).hostname || 'the site'}`)
  needChrome()
  const { chromium } = await playwright()
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(url, { waitUntil: 'load', timeout: 60000 })
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    // a cookie banner hides the first screen
    await page.evaluate(() => [...document.querySelectorAll('button, a, [role=button]')]
      .find(b => /^(tout accepter|accepter( tout)?|accept( all)?|j'accepte|i agree|agree|ok|got it)$/i.test(b.textContent.trim().replace(/^[^\p{L}]+/u, '')))?.click())
    // one scroll down the page: lazy images load and scroll animations play
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += 450) scrollTo(0, y), await new Promise(ok => setTimeout(ok, 150))
      scrollTo(0, 0)
    })
    await page.waitForTimeout(800)
    const seen = await page.evaluate(seeLook)
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    const screens = [], end = Math.min(seen.height, 900 * 12)
    for (let y = 0; y < end; y += 900) {
      screens.push(`screen-${String(screens.length + 1).padStart(2, '0')}.jpg`)
      await page.screenshot({ path: path.join(dir, screens.at(-1)), type: 'jpeg', quality: 80, fullPage: true, clip: { x: 0, y, width: 1440, height: Math.min(900, end - y) } })
    }
    const svgs = seen.svgs.map((s, i) => {
      const file = `svg-${String(i + 1).padStart(2, '0')}.svg`
      fs.writeFileSync(path.join(dir, file), s.html)
      return { file, w: s.w, h: s.h }
    })
    if (svgs.length) {
      // on grey, so white and black marks both show
      await page.setContent(`<!doctype html><style>body{margin:0;padding:8px;display:flex;flex-wrap:wrap;gap:8px;font:600 12px sans-serif}
        div{position:relative;width:168px;height:128px;background:#808080}div:nth-child(even){background:#9a9a9a}
        svg{position:absolute;left:14px;top:12px;width:140px;height:92px}b{position:absolute;left:5px;bottom:3px;color:#fff}</style>
        ${seen.svgs.map((s, i) => `<div>${s.html}<b>${String(i + 1).padStart(2, '0')}</b></div>`).join('')}`)
      await page.screenshot({ path: path.join(dir, 'svgs.jpg'), type: 'jpeg', quality: 85, fullPage: true })
    }
    const { title, backgrounds, text, shapes, fonts, images } = seen
    writeJson(path.join(dir, 'site.json'), { url, title, screens, backgrounds, text, shapes, fonts, images, svgs })
    const top = l => l.slice(0, 8).map(([k, v]) => `${k} ${v}%`).join(' · ') || '-'
    console.log(`site: ${dir}\n${title}\nscreens: ${screens.length} (${screens[0]}…), svgs: ${svgs.length}${svgs.length ? ' (svgs.jpg, svg-01.svg…)' : ''}`)
    console.log(`backgrounds: ${top(backgrounds)}\ntext: ${top(text)}\nshapes: ${top(shapes)}\nfonts: ${top(fonts)}`)
    console.log('Read the screenshots and svgs.jpg: the look is in them, these numbers only rank its colors.')
  } finally {
    await browser.close()
  }
}

// the tools the engine needs, with the command that installs a missing one; the projects folder and its style
function doctor() {
  // found on the PATH: it starts (its exit code does not matter)
  const has = bin => !spawnSync(bin, ['-version'], { stdio: 'ignore' }).error
  const checks = [
    ['node 22 or later', +process.versions.node.split('.')[0] >= 22, byOs('brew install node', 'https://nodejs.org/en/download', 'winget install OpenJS.NodeJS.LTS')],
    ['ffmpeg and ffprobe', has('ffmpeg') && has('ffprobe'), byOs('brew install ffmpeg', 'sudo apt install ffmpeg', 'winget install Gyan.FFmpeg')],
    ['Google Chrome', hasChrome(), CHROME_FIX],
    ['uv and uvx', has('uv') && has('uvx'), byOs('brew install uv', 'curl -LsSf https://astral.sh/uv/install.sh | sh', 'winget install astral-sh.uv')],
  ]
  for (const [name, ok, fix] of checks) console.log(`${ok ? 'ok     ' : 'MISSING'} ${name}${ok ? '' : `: ${fix}`}`)
  if (process.platform !== 'darwin' || process.arch !== 'arm64') console.log('note: Whisper transcribes on the CPU here (faster-whisper), slower than on Apple Silicon; Scribe v2 (ElevenLabs) is faster')
  console.log(process.env.ELEVENLABS_API_KEY ? 'elevenlabs: key set (Scribe v2 transcript, voice-over, music, sound effects)' : 'elevenlabs: no key (Whisper transcript, no voice-over, the kit makes the sound); the plugin\'s secret: /plugin configure skill-video@pabrisson')
  console.log(`projects: ${HOME}`)
  // in a git repository: nothing of what makes the videos ignored
  const ignored = spawnSync('git', ['-C', HOME, 'check-ignore', '--no-index', ...KEPT], { encoding: 'utf8' })
  if (ignored.status === 0) console.log(`warning: git ignores ${ignored.stdout.trim().split('\n').join(', ')} here: the rushes, music and effects must stay versioned, fix ${path.join(HOME, '.gitignore')}`)
  const own = soundsIn(LIBRARY).filter(k => !CATALOG[k]).length
  console.log(`sound library: ${Object.keys(CATALOG).filter(k => takesIn(LIBRARY, k).length).length} of the catalog's ${Object.keys(CATALOG).length} effects${own ? ` and ${own} of its own` : ''} in ${LIBRARY} (video.mjs sounds)`)
  console.log(fs.existsSync(path.join(HOME, '.style/style.json')) ? `style: ${path.join(HOME, '.style/STYLE.md')}` : 'style: none yet, run the setup interview')
  if (checks.some(c => !c[1])) process.exit(1)
}

// rules [list] | show [<pack>] | use <pack|none> | set <key>=<value>…: the packs, and the project's one with its overrides
function rules(sub, ...rest) {
  const all = packs(), [arg] = rest
  if (!sub || sub === 'list') {
    const dir = projectDir(false), active = dir && readJson(path.join(dir, 'source/rules.json')).active
    for (const pk of Object.values(all)) console.log(`${active ? (active.includes(pk.name) ? '● ' : '○ ') : ''}${pk.name}: ${pk.description ?? ''} [${pk.origin}${pk.extends ? `, extends ${pk.extends}` : ''}] ${pk.file}${pk.errors.length ? `\n  broken, init and rules use refuse it: ${pk.errors.join('; ')}` : ''}`)
    if (active) console.log(`\nactive on ${path.basename(dir)}: ${active.join(', ') || 'none'}`)
  } else if (sub === 'show') {
    // the pack's text with the lines of the packs it extends, and on a project the params it follows
    const r = arg ? null : readJson(path.join(projectDir(), 'source/rules.json')), name = arg ?? r.active[0], pk = all[name]
    if (name && !pk) die(`unknown rules pack: ${name}`)
    console.log(pk ? `pack: ${pk.name} [${pk.origin}] ${pk.file}` : 'pack: none')
    console.log(`params: ${JSON.stringify(r ? effective(r, () => {}) : pk.params)}`)
    if (Object.keys(r?.overrides ?? {}).length) console.log(`overrides of the project: ${JSON.stringify(r.overrides)}`)
    if (pk) console.log(`\n${pk.body.trim()}`)
  } else if (sub === 'use' && arg) {
    const dir = projectDir(), file = path.join(dir, 'source/rules.json'), active = onePack(arg)
    let params
    try { params = mergeParams(all, active[0]) } catch (e) { die(e.message) }
    writeJson(file, { active, params, overrides: readJson(file).overrides ?? {} })
    console.log(`rules: ${active.join(', ') || 'none'}. ${readJson(path.join(dir, 'source/project.json')).source ? 'Now run prepare, then rough' : 'Now update the scene, then stills'}`)
  } else if (sub === 'set' && rest.length && rest.every(x => /^\w+=/.test(x))) {
    // the project's overrides, over its pack's params: the value is JSON when it parses, else text
    const dir = projectDir(), file = path.join(dir, 'source/rules.json'), r = readJson(file)
    r.overrides ??= {}
    for (const x of rest) {
      const [k, ...v] = x.split('=')
      try { r.overrides[k] = JSON.parse(v.join('=')) } catch { r.overrides[k] = v.join('=') }
      if (!PARAMS[k] && !(k in r.params)) console.log(`note: ${k} is neither a param of the engine nor of the pack: only Claude reads it`)
    }
    const errors = paramErrors(r.overrides)
    if (errors.length) die(`rules set: ${errors.join('; ')}`)
    writeJson(file, r)
    console.log(`overrides of the project: ${JSON.stringify(r.overrides)}\nparams: ${JSON.stringify(effective(r))}`)
    if (rest.some(x => /^(transcribe|face_framing|speed|breaths)=/.test(x)) && readJson(path.join(dir, 'source/project.json')).source) console.log('Now run prepare, then rough')
  } else die('usage: rules [list] | rules show [<pack>] | rules use <pack|none> | rules set <key>=<value>…')
}

// the active pack's numbers measured on the edit (rules-format.md), after stills: they save the scene's parts. Then,
// whatever the pack, the layout of every format sampled 4 times a second in the page
async function check() {
  const dir = projectDir(), f = rel => path.join(dir, rel), p = readyToDraw(dir)
  const j = job(dir, p.formats[0], ''), tl = makeTimeline(j.timeline), saved = fs.statSync(f('.cache/parts.json'), { throwIfNoEntry: false })
  if (!saved || saved.mtimeMs < fs.statSync(f('source/scene.js')).mtimeMs) die('run stills first: they save the parts of the current scene')
  step(dir, 'Checking the edit')
  const words = fs.existsSync(f('assets/words.json')) ? readJson(f('assets/words.json')) : []
  const found = checkEdit(j.params, {
    duration: j.duration, cuts: loadEdit(dir).cut ?? [], joins: (j.timeline?.segments ?? []).slice(1).map(([a]) => tl.toVideo(a)),
    words: p.source ? words.filter(w => !w.screen) : [], screen: words.filter(w => w.screen).map(w => ({ w: w.w, v0: tl.toVideo(w.t0), v1: tl.toVideo(w.t1) })),
    parts: readJson(f('.cache/parts.json')), scene: fs.readFileSync(f('source/scene.js'), 'utf8'),
    beats: fs.existsSync(f('files/beats.json')) ? readJson(f('files/beats.json')).beats : null, fps: p.fps,
  })
  found.push(...(await withChrome(p.slug, p.formats.length, (pages, base) => Promise.all(p.formats.map(async (fmt, i) => {
    await openPage(pages[i], `${base}render?format=${encodeURIComponent(fmt)}&type=`, job(dir, fmt, ''))
    return checkLayout(await pages[i].evaluate(step => window.sampleLayout(step), 0.25), 0.25, fmt)
  })))).flat())
  // every cue is heard: its sound in the library (or the video's) when sound.py plays it, or a kind sound.py names
  const code = fs.existsSync(f('source/sound.py')) ? fs.readFileSync(f('source/sound.py'), 'utf8') : null
  if (code && fs.existsSync(f('.cache/cues.json'))) {
    const silent = [...new Set(readJson(f('.cache/cues.json')).map(c => c.kind))].filter(k => !named(code, k) && !(/\bplay\(/.test(code) && effectSource(dir, k)))
    found.push([!silent.length, silent.length ? `no sound for the cues ${silent.join(', ')}: video.mjs sounds -p ${p.slug} says how to make them` : 'every cue has its sound'])
  }
  for (const [ok, msg] of found) console.log(`${ok ? '✓' : '✗'} ${msg}`)
  const failed = found.filter(([ok]) => !ok).length, active = readJson(f('source/rules.json')).active
  console.log(found.length ? `${failed ? `${failed} to fix` : 'nothing to fix'} (rules: ${active.join(', ') || 'none'}). The stills show the rest` : 'nothing to measure for this pack: the stills show the rest')
  if (failed) process.exit(1)
}

const commands = {
  doctor, probe: () => probeSource(args[0]), site: () => site(args[0]), init: () => init(args[0]), prepare, rough, stills, render, audio, final, studio, preview, codecs,
  style: () => style(...args), serve, rules: () => rules(...args), check, sync: () => syncMedia(args[0]), beats: () => beatGrid(args[0]), thumbnail,
  fix: () => fixWord(args[0], args[1]), status: () => status(...args), voice: voiceOver, voices: () => voices(args[0]),
  elevenlabs: () => elevenlabs(...args), credits: () => credits(...args),
  music: () => music(args[0]), sfx: () => sfx(...args), sounds,
}
if (!commands[cmd]) die(`usage: video.mjs <${Object.keys(commands).join(' | ')}> [--project <slug>]`)
await commands[cmd]()
