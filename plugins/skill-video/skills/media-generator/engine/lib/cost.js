// Costs: estimates from the providers' catalogs, the ledger of what was spent, and when to ask before spending.
// Each provider keeps its own unit: USD for OpenRouter, credits for ElevenLabs. Nothing is converted.
import fs from 'node:fs'
import path from 'node:path'

// pixels of a resolution tier at a ratio (the tier is the short side, as video tiers are named)
const SHORT = { '480p': 480, '720p': 720, '768p': 768, '1080p': 1080, '2k': 1440, '4k': 2160 }
export function dims(resolution = '1080p', ratio = '16:9') {
  const short = SHORT[String(resolution).toLowerCase()] ?? 1080
  const [a, b] = String(ratio).split(':').map(Number)
  const r = a && b ? a / b : 16 / 9
  return r >= 1 ? [Math.round(short * r), short] : [short, Math.round(short / r)]
}

// one key of a video model's pricing_skus: what it bills and under which conditions
export function parseSku(key, value) {
  const k = key.toLowerCase(), rate = Number(value) / (k.includes('cents') ? 100 : 1)
  const unit = k.includes('minimum') ? 'minimum'
    : /image_input|images/.test(k) ? 'per_image'
    : k.includes('megapixel_second') ? 'mp_second'
    : k.includes('video_tokens') ? 'token'
    : k.includes('second') ? 'second' : null
  return {
    key, rate, unit,
    res: k.match(/480p|720p|768p|1080p|2k|4k/)?.[0] ?? null,
    audio: k.includes('without_audio') ? false : k.includes('with_audio') ? true : null,
    input: k.startsWith('text_to_video') ? 'text' : k.startsWith('image_to_video') ? 'image' : k.includes('with_video_input') ? 'video'
      : k.includes('continuation') ? 'continuation' : k.startsWith('reference_') ? 'reference' : null,
    creativity: k.includes('precise') ? 'precise' : k.includes('creative') ? 'creative' : null,
  }
}

// a video: the most specific per-second (or per-token, per-megapixel-second) price that does not contradict the
// request, times its length; plus the images it sends, at least the minimum. req: duration, resolution, ratio,
// sound, input (text | image | video | continuation), images, creativity, width/height (the source of an upscale)
export function estimateVideo(skus, req) {
  const all = Object.entries(skus ?? {}).map(([k, v]) => parseSku(k, v)).filter(s => s.unit && Number.isFinite(s.rate))
  const fits = s => (!s.res || s.res === String(req.resolution ?? '').toLowerCase())
    && (s.audio === null || s.audio === !!req.sound)
    && (!s.input || s.input === req.input)
    && (!s.creativity || s.creativity === req.creativity)
  // a price that names the sound wins: a per-resolution price without it would drop the sound's surcharge
  const score = s => (s.audio !== null ? 10 : 0) + [s.res, s.input, s.creativity].filter(x => x !== null).length
  const main = all.filter(s => ['second', 'token', 'mp_second'].includes(s.unit) && fits(s)).sort((a, b) => score(b) - score(a))[0]
  if (!main) return { amount: null, unit: 'usd', known: false, detail: 'no price for these settings' }
  const duration = Number(req.duration) || 5
  let amount, detail
  if (main.unit === 'second') [amount, detail] = [main.rate * duration, `${duration} s × $${main.rate}/s`]
  else if (main.unit === 'token') {
    // ponytail: Seedance's formula (width × height × 24 fps × seconds / 1024); other token-priced models may count differently
    const [w, h] = dims(req.resolution, req.ratio), tokens = Math.round((w * h * 24 * duration) / 1024)
    ;[amount, detail] = [tokens * main.rate, `${tokens} video tokens`]
  } else {
    // FLUX Video Upscale bills the output's megapixel-seconds at 58 % (precise) and 83 % (creative) of the catalog's
    // price, ×3 a tenth less: measured on 2026-10-29 (5 jobs, 320×180 and 640×360 sources)
    // ponytail: measured ratios, to measure again when the catalog's prices change
    const factor = Number(req.factor) || 2, mp = ((req.width || 1920) * (req.height || 1080) * factor * factor) / 1e6, billed = { precise: 0.5787, creative: 0.8267 }[main.creativity] ?? 1
    ;[amount, detail] = [mp * duration * main.rate * billed, `${mp.toFixed(1)} MP × ${duration} s`]
  }
  const perImage = all.find(s => s.unit === 'per_image' && fits(s))
  if (perImage && req.images) amount += perImage.rate * req.images
  const min = all.find(s => s.unit === 'minimum')
  if (min) amount = Math.max(amount, min.rate)
  return { amount: round(amount), unit: 'usd', known: true, detail }
}

