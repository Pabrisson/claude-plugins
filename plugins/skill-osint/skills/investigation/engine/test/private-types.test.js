import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { homeDir } from '../lib/case.js'
import { DENY } from '../lib/net.js'
import { startServer } from '../lib/server.js'
import { typesDir } from '../lib/templates.js'
import { loadEngine, makeCtx, RESERVED_IDS, scanTypes, tunnelOpts } from '../lib/types.js'
import { readNote } from '../lib/vault.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, ENGINE, FIXTURES, json, read, run } from './helpers.js'

const fake = await startFake()
test.after(() => fake.close())
const env = fakeEnv(fake.url)
const SHOP = path.join(FIXTURES, 'osint-types', 'shop-audit')
// a private type in a cases folder, as the agent makes one: a copy of a type's folder, its id and manifest changed
function own(home, id = 'shop-audit', patch = {}) {
  const dir = path.join(home, '.osint-types', id)
  fs.cpSync(SHOP, dir, { recursive: true })
  const f = path.join(dir, 'type.json')
  fs.writeFileSync(f, JSON.stringify({ ...JSON.parse(fs.readFileSync(f, 'utf8')), id, ...patch }, null, 2))
  return dir
}
const AUDIT = ['new', 'shop-audit', 'durand-bakery.example', '--title', 'Durand shop audit', '--question', 'Can one order from this shop?', '--frame', 'noisy=never']
const P = ['-p', 'durand-shop-audit']
const whyOf = rejected => Object.fromEntries(rejected.map(r => [r.id, [r.why, ...r.errors].join(' · ')]))
// a private type whose engine.js is the given source (the shop-audit folder, its engine replaced)
function withEngine(home, id, source, patch) {
  const dir = own(home, id, patch)
  fs.writeFileSync(path.join(dir, 'engine.js'), source)
  return dir
}
const symlink = (target, file) => { try { fs.symlinkSync(target, file); return true } catch { return false } }

