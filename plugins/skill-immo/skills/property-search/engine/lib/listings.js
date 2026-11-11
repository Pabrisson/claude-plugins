// listings.json: one format whatever the source (references/search-files.md). A property of Stream Estate (its v1
// PropertyDocument, with one advert per portal) or a listing the agent read (WebSearch, WebFetch, pasted text) becomes
// the same object; a refresh merges the new state into the old one and says what changed.
import { createHash } from 'node:crypto'
import { TYPES } from './market.js'

const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 12)
const ppm2 = (price, area) => (price > 0 && area > 0 ? Math.round(price / area) : null)
// the earliest of ISO dates
const first = ds => ds.filter(Boolean).sort()[0] ?? null
const seType = t => Object.keys(TYPES).find(k => TYPES[k].includes(t)) ?? 'flat'

// what the address base is asked for a listing's address: with its postcode and town when it has no postcode (alone,
// « 11 Rue de l'Etang » of Louveciennes is found in Versailles)
export const addressQuery = (address, loc) => (/\b\d{5}\b/.test(address) ? address : [address, loc.postcode, loc.city].filter(Boolean).join(' '))

// the same listing whatever the tracking parameters, the fragment or a trailing slash
export function normUrl(u) {
  try {
    const x = new URL(u)
    return `${x.hostname.replace(/^www\./, '').toLowerCase()}${x.pathname.replace(/\/+$/, '')}`
  } catch { return null }
}

// The advertisers behind a property's adverts (an advert's publisher is the portal): one per phone number, else
// email, else name, the most complete contact kept; those with neither phone nor email only when no other has one.
function publishersOf(ads) {
  const filled = c => [c.name, c.phone, c.email].filter(Boolean).length, byKey = new Map()
  const contacts = ads.map(a => ({ ...a.contact, type: a.publisher?.type })).filter(filled).toSorted((a, b) => filled(b) - filled(a))
  for (const c of contacts) {
    const k = c.phone?.replace(/\D/g, '').slice(-9) || c.email || c.name.toLowerCase()
    if (!byKey.has(k)) byKey.set(k, c)
  }
  const all = [...byKey.values()], reach = all.filter(c => c.phone || c.email)
  return (reach.length ? reach : all).map(c => ({
    type: { 0: 'PRIVATE_INDIVIDUAL', 1: 'REAL_ESTATE_AGENCY' }[c.type] ?? null, name: c.name ?? null, card: null, website: null,
    phone: c.phone ?? null, email: c.email ?? null, profile_url: null, mandate: null,
  }))
}

// An advert gone from its portal: expired, found gone by the link check (linkGone), or not crawled by Stream Estate for
// 30 days when the property was read (`readAt`). The v1 never expires most of what leaves the portals: on 2026-11-02,
// Louveciennes, every advert not crawled for 50 days or more answered 410 or « not found », those crawled within 14
// days 200.
export const STALE_DAYS = 30
// (a crawl after the link check found it gone brings it back)
const t = d => (d ? Date.parse(d) : 0)
export const deadAd = (u, readAt) => !!(u.expired_at || (u.gone_at && t(u.last_seen_at) < t(u.gone_at)) || (u.last_seen_at && readAt && t(readAt) - t(u.last_seen_at) > STALE_DAYS * 86400000))
// a listing all of whose adverts are gone (one without a link stays as it is); read when it was first seen, for one
// fetched before skill-immo 1.20
export const allGone = l => l.urls.length > 0 && l.urls.every(u => deadAd(u, l.read_at ?? l.first_seen))