// tokens an image output counts, for token-priced image models
// ponytail: published averages (Gemini 1,120 tokens up to 2K and 2,000 at 4K; GPT Image by quality), 1,300 elsewhere
function imageTokens(model, resolution, quality) {
  if (model.startsWith('openai/')) return { low: 272, medium: 1056 }[quality] ?? 4160
  if (model.startsWith('google/')) return String(resolution).toUpperCase() === '4K' ? 2000 : 1120
  return 1300
}
// tokens an input image counts: OpenAI's 512 px tiles (85 + 170 each) once it fits 2048 px and 768 px on its short
// side, never enlarged (a 512 px image 255, measured on 2026-10-29); 1,000 elsewhere
function inputTokens(model, [w, h] = []) {
  if (!model.startsWith('openai/') || !w || !h) return 1000
  const k = Math.min(1, 2048 / Math.max(w, h), 768 / Math.min(w, h))
  return 85 + 170 * Math.ceil((w * k) / 512) * Math.ceil((h * k) / 512)
}
const MEGAPIXELS ={ '512': 0.26, '768': 0.59, '1K': 1.05, '1.5K': 2.36, '2K': 4.19, '4K': 16.8 }

// an image request on one endpoint's pricing lines: outputs, the references it sends; the dearest endpoint counts
export function estimateImage(model, endpoints, req) {
  const n = Number(req.n) || 1, refs = Number(req.refs) || 0, res = req.resolution ?? '1K'
  const priced = (endpoints ?? []).map(e => e.pricing ?? []).filter(p => p.length)
  if (!priced.length) return { amount: null, unit: 'usd', known: false, detail: 'no price listed' }
  const inTokens = req.sizes?.length ? req.sizes.reduce((a, s) => a + inputTokens(model, s), 0) / req.sizes.length : 1000
  // per billable line: its resolution tier's variant (768, 1k, Grok's low_1k with the quality first), else the plain
  // one; other variants are optional surcharges
  const tier = v => /^((low|medium|high)_)?\d+(\.\d+)?k?$/i.test(v)
  const want = [String(res), `${req.quality}_${res}`].map(s => s.toLowerCase())
  const one = lines => {
    let usd = 0
    for (const billable of new Set(lines.map(l => l.billable))) {
      const same = lines.filter(l => l.billable === billable && (!l.variant || tier(l.variant)))
      const l = same.find(x => want.includes(x.variant?.toLowerCase())) ?? same.find(x => !x.variant) ?? same[0]
      const count = billable === 'output_image' ? n : /input_image|input_reference/.test(billable) ? refs : 0
      if (!l || !count) continue
      const each = l.unit === 'megapixel' ? (MEGAPIXELS[res] ?? 1.05) : l.unit === 'token' ? (billable === 'output_image' ? imageTokens(model, res, req.quality) : inTokens) : 1
      usd += l.unit === 'request' ? l.cost_usd : l.cost_usd * each * count
    }
    return usd
  }
  return { amount: round(Math.max(...priced.map(one))), unit: 'usd', known: true, detail: `${n} image${n > 1 ? 's' : ''} at ${res}` }
}

// speech: the characters read, plus the seconds made when the model bills its output
// ponytail: about 15 characters a second; Gemini bills audio tokens, 32 a second
export function estimateSpeech(model, pricing, text) {
  const chars = String(text ?? '').length, secs = chars / 15
  if (!pricing) return { amount: null, unit: 'usd', known: false, detail: 'no price listed' }
  const amount = chars * Number(pricing.prompt || 0) + secs * Number(pricing.completion || 0) * (model.startsWith('google/') ? 32 : 1)
  return { amount: round(amount), unit: 'usd', known: true, detail: `${chars} characters` }
}

const round = x => Math.round(x * 10000) / 10000

// the ledger: one JSON line per paid action, in the provider's unit
const ledgerFile = home => path.join(home, 'ledger.jsonl')
export function readLedger(home) {
  const f = ledgerFile(home)
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []
}
export function appendLedger(home, entry) {
  fs.appendFileSync(ledgerFile(home), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n')
}
// what a provider cost this month (its actual cost, else its estimate while it runs)
export function spentThisMonth(entries, provider, now = new Date()) {
  const month = now.toISOString().slice(0, 7)
  return round(entries.filter(e => e.provider === provider && e.at.startsWith(month)).reduce((a, e) => a + (e.actual ?? e.estimate ?? 0), 0))
}

// whether a paid action needs the user's yes first: an unknown price, over the threshold, or over the monthly cap.
// threshold and cap are per provider and unset by default (settings.json), so then nothing asks
export function needsYes(estimate, limits = {}, spent = 0) {
  if (!estimate.known) return 'unknown'
  if (limits.cap != null && spent + estimate.amount > limits.cap) return 'cap'
  if (limits.threshold != null && estimate.amount > limits.threshold) return 'threshold'
  return null
}

// ElevenLabs' plans in USD per 1,000 credits (the user's table, 2026-10-29): the plan set in Settings prices the credits
export const PLANS = { free: 0, starter: 0.2, creator: 0.1818, pro: 0.165, scale: 0.166, business: 0.165 }

// what a price looks like: dollars for OpenRouter, credits for ElevenLabs, with their dollars once a paid plan is set
export function money(amount, unit, usdPer1000) {
  if (amount == null) return 'unknown cost'
  // cents, or a tenth of a cent under ten cents ($0.039)
  if (unit === 'usd') return `$${amount >= 0.1 || !amount ? amount.toFixed(2) : amount.toFixed(3).replace(/0$/, '')}`
  const credits = `${Math.round(amount).toLocaleString('en-US')} credits`
  return usdPer1000 ? `${credits} · ${money((amount * usdPer1000) / 1000, 'usd')}` : credits
}
