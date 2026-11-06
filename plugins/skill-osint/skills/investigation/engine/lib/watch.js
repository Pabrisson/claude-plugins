// The watch (spec § 12.1): a period per case, kept in its case.json with its last and next pass; the folder's switch
// and notifications in .osint-settings.json. The dashboard server runs the passes (lib/server.js, startWatch); one
// round of them is `watch --due` (runDue, below).
import fs from 'node:fs'
import path from 'node:path'
import { caseDir, journal, listCases, personRoot, readCase, updateCase } from './case.js'
import { emit, eventsFile, readFrom } from './events.js'
import { refresh } from './refresh.js'
import { pursuitHit, sensitiveHit, CATEGORIES } from './sensitive.js'
import { getType } from './types.js'
import { approvedHash, approveType, arm, disarm, isArmed, typeDigest } from './watch-ok.js'
import { fail, readJson, writeJson } from './util.js'
import { localDate, localTime, readNote } from './vault.js'
import { nextAt, PERIODS, watchSteps, watchText } from './watch-rules.js'

// the watch's clock: OSINT_NOW (an ISO date, for the tests and the demo), else this machine's
export const clock = () => (process.env.OSINT_NOW ? Date.parse(process.env.OSINT_NOW) : Date.now())
// a pass's time for a person: its local time, with its date when it is not today (stored times are UTC ISO dates)
export function when(iso) {
  const d = new Date(iso), hm = localTime(d).slice(0, 5)
  return localDate(d) === localDate(new Date(clock())) ? hm : `${localDate(d)} ${hm}`
}

// the folder's settings; other stages add their own key next to `watch`
// developer.on: null (unset) is on for a server started on fake APIs, off for any other (Settings › Development)
const DEFAULTS = { watch: { on: true, notify: true }, developer: { on: null } }
export const settingsFile = home => path.join(home, '.osint-settings.json')
export function settings(home) {
  const s = readJson(settingsFile(home), {})
  return { ...DEFAULTS, ...s, watch: { ...DEFAULTS.watch, ...s.watch }, developer: { on: typeof s.developer?.on === 'boolean' ? s.developer.on : null } }
}
// developer mode: true, false or null (unset); only the dashboard (/api/developer) and `setup set` write it
export function saveDeveloper(home, on) {
  if (on !== null && typeof on !== 'boolean') fail('developer.on: on, off or none')
  writeJson(settingsFile(home), { ...readJson(settingsFile(home), {}), developer: { on } })
  return settings(home)
}
export function saveSettings(home, patch) {
  for (const [k, v] of Object.entries(patch)) if (!(k in DEFAULTS.watch) || typeof v !== 'boolean') fail(`the watch's settings: on and notify, true or false (not ${k}=${v})`)
  const s = readJson(settingsFile(home), {})
  writeJson(settingsFile(home), { ...s, watch: { ...DEFAULTS.watch, ...s.watch, ...patch } })
  return settings(home)
}

// A person case is watched only within its frame (§ 5): its purpose and legal basis are there, and the question and
// purpose neither pursue a private person nor name a GDPR article 9 category (a watch would ask about it again and
// again). Checked when the watch is set and before every pass; null when the case is not part of a person case.
export function frameRefusal(dir) {
  const root = personRoot(dir)
  if (!root) return null
  const home = path.dirname(dir), rootProps = readNote(path.join(home, root.slug, 'Case.md')).props, own = readNote(path.join(dir, 'Case.md')).props
  if (!String(rootProps.purpose ?? '').trim()) return `the person case ${root.slug} has no purpose in its frame: a watch asks again for what the purpose weighs, so it needs one`
  for (const p of [rootProps, own]) if ((p === rootProps || p.person === true) && !String(p.legal_basis ?? '').trim()) return `${p === rootProps ? root.slug : path.basename(dir)} has no legal basis in its frame: a person is watched only within it`
  for (const p of [rootProps, own]) {
    const said = [p.question, p.purpose, p.scope].filter(Boolean).join('\n'), chase = pursuitHit(said), hit = sensitiveHit({ text: said, ignore: [root.name] })
    if (chase) return `the frame says « ${chase} »: a case is never watched to find, contact or follow a private person`
    if (hit) return `the frame touches ${CATEGORIES[hit.category].label} data (GDPR article 9): a watch never asks about it again`
  }
  return null
}

