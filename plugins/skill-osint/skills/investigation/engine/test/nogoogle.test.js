// Spec § 13.1: by default no Gemini and no Google Vision, proven. The engine hands GeoINT no Google key and always runs
// compare.py with --no-check; net.js refuses the Google AI hosts; the whole demo, built with the keys set, calls none of
// them. Each later case type enters this test by adding its demo case to buildDemo.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { DENY, request } from '../lib/net.js'
import { PIN } from '../lib/python.js'
import { buildDemo } from './demo-data.mjs'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, FIXTURES, geoEnvFor, PATHX, run, uvCalls } from './helpers.js'

const KEYS = { GEMINI_API_KEY: 'AIza-test-gemini-not-a-key', GOOGLE_API_KEY: 'AIza-test-google-not-a-key', GOOGLE_APPLICATION_CREDENTIALS: '/nowhere/credentials.json' }
const skip = process.platform === 'win32'
const TEMPLE = path.join(FIXTURES, 'images', 'evora-temple.jpg'), P = ['-p', 'evora-temple']
const script = (c, name) => c.argv.some(a => a.endsWith(name))
function checkCalls(env) {
  const calls = uvCalls(env)
  assert.ok(calls.length >= 4, `${calls.length} uv calls`)
  for (const c of calls) for (const k of Object.keys(KEYS)) assert.ok(!(k in c.env), `${k} reached ${c.argv.join(' ')}`)
  for (const c of calls.filter(c => script(c, 'compare.py'))) assert.ok(c.argv.includes('--no-check'), c.argv.join(' '))
  for (const c of calls.filter(c => script(c, 'intake.py'))) assert.ok(c.argv.includes('--no-compare'), c.argv.join(' '))
  for (const c of calls.filter(c => script(c, 'recon.py'))) assert.ok(c.argv[c.argv.indexOf('--skip') + 1]?.split(',').includes('compare'), c.argv.join(' '))
  assert.ok(!fs.existsSync(path.join(env.OSINT_DATA, 'geoint', PIN.sha, 'config.local.json')))
  return calls
}

test('recon, compare and run hand GeoINT no Google key; compare.py always runs --no-check, intake.py never runs its own compare', { skip }, async () => {
  const home = casesFolder(), env = { ...geoEnvFor(home), ...KEYS }, gut = path.join(home, 'gut.json')
  fs.writeFileSync(gut, JSON.stringify({ ranked: [{ place: 'Portugal', p: 60, cues: 'granite' }], would_change: 'a Spanish sign' }))
  assert.equal((await run(home, ['new', 'geolocate-image', '--file', TEMPLE, '--question', 'Where?', '--frame', 'image_may_leave=true', '--frame', 'noisy=never'], env)).status, 0)
  assert.equal((await run(home, ['geolocate-image', 'gut', '--file', gut, ...P], env)).status, 0)
  for (const argv of [['recon', '--no-people'], ['compare'], ['run', 'geo.py', 'bearing', '38.5725,-7.9075', '38.5728,-7.9072'], ['run', 'intake.py', 'E01', '--out-dir', 'again']]) {
    const r = await run(home, ['geolocate-image', ...argv, ...P], env)
    assert.equal(r.status, 0, `${argv.join(' ')}: ${r.err}`)
  }
  const calls = checkCalls(env)
  assert.ok(['recon.py', 'compare.py', 'geo.py', 'intake.py'].every(n => calls.some(c => script(c, n))))
})

test('net.js refuses the Google AI hosts, in production as in the tests', async () => {
  for (const h of DENY) await assert.rejects(request('web', `https://${h}/v1/models`), /never calls/)
  assert.deepEqual([...DENY].sort(), ['aiplatform.googleapis.com', 'generativelanguage.googleapis.com', 'vision.googleapis.com'])
})

test('the whole demo, built with Google keys in the environment, calls no Google AI host and gives GeoINT no key; doctor says Gemini and Vision are off', { skip }, async () => {
  const fake = await startFake(), home = casesFolder()
  try {
    const env = { ...process.env, ...fakeEnv(fake.url), ...geoEnvFor(home), ...PATHX, ...KEYS, OSINT_DIR: home, OSINT_NOTIFY: '0' }
    delete env.OSINT_BY
    await buildDemo(env)
    assert.ok(fs.existsSync(path.join(home, 'jeanne-durand', 'Profile.md'))) // the person case ran too
    assert.ok(fake.seen.length > 0)
    assert.ok(fake.seen.some(x => x.service === 'tor')) // the ip case ran (only the ip type reads the Tor list)
    assert.ok(['entreprises', 'bodacc'].every(s => fake.seen.some(x => x.service === s)))
    assert.ok(['geopf', 'overpass', 'panoramax', 'kartaview', 'esri'].every(s => fake.seen.some(x => x.service === s))) // the place case ran
    assert.deepEqual(fake.seen.filter(s => DENY.has(s.host)), [])
    checkCalls(env)
    // Holehe (stage 6) got no key either: cleanEnv of lib/python.js keeps none
    const holehe = JSON.parse(fs.readFileSync(path.join(home, 'contact-durand-bakery-example', '.osint', 'cache', 'holehe', 'fake-uv.json'), 'utf8'))
    assert.ok(!holehe.env.some(k => /KEY|TOKEN|SECRET|GOOGLE/i.test(k)), holehe.env.join(' '))
    // verify-media's demo case is in it: its direct search went through the fake uv, Yandex and Baidu only
    assert.ok(fs.existsSync(path.join(home, 'orage-a-merida', '.osint', 'case.json')))
    assert.ok(uvCalls(env).some(c => script(c, 'revimg.py') && c.argv.at(-1) === 'yandex,baidu'))
    const d = JSON.parse((await run(home, ['doctor', '--json'], { ...fakeEnv(fake.url), ...KEYS })).out)
    assert.deepEqual(['gemini', 'google vision'].map(n => d.lines.find(l => l.name === n)?.text.startsWith('off')), [true, true])
  } finally { fake.close() }
})
