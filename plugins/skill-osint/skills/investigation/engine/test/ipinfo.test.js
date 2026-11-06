import assert from 'node:assert/strict'
import test from 'node:test'
import { asHolder, internetDb, networkInfo, ripestat, vcardName } from '../lib/ipinfo.js'
import { request } from '../lib/net.js'
import { fakeEnv, startFake } from './fake.mjs'

const fake = await startFake()
test.after(() => fake.close())
Object.assign(process.env, fakeEnv(fake.url))
const ctx = { fetch: (service, p, opts) => request(service, p, opts) }

test('network-info, autnum and InternetDB through ctx.fetch, IPv4 and IPv6; a 404 from InternetDB is « unknown to Shodan »', async () => {
  assert.deepEqual(await networkInfo(ctx, '1.1.1.1'), { asn: '13335', asns: ['13335'], prefix: '1.1.1.0/24' })
  assert.deepEqual(await networkInfo(ctx, '2606:4700:4700::1111'), { asn: '13335', asns: ['13335'], prefix: '2606:4700:4700::/48' })
  assert.equal(await asHolder(ctx, '64500'), 'Exemple Hébergement SAS')
  assert.equal(await asHolder(ctx, '64999'), null)
  const open = await internetDb(ctx, '1.1.1.1')
  assert.deepEqual([open.known, open.ports.slice(0, 4), open.hostnames, open.tags], [true, [53, 69, 80, 443], ['one.one.one.one', 'meusite.ifood.com.br', 'guestwebauth.regeneron.com'], ['pqc']])
  assert.deepEqual((await internetDb(ctx, '2606:4700:4700::1111')).tags, ['cdn'])
  assert.deepEqual(await internetDb(ctx, '203.0.113.99'), { known: false, ports: [], hostnames: [], cpes: [], vulns: [], tags: [] })
  await assert.rejects(ripestat(ctx, 'whois', '203.0.113.99'), /RIPEstat whois answered 404/)
  assert.equal(vcardName({ vcardArray: ['vcard', [['fn', {}, 'text', 'Cloudflare, Inc.']]] }), 'Cloudflare, Inc.')
  assert.ok(fake.seen.some(s => s.service === 'ripestat' && s.query.get('sourceapp') === 'skill-osint'))
})

test('InternetDB is third-party text: only what looks like a port, a host name, a CPE, a CVE id or a tag is kept', async () => {
  const hostile = { ports: [443, 'x', 70000, 80, 80], hostnames: ['ok.example', '![x](http://evil.example/a.png)', 'two\nlines.example', 'A.Example', '%%osint:end%%'], cpes: ['cpe:/a:nginx:nginx', '[l](http://e)'], vulns: ['CVE-2024-0001', 'CVE-1 <script>'], tags: ['cdn', '`x`', 'a\nb'] }
  const fake = { fetch: async () => ({ status: 200, body: Buffer.from(JSON.stringify(hostile)) }) }
  assert.deepEqual(await internetDb(fake, '203.0.113.7'), { known: true, ports: [80, 443], hostnames: ['ok.example', 'a.example'], cpes: ['cpe:/a:nginx:nginx'], vulns: ['CVE-2024-0001'], tags: ['cdn'] })
})
