import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// voice-change, voice-clone and dub on any file, against a faked ElevenLabs (its fetch replaced): what each sends,
// the user's yes before a credit, the pieces of a long sound, what comes back on the video
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'video-voice-'))
const engine = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'video.mjs')
const at = rel => path.join(home, rel)
const ffmpeg = (...argv) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...argv], { cwd: home })
const streams = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', f], { encoding: 'utf8' }))
test.after(() => fs.rmSync(home, { recursive: true, force: true }))

const calls = at('eleven.log'), mock = at('eleven.mjs')
fs.writeFileSync(mock, `import fs from 'node:fs'
  // the subscription's count moves a few reads after the spend, as ElevenLabs' lags 10 to 20 s
  let used = 1000, pending = 0, reads = 0
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), form = init.body instanceof FormData ? Object.fromEntries([...new Set(init.body.keys())].map(k => [k, init.body.getAll(k).map(v => typeof v === 'string' ? v : 'blob:' + v.size)])) : init.body
    fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ u, method: init.method ?? 'GET', form }) + '\\n')
    if (u.endsWith('/v1/user/subscription')) { if (pending && ++reads > 2) [used, pending, reads] = [used + pending, 0, 0]; return Response.json({ character_count: used, character_limit: 10000 }) }
    // a free plan refuses the formats of the Creator tier
    if (u.includes('output_format=mp3_44100_192')) return Response.json({ detail: { code: 'subscription_required', message: "Output format 'mp3_44100_192' is only available on the Creator tier and above.", status: 'output_format_not_allowed' } }, { status: 403 })
    if (u.includes('/v1/voice-changer/')) { pending += 50; return new Response(fs.readFileSync(${JSON.stringify(at('voice.mp3'))}), { headers: { 'content-type': 'audio/mpeg' } }) }
    if (u.endsWith('/v1/voices/add')) return Response.json({ voice_id: 'cloned-1' })
    if (u.endsWith('/v1/dubbing/project')) return Response.json({ project_id: 'p1', status: 'queued', language_ids: ['l-en'] })
    if (u.endsWith('/v1/dubbing/project/p1')) return Response.json({ project_id: 'p1', status: 'ready', language_ids: ['l-en'] })
    if (u.endsWith('/v1/dubbing/project/p1/language')) return Response.json({ language_id: 'l-' + JSON.parse(init.body).target_language, status: 'queued' })
    if (/\\/language\\/l-\\w+$/.test(u)) { pending += 300; return Response.json({ status: 'completed', outputs: { lossless_audio: 'https://signed/' + u.split('/').pop() + '.flac', subtitles: 'https://signed/' + u.split('/').pop() + '.vtt' } }) }
    if (u.endsWith('.flac')) return new Response(fs.readFileSync(${JSON.stringify(at('dub.flac'))}))
    if (u.endsWith('.vtt')) return new Response('WEBVTT\\n\\n00:00.000 --> 00:01.000\\nHello\\n')
    return Response.json({ detail: { message: 'unexpected ' + u } }, { status: 404 })
  }`)
const cli = (...argv) => spawnSync(process.execPath, ['--import', mock, engine, ...argv], { cwd: home, env: { ...process.env, VIDEO_EDITOR_DIR: home, ELEVENLABS_API_KEY: 'k-test', VIDEO_EDITOR_POLL: '1' }, encoding: 'utf8' })
const log = () => (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [])

ffmpeg('-f', 'lavfi', '-i', 'sine=f=220:d=3', 'voice.mp3')
ffmpeg('-f', 'lavfi', '-i', 'sine=f=330:d=3', 'dub.flac')
ffmpeg('-f', 'lavfi', '-i', 'testsrc2=s=320x240:r=25:d=3', '-f', 'lavfi', '-i', 'sine=f=300:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-shortest', 'talk.mp4')

