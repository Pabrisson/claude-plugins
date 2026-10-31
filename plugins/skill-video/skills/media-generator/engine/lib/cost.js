// Costs: estimates from the providers' catalogs, the ledger of what was spent, and when to ask before spending.
// Each provider keeps its own unit: USD for OpenRouter, credits for ElevenLabs. Nothing is converted.
import fs from 'node:fs'
import path from 'node:path'

// Seedance's pixels per frame at a tier, its 16:9 size (its other ratios are within 3 %)
const SEEDANCE_PIXELS = { '480p': 864 * 496, '720p': 1280 * 720, '1080p': 1920 * 1080, '4k': 3840 * 2160 }

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
  // measured_*: what the bill showed beyond the listed prices (a model's own minimum length, a ratio to its price)
  const unit = k.startsWith('measured_minimum_seconds') ? 'min_seconds' : k.startsWith('measured_billed_ratio') ? 'ratio'
    : k.includes('minimum') ? 'minimum'
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
  const fits = (s, r = req) => (!s.res || s.res === String(r.resolution ?? '').toLowerCase())
    && (s.audio === null || s.audio === !!r.sound)
    && (!s.input || s.input === r.input)
    && (!s.creativity || s.creativity === r.creativity)
  // a price that names the sound wins: a per-resolution price without it would drop the sound's surcharge
  const score = s => (s.audio !== null ? 10 : 0) + [s.res, s.input, s.creativity].filter(x => x !== null).length
  const best = r => all.filter(s => ['second', 'token', 'mp_second'].includes(s.unit) && fits(s, r)).sort((a, b) => score(b) - score(a))[0]
  // a video sent to a token-priced model (Seedance) is billed apart at its with-video price, the output at the plain one
  const sent = req.input === 'video' ? all.find(s => s.unit === 'token' && s.input === 'video' && fits(s)) : null
  const main = best(sent ? { ...req, input: undefined } : req)
  // a note in place of the prices: a model whose bill does not follow them, said as it is
  if (!main) return { amount: null, unit: 'usd', known: false, detail: skus?.note ?? 'no price for these settings' }
  // a model that bills at least so many seconds (Kling 3.0 Pro: a 3 s shot billed 5 s, 2026-10-31)
  const least = all.find(s => s.unit === 'min_seconds')?.rate ?? 0, duration = Math.max(Number(req.duration) || 5, least)
  let amount, detail
  if (main.unit === 'second') [amount, detail] = [main.rate * duration, `${duration} s × $${main.rate}/s`]
  else if (main.unit === 'token') {
    // Seedance: its own frame sizes (about the same pixels at every ratio of a tier: 864×496, 752×560 at 480p), 24 fps
    // and one frame more (752 × 560 × 97 / 1024 tokens for 4 s, to the cent); a video sent adds its pixels at 8 frames
    // a second (2 jobs within 0.1 %): measured on 2026-10-31
    // ponytail: Seedance's formula; other token-priced models may count differently
    const [w, h] = dims(req.resolution, req.ratio), pixels = SEEDANCE_PIXELS[String(req.resolution).toLowerCase()] ?? w * h
    const tokens = Math.round((pixels * (24 * duration + 1)) / 1024)
    ;[amount, detail] = [tokens * main.rate, `${tokens} video tokens`]
    if (sent) {
      const input = Math.round((Math.max((req.width || w) * (req.height || h), req.min_pixels || 0) * 8 * (req.source_duration || duration)) / 1024)
      ;[amount, detail] = [amount + input * sent.rate, `${detail} + ${input} for the video sent`]
    }
  } else {
    // FLUX Video Upscale bills the output's megapixel-seconds at 58 % (precise) and 83 % (creative) of the catalog's
    // price, ×3 a tenth less: measured on 2026-10-29 (5 jobs, 320×180 and 640×360 sources)
    // ponytail: measured ratios, to measure again when the catalog's prices change
    const factor = Number(req.factor) || 2, mp = ((req.width || 1920) * (req.height || 1080) * factor * factor) / 1e6, billed = { precise: 0.5787, creative: 0.8267 }[main.creativity] ?? 1
    ;[amount, detail] = [mp * duration * main.rate * billed, `${mp.toFixed(1)} MP × ${duration} s`]
  }
  // more than listed, as billed (Wan 3.0 at 480p: $0.2125 for 2 s with or without sound, twice, 2026-10-31)
  const ratio = all.find(s => s.unit === 'ratio' && fits(s))
  if (ratio) [amount, detail] = [amount * ratio.rate, `${detail}, × ${ratio.rate} as billed`]
  const perImage = all.find(s => s.unit === 'per_image' && fits(s))
  if (perImage && req.images) amount += perImage.rate * req.images
  const min = all.find(s => s.unit === 'minimum')
  if (min && min.rate > amount) [amount, detail] = [min.rate, `the $${min.rate.toFixed(2)} minimum (${detail})`]
  return { amount: round(amount), unit: 'usd', known: true, detail }
}

