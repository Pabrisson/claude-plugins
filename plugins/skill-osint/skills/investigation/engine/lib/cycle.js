// The analysis of a case as commands: hypotheses (their notes), likelihood ratios and exclusions (.osint/analysis.json),
// the red team, the conclusion, the leads. Each change ranks again and rewrites the managed blocks that show it: each
// hypothesis's `analysis`, Case.md's `hypotheses` (shares and the ACH matrix), `conclusion`, Report.md's `report`,
// Leads.md's `leads`. A hypothesis's status lives in its note: changed in Obsidian, the ranking reads it.
import fs from 'node:fs'
import path from 'node:path'
import { alternatives, clamp, conclusionErrors, consistency, exclusionError, frontier, rank } from './analysis.js'
import { caseLabels, journal, nextId, readCase, updateCase, withLock, writeCaseNote } from './case.js'
import { emit } from './events.js'
import { CAPS } from './kinds.js'
import { findById, guard, noteLink, strings } from './records.js'
import { template } from './templates.js'
import { fail, nowIso, readJson, safeName, writeJson } from './util.js'
import { getBlock, journalIds, readNote } from './vault.js'

const notesIn = (dir, folder) => { try { return fs.readdirSync(path.join(dir, folder)).filter(f => f.endsWith('.md')).sort().map(f => `${folder}/${f}`) } catch { return [] } }
const titleOf = (dir, rel) => /^# (.+)$/m.exec(readNote(path.join(dir, rel)).body)?.[1].trim() ?? path.posix.basename(rel, '.md')
export const hypsOf = dir => notesIn(dir, 'Hypotheses').map(rel => {
  const p = readNote(path.join(dir, rel)).props
  return { id: p.id, path: rel, title: titleOf(dir, rel), status: p.status ?? 'active', level: p.level, parent: p.parent ?? null, prior: p.prior ?? undefined, point: p.point ?? null, radius_m: p.radius_m ?? null, refute_if: p.refute_if, reason: p.reason ?? null }
}).filter(h => h.id)
export const cluesOf = dir => notesIn(dir, 'Clues').map(rel => {
  const p = readNote(path.join(dir, rel)).props
  return { id: p.id, path: rel, title: titleOf(dir, rel), status: p.status, constraint: !!p.constraint, sources: [].concat(p.sources ?? []), journal: p.journal ?? null, where: p.where ?? null, credibility: p.credibility ?? null }
}).filter(c => c.id)
const AFILE = dir => path.join(dir, '.osint', 'analysis.json')
export const readAnalysis = dir => readJson(AFILE(dir), { cells: [], exclusions: [] })
// read, change, write under the case's lock: two commands at once lose nothing
const updateAnalysis = (dir, fn) => withLock(dir, () => { const a = readAnalysis(dir); fn(a); writeJson(AFILE(dir), a) })
export function ranking(dir, manifest) {
  const hyps = hypsOf(dir), a = readAnalysis(dir), ranked = rank(hyps, a.cells)
  return { hyps, ...a, ranked, frontier: frontier(ranked, manifest.levels.map(l => l.id)) }
}
const pct = x => `${Math.round(x * 100)} %`

export function rerank(dir, manifest) {
  const r = ranking(dir, manifest), L = caseLabels(dir), clues = cluesOf(dir)
  const share = id => Object.values(r.ranked).flat().find(h => h.id === id)?.share ?? 0
  const clueLink = id => { const c = clues.find(x => x.id === id); return c ? noteLink(c.path) : id }
  for (const h of r.hyps) {
    const cells = r.cells.filter(c => c.hyp === h.id), place = (r.ranked[h.level] ?? []).findIndex(x => x.id === h.id) + 1
    writeCaseNote(dir, h.path, { blocks: { analysis: [
      `**${L.share}** — ${pct(share(h.id))} (${h.level}, ${place}/${(r.ranked[h.level] ?? []).length})`,
      `**${L.refute_if}** — ${h.refute_if}`,
      cells.length ? [`| ${L.clue} | ${L.status} | LR | ${L.why} |`, '|---|---|---|---|', ...cells.map(c => `| ${clueLink(c.clue)} | ${c.status} | ${c.lr} | ${c.why} |`)].join('\n') : '',
    ].filter(Boolean).join('\n\n') } })
  }
  const matrixClues = [...new Set(r.cells.map(c => c.clue))].sort()
  const table = [`| ${L.hypotheses} | Level | ${L.status} | ${L.share} |`, '|---|---|---|---|', ...r.hyps.map(h => `| ${noteLink(h.path)} | ${h.level} | ${h.status} | ${pct(share(h.id))} |`)].join('\n')
  const ach = matrixClues.length ? ['', `| ${L.clue} | ${r.hyps.map(h => h.id).join(' | ')} |`, `|---|${r.hyps.map(() => '---|').join('')}`,
    ...matrixClues.map(cl => `| ${clueLink(cl)} | ${r.hyps.map(h => { const c = r.cells.find(x => x.clue === cl && x.hyp === h.id); return c ? `${consistency(c.lr)} ×${c.lr}` : '' }).join(' | ')} |`)].join('\n') : ''
  writeCaseNote(dir, 'Case.md', { blocks: { hypotheses: r.hyps.length ? `## ${L.hypotheses}\n\n${table}\n${ach}` : '' } })
  // the red team is stale only when the ranking moved: `retained` is not a change (retained counts as active)
  const sig = JSON.stringify(Object.values(r.ranked).flat().map(h => [h.id, h.status === 'retained' ? 'active' : h.status, h.share]))
  updateCase(dir, c => { if (c.ranked_sig !== sig) { c.ranked_sig = sig; c.ranked_at = nowIso() } })
  emit(dir, { kind: 'hyp.rank', data: { ranked: r.ranked, frontier: r.frontier } })
  return r
}

