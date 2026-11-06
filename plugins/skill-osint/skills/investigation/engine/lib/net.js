// Every request the engine makes: the service's base (OSINT_BASE_<SERVICE> points it at the tests' fake server, which
// then gets the host meant in x-osint-host), a gap between two calls to one host, a size cap, redirects followed by
// hand so that each hop is checked, a cache on request, a User-Agent that says who calls. Three Google AI hosts are
// always refused: the agent checks matches and recognises landmarks itself.
import dns from 'node:dns'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { withLock } from './case.js'
import { inCidr, parseIp, special } from './cidr.js'
import { fail, readJson, sha256, VERSION, writeAtomic } from './util.js'

export const SERVICES = { rdap: 'https://rdap.org', crtsh: 'https://crt.sh', cdx: 'https://web.archive.org', spn: 'https://web.archive.org', ripestat: 'https://stat.ripe.net', internetdb: 'https://internetdb.shodan.io',
  nominatim: 'https://nominatim.openstreetmap.org', openmeteo: 'https://archive-api.open-meteo.com', mapillary: 'https://graph.mapillary.com', hf: 'https://huggingface.co', doh: 'https://cloudflare-dns.com', raw: 'https://raw.githubusercontent.com',
  entreprises: 'https://recherche-entreprises.api.gouv.fr', bodacc: 'https://bodacc-datadila.opendatasoft.com',
  gravatar: 'https://api.gravatar.com', xon: 'https://api.xposedornot.com', arcep: 'https://extranet.arcep.fr',
  tor: 'https://check.torproject.org', aws: 'https://ip-ranges.amazonaws.com', gcp: 'https://www.gstatic.com', cloudflare: 'https://www.cloudflare.com',
  // the place type
  geopf: 'https://data.geopf.fr', overpass: 'https://overpass-api.de', panoramax: 'https://api.panoramax.xyz', kartaview: 'https://api.kartaview.org', esri: 'https://s3-us-west-2.amazonaws.com' }
// ms between two calls to one host (crt.sh and the Wayback Machine answer 429 when hurried; Nominatim asks for 1/s; Recherche d'entreprises takes 7 a second per IP)
export const GAP = { rdap: 400, crtsh: 2000, cdx: 1500, spn: 20000, ripestat: 150, internetdb: 300, web: 1000, nominatim: 1100, openmeteo: 500, mapillary: 200, hf: 500, doh: 0, raw: 500, entreprises: 150, bodacc: 300, gravatar: 1000, xon: 600, arcep: 1000,
  // the Géoplateforme takes 50 requests a second; Overpass two queries at a time per address (one at a time here)
  geopf: 100, overpass: 1000, panoramax: 300, kartaview: 500, esri: 0 }
export const DENY = new Set(['generativelanguage.googleapis.com', 'vision.googleapis.com', 'aiplatform.googleapis.com'])
// A phone number looked up in a messaging app — wa.me/<number> and WhatsApp's send links, Telegram's t.me/+<number>,
// Signal's signal.me/#p/<number> — is a presence check, which skill-osint never makes (spec § 5 and § 11.6). The apps'
// other public pages (a channel t.me/<name>, a group invite) stay readable.
// Tested on the normalised URL (host without its final dot or www, default port dropped, path and fragment decoded),
// so wa.me:443, wa.me. and t.me/%2B33… are caught as wa.me and t.me/+33… are.
export function isMessaging(href) {
  let u
  try { u = new URL(String(href)) } catch { return false }
  if (!/^https?:$/.test(u.protocol)) return false
  const host = u.hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '')
  const dec = x => { try { return decodeURIComponent(x) } catch { return x } }
  const p = dec(u.pathname).replace(/\/{2,}/g, '/')
  return host === 'wa.me' || /^(api|web)\.whatsapp\.com$/.test(host) && /^\/send(\/|$)/i.test(p)
    || /^(t|telegram)\.me$/.test(host) && /^\/\+\d{6,15}(\/|$)/.test(p) || host === 'signal.me' && dec(u.hash).startsWith('#p/')
}
export const MESSAGING_REFUSAL = 'refused: a messaging app looked up by phone number is a presence check, which skill-osint never makes (no call, no text, no WhatsApp, Telegram or Signal lookup)'
// the ports of SMTP: skill-osint never talks to a mail server (asking it RCPT TO about an address contacts the target)
export const SMTP_PORTS = new Set(['25', '465', '587', '2525'])
const refuseSmtp = u => { if (SMTP_PORTS.has(u.port)) fail(`refused: skill-osint never talks to a mail server (port ${u.port})`) }
const SENSITIVE = /^(authorization|proxy-authorization|cookie|x-.*(key|token|secret|auth|session).*)$/i
export const UA = `skill-osint/${VERSION} (+https://github.com/Pabrisson/claude-plugins)`