// tokens an image output counts, for token-priced image models
// ponytail: published averages (Gemini 1,120 tokens up to 2K and 2,000 at 4K; GPT Image by quality, square, half as
// many again otherwise: 400 at 3:2, measured on 2026-10-31), 1,300 elsewhere
function imageTokens(model, resolution, quality, ratio) {
  // GPT Image 2.5 low: 196 square (its two bills to 0.3 %, 2026-10-31)
  if (model.startsWith('openai/')) return ({ low: model.includes('gpt-image-2.5') ? 196 : 272, medium: 1056 }[quality] ?? 4160) * (ratio && ratio !== '1:1' ? 1.5 : 1)
  if (model.startsWith('google/')) return String(resolution).toUpperCase() === '4K' ? 2000 : 1120
  return 1300
}
// tokens an input image counts: OpenAI's 32 px patches, 1,536 at most (1536×1024 1,536 and 1024×1024 1,024 on GPT
// Image 1 Mini, to the cent, 2026-10-31); 1,000 elsewhere
function inputTokens(model, [w, h] = []) {
  if (!model.startsWith('openai/') || !w || !h) return 1000
  return Math.min(1536, Math.ceil(w / 32) * Math.ceil(h / 32))
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
      // the prompt's text too, about 4 characters a token
      const count = billable === 'output_image' ? n : /input_image|input_reference/.test(billable) ? refs : billable === 'input_text' ? Math.ceil((req.text || 0) / 4) : 0
      if (!l || !count) continue
      const each = l.unit === 'megapixel' ? (MEGAPIXELS[res] ?? 1.05) : billable === 'input_text' ? 1
        : l.unit === 'token' ? (billable === 'output_image' ? imageTokens(model, res, req.quality, req.ratio) : inTokens) : 1
      usd += l.unit === 'request' ? l.cost_usd : l.cost_usd * each * count
    }
    return usd
  }
  return { amount: round(Math.max(...priced.map(one))), unit: 'usd', known: true, detail: `${n} image${n > 1 ? 's' : ''} at ${res}` }
}

// speech: the characters read, plus the seconds made when the model bills its output: about 14 characters a second
// and 1.5 s of silence around them; Gemini bills audio tokens, 25 a second, the others whole seconds (28 characters
// made 3.6 s on Gemini, 4.1 s billed 4 on Seed Audio, 2026-10-31)
// ponytail: measured on one short line each; a long text's pace may differ
export function estimateSpeech(model, pricing, text) {
  const chars = String(text ?? '').length, secs = 1.5 + chars / 14, google = model.startsWith('google/')
  if (!pricing) return { amount: null, unit: 'usd', known: false, detail: 'no price listed' }
  const amount = chars * Number(pricing.prompt || 0) + (google ? secs * 25 : Math.ceil(secs)) * Number(pricing.completion || 0)
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
