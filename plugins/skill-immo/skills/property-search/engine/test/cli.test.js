import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { band, bbox, center } from '../lib/geo.js'
import { decodePng, encodePng, frame, SIZE } from '../lib/preview.js'
import { ENGINE, fakeStreamEstate, property, searchesFolder } from './helpers.js'

const api = await fakeStreamEstate()
test.after(() => api.close())

// immo.mjs in a searches folder, with or without the key (async: the fake API lives in this process)
const run = (home, argv, { key = 'test-key' } = {}) => new Promise(ok => {
  const env = { ...process.env, IMMO_DIR: home, STREAM_ESTATE_BASE: api.url, STREAM_ESTATE_API_KEY: key ?? '' }
  if (!key) delete env.STREAM_ESTATE_API_KEY
  const p = spawn(process.execPath, [ENGINE, ...argv], { env })
  let out = '', err = ''
  p.stdout.on('data', d => (out += d))
  p.stderr.on('data', d => (err += d))
  p.on('close', status => ok({ status, out, err }))
})
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))

test('a fetch waits for the user: estimate, then --spend; the credits are logged', async () => {
  const { home, dir } = searchesFolder()
  let r = await run(home, ['fetch', '-p', 'paul-bert'])
  assert.equal(r.status, 2)
  assert.match(r.err, /estimated 1 credits \(0,01 €\).*--spend 1/)
  r = await run(home, ['fetch', '-p', 'paul-bert', '--estimate'])
  assert.deepEqual(JSON.parse(r.out), { what: 'fetch 1 of 1 listings', route: 'GET /documents/properties', credits: 1, eur: 0.01, unknown: false, spent: 0, cap: 500, remaining: 500 })
  r = await run(home, ['fetch', '-p', 'paul-bert', '--spend', '1'])
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /fetched 1 listings: 1 new/)
  const [l] = read(dir, 'listings.json')
  assert.deepEqual([l.id, l.price, l.first_seen.slice(0, 4), l.building.risks.natural[0].key], [property.uuid, 280000, String(new Date().getFullYear()), 'seisme'])
  // the counts cost nothing, the fetch one credit per item
  assert.deepEqual(read(home, '.cache/api-usage.json').map(e => e.credits), [0, 0, 0, 1])
  // the v1 query: the zone, the type, the criteria, what is online; a page of exactly what was paid for
  const q = api.seen.findLast(x => x.query?.get('itemsPerPage') === '1').query
  assert.deepEqual(['propertyTypes[]', 'transactionType', 'lat', 'lon', 'radius', 'roomMin', 'expired', 'page', 'order[updatedAt]'].map(k => q.getAll(k).join()), ['0', '0', '45.756', '4.8455', '0.5', '3', 'false', '1', 'desc'])
  // online: updated within 90 days (the v1 leaves most of what left the portals unexpired)
  assert.equal(q.get('fromUpdatedAt'), new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10))
  // the property already fetched is left out of the next count
  await run(home, ['fetch', '-p', 'paul-bert', '--estimate'])
  assert.deepEqual(api.seen.findLast(x => x.query?.get('itemsPerPage') === '0').query.getAll('excludedProperties[]'), [property.uuid])
  assert.equal(api.seen.at(-1).key, 'test-key')
})

test('reread: the listings online read again one by one, a credit each, logged; one Stream Estate deleted expires', async () => {
  const { home, dir } = searchesFolder()
  assert.equal((await run(home, ['fetch', '-p', 'paul-bert', '--spend', '1'])).status, 0)
  let r = await run(home, ['reread', '-p', 'paul-bert', '--estimate'])
  assert.deepEqual(JSON.parse(r.out), { what: 'reread 1 listings', route: 'GET /documents/properties/{id}', credits: 1, eur: 0.01, unknown: false, spent: 1, cap: 500, remaining: 499 })
  r = await run(home, ['reread', '-p', 'paul-bert', '--spend', '1', '--id', property.uuid])
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /reread 1 listings: 0 new.*0 expired; 1 photos/)
  assert.deepEqual(read(home, '.cache/api-usage.json').at(-1), { ...read(home, '.cache/api-usage.json').at(-1), route: 'GET /documents/properties/{id}', credits: 1, results: 1, search: 'paul-bert' })
  api.state.deleted = [property.uuid]
  try { r = await run(home, ['reread', '-p', 'paul-bert', '--spend', '1']) } finally { delete api.state.deleted }
  assert.match(r.out, /1 expired/)
  assert.equal(read(dir, 'listings.json')[0].status, 'EXPIRED')
  // a dropped one is read again with --id only
  fs.writeFileSync(path.join(dir, 'listings.json'), JSON.stringify(read(dir, 'listings.json').map(l => ({ ...l, status: 'AVAILABLE', my_status: 'dropped' }))))
  assert.match((await run(home, ['reread', '-p', 'paul-bert'])).out, /no Stream Estate listing/)
  fs.writeFileSync(path.join(dir, 'listings.json'), JSON.stringify(read(dir, 'listings.json').map(l => ({ ...l, status: 'EXPIRED' }))))
  // nothing left online: nothing to read, nothing paid
  assert.match((await run(home, ['reread', '-p', 'paul-bert'])).out, /no Stream Estate listing/)
})

