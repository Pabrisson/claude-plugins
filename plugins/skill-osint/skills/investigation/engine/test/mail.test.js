import assert from 'node:assert/strict'
import test from 'node:test'
import { mailProvider, parseAddress } from '../lib/mail.js'

test('parseAddress: one address whatever its form', () => {
  for (const s of ['jo@example.org', ' MAILTO:Jo@Example.ORG ', 'Jo Durand <jo@EXAMPLE.org.>', 'mailto:jo@example.org?subject=hi'])
    assert.equal(parseAddress(s)?.address, 'jo@example.org', s)
  for (const s of ['', 'jo', 'jo@', '@example.org', 'jo@localhost', 'a@b@example.org', 'jo durand@example.org', null]) assert.equal(parseAddress(s), null, String(s))
  assert.equal(parseAddress('jo@exämple.org').domain, 'xn--exmple-cua.org')
})

test('parseAddress: Gmail ignores dots and +tags; a +tag elsewhere is kept; a role address; a public webmail', () => {
  const g = parseAddress('Some.Name+news@googlemail.com')
  assert.deepEqual([g.address, g.local, g.user, g.tag, g.domain, g.gmail, g.webmail, g.role], ['some.name+news@googlemail.com', 'some.name+news', 'some.name', 'news', 'googlemail.com', 'somename@gmail.com', true, false])
  assert.deepEqual(g.aliases, ['somename@gmail.com', 'somename@googlemail.com'])
  assert.deepEqual(parseAddress('somename@gmail.com').aliases, ['somename@googlemail.com'])
  const t = parseAddress('jo+shop@example.org')
  assert.deepEqual([t.user, t.tag, t.gmail, t.aliases, t.webmail], ['jo', 'shop', null, [], false])
  const c = parseAddress('Contact@Durand-Bakery.example')
  assert.deepEqual([c.address, c.user, c.domain, c.role, c.webmail], ['contact@durand-bakery.example', 'contact', 'durand-bakery.example', true, false])
})

test('mailProvider: the first MX or SPF host whose provider is known', () => {
  assert.equal(mailProvider(['aspmx.l.google.com']), 'Google Workspace')
  assert.equal(mailProvider(['gmail-smtp-in.l.google.com.']), 'Google Workspace')
  assert.equal(mailProvider(['durand-bakery-example.mail.protection.outlook.com']), 'Microsoft 365')
  assert.equal(mailProvider(['mx1.mail.ovh.net']), 'OVHcloud')
  assert.equal(mailProvider(['_spf.protonmail.ch']), 'Proton Mail')
  assert.equal(mailProvider(['mx01.mail.icloud.com']), 'iCloud Mail')
  assert.equal(mailProvider(['mx.example.org', 'spf.protection.outlook.com']), 'Microsoft 365')
  assert.equal(mailProvider(['mx.example.org']), null)
  assert.equal(mailProvider([]), null)
})
