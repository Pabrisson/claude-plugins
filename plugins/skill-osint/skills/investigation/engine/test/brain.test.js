import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { indexCase, linksOf, resolver, summaries } from '../lib/brain.js'
import { casesFolder, NEW, run } from './helpers.js'

test('links: wikilinks, embeds, anchors and block refs; resolved by path or by name, as Obsidian does', () => {
  assert.deepEqual(linksOf('See [[S01 RDAP]], ![[crop-03.jpg]], [[Journal#^j042|the log]] and [[Entities/x.example#Facts]].'), [
    { target: 'S01 RDAP', anchor: null, embed: false }, { target: 'crop-03.jpg', anchor: null, embed: true },
    { target: 'Journal', anchor: '^j042', embed: false }, { target: 'Entities/x.example', anchor: 'Facts', embed: false },
  ])
  const r = resolver(['Case.md', 'Journal.md', 'Sources/S01 RDAP.md', 'Entities/x.example.md', 'Evidence/crops/crop-03.jpg'])
  assert.equal(r('S01 RDAP'), 'Sources/S01 RDAP.md')
  assert.equal(r('Entities/x.example'), 'Entities/x.example.md')
  assert.equal(r('x.example'), 'Entities/x.example.md')
  assert.equal(r('crop-03.jpg'), 'Evidence/crops/crop-03.jpg')
  assert.equal(r('journal'), 'Journal.md')
  assert.equal(r('nowhere'), null)
})

test('indexCase lists the notes with their properties, links and backlinks; summaries count each case', async () => {
  const home = casesFolder()
  await run(home, NEW)
  const dir = path.join(home, 'durand-bakery-example')
  fs.writeFileSync(path.join(dir, 'Entities', 'x.example.md'), '---\nkind: domain\nsources:\n  - "[[Journal#^j001]]"\n---\n# x.example\n\nSeen in [[Case]].\n')
  const ix = indexCase(home, 'durand-bakery-example')
  assert.deepEqual(ix.notes.map(n => n.path), ['Case.md', 'Entities/x.example.md', 'Journal.md', 'Leads.md', 'Report.md'])
  const e = ix.notes.find(n => n.path === 'Entities/x.example.md')
  assert.deepEqual([e.title, e.folder, e.props.kind, e.excerpt], ['x.example', 'Entities', 'domain', 'Seen in [[Case]].'])
  assert.deepEqual(ix.backlinks['Case.md'].map(b => [b.from, b.line]), [['Entities/x.example.md', 8]])
  assert.deepEqual(ix.backlinks['Journal.md'].map(b => b.from), ['Entities/x.example.md'])
  assert.ok(ix.notes.find(n => n.path === 'Journal.md').blocks.includes('j001'))
  assert.deepEqual(ix.counts, { entities: 1, sources: 0, clues: 0, hypotheses: 0, leads_open: 0, new: 0 })
  const [s] = summaries(home)
  assert.deepEqual([s.slug, s.type, s.status, s.title, s.last.kind], ['durand-bakery-example', 'domain', 'draft', 'durand-bakery.example', 'case.new'])
})
