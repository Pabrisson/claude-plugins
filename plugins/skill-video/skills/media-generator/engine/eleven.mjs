#!/usr/bin/env node
// ElevenLabs on any file, for media.mjs (Change voice, Translate, Isolate voice, a voice of the Library put on the
// account) and its voices and balance: voice-change, isolate, dub, voice-clone, voices, credits. A paid command prints
// its estimate (--estimate) or stops with exit code 2 without --spend <credits>, then says what it spent.
// $ELEVENLABS_API_KEY (the plugin's secret), $ELEVENLABS_BASE for the tests' fake server
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'

const { values: opt, positionals: [cmd, ...args] } = parseArgs({
  allowPositionals: true,
  options: {
    voice: { type: 'string' }, out: { type: 'string' }, denoise: { type: 'boolean' }, to: { type: 'string' }, from: { type: 'string' },
    model: { type: 'string' }, spend: { type: 'string' }, estimate: { type: 'boolean' }, json: { type: 'boolean' },
  },
})
const die = msg => { console.error(`error: ${msg}`); process.exit(1) }
const list = s => (s ?? '').split(',').map(x => x.trim()).filter(Boolean)
const ms = x => Math.round(x * 1000) / 1000
// every program started from here hides its window (Windows)
const HIDE = { windowsHide: true }
const run = (bin, argv) => execFileSync(bin, argv, { ...HIDE, stdio: ['ignore', 'inherit', 'inherit'], maxBuffer: Infinity })
const out = (bin, argv) => execFileSync(bin, argv, { ...HIDE, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
// the log of an ffmpeg pass that only analyzes (its filters print to stderr)
const ffmpegLog = argv => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...argv], { ...HIDE, encoding: 'utf8', maxBuffer: Infinity })
  if (r.status) die(`ffmpeg: ${r.stderr.trim().split('\n').at(-1)}`)
  return r.stderr
}
const POLL = d => +(process.env.MEDIA_GENERATOR_POLL ?? d)

const ELEVEN_API = () => (process.env.ELEVENLABS_BASE ?? 'https://api.elevenlabs.io').replace(/\/$/, '')
async function eleven(route, init = {}) {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) die('no ElevenLabs key (the plugin\'s secret, /plugin configure skill-video@pabrisson, or ELEVENLABS_API_KEY)')
  const r = await fetch(`${ELEVEN_API()}${route}`, { ...init, headers: { 'xi-api-key': key, ...init.headers } })
  if (!r.ok) {
    // ElevenLabs' own sentence (detail.message), not its whole JSON
    const text = await r.text(), why = (() => { try { const d = JSON.parse(text).detail; return d?.message ?? (typeof d === 'string' ? d : null) } catch { return null } })()
    die(`ElevenLabs ${route.split('?')[0]}: ${r.status} ${why ?? text}`)
  }
  return /json/.test(r.headers.get('content-type') ?? '') ? r.json() : Buffer.from(await r.arrayBuffer())
}

// voices [<search>]: the voices of the ElevenLabs account, with their labels and languages
async function voices(search) {
  const j = await eleven(`/v2/voices?page_size=100${search ? `&search=${encodeURIComponent(search)}` : ''}`)
  if (opt.json) return console.log(JSON.stringify(j.voices.map(v => ({ voice_id: v.voice_id, name: v.name, category: v.category, labels: v.labels ?? {},
    languages: [...new Set((v.verified_languages ?? []).map(l => l.language))], description: v.description ?? null, preview_url: v.preview_url ?? null,
    // a sample in each language the voice was verified in (the first of its models)
    previews: Object.fromEntries((v.verified_languages ?? []).filter(l => l.preview_url).reverse().map(l => [l.language, l.preview_url])) }))))
  for (const v of j.voices) {
    const langs = [...new Set((v.verified_languages ?? []).map(l => l.language))]
    console.log(`${v.voice_id}  ${v.name} [${v.category}] ${Object.values(v.labels ?? {}).join(', ')}${langs.length ? ` · ${langs.join('/')}` : ''}${v.description ? ` — ${v.description}` : ''}`)
  }
  console.log(j.voices.length ? (j.has_more ? 'more voices: narrow with voices <search>' : '') : 'no voice found')
}

