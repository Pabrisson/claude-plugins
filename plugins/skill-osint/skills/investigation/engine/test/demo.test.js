import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { buildDemo } from './demo-data.mjs'
import { isMessaging } from '../lib/net.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, FAKE_BROWSER, json, read, run } from './helpers.js'
import { pivotsFor } from '../lib/prompt.js'
import { PIN } from '../lib/python.js'
import { listCases } from '../lib/case.js'
import { loadTypes } from '../lib/types.js'
import { readNote } from '../lib/vault.js'

test('the demo builds a finished case, a child case that shares a tracker with it, in two languages', async () => {
  const fake = await startFake(), home = casesFolder()
  try {
    const env = { ...process.env, ...fakeEnv(fake.url), OSINT_DIR: home, OSINT_NOTIFY: '0', OSINT_BROWSER: FAKE_BROWSER }
    delete env.OSINT_BY
    await buildDemo(env)
    // the PDF of each finished case, the first one with the Journal appended; a running case gets none
    const done = listCases(home).filter(s => readNote(path.join(home, s, 'Case.md')).props.status === 'done')
    assert.ok(done.includes('durand-bakery-example'))
    for (const s of done) assert.equal(fs.readdirSync(path.join(home, s, 'Exports')).filter(f => f.endsWith('.pdf')).length, 1, s)
    assert.match(fs.readFileSync(path.join(home, 'durand-bakery-example', 'Journal.md'), 'utf8'), /· export · Exports\/durand-bakery-example-\d{4}-\d{2}-\d{2}\.pdf \(OSINT_BROWSER \(.+\), Journal appended\) · sha256 [0-9a-f]{64} \^j\d{3}/)
    assert.ok(!fs.existsSync(path.join(home, 'other-shop-example', 'Exports')), 'a running case gets no PDF in the demo')
    // the ip case, born from the bakery site's address; the pivot is offered on every IP entity
    const ipCase = readNote(path.join(home, '192-0-2-10', 'Case.md')).props
    assert.deepEqual([ipCase.type, ipCase.parent, ipCase.from, ipCase.status, ipCase.confidence], ['ip', 'durand-bakery-example', 'Entities/192.0.2.10.md', 'done', 'high'])
    assert.ok(readNote(path.join(home, 'durand-bakery-example', 'Case.md')).props.children.includes('192-0-2-10'))
    assert.equal(json(path.join(home, '192-0-2-10'), '.osint/views/map.json').features[0].properties.radius_m, 50000)
    assert.deepEqual(pivotsFor({ kind: 'ip', value: '192.0.2.10', path: 'Entities/192.0.2.10.md' }, loadTypes()).map(p => [p.type, p.label]), [['ip', 'New IP address case on 192.0.2.10']])
    const sharedIp = JSON.parse((await run(home, ['brain', 'entities', '--all', '--json'], fakeEnv(fake.url))).out)
    for (const key of ['ip:192.0.2.10', 'organization:exemple hébergement sas']) assert.ok(sharedIp.some(e => e.key === key && e.cases.some(c => c.slug === '192-0-2-10')), key)
    const parent = readNote(path.join(home, 'durand-bakery-example', 'Case.md')).props
    assert.deepEqual([parent.status, parent.lang, parent.confidence], ['done', 'fr', 'high'])
    assert.ok(['other-shop-example', 'durand-bakery'].every(c => parent.children.includes(c)))
    assert.ok(parent.children.includes('contact-durand-bakery-example'))
    const child = readNote(path.join(home, 'other-shop-example', 'Case.md')).props
    assert.deepEqual([child.parent, child.status], ['durand-bakery-example', 'running'])
    assert.ok(json(path.join(home, 'durand-bakery-example'), '.osint/case.json').leads.length >= 2)
    const shared = JSON.parse((await run(home, ['brain', 'entities', '--all', '--json'], fakeEnv(fake.url))).out)
    assert.ok(shared.some(e => e.key === 'tracker:g-durand123'))
    // the username case, born of the account the bakery's home page links to
    const u = readNote(path.join(home, 'durand-bakery', 'Case.md')).props
    assert.deepEqual([u.type, u.status, u.lang, u.person, u.noisy, u.parent, u.confidence], ['username', 'done', 'fr', true, 'ask', 'durand-bakery-example', 'medium']) // noisy: the child keeps its parent's
    assert.match(String(u.legal_basis), /^Intérêt légitime/)
    const rows = json(path.join(home, 'durand-bakery'), '.osint/views/accounts.json')
    assert.deepEqual(rows.filter(r => r.state === 'found').map(r => r.site), ['Example Forum', 'Instagram'])
    assert.ok(shared.some(e => e.key === 'account:https://www.instagram.com/durand.bakery' && ['contact-durand-bakery-example', 'durand-bakery', 'durand-bakery-example'].every(c => e.cases.some(x => x.slug === c))))  // stage 10's person case shares it too
    const mail = readNote(path.join(home, 'contact-durand-bakery-example', 'Case.md')).props
    assert.deepEqual([mail.type, mail.status, mail.lang, mail.parent, mail.person, mail.noisy, mail.confidence], ['email', 'done', 'fr', 'durand-bakery-example', true, 'ask', 'high'])
    // the pivot from the domain case: the address its home page publishes offers a new email case
    const types = loadTypes(), on = (kind, value) => pivotsFor({ kind, value, path: 'x' }, types).map(p => p.type)
    assert.ok(pivotsFor({ kind: 'email', value: 'contact@durand-bakery.example', path: 'Entities/contact@durand-bakery.example.md' }, types)
      .some(p => p.label === 'New Email case on contact@durand-bakery.example' && p.item.tag === 'pivot:email'))
    // and from the email case: its own domain, the avatar
    assert.ok(on('domain', 'durand-bakery.example').includes('domain'))
    for (const t of ['geolocate-image', 'verify-media']) assert.ok(on('image', 'https://0.gravatar.com/avatar/d6c050fc099f0d5d805a75f276536a36c65bed0b6392b650647bf47b27542c7c').includes(t), t)
    assert.ok(shared.some(e => e.key === 'account:https://www.instagram.com/durand.bakery' && e.cases.some(c => c.slug === 'contact-durand-bakery-example')))
    const M = path.join(home, 'contact-durand-bakery-example')
    assert.ok(json(M, '.osint/views/accounts.json').some(x => x.by === 'holehe' && x.state === 'registered'))
    assert.ok(json(M, '.osint/case.json').leads.length >= 2)
    const ig = { kind: 'account', value: 'https://www.instagram.com/durand.bakery', path: 'Entities/https---www.instagram.com-durand.bakery.md' }
    assert.ok(pivotsFor(ig, loadTypes()).some(p => p.label === 'New Username case on https://www.instagram.com/durand.bakery'))
    assert.ok(json(path.join(home, 'durand-bakery'), '.osint/case.json').leads.length >= 2)
    const PD = path.join(home, 'jeanne-durand'), person = readNote(path.join(PD, 'Case.md')).props
    assert.deepEqual([person.type, person.status, person.lang, person.confidence, person.parent], ['person', 'done', 'fr', 'medium', 'boulangerie-durand-sarl'])
    assert.deepEqual([...person.children].sort(), ['durand-bakery-jeanne-durand', 'jeanne-durand-bakery-example', 'telephone-de-jeanne-durand'])
    const ids = json(PD, '.osint/views/identifiers.json'), id = v => ids.find(x => x.value === v)
    assert.deepEqual(['durand.bakery', 'jeanne@durand-bakery.example', '+33639981234'].map(v => id(v).belongs), ['83 %', '75 %', '5 %'])
    assert.deepEqual([id('BOULANGERIE DURAND').confidence, id('Exempleville').case], ['high', 'pas d\'enquête : une ville seule n\'en ouvre pas'])
    // what the username child only found (the account, namesakes) is a candidate, out of the identifiers and the profile
    assert.ok(!ids.some(x => x.kind === 'account'))
    assert.ok(json(PD, '.osint/views/candidates.json').some(x => x.kind === 'account' && x.value === 'https://www.instagram.com/durand.bakery'))
    const profile = read(PD, 'Profile.md')
    assert.match(profile, /# Profil — Jeanne Durand\n\nNaissance : 1961-04 · Enquêtes liées : \[boulangerie-durand-sarl\]/)
    assert.match(profile, /\| \[\[BOULANGERIE DURAND\]\] \| \[boulangerie-durand-sarl\]\([^)]+\) \(comme [^)]+\) \|/)
    const people = JSON.parse((await run(home, ['brain', 'entities', '--all', '--json'], fakeEnv(fake.url))).out)
    assert.ok(people.some(e => e.key === 'person:jeanne durand 1961-04' && e.cases.some(c => c.slug === 'jeanne-durand')))
    assert.ok(people.some(e => e.key === 'organization:456789122' && e.cases.some(c => c.slug === 'jeanne-durand')))
    // the sensitive site categories are never checked (the manifest's default leaves them out; sitesFor skips them; a person case filters a chosen one)
    const wmn = JSON.parse(fs.readFileSync(path.join(home, 'durand-bakery-jeanne-durand', 'Evidence', 'captures', fs.readdirSync(path.join(home, 'durand-bakery-jeanne-durand', 'Evidence', 'captures')).find(f => f.startsWith('S01'))), 'utf8'))
    assert.ok(!wmn.categories.some(c => ['dating', 'health', 'political', 'nsfw'].includes(c)))
    const officer = { kind: 'person', value: 'Jeanne Durand', path: 'Entities/Jeanne Durand.md', props: { born: '1961-04' } }
    assert.ok(pivotsFor(officer, loadTypes()).some(p => p.type === 'person'))
    // the watch: the finished case watched every 24 h, one pass a moment ago that found three certificates
    const D = path.join(home, 'durand-bakery-example'), w = json(D, '.osint/case.json')
    assert.equal(w.watch.every, '24h')
    assert.ok(Date.now() - Date.parse(w.watch.last) < 10 * 60e3 && Date.parse(w.watch.next) - Date.now() > 23 * 3600e3)
    assert.deepEqual([w.refreshes.at(-1).by, w.refreshes.at(-1).added, w.refreshes.at(-1).removed], ['watch', 3, 0])
    assert.match(read(D, 'Case.md'), /## Ce qui a changé — .+ · veille[\s\S]*crt: \+3/)
    assert.ok(fs.existsSync(path.join(D, 'Entities', 'click-collect.durand-bakery.example.md')))
    // a watch pass writes no line for what it read again unchanged (its « What changed » line says what is new)
    assert.doesNotMatch(read(D, 'Journal.md'), /read again, unchanged/)
    assert.ok(!/· cmd · domain collect --only home/.test(read(D, 'Journal.md').split('· watch · every 24h')[1]), 'the watch never reads the site itself')
  } finally { fake.close() }
})

