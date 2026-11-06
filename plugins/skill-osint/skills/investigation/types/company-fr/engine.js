// The company-fr type: a French company from its name, SIREN or SIRET, read in the public registries without a key.
// collect: Recherche d'entreprises (identity, establishments with their coordinates, officers); bodacc: the BODACC
// legal notices; officers: each officer's other companies, matched on the name and the month of birth. Each step
// records what it read as a source, entities, clues and relations, adds its dates to the timeline and takes a snapshot
// that refresh compares. Officers are people: their name, their role, their month and year of birth; never a day, an
// address or a nationality. What the registries wrote (names, addresses, notices) enters the notes escaped (`safe`,
// and `ctx.t` which fills its words through it); a clue is written once (the engine finds the same one again), so a
// refresh of an unchanged registry adds none.
import { safe } from '../../engine/lib/templates.js'
import { safeName } from '../../engine/lib/util.js'
import { readNote } from '../../engine/lib/vault.js'
import { luhn } from '../domain/engine.js'

const API = 'https://recherche-entreprises.api.gouv.fr'
// the commonest INSEE legal categories; another one shows its code alone
const LEGAL = { 1000: 'Entrepreneur individuel', 5202: 'SNC', 5485: 'SELARL', 5498: 'EURL', 5499: 'SARL', 5599: "SA à conseil d'administration", 5699: 'SA à directoire', 5710: 'SAS', 5720: 'SASU', 6540: 'SCI', 6599: 'Société civile', 9220: 'Association déclarée' }
// INSEE's staff bands (NN: no employee declared)
const STAFF = { '00': '0', '01': '1-2', '02': '3-5', '03': '6-9', 11: '10-19', 12: '20-49', 21: '50-99', 22: '100-199', 31: '200-249', 32: '250-499', 41: '500-999', 42: '1000-1999', 51: '2000-4999', 52: '5000-9999', 53: '10000+' }
const body = r => r.body.toString('utf8')
const digits = s => String(s ?? '').replace(/\D/g, '')
const spaced = s => [s.slice(0, 3), s.slice(3, 6), s.slice(6, 9), s.slice(9)].filter(Boolean).join(' ')
const num = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
const title = s => String(s ?? '').toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
// a name or an address from a registry, as one plain line: nothing that markdown would read as a link, an image or a block
const tidy = s => String(s ?? '').replace(/[\\![\]<>`%]+/g, ' ').replace(/\s+/g, ' ').trim()
// a company that is not fully public (statut_diffusion other than O) is not for sharing: no note, no source. A sole
// trader (nature juridique 1xxx) is a natural person: only the commune, never an address nor a point, in the notes or
// in the source (ADDRESS keys are dropped from what is kept)
const hidden = c => !!c?.statut_diffusion && c.statut_diffusion !== 'O'
const soleTrader = c => String(c?.nature_juridique ?? '').startsWith('1')
const ADDRESS = /adresse|latitude|longitude|coordonn|voie|code_postal|complement|geo_/i
const scrub = v => (Array.isArray(v) ? v.map(scrub) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => !ADDRESS.test(k)).map(([k, x]) => [k, scrub(x)])) : v)
const keep = (c, extra = {}) => JSON.stringify({ results: [soleTrader(c) ? scrub({ ...c, ...extra }) : { ...c, ...extra }] }, null, 2)
const money = (ctx, v) => (v == null ? '?' : Number(v).toLocaleString(ctx.lang === 'fr' ? 'fr-FR' : 'en-GB'))
export const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// "456 789 122", "SIREN 456 789 122", "RCS Exempleville 456.789.122", a SIRET; null for a name
export function idOf(input) {
  const s = String(input ?? '').trim()
  if (!/^(?:(?:SIREN|SIRET|RCS)\b\D*)?[\d\s.]+$/i.test(s)) return null
  const d = digits(s)
  if (d.length === 9 && luhn(d)) return { siren: d, siret: null }
  if (d.length === 14 && luhn(d.slice(0, 9))) return { siren: d.slice(0, 9), siret: d }
  return { error: `${s}: a SIREN has 9 digits and a SIRET 14, and the SIREN passes the Luhn check` }
}

// one officer as the registry lists it: a person (a month and a year of birth at most) or a company
export function officerOf(d) {
  if (d.type_dirigeant === 'personne morale') {
    const siren = digits(d.siren) || null
    return { type: 'company', name: tidy(d.denomination) || (siren ? `SIREN ${spaced(siren)}` : '?'), siren, role: tidy(d.qualite) || null }
  }
  // the registry gives a month and a year; a day, if one ever comes, is dropped
  const born = String(d.date_de_naissance ?? d.annee_de_naissance ?? '').slice(0, 7) || null
  return { type: 'person', name: tidy(`${title(d.prenoms)} ${title(d.nom)}`), nom: d.nom ?? '', prenoms: d.prenoms ?? '', born, role: tidy(d.qualite) || null }
}
// the officers of a company: one entry per person (all their roles) or company; two people of one name (a father and
// his son) keep an entry each, their value told apart by their birth
export function officersOf(dirigeants) {
  const by = new Map()
  for (const o of (dirigeants ?? []).map(officerOf)) {
    const key = o.type === 'company' ? `company:${o.siren ?? fold(o.name)}` : `person:${fold(o.name)}:${o.born ?? ''}`
    const had = by.get(key)
    if (had) { if (o.role && !had.roles.includes(o.role)) had.roles.push(o.role); continue }
    by.set(key, { ...o, key, roles: o.role ? [o.role] : [] })
  }
  const count = new Map()
  for (const o of by.values()) if (o.type === 'person') count.set(fold(o.name), (count.get(fold(o.name)) ?? 0) + 1)
  return [...by.values()].map(({ roles, ...o }) => ({ ...o, role: roles.join(', ') || null, value: o.type === 'person' && count.get(fold(o.name)) > 1 ? `${o.name} (${o.born ?? '?'})` : o.name }))
}

// one note per company: a second company of the same name (another SIREN) gets its SIREN in its name. The notes say
// which SIREN holds a name; nothing else keeps it.
function orgName(ctx, name, siren) {
  const n = readNote(ctx.file(`Entities/${safeName(tidy(name))}.md`))
  return n.exists && n.props.kind === 'organization' && String(n.props.siren ?? siren) !== siren ? `${tidy(name)} (${spaced(siren)})` : tidy(name)
}

async function search(ctx, params) {
  const q = new URLSearchParams(params).toString()
  const r = await ctx.fetch('entreprises', `/search?${q}`, { retries: 2, timeout: 30000 })
  if (r.status !== 200) throw new Error(`Recherche d'entreprises answered ${r.status}${r.status === 400 ? ` (${safe(/"erreur"\s*:\s*"([^"]*)"/.exec(body(r))?.[1] ?? '')})` : ''}`)
  return { r, q, j: JSON.parse(body(r)) }
}

// a name: one company goes on; several stop with their list, for the user to choose (collect --siren)
async function pick(ctx, text) {
  const { j } = await search(ctx, { q: text, per_page: '5', minimal: 'true', include: 'siege' })
  const list = (j.results ?? []).filter(x => x.nom_complet)
  if (list.length === 1) return list[0].siren
  if (!list.length) ctx.refuse(`no company matches "${text}" in the registry: try its SIREN or another spelling`)
  ctx.refuse(`${j.total_results ?? list.length} companies match "${text}": ${list.map(x => `${spaced(x.siren)} ${tidy(x.nom_complet)} (${tidy(x.siege?.libelle_commune) || '?'}${x.etat_administratif === 'C' ? ', ceased' : ''})`).join(' · ')} — ask the user which one, then company-fr collect --siren <SIREN>`)
}

async function identity(ctx, siren, siret) {
  const { r, q, j } = await search(ctx, { q: siret ?? siren })
  // an unknown number may come back as a record whose fields are all null
  const co = (j.results ?? []).find(x => x.siren === siren && x.nom_complet)
  if (hidden(co)) ctx.refuse(`company ${spaced(siren)}: its data are not fully public (statut_diffusion ${co.statut_diffusion}); nothing is recorded`)
  // the source keeps this company only: a search by SIREN may bring others
  const src = await ctx.source({ url: `${API}/search?${q}`, body: co ? keep(co) : r.body, contentType: 'application/json', title: ctx.t('registry', { siren: spaced(siren) }), reliability: 'A' })
  if (!co) {
    ctx.clue(ctx.t('not_found', { siren: spaced(siren) }), { status: 'read', sources: [src.id] })
    ctx.refuse(`no company ${spaced(siren)} in the registry (Recherche d'entreprises): check the number; a company whose data are not public is left out`)
  }
  const name = orgName(ctx, co.nom_complet, siren), S = { status: 'read', sources: [src.id] }
  const code = co.nature_juridique ?? null, form = code && LEGAL[code] ? `${LEGAL[code]} (${code})` : code
  const year = Object.keys(co.finances ?? {}).sort().at(-1), fin = year ? co.finances[year] : null
  const active = co.etat_administratif === 'A'
  ctx.entity('organization', name, {
    sources: [src.id], confidence: 'high', aliases: [`SIREN ${spaced(siren)}`, tidy(co.sigle)].filter(Boolean),
    props: {
      role: 'subject', siren, legal_form: form, naf: co.activite_principale ?? null, created: co.date_creation ?? null, state: active ? 'active' : 'ceased',
      closed: co.date_fermeture ?? null, category: co.categorie_entreprise ?? null, employees: STAFF[co.tranche_effectif_salarie] ?? null,
      establishments: co.nombre_etablissements ?? null, open_establishments: co.nombre_etablissements_ouverts ?? null, vat: co.tva?.[0] ?? null,
      revenue: fin?.ca ?? null, net_income: fin?.resultat_net ?? null, finances_year: year ? Number(year) : null,
      registry_page: `https://annuaire-entreprises.data.gouv.fr/entreprise/${siren}`,
    },
  })
  ctx.clue(ctx.t('identity', { name, form: form ?? '?', siren: spaced(siren), created: co.date_creation ?? '?' }), S)
  ctx.clue(active ? ctx.t('active') : ctx.t('ceased', { date: co.date_fermeture ?? '?' }), S)
  if (co.activite_principale) ctx.clue(ctx.t('activity', { naf: co.activite_principale }), S)
  const place = soleTrader(co) ? tidy(co.siege?.libelle_commune) : co.siege?.adresse
  if (place) ctx.clue(ctx.t('head_office', { address: place }), S)
  if (fin) ctx.clue(ctx.t('finances', { year, ca: money(ctx, fin.ca), rn: money(ctx, fin.resultat_net) }), S)
  ctx.timeline([
    co.date_creation && { date: co.date_creation, label: ctx.t('created_on'), ref: src.id, kind: 'registry' },
    co.date_fermeture && { date: co.date_fermeture, label: ctx.t('ceased_on'), ref: src.id, kind: 'registry' },
  ].filter(Boolean))
  ctx.state({ siren, name })
  return { co, name, src, item: { key: siren, kind: 'company', name: tidy(co.nom_complet), state: active ? 'active' : 'ceased', head_office: co.siege?.siret ?? null, naf: co.activite_principale ?? null, legal_form: code } }
}

// a search by SIREN gives no matching_etablissements: the search by the company's name gives them (100 at most)
async function establishments(ctx, { co, name, src: src0 }) {
  let hit = null, src = src0
  try {
    const { r, q, j } = await search(ctx, { q: co.nom_raison_sociale || co.nom_complet, per_page: '25', limite_matching_etablissements: '100', minimal: 'true', include: 'matching_etablissements,siege' })
    hit = (j.results ?? []).find(x => x.siren === co.siren) ?? null
    // only this company is kept of the 25 the name brought: the others are third parties and change without it
    src = await ctx.source({ url: `${API}/search?${q}`, body: hit ? keep(hit) : JSON.stringify({ results: [] }), contentType: 'application/json', title: ctx.t('establishments_src', { name }), reliability: 'A' })
  } catch (e) { if (e.userError) throw e; ctx.fail(`establishments: ${safe(e.message)} — the head office only`) }
  const all = new Map()
  for (const e of [co.siege, ...(co.matching_etablissements ?? []), ...(hit?.matching_etablissements ?? [])]) if (e?.siret) all.set(e.siret, { ...all.get(e.siret), ...e })
  const list = [...all.values()].sort((a, b) => Number(!!b.est_siege) - Number(!!a.est_siege) || a.siret.localeCompare(b.siret))
  const features = [], dates = []
  for (const e of list) {
    const open = e.etat_administratif === 'A', ei = soleTrader(co), lat = ei ? null : num(e.latitude), lon = ei ? null : num(e.longitude), value = `SIRET ${spaced(e.siret)}`
    const commune = ei ? tidy(e.libelle_commune) || null : null
    const sign = tidy(e.liste_enseignes?.[0] ?? e.nom_commercial) || null, address = ei ? null : tidy(e.adresse) || null, label = sign ?? address ?? commune ?? value
    const { path } = ctx.entity('place', value, {
      sources: [...new Set([src0.id, src.id])], confidence: 'high',
      props: { siret: e.siret, address, ...(commune && { commune }), sign, lat, lon, state: open ? 'open' : 'closed', head_office: !!e.est_siege, naf: e.activite_principale ?? null, created: e.date_creation ?? null, closed: e.date_fermeture ?? null },
    })
    ctx.relate(['place', value], ['organization', name], e.est_siege ? 'head office of' : 'establishment of', src.id)
    if (lat != null && lon != null) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { role: 'place', group: 'establishments', label: open ? label : ctx.t('closed_label', { label }), ref: path, kind: e.est_siege ? 'head-office' : open ? 'establishment' : 'closed', ...(e.date_creation && { date: e.date_creation }) } })
    if (e.date_creation) dates.push({ date: e.date_creation, label: ctx.t('opened', { label }), ref: src.id, kind: 'establishment' })
    if (e.date_fermeture) dates.push({ date: e.date_fermeture, label: ctx.t('closed', { label }), ref: src.id, kind: 'establishment' })
  }
  ctx.view('map', { type: 'FeatureCollection', features })
  // ponytail: the 40 latest openings and closings, a big company has thousands
  ctx.timeline(dates.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40))
  ctx.clue(ctx.t('establishments', { n: co.nombre_etablissements ?? list.length, open: co.nombre_etablissements_ouverts ?? list.filter(e => e.etat_administratif === 'A').length, listed: list.length }), { status: 'read', sources: [src.id] })
  return list.map(e => ({ key: e.siret, kind: 'establishment', state: e.etat_administratif === 'A' ? 'open' : 'closed', address: soleTrader(co) ? null : tidy(e.adresse) || null }))
}

