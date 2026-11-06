// The person type, the orchestrator. From a name and the identifiers already known, `plan` records each identifier
// with why the purpose needs it and proposes one child case per identifier (pivots the user chooses); `consolidate`
// reads what the linked cases (the parent, the children) found about their subject and writes Profile.md; `lr` weighs
// an identifier as the subject's or another person's with a clue of a linked case. It reads the other cases' notes and
// never writes there; it calls no service (libphonenumber's metadata, cached by the phone type, aside).
import fs from 'node:fs'
import path from 'node:path'
import { clamp, rank } from '../../engine/lib/analysis.js'
import { withLock } from '../../engine/lib/case.js'
import { cluesOf } from '../../engine/lib/cycle.js'
import { dataset } from '../../engine/lib/datasets.js'
import { CAPS, normalize } from '../../engine/lib/kinds.js'
import { parseAddress } from '../../engine/lib/mail.js'
import { parseMetadata, parsePhone } from '../../engine/lib/phones.js'
import { CATEGORIES, fold, isMinor, isStreetAddress, sensitiveHit } from '../../engine/lib/sensitive.js'
import { refresh } from '../../engine/lib/refresh.js'
import { frameRefusal } from '../../engine/lib/watch.js'
import { watchSteps } from '../../engine/lib/watch-rules.js'
import { safe } from '../../engine/lib/templates.js'
import { getType } from '../../engine/lib/types.js'
import { readNote } from '../../engine/lib/vault.js'
import { domainOf, luhn } from '../domain/engine.js'
import { SETS } from '../phone/engine.js'

// the words a line may start with (« ville : Lyon »), in English and French, folded
export const LABELS = {
  username: ['username', 'user', 'pseudo', 'pseudonyme', 'handle', 'login'],
  email: ['email', 'e-mail', 'mail', 'courriel', 'adresse email', 'adresse mail'],
  phone: ['phone', 'telephone', 'tel', 'mobile', 'portable', 'numero', 'gsm'],
  domain: ['domain', 'domaine', 'site', 'website', 'site web', 'url'],
  employer: ['employer', 'employeur', 'company', 'societe', 'entreprise', 'siren', 'siret'],
  city: ['city', 'ville', 'town', 'commune'],
}
const KIND = { username: 'username', account: 'account', email: 'email', phone: 'phone', domain: 'domain', employer: 'organization', city: 'place' }
// a town alone opens no case: place (stage 9) wants an address or coordinates, and a person's home is never sought
const TYPE = { username: 'username', account: 'username', email: 'email', phone: 'phone', domain: 'domain', employer: 'company-fr', city: null }
const SOCIAL = /(^|\.)(instagram\.com|facebook\.com|x\.com|twitter\.com|tiktok\.com|github\.com|linkedin\.com|youtube\.com|bsky\.app|threads\.net|mastodon\.social|pinterest\.com|reddit\.com|twitch\.tv|soundcloud\.com|medium\.com)$/
const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/
const digits = s => String(s).replace(/\D/g, '')
const spaced = s => `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6, 9)}`
const companyId = text => text.replace(/^(siren|siret)\s*:?\s*/i, '')
export { isStreetAddress }
export const splitLines = text => [...new Set(String(text ?? '').split(/\r?\n/).map(s => s.trim()).filter(Boolean))]