test('voice-change: the estimate first, nothing sent without --spend; then the same video with the new voice and what it spent', () => {
  const est = cli('voice-change', 'talk.mp4', '--voice', 'v1', '--estimate')
  assert.equal(est.status, 0)
  assert.deepEqual(JSON.parse(est.stdout), { credits: 50, detail: 'voice change of 3 s' })
  const no = cli('voice-change', 'talk.mp4', '--voice', 'v1')
  assert.equal(no.status, 2)
  assert.match(no.stderr, /Ask the user, then run again with --spend 50/)
  assert.equal(log().length, 0)
  const ok = cli('voice-change', 'talk.mp4', '--voice', 'v1', '--denoise', '--spend', '50', '--out', 'out/talk.mp4')
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.stdout, /spent: 50 credits/)
  const sent = log().find(c => c.u.includes('/v1/voice-changer/v1'))
  assert.deepEqual(sent.form.model_id, ['eleven_multilingual_sts_v2'])
  assert.deepEqual(sent.form.remove_background_noise, ['true'])
  assert.deepEqual(streams(at('out/talk.mp4')).streams.map(s => s.codec_type).sort(), ['audio', 'video'])
})

test('voice-change on a long sound: pieces of at most 290 s, cut in its silences', { timeout: 60000 }, () => {
  fs.rmSync(calls, { force: true })
  // 250 s, a second of silence, 250 s, a second of silence, 150 s
  ffmpeg('-f', 'lavfi', '-i', 'sine=d=250', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1', '-f', 'lavfi', '-i', 'sine=d=250', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono:d=1', '-f', 'lavfi', '-i', 'sine=d=150',
    '-filter_complex', '[0][1][2][3][4]concat=n=5:v=0:a=1', '-ac', '1', 'long.mp3')
  const r = cli('voice-change', 'long.mp3', '--voice', 'v1', '--spend', '99999')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(log().filter(c => c.u.includes('/v1/voice-changer/')).length, 3)
  assert.match(r.stdout, /voice changed: .*long-voice\.mp3/)
})

test('voice-clone sends the name and every recording, and gives the new voice id', () => {
  fs.rmSync(calls, { force: true })
  const r = cli('voice-clone', 'Me', 'voice.mp3', 'dub.flac')
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /voice: cloned-1 {2}Me \(cloned from 2 files\)/)
  assert.deepEqual(log()[0].form.name, ['Me'])
  assert.equal(log()[0].form.files.length, 2)
})

test('dub: one project, a language target each, every language back on the video with its subtitles; the yes first', () => {
  fs.rmSync(calls, { force: true })
  const no = cli('dub', 'talk.mp4', '--to', 'en,es')
  assert.equal(no.status, 2)
  assert.deepEqual(JSON.parse(no.stdout), { credits: 300, detail: 'dubbing v1 of 3 s into en, es' })
  assert.match(cli('dub', 'talk.mp4', '--to', 'en', '--model', 'dubbing_v2', '--estimate').stdout, /"credits":675/)
  const r = cli('dub', 'talk.mp4', '--to', 'en,es', '--spend', '300', '--out', 'dubs')
  assert.equal(r.status, 0, r.stderr)
  const project = log().find(c => c.u.endsWith('/v1/dubbing/project'))
  assert.deepEqual(project.form.model_id, ['dubbing_v1'])
  assert.deepEqual(project.form.target_language, ['en'])
  assert.ok(log().some(c => c.u.endsWith('/language') && JSON.parse(c.form).target_language === 'es'))
  for (const lang of ['en', 'es']) {
    assert.deepEqual(streams(at(`dubs/dub-${lang}.mp4`)).streams.map(s => s.codec_type).sort(), ['audio', 'video'])
    assert.match(fs.readFileSync(at(`dubs/dub-${lang}.vtt`), 'utf8'), /WEBVTT/)
  }
  assert.match(r.stdout, /spent: 600 credits/)
})

test('credits estimates the voice changer and dubbing at their rates', () => {
  const r = spawnSync(process.execPath, [engine, 'credits', 'sts=60', 'dub=60x2', 'dub_v2=30'], { cwd: home, env: { ...process.env, VIDEO_EDITOR_DIR: home, ELEVENLABS_API_KEY: '' }, encoding: 'utf8' })
  assert.match(r.stdout, /voice change \(60 s\): 1000 credits/)
  assert.match(r.stdout, /dubbing v1 \(60 s × 2 languages\): 6000 credits/)
  assert.match(r.stdout, /dubbing v2 \(30 s × 1 language\): 6750 credits/)
})
