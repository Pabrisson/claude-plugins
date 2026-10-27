// The network smoke test, run only with IMMO_LIVE=1: a real search rue Paul Bert (Lyon 3e) on the open data and,
// with STREAM_ESTATE_API_KEY, Stream Estate at the lowest cost: a count (free), then ONE listing (1 credit).
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ENGINE } from './helpers.js'

const live = process.env.IMMO_LIVE === '1'
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'immo-live-'))
const run = argv => spawnSync(process.execPath, [ENGINE, ...argv], { env: { ...process.env, IMMO_DIR: home }, encoding: 'utf8', timeout: 180000 })
const read = f => JSON.parse(fs.readFileSync(path.join(home, 'rue-paul-bert-69003-lyon', f), 'utf8'))

test('open data: zone, DVF, shops, crime, income, risks', { skip: !live && 'IMMO_LIVE=1 runs it' }, () => {
  fs.writeFileSync(path.join(home, '.profile.json'), JSON.stringify({ places: [{ label: 'Travail', address: 'Place Bellecour 69002 Lyon', point: [4.8320, 45.7578] }] }))
  const r = run(['search', 'rue Paul Bert, Lyon 3e', '--radius', '400', '--mode', 'classic'])
  assert.equal(r.status, 0, r.stderr)
  const s = read('search.json'), m = read('market.json'), a = read('area.json')
  assert.deepEqual([s.insee, s.street.code_voie, s.mode], ['69383', '5245', 'classic'])
  assert.ok(m.dvf.commune.count > 1000 && m.dvf.street.count > 20, 'five years of sales in Lyon 3e')
  assert.ok(m.dvf.zone.median_ppm2 > 2500 && m.dvf.zone.median_ppm2 < 8000)
  assert.ok(Array.isArray(a.pois) && a.pois.some(p => p.cat === 'transport'), JSON.stringify(a.pois).slice(0, 200))
  assert.ok(a.crime.commune.rows.length > 5 && a.income.local.median > 0 && a.risks.natural.length > 0)
  assert.equal(a.isochrones.length, 3)
  assert.ok(a.isochrones.every(i => i.geometry?.type))
})

test('Stream Estate: a free count, then one listing for 1 credit', { skip: (!live || !process.env.STREAM_ESTATE_API_KEY) && 'IMMO_LIVE=1 and the key run it' }, () => {
  let r = run(['search', '-p', 'rue-paul-bert-69003-lyon', '--mode', 'stream-estate'])
  assert.equal(r.status, 0, r.stderr)
  assert.ok(read('search.json').stream.total >= 0)
  r = run(['fetch', '-p', 'rue-paul-bert-69003-lyon', '--max', '1', '--spend', '1'])
  assert.equal(r.status, 0, r.stderr)
  const log = JSON.parse(fs.readFileSync(path.join(home, '.cache/api-usage.json'), 'utf8'))
  assert.deepEqual(log.map(e => e.credits), [0, 0, 1], 'X-Credits-Charged: the counts are free, the listing costs 1')
  console.log(run(['usage', '--remote']).stdout)
})
