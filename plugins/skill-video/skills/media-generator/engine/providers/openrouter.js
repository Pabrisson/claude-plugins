// OpenRouter: one key for the image, video and speech models of many labs, billed in USD.
// $OPENROUTER_API_KEY (the plugin's secret), $OPENROUTER_MANAGEMENT_KEY for the account's balance, $OPENROUTER_BASE
// for the tests' fake server
import { estimateImage, estimateSpeech, estimateVideo } from '../lib/cost.js'

const base = () => (process.env.OPENROUTER_BASE ?? 'https://openrouter.ai/api/v1').replace(/\/$/, '')

// the catalogs are public: they work before the key is set
const PUBLIC = /^\/(images\/models|videos\/models|models\?)/
async function api(route, init = {}, key = process.env.OPENROUTER_API_KEY) {
  if (!key && !PUBLIC.test(route)) throw Object.assign(new Error('no OpenRouter key: /plugin configure skill-video@pabrisson, or OPENROUTER_API_KEY'), { status: 401 })
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
const values = p => p?.values ?? null
const range = p => (p?.type === 'range' ? { min: p.min, max: p.max } : null)

// the video models' kind of work, from their name: OpenRouter lists them all as video generation
const role = id => (/upscale/.test(id) ? 'upscale' : /video-edit|aleph/.test(id) ? 'edit' : /avatar/.test(id) ? 'avatar' : 'generate')

export default {
  id: 'openrouter',
  label: 'OpenRouter',
  unit: 'usd',
  key: () => !!process.env.OPENROUTER_API_KEY,

  // the catalog of a kind, in one shape for the form: what each model accepts, and its raw prices for the estimates
  async models(kind) {
    if (kind === 'image') {
      const { data } = await json('/images/models')
      // ponytail: one request per model for its endpoints' prices (60-odd, cached a day by the engine)
      const endpoints = await Promise.all(data.map(m => json(`/images/models/${m.id}/endpoints`).then(e => e.endpoints ?? e.data?.endpoints ?? []).catch(() => [])))
      return data.map((m, i) => {
        const p = m.supported_parameters ?? {}
        return {
          model: m.id, name: m.name, kind, role: (m.architecture?.input_modalities ?? []).includes('image') ? 'both' : 'create', description: m.description,
          params: { resolution: values(p.resolution), aspect_ratio: values(p.aspect_ratio), n: range(p.n), references: range(p.input_references)?.max ?? (p.input_references ? 4 : 0),
            seed: !!p.seed, quality: values(p.quality), background: values(p.background) },
          pricing: endpoints[i],
        }
      })
    }
    if (kind === 'video') {
      const { data } = await json('/videos/models')
      return data.map(m => ({
        model: m.id, name: m.name, kind, role: role(m.id), description: m.description,
        params: { resolution: m.supported_resolutions ?? null, aspect_ratio: m.supported_aspect_ratios ?? null, duration: m.supported_durations?.toSorted((a, b) => a - b) ?? null,
          frames: m.supported_frame_images ?? [], audio: m.generate_audio ?? null, seed: !!m.seed, creativity: !!m.creativity, factor: !!m.upscale_factor },
        pricing: m.pricing_skus ?? null,
      }))
    }
    if (kind === 'speech') {
      const { data } = await json('/models?output_modalities=speech')
      return data.map(m => ({ model: m.id, name: m.name, kind, role: 'create', description: m.description, params: { voices: m.supported_voices ?? null }, pricing: m.pricing ?? null }))
    }
    throw new Error(`no ${kind} models on OpenRouter`)
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
