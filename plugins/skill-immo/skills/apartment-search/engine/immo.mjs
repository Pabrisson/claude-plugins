#!/usr/bin/env node
// apartment-search CLI and local dashboard server. The searches live in the folder Claude Code runs in ($IMMO_DIR
// overrides it): one folder per search (<slug>/: search.json, listings.json, market.json, area.json), the buyer's
// profile (.profile.json), the measured API prices (.costs.json), the open data cache and the credits log (.cache/).
// Each search has a mode: stream-estate (listings, analytics, alerts from the API) or classic (open data and assisted
// listings only, never a credit). Search commands take -p <slug>. Exit codes: 2 the user must agree first (cost), 3 no credits left (402, assisted
// mode), 4 the listing is unknown to Stream Estate (read it with WebFetch).
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { PROFILE, budget } from './lib/budget.js'
import { estimate, gate, table, usage } from './lib/costs.js'
import { building, median, summary } from './lib/dvf.js'
import { around, bbox, center, circle, corridor, distance, inGeometry, inZone } from './lib/geo.js'
import { fromInput, fromStreamEstate, merge, normUrl } from './lib/listings.js'
import { badge, daysOnline, dropped, matches, negotiation, reference } from './lib/market.js'
import { openData } from './lib/opendata.js'
import { NoCredits, se } from './lib/stream.js'

const SELF = fileURLToPath(import.meta.url)
// the code this process runs: a dashboard server started from an older immo.mjs gets replaced
const LOADED = fs.statSync(SELF).mtimeMs
const ENGINE = path.dirname(SELF)
// the searches folder: $IMMO_DIR, else the folder Claude Code runs in (its parent, when run inside a search)
const HOME = (() => {
  if (process.env.IMMO_DIR) return path.resolve(process.env.IMMO_DIR)
  return fs.existsSync(path.join(process.cwd(), 'search.json')) ? path.dirname(process.cwd()) : process.cwd()
})()
const PORT = +(process.env.IMMO_PORT || 41287)
// the dashboard, built from plugins-src/skill-immo/dashboard and served as is
const DASHBOARD = path.join(ENGINE, 'dashboard/dist')
const CACHE = path.join(HOME, '.cache'), USAGE = path.join(CACHE, 'api-usage.json')
const PROFILE_FILE = path.join(HOME, '.profile.json'), MEASURED = path.join(HOME, '.costs.json')
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
// the searches folder's .gitignore, written with its first search: git keeps each search, its listings (the user's
// statuses, notes and price history), the measured prices and the credits log; it leaves out what the engine makes
// again, and the buyer's profile (income, down payment)
const GITIGNORE = `# skill-immo: what the engine makes again, and the buyer's private profile. Git keeps every search
# (search.json, listings.json with your statuses, notes and price history), .costs.json and the credits log.
.cache/*
!.cache/api-usage.json
*/market.json
*/area.json
*/alert-events.json
.profile.json
.dashboard.log
.DS_Store
`
// what git must keep, to check against the .gitignore
const KEPT = ['s/search.json', 's/listings.json', '.costs.json', '.cache/api-usage.json']
const CRITERIA = ['budget_min', 'budget_max', 'area_min', 'area_max', 'rooms_min', 'rooms_max', 'floor_min', 'dpe_max', 'elevator', 'outdoor']
const LETTERS = 'ABCDEFG'
// the profile's numbers, the only fields the dashboard may write
const PROFILE_NUMBERS = ['down_payment', 'net_income_monthly', 'other_loans_monthly', 'rate', 'years', 'insurance_rate', 'notary_old', 'notary_new', 'eur_per_credit', 'monthly_credit_cap']

const { values: opt, positionals: [cmd, ...args] } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: 'string', short: 'p' }, slug: { type: 'string' }, json: { type: 'boolean' },
    estimate: { type: 'boolean' }, spend: { type: 'string' }, force: { type: 'boolean' }, 'accept-unknown': { type: 'boolean' },
    mode: { type: 'string' }, zone: { type: 'string' }, radius: { type: 'string' }, division: { type: 'string' }, type: { type: 'string' }, criteria: { type: 'string' }, max: { type: 'string' },
    url: { type: 'string' }, file: { type: 'string' }, source: { type: 'string' }, id: { type: 'string' }, all: { type: 'boolean' }, resolve: { type: 'boolean' },
    webhook: { type: 'string' }, drop: { type: 'string' }, remote: { type: 'boolean' }, open: { type: 'boolean' },
  },
})

const die = (msg, code = 1) => { console.error(`error: ${msg}`); process.exit(code) }
const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { if (fallback !== undefined) return fallback; throw e } }
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n') }
const now = () => new Date().toISOString()
const euros = (n, eur) => `${(n * eur).toFixed(2).replace('.', ',')} €`
const fmt = n => (n == null ? '—' : Math.round(n).toLocaleString('fr-FR'))
const slugify = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)
const od = openData(CACHE)
const profile = () => ({ ...PROFILE, ...readJson(PROFILE_FILE, {}) })
const hasKey = () => !!process.env.STREAM_ESTATE_API_KEY
const MODES = ['stream-estate', 'classic']
// a search may call Stream Estate: its mode allows it and the key is there
const streamOn = s => s.mode !== 'classic' && hasKey()

// the searches of the folder, by slug
const searches = () => fs.readdirSync(HOME).filter(x => /^[a-z0-9][a-z0-9-]*$/.test(x) && fs.existsSync(path.join(HOME, x, 'search.json'))).sort()
function searchDir(required = true) {
  const p = opt.project ?? (fs.existsSync('search.json') ? '.' : null)
  if (!p) return required ? die('which search? pass -p <slug>') : null
  const dir = path.resolve(HOME, p)
  if (!fs.existsSync(path.join(dir, 'search.json'))) die(`no search ${p} in ${HOME}`)
  return dir
}
const load = dir => ({
  search: readJson(path.join(dir, 'search.json')), listings: readJson(path.join(dir, 'listings.json'), []),
  market: readJson(path.join(dir, 'market.json'), {}), area: readJson(path.join(dir, 'area.json'), {}),
})

// --- credits -------------------------------------------------------------------------------------------------

const usageLog = () => readJson(USAGE, [])
// what a Stream Estate call cost, in the log: the API's figure, else the route's price when it is known
const charged = slug => ({ route, credits, results }) => {
  const known = credits ?? estimate(route, { results }, readJson(MEASURED, {}))
  writeJson(USAGE, [...usageLog(), { date: now(), route, credits: known, results, search: slug ?? null, ...(credits == null && known != null ? { estimated: true } : {}) }])
}
const api = (slug, method, p, init) => se(method, p, { ...init, charged: charged(slug) })

// Before a call that may cost: --estimate prints the estimate (JSON) and stops; otherwise the call goes only with the
// user's yes (--spend, --accept-unknown) and under the monthly cap (--force).
function approve(route, credits, what) {
  const p = profile(), spent = usage(usageLog()).month, cap = p.monthly_credit_cap
  const e = { what, route, credits, eur: credits == null ? null : +(credits * p.eur_per_credit).toFixed(2), unknown: credits == null, spent, cap, remaining: Math.max(0, cap - spent) }
  if (opt.estimate) { console.log(JSON.stringify(e)); process.exit(0) }
  const block = gate({ credits, spend: opt.spend == null ? null : +opt.spend, cap, spent, force: opt.force, acceptUnknown: opt['accept-unknown'], eur: p.eur_per_credit })
  if (block) die(`${what}: ${block}`, 2)
  return e
}

// a 402 or a missing key: the assisted mode takes over
const assisted = why => die(`${why}. Assisted mode: find listings with WebSearch, read one page with WebFetch, or take the text the user pastes, then \`immo.mjs add -p <slug> --file listing.json\``, 3)
// the paid commands of a search: classic searches never call the API
const requireStream = s => {
  if (s.mode === 'classic') die(`${s.slug} is a classic search (open data and assisted listings, no credit): switch it with search -p ${s.slug} --mode stream-estate`, 2)
  if (!hasKey()) assisted('Stream Estate is off (no key)')
}
const withCredits = async fn => { try { return await fn() } catch (e) { if (e instanceof NoCredits) assisted(e.message); throw e } }

