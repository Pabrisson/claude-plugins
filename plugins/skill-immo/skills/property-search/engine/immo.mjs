#!/usr/bin/env node
// property-search CLI and local dashboard server. The searches live in the folder Claude Code runs in ($IMMO_DIR
// overrides it): one folder per search (<slug>/: search.json, listings.json, market.json, area.json, feed.json, alerts.json), the buyer's
// profile (.profile.json), the measured API prices (.costs.json), the open data cache and the credits log (.cache/).
// Each search has a mode: stream-estate (listings, asking prices, free counts from the API v1) or classic (open data and
// assisted listings only, never a credit). Search commands take -p <slug>. Exit codes: 2 the user must agree first
// (cost), 3 no credits left (402, assisted mode), 4 a listing URL to read with WebFetch (the API has no lookup by URL).
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { alertsOf, cleanAlerts, firing, newsKey, takes as alertTakes } from './lib/alerts.js'
import { PROFILE, budget, rentOf, rentVsBuy } from './lib/budget.js'
import { estimate, gate, table, usage } from './lib/costs.js'
import { review, score, WEIGHTS } from './lib/decide.js'
import { recentDpe } from './lib/dpe.js'
import { building, median, summary } from './lib/dvf.js'
import { around, bbox, center, circle, corridor, distance, inGeometry, inZone } from './lib/geo.js'
import { addressQuery, fromInput, fromStreamEstate, merge, normUrl } from './lib/listings.js'
import { asking, badge, daysOnline, dropped, isHome, matches, negotiation, reference, takes, TYPES, typeOf, unitPrice } from './lib/market.js'
import { irisOdds } from './lib/odds.js'
import { openData } from './lib/opendata.js'
import { members, NoCredits, se } from './lib/stream.js'

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
const PROFILE_FILE = path.join(HOME, '.profile.json'), MEASURED = path.join(HOME, '.costs.json'), SETTINGS_FILE = path.join(HOME, '.settings.json')
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
.profile.json
.dashboard.log
.DS_Store
`
// what git must keep, to check against the .gitignore
const KEPT = ['s/search.json', 's/listings.json', 's/alerts.json', '.costs.json', '.cache/api-usage.json']
const CRITERIA = ['budget_min', 'budget_max', 'area_min', 'area_max', 'rooms_min', 'rooms_max', 'floor_min', 'land_min', 'dpe_max', 'elevator', 'outdoor']
const MESSAGE_KINDS = ['offer', 'question', 'visit', 'reply', 'follow_up', 'documents', 'other']
const CHANNELS = ['email', 'sms', 'phone', 'visit']
const LETTERS = 'ABCDEFG'
// the profile's numbers, the only fields the dashboard may write
const PROFILE_NUMBERS = ['down_payment', 'net_income_monthly', 'other_loans_monthly', 'rate', 'years', 'insurance_rate', 'notary_old', 'notary_new', 'eur_per_credit', 'monthly_credit_cap', 'max_fetch']
// The dashboard's settings (« Réglages », .settings.json, the folder's): the watch's period in minutes (0: off;
// IMMO_WATCH_HOURS sets its default), the API on or off, the automatic fetch and its credits a month, the desktop
// notifications (sound, quiet hours), a news read once opened, how many days of news the follow-up keeps (0: all)
const SETTINGS = {
  watch_minutes: process.env.IMMO_WATCH_HOURS != null ? +process.env.IMMO_WATCH_HOURS * 60 : 360, api: true, auto_fetch: false, auto_credits: 50,
  notify: true, sound: true, quiet: null, read_on_open: true, keep_days: 0,
}
const WATCH_MINUTES = [0, 30, 60, 360, 720, 1440], KEEP_DAYS = [0, 30, 90, 365]

const { values: opt, positionals: [cmd, ...args] } = parseArgs({
  allowPositionals: true,
  options: {
    project: { type: 'string', short: 'p' }, slug: { type: 'string' }, json: { type: 'boolean' },
    estimate: { type: 'boolean' }, spend: { type: 'string' }, force: { type: 'boolean' }, 'accept-unknown': { type: 'boolean' },
    mode: { type: 'string' }, zone: { type: 'string' }, radius: { type: 'string' }, type: { type: 'string' }, types: { type: 'string' }, criteria: { type: 'string' }, max: { type: 'string' },
    kind: { type: 'string' }, amount: { type: 'string' }, to: { type: 'string' }, text: { type: 'string' }, from: { type: 'string' }, channel: { type: 'string' }, date: { type: 'string' }, sent: { type: 'boolean' },
    url: { type: 'string' }, file: { type: 'string' }, source: { type: 'string' }, id: { type: 'string' }, all: { type: 'boolean' },
    open: { type: 'boolean' },
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
const settings = () => ({ ...SETTINGS, ...readJson(SETTINGS_FILE, {}) })
// the API may be called: the key is there and the user did not turn it off (« Réglages »)
const apiOn = () => hasKey() && settings().api !== false
const MODES = ['stream-estate', 'classic']
// the types of property of a search (flats, for one made before the types)
const typesOf = s => s.types ?? ['flat']
// a search may call Stream Estate: its mode allows it, the key is there and the API is on
const streamOn = s => s.mode !== 'classic' && apiOn()

// the searches of the folder, by slug
const searches = () => fs.readdirSync(HOME).filter(x => /^[a-z0-9][a-z0-9-]*$/.test(x) && fs.existsSync(path.join(HOME, x, 'search.json'))).sort()
function searchDir(required = true) {
  const p = opt.project ?? (fs.existsSync('search.json') ? '.' : null)
  if (!p) return required ? die('which search? pass -p <slug>') : null
  const dir = path.resolve(HOME, p)
  if (!fs.existsSync(path.join(dir, 'search.json'))) die(`no search ${p} in ${HOME}`)
  return dir
}
const version = dir => Math.max(...['search.json', 'listings.json', 'market.json', 'area.json', 'feed.json', 'alerts.json'].map(f => fs.statSync(path.join(dir, f), { throwIfNoEntry: false })?.mtimeMs ?? 0))
const load = dir => ({
  search: readJson(path.join(dir, 'search.json')), listings: readJson(path.join(dir, 'listings.json'), []),
  market: readJson(path.join(dir, 'market.json'), {}), area: readJson(path.join(dir, 'area.json'), {}),
})

// --- credits -------------------------------------------------------------------------------------------------

const usageLog = () => readJson(USAGE, [])
// what a Stream Estate call cost, in the log: the route's price for the items it returned (the v1 gives no figure)
const charged = slug => ({ route, results }) =>
  writeJson(USAGE, [...usageLog(), { date: now(), route, credits: estimate(route, { results }, readJson(MEASURED, {})), results, search: slug ?? null, ...(process.env.IMMO_BY ? { by: process.env.IMMO_BY } : {}) }])
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
  if (s.mode === 'classic') die(`${s.slug} is an OpenData search (classic: open data and assisted listings, no credit): switch it with search -p ${s.slug} --mode stream-estate`, 2)
  if (!hasKey()) assisted('Stream Estate is off (no key)')
  if (!apiOn()) assisted("the API is turned off in the dashboard's Réglages")
}
const withCredits = async fn => { try { return await fn() } catch (e) { if (e instanceof NoCredits) assisted(e.message); throw e } }

// --- Stream Estate queries ---------------------------------------------------------------------------------

// ponytail: an outline cut to `max` vertices (every k-th one), enough for a street band or an IRIS; a Douglas-Peucker
// if a zone ever looks off
const outline = (ring, max) => { const k = Math.ceil(ring.length / max); return [...ring.filter((_, i) => i % k === 0), ring[0]].map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]) }

// where, as v1 filters: around a point, in the commune (its INSEE code), else inside the zone's outline (60 vertices
// at most in all: the URL must stay under 9 kB)
function seWhere(s) {
  const z = s.zone
  if (z.kind === 'radius') return { lat: z.center[1], lon: z.center[0], radius: z.radius_m / 1000 }
  if (z.how === 'commune') return { includedInseeCodes: [s.insee] }
  const polygons = z.geometry.type === 'MultiPolygon' ? z.geometry.coordinates : [z.geometry.coordinates]
  return { geoShapes: polygons.map(p => outline(p[0], Math.floor(60 / polygons.length))) }
}

// the criteria of the type t as v1 filters
function seFilters(s, t) {
  const c = s.criteria ?? {}, on = k => takes(t, k)
  return {
    transactionType: 0, propertyTypes: TYPES[t], budgetMin: c.budget_min, budgetMax: c.budget_max,
    ...(on('area') ? { surfaceMin: c.area_min, surfaceMax: c.area_max } : {}),
    ...(on('rooms') ? { roomMin: c.rooms_min, roomMax: c.rooms_max } : {}),
    ...(on('land') ? { landSurfaceMin: c.land_min } : {}),
  }
}

// the criteria the v1 cannot filter on: matches() sorts them out once the listings are fetched (and paid)
const localOnly = s => ['floor_min', 'elevator', 'outdoor'].filter(k => s.criteria?.[k] != null && s.criteria[k] !== false)

// Online, for the v1: not expired and updated within 90 days. It never expires most of what left the portals: rue
// Paul Bert, 2026-10-28, 9 420 flats not expired, 7 007 of them not updated for a year; 1 299 updated within 90 days.
const ONLINE_DAYS = 90
const onlineSince = () => new Date(Date.now() - ONLINE_DAYS * 86400000).toISOString().slice(0, 10)

// The search as GET /documents/properties queries: one per type, each with the criteria it takes (a parking has no
// rooms), of what is online. `since`: what changed from that date, and what expired since (a second query per type);
// `exclude`: the properties already fetched.
// ponytail: 60 excluded ids at most (the URL's length); past that, a fetch may pay again for a known listing
function seQueries(s, { since, exclude = [] } = {}) {
  const c = s.criteria ?? {}, where = seWhere(s)
  const query = t => ({
    ...seFilters(s, t), ...where,
    energyCategories: takes(t, 'dpe') && c.dpe_max ? [...LETTERS.slice(0, LETTERS.indexOf(c.dpe_max) + 1)] : undefined,
    excludedProperties: exclude.length ? exclude.slice(-60) : undefined,
  })
  return typesOf(s).flatMap(t => since
    ? [{ ...query(t), expired: false, fromUpdatedAt: since }, { ...query(t), expired: true, fromExpiredAt: since }]
    : [{ ...query(t), expired: false, fromUpdatedAt: onlineSince() }])
}

// how many properties the queries match (itemsPerPage 0: no item returned, so no credit; the API counts up to
// 10 000). `quiet`: not logged (the dashboard server's watch counts every few hours)
async function seCount(slug, queries, { quiet = false } = {}) {
  const log = charged(slug)
  let total = 0
  for (const query of queries) total += (await se('GET', '/documents/properties', { query: { ...query, itemsPerPage: 0 }, charged: c => quiet || log(c) })).data?.['hydra:totalItems'] ?? 0
  return total
}

// up to `max` properties, the latest updated first, query after query, never one more than asked: a page holds 30 at
// most and starts at a multiple of its size, so the last few come in smaller pages
async function seFetch(slug, queries, max) {
  const out = []
  for (const query of queries) for (let at = 0; out.length < max; ) {
    const size = [30, 15, 10, 6, 5, 3, 2, 1].find(n => n <= max - out.length && at % n === 0)
    const got = members((await api(slug, 'GET', '/documents/properties', { query: { ...query, itemsPerPage: size, page: at / size + 1, 'order[updatedAt]': 'desc' } })).data)
    out.push(...got)
    at += got.length
    if (got.length < size) break
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
  console.log(hasKey() ? `stream-estate: ${apiOn() ? 'on (API v1: listings, asking prices)' : "off: turned off in the dashboard's Réglages (assisted mode)"}` : "stream-estate: off (assisted mode: listings from WebSearch, WebFetch or pasted text); the plugin's secret: /plugin configure skill-immo@pabrisson")
  // a count returns no item, so it is free: it checks the key
  const key = hasKey() ? await se('GET', '/documents/properties', { query: { itemsPerPage: 0, transactionType: 0 } }).then(() => '; key accepted', e => `; the key fails: ${e.message}`) : ''
  console.log(`credits: ${u.last30} in the last 30 days (${euros(u.last30, p.eur_per_credit)}), ${u.month} this month of the ${p.monthly_credit_cap} cap${u.unknown ? `, ${u.unknown} calls of unknown cost` : ''}${key}`)
  if (hasKey()) { const a = accountOf(); console.log(a ? `account: about ${euros(a.left, 1)} left (${fmt(a.left_items)} items): ${euros(a.deposited, 1)} deposited, ${fmt(a.items)} items on the console on ${a.at.slice(0, 10)}, ${fmt(a.since)} since in the log` : "account: unknown (the API does not give it; Stream Estate's console shows the € deposited and « API items returned »)") }
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

// --types flat,house: the types of property of a search
function parseTypes(v) {
  const ts = [...new Set(v.split(/[\s,]+/).filter(Boolean))]
  if (!ts.length || ts.some(t => !(t in TYPES))) die(`--types takes ${Object.keys(TYPES).join(', ')} (comma separated)`)
  return ts
}

// the points of a street: its sales (DVF) and its numbers (the national address base), within 3 km of its point
async function streetPoints(s) {
  const [{ sales }, numbers] = await Promise.all([od.dvf(s.insee), od.geocode(`${s.street.name} ${s.city}`, { type: 'housenumber', limit: 50 })])
  const prefix = `${s.insee}_${s.street.code_voie}_`
  return [s.point, ...sales.filter(x => x.code_voie === s.street.code_voie && x.point).map(x => x.point), ...numbers.filter(f => f.properties.id.startsWith(prefix)).map(f => f.geometry.coordinates)]
    .filter(p => distance(p, s.point) <= 3000)
}

// The zone of a search, a polygon: along a street (300 m on each side by default), a circle around an address (500 m),
// the outline of the commune (or arrondissement), or of the IRIS around the point.
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
  die('--zone is radius, commune or iris')
}

const ARRONDISSEMENT = /^(751\d\d|6938\d|132\d\d)$/
// the recent DPE of a search for Claude: how many, how many no listing matches (homes about to go on sale, or to let),
// how many of those are new since the area.json before (`before`: the numbers it held)
function dpeLine(rows, listings, before) {
  if (!Array.isArray(rows)) return rows?.error ? `recent DPE: failed (${rows.error})` : null
  const open = recentDpe(rows, listings).flatMap(a => a.items).filter(d => !d.listing), fresh = before && open.filter(d => !before.has(d.number)).length
  return `recent DPE (12 months): ${rows.length}, ${open.length} without a listing${before ? `, ${fresh} new since the last refresh` : ''}`
}
const dpeNumbers = dir => { const r = readJson(path.join(dir, 'area.json'), {}).dpe_recent; return Array.isArray(r) ? new Set(r.map(d => d.number)) : null }

// The news of a search (<slug>/feed.json), newest first: a recent DPE of the zone that no listing matches and the
// area.json before did not hold (a home about to go on sale?), Stream Estate listings to fetch. The listings' own
// changes (new, drops, expiries) stay in listings.json; both are unread until `read_at`. The search's alerts
// (lib/alerts.js) pick those that show: the default one on DPE keeps those of its types and criteria.
const feedOf = dir => readJson(path.join(dir, 'feed.json'), { read_at: null, stream: null, items: [] })
function addNews(dir, items, extra) {
  if (!items.length && !extra) return
  const f = feedOf(dir)
  // ponytail: the last 500 news kept, older ones dropped; an archive if anyone scrolls that far
  writeJson(path.join(dir, 'feed.json'), { ...f, ...extra, items: [...items, ...f.items].slice(0, 500) })
}
const dpeNews = (rows, listings, before) => recentDpe(rows, listings).flatMap(a => a.items)
  .filter(d => !d.listing && !before.has(d.number)).map(({ listing, ...dpe }) => ({ date: now(), kind: 'dpe', dpe }))
const alertsAt = dir => alertsOf(readJson(path.join(dir, 'alerts.json'), {}))
// every news of a search: the feed's, and the listings' changes with their listing, those of the last `keep_days`
const newsOf = dir => {
  const k = settings().keep_days, since = k ? new Date(Date.now() - k * 86400000).toISOString() : ''
  return [...feedOf(dir).items, ...listingsOf(dir).flatMap(l => (l.changes ?? []).map(c => ({ ...c, l })))].filter(n => n.date >= since)
}
// a news is read once marked so, all of them up to `read_at` or one by one (`read`, their keys)
const isRead = (f, n) => n.date <= (f.read_at ?? '') || !!f.read?.includes(newsKey(n))
// the news an alert that is on takes, not read yet
const unread = dir => {
  const f = feedOf(dir), s = readJson(path.join(dir, 'search.json')), alerts = alertsAt(dir)
  return newsOf(dir).filter(n => !isRead(f, n) && firing(alerts, n, s).length).length
}
// The DPE at the places of the search's alerts, outside its zone (lib/alerts.js): an alert's first look notes what
// is there; the next ones bring what is new, no listing of the zone, not already in the news, and that an alert takes.
// What each alert saw stays in .cache/alerts/<slug>/ (cleared with the cache: the next look notes again).
async function placeNews(dir, s, days) {
  const alerts = alertsAt(dir).filter(a => a.enabled && a.event === 'dpe' && a.place && a.place.how !== 'zone'), news = []
  const zone = dpeNumbers(dir) ?? new Set(), known = new Set(feedOf(dir).items.filter(n => n.outside).map(n => n.dpe.number))
  for (const a of alerts) {
    const rows = await od.placeDpe(a.place, days), f = path.join(CACHE, 'alerts', s.slug, `${a.id}.json`), seen = readJson(f, null)
    if (seen) for (const dpe of rows) {
      const n = { date: now(), kind: 'dpe', dpe, outside: true }
      if (!seen.includes(dpe.number) && !zone.has(dpe.number) && !known.has(dpe.number) && alertTakes(a, n, s)) { news.push(n); known.add(dpe.number) }
    }
    writeJson(f, rows.map(d => d.number))
  }
  return news
}
// the user's own alerts that news fired, for Claude to say: alerts: « DPE rue Paul Bert » 2
function alertLine(dir, s, news) {
  const n = {}, mine = alertsAt(dir).filter(a => !a.builtin)
  for (const x of news) for (const a of firing(mine, x, s)) n[a.name] = (n[a.name] ?? 0) + 1
  return Object.keys(n).length ? `alerts: ${Object.entries(n).map(([k, v]) => `« ${k} » ${v}`).join(', ')}` : null
}
const pool = async (items, n, fn) => { const out = [], it = items.entries(); await Promise.all(Array.from({ length: n }, async () => { for (const [i, x] of it) out[i] = await fn(x) })); return out }

// the free market and neighborhood data of a search: DVF sales, shops and services, travel times to the user's
// places, crime, income and risks at its center, the DPE of the last 12 months in the zone (for a search of homes)
async function freeData(dir, s) {
  const zoneOf = p => inZone(p, s.zone)
  const since = new Date(Date.now() - 2 * 365 * 86400000).toISOString().slice(0, 10)
  const dvf = od.dvf(s.insee), rent = od.rent(s.insee).catch(e => ({ error: e.message })), c = center(s.zone), places = profile().places ?? []
  const settle = p => p.then(v => v, e => ({ error: e.message }))
  // the commune's context: the DPE of the zone (around its center for a radius or along a street, else the
  // commune's), the property tax rate, the homes authorised to be built
  const dpeAt = s.zone.how === 'radius' && s.zone.radius_m ? { point: c, radius: s.zone.radius_m } : { insee: s.insee }
  const context = Promise.all([settle(od.dpeClasses(dpeAt)), settle(od.tax(s.insee)), settle(od.housing(s.insee))])
  const areaParts = Promise.all([
    settle(od.overpass(bbox(s.zone, 600))), settle(od.georisques(c)), settle(od.crime(s.insee, s.dep)),
    settle(od.income(`${ARRONDISSEMENT.test(s.insee) ? 'ARM' : 'COM'}-${s.insee}`)), settle(od.income(`DEP-${s.dep}`)), settle(od.income('FRANCE-FM')),
    settle(od.irisAt(c)),
    settle(pool(places.flatMap(pl => [['pedestrian', 15], ['pedestrian', 30], ['car', 20]].map(([pr, m]) => ({ pl, pr, m }))), 3,
      async ({ pl, pr, m }) => ({ place: pl.label, profile: pr, minutes: m, geometry: await od.isochrone(pl.point, pr, m) }))),
    typesOf(s).some(isHome) ? settle(od.recentDpe(bbox(s.zone)).then(rows => rows.filter(d => zoneOf(d.point)))) : [],
  ])
  const d = await dvf
  const byType = Object.fromEntries(typesOf(s).map(t => [t, summary(d.sales.filter(x => x.type === t), { inZone: zoneOf, code_voie: s.street?.code_voie, since, center: c })]))
  const [dpe, tax, housing] = await context
  const market = {
    ...readJson(path.join(dir, 'market.json'), {}), updated: now(), alsace_moselle: d.alsace_moselle, dvf: d.sales.length ? byType : null, rent: await rent,
    context: { dpe: dpe.error ? dpe : { scope: dpeAt.insee ? 'commune' : 'zone', ...dpe }, tax, housing },
  }
  writeJson(path.join(dir, 'market.json'), market)
  const [pois, risks, crime, local, department, france, iris, isochrones, dpe_recent] = await areaParts
  const area = { updated: now(), center: c, pois, risks, crime, income: { local, department, france }, iris: iris && !iris.error ? { code: iris.code, name: iris.name } : null, isochrones, places, dpe_recent }
  writeJson(path.join(dir, 'area.json'), area)
  return { market, area }
}

// The odds of a box of the map [w, s, e, n] (the dashboard's « Prospection »): its IRIS with their census, DVF sales
// and odds, its communes, its DPE of the last 12 months. Free open data, each source kept in .cache/ per IRIS or
// commune: a map moved back comes at once. A source that fails leaves its part empty and is named.
async function oddsOf(bb) {
  const iris = await od.irisIn(bb), failed = []
  const settle = (p, what) => p.catch(e => { failed.push(`${what} (${e.message.slice(0, 80)})`); return null })
  const [censusOf, communes] = await Promise.all([
    settle(od.irisCensus(iris.map(i => i.code)), 'recensement INSEE'),
    Promise.all([...new Map(iris.map(i => [i.insee, i.commune]))].map(async ([insee, name]) => {
      const [dvf, dpe] = await Promise.all([settle(od.dvf(insee, 3), `DVF ${name}`), settle(od.communeDpe(insee), `DPE ${name}`)])
      return { insee, name, dvf, dpe }
    })),
  ])
  // the last three whole years DVF has
  const year = new Date().getFullYear(), years = [...new Set(communes.flatMap(c => c.dvf?.years ?? []))].filter(y => +y < year).sort().slice(-3)
  const inBox = ([x, y]) => x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3]
  return {
    bbox: bb, years, failed,
    iris: irisOdds(iris, censusOf ?? {}, Object.fromEntries(communes.map(c => [c.insee, c.dvf && !c.dvf.alsace_moselle ? c.dvf.sales : null])), years),
    communes: communes.map(c => ({ insee: c.insee, name: c.name, alsace_moselle: !!c.dvf?.alsace_moselle })),
    dpe: communes.flatMap(c => (c.dpe ?? []).filter(d => inBox(d.point))),
  }
}

// search "<address | street | neighborhood>" [--zone …] [--radius m] [--criteria …]: a new search, or -p
// <slug> to change one (zone, criteria) and refresh its free data
async function search(query) {
  let dir = opt.project ? searchDir() : null, s = dir ? readJson(path.join(dir, 'search.json')) : null
  if (!s) {
    if (!query) die('usage: search "<address, street or neighborhood>" [--zone radius|commune|iris] [--radius m] [--criteria "k=v …"]')
    const [f] = await od.geocode(query, { type: opt.type, limit: 1 })
    if (!f) die(`no place found for "${query}": try geocode "${query}" and a more precise query`)
    const x = f.properties, slug = (() => { const b = slugify(opt.slug ?? x.label); let sl = b; for (let i = 2; fs.existsSync(path.join(HOME, sl)); i++) sl = `${b}-${i}`; return sl })()
    const [, voie] = x.id.split('_')
    s = {
      slug, query, label: x.label, created: now(), type: x.type, point: f.geometry.coordinates, insee: x.citycode, city: x.city, district: x.district ?? null,
      postcode: x.postcode, dep: x.depcode ?? x.citycode.slice(0, 2), street: x.street && voie ? { name: x.street, code_voie: voie } : null, ban: x.id,
      types: ['flat'], criteria: {}, stream: null, last_fetch: null, last_refresh: null, last_visit: null,
    }
    dir = path.join(HOME, slug)
  }
  // OpenData is the classic mode's name for the user
  if (opt.mode === 'opendata') opt.mode = 'classic'
  if (opt.mode && !MODES.includes(opt.mode)) die('--mode is stream-estate or classic (OpenData)')
  s.mode = opt.mode ?? s.mode ?? (hasKey() ? 'stream-estate' : 'classic')
  if (opt.types) s.types = parseTypes(opt.types)
  if (opt.criteria) parseCriteria(opt.criteria, s.criteria)
  if (!s.zone || opt.zone || opt.radius) s.zone = await makeZone(s)
  writeJson(path.join(dir, 'search.json'), s)
  writeGitignore()
  console.log(`search ${s.slug} [${s.mode}] ${typesOf(s).join(', ')}: ${s.zone.label} (${s.label}, insee ${s.insee})`)
  const { market, area } = await freeData(dir, s)
  if (market.alsace_moselle) console.log('DVF: none for the Bas-Rhin, Haut-Rhin and Moselle (their land register is not in DVF)')
  for (const [t, m] of Object.entries(market.dvf ?? {})) {
    const unit = t === 'parking' ? '€ a lot' : t === 'land' ? '€/m² of land' : '€/m²'
    console.log(m.commune.count ? `DVF ${t}, sold ${unit} (median): zone ${fmt(m.zone.median_ppm2)} (${m.zone.count} sales), ${m.street ? `street ${fmt(m.street.median_ppm2)} (${m.street.count}), ` : ''}commune ${fmt(m.commune.median_ppm2)} (${m.commune.count}) over ${m.years.join(', ')}` : `DVF ${t}: no sale found`)
  }
  const r = market.rent
  if (r?.flat || r?.house) console.log(`rent (carte des loyers ${r.year}, €/m² a month, charges included): flats ${r.flat?.per_m2 ?? '—'}, houses ${r.house?.per_m2 ?? '—'}`)
  const { tax, housing } = market.context
  if (tax && !tax.error) console.log(`property tax ${tax.year}: ${tax.total} % in ${tax.city} (France ${tax.france} %)${housing?.years?.length ? `; homes authorised ${housing.years.at(-1).year}: ${housing.years.at(-1).authorised}` : ''}`)
  const failed = Object.entries({ shops: area.pois, risks: area.risks, crime: area.crime, ...market.context }).filter(([, v]) => v?.error).map(([k, v]) => `${k} (${v.error})`)
  console.log(`neighborhood: ${Array.isArray(area.pois) ? area.pois.length : 0} places nearby, ${(area.isochrones?.length ?? 0)} travel areas${failed.length ? `; failed: ${failed.join(', ')}` : ''}`)
  const dl = dpeLine(area.dpe_recent, listingsOf(dir))
  if (dl) console.log(dl)
  if (streamOn(s)) {
    const total = await withCredits(() => seCount(s.slug, seQueries(s, { exclude: listingsOf(dir).map(l => l.se_id).filter(Boolean) })))
    s.stream = { total, counted_at: now() }
    writeJson(path.join(dir, 'search.json'), s)
    const p = profile(), n = Math.min(total, p.max_fetch), local = localOnly(s)
    console.log(`Stream Estate: ${total} new listings match, ${n} would be fetched for ${n} credits (${euros(n, p.eur_per_credit)}); ${Math.max(0, p.monthly_credit_cap - usage(usageLog()).month)} left of the monthly cap.${local.length ? ` The API does not filter on ${local.join(', ')}: the count includes listings they rule out.` : ''} Ask the user, then fetch -p ${s.slug} --spend ${n}`)
  } else console.log(`${s.mode === 'classic' ? 'OpenData search' : hasKey() ? "Stream Estate: turned off in the dashboard's Réglages" : 'Stream Estate: off (no key)'}: assisted listings (WebSearch, WebFetch, pasted text, then add)`)
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
// sales of the same building
async function enrichOne(l, s, sales) {
  const b = { ...(l.building ?? {}) }, precise = l.location.accuracy === 'PRECISE' || (l.source !== 'stream-estate' && l.location.address)
  const point = l.location.point, label = precise ? l.location.address : null
  if (!point) return l
  const [f] = label ? await od.geocode(addressQuery(label, l.location), { type: 'housenumber', limit: 1 }) : []
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
    sales: ban && number ? building(sales.filter(x => x.type === typeOf(l)), +number, voie).slice(0, 20) : [],
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
  const known = listingsOf(dir).map(l => l.se_id).filter(Boolean), queries = seQueries(s, { exclude: known })
  const total = await withCredits(() => seCount(s.slug, queries)), n = Math.min(total, +(opt.max ?? profile().max_fetch))
  if (!n) return console.log('Stream Estate: no new listing matches')
  approve('GET /documents/properties', n, `fetch ${n} of ${total} listings`)
  const raw = await withCredits(() => seFetch(s.slug, queries, Math.min(n, +opt.spend || n)))
  const changes = saveMerged(dir, raw.map(fromStreamEstate))
  Object.assign(s, { last_fetch: now(), last_refresh: s.last_refresh ?? now(), stream: { total: total - raw.length, counted_at: now() } })
  writeJson(path.join(dir, 'search.json'), s)
  const enriched = await autoEnrich(dir, s, changes)
  console.log(`fetched ${raw.length} listings: ${describe(changes)}; ${enriched} with building data (enrich -p ${s.slug} --all for the rest)`)
}

// market -p <slug> [--accept-unknown]: the asking price per m² of the zone's listings (median, and month by month
// over two years)
async function market() {
  const dir = searchDir(), s = readJson(path.join(dir, 'search.json'))
  requireStream(s)
  approve('GET /indicators/price_per_meter', estimate('GET /indicators/price_per_meter', {}, readJson(MEASURED, {})), 'asking prices')
  // ponytail: the search's first type only (a median mixing types means nothing); one call per type when a search
  // really needs several
  const main = typesOf(s)[0], from = new Date(Date.now() - 730 * 86400000).toISOString().slice(0, 10)
  const r = (await withCredits(() => api(s.slug, 'GET', '/indicators/price_per_meter', { query: { transactionType: 0, propertyTypes: TYPES[main], ...seWhere(s), fromDate: from, aggregationInterval: 'month' } }))).data
  const x = members(r)[0] ?? {}, out = { ...readJson(path.join(dir, 'market.json'), {}), stream: { updated: now(), type: main, median: x.median ?? null, average: x.average ?? null, series: x.series ?? {} } }
  writeJson(path.join(dir, 'market.json'), out)
  const last = Object.entries(out.stream.series).at(-1)
  console.log(`asking €/m² (${main}, listings of the last two years): median ${fmt(x.median)}, average ${fmt(x.average)}${last ? `; ${last[0]}: ${fmt(last[1])}` : ''}`)
}

// add -p <slug> --url <listing> | --file <listing.json> [--source websearch|pasted]
async function add() {
  const dir = searchDir(), s = readJson(path.join(dir, 'search.json'))
  if (opt.url) {
    const known = byUrl(dir, opt.url)
    if (known) return console.log(`already in the search: ${known.id}`)
    // the API v1 has no lookup by URL: a fetch finds the listing later, and merges it with this one by its URL
    die(`read ${opt.url} with WebFetch, then add -p ${s.slug} --file listing.json`, 4)
  }
  if (!opt.file) die('usage: add -p <slug> --url <listing url> | --file <listing.json> (listing-format.md)')
  const raw = readJson(opt.file === '-' ? 0 : opt.file), items = [raw].flat(), source = opt.source === 'pasted' ? 'pasted' : 'websearch'
  const { ls, changes } = await addListings(dir, s, items, source)
  console.log(`added ${ls.length} listing${ls.length > 1 ? 's' : ''}: ${describe(changes)}`)
}

// Listings Claude read or the user typed: placed (an address without a point), merged, given their building data. A
// failed enrichment leaves them added (enrich takes them later).
async function addListings(dir, s, items, source) {
  const ls = await Promise.all(items.map(async x => {
    // an address without a point: the national address base places it
    if (!x.point && x.address) {
      const [f] = await od.geocode(`${x.address} ${x.city ?? s.city}`, { limit: 1 })
      if (f) Object.assign(x, { point: f.geometry.coordinates, insee: x.insee ?? f.properties.citycode, postcode: x.postcode ?? f.properties.postcode, city: x.city ?? f.properties.city })
    }
    return fromInput(x, source)
  }))
  const changes = saveMerged(dir, ls)
  await autoEnrich(dir, s, changes).catch(e => console.error(`enrich: ${e.message}`))
  return { ls, changes }
}
const byUrl = (dir, url) => listingsOf(dir).find(l => l.urls.some(u => normUrl(u.url) === normUrl(url)))

// A listing the user typed in the dashboard: the fields of add --file, checked at the door. Its link is shown as a
// link, so http(s) only.
function manualInput(x) {
  if (!(+x.price > 0 && +x.area > 0)) throw new Error('price and area are required')
  if (x.type != null && !Object.hasOwn(TYPES, x.type)) throw new Error('bad type')
  if (x.url != null && !/^https?:\/\/\S+$/i.test(x.url)) throw new Error('bad url')
  if (x.point != null && !(Array.isArray(x.point) && x.point.length === 2 && x.point.every(Number.isFinite))) throw new Error('bad point')
  return { ...x, pictures: [] }
}

// enrich -p <slug> --id <id> | --all
async function enrich() {
  const dir = searchDir(), s = readJson(path.join(dir, 'search.json')), ls = listingsOf(dir)
  const ids = opt.id ? opt.id.split(',') : opt.all ? ls.filter(l => l.location.point).map(l => l.id) : die('usage: enrich -p <slug> --id <id[,id…]> | --all')
  console.log(`building data for ${await enrichAll(dir, s, ids)} of ${ids.length} listings`)
}

// refresh -p <slug> [--spend n]: what changed since the last refresh — new listings, price drops, offers, expiries
async function refresh() {
  const dir = searchDir(), s = readJson(path.join(dir, 'search.json')), before = dpeNumbers(dir)
  const { area } = await freeData(dir, s)
  // the DPE line, the new DPE of the zone and of the alerts' places as news, then the user's alerts those and the
  // listings' changes fired
  const dpe = async (changes = []) => {
    const l = dpeLine(area.dpe_recent, listingsOf(dir), before), ls = listingsOf(dir)
    if (l) console.log(l)
    const news = [...before && Array.isArray(area.dpe_recent) ? dpeNews(area.dpe_recent, ls, before) : [], ...await placeNews(dir, s, 1).catch(() => [])]
    addNews(dir, news)
    const a = alertLine(dir, s, [...news, ...changes.map(c => ({ ...c, l: ls.find(x => x.id === c.id) }))])
    if (a) console.log(a)
  }
  // a listing typed or pasted without a link has no page to check
  const assistedCount = listingsOf(dir).filter(l => l.source !== 'stream-estate' && l.urls.length && l.status !== 'EXPIRED').length
  if (!streamOn(s) || !s.last_refresh) {
    console.log(`free data refreshed. ${streamOn(s) ? `No Stream Estate fetch yet: fetch -p ${s.slug}` : s.mode === 'classic' ? 'OpenData search' : 'Stream Estate is off'}${assistedCount ? `; ${assistedCount} assisted listings: check each with WebFetch (one page), then add --file to update price or status` : ''}`)
    return await dpe()
  }
  const queries = seQueries(s, { since: s.last_refresh }), total = await withCredits(() => seCount(s.slug, queries)), n = Math.min(total, +(opt.max ?? profile().max_fetch))
  if (n) approve('GET /documents/properties', n, `refresh ${n} changed listings`)
  const raw = n ? await withCredits(() => seFetch(s.slug, queries, n)) : []
  const changes = saveMerged(dir, raw.map(fromStreamEstate))
  s.last_refresh = now()
  writeJson(path.join(dir, 'search.json'), s)
  await autoEnrich(dir, s, changes)
  console.log(`refresh: ${raw.length} changed since the last one: ${describe(changes)}`)
  for (const c of changes.filter(c => c.kind !== 'new')) console.log(`  ${c.id} ${c.kind}: ${c.from} → ${c.to}`)
  await dpe(changes)
}

// alerts -p <slug> [--file <alerts.json>]: the search's alerts (lib/alerts.js), each with how many news it took;
// --file replaces them, checked as the dashboard's are
function alertsCmd() {
  const dir = searchDir(), s = readJson(path.join(dir, 'search.json'))
  if (opt.file) try { writeJson(path.join(dir, 'alerts.json'), cleanAlerts(readJson(opt.file === '-' ? 0 : opt.file))) } catch (e) { die(e.message) }
  const news = newsOf(dir)
  console.log(JSON.stringify(readJson(path.join(dir, 'alerts.json'), {})))
  for (const a of alertsAt(dir)) console.log(`${a.enabled ? 'on ' : 'off'} ${a.builtin ? 'default' : 'custom'} ${a.id}${a.name ? ` « ${a.name} »` : ''}: ${a.event}${a.place && a.place.how !== 'zone' ? ` at ${a.place.label}` : ''}, ${news.filter(n => alertTakes(a, n, s)).length} news`)
}

// alert delete -p <slug>: deletes the Stream Estate saved searches skill-immo 1.6 and before made (they pushed to
// ntfy.sh). The alerts are the dashboard's now, fed by the server's free counts.
async function alert(sub) {
  const dir = searchDir(), s = readJson(path.join(dir, 'search.json'))
  if (sub !== 'delete') die(`the alerts are the dashboard's now: alerts -p ${s.slug}. alert delete -p ${s.slug} deletes an old Stream Estate alert`)
  if (!s.alert?.searches?.length) return console.log(`no Stream Estate alert on ${s.slug}`)
  if (!hasKey()) die('deleting the Stream Estate alert needs the key')
  approve('DELETE /searches/{id}', estimate('DELETE /searches/{id}', { calls: s.alert.searches.length }, readJson(MEASURED, {})), 'delete the alert')
  for (const a of s.alert.searches) await api(s.slug, 'DELETE', `/searches/${a.id}`)
  s.alert = null
  writeJson(path.join(dir, 'search.json'), s)
  console.log('the Stream Estate alert is deleted: its pushes stop')
}

