import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { notify, notifyPlan, plain, startServer, startWatch } from '../lib/server.js'
import { casesFolder, ENGINE, events, FIXTURES, json, run } from './helpers.js'

const TYPES = path.join(FIXTURES, 'watch-types'), T0 = '2026-11-03T06:00:00.000Z'
const NEW = ['new', 'watched', 'thing one', '--question', 'Q?', '--frame', 'noisy=never']
const dist = fs.mkdtempSync(path.join(casesFolder(), 'dist-'))
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>OSINT</title>')
const freePort = () => new Promise(ok => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)) }) })
const post = (base, p, b, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(b) })

const HOSTILE = 'a"b<c>&d\'e 🙂 $(touch pwned) `touch pwned` ; touch pwned: 3 new certificates'

test('notifications: a click opens the case where the OS allows it; nothing the case holds reaches a shell, a script or raw XML', () => {
  const url = 'http://127.0.0.1:41387/#/c/acme-fr', msg = HOSTILE
  const mac = notifyPlan('OSINT watch', msg, url, 'darwin')
  assert.deepEqual(mac.map(t => t.bin), ['terminal-notifier', 'osascript'])
  assert.deepEqual(mac[0].args, ['-title', 'OSINT watch', '-message', msg, '-open', url])
  assert.deepEqual(mac[1].args.slice(-2), ['OSINT watch', msg])
  assert.ok(!mac[1].args.slice(0, -2).join(' ').includes('touch'), 'osascript reads the text from argv, never from the script')
  const linux = notifyPlan('OSINT watch', msg, url, 'linux')
  assert.deepEqual(linux.map(t => [t.bin, t.open ?? null]), [['notify-send', 'open'], ['notify-send', null]])
  assert.ok(linux[0].args.includes('--action=open=Open case'))
  assert.equal(linux[0].args.at(-2), 'OSINT watch')
  assert.equal(linux[0].args.at(-3), '--', 'what follows is never read as an option')
  assert.equal(linux[0].args.at(-1), 'a"b&lt;c&gt;&amp;d\'e 🙂 $(touch pwned) `touch pwned` ; touch pwned: 3 new certificates', 'the body is markup: shown as it is')
  const [win] = notifyPlan('OSINT watch', msg, url, 'win32')
  assert.equal(win.bin, 'powershell.exe')
  assert.ok(!win.args.join(' ').includes('certificates') && !win.args.join(' ').includes('touch'), 'the toast comes from an env var')
  assert.match(win.env.OSINT_TOAST, /^<toast activationType="protocol" launch="http:\/\/127\.0\.0\.1:41387\/#\/c\/acme-fr">/)
  assert.ok(win.env.OSINT_TOAST.includes('a&#34;b&#60;c&#62;&#38;d&#39;e 🙂 $(touch pwned) `touch pwned` ; touch pwned: 3 new certificates'))
  assert.ok(!/[<>"']/.test(win.env.OSINT_TOAST.replace(/<[^>]*>/g, '')), 'no raw markup character left in the text nodes')
})

test('the text of a notification is one plain line that no tool reads as an option', () => {
  assert.equal(plain('a\nb\u0007c\u202ed'), 'a b c d')
  assert.equal(plain('x'.repeat(500)).length, 240)
  for (const t of ['--urgency=critical', '-h', '@file']) {
    const [mac, , ] = notifyPlan('OSINT watch', `${t}: 2 new things`, 'http://127.0.0.1:1/#/c/x', 'darwin')
    assert.ok(!mac.args[3].startsWith('-') && !mac.args[3].startsWith('@'), t)
    assert.ok(mac.args[3].endsWith(`${t}: 2 new things`))
  }
  const [toast] = notifyPlan('t', 'a\u0000b', 'http://127.0.0.1:1/#/c/x', 'win32')
  assert.ok(!/[\u0000-\u0008]/.test(toast.env.OSINT_TOAST), 'XML 1.0 refuses control characters')
})

// the three notification tools, faked: each writes its arguments (and OSINT_TOAST) to a log and creates nothing else
function fakeTools(names) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-notify-')), log = path.join(bin, 'calls.jsonl')
  for (const n of names) {
    fs.writeFileSync(path.join(bin, n), `#!${process.execPath}\nrequire('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify({ bin: ${JSON.stringify(n)}, args: process.argv.slice(2), toast: process.env.OSINT_TOAST ?? null }) + '\\n')\n`)
    fs.chmodSync(path.join(bin, n), 0o755)
  }
  return { bin, calls: () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : []) }
}
test('notify runs the first tool this OS has with the text as arguments, falls back to the next, and shows nothing when off', { skip: process.platform === 'win32' }, async () => {
  const url = 'http://127.0.0.1:41387/#/c/acme-fr', was = { PATH: process.env.PATH, OSINT_NOTIFY: process.env.OSINT_NOTIFY }
  const tools = { darwin: ['terminal-notifier', 'osascript'], linux: ['notify-send'] }[process.platform] ?? ['notify-send']
  try {
    delete process.env.OSINT_NOTIFY
    const a = fakeTools(tools)
    process.env.PATH = `${a.bin}${path.delimiter}${was.PATH}`
    await notify('OSINT watch', HOSTILE, url)
    assert.equal(a.calls().length, 1)
    assert.ok(a.calls()[0].args.some(x => x.includes('touch pwned')), 'the text arrived as an argument')
    assert.ok(!fs.existsSync(path.join(process.cwd(), 'pwned')) && !fs.existsSync('pwned'), 'nothing was executed')
    if (process.platform === 'darwin') {   // terminal-notifier missing: osascript, with the text as its last arguments
      const b = fakeTools(['osascript'])
      process.env.PATH = `${b.bin}${path.delimiter}${path.dirname(process.execPath)}`
      await notify('OSINT watch', HOSTILE, url)
      assert.deepEqual(b.calls()[0].args.slice(-2), ['OSINT watch', HOSTILE.replace(/\s+/g, ' ')])
    }
    process.env.OSINT_NOTIFY = '0'
    const c = fakeTools(tools)
    process.env.PATH = `${c.bin}${path.delimiter}${was.PATH}`
    await notify('OSINT watch', 'x', url)
    assert.deepEqual(c.calls(), [])
  } finally { process.env.PATH = was.PATH; if (was.OSINT_NOTIFY === undefined) delete process.env.OSINT_NOTIFY; else process.env.OSINT_NOTIFY = was.OSINT_NOTIFY }
})

