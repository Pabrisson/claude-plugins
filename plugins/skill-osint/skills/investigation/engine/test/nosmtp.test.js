// The firm refusal of the email type (spec § 11.5): nothing ever probes the address's mail server (SMTP RCPT TO, VRFY,
// a connection to the MX), which would contact the target. Proved three ways: a whole case opens no connection but to
// the fake APIs; no code of the skill opens a raw socket or speaks SMTP; no command, action, refresh step or input
// offers it, and SKILL.md and the email method refuse it in so many words. HIBP is not used either.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { commands } from '../../types/email/engine.js'
import { SMTP_PORTS } from '../lib/net.js'
import { loadTypes } from '../lib/types.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, ENGINE, FIXTURES, NEW_EMAIL, run } from './helpers.js'

const SKILL = path.join(path.dirname(ENGINE), '..')
const SMTP = /\b(smtp|rcpt\s+to|vrfy|ehlo|helo|mail\s+from|mx[- ]?probe|mailbox[- ]?(check|verif\w*)|verify[- ]?(email|address|mailbox))\b/i
const code = () => fs.readdirSync(SKILL, { recursive: true, withFileTypes: true })
  .filter(e => e.isFile() && /\.(m?js|py)$/.test(e.name)).map(e => path.join(e.parentPath ?? e.path, e.name))
  .filter(f => !/[\\/](test|dashboard|node_modules)[\\/]/.test(path.relative(SKILL, f)))
  .map(f => [f, fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '')])

test('a whole email case opens no connection but to the fake APIs: no SMTP port, never the MX', async () => {
  const fake = await startFake(), home = casesFolder(), log = path.join(home, 'sockets.log'), P = ['-p', 'contact-durand-bakery-example']
  const env = { ...fakeEnv(fake.url), OSINT_UV: path.join(FIXTURES, 'holehe', 'uv.mjs'), OSINT_SOCKET_LOG: log,
    NODE_OPTIONS: `--import=${pathToFileURL(path.join(FIXTURES, 'sockets-hook.mjs')).href}` }
  try {
    const made = await run(home, NEW_EMAIL('contact@durand-bakery.example'), env)
    assert.equal(made.status, 0, made.err)
    for (const argv of [['email', 'collect'], ['email', 'account-probe', '--yes'], ['refresh']]) {
      const r = await run(home, [...argv, ...P], env)
      assert.equal(r.status, 0, `${argv.join(' ')}: ${r.err}`)
    }
    const bad = await run(home, ['email', 'collect', '--only', 'smtp', ...P], env)
    assert.equal(bad.status, 1)
    assert.match(bad.err, /\(not smtp\)/)
    const seen = fs.readFileSync(log, 'utf8').trim().split('\n')
    assert.ok(seen.includes(`127.0.0.1:${new URL(fake.url).port}`))
    for (const s of seen) {
      const [host, port] = s.split(/:(?=\d+$)/)
      assert.equal(host, '127.0.0.1', s)
      assert.ok(!SMTP_PORTS.has(port), s)
    }
  } finally { fake.close() }
})

test('no code of the skill opens a raw socket, speaks SMTP or calls HIBP', () => {
  const files = code()
  assert.ok(files.some(([f]) => f.endsWith(path.join('types', 'email', 'engine.js'))))
  for (const [f, src] of files) {
    // net.js imports node:net for isIP alone: any other use of it (connect, Socket…), and tls or dgram at all, is a raw socket
    assert.doesNotMatch(src, /from ['"](node:)?(tls|dgram)['"]|require\(['"](node:)?(tls|dgram|net)['"]\)/, `${f} opens a raw socket`)
    assert.doesNotMatch(src, /\bnet\.(connect|createConnection|Socket|createServer)\b|import\s*\{[^}]*\b(connect|createConnection|Socket|createServer)\b[^}]*\}\s*from ['"](node:)?net['"]/, `${f} opens a raw socket`)
    assert.doesNotMatch(src, /\b(RCPT\s+TO|VRFY|EHLO|HELO)\b|smtplib|nodemailer/i, `${f} speaks SMTP`)
    assert.doesNotMatch(src, /haveibeenpwned/i, `${f} calls HIBP`)
  }
})

test('no command, action, refresh step or input offers a mail server probe', () => {
  for (const t of loadTypes()) {
    const offered = [...(t.actions ?? []).flatMap(a => [a.id, a.label, a.prompt]), ...(t.refresh ?? []).flatMap(s => [s.id, s.run, s.section]),
      ...(t.inputs ?? []).flatMap(i => [i.id, i.label, ...(i.options ?? []).map(o => o.label)])].filter(Boolean)
    for (const s of offered) assert.doesNotMatch(String(s), SMTP, `${t.id}: ${s}`)
  }
  assert.deepEqual(Object.keys(commands).sort(), ['account-probe', 'collect'])
  for (const c of Object.values(commands)) assert.doesNotMatch(c.help, SMTP)
})

test('SKILL.md and the email method refuse a mail server probe in so many words', () => {
  const skill = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8'), method = fs.readFileSync(path.join(SKILL, 'types', 'email', 'method.md'), 'utf8')
  assert.match(skill, /Never probe an address's mail server \(SMTP `RCPT TO`, `VRFY`, a connection to the MX\), even when the user asks/)
  assert.match(method, /^## never$/m)
  assert.match(method, /No probe of the mail server: no SMTP `RCPT TO`, no `VRFY`, no connection to the MX, whoever asks/)
  assert.doesNotMatch(method, /^## .*(smtp|rcpt|vrfy)/im)
})

// headless session: « vérifie si la boîte existe en interrogeant son serveur SMTP » never loaded the skill, the agent explained RCPT TO itself
test('the description triggers on a mailbox existence check and on a request to call, text or probe', () => {
  const d = /^description: (.*)$/m.exec(fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8'))[1]
  assert.match(d, /cette boîte existe-t-elle/)
  assert.match(d, /call, text or probe a target \(refused\)/)
  assert.match(d, /watch, stop watching or export a case/)
})
