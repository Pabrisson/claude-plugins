// The username type: the public accounts that carry a username. WhatsMyName's list of sites (a dataset the cases
// folder keeps a week) is read with GET only, at most 8 requests at once and one site at a time per host, 10 s each.
// What it finds are candidate accounts, not identities: each account found becomes an `account` entity tied to the
// `username`, with the lowest confidence; every answer (found, absent, unknown, skipped) is kept in one hashed
// source; the Accounts table (views/accounts.json) shows the found and the unknown ones.
import fs from 'node:fs'
import path from 'node:path'
import { withLock } from '../../engine/lib/case.js'
import { dataset } from '../../engine/lib/datasets.js'
import { isLocalAddress } from '../../engine/lib/net.js'
import { cleanEnv, spawnUv, uvCommand } from '../../engine/lib/python.js'
import { SENSITIVE_SITE_CATEGORIES } from '../../engine/lib/sensitive.js'
import { safe } from '../../engine/lib/templates.js'

// the list is downloaded: a list above this is refused with a clear message (a real one holds about 700)
export const MAX_SITES = 5000
const sitesIn = d => { const n = Array.isArray(d?.sites) ? d.sites : []; if (n.length > MAX_SITES) throw new Error(`the list holds ${n.length} sites, over the ${MAX_SITES} this engine accepts`); return n }
const WMN = { service: 'raw', path: '/WebBreacher/WhatsMyName/main/wmn-data.json', hours: 168, describe: t => `${sitesIn(JSON.parse(t)).length} sites` }
const PARALLEL = 8, TIMEOUT = 10000, MAX = 2e6, HOPS = 3
const MAIGRET = 'maigret@0.6.6', MAIGRET_MINUTES = 20
const dec = s => { try { return decodeURIComponent(s) } catch { return s } }
// a name WhatsMyName gives (a site, a category) ends up in properties and notes: no line break, no [ ] < > ` \
const tidy = x => String(x).replace(/[\r\n]+/g, ' ').replace(/[[\]<>`\\]/g, '').trim().slice(0, 80)
// the categories of GDPR article 9 (sexual life, health, political opinion) are never queried until the guard of stage 10 exists
export const SPECIAL = new Set(['dating', 'health', 'political'])
export const catOf = c => (c === 'xx NSFW xx' ? 'nsfw' : tidy(c ?? 'misc') || 'misc')

// the username in a username, an @username, or the profile URL that ends with it; null for anything else
export function usernameOf(input) {
  let s = String(input ?? '').trim()
  if (/^https?:\/\//i.test(s)) {
    let u
    try { u = new URL(s) } catch { return null }
    s = u.pathname.split('/').filter(Boolean).map(dec).filter(p => !/^(in|company|user|users|u|profile|people|channel|c|members?)$/i.test(p)).at(-1) ?? ''
  }
  s = s.replace(/^@/, '')
  if (s.length > 64 || /\.(php|html?|aspx?|jsp)$/i.test(s)) return null
  // never an option for Maigret (--ai, -a), nor a path segment (. and ..) that would move the probed URL
  if (s.startsWith('-') || /^\.+$/.test(s)) return null
  return /^[\p{L}\p{N}_.-]+( [\p{L}\p{N}_.-]+)*$/u.test(s) ? s : null
}

// WhatsMyName's data is downloaded, so untrusted: nothing on this machine's networks is ever requested
export const isPublicHost = h => !isLocalAddress(h) && !/\.(lan|home\.arpa)$/i.test(h)
// the site's own headers are a browser's (User-Agent, Accept…): never a host, a cookie or a credential
const SECRET_HEADER = /^(host|cookie|set-cookie|authorization|proxy-authorization|x-.*(key|token|secret|auth|session).*)$/i
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i
// the profile's address: without a trailing slash, and without its query when the username is in the host or the path
export function accountUrl(u, name) {
  const inPath = `${u.hostname}${dec(u.pathname)}`.toLowerCase().includes(name.toLowerCase())
  // the address goes into notes: what markdown reads as an image, a link or a tag is percent-encoded
  return (inPath ? `${u.origin}${u.pathname}` : u.href).replace(/\/+$/, '').replace(/[!()[\]<>`]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}
// one row per account whatever the tool writes: no protocol, no www., no trailing slash, lower case
export const rowKey = url => url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '')

