// `prompt.edit` is raised by the composer alone (the kit has no call for it), so the hook's logic
// is checked through `fence` and `detect`; the wiring is checked by a paste in a live session.

import { expect, test } from 'claude-code/testing'
import { detect, fence } from '../hooks/register'

const LANGS: [string, string | null][] = [
  ['<?php\necho "hi";', 'php'],
  ['public function index()\n{\n    return $this->view;\n}', 'php'],
  ['<div class="a">\n  <p>hi</p>\n</div>', 'html'],
  ['{\n  "a": 1,\n  "b": [true]\n}', 'json'],
  ['services:\n  web:\n    image: nginx', 'yaml'],
  ['FROM node:20\nRUN npm ci', 'dockerfile'],
  ['SELECT id, name\nFROM users\nWHERE id = 1', 'sql'],
  ['def add(a, b):\n    return a + b', 'python'],
  ['package main\n\nfunc main() {}', 'go'],
  ['fn main() {\n    let mut x = 1;\n}', 'rust'],
  ['interface User {\n  name: string\n}', 'typescript'],
  ['const a = [1, 2]\nconsole.log(a)', 'javascript'],
  ['.btn {\n  color: red;\n}', 'css'],
  ['#!/bin/bash\necho hi', 'bash'],
  ['#!/usr/bin/env python3\nprint(1)', 'python'],
  ['git status\nnpm run build', 'bash'],
  ['foo(bar);\nbaz(qux);', ''],
  ['Bonjour,\nje voudrais que tu regardes ce fichier.', null],
  ['Objet: réunion\nDate: lundi', null],
  ['Objet: réunion\n\nDate: lundi', null],
  ['Please select the item\nfrom the list below.', null],
]

test('detect names the language, or says prose', () => {
  for (const [code, lang] of LANGS) expect([code, detect(code)]).toEqual([code, lang])
})

test('a code paste is fenced with its language', () => {
  expect(fence('', 0, 'def f():\n    pass\n')).toBe('```python\ndef f():\n    pass\n```\n')
})

test('leading blank lines go, indentation stays', () => {
  expect(fence('', 0, '\n\n    x = 1;\n    y = 2;')).toBe('```\n    x = 1;\n    y = 2;\n```\n')
})

test('a paste in the middle of a line opens the fence on a line of its own', () => {
  expect(fence('Regarde :', 9, 'SELECT 1\nFROM t')).toBe('\n```sql\nSELECT 1\nFROM t\n```\n')
})

test('left as is: one line, already fenced, inside an open fence, prose', () => {
  expect(fence('', 0, 'const a = 1')).toBe(null)
  expect(fence('', 0, '```js\nconst a = 1\n```')).toBe(null)
  expect(fence('```ts\n', 6, 'const a = 1\nconst b = 2')).toBe(null)
  expect(fence('', 0, 'Bonjour,\nça va ?')).toBe(null)
})

test('a large paste is read in linear time', () => {
  const t = performance.now()
  detect('x\n' + ' \n'.repeat(50000) + 'y')
  detect(Array.from({ length: 20000 }, (_, i) => `12:00:${i} INFO id=${i} user: bob`).join('\n'))
  expect(performance.now() - t).toBeLessThan(1000)
})
