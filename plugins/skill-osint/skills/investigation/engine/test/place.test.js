import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { cartesLink, choosePoint, geopfPlace, IGN_LAYERS, ignRasters, kartaviewImages, mapillaryImages, nominatimPlace, overpassQuery, panoramaxImages, pointOf, readCompanies, readOverpass, waybackLinks, websiteHost } from '../../types/place/engine.js'
import { DENY } from '../lib/net.js'
import { pivotsFor } from '../lib/prompt.js'
import { loadTypes, validateEngine, validateManifest } from '../lib/types.js'
import { readNote } from '../lib/vault.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, events, FIXTURES, json, read, run } from './helpers.js'

const fx = rel => JSON.parse(fs.readFileSync(path.join(FIXTURES, rel), 'utf8')), AT = [48.8565, 2.352]

test('pointOf: coordinates as people write or copy them; an address with numbers is not a point', () => {
  for (const s of ['48.8565, 2.352', ' 48.8565,2.352 ', '48.8565 2.352', `48°51'23.4"N 2°21'07.2"E`, '48°51′23.4″N, 2°21′07.2″E']) assert.deepEqual(pointOf(s), AT, s)
  assert.deepEqual(pointOf(`33°51'35.9"S 151°12'40.0"E`), [-33.859972, 151.211111])
  for (const s of ['12 rue 45', '91, 2', '48.8565', '4 place de l\'Hôtel de Ville 75004 Paris', '']) assert.equal(pointOf(s), null, s)
})

test('the geocoders: one point by a written rule, never a midpoint; the other one, a street or finer far away, is the disagreement; a city is no answer', () => {
  const rev = nominatimPlace(fx('nominatim/reverse-48.8565,2.352.json'))
  assert.deepEqual(rev, { lat: 48.856559, lon: 2.351971, label: "6 Place de l'Hôtel-de-Ville - Esplanade de la Libération, 75004 Paris, France", rank: 30, kind: 'amenity', osm: 'node/2871963325', country: 'fr', precise: true })
  const official = geopfPlace(fx('geopf/reverse-48.8565,2.352.json'))
  assert.deepEqual([official.label, official.type, official.distance, official.precise], ["6 Place de l'Hôtel de Ville-esplanade de la Libération 75004 Paris", 'housenumber', 15, true])
  const nom = nominatimPlace(fx('nominatim/search-4-place-de-l-hotel-de-ville-75004-paris.json')), gp = geopfPlace(fx('geopf/search-4-place-de-l-hotel-de-ville-75004-paris.json'))
  assert.deepEqual([nom.label, nom.rank, nom.osm], ["Place de l'Hôtel de Ville, 75004 Paris, France", 26, 'way/4476805'])
  assert.deepEqual([gp.label, Number(gp.score.toFixed(2))], ["4 Rue de l'Hôtel de Ville 75004 Paris", 0.72])
  const c = choosePoint(nom, gp)
  assert.deepEqual([c.by, c.lat, c.lon, c.other.by, c.other.label, c.other.apart], ['nominatim', 48.856446, 2.350898, 'geopf', "4 Rue de l'Hôtel de Ville 75004 Paris", 671])
  assert.equal(choosePoint(nom, { ...gp, score: 0.93 }).by, 'geopf')                 // sure of itself: the official base
  assert.equal(choosePoint(nom, { ...gp, lat: nom.lat, lon: nom.lon }).other, null)  // they agree: no disagreement
  const lyon = [nominatimPlace(fx('nominatim/search-lyon.json')), geopfPlace(fx('geopf/search-lyon.json'))]
  assert.deepEqual([lyon[0].kind, lyon[0].precise, lyon[1].type, lyon[1].precise], ['city', false, 'municipality', false])
  assert.equal(choosePoint(...lyon), null)
  assert.equal(choosePoint(null, null), null)
})

test('Overpass: the building that contains the point, then the named places by distance; the exact query', () => {
  assert.equal(overpassQuery(48.8565, 2.352), '[out:json][timeout:25];is_in(48.8565,2.352)->.a;(way(pivot.a)["building"];rel(pivot.a)["building"];)->.b;.b out tags center;make here;out;(nwr(around:150,48.8565,2.352)["name"][~"^(amenity|shop|office|tourism|craft|leisure|healthcare|historic)$"~"."];nw(around:150,48.8565,2.352)[~"^(contact:)?(website|phone)$"~"."];);out tags center 300;')
  const o = readOverpass(fx('overpass/48.8565,2.352.json'), AT)
  assert.equal(o.at, fx('overpass/48.8565,2.352.json').osm3s.timestamp_osm_base) // recorded 2026-11-06
  assert.deepEqual(o.buildings.map(b => [b.osm, b.label, b.building, b.levels, b.distance_m, b.website, b.phone]), [['relation/284089', 'Hôtel de ville', 'civic', '4', 39, 'https://www.paris.fr', '+33 1 42 76 40 40']])
  // 55 elements of the real answer: the named places, nearest first; a place with no name is labelled by its tag or its id
  assert.deepEqual(o.pois.slice(0, 3).map(p => [p.label, p.distance_m]), [["L'Art", 15], ['Le gouvernement provisoire de la République Française décerne la Croix de la Libération à la Ville de Paris', 16], ['La Science', 19]])
  assert.ok(o.pois.length >= 45 && o.pois.every((p, i, all) => i === 0 || all[i - 1].distance_m <= p.distance_m))
  assert.ok(o.pois.some(p => p.label === 'tourism=artwork') && o.pois.some(p => p.label === 'OSM node/3801064168'))
  assert.ok(!o.pois.some(p => p.osm === 'relation/284089'))             // listed on both sides: the building
  assert.deepEqual(o.pois.find(p => p.name === 'Le BHV Marais'), { osm: 'way/29168869', name: 'Le BHV Marais', label: 'Le BHV Marais', category: 'shop=department_store', website: 'https://www.bhv.fr/', phone: null, lat: 48.857468, lon: 2.353317, distance_m: 145, building: 'yes', levels: '9', start_date: null, address: null, url: 'https://www.openstreetmap.org/way/29168869' })
  assert.deepEqual(['https://www.paris.fr', 'http://equipement.paris.fr/x', 'www.bhv.fr/', 'not a url %'].map(websiteHost), ['paris.fr', 'equipement.paris.fr', 'bhv.fr', null])
  assert.deepEqual(readOverpass({ elements: [] }, AT), { buildings: [], pois: [], at: null })
})

