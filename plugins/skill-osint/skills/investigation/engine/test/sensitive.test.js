import assert from 'node:assert/strict'
import test from 'node:test'
import { CATEGORIES, fold, isMinor, pursuitHit, SENSITIVE_SITE_CATEGORIES, sensitiveHit } from '../lib/sensitive.js'

const cat = (text, opts = {}) => sensitiveHit({ text, ...opts })?.category ?? null

test('each category of GDPR article 9 is found in English and in French, on folded text', () => {
  const cases = {
    health: ['She is pregnant', 'Elle est enceinte', 'diagnosed with diabetes', 'Il est séropositif', 'a mental health condition', 'son état de santé'],
    religion: ['a practising Muslim', 'Il est catholique pratiquant', 'goes to the synagogue', 'sa religion', 'témoin de Jéhovah'],
    sex: ['his sexual orientation', 'Elle est lesbienne', 'il est gay', 'a dating profile', 'site de rencontre', 'LGBT+ association'],
    politics: ['her political views', 'militante du parti', 'vote pour l’extrême droite', 'a party member since 2010', 'opinions politiques'],
    origin: ['son origine ethnique', 'ethnic background', 'ethnicity: x'],
    union: ['Il est syndiqué à la CGT', 'délégué syndical', 'a trade union member'],
    genetic: ['un test ADN', 'her genetic profile', 'genome sequencing'],
    biometric: ['reconnaissance faciale', 'biometric passport photo', 'ses empreintes digitales'],
  }
  for (const [want, texts] of Object.entries(cases)) for (const t of texts) assert.equal(cat(t), want, t)
  assert.equal(Object.keys(CATEGORIES).length, 8)
  assert.equal(fold('Éléonore ÇA'), 'eleonore ca')
})

test('names, everyday words and OSINT terms are not sensitive', () => {
  for (const t of ['Boulangerie Durand, gérante Jeanne Durand', 'Christian Martin, co-gérant', 'Marie Gay est aussi gérante',
    'Syndicat de copropriété du 12', 'syndicat d\'initiative', 'TLS fingerprint of the certificate', 'Orientation: 1 (EXIF)',
    'durand.bakery on Instagram', 'Islamabad office', 'the race to the bottom', 'my example', 'a political science degree'])
    assert.equal(cat(t), null, t)
})

test('the subject\'s own name never trips the guard; the same word about them does', () => {
  assert.equal(cat('Pierre Gay tient le compte durand.bakery', { ignore: ['Pierre Gay'] }), null)
  assert.equal(cat('PIERRE GAY, gérant', { ignore: ['Pierre Gay'] }), null)
  assert.equal(cat('Pierre Gay est gay', { ignore: ['Pierre Gay'] }), 'sex')
})

test('properties: a refused key, a category value, a sensitive word in a value', () => {
  assert.deepEqual(sensitiveHit({ props: { religion: 'catholique' } }), { category: 'religion', where: 'property religion' })
  assert.deepEqual(sensitiveHit({ props: { 'Sexual orientation': 'x' } }), { category: 'sex', where: 'property Sexual orientation' })
  assert.deepEqual(sensitiveHit({ props: { category: 'political', site: 'Example' } }), { category: 'politics', where: 'property category' })
  assert.deepEqual(sensitiveHit({ props: { bio: ['baker', 'syndiqué CGT'] } }), { category: 'union', where: 'property bio' })
  assert.equal(sensitiveHit({ props: { category: 'social', role: 'subject', born: '1961-04', ports: [80, 443], orientation: 1, religion: null } }), null)
})

test('pursuit: finding, contacting or following a private person', () => {
  for (const t of ['Trouve l\'adresse de mon ex', 'où elle habite maintenant', 'Find where she lives', 'track her location', 'pour la retrouver', 'my ex-girlfriend\'s accounts'])
    assert.ok(pursuitHit(t), t)
  for (const t of ['Vérifier la gérante avant un contrat', 'Check my example account', 'who runs the bakery', 'retrouver le fournisseur'])
    assert.equal(pursuitHit(t), null, t)
})

test('isMinor: the youngest the person can be decides', () => {
  const now = new Date('2026-11-03T12:00:00Z')
  assert.deepEqual(['2010-05', '2008', '2008-11', '2009-01-02'].map(b => isMinor(b, now)), [true, true, true, true])
  assert.deepEqual(['1961-04', '2008-10', '2008-11-02', '', null, 'unknown'].map(b => isMinor(b, now)), [false, false, false, false, false, false])
  assert.ok(SENSITIVE_SITE_CATEGORIES.has('political') && !SENSITIVE_SITE_CATEGORIES.has('social'))
})
