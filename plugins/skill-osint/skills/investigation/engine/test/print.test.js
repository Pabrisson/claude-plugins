import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import test from 'node:test'
import { admiralty } from '../lib/print.js'
import { readNote } from '../lib/vault.js'
import { casesFolder, finishedCase, json, NEW, read, run, serveHome } from './helpers.js'

const SLUG = 'durand-bakery-example'
const page = (base, q = '') => fetch(`${base}/print/${SLUG}${q}`).then(async r => ({ status: r.status, type: r.headers.get('content-type'), html: await r.text() }))

test('admiralty: the source\'s reliability then the clue\'s credibility; what is unknown cannot be judged', () => {
  assert.equal(admiralty('B', 2), 'B2')
  assert.equal(admiralty(null, 3), 'F3')
  assert.equal(admiralty('A', null), 'A6')
})

test('the print view: the case on paper in its language, its anchors, no script', async t => {
  const { home, dir } = await finishedCase()
  const { base, close } = await serveHome(home)
  t.after(close)
  const { status, type, html } = await page(base)
  assert.equal(status, 200)
  assert.equal(type, 'text/html; charset=utf-8')
  assert.match(html, /^<!doctype html>\n<html lang="fr">/)
  assert.match(html, /<title>durand-bakery\.example — Rapport<\/title>/)
  assert.ok(!/<script|EventSource|WebSocket|<link /i.test(html), 'a static page: Chrome prints it once its last request ends')
  // the cover: type, status, date; the question and the frame (Case.md's summary block); the answer
  assert.match(html, /<p class="kicker">Domaine · Terminée · Généré le \d{4}-\d{2}-\d{2} \d{2}:\d{2}<\/p>/)
  assert.ok(!html.includes('class="draft"'))
  assert.match(html, /<strong>Question<\/strong> — Who runs this bakery site\?/)
  assert.match(html, /<strong>Cadre<\/strong> — Actions bruyantes: jamais/)
  // the report: the confidence of each level with its criteria; the agent's free text escaped
  assert.match(html, /<h2>Rapport<\/h2>[\s\S]*<td>owner<\/td><td>high<\/td><td>SIREN read on the legal notice<\/td>/)
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'))
  assert.ok(!html.includes('javascript:'))
  // the hypotheses and the ACH matrix: C ×20, ✕ for the exclusion, I ×0.5; the excluded column struck through
  assert.match(html, /<tr id="H01"><td>H01<\/td><td>Durand runs it<\/td><td>owner<\/td><td>retenue<\/td><td class="num">\d+ %<\/td>/)
  assert.match(html, /<tr id="H02"><td>H02<\/td><td>An agency runs it<\/td><td>owner<\/td><td>exclue<\/td><td class="num">—<\/td>[\s\S]*?<em>Exclue<\/em> — the notice names the bakery as publisher — <a href="#C01">C01 SIREN on the legal notice<\/a> · <span class="ref">Journal › j\d{3}<\/span>/)
  assert.match(html, /<th>Indice<\/th><th>Admiralty<\/th><th>H01<\/th><th><span class="out">H02<\/span><\/th>/)
  assert.match(html, /<tr id="C01"><td>C01 SIREN on the legal notice<\/td><td>B2<\/td><td class="ach ach-C" title="[^"]+">C ×20<\/td><td class="ach ach-X">✕<\/td><\/tr>/)
  assert.match(html, /<tr id="C02"><td>C02 Agency style<\/td><td>F6<\/td><td class="ach ach-I" title="[^"]+">I ×0\.5<\/td><td><\/td><\/tr>/)
  // the sources: title escaped, URL, date, archive, full SHA-256, Admiralty per citing clue
  const s01 = readNote(path.join(dir, 'Sources', fs.readdirSync(path.join(dir, 'Sources'))[0])).props
  assert.ok(html.includes(`<tr id="S01"><td>S01</td><td>&lt;script&gt;alert(1)&lt;/script&gt; Mentions<br><a href="https://durand-bakery.example/mentions-legales">https://durand-bakery.example/mentions-legales</a></td><td class="num">${s01.accessed.slice(0, 10)}</td><td>—</td><td class="hash">${s01.sha256}</td><td><strong>B</strong><br><span class="muted">C01 B2</span></td></tr>`))
  // the evidence: a thumbnail from the local server, its SHA-256
  const e01 = json(dir, '.osint/case.json').evidence[0]
  assert.ok(html.includes(`<figure id="E01"><img src="/api/cases/${SLUG}/file?path=Evidence%2FE01-pixel.png" alt=""><figcaption><strong>E01</strong> E01-pixel.png<br><span class="hash">${e01.sha256}</span></figcaption></figure>`))
  assert.equal((await fetch(`${base}/api/cases/${SLUG}/file?path=Evidence%2FE01-pixel.png`)).status, 200)
  // no appendix unless asked
  assert.ok(!html.includes('class="appendix"'))
  assert.ok(!html.includes('id="j001"'))
  // no Profile.md, no profile section
  assert.ok(!html.includes('class="profile"'))
})