// the account's subscription (credits used and left), or why it cannot be read; never fatal
async function subscription() {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) return { error: 'no key' }
  const r = await fetch(`${ELEVEN_API()}/v1/user/subscription`, { headers: { 'xi-api-key': key } }).catch(e => ({ ok: false, status: e.message, json: async () => ({}) }))
  const j = await r.json().catch(() => ({}))
  return r.ok ? j : { error: j.detail?.message ?? `ElevenLabs answered ${r.status}` }
}

// a paid command on any file (voice-change, dub, isolate): --estimate prints its credits as JSON; without the user's yes as
// --spend <credits>, it stops with exit code 2 and the same JSON
function spendGate(credits, detail) {
  console.log(JSON.stringify({ credits, detail }))
  if (opt.estimate) process.exit(0)
  if (!(+opt.spend >= credits)) {
    console.error(`error: ${detail}: about ${credits} ElevenLabs credits. Ask the user, then run again with --spend ${credits}`)
    process.exit(2)
  }
}
// what a paid command spent: the subscription's count before and once it moved (10 to 20 s later on 2026-10-29), else
// the estimate (said as such)
async function spentSince(before, credits) {
  let after = await subscription()
  for (let i = 0; i < 15 && !before.error && !after.error && after.character_count === before.character_count; i++) {
    await new Promise(ok => setTimeout(ok, POLL(2000)))
    after = await subscription()
  }
  // the account's count moves with every spend: another one at the same time (a voice, a second job) shows as a gap from
  // the estimate, and the estimate stands
  const moved = after.character_count - before.character_count, near = Math.abs(moved - credits) <= Math.max(5, credits * 0.25)
  console.log(before.error || after.error || !moved ? `spent: about ${credits} credits (estimated)` : near ? `spent: ${moved} credits` : `spent: about ${credits} credits (estimated: the account moved by ${moved} meanwhile)`)
}

// a file's sound and length, for the commands that work on any file
// (width is set for a video, not for a sound with a cover picture)
function soundOf(file) {
  if (!file || !fs.existsSync(file)) die(`no such file: ${file}`)
  const j = JSON.parse(out('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file]))
  if (!j.streams.some(s => s.codec_type === 'audio')) die(`${path.basename(file)} has no sound`)
  const v = j.streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic)
  return { duration: ms(+j.format.duration), width: v?.width ?? null }
}

// where to cut a long sound into pieces of at most 290 s: in its silences when there are some
function cutPoints(file, duration, max = 290) {
  if (duration <= max) return []
  const log = ffmpegLog(['-i', file, '-af', 'silencedetect=noise=-35dB:d=0.3', '-f', 'null', '-'])
  const quiet = [...log.matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map(m => (+m[1] + +m[2]) / 2)
  const cuts = []
  for (let from = 0; duration - from > max;) {
    const at = quiet.filter(t => t > from + 60 && t <= from + max).pop() ?? from + max
    cuts.push(ms(at))
    from = at
  }
  return cuts
}

// voice-change <file> --voice <voice_id> [--out <file>] [--denoise]: the same delivery in another voice (ElevenLabs'
// voice changer, 300 s a call: longer sounds go in pieces cut in silences), back on the video when it is one
async function voiceChange(file) {
  if (!opt.voice) die('usage: voice-change <file> --voice <voice_id> [--out <file>] [--denoise] [--spend <credits>] (voices lists the voice ids)')
  const p = soundOf(file), credits = Math.ceil((p.duration / 60) * 1000)
  spendGate(credits, `voice change of ${ms(p.duration)} s`)
  const before = await subscription(), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-change-'))
  const cuts = cutPoints(file, p.duration), bounds = [0, ...cuts, p.duration], pieces = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const piece = path.join(tmp, `in-${i}.mp3`), made = path.join(tmp, `out-${i}.mp3`), form = new FormData()
    run('ffmpeg', ['-y', '-v', 'error', '-ss', `${bounds[i]}`, '-t', `${bounds[i + 1] - bounds[i]}`, '-i', file, '-vn', '-ac', '1', '-b:a', '192k', piece])
    for (const [k, v] of Object.entries({ model_id: 'eleven_multilingual_sts_v2', remove_background_noise: `${!!opt.denoise}` })) form.append(k, v)
    form.append('audio', await fs.openAsBlob(piece), 'audio.mp3')
    console.log(`voice change ${i + 1}/${bounds.length - 1}…`)
    // 128 kb/s on every plan: 192 needs the Creator tier (403 output_format_not_allowed)
    fs.writeFileSync(made, await eleven(`/v1/voice-changer/${encodeURIComponent(opt.voice)}?output_format=mp3_44100_128`, { method: 'POST', body: form }))
    pieces.push(made)
  }
  const voice = path.join(tmp, 'voice.wav')
  fs.writeFileSync(path.join(tmp, 'list.txt'), pieces.map(f => `file '${f}'`).join('\n'))
  run('ffmpeg', ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), voice])
  const ext = path.extname(file), dest = path.resolve(opt.out ?? path.join(path.dirname(file), `${path.basename(file, ext)}-voice${p.width ? ext : '.mp3'}`))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  if (p.width) run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-i', voice, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', dest])
  else run('ffmpeg', ['-y', '-v', 'error', '-i', voice, '-b:a', '256k', dest])
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`voice changed: ${dest}`)
  await spentSince(before, credits)
}

