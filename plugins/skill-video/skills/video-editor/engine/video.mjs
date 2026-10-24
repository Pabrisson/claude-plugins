#!/usr/bin/env node
// video-editor CLI. Every time read or written here is in SOURCE seconds (identical to video seconds without a source).
// Project commands work on the current directory, or on --project <slug|path>.
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { shownTexts } from './lib/actors.js'
import { effective, listPacks, mergeParams } from './lib/rules.js'
import { FORMATS, STYLE, logical, styleOf } from './lib/runtime.js'
import { keepSegments, makeTimeline } from './lib/timeline.js'

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
const WHISPER = 'mlx-community/whisper-large-v3-turbo'
const PORT = +(process.env.VIDEO_EDITOR_PORT || 41187)
// the review studio, built from plugins-src/skill-video/studio and served as is
const STUDIO = path.join(ENGINE, 'studio/dist')
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
  '.wav': 'audio/wav', '.wasm': 'application/wasm',
}
const REVIEW_ABOUT = 'Review studio feedback on ONE version of the video (video field). type: comment or cut. t0/t1: VIDEO seconds of that version; s0/s1: SOURCE seconds (absent without a source). words: what is said, or shown, in the range; from: "transcript" when the comment was made on a selection of the transcript. images: attached frames or pictures, with their size and ratio. visuals: what the comment is about in the picture, a part() of the scene ({kind, t0, t1, …data}, VIDEO seconds) or every part of a kind ({kind}). sounds: what the comment is about in the sound, a whole track (voice, music, fx) or a cue of the scene ({kind, t, …data}, t in VIDEO seconds). format: the format it was made on. Claude answers each comment in reply and sets resolved: true.'

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
    source: { type: 'string' },
    rules: { type: 'string' },
    fps: { type: 'string' },
    codec: { type: 'string' },
    format: { type: 'string' },
    type: { type: 'string' },
    workers: { type: 'string' },
    variants: { type: 'string' },
    at: { type: 'string' },
    blur: { type: 'string' },
    force: { type: 'boolean' },
    open: { type: 'boolean' },
  },
})

const die = msg => { console.error(`error: ${msg}`); process.exit(1) }
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

const packs = () => listPacks([['plugin', path.join(ENGINE, '../rules')], ['perso', path.join(HOME, '.rules')]])

// engine/renders.json, then the projects folder's .renders.json field by field
function renders() {
  const base = readJson(path.join(ENGINE, 'renders.json')), own = path.join(HOME, '.renders.json')
  const mine = fs.existsSync(own) ? readJson(own) : {}
  return Object.fromEntries(Object.keys({ ...base, ...mine }).map(k => [k, { ...base[k], ...mine[k] }]))
}

// a render is a resolution (renders.json: 1080p…), named after its short side
function renderShort(type) {
  const t = renders()[type]
  if (!t) throw new Error(`unknown resolution ${type}`)
  return t.short
}

