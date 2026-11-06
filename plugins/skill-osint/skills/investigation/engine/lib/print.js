// lib/print.js — a case on paper: one static HTML page, the print view the dashboard opens (« Print view ») and that
// `export` hands to a headless Chromium. The question and the frame, the report (answer and confidence per level with
// their criteria), the hypotheses and the ACH matrix, the sources with their hashes and Admiralty grades, the
// evidence with its hashes, the Journal as an appendix on demand; the words in the case's language. No script at all:
// Chrome's --virtual-time-budget only ends once no request is open, and a live page never gets there (2026-11-03).
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { consistency } from './analysis.js'
import { resolver, vaultFiles } from './brain.js'
import { caseLabels, readCase } from './case.js'
import { cluesOf, ranking } from './cycle.js'
import { esc, inline, mdToHtml, unescapeMd } from './md-html.js'
import { preprocess } from './obsidian-md.js'
import { findType } from './types.js'
import { sha256File } from './util.js'
import { getBlock, localDate, localTime, readNote } from './vault.js'

const PRINT = 'print()'   // the toolbar's only code, an inline handler the page's CSP lets through by its hash
const IMAGE = /\.(jpe?g|png|webp|gif|avif)$/i
const fileUrl = (slug, rel) => `/api/cases/${slug}/file?path=${encodeURIComponent(rel)}`
const idOfLink = link => String(link).replace(/^\[\[|\]\]$/g, '').split(/[ |#]/)[0]
const lower = md => md.replace(/^# .*\n?/, '').replace(/^(#{1,5}) /gm, '#$1 ')   // the note's h1 goes, h2 → h3
// the Admiralty grade of a clue from one source: its reliability A–F, then the clue's credibility 1–6 (F, 6: cannot be judged)
export const admiralty = (reliability, credibility) => `${reliability || 'F'}${credibility || 6}`

export function printHtml(home, slug, { journal = false, now = new Date() } = {}) {
  const dir = path.join(home, slug), c = readCase(dir), manifest = findType(c.type, home) ?? { id: c.type, label: c.type, levels: [] } /* a private type removed or refused: still printable */, L = caseLabels(dir)
  const caseNote = readNote(path.join(dir, 'Case.md')), p = caseNote.props, status = p.status ?? 'draft'
  const title = unescapeMd(/^# (.+)$/m.exec(caseNote.body)?.[1].trim() ?? slug), files = vaultFiles(dir), resolve = resolver(files)
  const r = ranking(dir, manifest), clues = cluesOf(dir)
  const sources = files.filter(f => f.startsWith('Sources/') && f.endsWith('.md')).map(rel => {
    const n = readNote(path.join(dir, rel))
    return { rel, ...n.props, title: unescapeMd(/^# (.+)$/m.exec(n.body)?.[1].trim() ?? path.posix.basename(rel, '.md')) }
  }).filter(s => s.id)
  const achClues = [...new Set([...r.cells.map(x => x.clue), ...r.exclusions.map(x => x.clue)])].sort()
  // a note that has its own row on this page is a link to it; the others are text
  const anchors = new Map([...r.hyps.map(h => [h.path, h.id]), ...clues.filter(x => achClues.includes(x.id)).map(x => [x.path, x.id]), ...sources.map(s => [s.rel, s.id])])
  const hooks = {
    note: (t, text) => {
      const f = resolve(t.target)
      if (f === 'Journal.md' && journal && t.anchor?.startsWith('^')) return `<a href="#${esc(t.anchor.slice(1))}">${text}</a>`
      return anchors.has(f) ? `<a href="#${esc(anchors.get(f))}">${text}</a>` : `<span class="ref">${text}</span>`
    },
    embed: (t, alt) => {
      const f = resolve(t.target)
      return f && IMAGE.test(f) ? `<img class="embed" src="${esc(fileUrl(slug, f))}" alt="${esc(alt)}">` : `<span class="ref">${esc(alt)}</span>`
    },
  }
  const md = text => mdToHtml(preprocess(text ?? ''), hooks), md1 = text => inline(preprocess(String(text ?? '')), hooks)
  const table = (head, rows, cls = '') => `<div class="table${cls}"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`

  const cover = `<header>
<p class="kicker">${esc(L[`type_${c.type}`] ?? manifest.label)} · ${esc(L[`status_${status}`] ?? status)} · ${esc(L.print_generated)} ${localDate(now)} ${localTime(now).slice(0, 5)}</p>
<h1>${esc(title)}</h1>
${status === 'done' ? '' : `<p class="draft">${esc(L.print_draft)}</p>`}
${md(getBlock(caseNote.body, 'summary'))}
${md(getBlock(caseNote.body, 'conclusion'))}
</header>`

  const report = `<section><h2>${esc(L.report)}</h2>${md(lower(readNote(path.join(dir, 'Report.md')).body))}</section>`
  // a person case's Profile.md (stage 10): its title, inside its managed block, heads the section (h1 → h2)
  const profileFile = path.join(dir, 'Profile.md')
  const profile = fs.existsSync(profileFile) ? `<section class="profile">${md(lower(readNote(profileFile).body.replace(/%% osint:begin candidates %%[\s\S]*?%% osint:end candidates %%\n?/, '')))}</section>` : ''

  const share = id => Object.values(r.ranked).flat().find(h => h.id === id)?.share
  const hypRow = h => `<tr id="${esc(h.id)}"><td>${esc(h.id)}</td><td>${esc(unescapeMd(h.title))}</td><td>${esc(h.level)}</td><td>${esc(L[`hyp_${h.status}`] ?? h.status)}</td>`
    + `<td class="num">${h.status === 'excluded' || share(h.id) == null ? '—' : `${Math.round(share(h.id) * 100)} %`}</td>`
    + `<td>${md1(h.refute_if)}${h.status === 'excluded' && h.reason ? `<br><em>${esc(L.excluded)}</em> — ${md1(h.reason)}` : ''}</td></tr>`
  const clueOf = id => clues.find(x => x.id === id)
  const reliabilityOf = id => sources.find(s => s.id === id)?.reliability
  const gradeOf = x => (x ? x.sources.map(s => admiralty(reliabilityOf(idOfLink(s)), x.credibility)).sort()[0] ?? admiralty(null, x.credibility) : '')
  const achCell = (cl, h) => {
    if (r.exclusions.some(e => e.clue === cl && e.hyp === h.id)) return '<td class="ach ach-X">✕</td>'
    const x = r.cells.find(y => y.clue === cl && y.hyp === h.id)
    return x ? `<td class="ach ach-${consistency(x.lr)}" title="${esc(x.why)}">${consistency(x.lr)} ×${Number(Number(x.lr).toPrecision(2))}</td>` : '<td></td>'
  }
  const hypotheses = `<section><h2>${esc(L.hypotheses)}</h2>${r.hyps.length
    ? table(['', L.hypotheses, L.level, L.status, L.share, L.refute_if].map(esc), r.hyps.map(hypRow))
    : `<p>${esc(L.none)}</p>`}
${achClues.length ? `<h3>${esc(L.ach)}</h3>${table([esc(L.clue), esc(L.admiralty), ...r.hyps.map(h => (h.status === 'excluded' ? `<span class="out">${esc(h.id)}</span>` : esc(h.id)))],
    achClues.map(cl => `<tr id="${esc(cl)}"><td>${esc(cl)} ${esc(unescapeMd(clueOf(cl)?.title ?? ''))}</td><td>${esc(gradeOf(clueOf(cl)))}</td>${r.hyps.map(h => achCell(cl, h)).join('')}</tr>`), ' ach-table')}<p class="legend">${esc(L.ach_legend)}</p>` : ''}</section>`

  const citing = id => clues.filter(x => x.sources.some(s => idOfLink(s) === id))
  const link = u => (/^https?:\/\//i.test(u ?? '') ? `<a href="${esc(u)}">${esc(u)}</a>` : esc(u ?? ''))
  const sourceRow = s => `<tr id="${esc(s.id)}"><td>${esc(s.id)}</td><td>${esc(s.title)}<br>${link(s.url)}</td><td class="num">${esc(String(s.accessed ?? '').slice(0, 10))}</td>`
    + `<td>${s.archive ? link(s.archive) : '—'}</td><td class="hash">${esc(s.sha256 ?? '')}</td>`
    + `<td><strong>${esc(s.reliability ?? '—')}</strong>${citing(s.id).map(x => `<br><span class="muted">${esc(x.id)} ${esc(admiralty(s.reliability, x.credibility))}</span>`).join('')}</td></tr>`
  const sourcesHtml = `<section><h2>${esc(L.sources)}</h2>${sources.length
    ? `${table(['', L.source, L.accessed, L.archive, 'SHA-256', L.admiralty].map(esc), sources.map(sourceRow), ' sources')}<p class="legend">${esc(L.admiralty_legend)}</p>`
    : `<p>${esc(L.none)}</p>`}</section>`

  const figure = e => {
    const f = path.join(dir, e.file), there = fs.existsSync(f), changed = there && sha256File(f) !== e.sha256
    return `<figure id="${esc(e.id)}">${IMAGE.test(e.file) && there ? `<img src="${esc(fileUrl(slug, e.file))}" alt="">` : `<div class="file">${esc(path.extname(e.file).slice(1).toUpperCase() || e.id)}</div>`}`
      + `<figcaption><strong>${esc(e.id)}</strong> ${esc(path.posix.basename(e.file))}${e.of ? ` · ${esc(L.of)} ${esc(e.of)}` : ''}<br><span class="hash">${esc(e.sha256)}</span>`
      + `${!there ? `<br><span class="warn">${esc(L.print_missing)}</span>` : changed ? `<br><span class="warn">${esc(L.print_changed)}</span>` : ''}</figcaption></figure>`
  }
  const evidence = `<section><h2>${esc(L.evidence)}</h2>${(c.evidence ?? []).length ? `<div class="evidence">${c.evidence.map(figure).join('')}</div>` : `<p>${esc(L.none)}</p>`}</section>`

  const appendix = journal ? `<section class="appendix"><h2>${esc(L.journal_appendix)}</h2>${md(lower(readNote(path.join(dir, 'Journal.md')).body))}</section>` : ''
  const toolbar = `<nav class="toolbar"><a href="/#/c/${esc(slug)}">Back to the case</a><a href="?${journal ? '' : 'journal=1'}">${journal ? 'Hide the Journal appendix' : 'Add the Journal appendix'}</a><button type="button" onclick="${PRINT}">Print</button></nav>`
  return `<!doctype html>
<html lang="${esc(String(p.lang ?? 'en').slice(0, 2))}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer">
<title>${esc(title)} — ${esc(L.report)}</title><style>${CSS}</style></head>
<body>${toolbar}<main>
${cover}
${report}
${profile}
${hypotheses}
${sourcesHtml}
${evidence}
${appendix}
${c.fake_apis ? `<footer class="fake">${esc(L.print_fake)}</footer>` : ''}
</main></body></html>
`
}

// paper: a white A4 sheet, on a dark backdrop on screen (the dashboard's), alone in print; no colored left band
const CSS = `@page { size: A4; margin: 16mm 14mm; }
* { box-sizing: border-box; }
html { background: #09090b; color-scheme: light; }
body { margin: 0; color: #18181b; font: 10pt/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
main { background: #fff; max-width: 210mm; margin: 0 auto 24px; padding: 16mm 14mm; }
.toolbar { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: flex-end; padding: 10px 16px; background: #18181b; border-bottom: 1px solid #27272a; font-size: 13px; }
.toolbar a { color: #e4e4e7; }
.toolbar button { background: #fafafa; color: #18181b; border: 0; border-radius: 6px; padding: 6px 14px; font: inherit; font-weight: 600; cursor: pointer; }
h1 { font-size: 20pt; line-height: 1.2; margin: 4px 0 12px; }
h2 { font-size: 14pt; margin: 22px 0 8px; padding-bottom: 4px; border-bottom: 1px solid #e4e4e7; break-after: avoid; }
h3 { font-size: 11pt; margin: 16px 0 6px; break-after: avoid; }
h4, h5, h6 { font-size: 10pt; margin: 12px 0 4px; break-after: avoid; }
p { margin: 6px 0; }
.kicker, .legend, .muted { color: #71717a; font-size: 8.5pt; }
.fake { margin-top: 18px; padding-top: 6px; border-top: 1px solid #e4e4e7; color: #92400e; font-size: 8.5pt; font-weight: 600; }
.draft { background: #fef3c7; color: #92400e; padding: 6px 10px; border-radius: 6px; }
.warn { color: #b91c1c; font-size: 8pt; font-weight: 600; }
a { color: #1d4ed8; text-decoration: none; overflow-wrap: anywhere; }
.ref { font-weight: 600; }
.table { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 8.5pt; }
th, td { border: 1px solid #e4e4e7; padding: 4px 6px; text-align: left; vertical-align: top; }
th { background: #f4f4f5; font-weight: 600; }
thead { display: table-header-group; }
tr, figure, pre, blockquote, .callout { break-inside: avoid; }
td.num { white-space: nowrap; }
td.hash { min-width: 0; }
.sources table { table-layout: fixed; } .sources th:nth-child(1) { width: 7%; } .sources th:nth-child(3) { width: 14%; } .sources th:nth-child(4) { width: 10%; } .sources th:nth-child(5) { width: 27%; } .sources th:nth-child(6) { width: 15%; } .sources td { overflow-wrap: anywhere; }
code, pre, .hash { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 7.5pt; }
.hash { word-break: break-all; }
pre { background: #f4f4f5; padding: 8px; border-radius: 4px; white-space: pre-wrap; }
blockquote { margin: 8px 0; padding: 4px 12px; background: #f4f4f5; border-radius: 4px; }
.callout { margin: 8px 0; padding: 6px 12px; background: #eff6ff; border-radius: 6px; }
.callout-title { font-weight: 600; margin: 0 0 4px; }
.callout-warning { background: #fffbeb; } .callout-danger, .callout-error { background: #fef2f2; } .callout-tip { background: #f0fdf4; }
.ach { text-align: center; white-space: nowrap; font-weight: 600; }
.ach-table table { table-layout: fixed; } .ach-table th:first-child { width: 26%; } .ach-table th:nth-child(2) { width: 9%; } .ach-table td, .ach-table th { overflow-wrap: anywhere; padding: 4px 3px; } .ach-table .ach { white-space: normal; }
.ach-C { background: #dcfce7; color: #166534; } .ach-N { background: #f4f4f5; color: #52525b; } .ach-I { background: #fee2e2; color: #991b1b; } .ach-X { background: #e4e4e7; color: #18181b; }
.out { color: #a1a1aa; text-decoration: line-through; }
.evidence { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
figure { margin: 0; }
figure img, figure .file { display: flex; align-items: center; justify-content: center; width: 100%; height: 42mm; object-fit: contain; background: #f4f4f5; border-radius: 4px; color: #71717a; font-weight: 600; }
figcaption { font-size: 8pt; margin-top: 4px; }
img.embed { max-width: 100%; max-height: 80mm; }
li.task { list-style: none; } li.task input { margin: 0 6px 0 -18px; }
.appendix { break-before: page; } .appendix li { font-size: 8.5pt; }
@media screen and (max-width: 640px) { main { padding: 16px; } .evidence { grid-template-columns: repeat(2, 1fr); } }
@media print { html { background: none; } .toolbar { display: none; } .table { overflow: visible; } main { max-width: none; margin: 0; padding: 0; } }
`

// What the page may load, enforced by the browser whatever the notes quote: nothing but this server's own images (the
// case's evidence), the page's one stylesheet and the Print button's handler, each by its hash. No frame, no connection,
// no form, no base: a hostile note cannot make the browser that prints it fetch, follow or run anything.
const sha = text => `'sha256-${createHash('sha256').update(text).digest('base64')}'`
export const PRINT_CSP = `default-src 'none'; img-src 'self'; style-src ${sha(CSS)}; script-src 'unsafe-hashes' ${sha(PRINT)}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
