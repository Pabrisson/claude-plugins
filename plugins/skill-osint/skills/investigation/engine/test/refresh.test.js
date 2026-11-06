import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { diff } from '../lib/refresh.js'
import { readNote } from '../lib/vault.js'
import { casesFolder, events, FIXTURES, json, run } from './helpers.js'

const env = items => ({ OSINT_TYPES: path.join(FIXTURES, 'types'), OSINT_SAMPLE_ITEMS: JSON.stringify(items) })

test('diff: added, removed, changed with the fields that changed', () => {
  assert.deepEqual(diff([{ key: 'a', ip: '1' }, { key: 'b' }], [{ key: 'a', ip: '2' }, { key: 'c' }]), {
    added: [{ key: 'c' }], removed: [{ key: 'b' }], changed: [{ key: 'a', fields: ['ip'] }],
  })
})

test('refresh replays the engine steps, writes What changed, and gives back the agent steps; noisy steps follow the frame', async () => {
  const home = casesFolder(), dir = path.join(home, 'thing-one')
  await run(home, ['new', 'sample', 'thing one', '--question', 'Q?', '--frame', 'noisy=ask'], env([]))
  await run(home, ['sample', 'collect', '-p', 'thing-one'], env([{ key: 'a.example', ip: '1' }, { key: 'b.example' }]))
  const asked = await run(home, ['refresh', '-p', 'thing-one'], env([]))
  assert.equal(asked.status, 2)
  assert.match(asked.err, /loud is a noisy step: the user's yes, then --yes/)
  const r = await run(home, ['refresh', '-p', 'thing-one', '--only', 'items,read', '--json'], env([{ key: 'a.example', ip: '2' }, { key: 'c.example' }]))
  assert.equal(r.status, 0, r.err)
  const out = JSON.parse(r.out)
  assert.deepEqual(out.diffs.map(d => [d.name, d.added.length, d.removed.length, d.changed.length]), [['items', 1, 1, 1]])
  assert.deepEqual(out.agent, [{ id: 'read', section: 'refresh-read', prompt: '[sample:refresh-read] thing one' }])
  const c = readNote(path.join(dir, 'Case.md'))
  assert.match(c.body, /%% osint:begin what-changed %%[\s\S]*items: \+1 \(c\.example\) · −1 \(b\.example\) · ~1 \(a\.example: ip\)/)
  assert.deepEqual(json(dir, '.osint/case.json').refreshes.map(x => [x.added, x.removed, x.changed]), [[1, 1, 1]])
  assert.ok(events(dir).some(e => e.kind === 'refresh.diff'))
  // never: the noisy step is skipped, said in the Journal
  await run(home, ['new', 'sample', 'quiet one', '--question', 'Q?', '--frame', 'noisy=never'], env([]))
  const q = await run(home, ['refresh', '-p', 'quiet-one', '--json'], env([]))
  assert.equal(q.status, 0, q.err)
  assert.match(readNote(path.join(home, 'quiet-one', 'Journal.md')).body, /skipped loud: noisy steps are never run in this case/)
})
