import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { maigretRows, mergeRows, pool, rowKey, siteOf, sitesFor, usernameOf, verdict } from '../../types/username/engine.js'
import { DENY } from '../lib/net.js'
import { pivotsFor } from '../lib/prompt.js'
import { loadTypes } from '../lib/types.js'
import { readNote } from '../lib/vault.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, events, FIXTURES, json, read, run } from './helpers.js'

const fake = await startFake()
test.after(() => fake.close())
const env = fakeEnv(fake.url)
const WMN_FILE = ['raw', 'WebBreacher', 'WhatsMyName', 'main', 'wmn-data.json']
const LEGAL = 'legal_basis=Legitimate interest — vetting a supplier before a bulk order'
const NEWU = ['new', 'username', 'durand.bakery', '--question', 'Which public accounts carry this name?', '--frame', 'noisy=never', '--frame', LEGAL]
const P = ['-p', 'durand-bakery']
const ent = (dir, value) => readNote(path.join(dir, 'Entities', `${value}.md`)).props
const known = () => loadTypes().find(t => t.id === 'username').inputs.find(i => i.id === 'categories').options.map(o => o.value)
// a copy of the fixtures a test may change, with its own fake server
async function fixturesCopy(change = () => {}) {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-fx-'))
  fs.cpSync(FIXTURES, copy, { recursive: true })
  change(copy)
  const f = await startFake({ fixtures: copy })
  return { copy, fake: f, env: fakeEnv(f.url, copy) }
}
const editWmn = (copy, fn) => { const f = path.join(copy, ...WMN_FILE), d = JSON.parse(fs.readFileSync(f, 'utf8')); fn(d); fs.writeFileSync(f, JSON.stringify(d)) }
const put = (copy, rel, text) => { const f = path.join(copy, 'web', rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text) }

test('the form takes WhatsMyName\'s own categories, NSFW off by default; a username or an account pivots here', () => {
  const m = loadTypes().find(t => t.id === 'username'), cats = m.inputs.find(i => i.id === 'categories')
  const wmn = JSON.parse(fs.readFileSync(path.join(FIXTURES, ...WMN_FILE), 'utf8')).categories.map(c => (c === 'xx NSFW xx' ? 'nsfw' : c))
  assert.deepEqual(cats.options.map(o => o.value), wmn)
  assert.ok(cats.multiple && cats.options.every(o => o.icon))
  assert.deepEqual(cats.default, wmn.filter(c => c !== 'nsfw' && !['dating', 'health', 'political'].includes(c))) // article 9: never by default
  const types = loadTypes()
  assert.ok(pivotsFor({ kind: 'account', value: 'https://www.instagram.com/durand.bakery', path: 'Entities/https---www.instagram.com-durand.bakery.md' }, types).some(p => p.type === 'username'))
  assert.ok(pivotsFor({ kind: 'username', value: 'durand.bakery', path: 'Entities/durand.bakery.md' }, types).some(p => p.type === 'username'))
})

test('usernameOf: a username, @name, or the profile URL that ends with it; anything else refused', () => {
  for (const [given, want] of [
    ['durand.bakery', 'durand.bakery'], ['@durand.bakery', 'durand.bakery'], ['  Jean_Dupont-2 ', 'Jean_Dupont-2'],
    ['https://www.instagram.com/durand.bakery/', 'durand.bakery'], ['https://www.linkedin.com/in/jdupont', 'jdupont'],
    ['https://www.youtube.com/@DurandBakery', 'DurandBakery'], ['https://bsky.app/profile/durand.bsky.social', 'durand.bsky.social'],
    ['travis branham', 'travis branham'], ['émilie', 'émilie'],
    ['a/b', null], ['', null], ['x'.repeat(65), null], ['<script>', null], ['https://example.org/', null], ['https://www.facebook.com/profile.php?id=1', null],
  ]) assert.equal(usernameOf(given), want, given)
})