test('hundreds fetched: left out over windows of creation dates, so never counted nor paid again', async () => {
  const { home, dir } = searchesFolder(), file = path.join(dir, 'search.json')
  // a zone drawn on the map: its 60 corners leave the least room in the URL
  const ring = Array.from({ length: 61 }, (_, i) => [4.8455 + 0.004 * Math.cos(i * Math.PI / 30), 45.756 + 0.003 * Math.sin(i * Math.PI / 30)])
  fs.writeFileSync(file, JSON.stringify({ ...read(dir, 'search.json'), zone: { how: 'drawn', kind: 'polygon', geometry: { type: 'Polygon', coordinates: [ring] }, label: 'Zone dessinée sur la carte' } }))
  // 300 fetched, an hour apart, two of them in the same second; the older half fetched before 1.19 (published_at only)
  const hour = i => new Date(Date.parse('2026-10-31T12:00:00Z') - Math.max(0, i - 1) * 3600000).toISOString()
  const props = Array.from({ length: 300 }, (_, i) => ({ ...property, uuid: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, createdAt: hour(i) }))
  const known = props.map((p, i) => ({ id: p.uuid, se_id: p.uuid, source: 'stream-estate', urls: [], price: p.price, status: 'AVAILABLE', ...(i < 150 ? { se_created_at: p.createdAt } : {}), published_at: p.createdAt }))
  fs.writeFileSync(path.join(dir, 'listings.json'), JSON.stringify(known))
  // two new ones: just out, and one older than the oldest fetched
  const fresh = [['1', '2026-11-01T08:00:00Z'], ['2', '2026-01-01T08:00:00Z']].map(([n, createdAt]) => ({ ...property, uuid: `ffffffff-0000-4000-8000-00000000000${n}`, createdAt, adverts: property.adverts.map(a => ({ ...a, url: `${a.url}/${n}` })) }))
  api.state.properties = [...props, ...fresh]
  try {
    const at = api.seen.length
    let r = await run(home, ['fetch', '-p', 'paul-bert', '--estimate'])
    assert.equal(r.status, 0, r.err)
    assert.equal(JSON.parse(r.out).what, 'fetch 2 of 2 listings')
    const calls = api.seen.slice(at)
    assert.ok(calls.some(x => x.query.get('fromDate')) && calls.some(x => x.query.get('toDate')), 'several windows')
    assert.ok(calls.every(x => x.url.length < 9000), 'every URL under 9 kB')
    r = await run(home, ['fetch', '-p', 'paul-bert', '--spend', '2'])
    assert.equal(r.status, 0, r.err)
    assert.match(r.out, /fetched 2 listings: 2 new/)
    assert.deepEqual(read(dir, 'listings.json').slice(-2).map(l => [l.id, l.se_created_at]), fresh.map(p => [p.uuid, p.createdAt]))
    // nothing new: nothing to fetch
    r = await run(home, ['fetch', '-p', 'paul-bert', '--estimate'])
    assert.match(r.out, /no new listing matches/)
    assert.equal(read(dir, 'search.json').stream.total, 0)
    // a fetched one dated wrong is out of its window: the free check refuses before any credit
    fs.writeFileSync(path.join(dir, 'listings.json'), JSON.stringify(read(dir, 'listings.json').map(l => (l.id === props[200].uuid ? { ...l, published_at: '2026-10-31T11:00:00Z' } : l))))
    const before = api.seen.length
    r = await run(home, ['fetch', '-p', 'paul-bert', '--spend', '1'])
    assert.equal(r.status, 1)
    assert.match(r.err, /1 of the 1 listings counted are already in the search/)
    assert.ok(api.seen.slice(before).every(x => x.query.get('itemsPerPage') === '0'), 'no paid call')
  } finally { delete api.state.properties }
})

