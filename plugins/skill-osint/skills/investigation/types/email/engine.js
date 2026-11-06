// The email type: an address, from free and passive sources only. address: its parts, Gmail's equivalent addresses,
// a role or webmail address; disposable: the disposable-email-domains list; mail: the domain's MX, SPF and DMARC read
// by the resolver, and the provider they name; gravatar: the public profile found by the SHA-256 of the address;
// breaches: the names of the breaches XposedOrNot knows, within its limits. account-probe (Holehe) is noisy: the user's
// yes each time, never a password reset. No step ever talks to the address's mail server: asking it RCPT TO about an
// address contacts the target.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { withLock } from '../../engine/lib/case.js'
import { dataset } from '../../engine/lib/datasets.js'
import { mailProvider, parseAddress } from '../../engine/lib/mail.js'
import { quota } from '../../engine/lib/net.js'
import { cleanEnv, spawnUv, uvCommand } from '../../engine/lib/python.js'
import { INSTALL } from '../../engine/lib/util.js'

export const STEPS = ['address', 'disposable', 'mail', 'gravatar', 'breaches']
const joined = v => [].concat(v).join('')
// a name a third party gives (a service label) ends up in properties and notes: no line break, no [ ] < > ` \
const tidy = x => String(x ?? '').replace(/[\r\n]+/g, ' ').replace(/[[\]<>`\\]/g, '').trim().slice(0, 80)
// an address a service gives: http(s) only, what markdown reads as an image, a link or a tag percent-encoded
const httpUrl = u => { try { const x = new URL(String(u).trim()); return /^https?:$/.test(x.protocol) ? x.href.replace(/[!()[\]<>`]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`) : null } catch { return null } }
// a step whose snapshot did not change writes no clue again (a refresh of an unchanged address adds nothing)
const unchanged = d => !d.first && !d.added.length && !d.removed.length && !d.changed.length

function address(ctx, a) {
  ctx.entity('email', a.address, { props: { role: 'subject', local: a.local, domain: a.domain }, ...(a.aliases.length && { aliases: a.aliases }) })
  const E = { entities: [a.address] }
  if (a.gmail) ctx.clue(ctx.t('gmail_aliases', { aliases: a.aliases.join(', ') }), { status: 'computed', ...E })
  if (a.webmail) ctx.clue(ctx.t('webmail', { d: a.domain }), { status: 'inferred', ...E })
  if (a.role) return void ctx.clue(ctx.t('role_address', { local: a.user }), { status: 'inferred', ...E })
  ctx.entity('username', a.user, { confidence: 'low', props: { role: 'local part of an address' } })
  ctx.relate(['email', a.address], ['username', a.user], 'local part')
}

// the list, kept 7 days for the whole folder (declared in type.json's requires.datasets); describe() says what it holds on
// doctor's line and refuses a download that is not a list of domains (an error page): the copy stays
const domainsOf = text => text.split('\n').map(l => l.trim().toLowerCase()).filter(l => l && !l.startsWith('#'))
const LIST = {
  service: 'raw', path: '/disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf', hours: 24 * 7,
  describe: text => {
    const d = domainsOf(text)
    if (!d.length || d.some(l => !/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(l))) throw new Error('not a list of domains')
    return `${d.length.toLocaleString('en')} domains`
  },
}
async function disposable(ctx, a) {
  const ds = await dataset(ctx.home, 'disposable-domains', LIST)
  const list = new Set(domainsOf(ds.text))
  const parts = a.domain.split('.'), hit = parts.slice(0, -1).map((_, i) => parts.slice(i).join('.')).find(d => list.has(d)) ?? null
  ctx.state({ disposable: hit })
  const src = await ctx.source({ url: `https://raw.githubusercontent.com${LIST.path}`, body: JSON.stringify({ domain: a.domain, listed: hit }, null, 2) /* no list date nor size: they change weekly without the answer changing */, contentType: 'application/json', title: ctx.t('disposable_list'), reliability: 'B' })
  if (unchanged(ctx.snapshot('disposable', [{ key: a.domain, listed: hit }]))) return
  ctx.clue(hit ? ctx.t('disposable', { d: hit }) : ctx.t('not_disposable', { d: a.domain, n: list.size.toLocaleString('en') }), { status: 'read', sources: [src.id] })
}

