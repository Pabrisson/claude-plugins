import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { normalize, placePoint, samePlace } from '../lib/kinds.js'
import { addCanvas, appendJournal, getBlock, journalIds, readNote, setBlock, writeNote, writeObsidianConfig } from '../lib/vault.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'osint-vault-'))

test('writeNote creates a note, then touches only its keys and its blocks', () => {
  const f = path.join(tmp(), 'Entities', 'x.md')
  assert.equal(writeNote(f, { props: { kind: 'domain', value: 'x.example' }, create: '# x\n\n%% osint:begin facts %%\n%% osint:end facts %%\n\n## Notes\n' }), true)
  // the user writes in Obsidian: a property, a line under Notes
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('value: x.example', 'value: x.example\nmine: kept') + 'My own line.\n')
  writeNote(f, { props: { confidence: 'high' }, blocks: { facts: '- registered 2019' } })
  const n = readNote(f)
  assert.deepEqual([n.props.kind, n.props.mine, n.props.confidence], ['domain', 'kept', 'high'])
  assert.equal(getBlock(n.body, 'facts'), '- registered 2019')
  assert.ok(n.body.endsWith('## Notes\nMy own line.\n'))
  // nothing to change: the file is left as it is
  assert.equal(writeNote(f, { props: { confidence: 'high' }, blocks: { facts: '- registered 2019' } }), false)
})

test('a block is replaced whole, added at the end when the note has none, and an empty block stays a pair', () => {
  let b = '# T\n\n%% osint:begin a %%\nold\nlines\n%% osint:end a %%\n\nafter\n'
  b = setBlock(b, 'a', 'new $& text')
  assert.equal(b, '# T\n\n%% osint:begin a %%\nnew $& text\n%% osint:end a %%\n\nafter\n')
  b = setBlock(b, 'b', 'bee')
  assert.ok(b.endsWith('after\n\n%% osint:begin b %%\nbee\n%% osint:end b %%\n'))
  assert.equal(setBlock(b, 'a', ''), b.replace('new $& text\n', ''))
  assert.equal(getBlock('x', 'a'), null)
})