// isolate <file> [--out <file>]: the voice alone, music, noise and room taken out (ElevenLabs' Voice Isolator, 1,000
// credits a minute: its help center, 2026-11-01), back on the video when it is one
// ponytail: one call, ElevenLabs takes up to an hour and 500 MB; cut in pieces like voice-change if that is ever short
async function isolate(file) {
  const p = soundOf(file), credits = Math.ceil((p.duration / 60) * 1000)
  // ElevenLabs' own minimum (its 400, free, 2026-11-01)
  if (p.duration < 4.6) die(`ElevenLabs' Voice Isolator takes 4.6 s at least: ${path.basename(file)} lasts ${p.duration.toFixed(1)} s`)
  spendGate(credits, `voice isolation of ${ms(p.duration)} s`)
  const before = await subscription(), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'isolate-'))
  const sound = path.join(tmp, 'in.mp3'), voice = path.join(tmp, 'voice.mp3'), form = new FormData()
  run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-vn', '-b:a', '192k', sound])
  form.append('audio', await fs.openAsBlob(sound), 'audio.mp3')
  console.log('isolating the voice…')
  fs.writeFileSync(voice, await eleven('/v1/audio-isolation', { method: 'POST', body: form }))
  const ext = path.extname(file), dest = path.resolve(opt.out ?? path.join(path.dirname(file), `${path.basename(file, ext)}-voice-only${p.width ? ext : '.mp3'}`))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  if (p.width) run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-i', voice, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', dest])
  else run('ffmpeg', ['-y', '-v', 'error', '-i', voice, '-b:a', '256k', dest])
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`voice isolated: ${dest}`)
  await spentSince(before, credits)
}

// voice-clone <name> <files…>: an instant clone of a voice from a few clean recordings, on the account; its id for
// voice-change and the voices
async function voiceClone(name, ...files) {
  if (!name || !files.length) die('usage: voice-clone <name> <recordings…> (a minute or more of clean speech)')
  const form = new FormData()
  form.append('name', name)
  for (const f of files) {
    if (!fs.existsSync(f)) die(`no such file: ${f}`)
    form.append('files', await fs.openAsBlob(f), path.basename(f))
  }
  const j = await eleven('/v1/voices/add', { method: 'POST', body: form })
  console.log(`voice: ${j.voice_id}  ${name} (cloned from ${files.length} file${files.length > 1 ? 's' : ''})`)
}

