// The Stream Estate API v1 (references/stream-estate.md), with the key of $STREAM_ESTATE_API_KEY that the plugin's
// SessionStart hook exports: it never leaves the engine. The v1 says nothing of what a call cost: `charged` gets the
// number of items it returned, and the log prices them. A 402 (no credits left) throws NO_CREDITS, and the caller
// falls back to the assisted mode; a 429 waits for the delay the API gives, three times at most.
import { routeOf } from './costs.js'

export const base = () => process.env.STREAM_ESTATE_BASE || 'https://api.stream.estate'

export class NoCredits extends Error {
  code = 'NO_CREDITS'
  constructor() { super('Stream Estate: no credits left (402), the call was not served') }
}

const sleep = t => new Promise(ok => setTimeout(ok, t))

// a query string as the v1 reads it: `propertyTypes[]=0&propertyTypes[]=1`, `geoShapes[0][3][1]=45.75`. The brackets
// stay raw, which keeps the URL short (the API refuses one of 10 kB)
export function queryString(query = {}) {
  // a list of values takes [], an array within an array its indexes (a polygon's rings, a point's lon and lat)
  const out = [], put = (k, v, nested = false) => {
    if (v == null) return
    if (Array.isArray(v)) v.forEach((x, i) => put(nested || Array.isArray(x) ? `${k}[${i}]` : `${k}[]`, x, true))
    else out.push(`${k}=${encodeURIComponent(v)}`)
  }
  for (const [k, v] of Object.entries(query)) put(k, v)
  return out.join('&')
}

// the members of a collection: JSON-LD (hydra:member, with hydra:totalItems) or a plain array
export const members = data => (Array.isArray(data) ? data : data?.['hydra:member'] ?? [])

// { status, data }: data is null on a 404
export async function se(method, path, { body, query, accept = 'application/ld+json', key = process.env.STREAM_ESTATE_API_KEY, charged = () => {} } = {}) {
  if (!key) throw new Error('Stream Estate: no key (STREAM_ESTATE_API_KEY)')
  const qs = queryString(query), url = base() + path + (qs ? `?${qs}` : '')
  const route = routeOf(method, path)
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method, body: body && JSON.stringify(body),
      headers: { 'X-API-KEY': key, Accept: accept, ...(body ? { 'Content-Type': 'application/json' } : {}), 'User-Agent': 'skill-immo/1.5' },
    })
    if (res.status === 429 && attempt < 3) {
      await sleep(Math.min(65000, (+res.headers.get('Retry-After') || 5) * 1000))
      continue
    }
    if (res.status === 402) throw new NoCredits()
    if (res.status === 404) return { status: 404, data: null }
    const text = await res.text()
    if (!res.ok) throw new Error(`Stream Estate ${res.status} on ${route}: ${text.slice(0, 300)}`)
    const data = text ? JSON.parse(text) : null
    // the items returned, what the pricing counts: a collection's members, else the one document
    charged({ route, results: Array.isArray(data) || data?.['hydra:member'] ? members(data).length : data ? 1 : 0 })
    return { status: res.status, data }
  }
}
