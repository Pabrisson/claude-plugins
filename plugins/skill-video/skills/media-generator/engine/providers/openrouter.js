// OpenRouter: one key for the image, video and speech models of many labs, billed in USD.
// $OPENROUTER_API_KEY (the plugin's secret), $OPENROUTER_MANAGEMENT_KEY for the account's balance, $OPENROUTER_BASE
// for the tests' fake server
import fs from 'node:fs'
import { estimateImage, estimateSpeech, estimateVideo } from '../lib/cost.js'

const base = () => (process.env.OPENROUTER_BASE ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '')

async function api(route, init = {}, key = process.env.OPENROUTER_API_KEY) {
  if (!key) throw Object.assign(new Error('no OpenRouter key: /plugin configure skill-video@pabrisson, or OPENROUTER_API_KEY'), { status: 401 })
  const r = await fetch(base() + route, {
    ...init,
    headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), 'x-title': 'media-generator', ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...init.headers },
  })
  if (!r.ok) {
    const text = await r.text(), message = (() => { try { return JSON.parse(text).error?.message ?? text } catch { return text } })()
    const why = { 401: 'the key is refused', 402: 'no credits left on OpenRouter', 429: 'rate limited, try again in a moment' }[r.status]
    throw Object.assign(new Error(`OpenRouter ${route.split('?')[0]}: ${r.status}${why ? ` (${why})` : ''} ${message}`.trim()), { status: r.status })
  }
  return r
}
const json = async (route, init) => (await api(route, init)).json()

// the models on offer: a normalized list kept by hand next to this file, never fetched (the tests' own in
// $MEDIA_GENERATOR_MODELS)
const list = () => JSON.parse(fs.readFileSync(process.env.MEDIA_GENERATOR_MODELS ?? new URL('./openrouter-models.json', import.meta.url), 'utf8'))

export default {
  id: 'openrouter',
  label: 'OpenRouter',
  unit: 'usd',
  key: () => !!process.env.OPENROUTER_API_KEY,

  // the list of a kind in the engine's shape: what each model accepts, and its raw prices for the estimates
  async models(kind) {
    const all = list()[kind]
    if (!all) throw new Error(`no ${kind} models on OpenRouter`)
    return all.map(m => ({
      model: m.id, name: `${m.lab}: ${m.name}`, lab: m.lab, kind, role: m.role,
      params: kind === 'image'
        ? { resolution: m.resolutions, aspect_ratio: m.aspect_ratios, n: { min: 1, max: m.max_images }, references: m.references, seed: m.seed, quality: m.quality, background: m.background }
        : kind === 'video'
          ? { resolution: m.resolutions, aspect_ratio: m.aspect_ratios, duration: m.durations, frames: m.frames, references: m.references, audio: m.sound, seed: m.seed, creativity: !!m.upscale?.creativity, factor: !!m.upscale, min_pixels: m.min_pixels }
          : { voices: m.voices },
      pricing: kind === 'image' ? m.pricing.map(pricing => ({ pricing })) : m.pricing,
    }))
  },

  estimate(kind, m, req) {
    if (kind === 'image') return estimateImage(m.model, m.pricing, req)
    if (kind === 'video') return estimateVideo(m.pricing, req)
    return estimateSpeech(m.model, m.pricing, req.text)
  },

  // images come back in the answer; refs are URLs or data: URLs
  async image({ model, prompt, refs = [], ...params }) {
    const body = { model, prompt, ...params, ...(refs.length ? { input_references: refs.map(url => ({ type: 'image_url', image_url: { url } })) } : {}) }
    const j = await json('/images', { method: 'POST', body: JSON.stringify(body) })
    return { files: j.data.map(d => ({ data: Buffer.from(d.b64_json, 'base64'), type: d.media_type ?? 'image/png' })), cost: j.usage?.cost ?? null }
  },

  // videos are jobs: the id to poll (and to continue with previous_job_id)
  async video({ model, prompt, frames = {}, refs = [], ...params }) {
    const frame_images = Object.entries(frames).filter(([, url]) => url).map(([frame_type, url]) => ({ type: 'image_url', image_url: { url }, frame_type }))
    const input_references = refs.map(({ kind, url }) => ({ type: `${kind}_url`, [`${kind}_url`]: { url } }))
    const body = { model, ...(prompt ? { prompt } : {}), ...params, ...(frame_images.length ? { frame_images } : {}), ...(input_references.length ? { input_references } : {}) }
    const j = await json('/videos', { method: 'POST', body: JSON.stringify(body) })
    return { id: j.id, polling_url: j.polling_url }
  },
  async poll(job) {
    const j = await json(`/videos/${job.id}`)
    return { status: j.status, urls: j.unsigned_urls ?? [], cost: j.usage?.cost ?? null, error: j.error ?? null }
  },
  async download(url) {
    const r = await api(url.startsWith('http') ? url.slice(url.indexOf('/videos/')) : url)
    return Buffer.from(await r.arrayBuffer())
  },

  // speech comes back as bytes; its cost from the generation's stats, a moment later
  async speech({ model, text, voice, instructions, refs = [], format = 'mp3' }) {
    const body = { model, input: text, response_format: format, ...(voice ? { voice } : {}), ...(instructions ? { instructions } : {}),
      ...(refs.length ? { input_references: refs.map(url => ({ type: 'input_audio', input_audio: { data: url } })) } : {}) }
    const r = await api('/audio/speech', { method: 'POST', body: JSON.stringify(body) })
    // raw PCM says its rate in its type: audio/pcm;rate=44100;channels=1 (HeyGen), 24000 (Gemini)
    const type = r.headers.get('content-type') ?? ''
    return { data: Buffer.from(await r.arrayBuffer()), format, rate: +type.match(/rate=(\d+)/)?.[1] || 24000, channels: +type.match(/channels=(\d+)/)?.[1] || 1,
      generation: r.headers.get('x-generation-id') }
  },
  // the generation's stats answer 404 for 10 to 15 s after the speech
  async generationCost(id) {
    for (let i = 0; i < 15; i++) {
      const j = await json(`/generation?id=${encodeURIComponent(id)}`).catch(() => null)
      if (j?.data?.total_cost != null) return j.data.total_cost
      await new Promise(ok => setTimeout(ok, +(process.env.MEDIA_GENERATOR_POLL ?? 2000)))
    }
    return null
  },

  // what is left: the key's own limit and month, and with a management key the account's balance
  async balance() {
    const { data: k } = await json('/key')
    const out = { unit: 'usd', key_left: k.limit_remaining ?? null, key_limit: k.limit ?? null, month: k.usage_monthly ?? null, account_left: null }
    if (process.env.OPENROUTER_MANAGEMENT_KEY) {
      const r = await api('/credits', {}, process.env.OPENROUTER_MANAGEMENT_KEY).then(x => x.json()).catch(() => null)
      if (r?.data) out.account_left = Math.round((r.data.total_credits - r.data.total_usage) * 100) / 100
    }
    return out
  },
}
