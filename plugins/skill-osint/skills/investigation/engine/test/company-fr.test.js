import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { idOf, matchLevel, noticeOf, officerOf, officersOf } from '../../types/company-fr/engine.js'
import { DENY } from '../lib/net.js'
import { readNote } from '../lib/vault.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, events, FIXTURES, json, read, run } from './helpers.js'

const fake = await startFake()
test.after(() => fake.close())
const env = fakeEnv(fake.url), SLUG = 'boulangerie-durand', P = ['-p', SLUG]
const NEWCO = ['new', 'company-fr', 'SIREN 456 789 122', '--title', 'Boulangerie Durand', '--question', 'Who runs this company?']
const ent = (dir, value) => readNote(path.join(dir, 'Entities', `${value}.md`)).props
// each clue: its file name (60 characters at most, : and / turned into -) and its note, where the whole text is
const clues = dir => fs.readdirSync(path.join(dir, 'Clues')).map(f => `${f}\n${read(dir, `Clues/${f}`)}`).join('\n')

test('idOf: a SIREN or a SIRET, spaced or labelled, checked by Luhn; a name is no number', () => {
  assert.deepEqual(idOf('456 789 122'), { siren: '456789122', siret: null })
  assert.deepEqual(idOf('SIREN 456 789 122'), { siren: '456789122', siret: null })
  assert.deepEqual(idOf('RCS Exempleville 456.789.122'), { siren: '456789122', siret: null })
  assert.deepEqual(idOf('456 789 122 00029'), { siren: '456789122', siret: '45678912200029' })
  assert.match(idOf('123 456 789').error, /Luhn/)
  assert.match(idOf('1234').error, /9 digits/)
  assert.equal(idOf('Boulangerie Durand'), null)
})

test('officers: a month and a year of birth at most; one note per person with all their roles; namesakes told apart by their birth', () => {
  assert.deepEqual(officerOf({ type_dirigeant: 'personne physique', nom: 'DURAND', prenoms: 'JEANNE MARIE', date_de_naissance: '1961-04-12', nationalite: 'Française', qualite: 'Gérant' }),
    { type: 'person', name: 'Jeanne Marie Durand', nom: 'DURAND', prenoms: 'JEANNE MARIE', born: '1961-04', role: 'Gérant' })
  assert.deepEqual(officerOf({ type_dirigeant: 'personne physique', nom: "DE LA FONTAINE-D'ARC", prenoms: 'JEAN-LUC', annee_de_naissance: '1950', date_de_naissance: null }),
    { type: 'person', name: "Jean-Luc De La Fontaine-D'Arc", nom: "DE LA FONTAINE-D'ARC", prenoms: 'JEAN-LUC', born: '1950', role: null })
  assert.deepEqual(officerOf({ type_dirigeant: 'personne morale', siren: '111 111 118', denomination: 'EXEMPLE AUDIT', qualite: 'Commissaire aux comptes titulaire' }),
    { type: 'company', name: 'EXEMPLE AUDIT', siren: '111111118', role: 'Commissaire aux comptes titulaire' })
  const list = officersOf([
    { type_dirigeant: 'personne physique', nom: 'DURAND', prenoms: 'JEAN', date_de_naissance: '1950-01', qualite: 'Président' },
    { type_dirigeant: 'personne physique', nom: 'DURAND', prenoms: 'JEAN', date_de_naissance: '1980-05', qualite: 'Directeur général' },
    { type_dirigeant: 'personne physique', nom: 'DURAND', prenoms: 'JEAN', date_de_naissance: '1950-01', qualite: 'Administrateur' },
    { type_dirigeant: 'personne morale', siren: '111111118', denomination: 'EXEMPLE AUDIT', qualite: 'Commissaire aux comptes titulaire' },
  ])
  assert.deepEqual(list.map(o => [o.value, o.role, o.key]), [
    ['Jean Durand (1950-01)', 'Président, Administrateur', 'person:jean durand:1950-01'],
    ['Jean Durand (1980-05)', 'Directeur général', 'person:jean durand:1980-05'],
    ['EXEMPLE AUDIT', 'Commissaire aux comptes titulaire', 'company:111111118'],
  ])
})