// The photos of a property: the whole gallery of its best advert still online (the most photos, the latest crawled),
// on the portal's own servers (`picturesRemote`: 10 to 20 photos where Stream Estate's copies hold 1 to 5; a gone
// advert's answer 404); the property's copies by Stream Estate (`pictures`, they stay) when no advert has more, else
// kept aside for when the portal's are gone. The adverts' own copies are left out: the same photos again, taken at
// each crawl of each portal.
function photosOf(d, live) {
  const copies = [...new Set(d.pictures ?? [])]
  const best = live.toSorted((a, b) => (b.picturesRemote?.length ?? 0) - (a.picturesRemote?.length ?? 0) || (b.lastCrawledAt ?? '').localeCompare(a.lastCrawledAt ?? ''))[0]
  const gallery = [...new Set(best?.picturesRemote ?? [])]
  return gallery.length > copies.length ? { pictures: gallery, se_pictures: copies } : { pictures: copies, se_pictures: [] }
}

const UA = 'skill-immo/1.20 (+https://github.com/Pabrisson/claude-plugins)'
// Is a listing's page gone from its portal? true: 404, 410, or a redirect to a « not found » page; false: it answers;
// null: unknown (blocked: Leboncoin, SeLoger, Le Figaro and PAP answer 403; 429; no answer)
// ponytail: a portal that sends a gone listing to a search page with a 200 (ParuVendu, once) reads as online
export async function linkGone(url, { timeout = 12000 } = {}) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': UA, Accept: 'text/html' } })
    await res.body?.cancel()
    if (res.status === 404 || res.status === 410) return true
    return res.ok ? res.redirected && /not.?found|introuvable|expir|supprim/i.test(res.url) : null
  } catch { return null }
}

// `at`: when Stream Estate gave the document (the dead adverts are read against it)
export function fromStreamEstate(d, at = new Date().toISOString()) {
  // the adverts still online first: what a field says now
  const ads = d.adverts ?? [], now = [...ads.filter(a => !a.expired), ...ads.filter(a => a.expired)]
  const pick = k => now.map(a => a[k]).find(x => x != null) ?? null
  // an amenity a portal lists among its features (free text): true, else unknown, never false
  const has = re => ads.some(a => a.features?.some(f => re.test(f))) || null
  const price = d.price ?? null, area = d.surface ?? null, type = seType(d.propertyType), land = d.landSurface ?? pick('landSurface')
  // the rating most portals give (one of them often mistypes it)
  const most = k => [...Map.groupBy(now.filter(a => a[k]?.category), a => a[k].category).values()].sort((x, y) => y.length - x.length)[0]?.[0][k] ?? null
  const floor = d.floor ?? null, floors = pick('floorQuantity'), energy = most('energy'), ghg = most('greenHouseGas')
  const fees = pick('feesPercentage'), paidBy = pick('feesResponsibility'), accuracy = Math.min(...ads.map(a => a.geoAccuracy ?? 9))
  const seen = new Set(), changes = ads.flatMap(a => a.events ?? []).filter(e => e.fieldName === 'price' && e.fieldNewValue != null)
  const urls = ads.map(a => ({ url: a.url ?? null, source: a.publisher?.name ?? null, published_at: a.createdAt ?? null, expired_at: a.expiredAt ?? (a.expired ? at : null), last_seen_at: a.lastCrawledAt ?? null, favorites: null, urgent: false }))
  const live = ads.filter((_, i) => !deadAd(urls[i], at))
  return {
    id: d.uuid, se_id: d.uuid, se_created_at: d.createdAt ?? null, read_at: at, source: 'stream-estate', property_type: type,
    urls,
    title: d.title ?? null, description: d.description ?? null,
    price, net_price: pick('priceExcludingFees'), area, carrez: null, land_area: land,
    price_per_m2: ppm2(price, type === 'land' ? land ?? area : area),
    rooms: d.room ?? null, bedrooms: d.bedroom ?? null, floor, floors,
    last_floor: type === 'flat' && floor != null && floors ? floor === floors : null, ground_floor: floor === 0 || null,
    dpe: { energy: energy?.category ?? null, energy_value: energy?.value ?? null, ghg: ghg?.category ?? null, date: pick('diagnosticDate'), reference: null },
    construction_year: pick('constructionYear'), lots: pick('lotCount'), construction_type: null, condition: null, legal_proceedings: null, new_build: null,
    features: {
      balcony: has(/balcon/i), terrace: has(/terrasse/i), garden: has(/jardin/i), cellar: has(/\bcave\b/i), parking: has(/parking|garage|\bbox\b/i),
      elevator: d.elevator ?? pick('elevator'), caretaker: has(/gardien|concierge/i), bike_room: has(/local (à )?vélo/i), fiber: has(/fibre/i), crossing: has(/traversant/i), quiet: null, orientation: [], heating: null,
    },
    outdoor_area: null,
    location: {
      point: d.location ? [d.location.lon, d.location.lat] : null, accuracy: { 1: 'PRECISE', 2: 'NEIGHBORHOOD' }[accuracy] ?? null, address: null,
      city: d.city?.name ?? null, insee: d.city?.insee ?? null, postcode: d.city?.zipcode ?? null, neighborhood: null, iris: null, city_id: d.city?.id ?? null,
    },
    fees: {
      agency: fees != null || paidBy != null ? { amount: null, percentage: fees, included: null, paid_by: { 0: 'SELLER', 1: 'BUYER' }[paidBy] ?? null } : null,
      condo_yearly: pick('condominiumFees') ? Math.round(pick('condominiumFees')) : null, property_tax: null,
    },
    status: d.expired || (ads.length && !live.length) ? 'EXPIRED' : 'AVAILABLE',
    publishers: publishersOf(ads),
    ...photosOf(d, live),
    published_at: first([d.createdAt, ...ads.map(a => a.createdAt)]), updated_at: d.updatedAt ?? null,
    urgent: false, favorites: null,
    // the portals' own price changes, oldest first, once each (the same drop shows on every portal)
    price_changes: changes.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(e => ({ date: e.createdAt, from: +e.fieldOldValue, to: +e.fieldNewValue, pct: e.percentVariation }))
      .filter(c => !seen.has(`${c.from}>${c.to}`) && seen.add(`${c.from}>${c.to}`)),
  }
}

