// A fake OpenRouter (under /api/v1) and ElevenLabs (under /el) for the tests (their models: test/models.json): generations that answer
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
  const calls = [], polls = {}, lookups = {}, names = {}, fetched = []
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
    // OpenRouter
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
    // a scoped key without the permission of dubbing; a free plan refused instant voice cloning
    if (p === '/el/v1/dubbing/project') return json({ detail: { type: 'authentication_error', code: 'unauthorized', message: 'The API key you used is missing the permission dubbing_write to execute this operation.', status: 'missing_permissions' } }, 401)
    if (p === '/el/v1/voices/add') return json({ detail: { type: 'payment_required', code: 'paid_plan_required', message: 'Your subscription does not include instant voice cloning. Please upgrade your plan.', status: 'can_not_use_instant_voice_cloning' } }, 400)
    if (p === '/el/v2/voices') return json({ voices: [{ voice_id: 'v1', name: 'Arthur', category: 'premade', labels: { gender: 'male' }, verified_languages: [{ language: 'en' }] }], has_more: false })
    json({ error: { message: `fake: nothing at ${p}` } }, 404)
  })
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const base = `http://127.0.0.1:${server.address().port}`
  return { base, bin, calls, fetched, close: () => { server.closeAllConnections(); server.close() } }
}
