import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { createCase } from '../lib/case.js'
import { getType, loadTypes, makeCtx, validateEngine, validateManifest } from '../lib/types.js'
import { casesFolder, events, FIXTURES, json, read, run } from './helpers.js'

const TYPES = { OSINT_TYPES: path.join(FIXTURES, 'types') }

test('validateManifest names each mistake of a manifest; a sound one has none', async () => {
  process.env.OSINT_TYPES = TYPES.OSINT_TYPES
  try {
    const all = loadTypes(), sample = all.find(t => t.id === 'sample'), broken = all.find(t => t.id === 'broken')
    assert.deepEqual(validateManifest(sample), [])
    assert.deepEqual(await validateEngine(sample), [])
    const e = validateManifest(broken).join('\n')
    for (const want of ['frame: person|image|noisy, not mood', 'inputs.x.kind', 'inputs.x.when: unknown input nope', 'inputs.y.options.a.icon', 'inputs.z.multiple', 'levels.l.criteria.medium', 'unknown widget pie', 'actions.a.target', 'actions.a.noisy', 'actions.a.minutes', 'pivots: unknown entity kind planet', 'method.md', 'levels.m.max.confidence: medium|low', 'levels.m.max.unless', 'levels.m.max.why']) assert.ok(e.includes(want), want)
    assert.match((await validateEngine(broken)).join('\n'), /refresh\.r: no engine\.js/)
  } finally { delete process.env.OSINT_TYPES }
})

test('a type command runs with its ctx: journaled, cmd events, its flags parsed, unknown commands listed', async () => {
  const home = casesFolder(), env = { ...TYPES, OSINT_SAMPLE_ITEMS: JSON.stringify([{ key: 'a.example' }, { key: 'b.example' }]) }
  assert.equal((await run(home, ['new', 'sample', 'thing one', '--question', 'Q?', '--frame', 'noisy=ask'], env)).status, 0)
  const r = await run(home, ['sample', 'collect', '--loud', '-p', 'thing-one'], env)
  assert.equal(r.status, 0, r.err)
  const dir = path.join(home, 'thing-one'), ev = events(dir)
  assert.deepEqual(ev.filter(e => e.kind.startsWith('cmd.')).map(e => e.kind), ['cmd.start', 'cmd.end'])
  assert.equal(ev.find(e => e.kind === 'cmd.end').data.code, 0)
  assert.equal(ev.find(e => e.kind === 'progress').text, 'loud')
  assert.match(read(dir, 'Journal.md'), /· cmd · sample collect --loud \^j\d{3}/)
  assert.ok(read(dir, 'Entities/a.example.md').includes('[[S01 Sample items]]'))
  assert.deepEqual(json(dir, '.osint/views/timeline.json').map(i => i.label), ['a.example', 'b.example'])
  const bad = await run(home, ['sample', 'dance', '-p', 'thing-one'], env)
  assert.equal(bad.status, 1)
  assert.match(bad.err, /sample: collect/)
})

test('ctx.fetch: quiet writes no Journal line; follow: false gives the redirection back', async () => {
  const s = await new Promise(ok => { const x = http.createServer((req, res) => { if (req.url.endsWith('/r')) { res.writeHead(302, { location: '/t' }); return res.end() } res.writeHead(200); res.end('target') }).listen(0, '127.0.0.1', () => ok(x)) })
  process.env.OSINT_BASE_WEB = `http://127.0.0.1:${s.address().port}`
  try {
    const home = casesFolder(), { slug } = await createCase(home, getType('domain'), { input: 'x.example', question: 'Q?', frame: { noisy: 'never' } })
    const ctx = makeCtx(home, slug, getType('domain')), journal = () => fs.readFileSync(path.join(home, slug, 'Journal.md'), 'utf8').split('\n').length
    const n = journal()
    const a = await ctx.fetch('web', 'https://x.example/r', { follow: false, quiet: true })
    assert.deepEqual([a.status, a.headers.location, journal()], [302, '/t', n])
    const b = await ctx.fetch('web', 'https://x.example/r')
    assert.deepEqual([b.status, b.body.toString(), journal() > n], [200, 'target', true])
  } finally { delete process.env.OSINT_BASE_WEB; s.close() }
})
