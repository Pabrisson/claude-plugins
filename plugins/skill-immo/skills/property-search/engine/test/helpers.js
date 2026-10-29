// A throwaway searches folder with one search rue Paul Bert, its open data cache filled (no network), and a fake
// Stream Estate API v1 that answers from the fixture property (a v1 PropertyDocument).
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bbox } from '../lib/geo.js'

export const ENGINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'immo.mjs')
export const property = JSON.parse(fs.readFileSync(new URL('./fixtures/se-property.json', import.meta.url), 'utf8'))

export function searchesFolder(mode = 'stream-estate') {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'immo-')), dir = path.join(home, 'paul-bert')
  fs.mkdirSync(dir)
  const point = [4.8455, 45.756]
  fs.writeFileSync(path.join(dir, 'search.json'), JSON.stringify({
    slug: 'paul-bert', query: 'rue Paul Bert, Lyon 3e', label: 'Rue Paul Bert 69003 Lyon', created: '2026-10-27T10:00:00.000Z', type: 'street', point,
    insee: '69383', city: 'Lyon', postcode: '69003', dep: '69', street: { name: 'Rue Paul Bert', code_voie: '5245' }, ban: '69383_5245', mode,
    zone: { how: 'radius', kind: 'radius', center: point, radius_m: 500, label: '500 m autour de Rue Paul Bert 69003 Lyon' },
    criteria: { rooms_min: 3 }, max: 100, stream: null, last_fetch: null, last_refresh: null, last_visit: null, alert: null,
  }))
  const cache = (rel, v) => { fs.mkdirSync(path.dirname(path.join(home, '.cache', rel)), { recursive: true }); fs.writeFileSync(path.join(home, '.cache', rel), JSON.stringify(v)) }
  const y = new Date().getFullYear()
  for (let k = y - 6; k <= y; k++) cache(`dvf/v2-69383-${k}.json`, [])
  cache('georisques/4.84550,45.75600.json', { natural: [{ key: 'seisme', label: 'Séisme' }], technological: [], url: null })
  const zone = { kind: 'radius', center: point, radius_m: 500 }
  cache(`overpass/${bbox(zone, 600).map(x => x.toFixed(4)).join(',')}.json`, [{ cat: 'transport', kind: 'tram_stop', name: 'Guillotière - Gabriel Péri', point: [4.8425387, 45.7549452] }])
  cache('ssmsi/69383.json', { commune: { year: 2025, rows: [{ indicator: 'Cambriolages de logement', count: 420, rate: 6.73 }] }, department: null })
  for (const [geo, median] of [['ARM-69383', 30190], ['DEP-69', 27500], ['FRANCE-FM', 25920]]) cache(`filosofi/${geo}.json`, { geo, year: '2023', median, poverty: 16 })
  cache('polygon/iris-4.84550,45.75600.json', { code: '693830201', name: 'Moncey', geometry: null })
  // the carte des loyers 2025 of Lyon 3e, as the tabular API answered on 2026-10-27
  cache('rent/69383.json', { year: 2025, flat: { per_m2: 16.4, low: 12.82, high: 20.98, scope: 'commune', observations: 30256 }, flat_small: { per_m2: 18.87, low: 14.58, high: 24.43, scope: 'commune', observations: 19582 }, flat_large: { per_m2: 15.22, low: 11.75, high: 19.71, scope: 'commune', observations: 10876 }, house: { per_m2: 17.89, low: 12.4, high: 25.8, scope: 'commune', observations: 252 } })
  // the commune's context, as ADEME, the DGFiP and the SDES answered on 2026-10-27
  cache('ademe/classes-4.8455,45.7560-500.json', { flat: { A: 12, B: 160, C: 2480, D: 1400, E: 650, F: 190, G: 80 }, house: { C: 6, D: 3 } })
  cache('tax/69123.json', { year: 2025, city: 'LYON', commune: 31.89, epci: 0.55, epci_name: 'Métropole de Lyon', total: 32.82, waste: 5.19, france: 43.13 })
  cache('sitadel/69383.json', { release: '2026-09', years: [{ year: 2023, authorised: 75, started: 12 }, { year: 2024, authorised: 81, started: 61 }, { year: 2025, authorised: 174, started: null }] })
  // the recent DPE of the zone's box: two in the zone, one in its corner, outside the 500 m
  const ago = d => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
  cache(`ademe/recent-${bbox(zone).map(x => x.toFixed(4)).join(',')}.json`, [
    { number: '2669E0000001A', date: ago(10), energy: 'E', type: 'flat', area: 40, address: '10 Rue Paul Bert 69003 Lyon', ban: '69383_5245_00010', point: [4.846, 45.7565] },
    { number: '2669E0000002B', date: ago(40), energy: 'G', type: 'house', area: 120, address: null, ban: null, point: [4.844, 45.7555] },
    { number: '2669E0000003C', date: ago(5), energy: 'C', type: 'flat', area: 70, address: null, ban: null, point: [4.8392, 45.7516] },
  ])
  // its energy audits (one in the zone) and Lyon's building permits (one in the zone, one in the 9e)
  cache(`ademe/audits-${bbox(zone).map(x => x.toFixed(4)).join(',')}.json`, [
    { number: 'A26690000001A', date: ago(20), energy: 'F', type: 'house', building: false, area: 90, period: 'avant 1948', address: '12 Rue Paul Bert 69003 Lyon', ban: '69383_5245_00012', point: [4.8462, 45.7562] },
  ])
  cache('sitadel/permits-69123.json', [
    { number: 'PD06912326V0001', kind: 'demolish', form: 'PD', date: ago(60), homes: null, demolished: null, land: 400, address: '14 Rue Paul Bert 69003 Lyon', ban: '69383_5245_00014', point: [4.8458, 45.7561] },
    { number: 'PC06912325V0002', kind: 'build', form: 'PC', date: ago(200), homes: 21, demolished: null, land: 3000, address: '3 Avenue de Ménival 69005 Lyon', ban: '69385_4710_00003', point: [4.787, 45.751] },
  ])
  return { home, dir }
}