test('third-party text never carries markdown or a link that loads: names, labels, sites and image links are cleaned at the reader', () => {
  const evil = '![x](http://evil.example/a.png) <b>[[Journal]]</b> `%%`'
  const o = readOverpass({ elements: [{ type: 'node', id: 1, lat: 48.8565, lon: 2.352, tags: { name: evil, shop: 'bakery', website: 'javascript:alert(1)', phone: '+33 1 99 00 12 34', 'addr:street': evil } }] }, AT)
  assert.ok(!/[[\]<>`\\%]/.test(`${o.pois[0].name}${o.pois[0].label}${o.pois[0].address}`))
  assert.equal(o.pois[0].website, null)                 // not http(s): dropped
  const n = nominatimPlace([{ lat: '1', lon: '2', place_rank: 30, name: evil, address: { road: evil, country: evil, country_code: 'fr' } }])
  assert.ok(!/[[\]<>`\\%]/.test(n.label))
  const g = geopfPlace({ features: [{ geometry: { coordinates: [2, 1] }, properties: { label: evil, type: 'housenumber', score: 0.9 } }] })
  assert.ok(!/[[\]<>`\\%]/.test(g.label))
  const c = readCompanies({ results: [{ siren: '1', nom_complet: evil, statut_diffusion: 'O', nature_juridique: '5499', matching_etablissements: [{ siret: '1', adresse: evil, liste_enseignes: [evil], latitude: '48.8565', longitude: '2.352', etat_administratif: 'A' }] }] }, AT)
  assert.ok(!/[[\]<>`\\%]/.test(`${c.rows[0].name}${c.rows[0].address}${c.rows[0].sign}`))
  const p = panoramaxImages({ features: [{ id: 'a', geometry: { coordinates: [2.352, 48.8565] }, assets: { thumb: { href: 'javascript:alert(1)' } }, providers: [{ name: evil, roles: ['producer'] }], properties: { license: evil, datetime: '2024-01-01T00:00:00Z' } }] }, AT)
  assert.equal(p[0].thumb, null)
  assert.ok(!/[[\]<>`\\%]/.test(`${p[0].author}${p[0].license}`))
  const geom = { coordinates: [2.352, 48.8565] }
  const m = mapillaryImages({ data: [{ id: '1; DROP', captured_at: 1, geometry: geom }, { id: '7', captured_at: 1, geometry: geom, thumb_1024_url: 'file:///etc/passwd', creator: { username: evil } }] }, AT)
  assert.deepEqual([m.length, m[0].id, m[0].thumb], [1, '7', null])    // an id is digits: it goes into a link
  assert.ok(!/[[\]<>`\\%]/.test(m[0].author))
  const k = kartaviewImages({ result: { data: [{ id: 'x', lat: '48.8565', lng: '2.352', sequenceId: '1/../2', sequenceIndex: '3', fileurlTh: 'data:text/html,x' }] } }, AT)
  assert.deepEqual(k.map(i => [i.thumb, i.page]), [])                    // a link built from a sequence that is not digits is no link
})

test('ground images: within 150 m, the nearest, with date, bearing, licence and author; KartaView\'s own distance ignored', () => {
  const p = panoramaxImages(fx('panoramax/48.8565,2.352.json'), AT)
  // recorded 2026-11-06: 8 pictures within 150 m among the 100 the API sent; the authors are rewritten « EXEMPLE Prénom » in the fixture
  assert.deepEqual(p.slice(0, 4).map(i => [i.id.slice(0, 8), i.distance_m, i.date, i.heading, i.pano, i.license, i.author]), [
    ['9cc38bf6', 16, '2023-05-20T17:55:28+00:00', 81, false, 'CC-BY-SA-4.0', 'EXEMPLE Prénom'],
    ['c08f8923', 18, '2026-08-04T19:54:54+00:00', 255, false, 'CC-BY-SA-4.0', 'EXEMPLE Prénom'],
    ['9b84d7a9', 41, '2025-07-08T07:49:21+00:00', 300, true, 'CC-BY-SA-4.0', 'EXEMPLE Prénom'],
    ['2a07e151', 42, '2025-07-08T07:49:25+00:00', 285, true, 'CC-BY-SA-4.0', 'EXEMPLE Prénom'],
  ])
  assert.equal(p.length, 8)
  assert.deepEqual([p[0].page, p[0].thumb], ['https://api.panoramax.xyz/#focus=pic&pic=9cc38bf6-6a40-4adf-b2be-4447eb361202', 'https://panoramax.mapcomplete.org/derivatives/9c/c3/8b/f6/6a40-4adf-b2be-4447eb361202/thumb.jpg'])
  const k = kartaviewImages(fx('kartaview/48.8565,2.352.json'), AT)
  assert.deepEqual(k.slice(0, 3).map(i => [i.id, i.distance_m, i.date, i.heading, i.license]), [['1194735049', 43, '2018-04-03T12:09:06', 270, null], ['3892455', 80, '2016-07-09T10:54:04', 58.9, null], ['1693577721', 87, '2023-02-07T15:47:58', 108.5, null]])
  assert.equal(k.length, 8)
  assert.equal(k[0].page, 'https://kartaview.org/details/3299993/24/track-info')
  const m = mapillaryImages(fx('mapillary/images-paris.json'), AT)
  assert.deepEqual(m.map(i => [i.id, i.distance_m, i.date, i.heading, i.pano, i.license, i.author]), [['1000000000000001', 14, '2024-07-01T08:00:00.000Z', 176.4, false, 'CC-BY-SA', 'exemple_mapper'], ['1000000000000002', 63, '2022-07-01T08:00:00.000Z', 90, true, 'CC-BY-SA', 'exemple_mapper']])
  assert.equal(m[0].page, 'https://www.mapillary.com/app/?pKey=1000000000000001&focus=photo')
  assert.deepEqual([mapillaryImages({}, AT), panoramaxImages({ features: [] }, AT), kartaviewImages({ result: null }, AT)], [[], [], []])
})