// a page of the web is never fetched on this machine or its network (a link or a redirect could aim there), unless
// OSINT_BASE_WEB points the web at the tests' fake server
export function isLocalAddress(host) {
  const h = String(host).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.') && !net.isIP(h)) return true
  let a = parseIp(h) // an IPv4-mapped address (::ffff:7f00:1 as URL writes it) is already its IPv4
  if (!a) return false
  // an IPv4 inside an IPv6 (::/96, 64:ff9b::/96 NAT64, 2002::/16 6to4) is judged as that IPv4
  if (a.v === 6) {
    if (a.n >> 32n === 0n || inCidr(a, '64:ff9b::/96')) a = { v: 4, n: a.n & 0xffffffffn }
    else if (inCidr(a, '2002::/16')) a = { v: 4, n: (a.n >> 80n) & 0xffffffffn }
  }
  return !!special(a)
}
async function checkPublic(host) {
  if (isLocalAddress(host)) fail(`refused: ${host} is on this machine or its network`)
  if (net.isIP(host)) return
  const addrs = await dns.promises.lookup(host, { all: true }).catch(() => [])
  const bad = addrs.find(a => isLocalAddress(a.address))
  if (bad) fail(`refused: ${host} resolves to ${bad.address}, on this machine or its network`)
}

export function target(service, pathOrUrl) {
  if (service === 'web') {
    const u = new URL(pathOrUrl), base = process.env.OSINT_BASE_WEB
    refuseSmtp(u)
    return { url: base ? `${base}/${u.host}${u.pathname}${u.search}` : u.href, host: u.hostname, real: !base }
  }
  const real = SERVICES[service]
  if (!real) fail(`unknown service ${service}`)
  const base = process.env[`OSINT_BASE_${service.toUpperCase()}`]
  return { url: `${base ?? real}${pathOrUrl}`, host: new URL(real).hostname, real: !base }
}

const last = new Map()
export async function request(service, pathOrUrl, { method = 'GET', headers = {}, body, timeout = 20000, max = 5e6, retries = 0, cacheDir = null, cacheHours = 0, accept, follow = true } = {}) {
  const t = target(service, pathOrUrl)
  if (DENY.has(t.host)) fail(`refused: skill-osint never calls ${t.host}`)
  if (service === 'web' && isMessaging(pathOrUrl)) fail(MESSAGING_REFUSAL)
  const guard = service === 'web' && t.real
  if (guard) await checkPublic(t.host)
  const key = cacheDir && cacheHours ? path.join(cacheDir, `${sha256(`${method} ${t.url}`)}.json`) : null
  if (key) {
    try { const c = JSON.parse(fs.readFileSync(key, 'utf8')); if (Date.now() - c.at < cacheHours * 3600e3) return { ...c, body: Buffer.from(c.body, 'base64'), cached: true } } catch {}
  }
  const t0 = Date.now()
  for (let attempt = 0; ; attempt++) {
    const wait = (last.get(t.host) ?? 0) + (GAP[service] ?? 1000) - Date.now()
    if (wait > 0) await sleep(wait)
    last.set(t.host, Date.now())
    let res, url = t.url, host = t.host, sent = headers
    try {
      for (let hop = 0; ; hop++) {
        res = await fetch(url, {
          method, body, redirect: 'manual', signal: AbortSignal.timeout(timeout),
          headers: { 'user-agent': UA, ...(accept && { accept }), ...(!t.real && { 'x-osint-host': host }), ...sent },
        })
        const loc = res.headers.get('location')
        if (!follow || res.status < 300 || res.status >= 400 || !loc || hop >= 5) break
        const next = new URL(loc, url)
        if (isMessaging(next.href)) fail(MESSAGING_REFUSAL)
        if (DENY.has(next.hostname)) fail(`refused: skill-osint never calls ${next.hostname}`)
        refuseSmtp(next)
        if (t.real) await checkPublic(next.hostname) // every hop of a real service, whichever it is
        // a credential (the Mapillary token, a cookie, a key) never follows a redirect to another host
        if (next.host !== new URL(url).host) sent = Object.fromEntries(Object.entries(sent).filter(([k]) => !SENSITIVE.test(k)))
        url = next.href
        if (t.real) host = next.hostname
      }
    } catch (e) {
      if (e.userError) throw e
      if (attempt < retries) { await sleep(2 ** attempt * 1000); continue }
      throw new Error(`${t.host}: ${e.name === 'TimeoutError' ? `no answer in ${timeout / 1000} s` : e.cause?.code ?? e.message}`)
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const after = Number(res.headers.get('retry-after'))
      await sleep((after > 0 && after < 120 ? after : 2 ** attempt) * 1000)
      continue
    }
    const chunks = []
    let size = 0, truncated = false
    const reader = res.body?.getReader()
    if (reader) for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value); size += value.length
      if (size > max) { truncated = true; await reader.cancel(); break }
    }
    const out = { url: t.real ? url : t.url, status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.concat(chunks), ms: Date.now() - t0, truncated, cached: false }
    if (key && res.status === 200) { fs.mkdirSync(cacheDir, { recursive: true }); fs.writeFileSync(key, JSON.stringify({ ...out, at: Date.now(), body: out.body.toString('base64') })) }
    return out
  }
}