test('a person case\'s Profile.md (stage 10) is printed after the report, under its own title, with what the user wrote below it', async t => {
  const { home, dir } = await finishedCase()
  fs.writeFileSync(path.join(dir, 'Profile.md'), '%% osint:begin profile %%\n# Profile — Jeanne Durand\n\n## Username\n\n| Identifier | Case | Confidence |\n|---|---|---|\n| durand.bakery | durand-bakery | medium |\n%% osint:end profile %%\n\n%% osint:begin candidates %%\n## Candidates (not weighed)\n\n| colleague@shop.example |\n%% osint:end candidates %%\n\nWritten in Obsidian.\n')
  const { base, close } = await serveHome(home)
  t.after(close)
  const { html } = await page(base)
  assert.match(html, /<h2>Rapport<\/h2>[\s\S]*<section class="profile"><h2>Profile — Jeanne Durand<\/h2>\n<h3>Username<\/h3>[\s\S]*<td>durand\.bakery<\/td>[\s\S]*<p>Written in Obsidian\.<\/p><\/section>[\s\S]*<h2>Hypothèses<\/h2>/)
  assert.ok(!html.includes('osint:begin'))
  assert.ok(!/Candidates|colleague@shop/.test(html), 'the candidates are in the PDF')
})

test('?journal=1 appends the Journal; its references become links to their entries', async t => {
  const { home, dir } = await finishedCase()
  const { base, close } = await serveHome(home)
  t.after(close)
  const { html } = await page(base, '?journal=1')
  assert.match(html, /<section class="appendix"><h2>Annexe — Journal<\/h2><h3>\d{4}-\d{2}-\d{2}<\/h3>/)
  assert.match(html, /<li>\d{2}:\d{2}:\d{2} · case · created \(domain: durand-bakery\.example\) — Who runs this bakery site\? <span class="block" id="j001"><\/span><\/li>/)
  const jx = /· exclude · .* \^(j\d+)$/m.exec(read(dir, 'Journal.md'))[1]
  assert.ok(html.includes(`<a href="#${jx}">Journal › ${jx}</a>`))
  assert.ok(html.includes(`id="${jx}"`))
  assert.match(html, /<a href="\?">Hide the Journal appendix<\/a>/)
})

test('a draft says so; evidence changed or gone since it was added is marked; unknown cases and other hosts are refused', async t => {
  const home = casesFolder()
  await run(home, NEW)
  const { base, close } = await serveHome(home)
  t.after(close)
  const draft = (await page(base)).html
  assert.match(draft, /<html lang="en">/)
  assert.match(draft, /<p class="kicker">Domain · Draft · Generated on /)
  assert.match(draft, /<p class="draft">Draft: this case is not concluded yet\.<\/p>/)
  assert.match(draft, /<h2>Hypotheses<\/h2><p>none<\/p>/)
  const { home: h2, dir } = await finishedCase()
  const other = await serveHome(h2)
  t.after(other.close)
  const f = path.join(dir, 'Evidence', 'E01-pixel.png')
  fs.chmodSync(f, 0o644)
  fs.writeFileSync(f, 'two')
  assert.ok((await page(other.base)).html.includes('<span class="warn">Modifié depuis son ajout : le SHA-256 diffère</span>'))
  fs.rmSync(f)
  const gone = (await page(other.base)).html
  assert.ok(gone.includes('<span class="warn">Absent du dossier de l&#39;enquête</span>'))
  assert.ok(gone.includes('<div class="file">PNG</div>'))
  assert.equal((await fetch(`${base}/print/nope`)).status, 404)
  const evil = await new Promise(ok => http.get(`${base}/print/${SLUG}`, { headers: { host: 'evil.example' } }, ok))
  assert.equal(evil.statusCode, 403)
})

// the headless browser that prints the page must never follow a link nor load a third party's resource, whatever the
// notes quote: the page has none, and its Content-Security-Policy would stop one anyway
const get = (base, p, headers = {}) => new Promise(ok => http.get(`${base}${p}`, { headers }, r => { r.resume(); ok(r) }))
const sha = text => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

