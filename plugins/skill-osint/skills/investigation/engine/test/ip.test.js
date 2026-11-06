import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import test from 'node:test'
import { addressOf, cloudMatch, cloudRanges, geoOf, looksResidential, prefixOf, rdapOf, torListed, whoisOf } from '../../types/ip/engine.js'
import { PROBES } from '../lib/doctor.js'
import { DENY, request } from '../lib/net.js'
import { readNote } from '../lib/vault.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, events, FIXTURES, json, read, run } from './helpers.js'

const fx = rel => fs.readFileSync(path.join(FIXTURES, rel), 'utf8')
const data = rel => JSON.parse(fx(rel)).data

test('addressOf: the canonical public address, or a refusal that says why', () => {
  assert.deepEqual(addressOf(' 2606:4700:4700:0:0:0:0:1111 '), { ip: '2606:4700:4700::1111', v: 6 })
  assert.deepEqual(addressOf('::ffff:1.1.1.1'), { ip: '1.1.1.1', v: 4 })
  assert.match(addressOf('192.168.1.10').error, /^192\.168\.1\.10 is a private address \(192\.168\.0\.0\/16\): no public registry describes it/)
  assert.match(addressOf('100.64.3.4').error, /carrier-grade NAT/)
  for (const bad of ['1.1.1', '1.1.1.0/24', '1.2.3.4:80', 'example.org', '']) assert.match(addressOf(bad).error, /is not an IP address/, bad)
})

test('rdapOf: the range, the network, its holder (contacts nested too), the registry and the dates — IPv4 at APNIC, IPv6 at ARIN', () => {
  assert.deepEqual(rdapOf(JSON.parse(fx('rdap/ip-1.1.1.1.json'))), { range: '1.1.1.0 - 1.1.1.255', cidrs: ['1.1.1.0/24'], netname: 'APNIC-LABS', type: 'ASSIGNED PORTABLE', country: 'AU', registrant: 'APNIC Research and Development', abuse: 'helpdesk@apnic.net', rir: 'apnic', registered: '2011-08-10', changed: '2023-04-26' })
  const v6 = rdapOf(JSON.parse(fx('rdap/ip-2606_4700_4700__1111.json')))
  assert.deepEqual([v6.cidrs, v6.netname, v6.country, v6.registrant, v6.abuse, v6.rir, v6.registered], [['2606:4700::/32'], 'CLOUDFLARENET', null, 'Cloudflare, Inc.', 'abuse@cloudflare.com', 'arin', '2011-11-01'])
})

test('whoisOf and prefixOf: the record that has a netname (none in ARIN\'s « No match »), the announcing AS split into its name and holder', () => {
  assert.deepEqual(whoisOf(data('ripestat/whois-1.1.1.1.json')), { netname: 'APNIC-LABS', descr: ['APNIC and Cloudflare DNS Resolver project', 'Routed globally by AS13335/Cloudflare', 'Research prefix for APNIC Labs'], country: 'AU', org: 'ORG-ARAD1-AP' })
  assert.equal(whoisOf(data('ripestat/whois-2606_4700_4700__1111.json')), null)
  assert.deepEqual(prefixOf(data('ripestat/prefix-overview-1.1.1.1.json')), { prefix: '1.1.1.0/24', announced: true, asns: [{ asn: 'AS13335', name: 'CLOUDFLARENET', org: 'Cloudflare, Inc.' }] })
  assert.deepEqual(prefixOf({ resource: '203.0.113.0/24', announced: false, asns: [] }), { prefix: '203.0.113.0/24', announced: false, asns: [] })
  assert.deepEqual(prefixOf({ asns: [{ asn: 64501, holder: 'Plain Holder' }] }).asns, [{ asn: 'AS64501', name: null, org: 'Plain Holder' }])
})