test('refresh: what changed since the last one, a price drop logged', async () => {
  const { home, dir } = searchesFolder()
  await run(home, ['fetch', '-p', 'paul-bert', '--spend', '1'])
  api.state.price = 265000
  const r = await run(home, ['refresh', '-p', 'paul-bert', '--spend', '1'])
  delete api.state.price
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /1 price drops/)
  assert.match(r.out, /price_drop: 280000 → 265000/)
  // what changed and is online, then what expired since
  const [changed, gone] = api.seen.filter(x => x.query?.get('itemsPerPage') === '0').slice(-2).map(x => x.query)
  assert.ok(changed.get('fromUpdatedAt') && changed.get('expired') === 'false' && gone.get('fromExpiredAt') && gone.get('expired') === 'true')
  assert.deepEqual(read(dir, 'listings.json')[0].price_history.map(h => h.price), [280000, 265000])
  // dropped (« Écarté »), it is left out of the refresh: nothing to pay, its price stays
  fs.writeFileSync(path.join(dir, 'listings.json'), JSON.stringify(read(dir, 'listings.json').map(l => ({ ...l, my_status: 'dropped' }))))
  api.state.price = 250000
  const again = await run(home, ['refresh', '-p', 'paul-bert'])
  delete api.state.price
  assert.equal(again.status, 0, again.err)
  assert.match(again.out, /refresh: 0 changed/)
  assert.deepEqual(api.seen.findLast(x => x.query?.get('itemsPerPage') === '0').query.getAll('excludedProperties[]'), [property.uuid])
  assert.equal(read(dir, 'listings.json')[0].price, 265000)
})

test('the recent DPE of the zone: kept in area.json, those without a listing, the new ones at the next refresh', async () => {
  const { home, dir } = searchesFolder('classic')
  let r = await run(home, ['search', '-p', 'paul-bert'], { key: null })
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /recent DPE \(12 months\): 2, 2 without a listing\n/)
  assert.deepEqual(read(dir, 'area.json').dpe_recent.map(d => d.number), ['2669E0000001A', '2669E0000002B'])
  const file = fs.readdirSync(path.join(home, '.cache/ademe')).find(f => f.startsWith('recent-')), rows = read(home, `.cache/ademe/${file}`)
  fs.writeFileSync(path.join(home, '.cache/ademe', file), JSON.stringify([{ ...rows[0], number: '2669E0000004D' }, ...rows]))
  r = await run(home, ['refresh', '-p', 'paul-bert'], { key: null })
  assert.match(r.out, /recent DPE \(12 months\): 3, 3 without a listing, 1 new since the last refresh/)
  // the new one is news: a flat, as the search's type
  assert.deepEqual(read(dir, 'feed.json').items.map(n => n.dpe.number), ['2669E0000004D'])
})

test("the zone's energy audits and building permits: kept in area.json, the new ones news at the next refresh", async () => {
  const { home, dir } = searchesFolder('classic')
  let r = await run(home, ['search', '-p', 'paul-bert'], { key: null })
  assert.match(r.out, /^energy audits \(12 months\): 1$/m)
  assert.match(r.out, /^building permits \(12 months\): 1$/m, "Lyon's permit in the 9e is outside the zone")
  const add = (f, row) => fs.writeFileSync(path.join(home, '.cache', f), JSON.stringify([row, ...read(home, `.cache/${f}`)]))
  const audits = `ademe/${fs.readdirSync(path.join(home, '.cache/ademe')).find(f => f.startsWith('audits-'))}`, [a] = read(home, `.cache/${audits}`)
  add(audits, { ...a, number: 'A26690000002B', building: true })
  add('sitadel/permits-v2-69123.json', { ...read(home, '.cache/sitadel/permits-v2-69123.json')[0], number: 'PC06912326V0009', kind: 'build', homes: 8 })
  r = await run(home, ['refresh', '-p', 'paul-bert'], { key: null })
  assert.match(r.out, /energy audits \(12 months\): 2, 1 new since the last refresh/)
  assert.match(r.out, /building permits \(12 months\): 2, 1 new since the last refresh/)
  assert.deepEqual(read(dir, 'feed.json').items.map(n => [n.kind, n[n.kind].number]), [['audit', 'A26690000002B'], ['permit', 'PC06912326V0009']])
})

test("the account: unknown to the API; the console's € deposited and items, money added, less what the log spent since", async () => {
  const { home } = searchesFolder()
  let r = await run(home, ['doctor'])
  assert.match(r.out, /^account: unknown \(the API does not give it/m)
  assert.equal((await run(home, ['costs', 'account', '5', 'lots'])).status, 1)
  assert.match((await run(home, ['costs', 'topup', '30'])).err, /the account is unknown/)
  // 5 € deposited, 4 items returned: 4,96 € left, 496 items
  r = await run(home, ['costs', 'account', '5', '4'])
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /about 4,96 € left \(496 items\)/)
  // 30 € added, then one item fetched
  assert.match((await run(home, ['costs', 'topup', '30'])).out, /about 34,96 € left \(3\u202f496 items\), 35,00 € deposited/)
  await run(home, ['fetch', '-p', 'paul-bert', '--spend', '1'])
  assert.match((await run(home, ['doctor'])).out, /^account: about 34,95 € left \(3\u202f495 items\): 35,00 € deposited, 4 items on the console on \d{4}-\d\d-\d\d, 1 since in the log$/m)
})

