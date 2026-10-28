// listings.json: one format whatever the source (references/listing-format.md). A property of Stream Estate (its v1
// PropertyDocument, with one advert per portal) or a listing Claude read (WebSearch, WebFetch, pasted text) becomes
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

export function fromStreamEstate(d) {
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
  return {
    id: d.uuid, se_id: d.uuid, source: 'stream-estate', property_type: type,
    urls: ads.map(a => ({ url: a.url ?? null, source: a.publisher?.name ?? null, published_at: a.createdAt ?? null, expired_at: a.expiredAt ?? null, last_seen_at: a.lastCrawledAt ?? null, favorites: null, urgent: false })),
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
    status: d.expired ? 'EXPIRED' : 'AVAILABLE',
    publishers: publishersOf(ads),
    pictures: (d.pictures ?? []).slice(0, 12),
    published_at: first([d.createdAt, ...ads.map(a => a.createdAt)]), updated_at: d.updatedAt ?? null,
    urgent: false, favorites: null,
    // the portals' own price changes, oldest first, once each (the same drop shows on every portal)
    price_changes: changes.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(e => ({ date: e.createdAt, from: +e.fieldOldValue, to: +e.fieldNewValue, pct: e.percentVariation }))
      .filter(c => !seen.has(`${c.from}>${c.to}`) && seen.add(`${c.from}>${c.to}`)),
  }
}

// A listing Claude read: the fields of listing-format.md, whatever it found. Its id is its URL's, else its text's.
export function fromInput(x, source) {
  const url = x.url ?? null, price = +x.price || null, area = +x.area || null, land = +x.land_area || null
  const key = (url && normUrl(url)) || x.text || JSON.stringify(x), type = x.type in TYPES ? x.type : 'flat'
  return {
    id: `${source === 'pasted' ? 'p' : 'w'}-${hash(key)}`, se_id: null, source, property_type: type,
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

// what the user keeps on a listing (their star, the messages Claude wrote for it included), and what the engine
// adds, through every refresh
const KEPT = ['first_seen', 'price_history', 'my_status', 'favorite', 'notes', 'messages', 'building', 'changes']

// Merges listings into the known ones (by id, else by URL) on day `now`. A listing seen again keeps the user's status,
// notes and history; a new price, status or expiry is logged in its `changes` and returned. `gone`: ids a complete
// listing of the zone no longer holds, which become EXPIRED.
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
    // what Claude did not read stays as it was
    for (const [k, v] of Object.entries(n)) if (!KEPT.includes(k) && v != null && !(Array.isArray(v) && !v.length && old[k]?.length)) old[k] = v
    old.urls = [...new Map([...before.urls, ...n.urls].map(u => [normUrl(u.url) ?? u.source, u])).values()]
    byId.set(old.id, old)
    if (n.price && before.price && n.price !== before.price) {
      old.price_history = [...(old.price_history ?? []), { date: now, price: n.price }]
      log(old, n.price < before.price ? 'price_drop' : 'price_rise', before.price, n.price)
    }
    if (n.status && n.status !== before.status) log(old, n.status === 'EXPIRED' ? 'expired' : 'status', before.status, n.status)
  }
  for (const id of gone) {
    const l = byId.get(id)
    if (l && l.status !== 'EXPIRED') { log(l, 'expired', l.status, 'EXPIRED'); l.status = 'EXPIRED' }
  }
  return { listings: [...new Set(byId.values())], changes }
}
