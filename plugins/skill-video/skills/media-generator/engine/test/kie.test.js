import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { startFake } from './fake-api.js'
import { CATALOG_PRICES, estimateKie, made, readSpec } from '../providers/kie.js'
import { retry429, retryAfter, windowed } from '../lib/limit.js'

// Kie as the active router, on a throwaway folder, against the fake Kie (its API, upload, docs and files)
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'media-gen-kie-'))
const engine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'media.mjs')
const fake = await startFake(home)
// each CLI run waits on its own window: the account's 20 a 10 s is the limits test's, not this many runs'
fake.kie.rate = 1000
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
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=d=6', at('voice6.mp3')])
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=25:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', at('short.mp4')])
test.after(() => { fake.close(); fs.rmSync(home, { recursive: true, force: true }) })

test('the router: Kie by default (OpenRouter with only its key), the one picked after; only its models; its catalog and prices read from its API and docs', async () => {
  assert.match((await cli('models', 'image')).out, /kie:fake\/kimg/)
  const orOnly = await new Promise(ok => { const c = spawn(process.execPath, [engine, 'models', 'image'], { cwd: home, env: { ...env, KIE_API_KEY: '' } }); let out = ''; c.stdout.on('data', d => (out += d)); c.on('close', () => ok(out)) })
  assert.match(orOnly, /openrouter:fake\/img/)
  assert.match((await cli('setup', 'set', 'router.active=nope')).err, /router\.active is one of openrouter, kie/)
  { const x = await cli('setup', 'set', 'router.active=openrouter'); assert.equal(x.code, 0, x.err) }
  assert.match((await cli('models', 'image')).out, /openrouter:fake\/img/)
  { const x = await cli('setup', 'set', 'router.active=kie'); assert.equal(x.code, 0, x.err) }
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
  // each keeps the day it first showed (Settings lists the newest first)
  const since = () => JSON.parse(fs.readFileSync(path.join(home, 'kie-cache', 'kie-catalog.json'), 'utf8')).video.find(m => m.id === 'newlab/new-video').since
  const first = since()
  assert.ok(first)
  const again = await cli('models', 'video', '--refresh')
  assert.equal(since(), first)
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
  { const x = await cli('elements', 'add', 'Papi', at('a.png'), at('b.png'), '--type', 'character', '--words', 'an old man with a white beard'); assert.equal(x.code, 0, x.err) }
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
  { const x = await cli('audio', '--model', 'kie:fake/el', '--prompt', 'hello', '--voice', 'v1', '--spend', '1'); assert.equal(x.code, 0, x.err) }
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
  // its length caps all its frames: 4 at 3 s, first and last included
  const four = ['--in', `first_frame=${at('a.png')}`, '--in', `mid_frames=${at('a.png')}`, '--in', `mid_frames=${at('b.png')}`, '--in', `last_frame=${at('b.png')}`]
  assert.match((await cli('video', '--model', 'fake/kling4', '--prompt', 'x', ...four, '--in', `mid_frames=${at('b.png')}`, '--duration', '3', '--estimate')).err, /takes 4 frames at 3 s, first and last included: this has 5/)
  { const x = await cli('video', '--model', 'fake/kling4', '--prompt', 'x', ...four, '--duration', '3', '--estimate'); assert.equal(x.code, 0, x.err) }
  // an edit: the video named first, its own sound kept unless turned off
  await run('video', '--tool', 'free-edit', '--model', 'fake/kling4', '--in', `video=${at('long.mp4')}`, '--prompt', 'the car is red', '--accept-unknown')
  assert.deepEqual([last().model, last().input.video_urls.length, last().input.keep_original_sound], ['fake-kling4-ref', 1, true])
  assert.match(last().input.prompt, /^In @video_1: the car is red/)
  await run('video', '--tool', 'free-edit', '--model', 'fake/kling4', '--in', `video=${at('long.mp4')}`, '--prompt', 'the car is red', '--option', 'keep_original_sound=off', '--accept-unknown')
  assert.equal(last().input.keep_original_sound, false)
  // lines spoken in sync: who says what, a character's own voice (its element's voice_url), a voice off screen
  await run('elements', 'add', 'Hero', at('a.png'), at('b.png'), '--type', 'character', '--voice', '@Narr')
  assert.match((await cli('elements', 'set', 'Narr', '--voice', '@Narr')).err, /only a character has a voice of its own/)
  await run('video', '--model', 'fake/kling4', '--prompt', 'in a park', '--say', '@Hero: Hello there', '--say', '(@Narr): And so it began', '--accept-unknown')
  assert.equal(last().input.prompt, 'in a park @Hero says: "Hello there" @Narr says off screen: "And so it began"')
  assert.deepEqual([last().input.elements[0].name, /^http/.test(last().input.elements[0].voice_url), last().input.voices.map(v => v.name)], ['Hero', true, ['Narr']])
  assert.match((await cli('video', '--model', 'fake/kling', '--prompt', 'x', '--say', '@Hero (@Narr): hi', '--estimate')).err, /takes no voice of its own for a line: Kling 4\.0 on Kie does/)
  // Kling 3.0: a character's own voice too, a list of one clip of 5 to 30 s
  assert.match((await cli('video', '--model', 'fake/kling', '--prompt', '@Hero waves', '--estimate')).err, /takes a character's voice of 5 to 30 s: @Narr's first clip is 2\.\d s/)
  await run('elements', 'add', 'Long', at('voice6.mp3'), '--type', 'voice')
  await run('elements', 'set', 'Hero', '--voice', '@Long')
  await run('video', '--model', 'fake/kling', '--prompt', '@Hero waves', '--duration', '5', '--accept-unknown')
  assert.deepEqual(last().input.kling_elements.map(e => [e.name, e.element_input_audio_urls?.length]), [['Hero', 1]])
  // a mode with its own names (Wan 2.7): the sound is text-to-video's audio_url, image-to-video's driving audio (a talking
  // head as long as its voice), references' voice
  await run('video', '--model', 'fake/wan27', '--prompt', 'a song', '--in', `ref_audios=${at('voice.mp3')}`, '--ratio', '1:1', '--accept-unknown')
  assert.deepEqual([last().model, !!last().input.audio_url, last().input.ratio], ['fake-wan-t', true, '1:1'])
  await run('video', '--tool', 'talking-avatar', '--model', 'fake/wan27', '--in', `first_frame=${at('a.png')}`, '--in', `audio=${at('voice6.mp3')}`, '--accept-unknown')
  assert.deepEqual([last().model, !!last().input.first_frame_url, !!last().input.driving_audio_url, last().input.duration], ['fake-wan-i', true, true, 5])
  await run('video', '--model', 'fake/wan27', '--prompt', 'the dancer', '--in', `ref_videos=${at('short.mp4')}`, '--in', `references=${at('a.png')}`, '--in', `ref_audios=${at('voice.mp3')}`, '--accept-unknown')
  assert.deepEqual([last().model, last().input.reference_video.length, last().input.reference_image.length, !!last().input.reference_voice], ['fake-wan-r', 1, 1, true])
  // Object swap on Wan 2.2 Animate Replace: the video and an Element's main view alone (not refused for its 2 views), no
  // prompt (4 s at 12 credits)
  const swap = ['video', '--tool', 'object-swap', '--model', 'alibaba/wan-2.2-animate-replace', '--in', `video=${at('long.mp4')}`, '--field', 'old=the man', '--field', 'element=@Hero']
  assert.equal(JSON.parse((await cli(...swap, '--estimate')).out).estimate.credits, 48)
  await run(...swap, '--spend', '1')
  assert.deepEqual([last().model, typeof last().input.image_url, !!last().input.video_url, last().input.prompt], ['fake-animate', 'string', true, undefined])
  // omni references: a reference video cited as written (not the video an edit changes), a voice of one's own by name
  await run('video', '--model', 'fake/kling4', '--prompt', 'the dancer of @video_1, @Hero speaks', '--in', `ref_videos=${at('short.mp4')}`, '--in', `ref_voices=${at('voice.mp3')}@Hero`, '--accept-unknown')
  assert.deepEqual([last().model, last().input.video_urls.length, last().input.prompt], ['fake-kling4-ref', 1, 'the dancer of @video_1, @Hero speaks'])
  assert.deepEqual(last().input.voices.map(v => v.name), ['Hero'])
  // each within the model's lengths, and its count of references in all (images, videos, Elements, voices)
  assert.match((await cli('video', '--model', 'fake/kling4', '--prompt', 'x', '--in', `ref_videos=${at('long.mp4')}`, '--estimate')).err, /takes reference videos of 2 to 3 s, long\.mp4 is 4\.0 s: cut it/)
  assert.match((await cli('video', '--model', 'fake/kling4', '--prompt', 'x', '--in', `ref_videos=${at('short.mp4')}`, '--in', `ref_videos=${at('short.mp4')}`, '--in', `ref_videos=${at('short.mp4')}`, '--estimate')).err, /takes 5 s of reference videos in all, these last 6\.0 s/)
  assert.match((await cli('video', '--model', 'fake/kling4', '--prompt', 'x', '--in', `references=${at('a.png')}`, '--in', `references=${at('b.png')}`, '--in', `ref_videos=${at('short.mp4')}`, '--in', `ref_voices=${at('voice.mp3')}`, '--in', `ref_voices=${at('voice.mp3')}@Two`, '--estimate')).err, /takes 4 references in all \(images, videos, Elements and voices\), this has 5/)
  assert.match((await cli('video', '--model', 'fake/kling4', '--prompt', 'x', '--in', `ref_audios=${at('voice.mp3')}`, '--estimate')).err, /takes 0 reference sounds, this has 1/)
  assert.match((await cli('video', '--model', 'fake/kling', '--prompt', 'x', '--in', `ref_voices=${at('voice.mp3')}`, '--estimate')).err, /takes no voice of its own: Kling 4\.0 on Kie does/)
  // Seedance: reference sounds too, never beside a frame; a reference video priced as a video input
  await run('video', '--model', 'bytedance/seedance-2.5', '--prompt', 'a dancer', '--in', `ref_audios=${at('voice.mp3')}`, '--in', `ref_videos=${at('short.mp4')}`, '--resolution', '480p', '--duration', '5', '--spend', '5')
  assert.deepEqual([last().input.reference_audio_urls.length, last().input.reference_video_urls.length], [1, 1])
  assert.match((await cli('video', '--model', 'bytedance/seedance-2.5', '--prompt', 'x', '--in', `ref_audios=${at('voice.mp3')}`, '--in', `first_frame=${at('a.png')}`, '--estimate')).err, /a first, middle or last frame and references do not go together/)
  assert.match((await cli('video', '--model', 'fake/kimg', '--prompt', 'x', '--in', `mid_frames=${at('a.png')}`, '--estimate')).err, /no video model fake\/kimg/)
  assert.match((await cli('video', '--model', 'fake/kling', '--prompt', 'x', '--in', `mid_frames=${at('a.png')}`, '--estimate')).err, /takes no middle frames: Kling 4\.0 and Grok/)
  // Lip sync (Kie only): the video and the voice, no prompt; as long as the voice (2 s at 8 credits); its scene mode
  const lip = ['video', '--tool', 'lip-sync', '--in', `video=${at('long.mp4')}`, '--in', `audio=${at('voice.mp3')}`]
  assert.equal(Math.round(JSON.parse((await cli(...lip, '--estimate')).out).estimate.credits), 16)
  await run(...lip, '--option', 'mode=basic', '--spend', '1')
  assert.deepEqual([last().model, last().input.mode, !!last().input.video_url, !!last().input.audio_url, last().input.prompt], ['fake-lip', 'basic', true, true, undefined])
  assert.equal((await run('setup', 'set', 'router.active=openrouter')).code, 0)
  assert.match((await cli(...lip, '--estimate')).err, /Lip sync runs on Kie\.ai only: switch the router in Settings/)
  assert.equal((await run('setup', 'set', 'router.active=kie')).code, 0)
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
  const RES = ['360p', '480p', '540p', '580p', '720p', '768p', '1080p', '1K', '1.5K', '2K', '4K'], ratio = r => r.split(':').reduce((a, b) => a / b)
  const sorted = (l, by, at) => assert.deepEqual(l, l.toSorted((a, b) => by(a) - by(b)), at)
  const roles = { image: ['create', 'both', 'edit'], video: ['generate', 'edit', 'upscale', 'avatar'], speech: ['speech', 'music', 'sound', 'stems', 'extras'] }
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
          // Lip sync also runs on a talking head, from a frame of its video
          if (video) assert.ok(['edit', 'upscale'].includes(m.role) || m.videos > 0 || (t.id === 'lip-sync' && m.role === 'avatar'), `${at} takes no video`)
          else assert.ok(!['edit', 'upscale'].includes(m.role), `${at} cannot create`)
          for (const f of ['first_frame', 'last_frame']) if (needs.some(i => i.key === f) && m.role !== 'avatar') assert.ok(m.frames.includes(f), `${at}: no ${f}`)
          // a talking head: an avatar model, or one whose first frame a voice drives (Wan 2.7)
          if (['talking-avatar', 'speech-to-video'].includes(t.id)) assert.ok(m.role === 'avatar' || (m.frames.includes('first_frame') && m.audios > 0), at)
        }
        // each audio tool on the models of its kind: voices, music, sounds, Suno's stems and extras
        if (kind === 'audio') assert.ok([{ voice: 'speech', music: 'music', 'sound-effect': 'sound', stems: 'stems' }[t.id] ?? (t.hidden ? 'extras' : 'music')].flat().includes(m.role), `${at}: role ${m.role}`)
      }
    }
  }
})