test('siteOf: the username stripped and encoded, a host label checked, no cookie sent; each skipped site says why', () => {
  const base = { name: 'S', e_code: 200, e_string: 'yes', m_code: 404, m_string: '', known: ['x'], cat: 'social' }
  const s = siteOf({ ...base, uri_check: 'https://s.example/u/{account}?ref=1', uri_pretty: 'https://s.example/{account}/', headers: { 'User-Agent': 'Mozilla/5.0', Cookie: 'sid=1', Host: 'x' } }, 'jean dupont')
  assert.deepEqual([s.check, s.url, s.host, s.headers], ['https://s.example/u/jean%20dupont?ref=1', 'https://s.example/jean%20dupont', 's.example', { 'user-agent': 'Mozilla/5.0' }])
  assert.equal(siteOf({ ...base, uri_check: 'https://{account}.blog.example/', strip_bad_char: '.' }, 'durand.bakery').check, 'https://durandbakery.blog.example/')
  for (const [site, why] of [
    [{ ...base, uri_check: 'https://{account}.blog.example/' }, 'the username cannot be a host name'],
    [{ ...base, uri_check: 'https://s.example/{account}', valid: false }, 'marked broken by WhatsMyName'],
    [{ ...base, uri_check: 'https://s.example/api', post_body: '{"u":"{account}"}', headers: { 'Content-Type': 'application/json' } }, 'POST only (this engine only reads with GET)'],
    [{ ...base, uri_check: 'https://s.example/{account}', protection: ['cloudflare', 'user-auth'] }, 'needs a login'],
    [{ ...base, uri_check: 'http://127.0.0.1:41387/api/cases?u={account}' }, 'not a public host'],
    [{ ...base, uri_check: 'https://router.local/{account}' }, 'not a public host'],
    [{ ...base, uri_check: 'ftp://s.example/{account}' }, 'malformed entry'],
    [{ name: 'S', uri_check: 'https://s.example/{account}', e_string: 'x', m_string: '', cat: 'social' }, 'malformed entry'],
  ]) assert.equal(siteOf(site, site.uri_check.includes('blog') ? 'jean dupont' : 'durand.bakery').skip, why, JSON.stringify(site))
  const data = JSON.parse(fs.readFileSync(path.join(FIXTURES, ...WMN_FILE), 'utf8')), cats = known()
  const all = sitesFor(data, { name: 'durand.bakery', categories: cats.filter(c => c !== 'nsfw'), known: cats })
  assert.deepEqual(all.run.map(x => x.site), ['Blogspot', 'Example Code', 'Example Forum', 'Example Pics', 'Example Shop', 'Instagram'])
  assert.deepEqual(all.skipped.map(x => [x.site, x.reason]), [['7cup', 'marked broken by WhatsMyName'], ['AniList', 'POST only (this engine only reads with GET)'], ['Example Private', 'needs a login']])
  assert.equal(all.outside, 1)
  // a category WhatsMyName adds later is checked with misc
  assert.equal(sitesFor({ sites: [{ ...base, uri_check: 'https://s.example/{account}', cat: 'astrology' }] }, { name: 'x', categories: ['misc'], known: cats }).run.length, 1)
})

test('verdict: found by e_code and e_string, absent by m_code and m_string; both or neither is unknown', () => {
  const r = (status, body) => ({ status, body: Buffer.from(body) })
  const s = { e_code: 200, e_string: 'profile-header', m_code: 404, m_string: '' }
  assert.equal(verdict(s, r(200, '<div class="profile-header">')), 'found')
  assert.equal(verdict(s, r(404, 'whatever')), 'absent')
  assert.equal(verdict(s, r(200, 'Checking your browser')), 'unknown')
  assert.equal(verdict(s, r(403, 'profile-header')), 'unknown')
  const ig = { e_code: 200, e_string: 'Posts - See', m_code: 200, m_string: '"routePath":null' }
  assert.equal(verdict(ig, r(200, 'Posts - See … "routePath":null')), 'unknown')
  assert.equal(verdict(ig, r(200, '"routePath":null')), 'absent')
  assert.equal(verdict({ e_code: 302, e_string: '', m_code: 404, m_string: 'User not found' }, r(302, '')), 'found')
})

