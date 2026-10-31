// OpenRouter: one key for the image, video and speech models of many labs, billed in USD.
// $OPENROUTER_API_KEY (the plugin's secret), $OPENROUTER_MANAGEMENT_KEY for the account's balance, $OPENROUTER_BASE
// for the tests' fake server
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
    const why = { 401: 'the key is refused', 402: 'no credits left on OpenRouter, or held by videos still running: wait for them to end', 429: 'rate limited, try again in a moment' }[r.status]
    throw Object.assign(new Error(`OpenRouter ${route.split('?')[0]}: ${r.status}${why ? ` (${why})` : ''} ${message}`.trim()), { status: r.status })
  }
  return r
}
const json = async (route, init) => (await api(route, init)).json()

// the models on offer: a normalized list kept by hand next to this file (the tests' own in $MEDIA_GENERATOR_MODELS),
// plus the models OpenRouter's catalog has and it lacks
const list = () => JSON.parse(fs.readFileSync(process.env.MEDIA_GENERATOR_MODELS ?? new URL('./openrouter-models.json', import.meta.url), 'utf8'))

// ---------- the catalog: OpenRouter's free routes, checked once a day, cached for every project of this machine ----------

const CATALOG = () => process.env.MEDIA_GENERATOR_CATALOG ?? path.join(os.homedir(), '.cache/media-generator/openrouter-catalog.json')
const DAY = 864e5
const RES = ['360p', '432p', '480p', '540p', '720p', '768p', '1080p', '1440p', '512', '768', '1K', '1.5K', '2K', '4K']
const byRes = l => (l?.length ? l.filter(r => RES.includes(r)).toSorted((a, b) => RES.indexOf(a) - RES.indexOf(b)) : null)
const ratio = r => (r === 'auto' ? Infinity : r.split(':').reduce((a, b) => a / b))
const byRatio = l => (l?.length ? l.toSorted((a, b) => ratio(a) - ratio(b)) : null)
// « Black Forest Labs: FLUX 3 Image » → its lab and its name, as the hand list keeps them
const named = m => { const i = m.name.indexOf(': '); return i > 0 ? { lab: m.name.slice(0, i), name: m.name.slice(i + 2) } : { lab: m.id.split('/')[0], name: m.name } }
const values = p => p?.values ?? null

// a catalog entry in the hand list's shape; null for one OpenRouter does not serve yet (no endpoint, no price)
const NORMALIZE = {
  image(m, endpoints) {
    const sp = m.supported_parameters ?? {}, priced = endpoints.filter(e => e.pricing?.length)
    if (!priced.length) return null
    const takes = m.architecture?.input_modalities?.includes('image')
    return { id: m.id, ...named(m), role: !takes ? 'create' : sp.input_references?.min > 0 ? 'edit' : 'both',
      resolutions: byRes(values(sp.resolution)), aspect_ratios: byRatio(values(sp.aspect_ratio)), max_images: sp.n?.max ?? 1,
      references: takes ? sp.input_references?.max ?? 1 : 0, quality: values(sp.quality), background: values(sp.background), seed: !!sp.seed,
      pricing: priced.map(e => e.pricing) }
  },
  // the catalog does not say edit or avatar: a model with no length of its own takes a video (Aleph 2, FLUX Video Edit;
  // HeyGen's avatar too), kept off the create tools till its tool names it; its references unknown
  video: m => ({ id: m.id, ...named(m), role: m.upscale_factor ? 'upscale' : m.supported_durations?.length ? 'generate' : 'edit',
    resolutions: byRes(m.supported_resolutions), aspect_ratios: byRatio(m.supported_aspect_ratios), durations: m.supported_durations?.toSorted((a, b) => a - b) ?? null,
    frames: m.supported_frame_images ?? [], references: null, sound: !!m.generate_audio, seed: !!m.seed,
    upscale: m.upscale_factor ? { ...m.upscale_factor, creativity: !!m.creativity } : null, min_pixels: null,
    pricing: Object.fromEntries(Object.entries(m.pricing_skus ?? {}).map(([k, v]) => [k, Number(v)])) }),
  speech: m => ({ id: m.id, ...named(m), role: 'speech', voices: m.supported_voices?.length ? m.supported_voices : null,
    pricing: { prompt: Number(m.pricing?.prompt ?? 0), completion: Number(m.pricing?.completion ?? 0) } }),
}

// the routes answer without a key; the image prices come from each new model's endpoints, one request each
async function fetchCatalog(hand) {
  const get = route => fetch(base() + route, { signal: AbortSignal.timeout(15e3) }).then(r => {
    if (!r.ok) throw new Error(`OpenRouter ${route.split('?')[0]}: ${r.status}`)
    return r.json()
  })
  const [image, video, speech] = await Promise.all(['/images/models', '/videos/models', '/models?output_modalities=speech'].map(get))
  const known = kind => new Set(hand[kind].map(m => m.id)), fresh = (kind, data) => data.filter(m => !known(kind).has(m.id))
  const images = await Promise.all(fresh('image', image.data).map(async m => NORMALIZE.image(m, (await get(`/images/models/${m.id}/endpoints`).catch(() => null))?.endpoints ?? [])))
  return { at: new Date().toISOString(), image: images.filter(Boolean), video: fresh('video', video.data).map(NORMALIZE.video), speech: fresh('speech', speech.data).map(NORMALIZE.speech) }
}

