import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { holeheArgs, readHolehe } from '../../types/email/engine.js'
import { loadTypes, validateEngine, validateManifest } from '../lib/types.js'
import { readNote } from '../lib/vault.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, events, FIXTURES, json, NEW_EMAIL, read, run } from './helpers.js'

const fake = await startFake()
test.after(() => fake.close())
const env = fakeEnv(fake.url)
const ent = (dir, value) => readNote(path.join(dir, 'Entities', `${value}.md`)).props
const texts = dir => fs.readdirSync(path.join(dir, 'Clues')).map(f => read(dir, `Clues/${f}`)).join('\n')
const fails = dir => events(dir).filter(e => e.kind === 'fail').map(e => e.text)

test('the email manifest is sound; a person is always its subject, with its legal basis', async () => {
  const m = loadTypes().find(t => t.id === 'email')
  assert.deepEqual(validateManifest(m), [])
  assert.deepEqual(await validateEngine(m), [])
  const home = casesFolder()
  const no = await run(home, ['new', 'email', 'jo@example.org', '--question', 'Q?', '--frame', 'noisy=ask'])
  assert.equal(no.status, 1)
  assert.match(no.err, /legal_basis/)
  const ok = await run(home, ['new', 'email', 'jo@example.org', '--question', 'Q?', '--frame', 'legal_basis=Consent — the owner asked', '--frame', 'noisy=ask'])
  assert.equal(ok.status, 0, ok.err)
  const p = readNote(path.join(home, 'jo-example-org', 'Case.md')).props
  assert.deepEqual([p.person, p.legal_basis, p.noisy], [true, 'Consent — the owner asked', 'ask'])
})

