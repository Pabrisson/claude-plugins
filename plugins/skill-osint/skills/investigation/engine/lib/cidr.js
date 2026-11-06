// lib/cidr.js — IPv4 and IPv6 addresses and prefixes as BigInt, in plain JavaScript (no node:net: the dashboard
// imports it through kinds.js). Parse an address, write its canonical text (dotted quad; RFC 5952 for IPv6; an
// IPv4-mapped IPv6 address is its IPv4), test its membership in a CIDR, name the special-purpose ranges that no
// public registry describes. The documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32)
// are not special here: the tests and the demo use them.
const OCTET = '(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)'
const V4 = new RegExp(`^${OCTET}(\\.${OCTET}){3}$`)
const v4 = s => (V4.test(s) ? s.split('.').reduce((n, o) => (n << 8n) | BigInt(o), 0n) : null)
function v6(s) {
  const tail = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s) // an IPv4 tail (::ffff:1.2.3.4) becomes two groups
  if (tail) {
    const n = v4(tail[2])
    if (n == null) return null
    s = `${tail[1]}${(n >> 16n).toString(16)}:${(n & 0xffffn).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : [], rest = halves[1] ? halves[1].split(':') : []
  const gap = 8 - head.length - rest.length
  if (halves.length === 2 ? gap < 1 : head.length !== 8) return null
  const groups = [...head, ...Array(halves.length === 2 ? gap : 0).fill('0'), ...rest]
  return groups.every(g => /^[0-9a-f]{1,4}$/.test(g)) ? groups.reduce((n, g) => (n << 16n) | BigInt(`0x${g}`), 0n) : null
}
function raw(s) {
  const t = String(s ?? '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1').replace(/%[\w.-]+$/, '')
  const n = t.includes(':') ? v6(t) : v4(t)
  return n == null ? null : { v: t.includes(':') ? 6 : 4, n }
}
export function parseIp(s) {
  const a = raw(s)
  return a && a.v === 6 && a.n >> 32n === 0xffffn ? { v: 4, n: a.n & 0xffffffffn } : a
}
export function ipText({ v, n }) {
  if (v === 4) return [24n, 16n, 8n, 0n].map(s => (n >> s) & 255n).join('.')
  const g = Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(112 - 16 * i)) & 0xffffn))
  let at = -1, len = 0
  for (let i = 0, j; i < 8; i = j + 1) {
    for (j = i; j < 8 && g[j] === 0; j++);
    if (j - i > len) [at, len] = [i, j - i]
  }
  const hex = a => a.map(x => x.toString(16)).join(':')
  return len < 2 ? hex(g) : `${hex(g.slice(0, at))}::${hex(g.slice(at + len))}`
}
export const canonicalIp = s => { const a = parseIp(s); return a ? ipText(a) : null }
export function parseCidr(s) {
  const [addr, bits, more] = String(s ?? '').trim().split('/')
  const a = more === undefined ? raw(addr) : null
  if (!a) return null
  const width = a.v === 4 ? 32 : 128, b = bits === undefined ? width : /^\d{1,3}$/.test(bits) ? Number(bits) : NaN
  return b >= 0 && b <= width ? { v: a.v, n: a.n, bits: b } : null
}
export function inCidr(ip, cidr) {
  const a = typeof ip === 'string' ? parseIp(ip) : ip, c = typeof cidr === 'string' ? parseCidr(cidr) : cidr
  if (!a || !c || a.v !== c.v) return false
  const shift = BigInt((c.v === 4 ? 32 : 128) - c.bits)
  return a.n >> shift === c.n >> shift
}
const SPECIAL = [
  ['0.0.0.0/8', 'this network'], ['10.0.0.0/8', 'private'], ['100.64.0.0/10', 'shared (carrier-grade NAT)'], ['127.0.0.0/8', 'loopback'],
  ['169.254.0.0/16', 'link-local'], ['172.16.0.0/12', 'private'], ['192.0.0.0/24', 'reserved (IETF protocol)'], ['192.168.0.0/16', 'private'], ['198.18.0.0/15', 'reserved (benchmarking)'], ['224.0.0.0/4', 'multicast'], ['240.0.0.0/4', 'reserved'],
  ['::/128', 'unspecified'], ['::1/128', 'loopback'], ['fc00::/7', 'unique local (private)'], ['fe80::/10', 'link-local'], ['fec0::/10', 'reserved (site-local)'], ['ff00::/8', 'multicast'],
].map(([cidr, name]) => ({ ...parseCidr(cidr), cidr, name }))
export function special(ip) {
  const a = typeof ip === 'string' ? parseIp(ip) : ip, r = a && SPECIAL.find(x => inCidr(a, x))
  return r ? { cidr: r.cidr, name: r.name } : null
}