// --- Stream Estate criteria ----------------------------------------------------------------------------------

const range = (gte, lte) => (gte != null || lte != null ? { gte: gte ?? null, lte: lte ?? null } : undefined)

// The search's criteria as a POST /properties criteria tree: flats for sale in the zone. `since`: only what changed
// from that date, with what expired since; `exclude`: property ids already fetched (the API takes 100).
function seCriteria(s, { since, exclude = [], alert = false } = {}) {
  const c = s.criteria ?? {}, z = s.zone
  const locations = z.division ? { in: { ids: [z.division] } } : z.kind === 'radius'
    ? { in: { centerPoint: { latitude: z.center[1], longitude: z.center[0], radiusKm: z.radius_m / 1000 } } }
    : { in: { geoShapes: [z.geometry] } }
  const property = {
    type: { in: ['FLAT'] }, transaction: { type: 'SELL' }, locations,
    pricing: range(c.budget_min, c.budget_max) && { displayed: range(c.budget_min, c.budget_max) },
    areas: range(c.area_min, c.area_max) && { displayed: range(c.area_min, c.area_max) },
    unit: {
      rooms: range(c.rooms_min, c.rooms_max), floor: c.floor_min != null ? { gte: c.floor_min, lte: null } : undefined,
      diagnostic: c.dpe_max ? { scores: [{ type: 'ENERGY_CONSUMPTION', rating: [...LETTERS.slice(0, LETTERS.indexOf(c.dpe_max) + 1)] }] } : undefined,
    },
    amenities: c.elevator ? { features: { in: ['ELEVATOR'] } } : undefined,
    id: !alert && exclude.length ? { nin: exclude.slice(0, 100) } : undefined,
  }
  const node = extra => ({ property, ...extra })
  const base = since ? { or: [node({ dates: { updatedAt: { from: since } } }), node({ listings: { expiredAt: { from: since } } })] } : node({})
  return c.outdoor ? { and: [base, { or: ['BALCONY', 'TERRACE', 'GARDEN'].map(f => ({ property: { unit: { features: { in: [f] } } } })) }] } : base
}

// how many properties match (size 0: no result returned, so no credit)
async function seCount(slug, criteria) {
  const { data } = await api(slug, 'POST', '/properties', { body: { criteria, size: 0 }, accept: 'application/vnd.api+json' })
  return data?.meta?.totalItems ?? 0
}

// up to `max` properties, 100 a page, newest update first
async function seFetch(slug, criteria, max) {
  const out = []
  for (let page = 1; out.length < max; page++) {
    const size = Math.min(100, max - out.length), { data } = await api(slug, 'POST', '/properties', { body: { criteria, size, page, paginationType: 'PAGE' } })
    out.push(...(data ?? []))
    if (!data || data.length < size) break
  }
  return out
}

// --- commands ------------------------------------------------------------------------------------------------

async function doctor() {
  const p = profile(), u = usage(usageLog())
  const checks = [
    ['node 22 or later', +process.versions.node.split('.')[0] >= 22, 'https://nodejs.org/en/download'],
    ['dashboard built', fs.existsSync(path.join(DASHBOARD, 'index.html')), `npm run build in plugins-src/skill-immo/dashboard (${DASHBOARD})`],
  ]
  for (const [name, ok, fix] of checks) console.log(`${ok ? 'ok     ' : 'MISSING'} ${name}${ok ? '' : `: ${fix}`}`)
  console.log(hasKey() ? 'stream-estate: on (listings, market analytics, transactions, alerts)' : "stream-estate: off (assisted mode: listings from WebSearch, WebFetch or pasted text); the plugin's secret: /plugin configure skill-immo@pabrisson")
  let remote = ''
  if (hasKey()) {
    const r = await api(null, 'GET', '/account/api-usage').catch(e => ({ error: e.message }))
    remote = r.error ? `; api-usage: ${r.error}` : `; Stream Estate counts ${r.data?.totals?.credits ?? '?'} over 30 days`
  }
  console.log(`credits: ${u.last30} in the last 30 days (${euros(u.last30, p.eur_per_credit)}), ${u.month} this month of the ${p.monthly_credit_cap} cap${u.unknown ? `, ${u.unknown} calls of unknown cost` : ''}${remote}`)
  console.log(fs.existsSync(PROFILE_FILE) ? `profile: ${PROFILE_FILE}` : 'profile: none yet, run setup (the budget tab needs it)')
  console.log(`searches: ${HOME} (${searches().length})`)
  // in a git repository: none of what the user made ignored, the cache and the profile left out
  const check = files => spawnSync('git', ['-C', HOME, 'check-ignore', '--no-index', ...files], { encoding: 'utf8' })
  const ignored = check(KEPT)
  if (ignored.status === 0) console.log(`warning: git ignores ${ignored.stdout.trim().split('\n').join(', ')} here: the searches and the credits log must stay versioned, fix ${path.join(HOME, '.gitignore')}`)
  if (check(['.cache/x.json']).status === 1 && fs.existsSync(path.join(HOME, '.git'))) console.log(`warning: git would version the cache here: add the skill's lines to ${path.join(HOME, '.gitignore')} (search writes them when there is none)`)
  if (checks.some(c => !c[1])) process.exit(1)
}

// setup [show] | set <key>=<value>… | place add <label> <address…> | place rm <label>
async function setup(sub, ...rest) {
  const p = readJson(PROFILE_FILE, {})
  if (!sub || sub === 'show') return console.log(JSON.stringify({ ...PROFILE, ...p }, null, 2))
  if (sub === 'set' && rest.length) {
    for (const x of rest) {
      const [k, ...v] = x.split('='), value = Number(v.join('='))
      if (!PROFILE_NUMBERS.includes(k) || !Number.isFinite(value)) die(`setup set: ${k} is not one of ${PROFILE_NUMBERS.join(', ')}, or its value is not a number`)
      p[k] = value
    }
  } else if (sub === 'place' && rest[0] === 'add' && rest[2]) {
    const [, label, ...addr] = rest, [f] = await od.geocode(addr.join(' '), { limit: 1 })
    if (!f) die(`no address found for ${addr.join(' ')}`)
    p.places = [...(p.places ?? []).filter(x => x.label !== label), { label, address: f.properties.label, point: f.geometry.coordinates }]
  } else if (sub === 'place' && rest[0] === 'rm' && rest[1]) p.places = (p.places ?? []).filter(x => x.label !== rest[1])
  else die('usage: setup [show] | setup set <key>=<value>… | setup place add <label> <address…> | setup place rm <label>')
  writeJson(PROFILE_FILE, p)
  console.log(`profile saved: ${PROFILE_FILE}\n${JSON.stringify({ ...PROFILE, ...p })}\nRun search -p <slug> again for the places' travel times`)
}

async function geocode(q) {
  if (!q) die('usage: geocode "<address, street or place>" [--type housenumber|street|municipality]')
  for (const f of await od.geocode(q, { type: opt.type, limit: 5 })) {
    const x = f.properties
    console.log(`${x.label} [${x.type}] insee ${x.citycode} ban ${x.id} at ${f.geometry.coordinates.join(',')} score ${x.score.toFixed(2)}`)
  }
}

// criteria "budget_max=450000 rooms_min=3 dpe_max=D elevator=true"
function parseCriteria(s, into = {}) {
  for (const x of (s ?? '').split(/[\s,]+/).filter(Boolean)) {
    const [k, v] = x.split('=')
    if (!CRITERIA.includes(k)) die(`unknown criterion ${k}: ${CRITERIA.join(', ')}`)
    if (v === '' || v === 'null') { delete into[k]; continue }
    into[k] = k === 'dpe_max' ? v.toUpperCase() : ['elevator', 'outdoor'].includes(k) ? v === 'true' : +v
    if (k === 'dpe_max' && !LETTERS.includes(into[k])) die('dpe_max is a letter from A to G')
    if (!['dpe_max', 'elevator', 'outdoor'].includes(k) && !Number.isFinite(into[k])) die(`${k} is a number`)
  }
  return into
}