// DNS: $OSINT_DNS (the tests' and the demo's fixture: { "<name>": { "A": […], "MX": [{ exchange, priority }], … } })
// or this machine's resolver; a name without that record answers []
const EMPTY = new Set(['ENODATA', 'ENOTFOUND', 'ENOTIMP', 'ESERVFAIL', 'EREFUSED', 'ETIMEOUT', 'ECONNREFUSED'])
export function resolver() {
  if (process.env.OSINT_DNS) {
    const zone = JSON.parse(fs.readFileSync(process.env.OSINT_DNS, 'utf8'))
    return { resolve: async (name, rr) => zone[name.toLowerCase()]?.[rr] ?? [] }
  }
  const r = new dns.promises.Resolver({ timeout: 5000, tries: 2 })
  return { resolve: (name, rr) => r.resolve(name, rr).then(x => (Array.isArray(x) ? x : [x]), e => (EMPTY.has(e.code) ? [] : Promise.reject(e))) }
}

// the free APIs' own limits (XposedOrNot: 2 a second, 25 an hour, 100 a day; the seconds are GAP's)
export const QUOTAS = { xon: { hour: 25, day: 100 } }
// for the whole cases folder and across runs: the calls of the last 24 hours in <home>/.cache/quota-<name>.json; a call
// within the limits is counted, one over them is refused with the time the next one is allowed. Read-modify-write under
// a lock (the cases folder's own mkdir lock), so two engines at once never take the same slot.
export function quota(home, name, now = Date.now()) {
  const lim = QUOTAS[name]
  if (!lim) fail(`no quota for ${name}`)
  const f = path.join(home, '.cache', `quota-${name}.json`), lockDir = path.join(home, '.cache', `quota-${name}.lock`)
  fs.mkdirSync(path.join(lockDir, '.osint'), { recursive: true })
  return withLock(lockDir, () => {
    const calls = (readJson(f, { calls: [] }).calls ?? []).filter(t => now - t < 86400e3)
    const hour = calls.filter(t => now - t < 3600e3)
    if (hour.length >= lim.hour) return { ok: false, limit: `${lim.hour} calls an hour`, next: new Date(hour[0] + 3600e3).toISOString() }
    if (calls.length >= lim.day) return { ok: false, limit: `${lim.day} calls a day`, next: new Date(calls[0] + 86400e3).toISOString() }
    writeAtomic(f, JSON.stringify({ calls: [...calls, now] }))
    return { ok: true, left: { hour: lim.hour - hour.length - 1, day: lim.day - calls.length - 1 } }
  })
}
