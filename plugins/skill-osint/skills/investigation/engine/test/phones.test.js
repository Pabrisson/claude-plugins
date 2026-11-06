import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { frenchNational, lengths, LINE_TYPES, parseMetadata, parsePhone, typeOf, writings } from '../lib/phones.js'
import { FIXTURES } from './helpers.js'

const meta = parseMetadata(fs.readFileSync(path.join(FIXTURES, 'raw', 'google', 'libphonenumber', 'master', 'resources', 'PhoneNumberMetadata.xml'), 'utf8'))
const NAME = { fixedLine: 'fixed-line', mobile: 'mobile', premiumRate: 'premium-rate', tollFree: 'toll-free', sharedCost: 'shared-cost', voip: 'voip', personalNumber: 'personal', pager: 'pager', uan: 'uan', voicemail: 'voicemail' }
const p = (input, region) => parsePhone(meta, input, region)
const short = x => [x.e164, x.region, x.type, x.valid]

test('the metadata: each territory with its codes and prefixes, its formats, one pattern per line type', () => {
  // the whole recorded file (libphonenumber v9.0.43): every territory, 001 for the non-geographic entities
  assert.equal(meta.territories.length, 254)
  const ids = new Set(meta.territories.map(t => t.id))
  for (const id of ['001', 'AG', 'BL', 'CA', 'FR', 'GB', 'GF', 'GG', 'GP', 'IM', 'JE', 'MF', 'MQ', 'PM', 'RE', 'US', 'YT']) assert.ok(ids.has(id), id)
  const fr = meta.byId.get('FR')
  assert.deepEqual([fr.cc, fr.idd, fr.np], ['33', '00', '0'])
  assert.deepEqual(Object.keys(fr.types).sort(), ['fixedLine', 'mobile', 'premiumRate', 'sharedCost', 'tollFree', 'uan', 'voip'])
  assert.equal(fr.types.mobile.pattern, '(?:6(?:[0-24-8]\\d|3[0-8]|9[589])|7[3-9]\\d)\\d{6}')
  assert.deepEqual(fr.types.mobile.lengths, [9])
  assert.deepEqual(fr.formats.at(-1), { pattern: '(\\d)(\\d{2})(\\d{2})(\\d{2})(\\d{2})', leading: ['[1-79]'], format: '$1 $2 $3 $4 $5', intl: null, rule: '$NP$FG' })
  assert.deepEqual(meta.byCc.get('1').map(t => t.id).slice(0, 3), ['US', 'AG', 'AI'])
  assert.ok(meta.byCc.get('1').some(t => t.id === 'CA'))
  assert.deepEqual(meta.byCc.get('262').map(t => t.id), ['RE', 'YT'])
  assert.equal(meta.byId.get('AG').leading, '268')
  assert.equal(meta.byId.get('JE').npTransform, '1534$1')
  assert.deepEqual([lengths('9'), lengths('[8-10]'), lengths('[4-6],8')], [[9], [8, 9, 10], [4, 5, 6, 8]])
})

test('every example number of the metadata is typed as libphonenumber types it', () => {
  let n = 0
  for (const t of meta.territories) for (const [k, d] of Object.entries(t.types)) {
    if (!d.example) continue
    n++
    const got = typeOf(t, d.example), want = NAME[k]
    assert.ok(got === want || (['fixed-line', 'mobile'].includes(want) && got === 'fixed-line-or-mobile'), `${t.id} ${k} ${d.example}: ${got}`)
  }
  assert.ok(n >= 90, `${n} examples`)
})

test('a shared country code goes to the territory whose own patterns match, the main one first', () => {
  assert.deepEqual(short(p('+1 201 555 0123')), ['+12015550123', 'US', 'fixed-line-or-mobile', true])
  assert.deepEqual(short(p('+1 613 555 0123')), ['+16135550123', 'CA', 'fixed-line-or-mobile', true])
  // Antigua by its leading digits 268; 555-0123 is no range of Antigua
  assert.deepEqual(short(p('+1 268 555 0123')), ['+12685550123', 'AG', 'unknown', false])
  assert.deepEqual(short(p('+44 1534 456789')), ['+441534456789', 'JE', 'fixed-line', true])
  assert.deepEqual(short(p('+44 20 7946 0123')), ['+442079460123', 'GB', 'fixed-line', true])
  // Ofcom keeps 07700 900xxx for drama: libphonenumber lists no range for it
  assert.deepEqual([...short(p('+44 7700 900123')), p('+44 7700 900123').country], ['+447700900123', null, 'unknown', false, 'GB'])
  // a toll-free number of a shared code: the main territory, as libphonenumber says
  assert.deepEqual(short(p('+1 800 212 3456')), ['+18002123456', 'US', 'toll-free', true])
  // a code of no country: the non-geographic entities, "001"
  assert.deepEqual(short(p('+800 1234 5678')), ['+80012345678', '001', 'toll-free', true])
})

