import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, events, NEW_EMAIL, run } from './helpers.js'

const fake = await startFake()
test.after(() => fake.close())
const xon = () => fake.seen.filter(s => s.service === 'xon').length
// the watch's clock is OSINT_NOW; XposedOrNot's own limits count real time
const later = h => ({ ...fakeEnv(fake.url), OSINT_NOW: new Date(Date.now() + h * 3600e3).toISOString() })

test('an email case is watched with the free steps only; XposedOrNot\'s limits hold in a pass, and Holehe never runs', async () => {
  const home = casesFolder(), dir = path.join(home, 'jd'), P = ['-p', 'jd']
  await run(home, NEW_EMAIL('jeanne.durand@durand-bakery.example', '--title', 'jd'), later(0))
  const w = await run(home, ['watch', ...P, '--every', '6h', '--json'], later(0))
  assert.equal(w.status, 0, w.err)
  assert.deepEqual(JSON.parse(w.out).steps, ['breaches', 'gravatar', 'mail'])
  // a pass with room under the limits: one XposedOrNot call, the three steps, no account-probe
  const mark = events(dir).length, before = xon()
  assert.equal(JSON.parse((await run(home, ['watch', '--due', '--json'], later(7))).out).passes.length, 1)
  assert.equal(xon() - before, 1)
  assert.deepEqual(events(dir).slice(mark).filter(e => e.kind === 'cmd.start').map(e => e.text).sort(),
    ['email collect --only breaches', 'email collect --only gravatar', 'email collect --only mail'])
  // the hour's calls used: the next pass sends nothing to XposedOrNot, says so, and the other steps go on
  const now = Date.now()
  fs.writeFileSync(path.join(home, '.cache', 'quota-xon.json'), JSON.stringify({ calls: Array.from({ length: 25 }, (_, i) => now - 60e3 + i) }))
  const again = xon()
  const [pass] = JSON.parse((await run(home, ['watch', '--due', '--json'], later(14))).out).passes
  assert.equal(xon(), again, 'no call left for XposedOrNot')
  assert.match(pass.error, /breaches: .*XposedOrNot allows 25 calls an hour/)
})
