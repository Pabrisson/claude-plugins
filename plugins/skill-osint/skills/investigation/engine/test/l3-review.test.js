// The fixes of the L3 review (stages 4 to 9): one file, one test per point.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { isLocalAddress, request } from '../lib/net.js'
import { casesFolder, NEW, run } from './helpers.js'

const listen = handler => new Promise(ok => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => ok(s)) })
const noBase = async f => { const was = process.env.OSINT_BASE_WEB; delete process.env.OSINT_BASE_WEB; try { return await f() } finally { if (was !== undefined) process.env.OSINT_BASE_WEB = was } }

test('an IPv6 that carries a local IPv4 is local, however URL writes it', async () => {
  for (const h of ['[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::ffff:a00:1]', '[::7f00:1]', '[64:ff9b::7f00:1]', '[64:ff9b::a00:1]', '[2002:7f00:1::]', '[::]', '[::1]', '[::ffff:c0a8:1]', '[::ffff:a9fe:a9fe]'])
    assert.ok(isLocalAddress(new URL(`http://${h}/`).hostname), h)
  for (const h of ['[2606:4700::1111]', '[::ffff:808:808]', '[64:ff9b::808:808]', '1.1.1.1']) assert.ok(!isLocalAddress(new URL(`http://${h}/`).hostname), h)
})

test('a page at such an address is never fetched, nor a redirect to it', async () => {
  const s = await listen((q, r) => r.end('LOCAL-HIT'))
  const port = s.address().port
  try {
    await noBase(async () => {
      for (const h of ['[::ffff:127.0.0.1]', '[::ffff:7f00:1]', '[::7f00:1]', '[64:ff9b::7f00:1]', '[::ffff:a00:1]'])
        await assert.rejects(request('web', `http://${h}:${port}/x`, { timeout: 2000 }), /refused/, h)
    })
  } finally { s.close() }
})

test('a real service that redirects to this machine is refused at the hop', async () => {
  const hits = []
  const local = await listen((q, r) => { hits.push(q.url); r.end('LOCAL-HIT') })
  const { fetch: real } = globalThis
  const to = `http://[::ffff:127.0.0.1]:${local.address().port}/secret`
  // a fake fetch stands for rdap.org: it answers 302 to the local address, and passes the other calls
  globalThis.fetch = async (url, o) => (String(url).startsWith('https://rdap.org') ? new Response(null, { status: 302, headers: { location: to } }) : real(url, o))
  try { await assert.rejects(request('rdap', '/ip/1.1.1.1', { timeout: 2000 }), /refused/) } finally { globalThis.fetch = real; local.close() }
  assert.deepEqual(hits, [])
})