test('the monthly cap stops a call, --force passes it', async () => {
  const { home } = searchesFolder()
  fs.writeFileSync(path.join(home, '.profile.json'), JSON.stringify({ monthly_credit_cap: 0 }))
  let r = await run(home, ['fetch', '-p', 'paul-bert', '--spend', '1'])
  assert.equal(r.status, 2)
  assert.match(r.err, /monthly cap of 0 credits would be passed/)
  r = await run(home, ['fetch', '-p', 'paul-bert', '--spend', '1', '--force'])
  assert.equal(r.status, 0, r.err)
})

test('no credits left (402): the assisted mode takes over, nothing is logged as spent', async () => {
  const { home } = searchesFolder()
  api.state.broke = true
  const r = await run(home, ['fetch', '-p', 'paul-bert', '--spend', '1'])
  api.state.broke = false
  assert.equal(r.status, 3)
  assert.match(r.err, /no credits left \(402\).*Assisted mode/)
  assert.ok(!fs.existsSync(path.join(home, '.cache/api-usage.json')))
})

test('a classic search never calls Stream Estate', async () => {
  const { home } = searchesFolder('classic')
  const before = api.seen.length
  let r = await run(home, ['fetch', '-p', 'paul-bert', '--spend', '9'])
  assert.equal(r.status, 2)
  assert.match(r.err, /OpenData search .*--mode stream-estate/)
  r = await run(home, ['add', '-p', 'paul-bert', '--url', 'https://www.seloger.com/x.htm'])
  assert.equal(r.status, 4)
  assert.equal(api.seen.length, before)
})

test('add: a URL goes to WebFetch (the API has no lookup by URL), one already fetched is known, a listing the agent read joins', async () => {
  const { home, dir } = searchesFolder()
  const before = api.seen.length
  let r = await run(home, ['add', '-p', 'paul-bert', '--url', 'https://www.leboncoin.fr/ad/ventes_immobilieres/1.htm'])
  assert.equal(r.status, 4)
  assert.match(r.err, /read .*leboncoin.* with WebFetch, then add -p paul-bert --file/)
  assert.equal(api.seen.length, before)
  await run(home, ['fetch', '-p', 'paul-bert', '--spend', '1'])
  r = await run(home, ['add', '-p', 'paul-bert', '--url', 'https://www.seloger.com/annonces/achat/appartement/lyon-3eme-69/123456789.htm?utm_source=x'])
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, new RegExp(`already in the search: ${property.uuid}`))
  const file = path.join(home, 'read.json')
  fs.writeFileSync(file, JSON.stringify({ url: 'https://www.pap.fr/annonces/appartement-lyon-3e-r1', price: 255000, area: 52, rooms: 3, dpe: 'C', point: [4.8455, 45.756], publisher: 'Particulier', publisher_type: 'PRIVATE_INDIVIDUAL' }))
  r = await run(home, ['add', '-p', 'paul-bert', '--file', file], { key: null })
  assert.equal(r.status, 0, r.err)
  const ls = read(dir, 'listings.json')
  assert.deepEqual(ls.map(l => [l.source, l.price_per_m2]), [['stream-estate', 5000], ['websearch', 4904]])
  assert.equal(ls[1].building.risks.natural[0].key, 'seisme')
  r = await run(home, ['add', '-p', 'paul-bert', '--url', 'https://www.seloger.com/x.htm'], { key: null })
  assert.equal(r.status, 4)
})

