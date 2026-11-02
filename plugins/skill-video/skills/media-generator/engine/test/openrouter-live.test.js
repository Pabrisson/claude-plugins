// OpenRouter's real API, free calls only (its model routes): every setting a listed model takes is sent or left out
// with its reason, and its provider's settings go under its slug. OR_LIVE=1 node --test test/openrouter-live.test.js
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { OPTIONS, SKIP } from '../lib/options.js'

const live = process.env.OR_LIVE === '1'
const list = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'providers', 'openrouter-models.json'), 'utf8'))
const get = async route => (await (await fetch(`https://openrouter.ai/api/v1${route}`)).json())
const keyOf = o => (typeof o === 'string' ? o : o.key)

test('OpenRouter live: each listed model\'s settings sent or left out with a reason, under its provider\'s slug', { skip: !live && 'OR_LIVE=1', timeout: 120e3 }, async () => {
  const videos = (await get('/videos/models')).data
  for (const m of list.video) {
    const api = videos.find(x => x.id === m.id)
    if (!api) continue
    const pass = api.allowed_passthrough_parameters ?? [], own = (m.options ?? []).map(keyOf)
    for (const k of own) assert.ok(pass.includes(k) && (OPTIONS[k] || typeof m.options.find(o => keyOf(o) === k) === 'object'), `${m.id}: option ${k} is not one it takes`)
    // its driving sound goes under its own name (Wan 2.7's audio)
    assert.deepEqual(pass.filter(k => !own.includes(k) && k !== m.audio_param && !m.skip?.[k] && !SKIP[k]), [], `${m.id}: settings neither sent nor skipped`)
    if (pass.length) assert.equal(m.slug, (await get(`/models/${m.id}/endpoints`)).data.endpoints[0].tag, `${m.id}: its provider's slug`)
  }
  // an image's settings: the shared ones, its options, a format it has alone; the rest said
  const images = (await get('/images/models')).data, shared = ['resolution', 'aspect_ratio', 'n', 'input_references', 'seed', 'quality', 'background']
  for (const m of list.image) {
    const sp = images.find(x => x.id === m.id)?.supported_parameters
    if (!sp) continue
    const own = (m.options ?? []).map(keyOf), single = sp.output_format?.values?.length === 1 ? ['output_format'] : []
    assert.deepEqual(Object.keys(sp).filter(k => !shared.includes(k) && !own.includes(k) && !single.includes(k) && !SKIP[k]), [], `${m.id}: settings neither sent nor skipped`)
  }
  // speech models list no setting of their own (2026-10-31): one that appears is to wire
  const speech = (await get('/models?output_modalities=speech')).data
  for (const m of list.speech) assert.deepEqual(speech.find(x => x.id === m.id)?.supported_parameters ?? [], [], `${m.id}: a setting to wire`)
})
