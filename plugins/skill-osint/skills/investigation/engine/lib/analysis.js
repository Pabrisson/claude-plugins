// A case's analysis, generic (GeoINT's board.py in JS): hypotheses by level; likelihood ratios clamped by what their
// clue rests on (a model alone weighs 3 at most); per level, the shares (softmax of log prior + Σ log LR) of the
// hypotheses not excluded; the frontier, where the answer is read; the rules of an exclusion and of a conclusion. The
// ACH matrix is a view of the same cells. Pure: the dashboard imports it too.
import { CAPS, EXCLUDERS } from './kinds.js'

const RANK = { low: 0, medium: 1, high: 2 }
export const clamp = (lr, cap) => Math.min(cap, Math.max(1 / cap, lr))
export function rank(hyps, cells) {
  const levels = {}
  for (const h of hyps) (levels[h.level ?? 'answer'] ??= []).push(h)
  const out = {}
  for (const [level, hs] of Object.entries(levels)) {
    const active = hs.filter(h => h.status !== 'excluded')
    const score = h => Math.log(h.prior ?? 1 / active.length) + cells.filter(c => c.hyp === h.id).reduce((s, c) => s + Math.log(clamp(c.lr, CAPS[c.status] ?? 3)), 0)
    const sc = active.map(score), max = Math.max(...sc), ex = sc.map(x => Math.exp(x - max)), sum = ex.reduce((a, b) => a + b, 0)
    out[level] = hs.map(h => { const i = active.indexOf(h); return { id: h.id, status: h.status, share: i < 0 ? 0 : ex[i] / sum } })
      .sort((a, b) => b.share - a.share || a.id.localeCompare(b.id))
  }
  return out
}
export function frontier(ranked, order = []) {
  const levels = [...order.filter(l => ranked[l]), ...Object.keys(ranked).filter(l => !order.includes(l))].reverse()
  const active = l => ranked[l].filter(h => h.status !== 'excluded').length
  return levels.find(l => active(l) >= 2) ?? levels.find(l => active(l) >= 1) ?? null
}
export const alternatives = (ranked, level, main) => (ranked[level] ?? []).filter(h => h.id !== main && h.status !== 'excluded' && h.share >= 0.05)
export const consistency = lr => (lr > 1 ? 'C' : lr < 1 ? 'I' : 'N')

export function exclusionError({ clue, hyp, covers, fileExists }) {
  if (!clue) return 'an exclusion rests on a clue: --clue C<nn>'
  if (clue.status === 'model') return `${clue.id} comes from a model: models rank, evidence decides; an exclusion needs a text read or a calculation`
  if (!EXCLUDERS.includes(clue.status)) return `${clue.id} is ${clue.status}: an exclusion needs a text read or a calculation (exclusion needs the same standard as confirmation)`
  if (!fileExists) return `${clue.id} names no file that exists (its where, or the capture of one of its sources)`
  if ((hyp.point || hyp.radius_m) && !(Number(covers) >= 0.5)) return `${hyp.id} is an area: the clue must cover at least half of it, --covers 0.5..1`
  return null
}

export function conclusionErrors({ conclusion: c, hyps, cells, clues, exclusions, journalIds, levels, redteam, redteamAt, rankedAt, state = {} }) {
  const errs = [], hyp = Object.fromEntries(hyps.map(h => [h.id, h])), clue = Object.fromEntries(clues.map(x => [x.id, x]))
  if (!redteamAt || (rankedAt && redteamAt < rankedAt)) errs.push('run the red team after the last ranking change (redteam --file)')
  else if (redteam?.target !== c.answer) errs.push(`the red team targeted ${redteam?.target}, not the answer ${c.answer}`)
  else if (redteam.outcome === 'refuted') errs.push(`the red team refuted ${c.answer}`)
  if (!hyp[c.answer]) errs.push(`no hypothesis ${c.answer}`)
  else if (hyp[c.answer].status === 'excluded') errs.push(`${c.answer} is excluded`)
  const support = cells.filter(x => x.hyp === c.answer && x.lr > 1)
  if (c.radius_m != null && Number(c.radius_m) <= 100 && support.filter(x => clue[x.clue]?.constraint).length < 2)
    errs.push('a radius of 100 m or less needs two independent constraints (clue --constraint) supporting the answer')
  const cited = x => !!x && ((x.sources ?? []).length > 0 || (!!x.journal && journalIds.has(x.journal)))
  const uncited = [...new Set([...support.map(x => x.clue), ...exclusions.map(e => e.clue)])].filter(id => !cited(clue[id]))
  if (uncited.length) errs.push(`never fabricate verification: ${uncited.join(', ')} cite no source nor Journal entry`)
  for (const a of c.alternatives ?? []) {
    if (!hyp[a.hyp]) errs.push(`alternative ${a.hyp}: no such hypothesis`)
    if (!String(a.test ?? '').trim()) errs.push(`alternative ${a.hyp}: write the test that would tell it from the answer`)
  }
  const ids = levels.map(l => l.id)
  if (!c.confidence || !Object.keys(c.confidence).length) errs.push('a confidence per level: "confidence": { "<level>": "high|medium|low" }')
  for (const [l, v] of Object.entries(c.confidence ?? {})) {
    if (!ids.includes(l)) errs.push(`unknown level ${l}: ${ids.join(', ')}`)
    if (!['high', 'medium', 'low'].includes(v)) errs.push(`confidence ${l}: high|medium|low`)
    if (!String(c.criteria?.[l] ?? '').trim()) errs.push(`confidence ${l}: write the criteria it meets ("criteria": { "${l}": "…" })`)
    // a capped level (levels[].max): its confidence stays at the cap unless the type's state lifts it (a flag set true)
    const max = levels.find(x => x.id === l)?.max
    if (max && RANK[v] > RANK[max.confidence] && !(max.unless && state?.[max.unless] === true)) errs.push(`confidence ${l}: at most ${max.confidence} — ${max.why}`)
  }
  return errs
}