test('companies near the point: one row per establishment, open or closed; a sole trader (a person) only with a legal basis for people', () => {
  // recorded 2026-11-06: 549 establishments within 150 m, 25 companies a page, 22 pages; sole traders (here on page 4) have their names and addresses rewritten
  const c = readCompanies(fx('entreprises/near-48.8565,2.352-1.json'), AT)
  assert.deepEqual(c.skipped, { people: 0, hidden: 0 })
  assert.deepEqual([c.total, c.pages, c.rows.length], [549, 22, 30])
  assert.deepEqual(c.rows.slice(0, 3).map(r => [r.siret, r.name, r.state, r.distance_m]), [
    ['21750001600019', 'VILLE DE PARIS', 'open', 4],
    ['31703299300857', 'SAEM EXPLOITATION STATIONNEM VILLE PARIS (SAEMES)', 'open', 97],
    ['31890659101544', 'LA BRIOCHE DOREE', 'closed', 106],
  ])
  assert.ok(c.rows.some(r => r.state === 'closed' && r.closed), 'a closed establishment carries its closing date')
  assert.ok(c.rows.every((r, i, all) => i === 0 || all[i - 1].distance_m <= r.distance_m))
  const p4 = fx('entreprises/near-48.8565,2.352-4.json'), kept = readCompanies(p4, AT)
  assert.deepEqual(kept.skipped, { people: 6, hidden: 0 })
  const all = readCompanies(p4, AT, { people: true })
  assert.deepEqual([all.rows.length - kept.rows.length, all.skipped.people, all.rows.filter(r => r.sole_trader).length], [7, 0, 7])
  assert.deepEqual(readCompanies({ results: [{ siren: '1', nom_complet: '[NON-DIFFUSIBLE]', statut_diffusion: 'P', matching_etablissements: [] }], total_results: 1 }, AT).skipped, { people: 0, hidden: 1 })
})

test('imagery: the IGN orthophotos as XYZ tiles of the WMTS, their viewer links, and Esri Wayback releases as links only', () => {
  const r = ignRasters()
  assert.deepEqual(r.map(x => x.period), ['current', '2021-2023', '2016-2020', '2011-2015', '2006-2010', '2000-2005', '1980-1995', '1965-1980', '1950-1965'])
  assert.deepEqual(r.at(-1), { id: 'ign-1950-1965', label: 'IGN orthophoto 1950-1965', tiles: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS.1950-1965&STYLE=BDORTHOHISTORIQUE&TILEMATRIXSET=PM&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}', maxzoom: 18, attribution: '© IGN – Géoplateforme (Licence Ouverte)', period: '1950-1965' })
  assert.equal(r[0].label, 'IGN orthophoto (current)')
  assert.equal(cartesLink(IGN_LAYERS[0].layer, AT), 'https://cartes.gouv.fr/explorer-les-cartes/?c=2.352,48.8565&z=18&l=ORTHOIMAGERY.ORTHOPHOTOS$GEOPORTAIL:OGC:WMTS(1;1;1;0)&permalink=yes')
  const w = waybackLinks(fx('esri/waybackconfig.json'), AT) // the whole recorded configuration: 14 distinct years' releases
  assert.equal(w.length, 14)
  assert.deepEqual(w[0], { period: '2026-10-29', release: 43291, url: 'https://livingatlas.arcgis.com/wayback/#active=43291&mapCenter=2.35200%2C48.85650%2C18' })
  assert.deepEqual(w.at(-1), { period: '2014-02-20', release: 10, url: 'https://livingatlas.arcgis.com/wayback/#active=10&mapCenter=2.35200%2C48.85650%2C18' })
  assert.deepEqual(waybackLinks({}, AT), [])
})

const fake = await startFake()
test.after(() => fake.close())
const env = { ...fakeEnv(fake.url), MAPILLARY_TOKEN: '' }
const NEW_PLACE = (place, ...more) => ['new', 'place', place, '--question', `What stands at ${place}?`, '--frame', 'noisy=never', ...more]
const PARIS = '48.8565, 2.352', PP = ['-p', '48-8565-2-352']
const entsOf = dir => fs.readdirSync(path.join(dir, 'Entities')).map(f => readNote(path.join(dir, 'Entities', f)).props)
const clues = dir => (fs.existsSync(path.join(dir, 'Clues')) ? fs.readdirSync(path.join(dir, 'Clues')) : [])
const clueText = dir => clues(dir).map(f => read(dir, `Clues/${f}`)).join('\n')
const clueStatus = (dir, fragment) => readNote(path.join(dir, 'Clues', clues(dir).find(f => read(dir, `Clues/${f}`).includes(fragment)))).props.status
const count = (dir, folder) => (fs.existsSync(path.join(dir, folder)) ? fs.readdirSync(path.join(dir, folder)).length : 0)
const everything = dir => fs.readdirSync(dir, { recursive: true }).map(String).filter(x => fs.statSync(path.join(dir, x)).isFile()).map(x => fs.readFileSync(path.join(dir, x), 'utf8')).join('\n')
// a copy of the fixtures with some files changed, served by a second fake
async function fakeWith(change) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-fx-'))
  fs.cpSync(FIXTURES, copy, { recursive: true })
  change(copy)
  const f = await startFake({ fixtures: copy })
  return { f, env: { ...fakeEnv(f.url, copy), MAPILLARY_TOKEN: '' } }
}
// a stand-in for one service: answers from `reply(n, req)` and counts the calls and how many ran at once
async function standIn(reply) {
  const s = { hits: 0, now: 0, max: 0, headers: [], urls: [] }
  const server = http.createServer(async (req, res) => {
    s.hits++; s.now++; s.max = Math.max(s.max, s.now); s.headers.push(req.headers); s.urls.push(req.url)
    const [status, body] = await reply(s.hits, req)
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(body); s.now--
  })
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  return Object.assign(s, { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })
}

