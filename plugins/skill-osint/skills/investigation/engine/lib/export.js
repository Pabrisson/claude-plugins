// lib/export.js — `export -p <slug> [--journal]`: the case's print view, served by this process's own dashboard server
// on a free port for the time of the print, printed by a Chromium-family browser to <case>/Exports/<slug>-<date>.pdf
// (-2, -3… on the same day: a PDF whose hash is in the Journal is never overwritten); its SHA-256 goes to the Journal.
// No browser: exit 3, the dashboard's Print view prints from any browser.
import fs from 'node:fs'
import path from 'node:path'
import { browserMissing, pdfBrowser, printToPdf } from './browser.js'
import { caseDir, journal, withLock } from './case.js'
import { emit } from './events.js'
import { startServer } from './server.js'
import { fail, sha256File } from './util.js'
import { localDate } from './vault.js'

export async function exportPdf(home, slug, { journal: appendix = false, dist, engine, loaded } = {}) {
  const dir = caseDir(home, slug), browser = pdfBrowser()   // caseDir: a known slug only, never a path: the PDF lands in <slug>/Exports/
  if (!browser) fail(browserMissing(), 3)
  // printed under .osint/cache (which git ignores), moved to Exports/ once whole and hashed
  const tmp = path.join(dir, '.osint', 'cache', `export-${process.pid}.pdf`)
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  try {
    // its own server for the print, without the watch of stage 11 (no pass may start while a PDF is printed)
    const server = await startServer({ home, port: 0, dist, engine, loaded, watch: false })
    const url = `http://127.0.0.1:${server.address().port}/print/${slug}${appendix ? '?journal=1' : ''}`
    let r
    try { r = await printToPdf(browser, url, tmp, { timeout: Number(process.env.OSINT_PDF_TIMEOUT) || 120000 }) } finally {
      server.close()
      server.closeAllConnections()
    }
    if (!r.ok) {
      const text = `export: ${browser.name} ${r.why}`, j = journal(dir, 'fail', text)
      emit(dir, { kind: 'fail', text, journal: j })
      fail(`${text} — Print view in the dashboard prints from any browser`)
    }
    const day = localDate(new Date()), sha256 = sha256File(tmp)
    const rel = withLock(dir, () => {
      let name = `Exports/${slug}-${day}.pdf`
      for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `Exports/${slug}-${day}-${n}.pdf`
      fs.mkdirSync(path.join(dir, 'Exports'), { recursive: true })
      fs.renameSync(tmp, path.join(dir, name))
      return name
    })
    const j = journal(dir, 'export', `${rel} (${browser.name}${appendix ? ', Journal appended' : ''}) · sha256 ${sha256}`)
    emit(dir, { kind: 'export', path: rel, text: `PDF ${rel}`, journal: j, data: { sha256, browser: browser.name, journal: appendix } })
    return { file: rel, sha256, browser: browser.name, journal: j }
  } finally { fs.rmSync(tmp, { force: true }) }   // whatever went wrong, no half PDF stays under .osint/cache
}
