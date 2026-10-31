import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { startFake } from './fake-api.js'
import { CATALOG_PRICES, estimateKie, readSpec } from '../providers/kie.js'
import { retry429, retryAfter, windowed } from '../lib/limit.js'

// Kie as the active router, on a throwaway folder, against the fake Kie (its API, upload, docs and files)
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'media-gen-kie-'))
const engine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'media.mjs')
const fake = await startFake(home)
const orCatalog = path.join(home, 'catalog.json')
fs.writeFileSync(orCatalog, JSON.stringify({ at: new Date().toISOString(), image: [], video: [], speech: [] }))
const env = { ...process.env, MEDIA_GENERATOR_DIR: home, MEDIA_GENERATOR_MODELS: path.join(path.dirname(engine), 'test', 'models.json'), MEDIA_GENERATOR_CATALOG: orCatalog,
  MEDIA_GENERATOR_KIE_MODELS: path.join(path.dirname(engine), 'test', 'kie-models.json'), MEDIA_GENERATOR_KIE_CACHE: path.join(home, 'kie-cache'),
  OPENROUTER_BASE: `${fake.base}/api/v1`, OPENROUTER_API_KEY: 'k-test', KIE_BASE: `${fake.base}/kie`, KIE_UPLOAD_BASE: `${fake.base}/kieup`, KIE_DOCS: `${fake.base}/kiedocs`,
  KIE_API_KEY: 'k-kie', ELEVENLABS_API_KEY: '', MEDIA_GENERATOR_POLL: '20', MEDIA_GENERATOR_RETRY: '30', PATH: `${fake.bin}${path.delimiter}${process.env.PATH}` }
