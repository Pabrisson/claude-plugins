// A throwaway cases folder and the engine run in it, as the agent runs it.
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { startServer } from '../lib/server.js'

// the user's arming of a watch (watch-ok.js) lives in dataDir(): a test never writes the real one
process.env.OSINT_DATA ??= fs.mkdtempSync(path.join(os.tmpdir(), 'osint-data-'))
export const ENGINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'osint.mjs')
export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
export const FAKE_BROWSER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fake-browser.mjs')
export const casesFolder = () => fs.mkdtempSync(path.join(os.tmpdir(), 'osint-cases-'))
export function run(home, argv, env = {}) {
  return new Promise(ok => {
    // no desktop notification, and no dashboard server started by `watch --every`, from the tests
    const e = { ...process.env, OSINT_DIR: home, OSINT_NOTIFY: '0', OSINT_SERVE: '0', ...env }
    delete e.OSINT_BY
    const p = spawn(process.execPath, [ENGINE, ...argv], { env: e, windowsHide: true })
    let out = '', err = ''
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('close', status => ok({ status, out, err }))
  })
}
export const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8')
export const json = (dir, rel) => JSON.parse(read(dir, rel))
export const events = dir => read(dir, '.osint/events.jsonl').trim().split('\n').map(l => JSON.parse(l))
export const NEW = ['new', 'domain', 'durand-bakery.example', '--question', 'Who runs this bakery site?', '--frame', 'noisy=never']
export const BIN = path.join(FIXTURES, 'bin')
// the fake binaries (uv, cloudflared, yt-dlp) first on the PATH; Node scripts run by their shebang (not on Windows)
export const PATHX = { PATH: `${BIN}${path.delimiter}${process.env.PATH}` }
if (process.platform !== 'win32' && fs.existsSync(BIN)) for (const f of fs.readdirSync(BIN)) fs.chmodSync(path.join(BIN, f), 0o755)
export const hasFfmpeg = !spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', windowsHide: true }).error
import { PIN } from '../lib/python.js'
// the GeoINT pack as setup geoint leaves it (its folder with its scripts, its info file) under a test's OSINT_DATA
export function fakePack(data) {
  const dir = path.join(data, 'geoint', PIN.sha)
  for (const d of ['scripts', 'references', 'tests']) fs.mkdirSync(path.join(dir, d), { recursive: true })
  for (const s of ['recon.py', 'compare.py', 'intake.py', 'detect.py', 'imgprep.py', 'sweep.py', 'pano.py', 'geo.py', 'revimg.py', 'doctor.py', 'clues.py', 'photo_session.py', 'board.py', 'triage.py', 'bench.py', 'sun.py', 'osm.py']) fs.writeFileSync(path.join(dir, 'scripts', s), '# fake\n')
  fs.writeFileSync(path.join(data, 'geoint', `${PIN.sha}.json`), JSON.stringify({ sha: PIN.sha, date: PIN.date, tests_ok: true, models_ok: true }))
  return dir
}
// a test that runs GeoINT scripts: the fake pack, and the fake uv that notes each call
export function geoEnvFor(home) {
  const data = path.join(home, '.data')
  fakePack(data)
  return { OSINT_DATA: data, OSINT_UV: path.join(BIN, 'uv'), OSINT_UV_LOG: path.join(home, 'uv.jsonl') }
}
export const uvCalls = env => (fs.existsSync(env.OSINT_UV_LOG) ? fs.readFileSync(env.OSINT_UV_LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [])

// a PATH with node alone (the fake binaries run by `#!/usr/bin/env node`), so that ffmpeg, cloudflared… are missing
export function nodeOnlyPath() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-path-'))
  fs.symlinkSync(process.execPath, path.join(d, 'node'))
  return { PATH: d }
}
// a new email case with its whole frame (a person is always the subject: a legal basis)
export const NEW_EMAIL = (address, ...more) => ['new', 'email', address, '--question', 'Who uses this address, and is it still in use?',
  '--frame', 'legal_basis=Legitimate interest — checking a seller before a bulk order', '--frame', 'noisy=ask', ...more]

// a 1×1 PNG: an evidence picture for the print view
export const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
// a finished domain case in French: a source whose title quotes a page's HTML, two clues (one graded B2), two
// hypotheses (one excluded), a red team, the conclusion, one picture, and the agent's free text in Report.md
export async function finishedCase() {
  const home = casesFolder(), dir = path.join(home, 'durand-bakery-example'), P = ['-p', 'durand-bakery-example']
  const file = (name, v) => { const f = path.join(home, name); fs.writeFileSync(f, typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(v)); return f }
  const created = await run(home, [...NEW, '--lang', 'fr'])
  assert.equal(created.status, 0, created.err)
  for (const argv of [
    ['source', 'https://durand-bakery.example/mentions-legales', '--file', file('page.html', '<title>Mentions</title>RCS 456 789 122'), '--reliability', 'B', '--title', '<script>alert(1)</script> Mentions'],
    ['clue', 'SIREN 456 789 122 on the legal notice', '--status', 'read', '--credibility', '2', '--sources', 'S01', '--title', 'SIREN on the legal notice'],
    ['clue', 'Same style as an agency\'s sites', '--status', 'observed', '--title', 'Agency style'],
    ['hyp', 'add', 'Durand runs it', '--level', 'owner', '--refute-if', 'the RCS names another company'],
    ['hyp', 'add', 'An agency runs it', '--level', 'owner', '--refute-if', 'the notice names the bakery as publisher'],
    ['hyp', 'lr', 'H01', '--clue', 'C01', '--lr', '20', '--why', 'the SIREN is the bakery\'s'],
    ['hyp', 'lr', 'H01', '--clue', 'C02', '--lr', '0.5', '--why', 'an agency\'s style'],
    ['hyp', 'exclude', 'H02', '--clue', 'C01', '--why', 'the notice names the bakery as publisher'],
    ['redteam', '--file', file('rt.json', { target: 'H01', outcome: 'survives', refutations: [{ test: 'Is the SIREN another company\'s?', result: 'no: the RCS line names Boulangerie Durand SARL' }] })],
    ['conclude', '--file', file('c.json', { answer: 'H01', confidence: { owner: 'high' }, criteria: { owner: 'SIREN read on the legal notice' }, alternatives: [], unresolved: ['C02'] })],
    ['evidence', file('pixel.png', Buffer.from(PNG, 'base64'))],
    ['note', 'Report.md', '--text', '[click](javascript:alert(1)) <img src=x onerror=alert(1)>'],
  ]) {
    const r = await run(home, [...argv, ...P])
    assert.equal(r.status, 0, `${argv.join(' ')}: ${r.err}`)
  }
  return { home, dir }
}
// the dashboard server of a cases folder on a free port, with a stand-in dashboard page
export async function serveHome(home) {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-dist-'))
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>OSINT</title>')
  const server = await startServer({ home, port: 0, dist, engine: ENGINE, loaded: 0 })
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => { server.close(); server.closeAllConnections() } }
}