test('the place type is sound', async () => {
  const t = loadTypes().find(x => x.id === 'place')
  assert.deepEqual(validateManifest(t), [])
  assert.deepEqual(await validateEngine(t), [])
})

test('collect at the Hôtel de Ville of Paris (real answers): the point, the building, the places around, ground images, companies, imagery — and nobody contacted', async () => {
  const home = casesFolder(), dir = path.join(home, '48-8565-2-352'), before = fake.seen.length
  assert.equal((await run(home, NEW_PLACE(PARIS))).status, 0)
  const r = await run(home, ['place', 'collect', ...PP], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(events(dir).filter(e => e.kind === 'fail').map(e => e.text), [])
  const st = json(dir, '.osint/case.json').state.place
  assert.deepEqual([st.point, st.country, st.value, st.how], [[48.8565, 2.352], 'fr', '48.8565, 2.352', 'given'])
  const ents = entsOf(dir), role = r0 => ents.filter(e => e.role === r0)
  const subject = role('subject')[0]
  assert.deepEqual([subject.kind, Number(subject.lat), Number(subject.lon), subject.address, subject.ban], ['place', 48.8565, 2.352, "6 Place de l'Hôtel de Ville-esplanade de la Libération 75004 Paris", 'fd8fdcc4-9c1b-44f0-8116-af7e538b66b7'])
  const b = role('building')[0]
  assert.deepEqual([b.value, b.osm, b.building, String(b.levels), b.website, b.phone], ['Hôtel de ville (OSM relation/284089)', 'relation/284089', 'civic', '4', 'https://www.paris.fr', '+33142764040'])
  assert.equal(role('poi').length, 21)                                     // the places with a website or a phone
  assert.deepEqual(role('website').map(e => e.value).sort(), ['agences.banquepopulaire.fr', 'basket4ballers.com', 'batobus.com', 'benscookies.com', 'bhv.fr', 'equipement.paris.fr', 'fr.parkindigo.com', 'gensdelaseine.com', 'geox.com', 'hisparis.com', 'lesarchescitoyennes.fr', 'oysho.com', 'paris.fr', 'paristoday.travel', 'q-park.fr', 'solicycle.org', 'space-invaders.com', 'teatribesandco.com'])
  assert.deepEqual(role('listed').map(e => e.value).sort(), ['+33140270000', '+33142720004', '+33142760224', '+33142764040', '+33142764887', '+33159202130', '+33639980012']) // the last one is a fiction number in the fixture (a mobile line of an association, rewritten)
  const images = role('ground image')
  assert.deepEqual([images.length, images.filter(e => e.provider === 'Panoramax').length, images.filter(e => e.provider === 'KartaView').length], [16, 8, 8])
  assert.ok(images.some(e => e.value === 'https://api.panoramax.xyz/#focus=pic&pic=9cc38bf6-6a40-4adf-b2be-4447eb361202' && e.author === 'EXEMPLE Prénom' && e.license === 'CC-BY-SA-4.0' && Number(e.heading) === 81))
  const near = role('nearby company').map(e => e.siren)
  assert.equal(near.length, 94)                                           // 108 establishments of 4 pages (30 + 30 + 28 + 20 − the 6 sole traders' rows)
  for (const siren of ['217500016', '317032993', '775671373']) assert.ok(near.includes(siren), siren)
  assert.ok(!near.some(x => x.startsWith('99000')), 'no sole trader')
  assert.ok(!ents.some(e => e.value === 'EXEMPLE Prénom'))               // a sole trader, without a legal basis for people
  const text = clueText(dir)
  for (const want of [
    'The case starts from coordinates: 48.8565, 2.352',
    "Nearest official address: 6 Place de l'Hôtel de Ville-esplanade de la Libération 75004 Paris, 15 m from the point (Géoplateforme)",
    'The point is inside Hôtel de ville (OpenStreetMap relation/284089: building=civic, 4 levels)',
    "Places with a name, a website or a phone within 150 m in OpenStreetMap: 52 — L'Art, Le gouvernement provisoire",
    'Panoramax: ground images within 150 m: 8, from 2023-05-20 to 2026-08-04 (360° panoramas: 6)',
    'KartaView: ground images within 150 m: 8, from 2016-07-09 to 2023-02-07',
    'Companies registered within 150 m: 94 (establishments: 108; open: 59, closed: 49); companies of the register not read: 449; sole traders (natural persons) not recorded: 6 — the frame gives no legal basis for people',
  ]) assert.ok(text.includes(want), want)
  assert.equal(count(dir, 'Sources'), 9)
  assert.match(read(dir, 'Journal.md'), /No Mapillary token: Mapillary skipped/)
  assert.match(read(dir, 'Journal.md'), /Imagery: the IGN orthophotos \(current, and 1950 to 2023\) on the map; 14 Esri Wayback releases from 2014-02-20 to 2026-10-29, as links/)
  const map = json(dir, '.osint/views/map.json'), groups = map.features.reduce((a, f) => ({ ...a, [f.properties.group]: (a[f.properties.group] ?? 0) + 1 }), {})
  assert.deepEqual(groups, { subject: 1, osm: 53, ground: 16, companies: 108 })
  assert.deepEqual([map.rasters.length, map.rasters[0].id, map.features.find(f => f.properties.group === 'subject').properties.radius_m], [9, 'ign-current', 150])
  assert.ok(map.features.filter(f => f.properties.role === 'pano').every(f => typeof f.properties.heading === 'number' && f.properties.url))
  assert.ok(map.features.some(f => f.properties.kind === 'closed' && f.properties.label === 'LA BRIOCHE DOREE (closed)'))
  const ev = json(dir, '.osint/views/evidence.json').items.filter(i => i.group === 'ground')
  assert.deepEqual(ev[0], { url: 'https://panoramax.mapcomplete.org/derivatives/9c/c3/8b/f6/6a40-4adf-b2be-4447eb361202/thumb.jpg', page: 'https://api.panoramax.xyz/#focus=pic&pic=9cc38bf6-6a40-4adf-b2be-4447eb361202', label: 'Panoramax · 2023-05-20 · 81°', kind: 'ground', date: '2023-05-20', heading: 81, license: 'CC-BY-SA-4.0', author: 'EXEMPLE Prénom', site: 'Panoramax', group: 'ground' })
  assert.equal(ev.length, 16)
  assert.deepEqual([json(dir, '.osint/views/pois.json').length, json(dir, '.osint/views/companies.json').length], [52, 108])
  assert.deepEqual(json(dir, '.osint/views/imagery.json').map(x => x.source), [...Array(9).fill('IGN'), ...Array(14).fill('Esri Wayback')])
  const tl = json(dir, '.osint/views/timeline.json')
  assert.ok(tl.some(i => i.date === '2023-05-20' && i.label === 'Panoramax ground image (81°)' && i.kind === 'ground'))
  assert.ok(tl.some(i => i.date === '1992-12-31' && i.label === 'BATA closes (68 RUE DE RIVOLI 75004 PARIS)'))
  assert.ok(json(dir, '.osint/case.json').relations.some(x => x.label === 'contains the point'))
  const seen = fake.seen.slice(before)
  assert.deepEqual([...new Set(seen.map(s => s.service))].sort(), ['entreprises', 'esri', 'geopf', 'kartaview', 'nominatim', 'overpass', 'panoramax', 'raw'])
  assert.ok(!seen.some(s => DENY.has(s.host)))
})

test('ground images can show people: the engine keeps a thumbnail link and a page, never the picture; a sole trader\'s name is in no source either', async () => {
  const home = casesFolder(), dir = path.join(home, '48-8565-2-352')
  await run(home, NEW_PLACE(PARIS))
  assert.equal((await run(home, ['place', 'collect', ...PP], env)).status, 0)
  assert.deepEqual(fs.readdirSync(path.join(dir, 'Evidence'), { recursive: true }).filter(f => /\.(jpe?g|png|webp|gif|avif|heic)$/i.test(f)), [])   // no picture saved (Evidence/captures holds the sources' JSON)
  assert.equal(json(dir, '.osint/case.json').evidence.length, 0)
  assert.ok(!fake.seen.some(s => /thumb|\.jpg/.test(s.path)))                                                           // no thumbnail asked for
  const all = everything(dir)
  assert.ok(!all.includes('990000010') && !all.includes('99000001000019'))          // not read into a source, a view or a snapshot
  assert.ok(all.includes('VILLE DE PARIS'))
  const withPeople = casesFolder(), d2 = path.join(withPeople, '48-8565-2-352')
  await run(withPeople, [...NEW_PLACE(PARIS), '--frame', 'person=true', '--frame', 'legal_basis=Legitimate interest — checking who works at the address'])
  assert.equal((await run(withPeople, ['place', 'collect', '--only', 'geocode,companies', ...PP], env)).status, 0)
  assert.ok(everything(d2).includes('99000001000019'))       // a sole trader's SIRET (rewritten in the fixture)
})

test('an address: one point by the written rule, the other geocoder\'s answer kept as a disagreement; collect --at moves the point', async () => {
  const home = casesFolder(), dir = path.join(home, 'hotel-de-ville'), P = ['-p', 'hotel-de-ville']
  assert.equal((await run(home, NEW_PLACE("4 place de l'Hôtel de Ville 75004 Paris", '--title', 'Hotel de Ville'))).status, 0)
  const r = await run(home, ['place', 'collect', '--only', 'geocode', ...P], env)
  assert.equal(r.status, 0, r.err)
  assert.match(r.err, /warning: The two geocoders disagree by 671 m: OpenStreetMap \(Nominatim\) gives Place de l'Hôtel de Ville, 75004 Paris, France, Géoplateforme \(official address base\) gives 4 Rue de l'Hôtel de Ville 75004 Paris/)
  assert.equal(clueStatus(dir, 'disagree by 671 m'), 'inferred')
  assert.ok(clueText(dir).includes("OpenStreetMap (Nominatim) places « 4 place de l'Hôtel de Ville 75004 Paris » at Place de l'Hôtel de Ville, 75004 Paris, France (48.856446, 2.350898)"))
  assert.deepEqual(json(dir, '.osint/case.json').state.place.point, [48.856446, 2.350898])
  const moved = await run(home, ['place', 'collect', '--only', 'geocode', '--at', '48.8565,2.352', ...P], env)
  assert.equal(moved.status, 0, moved.err)
  const st = json(dir, '.osint/case.json').state.place
  assert.deepEqual([st.point, st.how, st.value], [[48.8565, 2.352], 'agent', "Place de l'Hôtel de Ville, 75004 Paris, France"])
  assert.ok(clueText(dir).includes('The agent moved the point to 48.8565, 2.352'))
  const subject = entsOf(dir).find(e => e.role === 'subject')
  assert.deepEqual([Number(subject.lat), Number(subject.lon)], [48.8565, 2.352])
})

test('too vague, or nothing to start from: refused before any request around the point; a coarse place offers no place pivot', async () => {
  const home = casesFolder()
  assert.equal((await run(home, NEW_PLACE('Lyon'))).status, 0)
  const before = fake.seen.length
  const r = await run(home, ['place', 'collect', '-p', 'lyon'], env)
  assert.equal(r.status, 1)
  assert.match(r.err, /« Lyon » is a city for OpenStreetMap and a municipality for the Géoplateforme, not an address: give a street address, or coordinates lat,lon/)
  assert.deepEqual([...new Set(fake.seen.slice(before).map(s => s.service))].sort(), ['geopf', 'nominatim'])
  assert.equal(count(path.join(home, 'lyon'), 'Sources'), 0)
  for (const [argv, why] of [[['--only', 'osm'], /no point yet/], [['--only', 'bogus'], /--only geocode,osm,ground,companies,imagery \(not bogus\)/], [['--at', '91,0'], /--at <lat>,<lon>/]]) {
    const x = await run(home, ['place', 'collect', ...argv, '-p', 'lyon'], env)
    assert.equal(x.status, 1, argv.join(' '))
    assert.match(x.err, why)
  }
  // an IP's coarse place (stage 8): no lat/lon, so no "New Place case"; a case opened from it anyway is refused the same way
  assert.equal((await run(home, ['new', 'domain', 'shop.example', '--question', 'Q?', '--frame', 'noisy=never'])).status, 0)
  await run(home, ['entity', 'place', 'Lyon, FR', '--prop', 'coarse=true', '--prop', 'center=45.7, 4.8', '--prop', 'radius_m=50000', '-p', 'shop-example'])
  await run(home, ['entity', 'place', 'SIRET 217 500 016 21445', '--prop', 'lat=48.85638', '--prop', 'lon=2.352485', '-p', 'shop-example'])
  const types = loadTypes(home), on = rel => { const props = readNote(path.join(home, 'shop-example', rel)).props; return pivotsFor({ kind: 'place', value: props.value, path: rel, props }, types).map(p => p.type) }
  assert.ok(!on('Entities/Lyon, FR.md').includes('place'))
  assert.ok(on('Entities/SIRET 217 500 016 21445.md').includes('place'))
  assert.equal((await run(home, [...NEW_PLACE('Lyon'), '--title', 'from-ip', '--parent', 'shop-example', '--from', 'Entities/Lyon, FR.md'])).status, 0)
  assert.equal((await run(home, ['place', 'collect', '-p', 'from-ip'], env)).status, 1)
})

test('a case opened from a place with coordinates (a pivot) starts from that point, without geocoding the address', async () => {
  const home = casesFolder()
  assert.equal((await run(home, ['new', 'domain', 'shop.example', '--question', 'Q?', '--frame', 'noisy=never'])).status, 0)
  await run(home, ['entity', 'place', 'SIRET 217 500 016 21445', '--prop', 'lat=48.8565', '--prop', 'lon=2.352', '--prop', 'address=1 RUE DE LOBAU 75004 PARIS', '-p', 'shop-example'])
  assert.equal((await run(home, [...NEW_PLACE('SIRET 217 500 016 21445'), '--title', 'lobau', '--parent', 'shop-example', '--from', 'Entities/SIRET 217 500 016 21445.md'])).status, 0)
  const before = fake.seen.length, dir = path.join(home, 'lobau')
  const r = await run(home, ['place', 'collect', '--only', 'geocode', '-p', 'lobau'], env)
  assert.equal(r.status, 0, r.err)
  assert.ok(!fake.seen.slice(before).some(s => s.path.includes('search')))   // reverse only
  const st = json(dir, '.osint/case.json').state.place
  assert.deepEqual([st.point, st.how, st.value], [[48.8565, 2.352], 'from', '1 RUE DE LOBAU 75004 PARIS'])
  assert.equal(clueStatus(dir, 'The point comes from SIRET 217 500 016 21445 in case shop-example'), 'inferred')
})

test('outside France: no official address base, no company register, no IGN layer — Esri Wayback links only', async () => {
  const home = casesFolder(), dir = path.join(home, '38-5725-7-9075'), before = fake.seen.length
  assert.equal((await run(home, NEW_PLACE('38.5725, -7.9075'))).status, 0)
  const r = await run(home, ['place', 'collect', '--only', 'geocode,companies,imagery', '-p', '38-5725-7-9075'], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual([...new Set(fake.seen.slice(before).map(s => s.service))].sort(), ['esri', 'nominatim'])
  assert.equal(json(dir, '.osint/views/map.json').rasters, undefined)
  assert.deepEqual(json(dir, '.osint/views/imagery.json').map(x => x.source), Array(14).fill('Esri Wayback'))
  assert.match(read(dir, 'Journal.md'), /Outside France: no company register searched around the point/)
  assert.equal(json(dir, '.osint/case.json').state.place.country, 'pt')
})

test('personal data at the point: a home is flagged once when the frame has no person, and its own phone and site are not recorded; a sole trader is recorded only with a legal basis for people', async () => {
  const { f, env: e } = await fakeWith(copy => {
    const file = path.join(copy, 'overpass', '48.8565,2.352.json'), j = JSON.parse(fs.readFileSync(file, 'utf8'))
    j.elements[0].tags.building = 'apartments'
    fs.writeFileSync(file, JSON.stringify(j))
  })
  try {
    const home = casesFolder(), dir = path.join(home, '48-8565-2-352')
    await run(home, NEW_PLACE(PARIS))
    const r = await run(home, ['place', 'collect', '--only', 'geocode,osm', ...PP], e)
    assert.equal(r.status, 0, r.err)
    assert.match(r.err, /warning: The building at the point is a home \(building=apartments\): an address there is personal data — if the frame says person: false, stop and ask the user/)
    assert.equal(clueStatus(dir, 'is a home'), 'inferred')
    const kept = everything(dir)
    assert.ok(!kept.includes('42 76 40 40') && !kept.includes('+33142764040') && !kept.includes('"https://www.paris.fr"'))   // the home's own contact details (the garden's page of paris.fr is another place's)
    const own = entsOf(dir).find(x => x.osm === 'relation/284089')
    assert.deepEqual([own.phone ?? null, own.website ?? null], [null, null])
    const again = await run(home, ['place', 'collect', '--only', 'osm', ...PP], e)
    assert.doesNotMatch(again.err, /is a home/)
    assert.equal(clues(dir).filter(x => read(dir, `Clues/${x}`).includes('is a home')).length, 1)
    const h2 = casesFolder(), d2 = path.join(h2, '48-8565-2-352')
    await run(h2, [...NEW_PLACE(PARIS), '--frame', 'person=true', '--frame', 'legal_basis=Legitimate interest — checking who works at the address'])
    const p = await run(h2, ['place', 'collect', '--only', 'geocode,osm,companies', ...PP], e)
    assert.equal(p.status, 0, p.err)
    assert.doesNotMatch(p.err, /is a home/)
    assert.ok(entsOf(d2).some(x => x.value === '+33142764040'))
    const sole = entsOf(d2).filter(x => x.sole_trader === true)
    assert.ok(sole.length >= 1 && sole.every(x => x.kind === 'organization' && /^99000\d{4}$/.test(x.siren)), `${sole.length} sole traders`)
    assert.ok(clueText(d2).includes('Companies registered within 150 m: 100 (establishments: 115; open: 64, closed: 51)'))
  } finally { f.close() }
})

test('what a third party wrote never reaches a note as markdown: a name, an address, a company, a sign', async () => {
  const evil = '![x](https://evil.example/a.png) [[Journal]] <b>x</b> %%'
  const { f, env: e } = await fakeWith(copy => {
    const o = path.join(copy, 'overpass', '48.8565,2.352.json'), j = JSON.parse(fs.readFileSync(o, 'utf8'))
    Object.assign(j.elements[3].tags, { name: evil, 'addr:street': evil })
    fs.writeFileSync(o, JSON.stringify(j))
    const c = path.join(copy, 'entreprises', 'near-48.8565,2.352-1.json'), k = JSON.parse(fs.readFileSync(c, 'utf8'))
    k.results[0].nom_complet = evil; k.results[0].matching_etablissements[0].liste_enseignes = [evil]; k.results[0].matching_etablissements[0].adresse = evil
    fs.writeFileSync(c, JSON.stringify(k))
  })
  try {
    const home = casesFolder(), dir = path.join(home, '48-8565-2-352')
    await run(home, NEW_PLACE(PARIS))
    const r = await run(home, ['place', 'collect', '--only', 'geocode,osm,companies', ...PP], e)
    assert.equal(r.status, 0, r.err)
    const notes = ['Entities', 'Clues'].flatMap(d => fs.readdirSync(path.join(dir, d)).map(n => read(dir, `${d}/${n}`))).join('\n')
    assert.ok(notes.includes('Bistrot') || notes.includes('https://evil.example/a.png'), 'the cleaned text is there')
    for (const bad of ['![', '](', '[[Journal]]', '<b>']) assert.ok(!notes.includes(bad), bad)
    assert.ok(notes.split('\n').filter(l => l.includes('%%')).every(l => /^%% osint:(begin|end) [\w-]+ %%$/.test(l)), 'no %% but the engine\'s own markers')
  } finally { f.close() }
})

test('Overpass busy: 429 waits then asks again, one query at a time; at capacity three times, the step is noted as failed and the others run', async () => {
  const fixture = fs.readFileSync(path.join(FIXTURES, 'overpass', '48.8565,2.352.json'), 'utf8')
  const busy = await standIn(n => [n === 1 ? 429 : 200, n === 1 ? '{"remark":"rate limited"}' : fixture])
  const full = await standIn(() => [502, '# 502 Gateway Timeout\n\nThis Overpass API server is currently at capacity.'])
  try {
    const home = casesFolder(), dir = path.join(home, '48-8565-2-352')
    await run(home, NEW_PLACE(PARIS))
    const r = await run(home, ['place', 'collect', '--only', 'geocode,osm', ...PP], { ...env, OSINT_BASE_OVERPASS: busy.url, OSINT_OVERPASS_WAIT: '20' })
    assert.equal(r.status, 0, r.err)
    assert.deepEqual([busy.hits, busy.max], [2, 1])
    assert.match(read(dir, 'Journal.md'), /Overpass answered 429: waiting 0 s before asking again/)
    assert.equal(entsOf(dir).filter(x => x.role === 'poi').length, 21)
    const before = fake.seen.length
    const f = await run(home, ['place', 'collect', '--only', 'osm,ground,companies', ...PP], { ...env, OSINT_BASE_OVERPASS: full.url, OSINT_OVERPASS_WAIT: '20' })
    assert.equal(f.status, 0, f.err)
    assert.equal(full.hits, 3)
    assert.ok(events(dir).some(x => x.kind === 'fail' && x.text === 'osm: Overpass: HTTP 502'))
    assert.ok(['panoramax', 'kartaview', 'entreprises'].every(s => fake.seen.slice(before).some(x => x.service === s)))
  } finally { busy.close(); full.close() }
})

test('Mapillary with its token: in the Authorization header only, never in a URL, a source, the Journal or the cache', async () => {
  const token = 'MLY|1234567890|abcdefABCDEF0123', fixture = fs.readFileSync(path.join(FIXTURES, 'mapillary', 'images-paris.json'), 'utf8')
  const mly = await standIn(() => [200, fixture])
  try {
    const home = casesFolder(), dir = path.join(home, '48-8565-2-352')
    await run(home, NEW_PLACE(PARIS))
    const r = await run(home, ['place', 'collect', '--only', 'geocode,ground', ...PP], { ...env, MAPILLARY_TOKEN: token, OSINT_BASE_MAPILLARY: mly.url })
    assert.equal(r.status, 0, r.err)
    assert.equal(mly.headers[0].authorization, `OAuth ${token}`)
    assert.match(mly.urls[0], /^\/images\?bbox=2\.349952,48\.855153,2\.354048,48\.857847&limit=500&fields=/)
    assert.ok(!mly.urls[0].includes('access_token'))
    assert.ok(clueText(dir).includes('Mapillary: ground images within 150 m: 2, from 2022-07-01 to 2024-07-01 (360° panoramas: 1)'))
    assert.equal(entsOf(dir).filter(x => x.provider === 'Mapillary').length, 2)
    assert.ok(!everything(dir).includes('abcdefABCDEF0123'), 'the token is nowhere in the case')
    assert.ok(!r.out.includes('abcdefABCDEF0123') && !r.err.includes('abcdefABCDEF0123'))
  } finally { mly.close() }
})

test('Mapillary refusing the token: a clear message to configure it, the token nowhere, the other providers still searched', async () => {
  const token = 'MLY|1234567890|zzzzZZZZ9999', mly = await standIn(() => [401, '{"error":{"message":"Invalid OAuth access token."}}'])
  try {
    const home = casesFolder(), dir = path.join(home, '48-8565-2-352')
    await run(home, NEW_PLACE(PARIS))
    const r = await run(home, ['place', 'collect', '--only', 'geocode,ground', ...PP], { ...env, MAPILLARY_TOKEN: token, OSINT_BASE_MAPILLARY: mly.url })
    assert.equal(r.status, 0, r.err)
    assert.ok(events(dir).some(x => x.kind === 'fail' && x.text.includes('Mapillary refused the token (HTTP 401)') && x.text.includes('/plugin configure skill-osint@pabrisson')))
    assert.equal(entsOf(dir).filter(x => x.provider === 'Panoramax').length, 8)
    assert.ok(!everything(dir).includes('zzzzZZZZ9999') && !r.err.includes('zzzzZZZZ9999'))
  } finally { mly.close() }
})

test('Refresh: without a change nothing new is written; a provider down keeps its images, never counted as gone', async () => {
  const home = casesFolder(), dir = path.join(home, '48-8565-2-352')
  await run(home, NEW_PLACE(PARIS))
  assert.equal((await run(home, ['place', 'collect', ...PP], env)).status, 0)
  const sources = count(dir, 'Sources'), n = clues(dir).length
  const r = await run(home, ['refresh', ...PP, '--json'], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(JSON.parse(r.out).diffs.map(d => [d.name, d.added.length, d.removed.length, d.changed.length]), [['ground', 0, 0, 0], ['companies', 0, 0, 0], ['osm', 0, 0, 0]])
  assert.deepEqual([count(dir, 'Sources'), clues(dir).length], [sources, n])
  const { f, env: e } = await fakeWith(copy => fs.rmSync(path.join(copy, 'kartaview', '48.8565,2.352.json')))
  try {
    const down = await run(home, ['refresh', '--only', 'ground', ...PP, '--json'], e)
    assert.equal(down.status, 0, down.err)
    assert.deepEqual(JSON.parse(down.out).diffs.map(d => [d.name, d.removed.length]), [['ground', 0]])
    assert.ok(events(dir).some(x => x.kind === 'fail' && x.text === 'KartaView: HTTP 404'))
  } finally { f.close() }
})

test('doctor: the place type ready without a Mapillary token, one line for the token, the libphonenumber line once, the five services probed', async () => {
  const home = casesFolder()
  const d = JSON.parse((await run(home, ['doctor', '--json'], env)).out)
  assert.ok(d.types.some(t => t.id === 'place' && t.ready))
  assert.equal(d.lines.filter(l => l.name === 'MAPILLARY_TOKEN').length, 1)
  assert.equal(d.lines.filter(l => l.name === 'libphonenumber').length, 1)
  const n = JSON.parse((await run(home, ['doctor', '--network', '--json'], env)).out)
  for (const s of ['geopf', 'overpass', 'panoramax', 'kartaview', 'esri']) assert.equal(n.lines.find(l => l.name === s)?.status, 'ok', s)
})
