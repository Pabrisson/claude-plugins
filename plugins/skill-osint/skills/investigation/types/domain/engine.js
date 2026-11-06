// The domain type: a domain or a website, from free sources without a key. Each step records what it read as a
// source (captured and hashed), entities, clues and relations, adds its dates to the timeline and takes a snapshot that
// refresh compares. A step that fails is noted and the next one runs.
import { domainToASCII } from 'node:url'
import { asHolder, internetDb, networkInfo, vcardName as fn } from '../../engine/lib/ipinfo.js'
import { mailProvider } from '../../engine/lib/mail.js'
import { fail } from '../../engine/lib/util.js'

const STEPS = ['rdap', 'dns', 'crt', 'wayback', 'host', 'home'], QUICK = ['rdap', 'dns', 'home']
const NOISY = ['home'] // reads the site itself: the case's noisy frame decides
const MAX_SUB = 300
const HOST = /^(?=.{1,253}$)(?![\d.]+$)([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
// a domain, a URL or an email address (a pivot from an email entity: its domain); anything else is refused
export const domainOf = input => {
  let s = String(input).trim().toLowerCase().replace(/^mailto:/, '')
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) { try { s = new URL(s).hostname } catch { /* refused below */ } }
  else s = s.split(/[/?#]/)[0].replace(/^.*@/, '')
  s = domainToASCII(s.replace(/^www\./, '').replace(/\.$/, ''))
  if (!HOST.test(s)) fail(`not a domain name: ${input}`)
  return s
}
const day = x => (x ? String(x).slice(0, 10) : null)
const body = r => r.body.toString('utf8')

async function rdap(ctx, d) {
  const r = await ctx.fetch('rdap', `/domain/${d}`, { accept: 'application/rdap+json', retries: 1 })
  // the source keeps the query's public address (rdap.org redirects to the registry's server)
  // « last update of RDAP database » changes at every query: out of what is captured and hashed, or each read would be a new source
  let raw = r.body
  if (r.status < 400) try { const j = JSON.parse(body(r)); j.events = (j.events ?? []).filter(e => e.eventAction !== 'last update of RDAP database'); raw = JSON.stringify(j, null, 2) } catch {}
  const src = await ctx.source({ url: `https://rdap.org/domain/${d}`, body: raw, contentType: 'application/json', title: `RDAP ${d}`, reliability: 'A' })
  if (r.status === 404) { ctx.clue(ctx.t('no_rdap', { d }), { status: 'read', sources: [src.id] }); ctx.snapshot('rdap', []); return }
  if (r.status >= 400) throw new Error(`RDAP answered ${r.status}`)
  const j = JSON.parse(body(r)), ev = Object.fromEntries((j.events ?? []).map(e => [e.eventAction, e.eventDate]))
  const registrar = fn((j.entities ?? []).find(e => e.roles?.includes('registrar')))
  const ns = (j.nameservers ?? []).map(x => String(x.ldhName ?? '').toLowerCase()).filter(Boolean).sort()
  ctx.entity('domain', d, { sources: [src.id], props: { role: 'subject', registered: day(ev.registration), expires: day(ev.expiration), rdap_status: (j.status ?? []).join(', ') || null } })
  if (registrar) {
    ctx.entity('organization', registrar, { sources: [src.id], props: { role: 'registrar' } })
    ctx.relate(['domain', d], ['organization', registrar], 'registrar', src.id)
    ctx.clue(ctx.t('registrar', { name: registrar }), { status: 'read', sources: [src.id] })
  }
  for (const n of ns) { ctx.entity('domain', n, { sources: [src.id], props: { role: 'nameserver' } }); ctx.relate(['domain', d], ['domain', n], 'nameserver', src.id) }
  if (ev.registration) ctx.clue(ctx.t('registered', { date: day(ev.registration) }), { status: 'read', sources: [src.id] })
  ctx.timeline([['registration', 'registered_on'], ['expiration', 'expires_on'], ['last changed', 'rdap_changed']].filter(([k]) => ev[k]).map(([k, l]) => ({ date: ev[k], label: ctx.t(l), ref: src.id, kind: 'rdap' })))
  ctx.snapshot('rdap', [{ key: d, registrar, expires: day(ev.expiration), status: [...(j.status ?? [])].sort(), nameservers: ns }])
}

const RR = ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME', 'SOA', 'CAA']
const asText = (t, v) => (t === 'MX' ? `${v.priority} ${String(v.exchange).replace(/\.$/, '')}` : t === 'TXT' ? [].concat(v).join('')
  : t === 'SOA' ? `${v.nsname} ${v.hostmaster} ${v.serial}` : t === 'CAA' ? Object.entries(v).filter(([k]) => k !== 'critical').map(([k, x]) => `${k} ${x}`).join(' ') : String(v).replace(/\.$/, ''))
const VERIFY = /^(google-site-verification|MS|facebook-domain-verification|apple-domain-verification|atlassian-domain-verification|docusign|stripe-verification|adobe-idp-site-verification|yandex-verification|zoom-domain-verification)=/i
async function dnsStep(ctx, d) {
  const r = ctx.resolver(), rec = {}
  for (const t of RR) rec[t] = (await r.resolve(d, t)).map(v => asText(t, v)).sort() // the resolver's order changes between answers
  const src = await ctx.source({ url: `dns:${d}`, body: JSON.stringify(rec, null, 2), contentType: 'application/json', title: `DNS ${d}`, reliability: 'A' })
  ctx.entity('domain', d, { sources: [src.id] })
  for (const ip of [...rec.A, ...rec.AAAA]) { ctx.entity('ip', ip, { sources: [src.id] }); ctx.relate(['domain', d], ['ip', ip], 'resolves to', src.id) }
  for (const mx of rec.MX.filter(m => m.split(' ')[1])) { const h = mx.split(' ')[1]; ctx.entity('domain', h, { sources: [src.id], props: { role: 'mail' } }); ctx.relate(['domain', d], ['domain', h], 'mail', src.id) }
  const provider = mailProvider(rec.MX.map(m => m.split(' ')[1]).filter(Boolean))
  if (provider) ctx.clue(ctx.t('mail_by', { provider, mx: rec.MX.find(m => m.split(' ')[1]).split(' ')[1] }), { status: 'read', sources: [src.id] })
  for (const txt of rec.TXT) {
    const inc = /^v=spf1/i.test(txt) ? [...txt.matchAll(/include:(\S+)/g)].map(m => m[1]) : []
    if (inc.length) ctx.clue(ctx.t('spf', { includes: inc.join(', ') }), { status: 'read', sources: [src.id] })
    if (VERIFY.test(txt)) { ctx.entity('tracker', txt, { sources: [src.id], props: { service: txt.split('=')[0] } }); ctx.relate(['domain', d], ['tracker', txt], 'verification', src.id) }
  }
  const rows = Object.entries(rec).flatMap(([type, vs]) => vs.map(value => ({ type, value })))
  ctx.view('dns', rows)
  ctx.snapshot('dns', rows.map(x => ({ key: `${x.type}:${x.value}`, ...x })))
}

async function crt(ctx, d) {
  const r = await ctx.fetch('crtsh', `/?q=${encodeURIComponent(`%.${d}`)}&output=json`, { retries: 3, timeout: 90000, cacheHours: 1, max: 40e6 })
  if (r.status !== 200) throw new Error(`crt.sh answered ${r.status}`)
  const names = new Map()
  for (const row of JSON.parse(body(r) || '[]')) for (const raw of String(row.name_value ?? '').toLowerCase().split('\n')) {
    const name = raw.trim().replace(/^\*\./, '')
    if (!name.endsWith(`.${d}`)) continue
    const first = day(row.not_before) ?? '', cur = names.get(name)
    if (!cur || first < cur.first_seen) names.set(name, { first_seen: first, issuer: /CN=([^,]+)/.exec(row.issuer_name ?? '')?.[1] ?? null })
  }
  const src = await ctx.source({ url: `https://crt.sh/?q=%25.${d}`, body: r.body, contentType: 'application/json', title: `crt.sh ${d}`, reliability: 'B' })
  const list = [...names].sort((a, b) => a[1].first_seen.localeCompare(b[1].first_seen) || a[0].localeCompare(b[0]))
  ctx.entity('domain', d, { sources: [src.id] })
  const res = ctx.input.subdomains ? ctx.resolver() : null
  for (const [name, x] of list.slice(0, MAX_SUB)) {
    const ip = res ? (await res.resolve(name, 'A'))[0] ?? null : undefined
    ctx.entity('domain', name, { sources: [src.id], props: { role: 'subdomain', first_seen: x.first_seen, issuer: x.issuer, ...(ip !== undefined && { ip }) } })
    ctx.relate(['domain', name], ['domain', d], 'subdomain of', src.id)
  }
  ctx.clue(ctx.t('subdomains', { n: list.length, kept: Math.min(list.length, MAX_SUB) }), { status: 'read', sources: [src.id] })
  ctx.timeline(list.slice(0, 60).map(([name, x]) => ({ date: x.first_seen, label: ctx.t('first_cert', { name }), ref: src.id, kind: 'certificate' })))
  ctx.snapshot('crt', list.map(([name, x]) => ({ key: name, first_seen: x.first_seen })))
}

async function wayback(ctx, d) {
  const cdx = async q => {
    const r = await ctx.fetch('cdx', `/cdx/search/cdx?url=${encodeURIComponent(d)}&output=json${q}`, { retries: 2, timeout: 60000 })
    if (r.status !== 200) throw new Error(`the Wayback Machine answered ${r.status}`)
    return JSON.parse(body(r) || '[]').slice(1)
  }
  const first = await cdx('&fl=timestamp,original,statuscode,digest&limit=1')
  const last = await cdx('&fl=timestamp,original,statuscode,digest&limit=-1&fastLatest=true')
  const changes = await cdx('&fl=timestamp&collapse=digest&limit=5000')
  const ts = t => `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
  const src = await ctx.source({ url: `https://web.archive.org/web/*/${d}`, body: JSON.stringify({ first, last, changes }, null, 2), contentType: 'application/json', title: `Wayback ${d}`, reliability: 'A' })
  const f = first[0], l = last.at(-1)
  if (!f) { ctx.clue(ctx.t('never_archived', { d }), { status: 'read', sources: [src.id] }); ctx.snapshot('wayback', []); return }
  const perYear = {}
  for (const [t] of changes) perYear[t.slice(0, 4)] = (perYear[t.slice(0, 4)] ?? 0) + 1
  ctx.entity('domain', d, { sources: [src.id], props: { first_capture: ts(f[0]), last_capture: ts(l[0]) } })
  ctx.clue(ctx.t('archived', { first: ts(f[0]), last: ts(l[0]), n: changes.length }), { status: 'read', sources: [src.id] })
  ctx.timeline([
    { date: ts(f[0]), label: ctx.t('first_capture'), ref: src.id, kind: 'wayback', url: `https://web.archive.org/web/${f[0]}/${f[1]}` },
    { date: ts(l[0]), label: ctx.t('last_capture'), ref: src.id, kind: 'wayback', url: `https://web.archive.org/web/${l[0]}/${l[1]}` },
  ])
  ctx.view('wayback', { first: f[0], last: l[0], per_year: perYear })
  ctx.snapshot('wayback', [{ key: d, last: l[0], changes: changes.length }])
}

async function host(ctx, d) {
  const r = ctx.resolver(), ips = [...await r.resolve(d, 'A'), ...await r.resolve(d, 'AAAA')], items = []
  for (const ip of ips) {
    // the host step stays as tolerant as before: a registry that fails leaves its fields empty
    const info = await networkInfo(ctx, ip).catch(() => ({ asn: null, asns: [], prefix: null }))
    const asn = info.asn, holder = asn ? await asHolder(ctx, asn) : null
    const open = await internetDb(ctx, ip).catch(() => ({ known: null, ports: [], hostnames: [], cpes: [], vulns: [], tags: [] }))
    const src = await ctx.source({ url: `https://stat.ripe.net/app/${ip}`, body: JSON.stringify({ ripestat: info, asn, holder, internetdb: open }, null, 2), contentType: 'application/json', title: `Host ${ip}`, reliability: 'B' })
    ctx.entity('ip', ip, { sources: [src.id], props: { asn: asn ? `AS${asn}` : null, prefix: info.prefix ?? null, holder, ports: open.ports ?? [], hostnames: open.hostnames ?? [], cpes: open.cpes ?? [], vulns: open.vulns ?? [] } })
    if (holder) {
      ctx.entity('organization', holder, { sources: [src.id], props: { role: 'hosting' } })
      ctx.relate(['ip', ip], ['organization', holder], 'hosted by', src.id)
      ctx.clue(ctx.t('hosted_by', { holder, asn: `AS${asn}`, prefix: info.prefix ?? '?' }), { status: 'read', sources: [src.id] })
    }
    for (const h of open.hostnames ?? []) { ctx.entity('domain', h, { sources: [src.id], props: { role: 'hostname' } }); ctx.relate(['ip', ip], ['domain', h], 'hostname', src.id) }
    items.push({ key: ip, asn, holder, ports: [...(open.ports ?? [])].sort((a, b) => a - b) })
  }
  ctx.snapshot('host', items)
}

const TECH = [[/wp-content|wp-includes/i, 'WordPress'], [/cdn\.shopify\.com/i, 'Shopify'], [/\/_next\//i, 'Next.js'], [/static\.wixstatic\.com/i, 'Wix'], [/squarespace/i, 'Squarespace'], [/prestashop/i, 'PrestaShop'], [/drupal/i, 'Drupal'], [/joomla/i, 'Joomla'], [/webflow/i, 'Webflow']]
const TRACKERS = [
  ['google-analytics', /(?:gtag\/js\?id=|['"]config['"]\s*,\s*['"])(G-[A-Z0-9]{6,12})/g],
  ['universal-analytics', /\b(UA-\d{4,10}-\d{1,4})\b/g],
  ['google-tag-manager', /\b(GTM-[A-Z0-9]{4,9})\b/g],
  ['adsense', /\b(?:ca-)?(pub-\d{10,20})\b/g],
  ['facebook-pixel', /fbq\(\s*['"]init['"]\s*,\s*['"](\d{10,20})['"]/g],
]
const SOCIAL = /^https?:\/\/(www\.)?(twitter\.com|x\.com|facebook\.com|instagram\.com|linkedin\.com\/(company|in)|github\.com|youtube\.com|tiktok\.com|bsky\.app|threads\.net)\//i
const strip = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ')
const abs = (h, base) => { try { return new URL(h, base).href } catch { return h } }
export function luhn(d) {
  let s = 0
  for (let i = 0; i < d.length; i++) { let n = +d[d.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9 } s += n }
  return s % 10 === 0
}
export const sirensIn = text => [...new Set([...text.matchAll(/(?:SIREN|SIRET|RCS)[^0-9]{0,40}((?:\d[\s.]?){9})/gi).map(m => m[1].replace(/\D/g, '')).filter(luhn)])]
const spaced = s => `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6, 9)}`
export function readHome(html, headers = {}, base) {
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1].replace(/\s+/g, ' ').trim() || null
  const generator = /<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)/i.exec(html)?.[1] ?? null
  const tech = new Set(generator ? [generator] : [])
  for (const [re, name] of TECH) if (re.test(html)) tech.add(name)
  if (headers.server) tech.add(`server: ${headers.server}`)
  if (headers['x-powered-by']) tech.add(`x-powered-by: ${headers['x-powered-by']}`)
  const trackers = []
  for (const [service, re] of TRACKERS) for (const m of html.matchAll(re)) if (!trackers.some(t => t.id === m[1])) trackers.push({ service, id: m[1] })
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m => ({ href: abs(m[1], base), label: strip(m[2]).trim() }))
  const social = [...new Set(links.map(l => l.href).filter(h => SOCIAL.test(h) && !/sharer|\/share|intent\//i.test(h)).map(h => h.replace(/[?#].*$/, '').replace(/\/+$/, '')))]
  const emails = [...new Set(links.map(l => l.href).filter(h => /^mailto:/i.test(h)).map(h => decodeURIComponent(h.slice(7).split('?')[0]).toLowerCase()))]
  const legal = links.find(l => /mentions[\s-]+l[ée]gales|legal|impressum/i.test(`${l.label} ${l.href}`))?.href ?? null
  return { title, generator, tech: [...tech], trackers, social, emails, siren: sirensIn(strip(html)), legal }
}
async function home(ctx, d) {
  const url = `https://${d}/`, r = await ctx.fetch('web', url, { max: 5e6, timeout: 20000 })
  const src = await ctx.source({ url, body: r.body, contentType: r.headers['content-type'], title: ctx.t('home_page', { d }), reliability: 'B' })
  if (r.status >= 400) throw new Error(`the home page answered ${r.status}`)
  const h = readHome(body(r), r.headers, url), S = { status: 'read', sources: [src.id] }
  ctx.entity('domain', d, { sources: [src.id] })
  if (h.title) ctx.clue(ctx.t('site_title', { title: h.title }), S)
  if (h.tech.length) ctx.clue(ctx.t('built_with', { tech: h.tech.join(', ') }), S)
  for (const t of h.trackers) { ctx.entity('tracker', t.id, { sources: [src.id], props: { service: t.service } }); ctx.relate(['domain', d], ['tracker', t.id], 'uses', src.id) }
  if (h.trackers.length) ctx.clue(ctx.t('trackers', { ids: h.trackers.map(t => t.id).join(', ') }), S)
  for (const s of h.social) { ctx.entity('account', s, { sources: [src.id], props: { site: new URL(s).hostname.replace(/^www\./, '') } }); ctx.relate(['domain', d], ['account', s], 'links to', src.id) }
  for (const e of h.emails) { ctx.entity('email', e, { sources: [src.id] }); ctx.relate(['domain', d], ['email', e], 'publishes', src.id) }
  for (const s of h.siren) {
    ctx.entity('organization', `SIREN ${spaced(s)}`, { sources: [src.id], props: { siren: s } })
    ctx.relate(['domain', d], ['organization', `SIREN ${spaced(s)}`], 'names', src.id)
    ctx.clue(ctx.t('siren_home', { siren: spaced(s) }), S)
  }
  ctx.state({ legal_href: h.legal })
  ctx.view('home', h)
  ctx.snapshot('home', [{ key: 'title', value: h.title }, ...h.tech.map(x => ({ key: `tech:${x}` })), ...h.trackers.map(t => ({ key: `tracker:${t.id}` })), ...h.social.map(x => ({ key: `social:${x}` })), ...h.emails.map(x => ({ key: `email:${x}` })), ...h.siren.map(x => ({ key: `siren:${x}` }))])
}

async function legalNotice(ctx, args, flags) {
  const d = domainOf(ctx.input.domain), href = ctx.state().legal_href
  if (ctx.noisy === 'never') ctx.refuse('the legal notice is read on the site itself (noisy): this case is noisy=never')
  if (!flags.yes) ctx.refuse('the legal notice is read on the site itself (noisy): the user\'s yes, then --yes', 2)
  if (!href) ctx.refuse(`no legal notice link known for ${d}: run domain collect --only home first, or read the page and record it with source <url>`)
  const r = await ctx.fetch('web', href, { max: 3e6 })
  const src = await ctx.source({ url: href, body: r.body, contentType: r.headers['content-type'], title: ctx.t('legal_notice', { d }), reliability: 'B' })
  if (r.status >= 400) throw new Error(`the legal notice answered ${r.status}`)
  const text = strip(body(r)), S = { status: 'read', sources: [src.id] }
  for (const s of sirensIn(text)) {
    ctx.entity('organization', `SIREN ${spaced(s)}`, { sources: [src.id], props: { siren: s } })
    ctx.clue(ctx.t('siren_legal', { siren: spaced(s) }), S)
  }
  const grab = re => re.exec(text)?.[1].replace(/\s+/g, ' ').trim()
  const publisher = grab(/(?:directeur|directrice|responsable)\s+de\s+(?:la\s+)?publication\s*:?\s*([^.;]{3,80})/i)
  // a name is an entity only when the frame names a person as subject (spec § 5, § 11.2): else it stays in the clue
  if (publisher) { if (ctx.person) ctx.entity('person', publisher, { sources: [src.id], props: { role: 'publication director' } }); ctx.clue(ctx.t('publisher', { name: publisher }), S) }
  const hoster = grab(/(?:h[ée]bergeur|h[ée]berg[ée]\s+par|hosted\s+by|hosting)\s*:?\s*([^,.;]{3,80})/i)
  if (hoster) { ctx.entity('organization', hoster, { sources: [src.id], props: { role: 'hosting (legal notice)' } }); ctx.clue(ctx.t('legal_host', { name: hoster }), S) }
  const editor = grab(/[ée]diteur\s*:?\s*([^,;]{3,80})/i)
  if (editor) ctx.clue(ctx.t('editor', { name: editor }), S)
}

const STEP = { rdap, dns: dnsStep, crt, wayback, host, home }
export const commands = {
  collect: {
    help: 'rdap, dns, crt, wayback, host, home (Quick: rdap, dns, home); --only a,b; home is noisy: never in a noisy=never case, --yes in a noisy=ask one',
    flags: { only: 'string', yes: 'boolean' },
    async run(ctx, args, flags) {
      const d = domainOf(ctx.input.domain)
      const want = flags.only ? flags.only.split(',').map(s => s.trim()) : [...(ctx.input.depth === 'quick' ? QUICK : STEPS)]
      const bad = want.filter(s => !STEPS.includes(s))
      if (bad.length) ctx.refuse(`--only ${STEPS.join(',')} (not ${bad.join(', ')})`)
      const loud = want.filter(s => NOISY.includes(s))
      if (loud.length && ctx.noisy === 'never') { ctx.log(`skipped ${loud.join(', ')}: noisy steps are never run in this case`); for (const s of loud) want.splice(want.indexOf(s), 1) }
      else if (loud.length && !flags.yes) ctx.refuse(`${loud.join(', ')} reads the site itself (noisy): the user's yes, then --yes (or --only without ${loud.join(', ')})`, 2)
      let n = 0
      for (const s of STEPS.filter(x => want.includes(x))) {
        ctx.progress(++n, want.length, s)
        try { await STEP[s](ctx, d) } catch (e) { if (e.userError) throw e; ctx.fail(`${s}: ${e.message}`) }
      }
    },
  },
  'legal-notice': { help: 'one read of the legal notice page the home page links to (noisy: needs --yes)', flags: { yes: 'boolean' }, run: legalNotice },
}