async function mail(ctx, a) {
  const r = ctx.resolver(), d = a.domain
  const mx = (await r.resolve(d, 'MX')).map(m => ({ priority: m.priority, exchange: String(m.exchange ?? '').replace(/\.$/, '').toLowerCase() })).sort((x, y) => x.priority - y.priority)
  const spf = (await r.resolve(d, 'TXT')).map(joined).filter(t => /^v=spf1\b/i.test(t))
  const dmarc = (await r.resolve(`_dmarc.${d}`, 'TXT')).map(joined).filter(t => /^v=DMARC1\b/i.test(t))
  const rows = [...mx.map(m => ({ type: 'MX', name: d, value: `${m.priority} ${m.exchange || '.'}` })), ...spf.map(value => ({ type: 'SPF', name: d, value })), ...dmarc.map(value => ({ type: 'DMARC', name: `_dmarc.${d}`, value }))]
  const includes = spf.flatMap(t => [...t.matchAll(/\binclude:(\S+)/gi)].map(m => m[1].toLowerCase()))
  const viaMx = mx.find(m => mailProvider([m.exchange])), viaSpf = includes.find(h => mailProvider([h]))
  const provider = viaMx ? mailProvider([viaMx.exchange]) : viaSpf ? mailProvider([viaSpf]) : null
  const src = await ctx.source({ url: `dns:${d}`, body: JSON.stringify(rows, null, 2), contentType: 'application/json', title: ctx.t('mail_dns', { d }), reliability: 'A' })
  ctx.entity('email', a.address, { sources: [src.id] })
  // the address's own domain, to pivot to: never a public webmail nor a disposable domain
  if (!a.webmail && !ctx.state().disposable) {
    ctx.entity('domain', d, { sources: [src.id], props: { role: 'email domain', mail_provider: provider } })
    ctx.relate(['email', a.address], ['domain', d], 'address on', src.id)
  }
  ctx.view('mail-dns', rows)
  if (unchanged(ctx.snapshot('mail', rows.map(x => ({ key: `${x.type}:${x.value}`, ...x }))))) return
  const S = { status: 'read', sources: [src.id] }
  if (mx.length === 1 && !mx[0].exchange) ctx.clue(ctx.t('null_mx', { d }), S)
  else if (!mx.length) ctx.clue(ctx.t('no_mx', { d }), S)
  if (provider && !a.webmail) ctx.clue(ctx.t('provider', { provider, by: viaMx ? `MX ${viaMx.exchange}` : `SPF include:${viaSpf}` }), S)
  if (includes.length) ctx.clue(ctx.t('spf', { d, includes: includes.join(', ') }), S)
  else if (spf.some(t => /^v=spf1\s+-all$/i.test(t.trim()))) ctx.clue(ctx.t('spf_none', { d }), S)
  const policy = /\bp=(\w+)/i.exec(dmarc[0] ?? '')?.[1]?.toLowerCase()
  if (policy) ctx.clue(ctx.t('dmarc', { d, policy }), S)
}

// views/accounts.json holds the accounts of two steps (gravatar, holehe): each rewrites its own rows, under the case's
// lock (a refresh and the agent's account-probe at once never overwrite each other)
function accountsView(ctx, by, rows) {
  withLock(ctx.dir, () => {
    const f = path.join(ctx.dir, '.osint', 'views', 'accounts.json')
    const kept = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')).filter(r => r.by !== by) : []
    ctx.view('accounts', [...kept, ...rows])
  })
}
const sniff = b => (b[0] === 0x89 && b[1] === 0x50 ? '.png' : b[0] === 0xff && b[1] === 0xd8 ? '.jpg'
  : b.subarray(0, 3).toString() === 'GIF' ? '.gif' : b.subarray(8, 12).toString() === 'WEBP' ? '.webp' : null)