function officersStep(ctx, { co, name, src }) {
  const list = officersOf(co.dirigeants)
  // a person enters the case only under a frame that says the subject is a person (company-fr always does); otherwise the name stays in the clue
  const people = ctx.person ? list : list.filter(o => o.type !== 'person')
  for (const o of people) {
    if (o.type === 'company' && o.siren) o.value = orgName(ctx, o.value, o.siren)
    const kind = o.type === 'person' ? 'person' : 'organization'
    ctx.entity(kind, o.value, { sources: [src.id], confidence: 'high', props: o.type === 'person' ? { role: o.role, born: o.born } : { siren: o.siren, role: `officer: ${o.role ?? '?'}` } })
    ctx.relate([kind, o.value], ['organization', name], o.role ?? 'officer', src.id)
  }
  if (list.length) ctx.clue(ctx.t('officers', { n: list.length, list: list.map(o => `${o.value} (${o.role ?? '?'})`).join(', ') }), { status: 'read', sources: [src.id] })
  ctx.view('officers', people.map(o => ({ name: o.value, type: o.type, role: o.role, born: o.born ?? null, siren: o.siren ?? null, other_companies: null })))
  ctx.state({ officers: people.map(o => ({ key: o.key, type: o.type, value: o.value, nom: o.nom ?? null, prenoms: o.prenoms ?? null, born: o.born ?? null, role: o.role, siren: o.siren ?? null })) })
  return list.map(o => ({ key: o.key, kind: 'officer', role: o.role }))
}

