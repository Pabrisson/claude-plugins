import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { setNotes, unified, unpatch, upgradeNotes, versions } from '../lib/notes.js'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'immo-notes-'))
const at = m => `2026-11-11T10:${String(m).padStart(2, '0')}:00.000Z`

test('a .diff undone gives back the notes before it, word for word', () => {
  const a = '## A\n- [ ] Q\n- x\n\nB', b = '# T\n## A\n- [ ] Q\n- y\n\nB\nC', d = unified(a, b)
  assert.equal(d, '--- a/notes.md\n+++ b/notes.md\n@@ -1,5 +1,7 @@\n+# T\n ## A\n - [ ] Q\n-- x\n+- y\n \n B\n+C\n')
  assert.equal(unpatch(b, d), a)
  // a box ticked since: undone all the same, the tick kept
  assert.equal(unpatch(b.replace('[ ]', '[x]'), d), a.replace('[ ]', '[x]'))
  // two changes far apart: two hunks, both undone
  const long = Array.from({ length: 30 }, (_, i) => `l${i}`).join('\n'), two = long.replace('l2\n', 'L2\n').replace('l27', 'L27')
  assert.equal(unified(long, two).match(/^@@/gm).length, 2)
  assert.equal(unpatch(two, unified(long, two)), long)
  // lines moved by a change made since are found where they went; notes that no longer hold it: refused
  assert.equal(unpatch(`new\nnew\n${two}`, unified(long, two)), `new\nnew\n${long}`)
  assert.throws(() => unpatch('autre chose', unified(long, two)))
  // from and to nothing
  assert.equal(unpatch('x\ny', unified('', 'x\ny')), '')
  assert.equal(unpatch('', unified('x\ny', '')), 'x\ny')
})

test('each change of the notes kept as a .diff for « Restaurer », a tick and quick saves aside', () => {
  const dir = tmp(), l = { id: 'm-1', notes: '' }
  setNotes(dir, l, '## A\n- [ ] Q', 'user', at(0))
  assert.equal(l.notes_history, undefined) // nothing before
  setNotes(dir, l, '## A\n- [x] Q', 'user', at(1))
  assert.equal(l.notes_history, undefined) // a box ticked
  setNotes(dir, l, '## A\n- [x] Q\nB', 'user', at(2))
  setNotes(dir, l, '## A\n- [x] Q\nBC', 'user', at(4)) // 2 min after: the same change, its .diff written again
  assert.deepEqual(l.notes_history, [{ date: at(2), by: 'user', diff: 'notes/m-1/2026-11-11T10-02-00-000Z-user.diff' }])
  assert.ok(fs.readFileSync(path.join(dir, l.notes_history[0].diff), 'utf8').endsWith('\n ## A\n - [x] Q\n+BC\n'))
  setNotes(dir, l, '## A\n- [x] Q\nBC\n\n## D', 'agent', at(5))
  setNotes(dir, l, '## A\n- [x] Q', 'restore', at(6))
  const notes = () => versions(dir, l).map(v => [v.by, v.notes])
  assert.deepEqual(notes(), [['user', '## A\n- [x] Q'], ['agent', '## A\n- [x] Q\nBC'], ['restore', '## A\n- [x] Q\nBC\n\n## D']])
  // a box unticked since the last change (no version): every version rebuilt all the same, with the box as it is now
  setNotes(dir, l, '## A\n- [ ] Q', 'user', at(7))
  assert.deepEqual(notes(), [['user', '## A\n- [ ] Q'], ['agent', '## A\n- [ ] Q\nBC'], ['restore', '## A\n- [ ] Q\nBC\n\n## D']])
  // notes edited by hand in listings.json: the versions behind can no longer be rebuilt
  assert.deepEqual(versions(dir, { ...l, notes: 'tout autre' }).map(v => v.notes), [null, null, null])
  // the last 30 kept, the older .diff deleted
  for (let i = 0; i < 40; i++) setNotes(dir, l, `## v${i}`, 'agent', at(10 + i))
  assert.equal(l.notes_history.length, 30)
  assert.equal(fs.readdirSync(path.join(dir, 'notes/m-1')).length, 30)
  assert.equal(versions(dir, l)[0].notes, '## v9')
})

test('a history of copies (before 1.39.0) becomes .diff files, word for word', () => {
  const dir = tmp(), h = [{ date: at(1), notes: 'A', by: 'agent' }, { date: at(2), notes: 'A\n- [ ] B', by: 'user' }]
  const ls = [{ id: 'm-1', notes: 'A\n- [x] B\nC', notes_history: h.map(v => ({ ...v })) }, { id: 'm-2', notes: 'x' }]
  assert.equal(upgradeNotes(dir, ls), true)
  assert.deepEqual(ls[0].notes_history, h.map(v => ({ date: v.date, by: v.by, diff: `notes/m-1/${v.date.replace(/[:.]/g, '-')}-${v.by}.diff` })))
  assert.deepEqual(versions(dir, ls[0]).map(v => v.notes), h.map(v => v.notes))
  assert.equal(upgradeNotes(dir, ls), false)
  // an older engine ran in between: its copies after the .diff ones turned too, the .diff kept
  ls[0].notes_history.push({ date: at(3), notes: 'A\n- [x] B\nC', by: 'user' })
  ls[0].notes = 'A\n- [x] B\nC\nD'
  assert.equal(upgradeNotes(dir, ls), true)
  assert.deepEqual(versions(dir, ls[0]).map(v => v.notes), [...h.map(v => v.notes), 'A\n- [x] B\nC'])
})
