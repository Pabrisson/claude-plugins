// ElevenLabs' real API, free calls only (no speech is made): its model list against what the tools name and what the
// engine sends; the account's voices. ELEVEN_LIVE=1 ELEVENLABS_API_KEY=… node --test test/elevenlabs-live.test.js
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import elevenlabs from '../providers/elevenlabs.js'

const live = process.env.ELEVEN_LIVE === '1' && !!process.env.ELEVENLABS_API_KEY
const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

test('ElevenLabs live: every model a tool names is one it speaks with, its options the API\'s; nothing spent', { skip: !live && 'ELEVEN_LIVE=1 and ELEVENLABS_API_KEY' }, async () => {
  const get = async route => (await fetch(`https://api.elevenlabs.io${route}`, { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } })).json()
  const before = await get('/v1/user/subscription')
  const models = await elevenlabs.models('speech'), ids = models.map(m => m.model)
  const named = JSON.parse(fs.readFileSync(path.join(dir, 'tools', 'audio.json'), 'utf8')).flatMap(t => [...(t.models ?? []), ...(t.also ?? []), ...(t.kie?.models ?? []), ...(t.kie?.also ?? [])]).filter(x => /^eleven_/.test(x))
  for (const id of named) assert.ok(ids.includes(id), `${id} is not one of ElevenLabs' speech models`)
  // the dialogue models, and every option a key of the voice settings, the dialogue's or the request's
  const keys = new Set(['stability', 'similarity_boost', 'style', 'speed', 'use_speaker_boost', 'language_code', 'apply_text_normalization'])
  for (const m of models) for (const o of m.params.options) assert.ok(keys.has(o.key), `${m.model}: ${o.key}`)
  for (const id of ['eleven_v4', 'eleven_v3']) assert.ok(models.find(m => m.model === id)?.params.dialogue, `${id} speaks dialogues`)
  assert.ok(!models.find(m => m.model === 'eleven_v4').params.options.some(o => ['speed', 'style'].includes(o.key)), 'v4 takes no speed, no style')
  // the engine's copy (for a key without models_read) in step with the list: its models, their rates and lengths
  const copy = JSON.parse(fs.readFileSync(path.join(dir, 'providers', 'elevenlabs-models.json'), 'utf8')).models
  const now = (await get('/v1/models')).filter(m => m.can_do_text_to_speech)
  assert.deepEqual(copy.map(m => [m.model_id, m.model_rates.character_cost_multiplier, m.maximum_text_length_per_request, m.can_use_style, m.can_use_speaker_boost]),
    now.map(m => [m.model_id, m.model_rates.character_cost_multiplier, m.maximum_text_length_per_request, m.can_use_style, m.can_use_speaker_boost]), 'providers/elevenlabs-models.json is behind: write it again from GET /v1/models')
  // the account's voices (the pickers' list)
  assert.ok((await get('/v2/voices?page_size=5')).voices.length > 0)
  assert.equal((await get('/v1/user/subscription')).character_count, before.character_count, 'nothing spent')
})