// the last job of a tool, and the input of the last task Kie got
const jobOf = tool => { const d = fs.readdirSync(at('media')).filter(x => x.includes(`-${tool}-`)).sort().at(-1); return JSON.parse(fs.readFileSync(at('media', d, 'job.json'), 'utf8')) }
const lastTask = () => tasks().at(-1).body

test('music on Kie: Suno writes a song (2 takes, their covers and words, its ids kept), goes on from a take by its id or from any sound sent whole; a singer of the Library sings', async () => {
  const w = await cli('audio', '--tool', 'music', '--field', 'mode=write', '--field', 'title=Night', '--field', 'style=synthwave', '--field', 'lyrics=[Verse] road', '--option', 'vocal_gender=Female', '--spend', '1')
  assert.equal(w.code, 0, w.err)
  assert.deepEqual(lastTask(), { model: 'ai-music-api/generate', input: { custom_mode: true, instrumental: false, title: 'Night', style: 'synthwave', lyrics: '[Verse] road', model: 'V6', vocal_gender: 'f' } })
  const song = jobOf('music')
  assert.deepEqual(song.outputs, ['out-1.mp3', 'out-2.mp3', 'cover-1.png', 'cover-2.png', 'lyrics.txt'])
  assert.equal(song.suno.tracks[0].audio_id, `${song.suno.task_id}-take-1`)
  assert.deepEqual([song.actual, song.actual_known], [0.06, true])
  // Describe: words and images, never the settings of a song written (Kie refuses them there)
  const d = await cli('audio', '--tool', 'music', '--field', 'description=a road trip', '--field', 'vocals=instrumental', '--in', `references=${at('a.png')}`, '--option', 'style_weight=0.7', '--spend', '1')
  assert.equal(d.code, 0, d.err)
  const di = lastTask().input
  assert.deepEqual([di.custom_mode, di.instrumental, di.prompt, di.image_urls.length, 'style_weight' in di], [false, true, 'a road trip', 1, false])
  assert.match((await cli('audio', '--tool', 'music', '--field', 'mode=write', '--field', 'style=pop', '--estimate')).err, /has its title/)
  // a take goes on by its id; another sound is sent whole
  const take = at('media', song.id, 'out-1.mp3')
  { const x = await cli('audio', '--tool', 'extend-music', '--in', `clip=${take}`, '--field', 'from=0.5', '--spend', '1'); assert.equal(x.code, 0, x.err) }
  assert.deepEqual([lastTask().model, lastTask().input.audio_id, lastTask().input.continue_at], ['ai-music-api/extend', `${song.suno.task_id}-take-1`, 0.5])
  // a sound of its own: 6 s at least (Kie's 413), sent whole
  assert.match((await cli('audio', '--tool', 'extend-music', '--in', `clip=${at('voice.mp3')}`, '--estimate')).err, /6 s at least/)
  { const x = await cli('audio', '--tool', 'extend-music', '--in', `clip=${at('voice6.mp3')}`, '--spend', '1'); assert.equal(x.code, 0, x.err) }
  assert.equal(lastTask().model, 'ai-music-api/upload-and-extend-audio')
  assert.match(lastTask().input.upload_url, /\/kiefiles\/upload-/)
  // a singer from the take: the Library's voice, its persona; Music sings with it
  const s = await cli('audio', '--tool', 'singer', '--in', `clip=${take}`, '--field', 'name=Nova', '--field', 'description=warm voice', '--field', 'start=0', '--field', 'end=12', '--spend', '1')
  assert.equal(s.code, 0, s.err)
  assert.deepEqual(['type', 'suno'].map(k => JSON.parse(fs.readFileSync(at('elements', 'Nova', 'element.json'), 'utf8'))[k]), ['singer', { persona_id: 'persona-1' }])
  await cli('audio', '--tool', 'music', '--field', 'mode=write', '--field', 'title=Two', '--field', 'style=pop', '--field', 'singer=@Nova', '--spend', '1')
  assert.deepEqual([lastTask().input.persona_id, lastTask().input.persona_model], ['persona-1', 'style_persona'])
  assert.match((await cli('audio', '--tool', 'music', '--field', 'mode=write', '--field', 'title=T', '--field', 'style=pop', '--field', 'singer=@Lea', '--estimate')).err, /@Lea is not a singer of the Library/)
  // a singer switched to a voice and back keeps its persona
  await cli('elements', 'set', 'Nova', '--type', 'voice')
  await cli('elements', 'set', 'Nova', '--type', 'singer')
  assert.deepEqual(JSON.parse(fs.readFileSync(at('elements', 'Nova', 'element.json'), 'utf8')).suno, { persona_id: 'persona-1' })
})

