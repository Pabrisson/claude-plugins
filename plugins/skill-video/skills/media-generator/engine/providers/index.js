// The model routers. The engine only reaches a router through here: a new one is a file next to this one, with the
// same methods as openrouter.js, and its line below. Model ids carry their router: openrouter:google/veo-3.1
import openrouter from './openrouter.js'

export const PROVIDERS = { openrouter }
export const DEFAULT = 'openrouter'

export function routerOf(id) {
  const i = String(id).indexOf(':'), name = i > 0 && PROVIDERS[id.slice(0, i)] ? id.slice(0, i) : DEFAULT
  return { provider: PROVIDERS[name], name, model: i > 0 && PROVIDERS[id.slice(0, i)] ? id.slice(i + 1) : id }
}
