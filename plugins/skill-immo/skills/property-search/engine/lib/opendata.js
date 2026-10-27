// The free open data (references/data-sources.md), each answer kept in the searches folder's .cache/ for its TTL.
// Every source is public and keyless; Overpass asks for a User-Agent that names the client.
import fs from 'node:fs'
import path from 'node:path'
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
const sleep = t => new Promise(ok => setTimeout(ok, t))

export function openData(cacheDir) {
  // an answer kept `days` days under .cache/<key>; a failed fetch is not kept
  async function cached(key, days, fetcher) {
    const file = path.join(cacheDir, key), st = fs.statSync(file, { throwIfNoEntry: false })
    if (st && Date.now() - st.mtimeMs < days * 86400000) return JSON.parse(fs.readFileSync(file, 'utf8'))
    const value = await fetcher()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value))
    return value
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

  return {
    cached,

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

    // The sales of a commune, every type, over the years geo-DVF publishes (the last five): none for the Bas-Rhin,
    // the Haut-Rhin and the Moselle, whose land register is not in DVF.
    async dvf(insee) {
      const dep = insee.startsWith('97') ? insee.slice(0, 3) : insee.slice(0, 2), now = new Date().getFullYear()
      if (['57', '67', '68'].includes(dep)) return { sales: [], years: [], alsace_moselle: true }
      const years = await Promise.all(Array.from({ length: 7 }, (_, i) => now - 6 + i).map(y => cached(`dvf/v2-${insee}-${y}.json`, y >= now - 1 ? 30 : 180, async () => {
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
