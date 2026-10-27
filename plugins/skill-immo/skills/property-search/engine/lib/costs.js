// What a Stream Estate call costs, before and after it. Before: the route's price (references/stream-estate.md),
// documented, measured in phase 0 (the searches folder's .costs.json overrides it) or unknown. After: the credits
// the API charged (X-Credits-Charged), logged in .cache/api-usage.json. A call that costs credits needs the user's
// yes (--spend), one of unknown cost too (--accept-unknown), and none goes over the monthly cap without --force.

// credits per call, or per result returned (per: 'result'); null: unknown until measured
export const COSTS = {
  'POST /properties': { credits: 1, per: 'result', note: 'documented: 1 per result, 0 when none (size 0 counts only)' },
  'GET /properties/{id}': { credits: 1, note: 'documented: a flat price per property read' },
  'POST /properties/lookup-by-url': { credits: 1, note: 'documented: 1 when known, 404 free' },
  'POST /alerts/forecast': { credits: 0, note: 'documented: not billed' },
  'GET /account/api-usage': { credits: 0, note: 'assumed free (no X-Credits-Charged, no 402 in the spec)' },
  'POST /properties/{id}/resolve-address': { credits: null },
  'GET /analytics/listings': { credits: null },
  'POST /transactions/search': { credits: null },
  'GET /geo/autocomplete': { credits: null },
  'GET /geo/administrative-divisions/{id}': { credits: null },
  'GET /geo/administrative-divisions/{id}/geometry': { credits: null },
  'GET /geo/administrative-divisions/{id}/descendants': { credits: null },
  'POST /alerts': { credits: null },
  'GET /alerts': { credits: null },
  'PUT /alerts/{id}': { credits: null },
  'DELETE /alerts/{id}': { credits: null },
  'GET /alerts/{id}/events': { credits: null },
  'GET /sources': { credits: null },
  'GET /publishers/{id}': { credits: null },
}

// the route a request belongs to: its method and path with the ids put back as {id}
export const routeOf = (method, path) => `${method} ${path.replace(/^\/(properties|alerts|publishers|geo\/administrative-divisions)\/(?!lookup-by-url|forecast)[^/]+/, '/$1/{id}')}`

// the price table with the measured prices over it
export const table = (measured = {}) => Object.fromEntries(Object.entries(COSTS).map(([r, c]) => [r, r in measured ? { ...c, credits: measured[r], note: 'measured' } : c]))

// the estimated credits of `calls` calls returning `results` results in all; null when the route's price is unknown
export function estimate(route, { calls = 1, results = 0 } = {}, measured = {}) {
  const c = table(measured)[route]
  if (!c || c.credits == null) return null
  return c.per === 'result' ? c.credits * results : c.credits * calls
}

const month = d => d.slice(0, 7)
const sum = xs => xs.reduce((a, e) => a + (e.credits ?? 0), 0)

// the usage log's totals: this month, the last 30 days, per search and per route (credits; null ones are unknown)
export function usage(log, now = new Date()) {
  const m = month(now.toISOString()), since = new Date(now - 30 * 86400000).toISOString()
  const by = key => Object.fromEntries([...Map.groupBy(log, e => e[key] ?? '-')].map(([k, es]) => [k, { calls: es.length, credits: sum(es), unknown: es.filter(e => e.credits == null).length }]))
  return {
    month: sum(log.filter(e => month(e.date) === m)), last30: sum(log.filter(e => e.date >= since)),
    unknown: log.filter(e => e.credits == null).length, by_search: by('search'), by_route: by('route'),
    by_month: Object.fromEntries([...Map.groupBy(log, e => month(e.date))].map(([k, es]) => [k, sum(es)])),
  }
}

// null when the call may go, else what Claude must ask the user first
export function gate({ credits, spend, cap, spent, force = false, acceptUnknown = false, eur = 0.01 }) {
  const euros = n => `${(n * eur).toFixed(2).replace('.', ',')} €`
  if (credits == null && !acceptUnknown) return 'unknown cost: this route was not measured yet. Ask the user, then run again with --accept-unknown'
  if (credits > 0 && !(spend >= credits)) return `estimated ${credits} credits (${euros(credits)}), ${Math.max(0, cap - spent)} left of the monthly cap of ${cap}. Ask the user, then run again with --spend ${credits}`
  if (!force && spent + (credits ?? 0) > cap) return `the monthly cap of ${cap} credits would be passed (${spent} spent, ${credits} more). Raise it with setup, or ask the user for --force`
  return null
}
