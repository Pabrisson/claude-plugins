#!/usr/bin/env node
// The tests' Chromium (OSINT_BROWSER=<this file>, run by Node): reads the page it is asked to print, notes its
// arguments and that page in OSINT_FAKE_BROWSER_LOG, writes a tiny PDF. OSINT_FAKE_BROWSER: `fail` exits 1 without a
// PDF, `empty` exits 0 without one (as Playwright's Chromium 121 did), `half` writes the start of a PDF then never ends, `hang` never ends (as its Chrome for Testing 151).
import fs from 'node:fs'

const args = process.argv.slice(2), flag = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const mode = process.env.OSINT_FAKE_BROWSER
if (mode === 'hang') setInterval(() => {}, 1000)
else if (mode === 'half') { fs.writeFileSync(flag('print-to-pdf'), '%PDF-1.4\npartial'); setInterval(() => {}, 1000) } // a PDF begun, then killed by the timeout
else {
  const url = args.at(-1), html = await (await fetch(url)).text()
  if (process.env.OSINT_FAKE_BROWSER_LOG) fs.writeFileSync(process.env.OSINT_FAKE_BROWSER_LOG, JSON.stringify({ args, url, html, profile: fs.existsSync(flag('user-data-dir')) }))
  if (mode === 'fail') { console.error('fake browser: crashed'); process.exit(1) }
  if (mode !== 'empty') fs.writeFileSync(flag('print-to-pdf'), '%PDF-1.4\n% skill-osint fake browser\n%%EOF\n')
}