async function collect(ctx, args, flags) {
  const st = ctx.state()
  const id = flags.siren ? idOf(flags.siren) ?? { error: `--siren ${flags.siren}: 9 digits` } : st.siren ? { siren: st.siren, siret: null } : idOf(ctx.input.company)
  if (id?.error) ctx.refuse(id.error)
  const siren = id?.siren ?? await pick(ctx, ctx.input.company)
  ctx.progress(1, 3, 'identity')
  const found = await identity(ctx, siren, id?.siret ?? null)
  ctx.progress(2, 3, 'establishments')
  const places = await establishments(ctx, found)
  ctx.progress(3, 3, 'officers')
  const people = officersStep(ctx, found)
  // one snapshot per refresh step, named after it: the company, its establishments, its officers
  ctx.snapshot('registry', [found.item, ...places, ...people])
}

const BODACC = 'https://bodacc-datadila.opendatasoft.com'
const RECORDS = '/api/explore/v2.1/catalog/datasets/annonces-commerciales/records'
const PROCEDURES = ['collective', 'conciliation', 'retablissement_professionnel']
// BODACC keeps its structured fields as JSON strings; a broken one is kept as text
const parse = s => { if (s == null || s === '') return null; if (typeof s === 'object') return s; try { return JSON.parse(s) } catch { return { descriptif: String(s) } } }
// a notice's first sentence: the names of the people it concerns (administrators, receivers, notaries) come after
const sentence = s => String(s ?? '').split(/\.\s/)[0].trim()
export function noticeOf(r, siren) {
  const acte = parse(r.acte), jug = parse(r.jugement), rad = parse(r.radiationaurcs), dep = parse(r.depot), f = r.familleavis ?? 'inconnue'
  const people = [].concat(parse(r.listepersonnes)?.personne ?? [])
  const text = f === 'dpc' ? [dep?.typeDepot, dep?.dateCloture].filter(Boolean).join(', ')
    : PROCEDURES.includes(f) ? [jug?.nature ?? jug?.famille, jug?.date].filter(Boolean).join(', ')
    : f === 'radiation' ? rad?.commentaire ?? rad?.dateCessationActivitePP ?? ''
    : f === 'modification' ? sentence(parse(r.modificationsgenerales)?.descriptif)
    : f === 'vente' ? acte?.vente?.categorieVente ?? sentence(acte?.descriptif)
    : ['creation', 'immatriculation'].includes(f) ? acte?.creation?.categorieCreation ?? acte?.immatriculation?.categorieImmatriculation ?? sentence(acte?.descriptif)
    : sentence(parse(r.divers)?.texte ?? parse(r.divers)?.descriptif)
  return {
    key: r.id ?? null, date: r.dateparution ?? null, family: f, label: r.familleavis_lib ?? f, type: r.typeavis ?? 'annonce',
    text: String(text).slice(0, 200), closing: f === 'dpc' ? dep?.dateCloture ?? null : null,
    // registre lists every SIREN of the notice: the company may only be the other party (the seller of a business)
    own: people.some(p => digits(p?.numeroImmatriculation?.numeroIdentification) === siren),
    url: /^https?:\/\//i.test(String(r.url_complete ?? '')) ? r.url_complete : null, procedure: PROCEDURES.includes(f),
  }
}

