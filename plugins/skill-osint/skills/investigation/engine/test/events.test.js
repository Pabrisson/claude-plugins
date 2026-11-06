import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { emit, eventsFile, lastEvents, readFrom } from '../lib/events.js'

test('events are read from a byte offset; a line not ended yet waits; a reset file starts over', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-ev-'))
  assert.deepEqual(readFrom(dir, 0), { events: [], end: 0, reset: false })
  emit(dir, { kind: 'log', text: 'one' })
  emit(dir, { kind: 'log', text: 'two' })
  const a = readFrom(dir, 0)
  assert.deepEqual(a.events.map(x => x.ev.text), ['one', 'two'])
  assert.equal(a.end, fs.statSync(eventsFile(dir)).size)
  assert.equal(a.events[0].ev.by, 'engine')
  fs.appendFileSync(eventsFile(dir), '{"kind":"log","te')
  const b = readFrom(dir, a.end)
  assert.deepEqual([b.events.length, b.end], [0, a.end])
  fs.writeFileSync(eventsFile(dir), '{"kind":"case.new"}\n')
  const c = readFrom(dir, a.end)
  assert.equal(c.reset, true)
  assert.deepEqual(c.events.map(x => x.ev.kind), ['case.new'])
  assert.deepEqual(lastEvents(dir, 5).map(e => e.kind), ['case.new'])
})