export function hypAdd(dir, manifest, { title, level, under, refuteIf, point, radius, prior }) {
  if (!String(title ?? '').trim()) fail('hyp add "<what the hypothesis says>"')
  const levels = manifest.levels.map(l => l.id)
  guard(dir, { text: `${title}\n${refuteIf ?? ''}` })   // GDPR article 9: a person case's hypothesis never names it
  if (!levels.includes(level)) fail(`--level ${levels.join(', ')}`)
  if (!String(refuteIf ?? '').trim()) fail('--refute-if "<what would refute it>": written before the hypothesis is examined')
  if (under && !hypsOf(dir).some(h => h.id === under)) fail(`no hypothesis ${under}`)
  const pt = point ? String(point).split(',').map(Number) : null
  if (pt && (pt.length !== 2 || pt.some(Number.isNaN))) fail('--point <lat>,<lon>')
  const id = nextId(dir, 'H'), rel = `Hypotheses/${id} ${safeName(title)}.md`, L = caseLabels(dir)
  writeCaseNote(dir, rel, { props: { id, status: 'active', level, parent: under ?? null, refute_if: refuteIf, reason: null, point: pt, radius_m: radius == null ? null : Number(radius), prior: prior == null ? null : Number(prior) },
    create: template('hypothesis.md', readCase(dir).type, { ...L, title }, path.dirname(dir)) })
  const j = journal(dir, 'hypothesis', `${id} (${level}) ${title} — refuted if: ${refuteIf}`)
  emit(dir, { kind: 'hyp.add', id, path: rel, text: title, journal: j })
  rerank(dir, manifest)
  return { id, path: rel }
}
const hypOrFail = (dir, id) => hypsOf(dir).find(h => h.id === id) ?? fail(`no hypothesis ${id}`)
const clueOrFail = (dir, id) => cluesOf(dir).find(c => c.id === id) ?? fail(`no clue ${id}`)

export function hypLr(dir, manifest, { hyp, clue, lr, why }) {
  hypOrFail(dir, hyp)
  const c = clueOrFail(dir, clue), v = Number(lr)
  if (!(v > 0)) fail('--lr <a positive number: >1 supports, <1 weakens>')
  if (!String(why ?? '').trim()) fail('--why "<what the clue says about the hypothesis>"')
  guard(dir, { text: why })
  const cap = CAPS[c.status], value = clamp(v, cap)
  const j = journal(dir, 'lr', `${hyp} ← ${clue} ×${value} (${c.status}, cap ${cap})${value !== v ? ` (asked ${v})` : ''}: ${why}`)
  updateAnalysis(dir, a => { a.cells = [...a.cells.filter(x => !(x.clue === clue && x.hyp === hyp)), { clue, hyp, lr: value, status: c.status, cap, why, journal: j }] })
  return rerank(dir, manifest)
}