// A listing the agent read, or the user typed in the dashboard (manual): the fields of listing-format.md, whatever it
// found. Its id is its URL's, else its text's.
export function fromInput(x, source) {
  const url = x.url ?? null, price = +x.price || null, area = +x.area || null, land = +x.land_area || null
  const key = (url && normUrl(url)) || x.text || JSON.stringify(x), type = x.type in TYPES ? x.type : 'flat'
  return {
    id: `${{ pasted: 'p', manual: 'm' }[source] ?? 'w'}-${hash(key)}`, se_id: null, source, property_type: type,
    urls: url ? [{ url, source: x.site ?? normUrl(url)?.split('.')[0] ?? null, published_at: x.published_at ?? null, expired_at: null, last_seen_at: null, favorites: null, urgent: !!x.urgent }] : [],
    title: x.title ?? null, description: x.description ?? x.text ?? null,
    price, net_price: null, area, carrez: null, land_area: land, price_per_m2: ppm2(price, type === 'land' ? land ?? area : area),
    rooms: +x.rooms || null, bedrooms: +x.bedrooms || null, floor: x.floor ?? null, floors: x.floors ?? null, last_floor: x.last_floor ?? null, ground_floor: x.floor === 0 || null,
    dpe: { energy: x.dpe ?? null, energy_value: x.dpe_value ?? null, ghg: x.ges ?? null, date: null, reference: null },
    construction_year: x.construction_year ?? null, lots: x.lots ?? null, construction_type: null, condition: x.condition ?? null, legal_proceedings: null, new_build: x.new_build ?? null,
    features: { balcony: x.balcony ?? null, terrace: x.terrace ?? null, garden: x.garden ?? null, cellar: x.cellar ?? null, parking: x.parking ?? null, elevator: x.elevator ?? null, caretaker: null, bike_room: null, fiber: null, crossing: null, quiet: null, orientation: [], heating: x.heating ?? null },
    outdoor_area: x.outdoor_area ?? null,
    location: { point: x.point ?? null, accuracy: x.point ? (x.address ? 'PRECISE' : 'STREET') : null, address: x.address ?? null, city: x.city ?? null, insee: x.insee ?? null, postcode: x.postcode ?? null, neighborhood: null, iris: null, city_id: null },
    fees: { agency: x.agency_fees != null ? { amount: +x.agency_fees, percentage: null, included: x.agency_fees_included ?? true, paid_by: 'BUYER' } : null, condo_yearly: x.condo_yearly ?? null, property_tax: x.property_tax ?? null },
    status: x.status ?? 'AVAILABLE',
    publishers: x.publisher ? [{ type: x.publisher_type ?? null, name: x.publisher, card: null, website: null, phone: x.phone ?? null, email: null, profile_url: null, mandate: null }] : [],
    pictures: x.pictures ?? [], published_at: x.published_at ?? null, updated_at: null, urgent: !!x.urgent, favorites: null, price_changes: [],
  }
}