test('the demo has a finished geolocation case scored against its true location, and the bakery\'s shop-front picture offers the pivot', { skip: process.platform === 'win32' }, async () => {
  const fake = await startFake(), home = casesFolder()
  try {
    const env = { ...process.env, ...fakeEnv(fake.url), OSINT_DIR: home, OSINT_NOTIFY: '0', OSINT_BROWSER: FAKE_BROWSER }
    delete env.OSINT_BY
    await buildDemo(env)
    const d = path.join(home, 'evora-temple'), p = readNote(path.join(d, 'Case.md')).props
    assert.deepEqual([p.type, p.status, p.confidence, p.radius_m, p.lang], ['geolocate-image', 'done', 'high', 30, 'en'])
    const t = json(d, '.osint/case.json').state['geolocate-image'].truth
    assert.ok(t.error_km < 0.1 && t.country_hit && t.region_hit && t.gut_hit, JSON.stringify(t))
    const cal = json(d, '.osint/views/calibration.json')
    assert.deepEqual([cal.gut.ranked[0].place, cal.truth.score, cal.scoreboard.cases], ['Portugal', 5000, 1])
    const groups = new Set(json(d, '.osint/views/map.json').features.map(f => f.properties.group))
    for (const g of ['recon', 'sweep:town', 'agent', 'truth']) assert.ok(groups.has(g), g)
    assert.ok(json(d, '.osint/views/evidence.json').items.some(i => i.kind === 'candidate' && i.rank === 1 && i.verdict === 'match'))
    assert.ok(fs.existsSync(path.join(home, '.cache', 'osint-data', 'geoint', PIN.sha, 'scripts', 'recon.py')))
    const shop = { kind: 'image', value: 'https://durand-bakery.example/img/vitrine.jpg', path: 'Entities/https---durand-bakery.example-img-vitrine.jpg.md' }
    process.env.OSINT_TYPES = ''
    assert.ok(pivotsFor(shop, loadTypes()).some(x => x.type === 'geolocate-image'))
    assert.ok(fs.readdirSync(path.join(home, 'durand-bakery-example', 'Entities')).some(f => f.includes('vitrine')))
  } finally { delete process.env.OSINT_TYPES; fake.close() }
})