test('what pages write: no-break spaces, tel: links, labels, (+33), +33 (0), 0033, dots — one E.164', () => {
  for (const w of ['01 40 47 70 00', '+33 1 40 47 70 00', '+33 (0)1 40 47 70 00', '(+33) 1 40 47 70 00', '0033 1 40 47 70 00', '01.40.47.70.00',
    '01-40-47-70-00', 'tel:+33140477000', 'Tél. : 01 40 47 70 00', '+33\u00a01\u00a040\u202f47\u202f70\u202f00', '+33 01 40 47 70 00'])
    assert.equal(p(w).e164, '+33140477000', w)
  assert.match(p('abc').error, /not a phone number/)
  assert.match(p('+999 12 34').error, /no country has the calling code/)
  assert.match(p('01 40 47 70 00', 'ZZ').error, /needs its country/)
  assert.deepEqual([p('06 12 34 56 7').valid, p('06 12 34 56 7').possible], [false, false])
})

test('written without a country code: read in the case country\'s plan, and said so', () => {
  assert.deepEqual([p('01 40 47 70 00').assumed, p('+33 1 40 47 70 00').assumed], ['FR', null])
  assert.deepEqual(short(p('020 7946 0123', 'GB')), ['+442079460123', 'GB', 'fixed-line', true])
  assert.deepEqual(short(p('(201) 555-0123', 'US')), ['+12015550123', 'US', 'fixed-line-or-mobile', true])
  // Jersey's national prefix rule: 0 off, or 1534 put back before a local number
  assert.equal(p('01534 456789', 'JE').e164, '+441534456789')
  assert.equal(p('456789', 'JE').e164, '+441534456789')
})

test('the French plan: overseas prefixes take their own country code; the fiction blocks', () => {
  assert.deepEqual(short(p('01 40 47 70 00')), ['+33140477000', 'FR', 'fixed-line', true])
  assert.deepEqual(short(p('0692 12 34 56')), ['+262692123456', 'RE', 'mobile', true])
  assert.deepEqual(short(p('0596 30 12 34')), ['+596596301234', 'MQ', 'fixed-line', true])
  assert.deepEqual(short(p('0508 41 12 34')), ['+508411234', 'PM', 'fixed-line', true])
  assert.deepEqual(short(p('0 800 12 34 56')), ['+33800123456', 'FR', 'toll-free', true])
  // the ARCEP's fiction blocks: 01 99 00 fits the plan's fixed lines, 06 39 98 (among Mayotte's mobiles) fits no range
  assert.deepEqual(short(p('01 99 00 12 34')), ['+33199001234', 'FR', 'fixed-line', true])
  assert.deepEqual([...short(p('06 39 98 12 34')), p('06 39 98 12 34').country], ['+262639981234', null, 'unknown', false, 'RE'])
  assert.deepEqual(['01 40 47 70 00', '0692 12 34 56', '0508 41 12 34', '0596 30 12 34'].map(x => frenchNational(p(x))), ['0140477000', '0692123456', '0508411234', '0596301234'])
  assert.equal(frenchNational(p('+1 201 555 0123')), null)
})

test('the writings: national then international, with the separators pages use; each one reads back', () => {
  assert.deepEqual(writings(meta, p('01 40 47 70 00')), ['01 40 47 70 00', '0140477000', '01.40.47.70.00', '01-40-47-70-00', '+33 1 40 47 70 00',
    '+33140477000', '+33.1.40.47.70.00', '+33-1-40-47-70-00', '0033 1 40 47 70 00', '+33 (0)1 40 47 70 00'])
  assert.deepEqual(writings(meta, p('0692 12 34 56')).slice(0, 6), ['0692 12 34 56', '0692123456', '0692.12.34.56', '0692-12-34-56', '06 92 12 34 56', '+262 692 12 34 56'])
  assert.deepEqual(writings(meta, p('0 800 12 34 56')).slice(0, 6), ['0 800 12 34 56', '0800 12 34 56', '0800123456', '0800.12.34.56', '0800-12-34-56', '08 00 12 34 56'])
  assert.deepEqual(writings(meta, p('+1 201 555 0123')).slice(0, 7), ['(201) 555-0123', '201 555 0123', '2015550123', '201.555.0123', '201-555-0123', '+1 201-555-0123', '+12015550123'])
  assert.deepEqual(writings(meta, p('+800 1234 5678')), ['+800 1234 5678', '+80012345678', '+800.1234.5678', '+800-1234-5678', '00800 1234 5678'])
  for (const t of meta.territories) for (const d of Object.values(t.types)) {
    if (!d.example) continue
    const n = p(`+${t.cc}${d.example}`)
    // the international writings read with France's 00; the national ones with their own territory
    for (const w of writings(meta, n)) assert.equal(p(w, /^(\+|00)/.test(w) || t.id === '001' ? 'FR' : t.id).e164, n.e164, `${t.id} "${w}"`)
  }
  assert.ok(LINE_TYPES.includes('fixed-line-or-mobile') && LINE_TYPES.includes('unknown'))
})