test('geoOf: anycast (country ?, 0, 0) is unknown; a country alone is a 500 km circle, a city 50 km; never finer than 0.1°', () => {
  assert.equal(geoOf(data('ripestat/maxmind-geo-lite-1.1.1.1.json')), null)
  assert.equal(geoOf(data('ripestat/maxmind-geo-lite-2606_4700_4700__1111.json')), null)
  assert.deepEqual(geoOf(data('ripestat/maxmind-geo-lite-193.0.6.139.json')), { country: 'NL', city: null, lat: 52.4, lon: 4.9, radius_m: 500000, places: 1 })
  assert.deepEqual(geoOf(data('ripestat/maxmind-geo-lite-192.0.2.10.json')), { country: 'FR', city: 'Lyon', lat: 45.7, lon: 4.8, radius_m: 50000, places: 1 })
  assert.equal(geoOf({ located_resources: [] }), null)
  const two = geoOf({ located_resources: [{ locations: [{ country: 'DE', city: '', latitude: 51.3, longitude: 9.5, covered_percentage: 30 }, { country: 'FR', city: 'Paris', latitude: 48.8566, longitude: 2.3522, covered_percentage: 70 }] }] })
  assert.deepEqual([two.country, two.city, two.places], ['FR', 'Paris', 2])
})

test('Tor and the clouds: the published lists, IPv4 and IPv6, the most specific prefix and every service on it', () => {
  const tor = fx('tor/torbulkexitlist.txt')
  assert.deepEqual([torListed('171.25.193.25', tor), torListed('1.1.1.1', tor), torListed('171.25.193.250', tor)], [true, false, false])
  const ranges = cloudRanges({ 'aws-ranges': fx('aws/ip-ranges.json'), 'gcp-ranges': fx('gcp/cloud.json'), 'cloudflare-v4': fx('cloudflare/ips-v4.txt'), 'cloudflare-v6': fx('cloudflare/ips-v6.txt') })
  assert.deepEqual(cloudMatch('3.5.141.9', ranges), [{ provider: 'aws', name: 'Amazon Web Services', prefix: '3.5.140.0/22', region: 'ap-northeast-2', services: ['AMAZON', 'S3', 'EC2'] }])
  assert.deepEqual(cloudMatch('2406:daba:f0ff::1', ranges).map(m => [m.name, m.region]), [['Amazon Web Services', 'ap-southeast-4']])
  assert.deepEqual(cloudMatch('34.155.1.1', ranges).map(m => [m.name, m.prefix, m.region]), [['Google Cloud', '34.155.0.0/16', 'europe-west9']])
  assert.deepEqual(cloudMatch('2606:4700:4700::1111', ranges).map(m => [m.name, m.prefix]), [['Cloudflare', '2606:4700::/32']])
  assert.deepEqual(cloudMatch('131.0.75.255', ranges).map(m => m.prefix), ['131.0.72.0/22']) // the last line, without a final newline
  assert.deepEqual([cloudMatch('1.1.1.1', ranges), cloudMatch('192.0.2.10', ranges)], [[], []])
  assert.equal(cloudRanges({ 'cloudflare-v4': '104.16.0.0/13' }).length, 1) // a list that could not be read is left out
})

test('looksResidential: subscriber words in a reverse name or a network name; servers and providers are not', () => {
  assert.equal(looksResidential('abo-45-113-0-203.dsl.exemple-fai.example'), 'abo')
  assert.equal(looksResidential('EXEMPLE-FAI-BROADBAND'), 'broadband')
  assert.equal(looksResidential('host-1-2-3-4.pool.example.net'), 'pool')
  for (const s of ['one.one.one.one', 'web1.exemple-hebergement.example', 'APNIC-LABS', 'CLOUDFLARENET', 'homepage.example', '', null]) assert.equal(looksResidential(s), null, String(s))
})

const fake = await startFake()
test.after(() => fake.close())
const env = fakeEnv(fake.url)
const NEW_IP = (ip, ...more) => ['new', 'ip', ip, '--question', `Who operates ${ip}?`, '--frame', 'noisy=never', ...more]
const ent = (dir, name) => readNote(path.join(dir, 'Entities', `${name}.md`)).props
const clues = dir => fs.readdirSync(path.join(dir, 'Clues'))
const clueText = dir => clues(dir).map(f => read(dir, `Clues/${f}`)).join('\n')
const clueStatus = (dir, fragment) => readNote(path.join(dir, 'Clues', clues(dir).find(f => f.includes(fragment)))).props.status
const kindsIn = dir => fs.readdirSync(path.join(dir, 'Entities')).map(f => ent(dir, f.slice(0, -3)).kind)

