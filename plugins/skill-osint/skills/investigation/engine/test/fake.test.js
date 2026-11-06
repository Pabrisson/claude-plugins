import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { fakeEnv, fixtureOf, startFake } from './fake.mjs'
import { FIXTURES } from './helpers.js'
import { PROBES } from '../lib/doctor.js'
import { request, target } from '../lib/net.js'

test('each service maps to its fixture; the fake records the host each request was meant for', async () => {
  const q = s => new URLSearchParams(s)
  assert.equal(fixtureOf('rdap', 'domain/x.example', q('')), 'rdap/domain-x.example.json')
  assert.equal(fixtureOf('rdap', 'autnum/64500', q('')), 'rdap/autnum-64500.json')
  assert.equal(fixtureOf('crtsh', '', q('q=%25.x.example&output=json')), 'crtsh/x.example.json')
  assert.equal(fixtureOf('cdx', 'cdx/search/cdx', q('url=x.example&limit=1')), 'cdx/x.example-first.json')
  assert.equal(fixtureOf('cdx', 'cdx/search/cdx', q('url=x.example&collapse=digest')), 'cdx/x.example-changes.json')
  assert.equal(fixtureOf('ripestat', 'data/network-info/data.json', q('resource=192.0.2.10')), 'ripestat/network-info-192.0.2.10.json')
  assert.equal(fixtureOf('web', 'x.example/', q('')), 'web/x.example/index.html')
  assert.equal(fixtureOf('raw', 'WebBreacher/WhatsMyName/main/wmn-data.json', q('')), 'raw/WebBreacher/WhatsMyName/main/wmn-data.json')
  const env = fakeEnv('http://127.0.0.1:1')
  assert.equal(env.OSINT_BASE_RDAP, 'http://127.0.0.1:1/rdap')
  assert.equal(env.OSINT_BASE_RAW, 'http://127.0.0.1:1/raw')
  assert.equal(env.OSINT_DNS, path.join(FIXTURES, 'dns.json'))
  const fake = await startFake()
  fs.mkdirSync(path.join(FIXTURES, 'web', 'fake-test.example'), { recursive: true })
  fs.writeFileSync(path.join(FIXTURES, 'web', 'fake-test.example', 'index.html'), '<title>t</title>')
  try {
    const r = await fetch(`${fake.url}/web/fake-test.example/`, { headers: { 'x-osint-host': 'fake-test.example' } })
    assert.equal(await r.text(), '<title>t</title>')
    assert.equal((await fetch(`${fake.url}/rdap/domain/none.example`)).status, 404)
    assert.deepEqual(fake.seen.map(s => [s.host, s.method]), [['fake-test.example', 'GET'], [null, 'GET']])
  } finally { fake.close(); fs.rmSync(path.join(FIXTURES, 'web', 'fake-test.example'), { recursive: true }) }
})

test('the services of the geolocation map to their fixtures; a tunnel name registered by the fake cloudflared is relayed', async () => {
  const q = s => new URLSearchParams(s)
  assert.equal(fixtureOf('nominatim', 'reverse', q('lat=38.5725&lon=-7.9075&format=jsonv2')), 'nominatim/reverse-38.5725,-7.9075.json')
  assert.equal(fixtureOf('nominatim', 'status', q('format=json')), 'nominatim/status.json')
  assert.equal(fixtureOf('openmeteo', 'v1/archive', q('latitude=38.5725&longitude=-7.9075&start_date=2024-07-16')), 'openmeteo/38.5725,-7.9075-2024-07-16.json')
  assert.equal(fixtureOf('doh', 'dns-query', q('name=x.trycloudflare.com&type=A')), 'doh/x.trycloudflare.com.json')
  assert.equal(fixtureOf('hf', 'api/models/geolocal/StreetCLIP', q('')), 'hf/api/models/geolocal/StreetCLIP.json')
  assert.equal(fixtureOf('mapillary', 'images', q('bbox=1,2,3,4')), 'mapillary/images.json')
  const fake = await startFake()
  const local = http.createServer((req, res) => res.end(`local ${req.url} ${req.headers['user-agent']}`))
  await new Promise(ok => local.listen(0, '127.0.0.1', ok))
  try {
    await fetch(`${fake.url}/__tunnel`, { method: 'POST', body: JSON.stringify({ host: 't.trycloudflare.com', target: `http://127.0.0.1:${local.address().port}` }) })
    const r = await fetch(`${fake.url}/web/t.trycloudflare.com/abc/1.jpg`, { headers: { 'user-agent': 'Googlebot-Image/1.0' } })
    assert.equal(await r.text(), 'local /abc/1.jpg Googlebot-Image/1.0')
    assert.equal((await (await fetch(`${fake.url}/nominatim/reverse?lat=38.5725&lon=-7.9075&format=jsonv2`)).json()).address.country_code, 'pt')
  } finally { fake.close(); local.close() }
})

