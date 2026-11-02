// ElevenLabs, straight to its API (never through a router), billed in its credits. $ELEVENLABS_API_KEY (the plugin's
// secret); $ELEVENLABS_BASE for the tests' fake server. Its voice changer, dubbing and clones stay with video-editor's
// engine. What it makes here:
// - speech: its speech models as GET /v1/models lists them, one voice (text to speech) or several (text to dialogue,
//   Eleven v4 and v3), a character each, half on the models it halves (character_cost_multiplier); each voice with its
//   words' times (captions) and the audio effects of its catalog (a filter, a room, a background)
// - beyond speech, models of the engine's own (GET /v1/models lists none of them): sound effects, Eleven Music (words, or
//   a plan of sections, a sound as reference), music for a video, a song's stems, a voice designed or remixed (3
//   previews, one kept on the account), a transcript (Scribe v2) or the words of a text timed (forced alignment)
import fs from 'node:fs'
import path from 'node:path'
import { srt, wordsOf } from '../lib/captions.js'
import { unzip } from '../lib/unzip.js'

const base = () => (process.env.ELEVENLABS_BASE ?? 'https://api.elevenlabs.io').replace(/\/$/, '')
const key = () => process.env.ELEVENLABS_API_KEY
// MP3 at 128 kb/s: on every plan (192 is the Creator tier's)
const MP3 = 'output_format=mp3_44100_128'

async function call(route, init = {}) {
  if (!key()) throw Object.assign(new Error('no ElevenLabs key: /plugin configure skill-video@pabrisson, or ELEVENLABS_API_KEY'), { status: 401 })
  const r = await fetch(base() + route, { ...init, headers: { 'xi-api-key': key(), ...(typeof init.body === 'string' ? { 'content-type': 'application/json' } : {}), ...init.headers } })
  if (!r.ok) {
    // ElevenLabs' own sentence (detail.message), not its whole JSON
    const text = await r.text(), why = (() => { try { const d = JSON.parse(text).detail; return d?.message ?? (typeof d === 'string' ? d : Array.isArray(d) ? d.map(x => x.msg).join('; ') : null) } catch { return null } })()
    throw Object.assign(new Error(`ElevenLabs ${route.split('?')[0]}: ${r.status} ${why ?? text.slice(0, 200)}`), { status: r.status })
  }
  return r
}
const post = (route, body) => call(route, { method: 'POST', body: JSON.stringify(body) })
// a form of fields and files (a file by its path), its lists as repeated fields
async function form(route, fields) {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) {
    if (x == null || x === '') continue
    if (typeof x === 'object' && x.file) f.append(k, await fs.openAsBlob(x.file), path.basename(x.file))
    else f.append(k, String(x))
  }
  return call(route, { method: 'POST', body: f })
}
// what it billed (its character-cost header), when it says
const billed = r => { const c = r.headers.get('character-cost'); return c != null && c !== '' ? +c : null }
const audioOf = async r => Buffer.from(await r.arrayBuffer())