test('print view CSP: nothing may load but the local images; the style and the Print handler by their hashes', async t => {
  const { home } = await finishedCase()
  const { base, close } = await serveHome(home)
  t.after(close)
  const r = await fetch(`${base}/print/${SLUG}`), html = await r.text(), csp = r.headers.get('content-security-policy')
  const dir = Object.fromEntries(csp.split(';').map(d => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]))
  assert.deepEqual(dir['default-src'], ["'none'"])
  assert.deepEqual(dir['img-src'], ["'self'"])
  assert.deepEqual(dir['style-src'], [sha(/<style>([\s\S]*?)<\/style>/.exec(html)[1])])
  assert.deepEqual(dir['script-src'], ["'unsafe-hashes'", sha(/onclick="([^"]*)"/.exec(html)[1])])
  assert.deepEqual([dir['base-uri'], dir['form-action'], dir['frame-ancestors']], [["'none'"], ["'none'"], ["'none'"]])
  assert.ok(!/unsafe-inline|unsafe-eval|\*|https?:/.test(csp))
  assert.equal(r.headers.get('x-frame-options'), 'DENY')
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer')
})

test('print view: a hostile note and hostile evidence add no resource, frame, script or remote link to the page', async t => {
  const { home, dir } = await finishedCase()
  fs.writeFileSync(path.join(dir, 'Report.md'), [
    '![pixel](https://tracker.example/p.png) ![[evil.svg]] ![[nothing.png]]',
    '<iframe src="https://evil.example/"></iframe><link rel="stylesheet" href="https://evil.example/x.css"><object data="x"></object><embed src="x"><base href="https://evil.example/">',
    '<style>@import url(https://evil.example/x.css)</style><meta http-equiv="refresh" content="0;url=https://evil.example/">',
    '[a](javascript:alert(1)) [b](data:text/html,x) [c](vbscript:x) [d](//evil.example/) [e](file:///etc/passwd)', '',
  ].join('\n'))
  fs.writeFileSync(path.join(dir, 'Evidence', 'evil.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  fs.writeFileSync(path.join(dir, 'Evidence', 'page.html'), '<script>fetch("https://evil.example/")</script>')
  for (const f of ['evil.svg', 'page.html']) assert.equal((await run(home, ['evidence', path.join(dir, 'Evidence', f), '-p', SLUG])).status, 0)
  const { base, close } = await serveHome(home)
  t.after(close)
  const html = (await page(base, '?journal=1')).html
  assert.ok(!/<(iframe|link|object|embed|base|meta http-equiv|frame|form|svg|video|audio|source|input type="(?!checkbox))/i.test(html.replace(/<meta charset="utf-8"><meta name="viewport"[^>]*><meta name="referrer"[^>]*>/, '')), 'no element that loads or leaves')
  assert.equal([...html.matchAll(/<style/g)].length, 1)
  assert.ok(!/@import|url\(/i.test(/<style>([\s\S]*?)<\/style>/.exec(html)[1]), 'the one stylesheet is the page\'s own')
  assert.ok(html.includes('&lt;style&gt;@import'), 'a quoted stylesheet is text')
  assert.deepEqual([...html.matchAll(/\ssrc="([^"]*)"/g)].map(m => m[1].replace(/\?.*/, '')), [`/api/cases/${SLUG}/file`, `/api/cases/${SLUG}/file`].slice(0, 1), 'the only image is the evidence picture, from this server')
  assert.ok(!html.includes('evil.svg"') && html.includes('<div class="file">SVG</div>') && html.includes('<div class="file">HTML</div>'), 'an SVG or an HTML capture is a tile, never drawn')
  const hrefs = [...html.matchAll(/\shref="([^"]*)"/g)].map(m => m[1])
  assert.ok(hrefs.every(h => /^(https?:|mailto:|#|\/#\/c\/|\?)/.test(h)), hrefs.join(' '))
  assert.ok(!hrefs.some(h => /^(javascript|data|vbscript|file|\/\/)/i.test(h)))
  assert.ok(html.includes('<a href="https://tracker.example/p.png">pixel</a>'))
})

test('print view origin: only this server\'s exact origin and host (port included) get a page, and only by GET', async t => {
  const { home } = await finishedCase()
  const { base, close } = await serveHome(home)
  t.after(close)
  const port = +new URL(base).port
  assert.equal((await get(base, `/print/${SLUG}`, { origin: base })).statusCode, 200)
  assert.equal((await get(base, `/print/${SLUG}`, { origin: `http://localhost:${port}` })).statusCode, 200)
  for (const origin of ['https://evil.example', `http://127.0.0.1:${port + 1}`, `http://127.0.0.1:${port}.evil.example`, `https://127.0.0.1:${port}`, 'null']) assert.equal((await get(base, `/print/${SLUG}`, { origin })).statusCode, 403, origin)
  for (const host of ['evil.example', `127.0.0.1:${port + 1}`, '127.0.0.1', `evil.example:${port}`]) assert.equal((await get(base, `/print/${SLUG}`, { host })).statusCode, 403, host)
  assert.equal((await fetch(`${base}/print/${SLUG}`, { method: 'POST' })).status, 405)
})
