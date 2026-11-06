// Small helpers every part of the engine uses: user errors with their exit code, atomic writes, hashes, names that
// every OS and Obsidian take, install hints per OS.
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { MIME } from './mime.js'

export class UserError extends Error {
  constructor(message, code = 1) { super(message); this.code = code; this.userError = true }
}
export const fail = (message, code = 1) => { throw new UserError(message, code) }

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) {
    if (fallback !== undefined && e.code === 'ENOENT') return fallback
    throw e
  }
}
export const sleepSync = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
// write next to the file then rename: a reader (Obsidian, the dashboard) sees the old or the new text, never half;
// Windows refuses a rename while another program holds the file a moment: retry
export function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  fs.writeFileSync(tmp, text)
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, file); return } catch (e) {
      if (i >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { fs.rmSync(tmp, { force: true }); throw e }
      sleepSync(50)
    }
  }
}
export const writeJson = (file, value) => writeAtomic(file, JSON.stringify(value, null, 2) + '\n')
export const sha256 = buf => createHash('sha256').update(buf).digest('hex')
export function sha256File(file) { // streamed: a video of several Gio never sits in memory
  const h = createHash('sha256'), fd = fs.openSync(file, 'r'), b = Buffer.alloc(1 << 20)
  try { for (let n; (n = fs.readSync(fd, b, 0, b.length, null)) > 0;) h.update(b.subarray(0, n)) } finally { fs.closeSync(fd) }
  return h.digest('hex')
}
export const nowIso = () => new Date().toISOString()
// this process talks to the tests' fake APIs (an OSINT_BASE_<SERVICE> is set), not to the real services
export const fakeApis = () => Object.entries(process.env).some(([k, v]) => k.startsWith('OSINT_BASE_') && v)

export const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i
// a case folder's name: ASCII, lowercase, dashes
export function slugify(s) {
  const slug = String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '')
  return slug && !RESERVED.test(slug) ? slug : `case-${slug || 'x'}`
}
// a note's file name: readable and Unicode, without what an OS refuses or what breaks an Obsidian link (# ^ [ ] |)
export function safeName(s) {
  const n = String(s).replace(/[\\/:*?"<>|#^[\]\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim()
    .slice(0, 120).replace(/[. ]+$/, '')
  if (!n) return 'untitled'
  return RESERVED.test(n) ? `_${n}` : n
}

// a tool's install command on this OS (macOS, Linux, Windows), as media-generator gives them
export const byOs = (mac, linux, win) => ({ darwin: mac, win32: win })[process.platform] ?? linux
export const INSTALL = {
  node: byOs('brew install node', 'https://nodejs.org/en/download', 'winget install OpenJS.NodeJS.LTS'),
  git: byOs('brew install git', 'sudo apt install git', 'winget install Git.Git'),
  uv: byOs('brew install uv', 'curl -LsSf https://astral.sh/uv/install.sh | sh', 'winget install astral-sh.uv'),
  cloudflared: byOs('brew install cloudflared', 'https://github.com/cloudflare/cloudflared/releases/latest', 'winget install Cloudflare.cloudflared'),
  ffmpeg: byOs('brew install ffmpeg', 'sudo apt install ffmpeg', 'winget install Gyan.FFmpeg'),
  exiftool: byOs('brew install exiftool', 'sudo apt install libimage-exiftool-perl', 'winget install OliverBetz.ExifTool'),
  'yt-dlp': byOs('brew install yt-dlp', 'sudo apt install yt-dlp', 'winget install yt-dlp.yt-dlp'),
  c2patool: byOs('brew install c2patool', 'https://github.com/contentauth/c2patool/releases/latest', 'https://github.com/contentauth/c2patool/releases/latest'),
}
// a program on the PATH: it starts (its exit code does not matter, some refuse --version)
export const hasBin = bin => !spawnSync(bin, ['--version'], { stdio: 'ignore', windowsHide: true }).error
export const dataDir = () => path.resolve(process.env.OSINT_DATA ?? process.env.CLAUDE_PLUGIN_DATA ?? path.join(os.homedir(), '.skill-osint'))
const ENGINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const VERSION = readJson(path.join(ENGINE, '..', '..', '..', '.claude-plugin', 'plugin.json'), { version: '0.0.0' }).version
export function extOf(contentType, file) {
  if (file && path.extname(file)) return path.extname(file).toLowerCase()
  const t = String(contentType ?? '').split(';')[0].trim().toLowerCase()
  return Object.entries(MIME).find(([, m]) => m === t)?.[0] ?? (t.endsWith('+json') ? '.json' : '.bin')
}
export { accepts, isUrl, MIME, mimeOf } from './mime.js'
// the Chromium-family browsers of this machine live in lib/browser.js (the PDF export's too); re-exported for the
// modules that import them from here. browser.js imports this file: it calls nothing of it while loading
export { findBrowser } from './browser.js'