test("the alerts: the dashboard's, listed and replaced by the agent; an old Stream Estate alert only deleted; usage sums the log", async () => {
  const { home, dir } = searchesFolder()
  const file = path.join(home, 'alerts-in.json')
  fs.writeFileSync(file, JSON.stringify({ off: ['status'], custom: [{ id: 'a-1', name: 'DPE rue Paul Bert', event: 'dpe', conditions: [{ field: 'street', op: 'contains', value: 'Paul Bert' }] }] }))
  let r = await run(home, ['alerts', '-p', 'paul-bert', '--file', file], { key: null })
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /^off default status: status, 0 news$/m)
  assert.match(r.out, /^on  custom a-1 « DPE rue Paul Bert »: dpe, 0 news$/m)
  fs.writeFileSync(file, JSON.stringify({ custom: [{ id: 'a-1', name: 'x', event: 'dpe', conditions: [{ field: 'energy', op: 'gte', value: 'Z' }] }] }))
  assert.equal((await run(home, ['alerts', '-p', 'paul-bert', '--file', file], { key: null })).status, 1)
  assert.equal((await run(home, ['alert', 'create', '-p', 'paul-bert'])).status, 1)
  // a search with an alert of skill-immo 1.6: its deletion, of unknown cost
  const f = path.join(dir, 'search.json')
  fs.writeFileSync(f, JSON.stringify({ ...read(dir, 'search.json'), alert: { searches: [{ id: 's-9', type: 'flat' }], topic: 'immo-x' } }))
  r = await run(home, ['alert', 'delete', '-p', 'paul-bert'])
  assert.equal(r.status, 2)
  assert.match(r.err, /unknown cost/)
  r = await run(home, ['alert', 'delete', '-p', 'paul-bert', '--accept-unknown'])
  assert.equal(r.status, 0, r.err)
  assert.deepEqual([api.seen.findLast(x => x.method === 'DELETE').path, read(dir, 'search.json').alert], ['/searches/s-9', null])
  await run(home, ['fetch', '-p', 'paul-bert', '--spend', '1'])
  r = await run(home, ['usage', '--json'])
  const u = JSON.parse(r.out)
  assert.deepEqual([u.month, u.cap, u.by_search['paul-bert'].credits, u.unknown], [1, 500, 1, 1])
})

test('market: the asking price per m² of the zone, its last month shown to the agent', async () => {
  const { home, dir } = searchesFolder()
  let r = await run(home, ['market', '-p', 'paul-bert', '--accept-unknown'])
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /median 4\u202f800/)
  const q = api.seen.findLast(x => x.path === '/indicators/price_per_meter').query
  assert.deepEqual(['propertyTypes[]', 'radius', 'aggregationInterval', 'roomMin'].map(k => q.get(k)), ['0', '0.5', 'month', null])
  assert.deepEqual(read(dir, 'market.json').stream, { ...read(dir, 'market.json').stream, type: 'flat', median: 4800, series: { '2026-09': 4750, '2026-10': 4820 } })
  await run(home, ['fetch', '-p', 'paul-bert', '--spend', '1'])
  r = await run(home, ['show', '-p', 'paul-bert'])
  assert.equal(JSON.parse(r.out)[0].market.asking_ppm2, 4820)
})

test('a coherent .gitignore: the searches and the credits log kept, the cache and the profile left out', async () => {
  const { execFileSync } = await import('node:child_process')
  const { home } = searchesFolder()
  execFileSync('git', ['init', '-q'], { cwd: home })
  assert.match((await run(home, ['doctor'], { key: null })).out, /git would version the cache/)
  let r = await run(home, ['search', '-p', 'paul-bert', '--criteria', 'rooms_min=2'], { key: null })
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /wrote .*\.gitignore/)
  const ignored = f => { try { execFileSync('git', ['check-ignore', '-q', '--no-index', f], { cwd: home }); return true } catch { return false } }
  assert.deepEqual(['.cache/dvf/x.json', 'paul-bert/area.json', 'paul-bert/market.json', '.profile.json', '.dashboard.log'].map(ignored), [true, true, true, true, true])
  assert.deepEqual(['.cache/api-usage.json', 'paul-bert/search.json', 'paul-bert/listings.json', '.costs.json'].map(ignored), [false, false, false, false])
  assert.doesNotMatch((await run(home, ['doctor'], { key: null })).out, /warning/)
  // a .gitignore of the user's gets the skill's lines once, after its own
  const other = searchesFolder().home
  fs.writeFileSync(path.join(other, '.gitignore'), 'node_modules/')
  for (let i = 0; i < 2; i++) await run(other, ['search', '-p', 'paul-bert'], { key: null })
  const text = fs.readFileSync(path.join(other, '.gitignore'), 'utf8')
  assert.ok(text.startsWith('node_modules/\n\n# skill-immo:'))
  assert.equal(text.split('# skill-immo:').length, 2)
})

test('several types: one v1 query per type, each with the criteria it takes', async () => {
  const { home, dir } = searchesFolder()
  const r = await run(home, ['search', '-p', 'paul-bert', '--types', 'flat,parking', '--criteria', 'rooms_min=3 budget_max=300000 outdoor=true'])
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(read(dir, 'search.json').types, ['flat', 'parking'])
  const [flat, parking] = api.seen.filter(x => x.query?.get('itemsPerPage') === '0').slice(-2).map(x => x.query)
  // the flat: its rooms; the parking: only the budget
  assert.deepEqual([flat.getAll('propertyTypes[]'), flat.get('roomMin'), flat.get('budgetMax')], [['0'], '3', '300000'])
  assert.deepEqual([parking.getAll('propertyTypes[]'), parking.get('roomMin'), parking.get('budgetMax')], [['3'], null, '300000'])
  // an outdoor space is no v1 filter: the count says it includes listings without one
  assert.match(r.out, /does not filter on outdoor: the count includes listings they rule out/)
  // the market of each type, and the rent
  const m = read(dir, 'market.json')
  assert.deepEqual([Object.keys(m.dvf ?? {}), m.rent.flat_large.per_m2], [[], 15.22])
  assert.equal((await run(home, ['search', '-p', 'paul-bert', '--types', 'castle'])).status, 1)
})