// what the user keeps on a listing (their star, their labels, when they first opened it, the messages the agent wrote for it
// included), and what the engine adds, through every refresh
const KEPT = ['first_seen', 'price_history', 'my_status', 'favorite', 'labels', 'seen_at', 'notes', 'notes_history', 'messages', 'building', 'changes']

// Merges listings into the known ones (by id, else by URL) on day `now`. A listing seen again keeps the user's status,
// notes and history, and what the link check found of its adverts; a new price, status or expiry is logged in its
// `changes` and returned. `gone`: ids a complete listing of the zone no longer holds; they, and every listing all of
// whose adverts are gone (allGone), become EXPIRED.
export function merge(known, incoming, now, gone = []) {
  const all = known.map(l => ({ ...l })), byId = new Map(all.map(l => [l.id, l])), changes = []
  const byUrl = new Map(all.flatMap(l => l.urls.map(u => [normUrl(u.url), l])).filter(([k]) => k))
  const log = (l, kind, from, to) => { const c = { date: now, kind, from, to }; (l.changes ??= []).push(c); changes.push({ id: l.id, ...c }) }
  for (const n of incoming) {
    const old = byId.get(n.id) ?? n.urls.map(u => byUrl.get(normUrl(u.url))).find(Boolean)
    if (!old) {
      const l = { ...n, first_seen: now, price_history: n.price ? [{ date: now, price: n.price }] : [], my_status: null, notes: '', messages: [], changes: [] }
      log(l, 'new', null, n.price)
      all.push(l)
      byId.set(l.id, l)
      for (const u of l.urls) if (normUrl(u.url)) byUrl.set(normUrl(u.url), l)
      continue
    }
    const before = { price: old.price, status: old.status, urls: old.urls }
    // a Stream Estate property found for an assisted listing takes its place, and its id
    if (n.source === 'stream-estate' && old.source !== 'stream-estate') byId.delete(old.id)
    // what the agent did not read stays as it was
    // (a listing the user placed keeps their place: the source's new one waits in location_source, locate; a contact
    // they corrected, `by: 'hand'`, keeps the contacts as they are)
    const kept = k => KEPT.includes(k) || (k === 'publishers' && old.publishers?.some(p => p.by === 'hand'))
    for (const [k, v] of Object.entries(n)) if (!kept(k) && v != null && !(Array.isArray(v) && !v.length && old[k]?.length)) old[k === 'location' && old.location_source ? 'location_source' : k] = v
    const urls = new Map(before.urls.map(u => [normUrl(u.url) ?? u.source, u]))
    for (const u of n.urls) { const k = normUrl(u.url) ?? u.source; urls.set(k, { ...urls.get(k), ...u }) }
    old.urls = [...urls.values()]
    byId.set(old.id, old)
    if (n.price && before.price && n.price !== before.price) {
      old.price_history = [...(old.price_history ?? []), { date: now, price: n.price }]
      log(old, n.price < before.price ? 'price_drop' : 'price_rise', before.price, n.price)
    }
    if (old.status !== 'EXPIRED' && allGone(old)) old.status = 'EXPIRED'
    if (old.status !== before.status) log(old, old.status === 'EXPIRED' ? 'expired' : 'status', before.status, old.status)
  }
  for (const l of new Set(byId.values())) if (l.status !== 'EXPIRED' && (gone.includes(l.id) || allGone(l))) { log(l, 'expired', l.status, 'EXPIRED'); l.status = 'EXPIRED' }
  return { listings: [...new Set(byId.values())], changes }
}