test('the server\'s watch: one engine run when a case is due, a notification per case that changed, none when they are off', async () => {
  const home = casesFolder()
  await run(home, NEW, { OSINT_TYPES: TYPES })
  await run(home, ['watch', '-p', 'thing-one', '--every', '6h'], { OSINT_TYPES: TYPES, OSINT_NOW: T0 })
  const runs = [], notes = []
  let now = Date.parse(T0) + 3600e3
  const fakeRun = async (h, argv) => {
    runs.push(argv)
    return { code: 0, out: JSON.stringify({ passes: [{ slug: 'thing-one', text: 'thing one: 2 new things', error: null }, { slug: 'other', text: null, error: null }] }), err: '' }
  }
  const w = startWatch({ home, engine: ENGINE, port: 41387, run: fakeRun, notify: (...a) => notes.push(a), now: () => now, every: 1e9 })
  try {
    await w.tick()
    assert.deepEqual(runs, [], 'not due: no engine run')
    now = Date.parse(T0) + 7 * 3600e3
    await w.tick()
    assert.deepEqual(runs, [['watch', '--due', '--json']])
    assert.deepEqual(notes, [['OSINT watch', 'thing one: 2 new things', 'http://127.0.0.1:41387/#/c/thing-one']])
    fs.writeFileSync(path.join(home, '.osint-settings.json'), JSON.stringify({ watch: { notify: false } }))
    await w.tick()
    assert.equal(runs.length, 2)
    assert.equal(notes.length, 1, 'notifications off')
  } finally { w.stop() }
})

