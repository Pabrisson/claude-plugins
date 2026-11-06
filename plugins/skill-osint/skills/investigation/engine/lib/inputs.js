// lib/inputs.js — a case type's form (type.json `inputs`): which fields show (`when`) and the values the engine takes.
// Pure: the dashboard imports it to hide what does not apply and to send only what does.
const asStrings = v => [].concat(v).map(String)
export const shown = (input, values) => !input.when || Object.entries(input.when).every(([k, want]) => asStrings(want).includes(String(values[k])))
export const defaults = manifest => Object.fromEntries(manifest.inputs.filter(i => i.default !== undefined).map(i => [i.id, i.default]))
export const mainInput = manifest => manifest.inputs.find(i => i.required) ?? manifest.inputs[0]
const whenText = when => Object.entries(when).map(([k, v]) => `${k}=${asStrings(v).join('|')}`).join(' and ')
export function checkInputs(manifest, given) {
  for (const k of Object.keys(given)) if (!manifest.inputs.some(i => i.id === k)) return { error: `unknown input ${k} (the ${manifest.id} type takes ${manifest.inputs.map(i => i.id).join(', ')})` }
  const all = { ...defaults(manifest), ...given }, values = {}
  for (const i of manifest.inputs) {
    let v = given[i.id]
    if (!shown(i, all)) { if (v != null && v !== '') return { error: `--in ${i.id} only goes with ${whenText(i.when)}` }; continue }
    if (v == null || v === '') v = i.default
    if (v == null || v === '') { if (i.required) return { error: `missing input ${i.id} (${i.label})` }; continue }
    if (i.kind === 'toggle') v = v === true || v === 'true'
    else if (['select', 'chips'].includes(i.kind)) {
      const ok = x => i.options.some(o => o.value === x), list = i.options.map(o => o.value).join(', ')
      if (i.multiple) {
        // a list: from the form an array, from the command line a,b (the server joins an array the same way)
        const vs = [...new Set((Array.isArray(v) ? v : String(v).split(',')).map(x => String(x).trim()).filter(Boolean))]
        if (!vs.length) return { error: `--in ${i.id}: at least one of ${list}` }
        const bad = vs.filter(x => !ok(x))
        if (bad.length) return { error: `--in ${i.id}=${bad.join(',')}: one or more of ${list}` }
        v = vs
      } else if (!ok(v)) return { error: `--in ${i.id}=${v}: one of ${list}` }
    }
    else if (i.kind === 'url' && !/^https?:\/\/\S+$/i.test(v)) return { error: `--in ${i.id}: an http(s) URL` }
    else v = String(v).trim()
    values[i.id] = v
  }
  return { values }
}
// the GDPR bases the New case form offers, and a basis written as "<base> — <detail>" split back for it
export const LEGAL_BASES = ['Consent', 'Legitimate interest', 'Legal obligation', 'Public interest', 'Journalism or research']
export function basisParts(text) {
  const s = String(text ?? '').trim(), [head, ...rest] = s.split(/\s+—\s+/)
  const base = LEGAL_BASES.find(b => b.toLowerCase() === head.toLowerCase()) ?? null
  return base ? { base, detail: rest.join(' — ') } : { base: null, detail: s }
}
