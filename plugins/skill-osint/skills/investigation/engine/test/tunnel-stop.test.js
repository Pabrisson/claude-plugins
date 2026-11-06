// the tunnel's cloudflared (the fake writes its pid) dies with whatever stops the server, and one tunnel at a time per case
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, ENGINE, FIXTURES, nodeOnlyPath, PATHX, read, run } from './helpers.js'

const MEDIA = { OSINT_TYPES: path.join(FIXTURES, 'types-files') }
const TEMPLE = path.join(FIXTURES, 'images', 'evora-temple.jpg'), skip = process.platform === 'win32'
const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { if (e.code === 'ESRCH') return false; throw e } }
const gone = async pid => { for (let i = 0; i < 40; i++) { if (!alive(pid)) return true; await sleep(100) } return false }

async function setup() {
  const fake = await startFake(), home = casesFolder(), pids = path.join(home, 'cf.pids'), port = String(44000 + Math.floor(Math.random() * 2000))
  const env = { ...MEDIA, ...PATHX, ...fakeEnv(fake.url), OSINT_PORT: port, OSINT_FAKE_CF_PIDS: pids }
  await run(home, ['new', 'media', '--question', 'Where?', '--frame', 'image_may_leave=true', '--frame', 'noisy=never', '--file', TEMPLE], env)
  await run(home, ['reverse', '--files', 'E01', '--no-people', '-p', 'evora-temple'], { ...env, ...nodeOnlyPath() })
  const child = spawn(process.execPath, [ENGINE, 'serve'], { env: { ...process.env, ...env, OSINT_DIR: home, OSINT_NOTIFY: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  await new Promise((ok, ko) => { child.stdout.on('data', d => /dashboard server on/.test(d) && ok()); child.on('exit', () => ko(new Error('serve exited'))) })
  const base = `http://127.0.0.1:${port}`
  const open = () => fetch(`${base}/api/cases/evora-temple/tunnel`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ files: ['E01'] }) })
  const cf = () => (fs.existsSync(pids) ? fs.readFileSync(pids, 'utf8').trim().split('\n').filter(Boolean).map(Number) : [])
  return { fake, home, base, child, open, cf, journal: () => read(path.join(home, 'evora-temple'), 'Journal.md'), done: () => { child.kill('SIGKILL'); fake.close() } }
}

for (const how of ['SIGTERM', 'SIGHUP', 'SIGINT', 'quit']) {
  test(`serve stopped by ${how}: cloudflared is killed and the Journal says the tunnel closed`, { skip }, async () => {
    const s = await setup()
    try {
      assert.equal((await s.open()).status, 200)
      const [pid] = s.cf()
      assert.ok(pid && alive(pid))
      if (how === 'quit') await fetch(`${s.base}/__osint/quit`, { method: 'POST' }); else s.child.kill(how)
      assert.ok(await gone(pid), 'cloudflared still runs')
      assert.match(s.journal(), /tunnel closed \(server stopped\)/)
    } finally { s.done() }
  })
}

test('the server stops when its agent leaves: cloudflared dies with it', { skip }, async () => {
  const s = await setup(), agent = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'])
  try {
    await fetch(`${s.base}/__osint/owner?pid=${agent.pid}`, { method: 'POST' })
    assert.equal((await s.open()).status, 200)
    const [pid] = s.cf()
    agent.kill('SIGKILL')
    assert.ok(await gone(pid), 'cloudflared still runs')
    assert.match(s.journal(), /tunnel closed \(server stopped\)/)
  } finally { agent.kill(); s.done() }
})

test('two openings at once for a case: the second is refused (409), one cloudflared only; a later one replaces the first, which dies', { skip }, async () => {
  const s = await setup()
  try {
    const rs = await Promise.all([s.open(), s.open()])
    assert.deepEqual(rs.map(r => r.status).sort(), [200, 409])
    assert.equal(s.cf().length, 1)
    const [first] = s.cf()
    assert.equal((await s.open()).status, 200)
    assert.ok(await gone(first), 'the replaced tunnel still runs')
    assert.equal(s.cf().length, 2)
    assert.match(s.journal(), /tunnel closed \(replaced\)/)
  } finally { s.done() }
})
