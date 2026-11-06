import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { casesFolder, NEW, run } from './helpers.js'

const P = ['-p', 'durand-bakery-example']
async function brainCase() {
  const home = casesFolder(), dir = path.join(home, 'durand-bakery-example')
  await run(home, NEW)
  await run(home, ['entity', 'organization', 'Boulangerie Durand SARL', '--prop', 'siren=456789122', ...P])
  await run(home, ['entity', 'tracker', 'G-DURAND123', ...P])
  await run(home, ['clue', 'Pain au levain depuis 1987, écrit sur la page d\'accueil', '--status', 'read', '--title', 'Depuis 1987', ...P])
  await run(home, ['hyp', 'add', 'Durand runs it', '--level', 'owner', '--refute-if', 'x', ...P])
  await run(home, ['log', '--phase', 'collect', 'Read the home page', ...P])
  return { home, dir }
}

test('brain context: what a new session needs to take the case up, notes edited in the vault included', async () => {
  const { home, dir } = await brainCase()
  await new Promise(ok => setTimeout(ok, 20))
  fs.appendFileSync(path.join(dir, 'Entities', 'G-DURAND123.md'), '\nThe same id is on a second shop site.\n')
  const r = await run(home, ['brain', 'context', ...P])
  assert.equal(r.status, 0, r.err)
  const t = r.out
  for (const want of ['Who runs this bakery site?', 'status: running · phase: collect', 'H01 Durand runs it', 'tracker G-DURAND123', 'Read the home page', 'Edited in the vault since the agent\'s last command:', 'Entities/G-DURAND123.md']) assert.ok(t.includes(want), want)
  assert.ok(t.split('\n').length <= 60)
  // brain context counts as the agent's command: the next one no longer lists that edit
  assert.ok(!(await run(home, ['brain', 'context', ...P])).out.includes('Edited in the vault since'))
})

test('brain context: the vault edits stay near the top and in bold, each list capped, even in a big case', async () => {
  const { home, dir } = await brainCase()
  for (let i = 0; i < 12; i++) await run(home, ['hyp', 'add', `Hypothesis ${i}`, '--level', 'owner', '--refute-if', 'x', ...P])
  for (let i = 0; i < 20; i++) await run(home, ['entity', 'tracker', `G-BIG${i}`, ...P])
  for (let i = 0; i < 12; i++) await run(home, ['clue', `Clue ${i}`, '--status', 'read', ...P])
  await new Promise(ok => setTimeout(ok, 20))
  for (let i = 0; i < 20; i++) fs.appendFileSync(path.join(dir, 'Entities', `G-BIG${i}.md`), '\nedited\n')
  const lines = (await run(home, ['brain', 'context', ...P])).out.split('\n')
  const at = lines.indexOf("**Edited in the vault since the agent's last command:**")
  assert.ok(at > 0 && at < 8, `at ${at}`)
  assert.ok(lines.some(l => /… \+8 more/.test(l)))
})

test('brain search: every term, no case nor accent; brain show: a note by id with its backlinks, a Journal line', async () => {
  const { home } = await brainCase()
  const s = JSON.parse((await run(home, ['brain', 'search', 'levain ECRIT', ...P, '--json'])).out)
  assert.deepEqual(s.map(x => x.path), ['Clues/C01 Depuis 1987.md'])
  assert.match((await run(home, ['brain', 'search', 'levain', ...P])).out, /^durand-bakery-example\/Clues\/C01 Depuis 1987\.md:\d+: /m)
  assert.deepEqual(JSON.parse((await run(home, ['brain', 'search', 'levain nowhere', ...P, '--json'])).out), [])
  const show = JSON.parse((await run(home, ['brain', 'show', 'C01', ...P, '--json'])).out)
  assert.equal(show.path, 'Clues/C01 Depuis 1987.md')
  assert.equal(show.props.status, 'read')
  const j = JSON.parse((await run(home, ['brain', 'show', 'Journal#^j002', ...P, '--json'])).out)
  assert.match(j.journal.line, /entity · organization Boulangerie Durand SARL \^j002/)
  assert.equal((await run(home, ['brain', 'show', 'nothing-here', ...P])).status, 1)
})