// The listing's notes become `text`, the ones before kept in `notes_history` for the dossier's « Restaurer » ({ date,
// notes, by: user|agent|restore }, the last 30). None for a box ticked or unticked (a click undoes it), nor for the
// user's saves less than 5 minutes after their last one: the notes before their first save stay the ones kept.
export function setNotes(l, text, by, now = new Date().toISOString()) {
  const before = l.notes ?? '', h = l.notes_history ?? [], last = h.at(-1)
  if (text === before) return
  const again = by === 'user' && last?.by === 'user' && Date.parse(now) - Date.parse(last.date) < 5 * 60e3
  if (before.trim() && !again && !ticked(before, text)) l.notes_history = [...h, { date: now, notes: before, by }].slice(-30)
  l.notes = text
}
// The notes with what is left to ask last: every « À demander » part (a `##` or `###` heading so named, its lines up to the
// next heading) gathered into one, `## À demander`, at the end, in their order and once each; an entry left empty by it
// (its heading alone) goes. What the agent adds (`note`) thus lands before what is left to ask.
const HEADING = /^(#{1,6})[ \t]/, ASK = /^#{2,3}[ \t]+à demander[ \t]*:?[ \t]*$/iu
export function asksLast(text) {
  const body = [], asks = []
  let ask = false
  for (const line of text.split('\n')) {
    if (HEADING.test(line)) { ask = ASK.test(line.trim()); if (ask) continue }
    if (!ask) body.push(line)
    else if (line.trim() && !asks.includes(line)) asks.push(line)
  }
  const next = i => { let j = i + 1; while (j < body.length && !body[j].trim()) j++; return j }
  const kept = body.filter((line, i) => {
    const h = HEADING.exec(line), j = next(i), n = HEADING.exec(body[j] ?? '')
    return !h || (j < body.length && !(n && n[1].length <= h[1].length))
  })
  const rest = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return asks.length ? `${rest}\n\n## À demander\n${asks.join('\n')}` : rest
}

// the two texts differ by one box only, `[ ]` against `[x]`
function ticked(a, b) {
  if (a.length !== b.length) return false
  let i = 0
  while (a[i] === b[i]) i++
  return a[i - 1] === '[' && a[i + 1] === ']' && /[ xX]/.test(a[i]) && /[ xX]/.test(b[i]) && a.slice(i + 1) === b.slice(i + 1)
}

// The user's own place for a listing (the dashboard's « Préciser l'adresse »: by hand on the map, or found by an OSINT
// case on its photos, `immo.mjs locate`): `location` becomes it, so the map, the neighborhood and the building data use
// it, and the source's own place waits in `location_source` (a refresh writes there, merge). `at` is { point, address,
// postcode, city, insee, by: hand|osint, osint: { case, confidence, radius_m } }; null puts the source's place back.
export function locate(l, at, now) {
  const { location_source: src, ...rest } = l
  if (!at) return src ? { ...rest, location: src } : l
  const from = src ?? l.location, pick = k => at[k] ?? from[k] ?? null
  return {
    ...rest, location_source: from,
    location: { ...from, point: at.point, address: at.address || null, postcode: pick('postcode'), city: pick('city'), insee: pick('insee'), accuracy: 'PRECISE', by: at.by === 'osint' ? 'osint' : 'hand', at: now, osint: at.by === 'osint' ? at.osint ?? null : null },
  }
}