// the points of a street: its sales (DVF) and its numbers (the national address base), within 3 km of its point
async function streetPoints(s) {
  const [{ sales }, numbers] = await Promise.all([od.dvf(s.insee), od.geocode(`${s.street.name} ${s.city}`, { type: 'housenumber', limit: 50 })])
  const prefix = `${s.insee}_${s.street.code_voie}_`
  return [s.point, ...sales.filter(x => x.code_voie === s.street.code_voie && x.point).map(x => x.point), ...numbers.filter(f => f.properties.id.startsWith(prefix)).map(f => f.geometry.coordinates)]
    .filter(p => distance(p, s.point) <= 3000)
}

// The zone of a search, a polygon: along a street (300 m on each side by default), a circle around an address (500 m),
// the outline of the commune (or arrondissement), of the IRIS around the point, or of a Stream Estate division (its
// id, from geo autocomplete).
async function makeZone(s) {
  const kind = opt.zone ?? s.zone?.how ?? (s.type === 'municipality' ? 'commune' : 'radius')
  if (kind === 'radius') {
    const street = s.type === 'street' && s.street?.code_voie, r = +(opt.radius ?? s.zone?.radius_m ?? (street ? 300 : 500))
    const points = street ? await streetPoints(s) : []
    if (points.length >= 2) return { how: 'radius', kind: 'polygon', radius_m: r, geometry: corridor(points, r), label: `${r} m de part et d'autre de la ${s.street.name}` }
    return { how: 'radius', kind: 'radius', center: s.point, radius_m: r, geometry: circle(s.point, r), label: `${r} m autour de ${s.label}` }
  }
  if (kind === 'commune') {
    const c = await od.communePolygon(s.insee)
    if (!c) die(`no outline for the commune ${s.insee}`)
    return { how: 'commune', kind: 'polygon', geometry: c.geometry, label: c.name }
  }
  if (kind === 'iris') {
    const i = await od.irisAt(s.point)
    if (!i) die('no IRIS at this point')
    return { how: 'iris', kind: 'polygon', geometry: i.geometry, label: `IRIS ${i.name}`, iris: i.code }
  }
  if (kind === 'division') {
    const id = opt.division ?? s.zone?.division
    if (!id || !streamOn(s)) die('--zone division needs Stream Estate and --division <id> (geo autocomplete)')
    approve('GET /geo/administrative-divisions/{id}/geometry', estimate('GET /geo/administrative-divisions/{id}/geometry', {}, readJson(MEASURED, {})), 'division outline')
    const [g, d] = await Promise.all(['/geometry', ''].map(x => api(s.slug, 'GET', `/geo/administrative-divisions/${id}${x}`)))
    if (!g.data) die(`no division ${id}`)
    return { how: 'division', kind: 'polygon', geometry: g.data.geometry, label: d.data?.name ?? id, division: id }
  }
  die('--zone is radius, commune, iris or division')
}

const ARRONDISSEMENT = /^(751\d\d|6938\d|132\d\d)$/
const pool = async (items, n, fn) => { const out = [], it = items.entries(); await Promise.all(Array.from({ length: n }, async () => { for (const [i, x] of it) out[i] = await fn(x) })); return out }

// the free market and neighborhood data of a search: DVF sales, shops and services, travel times to the user's
// places, crime, income and risks at its center
async function freeData(dir, s) {
  const zoneOf = p => inZone(p, s.zone)
  const since = new Date(Date.now() - 2 * 365 * 86400000).toISOString().slice(0, 10)
  const dvf = od.dvf(s.insee), c = center(s.zone), places = profile().places ?? []
  const settle = p => p.then(v => v, e => ({ error: e.message }))
  const areaParts = Promise.all([
    settle(od.overpass(bbox(s.zone, 600))), settle(od.georisques(c)), settle(od.crime(s.insee, s.dep)),
    settle(od.income(`${ARRONDISSEMENT.test(s.insee) ? 'ARM' : 'COM'}-${s.insee}`)), settle(od.income(`DEP-${s.dep}`)), settle(od.income('FRANCE-FM')),
    settle(od.irisAt(c)),
    settle(pool(places.flatMap(pl => [['pedestrian', 15], ['pedestrian', 30], ['car', 20]].map(([pr, m]) => ({ pl, pr, m }))), 3,
      async ({ pl, pr, m }) => ({ place: pl.label, profile: pr, minutes: m, geometry: await od.isochrone(pl.point, pr, m) }))),
  ])
  const d = await dvf
  const market = { ...readJson(path.join(dir, 'market.json'), {}), updated: now(), alsace_moselle: d.alsace_moselle, dvf: d.sales.length ? summary(d.sales, { inZone: zoneOf, code_voie: s.street?.code_voie, since }) : null }
  writeJson(path.join(dir, 'market.json'), market)
  const [pois, risks, crime, local, department, france, iris, isochrones] = await areaParts
  const area = { updated: now(), center: c, pois, risks, crime, income: { local, department, france }, iris: iris && !iris.error ? { code: iris.code, name: iris.name } : null, isochrones, places }
  writeJson(path.join(dir, 'area.json'), area)
  return { market, area }
}

// search "<address | street | neighborhood>" [--zone …] [--radius m] [--criteria …] [--max n]: a new search, or -p
// <slug> to change one (zone, criteria) and refresh its free data
async function search(query) {
  let dir = opt.project ? searchDir() : null, s = dir ? readJson(path.join(dir, 'search.json')) : null
  if (!s) {
    if (!query) die('usage: search "<address, street or neighborhood>" [--zone radius|commune|iris|division] [--radius m] [--criteria "k=v …"] [--max n]')
    const [f] = await od.geocode(query, { type: opt.type, limit: 1 })
    if (!f) die(`no place found for "${query}": try geocode "${query}" and a more precise query`)
    const x = f.properties, slug = (() => { const b = slugify(opt.slug ?? x.label); let sl = b; for (let i = 2; fs.existsSync(path.join(HOME, sl)); i++) sl = `${b}-${i}`; return sl })()
    const [, voie] = x.id.split('_')
    s = {
      slug, query, label: x.label, created: now(), type: x.type, point: f.geometry.coordinates, insee: x.citycode, city: x.city, district: x.district ?? null,
      postcode: x.postcode, dep: x.depcode ?? x.citycode.slice(0, 2), street: x.street && voie ? { name: x.street, code_voie: voie } : null, ban: x.id,
      criteria: {}, max: 100, stream: null, last_fetch: null, last_refresh: null, last_visit: null, alert: null,
    }
    dir = path.join(HOME, slug)
  }
  if (opt.mode && !MODES.includes(opt.mode)) die('--mode is stream-estate or classic')
  s.mode = opt.mode ?? s.mode ?? (hasKey() ? 'stream-estate' : 'classic')
  if (opt.criteria) parseCriteria(opt.criteria, s.criteria)
  if (opt.max) s.max = +opt.max
  if (!s.zone || opt.zone || opt.radius || opt.division) s.zone = await makeZone(s)
  writeJson(path.join(dir, 'search.json'), s)
  writeGitignore()
  console.log(`search ${s.slug} [${s.mode}]: ${s.zone.label} (${s.label}, insee ${s.insee})`)
  const { market, area } = await freeData(dir, s)
  const m = market.dvf
  console.log(market.alsace_moselle ? 'DVF: none for the Bas-Rhin, Haut-Rhin and Moselle (their land register is not in DVF)'
    : m ? `DVF sold €/m² (median): zone ${fmt(m.zone.median_ppm2)} (${m.zone.count} sales), ${m.street ? `street ${fmt(m.street.median_ppm2)} (${m.street.count}), ` : ''}commune ${fmt(m.commune.median_ppm2)} (${m.commune.count}) over ${m.years.join(', ')}` : 'DVF: no apartment sale found')
  const failed = Object.entries({ shops: area.pois, risks: area.risks, crime: area.crime }).filter(([, v]) => v?.error).map(([k, v]) => `${k} (${v.error})`)
  console.log(`neighborhood: ${Array.isArray(area.pois) ? area.pois.length : 0} places nearby, ${(area.isochrones?.length ?? 0)} travel areas${failed.length ? `; failed: ${failed.join(', ')}` : ''}`)
  if (streamOn(s)) {
    const total = await withCredits(() => seCount(s.slug, seCriteria(s, { exclude: listingsOf(dir).map(l => l.se_id).filter(Boolean) })))
    s.stream = { total, counted_at: now() }
    writeJson(path.join(dir, 'search.json'), s)
    const n = Math.min(total, s.max), p = profile()
    console.log(`Stream Estate: ${total} new listings match, ${n} would be fetched for ${n} credits (${euros(n, p.eur_per_credit)}); ${Math.max(0, p.monthly_credit_cap - usage(usageLog()).month)} left of the monthly cap. Ask the user, then fetch -p ${s.slug} --spend ${n}`)
  } else console.log(`${s.mode === 'classic' ? 'classic search' : 'Stream Estate: off (no key)'}: assisted listings (WebSearch, WebFetch, pasted text, then add)`)
  console.log(`then: dashboard -p ${s.slug} --open`)
}
const listingsOf = dir => readJson(path.join(dir, 'listings.json'), [])

