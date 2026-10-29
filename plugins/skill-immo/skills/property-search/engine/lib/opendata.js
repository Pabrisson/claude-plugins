// The free open data (references/data-sources.md), each answer kept in the searches folder's .cache/ for its TTL.
// Every source is public and keyless; Overpass asks for a User-Agent that names the client.
import fs from 'node:fs'
import path from 'node:path'
import { atPlace, cityCodes } from './alerts.js'
import { dvfSales, parseCsv } from './dvf.js'

const UA = 'skill-immo/1.0 (+https://github.com/Pabrisson/claude-plugins)'
const GEOPF = 'https://data.geopf.fr'
const TABULAR = 'https://tabular-api.data.gouv.fr/api/resources'
// data.gouv datasets whose resources are found by title: their ids change with each release
const RNIC = { dataset: '62da71c068871f4c54258c7c', title: /actualisation quotidienne/i, fallback: '3ea8e2c3-0038-464a-b17e-cd5c91f65ce2' }
const SSMSI = { dataset: '621df2954fa5a3b5a023e23c', com: /^COM - /, dep: /^DEP - /, fallback: { com: '604d71b8-337d-4869-9226-49e01bae87df', dep: '2b27a675-e3bf-41ef-a852-5fb9ab483967' } }
// Overpass: what is within reach of a flat, by category
const POI = {
  shops: ['shop', /^(supermarket|convenience|bakery|butcher|greengrocer|deli|cheese|marketplace)$/],
  food: ['amenity', /^(restaurant|cafe|bar|fast_food)$/],
  schools: ['amenity', /^(kindergarten|school|college|childcare)$/],
  health: ['amenity', /^(pharmacy|doctors|clinic|hospital|dentist)$/],
  transport: ['railway', /^(station|halt|tram_stop|subway_entrance)$/],
  bus: ['highway', /^bus_stop$/],
  parks: ['leisure', /^(park|garden|playground)$/],
}
// Carte des loyers (DHUP): one dataset a year, found by its title; the 2025 resources if the search fails
const RENT = { q: "Carte des loyers indicateurs de loyers d'annonce par commune", fallback: { year: 2025, flat: '55b34088-0964-415f-9df7-d87dd98a09be', flat_small: '14a1fe11-b2d1-49b3-9f6b-83d12df9482c', flat_large: '5e3b28a4-cf56-43a3-ae79-43cceeb27f8c', house: '129f764d-b613-44e4-952c-5ff50a8c9b73' } }
// the property tax of each commune (DGFiP's "fiscalité locale des particuliers"); Paris, Lyon and Marseille vote one
// rate for all their arrondissements
const TAX = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/fiscalite-locale-des-particuliers/records'
const cityOf = insee => (/^751\d\d$/.test(insee) ? '75056' : /^6938\d$/.test(insee) ? '69123' : /^132\d\d$/.test(insee) ? '13055' : insee)
// Sitadel (SDES, DiDo): the homes authorised and started per commune and year
const SITADEL = { api: 'https://data.statistiques.developpement-durable.gouv.fr/dido/api/v1', dataset: '6513ee3a3b05e5cd969c270f', rid: '9c90a880-4ba0-49b4-b99d-d7dd6c810dd0' }
// Sitadel's lists of the permits (data.gouv dataset 689c42fa521ccf80ce954f83, monthly), each kind's CSV resource
const PERMITS = { build: '65a9e264-7a20-46a9-9d98-66becb817bc3', demolish: '8f73cf2d-7bc4-4b5a-b912-718d6991f0a0', develop: '9db13a09-72a9-4871-b430-13872b4890b3' }
// ADEME's energy audits of existing homes (since September 2023)
const AUDITS = 'ync2epx48x9azbdnggbygqp0'
const sleep = t => new Promise(ok => setTimeout(ok, t))
const MELODI = 'https://api.insee.fr/melodi/data'