test('cdx: a page (an address with a path) has its own fixture name, without a colon; a bare domain keeps its own', () => {
  const page = 'https://commons.wikimedia.org/wiki/File:Roman_Temple_of_%C3%89vora_1.jpg'
  assert.equal(fixtureOf('cdx', 'cdx/search/cdx', new URLSearchParams(`url=${encodeURIComponent(page)}&output=json&fl=timestamp,original,statuscode&limit=1`)), 'cdx/pages/commons.wikimedia.org_wiki_File_Roman_Temple_of__C3_89vora_1.jpg-first.json')
  assert.equal(fixtureOf('cdx', 'cdx/search/cdx', new URLSearchParams('url=example.org&output=json&limit=1')), 'cdx/example.org-first.json')
})

test('the French registries: their real hosts, the fake\'s fixtures, the doctor --network probes', async () => {
  assert.equal(target('entreprises', '/search?q=1').host, 'recherche-entreprises.api.gouv.fr')
  assert.equal(target('bodacc', '/api/x').host, 'bodacc-datadila.opendatasoft.com')
  const q = s => new URLSearchParams(s)
  assert.equal(fixtureOf('entreprises', 'search', q('q=456789122')), 'entreprises/search-456789122.json')
  assert.equal(fixtureOf('entreprises', 'search', q('q=Boulangerie+Durand&per_page=25&minimal=true')), 'entreprises/search-boulangerie-durand.json')
  assert.equal(fixtureOf('entreprises', 'search', q('q=ÉLECTRICITÉ DE FRANCE')), 'entreprises/search-electricite-de-france.json')
  assert.equal(fixtureOf('entreprises', 'search', q('nom_personne=DURAND&prenoms_personne=JEANNE+MARIE&type_personne=dirigeant')), 'entreprises/person-durand-jeanne.json')
  assert.equal(fixtureOf('bodacc', 'api/explore/v2.1/catalog/datasets/annonces-commerciales/records', q('where=registre%3D%22456789122%22&limit=100')), 'bodacc/456789122.json')
  assert.equal(fixtureOf('bodacc', 'api/explore/v2.1/catalog/datasets/annonces-commerciales/records', q('limit=1')), null)
  const fake = await startFake(), env = fakeEnv(fake.url)
  Object.assign(process.env, env)
  try {
    for (const s of ['entreprises', 'bodacc']) assert.equal((await request(s, PROBES[s][0])).status, 200, s)
  } finally { for (const k of Object.keys(env)) delete process.env[k]; fake.close() }
})

test('gravatar and xon map to their fixtures; a recorded 404 answers 404 with its body', async () => {
  const q = new URLSearchParams('')
  assert.equal(fixtureOf('gravatar', 'v3/profiles/abc', q), 'gravatar/abc.json')
  assert.equal(fixtureOf('xon', 'v1/check-email/jo@example.org', q), 'xon/jo@example.org.json')
  const fake = await startFake()
  try {
    const r = await fetch(`${fake.url}/gravatar/v3/profiles/973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b`)
    assert.deepEqual([r.status, await r.json()], [404, { error: 'Profile not found' }])
    assert.equal((await fetch(`${fake.url}/xon/v1/check-email/none%40example.org`)).status, 404)
  } finally { fake.close() }
})