// the searches folder's .gitignore: written when there is none, the skill's lines added once to one that lacks them
function writeGitignore() {
  const file = path.join(HOME, '.gitignore'), have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  if (have?.includes('# skill-immo:')) return
  fs.mkdirSync(HOME, { recursive: true })
  fs.writeFileSync(file, have == null ? GITIGNORE : `${have.replace(/\n*$/, '\n\n')}${GITIGNORE}`)
  console.log(`${have == null ? 'wrote' : 'added the skill\'s lines to'} ${file}: git keeps the searches and the credits log, not the cache nor the profile`)
}

// the free building data of a listing: its address, the DPE registry, the condominium register, the risks and the
// sales of the same building. --resolve asks Stream Estate for the exact address first (beta, unknown cost).
async function enrichOne(l, s, sales) {
  const b = { ...(l.building ?? {}) }, precise = l.location.accuracy === 'PRECISE' || (l.source !== 'stream-estate' && l.location.address)
  let point = l.location.point, label = precise ? l.location.address : null
  if (opt.resolve && l.se_id && streamOn(s)) {
    const r = await withCredits(() => api(s.slug, 'POST', `/properties/${l.se_id}/resolve-address`))
    const a = r.data?.address, conf = r.data?.confidence ?? 'NONE'
    b.address = { confidence: conf, method: r.data?.method ?? null, label: a?.label ?? null, certificate: r.data?.energyCertificateNumber ?? null, shown: ['EXACT', 'HIGH'].includes(conf) ? 'address' : ['MEDIUM', 'LOW'].includes(conf) ? 'probable' : null }
    if (a?.longitude != null && conf !== 'NONE') { point = [a.longitude, a.latitude]; label = a.label }
  }
  if (!point) return l
  const [f] = label ? await od.geocode(label, { type: 'housenumber', limit: 1 }) : []
  const ban = f?.properties.score > 0.7 ? f.properties.id : null
  const precisePoint = !!ban || precise
  const [dpe, risks, copro] = await Promise.all([
    precisePoint ? od.ademe(ban ? { ban } : { point, radius: 15 }).catch(() => []) : [],
    od.georisques(point).catch(() => null),
    precisePoint ? od.rnic(point).catch(() => []) : [],
  ])
  // the flat's own DPE: same surface within 8 %, and same floor when both are known (ADEME's 0 often means unknown)
  const match = l.area ? dpe.find(d => Math.abs(d.surface_habitable_logement - l.area) / l.area < 0.08 && (l.floor == null || !d.numero_etage_appartement || d.numero_etage_appartement === l.floor)) : null
  const coproNumber = dpe.find(d => d.numero_immatriculation_copropriete)?.numero_immatriculation_copropriete
  const [, voie, number] = ban?.split('_') ?? []
  Object.assign(b, {
    ban, updated: now(), risks,
    dpe: dpe.slice(0, 12).map(d => ({ number: d.numero_dpe, date: d.date_etablissement_dpe, energy: d.etiquette_dpe, ghg: d.etiquette_ges, area: d.surface_habitable_logement, floor: d.numero_etage_appartement, kwh: d.conso_5_usages_par_m2_ep, cost: d.cout_total_5_usages, heating: d.type_energie_principale_chauffage, year: d.annee_construction })),
    dpe_match: match ? match.numero_dpe : null, dpe_cost_yearly: match?.cout_total_5_usages ? Math.round(match.cout_total_5_usages) : null,
    construction_year: l.construction_year ?? dpe.find(d => d.annee_construction)?.annee_construction ?? null,
    copro: copro.find(c => c.number === coproNumber) ?? copro[0] ?? null,
    sales: ban && number ? building(sales, +number, voie).slice(0, 20) : [],
  })
  return { ...l, building: b }
}

async function enrichAll(dir, s, ids) {
  const sales = (await od.dvf(s.insee)).sales, set = new Set(ids)
  const ls = await pool(listingsOf(dir), 4, async l => (set.has(l.id) ? enrichOne(l, s, sales).catch(e => { console.error(`enrich ${l.id}: ${e.message}`); return l }) : l))
  writeJson(path.join(dir, 'listings.json'), ls)
  return ls.filter(l => set.has(l.id) && l.building).length
}

// new listings with a point get the free building data, 50 at most a run (the rest: enrich)
// ponytail: a fixed cap of 50 to keep a run short, a background queue if searches grow past it
const autoEnrich = (dir, s, changes) => enrichAll(dir, s, changes.filter(c => c.kind === 'new').map(c => c.id).filter(id => listingsOf(dir).find(l => l.id === id)?.location.point).slice(0, 50))

function saveMerged(dir, incoming, gone = []) {
  const { listings, changes } = merge(listingsOf(dir), incoming, now(), gone)
  writeJson(path.join(dir, 'listings.json'), listings)
  return changes
}

const describe = changes => {
  const n = k => changes.filter(c => c.kind === k).length
  return `${n('new')} new, ${n('price_drop')} price drops, ${n('price_rise')} rises, ${n('status')} status changes, ${n('expired')} expired`
}

// fetch -p <slug> --spend n: the listings of the zone from Stream Estate
async function fetchListings() {
  const dir = searchDir(), s = readJson(path.join(dir, 'search.json'))
  requireStream(s)
  const known = listingsOf(dir).map(l => l.se_id).filter(Boolean), criteria = seCriteria(s, { exclude: known })
  const total = await withCredits(() => seCount(s.slug, criteria)), n = Math.min(total, +(opt.max ?? s.max))
  if (!n) return console.log('Stream Estate: no new listing matches')
  approve('POST /properties', n, `fetch ${n} of ${total} listings`)
  const raw = await withCredits(() => seFetch(s.slug, criteria, Math.min(n, +opt.spend || n)))
  const changes = saveMerged(dir, raw.map(fromStreamEstate))
  Object.assign(s, { last_fetch: now(), last_refresh: s.last_refresh ?? now(), stream: { total: total - raw.length, counted_at: now() } })
  writeJson(path.join(dir, 'search.json'), s)
  const enriched = await autoEnrich(dir, s, changes)
  console.log(`fetched ${raw.length} listings: ${describe(changes)}; ${enriched} with building data (enrich -p ${s.slug} --all for the rest)`)
}