function encoderFor(p, type, [w, h]) {
  // video_kbps: YouTube's recommended upload bitrates, [≤ 30 fps, > 30 fps]
  const family = p.codec ?? 'h264', c = CODECS[family], v = renders()[type].video_kbps, kbps = Array.isArray(v) ? v[p.fps > 30 ? 1 : 0] : v
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

function fetchSource(src, dest) {
  if (/^https?:\/\//.test(src)) return run('uvx', ['yt-dlp', '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4', '-o', dest.replace(/\.mp4$/, '.%(ext)s'), src])
  if (/\.mp4$/i.test(src)) return fs.copyFileSync(src, dest, fs.constants.COPYFILE_FICLONE)
  const io = ['-y', '-v', 'error', '-i', src, '-map', '0:v:0', '-map', '0:a:0?']
  try { run('ffmpeg', [...io, '-c', 'copy', dest]) }
  catch { run('ffmpeg', [...io, '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '320k', dest]) }
}

function centerCrop({ width: w, height: h }, r) {
  const cw = even(Math.min(w, h * r)), ch = even(Math.min(h, w / r))
  return [even((w - cw) / 2), even((h - ch) / 2), cw, ch]
}

// source/edit.json: the data the engine reads besides the scene (duration without a source, cut, poster, media, music)
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

// Silent stretches (≥ 120 ms) in 10 ms windows: quieter than 35 dB under the speech level, yet 10 dB over
// the noise floor. null when there is no speech-like contrast (silence, steady noise).
// ponytail: fixed dB knobs tuned on clean voice, expose them in the pack's params if real rooms need it
function silences(pcm) {
  const win = RATE / 100, db = []
  for (let i = 0; i + win <= pcm.length; i += win) {
    let s = 0
    for (let j = i; j < i + win; j++) s += pcm[j] * pcm[j]
    db.push(10 * Math.log10(s / win / 32768 ** 2 + 1e-12))
  }
  const sorted = db.toSorted((a, b) => a - b)
  const floor = sorted[Math.floor(sorted.length * 0.1)], loud = sorted[Math.floor(sorted.length * 0.95)]
  if (!db.length || loud - floor < 20) return null
  const thr = Math.max(floor + 10, loud - 35), found = []
  let start = -1
  for (let i = 0; i <= db.length; i++) {
    const quiet = i < db.length && db[i] < thr
    if (quiet && start < 0) start = i
    if (!quiet && start >= 0) { if (i - start >= 12) found.push([start / 100, i / 100]); start = -1 }
  }
  return found
}

function transcribe(wav, lang, cache) {
  console.log(`transcribing with mlx-whisper ${WHISPER} (the first run downloads the model, ~1.6 GB)…`)
  fs.mkdirSync(cache, { recursive: true })
  run('uvx', ['--from', 'mlx-whisper', 'mlx_whisper', wav, '--model', WHISPER, '--language', lang,
    '--word-timestamps', 'True', '--condition-on-previous-text', 'False', '--hallucination-silence-threshold', '2',
    '--output-format', 'json', '--output-dir', cache, '--output-name', 'whisper', '--verbose', 'False'])
  const words = []
  for (const w of readJson(path.join(cache, 'whisper.json')).segments.flatMap(s => s.words ?? [])) {
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
// declares with say(), else the readable texts sampled 4 times a second, plus the actors' texts. Rewritten by stills
// and render, so the studio and the Copy prompt follow.
async function screenTranscript(dir, page, base, j) {
  const f = rel => path.join(dir, rel), p = readJson(f('source/project.json')), cur = fs.existsSync(f('assets/words.json')) ? readJson(f('assets/words.json')) : []
  if (!j.params.transcribe || cur.some(w => !w.screen)) return
  const tl = makeTimeline(j.timeline)
  await openPage(page, `${base}render?format=${encodeURIComponent(j.format)}&type=`, j)
  let lines = (await page.evaluate(() => window.says())).map(x => [x.v0, x.v1, x.w])
  if (!lines.length) {
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
  const end = p.source?.duration ?? j.duration
  // the end of a line just before a cut is the cut's start, not its end (both are the same video instant)
  const words = lines.map(([a, b, w]) => ({ w, t0: ms(tl.toSource(a)), t1: ms(tl.toSource(Math.min(b, j.duration) - 0.001) + 0.001), screen: true }))
    .concat((j.actors ?? []).flatMap(a => shownTexts(a, j.style.creator, num).map(w => ({ w, t0: a.from ?? 0, t1: a.to ?? end, screen: true }))))
    .sort((a, b) => a.t0 - b.t0)
  writeJson(f('assets/words.json'), words)
  fs.writeFileSync(f('files/words.md'), `# Transcript: ${p.slug}\n\nNo speech: what the video shows, moment by moment (SOURCE seconds).\n\n` +
    words.map(w => `- **${clock(w.t0)} → ${clock(w.t1)}** ${w.w}`).join('\n') + '\n')
}

// voice.wav: the kept segments joined with 8 ms fades (no click at the joins), then sped up by atempo.
// Each segment keeps its exact length, padded with silence where the audio track ends before the picture.
function buildVoice(dir, tl) {
  const pcm = readWav(path.join(dir, 'assets/source.wav')), fade = RATE * 0.008
  const parts = tl.segments.map(([a, b]) => {
    const [s0, s1] = [Math.round(a * RATE), Math.round(b * RATE)], seg = new Int16Array(s1 - s0)
    seg.set(pcm.subarray(s0, s1))
    for (let i = 0; i < Math.min(fade, seg.length / 2); i++) {
      seg[i] *= i / fade
      seg[seg.length - 1 - i] *= i / fade
    }
    return Buffer.from(seg.buffer)
  })
  const file = path.join(dir, 'assets/voice.wav')
  run('ffmpeg', ['-y', '-v', 'error', '-f', 's16le', '-ar', `${RATE}`, '-ac', '1', '-i', 'pipe:0',
    ...(tl.speed !== 1 ? ['-af', `atempo=${tl.speed}`] : []), '-c:a', 'pcm_s16le', file], Buffer.concat(parts))
  return file
}

// face_framing: MediaPipe's face detector in Chrome, 5 times a second, smoothed over about a second.
// assets/frames.json: { fps, faces: [[source s, x, y of the eyes, face height]] } in source pixels; [] when no face.
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
async function detectFaces(dir, p) {
  if (!fs.existsSync(path.join(ENGINE, 'node_modules/@mediapipe/tasks-vision'))) {
    console.log('face_framing: installing @mediapipe/tasks-vision in the engine…')
    execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ENGINE, stdio: 'inherit' })
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
  const started = Date.now(), { width: w, height: h, fps } = p.source
  const need = Math.max(...p.renders.map(t => renderShort(t))), scale = Math.min(w, h) > need ? (w < h ? `,scale=${need}:-2` : `,scale=-2:${need}`) : ''
  fs.rmSync(dest, { recursive: true, force: true })
  fs.mkdirSync(dest, { recursive: true })
  run('ffmpeg', ['-y', '-v', 'error', '-i', path.join(dir, 'assets/source.mp4'), '-vf', `fps=${fps}${scale}`, '-q:v', '3', path.join(dest, '%05d.jpg')])
  console.log(`camera frames: ${fs.readdirSync(dest).length} in ${secs(started)} s`)
}

// clips of edit.json's media as JPEG frames at the project rate, kept while the clip and its cut stay the same
function extractMedia(dir, media, fps) {
  for (const [id, m] of Object.entries(media ?? {})) {
    if (!/^[\w-]+$/.test(id)) die(`media id ${id}: letters, digits, - and _ only`)
    const src = path.resolve(dir, String(m.src).replace(/^~(?=\/)/, os.homedir()))
    if (!fs.existsSync(src)) die(`media ${id}: ${src} not found`)
    const dest = path.join(dir, '.cache/media', id), metaFile = path.join(dest, 'meta.json')
    const want = { src, mtime: fs.statSync(src).mtimeMs, from: m.from ?? 0, dur: m.dur ?? null, fps, width: m.width ?? 720 }
    if (fs.existsSync(metaFile) && JSON.stringify(readJson(metaFile).want) === JSON.stringify(want)) continue
    fs.rmSync(dest, { recursive: true, force: true })
    fs.mkdirSync(dest, { recursive: true })
    run('ffmpeg', ['-y', '-v', 'error', '-ss', `${want.from}`, ...(want.dur ? ['-t', `${want.dur}`] : []), '-i', src, '-vf', `fps=${fps},scale=${want.width}:-2`, '-q:v', '4', path.join(dest, '%05d.jpg')])
    const v = probe(path.join(dest, '00001.jpg'))
    writeJson(metaFile, { want, count: fs.readdirSync(dest).filter(x => x.endsWith('.jpg')).length, fps, ar: v.width / v.height })
  }
}

function readMedia(dir) {
  const root = path.join(dir, '.cache/media')
  if (!fs.existsSync(root)) return {}
  return Object.fromEntries(fs.readdirSync(root).filter(id => fs.existsSync(path.join(root, id, 'meta.json')))
    .map(id => { const m = readJson(path.join(root, id, 'meta.json')); return [id, { count: m.count, fps: m.fps, ar: m.ar }] }))
}

// everything a page needs to draw one format: sizes, timeline, transcript, faces, style, rules, actors, encoder (when rendering)
function buildJob(dir, format, type) {
  const f = rel => path.join(dir, rel), p = readJson(f('source/project.json')), edit = loadEdit(dir)
  if (!fs.existsSync(f('source/scene.js'))) throw new Error('no source/scene.js yet (see references/scene-format.md)')
  if (!p.formats.includes(format)) throw new Error(`format ${format} is not one of this project's (${p.formats.join(', ')})`)
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
    slug: p.slug, format, formats: p.formats, primary: p.formats[0], logical: [lw, lh], primaryLogical: logical(p.formats[0], src), size, fps: p.fps, duration,
    timeline, source: src && { width: src.width, height: src.height, fps: src.fps, frames },
    words: params.transcribe && fs.existsSync(f('assets/words.json')) ? readJson(f('assets/words.json')) : [],
    faces: params.face_framing && fs.existsSync(f('assets/frames.json')) ? readJson(f('assets/frames.json')).faces : null,
    style, params, media: readMedia(dir), actors: loadActors(dir), scene: { css: fs.existsSync(css), mtime: Math.round(mtime), duration: src ? null : edit.duration },
    encoder: type ? encoderFor(p, type, size) : null,
    // motion blur: sub-frames averaged per frame (render --blur N), 1 = sharp
    blur: type ? Math.max(1, Math.min(16, Math.round(+opt.blur || 1))) : 1,
  }
}

// Chunks of ~2 s on keyframes. A scene is code, so its key covers all it can read: the engine, the job, every file of
// source/, actors/ and assets/ (names and dates; not the sound, nor edit.json and words.json, whose parts the scene
// sees are in the job). Nothing changed: the chunk is kept; anything changed: all render again.
function chunkPlan(dir, job) {
  const files = root => (fs.existsSync(root) ? fs.readdirSync(root, { recursive: true }).filter(x => !/\.wav$|^(edit|words)\.json$/.test(x)).sort().map(x => [x, fs.statSync(path.join(root, x)).mtimeMs]) : [])
  const engine = ['lib/page.js', 'lib/kit.js', 'lib/runtime.js', 'lib/actors.js', 'lib/paper.js', 'lib/timeline.js', 'page/render.html'].map(x => fs.readFileSync(path.join(ENGINE, x), 'utf8')).join()
  const global = hash(engine + JSON.stringify([job, ...['source', 'actors', 'assets'].map(x => files(path.join(dir, x)))]))
  const total = Math.round(job.duration * job.fps), size = job.encoder.gop * Math.max(1, Math.round((2 * job.fps) / job.encoder.gop)), plan = []
  for (let a = 0; a < total; a += size) plan.push({ a, b: Math.min(total, a + size), key: hash(`${global}${a}`) })
  return plan
}

async function playwright() {
  if (!fs.existsSync(path.join(ENGINE, 'node_modules/playwright-core'))) {
    console.log('first run: installing playwright-core in the engine…')
    execFileSync('npm', ['install', '--omit=optional', '--no-audit', '--no-fund'], { cwd: ENGINE, stdio: 'inherit' })
  }
  return import('playwright-core')
}

// Headless system Chrome (it has the H.264 encoder Chromium lacks) with the HTML-in-canvas API, no frame rate cap;
// one context per worker, pages served by a private server that also takes their output.
const needChrome = () => process.platform === 'darwin' && !fs.existsSync('/Applications/Google Chrome.app') && die('Google Chrome is needed in /Applications: https://www.google.com/chrome/')

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
    const pages = await Promise.all(Array.from({ length: n }, async () => {
      const page = await (await browser.newContext()).newPage()
      page.on('pageerror', e => console.error(`page: ${e.message}`))
      page.on('console', m => ['warning', 'error'].includes(m.type()) && !/Failed to load resource/.test(m.text()) && console.warn(`page: ${m.text()}`))
      return page
    }))
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
${src ? `- Video: ${src.from} (${src.width}×${src.height}, ${src.duration} s)` : '- No source video: made from scratch in motion design'}

## Chiffres clés

## État
- ${today()}: project created.

## Beats
`
}

function init(slug) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug ?? '')) die('usage: init <slug> --formats 9:16,1:1 --renders 1080p,720p [--fps 30] [--codec h264] [--source <file|url>] [--rules a,b|none]')
  if (opt.fps && !(+opt.fps > 0 && +opt.fps <= 120)) die('--fps: frames per second, e.g. 24, 25, 30, 50 or 60')
  if (opt.codec && !CODECS[opt.codec]) die(`--codec: one of ${Object.keys(CODECS).join(', ')}`)
  const dir = path.join(HOME, slug)
  if (fs.existsSync(dir)) die(`${dir} already exists`)
  const formats = list(opt.formats), types = list(opt.renders), known = renders()
  if (!formats.length || formats.some(f => !FORMATS[f] && !(f === 'source' && opt.source))) die(`--formats: one or more of ${Object.keys(FORMATS).join(', ')}, source (with --source)`)
  if (!types.length || types.some(t => !known[t])) die(`--renders: one or more of ${Object.keys(known).join(', ')}`)
  const active = opt.rules === 'none' ? [] : list(opt.rules)
  let params
  try { params = mergeParams(packs(), active) } catch (e) { die(e.message) }
  if (opt.source && !/^https?:\/\//.test(opt.source) && !fs.existsSync(opt.source)) die(`source not found: ${opt.source}`)

  for (const d of ['assets/images', 'assets/logos', 'assets/review', 'files/reviews', 'output', 'source', 'stills']) fs.mkdirSync(path.join(dir, d), { recursive: true })
  let source = null
  if (opt.source) {
    const file = path.join(dir, 'assets/source.mp4')
    try { fetchSource(opt.source, file) } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); die(`could not get the source: ${e.message}`) }
    source = { from: opt.source, ...probe(file) }
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

  console.log(`project: ${dir}`)
  console.log(`formats: ${formats.join(', ')} · renders: ${types.join(', ')} · ${ms(p.fps)} fps · ${CODECS[p.codec].label} · rules: ${active.join(', ') || 'none'}`)
  console.log(source ? `source: ${source.width}×${source.height}, ${ms(source.fps)} fps, ${source.duration} s${source.audio ? '' : ', no audio'}. Next: prepare, then rough` : 'no source: set duration in source/edit.json, write source/scene.js, then stills and render')
}

async function prepare() {
  const dir = projectDir(), f = rel => path.join(dir, rel), p = readJson(f('source/project.json'))
  if (!p.source) die('this project has no source video: nothing to prepare')
  const params = effective(readJson(f('source/rules.json')))
  const lang = readJson(f('source/style.json')).creator?.lang ?? 'fr'

  let quiet = null
  if (p.source.audio) {
    if (opt.force || !fs.existsSync(f('assets/source.wav'))) run('ffmpeg', ['-y', '-v', 'error', '-i', f('assets/source.mp4'), '-vn', '-ac', '1', '-ar', `${RATE}`, '-c:a', 'pcm_s16le', '-bitexact', '-map_metadata', '-1', f('assets/source.wav')])
    quiet = silences(readWav(f('assets/source.wav')))
  }

  let words = []
  if (!params.transcribe) for (const x of ['assets/words.json', 'files/words.md']) fs.rmSync(f(x), { force: true })
  else if (!opt.force && fs.existsSync(f('assets/words.json'))) words = readJson(f('assets/words.json')).filter(w => !w.screen)
  else {
    if (quiet) words = transcribe(f('assets/source.wav'), lang, f('.cache'))
    writeJson(f('assets/words.json'), words)
    fs.writeFileSync(f('files/words.md'), wordsMd(words, p.slug))
  }

  const { duration, fps } = p.source
  const segments = params.breaths && quiet && words.length ? keepSegments(quiet, words, params.breaths, duration) : [[0, duration]]
  writeJson(f('assets/timeline.json'), { fps, speed: params.speed, segments })
  const tl = makeTimeline(readJson(f('assets/timeline.json')), loadEdit(dir).cut)
  extractFrames(dir, p)

  if (params.face_framing) {
    if (opt.force || !fs.existsSync(f('assets/frames.json'))) await detectFaces(dir, p)
  } else fs.rmSync(f('assets/frames.json'), { force: true })
  console.log(`transcript: ${!params.transcribe ? 'off (rules)' : words.length ? `${words.length} words → files/words.md` : 'no speech found'}`)
  console.log(`timeline: ${tl.segments.length} segment(s), ${duration} s → ${ms(tl.duration)} s (speed ×${tl.speed}). Next: rough`)
}

function rough() {
  const dir = projectDir(), f = rel => path.join(dir, rel), p = readJson(f('source/project.json'))
  if (!p.source) die('rough needs a source video')
  if (!fs.existsSync(f('assets/timeline.json'))) die('run prepare first')
  const started = Date.now()
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
  console.log(`rough cut v${v}: ${file} (${p.formats[0]}, ${ms(p.fps)} fps, ${clock(tl.duration)}, built in ${secs(started)} s)`)
}

// what a page needs before drawing: the scene, and the clips as frames
function readyToDraw(dir) {
  const p = readJson(path.join(dir, 'source/project.json'))
  if (!fs.existsSync(path.join(dir, 'source/scene.js'))) die('write source/scene.js first (see references/scene-format.md)')
  extractMedia(dir, loadEdit(dir).media, p.fps)
  return p
}

const job = (dir, format, type) => {
  try { return buildJob(dir, format, type) } catch (e) { die(e.message) }
}

// the scene's sound cues (video seconds), the same in every format, for sound.py. The file only changes with them,
// so the mix is not rebuilt for nothing. Its parts (the studio's Clip tab) go next to them
async function saveCues(dir, page) {
  const file = path.join(dir, '.cache/cues.json'), cues = await page.evaluate(() => window.cues())
  fs.mkdirSync(path.dirname(file), { recursive: true })
  if (!fs.existsSync(file) || JSON.stringify(cues) !== JSON.stringify(readJson(file))) writeJson(file, cues)
  writeJson(path.join(dir, '.cache/parts.json'), await page.evaluate(() => window.parts()))
}

async function stills() {
  const dir = projectDir(), p = readyToDraw(dir), started = Date.now()
  const formats = opt.format ? pick(opt.format, p.formats, 'format') : [p.formats[0]]
  const given = args.map(Number), n = +(opt.variants ?? 0)
  if (given.some(t => !(t >= 0)) || (opt.variants && !(n >= 2 && given.length === 1))) die('usage: stills [source seconds…] [--format f|all] | stills <source seconds> --variants N')
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
  const formats = pick(opt.format, p.formats, 'format'), types = pick(opt.type, p.renders, 'type'), n = workers(), started = Date.now()
  fs.mkdirSync(f('.cache/render'), { recursive: true })
  await withChrome(p.slug, n, async (pages, base) => {
    await screenTranscript(dir, pages[0], base, job(dir, p.formats[0], ''))
    for (const fmt of formats) for (const type of types) {
      const t0 = Date.now(), j = job(dir, fmt, type), c = CODECS[j.encoder.family], prefix = `${ratio(fmt)}-${type}-`
      const plan = chunkPlan(dir, j), name = x => `.cache/render/${prefix}${String(x.a).padStart(6, '0')}-${x.key.slice(0, 16)}.${c.ext}`
      const todo = plan.filter(x => !fs.existsSync(f(name(x)))), count = todo.length, hw = new Set()
      const url = `${base}render?format=${encodeURIComponent(fmt)}&type=${type}`
      await Promise.all(pages.slice(0, Math.min(n, todo.length)).map(async page => {
        await openPage(page, url, j)
        for (let x; (x = todo.shift());) hw.add(await page.evaluate(([a, b, file]) => window.renderChunk(a, b, file), [x.a, x.b, name(x)]))
      }))
      // cached chunks mean the same scene, so the same cues
      if (!fs.existsSync(f('.cache/parts.json')) || (count && fmt === p.formats[0])) {
        if (!count) await openPage(pages[0], url, j)
        await saveCues(dir, pages[0])
      }
      // chunks of older edits go; the others join into one stream, then one MP4
      const keep = new Set(plan.map(x => path.basename(name(x))))
      for (const x of fs.readdirSync(f('.cache/render'))) if (x.startsWith(prefix) && !keep.has(x)) fs.rmSync(f(`.cache/render/${x}`))
      const stream = f(`.cache/render/${p.slug}-${ratio(fmt)}-${type}.${c.ext}`), parts = plan.map(x => fs.readFileSync(f(name(x))))
      if (c.ext === 'ivf') {
        const head = Buffer.alloc(32)
        head.write('DKIF', 0)
        head.writeUInt16LE(32, 6)
        head.write(j.encoder.family === 'av1' ? 'AV01' : 'VP90', 8)
        head.writeUInt16LE(j.size[0], 12)
        head.writeUInt16LE(j.size[1], 14)
        head.writeUInt32LE(Math.round(j.fps * 1000), 16)
        head.writeUInt32LE(1000, 20)
        head.writeUInt32LE(plan.at(-1).b, 24)
        parts.unshift(head)
      }
      fs.writeFileSync(stream, Buffer.concat(parts))
      // a raw stream has no timestamps: -r on the input sets them (Chrome's own stream timing is not usable)
      run('ffmpeg', ['-y', '-v', 'error', ...(c.input ? [...c.input, '-r', `${j.fps}`] : []), '-i', stream, '-c', 'copy', ...(c.tag ?? []), '-movflags', '+faststart', f(`.cache/render/${p.slug}-${ratio(fmt)}-${type}.mp4`)])
      fs.rmSync(stream)
      const frames = plan.at(-1).b, took = (Date.now() - t0) / 1000
      console.log(`${fmt} ${type}: ${j.size.join('×')} ${c.label} ${[...hw].join('/') || 'cached'}${j.blur > 1 ? `, motion blur ×${j.blur}` : ''}, ${frames} frames, ${count}/${plan.length} chunks rendered in ${took.toFixed(1)} s` + (count ? ` (${Math.round((frames * count) / plan.length / took)} fps, ${Math.min(n, count)} workers)` : ''))
    }
  })
  console.log(`render done in ${secs(started)} s. Next: final`)
}

// assets/mix.wav: the edited voice, the music of edit.json and the scene's cues (.cache/cues.json, from render), mixed
// by audio.py (uv runs it with numpy). Rebuilt when one of its inputs changed; null when there is nothing to hear.
function mix(dir, force) {
  const f = rel => path.resolve(dir, rel), file = f('assets/mix.wav')
  const inputs = ['source/sound.py', 'source/edit.json', 'source/style.json', 'assets/timeline.json', 'assets/source.wav', '.cache/cues.json', path.join(ENGINE, 'audio.py')]
  if (!force && fs.existsSync(file) && fs.existsSync(f('assets/mix.json')) && fs.statSync(file).mtimeMs >= Math.max(...inputs.map(x => fs.statSync(f(x), { throwIfNoEntry: false })?.mtimeMs ?? 0))) return file
  const plan = audioPlan(dir)
  if (!plan.voice && !plan.sound) return fs.rmSync(file, { force: true }), null
  writeJson(f('.cache/audio-plan.json'), plan)
  run('uv', ['run', '--quiet', path.join(ENGINE, 'audio.py'), f('.cache/audio-plan.json')])
  return file
}

// what audio.py mixes, every time in video seconds: the voice, source/sound.py (written for the video), the scene's
// cues and the spoken words for it to follow
function audioPlan(dir) {
  const f = rel => path.join(dir, rel), p = readJson(f('source/project.json')), j = job(dir, p.formats[0], ''), tl = makeTimeline(j.timeline), s = j.style.sound, segs = j.timeline?.segments
  const words = j.words.filter(w => !w.screen && (!segs || segs.some(([a, b]) => w.t1 > a && w.t0 < b))).map(w => ({ w: w.w, v0: ms(tl.toVideo(w.t0)), v1: ms(tl.toVideo(w.t1)) }))
  return {
    duration: j.duration, voice: p.source?.audio ? buildVoice(dir, tl) : null,
    sound: fs.existsSync(f('source/sound.py')) ? f('source/sound.py') : null, variant: 0,
    cues: fs.existsSync(f('.cache/cues.json')) ? readJson(f('.cache/cues.json')) : [], words,
    levels: { music: s.music, sfx: s.sfx, duck: s.duck }, out: f('assets/mix.wav'),
  }
}

// audio, or sound variations: --at <source s> --variants N renders 8 s of the mix with sound.py's v.variant at 1…N
// into stills/sound/<n>.wav
function audio() {
  const dir = projectDir(), started = Date.now(), n = +(opt.variants ?? 0)
  if (!opt.variants) {
    const file = mix(dir, true)
    return console.log(file ? `audio done in ${secs(started)} s. Next: final` : 'no voice and no source/sound.py: the video stays silent')
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

// each render with its sound (mix.wav, rebuilt when stale), posters, then a new version
function final() {
  const dir = projectDir(), f = rel => path.join(dir, rel), p = readJson(f('source/project.json')), edit = loadEdit(dir)
  const j = job(dir, p.formats[0], ''), tl = makeTimeline(j.timeline), started = Date.now()
  const audio = mix(dir)
  // AAC once per bitrate (Apple's encoder when ffmpeg has it: ten times faster), then every file is a copy
  const aac = out('ffmpeg', ['-hide_banner', '-encoders']).includes(' aac_at ') ? 'aac_at' : 'aac', tracks = {}
  const track = kbps => (tracks[kbps] ??= (run('ffmpeg', ['-y', '-v', 'error', '-i', audio, '-c:a', aac, '-b:a', `${kbps}k`, '-ar', '48000', '-ac', '2', f(`.cache/audio-${kbps}.m4a`)]), f(`.cache/audio-${kbps}.m4a`)))
  const files = {}, made = []
  for (const fmt of p.formats) for (const type of p.renders) {
    const video = f(`.cache/render/${p.slug}-${ratio(fmt)}-${type}.mp4`)
    if (!fs.existsSync(video)) die(`no render for ${fmt} ${type}: run render first`)
    if (fs.statSync(video).mtimeMs < fs.statSync(f('source/scene.js')).mtimeMs) console.warn(`warning: ${fmt} ${type} was rendered before the last change of scene.js`)
    const file = f(`output/${p.slug}-${ratio(fmt)}-${type}.mp4`)
    run('ffmpeg', ['-y', '-v', 'error', '-i', video, ...(audio ? ['-i', track(renders()[type].audio_kbps), '-map', '0:v', '-map', '1:a', '-shortest'] : ['-an']),
      '-c', 'copy', '-movflags', '+faststart', file])
    files[fmt] ??= path.basename(file)
    made.push(file)
  }
  const at = edit.poster != null ? tl.toVideo(edit.poster) : Math.min(1.5, j.duration / 2)
  for (const fmt of p.formats) {
    const poster = f(`output/${p.slug}-${ratio(fmt)}-poster.jpg`)
    run('ffmpeg', ['-y', '-v', 'error', '-ss', `${at}`, '-i', f(`output/${files[fmt]}`), '-frames:v', '1', '-q:v', '2', poster])
    made.push(poster)
  }
  const v = addVersion(dir, p, { duration: ms(j.duration), files, timeline: j.timeline })
  // what the studio's sound panel shows of this version: the cues and each track's level (audio.py's mix.json)
  if (audio) {
    fs.mkdirSync(f('files/sound'), { recursive: true })
    fs.writeFileSync(f(`files/sound/v${v}.json`), JSON.stringify({ cues: fs.existsSync(f('.cache/cues.json')) ? readJson(f('.cache/cues.json')) : [], ...readJson(f('assets/mix.json')) }))
  }
  // and its Clip tab: the scene's parts, the takes kept from the source, and per format a strip of thumbnails
  // (one every `every` s, `cols` per row of the sheet)
  const every = Math.max(0.5, j.duration / 400), count = Math.ceil(j.duration / every), cols = 10, strips = {}
  fs.mkdirSync(f('files/video'), { recursive: true })
  for (const fmt of p.formats) {
    const [a, b] = fmt.split(':').map(Number), w = 2 * Math.round((72 * a) / b), file = `files/video/v${v}-${ratio(fmt)}.jpg`
    run('ffmpeg', ['-y', '-v', 'error', '-i', f(`output/${files[fmt]}`), '-vf', `fps=1/${every},scale=${w}:144,tile=${cols}x${Math.ceil(count / cols)}`, '-frames:v', '1', '-q:v', '5', f(file)])
    strips[fmt] = { file, every, count, cols, w, h: 144 }
  }
  const takes = p.source ? (j.timeline?.segments ?? [[0, j.duration]]).map(([a, b], i) => ({ kind: 'take', t0: ms(tl.toVideo(a)), t1: ms(tl.toVideo(b - 0.001)), name: `take ${i + 1}`, source: [a, b] })) : []
  const parts = fs.existsSync(f('.cache/parts.json')) ? readJson(f('.cache/parts.json')) : []
  fs.writeFileSync(f(`files/video/v${v}.json`), JSON.stringify({ parts: [...takes, ...parts], strips }))
  console.log(made.join('\n'))
  console.log(`final v${v} in ${secs(started)} s (${audio ? path.basename(audio) : 'no audio'}). Reload the studio`)
}

// every reviewable render is a new version, with its own feedback file (files/reviews/vN.json);
// its timeline is kept so the studio maps that version's times back to the source
function addVersion(dir, p, version) {
  const v = (p.versions?.length ?? 0) + 1
  p.versions = [...(p.versions ?? []), { v, rendered: new Date().toISOString(), ...version }]
  writeJson(path.join(dir, 'source/project.json'), p)
  return v
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
  return {
    slug: p.slug,
    dir,
    formats: p.formats,
    fps: p.fps,
    source: !!p.source,
    rules: rules.active,
    // null: no transcript (turned off by a pack, or not made yet)
    words: effective(rules, () => {}).transcribe && fs.existsSync(f('assets/words.json')) ? readJson(f('assets/words.json')) : null,
    versions: (p.versions ?? []).map(v => ({ ...v, files: Object.fromEntries(Object.entries(v.files).map(([k, file]) => [k, video(file)])) })),
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
  // the other videos of the folder, for the studio's switcher
  if (sub === 'api/projects') {
    return reply(res, 200, videos().map(x => {
      const p = readJson(path.join(HOME, x, 'source/project.json')), last = p.versions?.at(-1)
      const poster = `${x}-${ratio(p.formats[0])}-poster.jpg`
      return { slug: x, versions: p.versions?.length ?? 0, rendered: last?.rendered ?? null, duration: last?.duration ?? null, poster: fs.existsSync(path.join(HOME, x, 'output', poster)) ? poster : null }
    }))
  }
  if (sub === 'api/job') {
    try { return reply(res, 200, buildJob(dir, url.searchParams.get('format'), url.searchParams.get('type') ?? '')) } catch (e) { return reply(res, 400, { error: e.message }) }
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

// the studio server in the background: reused when it runs this very engine (same file, same version) for this projects folder
async function ensureServer() {
  const base = `http://127.0.0.1:${PORT}/`, sleep = t => new Promise(ok => setTimeout(ok, t))
  const ping = () => fetch(base + '__video-editor').then(r => r.json()).catch(() => null)
  let live = await ping()
  if (live && (live.engine !== ENGINE || live.home !== HOME || live.mtime !== LOADED)) {
    await fetch(base + '__video-editor/quit', { method: 'POST' }).catch(() => {})
    await sleep(300)
    live = null
  }
  if (!live) {
    fs.mkdirSync(HOME, { recursive: true })
    const log = fs.openSync(path.join(HOME, '.studio.log'), 'a')
    spawn(process.execPath, [SELF, 'serve'], { cwd: HOME, env: { ...process.env, VIDEO_EDITOR_DIR: HOME }, detached: true, stdio: ['ignore', log, log] }).unref()
    for (let i = 0; i < 50 && !(live = await ping()); i++) await sleep(100)
    if (!live) die(`the studio server did not start, see ${path.join(HOME, '.studio.log')}`)
  }
  return base
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
  if (opt.open) run('open', [url])
}

// the live debug page in a visible Chrome: the same scene, no encoding, R reloads it
async function preview() {
  const dir = servedProject(), p = readyToDraw(dir), format = opt.format ?? p.formats[0]
  pick(format, p.formats, 'format')
  job(dir, format, '')
  const url = `${await ensureServer()}${p.slug}/preview?format=${encodeURIComponent(format)}`
  if (process.platform === 'darwin') run('open', ['-a', 'Google Chrome', url])
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

// style [show] | style set a.b=value … | style note "text": the value is JSON when it parses (numbers, arrays), else text
function style(sub, ...rest) {
  const dir = path.join(HOME, '.style'), file = path.join(dir, 'style.json'), s = fs.existsSync(file) ? readJson(file) : {}
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
function probeSource(src) {
  const url = /^https?:\/\//.test(src ?? '')
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
  const has = bin => { try { return !!out('which', [bin]).trim() } catch { return false } }
  const checks = [
    ['node 22 or later', +process.versions.node.split('.')[0] >= 22, 'brew install node'],
    ['ffmpeg and ffprobe', has('ffmpeg') && has('ffprobe'), 'brew install ffmpeg'],
    ['Google Chrome', fs.existsSync('/Applications/Google Chrome.app') || process.platform !== 'darwin', 'brew install --cask google-chrome'],
    ['uv and uvx', has('uv') && has('uvx'), 'brew install uv'],
  ]
  for (const [name, ok, fix] of checks) console.log(`${ok ? 'ok     ' : 'MISSING'} ${name}${ok ? '' : `: ${fix}`}`)
  if (process.arch !== 'arm64') console.log('note: transcription (mlx-whisper) needs Apple Silicon; use a pack with "transcribe": false here')
  console.log(`projects: ${HOME}`)
  console.log(fs.existsSync(path.join(HOME, '.style/style.json')) ? `style: ${path.join(HOME, '.style/STYLE.md')}` : 'style: none yet, run the setup interview')
  if (checks.some(c => !c[1])) process.exit(1)
}

function rules(sub, arg) {
  const all = packs()
  if (!sub || sub === 'list') {
    const dir = projectDir(false), active = dir && readJson(path.join(dir, 'source/rules.json')).active
    for (const pk of Object.values(all)) console.log(`${active ? (active.includes(pk.name) ? '● ' : '○ ') : ''}${pk.name}: ${pk.description ?? ''} [${pk.origin}] ${pk.file}`)
    if (active) console.log(`\nactive on ${path.basename(dir)}: ${active.join(', ') || 'none'}`)
  } else if (sub === 'use' && arg) {
    const dir = projectDir(), file = path.join(dir, 'source/rules.json'), active = arg === 'none' ? [] : list(arg)
    let params
    try { params = mergeParams(all, active) } catch (e) { die(e.message) }
    writeJson(file, { active, params, overrides: readJson(file).overrides ?? {} })
    console.log(`rules: ${active.join(', ') || 'none'}. ${readJson(path.join(dir, 'source/project.json')).source ? 'Now run prepare, then rough' : 'Now update the scene, then stills'}`)
  } else die('usage: rules [list] | rules use <a,b|none>')
}

const commands = { doctor, probe: () => probeSource(args[0]), site: () => site(args[0]), init: () => init(args[0]), prepare, rough, stills, render, audio, final, studio, preview, codecs, style: () => style(...args), serve, rules: () => rules(...args) }
if (!commands[cmd]) die(`usage: video.mjs <${Object.keys(commands).join(' | ')}> [--project <slug>]`)
await commands[cmd]()
