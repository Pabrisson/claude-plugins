import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { setupPlan } from '../lib/doctor.js'
import { PIN } from '../lib/python.js'
import { findBrowser } from '../lib/util.js'
import { fakeEnv, startFake } from './fake.mjs'
import { BIN, casesFolder, fakePack, FIXTURES, run, uvCalls } from './helpers.js'

const skip = process.platform === 'win32'
// a GeoINT stand-in: a git repository with the files setup reads, one commit
function localRepo(root) {
  const repo = path.join(root, 'GeoINT')
  for (const d of ['scripts', 'tests', 'references']) fs.mkdirSync(path.join(repo, d), { recursive: true })
  for (const f of ['scripts/recon.py', 'scripts/doctor.py', 'tests/test_tools.py', 'tests/test_runtime.py', 'tests/test_photo_session.py', 'references/workflow.md']) fs.writeFileSync(path.join(repo, f), '# stand-in\n')
  fs.writeFileSync(path.join(repo, '.gitignore'), '__pycache__/\n.geo-cache/\n')
  const git = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...a], { encoding: 'utf8' }).trim()
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'pin')
  return { repo, sha: git('rev-parse', 'HEAD') }
}
const envOf = (home, { repo, sha }) => ({ OSINT_DATA: path.join(home, '.data'), OSINT_UV: path.join(BIN, 'uv'), OSINT_UV_LOG: path.join(home, 'uv.jsonl'), OSINT_GEOINT_REPO: repo, OSINT_GEOINT_PIN: sha })

test('setupPlan: Chromium only without Chrome, the sizes and the licence; not enough space is a refusal', () => {
  const a = setupPlan({ free: 50e9, chrome: true, ...PIN, dir: '/d' }), b = setupPlan({ free: 5e9, chrome: false, ...PIN, dir: '/d' })
  assert.equal(a.ok, true)
  assert.ok(!a.lines.some(l => /Chromium/.test(l)))
  assert.ok(a.lines.some(l => /about 6\.8 GB of models \(StreetCLIP \+ GeoCLIP 3\.5 GB, MegaLoc 1\.7 GB, OWLv2 0\.6 GB, GeoCalib 0\.1 GB/.test(l)))
  assert.ok(a.lines.some(l => /CC BY-NC 4\.0/.test(l)))
  assert.equal(b.ok, false)
  assert.ok(b.lines.some(l => /install Chromium/.test(l)))
  assert.ok(Math.abs(b.need - a.need - 0.15) < 1e-9)
})

test('setup geoint says what it will do and waits for the user\'s yes (exit code 2)', { skip }, async () => {
  const home = casesFolder(), env = envOf(home, localRepo(home))
  const r = await run(home, ['setup', 'geoint'], env)
  assert.equal(r.status, 2)
  for (const want of [/clone .*GeoINT at [0-9a-f]{8}/, /about 6\.8 GB of models/, /CC BY-NC 4\.0/, /free space: [\d.]+ GB available, [\d.]+ GB needed/, /setup geoint --yes/]) assert.match(r.err, want)
  assert.ok(!fs.existsSync(path.join(env.OSINT_DATA, 'geoint', env.OSINT_GEOINT_PIN)))
})

test('setup geoint --yes clones the pinned commit, loads the models, runs the pack\'s tests and writes its info; twice is a no-op; a changed pack is refused', { skip }, async () => {
  const home = casesFolder(), pinned = localRepo(home), env = envOf(home, pinned)
  const r = await run(home, ['setup', 'geoint', '--yes'], env)
  assert.equal(r.status, 0, r.err)
  const dir = path.join(env.OSINT_DATA, 'geoint', pinned.sha), info = JSON.parse(fs.readFileSync(`${dir}.json`, 'utf8'))
  assert.equal(execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), pinned.sha)
  assert.deepEqual([info.models_ok, info.tests_ok, info.tests.length], [true, true, 3])
  const calls = uvCalls(env)
  assert.ok(calls.some(c => c.argv.includes(path.join(dir, 'scripts', 'doctor.py')) && c.argv.includes('--models')))
  assert.equal(calls.filter(c => c.argv.some(a => /test_(tools|runtime|photo_session)\.py$/.test(a))).length, 3)
  assert.equal(calls.some(c => c.argv[0] === 'tool'), !findBrowser().some(b => b.kind === 'chrome'))
  for (const c of calls) assert.ok(!('GEMINI_API_KEY' in c.env))
  assert.ok(!fs.existsSync(path.join(dir, 'config.local.json')))
  assert.match((await run(home, ['setup', 'geoint', '--yes'], env)).out, /ok geoint pack/)
  fs.rmSync(`${dir}.json`)
  fs.chmodSync(path.join(dir, 'scripts', 'recon.py'), 0o644)
  fs.appendFileSync(path.join(dir, 'scripts', 'recon.py'), '# edited\n')
  const changed = await run(home, ['setup', 'geoint', '--yes'], env)
  assert.equal(changed.status, 1)
  assert.match(changed.err, /was changed/)
})

test('doctor: the pack a type needs, the browser for direct reverse search, the geolocation services and the Mapillary token', { skip }, async () => {
  const home = casesFolder(), types = { OSINT_TYPES: path.join(FIXTURES, 'types'), OSINT_DATA: path.join(home, '.data') }
  const line = (d, name) => d.lines.find(l => l.name === name)
  const before = JSON.parse((await run(home, ['doctor', '--json'], types)).out)
  assert.deepEqual([line(before, 'geoint pack').status, line(before, 'geoint pack').text], ['missing', 'osint.mjs setup geoint (about 6.8 GB of models, asks first) — nothing of this type runs'])
  assert.deepEqual(before.types.find(t => t.id === 'needs').missing.includes('the GeoINT pack'), true)
  assert.match(line(before, 'browser').text, /direct reverse search|installs Chromium/)
  fakePack(types.OSINT_DATA)
  const after = JSON.parse((await run(home, ['doctor', '--json'], types)).out)
  assert.match(line(after, 'geoint pack').text, new RegExp(`^geoint pack ${PIN.sha.slice(0, 8)} \\(2026-10-29\\) in `))
  assert.equal(after.lines.filter(l => l.name === 'git').length, 1)
  const fake = await startFake()
  try {
    const net = JSON.parse((await run(home, ['doctor', '--network', '--json'], { ...types, ...fakeEnv(fake.url), MAPILLARY_TOKEN: 'MLY|1|abc' })).out)
    for (const s of ['nominatim', 'openmeteo', 'hf', 'mapillary']) assert.equal(line(net, s)?.status, 'ok', s)
    assert.ok(!fake.seen.some(s => s.query.toString().includes('MLY')))
  } finally { fake.close() }
})