// market -p <slug> --accept-unknown: the asking prices (analytics) and the reconciled sales (transactions) of the zone
async function market() {
  const dir = searchDir(), s = readJson(path.join(dir, 'search.json'))
  requireStream(s)
  const m = readJson(MEASURED, {}), calls = 4
  const e = [estimate('GET /analytics/listings', { calls }, m), estimate('POST /transactions/search', { results: 100 }, m)]
  approve('GET /analytics/listings + POST /transactions/search', e.includes(null) ? null : e[0] + e[1], 'market analytics')
  const [w, so, ea, n] = bbox(s.zone), from = d => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
  const q = { property_type: 'FLAT', transaction_type: 'SELL', lng_min: w, lat_min: so, lng_max: ea, lat_max: n }
  const metrics = ['count', 'median:price_per_sqm', 'median:price', 'median:area']
  const run = async extra => (await withCredits(() => api(s.slug, 'GET', '/analytics/listings', { query: { ...q, ...extra } }))).data
  const [trend, dpe, publishers, online] = await Promise.all([
    run({ event_type: 'CREATED', event_at_from: from(730), time_bucket: 'month', metrics }),
    run({ event_type: 'CREATED', event_at_from: from(365), group_by: 'dpe_energy_rating', metrics }),
    run({ event_type: 'CREATED', event_at_from: from(365), group_by: 'publisher_type', metrics }),
    // days between a listing's creation and its expiry: how long flats stay online here
    run({ event_type: 'EXPIRED', event_at_from: from(365), metrics: ['count', 'median:days_between_events', 'percentile:days_between_events:75'] }),
  ])
  const tx = (await withCredits(() => api(s.slug, 'POST', '/transactions/search', { body: { propertyType: ['FLAT'], dateMutation: { after: from(730) }, geoshape: s.zone.geometry, page: { size: 100 } } }))).data
  const sold = (tx?.data ?? []).filter(t => t.price?.pricePerSqmCents).map(t => ({ id: t.id, source: t.source, date: t.dateMutation, price: t.price.amountCents / 100, ppm2: Math.round(t.price.pricePerSqmCents / 100), area: t.areas?.livingAreaSqm, rooms: t.areas?.roomsCount, point: t.location?.geoPoint ? [t.location.geoPoint.lon, t.location.geoPoint.lat] : null, matched: !!t.matched }))
  const out = { ...readJson(path.join(dir, 'market.json'), {}), stream: { updated: now(), trend, dpe, publishers, online, transactions: { count: sold.length, more: !!tx?.meta?.nextCursor, median_ppm2: median(sold.map(t => t.ppm2)), by_source: Object.fromEntries([...Map.groupBy(sold, t => t.source)].map(([k, v]) => [k, v.length])), items: sold } } }
  writeJson(path.join(dir, 'market.json'), out)
  console.log(`asking €/m² (median, 12 months): ${fmt(trend?.data?.at(-1)?.metrics?.['median:price_per_sqm'])} last month; ${sold.length} reconciled sales (${Object.entries(out.stream.transactions.by_source).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}), median ${fmt(out.stream.transactions.median_ppm2)} €/m²`)
}

// add -p <slug> --url <listing> [--spend 2] | --file <listing.json> [--source websearch|pasted]
async function add() {
  const dir = searchDir(), s = readJson(path.join(dir, 'search.json'))
  if (opt.url) {
    if (!streamOn(s)) die(`${s.mode === 'classic' ? 'classic search' : 'Stream Estate is off'}: read ${opt.url} with WebFetch, then add -p ${s.slug} --file listing.json`, 4)
    const known = listingsOf(dir).find(l => l.urls.some(u => normUrl(u.url) === normUrl(opt.url)))
    if (known) return console.log(`already in the search: ${known.id}`)
    approve('POST /properties/lookup-by-url + GET /properties/{id}', 2, 'look up the listing')
    const r = await withCredits(() => api(s.slug, 'POST', '/properties/lookup-by-url', { body: { url: opt.url } }))
    if (!r.data) die(`Stream Estate does not know ${opt.url} (not charged): read it with WebFetch, then add -p ${s.slug} --file listing.json`, 4)
    const p = await withCredits(() => api(s.slug, 'GET', `/properties/${r.data.id}`))
    const changes = saveMerged(dir, [fromStreamEstate(p.data)])
    await autoEnrich(dir, s, changes)
    return console.log(`added ${r.data.id}: ${describe(changes)}`)
  }
  if (!opt.file) die('usage: add -p <slug> --url <listing url> | --file <listing.json> (listing-format.md)')
  const raw = readJson(opt.file === '-' ? 0 : opt.file), items = [raw].flat(), source = opt.source === 'pasted' ? 'pasted' : 'websearch'
  const ls = await Promise.all(items.map(async x => {
    // an address without a point: the national address base places it
    if (!x.point && x.address) {
      const [f] = await od.geocode(`${x.address} ${x.city ?? s.city}`, { limit: 1 })
      if (f) Object.assign(x, { point: f.geometry.coordinates, insee: x.insee ?? f.properties.citycode, postcode: x.postcode ?? f.properties.postcode, city: x.city ?? f.properties.city })
    }
    return fromInput(x, source)
  }))
  const changes = saveMerged(dir, ls)
  await autoEnrich(dir, s, changes)
  console.log(`added ${ls.length} listing${ls.length > 1 ? 's' : ''}: ${describe(changes)}`)
}

// enrich -p <slug> --id <id> | --all [--resolve --accept-unknown]
async function enrich() {
  const dir = searchDir(), s = readJson(path.join(dir, 'search.json')), ls = listingsOf(dir)
  const ids = opt.id ? opt.id.split(',') : opt.all ? ls.filter(l => l.location.point).map(l => l.id) : die('usage: enrich -p <slug> --id <id[,id…]> | --all [--resolve]')
  if (opt.resolve) requireStream(s)
  if (opt.resolve) approve('POST /properties/{id}/resolve-address', estimate('POST /properties/{id}/resolve-address', { calls: ids.length }, readJson(MEASURED, {})), `resolve ${ids.length} addresses`)
  console.log(`building data for ${await enrichAll(dir, s, ids)} of ${ids.length} listings`)
}

// refresh -p <slug> [--spend n]: what changed since the last refresh — new listings, price drops, offers, expiries
async function refresh() {
  const dir = searchDir(), s = readJson(path.join(dir, 'search.json'))
  await freeData(dir, s)
  const assistedCount = listingsOf(dir).filter(l => l.source !== 'stream-estate' && l.status !== 'EXPIRED').length
  if (!streamOn(s) || !s.last_refresh) {
    console.log(`free data refreshed. ${streamOn(s) ? `No Stream Estate fetch yet: fetch -p ${s.slug}` : s.mode === 'classic' ? 'Classic search' : 'Stream Estate is off'}${assistedCount ? `; ${assistedCount} assisted listings: check each with WebFetch (one page), then add --file to update price or status` : ''}`)
    return
  }
  const criteria = seCriteria(s, { since: s.last_refresh }), total = await withCredits(() => seCount(s.slug, criteria)), n = Math.min(total, +(opt.max ?? s.max))
  if (n) approve('POST /properties', n, `refresh ${n} changed listings`)
  const raw = n ? await withCredits(() => seFetch(s.slug, criteria, n)) : []
  const changes = saveMerged(dir, raw.map(fromStreamEstate))
  s.last_refresh = now()
  writeJson(path.join(dir, 'search.json'), s)
  await autoEnrich(dir, s, changes)
  console.log(`refresh: ${raw.length} changed since the last one: ${describe(changes)}`)
  for (const c of changes.filter(c => c.kind !== 'new')) console.log(`  ${c.id} ${c.kind}: ${c.from} → ${c.to}`)
}