// what a line is when no label says it: an email, a URL (a social network's profile is an account), a @handle, a SIREN
// or SIRET, a phone number, a host name, a lower-case handle; else null (the agent writes « city: … », « employer: … »)
function guess(text) {
  if (parseAddress(text)) return 'email'
  if (/^https?:\/\//i.test(text)) { try { return SOCIAL.test(new URL(text).hostname.toLowerCase()) ? 'account' : 'domain' } catch { return null } }
  if (/^@[\w.-]{1,40}$/.test(text)) return 'username'
  const id = companyId(text)
  if (/^[\d\s.]+$/.test(id) && [9, 14].includes(digits(id).length) && luhn(digits(id))) return 'employer'
  if (/^\+?[\d\s.()/-]+$/.test(text) && digits(text).length >= 8 && digits(text).length <= 15) return 'phone'
  if (HOST.test(text.toLowerCase().replace(/^www\./, '').replace(/\.$/, ''))) return 'domain'
  if (/^[\p{Ll}\d_.-]{2,40}$/u.test(text)) return 'username'
  return null
}

// one line of the identifiers: what it is, its value as an entity, the child case it calls for
// region: the country of a number written without its country code, given by the language (fr) or the plan's entry; none: refused
export function identify(line, { meta = null, as = null, region = null } = {}) {
  const raw = String(line ?? '').trim()
  const m = /^([^:]{1,24}?)\s*:\s*(.+)$/.exec(raw)
  const label = m && Object.entries(LABELS).find(([, ls]) => ls.includes(fold(m[1]).replace(/[.\s]+$/, '').trim()))?.[0]
  const text = label ? m[2].trim() : raw
  let kind = as ?? label ?? guess(text)
  if (kind === 'domain' && guess(text) === 'account') kind = 'account'
  const no = error => ({ line: raw, error })
  if (isStreetAddress(text)) return no('a street address: a person case never plans a case on where someone lives')
  const item = (value, props = {}) => ({ line: raw, as: kind, kind: KIND[kind], value, type: TYPE[kind], props })
  switch (kind) {
    case 'username': {
      const v = text.replace(/^@/, '').toLowerCase()
      return /^[^\s/]{1,64}$/.test(v) ? item(v) : no('a username has no space nor slash')
    }
    case 'account': {
      try { const u = new URL(text); return item(`${u.origin}${u.pathname}`.replace(/\/+$/, ''), { site: u.hostname.replace(/^www\./, '') }) } catch { return no('not a URL') }
    }
    case 'email': { const a = parseAddress(text); return a ? item(a.address) : no('not an email address') }
    case 'phone': {
      if (!meta) return digits(text).length >= 8 ? item(text.replace(/[^\d+]/g, '')) : no('not a phone number')
      const p = parsePhone(meta, text, region), plus = /^[^\d+(]*\(?\s*(?:\+|00)/.test(text)
      if (!plus && !region) return no('a number without its country code: write it with it (« +44 7700 900123 »), or give "country": "GB" in the plan — the country is never guessed')
      if (p.error) return no(`not a phone number: ${p.error}`)
      return !plus && !p.possible ? no(`not a possible number of ${region}: write it with its country code`) : item(p.e164)
    }
    case 'domain': { const d = domainOf(text); return HOST.test(d) ? item(d) : no('not a domain name') }
    case 'employer': {
      const id = companyId(text), n = digits(id)
      if (/^[\d\s.]+$/.test(id) && [9, 14].includes(n.length)) return luhn(n) ? item(`SIREN ${spaced(n)}`, { siren: n.slice(0, 9), ...(n.length === 14 && { siret: n }) }) : no('a SIREN or SIRET whose check digit is wrong')
      return item(text)
    }
    case 'city': return item(text, { coarse: true })
    default: return no(`not recognised: write it « <what>: <value> », <what> one of ${Object.keys(LABELS).join(', ')}`)
  }
}

// the plan: every line of the input with why the purpose needs it (data minimisation) or why it is dropped; a line
// only in plan.json is an identifier added; nothing passes while one problem is left
export function planItems(lines, entries, { meta = null, ignore = [], region = null } = {}) {
  const items = [], dropped = [], errors = [], seen = new Set()
  if (!Array.isArray(entries) || entries.some(e => typeof e?.line !== 'string')) return { items, dropped, errors: ['plan.json: a list of { "line", "why" } (or "drop" instead of "why"), one per identifier'] }
  const byLine = new Map(entries.map(e => [e.line.trim(), e]))
  for (const line of [...lines, ...[...byLine.keys()].filter(l => !lines.includes(l))]) {
    const e = byLine.get(line) ?? {}
    if (String(e.drop ?? '').trim()) {
      // a dropped line is kept (and journaled) with its reason: unless it names article 9 data, which is never written down
      const hit = sensitiveHit({ text: `${line}\n${e.drop}`, ignore })
      dropped.push(hit ? { line: '(withheld)', reason: `${CATEGORIES[hit.category].label} data (GDPR article 9)` } : { line, reason: String(e.drop).trim() })
      continue
    }
    const why = String(e.why ?? '').trim()
    if (!why) { errors.push(`« ${line} »: why does the purpose need it? (data minimisation: each identifier has its "why", or "drop")`); continue }
    const hit = sensitiveHit({ text: `${line}\n${why}`, ignore })
    if (hit) { errors.push(`« ${line} »: it names ${CATEGORIES[hit.category].label} data (GDPR article 9), which a person case never looks for`); continue }
    if (e.as != null && !Object.keys(LABELS).includes(e.as)) { errors.push(`« ${line} »: "as" is one of ${Object.keys(LABELS).join(', ')}`); continue }
    const it = identify(line, { meta, as: e.as ?? null, region: e.country ? String(e.country).toUpperCase() : region })
    if (it.error) { errors.push(`« ${line} »: ${it.error}`); continue }
    const key = normalize(it.kind, it.value, it.props)
    if (seen.has(key)) continue
    seen.add(key)
    items.push({ ...it, why, key })
  }
  return { items, dropped, errors }
}

// a linked case as this type reads it: its frame, its entities, its sources, its timeline (never written to)
export function readLinked(home, slug, rel) {
  const dir = path.join(home, String(slug))
  if (!fs.existsSync(path.join(dir, '.osint', 'case.json'))) return null
  const notes = folder => { try { return fs.readdirSync(path.join(dir, folder)).filter(n => n.endsWith('.md')).sort().map(n => `${folder}/${n}`) } catch { return [] } }
  const p = readNote(path.join(dir, 'Case.md')).props
  const entities = notes('Entities').map(r => { const props = readNote(path.join(dir, r)).props; return { path: r, kind: props.kind, value: String(props.value ?? ''), props } }).filter(e => e.kind)
  const sources = notes('Sources').map(r => ({ name: path.posix.basename(r, '.md'), ...readNote(path.join(dir, r)).props }))
  let timeline = []
  try { timeline = JSON.parse(fs.readFileSync(path.join(dir, '.osint', 'views', 'timeline.json'), 'utf8')) } catch {}
  return { slug: String(slug), rel, dir, type: p.type, status: p.status, confidence: p.confidence ?? null, from: p.from ?? null, input: p.input ?? null, entities, sources, timeline }
}
export const linkedOf = ctx => {
  const f = ctx.frame(), home = path.dirname(ctx.dir)
  return [...(f.parent ? [[f.parent, 'parent']] : []), ...[].concat(f.children ?? []).map(s => [s, 'child'])].map(([s, r]) => readLinked(home, s, r)).filter(Boolean)
}
// the entity the case started from, in its parent (a company's officer): its birth month makes the subject the same
// person across cases (normalize), and says whether the subject may be a minor
function startedFrom(ctx) {
  const f = ctx.frame()
  return f.parent && f.from ? readNote(path.join(path.dirname(ctx.dir), String(f.parent), String(f.from))).props : {}
}
async function phoneMeta(ctx) {
  try { return parseMetadata((await dataset(path.dirname(ctx.dir), 'libphonenumber', SETS.libphonenumber)).text) } catch (e) {
    ctx.log(`libphonenumber metadata unavailable (${e.message}): phone numbers kept as written`)
    return null
  }
}

async function plan(ctx, args, flags) {
  if (!flags.file) ctx.refuse('person plan --file plan.json — [{ "line": "<a line of the identifiers>", "why": "<why the purpose needs it>" }, …]')
  let entries
  try { entries = JSON.parse(fs.readFileSync(flags.file, 'utf8')) } catch (e) { ctx.refuse(`${flags.file}: ${e.message}`) }
  const name = String(ctx.input.name), from = startedFrom(ctx), born = from.born ? String(from.born).slice(0, 7) : null
  const { items, dropped, errors } = planItems(splitLines(ctx.input.identifiers), entries, { meta: await phoneMeta(ctx), ignore: [name], region: ctx.lang === 'fr' ? 'FR' : null })
  if (born && isMinor(born)) errors.unshift(`the subject may be a minor (born ${born}): a person case never looks at a minor`)
  if (errors.length) ctx.refuse(`the plan is refused, nothing was written:\n- ${errors.join('\n- ')}`)
  ctx.entity('person', name, { props: { role: 'subject', ...(born && { born }) } })
  const covered = new Map(linkedOf(ctx).flatMap(c => c.entities.filter(e => e.props.role === 'subject').map(e => [normalize(e.kind, e.value, e.props), c])))
  const planned = []
  for (const it of items) {
    const r = ctx.entity(it.kind, it.value, { props: { role: 'identifier', why: it.why, line: it.line, case_type: it.type, ...it.props } })
    if (r.withheld) continue
    ctx.relate(['person', name], [it.kind, it.value], 'identifier')
    planned.push({ line: it.line, as: it.as, kind: it.kind, value: it.value, type: it.type, why: it.why, key: it.key, path: r.path })
    const c = covered.get(it.key)
    console.log(c ? `${it.value}: already in ${c.slug} (${c.rel})` : it.type ? `[pivot:${it.type}] ${it.value} — from ${r.path}`
      : `${it.value}: kept as an identifier — a town alone opens no case (place needs an address or coordinates)`)
  }
  ctx.state({ identifiers: planned, dropped })
  const ev = ctx.log(`plan: ${planned.length} identifiers (${planned.map(p => `${p.type} ${p.value}`).join(', ')})${dropped.length ? `, ${dropped.length} dropped: ${dropped.map(d => `« ${d.line} » ${d.reason}`).join(' ; ')}` : ''}`)
  console.log(`plan: ${planned.length} identifiers, ${dropped.length} dropped · ^${ev.journal}`)
  await writeProfile(ctx)
}

// ── consolidation ─────────────────────────────────────────────────────────────────────────────────────────────────
// what a child of each type finds about the one who holds its subject (its other entities are context: a registrar,
// the shops near a town, a block's operator); a parent gives its subject only
export const FINDS = { username: ['account'], email: ['username', 'account', 'domain'], domain: ['account', 'email'] }
// what a child finds that says nothing about the subject (the e-mail's provider, a site's host): never a candidate
const CONTEXT_ROLES = new Set(['email domain', 'local part of an address', 'hostname', 'subdomain', 'nameserver', 'registrar', 'registrant', 'hosting', 'hosting (legal notice)', 'mail', 'ptr', 'cloud', 'abuse contact', 'AS holder', 'block holder'])
const ORDER = ['username', 'account', 'email', 'phone', 'domain', 'organization', 'place', 'image', 'url']
const RANK = { high: 3, medium: 2, low: 1 }
const firstSource = sources => /\[\[(S\d+)/.exec([].concat(sources ?? [])[0] ?? '')?.[1] ?? null
const samePerson = (e, subject) => e.kind === 'person' && fold(e.value).trim() === fold(subject.name).trim()
  && !(e.props?.born && subject.born && String(e.props.born).slice(0, 7) !== String(subject.born).slice(0, 7))
// the share of « the subject's » against « another person's », a priori one half each, from the cells' LRs capped by
// their clue's status: analysis.js's own ranking, on a level of two
export const belongs = cells => (cells.length
  ? rank([{ id: 'subject', level: 'x', status: 'active' }, { id: 'other', level: 'x', status: 'active' }], cells.map(c => ({ clue: c.clue, hyp: 'subject', lr: c.lr, status: c.status }))).x.find(h => h.id === 'subject').share
  : null)

// one row per identifier: the ones planned, then what the linked cases found; a child opened on a planned identifier
// joins its row through its `from`, whatever the spelling (06… or +33…)
export function profileRows({ subject, planned = [], linked = [], cells = [] }) {
  const rows = new Map()
  // a found entity keeps the properties its sharing key rests on (a SIREN, an OSM id, a point), so that it stays shared
  const keyProps = p => Object.fromEntries(['siren', 'osm', 'coarse', 'lat', 'lon'].filter(k => p?.[k] != null).map(k => [k, p[k]]))
  const row = (key, e) => rows.get(key) ?? rows.set(key, { key, kind: e.kind, value: e.value, type: e.type ?? null, planned: false, why: null, path: null, props: keyProps(e.props), cases: [] }).get(key)
  for (const p of planned) Object.assign(row(p.key, p), { planned: true, why: p.why, type: p.type, path: p.path })
  for (const c of linked) {
    const mate = c.entities.find(e => samePerson(e, subject))
    const own = c.entities.filter(e => e.props?.role === 'subject' && e.kind !== 'person')
    const found = c.rel === 'child' ? c.entities.filter(e => (FINDS[c.type] ?? []).includes(e.kind) && e.props?.role !== 'subject' && !CONTEXT_ROLES.has(e.props?.role) && e.props?.mail_provider == null) : []
    for (const e of [...own, ...found]) {
      const joined = e.props?.role === 'subject' && c.rel === 'child' ? planned.find(p => p.path === c.from) : null
      const r = joined ? rows.get(joined.key) : row(normalize(e.kind, e.value, e.props ?? {}), e)
      if (e.props?.role === 'subject') r.asked = true
      const confidence = e.props?.role === 'subject' && c.status === 'done' && c.confidence ? c.confidence : e.props?.confidence ?? 'low'
      if (!r.cases.some(x => x.slug === c.slug)) r.cases.push({ slug: c.slug, rel: c.rel, path: e.path, source: firstSource(e.props?.sources), confidence, as: e.props?.role === 'subject' ? mate?.props?.role ?? null : null })
    }
  }
  for (const r of rows.values()) {
    const mine = cells.filter(x => x.key === r.key)
    // what a child only found (an account of a namesake, a colleague's address on the shop's site) is a candidate: out of the
    // profile until a likelihood ratio above 1 says it is the subject's
    Object.assign(r, { candidate: !r.planned && !r.asked && !mine.some(x => x.lr > 1), share: belongs(mine), lrs: mine.length, confidence: r.cases.map(x => x.confidence).sort((a, b) => (RANK[b] ?? 0) - (RANK[a] ?? 0))[0] ?? null })
  }
  return [...rows.values()].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.value.localeCompare(b.value))
}

// Profile.md's managed block: the subject, the linked cases, a table per kind of identifier, the identity cells
const pct = x => `${Math.round(x * 100)} %`
const cell = s => safe(String(s ?? '')).replace(/\|/g, '\\|')
const caseLink = (slug, rel = 'Case.md') => `[${slug}](obsidian://open?vault=${encodeURIComponent(slug)}&file=${encodeURIComponent(rel.replace(/\.md$/, ''))})`
const wiki = rel => (rel ? `[[${safe(path.posix.basename(rel, '.md'))}]]` : null)
export function profileText(rows, { subject, linked = [], cells = [], t, journal }) {
  const head = [`# ${t('profile')} — ${safe(subject.name)}`, '', [subject.born && t('born_is', { born: subject.born }),
    // the list holds links: it goes in as it is, never through t (whose variables are escaped as third-party text)
    `${t('linked_are')} ${linked.length ? linked.map(c => `${caseLink(c.slug)} (${t(c.rel)})`).join(', ') : t('none')}`,
    journal && `[[Journal#^${journal}]]`].filter(Boolean).join(' · ')]
  rows = rows.filter(r => !r.candidate)
  const groups = ORDER.filter(k => rows.some(r => r.kind === k)).flatMap(k => ['', `## ${t(`kind_${k}`)}`, '',
    `| ${t('identifier')} | ${t('case')} | ${t('source')} | ${t('confidence')} | ${t('belongs')} | ${t('why')} |`, '|---|---|---|---|---|---|',
    ...rows.filter(r => r.kind === k).map(r => `| ${wiki(r.path) ?? cell(r.value)} | ${r.cases.length ? r.cases.map(c => `${caseLink(c.slug, c.path)}${c.as ? ` (${t('as_role', { role: c.as }).replace(/\|/g, '\\|')})` : ''}`).join(', ') : t(r.type ? 'proposed' : 'no_child')} | ${r.cases.map(c => c.source && `${c.slug} ${c.source}`).filter(Boolean).join(', ')} | ${r.confidence ?? ''} | ${r.share == null ? t('not_weighed') : `${pct(r.share)} (${t('lrs', { n: r.lrs })})`} | ${cell(r.why ?? '')} |`)])
  const lines = cells.map(c => `- ${cell(c.value)} ← ${caseLink(c.case, c.clue_path)} ×${c.lr} (${c.status}, cap ${c.cap}) — ${cell(c.why)} · [[Journal#^${c.journal}]]`)
  return [...head, ...groups, ...(lines.length ? ['', `## ${t('identity')}`, '', ...lines] : [])].join('\n')
}

// the candidates (found by a child, not weighed): their own block of Profile.md, never in the profile nor its PDF
export function candidatesText(rows, { t }) {
  const c = rows.filter(r => r.candidate)
  if (!c.length) return ''
  return [`## ${t('candidates')}`, '', t('candidates_note'), '', `| ${t('identifier')} | ${t('case')} | ${t('source')} | ${t('confidence')} |`, '|---|---|---|---|',
    ...c.map(r => `| ${wiki(r.path) ?? cell(r.value)} | ${r.cases.map(x => caseLink(x.slug, x.path)).join(', ')} | ${r.cases.map(x => x.source && `${x.slug} ${x.source}`).filter(Boolean).join(', ')} | ${r.confidence ?? ''} |`)].join('\n')
}

// the profile as of now: the plan kept in state, the linked cases read from disk, the identity cells
function profileOf(ctx) {
  const st = ctx.state(), from = startedFrom(ctx)
  const subject = { name: String(ctx.input.name), born: from.born ? String(from.born).slice(0, 7) : null }
  const linked = linkedOf(ctx), cells = st.cells ?? []
  return { subject, linked, cells, rows: profileRows({ subject, planned: st.identifiers ?? [], linked, cells }) }
}
// write it: the identifiers as entities of this vault (graph, shared entities, pivots), Profile.md, the Identifiers
// table, the timeline of every linked case, the `profile` snapshot that Refresh compares
async function writeProfile(ctx) {
  const { subject, linked, cells, rows } = profileOf(ctx), kept = []
  ctx.entity('person', subject.name, { props: { role: 'subject', ...(subject.born && { born: subject.born }) } })
  for (const r of rows) {
    const e = ctx.entity(r.kind, r.value, { ...(r.confidence && { confidence: r.confidence }), props: { ...r.props, role: r.planned ? 'identifier' : r.candidate ? 'candidate' : 'found', cases: r.cases.map(c => c.slug), belongs: r.share == null ? null : pct(r.share) } })
    if (e.withheld) continue
    ctx.relate(['person', subject.name], [r.kind, r.value], r.planned ? 'identifier' : r.candidate ? 'candidate' : 'found identifier')
    kept.push({ ...r, path: e.path })
  }
  const cand = kept.filter(r => r.candidate).length, ev = ctx.log(`profile: ${kept.length - cand} identifiers from ${linked.length} linked cases (${linked.map(c => c.slug).join(', ') || 'none yet'})${cand ? `, ${cand} candidates not weighed` : ''}`)
  ctx.block('Profile.md', 'profile', profileText(kept, { subject, linked, cells, t: ctx.t, journal: ev.journal }))
  ctx.block('Profile.md', 'candidates', candidatesText(kept, { t: ctx.t }))
  ctx.view('candidates', kept.filter(r => r.candidate).map(r => ({ kind: r.kind, value: r.value, confidence: r.confidence, case: r.cases.map(c => c.slug).join(', '), source: r.cases.map(c => c.source && `${c.slug} ${c.source}`).filter(Boolean).join(', ') })))
  ctx.view('identifiers', kept.filter(r => !r.candidate).map(r => ({
    kind: r.kind, value: r.value, confidence: r.confidence, belongs: r.share == null ? ctx.t('not_weighed') : pct(r.share),
    case: r.cases.map(c => c.slug).join(', ') || ctx.t(r.type ? 'proposed' : 'no_child'), source: r.cases.map(c => c.source && `${c.slug} ${c.source}`).filter(Boolean).join(', '), why: r.why ?? '',
  })))
  ctx.view('timeline', linked.flatMap(c => [
    ...c.timeline.map(({ ref, ...i }) => ({ ...i, label: `${c.slug} · ${i.label}`, case: c.slug })),
    ...c.sources.filter(s => s.accessed).map(s => ({ date: s.accessed, label: `${c.slug} · ${s.name}`, kind: 'source', ...(/^https?:\/\//.test(s.url ?? '') && { url: s.url }), case: c.slug })),
  ]).filter(i => i.date).sort((a, b) => String(a.date).localeCompare(String(b.date))))
  ctx.snapshot('profile', kept.map(r => ({ key: r.key, ...(r.candidate && { candidate: true }), cases: r.cases.map(c => c.slug).sort(), confidence: r.confidence, share: r.share == null ? null : Math.round(r.share * 100) })))
  return { kept, linked, journal: ev.journal }
}

// the steps of a child's Refresh that the person's Refresh runs: all but the noisy ones, which wait for the user's yes
// (and need no word when the child never runs them)
export function childSteps(manifest, noisy) {
  const steps = manifest?.refresh ?? [], loud = steps.filter(s => s.noisy).map(s => s.id)
  return { only: steps.map(s => s.id).filter(id => !loud.includes(id)), loud: noisy === 'never' ? [] : loud }
}
// each child's own Refresh (its snapshots, its What changed, its Journal), one after the other; its agent steps come
// back with the case they belong to; a child gone, of a type no longer here or failing is noted and the others go on.
// Nothing on stdout: under `refresh --json` (the dashboard's Refresh) stdout is the JSON
async function refreshChildren(ctx) {
  const home = path.dirname(ctx.dir), kids = linkedOf(ctx).filter(c => c.rel === 'child'), watch = process.env.OSINT_BY === 'watch'
  let n = 0
  for (const c of kids) {
    ctx.progress(++n, kids.length, `refresh ${c.slug}`)
    try {
      const { only, loud } = childSteps(getType(c.type), readNote(path.join(c.dir, 'Case.md')).props.noisy)
      // the watch (OSINT_BY=watch) runs a child's watched steps only, within the child's own frame
      const refused = watch ? frameRefusal(c.dir) : null
      if (refused) { ctx.log(`refresh ${c.slug}: not run by the watch — ${refused}`); continue }
      if (loud.length && !watch) ctx.log(`refresh ${c.slug}: ${loud.join(', ')} not run (noisy) — after the user's yes: refresh -p ${c.slug} --only ${loud.join(',')} --yes`)
      if (watch ? !watchSteps(getType(c.type)).length : !only.length) continue
      const r = await refresh(home, c.slug, { only, watch })
      if (!watch) ctx.agentSteps(r.agent.map(a => ({ ...a, id: `${c.slug}:${a.id}`, prompt: `${a.prompt} (case ${c.slug})` })))
      ctx.log(`refresh ${c.slug}: ${r.diffs.map(d => `${d.name} ${d.first ? 'first' : `+${d.added.length} −${d.removed.length} ~${d.changed.length}`}`).join(', ') || 'agent steps only'}`)
    } catch (e) { if (!e.userError) throw e; ctx.fail(`refresh ${c.slug}: ${e.message}`) }
  }
}
// --children: the person's Refresh (type.json) — each child's Refresh first; its output is refresh's, so no stdout then
async function consolidate(ctx, args, flags) {
  if (flags.children) await refreshChildren(ctx)
  const { kept, linked, journal } = await writeProfile(ctx)
  if (!flags.children) console.log(`profile: ${kept.filter(r => !r.candidate).length} identifiers from ${linked.length} linked cases · ^${journal}`)
}

// identity: how much a clue of a linked case says an identifier is the subject's (above 1) or another person's (below 1)
async function lr(ctx, args, flags) {
  const value = args.join(' ').trim(), { rows, linked } = profileOf(ctx)
  const r = rows.find(x => x.value === value || x.key === value || fold(x.value) === fold(value))
  if (!r) ctx.refuse(`no identifier « ${value} » in the profile: ${rows.map(x => x.value).join(', ') || 'none yet (person plan, then person consolidate)'}`)
  const c = linked.find(x => x.slug === flags.case)
  if (!c) ctx.refuse(`--case <a linked case: ${linked.map(x => x.slug).join(', ') || 'none yet'}>`)
  const clue = cluesOf(c.dir).find(x => x.id === flags.clue)
  if (!clue) ctx.refuse(`no clue ${flags.clue} in ${c.slug}`)
  const asked = Number(flags.lr), why = String(flags.why ?? '').trim()
  if (!(asked > 0)) ctx.refuse('--lr <a positive number: above 1 the subject\'s, below 1 another person\'s>')
  if (!why) ctx.refuse('--why "<what the clue says about whose identifier it is>"')
  const hit = sensitiveHit({ text: why, ignore: [String(ctx.input.name)] })
  if (hit) ctx.refuse(`refused: ${CATEGORIES[hit.category].label} data (GDPR article 9) is never recorded in a person case nor in its children`)
  const cap = CAPS[clue.status] ?? 3, v = +clamp(asked, cap).toFixed(3)
  const ev = ctx.log(`identity ${r.value} ← ${c.slug} ${clue.id} ×${v} (${clue.status}, cap ${cap})${v !== asked ? ` (asked ${asked})` : ''}: ${why}`)
  // read, replace, write the cells under the case's lock: two weighings at once lose none
  withLock(ctx.dir, () => {
    const cells = (ctx.state().cells ?? []).filter(x => !(x.key === r.key && x.case === c.slug && x.clue === clue.id))
    ctx.state({ cells: [...cells, { key: r.key, value: r.value, case: c.slug, clue: clue.id, clue_path: clue.path, status: clue.status, lr: v, cap, why, journal: ev.journal }] })
  })
  const row = (await writeProfile(ctx)).kept.find(x => x.key === r.key)
  console.log(`${r.value}: ${row?.share == null ? 'not weighed' : `${pct(row.share)} the subject's`} (${row?.lrs ?? 0} LR) · ^${ev.journal}`)
}

export const commands = {
  plan: { help: 'record each identifier with why the purpose needs it (--file plan.json) and propose one child case per identifier', flags: { file: 'string' }, run: plan },
  consolidate: { help: 'read the linked cases (the parent, the children) and write Profile.md, the Identifiers table and the timeline; --children runs each child\'s Refresh first', flags: { children: 'boolean' }, run: consolidate },
  lr: { help: 'identity: "<identifier>" --case <linked case> --clue <Cnn> --lr <x> --why "…" (above 1 the subject\'s, below 1 another person\'s)', flags: { case: 'string', clue: 'string', lr: 'string', why: 'string' }, run: lr },
}