test('the Singer tool: a song sung solo, each take\'s voice taken apart; a singer made from one of them keeps its cover; Replace section sings with it', async () => {
  const est = JSON.parse((await cli('audio', '--tool', 'create-singer', '--field', 'name=nova', '--field', 'voice=a warm breathy female pop voice', '--field', 'style=synth-pop', '--estimate')).out)
  assert.deepEqual([est.estimate.amount, est.estimate.credits], [0.16, 32])
  assert.match((await cli('audio', '--tool', 'create-singer', '--estimate')).err, /describe the voice/)
  const r = await cli('audio', '--tool', 'create-singer', '--field', 'name=nova', '--field', 'voice=a warm breathy female pop voice', '--field', 'style=synth-pop', '--spend', '0.16')
  assert.equal(r.code, 0, r.err)
  const song = jobOf('create-singer'), splits = tasks().filter(x => x.body.model === 'ai-music-api/separate-vocals').slice(-2).map(x => x.body.input)
  assert.match(tasks().filter(x => x.body.model === 'ai-music-api/generate').at(-1).body.input.prompt, /^A short song sung solo by a warm breathy female pop voice, synth-pop\. The voice stays in front/)
  assert.deepEqual(splits.map(s => [s.audio_id, s.type]), song.suno.tracks.map(x => [x.audio_id, 'separate_vocal']))
  assert.deepEqual(song.outputs.filter(o => /^(out|voice)-/.test(o)), ['out-1.mp3', 'voice-1.mp3', 'out-2.mp3', 'voice-2.mp3'])
  assert.deepEqual(song.suno.tracks.map(x => x.voice), ['voice-1.mp3', 'voice-2.mp3'])
  // Make a singer from take 2's voice: Suno's persona of take 2, the voice alone as its clip, the take's cover as its picture
  const voice = at('media', song.id, 'voice-2.mp3')
  assert.match((await cli('audio', '--tool', 'singer', '--in', `clip=${voice}`, '--field', 'name=Nova2', '--field', 'description=warm', '--estimate')).err, /10 s of singing at least/)
  // (Suno's style of a song can run long: Kie takes 256 characters, cut at a comma)
  fs.writeFileSync(at('media', song.id, 'job.json'), JSON.stringify({ ...song, suno: { ...song.suno, tracks: song.suno.tracks.map(x => ({ ...x, tags: 'dreamy synth-pop, '.repeat(20) })) } }))
  const s = await cli('audio', '--tool', 'singer', '--in', `clip=${voice}`, '--field', 'name=Nova2', '--field', 'description=warm', '--field', 'start=0', '--field', 'end=12', '--spend', '0.002')
  assert.equal(s.code, 0, s.err)
  assert.deepEqual([lastTask().input.audio_id, lastTask().input.vocal_start, lastTask().input.vocal_end], [song.suno.tracks[1].audio_id, 0, 12])
  assert.ok(lastTask().input.style.length <= 256 && lastTask().input.style.endsWith('synth-pop'), lastTask().input.style)
  assert.ok(song.outputs.some(o => o.startsWith('cover-2.')), 'the fake take has its cover')
  assert.ok(fs.existsSync(at('elements', 'Nova2', 'cover.jpg')), 'the singer keeps its song\'s cover')
  assert.match((await cli('elements')).out, /^@Nova2: singer, 1 clip · warm$/m)
  // Replace section with that singer
  // (a fake take lasts 1 s: this one lasts a minute)
  fs.writeFileSync(at('media', song.id, 'job.json'), JSON.stringify({ ...song, suno: { ...song.suno, tracks: song.suno.tracks.map(x => ({ ...x, duration: 60 })) } }))
  const rs = await cli('audio', '--tool', 'replace-section', '--in', `clip=${at('media', song.id, 'out-1.mp3')}`, '--field', 'start=0', '--field', 'end=10', '--field', 'change=softer', '--field', 'singer=@Nova2', '--accept-unknown', '--spend', '1')
  assert.equal(rs.code, 0, rs.err)
  assert.deepEqual([lastTask().model, lastTask().input.persona_id, lastTask().input.persona_model], ['ai-music-api/replace-section', 'persona-1', 'style_persona'])
})

