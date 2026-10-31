// A model's own settings beyond the ones every model shares (prompt, frames, resolution, ratio, duration, sound, seed),
// by the name its API gives them: what control each is in the dashboard's Options. A model's list names its own
// (`options`: a name, or the name with its own values, default or hint), and says why it leaves out the rest (`skip`,
// or SKIP below for the reasons every model shares); the live audits check that nothing its docs list is left unsaid
const yes = (label, hint, value = false) => ({ label, type: 'switch', default: value, hint })
const choice = (label, values, value, hint) => ({ label, type: 'choice', values: values.map(([v, l]) => ({ value: v, label: l })), default: value, hint })

export const OPTIONS = {
  negative_prompt: { label: 'Avoid', type: 'text', hint: 'what must not appear' },
  negativePrompt: { label: 'Avoid', type: 'text', hint: 'what must not appear' },
  prompt_extend: yes('Prompt rewrite', 'the model writes the prompt out richer', true),
  enable_prompt_expansion: yes('Prompt rewrite', 'the model writes the prompt out richer', true),
  prompt_optimizer: yes('Prompt rewrite', 'the model writes the prompt out richer', true),
  enhancePrompt: yes('Prompt rewrite', 'the model writes the prompt out richer', true),
  enhance_prompt: yes('Prompt rewrite', 'the model writes the prompt out richer', true),
  prompt_enhancement: yes('Prompt rewrite', 'the model writes the prompt out richer', true),
  enable_translation: yes('Prompt in English', 'translated before it is read', true),
  cfg_scale: { label: 'Prompt adherence', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, hint: 'higher follows the words more closely' },
  conditioningScale: { label: 'Image adherence', type: 'slider', min: 0, max: 1, step: 0.05, default: 0.5, hint: 'how closely it keeps to the images' },
  web_search: yes('Web search', 'looks up what the prompt names before making it'),
  return_last_frame: yes('Last frame too', 'also saves the last frame, to start the next shot from'),
  output_format: { label: 'File format', type: 'choice' },
  output_compression: { label: 'Compression', type: 'slider', min: 0, max: 100, step: 5, default: 100, hint: '100 keeps every detail, lower is lighter' },
  thinking_mode: yes('Thinking', 'plans the image before drawing it; text to image only, slower'),
  enable_sequential: yes('Image set', 'a coherent series, with Several at once'),
  color_palette: { label: 'Palette', type: 'text', transform: 'palette', hint: '3 to 10 colors, #hex, in even shares' },
  temperature: { label: 'Variety', type: 'slider', min: 0, max: 2, step: 0.1, default: 1, hint: 'higher reads it more freely' },
  filler_words: yes('Filler words', 'ums and ahs in a dialogue of two voices'),
  pe_fast_mode: yes('Fast mode', 'quicker, a little lower quality'),
  fast_pretreatment: yes('Fast preparation', 'quicker start, a little lower quality'),
  keep_original_sound: yes('Keep the video\'s sound', 'the reference video\'s own audio, else new sound'),
  audio_setting: choice('Sound', [['auto', 'Auto'], ['origin', 'Keep the original']], 'auto'),
  personGeneration: choice('People', [['allow_all', 'Anyone'], ['allow_adult', 'Adults only'], ['dont_allow', 'Nobody']], 'allow_adult'),
  safety_tolerance: { label: 'Safety tolerance', type: 'slider', min: 0, max: 6, step: 1, default: 2, hint: '0 the strictest, 6 the most permissive' },
  draft: yes('Draft', 'a quick, cheap preview'),
  shot_type: choice('Shots', [['single', 'One shot'], ['multi', 'Several shots']], 'single', 'the model cuts the video into shots itself'),
  prefer_multi_shots: yes('Smart shots', 'the model cuts the video into shots itself; not with your own shots'),
  // Grok: the first frame ends the video too (loop_url)
  loop: yes('Loop', 'the first frame ends it too: a seamless loop'),
  reference_link_urls: { label: 'From a web page', type: 'text', wrap: true, hint: 'a public page made into a video: no frame with it' },
  reference_file_urls: { label: 'From a document', type: 'file', wrap: true, hint: 'PDF, Word, PowerPoint, Keynote, text: made into a video; no frame with it' },
}

// the reasons every model shares
export const SKIP = {
  nsfw_checker: 'the provider\'s safety filter, left at its default',
  watermark: 'off: no watermark on a generation',
  aigc_watermark: 'off: no watermark on a generation',
  req_key: 'an internal key of the provider',
  enable_fallback: 'deprecated by the provider',
  generation_type: 'set by the inputs: words, frames or references',
  contentModeration: 'the provider\'s moderation, left at its default',
  version: 'the model\'s own version, fixed by its id',
  aspectRatio: 'the ratio, given in the shared field',
  ratio: 'the ratio, given in the shared field',
  size: 'the resolution and the ratio say it',
  width: 'the resolution and the ratio say it',
  height: 'the resolution and the ratio say it',
  images: 'the reference images, given in the shared field',
  last_image: 'the last frame, given in the shared field',
  video: 'the video, given in the shared field',
  videos: 'the videos, given in the shared field',
  duration: 'follows its video',
}

// a model's options, each whole: a name of OPTIONS, or one with its own values (an enum of its docs), default or hint
export function resolveOptions(list = []) {
  return list.map(o => {
    const own = typeof o === 'string' ? { key: o } : o, base = OPTIONS[own.key]
    if (!base && !own.type) throw new Error(`no option ${own.key} in lib/options.js`)
    const out = { ...base, ...own }
    if (out.values) out.values = out.values.map(v => (typeof v === 'object' ? v : { value: v, label: String(v).toUpperCase() === String(v) ? String(v) : String(v).toUpperCase() }))
    return out
  })
}

// a palette as Kie's Wan takes it: each #hex its even share, written xx.xx %, the last one taking what rounding left
export function palette(text) {
  const hex = String(text).match(/#[0-9a-f]{6}\b/gi) ?? []
  if (hex.length < 3 || hex.length > 10) throw Object.assign(new Error(`a palette takes 3 to 10 colors (#hex), this one has ${hex.length}`), { code: 1 })
  const each = Math.floor(10000 / hex.length) / 100
  return hex.map((h, i) => ({ hex: h.toUpperCase(), ratio: `${(i === hex.length - 1 ? 100 - each * (hex.length - 1) : each).toFixed(2)}%` }))
}