test('private types load after the plugin\'s; a folder named like a plugin type, a command or a prompt tag, or whose manifest does not hold, is refused with why', () => {
  const home = casesFolder(), O = path.join(home, '.osint-types')
  own(home)
  own(home, 'domain', { label: 'Hijacked' })
  own(home, 'list')
  own(home, 'lead')
  own(home, 'Shop_Audit')
  fs.rmSync(path.join(own(home, 'no-method'), 'method.md'))
  own(home, 'wrong-shape', { inputs: {} })
  own(home, 'shop-x', { phases: [] })
  fs.mkdirSync(path.join(O, 'half')); fs.writeFileSync(path.join(O, 'half', 'type.json'), '{ "id": "half",')
  fs.mkdirSync(path.join(O, 'empty'))
  fs.mkdirSync(path.join(O, '.git'))
  const { types, rejected } = scanTypes(home)
  assert.deepEqual(types.map(t => t.private), [...types.filter(t => !t.private).map(() => false), true])
  const shop = types.find(t => t.id === 'shop-audit'), domain = types.find(t => t.id === 'domain')
  assert.deepEqual([shop.private, shop.dir], [true, path.join(O, 'shop-audit')])
  assert.deepEqual([domain.private, domain.dir, domain.label], [false, path.join(typesDir(), 'domain'), 'Domain'])
  const why = whyOf(rejected)
  assert.deepEqual(Object.keys(why).sort(), ['Shop_Audit', 'domain', 'empty', 'half', 'lead', 'list', 'no-method', 'shop-x', 'wrong-shape'])
  assert.match(why.domain, /^domain is a plugin type's id: rename the folder and its "id"$/)
  assert.match(why.list, /^list is an engine command or a prompt tag/)
  assert.match(why.lead, /^lead is an engine command or a prompt tag/)
  assert.match(why.Shop_Audit, /lowercase letters, digits and dashes/)
  assert.equal(why.empty, 'no type.json')
  assert.match(why.half, /^type\.json: /)
  assert.equal(why['no-method'], 'its manifest does not hold · method.md: missing')
  assert.match(why['shop-x'], /phases: at least one/)
  assert.match(why['wrong-shape'], /not the shape of a manifest/)
})

test('a private type never passes for a plugin type: its manifest id, its case, its spelling (case, Unicode, trailing dot) and Windows\' reserved names', () => {
  const home = casesFolder(), O = path.join(home, '.osint-types')
  // the manifest names a plugin type while the folder does not: the folder is the id, the manifest does not hold
  own(home, 'shop-y', { id: 'domain' })
  fs.writeFileSync(path.join(O, 'shop-y', 'type.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(SHOP + '/type.json', 'utf8')), id: 'domain' }))
  const { types, rejected } = scanTypes(home), why = whyOf(rejected)
  assert.deepEqual(types.filter(t => t.private), [])
  assert.match(why['shop-y'], /^its manifest does not hold · id domain: must be its folder's name \(shop-y\)$/)
  // the same name spelled otherwise (another case, full-width letters, a trailing dot or space: Windows drops them), the
  // names Windows reserves whatever their case, a control character, a dotted or spaced name; each in a cases folder of
  // its own (on macOS and Windows two spellings of one name are one folder)
  const alone = name => { const h = casesFolder(); own(h, name); const s = scanTypes(h); return { loaded: s.types.filter(t => t.private).length, why: whyOf(s.rejected) } }
  for (const n of ['Domain', 'DOMAIN', '\uFF44omain', 'domain.', 'domain ']) { const r = alone(n); assert.equal(r.loaded, 0, n); assert.match(Object.values(r.why)[0], /^domain is a plugin type's id/, n) }
  assert.match(Object.values(alone('LIST').why)[0], /^list is an engine command or a prompt tag/)
  for (const n of ['con', 'nul', 'aux', 'prn', 'com1', 'lpt9', 'NUL', 'nul.txt']) { const r = alone(n); assert.equal(r.loaded, 0, n); assert.match(Object.values(r.why)[0], /^Windows reserves the name /, n) }
  for (const n of ['bad\u0001id', 'a..b', 'shop audit']) { const r = alone(n); assert.equal(r.loaded, 0, n); assert.match(Object.values(r.why)[0], /lowercase letters, digits and dashes/, n) }
})

test('a private type is a real folder of the cases folder: a link out of it is refused, before any import', async () => {
  const home = casesFolder(), O = path.join(home, '.osint-types'), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-outside-')), mark = path.join(outside, 'ran.txt')
  fs.mkdirSync(O, { recursive: true })
  fs.cpSync(SHOP, path.join(outside, 'elsewhere'), { recursive: true })
  if (!symlink(path.join(outside, 'elsewhere'), path.join(O, 'linked'))) return // no right to make links here (Windows without developer mode)
  // a type whose engine.js (then type.json) is a link to a file outside its folder
  const a = own(home, 'engine-link')
  fs.writeFileSync(path.join(outside, 'engine.js'), `import fs from 'node:fs'\nfs.writeFileSync(${JSON.stringify(mark)}, 'ran')\nexport const commands = {}\n`)
  fs.rmSync(path.join(a, 'engine.js')); symlink(path.join(outside, 'engine.js'), path.join(a, 'engine.js'))
  const b = own(home, 'manifest-link')
  fs.copyFileSync(path.join(b, 'type.json'), path.join(outside, 'type.json'))
  fs.rmSync(path.join(b, 'type.json')); symlink(path.join(outside, 'type.json'), path.join(b, 'type.json'))
  // a link that stays inside the type's folder is fine
  const c = own(home, 'inner-link')
  fs.renameSync(path.join(c, 'method.md'), path.join(c, 'steps.md')); symlink('steps.md', path.join(c, 'method.md'))
  const { types, rejected } = scanTypes(home), why = whyOf(rejected)
  assert.deepEqual(types.filter(t => t.private).map(t => t.id), ['inner-link'])
  assert.match(why.linked, /^a symbolic link: a private type is a real folder of the cases folder/)
  assert.match(why['engine-link'], /engine\.js is a symbolic link out of the type's folder/)
  assert.match(why['manifest-link'], /type\.json is a symbolic link out of the type's folder/)
  const r = await run(home, ['engine-link', 'collect', '-p', 'x'])
  assert.equal(r.status, 1)
  assert.match(r.err, /the private type engine-link is refused/)
  assert.ok(!fs.existsSync(mark), 'the linked engine.js was imported')
  // the whole .osint-types being a link out of the cases folder
  const home2 = casesFolder()
  fs.mkdirSync(path.join(outside, 'all')); fs.cpSync(SHOP, path.join(outside, 'all', 'shop-audit'), { recursive: true })
  symlink(path.join(outside, 'all'), path.join(home2, '.osint-types'))
  const s = scanTypes(home2)
  assert.deepEqual([s.types.filter(t => t.private).length, s.rejected.map(x => x.id)], [0, ['.osint-types']])
  assert.match(s.rejected[0].why, /^\.osint-types is a symbolic link out of the cases folder/)
})

test('a private engine.js stays with node built-ins and ctx: an import of the plugin\'s files, a shell, a bare fetch, an eval, a dynamic import is refused before it loads', async () => {
  const home = casesFolder(), mark = path.join(home, 'ran.txt'), ok = `export const commands = { go: { help: 'x', flags: {}, run: async ctx => { await ctx.fetch('web', 'https://a.example/') } } }\n`
  const bad = {
    'imports-lib': `import { request } from '../../lib/net.js'\n${ok}`,
    'imports-abs': `import { entity } from '/opt/plugin/engine/lib/records.js'\n${ok}`,
    'imports-fs': `import fs from 'node:fs'\n${ok}`,
    'imports-cp': `import { execFileSync } from "node:child_process"\n${ok}`,
    'imports-bare': `import left from 'left-pad'\n${ok}`,
    'exports-from': `export { request } from '../../lib/net.js'\n${ok}`,
    'side-effect': `import '../x.js'\n${ok}`,
    'dynamic-import': `const m = 'node:' + 'fs'\nconst fs = await import(m)\n${ok}`,
    'require-it': `const fs = require('node:fs')\n${ok}`,
    'bare-fetch': `export const commands = { go: { help: 'x', flags: {}, run: async () => { await fetch('http://example.org') } } }\n`,
    'eval-it': `export const commands = { go: { help: 'x', flags: {}, run: async () => { eval('1') } } }\n`,
    'new-function': `export const commands = { go: { help: 'x', flags: {}, run: async () => { new Function('return 1')() } } }\n`,
    'binding': `export const commands = { go: { help: 'x', flags: {}, run: async () => { process.binding('fs') } } }\n`,
    'global-this': `export const commands = { go: { help: 'x', flags: {}, run: async () => { globalThis.fetch('http://example.org') } } }\n`,
  }
  for (const [id, src] of Object.entries(bad)) withEngine(home, id, src)
  // what a type may import: path, url, util, crypto…, as a multi-line import too, and ctx.fetch
  withEngine(home, 'fine', `import path from 'node:path'\nimport {\n  createHash,\n} from 'node:crypto'\nconst o = { fetched: path.sep, h: createHash }\n${ok}`)
  const { types, rejected } = scanTypes(home), why = whyOf(rejected)
  assert.deepEqual(types.filter(t => t.private).map(t => t.id), ['fine'])
  assert.deepEqual(Object.keys(why).sort(), Object.keys(bad).sort())
  // each one for its own reason (and only that one)
  const reason = { 'require-it': /uses require/, 'eval-it': /builds code at run time/, 'new-function': /builds code at run time/, binding: /process internals/, 'global-this': /globalThis/ }
  for (const id of Object.keys(bad)) assert.match(why[id], /^its engine\.js is not for a private type: /, id)
  for (const [id, re] of Object.entries(reason)) assert.match(why[id], re, id)
  for (const id of ['eval-it', 'new-function', 'binding', 'bare-fetch', 'dynamic-import']) assert.ok(!/imports /.test(why[id]), `${id}: ${why[id]}`)
  assert.match(why['imports-lib'], /imports ..\/..\/lib\/net\.js \(a private type imports node: built-ins only/)
  assert.match(why['imports-fs'], /imports node:fs/)
  assert.match(why['dynamic-import'], /import\(\)/)
  assert.match(why['bare-fetch'], /fetch\(\)/)
  // it is checked again at the moment of the import: a file changed after the scan never loads
  const m = types.find(t => t.id === 'fine')
  fs.writeFileSync(path.join(m.dir, 'engine.js'), `import fs from 'node:fs'\nfs.writeFileSync(${JSON.stringify(mark)}, 'ran')\n${ok}`)
  await assert.rejects(() => loadEngine(m), /imports node:fs/)
  assert.ok(!fs.existsSync(mark), 'a refused engine.js ran')
  assert.equal((await run(home, ['imports-fs', 'go', '-p', 'x'])).status, 1)
  assert.ok(!fs.existsSync(mark))
})

test('a private folder named like a plugin type never changes it: the plugin\'s manifest and templates still make its cases', async () => {
  const home = casesFolder(), dir = own(home, 'domain', { label: 'Hijacked' })
  fs.writeFileSync(path.join(dir, 'templates', 'Report.md'), '# HIJACKED {{title}}\n')
  const r = await run(home, ['new', 'domain', 'durand-bakery.example', '--question', 'Who runs it?', '--frame', 'noisy=never'])
  assert.equal(r.status, 0, r.err)
  const report = read(path.join(home, 'durand-bakery-example'), 'Report.md')
  assert.ok(!report.includes('HIJACKED'))
  assert.match(report, /%% osint:begin report %%/)
})

test('a case of a private type: its form, templates and labels, its engine.js through ctx against the fake APIs, its refresh', async () => {
  const home = casesFolder(), dir = path.join(home, 'durand-shop-audit')
  own(home)
  assert.match((await run(home, ['new', 'shop-audit', 'x.example', '--question', 'Q?'])).err, /noisy=ask\|never/)
  const r = await run(home, AUDIT, env)
  assert.equal(r.status, 0, r.err)
  assert.equal(readNote(path.join(dir, 'Case.md')).props.type, 'shop-audit')
  assert.match(read(dir, 'Report.md'), /^## Before ordering\n\n- \[ \] Read the terms of sale: withdrawal right, delivery, returns$/m)
  const c = await run(home, ['shop-audit', 'collect', ...P], env)
  assert.equal(c.status, 0, c.err)
  assert.deepEqual(json(dir, '.osint/views/checks.json'), [
    { check: 'Legal notice', status: 'found', where: 'https://durand-bakery.example/mentions-legales' },
    { check: 'SIREN', status: 'found', where: 'https://durand-bakery.example/mentions-legales' },
    { check: 'Contact', status: 'found', where: 'https://durand-bakery.example/' },
    { check: 'Terms of sale', status: 'missing', where: '—' },
    { check: 'Consumer mediator', status: 'missing', where: '—' },
  ])
  assert.equal(readNote(path.join(dir, 'Entities', 'SIREN 456 789 122.md')).props.siren, '456789122')
  assert.equal(readNote(path.join(dir, 'Entities', 'contact@durand-bakery.example.md')).props.kind, 'email')
  const clues = fs.readdirSync(path.join(dir, 'Clues')).join('\n')
  for (const want of ['Legal notice- found on the home page', 'SIREN 456 789 122 in the legal notice', 'Terms of sale- nothing on the home page and the legal notice']) assert.ok(clues.includes(want), want)
  assert.match(read(dir, 'Journal.md'), /· cmd · shop-audit collect \^j\d{3}/)
  assert.ok(!fake.seen.some(x => DENY.has(x.host)))
  const again = await run(home, ['refresh', ...P, '--json'], env)
  assert.equal(again.status, 0, again.err)
  assert.deepEqual(JSON.parse(again.out).diffs.map(d => [d.name, d.first, d.added.length + d.removed.length + d.changed.length]), [['checks', false, 0]])
})

test('a cases folder whose path has spaces, a hash and a percent still imports its private engine.js (file URL)', async () => {
  const base = casesFolder(), home = path.join(base, 'my cases #1 %41'), dir = path.join(home, 'durand-shop-audit')
  fs.mkdirSync(home)
  own(home)
  assert.equal((await run(home, AUDIT, env)).status, 0)
  const c = await run(home, ['shop-audit', 'collect', ...P], env)
  assert.equal(c.status, 0, c.err)
  assert.equal(json(dir, '.osint/views/checks.json').length, 5)
})

test('a private type named like an engine command never takes it; a refused one says why when its command is called', async () => {
  const home = casesFolder()
  own(home, 'list')
  own(home, 'shop-x', { phases: [] })
  const l = await run(home, ['list'])
  assert.equal(l.status, 0, l.err)
  assert.match(l.out, /^no case in /)
  const r = await run(home, ['shop-x', 'collect', '-p', 'anything'])
  assert.equal(r.status, 1)
  assert.match(r.err, /the private type shop-x is refused \(.*shop-x\): its manifest does not hold; phases: at least one/)
})

test('the engine run from inside a private type\'s folder works on the cases folder that holds it', () => {
  const home = casesFolder(), dir = own(home)
  assert.equal(homeDir({}, dir), home)
  assert.equal(homeDir({}, path.join(dir, 'templates')), home)
  assert.equal(homeDir({ OSINT_DIR: '/elsewhere' }, dir), path.resolve('/elsewhere'))
})

test('a private type gets ctx and nothing else: a frozen ctx without the engine\'s modules, a tunnel that never carries its own yes', async () => {
  const home = casesFolder()
  own(home)
  assert.equal((await run(home, AUDIT, env)).status, 0)
  const m = scanTypes(home).types.find(t => t.id === 'shop-audit'), ctx = makeCtx(home, 'durand-shop-audit', m)
  assert.ok(Object.isFrozen(ctx) && Object.isFrozen(ctx.manifest), 'the ctx and its manifest are frozen')
  assert.throws(() => { 'use strict'; ctx.manifest.private = false })
  assert.equal(ctx.manifest.private, true)
  // what a type may touch, by name: no module of the engine, no raw network, no records
  const expected = ['agentSteps', 'block', 'case', 'clue', 'crop', 'declareClear', 'dir', 'entity', 'evidence', 'evidenceFile', 'fail', 'fetch', 'file', 'frame', 'guarded', 'home', 'homeCtx', 'hyp', 'hypLrMany', 'hyps', 'input', 'lang', 'log', 'manifest', 'media', 'noisy', 'person', 'progress', 'python', 'refuse', 'relate', 'resolver', 'sendCopy', 'sendable', 'slug', 'snapshot', 'source', 'state', 't', 'timeline', 'tunnel', 'view']
  assert.deepEqual(Object.keys(ctx).sort(), expected)
  for (const k of ['request', 'records', 'net', 'sensitive', 'import', 'require', 'sendList', 'updateCase', 'withLock', 'writeJson']) assert.ok(!(k in ctx), k)
  // the user's yes and « people visible » are never the type's to give
  assert.deepEqual(tunnelOpts(m, { yes: true, unmasked: true, minutes: 5 }), { yes: false, unmasked: false, minutes: 5 })
  assert.deepEqual(tunnelOpts({ private: false }, { yes: true, unmasked: true }), { yes: true, unmasked: true })
})

test('osint.mjs types: every type with its folder and what it lacks; a private engine.js that does not load is named, the rest stays', async () => {
  const home = casesFolder()
  own(home)
  own(home, 'domain')
  fs.writeFileSync(path.join(own(home, 'bad-engine'), 'engine.js'), 'export const commands = {\n')
  const r = await run(home, ['types'])
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /^ok      domain — .*types[\\/]domain$/m)
  assert.match(r.out, /^ok      shop-audit \(private\) — \.osint-types\/shop-audit$/m)
  assert.match(r.out, /^missing bad-engine \(private\): needs a sound manifest — \.osint-types\/bad-engine\n {8}engine\.js does not load: /m)
  assert.match(r.out, /^refused domain \(private\): domain is a plugin type's id: rename the folder and its "id" — \.osint-types\/domain$/m)
  const j = JSON.parse((await run(home, ['types', '--json'])).out)
  assert.deepEqual(j.find(t => t.id === 'shop-audit'), { id: 'shop-audit', label: 'Shop audit', private: true, path: path.join(home, '.osint-types', 'shop-audit'), where: '.osint-types/shop-audit', ready: true, missing: [], notes: [], errors: [], refused: null })
  assert.deepEqual(j.filter(t => t.id === 'domain').map(t => [t.private, t.refused === null]), [[false, true], [true, false]])
})

test('doctor lists the private types with their folder, warns of a refused one, and never runs a private engine.js; types runs it only when asked to load', async () => {
  const home = casesFolder(), mark = path.join(home, 'ran.txt'), dir = own(home)
  own(home, 'domain')
  // a cases folder received from someone else: its private engine.js would run at load (it passes the static check)
  fs.writeFileSync(path.join(dir, 'engine.js'), `${fs.readFileSync(path.join(SHOP, 'engine.js'), 'utf8')}\nprocess.stderr.write(${JSON.stringify(`WITNESS ${mark}\n`)})\n`)
  const d = JSON.parse((await run(home, ['doctor', '--json'])).out)
  const line = d.lines.find(l => l.name === 'types').text
  assert.match(line, / · private: shop-audit \(\.osint-types\/shop-audit\)/)
  assert.match(line, / · private: domain refused \(\.osint-types\/domain\)$/)
  assert.ok(d.lines.some(l => l.status === 'warning' && l.text === 'private type domain (.osint-types/domain) refused: domain is a plugin type\'s id: rename the folder and its "id"'))
  assert.deepEqual(d.types.filter(t => t.private).map(t => [t.id, t.ready, t.where]), [['shop-audit', true, '.osint-types/shop-audit'], ['domain', false, '.osint-types/domain']])
  const dr = await run(home, ['doctor'])
  assert.match(dr.out, /^types: .* · private: shop-audit \(\.osint-types\/shop-audit\)/m)
  assert.ok(!dr.err.includes('WITNESS'), 'doctor ran a private engine.js')
  assert.ok(!(await run(home, ['list'])).err.includes('WITNESS'), 'list ran a private engine.js')
  assert.ok(!(await run(home, ['types', '--no-load'])).err.includes('WITNESS'), 'types --no-load ran a private engine.js')
  assert.ok((await run(home, ['types'])).err.includes('WITNESS'), 'types checks a private engine.js by loading it')
})

test('brain context gives the method.md of the case\'s type, wherever it is', async () => {
  const home = casesFolder()
  own(home)
  await run(home, AUDIT)
  const r = await run(home, ['brain', 'context', ...P])
  assert.equal(r.status, 0, r.err)
  assert.ok(r.out.split('\n').includes(`method: ${path.join(home, '.osint-types', 'shop-audit', 'method.md')} (a private type of this cases folder)`), r.out)
  await run(home, ['new', 'domain', 'durand-bakery.example', '--question', 'Who runs it?', '--frame', 'noisy=never'])
  const d = await run(home, ['brain', 'context', '-p', 'durand-bakery-example'])
  assert.ok(d.out.split('\n').includes(`method: ${path.join(typesDir(), 'domain', 'method.md')}`), d.out)
})

test('the cases folder\'s .gitignore keeps the private types; doctor warns when a .gitignore hides them', async () => {
  const home = casesFolder()
  own(home)
  await run(home, AUDIT)
  execFileSync('git', ['init', '-q', home], { windowsHide: true })
  const files = ['type.json', 'method.md', 'engine.js', 'labels.json', 'templates/Report.md'].map(f => `.osint-types/shop-audit/${f}`)
  assert.equal(spawnSync('git', ['-C', home, 'check-ignore', ...files], { windowsHide: true }).status, 1)
  fs.appendFileSync(path.join(home, '.gitignore'), '.osint-types/\n')
  const d = JSON.parse((await run(home, ['doctor', '--json'])).out)
  assert.ok(d.lines.some(l => l.status === 'warning' && /git ignores .*\.osint-types\/t\/type\.json/.test(l.text)))
})

test('a private type can take no engine command\'s name: each command of the usage line is reserved', async () => {
  const r = await run(casesFolder(), [])
  const cmds = /usage: osint\.mjs <([^>]+)>/.exec(r.err)[1].split(' | ')
  assert.ok(cmds.includes('types'))
  assert.deepEqual(cmds.filter(c => !RESERVED_IDS.includes(c)), [])
})

const T0 = '2026-11-03T06:00:00.000Z'
const at = h => new Date(Date.parse(T0) + h * 3600e3).toISOString()
const WATCHED = { refresh: [{ id: 'checks', by: 'engine', run: 'collect', noisy: false, sends_image: false, paid: false, watch: true, noun: ['check', 'checks'] }] }

test('a private type declaring watch: true is watched only on the user\'s yes, for the code that yes covered; the dashboard cannot give it', async () => {
  const home = casesFolder(), dir = path.join(home, 'durand-shop-audit'), e = h => ({ ...env, OSINT_NOW: at(h) })
  const eng = own(home, 'shop-audit', WATCHED)
  assert.equal((await run(home, AUDIT, e(0))).status, 0)
  // the manifest's own word is not enough: the user's yes first (exit 2), nothing kept
  const no = await run(home, ['watch', ...P, '--every', '24h'], e(0))
  assert.equal(no.status, 2)
  assert.match(no.err, /private type shop-audit.*runs its engine\.js without the agent.*--yes/)
  assert.ok(!json(dir, '.osint/case.json').watch)
  // the dashboard has no yes to give
  const dash = await run(home, ['watch', ...P, '--every', '24h'], { ...e(0), OSINT_BY: 'dashboard' })
  assert.equal(dash.status, 2)
  const yes = await run(home, ['watch', ...P, '--every', '24h', '--yes'], e(0))
  assert.equal(yes.status, 0, yes.err)
  assert.ok(!('private_ok' in json(dir, '.osint/case.json').watch), 'the yes is not kept in the folder')
  assert.match(Object.values(json(process.env.OSINT_DATA, 'watch-ok.json')).find(x => x.types['shop-audit']).types['shop-audit'], /^[0-9a-f]{64}$/)
  // the pass runs the engine
  const seen0 = fake.seen.length
  const pass = await run(home, ['watch', '--due'], e(25))
  assert.equal(pass.status, 0, pass.err)
  assert.ok(fake.seen.length > seen0, 'the confirmed pass ran the engine')
  assert.match(pass.out, /^durand-shop-audit: /)
  assert.ok(!/failed/.test(pass.out), pass.out)
  // the code changed after the yes (a pull, an edit): the next pass refuses, the engine does not run, the user is told
  fs.appendFileSync(path.join(eng, 'engine.js'), '\n// edited\n')
  const seen1 = fake.seen.length
  const changed = await run(home, ['watch', '--due'], e(50))
  assert.match(changed.out, /the pass failed — .*changed since the user's yes.*watch --every 24h -p durand-shop-audit --yes/)
  assert.equal(fake.seen.length, seen1, 'a changed engine.js ran unattended')
  // the same period asked again is not a yes to the new code
  assert.equal((await run(home, ['watch', ...P, '--every', '24h'], e(51))).status, 2)
  // a watch written by hand into case.json carries no yes: nothing runs
  const f = path.join(dir, '.osint', 'case.json'), c = JSON.parse(fs.readFileSync(f, 'utf8'))
  c.watch = { every: '24h', last: null, next: at(0), error: null }
  fs.writeFileSync(f, JSON.stringify(c))
  const hand = await run(home, ['watch', '--due'], e(60))
  assert.match(hand.out, /the pass failed — .*the user's yes/)
  assert.equal(fake.seen.length, seen1)
  // the dashboard's route asks the agent for it
  const server = await startServer({ home, port: 0, dist: fs.mkdtempSync(path.join(os.tmpdir(), 'osint-dist-')), engine: ENGINE, loaded: 0, watch: false }), base = `http://127.0.0.1:${server.address().port}`
  try {
    const r = await fetch(`${base}/api/cases/durand-shop-audit/watch`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ every: '6h', yes: true }) })
    assert.equal(r.status, 400)
    assert.match((await r.json()).error, /the user's yes/)
  } finally { server.close(); server.closeAllConnections() }
})

test('the server: /api/types marks the private types, makes a case of one, and a case whose type broke still opens', async () => {
  const home = casesFolder(), dir = own(home)
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-dist-'))
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>OSINT</title>')
  // the test process has no OSINT_DIR: every lookup of the server must use its own cases folder
  const server = await startServer({ home, port: 0, dist, engine: ENGINE, loaded: 0, watch: false }), base = `http://127.0.0.1:${server.address().port}`
  try {
    const types = await (await fetch(`${base}/api/types`)).json()
    assert.deepEqual(types.filter(t => t.private).map(t => t.id), ['shop-audit'])
    assert.equal(types.find(t => t.id === 'domain').private, false)
    assert.ok(types.every(t => !('dir' in t)))
    const made = await fetch(`${base}/api/cases`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'shop-audit', inputs: { shop: 'durand-bakery.example' }, frame: { noisy: 'never' }, question: 'Can one order?', title: 'Durand shop audit', lang: 'en' }) })
    const body = await made.json()
    assert.equal(made.status, 200, JSON.stringify(body))
    assert.deepEqual(body, { slug: 'durand-shop-audit' })
    assert.equal((await (await fetch(`${base}/api/cases/durand-shop-audit`)).json()).type, 'shop-audit')
    // the type broken while it is being edited: its cases still open, without its ranking; doctor says why
    fs.writeFileSync(path.join(dir, 'type.json'), '{ "id": "shop-audit",')
    assert.deepEqual((await (await fetch(`${base}/api/types`)).json()).filter(t => t.private), [])
    assert.equal((await fetch(`${base}/api/cases`)).status, 200)
    const ix = await fetch(`${base}/api/cases/durand-shop-audit`)
    assert.equal(ix.status, 200)
    assert.deepEqual((await ix.json()).analysis, { ranked: {}, frontier: null, cells: [], exclusions: [] })
    assert.equal((await fetch(`${base}/print/durand-shop-audit`)).status, 200)
    const doc = await (await fetch(`${base}/api/doctor`)).json()
    assert.match(doc.types.find(t => t.id === 'shop-audit').refused, /^type\.json: /)
  } finally { server.close(); server.closeAllConnections() }
})

test('the server never makes, changes nor runs a private type, and never reads one from a folder a request names', async () => {
  const home = casesFolder(), other = casesFolder(), dir = own(home)
  own(other, 'evil-x')
  fs.writeFileSync(path.join(other, '.osint-types', 'evil-x', 'engine.js'), fs.readFileSync(path.join(SHOP, 'engine.js'), 'utf8') + '\nprocess.stderr.write("WITNESS\\n")\n')
  assert.equal((await run(home, AUDIT, env)).status, 0)
  const before = JSON.stringify(fs.readdirSync(dir).sort()) + fs.readFileSync(path.join(dir, 'engine.js'), 'utf8'), tree = () => fs.readdirSync(path.join(home, '.osint-types')).sort().join()
  const server = await startServer({ home, port: 0, dist: fs.mkdtempSync(path.join(os.tmpdir(), 'osint-dist-')), engine: ENGINE, loaded: 0, watch: false }), base = `http://127.0.0.1:${server.address().port}`
  const send = (method, url, body, headers = {}) => fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) })
  try {
    // a folder named in the request is no source of types: the query, the body, a header
    for (const url of [`/api/types?home=${encodeURIComponent(other)}`, `/api/types?dir=${encodeURIComponent(other)}&OSINT_DIR=${encodeURIComponent(other)}`]) assert.deepEqual((await (await send('GET', url)).json()).filter(t => t.private).map(t => t.id), ['shop-audit'])
    const evil = await send('POST', '/api/cases', { type: 'evil-x', home: other, dir: other, OSINT_DIR: other, inputs: { shop: 'durand-bakery.example' }, frame: { noisy: 'never' }, question: 'Q?' }, { 'x-osint-dir': other })
    assert.equal(evil.status, 400)
    assert.match((await evil.json()).error, /unknown case type evil-x/)
    assert.ok(!fs.existsSync(path.join(other, 'durand-bakery-example')) && !fs.existsSync(path.join(home, 'durand-bakery-example')))
    // no route makes or changes a type
    for (const [m, u] of [['POST', '/api/types'], ['PUT', '/api/types/evil'], ['POST', '/api/types/shop-audit'], ['DELETE', '/api/types/shop-audit'], ['POST', '/api/private-types'], ['PUT', '/api/types']]) {
      const r = await send(m, u, { id: 'evil', engine: 'export const commands = {}', 'engine.js': 'x', 'type.json': '{}' })
      assert.ok([200, 404, 405].includes(r.status), `${m} ${u}`)
    }
    assert.equal(tree(), 'shop-audit')
    assert.equal(JSON.stringify(fs.readdirSync(dir).sort()) + fs.readFileSync(path.join(dir, 'engine.js'), 'utf8'), before)
    // Refresh of a private type's case would run its engine.js: the dashboard does not, the agent does
    const seen0 = fake.seen.length
    const r = await send('POST', '/api/cases/durand-shop-audit/refresh')
    assert.equal(r.status, 403)
    assert.match((await r.json()).error, /private type shop-audit.*engine\.js.*Agent/)
    assert.equal(fake.seen.length, seen0)
    // …while a plugin type's case refreshes as before
    assert.equal((await run(home, ['new', 'domain', 'durand-bakery.example', '--question', 'Who?', '--frame', 'noisy=never'], env)).status, 0)
    assert.notEqual((await send('POST', '/api/cases/durand-bakery-example/refresh')).status, 403)
  } finally { server.close(); server.closeAllConnections() }
})

// headless session: « modifie le type domain » made the agent edit the plugin's engine.js without reading types.md
test('SKILL.md Modes sends a request about a case type to types.md and to a private copy, never an edit of the plugin', () => {
  const skill = fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'SKILL.md'), 'utf8')
  assert.match(skill, /\*\*A case type\*\* .*read `references\/types\.md` first\. Never edit a type of the plugin's `types\/` folder.*private copy under a new id in `\.osint-types\/<id>\/`/)
})
