import assert from 'node:assert/strict'
import test from 'node:test'
import { description, speechCues, srt, vtt } from '../lib/deliver.js'

test('subtitles: lines of 42 characters at most, a new one after a sentence or a pause, up 0.8 s at least', () => {
  const words = 'Bonjour à tous. Aujourd’hui on parle du rendu local des vidéos et de sa vitesse réelle'.split(' ')
    .map((w, i) => ({ w, v0: i * 0.4 + (i >= 9 ? 1 : 0), v1: i * 0.4 + 0.3 + (i >= 9 ? 1 : 0) }))
  const cues = speechCues(words)
  assert.deepEqual(cues.map(c => c.text), ['Bonjour à tous.', 'Aujourd’hui on parle du rendu local', 'des vidéos et de sa vitesse réelle'])
  assert.ok(cues.every(c => c.text.length <= 42 && c.v1 - c.v0 >= 0.8))
  assert.equal(speechCues([{ w: 'Oui', v0: 1, v1: 1.2 }, { w: 'non', v0: 2.2, v1: 2.4 }])[0].v1, 1.8)
  assert.equal(speechCues([{ w: 'Oui.', v0: 1, v1: 1.2 }, { w: 'Non', v0: 1.5, v1: 1.7 }])[0].v1, 1.5)
  assert.match(srt(cues), /^1\n00:00:00,000 --> 00:00:01,100\nBonjour à tous\.\n\n2\n00:00:01,200 --> /)
  assert.match(vtt([{ v0: 3661.9996, v1: 3663, text: 'x' }]), /^WEBVTT\n\n01:01:02\.000 --> 01:01:03\.000\nx\n/)
})

test("description: About.md's own section, then the chapters when YouTube would show them", () => {
  const about = '# demo\n\n## Hook\nx\n\n## Description\nRendu local en 10 s\n#video\n\n## État\n- done\n'
  const seqs = [['Intro', 0, 12], ['Pourquoi', 12, 30], ['Comment', 30, 61]].map(([name, t0, t1]) => ({ kind: 'sequence', name, t0, t1 }))
  assert.equal(description(about, seqs), 'Rendu local en 10 s\n#video\n\n00:00 Intro\n00:12 Pourquoi\n00:30 Comment')
  assert.equal(description(about, seqs.slice(0, 2)), 'Rendu local en 10 s\n#video')
  assert.equal(description('# demo\n\n## Description\n', []), '')
  assert.equal(description('# demo\n\n## Description\nLast section', []), 'Last section')
})