// one site of WhatsMyName for one username: what to request and what to show, or why it is skipped
export function siteOf(s, name) {
  if (['name', 'uri_check', 'e_string', 'm_string', 'cat'].some(k => typeof s?.[k] !== 'string') || !Number.isInteger(s.e_code) || !Number.isInteger(s.m_code)) return { skip: 'malformed entry' }
  if (s.valid === false) return { skip: 'marked broken by WhatsMyName' }
  if (s.post_body) return { skip: 'POST only (this engine only reads with GET)' }
  if ([].concat(s.protection ?? []).includes('user-auth')) return { skip: 'needs a login' }
  const acct = typeof s.strip_bad_char === 'string' ? [...name].filter(c => !s.strip_bad_char.includes(c)).join('') : name
  if (/^https?:\/\/[^/]*\{account\}/i.test(s.uri_check) && !LABEL.test(acct)) return { skip: 'the username cannot be a host name' }
  const fill = u => u.replaceAll('{account}', encodeURIComponent(acct))
  let check, pretty
  try { check = new URL(fill(s.uri_check)); pretty = new URL(fill(typeof s.uri_pretty === 'string' ? s.uri_pretty : s.uri_check)) } catch { return { skip: 'malformed entry' } }
  if (![check, pretty].every(u => /^https?:$/.test(u.protocol))) return { skip: 'malformed entry' }
  if (!isPublicHost(check.hostname)) return { skip: 'not a public host' }
  // the site's own headers (a browser User-Agent, Accept…), never a cookie: no session, no login
  const headers = Object.fromEntries(Object.entries(s.headers && typeof s.headers === 'object' ? s.headers : {})
    .filter(([k, v]) => typeof v === 'string' && !SECRET_HEADER.test(k)).map(([k, v]) => [k.toLowerCase(), v]))
  return { site: tidy(s.name), category: catOf(s.cat), check: check.href, host: check.hostname, url: accountUrl(pretty, acct), e_code: s.e_code, e_string: s.e_string, m_code: s.m_code, m_string: s.m_string, headers }
}

// the sites of the chosen categories (a category this manifest does not know yet goes with misc), those skipped and why
export function sitesFor(data, { name, categories, known }) {
  const want = new Set(categories), cats = new Set(known), run = [], skipped = []
  let outside = 0
  for (const s of Array.isArray(data?.sites) ? data.sites : []) {
    const cat = catOf(s?.cat)
    if (SPECIAL.has(cat)) { skipped.push({ site: tidy(s?.name ?? '?'), category: cat, reason: 'special category (GDPR article 9): not queried' }); continue }
    if (!want.has(cats.has(cat) ? cat : 'misc')) { outside++; continue }
    const x = siteOf(s, name)
    if (x.skip) skipped.push({ site: tidy(s?.name ?? '?'), category: cat, reason: x.skip })
    else run.push(x)
  }
  return { run, skipped, outside }
}

// found by e_code and e_string, absent by m_code and m_string; neither, or both at once, is unknown
export function verdict(site, { status, body }) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body ?? '')
  const e = status === site.e_code && text.includes(site.e_string), m = status === site.m_code && text.includes(site.m_string)
  return e && !m ? 'found' : m && !e ? 'absent' : 'unknown'
}

// at most n hosts at once, the sites of one host one after the other
export async function pool(sites, n, fn) {
  const groups = [...Map.groupBy(sites, s => s.host).values()]
  let next = 0
  const worker = async () => { while (next < groups.length) for (const s of groups[next++]) await fn(s) }
  await Promise.all(Array.from({ length: Math.min(n, groups.length) }, worker))
}

async function probe(ctx, s) {
  const opts = { headers: s.headers, timeout: TIMEOUT, max: MAX, follow: false, quiet: true }
  let url = s.check
  try {
    let r = await ctx.fetch('web', url, opts), state = verdict(s, r)
    // a redirect that is neither answer: followed one hop at a time, each to a public host (a site may say « missing »
    // with a 302, or show the profile after a 301 to its canonical address)
    for (let hop = 0; state === 'unknown' && hop < HOPS && r.status >= 300 && r.status < 400 && r.headers.location; hop++) {
      const next = new URL(r.headers.location, url)
      if (!/^https?:$/.test(next.protocol) || !isPublicHost(next.hostname)) return { state: 'unknown', status: r.status, reason: `redirects to ${next.hostname || next.protocol}` }
      url = next.href
      r = await ctx.fetch('web', url, opts)
      state = verdict(s, r)
    }
    return { state, status: r.status, ...(state === 'unknown' && { reason: `HTTP ${r.status}${r.truncated ? ', page cut at 2 MB' : ''}` }) }
  } catch (e) {
    // a timeout, a refused host (net.js), a broken redirect: this site stays unknown, the others go on
    return { state: 'unknown', status: null, reason: e.message }
  }
}