// the avatar, kept as evidence once (again only when the picture changes); d=404: Gravatar's default image is no avatar.
// Only a Gravatar host is fetched: a profile is third-party text and must not point the engine at another server.
async function avatar(ctx, a, url, srcId) {
  if (!/(^|\.)gravatar\.com$/.test(new URL(url).hostname)) return null
  const r = await ctx.fetch('web', `${url.replace(/[?#].*$/, '')}?s=512&d=404`, { max: 5e6 })
  const ext = r.status === 200 ? sniff(r.body) : null
  if (!ext) return null
  const sha = createHash('sha256').update(r.body).digest('hex')
  if (ctx.state().avatar_sha256 !== sha) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-avatar-')), f = path.join(tmp, `gravatar-${sha.slice(0, 12)}${ext}`)
    fs.writeFileSync(f, r.body)
    try { const e = await ctx.evidence(f); ctx.state({ avatar_sha256: sha, avatar_file: path.posix.basename(e.file) }) } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
  }
  const file = ctx.state().avatar_file
  ctx.entity('image', url, { sources: [srcId], props: { site: 'gravatar.com', file: `[[${file}]]`, sha256: sha } })
  ctx.relate(['email', a.address], ['image', url], 'Gravatar avatar', srcId)
  return { sha, file }
}
// the public profile, found by the SHA-256 of the address trimmed and lowercased (the address itself never leaves); only
// what says who uses it becomes a clue (name, place, job, company, verified accounts, avatar, last edit); the bio and the
// rest stay in the capture
const FACTS = [['display_name', 'gravatar_name'], ['location', 'gravatar_location'], ['job_title', 'gravatar_job'], ['company', 'gravatar_company']]
async function gravatar(ctx, a) {
  const hash = createHash('sha256').update(a.address).digest('hex')
  const r = await ctx.fetch('gravatar', `/v3/profiles/${hash}`, { accept: 'application/json' })
  if (r.status === 429) throw new Error('Gravatar answered 429: about 100 profiles an hour without a key, try again later')
  if (r.status >= 400 && r.status !== 404) throw new Error(`Gravatar answered ${r.status}`)
  const src = await ctx.source({ url: `https://api.gravatar.com/v3/profiles/${hash}`, body: r.body, contentType: 'application/json', title: ctx.t('gravatar_profile', { address: a.address }), reliability: 'B' })
  const S = { status: 'read', sources: [src.id] }
  if (r.status === 404) { accountsView(ctx, 'gravatar', []); if (!unchanged(ctx.snapshot('gravatar', []))) ctx.clue(ctx.t('no_gravatar'), S); return }
  const p = JSON.parse(r.body.toString('utf8')), profile = httpUrl(p.profile_url)
  const accounts = (p.verified_accounts ?? []).filter(v => httpUrl(v?.url) && !v.is_hidden).map(v => ({ ...v, url: httpUrl(v.url) }))
  const label = v => tidy(v.service_label ?? v.service_type) || 'account'
  ctx.entity('email', a.address, { sources: [src.id], props: { gravatar: profile } })
  const rows = []
  if (profile) {
    ctx.entity('account', profile, { sources: [src.id], props: { site: 'gravatar.com' } })
    ctx.relate(['email', a.address], ['account', profile], 'Gravatar profile', src.id)
    rows.push({ site: 'Gravatar', state: 'profile', url: profile, source: src.id, by: 'gravatar' })
  }
  for (const v of accounts) {
    ctx.entity('account', v.url, { sources: [src.id], props: { site: label(v), verified: 'Gravatar' } })
    ctx.relate(['email', a.address], ['account', v.url], 'verified on Gravatar', src.id)
    rows.push({ site: label(v), state: 'verified by Gravatar', url: v.url, source: src.id, by: 'gravatar' })
  }
  accountsView(ctx, 'gravatar', rows)
  const avatarUrl = httpUrl(p.avatar_url), pic = avatarUrl ? await avatar(ctx, a, avatarUrl, src.id) : null
  const facts = FACTS.map(([k, l]) => [k, l, tidy(p[k])])
  const d = ctx.snapshot('gravatar', [{ key: hash, ...Object.fromEntries(facts.map(([k, , v]) => [k, v || null])), accounts: accounts.map(v => v.url).sort(), avatar: pic?.sha ?? null, edited: p.last_profile_edit ?? null }])
  // a first profile says everything; a refresh says only the fields that changed (nothing when none did)
  const changed = d.first || d.added.length ? null : new Set(d.changed.flatMap(c => c.fields)), say = k => !changed || changed.has(k)
  for (const [k, l, value] of facts) if (value && say(k)) ctx.clue(ctx.t(l, { value }), S)
  if (accounts.length && say('accounts')) ctx.clue(ctx.t('gravatar_accounts', { list: accounts.map(v => `${label(v)} ${v.url}`).join(', ') }), S)
  if (pic && say('avatar')) ctx.clue(ctx.t('gravatar_avatar'), { ...S, where: pic.file })
  if (p.last_profile_edit && say('edited')) ctx.clue(ctx.t('gravatar_edited', { date: String(p.last_profile_edit).slice(0, 10) }), S)
}