test('the frame of a company case: the person always, the proposed legal basis unless the user gives one', async () => {
  const home = casesFolder()
  assert.equal((await run(home, NEWCO)).status, 0)
  const p = readNote(path.join(home, SLUG, 'Case.md')).props
  assert.deepEqual([p.type, p.person, p.legal_basis, p.input], ['company-fr', true, 'Legitimate interest — public registry data', 'SIREN 456 789 122'])
  assert.equal((await run(home, ['new', 'company-fr', 'SIREN 456 789 122', '--title', 'own', '--question', 'Q?', '--frame', 'legal_basis=Consent — the officers agreed'])).status, 0)
  assert.equal(readNote(path.join(home, 'own', 'Case.md')).props.legal_basis, 'Consent — the officers agreed')
})

test('collect: the registry\'s identity, the establishments on the map, the officers as people with a month and a year of birth', async () => {
  const home = casesFolder(), dir = path.join(home, SLUG)
  await run(home, NEWCO)
  const r = await run(home, ['company-fr', 'collect', ...P], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(events(dir).filter(e => e.kind === 'fail'), [])
  const co = ent(dir, 'BOULANGERIE DURAND')
  assert.deepEqual([co.kind, co.role, co.siren, co.legal_form, co.naf, co.created, co.state, co.employees, co.vat, co.revenue, co.finances_year],
    ['organization', 'subject', '456789122', 'SARL (5499)', '10.71C', '1987-04-01', 'active', '6-9', 'FR72456789122', 412000, 2024])
  assert.deepEqual(co.aliases, ['SIREN 456 789 122'])
  assert.equal(co.registry_page, 'https://annuaire-entreprises.data.gouv.fr/entreprise/456789122')
  const places = ['00011', '00029', '00037'].map(n => ent(dir, `SIRET 456 789 122 ${n}`))
  assert.deepEqual(places.map(p => [p.kind, p.state, p.head_office, p.lat]), [['place', 'open', true, 45.9012], ['place', 'open', false, 45.9051], ['place', 'closed', false, 45.8981]])
  const map = json(dir, '.osint/views/map.json')
  assert.equal(map.type, 'FeatureCollection')
  assert.deepEqual(map.features.map(f => [f.properties.role, f.properties.kind, f.properties.ref, f.properties.label]), [
    ['place', 'head-office', 'Entities/SIRET 456 789 122 00011.md', 'BOULANGERIE DURAND'],
    ['place', 'establishment', 'Entities/SIRET 456 789 122 00029.md', 'DURAND AU MARCHE'],
    ['place', 'closed', 'Entities/SIRET 456 789 122 00037.md', '3 ROUTE DU MOULIN 99999 EXEMPLEVILLE (closed)'],
  ])
  assert.deepEqual(map.features[0].geometry, { type: 'Point', coordinates: [2.7021, 45.9012] })
  const jeanne = ent(dir, 'Jeanne Durand')
  assert.deepEqual([jeanne.kind, jeanne.role, jeanne.born, jeanne.nationalite, jeanne.nationality], ['person', 'Gérant, Associé', '1961-04', undefined, undefined])
  assert.equal(ent(dir, 'EXEMPLE AUDIT').siren, '111111118')
  assert.deepEqual(json(dir, '.osint/views/officers.json').map(o => [o.name, o.type, o.role]), [['Jeanne Durand', 'person', 'Gérant, Associé'], ['Paul Durand', 'person', 'Gérant'], ['EXEMPLE AUDIT', 'company', 'Commissaire aux comptes titulaire']])
  const rel = json(dir, '.osint/case.json').relations
  assert.ok(rel.some(x => x.from === 'Entities/Jeanne Durand.md' && x.to === 'Entities/BOULANGERIE DURAND.md' && x.label === 'Gérant, Associé'))
  assert.ok(rel.some(x => x.from === 'Entities/SIRET 456 789 122 00011.md' && x.label === 'head office of'))
  assert.deepEqual(json(dir, '.osint/collect/registry/1.json').items.map(i => `${i.kind} ${i.key}`), [
    'company 456789122', 'establishment 45678912200011', 'establishment 45678912200029', 'establishment 45678912200037',
    'officer person:jeanne durand:1961-04', 'officer person:paul durand:1988-09', 'officer company:111111118',
  ])
  const tl = json(dir, '.osint/views/timeline.json')
  assert.ok(tl.some(i => i.label === 'Company created' && i.date === '1987-04-01' && i.kind === 'registry'))
  assert.ok(tl.some(i => i.label === 'Establishment closed: 3 ROUTE DU MOULIN 99999 EXEMPLEVILLE' && i.kind === 'establishment'))
  for (const want of ['BOULANGERIE DURAND- SARL (5499), SIREN 456 789 122', 'Active in the registry', 'Main activity- NAF 10.71C', '3 establishments in the registry, 2 open', '3 officers in the registry']) assert.ok(clues(dir).includes(want), want)
  assert.equal(json(dir, '.osint/case.json').state['company-fr'].siren, '456789122')
  assert.doesNotMatch(read(dir, 'Entities/Jeanne Durand.md'), /\b1961-04-\d\d\b|Française/)
  assert.ok(!fake.seen.some(x => DENY.has(x.host)))
  assert.ok(fake.seen.some(x => x.service === 'entreprises' && x.query.get('q') === 'BOULANGERIE DURAND' && x.query.get('limite_matching_etablissements') === '100'))
})

test('a name is searched first: one company goes on; several are listed and wait for --siren, which refresh keeps', async () => {
  const home = casesFolder()
  await run(home, ['new', 'company-fr', 'Boulangerie Durand', '--question', 'Q?'])
  assert.equal((await run(home, ['company-fr', 'collect', '-p', 'boulangerie-durand'], env)).status, 0)
  assert.equal(json(path.join(home, 'boulangerie-durand'), '.osint/case.json').state['company-fr'].siren, '456789122')
  await run(home, ['new', 'company-fr', 'Durand', '--question', 'Q?'])
  const many = await run(home, ['company-fr', 'collect', '-p', 'durand'], env)
  assert.equal(many.status, 1)
  assert.match(many.err, /2 companies match "Durand": 456 789 122 BOULANGERIE DURAND \(EXEMPLEVILLE\) · 222 222 226 DURAND TRANSPORTS \(EXEMPLEVILLE-SUR-MER, ceased\) — ask the user which one, then company-fr collect --siren <SIREN>/)
  assert.deepEqual(fs.readdirSync(path.join(home, 'durand', 'Entities')), [])
  assert.equal((await run(home, ['company-fr', 'collect', '--siren', '456789122', '-p', 'durand'], env)).status, 0)
  const again = await run(home, ['refresh', '-p', 'durand', '--only', 'registry', '--json'], env)
  assert.equal(again.status, 0, again.err)
  assert.deepEqual(JSON.parse(again.out).diffs.map(d => [d.name, d.first, d.added.length + d.removed.length + d.changed.length]), [['registry', false, 0]])
  // the same record read again says nothing new
  assert.equal(fs.readdirSync(path.join(home, 'durand', 'Clues')).filter(f => f.includes('Active in the registry')).length, 1)
})

test('a SIRET finds its company; a number that fails Luhn is refused before any call; an unknown one records no company', async () => {
  const home = casesFolder()
  await run(home, ['new', 'company-fr', '456 789 122 00029', '--title', 'shop', '--question', 'Q?'])
  assert.equal((await run(home, ['company-fr', 'collect', '-p', 'shop'], env)).status, 0)
  assert.equal(ent(path.join(home, 'shop'), 'SIRET 456 789 122 00029').sign, 'DURAND AU MARCHE')
  await run(home, ['new', 'company-fr', 'SIREN 123 456 789', '--title', 'bad', '--question', 'Q?'])
  const before = fake.seen.length, bad = await run(home, ['company-fr', 'collect', '-p', 'bad'], env)
  assert.equal(bad.status, 1)
  assert.match(bad.err, /Luhn/)
  assert.equal(fake.seen.length, before)
  await run(home, ['new', 'company-fr', '555555556', '--title', 'ghost', '--question', 'Q?'])
  const ghost = await run(home, ['company-fr', 'collect', '-p', 'ghost'], env)
  assert.equal(ghost.status, 1)
  assert.match(ghost.err, /no company 555 555 556 in the registry/)
  assert.deepEqual(fs.readdirSync(path.join(home, 'ghost', 'Entities')), [])
  assert.match(clues(path.join(home, 'ghost')), /No company 555 555 556 in the registry/)
})

test('the real recorded answers for SIREN 552 081 317 parse without a failure; establishments without coordinates stay off the map', async () => {
  const home = casesFolder(), dir = path.join(home, 'edf')
  await run(home, ['new', 'company-fr', '552081317', '--title', 'edf', '--question', 'Who runs EDF?'])
  const r = await run(home, ['company-fr', 'collect', '-p', 'edf'], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(events(dir).filter(e => e.kind === 'fail').map(e => e.text), [])
  const co = ent(dir, 'ELECTRICITE DE FRANCE (EDF)')
  assert.deepEqual([co.siren, co.naf, co.legal_form, co.state, co.vat], ['552081317', '35.11Z', "SA à conseil d'administration (5599)", 'active', 'FR03552081317'])
  assert.deepEqual(co.aliases, ['SIREN 552 081 317', 'EDF'])
  const places = fs.readdirSync(path.join(dir, 'Entities')).filter(f => f.startsWith('SIRET '))
  const features = json(dir, '.osint/views/map.json').features
  assert.ok(features.length >= 10 && features.length < places.length, `${features.length} points for ${places.length} establishments`)
  assert.ok(features.some(f => f.properties.kind === 'closed'))
  assert.ok(json(dir, '.osint/views/officers.json').some(o => o.type === 'company'))
})

test('real recorded shapes (2026-11-06): the registry\'s ghost record is no company; a sole trader found among an officer\'s companies is kept by commune only', async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-real-'))
  fs.cpSync(FIXTURES, copy, { recursive: true })
  // the ghost the registry returns for 123 456 789 (recorded), served for a SIREN that passes Luhn
  const ghost = fs.readFileSync(path.join(FIXTURES, 'entreprises', 'ghost-123456789.json'), 'utf8').replaceAll('123456789', '555555556')
  fs.writeFileSync(path.join(copy, 'entreprises', 'search-555555556.json'), ghost)
  // one officer of EDF born in the month of the sole trader of the recorded officer search
  const pf = path.join(copy, 'entreprises', 'person-exemple-prenom.json'), pj = JSON.parse(fs.readFileSync(pf, 'utf8'))
  pj.results.find(r => String(r.nature_juridique).startsWith('1')).dirigeants[0].date_de_naissance = '1965-06'
  fs.writeFileSync(pf, JSON.stringify(pj))
  const f2 = await startFake({ fixtures: copy }), env2 = fakeEnv(f2.url, copy)
  try {
    const home = casesFolder(), edf = path.join(home, 'edf')
    await run(home, ['new', 'company-fr', '555555556', '--title', 'ghost', '--question', 'Q?'])
    const g = await run(home, ['company-fr', 'collect', '-p', 'ghost'], env2)
    assert.equal(g.status, 1)
    assert.match(g.err, /no company 555 555 556 in the registry/)
    assert.deepEqual(fs.readdirSync(path.join(home, 'ghost', 'Entities')), [])
    await run(home, ['new', 'company-fr', '552081317', '--title', 'edf', '--question', 'Who runs EDF?'])
    assert.equal((await run(home, ['company-fr', 'collect', '-p', 'edf'], env2)).status, 0)
    const o = await run(home, ['company-fr', 'officers', '-p', 'edf'], env2)
    assert.equal(o.status, 0, o.err)
    const everything = fs.readdirSync(path.join(edf, 'Evidence', 'captures')).map(f => fs.readFileSync(path.join(edf, 'Evidence', 'captures', f), 'utf8')).join('\n')
    // a read again on the recorded answers: the second pass adds no source
    assert.equal((await run(home, ['company-fr', 'bodacc', '-p', 'edf'], env2)).status, 0)
    const caps = () => fs.readdirSync(path.join(edf, 'Evidence', 'captures')).length
    const n1 = (await run(home, ['refresh', '-p', 'edf'], env2), caps()), n2 = (await run(home, ['refresh', '-p', 'edf'], env2), caps())
    assert.equal(n2, n1, 'refresh twice: no new source')
    assert.match(everything, /EXEMPLE Prénom/, 'the sole trader is kept')
    assert.doesNotMatch(everything, /RUE EXEMPLE/, 'its address is not')
  } finally { f2.close() }
})

test('noticeOf: the JSON strings read back, the first sentence only, the company as the other party, broken fields survived', () => {
  const own = JSON.stringify({ personne: { typePersonne: 'pm', numeroImmatriculation: { numeroIdentification: '456 789 122' } } })
  const base = { id: 'X1', dateparution: '2026-01-02', typeavis: 'annonce', registre: ['456789122'], listepersonnes: own, url_complete: 'https://www.bodacc.fr/x' }
  const n = o => noticeOf({ ...base, ...o }, '456789122')
  assert.deepEqual(n({ familleavis: 'dpc', familleavis_lib: 'Dépôts des comptes', depot: '{"dateCloture": "2025-12-31", "typeDepot": "Comptes annuels et rapports"}' }),
    { key: 'X1', date: '2026-01-02', family: 'dpc', label: 'Dépôts des comptes', type: 'annonce', text: 'Comptes annuels et rapports, 2025-12-31', closing: '2025-12-31', own: true, url: 'https://www.bodacc.fr/x', procedure: false })
  const open = n({ familleavis: 'collective', jugement: JSON.stringify({ famille: "Jugement d'ouverture", nature: "Jugement d'ouverture d'une procédure de sauvegarde", date: '2020-11-26', complementJugement: 'désignant Maître Exemple' }) })
  assert.deepEqual([open.text, open.procedure], ["Jugement d'ouverture d'une procédure de sauvegarde, 2020-11-26", true])
  assert.equal(n({ familleavis: 'modification', modificationsgenerales: JSON.stringify({ descriptif: "modification survenue sur l'administration. nom de l'administrateur Mme Exemple au lieu de Exempel" }) }).text, "modification survenue sur l'administration")
  assert.equal(n({ familleavis: 'radiation', radiationaurcs: JSON.stringify({ commentaire: 'Radiation suite à clôture des opérations de liquidation' }) }).text, 'Radiation suite à clôture des opérations de liquidation')
  const sold = n({ familleavis: 'vente', acte: JSON.stringify({ vente: { categorieVente: "Achat d'un fonds par une personne morale" } }), listepersonnes: JSON.stringify({ personne: [{ typePersonne: 'pm', numeroImmatriculation: { numeroIdentification: '678 912 346' } }] }) })
  assert.deepEqual([sold.text, sold.own], ["Achat d'un fonds par une personne morale", false])
  assert.equal(n({ familleavis: 'divers', divers: 'not json at all' }).text, 'not json at all')
  assert.equal(n({ familleavis: 'creation', acte: '{broken' }).text, '{broken')
  assert.deepEqual([n({ familleavis: undefined }).family, n({ typeavis: 'rectificatif', familleavis: 'dpc', depot: null }).type], ['inconnue', 'rectificatif'])
})

test('bodacc: the notices on the timeline, a clue for each insolvency proceeding, the last accounts, a snapshot; no name past a first sentence', async () => {
  const home = casesFolder(), dir = path.join(home, SLUG)
  await run(home, NEWCO)
  await run(home, ['company-fr', 'collect', ...P], env)
  const r = await run(home, ['company-fr', 'bodacc', ...P], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(events(dir).filter(e => e.kind === 'fail'), [])
  const c = clues(dir)
  assert.match(c, /7 BODACC notices from 2014-07-10 to 2025-07-18/)
  assert.equal(fs.readdirSync(path.join(dir, 'Clues')).filter(f => f.includes('Insolvency proceeding')).length, 2)
  assert.match(c, /Last accounts filed- Comptes annuels et rapports, 2024-12-31/)
  const co = ent(dir, 'BOULANGERIE DURAND')
  assert.deepEqual([co.bodacc_notices, co.last_accounts, co.procedures], [7, '2024-12-31', 2])
  const tl = json(dir, '.osint/views/timeline.json').filter(i => i.kind === 'bodacc')
  assert.equal(tl.length, 7)
  assert.ok(tl.some(i => i.label === "Ventes et cessions — Achat d'un fonds par une personne morale" && i.url.endsWith('id:A201901770055')))
  assert.ok(tl.some(i => i.label === "Modifications diverses — modification survenue sur l'administration"))
  for (const f of fs.readdirSync(path.join(dir, 'Clues'))) assert.doesNotMatch(read(dir, `Clues/${f}`), /Paul Durand nommé|Maître Exemple/, f)
  assert.doesNotMatch(JSON.stringify(tl), /Paul Durand|Maître/)
  assert.equal(json(dir, '.osint/collect/bodacc/1.json').items.length, 7)
  assert.ok(fake.seen.some(x => x.service === 'bodacc' && x.query.get('where') === 'registre="456789122"' && x.query.get('order_by') === 'dateparution desc'))
  await run(home, ['new', 'company-fr', 'Boulangerie Durand', '--title', 'byname', '--question', 'Q?'])
  const early = await run(home, ['company-fr', 'bodacc', '-p', 'byname'], env)
  assert.equal(early.status, 1)
  assert.match(early.err, /run company-fr collect first/)
})

test('the real recorded BODACC answer for SIREN 552 081 317 parses without a failure; the notices where EDF is the other party say so', async () => {
  const home = casesFolder(), dir = path.join(home, 'edf')
  await run(home, ['new', 'company-fr', '552081317', '--title', 'edf', '--question', 'Who runs EDF?'])
  await run(home, ['company-fr', 'collect', '-p', 'edf'], env)
  const r = await run(home, ['company-fr', 'bodacc', '-p', 'edf'], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(events(dir).filter(e => e.kind === 'fail').map(e => e.text), [])
  const tl = json(dir, '.osint/views/timeline.json').filter(i => i.kind === 'bodacc')
  const recorded = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'bodacc', '552081317.json'), 'utf8'))
  assert.equal(tl.length, recorded.results.length)
  assert.equal(ent(dir, 'ELECTRICITE DE FRANCE (EDF)').bodacc_notices, recorded.total_count)
  assert.match(clues(dir), new RegExp(`the ${recorded.results.length} latest of ${recorded.total_count}`))
  for (const x of recorded.results) {
    const own = [].concat(JSON.parse(x.listepersonnes ?? '{}').personne ?? []).some(p => String(p?.numeroImmatriculation?.numeroIdentification ?? '').replace(/\D/g, '') === '552081317')
    assert.equal(tl.find(i => i.url === x.url_complete).label.endsWith('(the company is the other party)'), !own, x.id)
  }
})