test('the demo\'s verify-media case: the false caption refuted by an earlier copy and the place, integrity held at medium, the pivots to and from it offered', { skip: process.platform === 'win32' }, async () => {
  const fake = await startFake(), home = casesFolder()
  try {
    const env = { ...process.env, ...fakeEnv(fake.url), OSINT_DIR: home, OSINT_NOTIFY: '0', OSINT_BROWSER: FAKE_BROWSER }
    delete env.OSINT_BY
    await buildDemo(env)
    const D = path.join(home, 'orage-a-merida'), p = readNote(path.join(D, 'Case.md')).props, c = json(D, '.osint/case.json'), st = c.state['verify-media']
    assert.deepEqual([p.type, p.status, p.lang, p.confidence], ['verify-media', 'done', 'fr', 'high'])
    assert.deepEqual([c.conclusion.answer, c.conclusion.confidence], ['H02', { claim: 'high', origin: 'medium', integrity: 'medium' }])
    assert.deepEqual([st.first.date, st.first.how, st.direct.unmasked, st.c2pa_valid], ['2021-11-20', 'page', false, false])
    assert.ok(json(D, '.osint/views/timeline.json').some(i => i.kind === 'earliest' && i.date === '2021-11-20'))
    assert.ok(c.leads.length >= 3)
    const ents = JSON.parse((await run(home, ['brain', 'entities', '--all', '--json'], fakeEnv(fake.url))).out), types = loadTypes()
    const img = ents.find(e => e.kind === 'image' && e.cases.some(x => x.slug === 'orage-a-merida'))
    assert.ok(pivotsFor({ kind: 'image', value: img.value, path: img.cases[0].path }, types).some(t => t.type === 'geolocate-image'))
    // the bakery's shop-front picture (the step-2 demo) now offers a verify-media case too
    const shop = ents.find(e => e.kind === 'image' && e.cases.some(x => x.slug === 'durand-bakery-example'))
    assert.ok(shop, 'the image entity of durand-bakery-example')
    assert.ok(pivotsFor({ kind: 'image', value: shop.value, path: shop.cases[0].path }, types).some(t => t.type === 'verify-media'))
  } finally { fake.close() }
})