test('a message for a listing: kept with it, shown to the agent', async () => {
  const { home, dir } = searchesFolder('classic')
  fs.writeFileSync(path.join(dir, 'l.json'), JSON.stringify({ url: 'https://www.pap.fr/annonces/r1', price: 262000, area: 58, rooms: 3, publisher: 'Particulier' }))
  await run(home, ['add', '-p', 'paul-bert', '--file', path.join(dir, 'l.json')], { key: null })
  const [{ id }] = read(dir, 'listings.json')
  fs.writeFileSync(path.join(dir, 'offer.txt'), 'Madame, Monsieur,\nje vous propose 250 000 €.')
  let r = await run(home, ['message', '-p', 'paul-bert', '--id', id, '--kind', 'offer', '--amount', '250000', '--file', path.join(dir, 'offer.txt')], { key: null })
  assert.equal(r.status, 0, r.err)
  const [m] = read(dir, 'listings.json')[0].messages
  assert.deepEqual([m.from, m.kind, m.amount, m.to, m.sent_at, m.text.split('\n')[1]], ['me', 'offer', 250000, 'Particulier', null, 'je vous propose 250 000 €.'])
  assert.equal((await run(home, ['message', '-p', 'paul-bert', '--id', id, '--kind', 'letter', '--text', 'x'], { key: null })).status, 1)
  // the seller's answer, pasted, dated the day before: the conversation reads in order
  r = await run(home, ['message', '-p', 'paul-bert', '--id', id, '--from', 'them', '--channel', 'phone', '--amount', '256000', '--date', '2020-01-01T10:00', '--text', 'Le vendeur descend à 256 000 €.'], { key: null })
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /received/)
  assert.equal((await run(home, ['message', '-p', 'paul-bert', '--id', id, '--from', 'agent', '--text', 'x'], { key: null })).status, 1)
  assert.equal((await run(home, ['message', '-p', 'paul-bert', '--id', id, '--date', 'hier', '--text', 'x'], { key: null })).status, 1)
  // an offer already sent: the listing goes to "Offre faite"
  await run(home, ['message', '-p', 'paul-bert', '--id', id, '--kind', 'offer', '--amount', '253000', '--sent', '--text', 'Je monte à 253 000 €.'], { key: null })
  assert.equal(read(dir, 'listings.json')[0].my_status, 'offer')
  // a refresh of the listing keeps its messages
  await run(home, ['add', '-p', 'paul-bert', '--file', path.join(dir, 'l.json')], { key: null })
  await run(home, ['search', '-p', 'paul-bert'], { key: null })
  const shown = JSON.parse((await run(home, ['show', '-p', 'paul-bert', '--id', id], { key: null })).out)
  assert.deepEqual([shown.type, shown.messages.length, shown.rent.rent, shown.favorite, shown.labels], ['flat', 3, 883, false, []])
  assert.deepEqual(shown.messages.map(x => [x.from, x.channel, !!x.sent_at]), [['them', 'phone', false], ['me', null, false], ['me', null, true]])
  assert.ok(shown.review.questions.length && shown.score.parts.length === 6)
  // documents the user gave in the chat: copied into the search, their path in show; a page is no document
  fs.writeFileSync(path.join(dir, 'pv.pdf'), '%PDF-1.4')
  r = await run(home, ['message', '-p', 'paul-bert', '--id', id, '--from', 'them', '--attach', path.join(dir, 'pv.pdf')], { key: null })
  assert.match(r.out, /1 document\)/, r.err)
  const [d] = JSON.parse((await run(home, ['show', '-p', 'paul-bert', '--id', id], { key: null })).out).messages.at(-1).documents
  assert.deepEqual([d.name, fs.readFileSync(d.path, 'utf8')], ['pv.pdf', '%PDF-1.4'])
  fs.writeFileSync(path.join(dir, 'x.html'), '<script>')
  assert.equal((await run(home, ['message', '-p', 'paul-bert', '--id', id, '--attach', path.join(dir, 'x.html')], { key: null })).status, 1)
  assert.equal((await run(home, ['message', '-p', 'paul-bert', '--id', id, '--attach', path.join(dir, 'nope.pdf')], { key: null })).status, 1)
  // a summary kept in « Mes notes », after what the user wrote
  const notes = (l = read(dir, 'listings.json')[0]) => l.notes
  await run(home, ['note', '-p', 'paul-bert', '--id', id, '--text', 'Résumé du PV : ravalement voté.'], { key: null })
  await run(home, ['note', '-p', 'paul-bert', '--id', id, '--text', 'Charges : 2 400 €/an.'], { key: null })
  assert.equal(notes(), 'Résumé du PV : ravalement voté.\n\nCharges : 2 400 €/an.')
  assert.equal((await run(home, ['note', '-p', 'paul-bert', '--id', id, '--text', ' '], { key: null })).status, 1)
  assert.equal((await run(home, ['note', '-p', 'paul-bert', '--id', id, '--text', 'x'.repeat(20001)], { key: null })).status, 1)
})