test('pool: at most 8 requests at once, never two to one host', async () => {
  const sites = Array.from({ length: 40 }, (_, i) => ({ host: `h${i % 13}.example`, i }))
  const busy = new Set(), done = []
  let now = 0, most = 0
  await pool(sites, 8, async s => {
    assert.ok(!busy.has(s.host), `two at once on ${s.host}`)
    busy.add(s.host); most = Math.max(most, ++now)
    await new Promise(ok => setTimeout(ok, 5 + (s.i % 3)))
    busy.delete(s.host); now--; done.push(s.i)
  })
  assert.deepEqual([most, done.length], [8, 40])
})

test('check: GET only, the found and the unknown in the Accounts table, candidates tied to the username, one hashed source', async () => {
  const home = casesFolder(), dir = path.join(home, 'durand-bakery')
  assert.equal((await run(home, NEWU, env)).status, 0)
  const before = fake.seen.length
  const r = await run(home, ['username', 'check', ...P], env)
  assert.equal(r.status, 0, r.err)
  assert.equal(r.out, '') // a type command prints nothing: refresh --json and the server read its stdout
  const seen = fake.seen.slice(before), hosts = new Set(seen.map(s => s.host))
  assert.ok(seen.every(s => s.method === 'GET'))
  for (const h of ['raw.githubusercontent.com', 'www.instagram.com', 'forum.example', 'code.example', 'pics.example', 'shop.example', 'durandbakery.blogspot.com']) assert.ok(hosts.has(h), h)
  for (const h of ['graphql.anilist.co', 'www.7cups.com', 'private.example', 'adult.example', ...DENY]) assert.ok(!hosts.has(h), h)
  assert.deepEqual(json(dir, '.osint/views/accounts.json').map(x => [x.site, x.category, x.state, x.url, x.via]), [
    ['Example Forum', 'hobby', 'found', 'https://forum.example/u/durand.bakery', ['whatsmyname']],
    ['Instagram', 'social', 'found', 'https://www.instagram.com/durand.bakery', ['whatsmyname']],
    ['Blogspot', 'blog', 'unknown', 'https://durandbakery.blogspot.com', ['whatsmyname']],
    ['Example Shop', 'shopping', 'unknown', 'https://shop.example/seller/durand.bakery', ['whatsmyname']],
  ])
  assert.deepEqual([ent(dir, 'durand.bakery').kind, ent(dir, 'durand.bakery').role], ['username', 'subject'])
  const ig = ent(dir, 'https---www.instagram.com-durand.bakery')
  assert.deepEqual([ig.kind, ig.site, ig.state, ig.via, ig.confidence], ['account', 'Instagram', 'found', ['whatsmyname'], 'low'])
  assert.equal(json(dir, '.osint/case.json').relations.filter(x => x.label === 'candidate account').length, 2)
  const clue = fs.readdirSync(path.join(dir, 'Clues')).find(f => f.includes('2 candidate accounts named durand.bakery (WhatsMyName)'))
  assert.equal(readNote(path.join(dir, 'Clues', clue)).props.status, 'inferred')
  const src = JSON.parse(read(dir, 'Evidence/captures/S01.json'))
  assert.deepEqual([src.username, src.checked.length, src.outside], ['durand.bakery', 6, 1])
  assert.deepEqual(src.skipped.map(x => x.site), ['7cup', 'AniList', 'Example Private'])
  assert.equal(src.checked.find(x => x.site === 'Example Shop').reason, 'HTTP 200')
  assert.match(src.data.sha256, /^[0-9a-f]{64}$/)
  // the Journal: the dataset used, the tally, each account found — not one line per request
  const j = read(dir, 'Journal.md')
  assert.ok(!/GET https:\/\/forum\.example/.test(j))
  assert.match(j, /dataset wmn: downloaded https:\/\/raw\.githubusercontent\.com\/WebBreacher\/WhatsMyName\/main\/wmn-data\.json · \d+ bytes · sha256 [0-9a-f]{12}/)
  assert.match(j, /whatsmyname: 6 sites checked — 2 found, 2 unknown, 2 absent; 3 skipped, 1 outside the chosen categories \(found: Example Forum, Instagram\) · S01/)
  assert.match(j, /whatsmyname found Instagram: https:\/\/www\.instagram\.com\/durand\.bakery/)
  assert.ok(fs.existsSync(path.join(dir, '.osint', 'collect', 'accounts', '1.json')))
  assert.ok(events(dir).some(e => e.kind === 'progress' && e.text === 'found on Instagram'))
})

