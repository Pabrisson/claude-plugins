import assert from 'node:assert/strict'
import test from 'node:test'
import { actionsFor, formatPrompt, itemOf, pivotsFor } from '../lib/prompt.js'

test('the copied prompts: a header per scope, one numbered line per item', () => {
  assert.equal(formatPrompt({ slug: 'durand-bakery-example' }, [{ tag: 'refresh', text: 'focus on the reverse image search' }, { tag: 'question', text: 'who is\nJeanne?' }]),
    'osint follow-up (case durand-bakery-example)\n1. [refresh] focus on the reverse image search\n2. [question] who is Jeanne?')
  assert.equal(formatPrompt({ start: 'x' }), 'osint case x: start')
  assert.equal(formatPrompt({ all: true }, [{ tag: 'question', text: 'q' }]), 'osint (all cases)\n1. [question] q')
  assert.deepEqual(itemOf('[domain:deep-wayback] {value}', { value: 'durand-bakery.example' }), { tag: 'domain:deep-wayback', text: 'durand-bakery.example' })
})

test('pivots: a new case of each type that takes the entity kind; actions by target', () => {
  const types = [{ id: 'domain', label: 'Domain', icon: 'globe', pivots: ['domain', 'url', 'email'], actions: [{ id: 'tracker-search', target: 'entity:tracker' }, { id: 'legal-notice', target: 'case' }] }]
  assert.deepEqual(pivotsFor({ kind: 'domain', value: 'shop.durand-bakery.example', path: 'Entities/shop.durand-bakery.example.md' }, types), [
    { type: 'domain', label: 'New Domain case on shop.durand-bakery.example', icon: 'globe', item: { tag: 'pivot:domain', text: 'shop.durand-bakery.example — from Entities/shop.durand-bakery.example.md' } },
  ])
  assert.deepEqual(pivotsFor({ kind: 'ip', value: '192.0.2.10', path: 'x' }, types), [])
  assert.deepEqual(actionsFor(types[0], 'entity:tracker').map(a => a.id), ['tracker-search'])
  assert.deepEqual(actionsFor(types[0], 'case').map(a => a.id), ['legal-notice'])
})
