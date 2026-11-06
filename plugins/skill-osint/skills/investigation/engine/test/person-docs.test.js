import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

// the refusals the engine cannot hold alone (what the agent says, the user's choice) are written where the agent reads
const root = path.join(import.meta.dirname, '..', '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')
test('SKILL.md and the person method carry the refusals and the user\'s choice of child cases', () => {
  const skill = read('SKILL.md'), method = read('types/person/method.md')
  for (const re of [/GDPR article 9/, /street address/, /find, contact or follow a private person/, /never a minor/, /never open one they did not choose/, /\(case <slug>\)/]) assert.match(skill, re)
  for (const re of [/GDPR article 9/, /minor/, /ex, a\s+neighbour/, /Never open a child case the user did not choose/, /Never a street address/]) assert.match(method, re)
  const d = /^description: (.*)$/m.exec(skill)[1]
  assert.ok(d.length <= 1100 && !d.includes(': '), `${d.length}`)
  // every line of SKILL.md stays in context for the whole conversation: type details go to method.md and references/
  const words = skill.split(/\s+/).length
  assert.ok(words <= 2100, `SKILL.md has ${words} words`)
})