test('collect 1.1.1.1 (real answers): registry, routing, a confirmed reverse name, no position (anycast), Shodan, not Tor, no cloud range — and never the address itself', async () => {
  const home = casesFolder(), dir = path.join(home, '1-1-1-1'), before = fake.seen.length
  assert.equal((await run(home, NEW_IP('1.1.1.1'))).status, 0)
  const r = await run(home, ['ip', 'collect', '-p', '1-1-1-1'], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(events(dir).filter(e => e.kind === 'fail').map(e => e.text), [])
  const ip = ent(dir, '1.1.1.1')
  assert.deepEqual([ip.role, ip.version, ip.netname, ip.rir, ip.registered_country, ip.prefix, ip.asn, ip.as_holder, ip.tor_exit], ['subject', 4, 'APNIC-LABS', 'apnic', 'AU', '1.1.1.0/24', 'AS13335', 'Cloudflare, Inc.', false])
  assert.deepEqual(ip.ports.slice(0, 3), [53, 69, 80])
  assert.equal(ent(dir, 'APNIC Research and Development').role, 'registrant')
  assert.deepEqual([ent(dir, 'Cloudflare, Inc').role, ent(dir, 'Cloudflare, Inc').asn], ['AS holder', 'AS13335']) // safeName drops the final dot
  assert.equal(ent(dir, 'helpdesk@apnic.net').role, 'abuse contact')
  assert.deepEqual([ent(dir, 'one.one.one.one').role, ent(dir, 'one.one.one.one').confirmed], ['ptr', true])
  assert.equal(ent(dir, 'meusite.ifood.com.br').role, 'hostname')
  assert.ok(!kindsIn(dir).includes('place'))
  assert.deepEqual(json(dir, '.osint/views/map.json'), { type: 'FeatureCollection', features: [] })
  const text = clueText(dir)
  for (const want of [
    'Network APNIC-LABS (1.1.1.0 - 1.1.1.255) held by APNIC Research and Development, registered at APNIC (AU)',
    'Abuse contact: helpdesk@apnic.net', 'Announced by AS13335 CLOUDFLARENET - Cloudflare, Inc. in 1.1.1.0/24',
    'Reverse name one.one.one.one, which resolves back to 1.1.1.1', 'No geolocation for 1.1.1.1 (anycast, or unknown to GeoLite2)',
    'Shodan saw ports 53, 69, 80, 443, 2053, 2082, 2087, 2096, 8080, 8443, 8880 open on 1.1.1.1 — software: cpe:/a:cloudflare:cloudflare',
    '3 names pointed to 1.1.1.1 when Shodan looked: one.one.one.one, meusite.ifood.com.br, guestwebauth.regeneron.com — not proof of who operates it',
    'Shodan tags 1.1.1.1: pqc', '1.1.1.1 is not a Tor exit (Tor Project list of',
    '1.1.1.1 is in none of the ranges published by Amazon Web Services, Google Cloud, Cloudflare',
  ]) assert.ok(text.includes(want), want)
  assert.ok(!text.includes('The whois record says')) // person: false: the whois description stays in the capture (L3 review)
  assert.equal(clueStatus(dir, 'No geolocation'), 'inferred')
  assert.equal(clueStatus(dir, 'names pointed'), 'inferred')
  assert.equal(fs.readdirSync(path.join(dir, 'Sources')).length, 7)
  assert.ok(json(dir, '.osint/views/timeline.json').some(i => i.label === 'Network registered' && i.date.startsWith('2011-08-10')))
  const seen = fake.seen.slice(before)
  assert.deepEqual([...new Set(seen.map(s => s.service))].sort(), ['aws', 'cloudflare', 'gcp', 'internetdb', 'rdap', 'ripestat', 'tor'])
  assert.ok(!seen.some(s => DENY.has(s.host)))
})

test('collect an IPv6 address written long: one canonical entity, Cloudflare by RDAP, by its AS and by its published ranges', async () => {
  const home = casesFolder(), dir = path.join(home, 'cloudflare-dns-v6')
  assert.equal((await run(home, NEW_IP('2606:4700:4700:0:0:0:0:1111', '--title', 'Cloudflare DNS v6'))).status, 0)
  const r = await run(home, ['ip', 'collect', '-p', 'cloudflare-dns-v6'], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(events(dir).filter(e => e.kind === 'fail').map(e => e.text), [])
  const ip = ent(dir, '2606-4700-4700--1111')
  assert.deepEqual([ip.value, ip.version, ip.netname, ip.rir, ip.prefix, ip.shodan_tags], ['2606:4700:4700::1111', 6, 'CLOUDFLARENET', 'arin', '2606:4700:4700::/48', ['cdn']])
  assert.equal(ent(dir, 'Cloudflare').role, 'cloud')
  assert.equal(ent(dir, 'abuse@cloudflare.com').role, 'abuse contact')
  const text = clueText(dir)
  assert.ok(text.includes('2606:4700:4700::1111 is in Cloudflare\'s published ranges: 2606:4700::/32'))
  assert.ok(text.includes('Network CLOUDFLARENET (2606:4700:: - 2606:4700:ffff:ffff:ffff:ffff:ffff:ffff) held by Cloudflare, Inc., registered at ARIN'))
  assert.ok(!text.includes('The whois record says')) // ARIN's « No match » is no record
})

test('collect 192.0.2.10 in French: a 50 km circle around Lyon on the map, a coarse place without a pin, the host on both registries, a confirmed PTR', async () => {
  const home = casesFolder(), dir = path.join(home, '192-0-2-10')
  assert.equal((await run(home, NEW_IP('192.0.2.10', '--lang', 'fr'))).status, 0)
  assert.equal((await run(home, ['ip', 'collect', '-p', '192-0-2-10'], env)).status, 0)
  assert.deepEqual(events(dir).filter(e => e.kind === 'fail').map(e => e.text), [])
  const map = json(dir, '.osint/views/map.json')
  assert.deepEqual(map.features.map(f => [f.geometry, f.properties.role, f.properties.radius_m, f.properties.ref, f.properties.label]), [[{ type: 'Point', coordinates: [4.8, 45.7] }, 'place', 50000, 'Entities/Lyon, FR.md', 'Lyon, FR — ±50 km (GeoLite2)']])
  const place = ent(dir, 'Lyon, FR')
  assert.deepEqual([place.kind, place.coarse, place.center, place.radius_m, place.lat, place.lon], ['place', true, '45.7, 4.8', 50000, undefined, undefined])
  assert.equal(clueStatus(dir, 'GeoLite2'), 'inferred')
  assert.ok(clueText(dir).includes('GeoLite2 place 192.0.2.10 vers Lyon, FR (±50 km, une estimation de base de données, jamais une rue)'))
  assert.deepEqual([ent(dir, 'Exemple Hébergement SAS').kind, ent(dir, 'abuse@exemple-hebergement.example').role], ['organization', 'abuse contact'])
  assert.deepEqual([ent(dir, 'web1.exemple-hebergement.example').role, ent(dir, 'web1.exemple-hebergement.example').confirmed], ['ptr', true])
  assert.deepEqual(json(dir, '.osint/views/open.json'), [{ type: 'port', value: '80' }, { type: 'port', value: '443' }, { type: 'hostname', value: 'web1.exemple-hebergement.example' }, { type: 'cpe', value: 'cpe:/a:nginx:nginx' }])
  assert.ok(json(dir, '.osint/views/timeline.json').some(i => i.label === 'Réseau enregistré' && i.date.startsWith('2015-06-01')))
  assert.ok(json(dir, '.osint/case.json').relations.some(x => x.label === 'geolocated around (estimate)'))
})

test('an address no public registry describes, or no address at all: refused before any request', async () => {
  const home = casesFolder()
  for (const [input, slug, why] of [['192.168.1.10', '192-168-1-10', /192\.168\.1\.10 is a private address \(192\.168\.0\.0\/16\)/], ['100.64.3.4', '100-64-3-4', /carrier-grade NAT/], ['1.1.1', '1-1-1', /is not an IP address/], ['1.2.3.4:80', '1-2-3-4-80', /is not an IP address/]]) {
    assert.equal((await run(home, NEW_IP(input))).status, 0, input)
    const before = fake.seen.length
    const r = await run(home, ['ip', 'collect', '-p', slug], env)
    assert.equal(r.status, 1, input)
    assert.match(r.err, why)
    assert.equal(fake.seen.length, before, `${input}: no request`)
  }
  await run(home, NEW_IP('192.0.2.10'))
  const bad = await run(home, ['ip', 'collect', '--only', 'whois', '-p', '192-0-2-10'], env)
  assert.equal(bad.status, 1)
  assert.match(bad.err, /--only registry,prefix,rdns,geo,ports,tor,cloud \(not whois\)/)
})

test('a subscriber line: an inferred clue and a warning to review the frame, once, nothing more on the subscriber', async () => {
  const home = casesFolder(), dir = path.join(home, '203-0-113-45')
  await run(home, NEW_IP('203.0.113.45'))
  const r = await run(home, ['ip', 'collect', '--only', 'rdns', '-p', '203-0-113-45'], env)
  assert.equal(r.status, 0, r.err)
  assert.match(r.err, /warning: 203\.0\.113\.45 looks like a residential line \(« abo »\): a residential IP is personal data — if the frame says person: false, ask the user/)
  assert.equal(clueStatus(dir, 'residential'), 'inferred')
  assert.equal(clueStatus(dir, 'Reverse name'), 'inferred') // the name does not resolve back: only claimed
  assert.equal(ent(dir, 'abo-45-113-0-203.dsl.exemple-fai.example').confirmed, false)
  assert.match(read(dir, 'Journal.md'), /looks like a residential line/)
  const again = await run(home, ['ip', 'collect', '--only', 'rdns', '-p', '203-0-113-45'], env)
  assert.doesNotMatch(again.err, /warning/)
  assert.equal(clues(dir).filter(f => f.includes('residential')).length, 1)
})

test('a shared address with many names: 50 domain entities at most, the rest counted, said to prove nothing; CVE ids noted as inferred', async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-fx-'))
  fs.cpSync(FIXTURES, copy, { recursive: true })
  const names = Array.from({ length: 80 }, (_, i) => `site${i + 1}.example`)
  fs.writeFileSync(path.join(copy, 'internetdb', '198.51.100.7.json'), JSON.stringify({ ip: '198.51.100.7', ports: [80, 443], hostnames: names, cpes: [], tags: ['cdn'], vulns: ['CVE-2024-0001'] }))
  const f2 = await startFake({ fixtures: copy })
  try {
    const home = casesFolder(), dir = path.join(home, '198-51-100-7')
    await run(home, NEW_IP('198.51.100.7'))
    assert.equal((await run(home, ['ip', 'collect', '--only', 'ports', '-p', '198-51-100-7'], fakeEnv(f2.url, copy))).status, 0)
    assert.equal(fs.readdirSync(path.join(dir, 'Entities')).filter(f => f.startsWith('site')).length, 50)
    assert.match(clueText(dir), /80 names pointed to 198\.51\.100\.7 when Shodan looked: site1\.example, .*site10\.example, \+70 — not proof of who operates it/)
    assert.equal(clueStatus(dir, 'CVE'), 'inferred')
    assert.ok(clueText(dir).includes('Shodan lists 1 CVE ids for the software it saw: CVE-2024-0001 — noted, never tested'))
  } finally { f2.close() }
})

test('refresh: nothing new adds nothing; a port opened and a new Tor listing add one clue each and say so in What changed', async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-fx-'))
  fs.cpSync(FIXTURES, copy, { recursive: true })
  const idb = path.join(copy, 'internetdb', '198.51.100.7.json'), tor = path.join(copy, 'tor', 'torbulkexitlist.txt')
  fs.writeFileSync(idb, JSON.stringify({ ip: '198.51.100.7', ports: [443], hostnames: [], cpes: [], tags: [], vulns: [] }))
  fs.writeFileSync(tor, '171.25.193.25\n80.67.167.81\n')
  const f2 = await startFake({ fixtures: copy }), env2 = fakeEnv(f2.url, copy)
  try {
    const home = casesFolder(), dir = path.join(home, '198-51-100-7'), P = ['-p', '198-51-100-7']
    const count = () => ({ clues: clues(dir).length, sources: fs.readdirSync(path.join(dir, 'Sources')).length })
    await run(home, NEW_IP('198.51.100.7'))
    assert.equal((await run(home, ['ip', 'collect', '--only', 'ports,tor', ...P], env2)).status, 0)
    const n = count()
    const same = await run(home, ['refresh', ...P, '--json'], env2)
    assert.equal(same.status, 0, same.err)
    assert.deepEqual(count(), n)
    fs.writeFileSync(idb, JSON.stringify({ ip: '198.51.100.7', ports: [22, 443], hostnames: [], cpes: [], tags: [], vulns: [] }))
    fs.writeFileSync(tor, '171.25.193.25\n198.51.100.7\n')
    fs.rmSync(path.join(home, '.cache', 'datasets'), { recursive: true, force: true }) // the Tor list is kept an hour
    const r = await run(home, ['refresh', ...P, '--json'], env2)
    assert.equal(r.status, 0, r.err)
    const diffs = Object.fromEntries(JSON.parse(r.out).diffs.map(d => [d.name, d]))
    assert.deepEqual(diffs.ports.added.map(x => x.key), ['port:22'])
    assert.deepEqual(diffs.tor.changed, [{ key: '198.51.100.7', fields: ['exit'] }])
    assert.deepEqual(count(), { clues: n.clues + 2, sources: n.sources + 2 })
    assert.match(clueText(dir), /198\.51\.100\.7 is a Tor exit \(Tor Project list of \d{4}-\d{2}-\d{2}\): whoever used it is not its operator/)
    assert.match(read(dir, 'Case.md'), /ports: \+1 \(port:22\)/)
    assert.match(read(dir, 'Case.md'), /tor: ~1 \(198\.51\.100\.7: exit\)/)
    assert.equal(ent(dir, '198.51.100.7').tor_exit, true)
  } finally { f2.close() }
})