test('stage 5: the bakery\'s company, a child case started from the SIREN on its site; the pivots that lead to it and from it', async () => {
  const fake = await startFake(), home = casesFolder()
  try {
    const env = { ...process.env, ...fakeEnv(fake.url), OSINT_DIR: home, OSINT_NOTIFY: '0', OSINT_BROWSER: FAKE_BROWSER }
    delete env.OSINT_BY
    await buildDemo(env)
    const CO = path.join(home, 'boulangerie-durand-sarl'), co = readNote(path.join(CO, 'Case.md')).props
    assert.deepEqual([co.type, co.status, co.lang, co.parent, co.from, co.person, co.legal_basis],
      ['company-fr', 'done', 'fr', 'durand-bakery-example', 'Entities/SIREN 456 789 122.md', true, 'Legitimate interest — public registry data'])
    assert.ok(readNote(path.join(home, 'durand-bakery-example', 'Case.md')).props.children.includes('boulangerie-durand-sarl'))
    assert.equal(json(CO, '.osint/views/map.json').features.length, 3)
    assert.deepEqual(json(CO, '.osint/views/network.json').map(x => x.level), ['high', 'medium', 'low'])
    assert.ok(json(CO, '.osint/case.json').leads.length >= 2)
    const shared = JSON.parse((await run(home, ['brain', 'entities', '--all', '--json'], fakeEnv(fake.url))).out)
    assert.ok(shared.some(e => e.key === 'organization:456789122' && e.cases.length >= 2))
    // a private type of the cases folder and a finished case of it, which shares the SIREN with the bakery's case
    const audit = readNote(path.join(home, 'durand-shop-audit', 'Case.md')).props
    assert.deepEqual([audit.type, audit.status, audit.lang, audit.confidence], ['shop-audit', 'done', 'fr', 'medium'])
    const typeList = JSON.parse((await run(home, ['types', '--json'], fakeEnv(fake.url))).out)
    assert.deepEqual(typeList.filter(t => t.private).map(t => [t.id, t.ready, t.where]), [['shop-audit', true, '.osint-types/shop-audit']])
    assert.ok(shared.some(e => e.key === 'organization:456789122' && e.cases.some(c => c.slug === 'durand-shop-audit')))
    const types = loadTypes(home), on = (slug, rel) => { const props = readNote(path.join(home, slug, rel)).props; return pivotsFor({ kind: props.kind, value: props.value, path: rel, props }, types).map(p => p.type) }
    assert.ok(on('durand-bakery-example', 'Entities/SIREN 456 789 122.md').includes('company-fr'))
    assert.ok(!on('durand-bakery-example', 'Entities/Exemple Registrar SAS.md').includes('company-fr'))
    assert.ok(on('boulangerie-durand-sarl', 'Entities/durand-bakery.example.md').includes('domain'))
    assert.ok(on('boulangerie-durand-sarl', 'Entities/SCI DURAND EXEMPLE.md').includes('company-fr'))
  } finally { fake.close() }
})

