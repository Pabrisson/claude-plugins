import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { cleanEnv, PIN, uvCommand } from '../lib/python.js'
import { casesFolder, FIXTURES, geoEnvFor, json, read, run, uvCalls } from './helpers.js'

const TYPES = { OSINT_TYPES: path.join(FIXTURES, 'types') }
const NEWS = ['new', 'sample', 'thing', '--question', 'Q?', '--frame', 'noisy=never']
const skip = process.platform === 'win32'

test('ctx.python runs a GeoINT script with uv in a clean environment: no Google key, the caches under OSINT_DATA, the case as cwd', { skip }, async () => {
  const home = casesFolder(), env = { ...TYPES, ...geoEnvFor(home), GEMINI_API_KEY: 'g', GOOGLE_API_KEY: 'k', GOOGLE_APPLICATION_CREDENTIALS: '/c.json', MAPILLARY_TOKEN: 'MLY|1|x' }
  await run(home, NEWS, TYPES)
  const r = await run(home, ['sample', 'py', 'geo.py', 'bearings', '--from', '38.57,-7.91', '-p', 'thing'], env)
  assert.equal(r.status, 0, r.err)
  const [call] = uvCalls(env), dir = path.join(home, 'thing')
  assert.deepEqual(call.argv, ['run', '-q', path.join(env.OSINT_DATA, 'geoint', PIN.sha, 'scripts', 'geo.py'), 'bearings', '--from', '38.57,-7.91'])
  assert.equal(fs.realpathSync(call.cwd), fs.realpathSync(path.join(dir, '.osint', 'geoint')))
  for (const k of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_APPLICATION_CREDENTIALS']) assert.ok(!(k in call.env), k)
  assert.deepEqual([call.env.UV_PYTHON, call.env.UV_EXCLUDE_NEWER, call.env.MAPILLARY_TOKEN, call.env.PYTHONUTF8], ['3.12', '2026-10-29T23:30:31Z', 'MLY|1|x', '1'])
  for (const [k, d] of [['GEOINT_CACHE', 'geoint-cache'], ['HF_HOME', 'hf'], ['TORCH_HOME', 'torch'], ['PLAYWRIGHT_BROWSERS_PATH', 'playwright'], ['UV_CACHE_DIR', 'uv']]) assert.equal(call.env[k], path.join(env.OSINT_DATA, d), k)
  assert.equal(fs.realpathSync(call.env.GEOINT_PHOTOS), fs.realpathSync(dir))
  const runs = read(dir, '.osint/runs.jsonl').trim().split('\n').map(l => JSON.parse(l))
  assert.deepEqual(runs[0].produced.map(p => p.rel), ['out-geo.json'])
  assert.match(read(dir, 'Journal.md'), /· run · geo\.py bearings --from 38\.57,-7\.91 → exit 0 in \d+ s; 1 files: out-geo\.json [0-9a-f]{12}/)
  assert.ok(!fs.existsSync(path.join(env.OSINT_DATA, 'geoint', PIN.sha, 'config.local.json')))
  assert.ok(json(dir, '.osint/case.json').python_at)
})

test('ctx.python: exit code 3 without the pack; refused with a config.local.json in the pack or a script that is not its own', { skip }, async () => {
  const home = casesFolder(), env = { ...TYPES, ...geoEnvFor(home) }
  await run(home, NEWS, TYPES)
  const none = await run(home, ['sample', 'py', 'geo.py', '-p', 'thing'], { ...env, OSINT_DATA: path.join(home, 'empty') })
  assert.equal(none.status, 3)
  assert.match(none.err, /setup geoint/)
  assert.equal((await run(home, ['sample', 'py', '../evil.py', '-p', 'thing'], env)).status, 1)
  fs.writeFileSync(path.join(env.OSINT_DATA, 'geoint', PIN.sha, 'config.local.json'), '{"gemini_env_file":"~/.env"}')
  const cfg = await run(home, ['sample', 'py', 'geo.py', '-p', 'thing'], env)
  assert.equal(cfg.status, 1)
  assert.match(cfg.err, /config\.local\.json exists/)
})

test('uvCommand: an OSINT_UV that is a .js or .mjs runs with this Node, a plain one as it is, a missing one is null', () => {
  assert.deepEqual(uvCommand({ OSINT_UV: import.meta.filename }), [process.execPath, [import.meta.filename]])
  assert.deepEqual(uvCommand({ OSINT_UV: path.join(FIXTURES, 'bin', 'uv') }), [path.join(FIXTURES, 'bin', 'uv'), []])
  assert.equal(uvCommand({ OSINT_UV: path.join(FIXTURES, 'no-such-uv') }), null)
})

test('a global type command runs without a case; a raw one gets its arguments untouched', { skip }, async () => {
  const home = casesFolder()
  await run(home, NEWS, TYPES)
  const r = await run(home, ['sample', 'overall'], TYPES)
  assert.equal(r.status, 0, r.err)
  assert.match(r.out, /sample cases: thing/)
})

test('cleanEnv keeps what uv needs and no key, Google or other', () => {
  const e = cleanEnv({ PATH: '/bin', HOME: '/h', UV_CACHE_DIR: '/c', HTTPS_PROXY: 'http://p', OPENAI_API_KEY: 'sk', GEMINI_API_KEY: 'g', GOOGLE_API_KEY: 'k', GOOGLE_APPLICATION_CREDENTIALS: '/c.json', MAPILLARY_TOKEN: 't', UV_PUBLISH_TOKEN: 'u', AWS_SECRET_ACCESS_KEY: 's' })
  assert.deepEqual(Object.keys(e).sort(), ['HOME', 'HTTPS_PROXY', 'PATH', 'UV_CACHE_DIR'])
})
