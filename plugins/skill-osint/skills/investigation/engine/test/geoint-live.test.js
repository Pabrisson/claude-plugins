// OSINT_LIVE=1 node --test test/geoint-live.test.js — the real GeoINT pack (setup geoint done, after the user's yes) on a
// public photo of a known place, with its EXIF, its network through the logging proxy: no Google AI host reached, a
// sound first pass. It downloads the photo, runs the local models and sends this public photo to Yandex and Baidu.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { DENY } from '../lib/net.js'
import { packReady } from '../lib/python.js'
import { casesFolder, json, read, run } from './helpers.js'
import { startProxy } from './proxy.mjs'

const UA = 'skill-osint/1.1.0 (+https://github.com/Pabrisson/claude-plugins)'
// the Commons original of the tests' photo, EXIF included (Dudva, CC BY-SA 4.0)
const PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/5/55/Roman_Temple_of_%C3%89vora_1.jpg'

test('live: recon on a public photo of the Roman temple of Évora with the real pack, through the logging proxy', { skip: !process.env.OSINT_LIVE, timeout: 3600e3 }, async () => {
  assert.ok(packReady(), 'the GeoINT pack is not set up: osint.mjs setup geoint (asks the user first)')
  const home = casesFolder(), log = path.join(home, 'hosts.jsonl'), proxy = await startProxy({ log })
  try {
    const photo = path.join(home, 'evora.jpg'), r0 = await fetch(PHOTO, { headers: { 'user-agent': UA } })
    assert.equal(r0.status, 200)
    fs.writeFileSync(photo, Buffer.from(await r0.arrayBuffer()))
    const env = { GEO_PROXY: proxy.url, HTTPS_PROXY: proxy.url, GEMINI_API_KEY: 'AIza-live-test-not-a-key', GOOGLE_API_KEY: 'AIza-live-test-not-a-key' }
    assert.equal((await run(home, ['new', 'geolocate-image', '--file', photo, '--question', 'Where was this photo taken?', '--frame', 'image_may_leave=true', '--frame', 'noisy=never'], env)).status, 0)
    const dir = path.join(home, 'evora'), P = ['-p', 'evora'], gut = path.join(home, 'gut.json')
    fs.writeFileSync(gut, JSON.stringify({ ranked: [{ place: 'Portugal', p: 50, cues: 'granite podium, Corinthian columns' }, { place: 'Spain', p: 30, cues: 'Roman ruins' }], would_change: 'a Spanish sign' }))
    assert.equal((await run(home, ['geolocate-image', 'gut', '--file', gut, ...P], env)).status, 0)
    const r = await run(home, ['geolocate-image', 'recon', '--no-people', ...P], env)
    assert.equal(r.status, 0, r.err)
    const hosts = fs.readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l))
    assert.deepEqual(hosts.filter(h => DENY.has(h.host)), [])
    assert.ok(hosts.some(h => /yandex/.test(h.host)), 'Yandex reached through the proxy')
    const g = path.join(dir, '.osint', 'geoint'), steps = JSON.parse(fs.readFileSync(path.join(g, 'recon', 'recon.json'), 'utf8')).steps
    assert.deepEqual(Object.entries(steps).filter(([, v]) => v.rc !== 0).map(([k, v]) => `${k}: ${v.error}`), [])
    const prior = JSON.parse(fs.readFileSync(path.join(g, 'recon', 'prior', 'prior.json'), 'utf8'))
    assert.ok(prior.combined.slice(0, 3).some(c => c.iso2 === 'PT'), JSON.stringify(prior.combined.slice(0, 5)))
    assert.ok(json(dir, '.osint/case.json').state['geolocate-image'].countries.PT)
    if (fs.existsSync(path.join(g, 'compare', 'compare.json'))) assert.equal(JSON.parse(fs.readFileSync(path.join(g, 'compare', 'compare.json'), 'utf8')).no_check, true)
    assert.match(read(dir, 'Report.md'), /EXIF GPS 38\.57279/)
  } finally { proxy.close() }
})