test('one\'s own singing voice in Suno: the phrase comes while its task waits, the recording makes the voice, Music sings with it', async () => {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=f=330:d=12', at('sung12.mp3')])
  assert.equal((await cli('elements', 'add', 'Me', at('sung12.mp3'), '--type', 'singer')).code, 0)
  const p = await cli('elements', 'suno', 'Me')
  assert.equal(p.code, 0, p.err)
  assert.match(p.out, /the moon sings softly/)
  const phrase = tasks().filter(x => x.body.model === 'ai-music-api/validation-phrase').at(-1)
  assert.deepEqual([phrase.body.input.vocal_start_s, phrase.body.input.vocal_end_s], [0, 12])
  const v = await cli('elements', 'suno', 'Me', '--verify', at('voice.mp3'))
  assert.equal(v.code, 0, v.err)
  const id = JSON.parse(fs.readFileSync(at('elements', 'Me', 'element.json'), 'utf8')).suno.voice_id
  assert.equal(lastTask().model, 'ai-music-api/create-voice')
  assert.equal(id, lastTask().input.task_id, 'the voice id is the phrase task\'s')
  await cli('audio', '--tool', 'music', '--field', 'mode=write', '--field', 'title=Mine', '--field', 'style=pop', '--field', 'singer=@Me', '--spend', '1')
  assert.deepEqual([lastTask().input.persona_id, lastTask().input.persona_model], [id, 'voice_persona'])
})