test('the demo\'s phone case: the number of the bakery\'s contact page, its pivot taken, a block kept for fiction', async () => {
  const fake = await startFake(), home = casesFolder()
  try {
    const env = { ...process.env, ...fakeEnv(fake.url), OSINT_DIR: home, OSINT_NOTIFY: '0', OSINT_BROWSER: FAKE_BROWSER }
    delete env.OSINT_BY
    await buildDemo(env)
    const parent = readNote(path.join(home, 'durand-bakery-example', 'Case.md')).props
    assert.ok(parent.children.includes('telephone-boulangerie-durand'))
    const phone = readNote(path.join(home, 'telephone-boulangerie-durand', 'Case.md')).props
    assert.deepEqual([phone.type, phone.status, phone.parent, phone.lang, phone.confidence], ['phone', 'done', 'durand-bakery-example', 'fr', 'high'])
    const shared = JSON.parse((await run(home, ['brain', 'entities', '--all', '--json'], fakeEnv(fake.url))).out)
    assert.ok(shared.some(e => e.key === 'phone:fr:0199001234'))
    const rel = 'Entities/+33199001234.md', props = readNote(path.join(home, 'durand-bakery-example', rel)).props
    assert.ok(pivotsFor({ kind: props.kind, value: props.value, path: rel, props }, loadTypes(home)).some(p => p.type === 'phone'))
    assert.ok(fs.readdirSync(path.join(home, 'telephone-boulangerie-durand', 'Clues')).some(n => n.includes('Bloc réservé par l')))
    assert.ok(!fake.seen.some(x => isMessaging(`https://${x.host}${x.path}`)))
  } finally { fake.close() }
})

