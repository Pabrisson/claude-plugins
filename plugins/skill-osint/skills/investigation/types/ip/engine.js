// The ip type: one IPv4 or IPv6 address, from published registries and lists, never from the address itself (no
// scan, no ping). Who holds the range (RDAP, whois, abuse contact), who announces it (RIPEstat), its reverse name, a
// coarse geolocation (always inferred: a big circle, never a street), what Shodan's own scans saw (InternetDB: noted,
// never tested), whether the Tor Project lists it as an exit, whether AWS, Google Cloud or Cloudflare publish it in
// their ranges. A step writes its source and its clues only when its snapshot is new or changed, so a refresh without
// change adds nothing; a step that fails is noted and the next one runs.
//
// THE RULE OF THIS TYPE (the frame is `noisy`, and nothing here is): no scan, no ping, no connection of any kind to
// the address under study. Every request goes through ctx.fetch to a registry or a published list; this file opens no
// socket, starts no process and resolves no address by itself (test/noscan.test.js fails if it does).
import path from 'node:path'
import { canonicalIp, inCidr, ipText, parseCidr, parseIp, special } from '../../engine/lib/cidr.js'
import { dataset } from '../../engine/lib/datasets.js'
import { parseAddress } from '../../engine/lib/mail.js'
import { internetDb, networkInfo, ripestat, vcardName } from '../../engine/lib/ipinfo.js'