// the open data a new zone asks, kept in the cache beforehand: its box's places, DPE and audits, its center's risks and
// IRIS, the DPE classes (`classes`: around the center, or the commune's)
function zoneCache(home, zone, classes) {
  const put = (rel, v) => { fs.mkdirSync(path.dirname(path.join(home, '.cache', rel)), { recursive: true }); fs.writeFileSync(path.join(home, '.cache', rel), JSON.stringify(v)) }
  const box = pad => bbox(zone, pad).map(x => x.toFixed(4)).join(','), c = center(zone).map(x => x.toFixed(5)).join(',')
  put(`overpass/${box(600)}.json`, [{ cat: 'parks', kind: 'park', name: 'Square du test', point: center(zone) }])
  for (const k of ['recent', 'audits']) put(`ademe/${k}-${box(0)}.json`, [])
  put(`georisques/${c}.json`, { natural: [], technological: [], url: null })
  put(`polygon/iris-${c}.json`, { code: '693830201', name: 'Moncey', geometry: null })
  put(`ademe/classes-${classes}.json`, { flat: { D: 1 } })
}

test("a street's zone follows its line in the BD TOPO; a zone drawn on the map replaces it once the agent applies it", async () => {
  const { home, dir } = searchesFolder()
  const line = read(path.dirname(new URL('./fixtures/bdtopo-69383_5245.json', import.meta.url).pathname), 'bdtopo-69383_5245.json').features.map(f => f.geometry.coordinates)
  fs.mkdirSync(path.join(home, '.cache/bdtopo'))
  fs.writeFileSync(path.join(home, '.cache/bdtopo/69383_5245.json'), JSON.stringify(line))
  const along = { how: 'radius', kind: 'polygon', radius_m: 300, label: "300 m de part et d'autre de la Rue Paul Bert", geometry: band(line, 300) }
  zoneCache(home, along, `${center(along).map(x => x.toFixed(4)).join(',')}-300`)
  let r = await run(home, ['search', '-p', 'paul-bert', '--radius', '300'])
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(read(dir, 'search.json').zone, along)
  assert.equal(read(dir, 'area.json').pois[0].name, 'Square du test', "the new zone's places")
  // the API gets its outline, 60 corners at most (its first one repeated at its end)
  const q = api.seen.findLast(x => x.path === '/documents/properties').query, vertices = [...q.keys()].filter(k => /^geoShapes\[0\]\[\d+\]\[0\]$/.test(k))
  assert.ok(vertices.length > 10 && vertices.length - 1 <= 60, `${vertices.length} vertices`)

  // the dashboard's draft (the server's route checks it the same way), then search --zone drawn takes it once
  const drawn = { type: 'Polygon', coordinates: [[[4.85, 45.755], [4.86, 45.755], [4.86, 45.759], [4.85, 45.755]]] }
  fs.writeFileSync(path.join(dir, 'zone-draft.json'), JSON.stringify({ geometry: drawn }))
  const zone = { how: 'drawn', kind: 'polygon', geometry: drawn, label: 'Zone dessinée sur la carte' }
  zoneCache(home, zone, '69383')
  r = await run(home, ['search', '-p', 'paul-bert', '--zone', 'drawn'])
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(read(dir, 'search.json').zone, zone)
  assert.ok(!fs.existsSync(path.join(dir, 'zone-draft.json')), 'the draft is taken')
  assert.match(r.out, /Zone dessinée sur la carte/)
  // no draft: the drawn zone stays; --radius goes back to the street's band
  assert.equal((await run(home, ['search', '-p', 'paul-bert', '--zone', 'drawn'])).status, 0)
  assert.deepEqual(read(dir, 'search.json').zone, zone)
  fs.writeFileSync(path.join(dir, 'zone-draft.json'), JSON.stringify({ geometry: { type: 'Polygon', coordinates: [[[4.85, 45.755], [4.86, 45.755]]] } }))
  r = await run(home, ['search', '-p', 'paul-bert', '--zone', 'drawn'])
  assert.equal(r.status, 1)
  assert.match(r.err, /zone-draft.json: a ring has 3 corners or more/)
  r = await run(home, ['search', '-p', 'paul-bert', '--radius', '300'])
  assert.deepEqual(read(dir, 'search.json').zone, along)
})