test('matchLevel: same month high; same year with a month unknown medium; another month or no birth a namesake; another name none', () => {
  const jeanne = { nom: 'DURAND', prenoms: 'JEANNE', born: '1961-04' }, d = o => ({ type_dirigeant: 'personne physique', nom: 'DURAND', prenoms: 'JEANNE', ...o })
  assert.equal(matchLevel(jeanne, d({ date_de_naissance: '1961-04' })), 'high')
  assert.equal(matchLevel(jeanne, d({ nom: 'Durànd', date_de_naissance: '1961-04' })), 'high')
  assert.equal(matchLevel(jeanne, d({ prenoms: 'Jeanne Marie', annee_de_naissance: '1961', date_de_naissance: null })), 'medium')
  assert.equal(matchLevel(jeanne, d({ date_de_naissance: '1961-11' })), 'low')
  assert.equal(matchLevel({ ...jeanne, born: '1961' }, d({ date_de_naissance: '1962-04' })), 'low')
  assert.equal(matchLevel({ ...jeanne, born: null }, d({ date_de_naissance: '1961-04' })), 'low')
  assert.equal(matchLevel(jeanne, d({ prenoms: 'PAUL', date_de_naissance: '1961-04' })), null)
  assert.equal(matchLevel(jeanne, d({ nom: 'DURAND-MARTIN', date_de_naissance: '1961-04' })), null)
})

