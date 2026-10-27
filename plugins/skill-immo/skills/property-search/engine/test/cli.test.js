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
  assert.deepEqual(JSON.parse(r.out), { what: 'fetch 1 of 1 listings', route: 'POST /properties', credits: 1, eur: 0.01, unknown: false, spent: 0, cap: 500, remaining: 500 })
  r = await run(home, ['fetch', '-p', 'paul-bert', '--spend', '1'])
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /fetched 1 listings: 1 new/)
  const [l] = read(dir, 'listings.json')
  assert.deepEqual([l.id, l.price, l.first_seen.slice(0, 4), l.building.risks.natural[0].key], [property.id, 280000, String(new Date().getFullYear()), 'seisme'])
  // the counts cost nothing, the fetch one credit per result
  assert.deepEqual(read(home, '.cache/api-usage.json').map(e => e.credits), [0, 0, 0, 1])
  // the property already fetched is left out of the next count
  await run(home, ['fetch', '-p', 'paul-bert', '--estimate'])
  assert.deepEqual(api.seen.findLast(x => x.body?.size === 0).body.criteria.property.id, { nin: [property.id] })
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
  const since = api.seen.findLast(x => x.body?.size === 0).body.criteria.or
  assert.ok(since[0].dates.updatedAt.from && since[1].listings.expiredAt.from)
  assert.deepEqual(read(dir, 'listings.json')[0].price_history.map(h => h.price), [280000, 265000])
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
  assert.match(r.err, /classic search .*--mode stream-estate/)
  r = await run(home, ['add', '-p', 'paul-bert', '--url', 'https://www.seloger.com/x.htm'])
  assert.equal(r.status, 4)
  assert.equal(api.seen.length, before)
})

test('add: a URL Stream Estate knows (2 credits), one it does not (WebFetch), and a listing Claude read', async () => {
  const { home, dir } = searchesFolder()
  let r = await run(home, ['add', '-p', 'paul-bert', '--url', 'https://www.leboncoin.fr/ad/ventes_immobilieres/1.htm', '--spend', '2'])
  assert.equal(r.status, 4)
  assert.match(r.err, /does not know .*not charged.*WebFetch/)
  r = await run(home, ['add', '-p', 'paul-bert', '--url', 'https://www.seloger.com/a.htm', '--spend', '2'])
  assert.equal(r.status, 0, r.err)
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

test('alert forecast is free; usage sums the log', async () => {
  const { home } = searchesFolder()
  let r = await run(home, ['alert', 'forecast', '-p', 'paul-bert'])
  assert.equal(r.status, 0, r.err)
  assert.equal(JSON.parse(r.out).total, 12)
  await run(home, ['fetch', '-p', 'paul-bert', '--spend', '1'])
  r = await run(home, ['usage', '--json'])
  const u = JSON.parse(r.out)
  assert.deepEqual([u.month, u.cap, u.by_search['paul-bert'].credits], [1, 500, 1])
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

test('several types: one Stream Estate branch per type, each with the criteria it takes', async () => {
  const { home, dir } = searchesFolder()
  const r = await run(home, ['search', '-p', 'paul-bert', '--types', 'flat,parking', '--criteria', 'rooms_min=3 budget_max=300000 outdoor=true'])
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(read(dir, 'search.json').types, ['flat', 'parking'])
  const { or: [flat, parking] } = api.seen.findLast(x => x.body?.size === 0).body.criteria
  // the flat: rooms and an outdoor space; the parking: only the budget
  assert.deepEqual([flat.and[0].property.type.in, flat.and[0].property.unit.rooms, flat.and[1].or.length], [['FLAT'], { gte: 3, lte: null }, 3])
  assert.deepEqual([parking.property.type.in, parking.property.unit.rooms, parking.property.pricing.displayed], [['PARKING'], undefined, { gte: null, lte: 300000 }])
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
  assert.deepEqual([shown.type, shown.messages.length, shown.rent.rent], ['flat', 3, 883])
  assert.deepEqual(shown.messages.map(x => [x.from, x.channel, !!x.sent_at]), [['them', 'phone', false], ['me', null, false], ['me', null, true]])
  assert.ok(shown.review.questions.length && shown.score.parts.length === 6)
})