// what each model takes beyond its list (docs of 2026-10-31): v4 and v4 Turbo only stability and similarity, no speed,
// no style; v3's stability is one of three steps; dialogue on v4 and v3; audio tags on v4, v4 Turbo and v3s;
// Multilingual v2 refuses a language code
const DIALOGUE = ['eleven_v4', 'eleven_v3']
const TAGS = /^eleven_v(3|4)/
const V4 = /^eleven_v4/, V3 = /^eleven_v3/
// a dialogue reads reliably up to 2,000 characters, 10 voices (the API reference)
export const DIALOGUE_MAX = 2000, DIALOGUE_VOICES = 10
const slider = (key, label, min, max, step, value, hint) => ({ key, label, type: 'slider', min, max, step, default: value, hint })
const yes = (key, label, hint, value = false) => ({ key, label, type: 'switch', default: value, hint })
// the audio effects of its catalog, on every voice (they change nothing of the price, 2026-11-02): none by default
const none = { value: 'none', label: 'None' }
const effectOptions = c => (!c ? [] : [
  { key: 'filter_preset_id', label: 'Filter', type: 'select', values: [none, ...c.filter_presets.map(x => ({ value: x.filter_preset_id, label: x.name }))], default: 'none', hint: 'colors the voice: a phone, an old radio' },
  { key: 'environment_id', label: 'Room', type: 'select', values: [none, ...c.environments.map(x => ({ value: x.environment_id, label: x.name }))], default: 'none', hint: 'a reverb, its tail after the words' },
  slider('send_level', 'Reverb', 0, 1, 0.05, 1, 'how much of the voice the room takes'),
  slider('distance', 'Distance', 0, 1, 0.05, 0, 'close to the microphone, to far'),
  { key: 'background_noise_id', label: 'Background', type: 'select', values: [none, ...c.background_noises.map(x => ({ value: x.background_noise_id, label: x.name }))], default: 'none', hint: 'a bed of noise under the voice' },
  slider('pan', 'Pan', -1, 1, 0.05, 0, 'left to right'),
])
const EFFECTS = ['filter_preset_id', 'environment_id', 'send_level', 'distance', 'background_noise_id', 'pan']
function optionsOf(m, catalog) {
  const id = m.model_id
  return [
    V3.test(id)
      ? { key: 'stability', label: 'Stability', type: 'choice', values: [{ value: 0, label: 'Creative' }, { value: 0.5, label: 'Natural' }, { value: 1, label: 'Robust' }], default: 0.5, hint: 'Creative is the most expressive, Robust the steadiest' }
      : slider('stability', 'Stability', 0, 1, 0.05, 0.5, 'lower is more expressive, higher steadier'),
    slider('similarity_boost', 'Similarity', 0, 1, 0.05, 0.75, 'how close to the voice it stays'),
    m.can_use_style && slider('style', 'Style exaggeration', 0, 1, 0.05, 0, 'the voice\'s own style, amplified'),
    !V4.test(id) && slider('speed', 'Speed', 0.7, 1.2, 0.05, 1),
    m.can_use_speaker_boost && yes('use_speaker_boost', 'Speaker boost', 'closer to the voice, a little slower', true),
    id !== 'eleven_multilingual_v2' && (m.languages?.length ?? 0) > 1 && { key: 'language_code', label: 'Language', type: 'select', values: m.languages.map(l => ({ value: l.language_id, label: l.name })), default: '', hint: 'read in this language; Auto follows the text' },
    { key: 'apply_text_normalization', label: 'Numbers and dates', type: 'choice', values: [{ value: 'auto', label: 'Auto' }, { value: 'on', label: 'Spelled out' }, { value: 'off', label: 'As written' }], default: 'auto' },
    ...effectOptions(catalog),
  ].filter(Boolean)
}

