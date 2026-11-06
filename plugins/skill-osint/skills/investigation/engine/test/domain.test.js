import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { domainOf, luhn, readHome } from '../../types/domain/engine.js'
import { DENY } from '../lib/net.js'
import { loadTypes, validateEngine, validateManifest } from '../lib/types.js'
import { readNote } from '../lib/vault.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, events, FIXTURES, json, NEW, read, run } from './helpers.js'

const fake = await startFake()
test.after(() => fake.close())
const P = ['-p', 'durand-bakery-example'], env = fakeEnv(fake.url)
const ASK = [...NEW.slice(0, -1), 'noisy=ask']
const ent = (dir, value) => readNote(path.join(dir, 'Entities', `${value}.md`)).props

test('every real type is sound: its manifest, its method sections, its engine commands', async () => {
  for (const t of loadTypes()) {
    assert.deepEqual(validateManifest(t), [], t.id)
    assert.deepEqual(await validateEngine(t), [], t.id)
  }
})

test('readHome: the title, the tech, the trackers, the social links (not the share buttons), the emails, a SIREN that passes Luhn, the legal notice', () => {
  const html = fs.readFileSync(path.join(FIXTURES, 'web', 'durand-bakery.example', 'index.html'), 'utf8')
  const h = readHome(html, { server: 'nginx' }, 'https://durand-bakery.example/')
  assert.equal(h.title, 'Boulangerie Durand — pains et viennoiseries')
  assert.deepEqual(h.tech, ['WordPress 6.6', 'WordPress', 'server: nginx'])
  assert.deepEqual(h.trackers, [{ service: 'google-analytics', id: 'G-DURAND123' }, { service: 'google-tag-manager', id: 'GTM-DUR4ND' }, { service: 'facebook-pixel', id: '123456789012345' }])
  assert.deepEqual(h.social, ['https://www.instagram.com/durand.bakery', 'https://www.facebook.com/BoulangerieDurandExample'])
  assert.deepEqual(h.emails, ['contact@durand-bakery.example'])
  assert.deepEqual(h.siren, ['456789122'])
  assert.equal(h.legal, 'https://durand-bakery.example/mentions-legales')
  assert.deepEqual([luhn('456789122'), luhn('123456789')], [true, false])
  assert.deepEqual([domainOf('https://WWW.Durand-Bakery.example/a'), domainOf('durand-bakery.example.'), domainOf('mailto:Contact@Durand-Bakery.example'), domainOf('contact@durand-bakery.example'), domainOf('Jeanne <j@www.durand-bakery.example>'.replace(/.*<|>/g, ''))], Array(5).fill('durand-bakery.example'))
  for (const bad of ['', 'not a domain', 'contact@', '@', 'localhost', '192.0.2.1', 'a@b@c', 'mailto:', 'https://']) assert.throws(() => domainOf(bad), /not a domain name/, bad)
})

