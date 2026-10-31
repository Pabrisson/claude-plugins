// ElevenLabs, straight to its API (never through a router): its speech models as GET /v1/models lists them, one voice
// (text to speech) or several (text to dialogue, Eleven v4 and v3), billed in its credits: a character each, half on
// the models it halves (character_cost_multiplier). $ELEVENLABS_API_KEY (the plugin's secret); $ELEVENLABS_BASE for the
// tests' fake server. Its voice changer, dubbing and clones stay with video-editor's engine
import fs from 'node:fs'

const base = () => (process.env.ELEVENLABS_BASE ?? 'https://api.elevenlabs.io').replace(/\/$/, '')
const key = () => process.env.ELEVENLABS_API_KEY

async function call(route, init = {}) {
  if (!key()) throw Object.assign(new Error('no ElevenLabs key: /plugin configure skill-video@pabrisson, or ELEVENLABS_API_KEY'), { status: 401 })
  const r = await fetch(base() + route, { ...init, headers: { 'xi-api-key': key(), ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers } })
  if (!r.ok) {
    // ElevenLabs' own sentence (detail.message), not its whole JSON
    const text = await r.text(), why = (() => { try { const d = JSON.parse(text).detail; return d?.message ?? (typeof d === 'string' ? d : null) } catch { return null } })()
    throw Object.assign(new Error(`ElevenLabs ${route.split('?')[0]}: ${r.status} ${why ?? text.slice(0, 200)}`), { status: r.status })
  }
  return r
}

// what each model takes beyond its list (docs of 2026-10-31): v4 and v4 Turbo only stability and similarity, no speed,
// no style; v3's stability is one of three steps; dialogue on v4 and v3; audio tags on v4, v4 Turbo and v3s;
// Multilingual v2 refuses a language code
const DIALOGUE = ['eleven_v4', 'eleven_v3']
const TAGS = /^eleven_v(3|4)/
const V4 = /^eleven_v4/, V3 = /^eleven_v3/
// a dialogue reads reliably up to 2,000 characters, 10 voices (the API reference)
export const DIALOGUE_MAX = 2000, DIALOGUE_VOICES = 10
const slider = (key, label, min, max, step, value, hint) => ({ key, label, type: 'slider', min, max, step, default: value, hint })
function optionsOf(m) {
  const id = m.model_id
  return [
    V3.test(id)
      ? { key: 'stability', label: 'Stability', type: 'choice', values: [{ value: 0, label: 'Creative' }, { value: 0.5, label: 'Natural' }, { value: 1, label: 'Robust' }], default: 0.5, hint: 'Creative is the most expressive, Robust the steadiest' }
      : slider('stability', 'Stability', 0, 1, 0.05, 0.5, 'lower is more expressive, higher steadier'),
    slider('similarity_boost', 'Similarity', 0, 1, 0.05, 0.75, 'how close to the voice it stays'),
    m.can_use_style && slider('style', 'Style exaggeration', 0, 1, 0.05, 0, 'the voice\'s own style, amplified'),
    !V4.test(id) && slider('speed', 'Speed', 0.7, 1.2, 0.05, 1),
    m.can_use_speaker_boost && { key: 'use_speaker_boost', label: 'Speaker boost', type: 'switch', default: true, hint: 'closer to the voice, a little slower' },
    id !== 'eleven_multilingual_v2' && (m.languages?.length ?? 0) > 1 && { key: 'language_code', label: 'Language', type: 'select', values: m.languages.map(l => ({ value: l.language_id, label: l.name })), default: '', hint: 'read in this language; Auto follows the text' },
    { key: 'apply_text_normalization', label: 'Numbers and dates', type: 'choice', values: [{ value: 'auto', label: 'Auto' }, { value: 'on', label: 'Spelled out' }, { value: 'off', label: 'As written' }], default: 'auto' },
  ].filter(Boolean)
}

// the list, straight from ElevenLabs (a free call): a new model shows by itself; read again once a day by a long-running
// server. A key without models_read (a scoped one) gets the engine's copy of it, its languages named here
const SNAPSHOT = new URL('./elevenlabs-models.json', import.meta.url)
const NAMES = new Intl.DisplayNames(['en'], { type: 'language' })
const named = id => { try { return NAMES.of(id) } catch { return id } }
const snapshot = () => JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')).models.map(m => ({ ...m, languages: m.languages.map(id => ({ language_id: id, name: named(id) })) }))
export let fromSnapshot = false
let listed = null, at = 0
async function list() {
  if (!listed || Date.now() - at > 864e5) {
    at = Date.now()
    listed = call('/v1/models').then(r => r.json(), e => {
      if (![401, 403].includes(e.status)) throw e
      fromSnapshot = true
      return snapshot()
    }).catch(e => { listed = null; throw e })
  }
  return (await listed).filter(m => m.can_do_text_to_speech)
}

// the voice's own settings unless some are asked: only those are sent
const voiceSettings = o => {
  const vs = Object.fromEntries(['stability', 'similarity_boost', 'style', 'speed', 'use_speaker_boost'].filter(k => o[k] != null).map(k => [k, o[k]]))
  return Object.keys(vs).length ? { voice_settings: vs } : {}
}

export default {
  id: 'elevenlabs',
  label: 'ElevenLabs',
  unit: 'credits',
  key: () => !!key(),

  async models(kind) {
    if (kind !== 'speech' || !key()) return []
    return (await list()).map(m => ({
      model: m.model_id, name: m.name, lab: 'ElevenLabs', kind, role: 'speech',
      params: { voices: null, clone: 'library', seed: true, dialogue: DIALOGUE.includes(m.model_id), speakers: DIALOGUE.includes(m.model_id) ? DIALOGUE_VOICES : 0, tags: TAGS.test(m.model_id),
        max_chars: m.maximum_text_length_per_request ?? null, options: optionsOf(m) },
      pricing: { multiplier: (m.model_rates?.character_cost_multiplier ?? 1) * (m.model_rates?.cost_discount_multiplier ?? 1) },
    }))
  },

  // a credit a character (spaces and audio tags too), times the model's multiplier
  estimate(kind, m, req) {
    const chars = req.text ?? 0, x = m.pricing.multiplier
    return { amount: Math.ceil(chars * x), unit: 'credits', known: true, detail: `${chars} characters${x !== 1 ? ` × ${x}` : ''}` }
  },

  // one voice, or a dialogue's lines (each its voice); the options as the API names them. MP3 at 128 kb/s, on every
  // plan; what it billed in its character-cost header
  async speech({ model, text, voice, dialogue, options = {}, seed }) {
    const { stability, similarity_boost, language_code, apply_text_normalization } = options
    const shared = { model_id: model, ...(language_code ? { language_code } : {}), ...(apply_text_normalization ? { apply_text_normalization } : {}), ...(seed != null ? { seed } : {}) }
    const r = dialogue?.length
      ? await call('/v1/text-to-dialogue?output_format=mp3_44100_128', { method: 'POST', body: JSON.stringify({ ...shared,
        inputs: dialogue.map(l => ({ text: l.text, voice_id: l.voice })), settings: { ...(stability != null ? { stability } : {}), ...(similarity_boost != null ? { similarity: similarity_boost } : {}) } }) })
      : await call(`/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, { method: 'POST', body: JSON.stringify({ ...shared, text, ...voiceSettings(options) }) })
    const billed = r.headers.get('character-cost')
    return { data: Buffer.from(await r.arrayBuffer()), format: 'mp3', cost: billed != null && billed !== '' ? +billed : null }
  },
}