// beyond speech: each model, what it makes (its role) and its own settings
const LOUDNESS = slider('loudness', 'Loudness', -1, 1, 0.05, 0.5, '0 is about -24 LUFS')
const STRENGTH = slider('prompt_strength', 'Words or reference', 0, 1, 0.05, 0.5, 'with a reference clip: 0 keeps to the clip, 1 to the words')
const SFX = [
  slider('duration_seconds', 'Length', 0, 30, 0.5, 0, '0: its own; set, 40 credits a second'),
  yes('loop', 'Loop', 'its end runs seamlessly into its start'),
  slider('prompt_influence', 'Prompt influence', 0, 1, 0.05, 0.3, 'higher follows the words more closely, lower varies more'),
]
const MUSIC = v1 => [
  { key: 'length', label: 'Length (s)', type: 'number', min: 0, max: 600, step: 5, default: 30, hint: 'Describe\'s length, 0: its own (priced after); Write takes its Length field' },
  ...(v1 ? [] : [{ key: 'condition_strength', label: 'Sound reference', type: 'choice', values: ['low', 'medium', 'high', 'xhigh'].map(v => ({ value: v, label: v === 'xhigh' ? 'Very high' : v[0].toUpperCase() + v.slice(1) })), default: 'medium', hint: 'with a sound given: how closely it keeps to it' }]),
]
const MORE = [
  { model: 'eleven_text_to_sound_v2', name: 'Eleven SFX v2', role: 'sound', options: SFX },
  { model: 'eleven_text_to_sound_v3', name: 'Eleven SFX v3', role: 'sound', options: SFX, note: 'limited access: an account without it is told « Unknown model »' },
  { model: 'music_v2_5', name: 'Eleven Music v2.5', role: 'music', options: MUSIC(false) },
  { model: 'music_v2', name: 'Eleven Music v2', role: 'music', options: MUSIC(false) },
  { model: 'music_v1', name: 'Eleven Music v1', role: 'music', options: MUSIC(true) },
  { model: 'eleven_video_to_music', name: 'Eleven Video to Music', role: 'video-music', options: [
    yes('add_sfx', 'Sound effects', 'its cues taken from the picture'),
    yes('separate_tracks', 'Separate tracks', 'the music and the effects as two files'),
    yes('use_audio_as_reference', 'Follow its sound', 'the video\'s own sound sets the genre, the tempo and the mood'),
  ] },
  { model: 'eleven_stem_separation', name: 'Eleven Stem Separation', role: 'stems', options: [] },
  { model: 'eleven_ttv_v3', name: 'Eleven Voice Design v3', role: 'design', options: [LOUDNESS, slider('guidance_scale', 'Prompt adherence', 0, 10, 0.5, 5, 'higher keeps to the words, too high sounds artificial'), yes('should_enhance', 'Enhance the description', 'ElevenLabs writes it out richer'), STRENGTH] },
  { model: 'eleven_multilingual_ttv_v2', name: 'Eleven Voice Design v2', role: 'design', options: [LOUDNESS, slider('guidance_scale', 'Prompt adherence', 0, 10, 0.5, 5, 'higher keeps to the words, too high sounds artificial'), yes('should_enhance', 'Enhance the description', 'ElevenLabs writes it out richer')] },
  { model: 'eleven_voice_remix', name: 'Eleven Voice Remix', role: 'remix', options: [LOUDNESS, slider('guidance_scale', 'Prompt adherence', 0, 10, 0.5, 2, 'higher keeps to the words, too high sounds artificial'), STRENGTH] },
  { model: 'scribe_v2', name: 'Scribe v2', role: 'transcribe', options: [
    { key: 'language_code', label: 'Language', type: 'text', hint: 'its code (fr, en); empty: found by itself' },
    yes('diarize', 'Speakers', 'who speaks when, in the text and the captions'),
    yes('tag_audio_events', 'Sound events', '(laughter), (applause) in the text'),
    yes('no_verbatim', 'Clean speech', 'no ums, false starts or noises'),
  ] },
]
// its models beyond speech by their ids (music_v2_5, scribe_v2 are ElevenLabs' own too), for the tests of the tools' lists
export const OWN_MODELS = new Set(MORE.map(m => m.model))
// ponytail: ElevenLabs' public rates of 2026-10-26 (video-editor's): sound effects 40 credits a second, 200 at their
// own length; music 15 a second; a transcript 330 a minute. No rate published for stems, voice design, the music of a
// video nor the alignment: priced after, from what it says it billed
const RATE = { sfx: 40, sfx_auto: 200, music: 15, transcript: 330 / 60 }

// the list, straight from ElevenLabs (a free call): a new model shows by itself; read again once a day by a long-running
// server. A key without models_read (a scoped one) gets the engine's copy of it, its languages named here
const SNAPSHOT = new URL('./elevenlabs-models.json', import.meta.url)
const NAMES = new Intl.DisplayNames(['en'], { type: 'language' })
const named = id => { try { return NAMES.of(id) } catch { return id } }
const snapshot = () => JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')).models.map(m => ({ ...m, languages: m.languages.map(id => ({ language_id: id, name: named(id) })) }))
export let fromSnapshot = false
let listed = null, at = 0, effects = null
async function list() {
  if (!listed || Date.now() - at > 864e5) {
    at = Date.now()
    listed = call('/v1/models').then(r => r.json(), e => {
      if (![401, 403].includes(e.status)) throw e
      fromSnapshot = true
      return snapshot()
    }).catch(e => { listed = null; throw e })
    // its audio effects (a free call too); none shown when it cannot be read
    effects = call('/v1/audio-effects/catalog').then(r => r.json()).catch(() => null)
  }
  return { models: (await listed).filter(m => m.can_do_text_to_speech), catalog: await effects }
}

