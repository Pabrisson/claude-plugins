// lib/ipinfo.js — what free registries say about one IP address, shared by the domain type (its host step) and the
// ip type: a RIPEstat data call (with sourceapp, its envelope checked), network-info (ASN, prefix), RDAP autnum (the
// AS holder) and Shodan InternetDB (ports, hostnames, CPE, CVE ids from Shodan's own scans: noted, never tested; a
// 404 means Shodan knows nothing of the address). Every call goes through ctx.fetch: the gap per host, one Journal
// entry per request. What InternetDB lists is third-party text on its way into notes: only what looks like a port, a
// host name, a CPE, a CVE id or a tag is kept.
const json = r => JSON.parse(r.body.toString('utf8'))
export const vcardName = e => e?.vcardArray?.[1]?.find(x => x[0] === 'fn')?.[3] ?? null
export async function ripestat(ctx, call, resource) {
  const r = await ctx.fetch('ripestat', `/data/${call}/data.json?resource=${encodeURIComponent(resource)}&sourceapp=skill-osint`, { retries: 1 })
  let j = null
  try { j = r.status === 200 ? json(r) : null } catch { /* not JSON: refused below */ }
  if (j?.status !== 'ok') throw new Error(`RIPEstat ${call} answered ${r.status}${j?.messages?.length ? ` (${j.messages.map(m => m[1]).join('; ')})` : ''}`)
  return j.data ?? {}
}
export async function networkInfo(ctx, ip) {
  const d = await ripestat(ctx, 'network-info', ip)
  return { asn: d.asns?.[0] ?? null, asns: d.asns ?? [], prefix: d.prefix ?? null }
}
export async function asHolder(ctx, asn) {
  const a = await ctx.fetch('rdap', `/autnum/${asn}`, { accept: 'application/rdap+json', retries: 1 })
  if (a.status !== 200) return null
  const j = json(a)
  return vcardName((j.entities ?? []).find(e => e.roles?.includes('registrant'))) ?? j.name ?? null
}
const only = (xs, re) => [...new Set((Array.isArray(xs) ? xs : []).map(x => String(x ?? '').trim()).filter(x => re.test(x)))]
export async function internetDb(ctx, ip) {
  const r = await ctx.fetch('internetdb', `/${ip}`)
  if (r.status === 404) return { known: false, ports: [], hostnames: [], cpes: [], vulns: [], tags: [] }
  if (r.status !== 200) throw new Error(`InternetDB answered ${r.status}`)
  const j = json(r)
  return {
    known: true,
    ports: [...new Set((Array.isArray(j.ports) ? j.ports : []).filter(p => Number.isInteger(p) && p >= 0 && p <= 65535))].sort((a, b) => a - b),
    hostnames: only(j.hostnames, /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,252}$/).map(h => h.toLowerCase()),
    cpes: only(j.cpes, /^cpe:[A-Za-z0-9:/._~*+-]{1,200}$/),
    vulns: only(j.vulns, /^CVE-\d{4}-\d{4,10}$/i),
    tags: only(j.tags, /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/),
  }
}