test('categories narrow the sites; NSFW only when asked; an unknown category is refused', async () => {
  const home = casesFolder()
  assert.equal((await run(home, [...NEWU, '--in', 'categories=coding,nsfw', '--title', 'narrow'], env)).status, 0)
  const before = fake.seen.length
  assert.equal((await run(home, ['username', 'check', '-p', 'narrow'], env)).status, 0)
  assert.deepEqual([...new Set(fake.seen.slice(before).map(s => s.host))].filter(h => h !== 'raw.githubusercontent.com').sort(), ['adult.example', 'code.example'])
  const bad = await run(home, [...NEWU, '--in', 'categories=astrology', '--title', 'bad'], env)
  assert.equal(bad.status, 1)
  assert.match(bad.err, /--in categories=astrology: one or more of archived/)
})

test('refresh: an account gone is removed, an unknown one found since is changed', async () => {
  const fx = await fixturesCopy()
  try {
    const home = casesFolder(), dir = path.join(home, 'durand-bakery')
    await run(home, NEWU, fx.env)
    await run(home, ['username', 'check', ...P], fx.env)
    fs.rmSync(path.join(fx.copy, 'web', 'forum.example', 'u', 'durand.bakery.html'))
    put(fx.copy, 'shop.example/seller/durand.bakery.html', '<div class="seller-card">durand.bakery</div>')
    const r = await run(home, ['refresh', ...P, '--json'], fx.env)
    assert.equal(r.status, 0, r.err)
    const d = JSON.parse(r.out).diffs.find(x => x.name === 'accounts')
    assert.deepEqual([d.added.length, d.removed.map(x => x.key), d.changed.map(x => [x.key, x.fields])], [0, ['forum.example/u/durand.bakery'], [['shop.example/seller/durand.bakery', ['state']]]])
    assert.match(read(dir, 'Case.md'), /accounts: −1 \(forum\.example\/u\/durand\.bakery\) · ~1 \(shop\.example\/seller\/durand\.bakery: state\)/)
    assert.equal(ent(dir, 'https---shop.example-seller-durand.bakery').state, 'found')
  } finally { fx.fake.close() }
})

test('the WhatsMyName data is untrusted: a private host, a Google AI host, a malformed entry are never called; a new category goes with misc', async () => {
  const base = { e_code: 200, e_string: 'star-profile', m_string: '', m_code: 404, known: ['example'] }
  const fx = await fixturesCopy(copy => {
    editWmn(copy, d => d.sites.push(
      { ...base, name: 'Example Local', uri_check: 'http://127.0.0.1:41387/api/cases?u={account}', cat: 'misc' },
      { ...base, name: 'Example AI', uri_check: 'https://generativelanguage.googleapis.com/v1/{account}', cat: 'misc' },
      { name: 'Example Broken', uri_check: 'https://broken.example/{account}', cat: 'misc' },
      { ...base, name: 'Example Stars', uri_check: 'https://stars.example/{account}', cat: 'astrology' },
    ))
    put(copy, 'stars.example/durand.bakery.html', '<div class="star-profile">durand.bakery</div>')
  })
  try {
    const home = casesFolder(), dir = path.join(home, 'durand-bakery')
    await run(home, [...NEWU, '--in', 'categories=misc'], fx.env)
    const r = await run(home, ['username', 'check', ...P], fx.env)
    assert.equal(r.status, 0, r.err)
    const hosts = fx.fake.seen.map(s => s.host)
    for (const h of ['127.0.0.1', 'generativelanguage.googleapis.com', 'broken.example']) assert.ok(!hosts.includes(h), h)
    const src = JSON.parse(read(dir, 'Evidence/captures/S01.json'))
    assert.deepEqual(src.skipped.map(x => [x.site, x.reason]), [['Example Private', 'needs a login'], ['Example Local', 'not a public host'], ['Example Broken', 'malformed entry']])
    assert.match(src.checked.find(x => x.site === 'Example AI').reason, /never calls generativelanguage\.googleapis\.com/)
    assert.deepEqual([src.checked.find(x => x.site === 'Example Stars').state, src.checked.find(x => x.site === 'Example Stars').category], ['found', 'astrology'])
  } finally { fx.fake.close() }
})