test('hostile registry, whois, reverse-DNS and Shodan text never reaches a note as markdown, an embed or an engine block end', async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-fx-'))
  fs.cpSync(FIXTURES, copy, { recursive: true })
  const evil = '![x](http://evil.example/p.png) [l](http://evil.example) %%osint:end%% <script>alert(1)</script>'
  const rd = JSON.parse(fx('rdap/ip-192.0.2.10.json'))
  rd.name = `NET\n${evil}`
  rd.entities[0].vcardArray[1][1][3] = evil
  rd.entities[1].vcardArray[1][3][3] = 'abuse@x.example, <b>y</b>@z'
  fs.writeFileSync(path.join(copy, 'rdap', 'ip-198.51.100.7.json'), JSON.stringify(rd))
  const wh = JSON.parse(fx('ripestat/whois-192.0.2.10.json'))
  wh.data.records[0].push({ key: 'descr', value: evil })
  fs.writeFileSync(path.join(copy, 'ripestat', 'whois-198.51.100.7.json'), JSON.stringify(wh))
  fs.writeFileSync(path.join(copy, 'ripestat', 'abuse-contact-finder-198.51.100.7.json'), JSON.stringify({ status: 'ok', data: { abuse_contacts: [evil, 'ok@x.example'], authoritative_rir: 'ripe' } }))
  fs.writeFileSync(path.join(copy, 'ripestat', 'reverse-dns-ip-198.51.100.7.json'), JSON.stringify({ status: 'ok', data: { result: [evil, 'fine.example.'] } }))
  const f2 = await startFake({ fixtures: copy })
  try {
    const home = casesFolder(), dir = path.join(home, '198-51-100-7')
    await run(home, NEW_IP('198.51.100.7'))
    const r = await run(home, ['ip', 'collect', '--only', 'registry,rdns', '-p', '198-51-100-7'], fakeEnv(f2.url, copy))
    assert.equal(r.status, 0, r.err)
    const all = [...fs.readdirSync(path.join(dir, 'Entities')).map(f => read(dir, `Entities/${f}`)), ...clues(dir).map(f => read(dir, `Clues/${f}`)), ...fs.readdirSync(path.join(dir, 'Entities'))].join('\n')
    for (const bad of ['![', '](', '%%osint:end%%', '<script>', '<b>']) assert.ok(!all.includes(bad), `${bad} in ${all.split('\n').find(l => l.includes(bad))}`)
    assert.ok(fs.readdirSync(path.join(dir, 'Entities')).includes('fine.example.md') || fs.readdirSync(path.join(dir, 'Entities')).includes('ok@x.example.md'))
    assert.ok(!fs.readdirSync(path.join(dir, 'Entities')).some(f => /[<>[\]%]/.test(f)))
  } finally { f2.close() }
})

