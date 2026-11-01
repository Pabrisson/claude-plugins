// A fake OpenRouter (under /api/v1), ElevenLabs (under /el, for video-editor's tests' kind) and Kie for the tests (their models: test/models.json): generations that answer
// files made by ffmpeg, the errors that matter, in the shapes the real APIs answered on 2026-10-29. Every request is
// kept in calls
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

export async function startFake(dir) {
  const make = (name, ...argv) => { const f = path.join(dir, name); execFileSync('ffmpeg', ['-y', '-v', 'error', ...argv, f]); return fs.readFileSync(f) }
  const png = make('fake.png', '-f', 'lavfi', '-i', 'color=red:s=64x64', '-frames:v', '1')
  const mp4 = make('fake.mp4', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25:d=2', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest')
  const mp3 = make('fake.mp3', '-f', 'lavfi', '-i', 'sine=f=440:d=1')
  // HeyGen's PCM: 1 s at 44.1 kHz mono
  const pcm = Buffer.alloc(44100 * 2)
  const calls = [], polls = {}, lookups = {}, names = {}, fetched = [], catalog = { down: false }
  // Kie: its tasks, its uploads, its window of new tasks, how many 429 to answer first (busy), the credits each model
  // bills, its price rows
  const kie = { tasks: {}, uploads: [], window: [], busy: 0, credits: { 'fake-i2i': 12, 'fake-vid': 136, 'fake-gem': 3 },
    prices: { 'fake img, 1K': [6, 'per image'], 'fake img, 2K': [10, 'per image'], 'fake vid, 480p no video': [28, 'per second'], 'fake lip, per second': [8, 'per second'], 'fake animate, per second': [12, 'per second'], 'fake vid, 480p with video': [17, 'per second'],
      'fake vid, 1080p with video': [95, 'per second'], 'fake tts': [6, 'per 1000 characters'],
      'fake suno, request': [12, 'per request'], 'fake suno, sound': [2.5, 'per request'], 'fake suno, stems': [10, 'per request'], 'fake suno, stems 12': [50, 'per request'], 'fake suno, tiny': [0.4, 'per request'], 'fake s2v, per second': [12, 'per second'] } }
  // a fake cloudflared: its quick tunnel's name carries the local port, where the fake router fetches the files
  const bin = path.join(dir, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, 'cloudflared'), `#!/usr/bin/env node
if (process.argv.includes('--version')) { console.log('cloudflared version fake'); process.exit(0) }
const port = process.argv[process.argv.indexOf('--url') + 1].split(':').pop()
console.error('INF |  https://fake-' + port + '.trycloudflare.com  |')
console.error('INF Registered tunnel connection connIndex=0 location=cdg15')
setInterval(() => {}, 1e6)
`, { mode: 0o755 })
  // ElevenLabs' count moves a few reads after the spend (10 to 20 s on 2026-10-29)
  let used = 1000, pending = 0, reads = 0
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const raw = Buffer.concat(chunks), body = /json/.test(req.headers['content-type'] ?? '') ? JSON.parse(raw.toString() || '{}') : null
    const u = new URL(req.url, 'http://x'), p = u.pathname
    calls.push({ method: req.method, path: p + u.search, body, auth: req.headers.authorization ?? req.headers['xi-api-key'] ?? null, size: raw.length })
    const json = (v, code = 200, headers = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(v)) }
    const bytes = (b, type, headers = {}) => { res.writeHead(200, { 'content-type': type, ...headers }); res.end(b) }
    // OpenRouter's catalog, as its routes answered on 2026-10-31: a model the list has (fake/img, fake/vid, fake/tts) and
    // new ones; fake/unserved has no endpoint yet. down: 503
    if (/^\/api\/v1\/(images\/models|videos\/models|models$)/.test(p) && catalog.down) return json({ error: { message: 'down' } }, 503)
    if (p === '/api/v1/images/models') return json({ data: [
      { id: 'fake/img', name: 'Fake: Something else', architecture: { input_modalities: ['text'], output_modalities: ['image'] }, supported_parameters: {} },
      { id: 'fake/new-img', name: 'NewLab: New Image', architecture: { input_modalities: ['text', 'image'], output_modalities: ['image'] },
        supported_parameters: { resolution: { type: 'enum', values: ['4K', '1K', '8K'] }, aspect_ratio: { type: 'enum', values: ['16:9', '1:1', '9:16', 'auto'] }, n: { type: 'range', min: 1, max: 4 }, input_references: { type: 'range', min: 0, max: 6 }, seed: { type: 'boolean' } } },
      { id: 'fake/unserved', name: 'NewLab: Unserved', architecture: { input_modalities: ['text'], output_modalities: ['image'] }, supported_parameters: {} },
    ] })
    if (p === '/api/v1/images/models/fake/new-img/endpoints') return json({ id: 'fake/new-img', endpoints: [{ provider_name: 'NewLab', pricing: [{ billable: 'output_image', unit: 'image', cost_usd: 0.05 }, { billable: 'output_image', unit: 'image', cost_usd: 0.2, variant: '4k' }] }] })
    if (p === '/api/v1/images/models/fake/unserved/endpoints') return json({ id: 'fake/unserved', endpoints: [] })
    if (p === '/api/v1/videos/models') return json({ data: [
      { id: 'fake/vid', name: 'Fake: Something else', supported_resolutions: ['480p'], supported_durations: [1] },
      { id: 'fake/new-vid', name: 'NewLab: New Video', supported_resolutions: ['720p', '480p'], supported_aspect_ratios: ['16:9'], supported_durations: [5, 3],
        supported_frame_images: ['first_frame'], upscale_factor: null, creativity: null, generate_audio: false, seed: true,
        pricing_skus: { cents_per_video_output_second_480p: '0.5', cents_per_video_output_second_720p: '1' } },
      { id: 'fake/new-edit', name: 'NewLab: New Edit', supported_resolutions: null, supported_durations: null, supported_frame_images: null, pricing_skus: { cents_per_second_output: '10' } },
    ] })
    if (p === '/api/v1/models' && u.searchParams.get('output_modalities') === 'speech') return json({ data: [
      { id: 'fake/tts', name: 'Fake: Speech', pricing: { prompt: '0', completion: '0' }, supported_voices: ['x'] },
      { id: 'fake/new-tts', name: 'NewLab: New Voice', pricing: { prompt: '0.00001', completion: '0' }, supported_voices: ['ava', 'max'] },
    ] })
    if (p === '/api/v1/images') {
      if (body.model === 'fake/broke') return json({ error: { message: 'Insufficient credits' } }, 402)
      if (body.model === 'fake/busy') return json({ error: { message: 'slow down' } }, 429)
      return json({ created: 1793306772, data: Array.from({ length: body.n ?? 1 }, () => ({ b64_json: png.toString('base64'), media_type: 'image/png' })),
        usage: { prompt_tokens: 17, completion_tokens: 272, total_tokens: 289, cost: 0.039 } })
    }
    if (p === '/api/v1/videos' && req.method === 'POST') {
      // the fields first (a number each, among the model's values), then the references: a video or a sound only by HTTPS
      for (const [k, name, ok, values] of [['creativity', 'Creativity', v => [0, 1].includes(v), '0, 1'], ['upscale_factor', 'Upscale factor', v => v >= 1.5 && v <= 3, '1.5-3']]) {
        if (!(k in body)) continue
        if (typeof body[k] !== 'number') return json({ success: false, error: { name: 'ZodError', message: `[{"expected":"number","code":"invalid_type","path":["${k}"],"message":"Invalid input: expected number, received ${typeof body[k]}"}]` } }, 400)
        if (!ok(body[k])) return json({ error: { message: `${name} ${body[k]} is not supported for this model. Supported values: ${values}`, code: 400, metadata: { failed_routing_step: 'Validate Video Parameters' } } }, 400)
      }
      // a length of 1 s or more: OpenRouter refuses Seedance's -1 (« follow the video »), 2026-10-31
      if ('duration' in body && !(body.duration >= 1)) return json({ success: false, error: { name: 'ZodError', message: '[{"origin":"number","code":"too_small","minimum":1,"path":["duration"],"message":"Too small: expected number to be >=1"}]' } }, 400)
      const bad = (body.input_references ?? []).findIndex(r => ['video_url', 'audio_url'].includes(r.type) && !r[r.type].url.startsWith('https://'))
      if (bad >= 0) return json({ error: { message: `Invalid reference URL: input_references[${bad}].${body.input_references[bad].type}.url: Only HTTPS URLs are allowed`, code: 400 } }, 400)
      // what a provider does with an https file: HEAD, then GET, through the (fake) tunnel
      for (const r of body.input_references ?? []) {
        const tunnel = r[r.type].url.match(/^https:\/\/fake-(\d+)\.trycloudflare\.com(\/.*)$/)
        if (!tunnel) continue
        const local = `http://127.0.0.1:${tunnel[1]}${tunnel[2]}`, head = await fetch(local, { method: 'HEAD' }).catch(() => null), get = await fetch(local).catch(() => null)
        fetched.push({ port: +tunnel[1], head: head?.status, type: head?.headers.get('content-type'), length: +head?.headers.get('content-length'), bytes: get?.ok ? (await get.arrayBuffer()).byteLength : null })
        if (!get?.ok) return json({ error: { message: `Failed to fetch ${r.type}: ${get?.status ?? 'unreachable'}`, code: 400 } }, 400)
      }
      const id = `gen-vid-${calls.length}`
      polls[id] = 0
      return json({ id, polling_url: `${base}/api/v1/videos/${id}`, status: 'pending' }, 202)
    }
    if (/^\/api\/v1\/videos\/gen-vid-\d+\/content$/.test(p)) return bytes(mp4, 'video/mp4')
    if (/^\/api\/v1\/videos\/gen-vid-\d+$/.test(p)) {
      const id = p.split('/').pop(), job = { id, generation_id: id, polling_url: `${base}/api/v1/videos/${id}` }
      const status = ['pending', 'in_progress'][polls[id]++] ?? 'completed'
      return json(status === 'completed' ? { ...job, status, unsigned_urls: [`${base}/api/v1/videos/${id}/content?index=0`], usage: { cost: 0.6, is_byok: false } } : { ...job, status })
    }
    if (p === '/api/v1/audio/speech') {
      if (body.model === 'fake/pcm-tts' && body.response_format !== 'pcm') return json({ error: { message: 'HeyGen Voice only supports response_format "pcm".', code: 400 } }, 400)
      return bytes(body.response_format === 'pcm' ? pcm : mp3, body.response_format === 'pcm' ? 'audio/pcm;rate=44100;channels=1' : 'audio/mpeg', { 'x-generation-id': `g${calls.length}` })
    }
    // a song (Lyria): chat completions with audio out, streamed in pieces of base64, its words as the transcript
    if (p === '/api/v1/chat/completions') {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const half = Math.floor(mp3.length / 2), id = `g${calls.length}`
      for (const part of [mp3.subarray(0, half), mp3.subarray(half)]) res.write(`data: ${JSON.stringify({ id, choices: [{ delta: { audio: { data: part.toString('base64') } } }] })}\n\n`)
      res.write(`data: ${JSON.stringify({ id, choices: [{ delta: { audio: { transcript: '[Verse] la la' } } }] })}\n\ndata: [DONE]\n\n`)
      return res.end()
    }
    // the stats answer 404 for a while after the generation (10 to 15 s on 2026-10-29)
    if (p === '/api/v1/generation') {
      const id = u.searchParams.get('id')
      return (lookups[id] = (lookups[id] ?? 0) + 1) <= 8 ? json({ error: { message: `Generation ${id} not found`, code: 404 } }, 404) : json({ data: { total_cost: 0.0021 } })
    }
    if (p === '/api/v1/key') return json({ data: { limit: 20, limit_remaining: 18.62, usage_monthly: 1.38 } })
    // the account's balance, for a management key only
    if (p === '/api/v1/credits') return req.headers.authorization === 'Bearer k-mgmt' ? json({ data: { total_credits: 20, total_usage: 6.29 } }) : json({ error: { message: 'Only management keys can perform this operation.', code: 403 } }, 403)
    // DNS over HTTPS: a new tunnel's name answers after a few lookups
    if (p === '/dns-query') {
      const name = u.searchParams.get('name')
      return (names[name] = (names[name] ?? 0) + 1) <= 2 ? json({ Status: 3 }) : json({ Status: 0, Answer: [{ name, type: 1, data: '104.16.231.132' }] })
    }
    // ElevenLabs
    if (p === '/el/v1/user/subscription') {
      if (pending && ++reads > 2) [used, pending, reads] = [used + pending, 0, 0]
      return json({ character_count: used, character_limit: 10000, next_character_count_reset_unix: 1794787200 })
    }
    if (p.startsWith('/el/v1/voice-changer/')) {
      // a free plan's answer to a format of the Creator tier
      if (u.searchParams.get('output_format') === 'mp3_44100_192') return json({ detail: { type: 'authorization_error', code: 'subscription_required', message: "Output format 'mp3_44100_192' is only available on the Creator tier and above.", status: 'output_format_not_allowed' } }, 403)
      pending += 50
      return bytes(mp3, 'audio/mpeg')
    }
    // the Voice Isolator: the voice alone, billed by the minute
    if (p === '/el/v1/audio-isolation') {
      pending += 50
      return bytes(mp3, 'audio/mpeg')
    }
    // a scoped key without the permission of dubbing; a free plan refused instant voice cloning
    if (p === '/el/v1/dubbing/project') return json({ detail: { type: 'authentication_error', code: 'unauthorized', message: 'The API key you used is missing the permission dubbing_write to execute this operation.', status: 'missing_permissions' } }, 401)
    if (p === '/el/v1/voices/add') return json({ detail: { type: 'payment_required', code: 'paid_plan_required', message: 'Your subscription does not include instant voice cloning. Please upgrade your plan.', status: 'can_not_use_instant_voice_cloning' } }, 400)
    // its speech models (GET /v1/models, the real one's shape of 2026-10-31, cut down), text to speech and dialogue:
    // an MP3, what it billed in character-cost
    if (p === '/el/v1/models') {
      const m = (model_id, name, x, more = {}) => ({ model_id, name, can_do_text_to_speech: true, can_use_style: false, can_use_speaker_boost: false, maximum_text_length_per_request: 10000,
        model_rates: { character_cost_multiplier: x, cost_discount_multiplier: 1 }, languages: [{ language_id: 'en', name: 'English' }, { language_id: 'fr', name: 'French' }], ...more })
      return json([m('eleven_v4', 'Eleven v4', 1), m('eleven_v4_turbo', 'Eleven v4 Turbo', 0.5), m('eleven_v3', 'Eleven v3', 1, { maximum_text_length_per_request: 5000 }),
        m('eleven_multilingual_v2', 'Eleven Multilingual v2', 1, { can_use_style: true, can_use_speaker_boost: true }), m('eleven_flash_v2_5', 'Eleven Flash v2.5', 0.5, { maximum_text_length_per_request: 40 }),
        { model_id: 'eleven_multilingual_sts_v2', name: 'Eleven Multilingual v2 (speech to speech)', can_do_text_to_speech: false }])
    }
    if (p.startsWith('/el/v1/text-to-speech/') || p === '/el/v1/text-to-dialogue') {
      const chars = body.text?.length ?? body.inputs.reduce((n, l) => n + l.text.length, 0)
      return bytes(mp3, 'audio/mpeg', { 'character-cost': String(Math.ceil(chars * (body.model_id === 'eleven_v4_turbo' ? 0.5 : 1))) })
    }
    if (p === '/el/v2/voices') return json({ voices: [{ voice_id: 'v1', name: 'Arthur', category: 'premade', labels: { gender: 'male' }, verified_languages: [{ language: 'en' }] }], has_more: false })
    // Kie.ai (under /kie, its upload under /kieup, its docs under /kiedocs, its files under /kiefiles), as it answered on
    // 2026-10-31: HTTP 200 with its own code in the body; the 21st new task in 10 s is a 429 (kie.window)
    const kieOk = data => json({ code: 200, msg: 'success', data })
    if (p.startsWith('/kie/') && !p.startsWith('/kie/client/') && p !== '/kie/api/v1/playground/model-paths' && req.headers.authorization !== 'Bearer k-kie')
      return json({ code: 401, msg: 'Unauthorized – Authentication failed.' })
    if (p === '/kie/api/v1/chat/credit') return kieOk(1080)
    if (p === '/kie/client/v1/model-pricing/page') {
      const rows = Object.entries(kie.prices).map(([modelDescription, [credits, unit]]) => ({ modelDescription, interfaceType: 'image', creditPrice: String(credits), creditUnit: unit, usdPrice: String(credits * 0.005) }))
      const page = body.pageNum, size = body.pageSize
      if (size > 100) return json({ code: 422, msg: '分页参数不能超过100', data: null })
      return kieOk({ records: rows.slice((page - 1) * size, page * size), total: rows.length, pages: Math.ceil(rows.length / size) })
    }
    if (p === '/kie/api/v1/playground/model-paths') return kieOk(['fake-t2i', 'fake-i2i', 'fake-vid', 'newlab/new-video', 'newlab/needs-mask'])
    if (p === '/kiedocs/llms.txt') return bytes(`- [New video](${base}/kiedocs/market/newlab/new-video.md)\n- [Mask](${base}/kiedocs/market/newlab/needs-mask.md)\n`, 'text/plain')
    if (p.startsWith('/kiedocs/market/newlab/')) {
      const name = `newlab/${path.basename(p, '.md')}`, mask = name.endsWith('needs-mask')
      return bytes(`# NewLab ${mask ? 'Needs Mask' : 'New Video'}\n\n\`\`\`yaml\npaths:\n  /api/v1/jobs/createTask:\n    post:\n      tags:\n        - docs/en/Market/Video Models/NewLab\n      requestBody:\n        content:\n          application/json:\n            schema:\n              properties:\n                model:\n                  type: string\n                  enum:\n                    - ${name}\n                input:\n                  type: object\n                  properties:\n                    prompt:\n                      type: string\n                    ${mask ? 'mask_url' : 'first_frame_url'}:\n                      type: string\n                    resolution:\n                      type: string\n                      enum:\n                        - 720P\n                        - 480P\n                    duration:\n                      type: string\n                      enum:\n                        - '5'\n                        - '3'\n                  required:\n                    - prompt\n${mask ? '                    - mask_url\n' : ''}\`\`\`\n`, 'text/markdown')
    }
    if (p === '/kieup/api/file-base64-upload' || p === '/kieup/api/file-stream-upload') {
      const n = kie.uploads.push({ route: p, size: raw.length, type: req.headers['content-type'] })
      return kieOk({ success: true, downloadUrl: `${base}/kiefiles/upload-${n}`, fileSize: raw.length })
    }
    if (p === '/kie/api/v1/jobs/createTask') {
      const now = Date.now()
      kie.window = kie.window.filter(t => now - t < 10e3)
      if (kie.window.length >= (kie.rate ?? 20) || kie.busy-- > 0) return json({ code: 429, msg: 'Your call frequency is too high. Please try again later.', data: null })
      kie.window.push(now)
      if (!body?.input) return json({ code: 422, msg: 'The input cannot be null', data: null })
      if (body.model === 'fake-broke') return json({ code: 402, msg: 'Credits insufficient', data: null })
      const id = `kie-task-${calls.length}`
      kie.tasks[id] = { model: body.model, input: body.input, polls: 0 }
      // Suno's timed lyrics answer at once (code and data inside data), no task to follow
      if (body.model === 'ai-music-api/timeStamped-lyrics') return kieOk({ code: 200, msg: 'success', data: { alignedWords: [{ word: 'la', startS: 0.2, endS: 0.6 }, { word: 'la', startS: 0.7, endS: 1 }] } })
      // a persona too: its id in data
      if (body.model === 'ai-music-api/generate-persona') return kieOk({ persona_id: 'persona-1', name: body.input.name })
      // a voice's recording: its validation phrase's task succeeds
      if (body.model === 'ai-music-api/create-voice' && kie.tasks[body.input.task_id]) kie.tasks[body.input.task_id].voiced = true
      return kieOk({ taskId: id })
    }
    if (p === '/kie/api/v1/jobs/recordInfo') {
      const id = u.searchParams.get('taskId'), t = kie.tasks[id]
      if (!t) return json({ code: 422, msg: 'recordInfo is null', data: null })
      // Suno's validation phrase waits for the recording (« generating », its phrase already there) until create-voice
      if (t.model === 'ai-music-api/validation-phrase')
        return kieOk({ taskId: id, model: t.model, state: t.voiced ? 'success' : 'generating', resultJson: t.polls++ ? JSON.stringify({ msg: 'success', code: 200, data: { verify_phrase_text: 'the moon sings softly', verify_phrase_id: 'p-1' }, task_id: id }) : '' })
      const state = ['waiting', 'generating'][t.polls++] ?? (t.model === 'fake-fail' ? 'fail' : 'success')
      // Suno (its docs, 2026-10-31): a song's two takes under response.data, the rest in resultJson (resultUrls, resultObject)
      const suno = t.model.startsWith('ai-music-api/') && t.model.split('/')[1], done = state === 'success'
      if (suno && ['generate', 'extend', 'upload-and-extend-audio', 'upload-and-cover-audio', 'add-vocals', 'add-instrumental', 'replace-section', 'mashup'].includes(suno))
        return kieOk({ taskId: id, model: t.model, state, resultJson: '', creditsConsumed: done ? 12 : null,
          response: done ? { data: [1, 2].map(n => ({ id: `${id}-take-${n}`, audio_url: `${base}/kiefiles/out.mp3`, image_url: `${base}/kiefiles/out.png`, title: t.input.title ?? 'Song', tags: t.input.style ?? 'pop', prompt: '[Verse]\nla la', duration: 1 })) } : null })
      const object = { 'separate-vocals': { origin_data: [{ id: 'stem-v', stem_name: 'vocals' }, { id: 'stem-i', stem_name: 'instrumental' }] }, 'timeStamped-lyrics': { aligned_words: [{ word: 'la', start_s: 0.2, end_s: 0.6 }, { word: 'la', start_s: 0.7, end_s: 1 }] },
        'generate-persona': { personaId: 'persona-1' }, 'generate-lyrics': { lyricsData: [{ title: 'Night', text: '[Verse]\nroad' }, { title: 'Drive', text: '[Verse]\nlights' }] }, 'boost-music-style': {},
        'validation-phrase': { phrase: 'the moon sings softly' }, 'create-voice': { voiceId: 'voice-1' }, 'generate-midi-from-audio': { instruments: [{ name: 'Voice', notes: [{ pitch: 60, start: 0, end: 0.5 }] }] } }[suno]
      const urls = { 'separate-vocals': ['vocals.mp3', 'instrumental.mp3'], 'convert-to-wav-format': ['out.wav'], 'create-music-video': ['out.mp4'], 'sounds': ['out.mp3'] }[suno]
      // Boost style's text comes among its « URLs » (2026-10-31)
      const texts = suno === 'boost-music-style' ? ['dreamy synthwave, airy female vocals, 100 BPM'] : []
      if (suno) return kieOk({ taskId: id, model: t.model, state, resultJson: done ? JSON.stringify({ resultUrls: [...(urls ?? []).map(u => `${base}/kiefiles/${u}`), ...texts], resultObject: object ?? {} }) : '', creditsConsumed: done ? 2 : null })
      const file = /vid|edit|avatar|kling|grok|s2v/.test(t.model) ? 'out.mp4' : /tts|gem/.test(t.model) ? 'out.mp3' : 'out.png'
      // the last frame beside, when asked
      return kieOk({ taskId: id, model: t.model, state, resultJson: state === 'success' ? JSON.stringify({ resultUrls: [`${base}/kiefiles/${file}`], ...(t.input?.return_last_frame ? { lastFrameUrl: `${base}/kiefiles/last.jpg` } : {}) }) : '',
        failCode: state === 'fail' ? '500' : '', failMsg: state === 'fail' ? 'Content flagged' : '', creditsConsumed: state === 'success' ? kie.credits[t.model] ?? 10 : null })
    }
    if (p === '/kiefiles/out.png') return bytes(png, 'image/png')
    if (p === '/kiefiles/last.jpg') return bytes(png, 'image/jpeg')
    if (p === '/kiefiles/out.mp4') return bytes(mp4, 'video/mp4')
    if (/^\/kiefiles\/(out|vocals|instrumental)\.(mp3|wav)$/.test(p)) return bytes(mp3, 'audio/mpeg')
    if (p.startsWith('/kiefiles/upload-')) return bytes(png, 'image/png')
    json({ error: { message: `fake: nothing at ${p}` } }, 404)
  })
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, bin, calls, fetched, catalog, kie, close: () => { server.closeAllConnections(); server.close() } }
}
