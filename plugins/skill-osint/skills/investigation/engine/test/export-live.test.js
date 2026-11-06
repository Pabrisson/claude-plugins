// OSINT_LIVE=1: the export with this machine's own Chromium-family browser (Google Chrome 156 on the development Mac,
// 2026-11-03); skipped without OSINT_LIVE or without a browser
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { pdfBrowser } from '../lib/browser.js'
import { finishedCase, run } from './helpers.js'

const browser = pdfBrowser()
test('a real browser prints the case: A4 pages, the Journal appended, titled after the case', { skip: process.env.OSINT_LIVE !== '1' ? 'OSINT_LIVE=1 only' : !browser && 'no Chromium-family browser here' }, async () => {
  const { home, dir } = await finishedCase()
  const t = Date.now(), r = await run(home, ['export', '-p', 'durand-bakery-example', '--journal', '--json'])
  assert.equal(r.status, 0, r.err)
  const out = JSON.parse(r.out), pdf = fs.readFileSync(path.join(dir, out.file), 'latin1')
  console.log(`${out.browser}: ${out.file}, ${pdf.length} bytes, ${Date.now() - t} ms`)
  assert.equal(out.browser, browser.name)
  assert.match(pdf, /\/MediaBox \[0 0 594\.9\d* 841\.9\d*\]/)
  assert.ok(+/\/Count (\d+)/.exec(pdf)[1] >= 2, 'the appendix starts a page of its own')
  const hex = /\/Title <FEFF([0-9A-F]+)>/.exec(pdf)?.[1]
  assert.equal(new TextDecoder('utf-16be').decode(Buffer.from(hex, 'hex')), 'durand-bakery.example — Rapport')
})
