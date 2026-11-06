// lib/browser.js — the Chromium-family browsers of this machine, the one the PDF export prints with, and one page
// printed to a PDF. findBrowser lists them all, each once: Chrome, Chromium, then Edge where their installers (or the
// PATH) put them, then the Chromium that setup geoint's Playwright downloaded under <data>/playwright, its headless shell
// first: on 2026-11-03 Playwright's chrome-headless-shell 151 printed a page in under 2 s, while its Chrome for Testing
// 151 never finished --print-to-pdf (and its older Chromium 121 exited 0 without a file). pdfBrowser picks one.
// util.js re-exports findBrowser (stage 2 imports it from there) and this file imports util.js: the two modules load
// each other, so nothing here calls into util.js while the module loads; the path tables are functions.
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { byOs, dataDir } from './util.js'

const isFile = f => { try { return fs.statSync(f).isFile() } catch { return false } }
const onPath = (bin, env) => String(env.PATH ?? '').split(path.delimiter).filter(Boolean).map(d => path.join(d, bin)).find(isFile) ?? null
export function systemBrowsers(env = process.env) {
  const mac = [['chrome', 'Google Chrome', 'Google Chrome.app/Contents/MacOS/Google Chrome'], ['chromium', 'Chromium', 'Chromium.app/Contents/MacOS/Chromium'], ['edge', 'Microsoft Edge', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge']]
  const linux = [['chrome', 'Google Chrome', ['/opt/google/chrome/chrome', 'google-chrome-stable', 'google-chrome']], ['chromium', 'Chromium', ['/snap/bin/chromium', 'chromium', 'chromium-browser']], ['edge', 'Microsoft Edge', ['/opt/microsoft/msedge/msedge', 'microsoft-edge-stable', 'microsoft-edge']]]
  const win = [['chrome', 'Google Chrome', 'Google/Chrome/Application/chrome.exe'], ['chromium', 'Chromium', 'Chromium/Application/chrome.exe'], ['edge', 'Microsoft Edge', 'Microsoft/Edge/Application/msedge.exe']]
  return byOs(
    mac.flatMap(([kind, name, rel]) => ['/Applications', path.join(os.homedir(), 'Applications')].map(d => ({ kind, name, path: path.join(d, rel) }))),
    linux.flatMap(([kind, name, bins]) => bins.map(b => ({ kind, name, path: path.isAbsolute(b) ? b : onPath(b, env) }))).filter(b => b.path),
    win.flatMap(([kind, name, rel]) => [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean).map(d => ({ kind, name, path: path.join(d, rel) }))),
  )
}
// Playwright's layouts (its registry's EXECUTABLE_PATHS, read on 2026-11-03), then its older ones
export const shellPaths = () => byOs(
  [['chrome-headless-shell-mac-arm64', 'chrome-headless-shell'], ['chrome-headless-shell-mac-x64', 'chrome-headless-shell'], ['chrome-mac', 'headless_shell']],
  [['chrome-headless-shell-linux64', 'chrome-headless-shell'], ['chrome-headless-shell-linux-arm64', 'chrome-headless-shell'], ['chrome-linux', 'headless_shell']],
  [['chrome-headless-shell-win64', 'chrome-headless-shell.exe'], ['chrome-win', 'headless_shell.exe']])
export const fullPaths = () => byOs(
  [['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'], ['chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'], ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium']],
  [['chrome-linux64', 'chrome'], ['chrome-linux-arm64', 'chrome'], ['chrome-linux', 'chrome']],
  [['chrome-win64', 'chrome.exe'], ['chrome-win', 'chrome.exe']])
export function packBrowsers(root = path.join(dataDir(), 'playwright')) {
  let dirs
  try { dirs = fs.readdirSync(root).filter(d => /^chromium(_headless_shell)?-\d+$/.test(d)) } catch { return [] }
  const shell = d => d.startsWith('chromium_headless_shell-'), rev = d => +d.split('-').pop()
  dirs.sort((a, b) => (shell(a) === shell(b) ? rev(b) - rev(a) : shell(a) ? -1 : 1))
  return dirs.flatMap(d => (shell(d) ? shellPaths() : fullPaths()).map(rel => ({ kind: 'pack', name: 'Chromium of the GeoINT pack', path: path.join(root, d, ...rel) })))
}
// every Chromium-family browser of this machine, in that order, each once: [{ kind: 'chrome'|'chromium'|'edge'|'pack', name, path }]
export function findBrowser(env = process.env, { pack } = {}) {
  const out = []
  for (const b of [...systemBrowsers(env), ...packBrowsers(pack)]) if (isFile(b.path) && !out.some(x => x.path === b.path)) out.push(b)
  return out
}
// the one `export` prints with: OSINT_BROWSER when it is set (nothing else is tried), else the first one found
export function pdfBrowser(env = process.env) {
  if (!env.OSINT_BROWSER) return findBrowser(env)[0] ?? null
  const p = path.resolve(env.OSINT_BROWSER)
  return isFile(p) ? { kind: 'env', name: `OSINT_BROWSER (${p})`, path: p } : null
}
export const installBrowser = () => byOs('brew install --cask google-chrome', 'https://www.google.com/chrome/', 'winget install Google.Chrome')
// what export (exit 3) and doctor say when there is none
export const browserMissing = (env = process.env) => (env.OSINT_BROWSER
  ? `OSINT_BROWSER=${env.OSINT_BROWSER} is not a file — the PDF export is off; Print view in the dashboard prints from any browser`
  : `no Chrome, Chromium or Edge (${installBrowser()}) — the PDF export is off; Print view in the dashboard prints from any browser`)

export const BUDGET = 10000   // the virtual ms the page gets to settle (its images) before Chrome prints it
// a PDF that begins as one and, when the browser did not end by itself (killed by the timeout), ends as one
const isPdf = (f, ended = true) => {
  try {
    const b = fs.readFileSync(f)
    return b.subarray(0, 5).toString('latin1') === '%PDF-' && (ended || b.subarray(-1024).toString('latin1').includes('%%EOF'))
  } catch { return false }
}
// one page to one PDF in a throwaway profile; { ok: true } or { ok: false, why }; a .js browser is the tests' fake,
// run by Node so that it runs on every OS
export async function printToPdf(browser, url, file, { timeout = 120000 } = {}) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-pdf-'))
  const [bin, pre] = /\.m?js$/i.test(browser.path) ? [process.execPath, [browser.path]] : [browser.path, []]
  const args = [...pre, '--headless', '--disable-gpu', '--no-pdf-header-footer', `--user-data-dir=${profile}`, `--virtual-time-budget=${BUDGET}`, `--print-to-pdf=${file}`, url]
  fs.rmSync(file, { force: true })
  const r = await new Promise(ok => execFile(bin, args, { timeout, windowsHide: true, maxBuffer: 16e6 }, (e, _, stderr) => ok({ e, stderr: String(stderr) })))
  // (Windows keeps a killed Chrome's profile locked for a moment: a profile left behind is the OS's temp folder's)
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch {}
  if (isPdf(file, !r.e)) return { ok: true }
  fs.rmSync(file, { force: true })
  const tail = r.stderr.trim().split('\n').slice(-2).join(' / ').slice(0, 300)
  return { ok: false, why: `${r.e?.killed ? `did not finish within ${Math.round(timeout / 1000)} s` : r.e ? `exited with ${r.e.code ?? r.e.signal}` : 'wrote no PDF'}${tail ? ` (${tail})` : ''}` }
}
