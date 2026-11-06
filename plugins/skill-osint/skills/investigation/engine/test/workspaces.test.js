// Workspaces (groups of investigations) and the investigation's tree (a case and its sub-cases as one)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { descendants, parents, rootOf } from '../lib/case.js'
import { startServer } from '../lib/server.js'
import { casesFolder, ENGINE, json, NEW, NEW_EMAIL, run } from './helpers.js'

const ok = async (home, argv) => { const r = await run(home, argv); assert.equal(r.status, 0, `${argv.join(' ')}: ${r.err}`); return r }
// a domain case, an email case below it, a username case below the email: one investigation; and another one
async function tree() {
  const home = casesFolder()
  await ok(home, NEW)
  await ok(home, [...NEW_EMAIL('contact@durand-bakery.example'), '--parent', 'durand-bakery-example', '--from', 'Entities/contact@durand-bakery.example.md'])
  await ok(home, ['new', 'username', 'durand.bakery', '--question', 'Which accounts?', '--parent', 'contact-durand-bakery-example'])
  await ok(home, ['new', 'domain', 'other-shop.example', '--question', 'Who runs it?', '--frame', 'noisy=never'])
  return home
}

test('workspaces: a default one; a new one is current, new cases join it, a sub-case follows its parent, a move takes the whole investigation', async () => {
  const home = casesFolder()
  assert.deepEqual(JSON.parse((await ok(home, ['workspaces', '--json'])).out), { current: 'default', list: [{ slug: 'default', name: 'Default workspace', current: true, investigations: 0 }] })
  await ok(home, ['workspaces', 'new', 'Client Durand'])
  await ok(home, NEW)
  await ok(home, [...NEW_EMAIL('contact@durand-bakery.example'), '--parent', 'durand-bakery-example'])
  assert.equal(json(path.join(home, 'contact-durand-bakery-example'), '.osint/case.json').workspace, 'client-durand')
  const refused = await run(home, [...NEW_EMAIL('a@b.example'), '--parent', 'durand-bakery-example', '--workspace', 'default'])
  assert.equal(refused.status, 1)
  assert.match(refused.err, /sub-case lives in its parent's workspace/)
  assert.match((await run(home, ['new', 'domain', 'x.example', '--question', 'Q?', '--frame', 'noisy=never', '--workspace', 'nope'])).err, /no workspace nope/)
  await ok(home, ['new', 'domain', 'other-shop.example', '--question', 'Q?', '--frame', 'noisy=never', '--workspace', 'default'])
  const list = async ws => JSON.parse((await ok(home, ['list', '--workspace', ws, '--json'])).out).map(r => r.slug)
  assert.deepEqual(await list('client-durand'), ['contact-durand-bakery-example', 'durand-bakery-example'])
  assert.deepEqual(await list('default'), ['other-shop-example'])
  // a sub-case named: its whole investigation moves
  assert.match((await ok(home, ['workspaces', 'move', 'contact-durand-bakery-example', 'default'])).out, /durand-bakery-example, contact-durand-bakery-example moved to default \(the whole investigation of durand-bakery-example\)/)
  assert.deepEqual(await list('client-durand'), [])
  await ok(home, ['workspaces', 'move', 'durand-bakery-example', 'client-durand'])
  await ok(home, ['workspaces', 'rename', 'client-durand', 'Durand (2026)'])
  assert.match((await ok(home, ['workspaces'])).out, /\* client-durand {2}Durand \(2026\) · 1 investigation/)
  assert.match((await run(home, ['workspaces', 'remove', 'default'])).err, /default workspace stays/)
  // removed: its cases come back to the default workspace, never deleted
  const r = JSON.parse((await ok(home, ['workspaces', 'remove', 'client-durand', '--json'])).out)
  assert.deepEqual([r.current, r.moved.sort()], ['default', ['contact-durand-bakery-example', 'durand-bakery-example']])
  assert.equal(json(path.join(home, 'durand-bakery-example'), '.osint/case.json').workspace, undefined)
  assert.ok(fs.existsSync(path.join(home, 'durand-bakery-example', 'Case.md')))
})

test('the tree: a case\'s root and descendants; a parent gone to .trash makes its child a root', async () => {
  const home = await tree(), up = parents(home)
  assert.equal(rootOf(home, 'durand-bakery', up), 'durand-bakery-example')
  assert.deepEqual(descendants(home, 'durand-bakery-example', up), [
    { slug: 'contact-durand-bakery-example', parent: 'durand-bakery-example', depth: 1 },
    { slug: 'durand-bakery', parent: 'contact-durand-bakery-example', depth: 2 },
  ])
  assert.deepEqual(descendants(home, 'other-shop-example', up), [])
  fs.renameSync(path.join(home, 'contact-durand-bakery-example'), path.join(casesFolder(), 'gone'))
  assert.equal(rootOf(home, 'durand-bakery'), 'durand-bakery')
})

test('brain context, search and entities on the top case cover its sub-cases; --shared counts investigations, not cases', async () => {
  const home = await tree()
  await ok(home, ['entity', 'tracker', 'G-DURAND123', '-p', 'durand-bakery'])
  await ok(home, ['entity', 'tracker', 'G-DURAND123', '-p', 'durand-bakery-example'])
  const ctx = (await ok(home, ['brain', 'context', '-p', 'durand-bakery-example'])).out
  assert.match(ctx, /sub-cases \(part of this investigation/)
  assert.match(ctx, /^- contact-durand-bakery-example \(email, draft, under durand-bakery-example\) — Who uses this address/m)
  assert.match(ctx, /^ {2}- durand-bakery \(username, draft, under contact-durand-bakery-example\) — Which accounts\?/m)
  assert.match((await ok(home, ['brain', 'context', '-p', 'durand-bakery'])).out, /investigation: durand-bakery-example \(its top case/)
  const found = JSON.parse((await ok(home, ['brain', 'search', 'G-DURAND123', '-p', 'durand-bakery-example', '--json'])).out)
  assert.deepEqual([...new Set(found.map(x => x.slug))].sort(), ['durand-bakery', 'durand-bakery-example'])
  const mine = JSON.parse((await ok(home, ['brain', 'entities', '--kind', 'tracker', '-p', 'durand-bakery-example', '--json'])).out)
  assert.deepEqual(mine[0].cases.map(c => [c.slug, c.root]), [['durand-bakery-example', 'durand-bakery-example'], ['durand-bakery', 'durand-bakery-example']])
  // the same tracker in two cases of one investigation: not shared; in another investigation too: shared
  const shared = async () => JSON.parse((await ok(home, ['brain', 'entities', '--all', '--shared', '--json'])).out).filter(e => e.kind === 'tracker')
  assert.deepEqual(await shared(), [])
  await ok(home, ['entity', 'tracker', 'G-DURAND123', '-p', 'other-shop-example'])
  assert.deepEqual((await shared()).map(e => e.cases.length), [3])
})

const dist = fs.mkdtempSync(path.join(casesFolder(), 'dist-'))
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>OSINT</title>')
async function serve(home) {
  const server = await startServer({ home, port: 0, dist, engine: ENGINE, loaded: 0 })
  test.after(() => server.close())
  return `http://127.0.0.1:${server.address().port}`
}
function stream(url, until, headers = {}) {
  return new Promise((done, ko) => {
    const got = [], req = http.get(url, { headers }, res => {
      let buf = ''
      res.on('data', d => {
        buf += d
        for (let i; (i = buf.indexOf('\n\n')) >= 0;) {
          const block = buf.slice(0, i); buf = buf.slice(i + 2)
          const ev = Object.fromEntries(block.split('\n').filter(l => /^(id|event|data):/.test(l)).map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]))
          if (ev.data) got.push({ ...ev, data: JSON.parse(ev.data) })
          if (until(got)) { req.destroy(); done(got) }
        }
      })
    })
    req.on('error', e => (e.code === 'ECONNRESET' ? done(got) : ko(e)))
    setTimeout(() => { req.destroy(); done(got) }, 3000)
  })
}

test('the API: a top case comes with its sub-cases\' indexes, a sub-case names its root; one stream for the tree; delete takes the tree', async () => {
  const home = await tree(), base = await serve(home)
  const top = await fetch(`${base}/api/cases/durand-bakery-example`).then(r => r.json())
  assert.equal(top.root, 'durand-bakery-example')
  assert.deepEqual(top.subcases.map(x => [x.slug, x.parent, x.depth, x.type]), [['contact-durand-bakery-example', 'durand-bakery-example', 1, 'email'], ['durand-bakery', 'contact-durand-bakery-example', 2, 'username']])
  assert.ok(top.subcases[1].notes.some(n => n.path === 'Case.md'))
  const below = await fetch(`${base}/api/cases/durand-bakery`).then(r => r.json())
  assert.deepEqual([below.root, below.subcases], ['durand-bakery-example', []])
  // a step logged in the grandchild reaches the top case's stream, marked with its case; the id resumes each file
  const url = `${base}/api/cases/durand-bakery-example/events`
  const first = stream(url, got => got.some(e => e.data.kind === 'log'))
  await new Promise(r => setTimeout(r, 200))
  await ok(home, ['log', '-p', 'durand-bakery', '--phase', 'collect', 'reading the accounts'])
  const got = await first, log = got.find(e => e.data.kind === 'log')
  assert.equal(log.data.case, 'durand-bakery')
  assert.ok(got.some(e => e.data.kind === 'case.new' && e.data.case === 'durand-bakery-example'))
  assert.match(log.id, /^\d+;(.+=\d+;?)+$/)
  const again = await stream(url, g => g.length >= 3, { 'last-event-id': log.id })
  assert.ok(!again.some(e => e.data.kind === 'log' && e.data.case === 'durand-bakery'))
  // a sub-case made while the page is open joins the stream
  const later = stream(url, g => g.some(e => e.data.case === 'other-durand-example'))
  await new Promise(r => setTimeout(r, 200))
  await ok(home, ['new', 'domain', 'other-durand.example', '--question', 'Q?', '--parent', 'durand-bakery-example'])
  assert.ok((await later).some(e => e.data.kind === 'case.new' && e.data.case === 'other-durand-example'))
  // the summaries carry each case's parent and workspace (the home page groups and filters them)
  const sums = await fetch(`${base}/api/cases`).then(r => r.json())
  assert.deepEqual(sums.find(s => s.slug === 'durand-bakery').parent, 'contact-durand-bakery-example')
  assert.ok(sums.every(s => s.workspace === 'default'))
  const del = await fetch(`${base}/api/cases/contact-durand-bakery-example`, { method: 'DELETE' }).then(r => r.json())
  assert.deepEqual(del.deleted, ['contact-durand-bakery-example', 'durand-bakery'])
  assert.ok(!fs.existsSync(path.join(home, 'durand-bakery')))
  assert.equal(fs.readdirSync(path.join(home, '.trash')).length, 2)
})

test('the API\'s workspaces: made, used, renamed, a case moved, removed; the home stream says when they change', async () => {
  const home = await tree(), base = await serve(home)
  const post = b => fetch(`${base}/api/workspaces`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then(async r => ({ status: r.status, body: await r.json() }))
  const told = stream(`${base}/api/events`, g => g.some(e => e.event === 'workspaces' && e.data.list.length === 2))
  await new Promise(r => setTimeout(r, 200))
  const made = await post({ new: 'Client Durand' })
  assert.deepEqual([made.status, made.body.current, made.body.list.map(x => x.name)], [200, 'client-durand', ['Default workspace', 'Client Durand']])
  assert.equal((await told).find(e => e.event === 'workspaces').data.current, 'client-durand')
  assert.equal((await post({ slug: 'default', use: true })).body.current, 'default')
  assert.equal((await post({ slug: 'client-durand', rename: 'Durand' })).body.list[1].name, 'Durand')
  assert.equal((await post({ slug: 'client-durand', move: 'durand-bakery' })).status, 200)
  assert.equal(json(path.join(home, 'durand-bakery-example'), '.osint/case.json').workspace, 'client-durand')
  assert.equal((await post({ slug: 'nope', move: 'durand-bakery' })).status, 400)
  assert.equal((await post({ slug: 'default', remove: true })).status, 400)
  assert.equal((await post({ slug: 'client-durand', remove: true })).body.list.length, 1)
  assert.equal(json(path.join(home, 'durand-bakery'), '.osint/case.json').workspace, undefined)
  assert.equal((await post({})).status, 400)
})