// usage: the credits spent, per month, search and route
async function usageCmd() {
  const p = profile(), log = usageLog(), u = usage(log)
  if (opt.json) return console.log(JSON.stringify({ ...u, cap: p.monthly_credit_cap, eur_per_credit: p.eur_per_credit }))
  console.log(`this month: ${u.month} credits (${euros(u.month, p.eur_per_credit)}) of the ${p.monthly_credit_cap} cap; last 30 days: ${u.last30}${u.unknown ? `; ${u.unknown} calls of unknown cost` : ''}`)
  for (const [k, v] of Object.entries(u.by_search)) console.log(`  search ${k}: ${v.credits} credits, ${v.calls} calls`)
  for (const [k, v] of Object.entries(u.by_route)) console.log(`  ${k}: ${v.credits} credits, ${v.calls} calls`)
}

// The account, as Stream Estate's console shows it: the euros deposited (pay as you go) and « API items returned », the
// items billed since the account opened (0.01 € each). The API v1 gives neither (checked 2026-10-29: /me, /users/me,
// /account answer 404, no header). The items the log counted since the console was read come on top. (A `balance` in
// credits, of the first 1.8 builds, reads as that many credits deposited.)
function accountOf() {
  const p = profile(), a = p.account ?? (p.balance && { deposited: p.balance.credits * p.eur_per_credit, items: 0, at: p.balance.at })
  if (!a) return null
  const since = usageLog().filter(e => e.date >= a.at).reduce((n, e) => n + (e.credits ?? 0), 0), used = a.items + since
  const left = Math.round((a.deposited - used * p.eur_per_credit) * 100) / 100
  return { deposited: a.deposited, items: a.items, at: a.at, topups: a.topups ?? [], since, used, left, left_items: Math.max(0, Math.floor(left / p.eur_per_credit + 1e-9)) }
}
// the account changed: money added (`topup` €), or the console's figures (`deposited` €, `items`: then as of now)
function setAccount(x) {
  const pr = readJson(PROFILE_FILE, {}), a = accountOf() ?? { deposited: 0, items: 0, at: now(), topups: [] }, ok = k => x[k] != null && x[k] !== '' && Number.isFinite(+x[k]) && +x[k] >= 0
  const next = { deposited: a.deposited, items: a.items, at: a.at, topups: a.topups }
  if (ok('topup') && +x.topup > 0) Object.assign(next, { deposited: Math.round((next.deposited + +x.topup) * 100) / 100, topups: [...next.topups, { date: now(), eur: +x.topup }].slice(-50) })
  if (ok('deposited')) next.deposited = +x.deposited
  if (ok('items')) Object.assign(next, { items: Math.round(+x.items), at: now() })
  delete pr.balance
  writeJson(PROFILE_FILE, { ...pr, account: next })
  return accountOf()
}

