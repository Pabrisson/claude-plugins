// Refresh: what changed since the last collection, not a new start. Each engine step of the type's `refresh` runs
// again; each snapshot it takes (items with a key) is compared with the previous one of its name; the changes go to the
// Journal, to Case.md's `what-changed` block and to case.json; the agent's steps are given back as prompt items.
import fs from 'node:fs'
import path from 'node:path'
import { caseLabels, journal, markFake, readCase, updateCase, withLock, writeCaseNote } from './case.js'
import { emit } from './events.js'
import { getType, runTypeCommand } from './types.js'
import { fail, nowIso, readJson, writeJson } from './util.js'
import { localDate, readNote } from './vault.js'
import { watchSteps } from './watch-rules.js'

export function diff(prev, next) {
  const before = new Map(prev.map(x => [x.key, x])), after = new Map(next.map(x => [x.key, x]))
  return {
    added: next.filter(x => !before.has(x.key)),
    removed: prev.filter(x => !after.has(x.key)),
    changed: next.filter(x => before.has(x.key)).map(x => ({ key: x.key, fields: [...new Set([...Object.keys(x), ...Object.keys(before.get(x.key))])].filter(k => k !== 'key' && JSON.stringify(x[k]) !== JSON.stringify(before.get(x.key)[k])) })).filter(c => c.fields.length),
  }
}
export function snapshot(dir, name, items) {
  const d = path.join(dir, '.osint', 'collect', name)
  fs.mkdirSync(d, { recursive: true })
  // numbering under the case's lock: two runs at once never take the same number
  return withLock(dir, () => {
    const runs = fs.readdirSync(d).filter(f => /^\d+\.json$/.test(f)).map(f => Number(f.slice(0, -5))).sort((a, b) => a - b)
    const last = runs.length ? path.join(d, `${runs.at(-1)}.json`) : null, prev = last ? readJson(last) : null
    const out = { name, first: prev == null, ...diff(prev?.items ?? [], items) }
    // nothing different from the last snapshot: no new file, the last one is read again now (a watch pass every few hours
    // would otherwise add a file each time, for ever)
    if (prev && !out.added.length && !out.removed.length && !out.changed.length && JSON.stringify(prev.items) === JSON.stringify(items)) writeJson(last, { ...prev, at: nowIso() })
    else writeJson(path.join(d, `${(runs.at(-1) ?? 0) + 1}.json`), { at: nowIso(), items })
    return out
  })
}

const few = (xs, f) => `${xs.slice(0, 12).map(f).join(', ')}${xs.length > 12 ? `, +${xs.length - 12}` : ''}`
export async function refresh(home, slug, { only, yes, watch = false } = {}) {
  const dir = path.join(home, slug), c = readCase(dir), m = getType(c.type, home), p = readNote(path.join(dir, 'Case.md')).props
  // a watch pass runs only what the watch may run (never a noisy step, one that sends an image, one that costs, nor one
  // nobody declared watch: true) and never has the user's yes; `only` and `yes` are ignored there
  const steps = watch ? watchSteps(m) : (m.refresh ?? []).filter(s => !only || only.includes(s.id))
  const loud = steps.filter(s => s.noisy)
  if (loud.length && p.noisy === 'ask' && !yes) fail(`${loud.map(s => s.id).join(', ')} ${loud.length > 1 ? 'are noisy steps' : 'is a noisy step'}: the user's yes, then --yes (or --only without ${loud.length > 1 ? 'them' : 'it'})`, 2)
  const diffs = [], handed = [], failed = []
  for (const s of steps.filter(x => x.by === 'engine')) {
    if (s.noisy && p.noisy === 'never') { journal(dir, 'refresh', `skipped ${s.id}: noisy steps are never run in this case`); continue }
    const [name, ...argv] = s.run.split(' ')
    if (s.noisy && yes && !watch) argv.push('--yes')
    try { await runTypeCommand(home, slug, m, name, argv, { diffs, fresh: true, agent: handed }) } catch (e) {
      if (!e.userError) throw e
      const text = `${watch ? 'watch pass' : 'refresh'} ${s.id}: ${e.message}`
      failed.push(`${s.id}: ${e.message}`)
      emit(dir, { kind: 'fail', text, journal: journal(dir, 'fail', text) })
    }
  }
  const real = diffs.filter(d => !d.first)
  const tot = k => real.reduce((n, d) => n + d[k].length, 0)
  const L = caseLabels(dir), at = nowIso(), by = watch ? 'watch' : 'engine'
  const lines = real.filter(d => d.added.length + d.removed.length + d.changed.length).map(d => `- ${d.name}: ${[
    d.added.length && `+${d.added.length} (${few(d.added, x => x.key)})`,
    d.removed.length && `−${d.removed.length} (${few(d.removed, x => x.key)})`,
    d.changed.length && `~${d.changed.length} (${few(d.changed, x => `${x.key}: ${x.fields.join(', ')}`)})`,
  ].filter(Boolean).join(' · ')}`)
  const summary = lines.length ? lines.join('\n') : `- ${L.none}`
  // a watch pass that finds nothing, after one that found nothing the same day: no Journal line, Case.md and case.json
  // untouched but for the last pass's time (a watch every 6 hours is not four lines a day, for ever)
  const before = readCase(dir).refreshes.at(-1), quiet = watch && !lines.length && before?.by === 'watch' && !before.added && !before.removed && !before.changed && localDate(new Date(before.at)) === localDate(new Date(at))
  const j = quiet ? before.journal : journal(dir, watch ? 'watch' : 'refresh', `What changed: ${lines.length ? lines.map(l => l.slice(2)).join(' ; ') : 'nothing'}`)
  if (!quiet) markFake(dir)
  if (!quiet) writeCaseNote(dir, 'Case.md', { blocks: { 'what-changed': `## ${L.what_changed} — ${at.slice(0, 16).replace('T', ' ')}${watch ? ` · ${L.by_watch}` : ''}\n\n${summary}\n\n[[Journal#^${j}]]` } })
  updateCase(dir, x => { if (quiet) x.refreshes[x.refreshes.length - 1] = { ...before, at }; else x.refreshes.push({ at, by, added: tot('added'), removed: tot('removed'), changed: tot('changed'), journal: j }) })
  emit(dir, { kind: 'refresh.diff', text: `${tot('added')} added, ${tot('removed')} removed, ${tot('changed')} changed`, journal: j, data: { added: tot('added'), removed: tot('removed'), changed: tot('changed') } })
  const agent = watch ? [] : [...steps.filter(s => s.by === 'agent').map(s => ({ id: s.id, section: s.section, prompt: `[${m.id}:${s.section}] ${p.input}` })), ...handed]
  return { diffs: diffs.map(({ name, first, added, removed, changed }) => ({ name, first, added, removed, changed })), agent, failed }
}
