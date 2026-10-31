import assert from 'node:assert/strict'
import test from 'node:test'
import { dims, estimateImage, estimateSpeech, estimateVideo, money, needsYes, parseSku, PLANS, spentThisMonth } from '../lib/cost.js'

// the pricing_skus shapes of OpenRouter's video catalog on 2026-10-29
test('a video costs its most specific per-second price that fits, never one that contradicts the request', () => {
  const veo = { duration_seconds_with_audio: '0.12', duration_seconds_with_audio_4k: '0.30', duration_seconds_without_audio: '0.10', duration_seconds_with_audio_720p: '0.10' }
  assert.equal(estimateVideo(veo, { duration: 8, resolution: '1080p', sound: true }).amount, 0.96)
  assert.equal(estimateVideo(veo, { duration: 8, resolution: '720p', sound: true }).amount, 0.8)
  assert.equal(estimateVideo(veo, { duration: 8, resolution: '4k', sound: true }).amount, 2.4)
  assert.equal(estimateVideo(veo, { duration: 8, resolution: '1080p', sound: false }).amount, 0.8)
  const kling = { duration_seconds: '0.112', duration_seconds_with_audio: '0.168', text_to_video_duration_seconds_720p: '0.112' }
  assert.equal(estimateVideo(kling, { duration: 5, resolution: '1080p', sound: true, input: 'image' }).amount, 0.84)
  assert.equal(estimateVideo(kling, { duration: 5, resolution: '1080p', sound: false, input: 'image' }).amount, 0.56)
  // a price per resolution that does not name the sound never hides the sound's surcharge
  const klingFull = { ...kling, text_to_video_duration_seconds_1080p: '0.112' }
  assert.equal(estimateVideo(klingFull, { duration: 5, resolution: '1080p', sound: true, input: 'text' }).amount, 0.84)
  assert.equal(estimateVideo(klingFull, { duration: 5, resolution: '1080p', sound: false, input: 'text' }).amount, 0.56)
  // cents, per resolution, plus each input image
  const grok = { cents_per_image_input: '1', cents_per_video_output_second_720p: '3', cents_per_video_output_second_1080p: '14' }
  assert.equal(estimateVideo(grok, { duration: 10, resolution: '1080p', input: 'image', images: 1 }).amount, 1.41)
  // a minimum per generation
  assert.equal(estimateVideo({ cents_per_second_output: '28', minimum_cents_per_generation: '56' }, { duration: 1, input: 'video' }).amount, 0.56)
  // video tokens (Seedance): its frame's pixels × (24 fps × seconds + 1) / 1024, as billed on 2026-10-31
  const seed15 = { video_tokens: '0.0000024', video_tokens_without_audio: '0.0000012' }
  assert.equal(estimateVideo(seed15, { duration: 4, resolution: '480p', ratio: '4:3', sound: false, input: 'image' }).amount, 0.0487, 'billed $0.04787 (752×560)')
  // a video sent: the output at the plain price, plus the video's pixels at 8 frames a second at the with-video price
  const mini = { video_tokens: '0.0000035', video_tokens_without_audio: '0.0000035', video_tokens_with_video_input: '0.0000021' }
  const sent = { resolution: '480p', ratio: '16:9', input: 'video', width: 848, height: 480, min_pixels: 407696 }
  assert.equal(estimateVideo(mini, { ...sent, duration: 4, sound: true, source_duration: 4.083 }).amount, 0.1694, 'billed $0.16962')
  assert.equal(estimateVideo(mini, { ...sent, duration: 5, sound: false, source_duration: 2.04 }).amount, 0.1909, 'billed $0.19071')
  // what the bill showed beyond the listed prices: a minimum length (Kling 3.0 Pro), a ratio at one tier (Wan 3.0, 480p)
  const kling5 = { duration_seconds: '0.112', duration_seconds_with_audio: '0.168', measured_minimum_seconds: '5' }
  assert.equal(estimateVideo(kling5, { duration: 3, sound: false }).amount, 0.56, 'billed $0.56 for 3 s')
  assert.equal(estimateVideo(kling5, { duration: 8, sound: false }).amount, 0.896)
  const wan = { duration_seconds_480p: '0.05', duration_seconds_720p: '0.1', measured_billed_ratio_480p: '2.125' }
  assert.equal(estimateVideo(wan, { duration: 2, resolution: '480p' }).amount, 0.2125, 'billed $0.2125 twice')
  assert.equal(estimateVideo(wan, { duration: 2, resolution: '720p' }).amount, 0.2)
  // megapixel-seconds of the output by creativity (FLUX upscale), at the share the router billed on 2026-10-29
  const up = { cents_per_megapixel_second_precise: '3.5', cents_per_megapixel_second_creative: '5' }
  assert.equal(estimateVideo(up, { duration: 1, creativity: 'precise', factor: 2, width: 320, height: 180 }).amount, 0.0047, 'billed $0.00467')
  assert.equal(estimateVideo(up, { duration: 1, creativity: 'precise', factor: 2, width: 640, height: 360 }).amount, 0.0187, 'billed $0.01867')
  assert.equal(estimateVideo(up, { duration: 2, creativity: 'precise', factor: 2, width: 320, height: 180 }).amount, 0.0093, 'billed $0.00933')
  assert.equal(estimateVideo(up, { duration: 1, creativity: 'creative', factor: 2, width: 320, height: 180 }).amount, 0.0095, 'billed $0.00952')
  assert.equal(estimateVideo(up, { duration: 1, creativity: 'precise', factor: 3, width: 320, height: 180 }).amount, 0.0105, 'billed $0.00933: ×3 within 12 %')
  // nothing that fits: unknown, never a guess
  assert.deepEqual(estimateVideo({ duration_seconds_480p: '0.05' }, { duration: 5, resolution: '1080p' }).known, false)
  assert.equal(estimateVideo(null, {}).known, false)
})

