import assert from 'node:assert/strict'
import test from 'node:test'
import { frontText, parseFront, propsOf, quote, setFront, splitNote } from '../lib/yaml.js'

const OBSIDIAN = `kind: domain
tags:
  - entity/domain
aliases: []
sources:
  - "[[S01 RDAP]]"
confidence: high
count: 3
done: false
phone: 0601020304
empty:
nested:
  a: 1
# a comment the user wrote
note: 'it''s'
inline: [a, "b, c"]
due date: 2026-11-03`

test('parseFront reads what Obsidian writes', () => {
  const p = propsOf(parseFront(OBSIDIAN))
  assert.deepEqual(p.tags, ['entity/domain'])
  assert.deepEqual(p.aliases, [])
  assert.deepEqual(p.sources, ['[[S01 RDAP]]'])
  assert.equal(p.confidence, 'high')
  assert.equal(p.count, 3)
  assert.equal(p.done, false)
  assert.equal(p.phone, '0601020304')
  assert.equal(p.empty, null)
  assert.deepEqual(p.nested, { raw: 'nested:\n  a: 1\n# a comment the user wrote' })
  assert.equal(p.note, "it's")
  assert.deepEqual(p.inline, ['a', 'b, c'])
  assert.equal(p['due date'], '2026-11-03')
})

test('setFront rewrites only the keys it changes, the rest byte for byte', () => {
  const out = frontText(setFront(parseFront(OBSIDIAN), { confidence: 'medium' }))
  assert.equal(out, OBSIDIAN.replace('confidence: high', 'confidence: medium'))
  // the same value: nothing moves, even when the user wrote it another way
  assert.equal(frontText(setFront(parseFront(OBSIDIAN), { inline: ['a', 'b, c'] })), OBSIDIAN)
  const added = frontText(setFront(parseFront(OBSIDIAN), { status: 'active', note: undefined }))
  assert.ok(added.endsWith('status: active'))
  assert.ok(!added.includes("note: 'it''s'"))
})

test('quote leaves plain words plain and quotes what YAML would misread', () => {
  assert.equal(quote('Évora'), 'Évora')
  assert.equal(quote('[[S01 RDAP]]'), '"[[S01 RDAP]]"')
  assert.equal(quote('https://a.b/c'), '"https://a.b/c"')
  assert.equal(quote('true'), '"true"')
  assert.equal(quote('12'), '"12"')
  assert.equal(quote('a: b'), '"a: b"')
  assert.equal(quote('line\nbreak'), '"line\\nbreak"')
  assert.equal(quote(12), '12')
  assert.equal(quote(null), null)
  const back = propsOf(parseFront(frontText(setFront([], { a: 'x: "y" #z', b: ['[[n]]', 'ok'], c: null }))))
  assert.deepEqual(back, { a: 'x: "y" #z', b: ['[[n]]', 'ok'], c: null })
})

test('splitNote takes CRLF, a BOM and an empty frontmatter', () => {
  assert.deepEqual(splitNote('﻿---\r\nkind: domain\r\n---\r\nBody\r\n'), { front: 'kind: domain', body: 'Body\r\n', had: true })
  assert.deepEqual(splitNote('---\n---\nBody'), { front: '', body: 'Body', had: true })
  assert.deepEqual(splitNote('# No front'), { front: '', body: '# No front', had: false })
  // a value ending in --- does not close the frontmatter
  assert.equal(splitNote('---\ntitle: x---\n---\nB').front, 'title: x---')
  assert.equal(propsOf(parseFront(splitNote('---\r\nkind: domain\r\ntags:\r\n  - a\r\n---\r\n').front)).tags[0], 'a')
})