test('collect: RDAP, DNS, certificates, Wayback, hosting and the home page become sources, entities, clues, a timeline and snapshots', async () => {
  const home = casesFolder(), dir = path.join(home, 'durand-bakery-example')
  await run(home, ASK)
  const r = await run(home, ['domain', 'collect', '--yes', ...P], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(events(dir).filter(e => e.kind === 'fail'), [])
  const d = ent(dir, 'durand-bakery.example')
  assert.deepEqual([d.registered, d.expires, d.first_capture, d.last_capture], ['2019-03-14', '2027-03-14', '2019-04-02', '2026-10-20'])
  assert.equal(ent(dir, 'Exemple Registrar SAS').role, 'registrar')
  const ip = ent(dir, '192.0.2.10')
  assert.deepEqual([ip.asn, ip.holder, ip.ports], ['AS64500', 'Exemple Hébergement SAS', [80, 443]])
  assert.deepEqual(['www', 'shop', 'mail'].map(s => ent(dir, `${s}.durand-bakery.example`).first_seen), ['2024-01-10', '2025-06-01', '2026-09-20'])
  assert.equal(ent(dir, 'G-DURAND123').service, 'google-analytics')
  assert.equal(ent(dir, 'google-site-verification=durandVERIFY123').kind, 'tracker')
  assert.equal(ent(dir, 'https---www.instagram.com-durand.bakery').kind, 'account')
  assert.equal(ent(dir, 'SIREN 456 789 122').siren, '456789122')
  const clues = fs.readdirSync(path.join(dir, 'Clues')).join('\n')
  for (const want of ['Registrar- Exemple Registrar SAS', 'Mail by Google Workspace', '3 subdomains in Certificate Transparency', 'Hosted by Exemple Hébergement SAS']) assert.ok(clues.includes(want), want)
  assert.ok(json(dir, '.osint/views/timeline.json').some(i => i.label === 'Registered'))
  assert.ok(json(dir, '.osint/views/dns.json').some(x => x.type === 'MX' && x.value === '1 aspmx.l.google.com'))
  for (const s of ['rdap', 'dns', 'crt', 'wayback', 'host', 'home']) assert.ok(fs.existsSync(path.join(dir, '.osint', 'collect', s, '1.json')), s)
  assert.ok(!fake.seen.some(x => DENY.has(x.host)))
  assert.ok(json(dir, '.osint/case.json').relations.some(x => x.label === 'registrar'))
})

test('depth quick runs rdap, dns and home only; subdomains=true resolves each subdomain', async () => {
  const home = casesFolder()
  await run(home, [...ASK, '--in', 'depth=quick', '--title', 'quick'])
  assert.equal((await run(home, ['domain', 'collect', '--yes', '-p', 'quick'], env)).status, 0)
  assert.deepEqual(fs.readdirSync(path.join(home, 'quick', '.osint', 'collect')).sort(), ['dns', 'home', 'rdap'])
  await run(home, [...NEW, '--in', 'subdomains=true', '--title', 'deep'])
  assert.equal((await run(home, ['domain', 'collect', '--only', 'crt', '-p', 'deep'], env)).status, 0)
  assert.equal(ent(path.join(home, 'deep'), 'shop.durand-bakery.example').ip, '192.0.2.20')
  assert.equal((await run(home, ['domain', 'collect', '--only', 'whois', '-p', 'deep'], env)).status, 1)
})

test('legal-notice reads the page the home page links to: the SIREN, the publication director, the host', async () => {
  const home = casesFolder(), dir = path.join(home, 'durand-bakery-example')
  await run(home, ASK)
  assert.equal((await run(home, ['domain', 'legal-notice', '--yes', ...P], env)).status, 1)
  await run(home, ['domain', 'collect', '--only', 'home', '--yes', ...P], env)
  const r = await run(home, ['domain', 'legal-notice', '--yes', ...P], env)
  assert.equal(r.status, 0, r.err)
  assert.ok(!fs.existsSync(path.join(dir, 'Entities', 'Jeanne Durand.md')), 'no person entity without the person frame')
  assert.equal(ent(dir, 'Exemple Hébergement SAS').role, 'hosting (legal notice)')
  assert.match(fs.readdirSync(path.join(dir, 'Clues')).join('\n'), /Publication director- Jeanne Durand/)
})

test('legal-notice: with the person frame the publication director becomes a person entity', async () => {
  const home = casesFolder(), dir = path.join(home, 'durand-bakery-example')
  await run(home, [...ASK, '--frame', 'person=true', '--frame', 'legal_basis=legitimate interest: checking a seller'])
  await run(home, ['domain', 'collect', '--only', 'home', '--yes', ...P], env)
  assert.equal((await run(home, ['domain', 'legal-notice', '--yes', ...P], env)).status, 0)
  assert.equal(ent(dir, 'Jeanne Durand').role, 'publication director')
})

test('refresh: a certificate issued since, found by diff', async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-fx-'))
  fs.cpSync(FIXTURES, copy, { recursive: true })
  const f2 = await startFake({ fixtures: copy }), env2 = fakeEnv(f2.url, copy)
  try {
    const home = casesFolder(), dir = path.join(home, 'durand-bakery-example')
    await run(home, ASK)
    await run(home, ['domain', 'collect', '--yes', ...P], env2)
    const crt = path.join(copy, 'crtsh', 'durand-bakery.example.json'), rows = JSON.parse(fs.readFileSync(crt, 'utf8'))
    rows.push({ issuer_name: 'C=US, O=Let\'s Encrypt, CN=R11', common_name: 'api.durand-bakery.example', name_value: 'api.durand-bakery.example', id: 1004, not_before: '2026-11-01T00:00:00', not_after: '2027-01-30T00:00:00' })
    fs.writeFileSync(crt, JSON.stringify(rows))
    const r = await run(home, ['refresh', '--yes', ...P, '--json'], env2)
    assert.equal(r.status, 0, r.err)
    const crtDiff = JSON.parse(r.out).diffs.find(x => x.name === 'crt')
    assert.deepEqual(crtDiff.added.map(x => x.key), ['api.durand-bakery.example'])
    assert.match(read(dir, 'Case.md'), /crt: \+1 \(api\.durand-bakery\.example\)/)
  } finally { f2.close() }
})

