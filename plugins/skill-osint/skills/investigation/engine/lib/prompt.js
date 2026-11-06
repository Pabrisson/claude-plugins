// lib/prompt.js — the prompts the dashboard copies for the agent (SKILL.md reads them back). Pure.
const oneLine = s => String(s ?? '').replace(/\s*\n\s*/g, ' ').trim()
export function formatPrompt(scope, items = []) {
  const head = scope.start ? `osint case ${scope.start}: start` : scope.slug ? `osint follow-up (case ${scope.slug})` : 'osint (all cases)'
  return [head, ...items.map((it, i) => `${i + 1}. [${it.tag}] ${oneLine(it.text)}`)].join('\n')
}
export const fillPrompt = (template, vars = {}) => String(template).replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m)
export function itemOf(prompt, vars = {}) {
  const s = fillPrompt(prompt, vars), m = /^\[([^\]]+)\]\s*([\s\S]*)$/.exec(s)
  return m ? { tag: m[1], text: m[2] } : { tag: 'question', text: s }
}
// a type takes an entity when one of its pivots names the entity's kind, and the property it asks for is there
const takes = (p, e) => (typeof p === 'string' ? p === e.kind : p?.kind === e.kind && e.props?.[p.has] != null && e.props[p.has] !== '')
/** @returns {{ type: string, label: string, icon: string, item: { tag: string, text: string } }[]} */
export const pivotsFor = (entity, types) => types.filter(t => (t.pivots ?? []).some(p => takes(p, entity))).map(t => ({
  type: t.id, label: `New ${t.label} case on ${entity.value}`, icon: t.icon, item: { tag: `pivot:${t.id}`, text: `${entity.value} — from ${entity.path}` },
}))
/** @returns {{ id: string, label: string, icon: string, target: string, prompt: string, noisy: boolean, minutes: number }[]} */
export const actionsFor = (manifest, target) => manifest.actions.filter(a => a.target === target)