// costs | costs set "<route>=<credits>" | costs topup <€> | costs account <€ deposited> <items>: the price of each route
// (one of unknown cost is read off Stream Estate's console after a first call, then set here), money the user added
// to the account, the console's figures
async function costs(sub, ...rest) {
  const m = readJson(MEASURED, {})
  if (sub === 'topup' || sub === 'account') {
    const x = sub === 'topup' ? { topup: rest[0] } : { deposited: rest[0], items: rest[1] }
    if (Object.values(x).some(v => !(v !== undefined && Number.isFinite(+v) && +v >= 0))) die('usage: costs topup <€ added> | costs account <€ deposited> <API items returned>')
    // a top-up on an account never set would read as the whole balance
    if (sub === 'topup' && !accountOf()) die("the account is unknown: costs account <€ deposited> <API items returned> first, the figures of Stream Estate's console")
    const a = setAccount(x)
    return console.log(`account: about ${euros(a.left, 1)} left (${fmt(a.left_items)} items), ${euros(a.deposited, 1)} deposited; the dashboard's « Coûts API » follows it`)
  }
  if (sub === 'set') {
    for (const x of rest) { const i = x.lastIndexOf('='); if (!(x.slice(0, i) in table())) die(`unknown route ${x.slice(0, i)}`); m[x.slice(0, i)] = +x.slice(i + 1) }
    writeJson(MEASURED, m)
  }
  for (const [route, c] of Object.entries(table(m))) console.log(`${route}: ${c.credits == null ? 'unknown' : `${c.credits}${c.per ? ' per item' : ''}`}${c.note ? ` (${c.note})` : ''}`)
}

