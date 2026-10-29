import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { mock } from 'node:test'
import { openData } from '../lib/opendata.js'

// ADEME's energy audits and Sitadel's permits, shaped as they answered on 2026-10-29 around rue Paul Bert, served by a
// fake fetch; the BAN's CSV geocoding answers each address it is sent, but the one it cannot place
const AUDIT = { n_audit: 'A26690214962L', date_etablissement_audit: '2026-09-30', classe_bilan_dpe: 'F', methode_application_dpe: 'dpe immeuble collectif chauffage collectif ecs individuel', surface_habitable_logement: null, surface_habitable_immeuble: 531.67, periode_constuction: 'avant 1948', adresse_ban: '262bis Rue Paul Bert 69003 Lyon', identifiant_ban: '69383_5245_00262_bis', _geopoint: '45.75651500867119,4.869013032673383' }
const ROW = { ADR_NUM_TER: '18', ADR_LIBVOIE_TER: 'AVENUE DU CHAÃ\x82Â\x82TEAU', ADR_CODPOST_TER: '69003', ADR_LOCALITE_TER: 'LYON', SUPERFICIE_TERRAIN: 420 }
const BUILD = [
  { ...ROW, NUM_DAU: 'DP06912326V0001', TYPE_DAU: 'DP', ETAT_DAU: 2, DATE_REELLE_AUTORISATION: '2026-03-17', NB_LGT_TOT_CREES: 1, NB_LGT_DEMOLIS: 0 },
  { ...ROW, NUM_DAU: 'PC06912326V0002', TYPE_DAU: 'PC', ETAT_DAU: 4, DATE_REELLE_AUTORISATION: '2026-03-10', NB_LGT_TOT_CREES: 40 },
]
const DEMOLISH = [{ ...ROW, NUM_PD: 'PD06912326V0003', ETAT_PD: 2, DATE_REELLE_AUTORISATION: '2026-09-29', ADR_NUM_TER: '999', ADR_LIBVOIE_TER: 'RUE INCONNUE' }]
const asked = []
let posted = ''
mock.method(globalThis, 'fetch', async (url, init) => {
  const u = new URL(String(url))
  asked.push(u)
  if (u.pathname.includes('ync2epx48x9azbdnggbygqp0/lines')) return Response.json({ total: 1, results: [AUDIT, { ...AUDIT, n_audit: 'X', _geopoint: null }] })
  if (u.host === 'tabular-api.data.gouv.fr') {
    // the build list in two pages, the demolitions in one, no plot
    const page = +u.searchParams.get('page'), build = u.pathname.includes('65a9e264')
    const data = build ? [BUILD[page - 1]] : u.pathname.includes('8f73cf2d') ? DEMOLISH : []
    return Response.json({ data, links: { next: build && page === 1 ? 'next' : null }, meta: { page } })
  }
  if (u.pathname === '/geocodage/search/csv') {
    posted = await init.body.get('data').text()
    const lines = posted.trim().split('\n').slice(1)
    return new Response(`id,address,longitude,latitude,result_score,result_label,result_id\n${lines.map(l => {
      const [id] = l.split(','), unknown = l.includes('INCONNUE')
      return `${id},x,4.8601,45.7561,${unknown ? 0.3 : 0.92},18 Avenue du Château 69003 Lyon,69383_1730_00018`
    }).join('\n')}\n`)
  }
  return new Response('', { status: 404 })
})
const od = openData(fs.mkdtempSync(path.join(os.tmpdir(), 'immo-sources-')))

test('the energy audits of a box: their initial state, the last 12 months, a whole building with its own surface', async () => {
  const rows = await od.recentAudits([4.84, 45.75, 4.88, 45.76])
  assert.deepEqual(rows, [{ number: 'A26690214962L', date: '2026-09-30', energy: 'F', type: 'flat', building: true, area: 531.67, period: 'avant 1948', address: '262bis Rue Paul Bert 69003 Lyon', ban: '69383_5245_00262_bis', point: [4.869013032673383, 45.75651500867119] }])
  const q = asked.findLast(u => u.pathname.includes('/lines')).searchParams
  assert.deepEqual([q.get('bbox'), q.get('categorie_scenario_eq'), q.get('sort')], ['4.84,45.75,4.88,45.76', 'état initial', '-date_etablissement_audit'])
  // at an alert's place: a street by its BAN id, Lyon by its arrondissements
  await od.placeAudits({ how: 'street', ban: '69383_5245' })
  assert.equal(asked.findLast(u => u.pathname.includes('/lines')).searchParams.get('identifiant_ban_starts'), '69383_5245_')
  await od.placeAudits({ how: 'commune', insee: '69123' })
  assert.match(asked.findLast(u => u.pathname.includes('/lines')).searchParams.get('code_insee_ban_in'), /^69381,69382,.*69389$/)
})

test("the permits of Lyon's 3e: the city's lists paged, the cancelled one left out, placed in one call, the unplaced dropped", async () => {
  const rows = await od.cityPermits('69383')
  assert.deepEqual(rows, [{ number: 'DP06912326V0001', kind: 'build', form: 'DP', date: '2026-03-17', homes: 1, demolished: null, land: 420, address: '18 Avenue du Château 69003 Lyon', ban: '69383_1730_00018', point: [4.8601, 45.7561] }])
  const lists = asked.filter(u => u.host === 'tabular-api.data.gouv.fr')
  assert.ok(lists.every(u => u.searchParams.get('COMM__exact') === '69123'), 'Lyon files its permits under the city')
  assert.equal(lists.filter(u => u.pathname.includes('65a9e264')).length, 2, 'two pages')
  // the garbled accents dropped before the BAN reads the address; one call for every permit
  assert.equal(asked.filter(u => u.pathname === '/geocodage/search/csv').length, 1)
  assert.match(posted, /^0,"18 AVENUE DU CHATEAU 69003 LYON"$/m)
  // the city's list is kept: another arrondissement asks nothing more
  const n = asked.length
  await od.cityPermits('69387')
  assert.equal(asked.length, n)
  // at an alert's place: the permits of its street's city on that street
  assert.equal((await od.placePermits({ how: 'street', ban: '69383_1730' })).length, 1)
  assert.equal((await od.placePermits({ how: 'street', ban: '69383_5245' })).length, 0)
})
