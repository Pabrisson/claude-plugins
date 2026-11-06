// The tunnel that lends the reverse-search engines a public URL for a few files: a local server at a random path
// (/<32 hex>/<n>.jpg) behind a Cloudflare quick tunnel (cloudflared, no account), as media-generator's tunnel() does;
// the links are given once the name answers on the public DNS (DNS over HTTPS: this machine's resolver would cache a
// miss). The dashboard's server holds it (reverse asks it) and closes it at its time, on reverse --close, when the
// case is deleted or when the server stops. sendList says what may go through it.
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { readCase } from './case.js'
import { request } from './net.js'
import { evidenceFile, reverseOf } from './records.js'
import { engineOf, sendable } from './reverse.js'
import { fail, hasBin, INSTALL, mimeOf, nowIso } from './util.js'
import { readNote } from './vault.js'

export function serveFiles(files) {
  const token = randomBytes(16).toString('hex'), names = files.map((f, i) => `${i + 1}${path.extname(f).toLowerCase()}`), served = []
  const server = http.createServer((req, res) => {
    const i = names.findIndex(n => new URL(req.url, 'http://x').pathname === `/${token}/${n}`)
    if (i < 0 || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); return res.end() }
    served.push({ at: nowIso(), file: files[i], ua: String(req.headers['user-agent'] ?? '').slice(0, 200), engine: engineOf(req.headers['user-agent']) })
    res.writeHead(200, { 'Content-Type': mimeOf(files[i]), 'Content-Length': fs.statSync(files[i]).size, 'Cache-Control': 'no-store' })
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(files[i]).pipe(res)
  })
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({ port: server.address().port, token, names, served, server })))
}

// ponytail: one public resolver (Cloudflare's); media-generator also waits for Google's: add it if an engine reports
// the link unreachable
export async function openTunnel(files) {
  if (!hasBin('cloudflared')) fail(`reverse search by link needs cloudflared: ${INSTALL.cloudflared} (no account); Yandex and Baidu work without it (geolocate-image recon)`, 3)
  const s = await serveFiles(files)
  const cf = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${s.port}`], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
  let closed = false
  const close = () => { if (closed) return; closed = true; cf.kill(); s.server.close(); s.server.closeAllConnections() }
  try {
    const base = await new Promise((ok, ko) => {
      let log = ''
      const t = setTimeout(() => ko(new Error('the Cloudflare tunnel did not open in 60 s')), 60e3)
      cf.on('error', e => { clearTimeout(t); ko(e) })
      cf.on('exit', code => { clearTimeout(t); ko(new Error(`cloudflared stopped (${code}): ${log.trim().split('\n').pop()}`)) })
      cf.stderr.on('data', d => {
        log += d
        const url = log.match(/https:\/\/[\w-]+\.trycloudflare\.com/)?.[0]
        if (url && /Registered tunnel connection/.test(log)) { clearTimeout(t); ok(url) }
      })
    })
    const host = new URL(base).hostname
    for (let i = 0; ; i++) {
      const r = await request('doh', `/dns-query?name=${host}&type=A`, { accept: 'application/dns-json', timeout: 5000 }).catch(() => null)
      const j = r?.status === 200 ? JSON.parse(r.body.toString('utf8')) : null
      if (j?.Status === 0 && j.Answer?.length) break
      if (i >= 90) throw new Error(`the tunnel's name ${host} did not resolve in 90 s`)
      await sleep(1000)
    }
    return { base, urls: s.names.map(n => `${base}/${s.token}/${n}`), served: s.served, close }
  } catch (e) { close(); throw e }
}

// doctor --network: a file of random bytes served, read back from outside, compared, the tunnel closed
export async function probeTunnel() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-tunnel-')), f = path.join(d, 'probe.txt'), want = randomBytes(12).toString('hex')
  fs.writeFileSync(f, want)
  const t0 = Date.now(), t = await openTunnel([f])
  try {
    const r = await request('web', t.urls[0], { timeout: 20000, retries: 2 })
    const got = r.body.toString('utf8')
    if (got !== want) throw new Error(`read back ${JSON.stringify(got.slice(0, 40))} instead of the file`)
    return { ms: Date.now() - t0, url: t.urls[0] }
  } finally { t.close(); fs.rmSync(d, { recursive: true, force: true }) }
}

// what a case may send out, or why not: the frame first, then each file (masked, or declared clear by the agent);
// verify-media alone may send an image unmasked (it looks for exact copies), and the Journal says so
export function sendList(dir, refs, { unmasked = false, yes = false } = {}) {
  const p = readNote(path.join(dir, 'Case.md')).props, c = readCase(dir)
  if (p.image_may_leave !== true) fail(`the frame keeps the image on this machine (image_may_leave: ${p.image_may_leave ?? 'not set'}): nothing is sent; ask the user, who changes it in Case.md`)
  if (unmasked && c.type !== 'verify-media') fail('--unmasked is for verify-media cases only (they look for exact copies): mask the people first (evidence mask)')
  if (unmasked && !yes) fail("--unmasked sends a picture with the people visible in it to the engines: the user's yes (in the dashboard, « Open unmasked »), then --yes", 2)
  if (!refs?.length) fail('--files E02,01_sign: the files to send')
  const clear = reverseOf(c).clear
  return refs.map(ref => {
    const rel = evidenceFile(dir, ref), s = sendable(rel, { evidence: c.evidence, clear })
    if (!s.ok && !(unmasked && /\.(jpe?g|png|webp|gif)$/i.test(rel))) fail(`${rel}: ${s.why}`)
    return { rel, abs: path.join(dir, rel), why: s.ok ? s.why : 'sent unmasked (verify-media)' }
  })
}
