import assert from 'node:assert/strict'
import test from 'node:test'
import { calloutOf, parseTarget, preprocess } from '../lib/obsidian-md.js'

test('Obsidian syntax becomes Markdown links the dashboard resolves; code is left alone', () => {
  assert.equal(preprocess('See [[S01 RDAP]] and [[Journal#^j042|the log]].'), 'See [S01 RDAP](obsidian:S01%20RDAP) and [the log](obsidian:Journal%23%5Ej042).')
  assert.equal(preprocess('[[Case#Facts]]'), '[Case › Facts](obsidian:Case%23Facts)')
  assert.equal(preprocess('![[crop-03.jpg]]'), '![crop-03.jpg](embed:crop-03.jpg)')
  assert.equal(preprocess('a\n%% osint:begin facts %%\n- x\n%% osint:end facts %%\nb'), 'a\n\n- x\n\nb')
  assert.equal(preprocess('`[[not a link]]` and\n```\n[[nor here]]\n```'), '`[[not a link]]` and\n```\n[[nor here]]\n```')
  assert.equal(preprocess('- 09:00 · cmd · x ^j001'), '- 09:00 · cmd · x [](#^j001)')
  assert.deepEqual(calloutOf('[!warning]- Careful\nbody'), { type: 'warning', fold: '-', title: 'Careful' })
  assert.equal(calloutOf('plain quote'), null)
  assert.deepEqual(parseTarget('obsidian:Journal%23%5Ej042'), { kind: 'obsidian', target: 'Journal', anchor: '^j042' })
  assert.deepEqual(parseTarget('embed:crop-03.jpg'), { kind: 'embed', target: 'crop-03.jpg', anchor: null })
  assert.equal(parseTarget('https://example.org'), null)
})
