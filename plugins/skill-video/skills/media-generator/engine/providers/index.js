// The model routers. The engine only reaches a router through here: a new one is a file next to this one, with the
// same methods as openrouter.js, and its line below. Model ids carry their router: openrouter:google/veo-3.1. One
// router is active at a time (settings.json router.active, Settings' Router)
// ElevenLabs is not a router: its speech models are reached straight, whichever router is active
import elevenlabs from './elevenlabs.js'
import kie from './kie.js'
import openrouter from './openrouter.js'

export const PROVIDERS = { openrouter, kie }
export const DIRECT = { elevenlabs }
export const DEFAULT = 'openrouter'

export function routerOf(id) {
  const all = { ...PROVIDERS, ...DIRECT }, i = String(id).indexOf(':'), named = i > 0 && all[id.slice(0, i)]
  const name = named ? id.slice(0, i) : DEFAULT
  return { provider: all[name], name, model: named ? id.slice(i + 1) : id }
}