// the voice's own settings unless some are asked: only those are sent
const voiceSettings = o => {
  const vs = Object.fromEntries(['stability', 'similarity_boost', 'style', 'speed', 'use_speaker_boost'].filter(k => o[k] != null).map(k => [k, o[k]]))
  return Object.keys(vs).length ? { voice_settings: vs } : {}
}
const audioEffects = o => {
  const e = Object.fromEntries(EFFECTS.filter(k => o[k] != null && o[k] !== 'none').map(k => [k, o[k]]))
  return Object.keys(e).length ? { audio_effects: e } : {}
}
const only = (o, keys) => Object.fromEntries(keys.filter(k => o[k] != null && o[k] !== '').map(k => [k, o[k]]))
// a voice's 3 previews (design, remix): their files, and the ids that keep one
const previews = (j, r) => ({
  files: j.previews.map((p, i) => ({ name: `voice-${i + 1}`, ext: 'mp3', data: Buffer.from(p.audio_base_64, 'base64') })),
  keep: { voices: j.previews.map((p, i) => ({ file: `voice-${i + 1}.mp3`, generated_voice_id: p.generated_voice_id })) }, data: { text: j.text }, cost: billed(r),
})

export default {
  id: 'elevenlabs',
  label: 'ElevenLabs',
  unit: 'credits',
  key: () => !!key(),

  // its speech models (with its key), then the others, listed whatever the key: a tool shows them, and says the key is
  // missing
  async models(kind) {
    if (kind !== 'speech') return []
    const { models, catalog } = key() ? await list() : { models: [] }
    return [
      ...models.map(m => ({
        model: m.model_id, name: m.name, lab: 'ElevenLabs', kind, role: 'speech',
        params: { voices: null, clone: 'library', seed: true, dialogue: DIALOGUE.includes(m.model_id), speakers: DIALOGUE.includes(m.model_id) ? DIALOGUE_VOICES : 0, tags: TAGS.test(m.model_id),
          max_chars: m.maximum_text_length_per_request ?? null, options: optionsOf(m, catalog) },
        pricing: { multiplier: (m.model_rates?.character_cost_multiplier ?? 1) * (m.model_rates?.cost_discount_multiplier ?? 1) },
      })),
      ...MORE.map(m => ({ model: m.model, name: m.name, lab: 'ElevenLabs', kind, role: m.role, params: { options: m.options }, pricing: {}, ...(m.note ? { note: m.note } : {}) })),
    ]
  },

  // speech: a credit a character (spaces and audio tags too), times the model's multiplier; the others by their seconds
  estimate(kind, m, req = {}) {
    const unknown = why => ({ amount: null, unit: 'credits', known: false, detail: why })
    const secs = s => `${+s.toFixed(1)} s`
    if (m.role === 'speech') {
      const chars = req.text ?? 0, x = m.pricing.multiplier
      return { amount: Math.ceil(chars * x), unit: 'credits', known: true, detail: `${chars} characters${x !== 1 ? ` × ${x}` : ''}` }
    }
    if (m.role === 'sound') return req.seconds
      ? { amount: Math.ceil(req.seconds * RATE.sfx), unit: 'credits', known: true, detail: `${secs(req.seconds)} × ${RATE.sfx} credits` }
      : { amount: RATE.sfx_auto, unit: 'credits', known: true, detail: 'its own length' }
    if (m.role === 'music') {
      if (!req.seconds) return unknown(`${RATE.music} credits a second, its length its own`)
      const all = req.seconds + (req.reference ?? 0)
      return { amount: Math.ceil(all * RATE.music), unit: 'credits', known: true, detail: `${secs(req.seconds)}${req.reference ? ` + its ${secs(req.reference)} sound reference` : ''} × ${RATE.music} credits` }
    }
    if (m.role === 'video-music') return { amount: req.seconds ? Math.ceil(req.seconds * RATE.music) : null, unit: 'credits', known: false, detail: `about Eleven Music's ${RATE.music} credits a second${req.seconds ? ` for ${secs(req.seconds)} of video` : ''}: ElevenLabs lists no rate of its own` }
    if (m.role === 'transcribe' && !req.align) return { amount: Math.ceil((req.seconds ?? 0) * RATE.transcript), unit: 'credits', known: true, detail: `${secs(req.seconds ?? 0)} at 330 credits a minute` }
    return unknown(`ElevenLabs lists no rate for ${{ stems: 'stems', design: 'a voice designed', remix: 'a voice remixed', transcribe: 'an alignment' }[m.role] ?? 'it'}: what it took shows after`)
  },

  // one voice, or a dialogue's lines (each its voice); the options as the API names them, its audio effects; the words'
  // times beside the sound (the timed endpoints, the same price). What it billed in its character-cost header
  async speech({ model, text, voice, dialogue, options = {}, seed }) {
    const { stability, similarity_boost, language_code, apply_text_normalization } = options
    const shared = { model_id: model, ...(language_code ? { language_code } : {}), ...(apply_text_normalization ? { apply_text_normalization } : {}), ...(seed != null ? { seed } : {}), ...audioEffects(options) }
    const r = dialogue?.length
      ? await post(`/v1/text-to-dialogue/with-timestamps?${MP3}`, { ...shared,
        inputs: dialogue.map(l => ({ text: l.text, voice_id: l.voice })), settings: { ...(stability != null ? { stability } : {}), ...(similarity_boost != null ? { similarity: similarity_boost } : {}) } })
      : await post(`/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps?${MP3}`, { ...shared, text, ...voiceSettings(options) })
    const j = await r.json()
    return { data: Buffer.from(j.audio_base64, 'base64'), format: 'mp3', cost: billed(r), words: wordsOf(j.alignment) }
  },

  // beyond speech, by its action: its files (name, ext, data), what it billed, what the job keeps (a voice's ids)
  async audio(req, { progress = () => {} } = {}) {
    const o = req.options ?? {}, one = async (r, name = 'out') => ({ files: [{ name, ext: 'mp3', data: await audioOf(r) }], cost: billed(r) })
    // a ZIP's files by their names (stems, a video's music and effects apart), else the one sound
    const many = async r => {
      const data = await audioOf(r)
      if (data.subarray(0, 2).toString() !== 'PK') return { files: [{ name: 'out', ext: 'mp3', data }], cost: billed(r) }
      return { files: unzip(data).map(f => ({ name: path.parse(f.name).name.replace(/[^\w-]+/g, '_'), ext: path.extname(f.name).slice(1) || 'mp3', data: f.data })), cost: billed(r) }
    }
    if (req.action === 'sound')
      return one(await post(`/v1/sound-generation?${MP3}`, { text: req.text, model_id: req.model, ...(o.duration_seconds ? { duration_seconds: o.duration_seconds } : {}), ...only(o, ['loop', 'prompt_influence']) }))
    if (req.action === 'compose') {
      let plan = req.plan
      // a sound as reference (v2 and v2.5): uploaded (priced as a song of its length), a plan made from the words (free),
      // its first part conditioned on the sound
      if (req.reference) {
        progress('sending the sound reference to ElevenLabs…')
        const { song_id } = await (await form('/v1/music/upload', { file: { file: req.reference.file } })).json()
        progress('planning the music…')
        plan = await (await post('/v1/music/plan', { prompt: req.prompt, model_id: req.model, ...(req.length ? { music_length_ms: req.length * 1000 } : {}) })).json()
        plan.chunks[0] = { ...plan.chunks[0], conditioning_ref: { song_id, range: { start_ms: 0, end_ms: Math.round(req.reference.seconds * 1000) } }, ...(o.condition_strength ? { condition_strength: o.condition_strength } : {}) }
      }
      progress('composing with Eleven Music…')
      const r = await post(`/v1/music?${MP3}`, { model_id: req.model, ...(plan ? { composition_plan: plan } : { prompt: req.prompt, ...(req.length ? { music_length_ms: req.length * 1000 } : {}), ...(req.instrumental ? { force_instrumental: true } : {}) }) })
      const song = r.headers.get('song-id')
      return { ...(await one(r)), ...(song ? { keep: { eleven: { song_id: song } } } : {}) }
    }
    if (req.action === 'video_music')
      return many(await form(`/v1/music/video-to-music?${MP3}`, { videos: { file: req.video }, description: req.description, tags: req.tags, ...only(o, ['add_sfx', 'separate_tracks', 'use_audio_as_reference']) }))
    if (req.action === 'stems') return many(await form(`/v1/music/stem-separation?${MP3}`, { file: { file: req.file }, stem_variation_id: req.variation }))
    if (req.action === 'design') {
      const ref = req.reference ? { reference_audio_base64: fs.readFileSync(req.reference).toString('base64') } : {}
      const r = await post(`/v1/text-to-voice/design?${MP3}`, { voice_description: req.description, model_id: req.model, ...(req.text ? { text: req.text } : { auto_generate_text: true }), ...ref,
        ...only(o, ['loudness', 'guidance_scale', 'should_enhance', ...(req.reference ? ['prompt_strength'] : [])]) })
      return previews(await r.json(), r)
    }
    if (req.action === 'remix') {
      const r = await post(`/v1/text-to-voice/${encodeURIComponent(req.voice)}/remix?${MP3}`, { voice_description: req.description, ...(req.text ? { text: req.text } : { auto_generate_text: true }), ...only(o, ['loudness', 'guidance_scale', 'prompt_strength']) })
      return previews(await r.json(), r)
    }
    // a transcript: its text (each speaker's turn on its line when asked), its captions and its words as Scribe gives them;
    // a text's words timed: the same, the text as given
    const text = (name, data) => ({ name, ext: name === 'words' ? 'json' : name === 'captions' ? 'srt' : 'txt', data: Buffer.from(data) })
    if (req.action === 'transcribe') {
      const r = await form('/v1/speech-to-text', { model_id: req.model, file: { file: req.file }, timestamps_granularity: 'word', keyterms: req.keyterms, language_code: o.language_code,
        diarize: !!o.diarize, tag_audio_events: !!o.tag_audio_events, ...(o.no_verbatim ? { no_verbatim: true } : {}) })
      const j = await r.json(), words = (j.words ?? []).filter(w => w.type === 'word').map(w => ({ text: w.text, start: w.start, end: w.end, speaker: w.speaker_id }))
      let said = j.text ?? ''
      if (o.diarize) {
        const turns = []
        for (const w of j.words ?? []) {
          if (w.type !== 'spacing' && w.speaker_id !== turns.at(-1)?.who) turns.push({ who: w.speaker_id, text: '' })
          if (turns.length) turns.at(-1).text += w.text
        }
        said = turns.map(t => `Speaker ${+String(t.who).replace(/\D/g, '') + 1}: ${t.text.trim()}`).join('\n\n')
      }
      return { files: [text('transcript', `${said.trim()}\n`), text('captions', srt(words)), text('words', JSON.stringify(j, null, 2))], cost: billed(r) }
    }
    if (req.action === 'align') {
      const r = await form('/v1/forced-alignment', { file: { file: req.file }, text: req.text }), j = await r.json()
      return { files: [text('transcript', `${req.text.trim()}\n`), text('captions', srt(j.words ?? [])), text('words', JSON.stringify(j, null, 2))], cost: billed(r) }
    }
    throw new Error(`ElevenLabs: no action ${req.action}`)
  },

  // a voice designed or remixed kept on the account: its id, for every voice tool
  async keepVoice({ name, description, generated_voice_id }) {
    return (await post('/v1/text-to-voice', { voice_name: name, voice_description: description, generated_voice_id })).json()
  },
}