test('sku keys are read for their unit and conditions', () => {
  assert.deepEqual(parseSku('image_to_video_duration_seconds_1080p', '0.15'), { key: 'image_to_video_duration_seconds_1080p', rate: 0.15, unit: 'second', res: '1080p', audio: null, input: 'image', creativity: null })
  assert.equal(parseSku('cents_per_second_video_continuation_2k', '31').input, 'continuation')
  assert.equal(parseSku('reference_input_images', '0.04').unit, 'per_image')
  assert.deepEqual(dims('1080p', '9:16'), [1080, 1920])
})

test('an image costs its outputs at the resolution tier, by image, megapixel or token; the dearest endpoint counts', () => {
  const tiers = [{ pricing: [{ billable: 'output_image', unit: 'image', cost_usd: 0.13 }, { billable: 'output_image', unit: 'image', cost_usd: 0.15, variant: '2k' }, { billable: 'output_image', unit: 'image', cost_usd: 0.3, variant: '4k' }] }]
  assert.equal(estimateImage('x/y', tiers, { n: 2, resolution: '4K' }).amount, 0.6)
  assert.equal(estimateImage('x/y', tiers, { n: 1, resolution: '1K' }).amount, 0.13)
  // a tier without its k (FLUX's 768), or with the quality first (Grok's low_1k)
  const flux = [{ pricing: [{ billable: 'output_image', unit: 'image', cost_usd: 0.041, variant: '768' }, { billable: 'output_image', unit: 'image', cost_usd: 0.048, variant: '1k' }] }]
  assert.equal(estimateImage('black-forest-labs/flux-3-image', flux, { resolution: '768' }).amount, 0.041)
  const grok = [{ pricing: [{ billable: 'input_image', unit: 'image', cost_usd: 0.01 }, ...[['low_1k', 0.04], ['low_2k', 0.06], ['medium_1k', 0.06], ['medium_2k', 0.08]].map(([variant, cost_usd]) => ({ billable: 'output_image', unit: 'image', cost_usd, variant }))] }]
  assert.equal(estimateImage('x-ai/grok-imagine-image-2.0', grok, { resolution: '1K', quality: 'low' }).amount, 0.04)
  assert.equal(estimateImage('x-ai/grok-imagine-image-2.0', grok, { resolution: '2K', quality: 'medium', refs: 1 }).amount, 0.09)
  const gemini = [{ pricing: [{ billable: 'input_image', unit: 'token', cost_usd: 0.000002 }, { billable: 'output_image', unit: 'token', cost_usd: 0.00012 }] }, { pricing: [{ billable: 'output_image', unit: 'token', cost_usd: 0.0002 }] }]
  assert.equal(estimateImage('google/gemini-3-pro-image', gemini, { n: 1, resolution: '2K', refs: 1 }).amount, 0.224)
  assert.equal(estimateImage('flux/klein', [{ pricing: [{ billable: 'output_image', unit: 'megapixel', cost_usd: 0.014 }] }], { resolution: '1K' }).amount, 0.0147)
  // a surcharge variant is optional: left out
  assert.equal(estimateImage('krea/k3', [{ pricing: [{ billable: 'output_image', unit: 'image', cost_usd: 0.07 }, { billable: 'output_image', unit: 'request', cost_usd: 0.02, variant: 'high_thinking_surcharge' }] }], {}).amount, 0.07)
  assert.equal(estimateImage('x/y', [{ pricing: [] }], {}).known, false)
  // GPT Image counts an input image in 32 px patches, 1,536 at most, its prompt's text, and an output not square half as
  // much again (measured: $0.00287 on 2026-10-29, $0.007106 and $0.00479 on 2026-10-31)
  const mini = [{ pricing: [{ billable: 'input_image', unit: 'token', cost_usd: 0.0000025 }, { billable: 'input_text', unit: 'token', cost_usd: 0.000002 }, { billable: 'output_image', unit: 'token', cost_usd: 0.000008 }] }]
  assert.equal(estimateImage('openai/gpt-image-1-mini', mini, { quality: 'low', refs: 1, sizes: [[512, 512]] }).amount, 0.0028)
  assert.equal(estimateImage('openai/gpt-image-1-mini', mini, { quality: 'low', refs: 1, sizes: [[4032, 3024]] }).amount, 0.006)
  assert.equal(estimateImage('openai/gpt-image-1-mini', mini, { quality: 'low', ratio: '3:2', text: 131, refs: 1, sizes: [[1536, 1024]] }).amount, 0.0072)
  assert.equal(estimateImage('openai/gpt-image-1-mini', mini, { quality: 'low', ratio: '1:1', text: 108, refs: 1, sizes: [[1024, 1024]] }).amount, 0.0048)
  // GPT Image 2.5 low: 196 tokens square ($0.00596 and $0.014257 billed, 2026-10-31)
  const g25 = [{ pricing: [{ billable: 'input_image', unit: 'token', cost_usd: 0.000008 }, { billable: 'input_text', unit: 'token', cost_usd: 0.000005 }, { billable: 'output_image', unit: 'token', cost_usd: 0.00003 }] }]
  assert.equal(estimateImage('openai/gpt-image-2.5-sunburst', g25, { quality: 'low', ratio: '1:1', text: 44 }).amount, 0.0059)
  assert.equal(estimateImage('openai/gpt-image-2.5-flare', g25, { quality: 'low', ratio: '1:1', text: 108, refs: 1, sizes: [[1024, 1024]] }).amount, 0.0142)
})