test('a Suno song\'s tools: stems and a stem\'s MIDI, its WAV, its words with their times; a sound; Write lyrics in the ledger', async () => {
  await cli('audio', '--tool', 'music', '--field', 'description=x', '--spend', '1')
  const song = jobOf('music'), take = at('media', song.id, 'out-2.mp3')
  assert.match((await cli('audio', '--tool', 'stems', '--in', `clip=${at('voice.mp3')}`, '--estimate')).err, /works on a song Suno made here/)
  assert.equal(JSON.parse((await cli('audio', '--tool', 'stems', '--in', `clip=${take}`, '--field', 'split=split_stem', '--estimate')).out).estimate.amount, 0.25)
  { const x = await cli('audio', '--tool', 'stems', '--in', `clip=${take}`, '--spend', '1'); assert.equal(x.code, 0, x.err) }
  assert.deepEqual(lastTask(), { model: 'ai-music-api/separate-vocals', input: { task_id: song.suno.task_id, audio_id: `${song.suno.task_id}-take-2`, type: 'separate_vocal' } })
  const stems = jobOf('stems')
  assert.deepEqual(stems.outputs, ['vocals.mp3', 'instrumental.mp3'])
  { const x = await cli('audio', '--tool', 'midi', '--in', `clip=${at('media', stems.id, 'vocals.mp3')}`, '--spend', '1'); assert.equal(x.code, 0, x.err) }
  assert.deepEqual(lastTask().input, { task_id: stems.suno.task_id, audio_id: 'stem-v' })
  { const x = await cli('audio', '--tool', 'wav', '--in', `clip=${take}`, '--spend', '1'); assert.equal(x.code, 0, x.err) }
  assert.deepEqual(jobOf('wav').outputs, ['out.wav'])
  { const x = await cli('audio', '--tool', 'lyrics-timings', '--in', `clip=${take}`, '--spend', '1'); assert.equal(x.code, 0, x.err) }
  const t = jobOf('lyrics-timings')
  assert.equal(fs.readFileSync(at('media', t.id, 'lyrics.srt'), 'utf8').split('\n').slice(0, 3).join('|'), '1|00:00:00,200 --> 00:00:00,600|la')
  // a sound: its loop and version; no tempo sent at 0 (its own)
  { const x = await cli('audio', '--tool', 'sound-effect', '--prompt', 'rain on a tin roof', '--option', 'sound_loop=on', '--option', 'version=V6_MINI', '--option', 'sound_tempo=0', '--spend', '1'); assert.equal(x.code, 0, x.err) }
  assert.deepEqual(lastTask(), { model: 'ai-music-api/sounds', input: { prompt: 'rain on a tin roof', model: 'V6_MINI', sound_loop: true } })
  // Write lyrics: its estimate, then the yes; both versions printed; its line in the ledger
  assert.equal((await cli('lyrics', 'a road trip at night')).code, 2)
  const l = await cli('lyrics', 'a road trip at night', '--spend', '0.002')
  assert.equal(l.code, 0, l.err)
  assert.match(l.out, /--- version 1: Night\n\[Verse\]\nroad/)
  assert.deepEqual([ledger().at(-1).tool, ledger().at(-1).actual, ledger().at(-1).status], ['write-lyrics', 0.01, 'done'])
  // Boost style: its text among Kie's « URLs »
  const b = await cli('boost', 'synthwave', '--spend', '0.002')
  assert.equal(b.out.trim(), 'dreamy synthwave, airy female vocals, 100 BPM', b.err)
})