const cli = (...argv) => new Promise(ok => {
  const c = spawn(process.execPath, [engine, ...argv], { cwd: home, env })
  let out = '', err = ''
  c.stdout.on('data', d => (out += d))
  c.stderr.on('data', d => (err += d))
  c.on('close', code => ok({ code, out, err }))
})
const at = (...p) => path.join(home, ...p)
const tasks = () => fake.calls.filter(c => c.path === '/kie/api/v1/jobs/createTask')
const ledger = () => fs.readFileSync(at('ledger.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l))
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=64x64', '-frames:v', '1', at('a.png')])
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=green:s=64x64', '-frames:v', '1', at('b.png')])
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', at('long.mp4')])
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=d=2', at('voice.mp3')])
test.after(() => { fake.close(); fs.rmSync(home, { recursive: true, force: true }) })

test('the router: Kie by default (OpenRouter with only its key), the one picked after; only its models; its catalog and prices read from its API and docs', async () => {
  assert.match((await cli('models', 'image')).out, /kie:fake\/kimg/)
  const orOnly = await new Promise(ok => { const c = spawn(process.execPath, [engine, 'models', 'image'], { cwd: home, env: { ...env, KIE_API_KEY: '' } }); let out = ''; c.stdout.on('data', d => (out += d)); c.on('close', () => ok(out)) })
  assert.match(orOnly, /openrouter:fake\/img/)
  assert.match((await cli('setup', 'set', 'router.active=nope')).err, /router\.active is one of openrouter, kie/)
  assert.equal((await cli('setup', 'set', 'router.active=openrouter')).code, 0)
  assert.match((await cli('models', 'image')).out, /openrouter:fake\/img/)
  assert.equal((await cli('setup', 'set', 'router.active=kie')).code, 0)
  const img = await cli('models', 'image')
  assert.match(img.out, /kie:fake\/kimg {2}Fake: Kie Image/)
  assert.doesNotMatch(img.out, /openrouter:/)
  assert.match(img.out, /on Kie\.ai, the active router/)
  // the catalog: a model of the docs whose inputs are known joins, one needing an unknown one (a mask) does not; a
  // command reads it on --refresh only (the server behind, at its start)
  assert.doesNotMatch((await cli('models', 'video')).out, /newlab/)
  assert.match((await cli('models', 'video', '--refresh')).err, /1 new model from Kie\.ai's catalog: New Video/)
  const vid = await cli('models', 'video')
  assert.match(vid.out, /kie:newlab\/new-video {2}NewLab: New Video {2}\[3–5 s, 480p\/720p, first_frame\] {2}new, from the catalog/)
  assert.doesNotMatch(vid.out, /needs-mask/)
  const asked = fake.calls.filter(c => c.path.startsWith('/kiedocs/')).length
  const again = await cli('models', 'video', '--refresh')
  assert.match(again.err, /Kie\.ai's catalog: nothing new/)
  assert.equal(fake.calls.filter(c => c.path.startsWith('/kiedocs/market')).length, asked - 1, 'each docs page read once, the index again')
  const prices = JSON.parse(fs.readFileSync(at('kie-cache', 'kie-prices.json'), 'utf8'))
  assert.deepEqual(prices.rows['fake img, 2K'], { credits: 10, usd: 0.05, unit: 'per image' })
})

test('an image on Kie: its reference uploaded, the image-to-image model, the price from the API in USD, the credits it consumed', async () => {
  const est = JSON.parse((await cli('image', '--tool', 'free-edit', '--model', 'kie:fake/kimg', '--in', `image=${at('a.png')}`, '--prompt', 'make it red', '--resolution', '2K', '--estimate')).out)
  assert.deepEqual([est.provider, est.estimate.amount, est.estimate.unit, est.estimate.credits], ['kie', 0.05, 'usd', 10])
  assert.match(est.estimate.detail, /10 credits × 1 = 10 credits/)
  const r = await cli('image', '--tool', 'free-edit', '--model', 'kie:fake/kimg', '--in', `image=${at('a.png')}`, '--prompt', 'make it red', '--resolution', '2K', '--spend', '0.05')
  assert.equal(r.code, 0, r.err)
  const body = tasks().at(-1).body
  assert.equal(body.model, 'fake-i2i')
  assert.equal(tasks().at(-1).auth, 'Bearer k-kie')
  assert.match(body.input.input_urls[0], /\/kiefiles\/upload-\d+$/)
  assert.equal(body.input.resolution, '2K')
  assert.equal(fake.kie.uploads.at(-1).route, '/kieup/api/file-base64-upload')
  const line = ledger().at(-1)
  assert.deepEqual([line.provider, line.unit, line.estimate, line.actual, line.actual_known], ['kie', 'usd', 0.05, 0.06, true])
  // text only: the text-to-image model
  await cli('image', '--prompt', 'a fox', '--model', 'kie:fake/kimg', '--spend', '1')
  assert.equal(tasks().at(-1).body.model, 'fake-t2i')
})

test('a video edit on Kie: the video uploaded (no tunnel), -1 follows its length, 1080p; the input seconds billed too', async () => {
  const argv = ['video', '--tool', 'free-edit', '--model', 'kie:bytedance/seedance-2.5', '--in', `video=${at('long.mp4')}`, '--prompt', 'the car is red', '--resolution', '1080p']
  const est = JSON.parse((await cli(...argv, '--estimate')).out)
  // 95 credits a second × (4 s out + 4 s in)
  assert.deepEqual([est.estimate.credits, est.estimate.amount], [760, 3.8])
  const r = await cli(...argv, '--spend', '3.8')
  assert.equal(r.code, 0, r.err)
  const { model, input } = tasks().at(-1).body
  assert.equal(model, 'fake-vid')
  assert.deepEqual([input.duration, input.resolution, input.aspect_ratio], [-1, '1080p', undefined])
  assert.match(input.reference_video_urls[0], /\/kiefiles\/upload-\d+$/)
  assert.equal(fake.kie.uploads.at(-1).route, '/kieup/api/file-stream-upload')
  assert.ok(!fake.calls.some(c => c.path === '/dns-query'), 'no tunnel')
  assert.match(r.out, /sending the files to Kie\.ai/)
  assert.deepEqual([ledger().at(-1).actual], [0.68])
})

test('Kling on Kie: both frames in one list, its mode for the resolution, the duration as a string; no price: its own yes', async () => {
  const argv = ['video', '--tool', 'first-last-frame', '--model', 'kie:fake/kling', '--in', `first_frame=${at('a.png')}`, '--in', `last_frame=${at('a.png')}`, '--duration', '5', '--resolution', '1080p']
  const no = await cli(...argv, '--spend', '1')
  assert.equal(no.code, 2)
  assert.match(no.err, /unknown cost/)
  const r = await cli(...argv, '--accept-unknown')
  assert.equal(r.code, 0, r.err)
  const { input } = tasks().at(-1).body
  assert.equal(input.image_urls.length, 2)
  assert.deepEqual([input.mode, input.duration, input.multi_shots], ['pro', '5', false])
})

test('Kling\'s elements: a cited @Element goes whole (its name, words, images), not as references; one image or too many refused', async () => {
  assert.equal((await cli('elements', 'add', 'Papi', at('a.png'), at('b.png'), '--type', 'character', '--words', 'an old man with a white beard')).code, 0)
  const r = await cli('video', '--model', 'kie:fake/kling', '--prompt', '@Papi walks in the rain', '--duration', '5', '--resolution', '720p', '--accept-unknown')
  assert.equal(r.code, 0, r.err)
  const { input } = tasks().at(-1).body
  assert.equal(input.prompt, '@Papi walks in the rain')
  assert.equal(input.kling_elements.length, 1)
  assert.deepEqual([input.kling_elements[0].name, input.kling_elements[0].description, input.kling_elements[0].element_input_urls.length], ['Papi', 'an old man with a white beard', 2])
  assert.equal(input.image_urls, undefined)
  // an Element made before the rule, with one image: refused, the way to a second view said
  fs.mkdirSync(at('elements', 'Old'), { recursive: true })
  fs.copyFileSync(at('a.png'), at('elements', 'Old', 'a.png'))
  fs.writeFileSync(at('elements', 'Old', 'element.json'), JSON.stringify({ type: 'object', words: 'a lamp' }))
  assert.match((await cli('video', '--model', 'kie:fake/kling', '--prompt', '@Old glows', '--estimate')).err, /@Old has 1 image: Fake: Kling-like takes 2 to 4 views of an Element\. Make another with media\.mjs image --tool object/)
  for (const n of ['A1', 'A2', 'A3']) await cli('elements', 'add', n, at('a.png'), at('b.png'), '--type', 'object')
  assert.match((await cli('video', '--model', 'kie:fake/kling', '--prompt', '@Papi @A1 @A2 @A3', '--estimate')).err, /Fake: Kling-like takes 3 Elements, this cites 4/)
})

test('speech on Kie: Gemini\'s speakers and turns, ElevenLabs\' text and voice by the 1,000 characters', async () => {
  const g = await cli('audio', '--model', 'kie:fake/gem', '--prompt', 'Bonjour', '--voice', 'Puck', '--accept-unknown')
  assert.equal(g.code, 0, g.err)
  assert.deepEqual(tasks().at(-1).body.input, { speakers: [{ speaker_id: 'Speaker 1', voice_name: 'Puck' }], dialogue_turns: [{ speaker_id: 'Speaker 1', text: 'Bonjour' }] })
  const id = fs.readdirSync(at('media')).sort().at(-1)
  assert.ok(fs.existsSync(at('media', id, 'out.mp3')))
  const est = JSON.parse((await cli('audio', '--model', 'kie:fake/el', '--prompt', 'x'.repeat(500), '--estimate')).out)
  assert.deepEqual([est.estimate.credits, est.estimate.amount], [3, 0.015])
  assert.equal((await cli('audio', '--model', 'kie:fake/el', '--prompt', 'hello', '--voice', 'v1', '--spend', '1')).code, 0)
  assert.deepEqual(tasks().at(-1).body.input, { text: 'hello', voice: 'v1' })
})

test('every capability: the models\' options and editors reach Kie under the names its docs give them', async () => {
  const last = () => tasks().at(-1).body, run = async (...a) => { const r = await cli(...a); assert.equal(r.code, 0, r.err); return r }
  // options: checked against the model's own, a choice by its label, a palette in even shares
  assert.match((await cli('image', '--model', 'fake/kimg', '--prompt', 'a poster', '--option', 'quality=9', '--estimate')).err, /Kie Image has no option quality \(its options: negative_prompt, output_format, color_palette\)/)
  assert.match((await cli('image', '--model', 'fake/kimg', '--prompt', 'a poster', '--option', 'output_format=gif', '--estimate')).err, /File format \(output_format\) is one of PNG, JPEG/)
  await run('image', '--model', 'fake/kimg', '--prompt', 'a poster', '--option', 'negative_prompt=text', '--option', 'output_format=JPEG', '--option', 'color_palette=#112233, #445566, #778899', '--spend', '1')
  assert.deepEqual([last().input.negative_prompt, last().input.output_format, last().input.color_palette],
    ['text', 'jpeg', [{ hex: '#112233', ratio: '33.33%' }, { hex: '#445566', ratio: '33.33%' }, { hex: '#778899', ratio: '33.34%' }]])
  // Kling's shots: each its words and seconds, their sum its length; Smart shots apart
  assert.match((await cli('video', '--model', 'fake/kling', '--shot', '2: a', '--shot', '4: b', '--estimate')).err, /the shots last 6 s: Fake: Kling-like makes 3, 5 or 10 s/)
  assert.match((await cli('video', '--model', 'fake/kling', '--shot', '2: a', '--shot', '3: b', '--option', 'prefer_multi_shots=on', '--estimate')).err, /Smart shots or your own shots, not both/)
  await run('video', '--model', 'fake/kling', '--shot', '2: a fox runs', '--shot', '3: it stops', '--accept-unknown')
  assert.deepEqual([last().input.multi_shots, last().input.multi_prompt, last().input.duration], [true, [{ prompt: 'a fox runs', duration: 2 }, { prompt: 'it stops', duration: 3 }], '5'])
  // Grok: a loop on its first frame alone, middle frames at their times
  assert.match((await cli('video', '--model', 'fake/grok', '--prompt', 'x', '--option', 'loop=on', '--estimate')).err, /a loop starts and ends on its first frame/)
  assert.match((await cli('video', '--model', 'fake/grok', '--prompt', 'x', '--in', `mid_frames=${at('b.png')}@5`, '--duration', '4', '--estimate')).err, /inside the video's 4 s/)
  await run('video', '--model', 'fake/grok', '--prompt', 'a dancer', '--in', `first_frame=${at('a.png')}`, '--option', 'loop=on', '--in', `mid_frames=${at('b.png')}@2`, '--duration', '4', '--accept-unknown')
  assert.deepEqual([!!last().input.loop_url, last().input.first_frame_url, last().input.keyframes.map(k => k.timestamp_s)], [true, undefined, [2]])
  // Kling 4.0: middle frames in order on its keyframe model, each cited; a voice of the Library cited by name
  await run('elements', 'add', 'Narr', at('voice.mp3'), '--type', 'voice')
  await run('video', '--model', 'fake/kling4', '--prompt', '@Narr says hello', '--in', `mid_frames=${at('a.png')}`, '--in', `mid_frames=${at('b.png')}`, '--accept-unknown')
  assert.equal(last().model, 'fake-kling4-key')
  assert.equal(last().input.keyframe_urls.length, 2)
  assert.equal(last().input.prompt, '@Narr says hello (@keyframe_1, @keyframe_2)')
  assert.deepEqual(last().input.voices.map(v => [v.name, /^http/.test(v.audio_url)]), [['Narr', true]])
  assert.match((await cli('video', '--model', 'fake/kimg', '--prompt', 'x', '--in', `mid_frames=${at('a.png')}`, '--estimate')).err, /no video model fake\/kimg/)
  assert.match((await cli('video', '--model', 'fake/kling', '--prompt', 'x', '--in', `mid_frames=${at('a.png')}`, '--estimate')).err, /takes no middle frames: Kling 4\.0 and Grok/)
  // OmniHuman: the masks of who speaks, its fast mode
  await run('video', '--tool', 'talking-avatar', '--model', 'fake/omni', '--in', `first_frame=${at('a.png')}`, '--in', `audio=${at('voice.mp3')}`, '--in', `speaker_masks=${at('b.png')}`, '--option', 'pe_fast_mode=on', '--accept-unknown')
  assert.deepEqual([last().input.mask_url.length, last().input.pe_fast_mode], [1, true])
  // Seedance 2.5's draft at 480p, its last frame kept; its final from it, priced as unknown
  const d = await run('video', '--model', 'bytedance/seedance-2.5', '--prompt', 'a dancer', '--option', 'draft=on', '--option', 'return_last_frame=on', '--resolution', '1080p', '--duration', '5', '--spend', '1')
  assert.deepEqual([last().input.draft, last().input.resolution, last().input.return_last_frame], [true, '480p', true])
  const draft = d.out.match(/media\/(\S+)/)[1]
  assert.ok(fs.readdirSync(at('media', draft)).includes('last-frame.jpg'))
  assert.match((await cli('video', '--model', 'bytedance/seedance-2.5', '--from-draft', draft, '--spend', '5')).err, /unknown cost.*Kie lists no price for a draft's final/)
  assert.match((await cli('video', '--model', 'bytedance/seedance-2.5', '--from-draft', 'nope', '--estimate')).err, /nope is not a draft of ByteDance: Seedance 2\.5/)
  await run('video', '--model', 'bytedance/seedance-2.5', '--from-draft', draft, '--accept-unknown')
  const fin = last(), taskId = JSON.parse(fs.readFileSync(at('media', draft, 'job.json'), 'utf8')).job.id
  assert.deepEqual([fin.model, fin.input.resolution, fin.input.draft_task_id], ['fake-vid-draft', '1080p', taskId])
  // Gemini: a dialogue of two voices, « how it sounds » as each turn's style, its options
  assert.match((await cli('audio', '--model', 'fake/gem', '--line', 'Kore: a', '--line', 'Puck: b', '--line', 'Zephyr: c', '--estimate')).err, /Gem TTS takes 2 voices in a dialogue, this one has 3/)
  await run('audio', '--model', 'fake/gem', '--line', 'Kore: Bonjour', '--line', 'Puck: Salut', '--field', 'instructions=warm', '--option', 'temperature=1.5', '--option', 'filler_words=on', '--accept-unknown')
  assert.deepEqual(last().input, { speakers: [{ speaker_id: 'Speaker 1', voice_name: 'Kore' }, { speaker_id: 'Speaker 2', voice_name: 'Puck' }],
    dialogue_turns: [{ speaker_id: 'Speaker 1', text: 'Bonjour', style: 'warm' }, { speaker_id: 'Speaker 2', text: 'Salut', style: 'warm' }], temperature: 1.5, filler_words: true })
})

test('the rate limit: a 429 waits and tries again; a model of the other router runs on this one when it has it, or says so', async () => {
  fake.kie.busy = 2
  const before = tasks().length
  const r = await cli('image', '--prompt', 'a fox', '--model', 'kie:fake/kimg', '--spend', '1')
  assert.equal(r.code, 0, r.err)
  assert.equal(tasks().length - before, 3, 'twice refused, then made')
  assert.match(r.out, /waiting for Kie's rate limit/)
  // Seedance 2.5 asked on OpenRouter's name: Kie's
  assert.equal(JSON.parse((await cli('video', '--prompt', 'a fox', '--model', 'openrouter:bytedance/seedance-2.5', '--resolution', '480p', '--duration', '5', '--estimate')).out).provider, 'kie')
  assert.match((await cli('image', '--prompt', 'a fox', '--model', 'openrouter:fake/img', '--estimate')).err, /no image model fake\/img on Kie\.ai \(it is OpenRouter's\)/)
  // a failed task: its words, nothing billed
  const credit = await cli('credits')
  assert.match(credit.out, /kie: 1080 credits left \(\$5\.40\)/)
  assert.match(credit.out, /active router: Kie\.ai/)
})

test('limits: the window holds the n+1th start, a 429 retried after what it says, Retry-After read', async () => {
  const slot = windowed(2, 120), t0 = Date.now()
  await slot(); await slot()
  let waited = 0
  await slot(() => waited++)
  assert.ok(Date.now() - t0 >= 115 && waited === 1)
  let n = 0
  assert.equal(await retry429(async () => { if (++n < 3) throw Object.assign(new Error('slow'), { status: 429, retryAfter: 5 }); return 'ok' }), 'ok')
  assert.equal(n, 3)
  await assert.rejects(retry429(async () => { throw Object.assign(new Error('no'), { status: 402 }) }), /no/)
  assert.equal(retryAfter(new Headers({ 'retry-after': '3' })), 3000)
  assert.equal(retryAfter(new Headers()), undefined)
})

test('Kie\'s estimates: per second with the input video, per image, a missing row unknown', () => {
  const rows = { 'v, 720p with video': { credits: 38, usd: 0.19, unit: 'per second' }, 'v, 720p no video': { credits: 63, usd: 0.315, unit: 'per second' }, 'i, 1K': { credits: 6, usd: 0.03, unit: 'per image' } }
  const vid = { pricing: [{ when: { resolution: '720p', input: 'video' }, row: 'v, 720p with video', in: true }, { when: { resolution: '720p' }, row: 'v, 720p no video' }], role: 'generate' }
  assert.equal(estimateKie('video', vid, { resolution: '720p', duration: 5, input: 'text' }, rows).amount, 1.575)
  assert.equal(estimateKie('video', vid, { resolution: '720p', duration: 4, source_duration: 4, input: 'video' }, rows).amount, 1.52)
  assert.equal(estimateKie('video', vid, { resolution: '1080p', duration: 4, input: 'text' }, rows).known, false)
  // an edit model priced before its video: 5 s
  assert.equal(estimateKie('video', { pricing: [{ row: 'v, 720p no video' }], role: 'edit' }, { input: 'text' }, rows).amount, 1.575)
  assert.equal(estimateKie('image', { pricing: [{ row: 'i, 1K' }] }, { n: 3, refs: 0 }, rows).amount, 0.09)
  // a model whose length isn't asked: its rule's seconds; an input image's row: the images sent
  assert.equal(estimateKie('video', { pricing: [{ row: 'v, 720p no video', seconds: 6 }], role: 'generate' }, { input: 'text' }, rows).amount, 1.89)
  assert.equal(estimateKie('image', { pricing: [{ row: ['i, 1K', 'q, input, 1K'] }] }, { n: 1, refs: 3 }, { ...rows, 'q, input, 1K': { credits: 0.5, usd: 0.0025, unit: 'per image' } }).credits, 7.5)
  // the catalog's prices (by hand): only the settings an estimate has, the engine's names of resolutions
  const vocabulary = { mode: ['text', 'refs', 'frames', 'video', 'avatar'], input: ['text', 'image', 'video'], sound: [true], duration: null, resolution: ['480p', '720p', '768p', '1080p', '4K', '1K', '2K'] }
  for (const [id, rules] of Object.entries(CATALOG_PRICES.models)) for (const r of rules) for (const [k, v] of Object.entries(r.when ?? {})) {
    assert.ok(k in vocabulary, `${id}: no estimate has ${k}`)
    assert.ok(vocabulary[k] ? vocabulary[k].includes(v) : Number.isInteger(v), `${id}: ${k} ${v}`)
  }
  assert.ok(Object.keys(CATALOG_PRICES.none).every(id => !CATALOG_PRICES.models[id]))
  // a docs page that is not strict YAML still reads (Kling 3.0's)
  const spec = readSpec('```yaml\n                model:\n                  type: string\n                  enum:\n                    - kling-3.0/video\n                input:\n                  properties:\n                    duration:\n                      type: string\n                      description: >-\n                        Required: 3–15: weird\n                      enum:\n                        - \'3\'\n                        - \'15\'\n                  required:\n                    - duration\n```')
  assert.deepEqual([spec.models, spec.props.duration.enum, spec.required], [['kling-3.0/video'], ['3', '15'], ['duration']])
})

// the shipped list: its shape, its lists sorted; every tool has a model on Kie that can run it
test('the shipped Kie list is normalized, and every tool that generates runs on Kie with models able to', () => {
  const dir = path.dirname(engine), list = JSON.parse(fs.readFileSync(path.join(dir, 'providers', 'kie-models.json'), 'utf8'))
  const RES = ['360p', '480p', '540p', '720p', '768p', '1080p', '1K', '1.5K', '2K', '4K'], ratio = r => r.split(':').reduce((a, b) => a / b)
  const sorted = (l, by, at) => assert.deepEqual(l, l.toSorted((a, b) => by(a) - by(b)), at)
  const roles = { image: ['create', 'both', 'edit'], video: ['generate', 'edit', 'upscale', 'avatar'], speech: ['speech'] }
  const NAMES = ['prompt', 'images', 'first_frame', 'last_frame', 'video', 'audio', 'resolution', 'aspect_ratio', 'duration', 'sound', 'seed', 'n', 'quality', 'background', 'factor', 'text', 'voice']
  for (const kind of Object.keys(roles)) {
    assert.equal(new Set(list[kind].map(m => m.id)).size, list[kind].length, `${kind}: an id twice`)
    for (const m of list[kind]) {
      assert.ok(m.id && m.lab && m.name && m.kie, m.id)
      assert.ok(roles[kind].includes(m.role), `${m.id}: role ${m.role}`)
      if (typeof m.kie === 'object') assert.ok(Object.keys(m.kie).every(k => ['text', 'frames', 'refs', 'video', 'avatar'].includes(k)), `${m.id}: modes`)
      assert.ok(Object.keys(m.fields ?? {}).every(k => NAMES.includes(k)), `${m.id}: fields ${Object.keys(m.fields ?? {})}`)
      if (m.resolutions) (assert.ok(m.resolutions.every(r => RES.includes(r)), `${m.id}: ${m.resolutions}`), sorted(m.resolutions, r => RES.indexOf(r), m.id))
      if (m.aspect_ratios) sorted(m.aspect_ratios, ratio, m.id)
      if (m.durations) sorted(m.durations, d => d, m.id)
      assert.ok(Array.isArray(m.price), `${m.id}: price`)
      m.price.forEach((r, i) => assert.ok(r.row && (r.when || i === m.price.length - 1), `${m.id}: price rule ${i}`))
    }
  }
  const tools = kind => JSON.parse(fs.readFileSync(path.join(dir, 'tools', `${kind}.json`), 'utf8'))
  for (const [kind, router] of [['image', 'image'], ['video', 'video'], ['audio', 'speech']]) {
    for (const t of tools(kind).filter(t => t.models)) {
      // ElevenLabs' own (eleven_…) are reached straight, whichever router
      const own = t.kie, ids = [...(own?.models ?? t.models), ...(own?.also ?? t.also ?? [])].filter(id => !/^eleven_/.test(id)), on = ids.map(id => list[router].find(x => x.id === id))
      // a list of Kie's own names each model it has; one inherited from OpenRouter at least one
      if (own) on.forEach((m, i) => assert.ok(m, `${kind}/${t.id}: ${ids[i]} is not on Kie`))
      assert.ok(on.some(Boolean), `${kind}/${t.id} has no model on Kie`)
      const needs = t.inputs.filter(i => !i.optional && i.kind !== 'matte')
      for (const m of on.filter(Boolean)) {
        const at = `${kind}/${t.id}: ${m.id}`
        if (kind === 'image') {
          if (t.mode === 'edit') assert.notEqual(m.role, 'create', `${at} cannot edit`)
          assert.ok(needs.filter(i => ['image', 'sketch', 'mask'].includes(i.kind)).length <= m.references, `${at}: too few references`)
          if (t.params?.background) assert.ok((m.background ?? []).includes(t.params.background), `${at}: no ${t.params.background} background`)
          if (t.params?.resolution) assert.ok((m.resolutions ?? []).includes(t.params.resolution), `${at}: no ${t.params.resolution}`)
        }
        if (kind === 'video') {
          const video = t.inputs.some(i => i.kind === 'video') && t.local !== 'extend'
          if (video) assert.ok(['edit', 'upscale'].includes(m.role) || m.videos > 0, `${at} takes no video`)
          else assert.ok(!['edit', 'upscale'].includes(m.role), `${at} cannot create`)
          for (const f of ['first_frame', 'last_frame']) if (needs.some(i => i.key === f) && m.role !== 'avatar') assert.ok(m.frames.includes(f), `${at}: no ${f}`)
          if (t.id === 'talking-avatar') assert.equal(m.role, 'avatar', at)
        }
        if (kind === 'audio') assert.equal(m.role, 'speech', at)
      }
    }
  }
})
