// The dev servers' fake APIs (developer mode's « Fake API » switch): OpenRouter's and Kie's real public catalogs and
// price lists (no key sent), every generation faked (nothing spent), ElevenLabs faked. Unlike fake-api.js (the tests'),
// it takes any model and any key and refuses nothing: every tool of the dashboard runs end to end on it.
//   node test/fake-proxy.mjs <dir> <port>      (dir: its files, calls.log, an optional voices.json of /v2/voices)
// then a server started with OPENROUTER_BASE=http://127.0.0.1:<port>/api/v1 ELEVENLABS_BASE=…/el KIE_BASE=…/kie
// KIE_UPLOAD_BASE=…/kieup (and any keys) shows the switch. A sound lasts long enough for what follows it: a voice 5 s
// (Isolate voice takes 4.6 s, OmniHuman 4 s), a song 30 s (a singer is made from 10 to 30 s of it)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { zip } from './fake-api.js'

const [dir, port] = [process.argv[2], +process.argv[3]]
if (!dir || !port) { console.error('usage: node fake-proxy.mjs <dir> <port>'); process.exit(1) }
fs.mkdirSync(dir, { recursive: true })
const make = (name, ...argv) => { const f = path.join(dir, name); execFileSync('ffmpeg', ['-y', '-v', 'error', ...argv, f]); return fs.readFileSync(f) }
const png = make('fake.png', '-f', 'lavfi', '-i', 'gradients=s=512x512:d=1', '-frames:v', '1')
const mp4 = make('fake.mp4', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=5', '-f', 'lavfi', '-i', 'sine=d=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest')
const voice = make('voice.mp3', '-f', 'lavfi', '-i', 'sine=f=440:d=5')
const song = make('song.mp3', '-f', 'lavfi', '-i', 'sine=f=330:d=30')
const wav = make('song.wav', '-f', 'lavfi', '-i', 'sine=f=330:d=30', '-ac', '1')
const flac = make('fake.flac', '-f', 'lavfi', '-i', 'sine=f=330:d=5')
// raw PCM, 16-bit mono, at the rate its type says (Gemini 24 kHz, HeyGen 44.1 kHz)
const pcm = rate => Buffer.alloc(rate * 2 * 5)
const log = path.join(dir, 'calls.log'), polls = {}
const ENGINE = new URL('../', import.meta.url)
const read = rel => JSON.parse(fs.readFileSync(new URL(rel, ENGINE), 'utf8'))
// Kie's tasks, and each model's kind from the engine's hand list (a catalog one guessed from its name)
const kieTasks = {}
const KIE_LIST = read('providers/kie-models.json')
const KIE_KIND = Object.fromEntries(['image', 'video', 'speech'].flatMap(k => KIE_LIST[k].flatMap(m => (typeof m.kie === 'string' ? [m.kie] : Object.values(m.kie ?? {}).map(v => v.model ?? v)).map(n => [n, k]))))
// ElevenLabs: its models as the engine's copy of GET /v1/models; its voices as dir/voices.json (the account's, read once
// from /v2/voices) or else the premade ones the engine lists (their ids in their samples' URLs)
const NAMES = new Intl.DisplayNames(['en'], { type: 'language' })
const EL_MODELS = read('providers/elevenlabs-models.json').models.map(m => ({ ...m, languages: m.languages.map(id => ({ language_id: id, name: (() => { try { return NAMES.of(id) } catch { return id } })() })) }))
const EL_VOICES = fs.existsSync(path.join(dir, 'voices.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'voices.json'), 'utf8'))
  : Object.values(read('providers/voices.json').voices).map(v => ({ voice_id: v.preview_url?.match(/\/voices\/([^/]+)\//)?.[1], name: v.name, category: 'premade', labels: v.labels,
    verified_languages: Object.keys(v.previews ?? {}).map(language => ({ language })) })).filter(v => v.voice_id)
let used = 1000
// an MP3 at 192 kb/s (what video.mjs sends) billed 1,000 credits a minute
const perMinute = bytes => Math.max(1, Math.ceil((bytes * 8) / 192e3 / 60 * 1000))
// Suno's stems, by the split asked (2026-10-31: separate_vocal 2, split_stem 12, its files named <id>_<Group>.mp3)
const STEMS = { separate_vocal: ['Vocals', 'Instrumental'], split_stem: ['Vocals', 'Backing Vocals', 'Drums', 'Bass', 'Guitar', 'Keyboard', 'Percussion', 'Strings', 'Synth', 'FX', 'Brass', 'Woodwinds'] }
const SONGS = ['generate', 'extend', 'upload-and-extend-audio', 'upload-and-cover-audio', 'add-vocals', 'add-instrumental', 'replace-section', 'mashup']

http.createServer(async (req, res) => {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks), u = new URL(req.url, 'http://x'), p = u.pathname
  const body = /json/.test(req.headers['content-type'] ?? '') ? (() => { try { return JSON.parse(raw.toString() || '{}') } catch { return {} } })() : null
  fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), method: req.method, path: p + u.search, model: body?.model ?? body?.model_id, prompt: body?.prompt ?? body?.input }) + '\n')
  const json = (v, code = 200, h = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(v)) }
  const bytes = (b, type, h = {}) => { res.writeHead(200, { 'content-type': type, 'content-length': b.length, ...h }); res.end(b) }
  const f = n => `http://127.0.0.1:${port}/kiefiles/${n}`

  // ---- OpenRouter: its catalog read from the real one (public, no key), the rest faked
  if (req.method === 'GET' && /^\/api\/v1\/(images\/models|videos\/models|models)/.test(p)) {
    const r = await fetch('https://openrouter.ai' + p + u.search).catch(() => null)
    return r ? bytes(Buffer.from(await r.arrayBuffer()), 'application/json') : json({ error: { message: 'fake: OpenRouter unreachable' } }, 503)
  }
  if (p === '/api/v1/images') return json({ data: Array.from({ length: body.n ?? 1 }, () => ({ b64_json: png.toString('base64'), media_type: 'image/png' })), usage: { cost: 0.134 } })
  if (p === '/api/v1/videos' && req.method === 'POST') { const id = `gen-vid-${Date.now()}`; polls[id] = 0; return json({ id, polling_url: `/api/v1/videos/${id}`, status: 'pending' }) }
  if (/^\/api\/v1\/videos\/gen-vid-\d+\/content$/.test(p)) return bytes(mp4, 'video/mp4')
  if (/^\/api\/v1\/videos\/gen-vid-\d+$/.test(p)) {
    const id = p.split('/').pop()
    return ++polls[id] < 3 ? json({ id, status: 'in_progress' }) : json({ id, status: 'completed', unsigned_urls: [`http://127.0.0.1:${port}/api/v1/videos/${id}/content?index=0`], usage: { cost: 0.55 } })
  }
  if (p === '/api/v1/audio/speech') {
    const rate = /heygen/i.test(body.model) ? 44100 : 24000
    return body.response_format === 'pcm' ? bytes(pcm(rate), `audio/pcm;rate=${rate};channels=1`, { 'x-generation-id': 'g1' }) : bytes(voice, 'audio/mpeg', { 'x-generation-id': 'g1' })
  }
  // a song (Lyria): chat completions streamed, its sound in pieces of base64, its words as the transcript
  if (p === '/api/v1/chat/completions') {
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const half = Math.floor(song.length / 2)
    for (const part of [song.subarray(0, half), song.subarray(half)]) res.write(`data: ${JSON.stringify({ id: 'g-song', choices: [{ delta: { audio: { data: part.toString('base64') } } }] })}\n\n`)
    res.write(`data: ${JSON.stringify({ id: 'g-song', choices: [{ delta: { audio: { transcript: '[Verse]\nla la, the night road' } } }] })}\n\ndata: [DONE]\n\n`)
    return res.end()
  }
  if (p === '/api/v1/generation') return json({ data: { total_cost: 0.004 } })
  if (p === '/api/v1/key') return json({ data: { limit: 20, limit_remaining: 18.62, usage_monthly: 1.38 } })
  if (p === '/api/v1/credits') return json({ data: { total_credits: 25, total_usage: 6.38 } })
  // a tunnel's name, for a server whose MEDIA_GENERATOR_DOH points here
  if (p === '/dns-query') return json({ Status: 0, Answer: [{ name: u.searchParams.get('name'), type: 1, data: '104.16.231.132' }] })

  // ---- Kie: its catalog and price list read from the real ones (public, no key), its tasks faked
  const kieOk = data => json({ code: 200, msg: 'success', data })
  if (p === '/kie/api/v1/playground/model-paths' || p === '/kie/client/v1/model-pricing/page') {
    const r = await fetch('https://api.kie.ai' + p.slice(4) + u.search, req.method === 'POST' ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw } : {}).catch(() => null)
    return r ? bytes(Buffer.from(await r.arrayBuffer()), 'application/json') : json({ code: 503, msg: 'fake: Kie unreachable', data: null })
  }
  if (p === '/kie/api/v1/chat/credit') return kieOk(1080)
  if (p === '/kieup/api/file-base64-upload' || p === '/kieup/api/file-stream-upload') return kieOk({ success: true, downloadUrl: f(`upload-${Date.now()}`), fileSize: raw.length })
  if (p === '/kie/api/v1/jobs/createTask') {
    const id = `kie-task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, input = body.input ?? {}
    kieTasks[id] = { model: body.model, input, polls: 0 }
    // answered at once, no task to follow: Suno's timed lyrics (code and data inside data), a persona
    if (body.model === 'ai-music-api/timeStamped-lyrics') return kieOk({ code: 200, msg: 'success', data: { alignedWords: ['la', 'la', 'the', 'night', 'road'].map((word, i) => ({ word, startS: 0.5 + i * 0.6, endS: 1 + i * 0.6 })) } })
    if (body.model === 'ai-music-api/generate-persona') return kieOk({ persona_id: `persona-${Date.now()}`, name: input.name })
    // a voice's recording: its validation phrase's task succeeds
    if (body.model === 'ai-music-api/create-voice' && kieTasks[input.task_id]) kieTasks[input.task_id].voiced = true
    return kieOk({ taskId: id })
  }
  if (p === '/kie/api/v1/jobs/recordInfo') {
    const id = u.searchParams.get('taskId'), t = kieTasks[id]
    if (!t) return json({ code: 422, msg: 'recordInfo is null', data: null })
    const suno = t.model.startsWith('ai-music-api/') && t.model.split('/')[1]
    // Suno's validation phrase waits for the recording (« generating », its phrase already there) until create-voice
    if (suno === 'validation-phrase')
      return kieOk({ taskId: id, model: t.model, state: t.voiced ? 'success' : 'generating', resultJson: JSON.stringify({ msg: 'success', code: 200, data: { verify_phrase_text: 'the moon sings softly over the sea', verify_phrase_id: 'p-1' }, task_id: id }) })
    const state = ['waiting', 'generating'][t.polls++] ?? 'success', done = state === 'success'
    // a song's two takes under response.data
    if (SONGS.includes(suno))
      return kieOk({ taskId: id, model: t.model, state, resultJson: '', creditsConsumed: done ? 12 : null,
        response: done ? { data: [1, 2].map(n => ({ id: `${id}-take-${n}`, audio_url: f(`take-${n}.mp3`), image_url: f(`cover-${n}.png`), title: t.input.title || 'Night Road', tags: t.input.style || t.input.tags || 'synthwave, airy female vocals', prompt: t.input.prompt && t.input.customMode ? t.input.prompt : '[Verse]\nla la, the night road\n[Chorus]\nlights go by', duration: 30 })) } : null })
    if (suno) {
      let urls = [], object = {}
      if (suno === 'separate-vocals') {
        // one instrument taken out: each take's instrument alone and the song without it
        if (t.input.type === 'split_stem_advanced') {
          const group = t.input.stem_name || 'Lead Vocal'
          object = { origin_data: [1, 2].map(n => ({ stem_type_group_name: group, extract: { id: `${id}-x${n}`, audio_url: f(`${id}-x${n}.mp3`) }, remove: { id: `${id}-r${n}`, audio_url: f(`${id}-r${n}.mp3`) } })) }
          urls = object.origin_data.flatMap(o => [o.extract.audio_url, o.remove.audio_url])
        } else {
          const groups = STEMS[t.input.type] ?? STEMS.separate_vocal
          object = { origin_data: groups.map((g, i) => ({ id: `${id}-s${i}`, stem_type_group_name: g })) }
          urls = object.origin_data.map(o => f(`${o.id}_${o.stem_type_group_name.replace(/ /g, '_')}.mp3`))
        }
      } else {
        urls = { 'convert-to-wav-format': [f('out.wav')], 'create-music-video': [f('out.mp4')], sounds: [f('sound.mp3')] }[suno] ?? []
        object = { 'generate-lyrics': { lyricsData: [{ title: 'Night', text: '[Verse]\nroad' }, { title: 'Drive', text: '[Verse]\nlights' }] },
          'generate-midi-from-audio': { instruments: [{ name: 'Voice', notes: [{ pitch: 60, start: 0, end: 0.5 }] }] } }[suno] ?? {}
      }
      // Boost style's text comes among its « URLs » (2026-10-31)
      const texts = suno === 'boost-music-style' ? ['dreamy synthwave, airy female vocals, 100 BPM'] : []
      return kieOk({ taskId: id, model: t.model, state, resultJson: done ? JSON.stringify({ resultUrls: [...urls, ...texts], resultObject: object }) : '', creditsConsumed: done ? 2 : null })
    }
    const kind = KIE_KIND[t.model] ?? (/video|kling|seedance|wan|veo|hailuo|sora|avatar|lip|s2v|omni|runway|aleph|vidu|grok-imagine\/(text|image)-to-video/i.test(t.model) ? 'video' : /tts|speech|audio|voice|eleven|music|sound/i.test(t.model) ? 'speech' : 'image')
    const file = kind === 'video' ? 'out.mp4' : kind === 'speech' ? 'speech.mp3' : 'out.png'
    return kieOk({ taskId: id, model: t.model, state, resultJson: done ? JSON.stringify({ resultUrls: [f(file)], ...(t.input.return_last_frame ? { lastFrameUrl: f('last.png') } : {}) }) : '', failCode: '', failMsg: '', creditsConsumed: done ? 10 : null })
  }
  if (p.startsWith('/kiefiles/')) {
    const n = p.slice(10)
    // a voice or a sound effect 5 s, a song and its stems 30 s
    return /\.mp4$/.test(n) ? bytes(mp4, 'video/mp4') : /\.wav$/.test(n) ? bytes(wav, 'audio/wav') : /^(speech|sound)\.mp3$/.test(n) ? bytes(voice, 'audio/mpeg')
      : /\.mp3$/.test(n) ? bytes(song, 'audio/mpeg') : bytes(png, 'image/png')
  }

  // ---- ElevenLabs, straight (media-generator's voices) and through video-editor's engine (voice change, dubbing,
  // isolation, clones): the account's count moves with each spend, as the real one does
  if (p === '/el/v1/models') return json(EL_MODELS)
  if (p.startsWith('/el/v1/text-to-speech/') || p.startsWith('/el/v1/text-to-dialogue')) {
    const text = body?.text ?? (body?.inputs ?? []).map(l => l.text).join(' ')
    const m = EL_MODELS.find(x => x.model_id === body?.model_id), cost = Math.ceil(text.length * (m?.model_rates?.character_cost_multiplier ?? 1))
    used += cost
    if (!p.includes('/with-timestamps')) return bytes(voice, 'audio/mpeg', { 'character-cost': String(cost) })
    // each character's times spread over the voice's 5 s
    const ch = [...text], each = 5 / Math.max(ch.length, 1)
    return json({ audio_base64: voice.toString('base64'), alignment: { characters: ch, character_start_times_seconds: ch.map((_, i) => i * each), character_end_times_seconds: ch.map((_, i) => (i + 1) * each) } }, 200, { 'character-cost': String(cost) })
  }
  // beyond speech: its effects, a sound, music (its plan, an upload, a video's music, stems as a ZIP), a voice designed
  // or remixed (3 previews) and kept, a transcript, an alignment; each counted as its rate would (unknown ones: 100)
  const form = /multipart/.test(req.headers['content-type'] ?? '') ? raw.toString('utf8') : ''
  if (p === '/el/v1/audio-effects/catalog') return json({ filter_presets: [['phone', 'Phone'], ['old_radio', 'Old radio'], ['megaphone', 'Megaphone']].map(([filter_preset_id, name]) => ({ filter_preset_id, name, description: null })),
    environments: [['small_room', 'Small room'], ['hall', 'Hall'], ['cathedral', 'Cathedral']].map(([environment_id, name]) => ({ environment_id, name, description: null })),
    background_noises: [['cafe', 'Café'], ['keyboard', 'Keyboard'], ['rain', 'Rain']].map(([background_noise_id, name]) => ({ background_noise_id, name, description: null })) })
  if (p === '/el/v1/sound-generation') { const c = body?.duration_seconds ? Math.ceil(body.duration_seconds * 40) : 200; used += c; return bytes(voice, 'audio/mpeg', { 'character-cost': String(c) }) }
  if (p === '/el/v1/music/plan') return json({ chunks: [{ text: '[Intro]', duration_ms: 15000, positive_styles: ['fake'], negative_styles: [] }, { text: '[Outro]', duration_ms: 15000, positive_styles: ['fake'], negative_styles: [] }] })
  if (p === '/el/v1/music/upload') { used += 450; return json({ song_id: `up-${Date.now()}` }) }
  if (p === '/el/v1/music') { used += 450; return bytes(song, 'audio/mpeg', { 'song-id': `song-${Date.now()}` }) }
  if (p === '/el/v1/music/video-to-music') { used += 450; return /name="separate_tracks"\r\n\r\ntrue/.test(form) ? bytes(zip({ 'music.mp3': song, 'sfx.mp3': voice }), 'application/zip') : bytes(song, 'audio/mpeg') }
  if (p === '/el/v1/music/stem-separation') { used += 100; return bytes(zip(/six_stems_v1/.test(form) ? Object.fromEntries(['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'].map(n => [`${n}.mp3`, song])) : { 'vocals.mp3': song, 'instrumental.mp3': song }), 'application/zip') }
  if (p === '/el/v1/text-to-voice/design' || /^\/el\/v1\/text-to-voice\/[\w-]+\/remix$/.test(p)) {
    used += 100
    return json({ previews: [1, 2, 3].map(n => ({ audio_base_64: voice.toString('base64'), generated_voice_id: `gen-${Date.now()}-${n}`, media_type: 'audio/mpeg', duration_secs: 5, language: 'en' })), text: 'A preview of the voice, as the fake says it.' })
  }
  if (p === '/el/v1/text-to-voice') return json({ voice_id: `v-${body.generated_voice_id}`, name: body.voice_name })
  if (p === '/el/v1/speech-to-text') {
    used += 30
    const w = (text, start, end, who) => [{ text, start, end, type: 'word', speaker_id: who }, { text: ' ', start: end, end, type: 'spacing', speaker_id: who }]
    return json({ language_code: 'en', text: 'This is a fake transcript. Its second speaker answers.', words: [...w('This', 0, 0.3, 'speaker_0'), ...w('is', 0.35, 0.5, 'speaker_0'), ...w('a', 0.55, 0.6, 'speaker_0'), ...w('fake', 0.65, 1, 'speaker_0'), ...w('transcript.', 1.05, 1.6, 'speaker_0'),
      ...w('Its', 2.2, 2.4, 'speaker_1'), ...w('second', 2.45, 2.8, 'speaker_1'), ...w('speaker', 2.85, 3.3, 'speaker_1'), ...w('answers.', 3.35, 4, 'speaker_1')].slice(0, -1) })
  }
  if (p === '/el/v1/forced-alignment') {
    used += 30
    const words = String(form.match(/name="text"\r\n\r\n([\s\S]*?)\r\n--/)?.[1] ?? '').split(/\s+/).filter(Boolean)
    return json({ words: words.map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.35, loss: 0.1 })), characters: [], loss: 0.1 })
  }
  if (p.startsWith('/el/v1/voice-changer/') || p === '/el/v1/audio-isolation') { used += perMinute(raw.length); return bytes(voice, 'audio/mpeg') }
  if (p === '/el/v1/voices/add') return json({ voice_id: `v-clone-${Date.now()}` })
  if (p === '/el/v1/dubbing/project') return json({ project_id: 'p1', status: 'queued', language_ids: ['l-first'] })
  if (p === '/el/v1/dubbing/project/p1') return json({ project_id: 'p1', status: 'ready', language_ids: ['l-first'] })
  if (p === '/el/v1/dubbing/project/p1/language') return json({ language_id: `l-${body.target_language}`, status: 'queued' })
  if (/^\/el\/v1\/dubbing\/project\/p1\/language\/l-[\w-]+$/.test(p)) { used += 250; return json({ status: 'completed', outputs: { lossless_audio: `http://127.0.0.1:${port}/el/out.flac`, subtitles: `http://127.0.0.1:${port}/el/out.vtt` } }) }
  if (p === '/el/out.flac') return bytes(flac, 'audio/flac')
  if (p === '/el/out.vtt') return bytes(Buffer.from('WEBVTT\n\n00:00.000 --> 00:05.000\n(fake dub)\n'), 'text/vtt')
  if (p === '/el/v1/user/subscription') return json({ tier: 'free', character_count: used, character_limit: 10000, next_character_count_reset_unix: Math.floor(Date.now() / 1000) + 20 * 864e2 })
  if (p === '/el/v2/voices') return json({ voices: EL_VOICES.map(v => ({ ...v, preview_url: `http://127.0.0.1:${port}/el/preview/${v.voice_id}.mp3`, verified_languages: (v.verified_languages ?? []).map(l => ({ ...l, preview_url: `http://127.0.0.1:${port}/el/preview/${v.voice_id}-${l.language}.mp3` })) })), has_more: false })
  if (p.startsWith('/el/preview/')) return bytes(voice, 'audio/mpeg')
  console.error(`fake: nothing at ${req.method} ${p}`)
  json({ error: { message: `fake: nothing at ${p}` } }, 404)
}).listen(port, '127.0.0.1', () => console.log(`fake on ${port}`))