test('search --preview: the zone pictured for the user to agree on, nothing else made', async () => {
  const { home, dir } = searchesFolder()
  const line = read(path.dirname(new URL('./fixtures/bdtopo-69383_5245.json', import.meta.url).pathname), 'bdtopo-69383_5245.json').features.map(f => f.geometry.coordinates)
  fs.mkdirSync(path.join(home, '.cache/bdtopo'))
  fs.writeFileSync(path.join(home, '.cache/bdtopo/69383_5245.json'), JSON.stringify(line))
  // the Plan IGN of its frame, kept beforehand: a grey page
  const along = { geometry: band(line, 300) }, plan = path.join(home, '.cache/plan', `${frame(along).join(',')}-${SIZE.join('x')}.png`)
  fs.mkdirSync(path.dirname(plan))
  fs.writeFileSync(plan, encodePng({ width: SIZE[0], height: SIZE[1], rgb: Buffer.alloc(SIZE[0] * SIZE[1] * 3, 230) }))
  const before = fs.readFileSync(path.join(dir, 'search.json'), 'utf8'), calls = api.seen.length
  const r = await run(home, ['search', '-p', 'paul-bert', '--radius', '300', '--preview'])
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /^preview paul-bert: 300 m de part et d'autre de la Rue Paul Bert \(Rue Paul Bert 69003 Lyon\), \d+\.\d\d km²\n.*paul-bert\.png\n/)
  assert.ok(!/Plan IGN/.test(r.out), 'the basemap kept')
  const img = decodePng(fs.readFileSync(path.join(home, '.cache/previews/paul-bert.png')))
  assert.ok(img.rgb.includes(Buffer.from([37, 99, 235])), 'the zone drawn')
  assert.equal(fs.readFileSync(path.join(dir, 'search.json'), 'utf8'), before, 'the search unchanged')
  assert.ok(!fs.existsSync(path.join(dir, 'area.json')), 'no open data fetched')
  assert.equal(api.seen.length, calls, 'no Stream Estate call')
  // a zone drawn on the dashboard map was seen there
  const drawn = await run(home, ['search', '-p', 'paul-bert', '--zone', 'drawn', '--preview'])
  assert.equal(drawn.status, 1)
  assert.match(drawn.err, /needs no preview/)
})

test("cadastre: a parcel by its IDU, its designation for an offer, its urban plan and sales; none at IGN, an error", async () => {
  const { home } = searchesFolder()
  const cache = (rel, v) => { fs.mkdirSync(path.dirname(path.join(home, '.cache', rel)), { recursive: true }); fs.writeFileSync(path.join(home, '.cache', rel), JSON.stringify(v)) }
  cache('cadastre/69383000DN0068.json', { idu: '69383000DN0068', commune: 'Lyon', insee: '69383', arrondissement: '383', prefix: '000', section: 'DN', number: '0068', sheet: 1, area: 990, geometry: { type: 'Polygon', coordinates: [] } })
  cache('cadastre/69383000DN9999.json', null)
  cache('gpu/69383000DN0068.json', { document: { kind: 'PLUi', name: 'PLUI GRAND LYON LA METROPOLE', id: '4f3ddc27' }, rnu: false, zones: [{ label: 'URm1', name: 'Zone mixte', kind: 'U' }], prescriptions: [{ label: 'Hauteur Max-16', value: '16' }], infos: [], easements: [] })
  cache('bdnb/69383000DN0068.json', [])
  const y = new Date().getFullYear()
  for (let k = y - 6; k <= y; k++) cache(`dvf/parcels-69383-${k}.json`, k === 2024 ? { '69383000DN0068': [{ id: 'm', date: '2024-01-19', nature: 'Vente', price: 150000, parcels: ['69383000DN0068'], locals: [{ type: 'flat', area: 48, rooms: 2 }], land: null }] } : null)
  const r = await run(home, ['cadastre', '69383000DN0068'])
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /^parcel 69383000DN0068: Lyon 3e \(69383\), section DN no 68, sheet 1, contenance 990 m² \(9 a 90 ca\)$/m)
  assert.match(r.out, /« cadastré section DN n° 68, pour une contenance de 9 a 90 ca »/)
  assert.match(r.out, /^zones: URm1 \(U\): Zone mixte$/m)
  assert.match(r.out, /^DVF 2024–2024: 1 mutations: 2024-01-19 Vente 150\s000\s€ \(flat 48 m²\)$/m)
  const none = await run(home, ['cadastre', '69383000DN9999'])
  assert.equal(none.status, 1)
  assert.match(none.err, /IGN has no parcel 69383000DN9999/)
})
