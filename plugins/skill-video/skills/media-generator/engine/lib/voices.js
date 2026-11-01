// what the dashboard shows of a model's voices: ElevenLabs' line, labels and public samples (providers/voices.json),
// for the ones it knows; the voices themselves stay plain ids
import fs from 'node:fs'

const KNOWN = JSON.parse(fs.readFileSync(new URL('../providers/voices.json', import.meta.url), 'utf8')).voices
export const voiceInfo = voices => {
  const out = Object.fromEntries((voices ?? []).filter(v => KNOWN[v]).map(v => [v, KNOWN[v]]))
  return Object.keys(out).length ? out : null
}