test('stage 9: the place of the bakery\'s head office, opened from its establishment in the company case; what it shows and what it shares', async () => {
  const fake = await startFake(), home = casesFolder()
  try {
    const env = { ...process.env, ...fakeEnv(fake.url), OSINT_DIR: home, OSINT_NOTIFY: '0', OSINT_BROWSER: FAKE_BROWSER }
    delete env.OSINT_BY
    await buildDemo(env)
    const PL = path.join(home, '1-place-de-l-exemple'), pl = readNote(path.join(PL, 'Case.md')).props
    assert.deepEqual([pl.type, pl.status, pl.lang, pl.parent, pl.from, pl.person, pl.confidence], ['place', 'done', 'fr', 'boulangerie-durand-sarl', 'Entities/SIRET 456 789 122 00011.md', true, 'high'])
    assert.ok(readNote(path.join(home, 'boulangerie-durand-sarl', 'Case.md')).props.children.includes('1-place-de-l-exemple'))
    assert.deepEqual(json(PL, '.osint/case.json').state.place.how, 'from')
    const map = json(PL, '.osint/views/map.json')
    assert.deepEqual([map.rasters.length, map.features.length, map.features.filter(f => f.properties.role === 'pano').length], [9, 14, 4])
    assert.ok(map.features.some(f => f.properties.kind === 'closed' && f.properties.label === "PHARMACIE DE L'EXEMPLE (fermé)"))
    assert.match(fs.readFileSync(path.join(PL, 'Journal.md'), 'utf8'), /Pas de jeton Mapillary : Mapillary sauté/)
    // the pivot that leads to it: offered on the establishment, which has coordinates
    const types = loadTypes(home), props = readNote(path.join(home, 'boulangerie-durand-sarl', 'Entities', 'SIRET 456 789 122 00011.md')).props
    assert.ok(pivotsFor({ kind: 'place', value: props.value, path: 'Entities/SIRET 456 789 122 00011.md', props }, types).some(p => p.type === 'place' && p.label === 'New Place case on SIRET 456 789 122 00011'))
    // and from it: a point of interest's site and phone, a ground image, a nearby company
    const on = rel => { const p = readNote(path.join(PL, rel)).props; return pivotsFor({ kind: p.kind, value: p.value, path: rel, props: p }, types).map(x => x.type) }
    assert.ok(on('Entities/durand-bakery.example.md').includes('domain'))
    assert.ok(on('Entities/+33465710012.md').includes('phone'))
    assert.ok(on('Entities/EPICERIE MARTIN.md').includes('company-fr'))
    const image = fs.readdirSync(path.join(PL, 'Entities')).find(f => readNote(path.join(PL, 'Entities', f)).props.provider === 'Panoramax')
    assert.ok(on(`Entities/${image}`).includes('verify-media'))
    // shared with the other cases of the demo
    const shared = JSON.parse((await run(home, ['brain', 'entities', '--all', '--json'], fakeEnv(fake.url))).out)
    const has = (key, slug) => shared.some(e => e.key === key && e.cases.some(c => c.slug === slug) && e.cases.some(c => c.slug === '1-place-de-l-exemple'))
    assert.ok(has('organization:456789122', 'boulangerie-durand-sarl'))
    assert.ok(has('domain:durand-bakery.example', 'durand-bakery-example'))
    assert.ok(has('phone:fr:0199001234', 'durand-bakery-example'))
    assert.ok(shared.some(e => e.kind === 'place' && ['boulangerie-durand-sarl', '1-place-de-l-exemple'].every(s => e.cases.some(c => c.slug === s))))
  } finally { fake.close() }
})
