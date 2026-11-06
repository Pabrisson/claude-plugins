// The phone type: a phone number, from open data without a key. numbering: libphonenumber's metadata gives the E.164
// form, the country, the line type and every writing a page may use; arcep: in the French plan, the operator the
// ARCEP attributed the number's block to — the original operator, not always today's (numbers are ported), hence an
// inferred clue. The agent then searches the web for each writing (method.md). No command calls the number, texts it
// or looks it up in a messaging app, and net.js refuses those links.
import { dataset } from '../../engine/lib/datasets.js'
import { frenchNational, parseMetadata, parsePhone, writings } from '../../engine/lib/phones.js'

// the three open datasets the cases folder keeps a week (lib/datasets.js; their labels are in type.json for doctor);
// describe() says what each holds and refuses a download that is not what this type reads (an error page, columns
// that changed): the copy stays
export const SETS = {
  libphonenumber: { service: 'raw', path: '/google/libphonenumber/master/resources/PhoneNumberMetadata.xml', hours: 168,
    describe: t => { const n = parseMetadata(t).territories.length; if (!n) throw new Error('no territory in the file'); return `${n} territories` } },
  'arcep-majnum': { service: 'arcep', path: '/uploads/MAJNUM.csv', hours: 168, encoding: 'latin1',
    describe: t => `${table(t, MAJNUM_HEAD, 'MAJNUM.csv').length} blocks` },
  'arcep-operators': { service: 'arcep', path: '/uploads/identifiants_CE.csv', hours: 168, encoding: 'latin1',
    describe: t => `${table(t, OPERATORS_HEAD, 'identifiants_CE.csv').length} operators` },
}
// the blocks the ARCEP keeps for works of fiction (decision 2019-0954): never attributed, they reach nobody
export const FICTION = ['019900', '026191', '035301', '046571', '053649', '063998']
export const MAJNUM_HEAD = 'EZABPQM;Tranche_Debut;Tranche_Fin;Mnémo;Territoire;Date_Attribution'
export const OPERATORS_HEAD = 'IDENTITE_OPERATEUR;CODE_OPERATEUR;SIRET_ACTEUR;RCS_ACTEUR;ADRESSE_COMPLETE_ACTEUR;ATTRIB_RESS_NUM;DATE_DECLARATION_OPERATEUR'

