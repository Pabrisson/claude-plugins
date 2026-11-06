// The place type: what stands at an address or a point, and how the place changed. Geocoding (Nominatim everywhere,
// the Géoplateforme in France), OpenStreetMap around the point (Overpass), ground images with their date and bearing
// (Mapillary with its token, Panoramax, KartaView), the companies registered near the point (France, Recherche
// d'entreprises), IGN orthophotos on the map (France) and Esri Wayback releases as links. A place is a place, never
// the home of a private person: nothing here looks for who lives at an address. Every service goes through ctx.fetch;
// what a third party wrote is cleaned at the readers (tidy, siteOf) before it reaches a note, a property or a view.
import fs from 'node:fs'
import { withLock } from '../../engine/lib/case.js'
import path from 'node:path'
import { dataset } from '../../engine/lib/datasets.js'
import { haversineKm, parseLatLon } from '../../engine/lib/geo.js'
import { SERVICES } from '../../engine/lib/net.js'
import { parseMetadata, parsePhone } from '../../engine/lib/phones.js'
import { safeName } from '../../engine/lib/util.js'
import { readNote } from '../../engine/lib/vault.js'
import { mergeView } from '../geolocate-image/engine.js'
import { SETS } from '../phone/engine.js'

export const AROUND_M = 150
export const PER_PROVIDER = 8
export const FRANCE = new Set(['fr', 'gp', 'mq', 'gf', 're', 'yt', 'pm', 'bl', 'mf'])
export const POI_KEYS = ['amenity', 'shop', 'office', 'tourism', 'craft', 'leisure', 'healthcare', 'historic']
export const RESIDENTIAL = new Set(['house', 'residential', 'apartments', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'farm', 'dormitory', 'houseboat', 'static_caravan'])
const r6 = x => Number(Number(x).toFixed(6))
const r1 = x => (x == null || x === '' || !Number.isFinite(Number(x)) ? null : Number(Number(x).toFixed(1)))
export const metres = (a, b) => Math.round(haversineKm(a, b) * 1000)
// what a service wrote, as one plain line: nothing that markdown would read as a link, an image, an embed or a block
const tidy = s => (s == null ? '' : String(s).replace(/[\\![\]<>`%]+/g, ' ').replace(/\s+/g, ' ').trim())
const tidyOr = s => tidy(s) || null
// a link that goes into a note, a property or a view: http(s) only (a bare host name is read as https), no space or
// character that would close a link or a tag
export function siteOf(u) {
  const s = String(u ?? '').trim()
  if (!s || /[\s<>"`\\[\]]/.test(s)) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return /^https?:\/\/[^/?#]+/i.test(s) ? s : null
  try { return new URL(`https://${s}`).hostname.includes('.') ? s : null } catch { return null }
}
const digitsOnly = s => (/^\d{1,20}$/.test(String(s ?? '')) ? String(s) : null)

// coordinates as people write or copy them: "48.8565, 2.352", "48.8565 2.352", 48°51'23.4"N 2°21'07.2"E
export function pointOf(s) {
  const t = String(s ?? '').trim()
  const dec = parseLatLon(t) ?? parseLatLon(t.replace(/^(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/, '$1,$2'))
  if (dec) return dec.map(r6)
  const m = /^(\d{1,2})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)(?:"|″|'')?\s*([NS])[\s,]+(\d{1,3})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)(?:"|″|'')?\s*([EW])$/i.exec(t)
  if (!m) return null
  const v = (d, mi, se, h) => (Number(d) + Number(mi) / 60 + Number(se) / 3600) * (/[SW]/i.test(h) ? -1 : 1)
  const lat = v(m[1], m[2], m[3], m[4]), lon = v(m[5], m[6], m[7], m[8])
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [r6(lat), r6(lon)] : null
}

// Nominatim (/search answers a list, /reverse one object): the point, a short label, how precise it is
export function nominatimPlace(j) {
  const p = Array.isArray(j) ? j[0] : j
  if (!p || p.error || p.lat == null) return null
  const a = p.address ?? {}, town = a.city ?? a.town ?? a.village ?? a.hamlet ?? a.municipality
  const road = a.road ?? a.pedestrian ?? a.square, street = [a.house_number, road].filter(Boolean).join(' ')
  const parts = [p.name && p.name !== road ? p.name : null, street, [a.postcode, town].filter(Boolean).join(' '), a.country].map(tidy)
  const label = [...new Set(parts.filter(Boolean))].join(', ') || tidy(p.display_name)
  const cc = /^[a-z]{2}$/i.test(a.country_code ?? '') ? a.country_code.toLowerCase() : null
  return { lat: r6(p.lat), lon: r6(p.lon), label, rank: p.place_rank ?? 0, kind: tidyOr(p.addresstype ?? p.type), osm: /^(node|way|relation)$/.test(p.osm_type) && digitsOnly(p.osm_id) ? `${p.osm_type}/${p.osm_id}` : null, country: cc, precise: (p.place_rank ?? 0) >= 26 }
}
// the Géoplateforme (France's official address base, BAN): a GeoJSON FeatureCollection
export function geopfPlace(fc) {
  const f = fc?.features?.[0]
  if (!f) return null
  const p = f.properties ?? {}, [lon, lat] = f.geometry.coordinates
  return { lat: r6(lat), lon: r6(lon), label: tidy(p.label), score: p.score ?? null, type: tidyOr(p.type), precise: ['housenumber', 'street', 'locality'].includes(p.type), ban: /^[\w-]{1,64}$/.test(p.banId ?? p.id ?? '') ? (p.banId ?? p.id) : null, citycode: tidyOr(p.citycode), distance: Number.isFinite(p.distance) ? p.distance : null }
}
// one point, never a midpoint: the official base when it is sure of itself (score ≥ 0.8), else OpenStreetMap when it
// found a street or finer, else the official base when it found an address at all (score ≥ 0.5); the other geocoder,
// when it found a street or finer more than 100 m away, is the disagreement the case writes down
export function choosePoint(nom, gp) {
  const g = gp?.precise && gp.score >= 0.5 ? gp : null, n = nom?.precise ? nom : null
  const pick = g && g.score >= 0.8 ? { ...g, by: 'geopf' } : n ? { ...n, by: 'nominatim' } : g ? { ...g, by: 'geopf' } : null
  if (!pick) return null
  const other = pick.by === 'geopf' ? nom : gp, apart = other?.precise ? metres([pick.lat, pick.lon], [other.lat, other.lon]) : 0
  return { ...pick, other: apart > 100 ? { ...other, by: pick.by === 'geopf' ? 'nominatim' : 'geopf', apart } : null }
}

// Overpass: the building(s) that contain the point, then (after the `make here` marker) what has a name, a website or
// a phone within r metres — the exact query verified on overpass-api.de on 2026-11-03
export const overpassQuery = (lat, lon, r = AROUND_M) => `[out:json][timeout:25];is_in(${lat},${lon})->.a;(way(pivot.a)["building"];rel(pivot.a)["building"];)->.b;.b out tags center;make here;out;(nwr(around:${r},${lat},${lon})["name"][~"^(${POI_KEYS.join('|')})$"~"."];nw(around:${r},${lat},${lon})[~"^(contact:)?(website|phone)$"~"."];);out tags center 300;`
export function poiCategory(t = {}) {
  const k = POI_KEYS.find(x => t[x]) ?? (t.building ? 'building' : null)
  return k ? tidy(`${k}=${t[k]}`) : null
}
export function readOverpass(j, at) {
  const els = j?.elements ?? [], cut = els.findIndex(e => e.type === 'here')
  const row = e => {
    const t = e.tags ?? {}, pos = e.center ?? (e.lat != null ? { lat: e.lat, lon: e.lon } : null), osm = `${e.type}/${e.id}`
    const name = tidyOr(t.name ?? t.brand ?? t.operator), category = poiCategory(t)
    return { osm, name, label: name ?? category ?? `OSM ${osm}`, category, website: siteOf(t.website ?? t['contact:website']), phone: tidyOr(t.phone ?? t['contact:phone']),
      lat: pos ? r6(pos.lat) : null, lon: pos ? r6(pos.lon) : null, distance_m: pos ? metres(at, [pos.lat, pos.lon]) : null,
      building: tidyOr(t.building), levels: tidyOr(t['building:levels']), start_date: tidyOr(t.start_date),
      address: tidyOr([t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ')), url: `https://www.openstreetmap.org/${osm}` }
  }
  const valid = e => /^(node|way|relation)$/.test(e.type) && digitsOnly(e.id)
  const buildings = (cut < 0 ? [] : els.slice(0, cut)).filter(valid).map(row), taken = new Set(buildings.map(b => b.osm))
  const pois = []
  for (const e of (cut < 0 ? els : els.slice(cut + 1)).filter(valid)) { const p = row(e); if (!taken.has(p.osm)) { taken.add(p.osm); pois.push(p) } }
  pois.sort((a, b) => (a.distance_m ?? 1e9) - (b.distance_m ?? 1e9) || a.osm.localeCompare(b.osm))
  return { buildings, pois, at: j?.osm3s?.timestamp_osm_base ?? null }
}
export function websiteHost(u) {
  try { return new URL(/^https?:\/\//i.test(u) ? u : `https://${u}`).hostname.toLowerCase().replace(/^www\./, '') } catch { return null }
}

// ground images: each provider's answer as rows { provider, id, lat, lon, date, heading, pano, thumb, page, license,
// author, distance_m }, those within AROUND_M, the nearest PER_PROVIDER (the newest first at equal distance). A person
// may be in a ground image: the engine keeps its thumbnail's link and its page, and never downloads the picture.
const near = (rows, at) => rows.map(x => ({ ...x, distance_m: metres(at, [x.lat, x.lon]) })).filter(x => x.distance_m <= AROUND_M)
  .sort((a, b) => a.distance_m - b.distance_m || String(b.date).localeCompare(String(a.date))).slice(0, PER_PROVIDER)
export function mapillaryImages(j, at) {
  return near((j?.data ?? []).filter(x => digitsOnly(x.id) && (x.computed_geometry ?? x.geometry)?.coordinates).map(x => {
    const [lon, lat] = (x.computed_geometry ?? x.geometry).coordinates
    return { provider: 'Mapillary', id: String(x.id), lat: r6(lat), lon: r6(lon), date: x.captured_at ? new Date(x.captured_at).toISOString() : null,
      heading: r1(x.computed_compass_angle ?? x.compass_angle), pano: !!x.is_pano, thumb: httpsOnly(x.thumb_1024_url ?? x.thumb_256_url),
      page: `https://www.mapillary.com/app/?pKey=${x.id}&focus=photo`, license: 'CC-BY-SA', author: tidyOr(x.creator?.username) }
  }), at)
}
const httpsOnly = u => (/^https?:\/\/[^\s<>"`\\]+$/i.test(String(u ?? '')) ? String(u) : null)
export function panoramaxImages(j, at) {
  return near((j?.features ?? []).filter(f => f.geometry?.coordinates && /^[\w-]{1,64}$/.test(f.id ?? '')).map(f => {
    const [lon, lat] = f.geometry.coordinates, p = f.properties ?? {}, makers = (f.providers ?? []).filter(x => x.roles?.includes('producer'))
    return { provider: 'Panoramax', id: f.id, lat: r6(lat), lon: r6(lon), date: tidyOr(p.datetime), heading: r1(p['view:azimuth']),
      pano: p['pers:interior_orientation']?.field_of_view === 360, thumb: httpsOnly(f.assets?.thumb?.href ?? f.assets?.sd?.href),
      page: `https://api.panoramax.xyz/#focus=pic&pic=${f.id}`,
      license: tidyOr(p.license ?? /\(([^)]+)\)/.exec((f.links ?? []).find(l => l.rel === 'license')?.title ?? '')?.[1]), author: tidyOr(makers.at(-1)?.name) }
  }), at)
}
// KartaView: asked within 500 m (less answers nothing); its `distance` is not the distance to the point
export function kartaviewImages(j, at) {
  return near((j?.result?.data ?? []).filter(x => digitsOnly(x.id) && digitsOnly(x.sequenceId) && digitsOnly(x.sequenceIndex)).map(x => ({ provider: 'KartaView', id: String(x.id), lat: r6(x.lat), lon: r6(x.lng),
    date: x.shotDate ? tidyOr(String(x.shotDate).slice(0, 19).replace(' ', 'T')) : null, heading: r1(x.heading), pano: !!x.projection && x.projection !== 'PLANE',
    thumb: httpsOnly(x.fileurlTh ?? x.fileurlProc), page: `https://kartaview.org/details/${x.sequenceId}/${x.sequenceIndex}/track-info`, license: null, author: null })), at)
}

// Recherche d'entreprises near_point: one row per establishment in the radius; a sole trader is a natural person
// (nature juridique 1xxx): kept only when the frame has a legal basis for people; a company not fully public is left out
export function readCompanies(j, at, { people = false } = {}) {
  const rows = [], skipped = { people: 0, hidden: 0 }
  for (const c of j?.results ?? []) {
    if (c.statut_diffusion && c.statut_diffusion !== 'O') { skipped.hidden++; continue }
    const person = String(c.nature_juridique ?? '').startsWith('1')
    if (person && !people) { skipped.people++; continue }
    for (const e of c.matching_etablissements ?? []) {
      const lat = e.latitude == null ? null : Number(e.latitude), lon = e.longitude == null ? null : Number(e.longitude), placed = Number.isFinite(lat) && Number.isFinite(lon)
      rows.push({ name: tidy(c.nom_complet), siren: digitsOnly(c.siren) ?? '', siret: digitsOnly(e.siret) ?? '', naf: tidyOr(e.activite_principale ?? c.activite_principale),
        state: e.etat_administratif === 'A' ? 'open' : 'closed', company_state: c.etat_administratif === 'A' ? 'active' : 'ceased',
        address: tidyOr(e.adresse), sign: tidy([...(e.liste_enseignes ?? []), e.nom_commercial].filter(Boolean).join(' / ')) || null,
        lat: placed ? r6(lat) : null, lon: placed ? r6(lon) : null, distance_m: placed ? metres(at, [lat, lon]) : null,
        created: tidyOr(e.date_creation), closed: tidyOr(e.date_fermeture), head_office: !!e.est_siege, sole_trader: person })
    }
  }
  rows.sort((a, b) => (a.distance_m ?? 1e9) - (b.distance_m ?? 1e9) || a.siret.localeCompare(b.siret))
  return { rows, skipped, total: j?.total_results ?? 0, pages: j?.total_pages ?? 1 }
}

// IGN orthophotos of the Géoplateforme's WMTS (Licence Ouverte), checked by GetCapabilities on 2026-11-03: the current
// one and the national mosaics of each period (a single year covers only the départements flown that year)
export const IGN_LAYERS = [
  { layer: 'ORTHOIMAGERY.ORTHOPHOTOS', period: 'current', style: 'normal', format: 'image/jpeg', maxzoom: 19 },
  { layer: 'ORTHOIMAGERY.ORTHOPHOTOS2021-2023', period: '2021-2023', style: 'normal', format: 'image/jpeg', maxzoom: 19 },
  { layer: 'ORTHOIMAGERY.ORTHOPHOTOS2016-2020', period: '2016-2020', style: 'normal', format: 'image/jpeg', maxzoom: 19 },
  { layer: 'ORTHOIMAGERY.ORTHOPHOTOS2011-2015', period: '2011-2015', style: 'normal', format: 'image/jpeg', maxzoom: 18 },
  { layer: 'ORTHOIMAGERY.ORTHOPHOTOS2006-2010', period: '2006-2010', style: 'normal', format: 'image/jpeg', maxzoom: 18 },
  { layer: 'ORTHOIMAGERY.ORTHOPHOTOS2000-2005', period: '2000-2005', style: 'normal', format: 'image/jpeg', maxzoom: 18 },
  { layer: 'ORTHOIMAGERY.ORTHOPHOTOS.1980-1995', period: '1980-1995', style: 'BDORTHOHISTORIQUE', format: 'image/png', maxzoom: 18 },
  { layer: 'ORTHOIMAGERY.ORTHOPHOTOS.1965-1980', period: '1965-1980', style: 'BDORTHOHISTORIQUE', format: 'image/png', maxzoom: 18 },
  { layer: 'ORTHOIMAGERY.ORTHOPHOTOS.1950-1965', period: '1950-1965', style: 'BDORTHOHISTORIQUE', format: 'image/png', maxzoom: 18 },
]
const WMTS = 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0'
export const ignRasters = () => IGN_LAYERS.map(l => ({ id: `ign-${l.period}`, label: l.period === 'current' ? 'IGN orthophoto (current)' : `IGN orthophoto ${l.period}`,
  tiles: `${WMTS}&LAYER=${l.layer}&STYLE=${l.style}&TILEMATRIXSET=PM&FORMAT=${l.format}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`,
  maxzoom: l.maxzoom, attribution: '© IGN – Géoplateforme (Licence Ouverte)', period: l.period }))
// the layer in IGN's own viewer (the link skill-immo uses for the cadastre, with this layer)
export const cartesLink = (layer, [lat, lon]) => `https://cartes.gouv.fr/explorer-les-cartes/?c=${lon},${lat}&z=18&l=${layer}$GEOPORTAIL:OGC:WMTS(1;1;1;0)&permalink=yes`
// Esri Wayback (links only: its terms outside ArcGIS are unclear): the last release of each year and the first one,
// newest first, each a link to the Wayback viewer at the point
export function waybackLinks(config, [lat, lon]) {
  const rel = Object.entries(config ?? {}).map(([k, v]) => ({ release: Number(k), date: /(\d{4}-\d{2}-\d{2})/.exec(v?.itemTitle ?? '')?.[1] }))
    .filter(r => r.date && Number.isInteger(r.release) && r.release > 0).sort((a, b) => b.date.localeCompare(a.date))
  const keep = [], years = new Set()
  for (const r of rel) if (!years.has(r.date.slice(0, 4))) { years.add(r.date.slice(0, 4)); keep.push(r) }
  if (rel.length && !keep.includes(rel.at(-1))) keep.push(rel.at(-1))
  const center = `${lon.toFixed(5)}%2C${lat.toFixed(5)}%2C18`
  return keep.map(r => ({ period: r.date, release: r.release, url: `https://livingatlas.arcgis.com/wayback/#active=${r.release}&mapCenter=${center}` }))
}

// ---- the steps of `place collect` ----
export const STEPS = ['geocode', 'osm', 'ground', 'companies', 'imagery']
export const MAX_POI_ENTITIES = 30
export const MAX_COMPANY_PAGES = 4
const real = (service, p) => `${SERVICES[service]}${p}`
const json = (r, what) => {
  if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status}`)
  try { return JSON.parse(r.body.toString('utf8')) } catch { throw new Error(`${what}: not JSON`) }
}
const readView = (ctx, w) => { try { return JSON.parse(fs.readFileSync(ctx.file(`.osint/views/${w}.json`), 'utf8')) } catch { return null } }
const fresh = d => d.first || d.added.length > 0 || d.removed.length > 0 || d.changed.length > 0
const day = s => (s ? String(s).slice(0, 10) : '?')
const few = (xs, n = 8) => `${xs.slice(0, n).join(', ')}${xs.length > n ? `, +${xs.length - n}` : ''}`
const record = (ctx, service, p, body, title) => ctx.source({ url: real(service, p), body: JSON.stringify(body, null, 2), contentType: 'application/json', title, reliability: 'B' })
const need = ctx => {
  const st = ctx.state()
  if (!st.point) ctx.refuse('no point yet: run osint.mjs place collect -p <slug> (its geocode step comes first)')
  return st
}
const lastItems = (ctx, name) => {
  const d = path.join(ctx.dir, '.osint', 'collect', name)
  try {
    const n = fs.readdirSync(d).filter(f => /^\d+\.json$/.test(f)).map(f => Number(f.slice(0, -5))).sort((a, b) => b - a)[0]
    return n ? JSON.parse(fs.readFileSync(path.join(d, `${n}.json`), 'utf8')).items : []
  } catch { return [] }
}
// the place entity of the parent case this one was started from (a pivot), when it has coordinates. The parent and the
// note are named in Case.md: only a case folder of this cases folder and a note of its Entities are read.
function parentPlace(ctx) {
  const f = ctx.frame(), parent = String(f.parent ?? ''), from = String(f.from ?? '')
  if (!parent || !from || parent !== safeName(parent) || !/^Entities\/[^/\\]+\.md$/.test(from) || from.includes('..')) return null
  const p = readNote(path.join(ctx.home, parent, ...from.split('/'))).props
  if (p.kind !== 'place' || p.lat == null || p.lon == null || p.coarse) return null
  const lat = Number(p.lat), lon = Number(p.lon)
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { point: [lat, lon], address: tidyOr(p.address), value: tidy(p.value), path: from, parent } : null
}

async function geocode(ctx, flags) {
  const lang = ctx.lang === 'fr' ? 'fr' : 'en', input = String(ctx.input.place ?? '').trim(), st = ctx.state()
  const moved = flags.at ? pointOf(flags.at) : null, given = moved ? null : pointOf(input), from = moved || given ? null : parentPlace(ctx)
  const sources = [], clues = []
  let point, nom = null, gp = null, chosen = null
  if (moved || given || from) {
    point = moved ?? given ?? from.point
    const q = `/reverse?lat=${point[0]}&lon=${point[1]}&format=jsonv2&zoom=18&addressdetails=1&accept-language=${lang}`
    const nj = json(await ctx.fetch('nominatim', q, { retries: 1 }), 'Nominatim'); nom = nominatimPlace(nj)
    sources.push(['nominatim', q, nj, ctx.t('src_reverse', { at: point.join(', '), service: ctx.t('svc_nominatim') })])
    if (FRANCE.has(nom?.country)) {
      const g = `/geocodage/reverse?lat=${point[0]}&lon=${point[1]}&limit=1`
      const gj = json(await ctx.fetch('geopf', g, { retries: 1 }), 'Géoplateforme'); gp = geopfPlace(gj)
      sources.push(['geopf', g, gj, ctx.t('src_reverse', { at: point.join(', '), service: ctx.t('svc_geopf') })])
    }
    if (moved) clues.push([ctx.t('moved', { lat: point[0], lon: point[1] }), 'read'])
    else if (given) clues.push([ctx.t('given', { lat: point[0], lon: point[1] }), 'read'])
    else clues.push([ctx.t('from_parent', { entity: from.value, parent: from.parent, lat: point[0], lon: point[1] }), 'inferred'])
    if (gp) clues.push([ctx.t('nearest_official', { label: gp.label, m: gp.distance ?? metres(point, [gp.lat, gp.lon]) }), 'read'])
    else if (nom) clues.push([ctx.t('nearest_osm', { label: nom.label }), 'read'])
  } else {
    const q = `/search?q=${encodeURIComponent(input)}&format=jsonv2&addressdetails=1&limit=1&accept-language=${lang}`
    const nj = json(await ctx.fetch('nominatim', q, { retries: 1 }), 'Nominatim'); nom = nominatimPlace(nj)
    sources.push(['nominatim', q, nj, ctx.t('src_geocode', { q: input, service: ctx.t('svc_nominatim') })])
    if (!nom || FRANCE.has(nom.country)) {
      const g = `/geocodage/search?q=${encodeURIComponent(input)}&limit=1`
      const gj = json(await ctx.fetch('geopf', g, { retries: 1 }), 'Géoplateforme'); gp = geopfPlace(gj)
      sources.push(['geopf', g, gj, ctx.t('src_geocode', { q: input, service: ctx.t('svc_geopf') })])
    }
    chosen = choosePoint(nom, gp)
    if (!chosen) {
      const a = w => `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`
      const what = [nom && `${a(nom.kind ?? 'place')} for OpenStreetMap`, gp && `${a(gp.type ?? 'place')} for the Géoplateforme`].filter(Boolean).join(' and ')
      ctx.refuse(what ? `« ${input} » is ${what}, not an address: give a street address, or coordinates lat,lon (osint.mjs new place "45.9012, 2.7021" …)`
        : `« ${input} » is unknown to OpenStreetMap and to the Géoplateforme: check the address, or give coordinates lat,lon`)
    }
    point = [chosen.lat, chosen.lon]
    const service = ctx.t(chosen.by === 'geopf' ? 'svc_geopf' : 'svc_nominatim')
    clues.push([ctx.t('geocoded', { service, q: input, label: chosen.label, lat: point[0], lon: point[1], score: chosen.score != null ? ctx.t('score', { score: chosen.score.toFixed(2) }) : '' }), 'read'])
    if (chosen.other) {
      const a = ctx.t(chosen.by === 'geopf' ? 'svc_geopf' : 'svc_nominatim'), b = ctx.t(chosen.other.by === 'geopf' ? 'svc_geopf' : 'svc_nominatim')
      const text = ctx.t('disagree', { m: chosen.other.apart, a, la: chosen.label, b, lb: chosen.other.label })
      clues.push([text, 'inferred'])
      process.stderr.write(`warning: ${text}\n`)
    }
  }
  const country = nom?.country ?? (gp ? 'fr' : null)
  const address = (chosen ? chosen.label : gp?.label ?? nom?.label) ?? null
  const value = st.value ?? (given ? `${point[0]}, ${point[1]}` : from ? (from.address ?? `${point[0]}, ${point[1]}`) : chosen?.label ?? `${point[0]}, ${point[1]}`)
  const d = ctx.snapshot('geocode', [{ key: 'point', lat: point[0], lon: point[1], address, country }])
  const S = []
  if (fresh(d)) {
    for (const [service, p, body, title] of sources) S.push((await record(ctx, service, p, body, title)).id)
    for (const [text, status] of clues) ctx.clue(text, { status, sources: S })
  }
  const subject = ctx.entity('place', value, { sources: S, props: { role: 'subject', lat: point[0], lon: point[1], address, country, ...(gp?.ban && { ban: gp.ban }), ...(from && { from: `${from.parent}/${from.path}` }) } })
  ctx.state({ point, country, value, address, subject: subject.path, how: moved ? 'agent' : given ? 'given' : from ? 'from' : chosen.by })
  mergeView(ctx, 'map', 'subject', [{ type: 'Feature', geometry: { type: 'Point', coordinates: [point[1], point[0]] }, properties: { role: 'place', kind: 'subject', label: value, ref: subject.path, radius_m: AROUND_M } }])
}

// Overpass takes no parallel query from one address; 429 or 406 (too many) and 5xx (at capacity): wait, then again
async function overpass(ctx, q) {
  const p = `/api/interpreter?data=${encodeURIComponent(q)}`, wait = Number(process.env.OSINT_OVERPASS_WAIT ?? 30000)
  for (let i = 0; ; i++) {
    const r = await ctx.fetch('overpass', p, { timeout: 60000, max: 20e6 })
    if (!(r.status === 429 || r.status === 406 || r.status >= 500) || i >= 2) return { r, p }
    ctx.log(ctx.t('overpass_wait', { status: r.status, s: Math.round(wait / 1000) }))
    await new Promise(ok => setTimeout(ok, wait))
  }
}
// a home is personal data: unless the frame says person: true, its own contact details are neither a property, an
// entity, a snapshot nor a line of the source this step keeps
const CONTACT = /^(contact:)?(phone|mobile|fax|website|email|url)$/
const dropContacts = (j, homes) => ({ ...j, elements: (j.elements ?? []).map(e => (homes.has(`${e.type}/${e.id}`) && e.tags ? { ...e, tags: Object.fromEntries(Object.entries(e.tags).filter(([k]) => !CONTACT.test(k))) } : e)) })

async function osm(ctx) {
  const st = need(ctx), [lat, lon] = st.point
  const { r, p } = await overpass(ctx, overpassQuery(lat, lon))
  const j = json(r, 'Overpass'), o = readOverpass(j, st.point), frame = ctx.frame()
  const homes = new Set(o.buildings.filter(b => RESIDENTIAL.has(b.building) && frame.person !== true).map(b => b.osm))
  for (const b of o.buildings) if (homes.has(b.osm)) { b.website = null; b.phone = null }
  const d = ctx.snapshot('osm', [...o.buildings, ...o.pois].map(x => ({ key: x.osm, name: x.name, category: x.category, website: x.website, phone: x.phone })))
  const S = fresh(d) ? [(await record(ctx, 'overpass', p, dropContacts(j, homes), ctx.t('src_osm', { r: AROUND_M, at: st.point.join(', ') }))).id] : []
  // phones in E.164 (libphonenumber's metadata, the folder's dataset, as the phone type reads it)
  let meta = null
  const e164 = async raw => {
    if (!raw) return []
    if (!meta) { const ds = await dataset(ctx.home, 'libphonenumber', SETS.libphonenumber); meta = ds.text ? parseMetadata(ds.text) : { territories: [], byCc: new Map(), byId: new Map() } }
    return String(raw).split(/\s*;\s*/).map(x => parsePhone(meta, x, String(st.country ?? 'fr').toUpperCase())).filter(x => x.e164).map(x => x.e164)
  }
  const features = [], rows = []
  const record1 = async (x, role) => {
    const value = x.label === `OSM ${x.osm}` ? x.label : `${x.label} (OSM ${x.osm})`, phones = await e164(x.phone), host = x.website ? websiteHost(x.website) : null
    const ent = ctx.entity('place', value, { sources: S, props: { role, osm: x.osm, category: x.category, lat: x.lat, lon: x.lon, distance_m: x.distance_m, website: x.website, phone: phones[0] ?? x.phone, address: x.address, ...(role === 'building' && { building: x.building, levels: x.levels, start_date: x.start_date }) } })
    if (host) { ctx.entity('domain', host, { sources: S, props: { role: 'website' } }); ctx.relate(['place', value], ['domain', host], 'website', S[0] ?? null) }
    for (const n of phones) { ctx.entity('phone', n, { sources: S, props: { role: 'listed' } }); ctx.relate(['place', value], ['phone', n], 'phone', S[0] ?? null) }
    ctx.relate(['place', value], ['place', st.value], role === 'building' ? 'contains the point' : `within ${AROUND_M} m`, S[0] ?? null)
    return ent.path
  }
  for (const b of o.buildings) {
    const ref = await record1(b, 'building')
    if (b.lat != null) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [b.lon, b.lat] }, properties: { role: 'place', kind: 'building', label: b.label, ref, url: b.url } })
    if (S.length) ctx.clue(ctx.t('building', { name: b.name ?? ctx.t('a_building'), osm: b.osm, kind: b.building, levels: b.levels ? ctx.t('levels', { n: b.levels }) : '', start: b.start_date ? ctx.t('built', { date: b.start_date }) : '' }), { status: 'read', sources: S })
    if (homes.has(b.osm) && !st.residential) {
      const text = ctx.t('residential', { kind: b.building })
      ctx.clue(text, { status: 'inferred', sources: S })
      ctx.state({ residential: b.osm })
      process.stderr.write(`warning: ${text} — if the frame says person: false, stop and ask the user for the frame (person=true and its legal basis)\n`)
    }
  }
  if (!o.buildings.length && S.length) ctx.clue(ctx.t('no_building'), { status: 'read', sources: S })
  let kept = 0
  for (const x of o.pois) {
    const ref = (x.website || x.phone) && kept < MAX_POI_ENTITIES ? (kept++, await record1(x, 'poi')) : null
    rows.push({ name: x.label, category: x.category, distance_m: x.distance_m, website: x.website, phone: x.phone, osm: x.osm, url: x.url })
    if (x.lat != null) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [x.lon, x.lat] }, properties: { role: 'place', kind: 'poi', label: x.label, url: x.url, ...(ref && { ref }) } })
  }
  if (S.length) ctx.clue(o.pois.length ? ctx.t('pois', { n: o.pois.length, r: AROUND_M, names: few(o.pois.map(x => x.label)) }) : ctx.t('no_pois', { r: AROUND_M }), { status: 'read', sources: S })
  ctx.view('pois', rows)
  mergeView(ctx, 'map', 'osm', features)
}

async function ground(ctx) {
  const st = need(ctx), at = st.point, [lat, lon] = at
  const dLat = AROUND_M / 111320, dLon = Math.min(AROUND_M / (111320 * Math.max(Math.cos((lat * Math.PI) / 180), 0.05)), 0.04)   // Mapillary: a box under 0.01 deg²
  const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map(x => Number(x.toFixed(6))).join(',')
  const asked = [], failed = new Set()
  const ask = async (provider, service, p, read, opts = {}) => {
    try {
      const r = await ctx.fetch(service, p, { timeout: 30000, ...opts })
      if (provider === 'Mapillary' && [400, 401, 403].includes(r.status)) throw new Error(ctx.t('mapillary_refused', { status: r.status }))
      const j = json(r, provider)
      asked.push({ provider, service, p, j, images: read(j, at) })
    } catch (e) { failed.add(provider); ctx.fail(e.message) }
  }
  // Mapillary only with its token, sent in the Authorization header: never in the URL, which the Journal keeps
  if (process.env.MAPILLARY_TOKEN) await ask('Mapillary', 'mapillary', `/images?bbox=${bbox}&limit=500&fields=id,captured_at,compass_angle,computed_compass_angle,geometry,computed_geometry,thumb_1024_url,is_pano,creator`, mapillaryImages, { headers: { authorization: `OAuth ${process.env.MAPILLARY_TOKEN}` } })
  else ctx.log(ctx.t('no_mapillary'))
  await ask('Panoramax', 'panoramax', `/api/search?place_position=${lon},${lat}&place_distance=0-${AROUND_M}&limit=100`, panoramaxImages)
  await ask('KartaView', 'kartaview', `/2.0/photo/?lat=${lat}&lng=${lon}&radius=500`, kartaviewImages)
  const images = asked.flatMap(a => a.images)
  // a provider that failed keeps its images of the last snapshot: a Refresh does not count them gone
  const carried = lastItems(ctx, 'ground').filter(i => failed.has(i.provider))
  const d = ctx.snapshot('ground', [...images.map(i => ({ key: `${i.provider.toLowerCase()}:${i.id}`, provider: i.provider, date: i.date, heading: i.heading })), ...carried])
  const S = {}
  // what is kept of an answer is the images within the radius, never the whole answer (other people's pictures and accounts)
  if (fresh(d)) for (const a of asked) {
    S[a.provider] = (await record(ctx, a.service, a.p, { provider: a.provider, within_m: AROUND_M, images: a.images }, ctx.t('src_ground', { provider: a.provider, r: AROUND_M, at: at.join(', ') }))).id
    const dates = a.images.map(i => day(i.date)).sort(), panos = a.images.filter(i => i.pano).length
    ctx.clue(a.images.length ? ctx.t('ground', { provider: a.provider, n: a.images.length, r: AROUND_M, first: dates[0], last: dates.at(-1), pano: panos ? ctx.t('panos', { n: panos }) : '' }) : ctx.t('no_ground', { provider: a.provider, r: AROUND_M }), { status: 'read', sources: [S[a.provider]] })
  }
  const items = [], features = [], dated = []
  for (const i of images) {
    const src = S[i.provider] ? [S[i.provider]] : []
    const ent = ctx.entity('image', i.page, { sources: src, props: { role: 'ground image', provider: i.provider, date: day(i.date), heading: i.heading, pano: i.pano, url: i.thumb, license: i.license, author: i.author, lat: i.lat, lon: i.lon, distance_m: i.distance_m } })
    ctx.relate(['image', i.page], ['place', st.value], `taken within ${AROUND_M} m`, src[0] ?? null)
    const label = ctx.t('ground_label', { provider: i.provider, day: day(i.date), heading: i.heading ?? '?' })
    items.push({ url: i.thumb, page: i.page, label, kind: 'ground', date: day(i.date), heading: i.heading, license: i.license, author: i.author, site: i.provider })
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [i.lon, i.lat] }, properties: { role: 'pano', kind: i.provider.toLowerCase(), label, ref: ent.path, url: i.page, date: day(i.date), ...(i.heading != null && { heading: i.heading }) } })
    if (i.date) dated.push({ date: day(i.date), label: ctx.t('tl_ground', { provider: i.provider, heading: i.heading ?? '?' }), kind: 'ground', url: i.page, ref: ent.path })
  }
  mergeView(ctx, 'evidence', 'ground', items)
  mergeView(ctx, 'map', 'ground', features)
  ctx.timeline(dated)
}

async function companies(ctx) {
  const st = need(ctx)
  if (!FRANCE.has(st.country)) return ctx.log(ctx.t('outside_france'))
  const [lat, lon] = st.point, people = ctx.frame().person === true, pages = [], rows = [], skipped = { people: 0, hidden: 0 }
  let total = 0, last = 1
  for (let page = 1; page <= Math.min(last, MAX_COMPANY_PAGES); page++) {
    const p = `/near_point?lat=${lat}&long=${lon}&radius=${AROUND_M / 1000}&per_page=25&page=${page}&limite_matching_etablissements=10&minimal=true&include=matching_etablissements`
    const j = json(await ctx.fetch('entreprises', p, { retries: 2 }), "Recherche d'entreprises"), c = readCompanies(j, st.point, { people })
    // a sole trader is a person and a company not fully public is not for sharing: neither goes into the source
    const keep = x => (!x.statut_diffusion || x.statut_diffusion === 'O') && (people || !String(x.nature_juridique ?? '').startsWith('1'))
    pages.push([p, { ...j, results: (j.results ?? []).filter(keep) }]); rows.push(...c.rows); skipped.people += c.skipped.people; skipped.hidden += c.skipped.hidden; total = c.total; last = c.pages
  }
  rows.sort((a, b) => (a.distance_m ?? 1e9) - (b.distance_m ?? 1e9) || a.siret.localeCompare(b.siret))
  const d = ctx.snapshot('companies', rows.map(r => ({ key: r.siret, name: r.name, state: r.state })))
  const S = []
  if (fresh(d)) {
    for (const [i, [p, j]] of pages.entries()) S.push((await record(ctx, 'entreprises', p, j, ctx.t('src_companies', { r: AROUND_M, at: st.point.join(', '), page: i + 1 }))).id)
    const sirens = new Set(rows.map(r => r.siren)), read = sirens.size + skipped.people + skipped.hidden
    ctx.clue(rows.length || skipped.people || skipped.hidden ? ctx.t('companies', { n: rows.length, c: sirens.size, r: AROUND_M, open: rows.filter(r => r.state === 'open').length, closed: rows.filter(r => r.state === 'closed').length,
      more: total > read ? ctx.t('more', { n: total - read }) : '', people: skipped.people ? ctx.t('people', { n: skipped.people }) : '', hidden: skipped.hidden ? ctx.t('hidden', { n: skipped.hidden }) : '' })
      : ctx.t('no_companies', { r: AROUND_M }), { status: 'read', sources: S })
  }
  const features = [], dated = [], seen = new Map()
  for (const r of rows) {
    if (!seen.has(r.siren)) {
      // two companies of one name are two entities: the second one is named with its SIREN
      const same = readNote(ctx.file(`Entities/${safeName(r.name)}.md`)), value = same.exists && same.props.kind === 'organization' && String(same.props.siren ?? r.siren) !== r.siren ? `${r.name} (${r.siren})` : r.name
      const ent = ctx.entity('organization', value, { sources: S, props: { role: 'nearby company', siren: r.siren, naf: r.naf, state: r.company_state, ...(r.sole_trader && { sole_trader: true }) } })
      ctx.relate(['organization', value], ['place', st.value], `registered within ${AROUND_M} m`, S[0] ?? null)
      seen.set(r.siren, ent.path)
    }
    const label = r.sign && r.sign !== r.name ? `${r.name} — ${r.sign}` : r.name
    if (r.lat != null) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: { role: 'place', kind: r.state === 'open' ? 'establishment' : 'closed', label: r.state === 'open' ? label : ctx.t('closed_label', { label }), ref: seen.get(r.siren), ...(r.created && { date: r.created }) } })
    if (r.created) dated.push({ date: r.created, label: ctx.t('tl_opens', { name: r.name, address: r.address ?? '?' }), kind: 'establishment', ref: seen.get(r.siren) })
    if (r.closed) dated.push({ date: r.closed, label: ctx.t('tl_closes', { name: r.name, address: r.address ?? '?' }), kind: 'establishment', ref: seen.get(r.siren) })
  }
  ctx.view('companies', rows.map(r => ({ name: r.name, siren: r.siren, siret: r.siret, naf: r.naf, state: r.state, address: r.address, sign: r.sign, distance_m: r.distance_m, created: r.created, closed: r.closed })))
  mergeView(ctx, 'map', 'companies', features)
  ctx.timeline(dated)
}

async function imagery(ctx) {
  const st = need(ctx), rows = [], france = FRANCE.has(st.country)
  withLock(ctx.dir, () => { // read then write the map: under the case's lock
    const map = readView(ctx, 'map') ?? { type: 'FeatureCollection', features: [] }
    if (france) ctx.view('map', { ...map, rasters: ignRasters() })
    else if (map.rasters) { delete map.rasters; ctx.view('map', map) }
  })
  if (france) rows.push(...IGN_LAYERS.map(l => ({ source: 'IGN', period: l.period, layer: l.layer, url: cartesLink(l.layer, st.point) })))
  let links = []
  try {
    links = waybackLinks(json(await ctx.fetch('esri', '/config.maptiles.arcgis.com/waybackconfig.json', { cacheHours: 24, timeout: 30000 }), 'Esri Wayback'), st.point)
    rows.push(...links.map(l => ({ source: 'Esri Wayback', period: l.period, layer: `release ${l.release}`, url: l.url })))
  } catch (e) { ctx.fail(`Esri Wayback: ${e.message}`) }
  ctx.view('imagery', rows)
  ctx.log(ctx.t('imagery', { ign: france ? ctx.t('imagery_ign') : '', n: links.length, first: links.at(-1)?.period ?? '?', last: links[0]?.period ?? '?' }))
}

const RUN = { geocode, osm, ground, companies, imagery }
async function collect(ctx, args, flags) {
  const only = flags.only ? String(flags.only).split(',').map(s => s.trim()).filter(Boolean) : STEPS
  const bad = only.filter(s => !STEPS.includes(s))
  if (bad.length) ctx.refuse(`--only ${STEPS.join(',')} (not ${bad.join(',')})`)
  if (flags.at && !pointOf(flags.at)) ctx.refuse('--at <lat>,<lon> in decimal degrees (or 48°51\'23"N 2°21\'07"E)')
  const steps = STEPS.filter(s => only.includes(s) || (s === 'geocode' && flags.at))
  if (!steps.includes('geocode') && !ctx.state().point) ctx.refuse('no point yet: run collect without --only first (its geocode step comes first)')
  for (const [i, s] of steps.entries()) {
    ctx.progress(i + 1, steps.length, s)
    try { await RUN[s](ctx, flags) } catch (e) { if (e.userError) throw e; ctx.fail(`${s}: ${e.message}`) }
  }
}

export const commands = {
  collect: { help: 'geocode the place, then OpenStreetMap around it, ground images, nearby companies (France), imagery: --only geocode,osm,ground,companies,imagery; --at lat,lon moves the point', flags: { only: 'string', at: 'string' }, run: collect },
}