test('a note edited on Windows (CRLF, BOM) keeps its text and its blocks are found', () => {
  const f = path.join(tmp(), 'n.md')
  fs.writeFileSync(f, '﻿---\r\nkind: ip\r\n---\r\n# N\r\n\r\n%% osint:begin facts %%\r\nold\r\n%% osint:end facts %%\r\n\r\nUser line\r\n')
  writeNote(f, { blocks: { facts: 'new' } })
  const t = fs.readFileSync(f, 'utf8')
  assert.match(t, /^---\nkind: ip\n---\n# N\r\n\r\n%% osint:begin facts %%\nnew\n%% osint:end facts %%\r\n\r\nUser line\r\n$/)
})

test('an edit saved in Obsidian between the read and the write is read again, never overwritten', () => {
  const f = path.join(tmp(), 'n.md')
  writeNote(f, { props: { a: 1 }, create: 'Body\n' })
  let once = true
  writeNote(f, { props: { b: 2 } }, { beforeWrite: () => { if (once) { once = false; fs.appendFileSync(f, 'Typed in Obsidian.\n') } } })
  const n = readNote(f)
  assert.deepEqual([n.props.a, n.props.b], [1, 2])
  assert.ok(n.body.endsWith('Typed in Obsidian.\n'))
})

test('the Journal gets one line per entry under the day, with its block id', () => {
  const dir = tmp()
  appendJournal(dir, { at: new Date(2026, 10, 3, 9, 5, 7), kind: 'cmd', text: 'domain collect\n --only crt', id: 'j001' })
  appendJournal(dir, { at: new Date(2026, 10, 3, 9, 6, 0), kind: 'fail', text: 'crt.sh 502', id: 'j002' })
  appendJournal(dir, { at: new Date(2026, 10, 4, 8, 0, 0), kind: 'step', text: 'next day', id: 'j003' })
  assert.equal(fs.readFileSync(path.join(dir, 'Journal.md'), 'utf8'),
    '# Journal\n\n## 2026-11-03\n\n- 09:05:07 · cmd · domain collect --only crt ^j001\n- 09:06:00 · fail · crt.sh 502 ^j002\n\n## 2026-11-04\n\n- 08:00:00 · step · next day ^j003\n')
  assert.deepEqual([...journalIds(dir)], ['j001', 'j002', 'j003'])
})

test('the canvas gets new nodes in their kind column and never moves a node the user placed', () => {
  const dir = tmp()
  addCanvas(dir, { nodes: [{ id: 'a', file: 'Entities/a.md', kind: 'domain' }, { id: 'b', file: 'Entities/b.md', kind: 'domain' }, { id: 'c', file: 'Entities/c.md', kind: 'ip' }] })
  const f = path.join(dir, 'Graph.canvas'), c = JSON.parse(fs.readFileSync(f, 'utf8'))
  assert.deepEqual(c.nodes.map(n => [n.id, n.x, n.y, n.type]), [['a', 0, 0, 'file'], ['b', 0, 120, 'file'], ['c', 640, 0, 'file']])
  c.nodes[0].x = 999
  fs.writeFileSync(f, JSON.stringify(c))
  addCanvas(dir, { nodes: [{ id: 'a', file: 'Entities/a.md', kind: 'domain' }], edges: [{ id: 'a-c', fromNode: 'a', toNode: 'c', label: 'resolves to' }] })
  const d = JSON.parse(fs.readFileSync(f, 'utf8'))
  assert.equal(d.nodes[0].x, 999)
  assert.deepEqual(d.edges, [{ id: 'a-c', fromNode: 'a', toNode: 'c', label: 'resolves to' }])
})

test('.obsidian holds the attachments folder and one graph color per entity kind', () => {
  const dir = tmp()
  writeObsidianConfig(dir)
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.obsidian', 'app.json'), 'utf8')).attachmentFolderPath, 'Evidence')
  const g = JSON.parse(fs.readFileSync(path.join(dir, '.obsidian', 'graph.json'), 'utf8'))
  assert.ok(g.colorGroups.some(x => x.query === 'tag:#entity/domain' && Number.isInteger(x.color.rgb)))
})

test('normalize gives the key that matches one entity across cases', () => {
  assert.equal(normalize('domain', 'WWW.Example.org.'), 'domain:www.example.org')
  assert.equal(normalize('email', ' Jo@Example.ORG '), 'email:jo@example.org')
  assert.equal(normalize('organization', 'ACME SAS', { siren: '552 100 554' }), 'organization:552100554')
  assert.equal(normalize('phone', '+33 6 01 02 03 04'), 'phone:fr:0601020304')
  assert.equal(normalize('account', 'https://GitHub.com/Durand/'), 'account:https://github.com/durand')
})

test('an image or a video is shared between cases by its SHA-256, whatever its name', () => {
  const sha = 'AB12'.padEnd(64, '0')
  assert.equal(normalize('image', 'E01-evora-temple.jpg', { sha256: sha }), `image:${sha.toLowerCase()}`)
  assert.equal(normalize('image', 'https://example.org/x.jpg', { sha256: sha }), normalize('image', 'E03-copy.jpg', { sha256: sha }))
  assert.equal(normalize('video', 'clip.mp4'), 'video:clip.mp4')
})

test('a place is one place across cases by its OpenStreetMap id, or within 100 m; an IP\'s coarse circle never by distance', () => {
  assert.equal(normalize('place', 'Hôtel de ville (OSM relation/284089)', { osm: 'Relation/284089' }), 'place:relation/284089')
  assert.equal(normalize('place', 'Lyon, FR', { coarse: true, center: '45.7, 4.8' }), 'place:coarse:lyon, fr')
  assert.equal(normalize('place', 'SIRET 456 789 122 00011', { lat: 45.9012, lon: 2.7021 }), 'place:siret 456 789 122 00011')
  assert.deepEqual([placePoint({ lat: '48.8565', lon: 2.352 }), placePoint({ lat: null, lon: 2 }), placePoint({ lat: 45.7, lon: 4.8, coarse: true })], [[48.8565, 2.352], null, null])
  const townhall = { osm: 'relation/284089', lat: 48.856427, lon: 2.352527 }
  assert.equal(samePlace(townhall, { osm: 'RELATION/284089' }), true)                            // one id, whatever the case
  assert.equal(samePlace(townhall, { osm: 'node/697183314', lat: 48.85665, lon: 2.35255 }), false) // two ids, 25 m apart: two places
  assert.equal(samePlace(townhall, { lat: 48.8565, lon: 2.352 }), true)                          // no id, 39 m
  assert.equal(samePlace({ lat: 48.8565, lon: 2.352 }, { lat: 48.8575, lon: 2.352 }), false)     // 111 m
  assert.equal(samePlace({ lat: 45.7, lon: 4.8, coarse: true }, { lat: 45.7, lon: 4.8 }), false) // a coarse circle has no point
})