function fileOf(dir, c) {
  const files = fs.readdirSync(dir, { recursive: true }).map(f => String(f).split(path.sep).join('/'))
  const name = s => String(s).replace(/^\[\[|\]\]$/g, '')
  if (c.where && files.some(f => path.posix.basename(f) === name(c.where) || f === name(c.where))) return true
  return c.sources.some(s => {
    const rel = findById(dir, 'Sources', name(s).split(' ')[0])
    const cap = rel && name(readNote(path.join(dir, rel)).props.capture ?? '')
    return cap && fs.existsSync(path.join(dir, 'Evidence', 'captures', cap))
  })
}
export function hypExclude(dir, manifest, { hyp, clue, why, covers }) {
  const h = hypOrFail(dir, hyp), c = clueOrFail(dir, clue)
  if (!String(why ?? '').trim()) fail('--why "<what rules it out>"')
  guard(dir, { text: why })
  const err = exclusionError({ clue: c, hyp: h, covers, fileExists: fileOf(dir, c) })
  if (err) fail(err)
  const j = journal(dir, 'exclude', `${hyp} excluded by ${clue}${covers ? ` (covers ${covers})` : ''}: ${why}`)
  writeCaseNote(dir, h.path, { props: { status: 'excluded', reason: `${why} — ${noteLink(c.path)} · [[Journal#^${j}]]` } })
  updateAnalysis(dir, a => { a.exclusions = [...a.exclusions.filter(x => x.hyp !== hyp), { hyp, clue, covers: covers == null ? null : Number(covers), why, journal: j }] })
  emit(dir, { kind: 'hyp.status', id: hyp, text: `${hyp} excluded`, data: { status: 'excluded' }, journal: j })
  return rerank(dir, manifest)
}
export function hypRetain(dir, manifest, id) {
  const h = hypOrFail(dir, id)
  for (const o of hypsOf(dir)) if (o.level === h.level && o.status === 'retained' && o.id !== id) writeCaseNote(dir, o.path, { props: { status: 'active' } })
  writeCaseNote(dir, h.path, { props: { status: 'retained' } })
  emit(dir, { kind: 'hyp.status', id, text: `${id} retained`, data: { status: 'retained' } })
  return rerank(dir, manifest)
}

export function redteam(dir, v) {
  guard(dir, { text: strings(v).join('\n') })
  if (!v?.target || !hypsOf(dir).some(h => h.id === v.target)) fail('the verdict needs its "target": the hypothesis it tried to refute')
  if (!['survives', 'weakened', 'refuted'].includes(v.outcome)) fail('"outcome": survives|weakened|refuted')
  if (!Array.isArray(v.refutations) || !v.refutations.length || v.refutations.some(r => !r.test || !r.result)) fail('"refutations": [{ "test": "…", "result": "…" }, …] — what was tried, and what came out')
  const j = journal(dir, 'redteam', `${v.target} ${v.outcome} (${v.refutations.length} tests): ${v.refutations.map(r => `${r.test} → ${r.result}`).join(' ; ')}`)
  updateCase(dir, c => { c.redteam = { ...v, journal: j }; c.redteam_at = nowIso() })
  emit(dir, { kind: 'log', phase: 'redteam', text: `Red team: ${v.target} ${v.outcome}`, journal: j })
}

export function conclude(dir, manifest, c) {
  guard(dir, { text: strings(c).join('\n') })
  const r = ranking(dir, manifest), cs = readCase(dir), clues = cluesOf(dir)
  const errs = conclusionErrors({ conclusion: c, hyps: r.hyps, cells: r.cells, clues, exclusions: r.exclusions, journalIds: journalIds(dir), levels: manifest.levels, redteam: cs.redteam, redteamAt: cs.redteam_at, rankedAt: cs.ranked_at, state: cs.state?.[manifest.id] ?? {} })
  if (errs.length) fail(`the conclusion is refused:\n- ${errs.join('\n- ')}`)
  hypRetain(dir, manifest, c.answer)
  const fresh = ranking(dir, manifest), h = fresh.hyps.find(x => x.id === c.answer), L = caseLabels(dir)
  const link = id => { const x = fresh.hyps.find(y => y.id === id) ?? clues.find(y => y.id === id); return x ? noteLink(x.path) : id }
  const shareOf = id => Object.values(fresh.ranked).flat().find(x => x.id === id)?.share ?? 0
  const report = [
    `## ${L.answer}`, '', `**${link(c.answer)}** (${h.level})`, '',
    `| Level | ${L.confidence} | ${L.criteria} |`, '|---|---|---|', ...Object.entries(c.confidence).map(([l, v]) => `| ${l} | ${v} | ${c.criteria[l]} |`),
    ...(c.radius_m != null ? ['', `${L.radius}: ${c.radius_m} m`] : []),
    '', `## ${L.alternatives}`, '', ...(c.alternatives?.length ? c.alternatives.map(a => `- ${link(a.hyp)} (${pct(shareOf(a.hyp))}) — ${L.test}: ${a.test}`) : [`- ${L.none}`]),
    '', `## ${L.excluded}`, '', ...(fresh.hyps.filter(x => x.status === 'excluded').map(x => `- ${link(x.id)} — ${x.reason ?? ''}`).concat(fresh.hyps.some(x => x.status === 'excluded') ? [] : [`- ${L.none}`])),
    '', `## ${L.unresolved}`, '', ...(c.unresolved?.length ? c.unresolved.map(u => `- ${link(u)}`) : [`- ${L.none}`]),
    '', `## ${L.red_team}`, '', `${cs.redteam.target} ${cs.redteam.outcome} — [[Journal#^${cs.redteam.journal}]]`,
  ].join('\n')
  writeCaseNote(dir, 'Report.md', { blocks: { report } })
  writeCaseNote(dir, 'Case.md', { props: { status: 'done', answer: h.title, confidence: c.confidence[h.level] ?? Object.values(c.confidence)[0], radius_m: c.radius_m ?? null },
    blocks: { conclusion: `## ${L.answer}\n\n**${link(c.answer)}** — ${L.confidence}: ${Object.entries(c.confidence).map(([l, v]) => `${l} ${v}`).join(', ')}` } })
  updateCase(dir, x => { x.conclusion = c })
  const j = journal(dir, 'conclude', `${c.answer} ${h.title} — ${Object.entries(c.confidence).map(([l, v]) => `${l} ${v}`).join(', ')}`)
  emit(dir, { kind: 'case.status', text: `done: ${h.title}`, data: { status: 'done', answer: c.answer }, journal: j })
}