// show -p <slug> [--id <id[,id…]>]: what Claude needs to analyse or compare listings, computed as the dashboard does
function show() {
  const dir = searchDir(), { search: s, listings, market: m, area } = load(dir), p = profile()
  const ids = opt.id?.split(',')
  const ls = ids ? ids.map(id => listings.find(l => l.id === id) ?? die(`no listing ${id} in ${s.slug}`)) : listings.filter(l => l.status !== 'EXPIRED')
  const pois = Array.isArray(area.pois) ? area.pois : [], isochrones = area.isochrones ?? []
  const out = ls.map(l => {
    const t = typeOf(l), ref = reference(m, t), ctx = { ref, pois, isochrones, profile: p, criteria: s.criteria }
    return {
    id: l.id, source: l.source, type: t, title: l.title, url: l.urls.find(u => u.url)?.url ?? null, portals: l.urls.map(u => u.source),
    price: l.price, area: l.area, land_area: l.land_area ?? null, price_per_m2: l.price_per_m2, rooms: l.rooms, floor: l.floor, dpe: l.dpe?.energy, status: l.status,
    matches: matches(l, s.criteria, typesOf(s)), my_status: l.my_status, favorite: !!l.favorite, notes: l.notes, messages: (l.messages ?? []).toSorted((a, b) => a.date.localeCompare(b.date)), address: l.location.address,
    market: { reference: ref, badge: badge(unitPrice(l), ref?.ppm2), street_ppm2: m.dvf?.[t]?.street?.median_ppm2 ?? null, asking_ppm2: asking(m, t) },
    negotiation: negotiation(l, ref?.ppm2), days_online: daysOnline(l), dropped: Math.round(dropped(l) * 1000) / 1000, urgent: l.urgent, favorites: l.favorites,
    review: review(l, ctx), score: score(l, ctx),
    budget: budget(l, p), rent: rentVsBuy(l, rentOf(l, m.rent), p),
    building: l.building ? { dpe_registry: l.building.dpe_match ? l.building.dpe.find(d => d.number === l.building.dpe_match) : null, construction_year: l.building.construction_year, copro: l.building.copro, risks: l.building.risks, building_sales: l.building.sales?.length ?? 0 } : null,
    nearby: l.location.point && Array.isArray(area.pois) ? around(l.location.point, area.pois) : null,
    travel: l.location.point ? (area.isochrones ?? []).filter(i => i.geometry && inGeometry(l.location.point, i.geometry)).map(i => `${i.place}: ≤ ${i.minutes} min ${i.profile === 'car' ? 'en voiture' : 'à pied'}`) : [],
    changes: l.changes ?? [],
    }
  })
  console.log(JSON.stringify(ids?.length === 1 ? out[0] : out, null, 2))
}