// the breaches XposedOrNot knows, by their names only; its limits (25 an hour, 100 a day) are counted for the whole
// cases folder before the call leaves. XposedOrNot takes the address itself in its URL (no hash): the Journal says that a
// call was made, not which address.
const few = xs => `${xs.slice(0, 10).join(', ')}${xs.length > 10 ? `, +${xs.length - 10}` : ''}`
async function breaches(ctx, a) {
  const q = quota(ctx.home, 'xon')
  if (!q.ok) throw new Error(`XposedOrNot allows ${q.limit}: the next call after ${q.next}`)
  const r = await ctx.fetch('xon', `/v1/check-email/${encodeURIComponent(a.address).replace('%40', '@')}`, { accept: 'application/json', quiet: true })
  ctx.log(`XposedOrNot check-email → ${r.status} (${q.left.hour} calls left this hour, ${q.left.day} today)`)
  if (r.status === 429) throw new Error('XposedOrNot answered 429 (2 calls a second, 25 an hour, 100 a day): try again later')
  if (r.status !== 200 && r.status !== 404) throw new Error(`XposedOrNot answered ${r.status}`)
  // a known address: 200 { breaches: [[names]] }; an unknown one: 200 { Error: 'Not found' } (a 404 is read the same)
  const j = r.status === 200 ? JSON.parse(r.body.toString('utf8') || '{}') : {}
  const names = [...new Set((j.breaches ?? []).flat().map(tidy).filter(Boolean))].sort((x, y) => x.localeCompare(y, 'en'))
  const src = await ctx.source({ url: `https://api.xposedornot.com/v1/check-email/${a.address}`, body: r.body, contentType: 'application/json', title: ctx.t('breaches_source', { address: a.address }), reliability: 'C' })
  ctx.view('breaches', names.map(name => ({ name, source: src.id })))
  if (unchanged(ctx.snapshot('breaches', names.map(name => ({ key: name }))))) return
  ctx.clue(names.length ? ctx.t('breaches', { n: names.length, names: few(names) }) : ctx.t('no_breach'), { status: 'read', sources: [src.id] })
}