let catalog = null, pending = null
const EMPTY = { at: null, image: [], video: [], speech: [] }
const readCatalog = () => { try { return JSON.parse(fs.readFileSync(CATALOG(), 'utf8')) } catch { return null } }
// the cached catalog while under a day old, else a new one; a failed check keeps the old one and waits a day (this
// process), forced it says why. force: Settings' « Update the list », models --refresh
async function catalogOf(force = false) {
  catalog ??= readCatalog()
  if (!force && catalog && Date.now() - Date.parse(catalog.checked ?? catalog.at) < DAY) return catalog
  pending ??= fetchCatalog(list()).then(c => {
    fs.mkdirSync(path.dirname(CATALOG()), { recursive: true })
    fs.writeFileSync(CATALOG(), JSON.stringify(c, null, 1))
    return (catalog = c)
  }).catch(e => {
    if (force) throw e
    return (catalog = { ...EMPTY, ...catalog, checked: new Date().toISOString() })
  }).finally(() => { pending = null })
  return pending
}

// a short price to show beside a catalog model: its cheapest settings
function fromPrice(kind, m) {
  const e = kind === 'image' ? estimateImage(m.id, m.pricing.map(pricing => ({ pricing })), { resolution: m.resolutions?.[0] ?? '1K' })
    : kind === 'video' ? estimateVideo(m.pricing, { duration: m.durations?.[0] ?? 5, resolution: m.resolutions?.[0], ratio: m.aspect_ratios?.[0], input: 'text' })
      : estimateSpeech(m.id, m.pricing, 'x'.repeat(1000))
  return e.known ? `$${e.amount} ${kind === 'image' ? 'an image' : kind === 'video' ? `for ${m.durations?.[0] ?? 5} s${m.resolutions?.[0] ? ` at ${m.resolutions[0]}` : ''}` : 'for 1,000 characters'}` : null
}

export default {
  id: 'openrouter',
  label: 'OpenRouter',
  unit: 'usd',
  key: () => !!process.env.OPENROUTER_API_KEY,

  // the catalog's models the hand list lacks, checked now: when, and what it added (its new ones this time apart)
  async refresh() {
    const prev = catalog ?? readCatalog(), before = new Set(['image', 'video', 'speech'].flatMap(k => prev?.[k]?.map(m => m.id) ?? []))
    const c = await catalogOf(true)
    const added = Object.fromEntries(['image', 'video', 'speech'].map(k => [k, c[k].map(m => ({ id: `openrouter:${m.id}`, name: `${m.lab}: ${m.name}`, found: !before.has(m.id) }))]))
    return { at: c.at, added }
  },
  // when the catalog was last read, and how many models it adds (the dashboard's Settings)
  catalogInfo() {
    const c = catalog ?? readCatalog()
    return { at: c?.at ?? null, added: c ? c.image.length + c.video.length + c.speech.length : 0 }
  },

  // the list of a kind in the engine's shape: what each model accepts, and its raw prices for the estimates. The
  // catalog's ones say new, with a price at their cheapest settings
  async models(kind) {
    const hand = list()[kind]
    if (!hand) throw new Error(`no ${kind} models on OpenRouter`)
    const ids = new Set(hand.map(m => m.id)), added = (await catalogOf())[kind]?.filter(m => !ids.has(m.id)) ?? []
    return [...hand, ...added.map(m => ({ ...m, new: true }))].map(m => ({
      ...(m.new ? { new: true, from: fromPrice(kind, m) } : {}),
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
  async video({ model, prompt, frames = {}, refs = [], keyframes, ...params }) {
    const frame_images = Object.entries(frames).filter(([, url]) => url).map(([frame_type, url]) => ({ type: 'image_url', image_url: { url }, frame_type }))
    const input_references = refs.map(({ kind, url }) => ({ type: `${kind}_url`, [`${kind}_url`]: { url } }))
    const body = { model, ...(prompt ? { prompt } : {}), ...params, ...(frame_images.length ? { frame_images } : {}), ...(input_references.length ? { input_references } : {}),
      // a provider's own parameters (GET /videos/models: allowed_passthrough_parameters) go under its slug: Aleph 2's
      // keyframes reach Runway only there (at the top level they were dropped, 2026-10-31)
      ...(keyframes ? { provider: { options: { runway: { parameters: { keyframes } } } } } : {}) }
    // Seedance 2.5's -1 (« follow the video ») is refused by OpenRouter until it takes it (2026-10-31): said so
    const j = await json('/videos', { method: 'POST', body: JSON.stringify(body) }).catch(e => {
      if (params.duration === -1 && e.status === 400) e.message += ': Seedance 2.5 edits a video once OpenRouter accepts duration -1 (github.com/OpenRouterTeam/typescript-sdk/issues/1096), till then take Seedance 2.0 Mini'
      throw e
    })
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
