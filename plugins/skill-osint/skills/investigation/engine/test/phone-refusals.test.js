import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { isMessaging, request } from '../lib/net.js'
import { loadEngine, loadTypes } from '../lib/types.js'
import { fixtureOf, SERVICES } from './fake.mjs'
import { casesFolder, FIXTURES, NEW, run } from './helpers.js'

// a phone number looked up in a messaging app: each link tells whether the number has an account there
const LOOKUPS = ['https://wa.me/33199001234', 'https://wa.me/+33199001234', 'https://wa.me/c/33199001234', 'https://api.whatsapp.com/send?phone=33199001234',
  'https://web.whatsapp.com/send?phone=33199001234', 'https://t.me/+33199001234', 'https://telegram.me/+33199001234', 'https://signal.me/#p/+33199001234',
  'https://wa.me:443/33199001234', 'https://wa.me./33199001234', 'https://t.me/%2B33199001234', 'https://SIGNAL.me:443/#p/+33199001234', 'https://signal.me/#p/%2B33199001234', 'https://T.ME./+33199001234', 'https://api.whatsapp.com:443/send/?phone=33199001234']

test('a messaging app looked up by phone number is refused before any request; the apps\' other public pages are not', async () => {
  for (const u of LOOKUPS) await assert.rejects(request('web', u), /presence check/, u)
  for (const u of ['https://t.me/durand_bakery', 'https://t.me/+AbCdEf12345', 'https://chat.whatsapp.com/AbCdEf', 'https://www.whatsapp.com/legal']) assert.ok(!isMessaging(u), u)
})

test('nor can such a page be recorded as a source, even one the agent read itself', async () => {
  const home = casesFolder(), cap = path.join(home, 'wa.html'), dir = path.join(home, 'durand-bakery-example')
  fs.writeFileSync(cap, '<html><title>WhatsApp</title></html>')
  await run(home, NEW)
  const r = await run(home, ['source', 'https://wa.me/33199001234', '--file', cap, '-p', 'durand-bakery-example'])
  assert.equal(r.status, 1)
  assert.match(r.err, /presence check/)
  assert.ok(!fs.existsSync(path.join(dir, 'Sources')) || fs.readdirSync(path.join(dir, 'Sources')).length === 0)
})

test('the fake server answers for the ARCEP with the real files, kept in ISO-8859-1', () => {
  assert.ok(SERVICES.includes('arcep'))
  assert.equal(fixtureOf('arcep', 'uploads/MAJNUM.csv', new URLSearchParams()), 'arcep/uploads/MAJNUM.csv')
  const head = fs.readFileSync(path.join(FIXTURES, 'arcep', 'uploads', 'MAJNUM.csv'), 'latin1').split('\n')[0]
  assert.equal(head, 'EZABPQM;Tranche_Debut;Tranche_Fin;Mnémo;Territoire;Date_Attribution')
})

test('a redirect to a messaging lookup is refused too, before the hop is followed', async () => {
  const hops = []
  const srv = http.createServer((req, res) => { hops.push(req.url); res.writeHead(302, { location: 'https://wa.me/33199001234' }); res.end() })
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok))
  const was = process.env.OSINT_BASE_WEB
  process.env.OSINT_BASE_WEB = `http://127.0.0.1:${srv.address().port}`
  try {
    await assert.rejects(request('web', 'https://short.example/x', { retries: 0 }), /presence check/)
    assert.equal(hops.length, 1)
  } finally { if (was === undefined) delete process.env.OSINT_BASE_WEB; else process.env.OSINT_BASE_WEB = was; srv.close() }
})

test('no command, input, action, view or refresh step of the phone type calls, texts or checks a messaging app; its method says never', async () => {
  const m = loadTypes().find(t => t.id === 'phone')
  assert.doesNotMatch(JSON.stringify([m.inputs, m.actions, m.refresh, m.views]), /\b(call|calls|sms|whatsapp|telegram|signal|viber|hlr)\b/i)
  assert.match(fs.readFileSync(path.join(m.dir, 'method.md'), 'utf8'), /^Hard rules: never call the number, never text it, never check whether it has an account on WhatsApp, Telegram, Signal or any app that syncs contacts\./m)
  const home = casesFolder()
  await run(home, ['new', 'phone', '+33 1 99 00 12 34', '--question', 'Who answers?', '--frame', 'noisy=never', '--title', 'fiction'])
  for (const c of ['call', 'sms', 'whatsapp', 'telegram']) {
    const r = await run(home, ['phone', c, '-p', 'fiction'])
    assert.equal(r.status, 1, c)
    assert.match(r.err, /phone: collect$/m, c)
  }
})

test('the phone engine reaches the network only for its three open datasets: no lookup of the number, no holder service', async () => {
  const m = loadTypes().find(t => t.id === 'phone'), { SETS } = await loadEngine(m)
  assert.deepEqual(Object.values(SETS).map(s => s.service).sort(), ['arcep', 'arcep', 'raw'])
  assert.deepEqual(Object.values(SETS).map(s => s.path).sort(), ['/google/libphonenumber/master/resources/PhoneNumberMetadata.xml', '/uploads/MAJNUM.csv', '/uploads/identifiants_CE.csv'])
  assert.doesNotMatch(fs.readFileSync(path.join(m.dir, 'engine.js'), 'utf8'), /ctx\.fetch|request\(|\bfetch\(|ctx\.tunnel|child_process/)
})
