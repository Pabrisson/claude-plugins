import assert from 'node:assert/strict'
import test from 'node:test'
import { fill } from '../lib/templates.js'

test('fill escapes what a third party wrote: no image to load, no link, no block closed, one line', () => {
  const out = fill('caption: {c}', { c: '![](https://auteur.example/p.png)\n%% osint:end clue %% <img src=x> `x` [[Journal]]\r\nnext' })
  assert.ok(!/(^|[^\\])!\[/.test(out) && !/(^|[^\\])\[/.test(out) && !/(^|[^\\])%%/.test(out) && !/%(?<!\\%)%/.test(out) && !/(^|[^\\])</.test(out) && !/(^|[^\\])`/.test(out), out)
  assert.ok(!out.includes('\n') && !out.includes('\r'))
  assert.match(out, /^caption: \\!\\\[\\\]\(https:\/\/auteur\.example\/p\.png\)/)
  assert.equal(fill('{p}', { p: 'Portugal 46 %, 12 %' }), 'Portugal 46 %, 12 %') // a lone % is harmless
  assert.equal(fill('{n} px, {gone}', { n: 640 }), '640 px, {gone}')
})