test('the real recorded answers for example.org parse without a failure', async () => {
  const home = casesFolder()
  await run(home, ['new', 'domain', 'example.org', '--question', 'Who runs example.org?', '--frame', 'noisy=never'])
  const r = await run(home, ['domain', 'collect', '--only', 'rdap,dns,crt,wayback,host', '-p', 'example-org'], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(events(path.join(home, 'example-org')).filter(e => e.kind === 'fail').map(e => e.text), [])
  assert.ok(ent(path.join(home, 'example-org'), 'example.org').registered)
})

test('noisy frame: never skips home and refuses the legal notice; ask needs the yes (code 2); the quiet steps never do', async () => {
  const home = casesFolder(), dir = path.join(home, 'durand-bakery-example'), web = () => fake.seen.filter(x => x.service === 'web').length
  await run(home, NEW)
  const before = web()
  const r = await run(home, ['domain', 'collect', ...P], env)
  assert.equal(r.status, 0, r.err)
  assert.equal(web(), before, 'no read of the site')
  assert.ok(!fs.existsSync(path.join(dir, '.osint', 'collect', 'home')))
  assert.match(read(dir, 'Journal.md'), /skipped home: noisy steps are never run in this case/)
  assert.equal((await run(home, ['domain', 'legal-notice', '--yes', ...P], env)).status, 1)
  const h2 = casesFolder()
  await run(h2, ASK)
  const a = await run(h2, ['domain', 'collect', ...P], env)
  assert.equal(a.status, 2)
  assert.match(a.err, /home.*noisy.*--yes/)
  assert.equal((await run(h2, ['domain', 'collect', '--only', 'rdap,dns', ...P], env)).status, 0)
  assert.equal((await run(h2, ['domain', 'legal-notice', ...P], env)).status, 2)
  assert.equal(web(), before)
  assert.equal((await run(h2, ['refresh', ...P], env)).status, 2)
  assert.equal((await run(h2, ['refresh', '--yes', ...P], env)).status, 0)
  assert.ok(web() > before, 'refresh --yes reads the home page')
})

test('collecting again against the real services creates no source when only the RDAP database date or the DNS answer order changed', async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-fx-'))
  fs.cpSync(FIXTURES, copy, { recursive: true })
  const f2 = await startFake({ fixtures: copy }), env2 = fakeEnv(f2.url, copy)
  try {
    const home = casesFolder(), dir = path.join(home, 'durand-bakery-example'), sources = () => fs.readdirSync(path.join(dir, 'Sources')).length
    await run(home, NEW)
    const rdap = path.join(copy, 'rdap', 'domain-durand-bakery.example.json'), dnsFile = path.join(copy, 'dns.json')
    const j = JSON.parse(fs.readFileSync(rdap, 'utf8')), z = JSON.parse(fs.readFileSync(dnsFile, 'utf8'))
    j.events.push({ eventAction: 'last update of RDAP database', eventDate: '2026-11-01T00:00:00Z' })
    z['durand-bakery.example'].A = ['192.0.2.10', '192.0.2.11']; z['durand-bakery.example'].TXT = [['b=2'], ['a=1']]
    fs.writeFileSync(rdap, JSON.stringify(j)); fs.writeFileSync(dnsFile, JSON.stringify(z))
    assert.equal((await run(home, ['domain', 'collect', '--only', 'rdap,dns', ...P], env2)).status, 0)
    const n = sources()
    j.events.at(-1).eventDate = '2026-11-02T00:00:00Z'
    z['durand-bakery.example'].A.reverse(); z['durand-bakery.example'].TXT.reverse()
    fs.writeFileSync(rdap, JSON.stringify(j)); fs.writeFileSync(dnsFile, JSON.stringify(z))
    assert.equal((await run(home, ['domain', 'collect', '--only', 'rdap,dns', ...P], env2)).status, 0)
    assert.equal(sources(), n)
  } finally { f2.close() }
})