test('a residential line when the frame says person: true: the clue, no warning to ask for the frame', async () => {
  const home = casesFolder(), dir = path.join(home, '203-0-113-45')
  await run(home, ['new', 'ip', '203.0.113.45', '--question', 'Whose line is this?', '--frame', 'noisy=never', '--frame', 'person=true', '--frame', 'legal_basis=Legitimate interest — an abuse report'])
  const r = await run(home, ['ip', 'collect', '--only', 'rdns', '-p', '203-0-113-45'], env)
  assert.equal(r.status, 0, r.err)
  assert.doesNotMatch(r.err, /warning/)
  assert.equal(clueStatus(dir, 'residential'), 'inferred')
  assert.ok(!kindsIn(dir).includes('person'))
})

test('doctor: the five lists once kept, each with its size and date; the ip type ready; the four list hosts probed', async () => {
  const home = casesFolder()
  await run(home, NEW_IP('1.1.1.1'))
  assert.equal((await run(home, ['ip', 'collect', '--only', 'tor,cloud', '-p', '1-1-1-1'], env)).status, 0)
  // one line per declared dataset, named by its id: its label, what describe() said, the day, the size
  const before = JSON.parse((await run(casesFolder(), ['doctor', '--json'], env)).out).lines.find(l => l.name === 'tor-exits')
  assert.deepEqual([before.status, before.text], ['info', 'tor exit list: not downloaded yet — the first ip case fetches it'])
  const d = JSON.parse((await run(home, ['doctor', '--json'], env)).out), line = id => d.lines.find(l => l.name === id)
  // the counts come from the recorded lists themselves
  const aws = JSON.parse(fx('aws/ip-ranges.json')), gcp = JSON.parse(fx('gcp/cloud.json')), lines = rel => fx(rel).split('\n').filter(Boolean).length
  for (const [id, text] of [['tor-exits', `tor exit list: ${lines('tor/torbulkexitlist.txt')} exits`], ['aws-ranges', `aws ip ranges: ${aws.prefixes.length + aws.ipv6_prefixes.length} prefixes`], ['gcp-ranges', `google cloud ip ranges: ${gcp.prefixes.length} prefixes`], ['cloudflare-v4', 'cloudflare ipv4 ranges: 15 prefixes'], ['cloudflare-v6', 'cloudflare ipv6 ranges: 7 prefixes']]) {
    assert.equal(line(id)?.status, 'ok', id)
    assert.match(line(id).text, new RegExp(`^${text}, \\d{4}-\\d{2}-\\d{2} \\(\\d+ KB\\)$`), id)
  }
  assert.equal(d.lines.filter(l => l.name === 'tor-exits').length, 1) // never two lines for one dataset
  assert.ok(d.types.some(t => t.id === 'ip' && t.ready))
  Object.assign(process.env, env)
  for (const s of ['tor', 'aws', 'gcp', 'cloudflare']) assert.equal((await request(s, PROBES[s][0])).status, 200, s)
})
