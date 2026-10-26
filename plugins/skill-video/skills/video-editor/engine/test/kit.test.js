import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

// lib/kit.js in Chrome, served from the engine folder
const ENGINE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
await page.route('http://engine/**', r => {
  const file = new URL(r.request().url()).pathname
  return file === '/' ? r.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0">' }) : r.fulfill({ path: path.join(ENGINE, file) })
})
await page.goto('http://engine/')
test.after(() => browser.close())

test('captions: the word being said pops without closing the gap to its neighbours; a frame shows one line', async () => {
  const r = await page.evaluate(async () => {
    const { captions } = await import('/lib/kit.js')
    const stage = document.createElement('div')
    stage.style.cssText = '--font:Inter,sans-serif;--ink:#000;position:relative;width:1080px'
    document.body.append(stage)
    // two lines: « Bonjour tout le », then « monde. » from 0.9 s
    const words = [['Bonjour', 0], ['tout', 0.3], ['le', 0.6], ['monde.', 0.9]].map(([w, v0]) => ({ w, v0, v1: v0 + 0.25 }))
    const c = captions({ fps: 30, style: { look: { captions: { size: 84 } } } }, words)
    stage.append(c)
    const gaps = v => {
      c.update(v)
      const b = [...c.children].map(s => s.getBoundingClientRect())
      return b.slice(1).map((x, i) => Math.round(x.left - b[i].right))
    }
    // the frame at 0.9 s, a quarter of a frame either side (its motion blur sub-frames)
    const line = v => (c.update(v), c.textContent)
    return { rest: gaps(0.85), tout: gaps(0.301), le: gaps(0.601), lines: [line(0.9 - 0.25 / 30), line(0.9 + 0.25 / 30)] }
  })
  for (const [i, pop] of [[0, r.tout], [1, r.le]]) assert.ok(pop[i] >= r.rest[i] - 1, `gap ${pop[i]} px instead of ${r.rest[i]} px while a word pops`)
  assert.deepEqual(r.lines, ['monde.', 'monde.'])
})