// A message of a listing's conversation with the agent or the seller: one the user sends (from: me, a draft until
// sent_at; Claude writes them) or one received (from: them: a reply pasted, a call summed up). Its text is kept as given.
function newMessage(l, { from = 'me', kind = 'other', channel = null, amount = null, to, text, date, sent = false }) {
  if (!['me', 'them'].includes(from)) throw new Error('from is me or them')
  if (!MESSAGE_KINDS.includes(kind)) throw new Error(`kind is ${MESSAGE_KINDS.join(', ')}`)
  if (channel != null && !CHANNELS.includes(channel)) throw new Error(`channel is ${CHANNELS.join(', ')}`)
  if (amount != null && !(+amount > 0)) throw new Error('amount is a price in €')
  const body = String(text ?? '').trim().slice(0, 10000), at = date ? new Date(date) : new Date()
  if (!body) throw new Error('the message is empty')
  if (Number.isNaN(at.getTime())) throw new Error('date is an ISO date: 2026-10-27 or 2026-10-27T18:30')
  return {
    id: `m-${randomBytes(4).toString('hex')}`, date: at.toISOString(), from, kind, channel, amount: amount != null ? +amount : null,
    to: to ?? l.publishers?.[0]?.name ?? null, text: body, sent_at: from === 'me' && sent ? at.toISOString() : null,
  }
}
// an offer sent puts the listing in "Offre faite"
const afterSent = (l, m) => { if (m.sent_at && m.kind === 'offer') l.my_status = 'offer' }

