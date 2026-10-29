import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
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

test("the account: unknown to the API; the console's € deposited and items, money added, less what the log spent since", async () => {
  const { home } = searchesFolder()
  let r = await run(home, ['doctor'])
  assert.match(r.out, /^account: unknown \(the API does not give it/m)
  assert.equal((await run(home, ['costs', 'account', '5', 'lots'])).status, 1)
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

test('add: a URL goes to WebFetch (the API has no lookup by URL), one already fetched is known, a listing Claude read joins', async () => {
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

test("the alerts: the dashboard's, listed and replaced by Claude; an old Stream Estate alert only deleted; usage sums the log", async () => {
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

test('market: the asking price per m² of the zone, its last month shown to Claude', async () => {
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

test('a message for a listing: kept with it, shown to Claude', async () => {
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
  assert.deepEqual([shown.type, shown.messages.length, shown.rent.rent, shown.favorite], ['flat', 3, 883, false])
  assert.deepEqual(shown.messages.map(x => [x.from, x.channel, !!x.sent_at]), [['them', 'phone', false], ['me', null, false], ['me', null, true]])
  assert.ok(shown.review.questions.length && shown.score.parts.length === 6)
})