export function openData(cacheDir) {
  // an answer kept `days` days under .cache/<key> (undefined when none is), and kept again
  const read = (key, days) => {
    const file = path.join(cacheDir, key), st = fs.statSync(file, { throwIfNoEntry: false })
    return st && Date.now() - st.mtimeMs < days * 86400000 ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined
  }
  const keep = (key, value) => {
    const file = path.join(cacheDir, key)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value))
    return value
  }
  // an answer kept `days` days; a failed fetch is not kept
  async function cached(key, days, fetcher) {
    const value = read(key, days)
    return value !== undefined ? value : keep(key, await fetcher())
  }

  // JSON (or text) with three tries on a busy server (429, 502, 503, 504), 2 then 4 s apart; null on a 404
  async function get(url, { text = false, init = {} } = {}) {
    for (let i = 0; ; i++) {
      const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...init.headers }, redirect: 'follow' })
      if ([429, 502, 503, 504].includes(res.status) && i < 2) { await sleep(2000 * 2 ** i); continue }
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}: ${(await res.text()).slice(0, 200)}`)
      return text ? res.text() : res.json()
    }
  }

  const resourceOf = (dataset, title, fallback) => cached(`datagouv/${dataset}-${title.source.replace(/\W/g, '')}.json`, 7, async () => {
    const d = await get(`https://www.data.gouv.fr/api/1/datasets/${dataset}/`)
    return d?.resources.filter(r => title.test(r.title)).sort((a, b) => b.last_modified.localeCompare(a.last_modified))[0]?.id ?? fallback
  })
  const tabular = (rid, params) => get(`${TABULAR}/${rid}/data/?${new URLSearchParams({ page_size: 50, ...params })}`)
  // ADEME's DPE of the last 12 months where `where` says (a box, a commune), one per home: the building DPE and the
  // flats' DPE generated from them are left out
  // ponytail: two pages of 10,000 at most (Paris 15e makes 11,400 a year), the newest kept; more pages if one zone needs them
  const lastYearDpe = (where, key, days) => cached(key, days, async () => {
    const q = new URLSearchParams({
      select: 'numero_dpe,date_etablissement_dpe,etiquette_dpe,type_batiment,surface_habitable_logement,adresse_ban,identifiant_ban,_geopoint',
      size: 10000, sort: '-date_etablissement_dpe', ...where, date_etablissement_dpe_gte: new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
      type_batiment_in: 'appartement,maison', methode_application_dpe_neq: 'dpe appartement généré à partir des données DPE immeuble',
    })
    const rows = []
    for (let url = `https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines?${q}`, i = 0; url && i < 2; i++) {
      const d = await get(url)
      rows.push(...(d?.results ?? []))
      url = d?.next
    }
    // _geopoint is "lat,lon"
    return rows.filter(r => r._geopoint).map(r => ({
      number: r.numero_dpe, date: r.date_etablissement_dpe, energy: r.etiquette_dpe, type: r.type_batiment === 'maison' ? 'house' : 'flat',
      area: r.surface_habitable_logement ?? null, address: r.adresse_ban ?? null, ban: r.identifiant_ban ?? null, point: r._geopoint.split(',').map(Number).reverse(),
    }))
  })

  // ADEME's energy audits of the last 12 months where `where` says (a box, a commune, a street, a circle), newest
  // first, one per audit (its initial state, not its scenarios of works). An audit is due to sell a house or a whole
  // building rated E, F or G; it is also made to get a renovation grant, and no field says which.
  const lastYearAudits = (where, key, days) => cached(key, days, async () => {
    const q = new URLSearchParams({
      select: 'n_audit,date_etablissement_audit,classe_bilan_dpe,methode_application_dpe,surface_habitable_logement,surface_habitable_immeuble,periode_constuction,adresse_ban,identifiant_ban,_geopoint',
      size: 10000, sort: '-date_etablissement_audit', categorie_scenario_eq: 'état initial', date_etablissement_audit_gte: new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10), ...where,
    })
    const d = await get(`https://data.ademe.fr/data-fair/api/v1/datasets/${AUDITS}/lines?${q}`)
    return (d?.results ?? []).filter(r => r._geopoint && r.classe_bilan_dpe).map(r => {
      const building = /immeuble/.test(r.methode_application_dpe ?? '')
      return {
        number: r.n_audit, date: r.date_etablissement_audit, energy: r.classe_bilan_dpe, type: /maison/.test(r.methode_application_dpe ?? '') ? 'house' : 'flat', building,
        area: (building ? r.surface_habitable_immeuble : r.surface_habitable_logement) ?? null, period: r.periode_constuction ?? null,
        address: r.adresse_ban ?? null, ban: r.identifiant_ban ?? null, point: r._geopoint.split(',').map(Number).reverse(),
      }
    })
  })
  // The building permits of a city (Paris, Lyon, Marseille: the whole city) authorised in the last 12 months, newest
  // first, from Sitadel's lists (data.gouv's tabular API, about a month late for a demolition, 6 for homes): the homes
  // built (a permit or a prior declaration), the demolitions, the plots divided. One call places them all (the BAN's
  // CSV geocoding): a permit it cannot place is left out. The applicant is never kept (some SCI bear a person's name).
  // Kept a week: Sitadel comes out monthly.
  const cityPermits = insee => cached(`sitadel/permits-${cityOf(insee)}.json`, 7, async () => {
    const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10), rows = []
    for (const [kind, rid] of Object.entries(PERMITS)) {
      for (let page = 1; page <= 10; page++) {
        const d = await tabular(rid, { COMM__exact: cityOf(insee), DATE_REELLE_AUTORISATION__greater: since, page_size: 200, page })
        rows.push(...(d?.data ?? []).map(r => ({ kind, r })))
        if (!d?.links?.next) break
      }
    }
    // 4: cancelled. Sitadel's addresses come in capitals, some with their accents garbled (« CHAÃ\x82Â\x82TEAU »): the
    // BAN reads them without accents
    const live = rows.filter(({ r }) => (r.ETAT_DAU ?? r.ETAT_PD ?? r.ETAT_PA) !== 4)
    const text = r => [r.ADR_NUM_TER, r.ADR_LIBVOIE_TER || r.ADR_LIEUDIT_TER, r.ADR_CODPOST_TER, r.ADR_LOCALITE_TER].filter(Boolean).join(' ')
      .replace(/[ÂÃ][\u0080-¿]/g, '').normalize('NFD').replace(/[^\x20-\x7E]/g, '').replace(/[",]/g, ' ')
    if (!live.length) return []
    const form = new FormData()
    form.append('data', new Blob([`id,address\n${live.map(({ r }, i) => `${i},"${text(r)}"`).join('\n')}\n`], { type: 'text/csv' }), 'permits.csv')
    form.append('columns', 'address')
    const placed = new Map(parseCsv(await get(`${GEOPF}/geocodage/search/csv`, { text: true, init: { method: 'POST', body: form } })).map(g => [+g.id, g]))
    return live.flatMap(({ kind, r }, i) => {
      const g = placed.get(i)
      if (!g?.longitude || !(+g.result_score >= 0.5)) return []
      return [{
        number: r.NUM_DAU ?? r.NUM_PD ?? r.NUM_PA, kind, form: r.TYPE_DAU ?? (kind === 'demolish' ? 'PD' : 'PA'), date: r.DATE_REELLE_AUTORISATION,
        // the lists type their numbers apart (a land area may come as text)
        homes: r.NB_LGT_TOT_CREES == null ? null : +r.NB_LGT_TOT_CREES, demolished: +r.NB_LGT_DEMOLIS || null, land: +r.SUPERFICIE_TERRAIN || null,
        address: g.result_label, ban: g.result_id || null, point: [+g.longitude, +g.latitude],
      }]
    }).sort((a, b) => b.date.localeCompare(a.date))
  })

  return {
    cached, cityOf,

    // Géoplateforme (ex-API Adresse): features with label, type, citycode, id (BAN: <insee>_<voie>_<number>)
    geocode: (q, { type, limit = 5 } = {}) => cached(`geocode/${encodeURIComponent(`${q}|${type ?? ''}|${limit}`)}.json`, 30, async () =>
      (await get(`${GEOPF}/geocodage/search?${new URLSearchParams({ q, limit, ...(type ? { type } : {}) })}`))?.features ?? []),
    reverse: ([lon, lat]) => cached(`reverse/${lon.toFixed(5)},${lat.toFixed(5)}.json`, 30, async () =>
      (await get(`${GEOPF}/geocodage/reverse?lon=${lon}&lat=${lat}&limit=1`))?.features?.[0] ?? null),
    // the search bar without a key: streets, addresses and places as the user types
    completion: text => get(`${GEOPF}/geocodage/completion?${new URLSearchParams({ text, maximumResponses: 8, type: 'StreetAddress,PositionOfInterest' })}`).then(d => d?.results ?? []),

    // the outline of a commune, or of an arrondissement of Paris, Lyon or Marseille
    communePolygon: insee => cached(`polygon/commune-${insee}.json`, 90, async () => {
      for (const type of ['commune-actuelle', 'arrondissement-municipal']) {
        const fc = await get(`https://geo.api.gouv.fr/communes?code=${insee}&type=${type}&format=geojson&geometry=contour&fields=nom,code`)
        if (fc?.features?.length) return { name: fc.features[0].properties.nom, geometry: fc.features[0].geometry }
      }
      return null
    }),
    // the IRIS a point is in (IGN's WFS takes the point as lat lon)
    irisAt: ([lon, lat]) => cached(`polygon/iris-${lon.toFixed(5)},${lat.toFixed(5)}.json`, 90, async () => {
      const q = new URLSearchParams({ SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', TYPENAMES: 'STATISTICALUNITS.IRIS:contours_iris', OUTPUTFORMAT: 'application/json', COUNT: 1, CQL_FILTER: `INTERSECTS(geometrie,POINT(${lat} ${lon}))` })
      const f = (await get(`${GEOPF}/wfs/ows?${q}`))?.features?.[0]
      return f ? { code: f.properties.code_iris, name: f.properties.nom_iris, geometry: f.geometry } : null
    }),
    // the IRIS of a box [w, s, e, n] (the WFS takes it as lat lon), with their commune or arrondissement and their type
    // (H: homes, A: activity, D: other, Z: a commune not split). Not kept: a map moved asks another box.
    irisIn: async bb => {
      const q = new URLSearchParams({ SERVICE: 'WFS', VERSION: '2.0.0', REQUEST: 'GetFeature', TYPENAMES: 'STATISTICALUNITS.IRIS:contours_iris', OUTPUTFORMAT: 'application/json', BBOX: `${bb[1]},${bb[0]},${bb[3]},${bb[2]}` })
      return ((await get(`${GEOPF}/wfs/ows?${q}`))?.features ?? []).map(f => ({
        code: f.properties.code_iris, name: f.properties.nom_iris, insee: f.properties.code_insee, commune: f.properties.nom_commune, kind: f.properties.type_iris, geometry: f.geometry,
      }))
    },
    // The census of IRIS (INSEE Melodi, the population census at the IRIS level): the observations of their households
    // and couples, and of their homes. Each IRIS kept 90 days; those missing asked 50 a call.
    async irisCensus(codes) {
      const key = c => `melodi/iris-${c}.json`, todo = codes.filter(c => read(key(c), 90) === undefined)
      const parts = Array.from({ length: Math.ceil(todo.length / 50) }, (_, i) => todo.slice(i * 50, i * 50 + 50))
      // two parts at a time: Melodi without a key takes a few calls a second
      for (let i = 0; i < parts.length; i += 2) await Promise.all(parts.slice(i, i + 2).map(async part => {
        const geo = part.map(c => `GEO=IRIS-${c}`).join('&')
        const [a, b] = await Promise.all(['DS_RP_MENAGES_PRINC_IRIS', 'DS_RP_LOGEMENT_PRINC_IRIS'].map(ds => get(`${MELODI}/${ds}?${geo}&maxResult=10000`)))
        const all = [...(a?.observations ?? []), ...(b?.observations ?? [])]
        for (const c of part) keep(key(c), all.filter(o => o.dimensions.GEO.endsWith(`IRIS-${c}`)))
      }))
      return Object.fromEntries(codes.map(c => [c, read(key(c), Infinity) ?? []]))
    },

    // The sales of a commune, every type, over the years geo-DVF publishes (the last five), or the last `back` years:
    // none for the Bas-Rhin, the Haut-Rhin and the Moselle, whose land register is not in DVF.
    async dvf(insee, back = 6) {
      const dep = insee.startsWith('97') ? insee.slice(0, 3) : insee.slice(0, 2), now = new Date().getFullYear()
      if (['57', '67', '68'].includes(dep)) return { sales: [], years: [], alsace_moselle: true }
      const years = await Promise.all(Array.from({ length: back + 1 }, (_, i) => now - back + i).map(y => cached(`dvf/v2-${insee}-${y}.json`, y >= now - 1 ? 30 : 180, async () => {
        const csv = await get(`https://files.data.gouv.fr/geo-dvf/latest/csv/${y}/communes/${dep}/${insee}.csv`, { text: true })
        return csv ? dvfSales(parseCsv(csv)) : []
      })))
      const sales = years.flat()
      return { sales, years: [...new Set(sales.map(s => s.date.slice(0, 4)))], alsace_moselle: false }
    },

    // The asking rent of a commune (or arrondissement) from the latest carte des loyers: € per m² a month, charges
    // included, with its 95 % range, for flats (all, 1–2 rooms, 3 rooms and more) and houses
    rent: insee => cached(`rent/${insee}.json`, 30, async () => {
      const ids = await cached('datagouv/rent-resources.json', 30, async () => {
        const found = await get(`https://www.data.gouv.fr/api/1/datasets/?${new URLSearchParams({ q: RENT.q, page_size: 20 })}`).catch(() => null)
        const d = (found?.data ?? []).map(x => ({ x, year: +x.title.match(/par commune en (\d{4})/)?.[1] })).filter(x => x.year).sort((a, b) => b.year - a.year)[0]
        const find = re => d.x.resources.find(r => re.test(r.title))?.id
        return d ? { year: d.year, flat: find(/appartement$/i), flat_small: find(/1 ou 2 pi/i), flat_large: find(/3 pi/i), house: find(/maison/i) } : RENT.fallback
      })
      const r2 = x => Math.round(x * 100) / 100
      const row = async rid => {
        const r = rid && (await tabular(rid, { INSEE_C__exact: insee }))?.data?.[0]
        return r ? { per_m2: r2(r.loypredm2), low: r2(r['lwr.IPm2']), high: r2(r['upr.IPm2']), scope: r.TYPPRED, observations: r.nbobs_com } : null
      }
      const [flat, flat_small, flat_large, house] = await Promise.all([ids.flat, ids.flat_small, ids.flat_large, ids.house].map(row))
      return { year: ids.year, flat, flat_small, flat_large, house }
    }),

    // ADEME's DPE of existing homes since July 2021: those of a BAN address, else within `radius` m of a point
    ademe: ({ ban, point, radius = 15 }) => cached(`ademe/${ban ?? point.map(x => x.toFixed(5)).join(',') + '-' + radius}.json`, 30, async () => {
      const select = 'numero_dpe,date_etablissement_dpe,etiquette_dpe,etiquette_ges,annee_construction,surface_habitable_logement,conso_5_usages_par_m2_ep,cout_total_5_usages,type_energie_principale_chauffage,complement_adresse_logement,numero_etage_appartement,numero_immatriculation_copropriete,adresse_ban,identifiant_ban,nombre_appartement,nombre_niveau_immeuble'
      const q = new URLSearchParams({ select, size: 100, sort: '-date_etablissement_dpe', ...(ban ? { qs: `identifiant_ban:"${ban}"` } : { geo_distance: `${point[0]},${point[1]},${radius}` }) })
      return (await get(`https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/lines?${q}`))?.results ?? []
    }),

    // ADEME's DPE of existing homes, counted per class, flats and houses apart: within `radius` m of a point, or in a
    // commune. One per home: the building DPE and the flats' DPE generated from them are left out.
    dpeClasses: ({ insee, point, radius }) => cached(`ademe/classes-${insee ?? `${point.map(x => x.toFixed(4)).join(',')}-${radius}`}.json`, 30, async () => {
      const q = new URLSearchParams({
        field: 'type_batiment;etiquette_dpe', agg_size: 10, type_batiment_in: 'appartement,maison', methode_application_dpe_neq: 'dpe appartement généré à partir des données DPE immeuble',
        ...(insee ? { code_insee_ban_eq: insee } : { geo_distance: `${point[0]},${point[1]},${radius}` }),
      })
      const d = await get(`https://data.ademe.fr/data-fair/api/v1/datasets/dpe03existant/values_agg?${q}`)
      const of = t => Object.fromEntries((d?.aggs?.find(a => a.value === t)?.aggs ?? []).map(a => [a.value, a.total]).sort())
      return { flat: of('appartement'), house: of('maison') }
    }),

    // ADEME's DPE of existing homes made in the last 12 months in a box [w, s, e, n], newest first, one per home as
    // above, each with its BAN address and point. Kept a week, or `days` (the dashboard server's watch reads them
    // fresher): they are the zone's news.
    recentDpe: (bb, days = 7) => lastYearDpe({ bbox: bb.join(',') }, `ademe/recent-${bb.map(x => x.toFixed(4)).join(',')}.json`, days),
    // the same in a commune (or an arrondissement): the prospection map asks each commune it shows once a week
    communeDpe: insee => lastYearDpe({ code_insee_ban_eq: insee }, `ademe/recent-${insee}.json`, 7),
    // the same at an alert's place (lib/alerts.js): a street by its BAN id, a circle, a commune (its arrondissements for
    // Paris, Lyon and Marseille), kept `days`
    placeDpe: (p, days = 7) => lastYearDpe(
      p.how === 'street' ? { identifiant_ban_starts: `${p.ban}_` } : p.how === 'radius' ? { geo_distance: `${p.point[0]},${p.point[1]},${p.radius_m}` } : { code_insee_ban_in: cityCodes(p.insee).join(',') },
      `ademe/place-${p.how === 'radius' ? `${p.point.map(x => x.toFixed(4)).join(',')}-${p.radius_m}` : p.ban ?? p.insee}.json`, days),

    // the energy audits of the last 12 months in a box, a commune and at an alert's place, as the DPE above
    recentAudits: (bb, days = 7) => lastYearAudits({ bbox: bb.join(',') }, `ademe/audits-${bb.map(x => x.toFixed(4)).join(',')}.json`, days),
    communeAudits: insee => lastYearAudits({ code_insee_ban_eq: insee }, `ademe/audits-${insee}.json`, 7),
    placeAudits: (p, days = 7) => lastYearAudits(
      p.how === 'street' ? { identifiant_ban_starts: `${p.ban}_` } : p.how === 'radius' ? { geo_distance: `${p.point[0]},${p.point[1]},${p.radius_m}` } : { code_insee_ban_in: cityCodes(p.insee).join(',') },
      `ademe/audits-place-${p.how === 'radius' ? `${p.point.map(x => x.toFixed(4)).join(',')}-${p.radius_m}` : p.ban ?? p.insee}.json`, days),
    // the building permits of the city of a commune (or arrondissement), and those at an alert's place: its street's or
    // commune's city, the city at the center of a circle
    // ponytail: a circle across two communes reads its center's only
    cityPermits,
    async placePermits(p) {
      const insee = p.how === 'street' ? p.ban.slice(0, 5) : p.how === 'commune' ? p.insee : (await this.reverse(p.point))?.properties?.citycode
      return insee ? (await cityPermits(insee)).filter(d => atPlace(p, d)) : []
    },

    // The property tax rates (taxe foncière sur le bâti, %) of the latest year: the commune's, its intercommunality's,
    // their total with the small extras (syndicates, GEMAPI…), the waste tax apart, and France's total weighted by
    // population for comparison
    tax: insee => cached(`tax/${cityOf(insee)}.json`, 90, async () => {
      const r = (await get(`${TAX}?${new URLSearchParams({ where: `insee_com='${cityOf(insee)}'`, select: 'exercice,libcom,q03,e12vote,e32vote,taux_global_tfb,taux_plein_teom', order_by: 'exercice desc', limit: 1 })}`))?.results?.[0]
      if (!r) return null
      const f = (await get(`${TAX}?${new URLSearchParams({ where: `exercice='${r.exercice}'`, select: 'sum(taux_global_tfb*mpoid)/sum(mpoid) as france', limit: 1 })}`))?.results?.[0]?.france
      return { year: +r.exercice, city: r.libcom, commune: r.e12vote, epci: r.e32vote, epci_name: r.q03, total: r.taux_global_tfb, waste: r.taux_plein_teom, france: f ? Math.round(f * 100) / 100 : null }
    }),

    // The homes authorised and started each year in a commune (or an arrondissement), from 2013, in the newest release
    // already out: DiDo lists a release before it opens it, and refuses it until then
    housing: insee => cached(`sitadel/${insee}.json`, 30, async () => {
      const files = (await get(`${SITADEL.api}/datasets/${SITADEL.dataset}`))?.datafiles ?? []
      const release = files.find(f => f.rid === SITADEL.rid)?.millesimes?.filter(m => new Date(m.date_diffusion) <= new Date()).sort((a, b) => b.millesime.localeCompare(a.millesime))[0]?.millesime
      const q = new URLSearchParams({ ...(release ? { millesime: release } : {}), COMM: `eq:${insee}`, TYPE_LGT: 'eq:Tous Logements', columns: 'ANNEE,LOG_AUT,LOG_COM' })
      const rows = await get(`${SITADEL.api}/datafiles/${SITADEL.rid}/json?${q}`)
      return { release: release ?? null, years: (rows ?? []).map(r => ({ year: +r.ANNEE, authorised: r.LOG_AUT, started: r.LOG_COM })).sort((a, b) => a.year - b.year) }
    }),

    // Géorisques: the natural and technological risks reported at a point
    georisques: ([lon, lat]) => cached(`georisques/${lon.toFixed(5)},${lat.toFixed(5)}.json`, 90, async () => {
      const r = await get(`https://georisques.gouv.fr/api/v1/resultats_rapport_risque?latlon=${lon},${lat}`)
      if (!r) return null
      const list = o => Object.entries(o ?? {}).filter(([, v]) => v.present).map(([k, v]) => ({ key: k, label: v.libelle }))
      return { natural: list(r.risquesNaturels), technological: list(r.risquesTechnologiques), url: r.url }
    }),

    // the registered condominiums within `radius` m of a point, nearest first (registre national, updated daily)
    async rnic([lon, lat], radius = 40) {
      const rid = await resourceOf(RNIC.dataset, RNIC.title, RNIC.fallback), dLat = radius / 111320, dLon = dLat / Math.cos((lat * Math.PI) / 180)
      return cached(`rnic/${lon.toFixed(5)},${lat.toFixed(5)}-${radius}.json`, 30, async () => {
        const d = await tabular(rid, { longitude__greater: lon - dLon, longitude__less: lon + dLon, latitude__greater: lat - dLat, latitude__less: lat + dLat })
        return (d?.data ?? []).map(x => ({
          number: x.numero_immatriculation, name: x.nom_usage_copropriete, address: x.adresse_reference, lots: x.nombre_total_lots,
          dwellings: x.nombre_lots_habitation, parking: x.nombre_lots_stationnement, period: x.periode_construction, syndic: x.type_syndic,
          syndic_name: x.raison_sociale_representant_legal, registered: x.date_immatriculation, point: [x.longitude, x.latitude],
        })).sort((a, b) => Math.hypot(a.point[0] - lon, a.point[1] - lat) - Math.hypot(b.point[0] - lon, b.point[1] - lat))
      })
    },

    // shops, schools, transport, parks… in a box [w, s, e, n], one point per place
    overpass: bb => cached(`overpass/${bb.map(x => x.toFixed(4)).join(',')}.json`, 30, async () => {
      const box = `(${bb[1]},${bb[0]},${bb[3]},${bb[2]})`
      const parts = Object.values(POI).map(([k, re]) => `nwr[${k}~"${re.source}"]${k === 'leisure' ? '[access!=private]' : ''}${box};`).join('')
      const d = await get('https://overpass-api.de/api/interpreter', { init: { method: 'POST', body: new URLSearchParams({ data: `[out:json][timeout:40];(${parts});out center tags;` }) } })
      return (d?.elements ?? []).flatMap(e => {
        const cat = Object.entries(POI).find(([, [k, re]]) => re.test(e.tags?.[k] ?? ''))?.[0], lon = e.lon ?? e.center?.lon, lat = e.lat ?? e.center?.lat
        return cat && lon ? [{ cat, kind: e.tags.shop ?? e.tags.amenity ?? e.tags.railway ?? e.tags.leisure ?? 'bus_stop', name: e.tags.name ?? null, point: [lon, lat] }] : []
      })
    }),

    // the area reachable from a point in `minutes`, on foot (pedestrian) or by car
    isochrone: ([lon, lat], profile, minutes) => cached(`isochrone/${lon.toFixed(5)},${lat.toFixed(5)}-${profile}-${minutes}.json`, 90, async () => {
      const q = new URLSearchParams({ resource: 'bdtopo-valhalla', point: `${lon},${lat}`, costType: 'time', costValue: minutes * 60, profile, timeUnit: 'second', geometryFormat: 'geojson' })
      return (await get(`${GEOPF}/navigation/isochrone?${q}`))?.geometry ?? null
    }),

    // Crimes recorded by police and gendarmerie (SSMSI), the latest year: per thousand inhabitants (or homes for
    // burglaries) of the commune, its department's for comparison. Small numbers are not published.
    async crime(insee, dep) {
      const latest = rows => { const y = Math.max(...rows.map(r => r.annee)); return { year: y, rows: rows.filter(r => r.annee === y).map(r => ({ indicator: r.indicateur, count: r.nombre, rate: r.taux_pour_mille })) } }
      return cached(`ssmsi/${insee}.json`, 30, async () => {
        const com = await resourceOf(SSMSI.dataset, SSMSI.com, SSMSI.fallback.com), depRid = await resourceOf(SSMSI.dataset, SSMSI.dep, SSMSI.fallback.dep)
        // the commune code's column carries the geography's year (CODGEO_2026)
        const col = Object.keys((await tabular(com, { page_size: 1 }))?.data?.[0] ?? {}).find(k => /^CODGEO/.test(k))
        const own = (await tabular(com, { [`${col}__exact`]: insee, annee__sort: 'desc', page_size: 40 }))?.data ?? []
        const of = (await tabular(depRid, { Code_departement__exact: dep, annee__sort: 'desc', page_size: 40 }))?.data ?? []
        return { commune: own.length ? latest(own) : null, department: of.length ? latest(of) : null }
      })
    },

    // INSEE Filosofi: the median standard of living (€ a year) and the poverty rate of a geography (COM-<insee>,
    // ARM-<insee> for an arrondissement, DEP-<dep>, FRANCE-FM); IRIS is not published here
    income: geo => cached(`filosofi/${geo}.json`, 90, async () => {
      const d = await get(`https://api.insee.fr/melodi/data/DS_FILOSOFI_CC?GEO=${geo}&maxResult=50`).catch(() => null)
      const v = m => d?.observations?.find(o => o.dimensions.FILOSOFI_MEASURE === m)?.measures?.OBS_VALUE_NIVEAU?.value ?? null
      return d ? { geo, year: d.observations?.[0]?.dimensions?.TIME_PERIOD ?? null, median: v('MED_SL'), poverty: v('PR_MD60'), d1: v('D1_SL'), d9: v('D9_SL') } : null
    }),
  }
}