test('Eleven v3 on Kie: one voice is a dialogue of one line, a dialogue its lines; its voices with their samples', async () => {
  { const x = await cli('audio', '--model', 'elevenlabs/eleven-v3', '--prompt', 'Bonjour', '--voice', 'v2', '--option', 'stability=Robust', '--spend', '1'); assert.equal(x.code, 0, x.err) }
  assert.deepEqual(lastTask(), { model: 'fake-tts-el3', input: { dialogue: [{ text: 'Bonjour', voice: 'v2' }], stability: 1 } })
  { const x = await cli('audio', '--model', 'elevenlabs/eleven-v3', '--line', 'EkK5I93UQWFDigLMpZcX: Salut', '--line', 'v2: Bonjour', '--spend', '1'); assert.equal(x.code, 0, x.err) }
  assert.equal(lastTask().input.dialogue.length, 2)
  const m = JSON.parse((await cli('models', 'audio', '--json')).out || '[]').find?.(x => x.model === 'elevenlabs/eleven-v3')
  if (m) assert.match(m.params.voice_info.EkK5I93UQWFDigLMpZcX.preview_url, /static\.aiquickdraw\.com\/elevenlabs\/voice\/EkK5I93UQWFDigLMpZcX\.mp3/)
})

test('speech to video: an image moved by a sound, its frames from its length; Lip sync from a frame of the video, or remade from it', async () => {
  const r = await cli('video', '--tool', 'speech-to-video', '--in', `first_frame=${at('a.png')}`, '--in', `audio=${at('voice6.mp3')}`, '--prompt', 'she sings', '--spend', '1')
  assert.equal(r.code, 0, r.err)
  assert.deepEqual([lastTask().model, lastTask().input.num_frames, lastTask().input.frames_per_second, lastTask().input.prompt], ['fake-s2v', 96, 16, 'Whoever is in the image speaks or sings the audio, the scene moving with it. she sings'])
  // 2 s: 40 frames at least, priced so (2.5 s)
  const est = JSON.parse((await cli('video', '--tool', 'speech-to-video', '--in', `first_frame=${at('a.png')}`, '--in', `audio=${at('voice.mp3')}`, '--estimate')).out)
  assert.equal(est.estimate.amount, 0.15)
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=d=9', at('voice9.mp3')])
  assert.match((await cli('video', '--tool', 'speech-to-video', '--in', `first_frame=${at('a.png')}`, '--in', `audio=${at('voice9.mp3')}`, '--estimate')).err, /moves 7\.5 s at most: this sound lasts 9\.0 s/)
  // a talking head in Lip sync: the frame at --frame, its photo
  const before = fake.kie.uploads.length
  const l = await cli('video', '--tool', 'lip-sync', '--model', 'fake/omni', '--in', `video=${at('long.mp4')}`, '--in', `audio=${at('voice.mp3')}`, '--frame', '1', '--accept-unknown')
  assert.equal(l.code, 0, l.err)
  assert.equal(lastTask().model, 'fake-avatar-omni')
  assert.ok(fake.kie.uploads.length - before >= 2, 'the frame and the voice uploaded')
  assert.match((await cli('video', '--tool', 'lip-sync', '--model', 'fake/omni', '--in', `video=${at('long.mp4')}`, '--in', `audio=${at('voice.mp3')}`, '--frame', '9', '--estimate')).err, /--frame is a time in the video: 0 to 4\.0 s/)
  // a sound longer (or shorter) than the talking head takes: said before anything is sent (OmniHuman 2.0: 4 s at least)
  assert.match((await cli('video', '--tool', 'lip-sync', '--model', 'fake/omni', '--in', `video=${at('long.mp4')}`, '--in', `audio=${at('voice9.mp3')}`, '--estimate')).err, /Omni-like takes a sound of 1 to 8 s: this one lasts 9\.0 s/)
})

test('a Suno stem\'s files by what they are: an instrument alone and the song without it, names decoded', () => {
  const u = n => `https://x/r/${n}_Drum%20Kit.mp3`, o = (n, kind) => ({ audio_url: u(n).replace('%20', ' '), stem_type_group_name: 'Drum Kit', kind })
  const one = { result: { resultUrls: ['a', 'b', 'c', 'd'].map(u), resultObject: { origin_data: [{ extract: o('a'), remove: o('b') }, { extract: o('c'), remove: o('d') }] } } }
  assert.deepEqual(made(one).files.map(f => f.name), ['Drum_Kit-1', 'without-Drum_Kit-1', 'Drum_Kit-2', 'without-Drum_Kit-2'])
  assert.deepEqual(made({ result: { resultUrls: ['https://x/r/id1_Backing%20Vocals.mp3', 'https://x/r/id2_Bass.mp3'] } }).files.map(f => f.name), ['id1_Backing_Vocals', 'id2_Bass'])
})