test('a computer that slept: the ticks that piled up are one round, not one per tick', async () => {
  const home = casesFolder()
  await run(home, NEW, { OSINT_TYPES: TYPES })
  await run(home, ['watch', '-p', 'thing-one', '--every', '6h'], { OSINT_TYPES: TYPES, OSINT_NOW: T0 })
  let runs = 0, release
  const gate = new Promise(ok => { release = ok })
  const w = startWatch({ home, engine: ENGINE, port: 41387, run: async () => { runs++; await gate; return { code: 0, out: '{"passes":[]}', err: '' } }, notify: () => {}, now: () => Date.parse(T0) + 5 * 24 * 3600e3, every: 1e9 })
  try {
    const ticks = [w.tick(), w.tick(), w.tick()]   // the first round already runs (the watch's start): they are all that round
    await sleep(20)
    release()
    await Promise.all(ticks)
    assert.equal(runs, 1, 'a round runs at a time: the ticks that piled up are that round, not one each')
  } catch (e) { release(); throw e } finally { w.stop() }
})

test('the dashboard turns a case\'s watch on and off and sets the folder\'s switches; a Refresh clicked while a pass runs waits for it', async () => {
  const home = casesFolder(), dir = path.join(home, 'thing-one')
  await run(home, NEW, { OSINT_TYPES: TYPES })
  const order = []
  const fakeRun = async (h, argv) => {
    order.push(`start ${argv[0]}`); await sleep(300); order.push(`end ${argv[0]}`)
    return { code: 0, out: argv[0] === 'watch' ? '{"passes":[]}' : '{"diffs":[],"agent":[]}', err: '' }
  }
  let now = Date.now()
  process.env.OSINT_TYPES = TYPES
  const server = await startServer({ home, port: 0, dist, engine: ENGINE, loaded: 0, run: fakeRun, watch: { now: () => now, every: 1e9, notify: () => {} } })
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal((await post(base, '/api/cases/thing-one/watch', { every: '5m' })).status, 400)
    const on = await (await post(base, '/api/cases/thing-one/watch', { every: '12h' })).json()
    assert.deepEqual([on.watch.every, on.stops], ['12h', false])
    assert.ok(events(dir).some(e => e.kind === 'log' && e.text === 'watch every 12h' && e.by === 'dashboard'))
    const st = await (await fetch(`${base}/api/watch`)).json()
    assert.deepEqual([st.on, st.notify, st.running, st.stops, st.cases.map(c => [c.slug, c.every])], [true, true, false, false, [['thing-one', '12h']]])
    assert.ok(st.click_hint === null || typeof st.click_hint === 'string')
    assert.equal((await (await post(base, '/api/watch', { notify: false })).json()).notify, false)
    assert.equal((await post(base, '/api/watch', { on: 'yes' })).status, 400)
    now = Date.parse(json(dir, '.osint/case.json').watch.next) + 1
    const pass = server.watch.tick()
    await sleep(20)
    const click = post(base, '/api/cases/thing-one/refresh', {})
    await Promise.all([pass, click])
    assert.deepEqual(order, ['start watch', 'end watch', 'start refresh', 'end refresh'])
    assert.equal((await (await post(base, '/api/cases/thing-one/watch', { every: 'off' })).json()).watch, null)
  } finally { server.close(); delete process.env.OSINT_TYPES }
})

test('only this server\'s own page may change the watch: another origin, another port or another host is refused', async () => {
  const home = casesFolder()
  await run(home, NEW, { OSINT_TYPES: TYPES })
  const server = await startServer({ home, port: 0, dist, engine: ENGINE, loaded: 0, watch: false })
  const port = server.address().port, base = `http://127.0.0.1:${port}`
  try {
    for (const origin of [`http://127.0.0.1:${port + 1}`, 'http://evil.example', `http://127.0.0.1:${port}.evil.example`, `https://127.0.0.1:${port}`]) {
      assert.equal((await post(base, '/api/watch', { on: false }, { origin })).status, 403, origin)
      assert.equal((await post(base, '/api/cases/thing-one/watch', { every: '6h' }, { origin })).status, 403, origin)
      assert.equal((await post(base, '/__osint/quit', {}, { origin })).status, 403, origin)
    }
  } finally { server.close() }
  assert.ok(!fs.existsSync(path.join(home, '.osint-settings.json')), 'nothing was set')
  assert.equal(json(path.join(home, 'thing-one'), '.osint/case.json').watch ?? null, null)
})

