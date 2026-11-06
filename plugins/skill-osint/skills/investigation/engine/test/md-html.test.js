import assert from 'node:assert/strict'
import test from 'node:test'
import { esc, inline, mdToHtml, unescapeMd } from '../lib/md-html.js'
import { preprocess } from '../lib/obsidian-md.js'

test('blocks: headings, paragraphs with Obsidian line breaks, lists, task lists, tables, code, rules', () => {
  assert.equal(mdToHtml('## Answer\n\nOne line\nnext line\n\n---'), '<h2>Answer</h2>\n<p>One line<br>next line</p>\n<hr>')
  assert.equal(mdToHtml('- a\n- b\n    - b1\n- [x] done\n- [ ] open'),
    '<ul><li>a</li><li>b<ul><li>b1</li></ul></li><li class="task"><input type="checkbox" disabled checked> done</li><li class="task"><input type="checkbox" disabled> open</li></ul>')
  assert.equal(mdToHtml('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>')
  assert.equal(mdToHtml('| Level | Confidence |\n|---|---|\n| owner | high |\n| infra |'),
    '<div class="table"><table><thead><tr><th>Level</th><th>Confidence</th></tr></thead><tbody><tr><td>owner</td><td>high</td></tr><tr><td>infra</td><td></td></tr></tbody></table></div>')
  assert.equal(mdToHtml('text\n| a | b |\n|---|---|\n| 1 | 2 |'), '<p>text</p>\n<div class="table"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>')
  assert.equal(mdToHtml('```\n<b>**not bold**</b>\n```'), '<pre><code>&lt;b&gt;**not bold**&lt;/b&gt;</code></pre>')
  assert.equal(mdToHtml('> [!warning] Careful\n> the image wins'), '<div class="callout callout-warning"><p class="callout-title">Careful</p><p>the image wins</p></div>')
  assert.equal(mdToHtml('> quoted\n> twice'), '<blockquote><p>quoted<br>twice</p></blockquote>')
  assert.equal(mdToHtml('a\r\n\r\nb'), '<p>a</p>\n<p>b</p>')
})

test('inline: code, emphasis, links, bare URLs; snake_case stays as it is', () => {
  assert.equal(inline('**SIREN** *read* ~~old~~ ==key== `x*y*`'), '<strong>SIREN</strong> <em>read</em> <del>old</del> <mark>key</mark> <code>x*y*</code>')
  assert.equal(inline('image_may_leave and some_long_name'), 'image_may_leave and some_long_name')
  assert.equal(inline('see https://durand-bakery.example/mentions?a=1&b=2.'), 'see <a href="https://durand-bakery.example/mentions?a=1&amp;b=2">https://durand-bakery.example/mentions?a=1&amp;b=2</a>.')
  assert.equal(inline('[the notice](https://x.example/a_(b)) and <https://y.example>'), '<a href="https://x.example/a_(b)">the notice</a> and <a href="https://y.example">https://y.example</a>')
  assert.equal(inline('- 09:05:07 · cmd · x [](#^j001)'), '- 09:05:07 · cmd · x <span class="block" id="j001"></span>')
})

test('nothing of a note runs: HTML is escaped, a javascript: link is text, a remote image is only a link', () => {
  assert.equal(esc('<"&\'>'), '&lt;&quot;&amp;&#39;&gt;')
  assert.equal(mdToHtml('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
  assert.equal(inline('[click](javascript:alert(1))'), 'click')
  assert.equal(inline('[x](data:text/html,hi)'), 'x')
  assert.equal(inline('![logo](https://tracker.example/p.png)'), '<a href="https://tracker.example/p.png">logo</a>')
  assert.equal(inline('[a "b"](https://x.example/?q="><script>)'), '<a href="https://x.example/?q=&quot;&gt;&lt;script&gt;">a &quot;b&quot;</a>')
})

test('obsidian: links and embed: images go to the hooks, after preprocess()', () => {
  const hooks = {
    note: (t, text) => `<a href="#${t.target.split(' ')[0]}">${text}</a>`,
    embed: (t, alt) => `<img src="/f/${t.target}" alt="${esc(alt)}">`,
  }
  assert.equal(mdToHtml(preprocess('See [[H01 Durand runs it]] and ![[crop-03.jpg]].'), hooks), '<p>See <a href="#H01">H01 Durand runs it</a> and <img src="/f/crop-03.jpg" alt="crop-03.jpg">.</p>')
  assert.equal(mdToHtml(preprocess('[[Journal#^j042|the log]]')), '<p><span class="ref">the log</span></p>')
  assert.equal(mdToHtml(preprocess('a\n%% osint:begin report %%\n## Answer\n%% osint:end report %%')), '<p>a</p>\n<h2>Answer</h2>')
})

test('a backslash escape (what the engine writes for a third party\'s text) shows the character, escaped, never markup', () => {
  assert.equal(inline('\\<script\\>alert(1)\\</script\\> \\*not em\\*'), '&lt;script&gt;alert(1)&lt;/script&gt; *not em*')
  assert.equal(unescapeMd('\\<b\\> a\\_b C:\\dir'), '<b> a_b C:\\dir')
})