// alert forecast | create [--webhook <https url>] [--drop 3] | list | events | on | off | delete, -p <slug>
async function alert(sub) {
  if (!hasKey()) die('alerts need Stream Estate (no key)')
  const m = readJson(MEASURED, {}), cost = r => estimate(r, {}, m)
  if (sub === 'list') {
    approve('GET /alerts', cost('GET /alerts'), 'list alerts')
    for (const a of (await api(null, 'GET', '/alerts')).data ?? []) console.log(`${a.id} ${a.enabled ? 'on ' : 'off'} ${a.name ?? ''}`)
    return
  }
  const dir = searchDir(), s = readJson(path.join(dir, 'search.json')), criteria = seCriteria(s, { alert: true })
  requireStream(s)
  if (sub === 'forecast') {
    const f = (await api(s.slug, 'POST', '/alerts/forecast', { body: { criteria } })).data
    return console.log(JSON.stringify({ window_days: f?.windowDays, total: f?.total, per_day: f?.perDay, per_hour: f?.perHour }))
  }
  if (sub === 'create') {
    if (s.alert?.id) die(`the search already has the alert ${s.alert.id}`)
    approve('POST /alerts', cost('POST /alerts'), 'create the alert')
    // ntfy.sh by default: a random topic (whoever knows it can read it), the JSON turned into a readable push
    const topic = `immo-${s.slug.slice(0, 20)}-${randomBytes(8).toString('hex')}`
    const tpl = new URLSearchParams({ tpl: 'yes', t: '{{.eventType}} · {{.alert.name}}', m: '{{.data.property.unit.rooms}} p. · {{.data.property.area.displayed}} m² · {{.data.property.pricing.displayed}} € — {{.data.property.location.address}}' })
    const webhook = opt.webhook ?? `https://ntfy.sh/${topic}?${tpl}`
    if (!/^https:\/\//.test(webhook)) die('the webhook must be HTTPS')
    const drop = +(opt.drop ?? 3)
    const a = (await api(s.slug, 'POST', '/alerts', { body: { name: `immo ${s.label}`, enabled: true, criteria, notificationDestination: { webhookUrl: webhook }, notificationConfig: { rules: [{ eventType: 'NEW_MATCH' }, { eventType: 'PRICE_CHANGE', variationPercent: [{ gte: null, lte: -drop }] }] } } })).data
    s.alert = { id: a.id, created: now(), webhook: opt.webhook ? 'custom' : 'ntfy', topic: opt.webhook ? null : topic, drop }
    writeJson(path.join(dir, 'search.json'), s)
    if (a.signingKey) console.log(`webhook signing key (shown once, keep it): ${a.signingKey}`)
    return console.log(`alert ${a.id}: new listings and drops of ${drop} % or more${opt.webhook ? '' : ` pushed to ntfy: subscribe to the topic ${topic} in the ntfy app (https://ntfy.sh/${topic})`}`)
  }
  if (!s.alert?.id) die(`no alert on ${s.slug}: alert create -p ${s.slug}`)
  if (sub === 'events') {
    approve('GET /alerts/{id}/events', cost('GET /alerts/{id}/events'), 'read the alert events')
    const ev = (await api(s.slug, 'GET', `/alerts/${s.alert.id}/events`, { query: { 'order[createdAt]': 'desc' } })).data ?? []
    writeJson(path.join(dir, 'alert-events.json'), ev.map(e => ({ id: e.id, type: e.eventType, property: e.property?.split('/').pop(), at: e.createdAt, notified: e.notifiedAt })))
    const known = new Set(listingsOf(dir).map(l => l.se_id))
    return console.log(`${ev.length} events; ${ev.filter(e => !known.has(e.property?.split('/').pop())).length} about properties not in the search yet (refresh fetches them)`)
  }
  if (['on', 'off'].includes(sub)) {
    approve('PUT /alerts/{id}', cost('PUT /alerts/{id}'), `turn the alert ${sub}`)
    await api(s.slug, 'PUT', `/alerts/${s.alert.id}`, { body: { enabled: sub === 'on' } })
    s.alert.enabled = sub === 'on'
  } else if (sub === 'delete') {
    approve('DELETE /alerts/{id}', cost('DELETE /alerts/{id}'), 'delete the alert')
    await api(s.slug, 'DELETE', `/alerts/${s.alert.id}`)
    s.alert = null
  } else die('usage: alert forecast | create [--webhook <https url>] [--drop 3] | list | events | on | off | delete -p <slug>')
  writeJson(path.join(dir, 'search.json'), s)
  console.log(`alert ${sub}: done`)
}

// usage [--remote]: the credits spent, per month, search and route; --remote compares with Stream Estate's count
async function usageCmd() {
  const p = profile(), log = usageLog(), u = usage(log)
  if (opt.json) return console.log(JSON.stringify({ ...u, cap: p.monthly_credit_cap, eur_per_credit: p.eur_per_credit }))
  console.log(`this month: ${u.month} credits (${euros(u.month, p.eur_per_credit)}) of the ${p.monthly_credit_cap} cap; last 30 days: ${u.last30}${u.unknown ? `; ${u.unknown} calls of unknown cost` : ''}`)
  for (const [k, v] of Object.entries(u.by_search)) console.log(`  search ${k}: ${v.credits} credits, ${v.calls} calls`)
  for (const [k, v] of Object.entries(u.by_route)) console.log(`  ${k}: ${v.credits} credits, ${v.calls} calls`)
  if (opt.remote && hasKey()) {
    const r = (await api(null, 'GET', '/account/api-usage', { query: { groupBy: 'ROUTE', granularity: 'MONTH' } })).data
    console.log(`Stream Estate over ${r?.period?.start?.slice(0, 10)} → ${r?.period?.end?.slice(0, 10)}: ${r?.totals?.credits ?? '?'} credits, ${r?.totals?.calls} calls (local log: ${u.last30})`)
    for (const x of r?.byRoute ?? []) console.log(`  ${x.route}: ${x.credits ?? '?'} credits, ${x.calls} calls, ${x.results} results`)
  }
}

// costs | costs set "<route>=<credits>" | costs measure --accept-unknown --spend 1: the price of each route
async function costs(sub, ...rest) {
  const m = readJson(MEASURED, {})
  if (sub === 'set') {
    for (const x of rest) { const i = x.lastIndexOf('='); if (!(x.slice(0, i) in table())) die(`unknown route ${x.slice(0, i)}`); m[x.slice(0, i)] = +x.slice(i + 1) }
    writeJson(MEASURED, m)
  } else if (sub === 'measure') {
    if (!hasKey()) die('costs measure needs the Stream Estate key')
    approve('POST /properties', 1, 'measure the routes of unknown cost (one property read, then one minimal call per route)')
    if (!opt['accept-unknown']) die('costs measure calls every route of unknown cost: ask the user, then pass --accept-unknown', 2)
    const before = (await api(null, 'GET', '/account/api-usage', { query: { groupBy: 'ROUTE' } })).data
    const [p] = (await api(null, 'POST', '/properties', { body: { criteria: { property: { type: { in: ['FLAT'] }, transaction: { type: 'SELL' }, locations: { countryCode: 'FR', in: { uniqueCodes: ['69383'] } } } }, size: 1 } })).data ?? []
    if (!p) die('no property to measure with')
    const city = p.property?.location?.city?.id, header = {}
    const call = async (route, ...a) => { try { header[route] = (await se(...a, { charged: charged('costs-measure') })).credits } catch (e) { header[route] = `error: ${e.message.slice(0, 80)}` } }
    await call('POST /properties/{id}/resolve-address', 'POST', `/properties/${p.id}/resolve-address`)
    await call('GET /analytics/listings', 'GET', '/analytics/listings', { query: { property_type: 'FLAT', metrics: 'count', lat_min: 45.75, lat_max: 45.76, lng_min: 4.84, lng_max: 4.85 } })
    await call('POST /transactions/search', 'POST', '/transactions/search', { body: { page: { size: 1 } } })
    await call('GET /geo/autocomplete', 'GET', '/geo/autocomplete', { query: { query: 'lyon', limit: 1 } })
    if (city) {
      await call('GET /geo/administrative-divisions/{id}', 'GET', `/geo/administrative-divisions/${city}`)
      await call('GET /geo/administrative-divisions/{id}/geometry', 'GET', `/geo/administrative-divisions/${city}/geometry`)
      await call('GET /geo/administrative-divisions/{id}/descendants', 'GET', `/geo/administrative-divisions/${city}/descendants`, { query: { size: 1 } })
    }
    await call('GET /sources', 'GET', '/sources')
    if (p.publishers?.[0]?.id) await call('GET /publishers/{id}', 'GET', `/publishers/${p.publishers[0].id}`)
    await call('GET /alerts', 'GET', '/alerts')
    const a = (await se('POST', '/alerts', { body: { name: 'immo cost probe', enabled: false, criteria: { property: { type: { in: ['FLAT'] }, transaction: { type: 'SELL' } } } }, charged: charged('costs-measure') }).catch(() => ({})))
    if (a.data?.id) {
      header['POST /alerts'] = a.credits
      await call('PUT /alerts/{id}', 'PUT', `/alerts/${a.data.id}`, { body: { enabled: false } })
      await call('GET /alerts/{id}/events', 'GET', `/alerts/${a.data.id}/events`)
      await call('DELETE /alerts/{id}', 'DELETE', `/alerts/${a.data.id}`)
    }
    // the account's count moves a few seconds after the calls
    await new Promise(ok => setTimeout(ok, 8000))
    const after = (await api(null, 'GET', '/account/api-usage', { query: { groupBy: 'ROUTE' } })).data
    const credit = (r, route) => r?.byRoute?.find(x => route.endsWith(x.route.replace(/\{[^}]+\}/g, '{id}')) || x.route.replace(/\{[^}]+\}/g, '{id}').endsWith(route.split(' ')[1]))?.credits ?? 0
    for (const route of Object.keys(header)) {
      const diff = credit(after, route) - credit(before, route), h = header[route]
      const value = typeof h === 'number' ? h : diff
      console.log(`${route}: header ${h ?? 'absent'}, api-usage +${diff} → ${value}`)
      if (typeof h !== 'string') m[route] = value
    }
    writeJson(MEASURED, m)
    console.log(`saved to ${MEASURED}; copy the results into references/stream-estate.md and lib/costs.js`)
  }
  for (const [route, c] of Object.entries(table(m))) console.log(`${route}: ${c.credits == null ? 'unknown' : `${c.credits}${c.per ? ' per result' : ''}`}${c.note ? ` (${c.note})` : ''}`)
}

// show -p <slug> [--id <id[,id…]>]: what Claude needs to analyse or compare listings, computed as the dashboard does
function show() {
  const dir = searchDir(), { search: s, listings, market: m, area } = load(dir), ref = reference(m), p = profile()
  const ids = opt.id?.split(',')
  const ls = ids ? ids.map(id => listings.find(l => l.id === id) ?? die(`no listing ${id} in ${s.slug}`)) : listings.filter(l => l.status !== 'EXPIRED')
  const out = ls.map(l => ({
    id: l.id, source: l.source, title: l.title, url: l.urls.find(u => u.url)?.url ?? null, portals: l.urls.map(u => u.source),
    price: l.price, area: l.area, price_per_m2: l.price_per_m2, rooms: l.rooms, floor: l.floor, dpe: l.dpe?.energy, status: l.status,
    matches: matches(l, s.criteria), my_status: l.my_status, notes: l.notes, address: l.building?.address?.shown ? l.building.address.label : l.location.address,
    market: { reference: ref, badge: badge(l.price_per_m2, ref?.ppm2), street_ppm2: m.dvf?.street?.median_ppm2 ?? null, asking_ppm2: m.stream?.trend?.data?.at(-1)?.metrics?.['median:price_per_sqm'] ?? null },
    negotiation: negotiation(l, ref?.ppm2), days_online: daysOnline(l), dropped: Math.round(dropped(l) * 1000) / 1000, urgent: l.urgent, favorites: l.favorites,
    budget: budget(l, p),
    building: l.building ? { dpe_registry: l.building.dpe_match ? l.building.dpe.find(d => d.number === l.building.dpe_match) : null, construction_year: l.building.construction_year, copro: l.building.copro, risks: l.building.risks, building_sales: l.building.sales?.length ?? 0 } : null,
    nearby: l.location.point && Array.isArray(area.pois) ? around(l.location.point, area.pois) : null,
    travel: l.location.point ? (area.isochrones ?? []).filter(i => i.geometry && inGeometry(l.location.point, i.geometry)).map(i => `${i.place}: ≤ ${i.minutes} min ${i.profile === 'car' ? 'en voiture' : 'à pied'}`) : [],
    changes: l.changes ?? [],
  }))
  console.log(JSON.stringify(ids?.length === 1 ? out[0] : out, null, 2))
}

function list() {
  for (const x of searches()) {
    const { search: s, listings: ls } = load(path.join(HOME, x))
    console.log(`${x} [${s.mode ?? 'classic'}]: ${s.zone?.label ?? s.label}, ${ls.length} listings (${ls.filter(l => l.status !== 'EXPIRED').length} online), created ${s.created.slice(0, 10)}`)
  }
}

// --- the dashboard server ------------------------------------------------------------------------------------

const reply = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)) }
const readBody = (req, max = 2e6) => new Promise((ok, ko) => {
  const chunks = []
  let size = 0
  req.on('data', c => { if ((size += c.length) > max) { ko(new Error('body too large')); req.destroy() } else chunks.push(c) })
  req.on('end', () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}) } catch (e) { ko(e) } })
  req.on('error', ko)
})
function sendFile(res, file) {
  const st = file && fs.statSync(file, { throwIfNoEntry: false })
  if (!st?.isFile()) return reply(res, 404, { error: 'not found' })
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'max-age=31536000, immutable' : 'no-cache' })
  fs.createReadStream(file).pipe(res)
}