// dub <file> --to <lang>[,<lang>…] [--from <lang>] [--model dubbing_v1|dubbing_v2] [--out <dir>]: ElevenLabs Dubbing,
// one project for the source and one language target each; every language comes back as its own file (on the video
// when it is one) with its subtitles. No lip-sync
async function dub(file) {
  const langs = list(opt.to), model = opt.model ?? 'dubbing_v1'
  if (!langs.length || !['dubbing_v1', 'dubbing_v2'].includes(model)) die('usage: dub <file> --to <lang>[,<lang>…] [--from <lang>] [--model dubbing_v1|dubbing_v2] [--out <dir>] [--spend <credits>]')
  const p = soundOf(file), credits = Math.ceil((p.duration / 60) * (model === 'dubbing_v2' ? 13500 : 3000)) * langs.length
  spendGate(credits, `dubbing ${model === 'dubbing_v2' ? 'v2' : 'v1'} of ${ms(p.duration)} s into ${langs.join(', ')}`)
  const before = await subscription(), wait = () => new Promise(ok => setTimeout(ok, POLL(10000)))
  const form = new FormData()
  for (const [k, v] of Object.entries({ model_id: model, target_language: langs[0], ...(opt.from ? { source_language: opt.from } : {}) })) form.append(k, v)
  form.append('file', await fs.openAsBlob(file), path.basename(file))
  const project = await eleven('/v1/dubbing/project', { method: 'POST', body: form })
  console.log(`dubbing project ${project.project_id}: transcribing the source…`)
  let state = project
  while (!['ready', 'failed'].includes(state.status)) { await wait(); state = await eleven(`/v1/dubbing/project/${project.project_id}`) }
  if (state.status === 'failed') die(`dubbing: ${state.error?.message ?? 'the source could not be prepared'} (refunded)`)
  const targets = Object.fromEntries((state.language_ids ?? project.language_ids ?? []).map((id, i) => [langs[i], id]))
  for (const lang of langs.filter(l => !targets[l])) {
    const t = await eleven(`/v1/dubbing/project/${project.project_id}/language`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ target_language: lang }) })
    targets[lang] = t.language_id
  }
  const dir = path.resolve(opt.out ?? path.dirname(file)), base = path.basename(file, path.extname(file)), made = []
  fs.mkdirSync(dir, { recursive: true })
  for (const [lang, id] of Object.entries(targets)) {
    let t
    do { await wait(); t = await eleven(`/v1/dubbing/project/${project.project_id}/language/${id}`); console.log(`dubbing ${lang}: ${t.status}`) } while (['queued', 'processing'].includes(t.status))
    if (t.status !== 'completed' || !t.outputs?.lossless_audio) { console.log(`dubbing ${lang} failed: ${t.error?.message ?? t.status}`); continue }
    const flac = path.join(dir, `.dub-${lang}.flac`), dest = path.join(dir, `${opt.out ? 'dub' : `${base}-dub`}-${lang}${p.width ? path.extname(file) : '.mp3'}`)
    fs.writeFileSync(flac, Buffer.from(await (await fetch(t.outputs.lossless_audio)).arrayBuffer()))
    if (p.width) run('ffmpeg', ['-y', '-v', 'error', '-i', file, '-i', flac, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', dest])
    else run('ffmpeg', ['-y', '-v', 'error', '-i', flac, '-b:a', '256k', dest])
    fs.rmSync(flac)
    if (t.outputs.subtitles) fs.writeFileSync(dest.replace(/\.[^.]+$/, '.vtt'), Buffer.from(await (await fetch(t.outputs.subtitles)).arrayBuffer()))
    made.push(dest)
  }
  if (!made.length) die('dubbing: no language came out')
  console.log(`dubbed: ${made.join(', ')}`)
  await spentSince(before, credits)
}


// credits --json: what the account has left (its subscription), for media.mjs's balances
async function credits() {
  const j = await subscription()
  console.log(JSON.stringify(j.error ? { error: j.error } : { left: j.character_limit - j.character_count, limit: j.character_limit,
    reset: j.next_character_count_reset_unix ? new Date(j.next_character_count_reset_unix * 1000).toISOString().slice(0, 10) : null }))
}

const commands = {
  voices: () => voices(args[0]), credits, 'voice-change': () => voiceChange(args[0]), 'voice-clone': () => voiceClone(...args), dub: () => dub(args[0]), isolate: () => isolate(args[0]),
}
if (!commands[cmd]) die(`usage: eleven.mjs <${Object.keys(commands).join(' | ')}>`)
await commands[cmd]()
