// listings.json: one format whatever the source (references/listing-format.md). A property of Stream Estate (its
// plain-JSON PropertySearchResult) or a listing Claude read (WebSearch, WebFetch, pasted text) becomes the same
// object; a refresh merges the new state into the old one and says what changed.
import { createHash } from 'node:crypto'
import { TYPES } from './market.js'

const YEARLY = { WEEKLY: 52, MONTHLY: 12, YEARLY: 1 }
const yearly = x => (x?.amount ?? x?.total) == null ? null : Math.round((x.amount ?? x.total) * (YEARLY[x.frequency] ?? 1))
const hash = s => createHash('sha1').update(s).digest('hex').slice(0, 12)
const ppm2 = (price, area) => (price > 0 && area > 0 ? Math.round(price / area) : null)
// the earliest of ISO dates
const first = ds => ds.filter(Boolean).sort()[0] ?? null
const seType = t => Object.keys(TYPES).find(k => TYPES[k].includes(t)) ?? 'flat'
// a land area in m² (Stream Estate gives large ones in hectares)
const landM2 = x => (x?.value > 0 ? Math.round(x.value * (x.unit === 'HECTARE' ? 10000 : 1)) : null)

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

export function fromStreamEstate(r) {
  const p = r.property ?? {}, u = p.unit ?? {}, b = p.building ?? {}, am = p.amenities ?? {}, loc = p.location ?? {}
  const sale = p.pricing?.sale ?? {}, fees = sale.fees ?? {}, scores = u.diagnostic?.scores ?? {}, out = p.area?.outdoor ?? {}
  const listings = r.listings ?? [], area = p.area?.displayed ?? null, price = p.pricing?.displayed ?? null
  const type = seType(p.propertyType), land = landM2(p.area?.land)
  return {
    id: r.id, se_id: r.id, source: 'stream-estate', property_type: type,
    urls: listings.map(l => ({
      url: l.url ?? null, source: l.source?.slug ?? null, published_at: l.publishedAt ?? null, expired_at: l.expiredAt ?? null,
      last_seen_at: l.lastSeenAt ?? null, favorites: l.marketing?.favorites ?? null, urgent: !!l.marketing?.urgent,
    })),
    title: p.body?.title ?? null, description: p.body?.description ?? null,
    price, net_price: sale.netPrice ?? null, area, carrez: p.area?.indoor?.legal?.value ?? null, land_area: land,
    price_per_m2: ppm2(price, type === 'land' ? land ?? area : area),
    rooms: u.rooms ?? null, bedrooms: u.bedrooms ?? null, floor: u.floor ?? null, floors: b.floors ?? null,
    last_floor: u.lastFloor ?? null, ground_floor: u.groundFloor ?? null,
    dpe: { energy: scores.ENERGY_CONSUMPTION?.rating ?? null, energy_value: scores.ENERGY_CONSUMPTION?.value ?? null, ghg: scores.CARBON_EMISSIONS?.rating ?? null, date: u.diagnostic?.date ?? null, reference: u.diagnostic?.reference ?? null },
    construction_year: b.constructionYear ?? null, lots: b.numberOfLots ?? null, construction_type: b.constructionType ?? null,
    condition: u.condition ?? null, legal_proceedings: b.legalStatus?.underLegalProceedings ?? null, new_build: p.constructionStatus ? p.constructionStatus !== 'OLD' : null,
    features: {
      balcony: u.balcony ?? null, terrace: u.terrace ?? null, garden: u.garden ?? null, cellar: u.cellar ?? null,
      parking: u.parking?.total > 0 || null, elevator: am.elevator ?? null, caretaker: am.caretaker ?? null, bike_room: am.bikeRoom ?? null,
      fiber: am.connectivity?.includes('FIBER') ?? null, crossing: u.crossing ?? null, quiet: u.quiet ?? null, orientation: u.orientation ?? [],
      heating: u.energy?.heating?.[0] ? [u.energy.heating[0].energyCarrier, u.energy.heating[0].collective ? 'collective' : 'individual'].join(' ') : null,
    },
    outdoor_area: [out.terrace, out.balcony, out.garden].some(x => x > 0) ? (out.terrace ?? 0) + (out.balcony ?? 0) + (out.garden ?? 0) : null,
    location: {
      point: loc.geometry?.type === 'Point' ? loc.geometry.coordinates : null, accuracy: loc.accuracy ?? null, address: loc.address ?? null,
      city: loc.city?.name ?? null, insee: loc.city?.uniqueCode ?? null, postcode: loc.city?.postalCodes?.[0] ?? null,
      neighborhood: loc.neighborhood?.name ?? null, iris: loc.subNeighborhood?.name ?? null, city_id: loc.city?.id ?? null,
    },
    fees: {
      agency: fees.agency ? { amount: fees.agency.amount ?? null, percentage: fees.agency.percentage ?? null, included: fees.agency.includedInPrice ?? null, paid_by: fees.agency.paidBy ?? null } : null,
      condo_yearly: yearly(fees.condominium), property_tax: yearly(fees.taxes?.propertyTax),
    },
    status: p.expired ? 'EXPIRED' : (p.transaction?.status ?? 'AVAILABLE'),
    publishers: (r.publishers ?? []).map(x => ({
      type: x.publisherType ?? null, name: x.agencyName ?? null, card: x.professionalCardNumber ?? null, website: x.website ?? null,
      phone: x.contact?.phone ?? null, email: x.contact?.email ?? null, profile_url: x.contact?.profileUrl ?? null, mandate: x.mandate ?? null,
    })),
    pictures: (p.pictures ?? []).map(x => x.url).filter(Boolean).slice(0, 12),
    published_at: first(listings.map(l => l.publishedAt)), updated_at: p.updatedAt ?? null,
    urgent: listings.some(l => l.marketing?.urgent), favorites: Math.max(0, ...listings.map(l => l.marketing?.favorites ?? 0)) || null,
    // the source's own price history, oldest first
    price_changes: (p.changes ?? []).filter(c => c.attribute === 'DISPLAYED_PRICE' && c.numericNew != null)
      .map(c => ({ date: c.occurredAt, from: c.numericOld, to: c.numericNew, pct: c.variationPercent })).reverse(),
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

// what the user keeps on a listing (the messages Claude wrote for it included), and what the engine adds, through
// every refresh
const KEPT = ['first_seen', 'price_history', 'my_status', 'notes', 'messages', 'building', 'changes']

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