test('watch: false starts no watch: a server that lives for one command (stage 12\'s export) runs no pass, even with a case due', async () => {
  const home = casesFolder()
  await run(home, NEW, { OSINT_TYPES: TYPES })
  await run(home, ['watch', '-p', 'thing-one', '--every', '24h'], { OSINT_TYPES: TYPES })
  const ran = []
  const server = await startServer({ home, port: 0, dist, engine: ENGINE, loaded: 0, run: async (h, argv) => { ran.push(argv[0]); return { code: 0, out: '{"passes":[]}', err: '' } }, watch: false })
  try {
    await sleep(50)
    assert.equal(server.watch, null)
    assert.deepEqual(ran, [])
  } finally { server.close() }
})

test('with a case watched the server outlives its agents; it stops once the last watch is off', async () => {
  const home = casesFolder()
  await run(home, NEW, { OSINT_TYPES: TYPES })
  await run(home, ['watch', '-p', 'thing-one', '--every', '24h'], { OSINT_TYPES: TYPES })
  const port = await freePort(), base = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, [ENGINE, 'serve'], { env: { ...process.env, OSINT_DIR: home, OSINT_PORT: `${port}`, OSINT_NOTIFY: '0', OSINT_TYPES: TYPES }, stdio: 'ignore', windowsHide: true })
  const exited = new Promise(ok => server.on('exit', ok))
  try {
    for (let i = 0; i < 50 && !(await fetch(`${base}/__osint`).then(() => true, () => false)); i++) await sleep(100)
    // an agent that opens the dashboard, then quits
    const agent = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 500)'], { windowsHide: true })
    assert.equal((await fetch(`${base}/__osint/owner?pid=${agent.pid}`, { method: 'POST' })).status, 200)
    await new Promise(ok => agent.on('exit', ok))
    await sleep(4500)
    assert.equal((await fetch(`${base}/__osint`)).status, 200, 'a watched case keeps the server on')
    // the folder's switch off: nothing is watched any more, the server may stop
    const off = await (await post(base, '/api/cases/thing-one/watch', { every: 'off' })).json()
    assert.equal(off.stops, true, 'the page is told the server stops')
    assert.equal(await Promise.race([exited.then(() => 'stopped'), sleep(5000).then(() => 'running')]), 'stopped')
  } finally { server.kill() }
})

test('the folder\'s switch off, the server does not outlive its agents for the watch', async () => {
  const home = casesFolder()
  await run(home, NEW, { OSINT_TYPES: TYPES })
  await run(home, ['watch', '-p', 'thing-one', '--every', '24h'], { OSINT_TYPES: TYPES })
  await run(home, ['watch', '--pause'], { OSINT_TYPES: TYPES })
  const port = await freePort(), base = `http://127.0.0.1:${port}`
  const server = spawn(process.execPath, [ENGINE, 'serve'], { env: { ...process.env, OSINT_DIR: home, OSINT_PORT: `${port}`, OSINT_NOTIFY: '0', OSINT_TYPES: TYPES }, stdio: 'ignore', windowsHide: true })
  const exited = new Promise(ok => server.on('exit', ok))
  try {
    for (let i = 0; i < 50 && !(await fetch(`${base}/__osint`).then(() => true, () => false)); i++) await sleep(100)
    const agent = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)'], { windowsHide: true })
    await fetch(`${base}/__osint/owner?pid=${agent.pid}`, { method: 'POST' })
    await new Promise(ok => agent.on('exit', ok))
    assert.equal(await Promise.race([exited.then(() => 'stopped'), sleep(6000).then(() => 'running')]), 'stopped')
  } finally { server.kill() }
})
