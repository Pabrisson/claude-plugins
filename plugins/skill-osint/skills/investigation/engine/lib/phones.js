// Phone numbers read with libphonenumber's metadata (PhoneNumberMetadata.xml, Apache-2.0, Google), without a
// dependency: one pattern per line type and per territory; a country code that several territories share (+1, +44,
// +262…) goes to the first territory whose own patterns match, the main one first, as libphonenumber does. Pure: the
// caller gives the XML text. The French national plan spans six country codes (0692… is Réunion, 0508… Saint-Pierre).

// checked in libphonenumber's order; fixed line and mobile come last
const TYPES = [['premiumRate', 'premium-rate'], ['tollFree', 'toll-free'], ['sharedCost', 'shared-cost'], ['voip', 'voip'],
  ['personalNumber', 'personal'], ['pager', 'pager'], ['uan', 'uan'], ['voicemail', 'voicemail']]
export const LINE_TYPES = ['fixed-line', 'mobile', 'fixed-line-or-mobile', ...TYPES.map(t => t[1]), 'unknown']
// the French plan's overseas prefixes (ARCEP MAJNUM, column « Territoire »): a national 0… number that starts with one
// of them is dialled from abroad with that country code
const DOM = { '0262': '262', '0263': '262', '0268': '262', '0269': '262', '0639': '262', '0692': '262', '0693': '262',
  '0590': '590', '0690': '590', '0691': '590', '0594': '594', '0694': '594', '0596': '596', '0696': '596', '0697': '596', '0508': '508' }
const FR_PLAN = new Set(['FR', 'RE', 'YT', 'GP', 'BL', 'MF', 'GF', 'MQ', 'PM'])

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unent = s => s.replace(/&(amp|lt|gt|quot|apos);/g, (_, e) => ENT[e])
const squeeze = s => unent(s).replace(/\s+/g, '')
const attrs = s => Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map(m => [m[1], unent(m[2])]))
const tag = (body, name) => new RegExp(`<${name}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${name}>)`).exec(body)
// "9", "[8-10]", "[4-6],8" → [9], [8, 9, 10], [4, 5, 6, 8]
export function lengths(spec = '') {
  const out = []
  for (const part of spec.split(',').filter(Boolean)) {
    const r = /^\[(\d+)-(\d+)\]$/.exec(part)
    if (r) for (let n = +r[1]; n <= +r[2]; n++) out.push(n)
    else out.push(+part)
  }
  return out
}
function desc(body, name) {
  const inner = tag(body, name)?.[2] ?? ''
  const p = tag(inner, 'nationalNumberPattern'), l = tag(inner, 'possibleLengths'), ex = tag(inner, 'exampleNumber')
  if (!p) return null
  return { pattern: squeeze(p[2]), lengths: lengths(l ? attrs(l[1]).national : ''), example: ex ? squeeze(ex[2]) : null }
}
export function parseMetadata(xml) {
  const territories = []
  for (const m of xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<territory\b([^>]*)>([\s\S]*?)<\/territory>/g)) {
    const a = attrs(m[1]), body = m[2], types = {}
    for (const name of ['fixedLine', 'mobile', ...TYPES.map(t => t[0])]) { const d = desc(body, name); if (d) types[name] = d }
    territories.push({
      id: a.id, cc: a.countryCode, main: a.mainCountryForCode === 'true', leading: a.leadingDigits ? squeeze(a.leadingDigits) : null,
      idd: a.internationalPrefix ?? null, np: a.nationalPrefix ?? null, npParse: a.nationalPrefixForParsing ? squeeze(a.nationalPrefixForParsing) : null,
      npTransform: a.nationalPrefixTransformRule ?? null, rule: a.nationalPrefixFormattingRule ?? null,
      general: desc(body, 'generalDesc')?.pattern ?? null, types,
      formats: [...body.matchAll(/<numberFormat\b([^>]*)>([\s\S]*?)<\/numberFormat>/g)].map(f => {
        const fa = attrs(f[1]), intl = tag(f[2], 'intlFormat')
        return { pattern: squeeze(fa.pattern), leading: [...f[2].matchAll(/<leadingDigits>([\s\S]*?)<\/leadingDigits>/g)].map(x => squeeze(x[1])),
          format: unent(tag(f[2], 'format')[2].trim()), intl: intl ? unent(intl[2].trim()) : null, rule: fa.nationalPrefixFormattingRule ?? null }
      }),
    })
  }
  const byCc = new Map()
  for (const t of territories) byCc.set(t.cc, [...(byCc.get(t.cc) ?? []), t])
  for (const list of byCc.values()) list.sort((x, y) => y.main - x.main)
  return { territories, byCc, byId: new Map(territories.filter(t => t.id !== '001').map(t => [t.id, t])) }
}