test('speech costs its characters, and its seconds when the model bills them', () => {
  // 28 characters: Gemini 25 audio tokens a second ($0.0007965 billed), Seed Audio whole seconds ($0.01 billed for 4.1 s)
  assert.equal(estimateSpeech('google/gemini-3.8-flash-tts', { prompt: '0.0000005', completion: '0.000009' }, 'x'.repeat(28)).amount, 0.0008)
  assert.equal(estimateSpeech('bytedance-seed/seed-audio-1-0', { prompt: '0', completion: '0.0025' }, 'x'.repeat(28)).amount, 0.01)
  assert.equal(estimateSpeech('elevenlabs/eleven-v4', { prompt: '0.00008', completion: '0' }, 'x'.repeat(1000)).amount, 0.08)
  assert.equal(estimateSpeech('bytedance-seed/seed-audio-1-0', { prompt: '0', completion: '0.0025' }, 'x'.repeat(150)).amount, 0.0325, '1.5 s + 150 / 14, 13 whole seconds')
  assert.equal(estimateSpeech('a/b', null, 'hi').known, false)
})

test('the yes: unknown always, the cap and the threshold only once set; prices in their own unit', () => {
  assert.equal(needsYes({ known: false }), 'unknown')
  assert.equal(needsYes({ known: true, amount: 5 }, { threshold: null, cap: null }), null)
  assert.equal(needsYes({ known: true, amount: 2 }, { threshold: 1 }), 'threshold')
  assert.equal(needsYes({ known: true, amount: 2 }, { cap: 10 }, 9), 'cap')
  assert.equal(money(0.84, 'usd'), '$0.84')
  assert.equal(money(0.0021, 'usd'), '$0.002')
  // credits alone, with their dollars on a paid plan
  assert.equal(money(1610, 'credits', PLANS.creator), '1,610 credits · $0.29')
  assert.equal(money(51, 'credits', PLANS.starter), '51 credits · $0.01')
  assert.equal(money(1610, 'credits', null), '1,610 credits')
  assert.equal(money(1610, 'credits', PLANS.free), '1,610 credits')
  assert.equal(money(null, 'usd'), 'unknown cost')
  const now = new Date('2026-10-29T12:00:00Z')
  const ledger = [{ at: '2026-10-02T10:00:00Z', provider: 'openrouter', actual: 1.5 }, { at: '2026-10-03T10:00:00Z', provider: 'openrouter', actual: null, estimate: 0.5 },
    { at: '2026-09-30T10:00:00Z', provider: 'openrouter', actual: 9 }, { at: '2026-10-04T10:00:00Z', provider: 'elevenlabs', actual: 1000 }]
  assert.equal(spentThisMonth(ledger, 'openrouter', now), 2)
  assert.equal(spentThisMonth(ledger, 'elevenlabs', now), 1000)
})