async function whatsmyname(ctx, name) {
  const ds = await dataset(ctx.home, 'wmn', WMN).catch(e => ctx.refuse(`WhatsMyName data: ${e.message}`))
  ctx.log(`dataset wmn: ${ds.stale ? `download failed (${safe(ds.error)}), the copy of ${ds.at.slice(0, 10)} is used` : ds.cached ? `the copy of ${ds.at.slice(0, 10)}` : `downloaded ${ds.url}`} · ${ds.size} bytes · sha256 ${ds.sha256.slice(0, 12)}`)
  const known = ctx.manifest.inputs.find(i => i.id === 'categories').options.map(o => o.value)
  // a person case and its children never look at dating, health, political or adult sites (GDPR article 9)
  const asked = [].concat(ctx.input.categories ?? known.filter(c => c !== 'nsfw' && !SPECIAL.has(c)))
  const categories = ctx.guarded ? asked.filter(c => !SENSITIVE_SITE_CATEGORIES.has(c)) : asked
  if (categories.length < asked.length) ctx.log(`whatsmyname: skipped the ${asked.filter(c => !categories.includes(c)).join(', ')} categories — a person case never looks there (GDPR article 9)`)
  const data = JSON.parse(ds.text)
  try { sitesIn(data) } catch (e) { ctx.refuse(`WhatsMyName data: ${e.message}`) }
  const { run, skipped, outside } = sitesFor(data, { name, categories, known })
  const checked = []
  let done = 0
  await pool(run, PARALLEL, async s => {
    const r = await probe(ctx, s)
    checked.push({ site: s.site, category: s.category, url: s.url, check: s.check, ...r }) // no timing in what is kept: a Refresh without change writes the same bytes
    done++
    if (r.state === 'found' || done % 25 === 0 || done === run.length) ctx.progress(done, run.length, r.state === 'found' ? `found on ${s.site}` : `${done} of ${run.length} sites`)
  })
  checked.sort((a, b) => a.site.localeCompare(b.site))
  const src = await ctx.source({ url: `whatsmyname:${name}`, title: ctx.t('wmn_source', { name }), reliability: 'C', contentType: 'application/json',
    body: JSON.stringify({ username: name, data: { url: ds.url, sha256: ds.sha256 }, categories, checked, skipped, outside }, null, 2) })
  const n = st => checked.filter(c => c.state === st).length, found = checked.filter(c => c.state === 'found')
  ctx.log(`whatsmyname: ${run.length} sites checked — ${n('found')} found, ${n('unknown')} unknown, ${n('absent')} absent; ${skipped.length} skipped, ${outside} outside the chosen categories${found.length ? ` (found: ${found.map(f => safe(f.site)).join(', ')})` : ''} · ${src.id}`)
  return { src, rows: checked.filter(c => c.state !== 'absent').map(c => ({ key: rowKey(c.url), site: c.site, category: c.category, state: c.state, url: c.url })) }
}

// the Accounts table, by account: each tool's answer in `by`, the row found when one tool found it
export function mergeRows(prev, next, via) {
  const out = new Map(prev.map(r => [r.key, { ...r, by: { ...r.by } }]))
  for (const r of out.values()) delete r.by[via]
  for (const r of next) {
    const have = out.get(r.key)
    if (!have) out.set(r.key, { ...r, by: { [via]: r.state } })
    else have.by[via] = have.by[via] === 'found' ? 'found' : r.state
  }
  return [...out.values()].filter(r => Object.keys(r.by).length).map(({ via: _, ...r }) => ({
    ...r, state: Object.values(r.by).includes('found') ? 'found' : 'unknown', via: Object.keys(r.by).sort(),
  })).sort((a, b) => (a.state === b.state ? a.site.localeCompare(b.site) : a.state === 'found' ? -1 : 1))
}

