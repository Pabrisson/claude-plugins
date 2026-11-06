import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { ranking } from '../lib/cycle.js'
import { startServer } from '../lib/server.js'
import { fakeEnv, startFake } from './fake.mjs'
import { getType, loadTypes, validateEngine, validateManifest } from '../lib/types.js'
import { readNote } from '../lib/vault.js'
import { casesFolder, ENGINE, events, FIXTURES, geoEnvFor, hasFfmpeg, json, PATHX, read, run, uvCalls } from './helpers.js'

const TEMPLE = path.join(FIXTURES, 'images', 'evora-temple.jpg'), P = ['-p', 'evora-temple'], skip = process.platform === 'win32'
const GEO = ['new', 'geolocate-image', '--question', 'Where was this taken?', '--frame', 'image_may_leave=true', '--frame', 'noisy=never']
const GUT = { ranked: [{ place: 'Portugal', p: 55, cues: 'granite, Corinthian columns, dry light' }, { place: 'Spain', p: 25, cues: 'Roman ruins' }, { place: 'Italy', p: 15, cues: 'a Roman temple' }], region: 'Alentejo', would_change: 'a Spanish plate or sign' }
const file = (home, name, v) => { const f = path.join(home, name); fs.writeFileSync(f, JSON.stringify(v)); return f }
export async function geoCase(env, extra = []) {
  const home = casesFolder(), e = { ...geoEnvFor(home), ...env }
  const r = await run(home, [...GEO, '--file', TEMPLE, ...extra], e)
  assert.equal(r.status, 0, r.err)
  return { home, env: e, dir: path.join(home, 'evora-temple') }
}
export const withGut = async (home, env) => assert.equal((await run(home, ['geolocate-image', 'gut', '--file', file(home, 'gut.json', GUT), ...P], env)).status, 0)

test('the geolocate-image type is sound; status names the pack and its references', { skip }, async () => {
  const t = loadTypes().find(x => x.id === 'geolocate-image')
  assert.deepEqual(validateManifest(t), [])
  assert.deepEqual(await validateEngine(t), [])
  const { home, env } = await geoCase()
  assert.match((await run(home, ['status', ...P], env)).out, /^references: .*geoint.*references$/m)
  assert.match((await run(home, ['status', ...P], { ...env, OSINT_DATA: path.join(home, 'none') })).out, /pack geoint: not set up \(osint\.mjs setup geoint\)/)
})