async function bodacc(ctx) {
  const st = ctx.state(), siren = st.siren ?? idOf(ctx.input.company)?.siren
  if (!siren) ctx.refuse('company-fr bodacc needs the SIREN: run company-fr collect first (it finds the SIREN of a name)')
  // ponytail: the 100 latest notices (the API's page); total_count says how many there are
  const rel = `${RECORDS}?${new URLSearchParams({ where: `registre="${siren}"`, order_by: 'dateparution desc', limit: '100' })}`
  const r = await ctx.fetch('bodacc', rel, { retries: 2, timeout: 30000 })
  if (r.status !== 200) throw new Error(`BODACC answered ${r.status}`)
  const j = JSON.parse(body(r)), notices = (j.results ?? []).map(x => noticeOf(x, siren)).filter(x => x.key && x.date)
  const src = await ctx.source({ url: `${BODACC}${rel}`, body: r.body, contentType: 'application/json', title: ctx.t('bodacc_src', { siren: spaced(siren) }), reliability: 'A' })
  const S = { status: 'read', sources: [src.id] }
  if (!notices.length) { ctx.clue(ctx.t('bodacc_none', { siren: spaced(siren) }), S); ctx.snapshot('bodacc', []); return }
  const total = j.total_count ?? notices.length, dates = notices.map(x => x.date).sort(), counts = {}
  for (const x of notices) counts[x.label] = (counts[x.label] ?? 0) + 1
  ctx.clue(ctx.t('bodacc_summary', { n: notices.length, first: dates[0], last: dates.at(-1), more: total > notices.length ? ctx.t('bodacc_more', { n: notices.length, total }) : '', counts: Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ') }), S)
  const own = notices.filter(x => x.own)
  for (const x of own.filter(y => y.procedure)) ctx.clue(ctx.t('procedure', { text: x.text, date: x.date }), S)
  for (const x of own.filter(y => y.family === 'radiation')) ctx.clue(ctx.t('struck_off', { text: x.text, date: x.date }), S)
  const acc = own.filter(y => y.closing).sort((a, b) => b.closing.localeCompare(a.closing))[0]
  if (acc) ctx.clue(ctx.t('accounts', { text: acc.text, date: acc.date }), S)
  if (st.name) ctx.entity('organization', st.name, { sources: [src.id], props: { bodacc_notices: total, last_accounts: acc?.closing ?? null, procedures: own.filter(y => y.procedure).length } })
  ctx.timeline(notices.map(x => ({
    date: x.date, label: safe(`${x.label}${x.type !== 'annonce' ? ` (${x.type})` : ''}${x.text ? ` — ${x.text}` : ''}`) + (x.own ? '' : ` (${ctx.t('other_party')})`),
    ref: src.id, kind: 'bodacc', ...(x.url && { url: x.url }),
  })))
  ctx.snapshot('bodacc', notices.map(x => ({ key: x.key, date: x.date, family: x.family, type: x.type })))
}

const RANK = { high: 0, medium: 1, low: 2 }
// the network level of a registry officer against one of the case's officers: high = same name and same month of
// birth; medium = same name and same year, the month unknown on one side; low = same name, another month or no birth
// to compare (a namesake is possible); null = another person's name
export function matchLevel(o, d) {
  const given = s => fold(s).split(' ')[0]
  if (fold(d.nom) !== fold(o.nom) || given(d.prenoms) !== given(o.prenoms)) return null
  const a = o.born ?? '', b = officerOf(d).born ?? ''
  if (!a || !b) return 'low'
  if (a.length >= 7 && b.length >= 7) return a.slice(0, 7) === b.slice(0, 7) ? 'high' : 'low'
  return a.slice(0, 4) === b.slice(0, 4) ? 'medium' : 'low'
}

// each officer who is a person: the companies the registry lists for their name and first given name, born in the same
// year (the window), then the level of each; high and medium are linked, low ones stay in the network view only
async function officers(ctx) {
  const st = ctx.state()
  if (!st.siren || !st.officers) ctx.refuse('company-fr officers reads the officers that collect found: run company-fr collect first')
  const people = st.officers.filter(o => o.type === 'person' && o.nom), rows = []
  let n = 0
  for (const o of people) {
    ctx.progress(++n, people.length, o.value)
    // ponytail: the first 25 companies of a name (one page); a very common name needs officers-deep
    const params = { nom_personne: o.nom, prenoms_personne: String(o.prenoms ?? '').trim().split(/\s+/)[0], type_personne: 'dirigeant', per_page: '25', minimal: 'true', include: 'dirigeants,siege' }
    if (o.born) Object.assign(params, { date_naissance_personne_min: `${o.born.slice(0, 4)}-01`, date_naissance_personne_max: `${o.born.slice(0, 4)}-12` })
    let res
    try { res = await search(ctx, params) } catch (e) { if (e.userError) throw e; ctx.fail(`officers ${o.value}: ${safe(e.message)}`); continue }
    // the matches first: the source keeps the companies retained (and the officer's own record in each), not the 25 the name brought
    const found = []
    for (const c of res.j.results ?? []) {
      if (c.siren === st.siren || !c.nom_complet || hidden(c)) continue
      const best = (c.dirigeants ?? []).filter(d => d.type_dirigeant === 'personne physique').map(d => ({ d, level: matchLevel(o, d) })).filter(x => x.level).sort((a, b) => RANK[a.level] - RANK[b.level])[0]
      if (best) found.push({ c, best })
    }
    const kept = found.filter(x => x.best.level !== 'low').map(({ c, best }) => (soleTrader(c) ? scrub : x => x)({ ...c, dirigeants: [best.d], matching_etablissements: undefined }))
    const src = await ctx.source({ url: `${API}/search?${res.q}`, body: JSON.stringify({ results: kept }, null, 2), contentType: 'application/json', title: ctx.t('officer_search', { name: o.value }), reliability: 'A' })
    const S = { status: 'read', sources: [src.id] }
    let linked = 0, namesakes = 0
    for (const { c, best } of found) {
      const role = tidy(best.d.qualite) || null, state = c.etat_administratif === 'C' ? 'ceased' : 'active'
      rows.push({ key: `${o.value} > ${c.siren}`, officer: o.value, company: tidy(c.nom_complet), siren: c.siren, role, born: officerOf(best.d).born, level: best.level, state, city: tidy(c.siege?.libelle_commune) || null })
      if (best.level === 'low') { namesakes++; continue }
      linked++
      const value = orgName(ctx, c.nom_complet, c.siren)
      ctx.entity('organization', value, { sources: [src.id], confidence: best.level, props: { siren: c.siren, role: 'officer’s other company', network: best.level, state } })
      ctx.relate(['person', o.value], ['organization', value], safe(`${role ?? 'officer'} (${best.level})`), src.id)
      ctx.clue(ctx.t(`network_${best.level}`, { name: o.value, role: role ?? '?', company: tidy(c.nom_complet), siren: spaced(c.siren) }), S)
    }
    if (namesakes) ctx.clue(ctx.t('namesakes', { name: o.value, n: namesakes }), S)
    ctx.entity('person', o.value, { sources: [src.id], props: { other_companies: linked } })
  }
  const linkedOf = v => rows.filter(r => r.officer === v && r.level !== 'low').length
  ctx.view('officers', st.officers.map(o => ({ name: o.value, type: o.type, role: o.role, born: o.born, siren: o.siren, other_companies: o.type === 'person' ? linkedOf(o.value) : null })))
  ctx.view('network', rows.map(({ key, ...r }) => r))
  ctx.snapshot('officers', rows.map(r => ({ key: r.key, level: r.level, role: r.role, state: r.state })))
}

export const commands = {
  collect: { help: "identity, establishments and officers from Recherche d'entreprises; --siren <SIREN> to pick one of the companies of a name", flags: { siren: 'string' }, run: collect },
  bodacc: { help: 'the BODACC notices: changes, insolvency proceedings, strike-off, filed accounts', flags: {}, run: bodacc },
  officers: { help: 'the other companies of each officer, matched on the name and the month of birth', flags: {}, run: officers },
}