// a box ticked in Obsidian (- [x] … ^l07) marks its lead done
export function leadsOf(dir) {
  const ticked = new Set([...(getBlock(readNote(path.join(dir, 'Leads.md')).body, 'leads') ?? '').matchAll(/^- \[[xX]\] .*\^(l\d+)\s*$/gm)].map(m => m[1].toUpperCase()))
  return readCase(dir).leads.map(l => (ticked.has(l.id) ? { ...l, done: true } : l))
}
function renderLeads(dir) {
  const leads = leadsOf(dir)
  updateCase(dir, c => { c.leads = leads })
  writeCaseNote(dir, 'Leads.md', { blocks: { leads: leads.map(l => `- [${l.done ? 'x' : ' '}] **${l.id}** ${l.label}${l.why ? ` — ${l.why}` : ''}${l.minutes ? ` (${l.minutes} min)` : ''}${l.noisy ? ' · noisy' : ''} ^${l.id.toLowerCase()}`).join('\n') } })
}
export function next(dir, list) {
  if (!Array.isArray(list) || list.some(l => !String(l?.label ?? '').trim())) fail('next --file: a JSON list of { "label", "why", "minutes", "noisy", "prompt"? }')
  guard(dir, { text: strings(list).join('\n') })
  const kept = leadsOf(dir).filter(l => l.done)
  const fresh = list.map(l => { const id = nextId(dir, 'L'); return { id, label: l.label, why: l.why ?? '', minutes: l.minutes ?? null, noisy: !!l.noisy, prompt: l.prompt ?? `[lead:${id}] ${l.label}`, done: false, created: nowIso() } })
  updateCase(dir, c => { c.leads = [...kept, ...fresh] })
  renderLeads(dir)
  const j = journal(dir, 'leads', fresh.map(l => `${l.id} ${l.label}`).join(' ; '))
  for (const l of fresh) emit(dir, { kind: 'lead.add', id: l.id, text: l.label, journal: j })
}
export function nextDone(dir, id) {
  if (!readCase(dir).leads.some(l => l.id === id)) fail(`no lead ${id}`)
  updateCase(dir, c => { c.leads = c.leads.map(l => (l.id === id ? { ...l, done: true } : l)) })
  renderLeads(dir)
  journal(dir, 'leads', `${id} done`)
}

// several likelihood ratios at once (a tool's signals): each capped by its clue's status and journaled, one ranking
export function hypLrMany(dir, manifest, cells) {
  guard(dir, { text: cells.map(x => x.why ?? '').join('\n') })
  const hyps = new Set(hypsOf(dir).map(h => h.id)), clues = Object.fromEntries(cluesOf(dir).map(c => [c.id, c])), a = readAnalysis(dir)
  for (const x of cells) {
    if (!hyps.has(x.hyp)) fail(`no hypothesis ${x.hyp}`)
    const c = clues[x.clue] ?? fail(`no clue ${x.clue}`), v = Number(x.lr)
    if (!(v > 0)) fail(`${x.hyp} ← ${x.clue}: a positive likelihood ratio`)
    const cap = CAPS[c.status], value = clamp(v, cap)
    const j = journal(dir, 'lr', `${x.hyp} ← ${x.clue} ×${+value.toFixed(3)} (${c.status}, cap ${cap})${value !== v ? ` (asked ${+v.toFixed(3)})` : ''}: ${x.why}`)
    a.cells = [...a.cells.filter(y => !(y.clue === x.clue && y.hyp === x.hyp)), { clue: x.clue, hyp: x.hyp, lr: value, status: c.status, cap, why: x.why, journal: j }]
  }
  writeJson(AFILE(dir), a)
  return rerank(dir, manifest)
}
