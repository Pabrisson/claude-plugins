import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { casesFolder, FIXTURES, run } from './helpers.js'

const count = (dir, folder) => { try { return fs.readdirSync(path.join(dir, folder)).length } catch { return 0 } }

// records.js reads a page again as the same source and finds a clue again as the same clue (stage 1, records.test.js);
// what this stage needs is that a watch of weeks leaves the vault as it was when nothing changed
test('watch passes over pages that did not change add no note, no capture, no clue', async () => {
  const home = casesFolder(), dir = path.join(home, 'thing-one'), at = h => new Date(Date.parse('2026-11-03T06:00:00.000Z') + h * 3600e3).toISOString()
  const env = (h, quiet) => ({ OSINT_TYPES: path.join(FIXTURES, 'watch-types'), OSINT_NOW: at(h), OSINT_WATCH_ITEMS: JSON.stringify({ quiet }) })
  await run(home, ['new', 'watched', 'thing one', '--question', 'Q?', '--frame', 'noisy=ask'], env(0, []))
  await run(home, ['watch', '-p', 'thing-one', '--every', '6h'], env(0, []))
  await run(home, ['watch', '--due'], env(7, [{ key: 'a' }]))
  const seen = () => [count(dir, 'Sources'), count(dir, 'Clues'), count(dir, 'Evidence/captures')]
  const [sources, clues, captures] = seen()
  for (const h of [14, 21, 28, 35]) assert.equal((await run(home, ['watch', '--due'], env(h, [{ key: 'a' }]))).status, 0)
  assert.deepEqual(seen(), [sources, clues, captures], 'four passes over the same page: nothing new')
  await run(home, ['watch', '--due'], env(42, [{ key: 'a' }, { key: 'b' }]))
  assert.deepEqual(seen(), [sources + 1, clues + 1, captures + 1], 'the page changed: one new source and one new clue')
})