// a name the ARCEP's files give (an operator, a territory) ends up in properties, file names and notes: no line break, no [ ] < > ` \ %
const tidy = x => String(x ?? '').replace(/[\r\n]+/g, ' ').replace(/[[\]<>`\\%]/g, '').trim().slice(0, 80)
const dmy = s => { const m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(s ?? ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }
const pairs = s => s.replace(/(\d\d)(?=\d)/g, '$1 ')
const countryName = (lang, id) => { try { return new Intl.DisplayNames([lang, 'en'], { type: 'region' }).of(id) ?? id } catch { return id ?? '?' } }

// ponytail: one record per line — the ARCEP's files have no line break inside a field; quotes and "" are handled
export function csv(text, sep = ';') {
  const rows = []
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line) continue
    const out = []
    let cur = '', q = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (q) { if (c !== '"') cur += c; else if (line[i + 1] === '"') { cur += '"'; i++ } else q = false }
      else if (c === '"') q = true
      else if (c === sep) { out.push(cur); cur = '' }
      else cur += c
    }
    rows.push([...out, cur])
  }
  return rows
}
// the rows under the header the type reads; a file whose columns changed fails loudly instead of being misread
export function table(text, head, name) {
  const [h, ...rows] = csv(text)
  if (h?.join(';') !== head) throw new Error(`${name} changed its columns (${h?.join(';') ?? 'an empty file'}): the phone type reads ${head}`)
  return rows
}
// a number's block in MAJNUM: its prefix (EZABPQM) starts the number and its range has the number's length
export function blockOf(rows, national) {
  let best = null
  for (const r of rows) if (r[1].length === national.length && national.startsWith(r[0]) && (!best || r[0].length > best[0].length)) best = r
  return best && { prefix: best[0], code: tidy(best[3]), territory: tidy(best[4]), date: dmy(best[5]) }
}
export function operatorOf(rows, code) {
  const r = rows.find(x => x[1] === code)
  return r ? { name: tidy(r[0]), code: tidy(r[1]), siren: r[2].replace(/\D/g, '').slice(0, 9) || null, rcs: tidy(r[3]) || null, declared: dmy(r[6]) } : null
}

async function load(ctx, id) {
  const ds = await dataset(ctx.home, id, SETS[id])
  ctx.log(`dataset ${id}: ${ds.stale ? `download failed (${ds.error}), the copy of ${ds.at.slice(0, 10)} is used` : ds.cached ? `the copy of ${ds.at.slice(0, 10)}` : `downloaded ${ds.url}`} · ${ds.size} bytes · sha256 ${ds.sha256.slice(0, 12)}`)
  return ds
}

async function numbering(ctx, st) {
  const set = await load(ctx, 'libphonenumber'), meta = parseMetadata(set.text)
  const p = parsePhone(meta, ctx.input.number, ctx.input.country || 'FR')
  if (p.error) ctx.refuse(`${ctx.input.number}: ${p.error}`)
  const w = writings(meta, p), country = countryName(ctx.lang, p.country)
  const src = await ctx.source({ url: set.url, title: ctx.t('numbering_source', { e164: p.e164 }), reliability: 'B', contentType: 'application/json',
    body: JSON.stringify({ dataset: 'libphonenumber', sha256: set.sha256, ...p, writings: w }, null, 2) })
  ctx.entity('phone', p.e164, { sources: [src.id], props: { role: 'subject', country: p.country, line_type: p.type, valid: p.valid, national: w[0], writings: w } })
  const S = { status: 'read', sources: [src.id] }
  if (p.valid) ctx.clue(ctx.t('line', { number: w[0], type: ctx.t(`type_${p.type}`), country }), S)
  else ctx.clue(ctx.t(p.possible ? 'no_range' : 'bad_length', { number: w[0], country }), S)
  if (p.assumed) ctx.clue(ctx.t('assumed', { country: countryName(ctx.lang, p.assumed), code: p.assumed }), { status: 'inferred', sources: [src.id] })
  ctx.view('writings', w.map(writing => ({ writing })))
  Object.assign(st, { p, w })
}

async function arcep(ctx, { p }) {
  const fr = frenchNational(p)
  if (!fr) { ctx.log(ctx.t('outside_plan', { e164: p.e164 })); return }
  const nums = await load(ctx, 'arcep-majnum'), block = blockOf(table(nums.text, MAJNUM_HEAD, 'MAJNUM.csv'), fr), number = pairs(fr)
  const src = await ctx.source({ url: nums.url, title: ctx.t('arcep_source', { number }), reliability: 'A', contentType: 'application/json',
    body: JSON.stringify({ dataset: 'arcep-majnum', sha256: nums.sha256, number: fr, block }, null, 2) })
  if (!block) {
    const fiction = FICTION.some(f => fr.startsWith(f))
    ctx.clue(ctx.t(fiction ? 'fiction' : 'no_block', { number }), { status: 'read', sources: [src.id] })
    ctx.entity('phone', p.e164, { sources: [src.id], props: { fiction } })
    return
  }
  const ops = await load(ctx, 'arcep-operators'), op = operatorOf(table(ops.text, OPERATORS_HEAD, 'identifiants_CE.csv'), block.code)
  const name = op?.name || block.code, sources = [src.id]
  if (op) sources.push((await ctx.source({ url: ops.url, title: ctx.t('operator_source', { code: op.code, name }), reliability: 'A', contentType: 'application/json',
    body: JSON.stringify({ dataset: 'arcep-operators', sha256: ops.sha256, operator: op }, null, 2) })).id)
  ctx.entity('organization', name, { sources, props: { role: 'block holder', arcep_code: block.code, ...(op?.siren && { siren: op.siren }) } })
  ctx.entity('phone', p.e164, { sources, props: { block: block.prefix, block_holder: name, territory: block.territory } })
  ctx.relate(['phone', p.e164], ['organization', name], 'block attributed to', src.id)
  ctx.clue(ctx.t('holder', { block: pairs(block.prefix), name, code: block.code, date: block.date, territory: block.territory }), { status: 'inferred', sources })
  if (block.date) ctx.timeline([{ date: block.date, label: ctx.t('attributed', { name }), ref: src.id, kind: 'arcep' }])
}

export const commands = {
  collect: {
    help: 'numbering (libphonenumber: E.164, country, line type, the writings to search), then arcep (who holds the French block)',
    flags: {},
    async run(ctx) {
      const st = {}
      ctx.progress(1, 2, 'numbering')
      try { await numbering(ctx, st) } catch (e) { if (e.userError) throw e; ctx.fail(`numbering: ${e.message}`); return }
      ctx.progress(2, 2, 'arcep')
      try { await arcep(ctx, st) } catch (e) { if (e.userError) throw e; ctx.fail(`arcep: ${e.message}`) }
      console.log(`${st.p.e164} · ${st.p.country} · ${st.p.type}${st.p.valid ? '' : ' (fits no range)'}\nwritings to search, in quotes:\n${st.w.map(x => `  "${x}"`).join('\n')}`)
    },
  },
}