// What the dashboard may run, as engine commands with their flags: the paid ones go through the same estimate and
// approval as Claude's (estimate: true first, then spend / accept_unknown once the user confirmed in the dialog).
const RUN = {
  search: ['query', 'mode', 'criteria', 'zone', 'radius', 'max'], fetch: ['spend', 'max'], market: [], refresh: ['spend'], enrich: ['id', 'all', 'resolve'],
  add: ['url', 'spend'], alert: ['sub', 'webhook', 'drop'], usage: ['remote'],
}
function runArgs(body) {
  const keys = RUN[body.cmd]
  if (!keys) throw new Error(`cannot run ${body.cmd}`)
  const a = body.args ?? {}, argv = [SELF, body.cmd]
  if (body.cmd === 'alert') { if (!['forecast', 'create', 'events', 'on', 'off', 'delete'].includes(a.sub)) throw new Error('bad alert'); argv.push(a.sub) }
  if (body.cmd === 'search' && a.query && !body.slug) argv.push(String(a.query))
  if (body.slug) { if (!/^[a-z0-9][a-z0-9-]*$/.test(body.slug)) throw new Error('bad slug'); argv.push('-p', body.slug) }
  for (const k of keys) if (!['query', 'sub'].includes(k) && a[k] != null && a[k] !== false) argv.push(`--${k}`, ...(a[k] === true ? [] : [String(a[k])]))
  if (body.estimate) argv.push('--estimate')
  if (body.accept_unknown) argv.push('--accept-unknown')
  return argv
}
const runEngine = argv => new Promise(ok => {
  const p = spawn(process.execPath, argv, { cwd: HOME, env: { ...process.env, IMMO_DIR: HOME } })
  let out = '', err = ''
  p.stdout.on('data', d => (out += d))
  p.stderr.on('data', d => (err += d))
  p.on('close', code => ok({ code, out: out.trim(), err: err.trim() }))
})

