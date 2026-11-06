// lib/md-html.js — the notes' Markdown, once lib/obsidian-md.js has preprocessed it, as static HTML for the print
// view: headings, paragraphs (a line break stays one, as in Obsidian), lists and task lists, tables, quotes and
// callouts, code, rules; inline code, links, bold, italics, strikes, highlights, bare URLs. Every text is escaped and
// raw HTML never goes through: the notes quote web pages. Only http(s), mailto and the page's own #anchors make links;
// `obsidian:` links and `embed:` images go to the caller's hooks; a remote image is a link, never loaded. Pure.
import { calloutOf, parseTarget } from './obsidian-md.js'

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c])
// Markdown's backslash escapes (the engine escapes what a third party wrote: \<script\>) back to their characters
const BS = /\\([\\`*_{}[\]()#+\-.!<>|~=%^&"'])/g
export const unescapeMd = s => String(s ?? '').replace(BS, '$1')

function link(label, href, hooks) {
  const text = inline(label, hooks)
  if (/^obsidian:/i.test(href)) return hooks.note ? hooks.note(parseTarget(href), text) : `<span class="ref">${text}</span>`
  if (/^#[\w^-]+$/.test(href) || /^(https?:|mailto:)/i.test(href)) return `<a href="${esc(href)}">${text || esc(href)}</a>`
  return text
}
function image(alt, src, hooks) {
  if (/^embed:/i.test(src)) return hooks.embed ? hooks.embed(parseTarget(src), alt) : `<span class="ref">${esc(alt)}</span>`
  if (/^https?:/i.test(src)) return `<a href="${esc(src)}">${esc(alt || src)}</a>`
  return esc(alt)
}
export function inline(text, hooks = {}) {
  const keep = [], put = html => `\u0000${keep.push(html) - 1}\u0000`
  const s = String(text ?? '').replace(/\u0000/g, '')
    .replace(/`([^`\n]+)`/g, (_, c) => put(`<code>${esc(c)}</code>`))
    .replace(BS, (_, c) => put(esc(c)))
    .replace(/\[\]\(#\^([\w-]+)\)/g, (_, id) => put(`<span class="block" id="${esc(id)}"></span>`))
    .replace(/(!?)\[([^\]\n]*)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/g, (_, bang, label, href) => put(bang ? image(label, href, hooks) : link(label, href, hooks)))
    .replace(/<((?:https?:|mailto:)[^\s<>]+)>/gi, (_, u) => put(`<a href="${esc(u)}">${esc(u)}</a>`))
    .replace(/\bhttps?:\/\/[^\s<>"'`\u0000]*[^\s<>"'`\u0000.,;:!?)\]]/gi, u => put(`<a href="${esc(u)}">${esc(u)}</a>`))
  return esc(s)
    .replace(/\*\*(?=\S)([^*]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])__(?=\S)([^_]*?\S)__(?!\w)/g, '$1<strong>$2</strong>')
    .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?![_\w])/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([^~]*?\S)~~/g, '<del>$1</del>')
    .replace(/==(?=\S)([^=]*?\S)==/g, '<mark>$1</mark>')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => keep[i])
}

const LIST = /^([ \t]*)([-*+]|\d+[.)])[ \t]+(.*)$/
const HR = /^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/
const FENCE = /^[ \t]*(```|~~~)/
const SEP = /^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/
const STARTS = line => /^[ \t]*(#{1,6}[ \t]|>)/.test(line) || FENCE.test(line) || HR.test(line) || LIST.test(line)
const lead = l => l.length - l.trimStart().length
const cells = row => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())

function list(lines, i, hooks) {
  const head = LIST.exec(lines[i]), indent = head[1].length, ordered = /\d/.test(head[2]), items = []
  for (; i < lines.length; i++) {
    const l = lines[i], m = LIST.exec(l)
    if (m && m[1].length === indent && /\d/.test(m[2]) === ordered) items.push([m[3]])
    else if (l.trim() && lead(l) > indent) items.at(-1).push(l.replace(new RegExp(`^[ \\t]{1,${indent + 2}}`), ''))
    else if (!l.trim() && lead(lines[i + 1] ?? '') > indent && (lines[i + 1] ?? '').trim()) items.at(-1).push('')
    else break
  }
  const li = ([first, ...rest]) => {
    const task = /^\[([ xX])\][ \t]+(.*)$/.exec(first)
    const text = task ? `<input type="checkbox" disabled${task[1] === ' ' ? '' : ' checked'}> ${inline(task[2], hooks)}` : inline(first, hooks)
    return `<li${task ? ' class="task"' : ''}>${text}${rest.length ? mdToHtml(rest.join('\n'), hooks) : ''}</li>`
  }
  const tag = ordered ? 'ol' : 'ul'
  return [`<${tag}>${items.map(li).join('')}</${tag}>`, i]
}

export function mdToHtml(md, hooks = {}) {
  const lines = String(md ?? '').replace(/\r\n?/g, '\n').split('\n'), out = []
  for (let i = 0; i < lines.length;) {
    const l = lines[i]
    let m
    if (!l.trim()) { i++; continue }
    if ((m = FENCE.exec(l))) {
      const body = []
      for (i++; i < lines.length && !lines[i].trimStart().startsWith(m[1]); i++) body.push(lines[i])
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`)
      i++
    } else if ((m = /^[ \t]*(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/.exec(l))) {
      out.push(`<h${m[1].length}>${inline(m[2], hooks)}</h${m[1].length}>`)
      i++
    } else if (HR.test(l)) {
      out.push('<hr>')
      i++
    } else if (l.includes('|') && SEP.test(lines[i + 1] ?? '')) {
      const head = cells(l), rows = []
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) rows.push(cells(lines[i]))
      const row = (r, tag) => `<tr>${head.map((_, k) => `<${tag}>${inline(r[k] ?? '', hooks)}</${tag}>`).join('')}</tr>`
      out.push(`<div class="table"><table><thead>${row(head, 'th')}</thead><tbody>${rows.map(r => row(r, 'td')).join('')}</tbody></table></div>`)
    } else if (/^[ \t]*>/.test(l)) {
      const body = []
      for (; i < lines.length && /^[ \t]*>/.test(lines[i]); i++) body.push(lines[i].replace(/^[ \t]*> ?/, ''))
      const c = calloutOf(body[0])
      out.push(c ? `<div class="callout callout-${esc(c.type)}"><p class="callout-title">${inline(c.title, hooks)}</p>${mdToHtml(body.slice(1).join('\n'), hooks)}</div>`
        : `<blockquote>${mdToHtml(body.join('\n'), hooks)}</blockquote>`)
    } else if (LIST.test(l)) {
      const [html, next] = list(lines, i, hooks)
      out.push(html)
      i = next
    } else {
      const para = [lines[i++].trim()]
      while (i < lines.length && lines[i].trim() && !STARTS(lines[i]) && !(lines[i].includes('|') && SEP.test(lines[i + 1] ?? ''))) para.push(lines[i++].trim())
      out.push(`<p>${para.map(x => inline(x, hooks)).join('<br>')}</p>`)
    }
  }
  return out.join('\n')
}
