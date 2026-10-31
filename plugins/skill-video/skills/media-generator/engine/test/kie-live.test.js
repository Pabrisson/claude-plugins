// Kie's real API, free calls only (no task is ever created): the shipped list against Kie's model names, its docs and
// its price API, the catalog's prices too; the key and the balance; an upload. KIE_LIVE=1 KIE_API_KEY=… node --test test/kie-live.test.js
// (the balance is read before and after: it must not move)
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import kie, { CATALOG_PRICES, fromSpec, readSpec } from '../providers/kie.js'
import { SKIP } from '../lib/options.js'

const live = process.env.KIE_LIVE === '1' && !!process.env.KIE_API_KEY
const list = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'providers', 'kie-models.json'), 'utf8'))
const all = ['image', 'video', 'speech'].flatMap(k => list[k].map(m => ({ ...m, kind: k })))
const names = m => (typeof m.kie === 'string' ? [m.kie] : Object.values(m.kie).map(v => v.model ?? v))
const key = f => f.replace(/\[\]$/, '')
// the fields a mode names its own way (Wan 2.7: audio_url, driving_audio_url, reference_voice)
const modeFields = m => Object.values(typeof m.kie === 'object' ? m.kie : {}).flatMap(v => Object.values(v.fields ?? {}))

test('Kie live: the shipped list against Kie\'s names, docs and prices; nothing spent', { skip: !live && 'KIE_LIVE=1 and KIE_API_KEY', timeout: 300e3 }, async () => {
  const before = await kie.balance()
  assert.ok(before.credits >= 0)

  // every model name is one Kie runs
  const paths = new Set((await (await fetch('https://api.kie.ai/api/v1/playground/model-paths')).json()).data)
  for (const m of all) for (const n of names(m)) assert.ok(paths.has(n), `${m.id}: ${n} is not one of Kie's models`)

  // every input key the list sends is one the model's docs page has, every value it sends one the page allows
  const index = await (await fetch('https://docs.kie.ai/llms.txt')).text()
  const pages = [...new Set(index.match(/https:\/\/docs\.kie\.ai\/(?:market|veo3-api|runway-api)\/[^\s)]+\.md/g))]
  const specs = {}
  for (const u of pages) {
    const s = readSpec(await (await fetch(u)).text())
    for (const n of s?.models ?? []) specs[n] ??= s
  }
  for (const m of all) {
    // a key is sent in the modes that take it (a text-to-image model has no images): one of its models has it
    const known = new Set(names(m).flatMap(n => Object.keys(specs[n]?.props ?? {})))
    if (known.size) {
      for (const f of [...Object.values(m.fields ?? {}), ...modeFields(m)]) assert.ok(known.has(key(f)), `${m.id}: no input ${key(f)} in its docs`)
      for (const k of Object.keys(m.set ?? {})) assert.ok(known.has(k), `${m.id}: no input ${k} to set`)
      if (m.elements) assert.ok(known.has(m.elements.key), `${m.id}: no input ${m.elements.key} for its Elements`)
      for (const o of m.options ?? []) { const k = typeof o === 'string' ? o : o.covers ?? o.key; assert.ok(known.has(k), `${m.id}: no input ${k} for its option`) }
    }
  }
  // every input its docs list is sent (a field, a constant, an option, an editor) or left out with its reason: what the
  // dashboard does not show is said, never forgotten (the docs' own YAML noise apart: apidog's keys, nested schemas)
  const noise = k => /^(required|properties|x-apidog.*)$/.test(k) || /^0[0-9A-Z]{25}$/.test(k)
  for (const m of all) {
    const sent = new Set([...Object.values(m.fields ?? {}).map(key), ...modeFields(m).map(key), ...Object.keys(m.set ?? {}), m.elements?.key, m.shots?.key, m.shots?.flag, m.mid_frames?.key, m.masks?.key, m.named_voices?.key,
      ...(m.dialogue === 'gemini' ? ['speakers', 'dialogue_turns'] : []), ...(m.options ?? []).map(o => (typeof o === 'string' ? o : o.covers ?? o.key))].filter(Boolean))
    for (const v of Object.values(typeof m.kie === 'object' ? m.kie : {})) for (const k of Object.keys(v.set ?? {})) sent.add(k)
    const left = [...new Set(names(m).flatMap(n => Object.keys(specs[n]?.props ?? {})))].filter(k => !noise(k) && !sent.has(k) && !m.skip?.[k] && !SKIP[k])
    assert.deepEqual(left, [], `${m.id}: inputs of its docs neither sent nor skipped with a reason`)
  }
  // a value is allowed by one of its models at least (Grok Image's auto ratio only with an image: its note says so)
  for (const m of all) {
    const sent = (name, v) => { const r = m.values?.[name]; return r && typeof r === 'object' ? (r[v] ?? v) : r === 'string' ? String(v) : v }
    for (const [name, values] of [['resolution', m.resolutions], ['aspect_ratio', m.aspect_ratios]]) {
      const k = m.fields?.[name] && key(m.fields[name]), allowed = k && names(m).flatMap(n => specs[n]?.props[k]?.enum ?? [])
      if (allowed?.length && values) for (const v of values) assert.ok(allowed.includes(String(sent(name, v))), `${m.id}: ${name} ${v} → ${sent(name, v)} not in ${allowed}`)
    }
  }

  // every price row is one the price API gives
  const rows = new Set()
  for (let page = 1, pages = 1; page <= pages; page++) {
    const j = await (await fetch('https://api.kie.ai/client/v1/model-pricing/page', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageNum: page, pageSize: 100, modelDescription: '', interfaceType: '' }) })).json()
    pages = j.data.pages
    for (const r of j.data.records) rows.add(r.modelDescription)
  }
  for (const m of all) for (const r of m.price ?? []) for (const d of [r.row].flat()) assert.ok(rows.has(d), `${m.id}: no price row « ${d} »`)
  // the models the catalog adds (Kie's names beyond the list, with a docs page): each priced by kie-catalog-prices.json on
  // rows the price API gives, or said to have none
  for (const [id, rules] of Object.entries(CATALOG_PRICES.models)) for (const r of rules) for (const d of [r.row].flat()) assert.ok(rows.has(d), `${id}: no price row « ${d} »`)
  const hand = new Set(all.flatMap(names))
  const unpriced = [...paths].filter(n => !hand.has(n) && !n.startsWith('elevenlabs/') && specs[n] && fromSpec(n, specs[n]) && !CATALOG_PRICES.models[n] && !CATALOG_PRICES.none[n])
  assert.deepEqual(unpriced, [], 'models of the catalog without their prices in kie-catalog-prices.json')

  // an upload is free and comes back
  const url = await kie.upload(`data:image/png;base64,${Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64')}`)
  assert.equal((await fetch(url)).status, 200)

  assert.equal((await kie.balance()).credits, before.credits, 'nothing spent')
})