const RX = new Map()
// the patterns come from a downloaded file: a long one, or a group that repeats a repeat ((a+)+), is refused (ReDoS)
const OPEN = '(?:[+*]|\\{\\d+,\\})', INNER = '(?:[^()\\\\]|\\\\.)*'
const NESTED = new RegExp(`\\(${INNER}${OPEN}${INNER}\\)${OPEN}`)
export const MAX_PATTERN = 4000
const rx = (p, whole = true) => {
  const k = `${whole ? 'w' : 's'}${p}`
  if (String(p).length > MAX_PATTERN || NESTED.test(p)) throw new Error('the libphonenumber data holds a pattern this engine refuses (too long or nested repeats)')
  if (!RX.has(k)) RX.set(k, new RegExp(whole ? `^(?:${p})$` : `^(?:${p})`))
  return RX.get(k)
}
const fits = (d, nsn) => !!d && (!d.lengths.length || d.lengths.includes(nsn.length)) && rx(d.pattern).test(nsn)
export function typeOf(t, nsn) {
  if (!t.general || !rx(t.general).test(nsn)) return 'unknown'
  for (const [k, id] of TYPES) if (fits(t.types[k], nsn)) return id
  const fixed = fits(t.types.fixedLine, nsn), mobile = fits(t.types.mobile, nsn)
  return fixed && mobile ? 'fixed-line-or-mobile' : fixed ? 'fixed-line' : mobile ? 'mobile' : 'unknown'
}
export function regionOf(meta, cc, nsn) {
  const list = meta.byCc.get(cc) ?? []
  if (list.length === 1) return list[0]
  return list.find(t => (t.leading ? rx(t.leading, false).test(nsn) : typeOf(t, nsn) !== 'unknown')) ?? null
}
// the national prefix (and its parsing rule) off a national number, unless only the number as written fits the plan
function stripNp(t, d) {
  const p = t?.npParse ?? t?.np
  const m = p ? rx(p, false).exec(d) : null
  if (!m) return d
  const out = t.npTransform && m.length > 1 && m[m.length - 1] != null
    ? t.npTransform.replace(/\$(\d)/g, (_, i) => m[i] ?? '') + d.slice(m[0].length) : d.slice(m[0].length)
  const ok = s => !t.general || rx(t.general).test(s)
  return ok(d) && !ok(out) ? d : out
}
function result(meta, input, cc, nsn, assumed) {
  const list = meta.byCc.get(cc) ?? [], t = regionOf(meta, cc, nsn), type = t ? typeOf(t, nsn) : 'unknown'
  const possible = list.some(x => Object.values(x.types).some(d => d.lengths.includes(nsn.length)))
  return { input, e164: `+${cc}${nsn}`, cc, nsn, region: t?.id ?? null, country: t?.id ?? list[0]?.id ?? null, type, valid: type !== 'unknown', possible, assumed }
}
// input: what a person or a page wrote (« +33 6 12 34 56 78 », « 06.12.34.56.78 », « 0033 … », « +33 (0)6 … »,
// « tel:+33… », « Tél. : 06… »); region: the country of a number written without its country code.
// → { input, e164, cc, nsn, region, country, type, valid, possible, assumed } | { input, error }
export function parsePhone(meta, input, region = 'FR') {
  const raw = String(input ?? '').trim(), s = raw.replace(/^[^\d+(]*/, '')
  if (!/^\+?[\d\s().\-/]{3,}$/.test(s.replace(/^\(\s*\+/, '+'))) return { input: raw, error: 'not a phone number: digits, spaces, dots, dashes, brackets and a leading + only' }
  let plus = /^\(?\s*\+/.test(s), d = s.replace(/\(0\)/g, '').replace(/\D/g, '')
  const home = meta.byId.get(String(region ?? '').toUpperCase())
  if (!plus && home?.idd) { const m = rx(home.idd, false).exec(d); if (m) { d = d.slice(m[0].length); plus = true } }
  if (plus) {
    for (const n of [1, 2, 3]) {
      const cc = d.slice(0, n)
      if (meta.byCc.has(cc)) return result(meta, raw, cc, stripNp(meta.byCc.get(cc)[0], d.slice(n)), null)
    }
    return { input: raw, error: `no country has the calling code of ${raw}` }
  }
  if (!home) return { input: raw, error: `a number without its country code needs its country (--in country=<ISO code>), not ${region}` }
  const dom = FR_PLAN.has(home.id) && d.length === 10 ? DOM[d.slice(0, 4)] : null
  if (dom) return result(meta, raw, dom, d.slice(dom === '508' ? 4 : 1), home.id)
  return result(meta, raw, home.cc, stripNp(home, d), home.id)
}

const fill = (fmt, g) => fmt.replace(/\$(\d)/g, (_, i) => g[i - 1] ?? '')
const pick = (t, nsn, intl) => t?.formats.find(f => !(intl && f.intl === 'NA') && (!f.leading.length || rx(f.leading.at(-1), false).test(nsn)) && rx(f.pattern).test(nsn)) ?? null
// every way a page may write the number, the commonest first (the agent searches the web for each, in quotes)
export function writings(meta, p) {
  const main = meta.byCc.get(p.cc)?.find(t => t.formats.length) ?? meta.byCc.get(p.cc)?.[0], out = []
  const nat = p.region === '001' ? null : pick(main, p.nsn, false), int = pick(main, p.nsn, true)
  if (nat) {
    const g = rx(nat.pattern).exec(p.nsn).slice(1), rule = nat.rule ?? main.rule, np = main.np ?? ''
    const first = [np && rule?.includes('$NP') ? `${np}${g[0]}` : g[0], ...g.slice(1)]
    out.push(fill(rule ? nat.format.replace('$1', () => rule.replace('$NP', np).replace('$FG', '$1')) : nat.format, g))
    out.push(first.join(' '), first.join(''), first.join('.'), first.join('-'))
  }
  const fr = frenchNational(p)
  if (fr?.length === 10) out.push(fr.replace(/(\d\d)(?=\d)/g, '$1 '))
  if (int) {
    const g = rx(int.pattern).exec(p.nsn).slice(1), f = fill(int.intl ?? int.format, g), rule = int.rule ?? main.rule
    out.push(`+${p.cc} ${f}`, p.e164, `+${p.cc} ${g.join(' ')}`, `+${p.cc}.${g.join('.')}`, `+${p.cc}-${g.join('-')}`, `00${p.cc} ${g.join(' ')}`)
    if (main.np && rule?.includes('$NP')) out.push(`+${p.cc} (${main.np})${f}`)
  } else out.push(p.e164)
  return [...new Set(out)]
}
// the number in the French national plan (what the ARCEP's MAJNUM lists), or null outside it
export function frenchNational(p) {
  if (p.cc === '508') return p.nsn.length === 6 ? `0508${p.nsn}` : `0${p.nsn}`
  return ['33', '262', '590', '594', '596'].includes(p.cc) ? `0${p.nsn}` : null
}
