import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { canonicalIp, inCidr, ipText, parseCidr, parseIp, special } from '../lib/cidr.js'
import { normalize } from '../lib/kinds.js'
import { readNote } from '../lib/vault.js'
import { casesFolder, NEW, run } from './helpers.js'

test('addresses: strict IPv4, IPv6 in every spelling, the canonical text of RFC 5952, IPv4-mapped is IPv4', () => {
  assert.equal(canonicalIp(' 1.1.1.1 '), '1.1.1.1')
  for (const s of ['2606:4700:4700::1111', '2606:4700:4700:0:0:0:0:1111', '2606:4700:4700:0000:0000:0000:0000:1111', '2606:4700:4700::1111'.toUpperCase(), '[2606:4700:4700::1111]']) assert.equal(canonicalIp(s), '2606:4700:4700::1111', s)
  assert.equal(canonicalIp('2001:db8:0:1:1:1:1:1'), '2001:db8:0:1:1:1:1:1') // a single zero group is never ::
  assert.equal(canonicalIp('2001:0:0:1:0:0:0:1'), '2001:0:0:1::1') // the longest run of zeros
  assert.equal(canonicalIp('2001:db8:0:0:1:0:0:1'), '2001:db8::1:0:0:1') // the first of two equal runs
  assert.deepEqual(['::', '::1', '1::', 'fe80::1%en0'].map(canonicalIp), ['::', '::1', '1::', 'fe80::1'])
  assert.equal(canonicalIp('::ffff:104.16.0.1'), '104.16.0.1')
  assert.equal(canonicalIp('::ffff:6810:1'), '104.16.0.1')
  assert.equal(canonicalIp('64:ff9b::1.2.3.4'), '64:ff9b::102:304') // only ::ffff:0:0/96 is IPv4-mapped
  assert.deepEqual(parseIp('1.2.3.4'), { v: 4, n: 0x01020304n })
  assert.equal(ipText({ v: 6, n: 0n }), '::')
  for (const bad of ['', '1.1.1', '1.1.1.1.1', '256.1.1.1', '01.1.1.1', '1.1.1.1/24', '1.2.3.4:80', '1::2::3', ':::', '1:2:3:4:5:6:7:8:9', '1:2:3:4:5:6:7::8', 'g::1', '::1.2.3', 'example.org', null]) assert.equal(parseIp(bad), null, String(bad))
})

test('membership: the bounds of a prefix, IPv6 compressed or not, IPv4-mapped against IPv4 prefixes, never across versions', () => {
  assert.ok(inCidr('1.1.1.0', '1.1.1.0/24') && inCidr('1.1.1.255', '1.1.1.0/24'))
  assert.ok(!inCidr('1.1.0.255', '1.1.1.0/24') && !inCidr('1.1.2.0', '1.1.1.0/24'))
  assert.ok(inCidr('104.23.255.255', '104.16.0.0/13') && !inCidr('104.24.0.0', '104.16.0.0/13'))
  assert.ok(inCidr('8.8.8.8', '0.0.0.0/0') && inCidr('9.9.9.9', '9.9.9.9') && inCidr('9.9.9.9', '9.9.9.9/32') && !inCidr('9.9.9.8', '9.9.9.9/32'))
  assert.ok(inCidr('2606:4700::', '2606:4700::/32') && inCidr('2606:4700:ffff:ffff:ffff:ffff:ffff:ffff', '2606:4700::/32'))
  assert.ok(!inCidr('2606:4701::', '2606:4700::/32') && !inCidr('2606:46ff:ffff:ffff:ffff:ffff:ffff:ffff', '2606:4700::/32'))
  assert.ok(inCidr('2606:4700:4700:0:0:0:0:1111', '2606:4700:4700::/48'))
  assert.ok(inCidr('2a06:98c7:ffff::1', '2a06:98c0::/29') && !inCidr('2a06:98c8::', '2a06:98c0::/29'))
  assert.ok(inCidr('::ffff:104.16.0.1', '104.16.0.0/13'))
  assert.ok(!inCidr('104.16.0.1', '::/0') && !inCidr('::1', '0.0.0.0/0'))
  assert.ok(inCidr('1.1.1.77', '1.1.1.1/24')) // host bits written in a prefix are ignored
  for (const bad of ['1.1.1.0/33', '2606::/129', '1.1.1.0/', '1.1.1.0/x', '1.1.1.0/24/1', 'nope/8']) assert.equal(parseCidr(bad), null, bad)
  assert.deepEqual([inCidr('1.1.1.1', 'nope'), inCidr('nope', '1.1.1.0/24')], [false, false])
})

test('special-purpose ranges are named; public and documentation addresses are not', () => {
  const ips = ['10.1.2.3', '172.31.255.255', '192.168.1.1', '100.64.0.1', '127.0.0.1', '169.254.1.1', '224.0.0.1', '255.255.255.255', '0.1.2.3', '::', '::1', 'fd00::1', 'fe80::1', 'ff02::1', '::ffff:192.168.0.1']
  assert.deepEqual(ips.map(ip => special(ip)?.name), ['private', 'private', 'private', 'shared (carrier-grade NAT)', 'loopback', 'link-local', 'multicast', 'reserved', 'this network', 'unspecified', 'loopback', 'unique local (private)', 'link-local', 'multicast', 'private'])
  assert.equal(special('10.1.2.3').cidr, '10.0.0.0/8')
  for (const ip of ['1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '192.0.2.10', '198.51.100.7', '2001:db8::1']) assert.equal(special(ip), null, ip)
})

test('an IP entity keeps its canonical form: two spellings make one note, and one key across cases', async () => {
  const home = casesFolder(), dir = path.join(home, 'durand-bakery-example'), P = ['-p', 'durand-bakery-example']
  await run(home, NEW)
  for (const v of ['2606:4700:4700:0:0:0:0:1111', '[2606:4700:4700::1111]', '::ffff:192.0.2.10', '192.0.2.10']) assert.equal((await run(home, ['entity', 'ip', v, ...P])).status, 0, v)
  assert.deepEqual(fs.readdirSync(path.join(dir, 'Entities')).sort(), ['192.0.2.10.md', '2606-4700-4700--1111.md'])
  assert.equal(readNote(path.join(dir, 'Entities', '2606-4700-4700--1111.md')).props.value, '2606:4700:4700::1111')
  assert.equal(normalize('ip', '2606:4700:4700:0:0:0:0:1111'), 'ip:2606:4700:4700::1111')
  assert.equal(normalize('ip', 'Not An IP'), 'ip:not an ip')
})
