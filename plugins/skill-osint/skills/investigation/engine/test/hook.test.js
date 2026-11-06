import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const HOOKS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'hooks', 'hooks.json')
const command = JSON.parse(fs.readFileSync(HOOKS, 'utf8')).hooks.SessionStart[0].hooks[0].command
function runHook(env) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-hook-')), envFile = path.join(d, 'env')
  fs.writeFileSync(envFile, '')
  const r = spawnSync('sh', ['-c', command], { env: { PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: path.join(d, 'data'), CLAUDE_ENV_FILE: envFile, ...env }, encoding: 'utf8' })
  return { r, envFile, key: path.join(d, 'data', 'mapillary-token') }
}

test('SessionStart keeps the Mapillary token in the plugin data (owner only) and exports it; anything else leaves no file', { skip: process.platform === 'win32' }, () => {
  const ok = runHook({ CLAUDE_PLUGIN_OPTION_MAPILLARY_TOKEN: ' MLY|1234567890|abcdefABCDEF0123 \n' })
  assert.equal(ok.r.status, 0, ok.r.stderr)
  assert.equal(fs.readFileSync(ok.key, 'utf8'), 'MLY|1234567890|abcdefABCDEF0123')
  assert.equal(fs.statSync(ok.key).mode & 0o077, 0)
  assert.match(fs.readFileSync(ok.envFile, 'utf8'), /^export MAPILLARY_TOKEN="\$\(cat '.*mapillary-token'\)"\n$/)
  const sourced = spawnSync('sh', ['-c', `. '${ok.envFile}'; printf %s "$MAPILLARY_TOKEN"`], { encoding: 'utf8' })
  assert.equal(sourced.stdout, 'MLY|1234567890|abcdefABCDEF0123')
  for (const bad of ['', 'x;rm -rf ~', '$(id)', "a'b"]) {
    const h = runHook({ CLAUDE_PLUGIN_OPTION_MAPILLARY_TOKEN: bad })
    assert.equal(h.r.status, 0, bad)
    assert.ok(!fs.existsSync(h.key), bad)
    assert.equal(fs.readFileSync(h.envFile, 'utf8'), '', bad)
  }
})
