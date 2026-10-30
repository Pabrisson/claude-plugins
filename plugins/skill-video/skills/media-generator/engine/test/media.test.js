import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { startFake } from './fake-api.js'

// the CLI and the dashboard's server on a throwaway folder, against the fake OpenRouter and ElevenLabs
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'media-gen-'))
const engine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'media.mjs')
const fake = await startFake(home)
const env = { ...process.env, MEDIA_GENERATOR_DIR: home, MEDIA_GENERATOR_MODELS: path.join(path.dirname(engine), 'test', 'models.json'), OPENROUTER_BASE: `${fake.base}/api/v1`, OPENROUTER_API_KEY: 'k-test', OPENROUTER_MANAGEMENT_KEY: 'k-mgmt',
  ELEVENLABS_BASE: `${fake.base}/el`, ELEVENLABS_API_KEY: 'k-el', MEDIA_GENERATOR_POLL: '20', VIDEO_EDITOR_POLL: '20',
  // the fake cloudflared first, and the fake public DNS
  PATH: `${fake.bin}${path.delimiter}${process.env.PATH}`, MEDIA_GENERATOR_DOH: `${fake.base}/dns-query` }
// asynchronous: the fake server answers in this very process
const cliWith = (e, ...argv) => new Promise(ok => {
  const c = spawn(process.execPath, [engine, ...argv], { cwd: home, env: e })
  let out = '', err = ''
  c.stdout.on('data', d => (out += d))
  c.stderr.on('data', d => (err += d))
  c.on('close', code => ok({ code, out, err }))
})
const cli = (...argv) => cliWith(env, ...argv)
const at = (...p) => path.join(home, ...p)
const ledger = () => fs.readFileSync(at('ledger.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
const sent = route => fake.calls.filter(c => c.path === route).at(-1)
const media = () => (fs.existsSync(at('media')) ? fs.readdirSync(at('media')) : [])
const probe = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', f], { encoding: 'utf8' }))
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=64x64', '-frames:v', '1', at('a.png')])
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25:d=3', '-f', 'lavfi', '-i', 'sine=d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest', at('talk.mp4')])
test.after(() => { fake.close(); fs.rmSync(home, { recursive: true, force: true }) })

test('the catalogs: tools from the engine, models from its own list in one shape, never fetched', async () => {
  const t = await cli('tools', 'video', '--search', 'dolly')
  assert.match(t.out, /video dolly-zoom-in \(create, Camera\)/)
  assert.match(t.out, /--field speed=slow\|steady\|fast/)
  const m = await cli('models', 'video')
  assert.match(m.out, /openrouter:fake\/vid {2}Fake: Video {2}\[5–10 s, 720p\/1080p, first_frame\+last_frame, audio\]/)
  assert.ok(!fake.calls.some(c => c.path.includes('models')), 'no catalog request')
})

// the list is edited by hand: each model keeps its kind's keys, in order, and its lists sorted
test('the shipped model list is normalized', () => {
  const list = JSON.parse(fs.readFileSync(path.join(path.dirname(engine), 'providers', 'openrouter-models.json'), 'utf8'))
  const keys = {
    image: ['id', 'lab', 'name', 'role', 'resolutions', 'aspect_ratios', 'max_images', 'references', 'quality', 'background', 'seed', 'pricing'],
    video: ['id', 'lab', 'name', 'role', 'resolutions', 'aspect_ratios', 'durations', 'frames', 'sound', 'seed', 'upscale', 'pricing'],
    speech: ['id', 'lab', 'name', 'role', 'voices', 'pricing'],
  }
  const roles = { image: ['create', 'both', 'edit'], video: ['generate', 'edit', 'upscale', 'avatar'], speech: ['speech'] }
  const RES = ['360p', '432p', '480p', '540p', '720p', '768p', '1080p', '1440p', '512', '768', '1K', '1.5K', '2K', '4K']
  const ratio = r => (r === 'auto' ? Infinity : r.split(':').reduce((a, b) => a / b))
  const sorted = (l, by) => assert.deepEqual(l, l.toSorted((a, b) => by(a) - by(b)))
  for (const kind of Object.keys(keys)) {
    assert.ok(list[kind].length > 0, kind)
    for (const m of list[kind]) {
      assert.deepEqual(Object.keys(m), keys[kind], m.id)
      assert.ok(roles[kind].includes(m.role), `${m.id}: role ${m.role}`)
      if (m.resolutions) (assert.ok(m.resolutions.every(r => RES.includes(r)), `${m.id}: ${m.resolutions}`), sorted(m.resolutions, r => RES.indexOf(r)))
      if (m.aspect_ratios) sorted(m.aspect_ratios, ratio)
      if (m.durations) sorted(m.durations, d => d)
    }
    assert.equal(new Set(list[kind].map(m => m.id)).size, list[kind].length, `${kind}: an id twice`)
  }
})

test('an image: the estimate and exit 2 before the yes, nothing made; then the image, its real cost in the ledger', async () => {
  const no = await cli('image', '--prompt', 'a red fox', '--model', 'fake/img')
  assert.equal(no.code, 2)
  assert.equal(JSON.parse(no.out.trim()).estimate.amount, 0.04)
  assert.match(no.err, /then --spend 0.04/)
  assert.deepEqual(media(), [])
  const r = await cli('image', '--prompt', 'a red fox', '--model', 'fake/img', '--in', `references=${at('a.png')}`, '--spend', '0.04')
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /cost: \$0\.039\n/)
  const body = sent('/api/v1/images').body
  assert.equal(body.prompt, 'a red fox')
  assert.equal(body.input_references.length, 1)
  assert.match(body.input_references[0].image_url.url, /^data:image\/png;base64,/)
  assert.ok(!('aspect_ratio' in body), 'an edit keeps its image\'s ratio')
  const [line] = ledger()
  assert.deepEqual([line.provider, line.model, line.unit, line.estimate, line.actual, line.actual_known, line.by, line.status], ['openrouter', 'fake/img', 'usd', 0.04, 0.039, true, 'claude', 'done'])
  const [id] = media()
  assert.ok(fs.existsSync(at('media', id, 'out-1.png')))
  assert.ok(fs.existsSync(at('media', id, 'in-references-1.png')), 'the inputs are copied in for a remix')
})

test('a tool: its template filled from the fields, its inputs sent in order', async () => {
  const r = await cli('image', '--tool', 'face-swap', '--model', 'openrouter:fake/img', '--in', `image=${at('a.png')}`, '--in', `face=${at('a.png')}`, '--spend', '1')
  assert.equal(r.code, 0, r.err)
  const body = sent('/api/v1/images').body
  assert.match(body.prompt, /^Replace the face of the person in the first image with the face of the person in the second image\./)
  assert.equal(body.input_references.length, 2)
  const miss = await cli('image', '--tool', 'face-swap', '--model', 'fake/img', '--in', `image=${at('a.png')}`)
  assert.match(miss.err, /Face swap needs face \(--in face=<file>\)/)
  // an @Element brings its images
  assert.match((await cli('elements', 'add', 'Lulu', at('a.png'))).out, /@Lulu: 1 images/)
  const e = await cli('image', '--prompt', '@Lulu in a café', '--model', 'fake/img', '--estimate')
  assert.equal(JSON.parse(e.out).prompt, 'Lulu in a café')
})

test('an unknown price needs its own yes; a refused payment (402) fails with exit 3, logged at no cost', async () => {
  const u = await cli('image', '--prompt', 'x', '--model', 'fake/noprice', '--spend', '5')
  assert.equal(u.code, 2)
  assert.match(u.err, /unknown cost, the user's yes then --accept-unknown/)
  assert.equal((await cli('image', '--prompt', 'x', '--model', 'fake/noprice', '--accept-unknown')).code, 0)
  const b = await cli('image', '--prompt', 'x', '--model', 'fake/broke', '--spend', '0.04')
  assert.equal(b.code, 3)
  assert.match(b.err, /402 \(no credits left on OpenRouter\)/)
  const last = ledger().at(-1)
  assert.deepEqual([last.status, last.actual], ['failed', 0])
})

test('the monthly cap and the threshold: none by default; a cap stops even a --spend, --force passes', async () => {
  assert.match((await cli('setup')).out, /openrouter: threshold not set · cap not set/)
  await cli('setup', 'set', 'openrouter.cap=0.1')
  const c = await cli('image', '--prompt', 'x', '--model', 'fake/img', '--spend', '0.04')
  assert.equal(c.code, 2)
  assert.match(c.err, /over this month's cap/)
  assert.equal((await cli('image', '--prompt', 'x', '--model', 'fake/img', '--spend', '0.04', '--force')).code, 0)
  await cli('setup', 'set', 'openrouter.cap=none')
  assert.match((await cli('setup', 'set', 'openrouter.cap=lots')).err, /is a number, or none/)
})

test('a video: a job submitted with its frames and settings (the ratio of its image), polled, downloaded; the cost the router reports', async () => {
  const r = await cli('video', '--tool', 'dolly-zoom-in', '--model', 'fake/vid', '--in', `first_frame=${at('a.png')}`, '--field', 'subject=the dancer', '--duration', '10', '--sound', 'off', '--spend', '1')
  assert.equal(r.code, 0, r.err)
  const body = sent('/api/v1/videos').body
  assert.match(body.prompt, /^Dolly zoom \(vertigo effect\) on the dancer: the camera dollies in at a steady pace/)
  assert.deepEqual([body.duration, body.generate_audio, body.resolution, body.aspect_ratio, body.frame_images[0].frame_type], [10, false, '1080p', '1:1', 'first_frame'])
  assert.match(r.out, /rendering on Fake: Video/)
  const line = ledger().at(-1)
  assert.deepEqual([line.estimate, line.actual], [1, 0.6])
  const id = media().find(d => d.includes('dolly'))
  assert.ok(probe(at('media', id, 'out.mp4')).streams.some(s => s.codec_type === 'video'))
})

test('talking avatar: the photo goes as a reference (the model takes no frame), the voice by the tunnel, its length the voice\'s', async () => {
  const r = await cli('video', '--tool', 'talking-avatar', '--model', 'fake/avatar-iv', '--in', `first_frame=${at('a.png')}`, '--in', `audio=${at('talk.mp4')}`, '--spend', '0.15')
  assert.equal(r.code, 0, r.err)
  const body = sent('/api/v1/videos').body
  assert.ok(!('frame_images' in body))
  assert.deepEqual([body.input_references[0].type, body.input_references[1].type, body.aspect_ratio], ['image_url', 'audio_url', undefined])
  assert.match(body.input_references[0].image_url.url, /^data:image\/png;base64,/)
  assert.match(body.input_references[1].audio_url.url, /^https:\/\/fake-\d+\.trycloudflare\.com\/[0-9a-f]{32}\/1\.mp4$/)
  assert.equal(body.prompt, 'The person speaks the audio, natural lip-sync and facial expressions.', 'an empty field leaves no ",."')
  assert.equal(ledger().at(-1).estimate, 0.15)
})

test('upscale: the video by a tunnel open for the job only, served whole with its type; creativity and factor as the numbers the router takes', async () => {
  const r = await cli('video', '--tool', 'upscale', '--model', 'fake/flux-video-upscale', '--in', `video=${at('talk.mp4')}`, '--field', 'creativity=creative', '--field', 'factor=1.5', '--spend', '1')
  assert.equal(r.code, 0, r.err)
  const body = sent('/api/v1/videos').body
  assert.deepEqual([body.creativity, body.upscale_factor, body.prompt], [1, 1.5, undefined])
  assert.match(body.input_references[0].video_url.url, /^https:\/\/fake-\d+\.trycloudflare\.com\/[0-9a-f]{32}\/1\.mp4$/)
  const got = fake.fetched.at(-1), size = fs.statSync(at('talk.mp4')).size
  assert.deepEqual([got.head, got.type, got.length, got.bytes], [200, 'video/mp4', size, size])
  // submitted once the tunnel's name answered on the public DNS, closed once the job ended
  const order = fake.calls.map(c => c.path.split('?')[0])
  assert.ok(order.lastIndexOf('/dns-query') < order.lastIndexOf('/api/v1/videos'))
  assert.match(r.out, /opening a tunnel for Fake: Upscale to fetch the video…[\s\S]*submitted[\s\S]*tunnel closed/)
  assert.equal(await fetch(`http://127.0.0.1:${got.port}/`).then(() => 'open', () => 'closed'), 'closed')
  // without cloudflared: what to install, nothing sent
  const tools = fs.mkdtempSync(path.join(os.tmpdir(), 'no-cloudflared-'))
  for (const t of ['ffmpeg', 'ffprobe']) fs.symlinkSync(execFileSync('which', [t], { encoding: 'utf8' }).trim(), path.join(tools, t))
  const before = fake.calls.filter(c => c.path === '/api/v1/videos').length
  const no = await cliWith({ ...env, PATH: `${tools}${path.delimiter}/usr/bin${path.delimiter}/bin` }, 'video', '--tool', 'upscale', '--model', 'fake/flux-video-upscale', '--in', `video=${at('talk.mp4')}`, '--spend', '1')
  assert.equal(no.code, 1)
  assert.match(no.err, /brew install cloudflared/)
  assert.equal(fake.calls.filter(c => c.path === '/api/v1/videos').length, before)
  assert.ok(!ledger().some(l => l.status === 'failed' && l.tool === 'upscale'), 'stopped before the yes: no job, no ledger line')
})

test('extend: the last frame starts the new shot, joined after the source; reframe: local, free, the new ratio', async () => {
  const e = await cli('video', '--tool', 'extend', '--model', 'fake/vid', '--in', `video=${at('talk.mp4')}`, '--field', 'next=she walks away', '--spend', '1')
  assert.equal(e.code, 0, e.err)
  assert.deepEqual([sent('/api/v1/videos').body.frame_images[0].frame_type, sent('/api/v1/videos').body.aspect_ratio], ['first_frame', '16:9'])
  const id = media().filter(d => d.includes('extend')).at(-1)
  assert.ok(+probe(at('media', id, 'extended.mp4')).format.duration > 4.5)
  const f = await cli('video', '--tool', 'reframe', '--in', `video=${at('talk.mp4')}`, '--field', 'ratio=1:1', '--field', 'focus=0.2')
  assert.equal(f.code, 0, f.err)
  const v = probe(at('media', media().find(d => d.includes('reframe')), 'out.mp4')).streams.find(s => s.codec_type === 'video')
  assert.equal(v.width, v.height)
  assert.ok(!ledger().some(l => l.tool === 'reframe'), 'nothing to log for a free local tool')
})

test('rich fields: an Auto option leaves nothing in the prompt, a label stands for its value, the moves come in order', async () => {
  const est = async (...argv) => JSON.parse((await cli(...argv, '--estimate')).out)
  const a = await est('image', '--tool', 'cinematic-camera', '--model', 'fake/img', '--prompt', 'a man', '--field', 'body=Auto', '--field', 'lens=Auto', '--field', 'shot=close-up')
  assert.equal(a.prompt, 'a man. 35mm focal length, f/2.8: matching depth of field, perspective and lens rendering. close-up. A cinematic, photorealistic film still.')
  const v = await est('video', '--tool', 'cinematic-camera', '--model', 'fake/vid', '--prompt', 'a dancer', '--field', 'movement=dolly in, then pan left', '--field', 'tempo=Calm')
  assert.match(v.prompt, /^a dancer\. Shot on ARRI Alexa 35, Cooke S4 spherical prime lens, 35mm focal length, f\/2\.8\. Camera: dolly in, then pan left\. calm, slow pacing\. Cinematic/)
  const f = await cli('video', '--tool', 'cinematic-camera', '--model', 'fake/vid', '--prompt', 'a dancer', '--in', `first_frame=${at('a.png')}`, '--in', `last_frame=${at('a.png')}`, '--spend', '1')
  assert.equal(f.code, 0, f.err)
  assert.deepEqual(sent('/api/v1/videos').body.frame_images.map(i => i.frame_type), ['first_frame', 'last_frame'])
  const r = await est('video', '--tool', 'relight-atmosphere', '--model', 'fake/vid', '--in', `video=${at('talk.mp4')}`, '--field', 'light=silhouette')
  assert.match(r.prompt, /^Relight the video: a strong bright backlight behind the subject, the subject reads as a dark silhouette/)
  const t = await cli('tools', 'video', '--search', 'cinematic')
  assert.match(t.out, /--field movement="<one>, then <another>" \(Static shot\|Dolly in\|/i)
  assert.match(t.out, /--field body=Auto\|ARRI Alexa 35\|/)
})

test('a batch: one yes for the total, as many jobs as asked, side by side; a seed goes up by one a job', async () => {
  const no = await cli('image', '--prompt', 'a kite', '--model', 'fake/img', '--batch', '3')
  assert.equal(no.code, 2)
  assert.deepEqual([JSON.parse(no.out.trim()).estimate.amount, JSON.parse(no.out.trim()).estimate.detail.startsWith('3 × ')], [0.12, true])
  const before = media().length, lines = ledger().length
  const r = await cli('image', '--prompt', 'a kite', '--model', 'fake/img', '--batch', '3', '--spend', '0.12')
  assert.equal(r.code, 0, r.err)
  assert.deepEqual([media().length - before, ledger().length - lines, (r.out.match(/^done: /gm) ?? []).length], [3, 3, 3])
  const calls = fake.calls.filter(c => c.path === '/api/v1/videos' && c.method === 'POST').length
  const s = await cli('video', '--prompt', 'waves', '--model', 'fake/vid', '--seed', '7', '--batch', '2', '--spend', '2')
  assert.equal(s.code, 0, s.err)
  assert.deepEqual(fake.calls.filter(c => c.path === '/api/v1/videos' && c.method === 'POST').slice(calls).map(c => c.body.seed).sort(), [7, 8])
})

test('expand: the image on its larger frame, gray margins, at the model\'s closest ratio; no frame, nothing sent', async () => {
  const none = await cli('image', '--tool', 'expand', '--model', 'fake/img', '--in', `image=${at('a.png')}`, '--estimate')
  assert.match(none.err, /drag the frame wider or taller first/)
  const r = await cli('image', '--tool', 'expand', '--model', 'fake/img', '--in', `image=${at('a.png')}`, '--field', 'left=0.5', '--field', 'right=0.5', '--spend', '0.04')
  assert.equal(r.code, 0, r.err)
  const body = sent('/api/v1/images').body, png = at('sent-canvas.png')
  fs.writeFileSync(png, Buffer.from(body.input_references[0].image_url.url.split(',')[1], 'base64'))
  const c = probe(png).streams[0]
  assert.deepEqual([c.width, c.height, body.aspect_ratio, body.input_references.length], [128, 64, '16:9', 1])
  assert.match(body.prompt, /^The image sits on a larger canvas with flat gray margins/)
  const job = JSON.parse(fs.readFileSync(at('media', media().filter(d => d.includes('expand')).at(-1), 'job.json'), 'utf8'))
  assert.deepEqual(Object.keys(job.spec.inputs), ['image'], 'the original is kept for a remix, not the canvas')
})

test('speech: a voice that only answers PCM is wrapped into an MP3 at its rate; its cost from the generation stats, once they answer', async () => {
  const r = await cli('audio', '--model', 'fake/pcm-tts', '--prompt', 'Hello there', '--voice', 'bo', '--spend', '1')
  assert.equal(r.code, 0, r.err)
  assert.equal(sent('/api/v1/audio/speech').body.voice, 'bo')
  assert.match(r.out, /cost: \$0\.002/)
  const id = media().find(d => d.includes('voice'))
  const mp3 = probe(at('media', id, 'out.mp3'))
  assert.ok(mp3.streams.some(s => s.codec_type === 'audio'))
  assert.ok(Math.abs(+mp3.format.duration - 1) < 0.1, `1 s at the rate its type says, not ${mp3.format.duration} s`)
})

test('change voice: through video.mjs and ElevenLabs, in credits; their dollars once a paid plan is set', async () => {
  const no = await cli('audio', '--tool', 'change-voice', '--in', `clip=${at('talk.mp4')}`, '--voice', 'v1')
  assert.equal(no.code, 2)
  assert.match(no.err, /: 50 credits \(voice change/)
  assert.match((await cli('setup', 'set', 'elevenlabs.plan=gold')).err, /elevenlabs\.plan is one of free, starter, creator, pro, scale, business, or none/)
  await cli('setup', 'set', 'elevenlabs.plan=starter')
  const r = await cli('audio', '--tool', 'change-voice', '--in', `clip=${at('talk.mp4')}`, '--voice', 'v1', '--spend', '50')
  assert.equal(r.code, 0, r.err)
  assert.match(r.out, /cost: 50 credits · \$0\.01\n/)
  const line = ledger().at(-1)
  assert.deepEqual([line.provider, line.unit, line.actual, line.actual_known, line.usd], ['elevenlabs', 'credits', 50, true, 0.01])
  assert.match(fake.calls.find(c => c.path.startsWith('/el/v1/voice-changer/v1')).path, /output_format=mp3_44100_128/)
})

test('refusals said in ElevenLabs\' words: a key without dubbing_write, a plan without voice cloning; nothing counted', async () => {
  const t = await cli('audio', '--tool', 'translate', '--in', `clip=${at('talk.mp4')}`, '--field', 'to=fr', '--spend', '150')
  assert.equal(t.code, 3)
  assert.match(t.err, /: 401 The API key you used is missing the permission dubbing_write to execute this operation\.\s*\(/)
  assert.deepEqual([ledger().at(-1).tool, ledger().at(-1).actual, ledger().at(-1).status], ['translate', 0, 'failed'])
  const c = await cli('voice-clone', 'Me', at('talk.mp4'))
  assert.equal(c.code, 1)
  assert.equal(c.err.trim(), 'error: ElevenLabs /v1/voices/add: 400 Your subscription does not include instant voice cloning. Please upgrade your plan.')
})

test('draft: Claude\'s prompt for the composer, nothing generated; credits: balances and this month', async () => {
  const before = media().length
  await cli('draft', '--space', 'video', '--tool', 'orbit', '--model', 'openrouter:fake/vid', '--prompt', 'slow orbit around the vase')
  const d = JSON.parse(fs.readFileSync(at('.cache', 'drafts.json'), 'utf8')).video
  assert.deepEqual([d.tool, d.prompt], ['orbit', 'slow orbit around the vase'])
  assert.equal(media().length, before)
  const c = await cli('credits')
  assert.match(c.out, /openrouter: \$13\.71 left on the account, \$18\.62 left on this key, \$1\.38 used this month/)
  assert.match(c.out, /elevenlabs: 8,950 credits · \$1\.79 left of 10000/)
  assert.match(c.out, /openrouter this month here: \$\d+\.\d+/)
})

test('the folder\'s .gitignore keeps the media, elements, ledger and settings, and drops the cache', () => {
  const gi = fs.readFileSync(at('.gitignore'), 'utf8')
  assert.match(gi, /^\.cache\/$/m)
  execFileSync('git', ['init', '-q'], { cwd: home })
  const ignored = f => { try { execFileSync('git', ['check-ignore', '-q', f], { cwd: home }); return true } catch { return false } }
  assert.deepEqual(['media/x/out.png', 'elements/Lulu/a.png', 'ledger.jsonl', 'settings.json', '.cache/models-video.json'].map(ignored), [false, false, false, false, true])
})

test('the server: state, estimate, a threshold asks first (409), a confirmed click runs to the end; it stops with its Claude', { timeout: 30000 }, async t => {
  const port = 42000 + Math.floor(Math.random() * 500), url = `http://127.0.0.1:${port}`
  const srv = spawn(process.execPath, [engine, 'serve'], { cwd: home, env: { ...env, MEDIA_GENERATOR_PORT: `${port}` } })
  t.after(() => srv.kill())
  for (let i = 0; i < 50; i++) { if (await fetch(url + '/__media-generator').then(r => r.ok).catch(() => false)) break; await new Promise(ok => setTimeout(ok, 100)) }
  const post = (p, body) => fetch(url + p, { method: 'POST', body: JSON.stringify(body) }).then(async r => ({ code: r.status, body: await r.json() }))
  const state = await fetch(url + '/api/state').then(r => r.json())
  assert.equal(state.home, home)
  assert.deepEqual(state.fake, { on: true, bases: [`${fake.base}/api/v1`, `${fake.base}/el`] }, 'the fake APIs, for the header\'s badge and toggle')
  // the toggle: off, the real APIs; on again, the fake
  assert.deepEqual((await post('/api/fake', { on: false })).body, { on: false, bases: state.fake.bases })
  assert.equal((await fetch(url + '/api/state').then(r => r.json())).fake.on, false)
  assert.equal((await post('/api/fake', { on: true })).body.on, true)
  assert.ok(state.media.length > 5)
  assert.equal(state.drafts.video.tool, 'orbit')
  const spec = { kind: 'image', tool: 'free', model: 'openrouter:fake/img', prompt: 'a lighthouse', inputs: {}, params: { n: 2 } }
  const est = await post('/api/estimate', spec)
  assert.deepEqual([est.body.estimate.amount, est.body.shown, est.body.needs], [0.08, '$0.08', null])
  await post('/api/settings', { openrouter: { threshold: 0.05 } })
  const ask = await post('/api/generate', spec)
  assert.deepEqual([ask.code, ask.body.needs, ask.body.shown], [409, 'threshold', '$0.08'])
  const go = await post('/api/generate', { ...spec, confirm: true })
  assert.equal(go.code, 200)
  let job
  for (let i = 0; i < 100 && job?.status !== 'done'; i++) { await new Promise(ok => setTimeout(ok, 100)); job = (await fetch(url + '/api/state').then(r => r.json())).media.find(m => m.id === go.body.id) }
  assert.deepEqual([job.status, job.by, job.outputs], ['done', 'dashboard', ['out-1.png', 'out-2.png']])
  assert.equal((await fetch(`${url}/files?path=${encodeURIComponent(at('media', job.id, 'out-1.png'))}`)).headers.get('content-type'), 'image/png')
  assert.equal((await fetch(`${url}/files?path=${encodeURIComponent('/etc/hosts')}`)).status, 404)
  // a batch from the dashboard: its total asks first, then as many jobs
  const batch = { ...spec, params: {}, batch: 2 }
  assert.deepEqual([(await post('/api/estimate', batch)).body.shown, (await post('/api/generate', batch)).code], ['$0.08', 409])
  assert.equal((await post('/api/generate', { ...batch, confirm: true })).body.ids.length, 2)
  // a frame of a video at a moment, to paint a mask on
  const frame = await post('/api/frame', { path: at('talk.mp4'), t: 1.5 })
  assert.equal(probe(frame.body.path).streams[0].width, 320)
  // Edit reference: a sent video cut to 0.5–2 s and to its left half, as a new file with its sound; the original stays
  const cut = await post('/api/cut', { path: at('talk.mp4'), start: 0.5, end: 2, crop: { x: 0, y: 0, w: 0.5, h: 1 } }), c = probe(cut.body.path), v = c.streams.find(s => s.codec_type === 'video')
  assert.deepEqual([path.dirname(cut.body.path), v.width, v.height, c.streams.some(s => s.codec_type === 'audio')], [at('.cache', 'uploads'), 160, 180, true])
  assert.ok(Math.abs(c.format.duration - 1.5) < 0.1, `cut to ${c.format.duration} s`)
  assert.ok(Math.abs(probe(at('talk.mp4')).format.duration - 3) < 0.1)
  assert.deepEqual([(await post('/api/cut', { path: '/etc/hosts', end: 1 })).code, (await post('/api/cut', { path: at('talk.mp4'), start: 2, end: 2 })).code], [403, 400])
  // a file dropped on the page goes to the library: moved out of the uploads, a free local result of its kind, no ledger line
  const sentPng = at('.cache', 'uploads', '123-photo.png'), spent = ledger().length
  fs.copyFileSync(at('a.png'), sentPng)
  const imported = await post('/api/import', { path: sentPng }), listed = (await fetch(url + '/api/state').then(r => r.json())).media.find(m => m.id === imported.body.id)
  assert.deepEqual([listed.kind, listed.status, listed.provider, listed.label, listed.outputs, fs.existsSync(sentPng), ledger().length], ['image', 'done', 'local', 'Imported', ['photo.png'], false, spent])
  assert.equal((await post('/api/import', { path: cut.body.path })).body.kind, 'video')
  fs.writeFileSync(at('.cache', 'uploads', '124-notes.txt'), 'hi')
  assert.deepEqual([(await post('/api/import', { path: at('talk.mp4') })).code, (await post('/api/import', { path: at('.cache', 'uploads', '124-notes.txt') })).code], [403, 400])
  // the Claude it works for quits: the server stops
  const claude = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1500)'])
  await post(`/__media-generator/owner?pid=${claude.pid}`, {})
  const stopped = await new Promise(ok => { const t = setTimeout(() => ok(false), 8000); srv.on('exit', () => { clearTimeout(t); ok(true) }) })
  assert.ok(stopped, 'the server stops once its Claude has quit')
})