// what a registry, Shodan or a published list wrote ends up in properties, file names and notes: no line break, no [ ] < > ` \ %
const tidy = x => String(x ?? '').replace(/[\r\n]+/g, ' ').replace(/[[\]<>`\\%]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
const EMAIL = /^[^\s@<>[\]`\\%,;]{1,64}@[A-Za-z0-9.-]{1,190}$/
const day = x => (x ? String(x).slice(0, 10) : null)

export function addressOf(input) {
  const s = String(input ?? '').trim(), a = parseIp(s)
  if (!a) return { error: `${s || '(empty)'} is not an IP address: give one IPv4 (203.0.113.7) or IPv6 (2001:db8::7) address, without a port or a prefix` }
  const sp = special(a)
  if (sp) return { error: `${ipText(a)} is a ${sp.name} address (${sp.cidr}): no public registry describes it — look at it on the network that uses it` }
  return { ip: ipText(a), v: a.v }
}

const withRole = (ents, role) => { for (const e of ents ?? []) { if (e.roles?.includes(role)) return e; const sub = withRole(e.entities, role); if (sub) return sub } return null }
const mail = x => (EMAIL.test(String(x ?? '').trim()) ? String(x).trim().toLowerCase() : null)
const vcardKind = e => String(e?.vcardArray?.[1]?.find(x => x[0] === 'kind')?.[3] ?? '').toLowerCase()
export const registrantKind = j => vcardKind(withRole(j?.entities, 'registrant'))
const vcardEmail = e => mail(e?.vcardArray?.[1]?.find(x => x[0] === 'email')?.[3])
export function rdapOf(j) {
  const ev = Object.fromEntries((j.events ?? []).map(e => [e.eventAction, e.eventDate]))
  return {
    range: tidy(j.startAddress && j.endAddress ? `${j.startAddress} - ${j.endAddress}` : j.handle) || null,
    cidrs: (j.cidr0_cidrs ?? []).map(c => `${c.v4prefix ?? c.v6prefix}/${c.length}`).filter(c => parseCidr(c)),
    netname: tidy(j.name) || null, type: tidy(j.type) || null, country: /^[A-Za-z]{2}$/.test(j.country ?? '') ? j.country.toUpperCase() : null,
    registrant: tidy(vcardName(withRole(j.entities, 'registrant'))) || null, abuse: vcardEmail(withRole(j.entities, 'abuse')),
    rir: /^whois\.(\w+)\./.exec(j.port43 ?? '')?.[1]?.toLowerCase() ?? null,
    registered: day(ev.registration), changed: day(ev['last changed']),
  }
}
// RIPEstat's whois: the first record that names a network (RIPE's netname, ARIN's NetName); ARIN's « No match » has none
export function whoisOf(data) {
  for (const rec of data.records ?? []) {
    const get = k => rec.filter(x => String(x.key).toLowerCase() === k).map(x => tidy(x.value)).filter(Boolean)
    const netname = get('netname')[0]
    if (netname) return { netname, descr: get('descr'), country: /^[A-Za-z]{2}$/.test(get('country')[0] ?? '') ? get('country')[0].toUpperCase() : null, org: get('org')[0] ?? null }
  }
  return null
}
// prefix-overview's holder reads « CLOUDFLARENET - Cloudflare, Inc. »: the AS name, then who holds it
export function prefixOf(data) {
  return {
    prefix: parseCidr(data.resource) ? data.resource : null, announced: !!data.announced,
    asns: (data.asns ?? []).filter(a => /^\d{1,10}$/.test(String(a.asn))).map(a => { const [name, ...org] = String(a.holder ?? '').split(' - '); return { asn: `AS${a.asn}`, name: org.length ? tidy(name) || null : null, org: tidy(org.length ? org.join(' - ') : name) || null } }),
  }
}
// ponytail: two fixed radii; a radius per country if a big country's 500 km circle misleads
export const CITY_M = 50000, COUNTRY_M = 500000
export function geoOf(data) {
  const locs = (data.located_resources ?? []).flatMap(r => r.locations ?? [])
  const l = [...locs].sort((a, b) => (b.covered_percentage ?? 0) - (a.covered_percentage ?? 0))[0]
  // anycast and unknown answers come as country « ? » at 0, 0: no place, never a point off Africa
  if (!l || !/^[A-Z]{2}$/.test(l.country ?? '') || (!l.latitude && !l.longitude)) return null
  const tenth = x => Math.round(x * 10) / 10
  return { country: l.country, city: tidy(l.city) || null, lat: tenth(l.latitude), lon: tenth(l.longitude), radius_m: tidy(l.city) ? CITY_M : COUNTRY_M, places: locs.length }
}
export const torListed = (ip, text) => String(text).split(/\r?\n/).some(line => canonicalIp(line) === ip)

export const PROVIDERS = { aws: 'Amazon Web Services', gcp: 'Google Cloud', cloudflare: 'Cloudflare' }
export function cloudRanges(texts) {
  const aws = texts['aws-ranges'] ? JSON.parse(texts['aws-ranges']) : { prefixes: [], ipv6_prefixes: [] }
  const gcp = texts['gcp-ranges'] ? JSON.parse(texts['gcp-ranges']) : { prefixes: [] }
  const cf = [texts['cloudflare-v4'], texts['cloudflare-v6']].filter(Boolean).join('\n')
  return [
    ...[...(aws.prefixes ?? []), ...(aws.ipv6_prefixes ?? [])].map(p => ({ provider: 'aws', prefix: p.ip_prefix ?? p.ipv6_prefix, region: tidy(p.region) || null, service: tidy(p.service) || null })),
    ...(gcp.prefixes ?? []).map(p => ({ provider: 'gcp', prefix: p.ipv4Prefix ?? p.ipv6Prefix, region: tidy(p.scope) || null, service: tidy(p.service) || null })),
    ...cf.split(/\s+/).filter(Boolean).map(prefix => ({ provider: 'cloudflare', prefix, region: null, service: null })),
  ].filter(r => parseCidr(r.prefix)) // a prefix is a prefix, never a text that rides into a note
}
export function cloudMatch(ip, ranges) {
  const a = parseIp(ip), best = {}
  for (const r of ranges) {
    const c = parseCidr(r.prefix)
    if (!c || !inCidr(a, c)) continue
    const b = best[r.provider]
    if (!b || c.bits > b.bits) best[r.provider] = { bits: c.bits, provider: r.provider, name: PROVIDERS[r.provider], prefix: r.prefix, region: r.region, services: r.service ? [r.service] : [] }
    else if (r.prefix === b.prefix && r.service && !b.services.includes(r.service)) b.services.push(r.service)
  }
  return Object.values(best).map(({ bits, ...m }) => m)
}
// ponytail: a word list over the reverse name and the network's name; a subscriber line named like a server slips by
const RESIDENTIAL = /(^|[^a-z])(dsl|adsl|vdsl|xdsl|ftth|fttx|cable|dyn|dynamic|dhcp|pool|ppp|pppoe|dialup|broadband|residential|customer|cust|subscriber|abo|home|mobile|lte|cgnat)([^a-z]|$)/i
export const looksResidential = text => RESIDENTIAL.exec(String(text ?? ''))?.[2].toLowerCase() ?? null
// ——— the steps of collect ———
export const STEPS = ['registry', 'prefix', 'rdns', 'geo', 'ports', 'tor', 'cloud']
export const MAX_HOSTS = 50
const HOSTNAME = /^[a-z0-9_][a-z0-9_.-]{0,252}$/ // a reverse name is third-party text: only a host name goes on
const few = (xs, n = 10) => `${xs.slice(0, n).join(', ')}${xs.length > n ? `, +${xs.length - n}` : ''}`
const stat = (call, ip) => `https://stat.ripe.net/data/${call}/data.json?resource=${ip}`
const subject = (ctx, ip, sources, props) => ctx.entity('ip', ip, { sources, props: { role: 'subject', version: parseIp(ip).v, ...props } })
// a step whose snapshot is new or changed records what it read as a source and writes its clues; otherwise it only
// updates the properties (its requests are in the Journal already): a refresh without change adds nothing
const fresh = d => d.first || d.added.length + d.removed.length + d.changed.length > 0
const recorded = (ctx, d, url, title, body, reliability = 'A') => (fresh(d) ? ctx.source({ url, body: JSON.stringify(body, null, 2), contentType: 'application/json', title, reliability }) : null)

// a residential line is personal data: said once, as an inferred clue; when the frame says person: false the agent is
// told to stop and ask for the frame (person=true and its legal basis); nothing more is looked up on the subscriber
function residential(ctx, ip, why, sources) {
  if (!why || ctx.state().residential) return
  ctx.state({ residential: why })
  ctx.clue(ctx.t('residential', { ip, why }), { status: 'inferred', sources })
  const warn = `${ip} looks like a residential line (« ${why} »): a residential IP is personal data`
  if (ctx.person) return void ctx.log(`${warn}; the frame has person: true`)
  const ask = `${warn} — if the frame says person: false, ask the user (person=true and its legal basis) before going on, and look no further into the subscriber`
  ctx.log(ask)
  console.error(`warning: ${ask}`)
}
// the published lists, kept for the whole folder (lib/datasets.js); describe() names them in doctor and refuses a
// download that is no list (an error page): the previous copy then stays
const count = (text, what) => { const n = String(text).split(/\s+/).filter(l => parseCidr(l)).length; if (!n) throw new Error(`no ${what} in the list`); return n }
const LISTS = {
  'tor-exits': { service: 'tor', path: '/torbulkexitlist', hours: 1, describe: t => `${count(t, 'address')} exits` },
  'aws-ranges': { service: 'aws', path: '/ip-ranges.json', hours: 24, describe: t => { const j = JSON.parse(t); return `${j.prefixes.length + j.ipv6_prefixes.length} prefixes` } },
  'gcp-ranges': { service: 'gcp', path: '/ipranges/cloud.json', hours: 24, describe: t => `${JSON.parse(t).prefixes.length} prefixes` },
  'cloudflare-v4': { service: 'cloudflare', path: '/ips-v4', hours: 24, describe: t => `${count(t, 'prefix')} prefixes` },
  'cloudflare-v6': { service: 'cloudflare', path: '/ips-v6', hours: 24, describe: t => `${count(t, 'prefix')} prefixes` },
}
async function listed(ctx, id) {
  const ds = await dataset(ctx.home, id, LISTS[id])
  ctx.log(`${id}: ${ds.cached ? 'cached copy' : 'downloaded'} of ${ds.at}${ds.stale ? ` (stale: ${ds.error})` : ''}`)
  return ds
}

async function registry(ctx, ip) {
  const r = await ctx.fetch('rdap', `/ip/${ip}`, { accept: 'application/rdap+json', retries: 1 })
  if (r.status >= 400 && r.status !== 404) throw new Error(`RDAP answered ${r.status}`)
  const raw = r.status === 404 ? null : JSON.parse(r.body.toString('utf8')), rd = raw && rdapOf(raw)
  // a person frame of false: no natural person (a vCard « individual ») and no personal mailbox (a public webmail) is kept, nor in the capture
  if (rd && !ctx.person) { if (registrantKind(raw) === 'individual') rd.registrant = null; if (rd.abuse && parseAddress(rd.abuse)?.webmail) rd.abuse = null }
  const w = whoisOf(await ripestat(ctx, 'whois', ip)), ab = await ripestat(ctx, 'abuse-contact-finder', ip)
  const found = [...new Set((Array.isArray(ab.abuse_contacts) ? ab.abuse_contacts : []).map(mail).filter(Boolean))].filter(e => ctx.person || !parseAddress(e)?.webmail)
  const abuse = found.length ? found : rd?.abuse ? [rd.abuse] : []
  const f = { range: rd?.range ?? null, netname: rd?.netname ?? w?.netname ?? null, registrant: rd?.registrant ?? null, rir: (/^[a-z]{2,10}$/.test(ab.authoritative_rir ?? '') ? ab.authoritative_rir : rd?.rir) ?? null, country: rd?.country ?? w?.country ?? null, abuse }
  const d = ctx.snapshot('registry', f.range || f.netname ? [{ key: f.range ?? f.netname, ...f }] : [])
  const src = await recorded(ctx, d, `https://rdap.org/ip/${ip}`, ctx.t('src_registry', { ip }), { rdap: rd, whois: w, abuse_contact_finder: ab })
  const S = src ? [src.id] : []
  subject(ctx, ip, S, { range: f.range, netname: f.netname, rir: f.rir, registered_country: f.country, abuse })
  if (f.registrant) { ctx.entity('organization', f.registrant, { sources: S, props: { role: 'registrant' } }); ctx.relate(['ip', ip], ['organization', f.registrant], 'registered to', src?.id ?? null) }
  for (const e of abuse) { ctx.entity('email', e, { sources: S, props: { role: 'abuse contact' } }); ctx.relate(['ip', ip], ['email', e], 'abuse contact', src?.id ?? null) }
  residential(ctx, ip, looksResidential([f.netname, ...(w?.descr ?? [])].join(' ')), S)
  if (!src) return
  const C = { status: 'read', sources: S }
  if (!rd && !w) return void ctx.clue(ctx.t('no_registry', { ip }), C)
  ctx.clue(ctx.t('network', { netname: f.netname ?? '?', range: f.range ?? '?', holder: f.registrant ?? w?.org ?? '?', rir: (f.rir ?? '?').toUpperCase(), country: f.country ? ` (${f.country})` : '' }), C)
  if (w?.descr.length && ctx.person) ctx.clue(ctx.t('whois_says', { text: w.descr.join(' ; ') }), C)
  if (abuse.length) ctx.clue(ctx.t('abuse', { emails: abuse.join(', ') }), C)
  ctx.timeline([[rd?.registered, 'net_registered'], [rd?.changed, 'net_changed']].filter(([x]) => x).map(([date, l]) => ({ date, label: ctx.t(l), ref: src.id, kind: 'rdap' })))
}

async function prefix(ctx, ip) {
  const ni = await networkInfo(ctx, ip), po = prefixOf(await ripestat(ctx, 'prefix-overview', ip))
  const asns = po.asns.length ? po.asns : ni.asns.map(a => ({ asn: `AS${a}`, name: null, org: null }))
  const pfx = po.prefix ?? ni.prefix
  const d = ctx.snapshot('prefix', pfx ? [{ key: pfx, asns: asns.map(a => a.asn), announced: po.announced }] : [])
  const src = await recorded(ctx, d, stat('prefix-overview', ip), ctx.t('src_prefix', { ip }), { 'network-info': ni, 'prefix-overview': po })
  const S = src ? [src.id] : []
  subject(ctx, ip, S, { prefix: pfx, asn: asns.map(a => a.asn).join(', ') || null, as_holder: asns.map(a => a.org).filter(Boolean).join(', ') || null, announced: po.announced })
  for (const a of asns.filter(x => x.org)) {
    ctx.entity('organization', a.org, { sources: S, props: { role: 'AS holder', asn: a.asn, as_name: a.name } })
    ctx.relate(['ip', ip], ['organization', a.org], 'announced by', src?.id ?? null)
  }
  if (!src) return
  const named = asns.map(a => [a.asn, [a.name, a.org].filter(Boolean).join(' - ')].filter(Boolean).join(' ')).join(', ')
  ctx.clue(po.announced && asns.length ? ctx.t('announced', { asns: named, prefix: pfx }) : ctx.t('not_announced', { ip }), { status: 'read', sources: S })
}

async function rdns(ctx, ip) {
  const data = await ripestat(ctx, 'reverse-dns-ip', ip)
  const names = [...new Set((Array.isArray(data.result) ? data.result : []).map(n => String(n).toLowerCase().replace(/\.$/, '')).filter(n => HOSTNAME.test(n)))]
  const res = ctx.resolver(), rr = parseIp(ip).v === 4 ? 'A' : 'AAAA', rows = []
  // forward-confirmed: the name resolves back to the address (anyone may write any name in their reverse zone)
  for (const name of names) rows.push({ key: name, confirmed: (await res.resolve(name, rr)).map(x => canonicalIp(x)).includes(ip) })
  ctx.state({ ptr: names })
  const d = ctx.snapshot('rdns', rows)
  const src = await recorded(ctx, d, stat('reverse-dns-ip', ip), ctx.t('src_rdns', { ip }), { 'reverse-dns-ip': data, forward: rows })
  const S = src ? [src.id] : []
  subject(ctx, ip, S, { ptr: names })
  for (const r of rows) { ctx.entity('domain', r.key, { sources: S, props: { role: 'ptr', confirmed: r.confirmed } }); ctx.relate(['ip', ip], ['domain', r.key], 'PTR', src?.id ?? null) }
  residential(ctx, ip, names.map(looksResidential).find(Boolean), S)
  if (!src) return
  if (!rows.length) ctx.clue(ctx.t('no_ptr', { ip }), { status: 'read', sources: S })
  for (const r of rows) ctx.clue(ctx.t(r.confirmed ? 'ptr_confirmed' : 'ptr_claimed', { ip, name: r.key }), { status: r.confirmed ? 'read' : 'inferred', sources: S })
}

async function geo(ctx, ip) {
  const data = await ripestat(ctx, 'maxmind-geo-lite', ip), g = geoOf(data)
  const d = ctx.snapshot('geo', [{ key: 'geo', country: g?.country ?? null, city: g?.city ?? null }])
  const src = await recorded(ctx, d, stat('maxmind-geo-lite', ip), ctx.t('src_geo', { ip }), { 'maxmind-geo-lite': data }, 'C')
  const S = src ? [src.id] : []
  subject(ctx, ip, S, { geo_country: g?.country ?? null, geo_city: g?.city ?? null })
  if (!g) {
    ctx.view('map', { type: 'FeatureCollection', features: [] })
    if (src) ctx.clue(ctx.t('no_geo', { ip }), { status: 'inferred', sources: S })
    return
  }
  // the place carries no lat/lon: the map draws the circle of map.json, never a pin that reads as an address
  const value = g.city ? `${g.city}, ${g.country}` : g.country, km = g.radius_m / 1000
  const place = ctx.entity('place', value, { sources: S, props: { coarse: true, country: g.country, city: g.city, center: `${g.lat}, ${g.lon}`, radius_m: g.radius_m, by: 'MaxMind GeoLite2 (RIPEstat)' } })
  ctx.relate(['ip', ip], ['place', value], 'geolocated around (estimate)', src?.id ?? null)
  ctx.view('map', { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [g.lon, g.lat] }, properties: { role: 'place', label: ctx.t('map_label', { place: value, km }), ref: place.path, radius_m: g.radius_m, kind: 'geoip' } }] })
  if (src) ctx.clue(ctx.t(g.city ? 'geo_city' : 'geo_country', { ip, place: value, km }), { status: 'inferred', sources: S })
}