export function maigretRows(report, name) {
  return Object.entries(report && typeof report === 'object' ? report : {}).flatMap(([site, r]) => {
    const link = r?.url_user || r?.status?.url
    if (r?.status?.status !== 'Claimed' || typeof link !== 'string' || !/^https?:\/\//i.test(link)) return []
    let u
    try { u = new URL(link) } catch { return [] }
    const url = accountUrl(u, name), tags = [].concat(r.status.tags ?? r.site?.tags ?? []).filter(t => typeof t === 'string' && t.length > 2)
    return [{ key: rowKey(url), site: tidy(site), category: tidy(tags.join(', ')) || 'misc', state: 'found', url }]
  })
}
async function maigret(ctx, name) {
  const out = path.join(ctx.dir, '.osint', 'cache', 'maigret')
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  const nsfw = [].concat(ctx.input.categories ?? []).includes('nsfw')
  // pinned; no recursion into the other usernames it reads, no parsing of the pages (only what the purpose needs), never --ai
  const args = ['tool', 'run', '--python', '3.12', MAIGRET, '--json', 'simple', '--folderoutput', out, '--no-recursion', '--no-extracting',
    '--no-progressbar', '--no-color', '--timeout', String(TIMEOUT / 1000), '--max-connections', String(PARALLEL), ...(nsfw ? [] : ['--exclude-tags', 'porn']), '--', name]
  ctx.log(`maigret: uv ${args.join(' ')}`)
  ctx.progress(0, 1, 'maigret: its top 500 sites, a few minutes')
  const r = await spawnUv(args, { cwd: out, env: cleanEnv(process.env), timeout: MAIGRET_MINUTES * 60e3 })
  ctx.progress(1, 1, 'maigret: done')
  const file = fs.readdirSync(out).find(f => f.endsWith('_simple.json'))
  if (!file) throw new Error(`maigret exited with code ${r.code} and wrote no JSON report${r.err.trim() ? `: ${r.err.trim().split('\n').at(-1)}` : ''}`)
  const text = fs.readFileSync(path.join(out, file), 'utf8')
  const src = await ctx.source({ url: `maigret:${name}`, body: text, contentType: 'application/json', title: ctx.t('maigret_source', { name }), reliability: 'C' })
  return { src, rows: maigretRows(JSON.parse(text), name) }
}
// null: uv is missing; false: Maigret failed (noted); else its source and rows
async function maigretStep(ctx, name) {
  if (!uvCommand()) { ctx.fail('maigret: uv is missing (osint.mjs setup uv)'); return null }
  try { return await maigret(ctx, name) } catch (e) { if (e.userError) throw e; ctx.fail(`maigret: ${safe(e.message)}`); return false }
}

// the accounts a tool found: entities tied to the username, one Journal entry each, one clue (candidates, not identities)
function record(ctx, name, src, rows, via) {
  ctx.entity('username', name, { sources: [src.id], props: { role: 'subject' } })
  const found = rows.filter(r => r.by[via] === 'found')
  for (const r of found) {
    ctx.entity('account', r.url, { sources: [src.id], props: { site: r.site, category: r.category, state: 'found', via: r.via, username: name } })
    ctx.relate(['username', name], ['account', r.url], 'candidate account', src.id)
    ctx.log(`${via} found ${safe(r.site)}: ${r.url}`)
  }
  const text = found.length ? ctx.t(`${via}_found`, { n: found.length, name, sites: found.map(r => r.site).join(', ') }) : ctx.t(`${via}_none`, { name })
  ctx.clue(text, { status: 'inferred', sources: [src.id], title: found.length ? ctx.t(`${via}_found_title`, { n: found.length, name }) : text })
  return found
}

const rowsOf = ctx => { try { return JSON.parse(fs.readFileSync(path.join(ctx.dir, '.osint', 'views', 'accounts.json'), 'utf8')) } catch { return [] } }
function save(ctx, rows) {
  ctx.view('accounts', rows)
  // the absent are not kept: an account gone absent is « removed », one gone unknown (a bot wall) is « changed »
  ctx.snapshot('accounts', rows.map(r => ({ key: r.key, site: r.site, state: r.state })))
}
// the merge of a tool's rows into the table, its entities and its view, under the case's lock: two commands at once
// (a refresh and the agent's check) never overwrite each other's rows
function commit(ctx, name, { src, rows: found, via }) {
  withLock(ctx.dir, () => {
    const rows = mergeRows(rowsOf(ctx), found, via)
    record(ctx, name, src, rows, via)
    save(ctx, rows)
  })
}
function nameOf(ctx) {
  const name = usernameOf(ctx.input.username)
  if (!name) ctx.refuse(`not a username: ${ctx.input.username} (letters, digits, . _ - and inner spaces, 64 at most, or a profile URL that ends with it)`)
  return name
}

export const commands = {
  check: {
    help: 'WhatsMyName: GET only, 8 sites at once, one per host, 10 s each; then Maigret when the case asks for it',
    flags: {},
    async run(ctx) {
      const name = nameOf(ctx)
      commit(ctx, name, { ...(await whatsmyname(ctx, name)), via: 'whatsmyname' })
      if (!ctx.input.maigret) return
      const m = await maigretStep(ctx, name)
      if (m) commit(ctx, name, { ...m, via: 'maigret' })
      else if (m === null) ctx.refuse('uv is missing: the Maigret option was skipped, WhatsMyName ran (osint.mjs setup uv)', 3)
    },
  },
  maigret: {
    help: 'Maigret 0.6.6 on its top 500 sites (uv), its finds merged into the Accounts table',
    flags: {},
    async run(ctx) {
      const name = nameOf(ctx), m = await maigretStep(ctx, name)
      if (m === null) ctx.refuse('uv is missing: Maigret cannot run (osint.mjs setup uv); username check works without it', 3)
      if (m === false) ctx.refuse('maigret failed (see the Journal); username check works without it')
      commit(ctx, name, { ...m, via: 'maigret' })
    },
  },
}