async function handle(req, res) {
  const { host, origin } = req.headers, port = req.socket.localPort
  // DNS rebinding and cross-site requests: only pages from this machine
  if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host) || (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))) return reply(res, 403, { error: 'forbidden' })
  const url = new URL(req.url, `http://${host}`), post = req.method === 'POST', p = url.pathname
  if (p === '/__immo') return reply(res, 200, { engine: ENGINE, home: HOME, mtime: LOADED })
  if (p === '/__immo/quit' && post) { res.on('finish', () => process.exit(0)); return reply(res, 200, {}) }
  if (p === '/__immo/owner' && post) {
    const pid = +url.searchParams.get('pid')
    if (!Number.isInteger(pid) || pid < 2) return reply(res, 400, { error: 'expects ?pid=<process id>' })
    watchOwner(pid)
    return reply(res, 200, {})
  }
  if (p === '/api/state') {
    const pr = profile(), u = usage(usageLog())
    return reply(res, 200, { home: HOME, stream_estate: hasKey(), costs: table(readJson(MEASURED, {})), usage: { ...u, cap: pr.monthly_credit_cap, eur_per_credit: pr.eur_per_credit }, log: usageLog().slice(-300) })
  }
  if (p === '/api/searches') return reply(res, 200, searches().map(x => { const { search: s, listings: ls } = load(path.join(HOME, x)); return { slug: x, label: s.label, mode: s.mode ?? 'classic', zone: s.zone?.label, created: s.created, listings: ls.length, online: ls.filter(l => l.status !== 'EXPIRED').length } }))
  if (p === '/api/profile') {
    if (!post) return reply(res, 200, profile())
    const body = await readBody(req), pr = readJson(PROFILE_FILE, {})
    for (const k of PROFILE_NUMBERS) if (body[k] != null && Number.isFinite(+body[k])) pr[k] = +body[k]
    writeJson(PROFILE_FILE, pr)
    return reply(res, 200, profile())
  }
  if (p === '/api/autocomplete') return reply(res, 200, await od.completion(url.searchParams.get('q') ?? '').catch(() => []))
  if (p === '/api/run' && post) {
    let argv
    try { argv = runArgs(await readBody(req)) } catch (e) { return reply(res, 400, { error: e.message }) }
    const r = await runEngine(argv)
    if (argv.includes('--estimate') && r.code === 0) try { return reply(res, 200, { ...r, estimate: JSON.parse(r.out.split('\n').at(-1)) }) } catch {}
    return reply(res, 200, r)
  }
  const m = p.match(/^\/api\/s\/([a-z0-9][a-z0-9-]*)(\/.*)?$/)
  if (m) {
    const dir = path.join(HOME, m[1]), sub = m[2] ?? ''
    if (!fs.existsSync(path.join(dir, 'search.json'))) return reply(res, 404, { error: `no search ${m[1]}` })
    if (!sub) return reply(res, 200, { ...load(dir), events: readJson(path.join(dir, 'alert-events.json'), []) })
    if (sub === '/visit' && post) {
      const f = path.join(dir, 'search.json'), s = readJson(f), before = s.last_visit
      s.last_visit = now()
      writeJson(f, s)
      return reply(res, 200, { last_visit: before })
    }
    const lm = sub.match(/^\/listings\/([\w-]+)$/)
    if (lm && post) {
      const body = await readBody(req), f = path.join(dir, 'listings.json'), ls = readJson(f, []), l = ls.find(x => x.id === lm[1])
      if (!l) return reply(res, 404, { error: 'no such listing' })
      if ('my_status' in body) { if (![null, 'to_visit', 'visited', 'offer', 'dropped'].includes(body.my_status)) return reply(res, 400, { error: 'bad status' }); l.my_status = body.my_status }
      if (typeof body.notes === 'string') l.notes = body.notes.slice(0, 5000)
      writeJson(f, ls)
      return reply(res, 200, l)
    }
    return reply(res, 404, { error: 'not found' })
  }
  if (p.startsWith('/api/')) return reply(res, 404, { error: 'not found' })
  // the dashboard: its files, else its page for any search URL (/<slug>/)
  const rel = p.replace(/^\/[a-z0-9-]+\/(?=assets\/)/, '/').slice(1), file = path.resolve(DASHBOARD, rel || 'index.html')
  sendFile(res, file.startsWith(DASHBOARD + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(DASHBOARD, 'index.html'))
}

function serve() {
  http.createServer((req, res) => handle(req, res).catch(e => reply(res, 500, { error: e.message })))
    .listen(PORT, '127.0.0.1', () => console.log(`dashboard server on http://127.0.0.1:${PORT}/ for ${HOME}`))
}

// the Claude processes the server works for (each `dashboard` adds its own): it quits once they have all quit. A
// server nobody registered with (started by hand, the tests) runs until stopped
const owners = new Set()
function watchOwner(pid) {
  if (!owners.size) setInterval(() => {
    for (const o of owners) try { process.kill(o, 0) } catch (e) { if (e.code === 'ESRCH') owners.delete(o) }
    if (!owners.size) { console.log('every Claude this dashboard server worked for has quit: stopping'); process.exit(0) }
  }, 2000)
  owners.add(pid)
}

// the Claude Code (or Claude app) this command runs under: the nearest ancestor named claude, null outside one
// ponytail: null on Windows (no ps -o), its server runs until Windows logs off; Get-CimInstance Win32_Process if that bothers
function claudePid() {
  try {
    const procs = new Map(execFileSync('ps', ['-A', '-o', 'pid=,ppid=,comm='], { encoding: 'utf8' }).trim().split('\n').map(l => {
      const [, pid, ppid, comm] = l.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/)
      return [+pid, { ppid: +ppid, comm }]
    }))
    for (let pid = process.ppid; pid > 1 && procs.has(pid); pid = procs.get(pid).ppid)
      if (/^claude$/i.test(path.basename(procs.get(pid).comm))) return pid
  } catch {}
  return null
}

// the dashboard server in the background: reused when it runs this very engine for this searches folder; one server
// per folder, side by side from PORT up
async function findServer() {
  const sleep = t => new Promise(ok => setTimeout(ok, t)), base = port => `http://127.0.0.1:${port}/`
  const ping = port => fetch(base(port) + '__immo').then(r => r.json()).catch(() => null)
  const ports = Array.from({ length: 20 }, (_, i) => PORT + i), lives = await Promise.all(ports.map(ping))
  let i = lives.findIndex(l => l?.home === HOME)
  if (i >= 0 && lives[i].engine === ENGINE && lives[i].mtime === LOADED) return base(ports[i])
  if (i >= 0) {
    await fetch(base(ports[i]) + '__immo/quit', { method: 'POST' }).catch(() => {})
    await sleep(300)
    lives[i] = null
  } else i = 0
  fs.mkdirSync(HOME, { recursive: true })
  const log = fs.openSync(path.join(HOME, '.dashboard.log'), 'a')
  for (; i < ports.length; i++) {
    if (lives[i]) continue
    spawn(process.execPath, [SELF, 'serve'], { cwd: HOME, env: { ...process.env, IMMO_DIR: HOME, IMMO_PORT: `${ports[i]}` }, detached: true, windowsHide: true, stdio: ['ignore', log, log] }).unref()
    let live = null
    for (let k = 0; k < 50 && !(live = await ping(ports[i])); k++) await sleep(100)
    if (live?.home === HOME) return base(ports[i])
  }
  die(`the dashboard server did not start on ports ${PORT}–${PORT + 19}, see ${path.join(HOME, '.dashboard.log')}`)
}

// a URL in the default browser; never fatal, the URL is printed anyway
function openUrl(url) {
  const [bin, ...argv] = { darwin: ['open'], win32: ['cmd', '/c', 'start', ''] }[process.platform] ?? ['xdg-open']
  spawn(bin, [...argv, url], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref()
}

async function dashboard() {
  if (!fs.existsSync(path.join(DASHBOARD, 'index.html'))) die(`the dashboard is not built (${DASHBOARD})`)
  const dir = searchDir(false), base = await findServer(), owner = claudePid()
  if (owner) await fetch(base + `__immo/owner?pid=${owner}`, { method: 'POST' }).catch(() => {})
  const url = dir ? `${base}${path.basename(dir)}/` : base
  console.log(`dashboard: ${url}`)
  if (opt.open) openUrl(url)
}

const commands = {
  doctor, setup: () => setup(...args), geocode: () => geocode(args.join(' ')), search: () => search(args.join(' ')), fetch: fetchListings, market, add, enrich, refresh,
  alert: () => alert(args[0]), usage: usageCmd, costs: () => costs(...args), show, list, dashboard, serve,
}
if (!commands[cmd]) die(`usage: immo.mjs <${Object.keys(commands).join(' | ')}> [-p <slug>]`)
await commands[cmd]()