// the fake API v1: state.price changes the property's price, state.total the number of matches, state.broke answers
// 402. What it matches is online (an expired=true query matches none) and not excluded. On a free port, or `port`
// (test/demo.mjs).
export async function fakeStreamEstate(state = {}, port = 0) {
  const seen = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', c => (body += c))
    req.on('end', () => {
      const url = new URL(req.url, 'http://x'), q = url.searchParams, json = body ? JSON.parse(body) : null
      seen.push({ method: req.method, path: url.pathname, query: q, body: json, key: req.headers['x-api-key'], accept: req.headers.accept })
      const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/ld+json' }); res.end(data == null ? '' : JSON.stringify(data)) }
      if (state.broke) return send(402, { title: 'Payment Required' })
      if (req.method === 'GET' && url.pathname === '/documents/properties') {
        const total = q.get('expired') === 'true' || q.getAll('excludedProperties[]').includes(property.uuid) ? 0 : state.total ?? 1
        const size = +q.get('itemsPerPage'), from = (+(q.get('page') ?? 1) - 1) * size
        const member = Array.from({ length: Math.max(0, Math.min(size, total - from)) }, () => ({ ...property, price: state.price ?? property.price }))
        return send(200, { '@type': 'hydra:Collection', 'hydra:member': member, 'hydra:totalItems': total })
      }
      if (req.method === 'GET' && url.pathname === '/indicators/price_per_meter') return send(200, [{ average: 4900, median: 4800, series: { '2026-09': 4750, '2026-10': 4820 } }])
      if (req.method === 'DELETE' && url.pathname.startsWith('/searches/')) return send(204, null)
      send(404, { title: 'Not found' })
    })
  })
  await new Promise(ok => server.listen(port, '127.0.0.1', ok))
  return { url: `http://127.0.0.1:${server.address().port}`, seen, state, close: () => server.close() }
}