test('gut: written once and before any tool, kept for the calibration; a malformed gut call is refused', { skip }, async () => {
  const { home, env, dir } = await geoCase()
  const early = await run(home, ['geolocate-image', 'map', 'add', 'place', '--at', '38.5,-7.9', ...P], env)
  assert.equal(early.status, 0, early.err)
  const g = await run(home, ['geolocate-image', 'gut', '--file', file(home, 'gut.json', GUT), ...P], env)
  assert.equal(g.status, 0, g.err)
  assert.match(read(dir, 'Report.md'), /## Gut call \(before tools\)\n\n1\. \*\*Portugal\*\* 55 % — granite[\s\S]*Would change my mind — a Spanish plate or sign/)
  assert.deepEqual(json(dir, '.osint/views/calibration.json').gut.ranked.map(r => r.place), ['Portugal', 'Spain', 'Italy'])
  assert.match((await run(home, ['geolocate-image', 'gut', '--file', file(home, 'gut.json', GUT), ...P], env)).err, /already written/)
  for (const bad of [{ ranked: [] }, { ranked: [{ place: 'A', p: 80 }, { place: 'B', p: 40 }], would_change: 'x' }, { ranked: [{ place: 'A', p: 50 }] }]) {
    const { home: h2, env: e2 } = await geoCase()
    assert.equal((await run(h2, ['geolocate-image', 'gut', '--file', file(h2, 'g.json', bad), ...P], e2)).status, 1, JSON.stringify(bad))
  }
})

test('intake: an image needs nothing; a Street View capture asks the agent to read its date and compass', { skip }, async () => {
  const a = await geoCase()
  assert.equal((await run(a.home, ['geolocate-image', 'intake', ...P], a.env)).status, 0)
  assert.match(read(a.dir, 'Journal.md'), /nothing to extract/)
  const home = casesFolder(), env = geoEnvFor(home)
  assert.equal((await run(home, [...GEO, '--in', 'source=streetview', '--file', TEMPLE, '--title', 'sv'], env)).status, 0)
  assert.equal((await run(home, ['geolocate-image', 'intake', '-p', 'sv'], env)).status, 0)
  assert.match(read(path.join(home, 'sv'), 'Journal.md'), /read its capture date and its compass/)
})

test('intake: a video gets its key frames; a video by link is downloaded, its page kept as a source', { skip: skip || !hasFfmpeg }, async () => {
  const home = casesFolder(), clip = path.join(home, 'walk.mp4')
  spawnSync('ffmpeg', ['-v', 'error', '-y', ...['red', 'blue', 'green', 'white'].flatMap(c => ['-f', 'lavfi', '-i', `color=c=${c}:s=160x120:d=1:r=10`]), '-filter_complex', '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0', '-pix_fmt', 'yuv420p', clip])
  const env = { ...geoEnvFor(home), ...PATHX, OSINT_FAKE_VIDEO: clip }
  assert.equal((await run(home, [...GEO, '--in', 'source=video', '--file', clip], env)).status, 0)
  const r = await run(home, ['geolocate-image', 'intake', '-p', 'walk'], env)
  assert.equal(r.status, 0, r.err)
  assert.equal(json(path.join(home, 'walk'), '.osint/views/evidence.json').items.filter(i => i.kind === 'frame').length, 3)
  assert.equal((await run(home, [...GEO, '--in', 'source=video', '--in', 'video=https://video.example/watch?v=abc', '--title', 'linked'], env)).status, 0)
  const l = await run(home, ['geolocate-image', 'intake', '-p', 'linked'], env)
  assert.equal(l.status, 0, l.err)
  const d = path.join(home, 'linked'), c = json(d, '.osint/case.json')
  assert.deepEqual([c.evidence[0].file, c.state['geolocate-image'].video_source], ['Evidence/E01-fakeid0001.mp4', 'S01'])
  assert.match(fs.readdirSync(path.join(d, 'Clues')).join(), /Posted by example-uploader on 2024-07-16/)
})

test('map add: a sight line by bearing and a candidate with its radius; map clear takes the agent\'s features off, the others stay', { skip }, async () => {
  const { home, env, dir } = await geoCase()
  await withGut(home, env)
  assert.equal((await run(home, ['geolocate-image', 'map', 'add', 'sightline', '--at', '38.5725,-7.9075', '--bearing', '112', '--km', '0.15', '--label', 'cathedral tower', '--ref', 'C04', ...P], env)).status, 0)
  assert.equal((await run(home, ['geolocate-image', 'map', 'add', 'candidate', '--at', '38.5725,-7.9075', '--radius', '80', ...P], env)).status, 0)
  const f = json(dir, '.osint/views/map.json').features.filter(x => x.properties.group === 'agent')
  assert.deepEqual(f.map(x => [x.geometry.type, x.properties.role]), [['LineString', 'sightline'], ['Point', 'candidate']])
  assert.deepEqual([f[0].properties.heading, f[1].properties.radius_m], [112, 80])
  const end = f[0].geometry.coordinates[1]
  assert.ok(end[0] > -7.9075 && end[1] < 38.5725)
  assert.equal((await run(home, ['geolocate-image', 'map', 'add', 'nowhere', '--at', '1,2', ...P], env)).status, 1)
  assert.equal((await run(home, ['geolocate-image', 'map', 'clear', ...P], env)).status, 0)
  assert.equal(json(dir, '.osint/views/map.json').features.filter(x => x.properties.group === 'agent').length, 0)
})

const notesOf = (dir, folder) => fs.readdirSync(path.join(dir, folder)).map(f => readNote(path.join(dir, folder, f)))
const bodies = (dir, status) => notesOf(dir, 'Clues').filter(n => n.props.status === status).map(n => n.body).join('\n')
const scriptCalls = (env, script) => uvCalls(env).filter(c => c.argv.some(a => a.endsWith(script)))

test('recon refuses before the gut call', { skip }, async () => {
  const { home, env } = await geoCase()
  const r = await run(home, ['geolocate-image', 'recon', ...P], env)
  assert.equal(r.status, 1)
  assert.match(r.err, /write the gut call first/)
})

test('recon imports GeoINT\'s first pass: EXIF as inferred clues, text and world prior as model clues on country hypotheses, the camera, the crops, OCR to confirm, Yandex and Baidu as sources; compare ranks with --no-check', { skip }, async () => {
  const { home, env, dir } = await geoCase()
  await withGut(home, env)
  const r = await run(home, ['geolocate-image', 'recon', '--no-people', ...P], env)
  assert.equal(r.status, 0, r.err)
  const [rec] = scriptCalls(env, 'recon.py'), [cmp] = scriptCalls(env, 'compare.py')
  assert.equal(rec.argv.includes('--no-rev'), true) // recon.py keeps the original for its local tools and never sends it
  const [snd] = scriptCalls(env, 'intake.py')
  assert.ok(snd.argv[snd.argv.findIndex(a => a.endsWith('intake.py')) + 1].includes(path.join('.osint', 'cache', 'send')) && !fs.readFileSync(snd.argv[snd.argv.findIndex(a => a.endsWith('intake.py')) + 1]).includes('Exif'), 'what is sent is the copy without EXIF')
  assert.match(read(dir, 'Journal.md'), /Sent to Yandex and Baidu by direct upload \(revimg\.py\), as a copy without its metadata: Evidence\/E01-evora-temple\.jpg/)
  assert.deepEqual(rec.argv.slice(rec.argv.indexOf('--skip'), rec.argv.indexOf('--skip') + 2), ['--skip', 'compare'])
  assert.ok(cmp.argv.includes('--no-check'))
  assert.match(bodies(dir, 'inferred'), /EXIF GPS 38\.5727917, -7\.9076417/)
  assert.match(bodies(dir, 'inferred'), /iPhone SE \(2nd generation\)/)
  assert.match(bodies(dir, 'model'), /Portugal 46 %/)
  assert.match(bodies(dir, 'model'), /language identified as “pt”/)
  assert.match(bodies(dir, 'computed'), /horizontal field of view 55\.96°/)
  const s = json(dir, '.osint/case.json').state['geolocate-image']
  assert.deepEqual(Object.keys(s.countries).sort(), ['AO', 'BR', 'ES', 'FR', 'GR', 'IT', 'PT'])
  assert.equal(s.photo, 'Evidence/E01-evora-temple.jpg')
  const country = ranking(dir, getType('geolocate-image')).ranked.country
  assert.equal(country.reduce((a, b) => (b.share > a.share ? b : a)).id, s.countries.PT)
  assert.match(read(dir, 'Report.md'), /0\.71 \(up\) Largo do Conde de Vila Flor/)
  const sources = fs.readdirSync(path.join(dir, 'Sources'))
  assert.deepEqual([sources.length, sources.some(f => f.includes('Yandex results')), sources.some(f => f.includes('Baidu results'))], [2, true, true])
  const ev = json(dir, '.osint/views/evidence.json').items
  assert.ok(ev.some(i => i.group === 'recon' && i.file === 'Evidence/crops/recon/01_sign.jpg' && i.kind === 'crop'))
  assert.deepEqual(ev.filter(i => i.group === 'compare').map(i => [i.rank, i.site]), [[1, 'pt.wikipedia.org'], [2, 'visitportugal.com'], [3, 'commons.wikimedia.org']])
  assert.ok(fs.existsSync(path.join(dir, 'Evidence', 'crops', 'compare', '001.jpg')))
  assert.deepEqual(json(dir, '.osint/views/map.json').features.filter(f => f.properties.group === 'recon').map(f => f.properties.kind), ['exif', 'prior', 'geoclip', 'geoclip', 'geoclip'])
  assert.equal(json(dir, '.osint/collect/rev/1.json').items.length, 6)
})

test('recon keeps the image on this machine when the frame says so or people may show (--no-rev, the reason in the report); a masked copy is searched instead', { skip }, async () => {
  const a = await geoCase({}, ['--frame', 'image_may_leave=false'])
  await withGut(a.home, a.env)
  assert.equal((await run(a.home, ['geolocate-image', 'recon', ...P], a.env)).status, 0)
  assert.ok(scriptCalls(a.env, 'recon.py')[0].argv.includes('--no-rev'))
  assert.deepEqual([scriptCalls(a.env, 'compare.py').length, scriptCalls(a.env, 'intake.py').length], [0, 0])
  assert.match(read(a.dir, 'Report.md'), /Reverse search skipped: the frame keeps the image on this machine/)
  const b = await geoCase()
  await withGut(b.home, b.env)
  assert.equal((await run(b.home, ['geolocate-image', 'recon', ...P], b.env)).status, 0)
  assert.match(read(b.dir, 'Report.md'), /mask the people first \(evidence mask E01/)
  if (!hasFfmpeg) return
  assert.equal((await run(b.home, ['evidence', 'mask', 'E01', '--box', '10,20,100,50', ...P], b.env)).status, 0)
  assert.equal((await run(b.home, ['geolocate-image', 'recon', ...P], b.env)).status, 0)
  const [intake] = scriptCalls(b.env, 'intake.py')
  assert.ok(intake.argv.some(x => x.endsWith('E02-E01-masked.jpg')) && intake.argv.includes('--no-compare'))
  assert.equal(fs.readdirSync(path.join(b.dir, 'Sources')).length, 2)
})

test('a GeoINT step that fails half-way: recon imports what exists, notes the failure, exits 0; a run again rewrites without duplicates', { skip }, async () => {
  const { home, env, dir } = await geoCase()
  await withGut(home, env)
  const r = await run(home, ['geolocate-image', 'recon', '--no-people', ...P], { ...env, OSINT_FAKE_FAIL: 'recon' })
  assert.equal(r.status, 0, r.err)
  assert.match(read(dir, 'Journal.md'), /· fail · recon\.py .* → exit 1 .*CUDA out of memory/)
  assert.match(read(dir, 'Report.md'), /calib\.py failed: .*CUDA out of memory/)
  assert.match(bodies(dir, 'inferred'), /EXIF GPS/)
  assert.equal(bodies(dir, 'computed'), '')
  const again = await run(home, ['geolocate-image', 'recon', '--no-people', ...P], env)
  assert.equal(again.status, 0, again.err)
  assert.equal((bodies(dir, 'inferred').match(/EXIF GPS 38\.5727917/g) ?? []).length, 1)   // the clue's title heading says EXIF GPS too
  assert.match(bodies(dir, 'computed'), /horizontal field of view/)
  const titles = notesOf(dir, 'Hypotheses').map(n => n.props.id)
  assert.equal(new Set(titles).size, 7)
  assert.doesNotMatch(read(dir, 'Report.md'), /CUDA out of memory/)
})

test('compare without any reverse-search list says so and runs nothing; --query adds a crop as a query', { skip }, async () => {
  const a = await geoCase({}, ['--frame', 'image_may_leave=false'])
  await withGut(a.home, a.env)
  assert.equal((await run(a.home, ['geolocate-image', 'compare', ...P], a.env)).status, 0)
  assert.match(read(a.dir, 'Journal.md'), /No similar image to rank/)
  assert.equal(scriptCalls(a.env, 'compare.py').length, 0)
  const b = await geoCase()
  await withGut(b.home, b.env)
  await run(b.home, ['geolocate-image', 'recon', '--no-people', ...P], b.env)
  assert.equal((await run(b.home, ['geolocate-image', 'compare', '--query', 'Evidence/crops/recon/01_sign.jpg', ...P], b.env)).status, 0)
  const last = scriptCalls(b.env, 'compare.py').at(-1).argv
  assert.deepEqual(last.filter((x, i) => last[i - 1] === '--query').map(x => path.basename(x)), ['E01-evora-temple.jpg', '01_sign.jpg'])
})

test('sweep index reports sweep.py\'s progress; sweep rank puts the best panoramas with their bearing and the clusters on the map', { skip }, async () => {
  const { home, env, dir } = await geoCase()
  await withGut(home, env)
  fs.mkdirSync(path.join(dir, '.osint', 'geoint'), { recursive: true })
  fs.copyFileSync(path.join(FIXTURES, 'geoint', 'pano', 'panoramax.jsonl'), path.join(dir, '.osint', 'geoint', 'town.jsonl'))
  assert.equal((await run(home, ['geolocate-image', 'sweep', 'index', '--manifest', 'town.jsonl', ...P], env)).status, 0)
  assert.deepEqual(events(dir).filter(e => e.kind === 'progress' && e.of === 512).map(e => e.n), [256, 512])
  assert.equal((await run(home, ['geolocate-image', 'sweep', 'rank', '--index', 'town', ...P], env)).status, 0)
  const f = json(dir, '.osint/views/map.json').features.filter(x => x.properties.group === 'sweep:town')
  assert.deepEqual(f.filter(x => x.properties.role === 'pano').map(x => x.properties.heading), [67.5, 45, 202.5])
  assert.deepEqual(f.filter(x => x.properties.kind === 'cluster').map(x => x.properties.radius_m), [38])
  assert.ok(json(dir, '.osint/views/evidence.json').items.some(i => i.file === 'Evidence/crops/sweep/town-top.jpg'))
  assert.match(bodies(dir, 'model'), /Sweep town: 3 panoramas ranked; best panoramax:6c1b3f0e/)
  const none = await run(home, ['geolocate-image', 'sweep', 'index', '--manifest', 'nowhere.jsonl', ...P], env)
  assert.equal(none.status, 1)
  assert.match(none.err, /no manifest nowhere\.jsonl/)
})

async function concludeAt(home, env, slug, at) {
  const p = ['-p', slug]
  const h = JSON.parse((await run(home, ['hyp', 'add', 'The camera point', '--level', 'point', '--point', at, '--radius', '200', '--refute-if', 'the ground-level imagery differs', '--json', ...p], env)).out).id
  const c = JSON.parse((await run(home, ['clue', 'The same façade on the panoramas', '--status', 'observed', '--journal', 'j001', '--json', ...p], env)).out).id
  assert.equal((await run(home, ['hyp', 'lr', h, '--clue', c, '--lr', '4', '--why', 'the same façade', ...p], env)).status, 0)
  assert.equal((await run(home, ['redteam', '--file', file(home, `rt-${slug}.json`, { target: h, outcome: 'survives', refutations: [{ test: 'a twin place?', result: 'none found' }] }), ...p], env)).status, 0)
  const r = await run(home, ['conclude', '--file', file(home, `c-${slug}.json`, { answer: h, confidence: { point: 'medium' }, criteria: { point: 'one ground-level match' }, radius_m: 200, alternatives: [], unresolved: [] }), ...p], env)
  assert.equal(r.status, 0, r.err)
  return h
}

test('run refuses, before running it, a script that would send the picture out when the frame keeps it here or people may show', { skip }, async () => {
  const a = await geoCase({}, ['--frame', 'image_may_leave=false'])
  await withGut(a.home, a.env)
  for (const argv of [['revimg.py', 'E01', '--out-dir', 'rev'], ['intake.py', 'E01', '--out-dir', 'again']]) {
    const r = await run(a.home, ['geolocate-image', 'run', ...argv, ...P], a.env)
    assert.equal(r.status, 1, argv.join(' '))
    assert.match(r.err, /the frame keeps the image on this machine/)
  }
  assert.deepEqual([scriptCalls(a.env, 'revimg.py').length, scriptCalls(a.env, 'intake.py').length], [0, 0])
  assert.equal((await run(a.home, ['geolocate-image', 'run', 'intake.py', 'E01', '--out-dir', 'again', '--no-rev', ...P], a.env)).status, 0)
  const [kept] = scriptCalls(a.env, 'intake.py')
  assert.ok(kept.argv.includes('--no-compare') && kept.argv.includes(path.join(a.dir, 'Evidence', 'E01-evora-temple.jpg')))
  assert.equal((await run(a.home, ['geolocate-image', 'run', 'revimg.py', '--query', 'templo romano', '--out-dir', 'q', ...P], a.env)).status, 0)
  const b = await geoCase()
  await withGut(b.home, b.env)
  const people = await run(b.home, ['geolocate-image', 'run', 'revimg.py', 'E01', '--out-dir', 'rev', ...P], b.env)
  assert.equal(people.status, 1)
  assert.match(people.err, /people may show/)
  const outside = await run(b.home, ['geolocate-image', 'run', 'revimg.py', 'recon/intake/variants/full_crop.jpg', '--out-dir', 'rev', ...P], b.env)
  assert.match(outside.err, /only a file of the case's Evidence folder may leave/)
  const ok = await run(b.home, ['geolocate-image', 'run', 'revimg.py', 'E01', '--out-dir', 'rev', '--no-people', ...P], b.env)
  assert.equal(ok.status, 0, ok.err)
  const [call] = scriptCalls(b.env, 'revimg.py')
  assert.ok(call.argv.some(a => a.includes(path.join('.osint', 'cache', 'send')) && a.endsWith('E01-evora-temple.jpg')) && !call.argv.includes(path.join(b.dir, 'Evidence', 'E01-evora-temple.jpg')) && !call.argv.includes('--no-people'))
  assert.match(read(b.dir, 'Journal.md'), /· step · Sent to Yandex and Baidu .*Evidence\/E01-evora-temple\.jpg/)
  assert.match(read(b.dir, 'Journal.md'), /· people · looked at by the agent, no person: Evidence\/E01-evora-temple\.jpg/)
  for (const [argv, err] of [[['recon.py', 'E01'], /own command: geolocate-image recon/], [['compare.py'], /own command: geolocate-image compare/], [['sweep.py', 'rank', '--index', 't'], /geolocate-image sweep rank/],
    [['clues.py', 'update'], /stays as pinned/], [['triage.py', 'https://x.example', '--check'], /Gemini/], [['_gemini.py'], /a module of the pack/]]) {
    const r = await run(b.home, ['geolocate-image', 'run', ...argv, ...P], b.env)
    assert.equal(r.status, 1, argv.join(' '))
    assert.match(r.err, err)
  }
  const early = await geoCase()
  assert.match((await run(early.home, ['geolocate-image', 'run', 'geo.py', 'bearing', '38.5,-7.9', '38.6,-7.8', ...P], early.env)).err, /gut call first/)
})

test('refresh: Yandex and Baidu again, compared by page URL; panoramas near the retained point; the agent\'s step for Lens, TinEye and Bing', { skip }, async () => {
  const { home, env, dir } = await geoCase()
  await withGut(home, env)
  await run(home, ['geolocate-image', 'recon', '--no-people', ...P], env)
  const first = await run(home, ['refresh', ...P, '--json'], env)
  assert.equal(first.status, 0, first.err)
  const o = JSON.parse(first.out)
  assert.deepEqual(o.diffs.map(d => [d.name, d.first, d.added.length, d.removed.length]), [['rev', false, 0, 0]])
  assert.deepEqual(o.agent.map(a => a.section), ['refresh-reverse-links'])
  assert.match(read(dir, 'Journal.md'), /No retained point yet: the panoramas step waits for the answer/)
  await concludeAt(home, env, 'evora-temple', '38.5725,-7.9075')
  const second = JSON.parse((await run(home, ['refresh', ...P, '--only', 'panos', '--json'], env)).out)
  assert.deepEqual(second.diffs.map(d => [d.name, d.first, d.added.length]), [['panos', true, 3]])
  assert.deepEqual(scriptCalls(env, 'pano.py').filter(c => c.argv.includes('list')).map(c => c.argv[c.argv.indexOf('--provider') + 1]).sort(), ['google', 'kartaview', 'panoramax'])
  assert.deepEqual(json(dir, '.osint/views/map.json').features.filter(f => f.properties.group === 'panos').map(f => f.properties.heading), [201, 112, 64])
  const closed = await geoCase({}, ['--frame', 'image_may_leave=false'])
  await withGut(closed.home, closed.env)
  await run(closed.home, ['geolocate-image', 'recon', ...P], closed.env)
  assert.equal((await run(closed.home, ['refresh', ...P, '--json'], closed.env)).status, 0)
  assert.equal(scriptCalls(closed.env, 'intake.py').length, 0)
  assert.match(read(closed.dir, 'Journal.md'), /Reverse search skipped: the frame keeps the image on this machine/)
})

test('truth scores the answer (error, world-map score, country and region by Nominatim, the gut call) and the scoreboard covers every case; refused before the conclusion', { skip }, async () => {
  const fake = await startFake()
  try {
    const { home, env, dir } = await geoCase(fakeEnv(fake.url))
    await withGut(home, env)
    const early = await run(home, ['geolocate-image', 'truth', '38.5728,-7.9076', ...P], env)
    assert.equal(early.status, 1)
    assert.match(early.err, /conclude first/)
    await concludeAt(home, env, 'evora-temple', '38.5725,-7.9075')
    const r = await run(home, ['geolocate-image', 'truth', '38.5728,-7.9076', ...P], env)
    assert.equal(r.status, 0, r.err)
    const t = json(dir, '.osint/case.json').state['geolocate-image'].truth
    assert.deepEqual([t.score, t.country_code, t.country_hit, t.region, t.region_hit, t.gut_rank, t.gut_hit, t.answer.confidence, t.answer.level], [5000, 'PT', true, 'PT-07', true, 1, true, 'medium', 'point'])
    assert.ok(t.error_km > 0.03 && t.error_km < 0.04, String(t.error_km))
    assert.match(read(dir, 'Report.md'), /## Ground truth\n\nActual location 38\.5728, -7\.9076 \(Évora, Portugal\)\. Error 0\.03 km; world-map score 5000; country right; region right; gut call right; stated confidence medium\./)
    assert.equal(json(dir, '.osint/views/calibration.json').scoreboard.cases, 1)
    assert.ok(json(dir, '.osint/views/map.json').features.some(f => f.properties.group === 'truth'))
    // a second case of the folder, answered in Paris
    assert.equal((await run(home, [...GEO, '--file', TEMPLE, '--title', 'paris-guess'], env)).status, 0)
    assert.equal((await run(home, ['geolocate-image', 'gut', '--file', file(home, 'gut2.json', GUT), '-p', 'paris-guess'], env)).status, 0)
    await concludeAt(home, env, 'paris-guess', '48.8584,2.2945')
    assert.equal((await run(home, ['geolocate-image', 'truth', '38.5728,-7.9076', '-p', 'paris-guess'], env)).status, 0)
    const t2 = json(path.join(home, 'paris-guess'), '.osint/case.json').state['geolocate-image'].truth
    assert.deepEqual([t2.country_hit, t2.region_hit, t2.gut_hit, t2.answer.country_code], [false, false, true, 'FR'])
    const board = await run(home, ['geolocate-image', 'scoreboard'], env)
    assert.equal(board.status, 0, board.err)
    assert.match(board.out, /^2 scored geolocate-image cases · median error 70\d\.\d+ km · mean world-map score 34\d\d/)
    const s = json(dir, '.osint/views/calibration.json').scoreboard
    assert.deepEqual([s.cases, s.within['1'], s.within['2500'], s.country_rate, s.gut_country_rate, s.by_confidence.medium.n], [2, 0.5, 1, 0.5, 1, 2])
    assert.deepEqual(json(path.join(home, 'paris-guess'), '.osint/views/calibration.json').scoreboard.cases, 2)
    // a southern latitude passes as it is (raw arguments); a place Nominatim does not know leaves its country unknown
    const south = await run(home, ['geolocate-image', 'truth', '-33.8568,151.2153', '-p', 'paris-guess'], env)
    assert.equal(south.status, 0, south.err)
    const t3 = json(path.join(home, 'paris-guess'), '.osint/case.json').state['geolocate-image'].truth
    assert.deepEqual([t3.country_code, t3.country_hit, t3.error_km > 16000], [null, null, true])
    assert.equal((await run(home, ['geolocate-image', 'truth', 'Évora', ...P], env)).status, 1)
  } finally { fake.close() }
})

test('« Set true location » in the dashboard records the truth through the engine; a body without coordinates is refused', { skip }, async () => {
  const fake = await startFake(), old = { ...process.env }
  try {
    const { home, env } = await geoCase(fakeEnv(fake.url))
    Object.assign(process.env, env)
    await withGut(home, env)
    await concludeAt(home, env, 'evora-temple', '38.5725,-7.9075')
    const dist = fs.mkdtempSync(path.join(home, 'dist-')); fs.writeFileSync(path.join(dist, 'index.html'), '<title>OSINT</title>')
    const server = await startServer({ home, port: 0, dist, engine: ENGINE, loaded: 0 }), base = `http://127.0.0.1:${server.address().port}`
    const post = body => fetch(`${base}/api/cases/evora-temple/truth`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    try {
      const ok = await post({ lat: 38.5728, lon: -7.9076 })
      assert.equal(ok.status, 200)
      assert.deepEqual([(await ok.json()).country_hit], [true])
      assert.ok(events(path.join(home, 'evora-temple')).some(e => e.by === 'dashboard' && e.kind === 'cmd.end'))
      assert.equal((await post({ lat: 'north' })).status, 400)
    } finally { server.close() }
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in old)) delete process.env[k]
    Object.assign(process.env, old)
    fake.close()
  }
})
