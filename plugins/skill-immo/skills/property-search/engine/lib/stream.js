// The Stream Estate API v2 (references/stream-estate.md), with the key of $STREAM_ESTATE_API_KEY that the plugin's
// SessionStart hook exports: it never leaves the engine. Every answer reports what it cost (X-Credits-Charged) to
// `charged`, which logs it. A 402 (no credits left: not served, not charged) throws NO_CREDITS, and the caller falls
// back to the assisted mode; a 429 waits for the delay the API gives, three times at most.
import { routeOf } from './costs.js'

export const base = () => process.env.STREAM_ESTATE_BASE || 'https://api-v2.stream.estate'

export class NoCredits extends Error {
  code = 'NO_CREDITS'
  constructor() { super('Stream Estate: no credits left (402), the call was neither served nor charged') }
}

const sleep = t => new Promise(ok => setTimeout(ok, t))

// { status, data, credits }: data is null on a 404, which is never charged
export async function se(method, path, { body, query, accept = 'application/json', key = process.env.STREAM_ESTATE_API_KEY, charged = () => {} } = {}) {
  if (!key) throw new Error('Stream Estate: no key (STREAM_ESTATE_API_KEY)')
  const url = new URL(base() + path)
  for (const [k, v] of Object.entries(query ?? {})) for (const x of [v].flat()) if (x != null) url.searchParams.append(k, x)
  const route = routeOf(method, path)
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method, body: body && JSON.stringify(body),
      headers: { 'X-API-KEY': key, Accept: accept, ...(body ? { 'Content-Type': 'application/json' } : {}), 'User-Agent': 'skill-immo/1.0' },
    })
    if (res.status === 429 && attempt < 3) {
      const at = +res.headers.get('X-RateLimit-Retry-After'), after = +res.headers.get('Retry-After')
      await sleep(Math.min(65000, at ? Math.max(1000, at * 1000 - Date.now()) : (after || 5) * 1000))
      continue
    }
    if (res.status === 402) throw new NoCredits()
    if (res.status === 404) return { status: 404, data: null, credits: 0 }
    const text = await res.text()
    if (!res.ok) throw new Error(`Stream Estate ${res.status} on ${route}: ${text.slice(0, 300)}`)
    const data = text ? JSON.parse(text) : null, header = res.headers.get('X-Credits-Charged')
    const credits = header == null ? null : +header
    charged({ route, credits, results: Array.isArray(data) ? data.length : Array.isArray(data?.data) ? data.data.length : 1 })
    return { status: res.status, data, credits }
  }
}