// a case's watch on (or its period changed) or off. The next pass comes a period after the last one, or after now
export function setWatch(home, slug, every, { now = clock(), by = process.env.OSINT_BY || 'agent', yes = false } = {}) {
  const dir = caseDir(home, slug), was = readCase(dir).watch ?? null
  if (every === 'off') {
    if (!was) return null
    updateCase(dir, c => { c.watch = null })
    disarm(home, slug)
    emit(dir, { kind: 'log', text: 'watch off', by, journal: journal(dir, 'watch', 'off') })
    return null
  }
  if (!PERIODS[every]) fail(`--every ${Object.keys(PERIODS).join('|')}|off`)
  const m = getType(readCase(dir).type, home), steps = watchSteps(m)
  // a watch is the user's own act on this machine: what it covers is kept in watch-ok.js (outside the folder, which
  // anyone may have written), and nothing a case.json says starts a pass without it. A private type's engine.js would
  // run without the agent, at every pass: whatever its manifest says (watch: true), only on the user's yes (their own
  // code to read first), and only for the code that yes covered
  if (was?.every === every && isArmed(home, slug, m.id) && (!m.private || approvedHash(home, m.id) === typeDigest(m))) return was
  if (!steps.length) fail(`a ${m.id} case has nothing the watch may run: it runs the refresh's engine steps declared watch: true that are not noisy, send no image and cost nothing`)
  const refusal = frameRefusal(dir)
  if (refusal) fail(`not watched: ${refusal}`)
  if (m.private && !yes) fail(`the private type ${m.id} runs its engine.js without the agent at each pass of the watch (${steps.map(s => s.id).join(', ')}): the user's yes (it is their own code to read first), then --yes`, 2)
  const w = { every, last: was?.last ?? null, next: nextAt(was?.last ?? null, every, now), error: null }
  if (m.private) approveType(home, m)
  arm(home, slug, m.id)
  updateCase(dir, c => { c.watch = w })
  emit(dir, { kind: 'log', text: `watch every ${every}`, by, journal: journal(dir, 'watch', `every ${every}: ${steps.map(s => s.id).join(', ')} — next pass ${when(w.next)}`) })
  return w
}

// the watched cases, with the last pass's result (the last refresh by the watch)
export const watchedCases = home => listCases(home).flatMap(slug => {
  const c = readCase(path.join(home, slug))
  return c.watch ? [{ slug, type: c.type, ...c.watch, armed: isArmed(home, slug, c.type), result: (c.refreshes ?? []).findLast(r => r.by === 'watch') ?? null }] : []
})
// the cases whose pass is due, the oldest first; none while the folder's switch is off
// (a watch found in a folder that this machine's user did not arm is not run: watch-ok.js)
export const dueCases = (home, now = clock()) => (settings(home).watch.on
  ? watchedCases(home).filter(w => w.armed && Date.parse(w.next) <= now).sort((a, b) => a.next.localeCompare(b.next))
  : [])
// a watched case keeps the dashboard server running after its agents have quit (§ 12.1)
export const keepsServer = home => settings(home).watch.on && watchedCases(home).some(w => w.armed)