// Holehe, run by uv after the user's yes: always -NP (no password reset, which would email the target); never -C (its
// CSV export crashes as soon as one site fails, holehe issue #330, while the printed list is always complete);
// @latest (holehe compares itself with PyPI at start, and runs pip3 outside uv when they differ)
export const holeheArgs = address => ['tool', 'run', 'holehe@latest', '-NP', '--no-color', '--no-clear', address]
const STATE = { '+': 'registered', '-': 'not registered', x: 'rate limited', '!': 'error' }
// one line per site, « [+] docker.com », then what the site showed (masked hints, a name), left in the capture only;
// the legend « [+] Email used, … » names no domain
export const readHolehe = out => [...String(out).matchAll(/^\[([+\-x!])\] ([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?=\s|$)/gim)].map(m => ({ site: m[2].toLowerCase(), state: STATE[m[1].toLowerCase()] }))
async function accountProbe(ctx, args, flags) {
  const a = parseAddress(ctx.input.email)
  if (!a) ctx.refuse(`not an email address: ${ctx.input.email}`)
  // the frame decides first, then the tool, then the user's yes: nothing here runs on a default
  if (ctx.noisy !== 'ask') ctx.refuse(`account-probe is a noisy action and this case says noisy: ${ctx.noisy ?? 'unset'}: it does not run here`)
  if (!uvCommand()) ctx.refuse(`uv is missing (${INSTALL.uv}): account-probe runs Holehe by uv, never bundled — osint.mjs setup uv`, 3)
  if (flags.yes !== true) ctx.refuse(`account-probe is noisy: Holehe asks the sign-up or login form of about 120 sites whether ${a.address} has an account there. The sites see these queries; the target gets no email (-NP: never a password reset). Holehe is unmaintained since 2024: its hits are inferred clues. The user's yes for this run only, then: email account-probe --yes`, 2)
  // the subject's entity, for the clues to name it (account-probe may run before collect)
  ctx.entity('email', a.address, { props: { role: 'subject', local: a.local, domain: a.domain } })
  const work = path.join(ctx.dir, '.osint', 'cache', 'holehe')
  fs.rmSync(work, { recursive: true, force: true })
  fs.mkdirSync(work, { recursive: true })
  ctx.log(`account-probe after the user's yes: uv ${holeheArgs(a.address).join(' ')}`)
  ctx.progress(0, 1, 'holehe')
  // uv (or the tests' fake) with an environment that carries no key at all (cleanEnv); holehe waits 10 s a site at most
  const r = await spawnUv(holeheArgs(a.address), { cwd: work, env: cleanEnv(process.env), timeout: 10 * 60e3 })
  const rows = readHolehe(r.out)
  if (!rows.length) {
    ctx.fail(`holehe printed no result (exit ${r.code}): ${r.err.trim().split('\n').slice(-3).join(' ').slice(0, 300)}`)
    ctx.refuse('holehe printed no result: see the Journal')
  }
  const src = await ctx.source({ url: `holehe:${a.address}`, body: r.out, contentType: 'text/plain', title: ctx.t('holehe_source', { address: a.address }), reliability: 'D' })
  const n = s => rows.filter(x => x.state === s).length
  accountsView(ctx, 'holehe', rows.filter(x => x.state === 'registered' || x.state === 'rate limited').map(x => ({ site: x.site, state: x.state, url: null, source: src.id, by: 'holehe' })))
  const d = ctx.snapshot('accounts', rows.map(x => ({ key: x.site, state: x.state })))
  const fresh = new Set([...d.added, ...d.changed].map(x => x.key))
  for (const x of rows.filter(x => x.state === 'registered' && (d.first || fresh.has(x.site)))) ctx.clue(ctx.t('holehe_hit', { site: x.site }), { status: 'inferred', sources: [src.id], entities: [a.address] })
  ctx.log(`holehe: ${rows.length} sites — ${n('registered')} registered, ${n('rate limited')} rate limited, ${n('error')} failed`)
  ctx.progress(1, 1, 'holehe')
}

const STEP = { address, disposable, mail, gravatar, breaches }
export const commands = {
  collect: {
    help: `${STEPS.join(', ')}; --only a,b`,
    flags: { only: 'string' },
    async run(ctx, args, flags) {
      const a = parseAddress(ctx.input.email)
      if (!a) ctx.refuse(`not an email address: ${ctx.input.email}`)
      const want = flags.only ? flags.only.split(',').map(s => s.trim()) : STEPS
      const bad = want.filter(s => !STEPS.includes(s))
      if (bad.length) ctx.refuse(`--only ${STEPS.join(',')} (not ${bad.join(', ')})`)
      let n = 0
      for (const s of STEPS.filter(x => want.includes(x))) {
        ctx.progress(++n, want.length, s)
        try { await STEP[s](ctx, a) } catch (e) { if (e.userError) throw e; ctx.fail(`${s}: ${e.message}`) }
      }
    },
  },
  'account-probe': {
    help: 'noisy: Holehe asks the sign-up forms of about 120 sites (-NP, never a password reset); the user\'s yes, then --yes',
    flags: { yes: 'boolean' },
    run: accountProbe,
  },
}