test('a third party\'s title never loads an image from a note: entity, source, Gravatar', async () => {
  const home = casesFolder(), dir = path.join(home, 'durand-bakery-example'), cap = path.join(home, 'p.html')
  fs.writeFileSync(cap, '<html><title>Durand ![x](https://tracker.example/pixel.png)</title></html>')
  await run(home, NEW)
  assert.equal((await run(home, ['source', 'https://durand-bakery.example/![u](https://tracker.example/u.png)', '--file', cap, '-p', 'durand-bakery-example'])).status, 0)
  assert.equal((await run(home, ['entity', 'organization', 'Durand ![e](https://tracker.example/e.png)', '-p', 'durand-bakery-example'])).status, 0)
  assert.equal((await run(home, ['entity', 'url', 'https://gravatar.com/a![b](https://tracker.example/q.png)', '-p', 'durand-bakery-example'])).status, 0) // a Gravatar profile_url
  for (const d of ['Sources', 'Entities']) for (const f of fs.readdirSync(path.join(dir, d))) assert.doesNotMatch(fs.readFileSync(path.join(dir, d, f), 'utf8').replace(/^---[\s\S]*?\n---/, ''), /(?<!\\)!\[(?!\[)/, f)
})

test('a namesake officer shares its key with the same person of another case; an establishment is not merged with another by distance', async () => {
  const { normalize, samePlace } = await import('../lib/kinds.js')
  assert.equal(normalize('person', 'Jean Durand (1961-04)', { born: '1961-04' }), normalize('person', 'Jean Durand', { born: '1961-04' }))
  const a = { siret: '45678912200029', lat: 45.9012, lon: 2.7021 }, b = { siret: '45678912200037', lat: 45.9013, lon: 2.7022 }
  assert.equal(samePlace(a, b), false) // two establishments 15 m apart
  assert.equal(samePlace(a, { siret: '456 789 122 00029' }), true)
  assert.equal(samePlace(a, { osm: 'node/1', role: 'poi', lat: 45.9013, lon: 2.7022 }), false) // a shop next door
  assert.equal(samePlace(a, { osm: 'way/2', role: 'building', lat: 45.9013, lon: 2.7022 }), true) // the building of the head office
  assert.equal(samePlace(a, { lat: 45.9013, lon: 2.7022, role: 'subject' }), true) // the subject place, no id: within 100 m
})

// ---- company-fr
import os from 'node:os'
import { fakeEnv, startFake } from './fake.mjs'
import { FIXTURES, json, read } from './helpers.js'
const fxCopy = async edit => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-fx-'))
  fs.cpSync(FIXTURES, copy, { recursive: true })
  const change = (rel, fn) => { const f = path.join(copy, rel), j = JSON.parse(fs.readFileSync(f, 'utf8')); fn(j); fs.writeFileSync(f, JSON.stringify(j)) }
  edit?.(change)
  const f = await startFake({ fixtures: copy })
  return { copy, change, close: () => f.close(), env: fakeEnv(f.url, copy) }
}
const NEWCO = ['new', 'company-fr', 'SIREN 456 789 122', '--title', 'Boulangerie Durand', '--question', 'Who runs this company?']
const allText = dir => ['Sources', 'Entities', 'Clues', 'Evidence/captures'].flatMap(d => (fs.existsSync(path.join(dir, d)) ? fs.readdirSync(path.join(dir, d)).map(f => read(dir, `${d}/${f}`)) : [])).join('\n')

test('a service that does not answer is an error line and a Journal line, never a stack', async () => {
  const home = casesFolder(), env = { OSINT_BASE_ENTREPRISES: 'http://127.0.0.1:9', OSINT_BASE_BODACC: 'http://127.0.0.1:9' }
  await run(home, NEWCO, env)
  for (const c of ['collect', 'bodacc']) {
    const r = await run(home, ['company-fr', c, '-p', 'boulangerie-durand'], env)
    assert.equal(r.status, 1, c)
    assert.match(r.err, new RegExp(`^error: company-fr ${c}: `, 'm'), c)
    assert.doesNotMatch(r.err, /\n\s+at /, c)
  }
  assert.match(read(path.join(home, 'boulangerie-durand'), 'Journal.md'), /company-fr bodacc: /)
})

test('company-fr: a company not fully public is refused flat; a sole trader keeps its commune only; the sources keep only what was retained', async () => {
  const hid = await fxCopy(c => c('entreprises/search-456789122.json', j => { j.results[0].statut_diffusion = 'P' }))
  const ei = await fxCopy(c => {
    c('entreprises/search-456789122.json', j => { j.results[0].nature_juridique = '1000' })
    c('entreprises/search-boulangerie-durand.json', j => { j.results[0].nature_juridique = '1000'; j.results.push({ siren: '999999999', nom_complet: 'THIRD PARTY SARL', nature_juridique: '5499', siege: {} }) })
  })
  try {
    let home = casesFolder(), dir = path.join(home, 'boulangerie-durand')
    await run(home, NEWCO)
    const r = await run(home, ['company-fr', 'collect', '-p', 'boulangerie-durand'], hid.env)
    assert.equal(r.status, 1)
    assert.match(r.err, /not fully public/)
    assert.equal(allText(dir).trim(), '')
    home = casesFolder(); dir = path.join(home, 'boulangerie-durand')
    await run(home, NEWCO)
    const e = await run(home, ['company-fr', 'collect', '-p', 'boulangerie-durand'], ei.env)
    assert.equal(e.status, 0, e.err)
    const text = allText(dir)
    assert.doesNotMatch(text, /PLACE DE L'EXEMPLE|45\.9012|2\.7021|"code_postal"|THIRD PARTY/)
    assert.match(text, /EXEMPLEVILLE/)
    assert.deepEqual(json(dir, '.osint/views/map.json').features, [])
  } finally { hid.close(); ei.close() }
})

test('company-fr: the name search and the officer search keep the company and the retained ones, not the 25 others', async () => {
  const fx = await fxCopy(c => {
    c('entreprises/search-boulangerie-durand.json', j => { j.results.push({ siren: '999999999', nom_complet: 'THIRD PARTY SARL', nature_juridique: '5499', siege: {} }) })
    c('entreprises/person-durand-jeanne.json', j => { j.results.push({ siren: '888888888', nom_complet: 'UNRELATED SAS', etat_administratif: 'A', siege: {}, dirigeants: [{ nom: 'ZZNOM', prenoms: 'LUC', qualite: 'Président', type_dirigeant: 'personne physique' }] }) })
  })
  try {
    const home = casesFolder(), dir = path.join(home, 'boulangerie-durand')
    await run(home, NEWCO)
    for (const c of ['collect', 'bodacc', 'officers']) assert.equal((await run(home, ['company-fr', c, '-p', 'boulangerie-durand'], fx.env)).status, 0, c)
    const caps = fs.readdirSync(path.join(dir, 'Evidence/captures')).map(f => read(dir, `Evidence/captures/${f}`)).join('\n')
    assert.doesNotMatch(caps, /THIRD PARTY|UNRELATED|ZZNOM/)
    const before = fs.readdirSync(path.join(dir, 'Sources')).length
    for (let i = 0; i < 2; i++) assert.equal((await run(home, ['refresh', '-p', 'boulangerie-durand', '--json'], fx.env)).status, 0)
    assert.equal(fs.readdirSync(path.join(dir, 'Sources')).length, before)
  } finally { fx.close() }
})

test('a BODACC notice link that is not http(s) is dropped', async () => {
  const { noticeOf } = await import('../../types/company-fr/engine.js')
  for (const u of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd']) assert.equal(noticeOf({ id: 'X', dateparution: '2026-01-02', url_complete: u }, '456789122').url, null, u)
  assert.equal(noticeOf({ id: 'X', dateparution: '2026-01-02', url_complete: 'https://www.bodacc.fr/x' }, '456789122').url, 'https://www.bodacc.fr/x')
})

// ---- username
test('usernameOf refuses what Maigret would read as an option and what moves the probed URL', async () => {
  const { usernameOf, sitesFor } = await import('../../types/username/engine.js')
  for (const s of ['--ai', '-a', '-', '..', '.', '...', 'a/b', 'a\\b', 'a\u0007b', 'https://x.example/-a', 'https://x.example/..']) assert.equal(usernameOf(s), null, JSON.stringify(s))
  for (const s of ['durand.bakery', 'a-b', '.hidden', 'x..y']) assert.equal(usernameOf(s), s)
  // the categories of GDPR article 9 are never queried, even when asked for
  const site = cat => ({ name: `S-${cat}`, uri_check: 'https://s.example/{account}', e_code: 200, e_string: 'x', m_code: 404, m_string: 'y', cat })
  const r = sitesFor({ sites: ['dating', 'health', 'political', 'social'].map(site) }, { name: 'durand', categories: ['dating', 'health', 'political', 'social'], known: ['dating', 'health', 'political', 'social'] })
  assert.deepEqual(r.run.map(x => x.category), ['social'])
  assert.deepEqual(r.skipped.map(x => x.category), ['dating', 'health', 'political'])
})

test('a username Refresh without change adds no source', async () => {
  const home = casesFolder(), P = ['-p', 'durand-bakery'], fx = await fxCopy(), dir = path.join(home, 'durand-bakery')
  try {
    await run(home, ['new', 'username', 'durand.bakery', '--question', 'Q?', '--frame', 'noisy=never', '--frame', 'legal_basis=Legitimate interest — vetting a supplier'], fx.env)
    assert.equal((await run(home, ['username', 'check', ...P], fx.env)).status, 0)
    const caps = () => fs.readdirSync(path.join(dir, 'Evidence/captures')).map(f => read(dir, `Evidence/captures/${f}`)).join('\n')
    assert.doesNotMatch(caps(), /"ms"/)
    const before = fs.readdirSync(path.join(dir, 'Sources')).length
    for (let i = 0; i < 2; i++) assert.equal((await run(home, ['refresh', ...P, '--json'], fx.env)).status, 0)
    assert.equal(fs.readdirSync(path.join(dir, 'Sources')).length, before)
  } finally { fx.close() }
})

// ---- email and phone
import { NEW_EMAIL } from './helpers.js'
test('email: a trapped Gravatar address loads nothing; two refreshes of an unchanged address add no source', async () => {
  const hash = 'd6c050fc099f0d5d805a75f276536a36c65bed0b6392b650647bf47b27542c7c'
  const fx = await fxCopy(c => c(`gravatar/${hash}.json`, j => {
    j.profile_url = 'https://gravatar.com/a![b](https://tracker.example/q.png)'
    j.verified_accounts[0].url = 'https://www.instagram.com/x![a](https://tracker.example/p.png)'
  }))
  try {
    const home = casesFolder(), dir = path.join(home, 'contact-durand-bakery-example'), P = ['-p', 'contact-durand-bakery-example']
    await run(home, NEW_EMAIL('contact@durand-bakery.example'))
    assert.equal((await run(home, ['email', 'collect', ...P], fx.env)).status, 0)
    for (const d of ['Entities', 'Clues', 'Sources']) for (const f of fs.readdirSync(path.join(dir, d))) assert.doesNotMatch(read(dir, `${d}/${f}`), /(?<!\\)!\[(?!\[)/, f)
    const before = fs.readdirSync(path.join(dir, 'Sources')).length
    for (let i = 0; i < 2; i++) assert.equal((await run(home, ['refresh', ...P, '--json'], fx.env)).status, 0)
    assert.equal(fs.readdirSync(path.join(dir, 'Sources')).length, before)
    assert.doesNotMatch(fs.readdirSync(path.join(dir, 'Evidence/captures')).map(f => read(dir, `Evidence/captures/${f}`)).join('\n'), /list_date/)
  } finally { fx.close() }
})

test('phone: what the datasets recorded carries no download date; collecting again adds no source', async () => {
  const fx = await fxCopy(), home = casesFolder()
  try {
    await run(home, ['new', 'phone', '+33 1 40 47 70 00', '--question', 'Who?', '--frame', 'noisy=never', '--title', 'p'], fx.env)
    assert.equal((await run(home, ['phone', 'collect', '-p', 'p'], fx.env)).status, 0)
    const dir = path.join(home, 'p'), before = fs.readdirSync(path.join(dir, 'Sources')).length
    assert.doesNotMatch(fs.readdirSync(path.join(dir, 'Evidence/captures')).map(f => read(dir, `Evidence/captures/${f}`)).join('\n'), /"fetched"/)
    assert.equal((await run(home, ['phone', 'collect', '-p', 'p'], fx.env)).status, 0)
    assert.equal(fs.readdirSync(path.join(dir, 'Sources')).length, before)
  } finally { fx.close() }
})

// ---- ip
test('ip with person: false: no natural person, no personal mailbox and no whois description becomes an entity or a clue', async () => {
  const fx = await fxCopy(c => {
    c('rdap/ip-192.0.2.10.json', j => {
      j.entities[0].vcardArray[1].find(x => x[0] === 'kind')[3] = 'individual'
      j.entities[0].vcardArray[1].find(x => x[0] === 'fn')[3] = 'Marie Exemple'
      j.entities[1].vcardArray[1].find(x => x[0] === 'email')[3] = 'marie.exemple@gmail.com'
    })
    c('ripestat/abuse-contact-finder-192.0.2.10.json', j => { j.data.abuse_contacts = ['marie.exemple@gmail.com'] })
  })
  try {
    for (const person of [false, true]) {
      const home = casesFolder(), dir = path.join(home, '192-0-2-10')
      await run(home, ['new', 'ip', '192.0.2.10', '--question', 'Who?', '--frame', 'noisy=never', ...(person ? ['--frame', 'person=true', '--frame', 'legal_basis=Legitimate interest — an abuse report'] : [])])
      assert.equal((await run(home, ['ip', 'collect', '--only', 'registry', '-p', '192-0-2-10'], fx.env)).status, 0)
      const text = ['Entities', 'Clues'].flatMap(d => fs.readdirSync(path.join(dir, d)).map(f => read(dir, `${d}/${f}`))).join('\n')
      assert.equal(/Marie Exemple|marie\.exemple@gmail\.com/.test(text), person, `person ${person}`)
      assert.equal(/shared web servers/.test(text), person, `descr, person ${person}`)
      assert.match(fs.readdirSync(path.join(dir, 'Evidence/captures')).map(f => read(dir, `Evidence/captures/${f}`)).join('\n'), /shared web servers/) // the capture keeps it
    }
  } finally { fx.close() }
})

test('a credential header never follows a redirect to another host', async () => {
  const seen = []
  const b = await listen((q, r) => { seen.push(q.headers); r.end('ok') })
  const a = await listen((q, r) => { seen.push(q.headers); if (q.url.endsWith('/start')) { r.writeHead(302, { location: `http://127.0.0.1:${b.address().port}/end` }); r.end() } else r.end('same') })
  process.env.OSINT_BASE_WEB = `http://127.0.0.1:${a.address().port}`
  try {
    await request('web', 'https://x.example/start', { headers: { authorization: 'OAuth secret', 'x-api-key': 'k', accept: 'text/html' } })
    assert.equal(seen.length, 2)
    assert.equal(seen[0].authorization, 'OAuth secret')
    assert.deepEqual([seen[1].authorization, seen[1]['x-api-key'], seen[1].accept], [undefined, undefined, 'text/html'])
  } finally { delete process.env.OSINT_BASE_WEB; a.close(); b.close() }
})

test('mergeView reads and rewrites a view under the case lock', async () => {
  const { mergeView } = await import('../../types/geolocate-image/engine.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-lock-')); fs.mkdirSync(path.join(dir, '.osint', 'views'), { recursive: true })
  let locked = null
  const ctx = { dir, file: rel => path.join(dir, rel), view: () => { locked = fs.existsSync(path.join(dir, '.osint', 'lock')) } }
  mergeView(ctx, 'map', 'osm', [])
  assert.equal(locked, true)
})

// ---- datasets
test('a damaged dataset file is no copy: the dataset is downloaded again; an oversized WhatsMyName list is refused; a hostile phone pattern is refused', async () => {
  const { dataset, datasetsInfo } = await import('../lib/datasets.js')
  const dirx = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-ds-')), f = path.join(dirx, 'raw', 'x', 'hello.txt')
  fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'hello')
  const fake = await startFake({ fixtures: dirx }), home = casesFolder(), was = process.env.OSINT_BASE_RAW
  process.env.OSINT_BASE_RAW = `${fake.url}/raw`
  try {
    const HELLO = { service: 'raw', path: '/x/hello.txt', hours: 24 }
    await dataset(home, 'hello', HELLO)
    fs.writeFileSync(path.join(home, '.cache', 'datasets', 'hello.json'), '{ broken')
    assert.deepEqual(datasetsInfo(home), [])
    const again = await dataset(home, 'hello', HELLO)
    assert.equal(again.text, 'hello'); assert.equal(again.cached, false)
  } finally { if (was === undefined) delete process.env.OSINT_BASE_RAW; else process.env.OSINT_BASE_RAW = was; fake.close() }
  const { MAX_SITES, sitesFor } = await import('../../types/username/engine.js')
  assert.ok(MAX_SITES >= 1000)
  const { typeOf } = await import('../lib/phones.js')
  const t = { general: '(a+)+$', types: {} }
  assert.throws(() => typeOf(t, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!'), /refuses/)
  assert.throws(() => typeOf({ general: 'a'.repeat(5000), types: {} }, '1'), /refuses/)
  assert.doesNotThrow(() => typeOf({ general: '[1-9]\\d{8}|(?:1\\d{2}){3}', types: {} }, '123456789'))
})

test('WhatsMyName: more than the cap is refused with a message; the site headers lose every credential', async () => {
  const { siteOf, MAX_SITES } = await import('../../types/username/engine.js')
  const s = siteOf({ name: 'S', uri_check: 'https://s.example/{account}', e_code: 200, e_string: 'x', m_code: 404, m_string: 'y', cat: 'social',
    headers: { 'User-Agent': 'u', Accept: 'a', Authorization: 'Bearer x', 'Proxy-Authorization': 'p', 'X-Api-Key': 'k', 'X-Auth-Token': 't', Cookie: 'c', Host: 'h' } }, 'durand')
  assert.deepEqual(Object.keys(s.headers).sort(), ['accept', 'user-agent'])
  const fx = await fxCopy(c => c('raw/WebBreacher/WhatsMyName/main/wmn-data.json', j => { j.sites = Array.from({ length: MAX_SITES + 1 }, (_, i) => ({ ...j.sites[0], name: `S${i}` })) }))
  try {
    const home = casesFolder()
    await run(home, ['new', 'username', 'durand.bakery', '--question', 'Q?', '--frame', 'noisy=never', '--frame', 'legal_basis=Legitimate interest — vetting a supplier'], fx.env)
    const r = await run(home, ['username', 'check', '-p', 'durand-bakery'], fx.env)
    assert.equal(r.status, 1)
    assert.match(r.err, /over the 5000 this engine accepts/)
  } finally { fx.close() }
})