test('a redirect that is neither answer is followed, one public hop at a time', async () => {
  const hobby = { e_code: 200, m_code: 404, m_string: '', known: ['example'], cat: 'hobby' }
  const fx = await fixturesCopy(copy => editWmn(copy, d => d.sites.push(
    { ...hobby, name: 'Example Moved', uri_check: 'https://moved.example/{account}', e_string: 'moved-profile' },
    { ...hobby, name: 'Example Gone', uri_check: 'https://gone.example/{account}', e_string: 'gone-profile', m_code: 200, m_string: 'No such user' },
    { ...hobby, name: 'Example Sneaky', uri_check: 'https://sneaky.example/{account}', e_string: 'sneaky-profile' },
  )))
  // this test's web: a server of its own (the dataset still comes from the fake)
  const web = http.createServer((req, res) => {
    const to = location => { res.writeHead(req.url.startsWith('/moved') ? 301 : 302, { location }); res.end('Found') }
    if (req.url === '/moved.example/durand.bakery') return to('https://moved.example/u/durand.bakery')
    if (req.url === '/moved.example/u/durand.bakery') return res.end('<div class="moved-profile">')
    if (req.url === '/gone.example/durand.bakery') return to('/search?q=durand.bakery')
    if (req.url === '/gone.example/search?q=durand.bakery') return res.end('No such user')
    if (req.url === '/sneaky.example/durand.bakery') return to('http://192.168.1.1/admin')
    res.writeHead(404); res.end()
  })
  await new Promise(ok => web.listen(0, '127.0.0.1', ok))
  try {
    const home = casesFolder(), dir = path.join(home, 'durand-bakery'), e = { ...fx.env, OSINT_BASE_WEB: `http://127.0.0.1:${web.address().port}` }
    await run(home, [...NEWU, '--in', 'categories=hobby'], e)
    assert.equal((await run(home, ['username', 'check', ...P], e)).status, 0)
    const by = Object.fromEntries(JSON.parse(read(dir, 'Evidence/captures/S01.json')).checked.map(x => [x.site, x]))
    assert.deepEqual([by['Example Moved'].state, by['Example Gone'].state, by['Example Sneaky'].state], ['found', 'absent', 'unknown'])
    assert.equal(by['Example Sneaky'].reason, 'redirects to 192.168.1.1')
  } finally { web.close(); fx.fake.close() }
})

test('offline: without a WhatsMyName copy, exit 1; with an old copy, it is used and the Journal says so', async () => {
  const home = casesFolder(), dir = path.join(home, 'durand-bakery'), noRaw = { ...env, OSINT_BASE_RAW: 'http://127.0.0.1:9/raw' }
  await run(home, NEWU, env)
  const r = await run(home, ['username', 'check', ...P], noRaw)
  assert.equal(r.status, 1)
  assert.match(r.err, /WhatsMyName data: dataset wmn: raw\.githubusercontent\.com: .*, and no copy in /)
  assert.equal((await run(home, ['username', 'check', ...P], env)).status, 0)
  const meta = path.join(home, '.cache', 'datasets', 'wmn.json'), m = JSON.parse(fs.readFileSync(meta, 'utf8'))
  fs.writeFileSync(meta, JSON.stringify({ ...m, at: new Date(Date.now() - 8 * 24 * 3600e3).toISOString() }))
  const s = await run(home, ['username', 'check', ...P], noRaw)
  assert.equal(s.status, 0, s.err)
  assert.match(read(dir, 'Journal.md'), /dataset wmn: download failed \(.+\), the copy of \d{4}-\d{2}-\d{2} is used/)
})