// One round of the watch: each case that is due gets one pass, one after another in this one process, so that net.js's
// gap between two calls to a host holds from one case to the next. A case late by several periods (the server was off,
// the machine slept) gets one pass for all of them; its next pass is a period after this one, whatever this one gave:
// a pass that breaks is noted, not tried again each minute. Everything a pass does is `by: watch`.
export async function runDue(home) {
  process.env.OSINT_BY = 'watch'
  const passes = []
  for (const w of dueCases(home)) {
    const dir = path.join(home, w.slug), t = clock(), P = PERIODS[w.every]
    const pass = { slug: w.slug, added: 0, removed: 0, changed: 0, text: null, error: null }
    // the pass is claimed first, under the case's lock: its next pass is set at once, so that a second `watch --due`
    // (the agent's, while the server's runs) finds nothing due and never runs the case twice; a case removed meanwhile is skipped
    try { if (!updateCase(dir, c => { if (!c.watch || Date.parse(c.watch.next) > t) return false; c.watch = { ...c.watch, last: new Date(t).toISOString(), next: new Date(t + P).toISOString() }; return true })) continue } catch { continue }
    try {
      const refusal = frameRefusal(dir)
      if (refusal) throw new Error(`not watched any more: ${refusal}`)
      const missed = Math.floor((t - Date.parse(w.next)) / P) + 1
      if (missed > 1) journal(dir, 'watch', `${missed} passes were due since ${when(w.next)} (the server was off): one pass for them`)
      const at = (() => { try { return fs.statSync(eventsFile(dir)).size } catch { return 0 } })()
      const m = getType(w.type, home), ok = m.private ? approvedHash(home, m.id) : null
      if (m.private && ok !== typeDigest(m)) throw new Error(`the private type ${m.id} ${ok ? 'changed since the user\'s yes' : 'was never given the user\'s yes'} on this machine: it does not run unattended until then (osint.mjs watch --every ${w.every} -p ${w.slug} --yes, after reading its engine.js)`)
      const r = await refresh(home, w.slug, { watch: true }), real = r.diffs.filter(d => !d.first)
      for (const k of ['added', 'removed', 'changed']) pass[k] = real.reduce((n, d) => n + d[k].length, 0)
      pass.text = watchText(readNote(path.join(dir, 'Case.md')).props.input, real, m.refresh)
      // a step that failed is said in the pass's error (a type's command may fail one step and go on: the case's feed has it)
      const failed = [...new Set(readFrom(dir, at).events.filter(x => x.ev.kind === 'fail').map(x => String(x.ev.text).replace(/^watch pass /, '')))]
      // (the engine's own line for a command that threw is the end of the refresh's line about its step: said once)
      const said = failed.filter(a => !failed.some(b => b !== a && b.endsWith(`: ${a}`)))
      if (said.length) pass.error = said.join(' ; ')
    } catch (e) {
      pass.error = e.message
      try { emit(dir, { kind: 'fail', text: `watch pass: ${e.message}`, journal: journal(dir, 'fail', `watch pass: ${e.message}`) }) } catch {}
    }
    // a case removed meanwhile has no case.json to update
    try { updateCase(dir, c => { if (c.watch) c.watch = { ...c.watch, error: pass.error } }) } catch {}
    passes.push(pass)
  }
  return { passes }
}

// doctor's line (§ 9): « 2 cases (acme-fr every 24h, next 06:00) · notifications on », the soonest pass in brackets;
// what keeps a click from opening the case, and a missing server, said after
export function watchLine(home, { up = false, hint = null } = {}) {
  const s = settings(home).watch, every = watchedCases(home), all = every.filter(w => w.armed), many = all.length > 1
  const loose = every.length - all.length, note = loose ? ` · ${loose} watch${loose > 1 ? 'es' : ''} found in the folder, not set on this machine (watch --every … arms it)` : ''
  if (!all.length) return `no case watched${note}`
  const n = `${all.length} case${many ? 's' : ''}`
  if (!s.on) return `paused — ${n} keep${many ? '' : 's'} ${many ? 'their' : 'its'} period; watch --resume (or Settings) turns it back on${note}`
  const soon = [...all].sort((a, b) => a.next.localeCompare(b.next))[0]
  const notes = s.notify ? `notifications on${hint ? ` (${hint})` : ''}` : 'notifications off'
  return `${n} (${soon.slug} every ${soon.every}, next ${when(soon.next)}) · ${notes}${up ? '' : ' · no dashboard server runs them: osint.mjs dashboard starts it'}${note}`
}
