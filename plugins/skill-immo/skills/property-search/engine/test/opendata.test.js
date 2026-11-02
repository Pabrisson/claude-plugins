import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { mock } from 'node:test'
import { openData } from '../lib/opendata.js'

// the open data answers recorded on 2026-10-27 around 20 rue Paul Bert (Lyon 3e), served by a fake fetch
const fixture = f => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')
// the BD TOPO's line of rue Paul Bert by its BAN id; none for the Corniche Kennedy (no BAN link), found by its name
// next to two other streets the name query also brings (another kind of street, another name)
const DECOYS = [['AV DU PRESIDENT JOHN KENNEDY', [[5.37, 43.27], [5.371, 43.271]]], ['BD DU PRESIDENT WILSON', [[5.38, 43.28], [5.381, 43.281]]]]
const kennedy = () => { const d = JSON.parse(fixture('bdtopo-13207-president.json')); d.features.push(...DECOYS.map(([n, c]) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: c }, properties: { nom_collaboratif_gauche: n, nom_collaboratif_droite: n } }))); return JSON.stringify(d) }
const ROUTES = [
  [/troncon_de_route.*identifiant_voie_ban_gauche%3D%2769383_5245/, 'bdtopo-69383_5245.json'], [/troncon_de_route.*identifiant_voie_ban/, () => '{"type":"FeatureCollection","features":[]}'],
  [/troncon_de_route.*nom_collaboratif/, kennedy],
  [/geocodage\/search/, 'geocode-20-rue-paul-bert.json'], [/georisques/, 'georisques-20-rue-paul-bert.json'], [/overpass/, 'overpass-paul-bert.json'],
  [/navigation\/isochrone/, 'isochrone-pedestrian-15.json'], [/wfs/, 'iris-moncey.json'],
  [/data\.gouv\.fr\/api\/1\/datasets\/\?q=Carte/, 'rent-datasets.json'], [/tabular-api.*INSEE_C__exact=69383/, 'rent-69383.json'],
  [/dpe03existant\/values_agg/, 'dpe-classes-paul-bert.json'], [/dpe03existant\/lines.*bbox/, 'dpe-recent-paul-bert.json'], [/fiscalite-locale.*insee_com/, 'tax-69123.json'], [/fiscalite-locale.*mpoid/, 'tax-france.json'],
  [/dido\/api\/v1\/datasets\//, 'sitadel-dataset.json'], [/dido\/api\/v1\/datafiles\/.*COMM=eq%3A69383/, 'sitadel-69383.json'],
]
// API Carto's cadastre: the parcel its query asks (none for the number 9999), as IGN writes it
const apicarto = u => {
  const q = new URL(u).searchParams, arr = q.get('code_arr'), [section, number] = [q.get('section'), q.get('numero')]
  const idu = arr ? `${q.get('code_insee').slice(0, 2)}${arr}000${section}${number}` : `${q.get('code_insee')}${q.get('com_abs')}${section}${number}`
  // a box (a point's parcel): DN 68 around the point, DN 69 beside it
  if (q.has('geom')) {
    const sq = (x, y, d) => ({ type: 'Polygon', coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] })
    return JSON.stringify({ type: 'FeatureCollection', features: [['69383000DN0069', sq(4.8732, 45.7559, 0.0002)], ['69383000DN0068', sq(4.8729, 45.7559, 0.0002)]].map(([idu, geometry]) => ({ type: 'Feature', geometry, properties: { idu } })) })
  }
  const features = number === '9999' ? [] : [{ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[[[4.873, 45.7559], [4.8735, 45.7559], [4.8735, 45.7562], [4.873, 45.7559]]]] }, properties: { numero: number, feuille: 1, section, nom_com: arr ? 'Lyon' : "L'Abergement-Clémenciat", com_abs: q.get('com_abs') ?? '000', code_arr: arr ?? '000', idu, contenance: 990, code_insee: q.get('code_insee') } }]
  return JSON.stringify({ type: 'FeatureCollection', features })
}
// the GPU's answers at DN 68 (2026-11-02), each endpoint its own; a zone told twice (two pieces of the parcel)
const GPU = {
  document: [{ du_type: 'PLUi', grid_title: 'PLUI GRAND LYON LA METROPOLE', gpu_doc_id: '4f3ddc27', name: '200046977_PLUi_20260326' }], municipality: [{ insee: '69383', is_rnu: false }],
  'zone-urba': [{ libelle: 'URm1', libelong: 'Zone mixte', typezone: 'U', datvalid: '20260326' }, { libelle: 'URm1', libelong: 'Zone mixte', typezone: 'U', datvalid: '20260326' }],
  'prescription-surf': [{ libelle: 'Hauteur Max-16', txt: '16' }, { libelle: 'Secteur de mixite sociale', txt: '' }], 'info-surf': [{ libelle: 'Reseau de chaleur urbain' }],
  'assiette-sup-s': [{ suptype: 'pm1', nomsuplitt: 'PPRNi Grand Lyon secteur Lyon Villeurbanne' }],
}
// the register of condominiums: its dataset's files (the daily one gone), its quarterly file's new columns
const RNIC_ROW = { numero_d_immatriculation: 'AB2859320', nom_d_usage_de_la_copropriete: 'LE SAINT EUSEBE', adresse_de_reference: '308 rue Paul Bert 69003 Lyon', nombre_total_de_lots: 64, nombre_de_lots_a_usage_d_habitation: 30, nombre_de_lots_de_stationnement: 0, periode_de_construction: 'DE_1975_A_1993', type_de_syndic_benevole_professionnel_non_connu: 'professionnel', raison_sociale_du_representant_legal: 'REGIE PEDRINI ', date_d_immatriculation: '2018-03-01', long: 4.87299, lat: 45.75604 }
ROUTES.unshift(
  [/data\.gouv\.fr\/api\/1\/datasets\/62da71c068871f4c54258c7c/, () => JSON.stringify({ resources: [{ id: 'old-quarter', title: 'Fichier T3 2025.csv', last_modified: '2026-01-05T10:50:02' }, { id: 'rnic-new', title: "Registre d'Immatriculation des Copropriétés T3 2025 - nouveau format de colonnes", last_modified: '2026-01-05T11:45:11' }] })],
  [/tabular-api.*rnic-new/, () => JSON.stringify({ data: [{ ...RNIC_ROW, numero_d_immatriculation: 'AB0000001', long: 4.8735, lat: 45.7562 }, RNIC_ROW] })],
  [/apicarto\.ign\.fr\/api\/gpu\//, () => JSON.stringify({ type: 'FeatureCollection', features: (GPU[new URL(asked.at(-1).url).pathname.split('/').pop()] ?? []).map(properties => ({ type: 'Feature', properties })) })],
  [/api\.bdnb\.io/, () => JSON.stringify([{ batiment_groupe_id: 'bdnb-bg-1', libelle_adr_principale_ban: '308 Rue Paul Bert 69003 Lyon', l_cle_interop_adr: ['69383_5245_00308'], usage_principal_bdnb_open: 'Résidentiel collectif', annee_construction: 1988, nb_niveau: 6, hauteur_mean: 16, nb_log: 31, surface_emprise_sol: 508, mat_mur_txt: 'BETON', mat_toit_txt: 'AUTRES', type_energie_chauffage: 'electricite', classe_bilan_dpe: 'C', nb_classe_bilan_dpe_a: 0, nb_classe_bilan_dpe_c: 10, nb_classe_bilan_dpe_d: 2, alea_argile: 'Moyen', perimetre_bat_historique: false, numero_immat_principal: 'AB2859320', l_siren: ['440869154'] }])],
  [/recherche-entreprises/, () => { const siren = new URL(asked.at(-1).url).searchParams.get('q'); return JSON.stringify({ results: [{ siren, nature_juridique: { 440869154: '6540', 782855696: '4140', 216901231: '7210', 552100554: '5710' }[siren] }] }) }],
)
ROUTES.push([/apicarto\.ign\.fr\/api\/cadastre\/parcelle/, () => apicarto(asked.at(-1).url)], [/geo-dvf\/latest\/csv\/2024\/communes\/69\/69383\.csv/, 'dvf-69383-2024.csv'])
const asked = []
mock.method(globalThis, 'fetch', async (url, init) => {
  asked.push({ url: String(url), ua: init?.headers?.['User-Agent'] })
  const hit = ROUTES.find(([re]) => re.test(String(url)))
  return hit ? new Response(typeof hit[1] === 'function' ? hit[1]() : fixture(hit[1]), { status: 200 }) : new Response('', { status: 404 })
})
const od = openData(fs.mkdtempSync(path.join(os.tmpdir(), 'immo-od-')))
const point = [4.845472, 45.755958]

test('geocoding: the BAN id carries the street code DVF uses', async () => {
  const [f] = await od.geocode('20 rue paul bert lyon', { limit: 1 })
  assert.deepEqual([f.properties.citycode, f.properties.id, f.properties.type], ['69383', '69383_5245_00020', 'housenumber'])
})

test('risks: only those present, with their label', async () => {
  const r = await od.georisques(point)
  assert.deepEqual(r.natural.map(x => x.key), ['inondation', 'remonteeNappe', 'seisme', 'retraitGonflementArgile', 'radon'])
  assert.ok(r.technological.some(x => x.key === 'icpe'))
})

test('Overpass: one point per place, by category, with an identifying User-Agent', async () => {
  const pois = await od.overpass([4.84, 45.75, 4.85, 45.76])
  assert.ok(pois.length > 0 && pois.every(p => p.cat && p.point.length === 2))
  assert.ok(pois.some(p => p.cat === 'transport' && /Guillotière/.test(p.name)))
  assert.match(asked.find(a => /overpass/.test(a.url)).ua, /^skill-immo\/1\.0 \(\+https:/)
})

test('isochrone and IRIS outlines, then the cache answers without the network', async () => {
  assert.equal((await od.isochrone(point, 'pedestrian', 15)).type, 'Polygon')
  const iris = await od.irisAt(point)
  assert.deepEqual([iris.code, iris.name, iris.geometry.type], ['693830201', 'Moncey', 'MultiPolygon'])
  const before = asked.length
  await od.irisAt(point)
  assert.equal(asked.length, before)
})

test("the rent map: the latest year's resources, found by their title", async () => {
  const r = await od.rent('69383')
  assert.deepEqual([r.year, r.flat.per_m2, r.flat.low, r.flat.high, r.flat.scope], [2025, 16.4, 12.82, 20.98, 'commune'])
  assert.ok(['55b34088', '14a1fe11', '5e3b28a4', '129f764d'].every(id => asked.some(a => a.url.includes(id))))
  assert.ok(!asked.some(a => a.url.includes('old-flat')))
})

test('no DVF in Alsace-Moselle, without a single request', async () => {
  const before = asked.length
  assert.deepEqual(await od.dvf('67482'), { sales: [], years: [], alsace_moselle: true })
  assert.equal(asked.length, before)
})

test('the DPE of the zone, one per home: flats and houses apart, building DPE left out', async () => {
  const d = await od.dpeClasses({ point: [4.856, 45.756], radius: 300 })
  assert.deepEqual(d, { flat: { A: 5, B: 60, C: 1026, D: 621, E: 306, F: 84, G: 30 }, house: { C: 3, D: 1 } })
  const q = new URL(asked.findLast(a => a.url.includes('values_agg')).url).searchParams
  assert.deepEqual([q.get('geo_distance'), q.get('methode_application_dpe_neq')], ['4.856,45.756,300', 'dpe appartement généré à partir des données DPE immeuble'])
})

test('the recent DPE of a box: the last 12 months, newest first, one per home, each with its point', async () => {
  const rows = await od.recentDpe([4.8391, 45.7515, 4.8519, 45.7605])
  assert.equal(rows.length, 12)
  assert.deepEqual(rows[0], { number: '2669E2663903R', date: '2026-10-19', energy: 'E', type: 'flat', area: 26.5, address: '13bis Rue Chalopin 69007 Lyon', ban: '69387_1380_00013_bis', point: [4.844620040377923, 45.75168297914536] })
  const q = new URL(asked.findLast(a => a.url.includes('dpe03existant/lines')).url).searchParams
  assert.deepEqual([q.get('bbox'), q.get('type_batiment_in'), q.get('sort'), q.get('methode_application_dpe_neq')], ['4.8391,45.7515,4.8519,45.7605', 'appartement,maison', '-date_etablissement_dpe', 'dpe appartement généré à partir des données DPE immeuble'])
  assert.equal(q.get('date_etablissement_dpe_gte'), new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10))
})

test("the property tax: Lyon's rate for an arrondissement, and France's average", async () => {
  assert.deepEqual(await od.tax('69383'), { year: 2025, city: 'LYON', commune: 31.89, epci: 0.55, epci_name: 'Métropole de Lyon', total: 32.82, waste: 5.19, france: 43.13 })
  assert.ok(asked.some(a => new URL(a.url).searchParams.get('where') === "insee_com='69123'"))
})

test('the homes authorised: the newest release already out, never one announced for later', async () => {
  const h = await od.housing('69383')
  assert.equal(h.release, '2026-09')
  assert.deepEqual(h.years.at(-1), { year: 2025, authorised: 174, started: null })
  assert.equal(h.years[0].year, 2013)
  assert.ok(asked.some(a => a.url.includes('millesime=2026-09')) && !asked.some(a => a.url.includes('millesime=2099')))
})

test("a street's line in the BD TOPO: by its BAN id, else by its name in the commune (its kind abbreviated)", async () => {
  const bert = await od.streetLine('69383_5245', 'Rue Paul Bert')
  assert.equal(bert.length, 47)
  assert.ok(bert.flat().every(([lon, lat]) => lon > 4.83 && lon < 4.89 && lat > 45.75 && lat < 45.77), 'Lyon 3e')
  const corniche = await od.streetLine('13207_dqffc7', 'Corniche president john f kennedy')
  assert.equal(corniche.length, 50, 'the Corniche only: not the avenue nor the boulevard')
  const q = new URL(asked.findLast(a => a.url.includes('nom_collaboratif')).url).searchParams.get('CQL_FILTER')
  assert.match(q, /insee_commune_gauche='13207' AND nom_collaboratif_gauche ILIKE '%PRESIDENT%'/)
  assert.deepEqual(await od.streetLine("69383_5245' OR 1=1 --", 'Rue Paul Bert'), [], 'only a BAN id goes in the filter')
})

test("a parcel of API Carto by its IDU: Lyon's asked as the city with its arrondissement, an absorbed commune's by its prefix, none is null", async () => {
  const query = () => Object.fromEntries(new URL(asked.findLast(a => a.url.includes('apicarto')).url).searchParams)
  const p = await od.parcel('69383000DN0068')
  assert.deepEqual({ ...p, geometry: p.geometry.type }, { idu: '69383000DN0068', commune: 'Lyon', insee: '69383', arrondissement: '383', prefix: '000', section: 'DN', number: '0068', sheet: 1, area: 990, geometry: 'MultiPolygon' })
  assert.deepEqual(query(), { code_insee: '69123', section: 'DN', numero: '0068', code_arr: '383' })
  assert.equal((await od.parcel('010011230A0045')).arrondissement, null)
  assert.deepEqual(query(), { code_insee: '01001', section: '0A', numero: '0045', com_abs: '123' })
  assert.equal(await od.parcel('01001000ZA9999'), null)
})

test('the mutations DVF has on a parcel: newest first, from the years of its commune, none in Alsace-Moselle', async () => {
  const d = await od.parcelSales('69383000DN0068')
  assert.deepEqual([d.sales.map(m => m.id), d.years], [['2024-826626', '2024-826459', '2024-826289'], ['2024']])
  assert.deepEqual((await od.parcelSales('69383000ZZ0001')).sales, [])
  const before = asked.length
  assert.deepEqual(await od.parcelSales('67482000AB0001'), { sales: [], years: [], alsace_moselle: true })
  assert.equal(asked.length, before)
})

test("the condominiums' register: its quarterly file found by its title, its new columns, nearest first, or by number", async () => {
  const [near, far] = await od.rnic([4.873, 45.75605])
  assert.deepEqual(near, { number: 'AB2859320', name: 'LE SAINT EUSEBE', address: '308 rue Paul Bert 69003 Lyon', lots: 64, dwellings: 30, parking: 0, period: 'DE_1975_A_1993', syndic: 'professionnel', syndic_name: 'REGIE PEDRINI', registered: '2018-03-01', point: [4.87299, 45.75604] })
  assert.equal(far.number, 'AB0000001')
  const q = new URL(asked.findLast(a => a.url.includes('rnic-new')).url).searchParams
  assert.ok(+q.get('long__greater') < 4.873 && +q.get('lat__less') > 45.75605)
  assert.equal((await od.coproByNumber('AB2859320')).name, 'LE SAINT EUSEBE')
  assert.equal(new URL(asked.findLast(a => a.url.includes('rnic-new')).url).searchParams.get('numero_d_immatriculation__exact'), 'AB2859320')
})

test('the parcel at a point: the one it is in, else the nearest (a point on the street)', async () => {
  assert.equal(await od.parcelAt([4.873, 45.756]), '69383000DN0068')
  assert.equal(await od.parcelAt([4.87316, 45.7562]), '69383000DN0069')
  assert.equal(JSON.parse(new URL(asked.findLast(a => a.url.includes('geom')).url).searchParams.get('geom')).type, 'Polygon')
})

test("a parcel's urban plan: its document, zones once, prescriptions, informations, easements; a long outline asked as its middle", async () => {
  const sq = { type: 'Polygon', coordinates: [[[4.8729, 45.7559], [4.8731, 45.7559], [4.8731, 45.7561], [4.8729, 45.7561], [4.8729, 45.7559]]] }
  assert.deepEqual(await od.urbanism('69383000DN0068', sq), {
    document: { kind: 'PLUi', name: 'PLUI GRAND LYON LA METROPOLE', id: '4f3ddc27', file: '200046977_PLUi_20260326' }, rnu: false,
    zones: [{ label: 'URm1', name: 'Zone mixte', kind: 'U', date: '20260326' }], prescriptions: [{ label: 'Hauteur Max-16', value: '16' }, { label: 'Secteur de mixite sociale', value: null }],
    infos: ['Reseau de chaleur urbain'], easements: [{ kind: 'pm1', name: 'PPRNi Grand Lyon secteur Lyon Villeurbanne' }],
  })
  assert.equal(asked.filter(a => a.url.includes('/api/gpu/')).length, 13)
  assert.equal(JSON.parse(new URL(asked.findLast(a => a.url.includes('/api/gpu/')).url).searchParams.get('geom')).type, 'Polygon')
  const long = { type: 'Polygon', coordinates: [Array.from({ length: 400 }, (_, i) => [4.87 + i * 1e-5, 45.75 + (i % 2) * 1e-5])] }
  await od.urbanism('69383000DN0001', long)
  assert.deepEqual(JSON.parse(new URL(asked.findLast(a => a.url.includes('/api/gpu/')).url).searchParams.get('geom')).type, 'Point')
})

test("a parcel's buildings (BDNB): the fields read, the DPE classes it has; a legal person's category, never its name", async () => {
  const [b] = await od.buildings('69383000DN0068')
  assert.deepEqual(b, {
    id: 'bdnb-bg-1', address: '308 Rue Paul Bert 69003 Lyon', bans: ['69383_5245_00308'], use: 'Résidentiel collectif', year: 1988, levels: 6, height: 16, homes: 31, footprint: 508, walls: 'BETON', roof: 'AUTRES',
    heating: 'electricite', dpe: 'C', dpe_classes: { C: 10, D: 2 }, clay: 'Moyen', monument: false, copro: 'AB2859320', sirens: ['440869154'],
  })
  assert.equal(new URL(asked.findLast(a => a.url.includes('bdnb')).url).searchParams.get('parcelle_id'), 'eq.69383000DN0068')
  assert.deepEqual(await Promise.all(['440869154', '782855696', '216901231', '552100554', '999999999'].map(od.ownerKind)), ['sci', 'social', 'local', 'company', null])
})

test('the parcels of a commune DVF sold: each with its latest mutation, its kind and its count', async () => {
  const sold = await od.soldParcels('69383')
  assert.deepEqual(sold['69383000DN0068'], { date: '2024-01-19', price: 150000, kind: 'flat', count: 3 })
  assert.deepEqual(sold['69383000DN0026'], { date: '2024-01-05', price: 375000, kind: 'house', count: 1 })
  assert.equal(sold['69383000AS0125'].kind, 'parking')
})

test("a commune's recent DPE: kept a week for the maps, asked again when the watch wants them fresher", async () => {
  const calls = () => asked.filter(a => a.url.includes('code_insee_ban_eq=69384')).length
  await od.communeDpe('69384')
  await od.communeDpe('69384')
  assert.equal(calls(), 1)
  await od.communeDpe('69384', 0)
  assert.equal(calls(), 2)
})