test('brain entities --shared: an entity found in two cases, matched on its normalized key', async () => {
  const { home } = await brainCase()
  await run(home, ['new', 'domain', 'other-shop.example', '--question', 'Who runs the other shop?', '--frame', 'noisy=never'])
  await run(home, ['entity', 'tracker', 'g-durand123', '-p', 'other-shop-example'])
  await run(home, ['entity', 'organization', 'Durand SARL', '--prop', 'siren=456 789 122', '-p', 'other-shop-example'])
  const shared = JSON.parse((await run(home, ['brain', 'entities', '--all', '--shared', '--json'])).out)
  assert.deepEqual(shared.map(e => [e.key, e.cases.map(c => c.slug)]), [
    ['organization:456789122', ['durand-bakery-example', 'other-shop-example']],
    ['tracker:g-durand123', ['durand-bakery-example', 'other-shop-example']],
  ])
  const one = JSON.parse((await run(home, ['brain', 'entities', '--kind', 'tracker', ...P, '--json'])).out)
  assert.deepEqual(one.map(e => e.value), ['G-DURAND123'])
})

test('brain search and entities without -p nor --all: a usage message, no stack', async () => {
  const { home } = await brainCase()
  for (const argv of [['brain', 'search', 'levain'], ['brain', 'entities']]) {
    const r = await run(home, argv)
    assert.equal(r.status, 1)
    assert.match(r.err, /^error: brain (search "<words>"|entities) -p <slug> \| --all$/m)
    assert.ok(!/\n\s+at /.test(r.err))
  }
})

test('brain entities --shared: two places of two cases are one when they share an OpenStreetMap id or stand within 100 m, never by a chain of steps', async () => {
  const home = casesFolder()
  for (const d of ['a.example', 'b.example', 'c.example']) assert.equal((await run(home, ['new', 'domain', d, '--question', 'Q?', '--frame', 'noisy=never'])).status, 0)
  const put = async (slug, value, ...props) => assert.equal((await run(home, ['entity', 'place', value, ...props.flatMap(p => ['--prop', p]), '-p', slug])).status, 0, value)
  await put('a-example', 'Hôtel de ville (OSM relation/284089)', 'osm=relation/284089', 'lat=48.856427', 'lon=2.352527')
  await put('b-example', 'Hôtel de Ville de Paris', 'osm=Relation/284089')                         // the same id, another name
  await put('b-example', 'SIRET 217 500 016 21445', 'lat=48.85638', 'lon=2.352485')                  // 6 m from it, no id
  await put('c-example', '48.8565, 2.352', 'lat=48.8565', 'lon=2.352')                               // 39 m from it, no id
  await put('a-example', 'Bistrot Marguerite (OSM node/697183314)', 'osm=node/697183314', 'lat=48.856282', 'lon=2.350543') // another id
  await put('a-example', 'Lyon, FR', 'coarse=true', 'center=45.7, 4.8', 'radius_m=50000')             // an IP's circle
  await put('c-example', 'Lyon, FR', 'lat=45.7', 'lon=4.8')                                          // a precise place of that name
  await put('a-example', 'Chain A', 'lat=48.86', 'lon=2.34')
  await put('b-example', 'Chain B', 'lat=48.8608', 'lon=2.34')                                       // 89 m north of A
  await put('c-example', 'Chain C', 'lat=48.8616', 'lon=2.34')                                       // 89 m north of B, 178 m from A
  const shared = JSON.parse((await run(home, ['brain', 'entities', '--all', '--shared', '--json'])).out).filter(e => e.kind === 'place')
  assert.deepEqual(shared.map(e => [e.key, e.cases.map(c => c.slug)]), [
    ['place:chain a', ['a-example', 'b-example']],
    ['place:relation/284089', ['a-example', 'b-example', 'c-example']],
  ])
})