test('collect address, disposable, mail: one entity whatever the form given, the provider, SPF and DMARC, the own domain to pivot to, the local part as a weak username', async () => {
  const home = casesFolder(), dir = path.join(home, 'jd')
  await run(home, NEW_EMAIL('Jeanne Durand <Jeanne.Durand@Durand-Bakery.example>', '--title', 'jd'))
  const r = await run(home, ['email', 'collect', '--only', 'address,disposable,mail', '-p', 'jd'], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(fails(dir), [])
  const e = ent(dir, 'jeanne.durand@durand-bakery.example')
  assert.deepEqual([e.kind, e.local, e.domain], ['email', 'jeanne.durand', 'durand-bakery.example'])
  assert.deepEqual([ent(dir, 'durand-bakery.example').role, ent(dir, 'durand-bakery.example').mail_provider], ['email domain', 'Google Workspace'])
  assert.deepEqual([ent(dir, 'jeanne.durand').kind, ent(dir, 'jeanne.durand').confidence], ['username', 'low'])
  const t = texts(dir)
  for (const want of ['Mail handled by Google Workspace (MX aspmx.l.google.com)', 'The SPF of durand-bakery.example includes _spf.google.com',
    'DMARC policy of durand-bakery.example: quarantine', 'durand-bakery.example is not in the list of 6 disposable domains']) assert.ok(t.includes(want), want)
  assert.deepEqual(json(dir, '.osint/views/mail-dns.json'), [
    { type: 'MX', name: 'durand-bakery.example', value: '1 aspmx.l.google.com' },
    { type: 'SPF', name: 'durand-bakery.example', value: 'v=spf1 include:_spf.google.com ~all' },
    { type: 'DMARC', name: '_dmarc.durand-bakery.example', value: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@durand-bakery.example' },
  ])
  assert.deepEqual(json(dir, '.osint/case.json').relations.map(x => x.label).sort(), ['address on', 'local part'])
  for (const s of ['disposable', 'mail']) assert.ok(fs.existsSync(path.join(dir, '.osint', 'collect', s, '1.json')), s)
  assert.equal((await run(home, ['email', 'collect', '--only', 'whois', '-p', 'jd'], env)).status, 1)
})

test('a public webmail gets no domain entity and a Gmail address its aliases; a role address no username; a disposable domain is said', async () => {
  const home = casesFolder(), gm = path.join(home, 'gm'), tmp = path.join(home, 'tmp')
  await run(home, NEW_EMAIL('Some.Name+news@googlemail.com', '--title', 'gm'))
  assert.equal((await run(home, ['email', 'collect', '--only', 'address', '-p', 'gm'], env)).status, 0)
  assert.deepEqual(ent(gm, 'some.name+news@googlemail.com').aliases, ['somename@gmail.com', 'somename@googlemail.com'])
  assert.equal(ent(gm, 'some.name').kind, 'username')
  assert.match(texts(gm), /Gmail ignores dots and \+tags: somename@gmail\.com, somename@googlemail\.com reach the same inbox/)
  assert.match(texts(gm), /googlemail\.com is a public webmail/)
  assert.ok(!fs.existsSync(path.join(gm, 'Entities', 'googlemail.com.md')))
  await run(home, NEW_EMAIL('contact@mailinator.com', '--title', 'tmp'))
  assert.equal((await run(home, ['email', 'collect', '--only', 'address,disposable,mail', '-p', 'tmp'], env)).status, 0)
  assert.match(texts(tmp), /mailinator\.com is a disposable address provider/)
  assert.match(texts(tmp), /contact@ is a role address/)
  for (const f of ['contact.md', 'mailinator.com.md']) assert.ok(!fs.existsSync(path.join(tmp, 'Entities', f)), f)
})

test('the real DNS of example.com: a null MX, an SPF that lets no server send, a DMARC reject', async () => {
  const home = casesFolder(), dir = path.join(home, 'test-example-com')
  await run(home, NEW_EMAIL('test@example.com'))
  const r = await run(home, ['email', 'collect', '--only', 'address,disposable,mail', '-p', 'test-example-com'], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(fails(dir), [])
  const t = texts(dir)
  for (const want of ['example.com accepts no mail (null MX, RFC 7505)', 'The SPF of example.com lets no server send mail', 'DMARC policy of example.com: reject']) assert.ok(t.includes(want), want)
})

const P = ['-p', 'contact-durand-bakery-example']

test('gravatar: the public profile by the SHA-256 of the address — name, place, company, verified accounts, the avatar kept as evidence', async () => {
  const home = casesFolder(), dir = path.join(home, 'contact-durand-bakery-example')
  await run(home, NEW_EMAIL('contact@durand-bakery.example'))
  const r = await run(home, ['email', 'collect', '--only', 'gravatar', ...P], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(fails(dir), [])
  assert.ok(fake.seen.some(s => s.service === 'gravatar' && s.path.endsWith('/v3/profiles/d6c050fc099f0d5d805a75f276536a36c65bed0b6392b650647bf47b27542c7c')))
  const t = texts(dir)
  for (const want of ['Name on Gravatar: Boulangerie Durand', 'Location on Gravatar: Lyon, France', 'Company on Gravatar: Boulangerie Durand SARL',
    'Accounts verified by Gravatar: Instagram https://www.instagram.com/durand.bakery', 'Gravatar profile last edited on 2026-09-14', 'Avatar on Gravatar']) assert.ok(t.includes(want), want)
  assert.ok(!t.includes('Pains au levain'), 'the bio stays in the capture')
  assert.ok(!t.includes('facebook.com'), 'a hidden account is not recorded')
  assert.equal(ent(dir, 'https---www.instagram.com-durand.bakery').verified, 'Gravatar')
  const [e] = json(dir, '.osint/case.json').evidence
  assert.match(e.file, /^Evidence\/E01-gravatar-[0-9a-f]{12}\.png$/)
  const img = ent(dir, 'https---0.gravatar.com-avatar-d6c050fc099f0d5d805a75f276536a36c65bed0b6392b650647bf47b27542c7c')
  assert.deepEqual([img.kind, img.file, img.sha256], ['image', `[[${path.posix.basename(e.file)}]]`, e.sha256])
  assert.match(t, /!\[\[E01-gravatar-[0-9a-f]{12}\.png\]\]/)
  assert.deepEqual(json(dir, '.osint/views/accounts.json').map(x => [x.site, x.state, x.by]), [['Gravatar', 'profile', 'gravatar'], ['Instagram', 'verified by Gravatar', 'gravatar']])
  assert.deepEqual(json(dir, '.osint/case.json').relations.map(x => x.label).sort(), ['Gravatar avatar', 'Gravatar profile', 'verified on Gravatar'])
})

test('the real recorded answers: no Gravatar profile for test@example.com (404), its breach names; an address XposedOrNot does not know', async () => {
  const home = casesFolder(), dir = path.join(home, 'test-example-com')
  await run(home, NEW_EMAIL('test@example.com'))
  const r = await run(home, ['email', 'collect', '--only', 'gravatar,breaches', '-p', 'test-example-com'], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(fails(dir), [])
  const names = [...new Set(JSON.parse(fs.readFileSync(path.join(FIXTURES, 'xon', 'test@example.com.json'), 'utf8')).breaches.flat())].sort((a, b) => a.localeCompare(b, 'en'))
  const t = texts(dir)
  assert.ok(t.includes('No public Gravatar profile for this address'))
  assert.ok(t.includes(`In ${names.length} known breaches (names only, XposedOrNot): ${names.slice(0, 10).join(', ')}, +${names.length - 10}`))
  assert.deepEqual(json(dir, '.osint/views/breaches.json').map(x => x.name), names)
  await run(home, NEW_EMAIL('no-such-mailbox-skill-osint@example.org', '--title', 'unknown'))
  assert.equal((await run(home, ['email', 'collect', '--only', 'breaches', '-p', 'unknown'], env)).status, 0)
  assert.ok(texts(path.join(home, 'unknown')).includes('In no breach XposedOrNot knows'))
  assert.deepEqual(json(path.join(home, 'unknown'), '.osint/views/breaches.json'), [])
})

test('XposedOrNot\'s quota: a full hour refuses the call before it leaves; the step fails, the others go on', async () => {
  const home = casesFolder(), dir = path.join(home, 'jd'), now = Date.now()
  fs.mkdirSync(path.join(home, '.cache'), { recursive: true })
  fs.writeFileSync(path.join(home, '.cache', 'quota-xon.json'), JSON.stringify({ calls: Array.from({ length: 25 }, (_, i) => now - 60e3 + i) }))
  await run(home, NEW_EMAIL('jeanne.durand@durand-bakery.example', '--title', 'jd'))
  const before = fake.seen.filter(s => s.service === 'xon').length
  const r = await run(home, ['email', 'collect', '--only', 'gravatar,breaches', '-p', 'jd'], env)
  assert.equal(r.status, 0, r.err)
  assert.match(fails(dir).join('\n'), /^breaches: XposedOrNot allows 25 calls an hour: the next call after \d{4}-\d\d-\d\dT/m)
  assert.equal(fake.seen.filter(s => s.service === 'xon').length, before)
  assert.ok(texts(dir).includes('No public Gravatar profile for this address'))
})

test('refresh: an unchanged address adds no clue and no second avatar; a new breach is found by diff', async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-fx-'))
  fs.cpSync(FIXTURES, copy, { recursive: true })
  const f2 = await startFake({ fixtures: copy }), env2 = fakeEnv(f2.url, copy)
  try {
    const home = casesFolder(), dir = path.join(home, 'contact-durand-bakery-example')
    await run(home, NEW_EMAIL('contact@durand-bakery.example'))
    assert.equal((await run(home, ['email', 'collect', ...P], env2)).status, 0)
    const clues = fs.readdirSync(path.join(dir, 'Clues')).length
    const r1 = await run(home, ['refresh', ...P, '--json'], env2)
    assert.equal(r1.status, 0, r1.err)
    assert.deepEqual(JSON.parse(r1.out).diffs.map(d => [d.name, d.added.length + d.removed.length + d.changed.length]), [['breaches', 0], ['gravatar', 0], ['mail', 0]])
    assert.equal(fs.readdirSync(path.join(dir, 'Clues')).length, clues)
    assert.equal(json(dir, '.osint/case.json').evidence.length, 1)
    assert.match(read(dir, 'Case.md'), /%% osint:begin what-changed %%[\s\S]*- none/)
    const xf = path.join(copy, 'xon', 'contact@durand-bakery.example.json'), x = JSON.parse(fs.readFileSync(xf, 'utf8'))
    x.breaches[0].push('ExempleForum2026')
    fs.writeFileSync(xf, JSON.stringify(x))
    const r2 = await run(home, ['refresh', ...P, '--json'], env2)
    assert.equal(r2.status, 0, r2.err)
    assert.deepEqual(JSON.parse(r2.out).diffs.find(d => d.name === 'breaches').added.map(a => a.key), ['ExempleForum2026'])
    assert.match(read(dir, 'Case.md'), /breaches: \+1 \(ExempleForum2026\)/)
  } finally { f2.close() }
})

const uvEnv = { ...env, OSINT_UV: path.join(FIXTURES, 'holehe', 'uv.mjs'), GEMINI_API_KEY: 'g-test', GOOGLE_API_KEY: 'k-test', OPENAI_API_KEY: 'sk-test', MAPILLARY_TOKEN: 'MLY|1|x' }
const uvLog = dir => { const f = path.join(dir, '.osint', 'cache', 'holehe', 'fake-uv.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null }
const NEVER = ['new', 'email', 'contact@durand-bakery.example', '--title', 'quiet', '--question', 'Q?', '--frame', 'legal_basis=Consent — the owner asked', '--frame', 'noisy=never']

test('readHolehe: one row per printed site, the legend and the credits skipped', () => {
  const rows = readHolehe(fs.readFileSync(path.join(FIXTURES, 'holehe', 'contact@durand-bakery.example.txt'), 'utf8'))
  assert.deepEqual(rows.map(r => `${r.state} ${r.site}`), ['not registered amazon.com', 'registered docker.com', 'not registered github.com', 'rate limited instagram.com',
    'error patreon.com', 'registered pinterest.com', 'not registered spotify.com', 'not registered twitter.com', 'registered wordpress.com'])
  assert.deepEqual(holeheArgs('a@example.org'), ['tool', 'run', 'holehe@latest', '-NP', '--no-color', '--no-clear', 'a@example.org'])
})

test('account-probe is noisy: exit 2 without --yes, refused when the frame says never, never in a refresh', async () => {
  const home = casesFolder()
  await run(home, NEW_EMAIL('contact@durand-bakery.example'))
  const ask = await run(home, ['email', 'account-probe', ...P], uvEnv)
  assert.equal(ask.status, 2)
  assert.match(ask.err, /noisy: Holehe asks the sign-up or login form of about 120 sites whether contact@durand-bakery\.example has an account there[\s\S]*the target gets no email \(-NP: never a password reset\)[\s\S]*account-probe --yes/)
  await run(home, NEVER)
  const never = await run(home, ['email', 'account-probe', '--yes', '-p', 'quiet'], uvEnv)
  assert.equal(never.status, 1)
  assert.match(never.err, /this case says noisy: never: it does not run here/)
  for (const slug of ['contact-durand-bakery-example', 'quiet']) assert.equal(uvLog(path.join(home, slug)), null, `${slug}: uv never ran`)
  const m = loadTypes().find(t => t.id === 'email')
  assert.ok(!m.refresh.some(s => /account-probe/.test(s.run ?? '')))
  assert.equal(m.actions.find(a => a.id === 'account-probe').noisy, true)
})

test('account-probe after the yes: holehe -NP (never -C), its printed list as inferred clues, rate-limited sites apart, what a site showed left out', async () => {
  const home = casesFolder(), dir = path.join(home, 'contact-durand-bakery-example')
  await run(home, NEW_EMAIL('contact@durand-bakery.example'))
  const r = await run(home, ['email', 'account-probe', '--yes', ...P], uvEnv)
  assert.equal(r.status, 0, r.err)
  const call = uvLog(dir)
  assert.deepEqual(call.args, ['tool', 'run', 'holehe@latest', '-NP', '--no-color', '--no-clear', 'contact@durand-bakery.example'])
  assert.ok(call.cwd.endsWith(path.join('.osint', 'cache', 'holehe')))
  assert.ok(!call.env.some(k => /KEY|TOKEN|SECRET|GOOGLE/i.test(k)), `no key reaches uv: ${call.env.join(' ')}`)
  const t = texts(dir)
  for (const s of ['docker.com', 'pinterest.com', 'wordpress.com']) assert.ok(t.includes(`A site says an account uses this address: ${s} (Holehe)`), s)
  for (const s of ['amazon.com', 'instagram.com', 'patreon.com']) assert.ok(!t.includes(`uses this address: ${s}`), s)
  assert.ok(!t.includes('FullName'))
  assert.ok(fs.readdirSync(path.join(dir, 'Clues')).every(f => readNote(path.join(dir, 'Clues', f)).props.status === 'inferred'))
  assert.deepEqual(json(dir, '.osint/views/accounts.json').map(x => [x.site, x.state, x.by]), [['docker.com', 'registered', 'holehe'], ['instagram.com', 'rate limited', 'holehe'], ['pinterest.com', 'registered', 'holehe'], ['wordpress.com', 'registered', 'holehe']])
  const j = read(dir, 'Journal.md')
  assert.match(j, /account-probe after the user's yes/)
  assert.match(j, /holehe: 9 sites — 3 registered, 1 rate limited, 1 failed/)
  const again = await run(home, ['email', 'account-probe', '--yes', ...P], uvEnv)
  assert.equal(again.status, 0, again.err)
  assert.equal(fs.readdirSync(path.join(dir, 'Clues')).length, 3, 'the same answer adds no clue')
})

test('account-probe without uv: exit 3; holehe printing nothing: exit 1, the failure in the Journal', async () => {
  const home = casesFolder()
  await run(home, NEW_EMAIL('contact@durand-bakery.example'))
  const none = await run(home, ['email', 'account-probe', '--yes', ...P], { ...env, OSINT_UV: path.join(home, 'no-such-uv') })
  assert.equal(none.status, 3)
  assert.match(none.err, /uv is missing/)
  await run(home, NEW_EMAIL('jeanne.durand@durand-bakery.example', '--title', 'jd'))
  const offline = await run(home, ['email', 'account-probe', '--yes', '-p', 'jd'], uvEnv)
  assert.equal(offline.status, 1)
  assert.match(fails(path.join(home, 'jd')).join('\n'), /holehe printed no result \(exit 1\): httpx\.ConnectError/)
})

test('gravatar text is third-party: escaped in the notes, a non-http link dropped, an avatar off Gravatar never fetched', async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-fx-'))
  fs.cpSync(FIXTURES, copy, { recursive: true })
  const f2 = await startFake({ fixtures: copy }), env2 = fakeEnv(f2.url, copy)
  try {
    const home = casesFolder(), dir = path.join(home, 'eve'), sha = createHash('sha256').update('eve@durand-bakery.example').digest('hex')
    fs.writeFileSync(path.join(copy, 'gravatar', `${sha}.json`), JSON.stringify({ hash: sha, display_name: 'Eve ![x](http://evil.example/p.png) %%osint:end%% <b>', profile_url: 'https://gravatar.com/eve',
      avatar_url: 'https://attacker.example/a.png', company: '', location: '', job_title: '',
      verified_accounts: [{ service_type: 'x', service_label: 'Mallory [link](http://evil.example)', url: 'javascript:alert(1)', is_hidden: false }, { service_type: 'mastodon', service_label: 'Mastodon', url: 'https://social.example/@eve', is_hidden: false }] }))
    await run(home, NEW_EMAIL('eve@durand-bakery.example', '--title', 'eve'), env2)
    const r = await run(home, ['email', 'collect', '--only', 'gravatar', '-p', 'eve'], env2)
    assert.equal(r.status, 0, r.err)
    assert.deepEqual(fails(dir), [])
    const t = texts(dir)
    assert.ok(!/(^|[^\\])!\[x\]/.test(t) && !t.includes('<b>') && !/(^|[^%\\])%%osint:end/.test(t), t)
    assert.ok(t.includes('Name on Gravatar: Eve'))
    assert.ok(!fs.readdirSync(path.join(dir, 'Entities')).some(f => /javascript/.test(f)))
    assert.ok(fs.readdirSync(path.join(dir, 'Entities')).some(f => /social\.example/.test(f)))
    assert.ok(!f2.seen.some(s => s.service === 'web' && s.host === 'attacker.example'), 'no request to the avatar host a profile names')
    assert.equal(json(dir, '.osint/case.json').evidence.length, 0)
  } finally { f2.close() }
})