// message -p <slug> --id <id> [--from me|them] [--kind …] [--channel …] [--amount €] [--to <who>] [--date <iso>]
// [--sent] --file <text> | --text "…": a message added to the listing's conversation, shown in its dossier
function message() {
  const dir = searchDir(), f = path.join(dir, 'listings.json'), ls = listingsOf(dir), l = ls.find(x => x.id === opt.id)
  if (!l) die(`usage: message -p <slug> --id <listing id> [--from me|them] [--kind ${MESSAGE_KINDS.join('|')}] [--channel ${CHANNELS.join('|')}] [--amount €] [--to <who>] [--date <iso>] [--sent] --file <text file> | --text "…"`)
  const text = opt.file ? fs.readFileSync(opt.file === '-' ? 0 : opt.file, 'utf8') : opt.text
  let m
  try { m = newMessage(l, { from: opt.from, kind: opt.kind, channel: opt.channel, amount: opt.amount, to: opt.to, text, date: opt.date, sent: opt.sent }) } catch (e) { die(e.message) }
  l.messages = [...(l.messages ?? []), m]
  afterSent(l, m)
  writeJson(f, ls)
  const state = m.from === 'them' ? 'received' : m.sent_at ? 'sent' : 'draft'
  console.log(`message ${m.id} (${m.kind}, ${state}${m.amount ? `, ${fmt(m.amount)} €` : ''}) added to the conversation of ${l.id}: the dossier shows it`)
}

