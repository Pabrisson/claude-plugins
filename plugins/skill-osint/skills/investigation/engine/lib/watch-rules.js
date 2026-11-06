// lib/watch-rules.js — the watch's rules (spec § 12.1), shared by the engine and the dashboard. Pure.
const HOUR = 3600e3
// the periods a case can be watched at, and their chips (each chip carries an icon)
export const PERIODS = { '6h': 6 * HOUR, '12h': 12 * HOUR, '24h': 24 * HOUR, '7d': 7 * 24 * HOUR }
export const EVERY = [
  { value: '6h', label: '6h', icon: 'clock-3' }, { value: '12h', label: '12h', icon: 'clock-6' },
  { value: '24h', label: '24h', icon: 'calendar-clock' }, { value: '7d', label: '7d', icon: 'calendar-days' },
]
// A refresh step the watch runs: an engine step its manifest declares passive with `watch: true`, and never a noisy
// one, one that sends an image or one that costs, whatever the manifest says. Opt-in: a step nobody declared (a
// private type, a flag forgotten) is never run by itself, and a step that needs the user's yes never is.
export const watchable = s => s?.by === 'engine' && s.watch === true && !s.noisy && !s.sends_image && !s.paid
export const watchSteps = manifest => (manifest?.refresh ?? []).filter(watchable)
// the next pass: a period after the last one (after now for a first one), never before now
export const nextAt = (last, every, now) => new Date(Math.max(now, (last ? Date.parse(last) : now) + PERIODS[every])).toISOString()

// what a pass found, for the desktop notification: « acme.fr: 3 new certificates, 1 DNS record changed »; null when
// nothing changed. A step's `noun` ([one, many]) names the items of the snapshot that has its id
export function watchText(input, diffs, steps = []) {
  const noun = (name, n) => {
    const s = steps.find(x => x.id === name)?.noun
    return s ? s[n === 1 ? 0 : 1] : `${name} item${n === 1 ? '' : 's'}`
  }
  const parts = []
  for (const d of diffs) {
    if (d.first) continue
    if (d.added.length) parts.push(`${d.added.length} new ${noun(d.name, d.added.length)}`)
    if (d.removed.length) parts.push(`${d.removed.length} ${noun(d.name, d.removed.length)} gone`)
    if (d.changed.length) parts.push(`${d.changed.length} ${noun(d.name, d.changed.length)} changed`)
  }
  if (!parts.length) return null
  return `${input}: ${parts.slice(0, 3).join(', ')}${parts.length > 3 ? `, ${parts.length - 3} more` : ''}`
}