test('the ip routes: RDAP ip/, file names without a colon, the four published lists', () => {
  const q = s => new URLSearchParams(s)
  assert.equal(fixtureOf('rdap', 'ip/2606:4700:4700::1111', q('')), 'rdap/ip-2606_4700_4700__1111.json')
  assert.equal(fixtureOf('rdap', 'ip/1.1.1.1', q('')), 'rdap/ip-1.1.1.1.json')
  assert.equal(fixtureOf('ripestat', 'data/whois/data.json', q('resource=2606:4700:4700::1111&sourceapp=skill-osint')), 'ripestat/whois-2606_4700_4700__1111.json')
  assert.equal(fixtureOf('internetdb', '2606:4700:4700::1111', q('')), 'internetdb/2606_4700_4700__1111.json')
  assert.equal(fixtureOf('tor', 'torbulkexitlist', q('')), 'tor/torbulkexitlist.txt')
  assert.equal(fixtureOf('aws', 'ip-ranges.json', q('')), 'aws/ip-ranges.json')
  assert.equal(fixtureOf('gcp', 'ipranges/cloud.json', q('')), 'gcp/cloud.json')
  assert.equal(fixtureOf('cloudflare', 'ips-v6', q('')), 'cloudflare/ips-v6.txt')
  for (const f of fs.readdirSync(FIXTURES, { recursive: true })) assert.ok(!/[:*?"<>|]/.test(f), `${f}: not a valid name on Windows`)
})

test('the services of the place type: their real hosts, the fake\'s fixtures, the doctor --network probes', async () => {
  assert.deepEqual(['geopf', 'overpass', 'panoramax', 'kartaview', 'esri'].map(s => target(s, '/x').host), ['data.geopf.fr', 'overpass-api.de', 'api.panoramax.xyz', 'api.kartaview.org', 's3-us-west-2.amazonaws.com'])
  const q = s => new URLSearchParams(s)
  assert.equal(fixtureOf('geopf', 'geocodage/reverse', q('lat=48.8565&lon=2.352&limit=1')), 'geopf/reverse-48.8565,2.352.json')
  assert.equal(fixtureOf('geopf', 'geocodage/search', q("q=4 place de l'Hôtel de Ville 75004 Paris&limit=1")), 'geopf/search-4-place-de-l-hotel-de-ville-75004-paris.json')
  assert.equal(fixtureOf('overpass', 'api/interpreter', q(`data=${encodeURIComponent('[out:json];nwr(around:150,48.8565,2.352)["name"];out;')}`)), 'overpass/48.8565,2.352.json')
  assert.equal(fixtureOf('overpass', 'api/status', q('')), 'overpass/status.txt')
  assert.equal(fixtureOf('panoramax', 'api/search', q('place_position=2.352,48.8565&place_distance=0-150&limit=100')), 'panoramax/48.8565,2.352.json')
  assert.equal(fixtureOf('panoramax', 'api', q('')), 'panoramax/api.json')
  assert.equal(fixtureOf('kartaview', '2.0/photo/', q('lat=48.8565&lng=2.352&radius=500')), 'kartaview/48.8565,2.352.json')
  assert.equal(fixtureOf('esri', 'config.maptiles.arcgis.com/waybackconfig.json', q('')), 'esri/waybackconfig.json')
  assert.equal(fixtureOf('nominatim', 'search', q('q=Lyon&format=jsonv2')), 'nominatim/search-lyon.json')
  assert.equal(fixtureOf('nominatim', 'reverse', q('lat=48.8565&lon=2.352&zoom=18')), 'nominatim/reverse-48.8565,2.352.json')
  assert.equal(fixtureOf('entreprises', 'near_point', q('lat=48.8565&long=2.352&radius=0.15&page=2')), 'entreprises/near-48.8565,2.352-2.json')
  assert.equal(fixtureOf('entreprises', 'near_point', q('lat=48.8565&long=2.352')), 'entreprises/near-48.8565,2.352-1.json')
  const fake = await startFake(), env = fakeEnv(fake.url)
  Object.assign(process.env, env)
  try {
    for (const s of ['geopf', 'overpass', 'panoramax', 'kartaview', 'esri']) assert.equal((await request(s, PROBES[s][0])).status, 200, s)
    assert.equal((await request('overpass', PROBES.overpass[0])).body.toString().includes('Rate limit: 2'), true)
  } finally { for (const k of Object.keys(env)) delete process.env[k]; fake.close() }
})