test('officers: each officer\'s other companies, linked when the birth agrees, namesakes kept apart and out of the graph', async () => {
  const home = casesFolder(), dir = path.join(home, SLUG)
  await run(home, NEWCO)
  const early = await run(home, ['company-fr', 'officers', ...P], env)
  assert.equal(early.status, 1)
  assert.match(early.err, /run company-fr collect first/)
  await run(home, ['company-fr', 'collect', ...P], env)
  const r = await run(home, ['company-fr', 'officers', ...P], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(events(dir).filter(e => e.kind === 'fail'), [])
  assert.deepEqual(json(dir, '.osint/views/network.json').map(x => [x.officer, x.company, x.level, x.born]), [
    ['Jeanne Durand', 'SCI DURAND EXEMPLE', 'high', '1961-04'], ['Jeanne Durand', 'EPICERIE MARTIN', 'medium', '1961'], ['Jeanne Durand', 'DURAND TRANSPORTS', 'low', '1961-11'],
  ])
  assert.deepEqual([ent(dir, 'SCI DURAND EXEMPLE').network, ent(dir, 'SCI DURAND EXEMPLE').siren, ent(dir, 'EPICERIE MARTIN').network], ['high', '567891239', 'medium'])
  assert.ok(!fs.existsSync(path.join(dir, 'Entities', 'DURAND TRANSPORTS.md')))
  assert.deepEqual([ent(dir, 'Jeanne Durand').other_companies, ent(dir, 'Paul Durand').other_companies], [2, 0])
  assert.deepEqual(json(dir, '.osint/views/officers.json').map(o => o.other_companies), [2, 0, null])
  const rel = json(dir, '.osint/case.json').relations
  assert.ok(rel.some(x => x.from === 'Entities/Jeanne Durand.md' && x.to === 'Entities/SCI DURAND EXEMPLE.md' && x.label === 'Gérant (high)'))
  assert.ok(rel.some(x => x.to === 'Entities/EPICERIE MARTIN.md' && x.label === 'Associé (medium)'))
  const c = clues(dir)
  assert.match(c, /Jeanne Durand is also Gérant of SCI DURAND EXEMPLE \(SIREN 567 891 239\): same name, same month of birth/)
  assert.match(c, /Jeanne Durand may be Associé of EPICERIE MARTIN/)
  assert.match(c, /Namesakes of Jeanne Durand in other companies, not linked: 1/)
  const asked = fake.seen.find(x => x.service === 'entreprises' && x.query.get('nom_personne') === 'DURAND' && x.query.get('prenoms_personne') === 'JEANNE')
  assert.deepEqual(['date_naissance_personne_min', 'date_naissance_personne_max', 'type_personne'].map(k => asked.query.get(k)), ['1961-01', '1961-12', 'dirigeant'])
  assert.equal(json(dir, '.osint/collect/officers/1.json').items.length, 3)
})

test('refresh: a ceased company, a new BODACC notice, a new company of an officer (of the same name as the case\'s), found by diff', async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-fx-'))
  fs.cpSync(FIXTURES, copy, { recursive: true })
  const f2 = await startFake({ fixtures: copy }), env2 = fakeEnv(f2.url, copy)
  try {
    const home = casesFolder(), dir = path.join(home, SLUG)
    await run(home, NEWCO)
    for (const c of ['collect', 'bodacc', 'officers']) assert.equal((await run(home, ['company-fr', c, ...P], env2)).status, 0, c)
    const edit = (rel, fn) => { const f = path.join(copy, rel), j = JSON.parse(fs.readFileSync(f, 'utf8')); fn(j); fs.writeFileSync(f, JSON.stringify(j)) }
    edit('entreprises/search-456789122.json', j => Object.assign(j.results[0], { etat_administratif: 'C', date_fermeture: '2026-10-31' }))
    edit('bodacc/456789122.json', j => {
      j.results.unshift({ ...j.results[0], id: 'B202602100001', dateparution: '2026-11-02', familleavis: 'radiation', familleavis_lib: 'Radiations', depot: null,
        radiationaurcs: JSON.stringify({ commentaire: "Radiation suite à cessation d'activité" }), url_complete: 'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:B202602100001' })
      j.total_count++
    })
    edit('entreprises/person-durand-jeanne.json', j => {
      j.results.push({ siren: '555555556', nom_complet: 'BOULANGERIE DURAND', nom_raison_sociale: 'BOULANGERIE DURAND', etat_administratif: 'A', siege: { libelle_commune: 'EXEMPLEVILLE' },
        dirigeants: [{ nom: 'DURAND', prenoms: 'JEANNE', annee_de_naissance: '1961', date_de_naissance: '1961-04', qualite: 'Président', type_dirigeant: 'personne physique' }] })
      j.total_results++
    })
    const r = await run(home, ['refresh', ...P, '--json'], env2)
    assert.equal(r.status, 0, r.err)
    const d = Object.fromEntries(JSON.parse(r.out).diffs.map(x => [x.name, x]))
    assert.deepEqual(Object.keys(d), ['registry', 'bodacc', 'officers'])
    assert.deepEqual([d.registry.changed, d.registry.added, d.registry.removed], [[{ key: '456789122', fields: ['state'] }], [], []])
    assert.deepEqual(d.bodacc.added.map(x => x.key), ['B202602100001'])
    assert.deepEqual(d.officers.added.map(x => x.key), ['Jeanne Durand > 555555556'])
    const caseMd = read(dir, 'Case.md')
    assert.match(caseMd, /registry: ~1 \(456789122: state\)/)
    assert.match(caseMd, /bodacc: \+1 \(B202602100001\)/)
    assert.match(caseMd, /officers: \+1 \(Jeanne Durand > 555555556\)/)
    assert.deepEqual([ent(dir, 'BOULANGERIE DURAND').state, ent(dir, 'BOULANGERIE DURAND').siren], ['ceased', '456789122'])
    assert.deepEqual([ent(dir, 'BOULANGERIE DURAND (555 555 556)').siren, ent(dir, 'BOULANGERIE DURAND (555 555 556)').network], ['555555556', 'high'])
    assert.match(clues(dir), /Struck off the register: Radiation suite à cessation d'activité \(BODACC 2026-11-02\)/)
    assert.match(clues(dir), /Ceased on 2026-10-31/)
    // what was read before and read again is not said twice
    const files = fs.readdirSync(path.join(dir, 'Clues'))
    for (const once of ['Main activity- NAF 10.71C', 'is also Gérant of SCI DURAND EXEMPLE', '7 BODACC notices', 'Namesakes of Jeanne Durand']) assert.equal(files.filter(x => x.includes(once)).length, 1, once)
  } finally { f2.close() }
})

test('what a registry wrote is escaped before it enters a note: a hostile name, address and notice load no image, no link, no block end', async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-fx-'))
  fs.cpSync(FIXTURES, copy, { recursive: true })
  const f2 = await startFake({ fixtures: copy }), env2 = fakeEnv(f2.url, copy)
  try {
    const evil = '![x](https://evil.example/p.png) [[Journal]] <img src=x> %%'
    const edit = (rel, fn) => { const f = path.join(copy, rel), j = JSON.parse(fs.readFileSync(f, 'utf8')); fn(j); fs.writeFileSync(f, JSON.stringify(j)) }
    edit('entreprises/search-456789122.json', j => { const r = j.results[0]; r.siege.adresse = `1 RUE ${evil}`; r.dirigeants[1].nom = `DURAND ${evil}`; r.dirigeants[3].denomination = `AUDIT ${evil}` })
    edit('bodacc/456789122.json', j => { j.results[5].modificationsgenerales = JSON.stringify({ descriptif: `modification ${evil}. suite` }) })
    const home = casesFolder(), dir = path.join(home, SLUG)
    await run(home, NEWCO)
    for (const c of ['collect', 'bodacc']) assert.equal((await run(home, ['company-fr', c, ...P], env2)).status, 0, c)
    const notes = [...['Entities', 'Clues'].flatMap(d => fs.readdirSync(path.join(dir, d)).map(f => `${d}/${f}`))]
    for (const f of notes) assert.doesNotMatch(read(dir, f).replace(/\\./g, ''), /!\[x\]|\]\(https:\/\/evil|\[\[Journal\]\]|<img|\.png\) \[\[/, f)
    assert.ok(notes.some(f => /EVIL|evil/i.test(read(dir, f))), 'the hostile text is kept, as plain text')
    for (const f of fs.readdirSync(path.join(dir, 'Entities'))) assert.doesNotMatch(f, /[[\]<>!%]/, f)
    for (const i of json(dir, '.osint/views/timeline.json')) assert.doesNotMatch(i.label.replace(/\\./g, ''), /!\[|<img|\]\(/, i.label)
  } finally { f2.close() }
})

test('a case whose frame says no person records no officer as a person: the names stay in the clue', async () => {
  const home = casesFolder(), dir = path.join(home, SLUG)
  await run(home, NEWCO)
  const f = path.join(dir, 'Case.md')
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^person: true$/m, 'person: false'))
  assert.equal((await run(home, ['company-fr', 'collect', ...P], env)).status, 0)
  assert.ok(!fs.existsSync(path.join(dir, 'Entities', 'Jeanne Durand.md')))
  assert.match(clues(dir), /3 officers in the registry: Jeanne Durand/)
  assert.deepEqual(json(dir, '.osint/views/officers.json').map(o => o.type), ['company'])
})