function list() {
  for (const x of searches()) {
    const { search: s, listings: ls } = load(path.join(HOME, x))
    console.log(`${x} [${s.mode ?? 'classic'}] ${typesOf(s).join(', ')}: ${s.zone?.label ?? s.label}, ${ls.length} listings (${ls.filter(l => l.status !== 'EXPIRED').length} online), created ${s.created.slice(0, 10)}`)
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
  search: ['query', 'mode', 'types', 'criteria', 'zone', 'radius', 'max'], fetch: ['spend', 'max'], market: [], refresh: ['spend'], enrich: ['id', 'all'],
  usage: [],
}
function runArgs(body) {
  const keys = RUN[body.cmd]
  if (!keys) throw new Error(`cannot run ${body.cmd}`)
  const a = body.args ?? {}, argv = [SELF, body.cmd]
  if (body.cmd === 'search' && a.query && !body.slug) argv.push(String(a.query))
  if (body.slug) { if (!/^[a-z0-9][a-z0-9-]*$/.test(body.slug)) throw new Error('bad slug'); argv.push('-p', body.slug) }
  for (const k of keys) if (k !== 'query' && a[k] != null && a[k] !== false) argv.push(`--${k}`, ...(a[k] === true ? [] : [String(a[k])]))
  if (body.estimate) argv.push('--estimate')
  if (body.accept_unknown) argv.push('--accept-unknown')
  return argv
}
const runEngine = (argv, env = {}) => new Promise(ok => {
  const p = spawn(process.execPath, argv, { cwd: HOME, env: { ...process.env, IMMO_DIR: HOME, ...env } })
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
    const pr = profile(), log = usageLog(), u = usage(log)
    // the credits a day over the last 60 days (all, and the automatic fetch's), a month (the automatic fetch's), and
    // per use: listings fetched, free counts, asking prices, an old alert deleted
    const since = new Date(Date.now() - 60 * 86400000).toISOString(), daily = {}, daily_auto = {}, monthly_auto = {}, by_use = {}
    const useOf = e => (e.route === 'GET /documents/properties' ? (e.results ? 'fetched' : 'counts') : e.route === 'GET /indicators/price_per_meter' ? 'asking' : e.route.startsWith('DELETE /searches') ? 'alert' : 'other')
    for (const e of log) {
      const d = e.date.slice(0, 10), c = e.credits ?? 0, add = (o, k) => { o[k] = (o[k] ?? 0) + c }
      if (e.date >= since) { add(daily, d); if (e.by === 'auto') add(daily_auto, d) }
      if (e.by === 'auto') add(monthly_auto, d.slice(0, 7))
      const x = by_use[useOf(e)] ??= { calls: 0, credits: 0, unknown: 0 }
      x.calls++
      x.credits += c
      if (e.credits == null) x.unknown++
    }
    // what each search has to fetch, from the latest counts: the new listings, the fetched ones changed since its refresh
    const pending = searches().map(x => {
      const d = path.join(HOME, x), s = readJson(path.join(d, 'search.json')), f = feedOf(d)
      const last = [s.stream, f.stream].filter(Boolean).sort((a, b) => b.counted_at.localeCompare(a.counted_at))[0]
      return { slug: x, label: s.label, on: streamOn(s), added: last?.total ?? 0, changed: f.changed?.since === s.last_refresh ? f.changed.total : 0 }
    })
    return reply(res, 200, {
      home: HOME, stream_estate: apiOn(), has_key: hasKey(), settings: settings(), watch: { last: lastWatch, next: nextWatch, running: !!watching },
      costs: table(readJson(MEASURED, {})), usage: { ...u, cap: pr.monthly_credit_cap, eur_per_credit: pr.eur_per_credit, max_fetch: pr.max_fetch, account: accountOf(), daily, daily_auto, monthly_auto, by_use }, pending, log: log.slice(-300),
    })
  }
  if (p === '/api/settings' && post) {
    let st
    try { st = cleanSettings(await readBody(req)) } catch (e) { return reply(res, 400, { error: e.message }) }
    writeJson(SETTINGS_FILE, st)
    schedule()
    return reply(res, 200, settings())
  }
  // the watch now, free: back once it is done
  if (p === '/api/watch' && post) { await watchAll(); return reply(res, 200, { last: lastWatch, next: nextWatch }) }
  // the open data cache: its size, and emptied (the credits log stays)
  if (p === '/api/cache') {
    if (req.method === 'DELETE') { for (const f of fs.readdirSync(CACHE)) if (f !== 'api-usage.json') fs.rmSync(path.join(CACHE, f), { recursive: true, force: true }) }
    const files = fs.existsSync(CACHE) ? fs.readdirSync(CACHE, { recursive: true, withFileTypes: true }).filter(e => e.isFile() && e.name !== 'api-usage.json') : []
    return reply(res, 200, { files: files.length, bytes: files.reduce((a, e) => a + fs.statSync(path.join(e.parentPath, e.name)).size, 0) })
  }
  // an alert's place from the address autocomplete: a street (its BAN id), a commune (its code), an address (a circle)
  if (p === '/api/place') {
    const how = url.searchParams.get('how'), q = url.searchParams.get('q') ?? ''
    if (!['street', 'commune', 'radius'].includes(how) || q.length < 3) return reply(res, 400, { error: 'expects ?how=street|commune|radius&q=' })
    const [f] = await od.geocode(q, { type: { street: 'street', commune: 'municipality' }[how], limit: 1 }).catch(() => [])
    if (!f) return reply(res, 404, { error: 'not found' })
    const x = f.properties, base = { how, label: how === 'commune' ? `${x.city ?? x.label} (${x.citycode})` : x.label, point: f.geometry.coordinates }
    return reply(res, 200, how === 'street' ? { ...base, ban: x.id } : how === 'commune' ? { ...base, insee: x.citycode } : { ...base, radius_m: +(url.searchParams.get('radius') ?? 300) })
  }
  if (p === '/api/searches') return reply(res, 200, searches().map(x => { const { search: s, listings: ls } = load(path.join(HOME, x)); return { slug: x, label: s.label, mode: s.mode ?? 'classic', types: typesOf(s), zone: s.zone?.label, created: s.created, listings: ls.length, online: ls.filter(l => l.status !== 'EXPIRED').length } }))
  if (p === '/api/profile') {
    if (!post) return reply(res, 200, profile())
    const body = await readBody(req), pr = readJson(PROFILE_FILE, {})
    for (const k of PROFILE_NUMBERS) if (body[k] != null && Number.isFinite(+body[k])) pr[k] = +body[k]
    // the account changed (`account_set`: money added, the console's figures), apart from the profile the pages send back
    const change = body.account_set && typeof body.account_set === 'object' ? body.account_set : null
    // the score's priorities: 0 to 3 for each of its parts
    if (body.weights) pr.weights = Object.fromEntries(Object.keys(WEIGHTS).map(k => [k, Math.max(0, Math.min(3, Math.round(+body.weights[k])))]).filter(([, v]) => Number.isFinite(v)))
    writeJson(PROFILE_FILE, pr)
    if (change) setAccount(change)
    return reply(res, 200, profile())
  }
  if (p === '/api/autocomplete') return reply(res, 200, await od.completion(url.searchParams.get('q') ?? '').catch(() => []))
  // a box of the map at zoom 14 or closer: about 0.15° by 0.1° on a large screen
  if (p === '/api/odds') {
    const bb = (url.searchParams.get('bbox') ?? '').split(',').map(Number)
    if (bb.length !== 4 || !bb.every(Number.isFinite) || bb[0] >= bb[2] || bb[1] >= bb[3]) return reply(res, 400, { error: 'expects ?bbox=w,s,e,n' })
    if (bb[2] - bb[0] > 0.3 || bb[3] - bb[1] > 0.2) return reply(res, 400, { error: 'zoom' })
    try { return reply(res, 200, await oddsOf(bb)) } catch (e) { return reply(res, 502, { error: e.message }) }
  }
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
    // the search's version: its files' latest change, taken before reading them, so that what Claude writes
    // meanwhile still shows as new to the page (it asks /version every few seconds)
    if (sub === '/version') return reply(res, 200, { version: version(dir), unread: unread(dir) })
    if (!sub && req.method === 'DELETE') {
      // a search with an old Stream Estate alert keeps it: it would go on pushing, with no search left to delete it
      if (readJson(path.join(dir, 'search.json')).alert?.searches?.length) return reply(res, 409, { error: 'alert' })
      fs.rmSync(dir, { recursive: true, force: true })
      return reply(res, 200, {})
    }
    if (!sub) { const v = version(dir); return reply(res, 200, { ...load(dir), alerts: readJson(path.join(dir, 'alerts.json'), {}), feed: feedOf(dir), unread: unread(dir), version: v }) }
    // the search's alerts: the default ones turned off, the user's own (lib/alerts.js)
    if (sub === '/alerts' && post) {
      let a
      try { a = cleanAlerts(await readBody(req)) } catch (e) { return reply(res, 400, { error: e.message }) }
      writeJson(path.join(dir, 'alerts.json'), a)
      // a new place: its first look now, so that what comes after is news
      placeNews(dir, readJson(path.join(dir, 'search.json')), 1).then(n => addNews(dir, n), e => console.log(`alerts ${m[1]}: ${e.message}`))
      return reply(res, 200, a)
    }
    // what an alert at a place would have taken among the DPE of its last 12 months (free, kept a day)
    if (sub === '/alerts/preview' && post) {
      let a
      try { [a] = cleanAlerts({ custom: [await readBody(req)] }).custom } catch (e) { return reply(res, 400, { error: e.message }) }
      if (a.place.how === 'zone') return reply(res, 400, { error: 'the zone is previewed from the news' })
      const s = readJson(path.join(dir, 'search.json'))
      try {
        const hits = (await od.placeDpe(a.place, 1)).filter(dpe => alertTakes(a, { kind: 'dpe', dpe, outside: true }, s))
        return reply(res, 200, { count: hits.length, items: hits.slice(0, 5) })
      } catch (e) { return reply(res, 502, { error: e.message }) }
    }
    // read: all of them, or some (their keys, 2 000 kept)
    if (sub === '/feed/read' && post) {
      const f = feedOf(dir), body = await readBody(req)
      const next = Array.isArray(body.keys) ? { ...f, read: [...new Set([...(f.read ?? []), ...body.keys.map(String)])].slice(-2000) } : { ...f, read_at: now(), read: [] }
      writeJson(path.join(dir, 'feed.json'), next)
      return reply(res, 200, {})
    }
    if (sub === '/visit' && post) {
      const f = path.join(dir, 'search.json'), s = readJson(f), before = s.last_visit
      s.last_visit = now()
      writeJson(f, s)
      return reply(res, 200, { last_visit: before })
    }
    // a listing the user typed: added as add --file does (free), refused when its link is already in the search
    if (sub === '/listings' && post) {
      let x
      try { x = manualInput(await readBody(req)) } catch (e) { return reply(res, 400, { error: e.message }) }
      const known = x.url && byUrl(dir, x.url)
      if (known) return reply(res, 409, { error: 'known', id: known.id })
      const { ls: [n] } = await addListings(dir, readJson(path.join(dir, 'search.json')), [x], 'manual')
      return reply(res, 200, listingsOf(dir).find(l => l.id === n.id))
    }
    const lm = sub.match(/^\/listings\/([\w-]+)$/)
    if (lm && post) {
      const body = await readBody(req), f = path.join(dir, 'listings.json'), ls = readJson(f, []), l = ls.find(x => x.id === lm[1])
      if (!l) return reply(res, 404, { error: 'no such listing' })
      if ('my_status' in body) { if (![null, 'to_visit', 'visited', 'offer', 'dropped'].includes(body.my_status)) return reply(res, 400, { error: 'bad status' }); l.my_status = body.my_status }
      if (typeof body.notes === 'string') l.notes = body.notes.slice(0, 5000)
      if (typeof body.favorite === 'boolean') l.favorite = body.favorite
      // the conversation: a message the user adds (a reply received, a call), one marked sent or not, one deleted
      if (body.message?.add) {
        try { l.messages = [...(l.messages ?? []), newMessage(l, body.message.add)] } catch (e) { return reply(res, 400, { error: e.message }) }
        afterSent(l, l.messages.at(-1))
      } else if (body.message?.id) {
        const msg = (l.messages ?? []).find(x => x.id === body.message.id)
        if (!msg) return reply(res, 404, { error: 'no such message' })
        if (body.message.delete) l.messages = l.messages.filter(x => x !== msg)
        else if (msg.from !== 'them') { msg.sent_at = body.message.sent ? now() : null; afterSent(l, msg) }
      }
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
    .listen(PORT, '127.0.0.1', () => {
      console.log(`dashboard server on http://127.0.0.1:${PORT}/ for ${HOME}`)
      if (settings().watch_minutes > 0) watchAll()
    })
}

// The watch of a search, free: the zone's recent DPE (downloaded again once 90 % of the watch's period has gone, so
// that a server restarted meanwhile reads its cache) and, in Stream Estate mode, the counts of the listings not
// fetched yet and of those fetched that changed since the last refresh. What is new goes to feed.json, and area.json
// takes the DPE for the map.
async function watch(dir) {
  const s = readJson(path.join(dir, 'search.json')), before = dpeNumbers(dir), news = [], extra = {}, api = {}, days = settings().watch_minutes / 1440 * 0.9
  if (before && typesOf(s).some(isHome)) {
    const rows = (await od.recentDpe(bbox(s.zone), days)).filter(d => inZone(d.point, s.zone))
    news.push(...dpeNews(rows, listingsOf(dir), before))
    const f = path.join(dir, 'area.json')
    if (rows.length !== before.size || rows.some(d => !before.has(d.number))) writeJson(f, { ...readJson(f, {}), dpe_recent: rows })
  }
  news.push(...await placeNews(dir, s, days))
  // the API's counts are no news: « Suivi » shows them in its bar, to fetch; they grow the notification
  if (streamOn(s)) {
    const known = listingsOf(dir).map(l => l.se_id).filter(Boolean), count = q => seCount(s.slug, q, { quiet: true })
    const total = await count(seQueries(s, { exclude: known }))
    // the latest count: the search's (search, fetch) or the watch's
    const last = [s.stream, feedOf(dir).stream].filter(Boolean).sort((a, b) => b.counted_at.localeCompare(a.counted_at))[0]
    if (total > (last?.total ?? 0)) api.added = total - (last?.total ?? 0)
    if (total !== last?.total) extra.stream = { total, counted_at: now() }
    // the fetched ones that changed on the portals since the last refresh (price, status, expiry, text): what the
    // refresh's queries match, less the same without them. Counted again from 0 after each refresh.
    // ponytail: the last 60 fetched only (the URL's length), a search with more undercounts
    const since = s.last_refresh
    if (since && known.length) {
      const changed = await count(seQueries(s, { since })) - await count(seQueries(s, { since, exclude: known }))
      const was = feedOf(dir).changed, prev = was?.since === since ? was.total : 0
      if (changed > prev) api.changed = changed - prev
      if (changed !== prev || was?.since !== since) extra.changed = { since, total: changed, counted_at: now() }
    }
  }
  addNews(dir, news, Object.keys(extra).length ? extra : undefined)
  return { s, news, api }
}

// The automatic fetch (« Réglages », off by default: the user's standing yes): when the counts grew, the refresh (or
// the first fetch) of what they found, within what is left of its credits this month, of the monthly cap and of the
// most a fetch takes. Its news come back for the notification.
// ponytail: one refresh a watch, so a listing past the fetch's most waits for « Récupérer »
async function autoFetch(dir, s, api) {
  const st = settings(), f = feedOf(dir)
  if (!st.auto_fetch || !streamOn(s) || !(api.added || api.changed)) return []
  const month = now().slice(0, 7), spent = usageLog().filter(e => e.by === 'auto' && e.date.startsWith(month)).reduce((a, e) => a + (e.credits ?? 0), 0)
  const n = Math.min((f.stream?.total ?? 0) + (f.changed?.total ?? 0), st.auto_credits - spent, profile().max_fetch)
  if (n <= 0) return []
  const before = new Set(newsOf(dir).map(newsKey))
  const r = await runEngine([SELF, s.last_refresh ? 'refresh' : 'fetch', '-p', s.slug, '--spend', `${n}`, '--max', `${n}`], { IMMO_BY: 'auto' })
  console.log(`auto ${s.slug}: ${r.code ? r.err.split('\n').at(-1) : r.out.split('\n').filter(l => /^(refresh|fetched)/.test(l)).join('; ')}`)
  return newsOf(dir).filter(x => !before.has(newsKey(x)))
}

// Every search's watch, then the next one after the settings' period; one desktop notification per search with news
// its alerts take (naming the user's own) or listings the API has. A watch asked while one runs waits for it.
let watching = null, timer = null, lastWatch = null, nextWatch = null
function watchAll() {
  watching ??= (async () => {
    for (const x of searches()) {
      try {
        const dir = path.join(HOME, x), { s, news: found, api } = await watch(dir), auto = await autoFetch(dir, s, api), alerts = alertsAt(dir)
        const fired = [...found, ...auto].map(n => firing(alerts, n, s)), news = [...found, ...auto].filter((_, i) => fired[i].length)
        const d = news.filter(n => n.kind === 'dpe').length, l = news.length - d, mine = [...new Set(fired.flat().filter(a => !a.builtin).map(a => `« ${a.name} »`))]
        const pl = (k, one, many = `${one}s`) => `${k} ${k > 1 ? many : one}`
        const text = [d && `${pl(d, 'nouveau', 'nouveaux')} DPE sans annonce`, l && pl(l, "nouveauté d'annonce", "nouveautés d'annonces"),
          !auto.length && api.added && `${pl(api.added, 'annonce')} à récupérer sur l'API`, !auto.length && api.changed && `${pl(api.changed, 'annonce suivie modifiée', 'annonces suivies modifiées')}`,
          mine.length && `${pl(mine.length, 'alerte')} ${mine.join(', ')}`].filter(Boolean).join(', ')
        if (!text) continue
        console.log(`watch ${x}: ${text}`)
        notify(`Immo · ${s.label}`, text, `http://127.0.0.1:${PORT}/${x}/`)
      } catch (e) { console.log(`watch ${x}: ${e.message}`) }
    }
  })().finally(() => { watching = null; lastWatch = now(); schedule() })
  return watching
}
// the next watch, from the last one (or now) and the settings' period; none when it is off
function schedule() {
  clearTimeout(timer)
  const m = settings().watch_minutes
  nextWatch = m > 0 ? new Date(Date.parse(lastWatch ?? now()) + m * 60000).toISOString() : null
  if (nextWatch) timer = setTimeout(watchAll, Math.max(0, Date.parse(nextWatch) - Date.now()))
}

// the settings the dashboard sends, checked at the door
function cleanSettings(b) {
  const st = settings(), bool = k => { if (b[k] != null) st[k] = b[k] === true }
  if (b.watch_minutes != null) { if (!WATCH_MINUTES.includes(+b.watch_minutes)) throw new Error('bad watch_minutes'); st.watch_minutes = +b.watch_minutes }
  if (b.keep_days != null) { if (!KEEP_DAYS.includes(+b.keep_days)) throw new Error('bad keep_days'); st.keep_days = +b.keep_days }
  if (b.auto_credits != null) { if (!(Number.isInteger(+b.auto_credits) && +b.auto_credits >= 0)) throw new Error('bad auto_credits'); st.auto_credits = +b.auto_credits }
  if (b.quiet !== undefined) {
    const ok = b.quiet === null || (Array.isArray(b.quiet) && b.quiet.length === 2 && b.quiet.every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)))
    if (!ok) throw new Error('quiet is null or ["22:00", "08:00"]')
    st.quiet = b.quiet
  }
  for (const k of ['api', 'auto_fetch', 'notify', 'sound', 'read_on_open']) bool(k)
  return st
}
// within the quiet hours [from, to] of the settings, across midnight when from > to
const quietNow = ([from, to], d = new Date()) => {
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return from <= to ? t >= from && t < to : t >= from || t < to
}

