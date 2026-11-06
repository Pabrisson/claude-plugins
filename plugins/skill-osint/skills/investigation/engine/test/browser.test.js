import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { browserMissing, findBrowser, fullPaths, packBrowsers, pdfBrowser, printToPdf, shellPaths, systemBrowsers } from '../lib/browser.js'
import { FAKE_BROWSER } from './helpers.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'osint-br-'))
const put = (root, dir, rel) => { const f = path.join(root, dir, ...rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ''); return f }

test('pdfBrowser: OSINT_BROWSER forces its path and nothing else is tried; findBrowser lists only the machine\'s browsers', () => {
  const f = path.join(tmp(), 'my-chrome')
  fs.writeFileSync(f, '')
  assert.deepEqual(pdfBrowser({ OSINT_BROWSER: f }), { kind: 'env', name: `OSINT_BROWSER (${f})`, path: f })
  assert.equal(pdfBrowser({ OSINT_BROWSER: `${f}-gone` }), null)
  assert.ok(!findBrowser({ OSINT_BROWSER: f }).some(b => b.path === f))
  assert.match(browserMissing({ OSINT_BROWSER: `${f}-gone` }), /is not a file — the PDF export is off; Print view in the dashboard prints from any browser$/)
  assert.match(browserMissing({}), /^no Chrome, Chromium or Edge \(.+\) — the PDF export is off/)
})

test('the system browsers in order: Chrome, Chromium, Edge, each with its kind', () => {
  const env = { PROGRAMFILES: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local', PATH: '' }
  const kinds = [...new Set(systemBrowsers(env).map(b => `${b.kind}:${b.name}`))]
  assert.deepEqual(kinds, ['chrome:Google Chrome', 'chromium:Chromium', 'edge:Microsoft Edge'])
})

test('the GeoINT pack Chromium: the headless shell first, the newest build first, after the system browsers', () => {
  const root = tmp()
  const full = put(root, 'chromium-1234', fullPaths()[0]), old = put(root, 'chromium_headless_shell-1200', shellPaths()[0]), shell = put(root, 'chromium_headless_shell-1234', shellPaths()[0])
  fs.mkdirSync(path.join(root, 'ffmpeg-1011'))
  assert.deepEqual(packBrowsers(root).filter(b => fs.existsSync(b.path)).map(b => b.path), [shell, old, full])
  assert.deepEqual(packBrowsers(path.join(root, 'none')), [])
  const all = findBrowser(process.env, { pack: root })
  assert.deepEqual(all.filter(b => b.kind === 'pack').map(b => [b.name, b.path]), [shell, old, full].map(p => ['Chromium of the GeoINT pack', p]))
  assert.ok(all.findIndex(b => b.kind === 'pack') === all.length - 3, 'the pack comes after the system browsers')
  assert.equal(new Set(all.map(b => b.path)).size, all.length)
})

test('util.js re-exports findBrowser: loaded first, the two modules that import each other still work', () => {
  const util = new URL('../lib/util.js', import.meta.url).href
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', `const u = await import(${JSON.stringify(util)}); console.log(Array.isArray(u.findBrowser()))`], { encoding: 'utf8', windowsHide: true })
  assert.equal(out.trim(), 'true')
})

test('printToPdf: the page printed in a throwaway profile; a crash or a hang leaves no file', async () => {
  const server = http.createServer((_, res) => res.end('<h1>hi</h1>'))
  await new Promise(ok => server.listen(0, '127.0.0.1', ok))
  const url = `http://127.0.0.1:${server.address().port}/print/x`, dir = tmp(), out = path.join(dir, 'a.pdf'), log = path.join(dir, 'log.json')
  const fake = { kind: 'env', name: 'fake', path: FAKE_BROWSER }
  try {
    process.env.OSINT_FAKE_BROWSER_LOG = log
    assert.deepEqual(await printToPdf(fake, url, out), { ok: true })
    assert.equal(fs.readFileSync(out, 'latin1').slice(0, 5), '%PDF-')
    const b = JSON.parse(fs.readFileSync(log, 'utf8'))
    assert.deepEqual(b.args.slice(0, 3), ['--headless', '--disable-gpu', '--no-pdf-header-footer'])
    assert.match(b.args[3], /^--user-data-dir=.*osint-pdf-/)
    assert.equal(b.profile, true)
    assert.ok(!fs.existsSync(b.args[3].slice('--user-data-dir='.length)))
    assert.deepEqual(b.args.slice(4), ['--virtual-time-budget=10000', `--print-to-pdf=${out}`, url])
    assert.equal(b.html, '<h1>hi</h1>')
    process.env.OSINT_FAKE_BROWSER = 'fail'
    const failed = await printToPdf(fake, url, out)
    assert.equal(failed.ok, false)
    assert.match(failed.why, /^exited with 1 \(fake browser: crashed\)$/)
    assert.ok(!fs.existsSync(out))
    process.env.OSINT_FAKE_BROWSER = 'empty'
    assert.match((await printToPdf(fake, url, out)).why, /^wrote no PDF/)
    process.env.OSINT_FAKE_BROWSER = 'hang'
    const t = Date.now(), hung = await printToPdf(fake, url, out, { timeout: 1500 })
    assert.match(hung.why, /^did not finish within 2 s/)
    assert.ok(Date.now() - t < 5000)
    assert.ok(!fs.existsSync(out))
    // killed by the timeout after writing only the start of a PDF: not a PDF
    process.env.OSINT_FAKE_BROWSER = 'half'
    const half = await printToPdf(fake, url, out, { timeout: 1500 })
    assert.equal(half.ok, false)
    assert.match(half.why, /^did not finish within 2 s/)
    assert.ok(!fs.existsSync(out))
  } finally {
    delete process.env.OSINT_FAKE_BROWSER
    delete process.env.OSINT_FAKE_BROWSER_LOG
    server.close()
  }
})