async function ports(ctx, ip) {
  const o = await internetDb(ctx, ip), ptr = ctx.state().ptr ?? []
  const rows = [...o.ports.map(p => ({ type: 'port', value: String(p) })), ...o.hostnames.map(value => ({ type: 'hostname', value })), ...o.cpes.map(value => ({ type: 'cpe', value })), ...o.vulns.map(value => ({ type: 'vuln', value })), ...o.tags.map(value => ({ type: 'tag', value }))]
  ctx.view('open', rows)
  const d = ctx.snapshot('ports', o.known ? rows.map(r => ({ key: `${r.type}:${r.value}` })) : [{ key: 'unknown' }])
  const src = await recorded(ctx, d, `https://internetdb.shodan.io/${ip}`, ctx.t('src_ports', { ip }), o, 'B')
  const S = src ? [src.id] : [], hosts = o.hostnames.slice(0, MAX_HOSTS)
  subject(ctx, ip, S, { ports: o.ports, hostnames: hosts, cpes: o.cpes, vulns: o.vulns, shodan_tags: o.tags })
  // a PTR name keeps its role; the others are names that pointed here when Shodan looked
  for (const h of hosts) { ctx.entity('domain', h, { sources: S, props: ptr.includes(h) ? {} : { role: 'hostname' } }); ctx.relate(['ip', ip], ['domain', h], 'hostname (Shodan)', src?.id ?? null) }
  if (!src) return
  if (!o.known) return void ctx.clue(ctx.t('shodan_unknown', { ip }), { status: 'read', sources: S })
  const changed = new Set([...d.added, ...d.removed].map(x => x.key.split(':')[0])), C = status => ({ status, sources: S })
  if (changed.has('port') || changed.has('cpe')) ctx.clue(ctx.t('ports', { ip, ports: o.ports.join(', ') || '—', software: o.cpes.length ? ctx.t('software', { cpes: o.cpes.join(', ') }) : '' }), C('read'))
  if (changed.has('hostname') && o.hostnames.length) ctx.clue(ctx.t('hostnames', { ip, n: o.hostnames.length, names: few(o.hostnames) }), C('inferred'))
  if (changed.has('vuln') && o.vulns.length) ctx.clue(ctx.t('vulns', { n: o.vulns.length, ids: few(o.vulns) }), C('inferred'))
  if (changed.has('tag') && o.tags.length) ctx.clue(ctx.t('tags', { ip, tags: o.tags.join(', ') }), C('inferred'))
}