// Windows PowerShell 5.1 toast (as hook-notify): the XML comes from an env var so nothing needs quoting
const PS_TOAST = '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null;'
  + '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null;'
  + '$x = New-Object Windows.Data.Xml.Dom.XmlDocument; $x.LoadXml($env:IMMO_TOAST);'
  + "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))"
// A desktop notification, never fatal: on macOS terminal-notifier (a click opens the dashboard) else osascript, on
// Linux notify-send, on Windows a toast. IMMO_NOTIFY=0 turns them off (the tests).
function notify(title, message, url) {
  const st = settings()
  if (process.env.IMMO_NOTIFY === '0' || !st.notify || (st.quiet && quietNow(st.quiet))) return
  const xml = t => t.replace(/[<>&"]/g, c => `&#${c.charCodeAt(0)};`)
  const env = { ...process.env, IMMO_TOAST: `<toast><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(message)}</text></binding></visual></toast>` }
  const tries = {
    darwin: [['terminal-notifier', '-title', title, '-message', message, '-open', url, ...(st.sound ? ['-sound', 'default'] : [])],
      ['osascript', '-e', 'on run argv', '-e', `display notification (item 2 of argv) with title (item 1 of argv)${st.sound ? ' sound name "default"' : ''}`, '-e', 'end run', title, message]],
    win32: [['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', PS_TOAST]],
  }[process.platform] ?? [['notify-send', title, message]]
  const next = ([[bin, ...argv] = [], ...rest]) => bin && spawn(bin, argv, { env, stdio: 'ignore', windowsHide: true }).on('error', () => next(rest)).unref()
  next(tries)
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
  alert: () => alert(args[0]), alerts: alertsCmd, usage: usageCmd, costs: () => costs(...args), show, message, list, dashboard, serve,
}
if (!commands[cmd]) die(`usage: immo.mjs <${Object.keys(commands).join(' | ')}> [-p <slug>]`)
await commands[cmd]()