test('the subject is always a person: a legal basis first; a child of a domain case keeps its frame and asks only for it', async () => {
  const home = casesFolder()
  const r = await run(home, ['new', 'username', 'durand.bakery', '--question', 'Q?', '--frame', 'noisy=never'], env)
  assert.equal(r.status, 1)
  assert.match(r.err, /legal_basis/)
  await run(home, ['new', 'domain', 'durand-bakery.example', '--question', 'Who runs it?', '--frame', 'noisy=never'], env)
  const child = ['new', 'username', 'https://www.instagram.com/durand.bakery', '--title', 'durand.bakery', '--question', 'Q?', '--parent', 'durand-bakery-example', '--from', 'Entities/https---www.instagram.com-durand.bakery.md']
  assert.match((await run(home, child, env)).err, /legal_basis/)
  assert.equal((await run(home, [...child, '--frame', LEGAL], env)).status, 0)
  const p = readNote(path.join(home, 'durand-bakery', 'Case.md')).props
  assert.deepEqual([p.type, p.person, p.noisy, p.parent], ['username', true, 'never', 'durand-bakery-example'])
  // the engine reads the username in the profile URL
  assert.equal((await run(home, ['username', 'check', '-p', 'durand-bakery'], env)).status, 0)
  assert.equal(ent(path.join(home, 'durand-bakery'), 'durand.bakery').kind, 'username')
  const bad = await run(home, ['new', 'username', 'https://example.org/', '--question', 'Q?', '--frame', 'noisy=never', '--frame', LEGAL, '--title', 'nobody'], env)
  assert.equal(bad.status, 0)
  assert.match((await run(home, ['username', 'check', '-p', 'nobody'], env)).err, /not a username: https:\/\/example\.org\//)
})

test('what a third party wrote (a site name, an address) never becomes markdown that loads or links: escaped in the notes and the Journal', async () => {
  const evil = 'Evil ![pwn](http://evil.example/p.png) [[Journal]] %% osint:end facts %%'
  const fx = await fixturesCopy(copy => {
    editWmn(copy, d => d.sites.push({ name: evil, uri_check: 'https://evil.example/{account}', uri_pretty: 'https://evil.example/![a](http://x.example/i.png)/{account}', e_code: 200, e_string: 'evil-profile', m_string: '', m_code: 404, known: ['example'], cat: 'misc' }))
    put(copy, 'evil.example/durand.bakery.html', '<div class="evil-profile">durand.bakery</div>')
  })
  try {
    const home = casesFolder(), dir = path.join(home, 'durand-bakery')
    await run(home, [...NEWU, '--in', 'categories=misc'], fx.env)
    assert.equal((await run(home, ['username', 'check', ...P], fx.env)).status, 0)
    const md = f => fs.readFileSync(path.join(dir, f), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '') // the properties are not rendered as markdown
    const notes = [...fs.readdirSync(path.join(dir, 'Entities')).map(f => `Entities/${f}`), ...fs.readdirSync(path.join(dir, 'Clues')).map(f => `Clues/${f}`), 'Journal.md']
    assert.ok(notes.some(f => /Entities\/.*evil/.test(f)))
    for (const f of notes) {
      assert.ok(!/(?<!\\)!\[/.test(md(f)), `${f}: an image`)
      assert.ok(!/(?<!\\)\]\(/.test(md(f)), `${f}: a link`)
      assert.ok(!/(?<!\\)\[\[Journal\]\]/.test(md(f)), `${f}: a wikilink`)
      assert.ok(!/%% osint:end facts %%\n.*%% osint:end facts %%/s.test(md(f)), `${f}: a block marker`)
    }
  } finally { fx.fake.close() }
})

test('mergeRows: one row per account whatever the tool writes (case, www., trailing slash); each tool replaces only its own answers', () => {
  let rows = mergeRows([], [
    { key: rowKey('https://www.Instagram.com/durand.bakery/'), site: 'Instagram', category: 'social', state: 'unknown', url: 'https://www.instagram.com/durand.bakery' },
    { key: rowKey('https://b.example/x'), site: 'B', category: 'misc', state: 'found', url: 'https://b.example/x' },
  ], 'whatsmyname')
  const report = {
    Instagram: { url_user: 'https://instagram.com/durand.bakery/', status: { status: 'Claimed', tags: ['photo', 'us'] } },
    GitHub: { url_user: 'https://github.com/durand.bakery', status: { status: 'Claimed', tags: ['coding'] } },
    Nowhere: { url_user: 'javascript:alert(1)', status: { status: 'Claimed' } },
    Other: { url_user: 'https://other.example/durand.bakery', status: { status: 'Available' } },
  }
  assert.deepEqual(maigretRows(report, 'durand.bakery').map(r => [r.site, r.category, r.url]), [['Instagram', 'photo', 'https://instagram.com/durand.bakery'], ['GitHub', 'coding', 'https://github.com/durand.bakery']])
  rows = mergeRows(rows, maigretRows(report, 'durand.bakery'), 'maigret')
  assert.deepEqual(rows.map(r => [r.site, r.state, r.via]), [['B', 'found', ['whatsmyname']], ['GitHub', 'found', ['maigret']], ['Instagram', 'found', ['maigret', 'whatsmyname']]])
  // Maigret finds nothing now: its rows go, WhatsMyName's answer for Instagram is back
  rows = mergeRows(rows, [], 'maigret')
  assert.deepEqual(rows.map(r => [r.site, r.state, r.via]), [['B', 'found', ['whatsmyname']], ['Instagram', 'unknown', ['whatsmyname']]])
})

test('Maigret (option): uv runs it pinned, without recursion, extraction nor AI, with no key around; its finds merge', async () => {
  const home = casesFolder(), dir = path.join(home, 'durand-bakery')
  const uvEnv = { ...env, OSINT_UV: path.join(FIXTURES, 'maigret', 'uv.mjs'), OPENAI_API_KEY: 'sk-test', GEMINI_API_KEY: 'g-test', GOOGLE_API_KEY: 'k-test', MAPILLARY_TOKEN: 'MLY|1|x' }
  assert.equal((await run(home, [...NEWU, '--in', 'maigret=true'], uvEnv)).status, 0)
  const r = await run(home, ['username', 'check', ...P], uvEnv)
  assert.equal(r.status, 0, r.err)
  const log = JSON.parse(read(dir, '.osint/cache/maigret/fake-uv.json'))
  assert.deepEqual(log.args.slice(0, 5), ['tool', 'run', '--python', '3.12', 'maigret@0.6.6'])
  assert.deepEqual(log.args.slice(-2), ['--', 'durand.bakery']) // the name last, after --: never read as an option
  for (const a of ['--json', 'simple', '--folderoutput', '--no-recursion', '--no-extracting', '--no-progressbar', '--no-color', '--exclude-tags', 'porn']) assert.ok(log.args.includes(a), a)
  assert.deepEqual([log.args[log.args.indexOf('--timeout') + 1], log.args[log.args.indexOf('--max-connections') + 1]], ['10', '8'])
  assert.ok(!log.args.includes('--ai'))
  assert.ok(!log.env.some(k => /KEY|TOKEN|SECRET/i.test(k)), log.env.join(' '))
  assert.deepEqual(json(dir, '.osint/views/accounts.json').filter(x => x.state === 'found').map(x => [x.site, x.via]), [
    ['Example Forum', ['whatsmyname']], ['GitHub', ['maigret']], ['Instagram', ['maigret', 'whatsmyname']],
  ])
  assert.deepEqual(ent(dir, 'https---github.com-durand.bakery').via, ['maigret'])
  assert.deepEqual(ent(dir, 'https---www.instagram.com-durand.bakery').via, ['maigret', 'whatsmyname'])
  assert.ok(fs.readdirSync(path.join(dir, 'Sources')).some(f => f.includes('Maigret search of durand.bakery')))
  assert.match(read(dir, 'Journal.md'), /maigret found GitHub: https:\/\/github\.com\/durand\.bakery/)
  // NSFW chosen: Maigret's adult sites too
  await run(home, [...NEWU, '--in', 'maigret=true', '--in', 'categories=social,nsfw', '--title', 'all'], uvEnv)
  await run(home, ['username', 'maigret', '-p', 'all'], uvEnv)
  assert.ok(!JSON.parse(read(path.join(home, 'all'), '.osint/cache/maigret/fake-uv.json')).args.includes('--exclude-tags'))
})

test('Maigret without uv: exit 3 for this option only, WhatsMyName done; a Maigret run that fails is noted, exit 1', async () => {
  const home = casesFolder(), dir = path.join(home, 'durand-bakery'), noUv = { ...env, OSINT_UV: path.join(home, 'no-such-uv') }
  await run(home, [...NEWU, '--in', 'maigret=true'], noUv)
  const r = await run(home, ['username', 'check', ...P], noUv)
  assert.equal(r.status, 3)
  assert.match(r.err, /uv is missing: the Maigret option was skipped, WhatsMyName ran/)
  assert.equal(json(dir, '.osint/views/accounts.json').filter(x => x.state === 'found').length, 2)
  assert.ok(events(dir).some(e => e.kind === 'fail' && /maigret: uv is missing/.test(e.text)))
  assert.equal((await run(home, ['username', 'maigret', ...P], noUv)).status, 3)
  const uvEnv = { ...env, OSINT_UV: path.join(FIXTURES, 'maigret', 'uv.mjs') }
  await run(home, ['new', 'username', 'maigret.fails', '--question', 'Q?', '--frame', 'noisy=never', '--frame', LEGAL], uvEnv)
  const f = await run(home, ['username', 'maigret', '-p', 'maigret-fails'], uvEnv)
  assert.equal(f.status, 1)
  assert.ok(events(path.join(home, 'maigret-fails')).some(e => e.kind === 'fail' && /maigret: maigret exited with code 2 and wrote no JSON report: maigret: something broke/.test(e.text)))
})

// recorded 2026-11-06: the whole WhatsMyName list, and the answers of Codeberg and GitLab for an account of their own
// and for one that does not exist (the verdicts hold on real bodies; GitLab says « absent » with a 200 and « [] »)
test('the real WhatsMyName list (692 sites, 2026-11-06): every site is read or skipped with a reason, none to a local host; real answers give their verdicts', () => {
  const real = JSON.parse(fs.readFileSync(path.join(FIXTURES, ...WMN_FILE.slice(0, -1), 'wmn-data.real.json'), 'utf8'))
  const { run: runs, skipped, outside } = sitesFor(real, { name: 'durand.bakery', categories: known(), known: known() })
  assert.equal(runs.length + skipped.length + outside, real.sites.length)
  assert.ok(runs.length > 400, `${runs.length} sites to ask`)
  assert.ok(runs.every(s => /^https?:\/\//.test(s.check) && /^https?:\/\//.test(s.url) && !/\{account\}/.test(s.check)))
  assert.ok(skipped.every(s => s.reason))
  const by = name => real.sites.find(s => s.name === name)
  const rec = (site, acct, status) => ({ status, body: fs.readFileSync(path.join(FIXTURES, 'username-real', `${site}-${acct}.json`)) })
  const NO = 'skill-osint-no-such-user-9f3k'
  const [cb, gl] = [siteOf(by('Codeberg'), 'codeberg'), siteOf(by('GitLab'), 'gitlab')]
  assert.equal(verdict(cb, rec('codeberg', 'codeberg', 200)), 'found')
  assert.equal(verdict(siteOf(by('Codeberg'), NO), rec('codeberg', NO, 404)), 'absent')
  assert.equal(verdict(gl, rec('gitlab', 'gitlab', 200)), 'found')
  assert.equal(verdict(siteOf(by('GitLab'), NO), rec('gitlab', NO, 200)), 'absent')
  assert.equal(verdict(gl, rec('gitlab', NO, 404)), 'unknown')
})

// headless session: with noisy=never the agent read no profile at all (« you asked for passive »)
test('the username method says a profile page is read whatever noisy says', () => {
  assert.match(fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'types', 'username', 'method.md'), 'utf8'), /A profile page is a third party's public page, not the subject's own site: it is read whatever `noisy` says/)
})