async function tor(ctx, ip) {
  const ds = await listed(ctx, 'tor-exits'), exit = torListed(ip, ds.text)
  const d = ctx.snapshot('tor', [{ key: ip, exit }])
  const src = await recorded(ctx, d, ds.url, ctx.t('src_tor'), { list: ds.url, fetched: ds.at, sha256: ds.sha256, exits: count(ds.text, 'address'), listed: exit })
  subject(ctx, ip, src ? [src.id] : [], { tor_exit: exit })
  if (!src) return
  ctx.clue(ctx.t(exit ? 'tor_exit' : 'not_tor', { ip, date: day(ds.at) }), { status: 'read', sources: [src.id] })
  if (exit) ctx.timeline([{ date: ds.at, label: ctx.t('tor_listed'), ref: src.id, kind: 'tor' }])
}

async function cloud(ctx, ip) {
  const texts = {}, urls = {}
  for (const id of ['aws-ranges', 'gcp-ranges', 'cloudflare-v4', 'cloudflare-v6']) {
    const ds = await listed(ctx, id) // a list that cannot be read fails the step: a provider missing would look like « no longer in its ranges »
    texts[id] = ds.text; urls[id.split('-')[0]] ??= ds.url
  }
  const m = cloudMatch(ip, cloudRanges(texts)), checked = [...new Set(Object.keys(texts).map(id => PROVIDERS[id.split('-')[0]]))]
  const d = ctx.snapshot('cloud', m.map(x => ({ key: `${x.provider}:${x.prefix}`, region: x.region, services: x.services })))
  const src = await recorded(ctx, d, urls[m[0]?.provider] ?? Object.values(urls)[0], ctx.t('src_cloud'), { checked, lists: Object.values(urls), matches: m })
  const S = src ? [src.id] : []
  subject(ctx, ip, S, { cloud: m.map(x => `${x.name} ${x.prefix}`) })
  for (const x of m) { ctx.entity('organization', x.name, { sources: S, props: { role: 'cloud' } }); ctx.relate(['ip', ip], ['organization', x.name], 'in the published ranges of', src?.id ?? null) }
  if (!src) return
  if (!m.length) ctx.clue(ctx.t('no_cloud', { ip, providers: checked.join(', ') }), { status: 'read', sources: S })
  for (const x of m) {
    const detail = [x.region, ...x.services].filter(Boolean).join(', ')
    ctx.clue(ctx.t('cloud', { ip, name: x.name, prefix: `${x.prefix}${detail ? ` (${detail})` : ''}` }), { status: 'read', sources: S })
  }
}

const STEP = { registry, prefix, rdns, geo, ports, tor, cloud }
export const commands = {
  collect: {
    help: 'registry, prefix, rdns, geo, ports, tor, cloud (all by default); --only a,b — published registries and lists only, never the address itself',
    flags: { only: 'string' },
    async run(ctx, args, flags) {
      const a = addressOf(ctx.input.ip)
      if (a.error) ctx.refuse(a.error)
      const want = flags.only ? flags.only.split(',').map(s => s.trim()) : STEPS
      const bad = want.filter(s => !STEPS.includes(s))
      if (bad.length) ctx.refuse(`--only ${STEPS.join(',')} (not ${bad.join(', ')})`)
      let n = 0
      for (const s of STEPS.filter(x => want.includes(x))) {
        ctx.progress(++n, want.length, s)
        try { await STEP[s](ctx, a.ip) } catch (e) { if (e.userError) throw e; ctx.fail(`${s}: ${e.message}`) }
      }
    },
  },
}
