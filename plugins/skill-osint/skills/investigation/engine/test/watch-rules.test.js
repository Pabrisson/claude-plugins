import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { getType, loadTypes, validateEngine, validateManifest } from '../lib/types.js'
import { EVERY, nextAt, PERIODS, watchable, watchSteps, watchText } from '../lib/watch-rules.js'
import { FIXTURES } from './helpers.js'

const TYPES = path.join(FIXTURES, 'watch-types')
const withTypes = (dir, fn) => {
  const was = process.env.OSINT_TYPES
  if (dir) process.env.OSINT_TYPES = dir; else delete process.env.OSINT_TYPES
  try { return fn() } finally { if (was === undefined) delete process.env.OSINT_TYPES; else process.env.OSINT_TYPES = was }
}

test('the watch runs the engine steps declared watch: true, never a noisy one, one that sends an image or one that costs, whatever the manifest says', () => {
  const m = { refresh: [
    { id: 'a', by: 'engine', run: 'x' }, { id: 'b', by: 'engine', run: 'x', watch: false },
    { id: 'c', by: 'engine', run: 'x', noisy: true }, { id: 'd', by: 'engine', run: 'x', sends_image: true },
    { id: 'e', by: 'engine', run: 'x', paid: true }, { id: 'f', by: 'engine', run: 'x', noisy: true, watch: true },
    { id: 'g', by: 'agent', section: 'y', watch: true }, { id: 'h', by: 'engine', run: 'x', watch: true },
    { id: 'i', by: 'engine', run: 'x', watch: 'yes' }, { id: 'j', by: 'engine', run: 'x', watch: true, sends_image: true },
    { id: 'k', by: 'engine', run: 'x', watch: true, paid: true },
  ] }
  // opt-in: a step nobody declared passive (a private type, a forgotten flag) is never watched
  assert.deepEqual(watchSteps(m).map(s => s.id), ['h'])
  assert.deepEqual(watchSteps({}), [])
  assert.equal(watchable(null), false)
})

test('nextAt: a period after the last pass (or after now for a first one), never in the past', () => {
  const now = Date.parse('2026-11-03T10:00:00.000Z')
  assert.equal(nextAt(null, '6h', now), '2026-11-03T16:00:00.000Z')
  assert.equal(nextAt('2026-11-03T08:00:00.000Z', '24h', now), '2026-11-04T08:00:00.000Z')
  assert.equal(nextAt('2026-10-01T08:00:00.000Z', '7d', now), '2026-11-03T10:00:00.000Z')
  assert.deepEqual(Object.keys(PERIODS), EVERY.map(e => e.value))
  assert.ok(EVERY.every(e => e.label && e.icon), 'every chip carries an icon')
})

test('watchText names what changed with the steps\' nouns; null when nothing did', () => {
  const steps = [{ id: 'crt', noun: ['certificate', 'certificates'] }, { id: 'dns', noun: ['DNS record', 'DNS records'] }]
  const d = (name, a, r, c, first = false) => ({ name, first, added: Array(a).fill({}), removed: Array(r).fill({}), changed: Array(c).fill({}) })
  assert.equal(watchText('acme.fr', [d('crt', 3, 0, 0)], steps), 'acme.fr: 3 new certificates')
  assert.equal(watchText('acme.fr', [d('crt', 1, 0, 0), d('dns', 0, 1, 2)], steps), 'acme.fr: 1 new certificate, 1 DNS record gone, 2 DNS records changed')
  assert.equal(watchText('x', [d('home', 2, 0, 0)], steps), 'x: 2 new home items')
  assert.equal(watchText('x', [d('crt', 0, 0, 0), d('dns', 5, 0, 0, true)], steps), null)
  assert.equal(watchText('x', [d('a', 1, 1, 1), d('b', 1, 0, 0)]), 'x: 1 new a item, 1 a item gone, 1 a item changed, 1 more')
})

test('validateManifest checks what a refresh step does and whether the watch may run it', async () => {
  const watched = withTypes(TYPES, () => loadTypes().find(t => t.id === 'watched'))
  assert.deepEqual(validateManifest(watched), ['refresh.sneaky.watch: never true for a step that is noisy, sends an image or costs'])
  assert.deepEqual(await validateEngine(watched), [])
  const e = validateManifest({ ...watched, refresh: [
    { id: 'g', by: 'agent', section: 'refresh-read', watch: true },
    { id: 'o', by: 'engine', run: 'collect', watch: 'yes', paid: 1, noun: ['one'] },
  ] })
  for (const want of ['refresh.g.watch: only an engine step can be watched', 'refresh.o.watch: true|false', 'refresh.o.paid: true|false', 'refresh.o.noun: ["one", "many"]']) assert.ok(e.some(x => x.startsWith(want)), want)
  // the engine never runs the sneaky step, nor the unmarked one, whatever its manifest says
  assert.deepEqual(watchSteps(watched).map(s => s.id), ['quiet'])
})

test('every shipped type is sound for the watch; domain\'s watch never visits the site itself, person\'s runs its profile', () => {
  withTypes(null, () => {
    for (const m of loadTypes()) {
      assert.deepEqual(validateManifest(m).filter(x => x.startsWith('refresh.')), [], m.id)
      for (const s of watchSteps(m)) assert.ok(s.by === 'engine' && !s.noisy && !s.sends_image && !s.paid && s.noun?.length === 2, `${m.id}.${s.id}`)
    }
    assert.deepEqual(watchSteps(getType('domain')).map(s => s.id), ['rdap', 'dns', 'crt', 'wayback', 'host'])
    // nothing that sends an image, asks a sign-up form or contacts the target's own server
    const all = loadTypes().flatMap(m => watchSteps(m).map(s => `${m.id}.${s.id}`))
    for (const never of ['domain.home', 'geolocate-image.rev', 'verify-media.direct', 'place.osm', 'phone.mentions', 'email.account-probe']) assert.ok(!all.includes(never), never)
    assert.ok(all.includes('person.profile'))
  })
})
