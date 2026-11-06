import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { c2paHint, canonicalUrl, dayOf, pageDate, readC2pa, readExif } from '../../types/verify-media/engine.js'
import { loadTypes, validateEngine, validateManifest } from '../lib/types.js'
import { readNote } from '../lib/vault.js'
import { fakeEnv, startFake } from './fake.mjs'
import { casesFolder, events, FIXTURES, geoEnvFor, hasFfmpeg, json, nodeOnlyPath, PATHX, read, run, uvCalls } from './helpers.js'

const fake = await startFake()
test.after(() => fake.close())
const skip = process.platform === 'win32'
const TEMPLE = path.join(FIXTURES, 'images', 'evora-temple.jpg'), FS = path.join(FIXTURES, 'first-seen')
const QUESTION = 'Is this the Temple of Diana in Mérida during the storm of 3 March 2025?'
const VM = leave => ['new', 'verify-media', '--question', QUESTION, '--frame', `image_may_leave=${leave}`, '--frame', 'noisy=never', '--in', 'claim=The Temple of Diana in Mérida during the storm of 3 March 2025']
// a case from the temple photo under the given name (the fake exiftool and c2patool answer by the file's name)
async function vmCase(name = 'evora-temple.jpg', { env = {}, leave = true, fx = fake.url } = {}) {
  const home = casesFolder(), file = path.join(home, name), e = { ...fakeEnv(fx), ...env }
  fs.copyFileSync(TEMPLE, file)
  const r = await run(home, [...VM(leave), '--file', file], e)
  assert.equal(r.status, 0, r.err)
  const slug = path.parse(name).name
  return { home, env: e, dir: path.join(home, slug), P: ['-p', slug] }
}
const write = (home, name, v) => { const f = path.join(home, name); fs.writeFileSync(f, typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(v)); return f }
const entityOf = (dir, kind, value) => fs.readdirSync(path.join(dir, 'Entities')).map(f => readNote(path.join(dir, 'Entities', f)).props).find(p => p.kind === kind && p.value === value)
const COMMONS = 'https://commons.wikimedia.org/wiki/File:Roman_Temple_of_%C3%89vora_1.jpg', NEWS = 'https://news.example/2025/03/04/storm-merida'
const SOCIAL = 'https://social.example/@newsdesk_example/posts/1123', BLOG = 'https://blog.example/travel/alentejo-in-three-days'
const PAGES = home => [
  { url: `${NEWS}/?utm_source=social&fbclid=xyz`, engine: 'yandex', match: 'exact' },
  { url: `${NEWS}#comments`, posted: '2025-03-04T09:30:00+01:00' },
  { url: SOCIAL, posted: '2025-03-03T21:14:00+01:00', author: '@newsdesk_example', capture: write(home, 'post.txt', fs.readFileSync(path.join(FS, 'social-post.txt'))), engine: 'web', match: 'exact' },
  { url: COMMONS, capture: path.join(FS, 'commons-evora.html'), engine: 'lens', match: 'exact' },
  { url: BLOG, posted: 'sometime in 2023' },
]

test('the verify-media type is sound', async () => {
  const t = loadTypes().find(x => x.id === 'verify-media')
  assert.deepEqual(validateManifest(t), [])
  assert.deepEqual(await validateEngine(t), [])
})

test('dayOf keeps the day the page wrote (no shift through UTC); refuses what is not a date, before 1990 or in the future', () => {
  const today = new Date('2026-11-03T12:00:00Z')
  assert.equal(dayOf('2025-03-04T09:30:00+01:00', today), '2025-03-04')
  assert.equal(dayOf('2025-03-03T23:30:00-05:00', today), '2025-03-03')
  assert.equal(dayOf('2021-11-20 16:40:25', today), '2021-11-20')
  assert.equal(dayOf('2025-03-04', today), '2025-03-04')
  assert.equal(dayOf('March 4, 2025', today), '2025-03-04')
  assert.equal(dayOf('4 March 2025', today), '2025-03-04')
  assert.equal(dayOf('Mar. 4th, 2025, 21:14', today), '2025-03-04')
  for (const bad of ['2027-01-01', '1989-12-31', 'yesterday', 'sometime in 2023', '4 mars 2025', 'Ma 4, 2025', '2025-02-30', '0000:00:00 00:00:00', '', null]) assert.equal(dayOf(bad, today), null, String(bad))
})

test('pageDate: the page\'s own date — published time, JSON-LD datePublished or uploadDate (Commons) — before any <time>', () => {
  const today = new Date('2026-11-03T12:00:00Z'), web = f => fs.readFileSync(path.join(FIXTURES, 'web', f), 'utf8')
  assert.deepEqual(pageDate(fs.readFileSync(path.join(FS, 'commons-evora.html'), 'utf8'), today), { date: '2021-11-20', how: 'uploadDate', raw: '2021-11-20 16:40:25' })
  assert.equal(pageDate(web('news.example/2025/03/04/storm-merida.html'), today).date, '2025-03-04')
  assert.deepEqual(pageDate(web('blog.example/travel/alentejo-in-three-days.html'), today), { date: '2023-06-14', how: 'datePublished', raw: '2023-06-14T08:00:00+01:00' })
  assert.equal(pageDate('<meta content="2025-03-04T23:30:00-05:00" property="article:published_time">', today).date, '2025-03-04')
  assert.equal(pageDate('<time datetime="2030-01-01">soon</time>', today), null)
  assert.equal(pageDate('<p>no date</p>', today), null)
})

test('canonicalUrl: one address per page — no fragment, no tracking parameter, no trailing slash', () => {
  assert.equal(canonicalUrl('https://News.Example/2025/03/04/storm-merida/?utm_source=x&fbclid=abc#comments'), NEWS)
  assert.equal(canonicalUrl('https://video.example/watch?v=abc&si=xyz&feature=share'), 'https://video.example/watch?v=abc')
  assert.equal(canonicalUrl('https://news.example/'), 'https://news.example/')
  assert.equal(canonicalUrl('https://commons.wikimedia.org/wiki/File:Roman_Temple_of_Évora_1.jpg'), COMMONS)
  assert.equal(canonicalUrl('https://example.org/?s=temple'), 'https://example.org/?s=temple')
})

test('first-seen: each page a dated source on the timeline, its site and its author; duplicates merged; a bad date named; the earliest dated is the candidate', async () => {
  const { home, dir, env, P } = await vmCase()
  const r = await run(home, ['verify-media', 'first-seen', '--file', write(home, 'pages.json', PAGES(home)), ...P], env)
  assert.equal(r.status, 0, r.err)
  const news = entityOf(dir, 'url', NEWS)
  assert.deepEqual([news.page_date, news.posted, news.first_capture, news.earliest, news.engine], ['2025-03-04', '2025-03-04', '2025-03-04', '2025-03-04', 'yandex'])
  assert.equal(fs.readdirSync(path.join(dir, 'Entities')).map(f => readNote(path.join(dir, 'Entities', f)).props).filter(p => p.kind === 'url' && p.site === 'news.example').length, 1)
  const social = entityOf(dir, 'url', SOCIAL)
  assert.deepEqual([social.posted, social.first_capture, social.earliest, social.how], ['2025-03-03', null, '2025-03-03', 'posted'])
  assert.equal(entityOf(dir, 'account', 'social.example/newsdesk_example').handle, '@newsdesk_example')
  const commons = entityOf(dir, 'url', COMMONS)
  assert.deepEqual([commons.page_date, commons.first_capture, commons.earliest, commons.how], ['2021-11-20', '2025-10-04', '2021-11-20', 'page'])
  const blog = entityOf(dir, 'url', BLOG)
  assert.deepEqual([blog.posted, blog.page_date, blog.first_capture, blog.earliest], [null, '2023-06-14', '2023-07-01', '2023-06-14'])
  assert.ok(events(dir).some(e => e.kind === 'fail' && /blog\.example.*"sometime in 2023" is not a date/.test(e.text)))
  for (const d of ['commons.wikimedia.org', 'news.example', 'social.example', 'blog.example']) assert.equal(entityOf(dir, 'domain', d)?.role, 'site', d)
  const st = json(dir, '.osint/case.json').state['verify-media']
  assert.deepEqual([st.first.url, st.first.date, st.first.how], [COMMONS, '2021-11-20', 'page'])
  const first = readNote(path.join(dir, 'Clues', fs.readdirSync(path.join(dir, 'Clues')).find(f => f.startsWith(st.first.clue))))
  assert.equal(first.props.status, 'read')
  assert.ok(first.props.sources.length && first.props.journal)
  const tl = json(dir, '.osint/views/timeline.json')
  assert.equal(tl.filter(i => i.kind === 'posted' && i.url === NEWS).length, 1)
  assert.deepEqual(tl.filter(i => i.kind === 'earliest').map(i => i.date), ['2021-11-20'])
  assert.ok(!tl.some(i => i.date >= '2027'))
  assert.equal(json(dir, '.osint/collect/cdx/1.json').items.length, 4)
  assert.match(read(dir, 'Journal.md'), /· query · GET cdx \/cdx\/search\/cdx\?url=https%3A%2F%2Fcommons/)
})

test('first-seen refuses a list without URLs and a capture that is not there', async () => {
  const { home, env, P } = await vmCase()
  assert.match((await run(home, ['verify-media', 'first-seen', '--file', write(home, 'p.json', [{ page: 'x' }]), ...P], env)).err, /each with its "url"/)
  assert.match((await run(home, ['verify-media', 'first-seen', '--file', write(home, 'p.json', [{ url: SOCIAL, capture: 'nowhere.txt' }]), ...P], env)).err, /no capture file nowhere\.txt/)
  assert.match((await run(home, ['verify-media', 'first-seen', ...P], env)).err, /--file pages\.json/)
})

test('first-seen --cdx asks the Wayback Machine again: a page archived since changes the snapshot', async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-fx-'))
  fs.cpSync(FIXTURES, copy, { recursive: true })
  const f2 = await startFake({ fixtures: copy })
  try {
    const { home, dir, P } = await vmCase('evora-temple.jpg', { fx: f2.url }), env = fakeEnv(f2.url, copy)
    assert.equal((await run(home, ['verify-media', 'first-seen', '--file', write(home, 'pages.json', PAGES(home)), ...P], env)).status, 0)
    fs.writeFileSync(path.join(copy, 'cdx', 'pages', 'social.example_newsdesk_example_posts_1123-first.json'), JSON.stringify([['timestamp', 'original', 'statuscode'], ['20250305080000', SOCIAL, '200']]))
    const r = await run(home, ['verify-media', 'first-seen', '--cdx', ...P], env)
    assert.equal(r.status, 0, r.err)
    assert.deepEqual(json(dir, '.osint/collect/cdx/2.json').items.find(i => i.key === SOCIAL), { key: SOCIAL, first_capture: '2025-03-05' })
    assert.equal(entityOf(dir, 'url', SOCIAL).first_capture, '2025-03-05')
    assert.equal(json(dir, '.osint/case.json').state['verify-media'].first.url, COMMONS)
  } finally { f2.close() }
})

test('intake: an image is measured and becomes an entity shared by its SHA-256; an image by link is downloaded once, its URL kept; a dead link adds nothing', async () => {
  const { home, dir, env, P } = await vmCase()
  const r = await run(home, ['verify-media', 'intake', ...P], env)
  assert.equal(r.status, 0, r.err)
  const c = json(dir, '.osint/case.json'), img = entityOf(dir, 'image', 'E01-evora-temple.jpg')
  assert.deepEqual([img.sha256, img.width, img.height], [c.evidence[0].sha256, 960, 715])
  assert.deepEqual([c.state['verify-media'].media, c.state['verify-media'].original], ['image', 'Evidence/E01-evora-temple.jpg'])
  const h2 = casesFolder(), link = 'https://durand-bakery.example/img/vitrine.jpg'
  assert.equal((await run(h2, [...VM(true), link], env)).status, 0)
  const v = path.join(h2, 'vitrine')
  assert.deepEqual(json(v, '.osint/case.json').evidence, [])
  assert.equal((await run(h2, ['verify-media', 'intake', '-p', 'vitrine'], env)).status, 0)
  const cv = json(v, '.osint/case.json')
  assert.deepEqual([cv.evidence[0].file, cv.evidence[0].url, cv.state['verify-media'].original], ['Evidence/E01-vitrine.jpg', link, 'Evidence/E01-vitrine.jpg'])
  assert.equal(entityOf(v, 'image', link).sha256, cv.evidence[0].sha256)
  assert.equal((await run(h2, [...VM(true), 'https://durand-bakery.example/img/none.jpg', '--title', 'gone'], env)).status, 0)
  const g = await run(h2, ['verify-media', 'intake', '-p', 'gone'], env)
  assert.equal(g.status, 1)
  assert.match(g.err, /the image could not be downloaded \(https:\/\/durand-bakery\.example\/img\/none\.jpg answered 404\)/)
  assert.deepEqual(json(path.join(h2, 'gone'), '.osint/case.json').evidence, [])
})

test('intake: a video link without a video adds nothing to Evidence, keeps the page as an entity and says what to give instead (exit 1, no stack)', { skip }, async () => {
  const home = casesFolder(), env = { ...fakeEnv(fake.url), ...PATHX }
  assert.equal((await run(home, [...VM(true), '--in', 'media=video', '--in', 'video=https://no-video.example/news/storm', '--title', 'nothing'], env)).status, 0)
  const r = await run(home, ['verify-media', 'intake', '-p', 'nothing'], env)
  assert.equal(r.status, 1)
  assert.match(r.err, /no video could be downloaded \(yt-dlp exited 1: ERROR: \[generic\] Unsupported URL: https:\/\/no-video\.example\/news\/storm\)/)
  assert.match(r.err, /Give the image by its URL/)
  assert.doesNotMatch(r.err, /\n\s+at /)
  const dir = path.join(home, 'nothing')
  assert.deepEqual(json(dir, '.osint/case.json').evidence, [])
  assert.deepEqual(fs.readdirSync(path.join(dir, 'Evidence')).filter(f => /^E\d/.test(f)), [])
  assert.equal(entityOf(dir, 'url', 'https://no-video.example/news/storm').video, 'none found')
  assert.ok(events(dir).some(e => e.kind === 'fail' && /no-video\.example/.test(e.text)))
})

test('intake: a video file gets its key frames; a video by link is downloaded, its page a dated source with its author', { skip: skip || !hasFfmpeg }, async () => {
  const home = casesFolder(), clip = path.join(home, 'walk.mp4')
  spawnSync('ffmpeg', ['-v', 'error', '-y', ...['red', 'blue', 'green', 'white'].flatMap(c => ['-f', 'lavfi', '-i', `color=c=${c}:s=160x120:d=1:r=10`]), '-filter_complex', '[0:v][1:v][2:v][3:v]concat=n=4:v=1:a=0', '-pix_fmt', 'yuv420p', clip], { windowsHide: true })
  const env = { ...fakeEnv(fake.url), ...PATHX, OSINT_FAKE_VIDEO: clip }
  assert.equal((await run(home, [...VM(true), '--in', 'media=video', '--file', clip], env)).status, 0)
  const r = await run(home, ['verify-media', 'intake', '-p', 'walk'], env)
  assert.equal(r.status, 0, r.err)
  const walk = path.join(home, 'walk')
  assert.equal(json(walk, '.osint/views/evidence.json').items.filter(i => i.group === 'intake' && i.kind === 'frame').length, 3)
  assert.equal(json(walk, '.osint/case.json').state['verify-media'].original, 'Evidence/E01-walk.mp4')
  assert.equal((await run(home, [...VM(true), '--in', 'media=video', '--in', 'video=https://video.example/watch?v=abc', '--title', 'linked'], env)).status, 0)
  const l = await run(home, ['verify-media', 'intake', '-p', 'linked'], env)
  assert.equal(l.status, 0, l.err)
  const d = path.join(home, 'linked'), c = json(d, '.osint/case.json'), st = c.state['verify-media']
  assert.deepEqual([c.evidence[0].file, st.original, st.video_page], ['Evidence/E01-fakeid0001.mp4', 'Evidence/E01-fakeid0001.mp4', 'S01'])
  const page = entityOf(d, 'url', 'https://video.example/watch?v=abc')
  assert.deepEqual([page.posted, page.author, page.earliest, page.how], ['2024-07-16', 'example-uploader', '2024-07-16', 'posted'])
  assert.equal(entityOf(d, 'account', 'video.example/example-uploader').site, 'video.example')
  assert.equal(entityOf(d, 'video', 'https://video.example/watch?v=abc').sha256, c.evidence[0].sha256)
  assert.equal(st.first.date, '2024-07-16')
})

test('intake: a video by link without yt-dlp is exit code 3', { skip }, async () => {
  const home = casesFolder(), env = { ...fakeEnv(fake.url), ...nodeOnlyPath() }
  await run(home, [...VM(true), '--in', 'media=video', '--in', 'video=https://video.example/watch?v=abc', '--title', 'bare'], env)
  const r = await run(home, ['verify-media', 'intake', '-p', 'bare'], env)
  assert.equal(r.status, 3)
  assert.match(r.err, /needs yt-dlp/)
})

const exifFx = n => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'exiftool', `${n}.json`), 'utf8'))[0]
const c2paFx = n => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'c2pa', `${n}.json`), 'utf8'))
const cluesOf = dir => fs.readdirSync(path.join(dir, 'Clues')).map(f => readNote(path.join(dir, 'Clues', f)))

test('readExif: the time as written with its offset, the camera, the software, GPS, a caption, AI markers; zero dates, (0, 0), blanks and file-system dates ignored', () => {
  const s = readExif(exifFx('street-2019'))
  assert.deepEqual(s.taken, { local: '2021-11-12T14:06:13', offset: '+00:00', tag: 'ExifIFD:DateTimeOriginal' })
  assert.deepEqual(s.modified, { local: '2023-06-14T18:02:11', offset: '+01:00', tag: 'IFD0:ModifyDate' })
  assert.deepEqual([s.camera, s.software, s.caption], ['Apple iPhone 12 (iPhone 12 back dual wide camera 4.2mm f/1.6)', 'Adobe Photoshop Lightroom Classic 13.0 (Macintosh)', { tag: 'IPTC:Caption-Abstract', value: 'Templo romano, Évora' }])
  assert.deepEqual(s.gps, { lat: 38.572792, lon: -7.907642, tag: 'Composite:GPSLatitude' })
  assert.deepEqual([s.ai, s.generator, s.empty], [[], null, false])
  const z = readExif(exifFx('zero-dates'))
  assert.deepEqual([z.taken, z.modified, z.gps, z.software, z.caption, z.camera], [{ local: '2019-05-01T10:20:30', offset: null, tag: 'ExifIFD:CreateDate' }, null, null, null, null, 'Canon EOS 5D Mark IV'])
  const a = readExif(exifFx('ai-render'))
  assert.deepEqual(a.ai, [{ tag: 'XMP-iptcExt:DigitalSourceType', value: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia' }])
  assert.deepEqual(a.generator, { tag: 'XMP-xmp:CreatorTool', value: 'Adobe Firefly' })
  assert.match(readExif(exifFx('sd-render')).generator.value, /^a roman temple in the rain at night, photorealistic Steps: 30/)
  assert.equal(readExif(exifFx('evora-temple')).empty, true)
})

test('readC2pa: the signer, the state, the actions, an AI source type anywhere in the store; valid only when signed, Valid or Trusted, without a failure', () => {
  const f = readC2pa(c2paFx('firefly-cat'))
  assert.deepEqual([f.state, f.signer.issuer, f.signer.common_name, f.generator, f.ai, f.valid, f.failures], ['Valid', 'Adobe Inc.', 'Adobe Firefly C2PA', 'Adobe Firefly', { type: 'trainedAlgorithmicMedia', agent: 'Adobe Firefly' }, true, []])
  const g = readC2pa(c2paFx('chatgpt-image'))
  assert.deepEqual([g.state, g.signer.issuer, g.ai, g.valid, g.failures, g.ingredients], ['Invalid', 'OpenAI', { type: 'trainedAlgorithmicMedia', agent: 'GPT-4o' }, false, ['signingCredential.untrusted'], [{ title: 'image.png', relationship: 'parentOf' }]])
  const c = readC2pa(c2paFx('crater-lake-cr'))
  assert.deepEqual([c.state, c.generator, c.ai, c.valid, c.actions.length], ['Valid', 'Lightroom', null, true, 7])
  assert.equal(readC2pa({ ...c2paFx('firefly-cat'), validation_state: 'Trusted' }).valid, true)
  // "Valid" for a signer nobody vouches for (self-signed: the signature checks out, no trust answer): the cap stays
  const self = readC2pa(c2paFx('self-signed'))
  assert.deepEqual([self.state, self.signer.issuer, self.failures, self.trusted, self.valid], ['Valid', 'Self-signed', [], false, false])
  const untrusted = c2paFx('firefly-cat'); untrusted.validation_results.activeManifest.informational.push({ code: 'signingCredential.untrusted' })
  assert.equal(readC2pa(untrusted).valid, false)
  const unsigned = c2paFx('firefly-cat'), m = unsigned.manifests[unsigned.active_manifest]
  delete m.signature_info
  assert.equal(readC2pa(unsigned).valid, false)
})

test('c2paHint: a JUMBF box labelled c2pa (JPEG APP11) or a caBX chunk (PNG), without c2patool; nothing in a plain photo', () => {
  assert.equal(c2paHint(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xeb, 0x00, 0x20]), Buffer.from('JP\0\x01\0\0\0\x01\0\0\0\x18jumb\0\0\0\x10jumdc2pa', 'latin1')])), true)
  assert.equal(c2paHint(Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.from('\0\0\0\x10caBX', 'latin1')])), true)
  assert.equal(c2paHint(fs.readFileSync(TEMPLE)), false)
})

test('meta: a camera file\'s metadata as inferred clues, its time on the timeline, its GPS a place, its thumbnail kept as derived evidence with its framing compared', { skip }, async () => {
  const { home, dir, env, P } = await vmCase('street-2019.jpg', { env: PATHX })
  await run(home, ['verify-media', 'intake', ...P], env)
  const r = await run(home, ['verify-media', 'meta', ...P], env)
  assert.equal(r.status, 0, r.err)
  const clues = cluesOf(dir), text = clues.map(c => c.body).join('\n')
  for (const want of ['Camera: Apple iPhone 12', 'Taken 2021-11-12 14:06:13 (UTC+00:00) by the camera\'s clock (ExifIFD:DateTimeOriginal)', 'GPS in the metadata: 38.572792, -7.907642', 'Saved again after capture: 2023-06-14 18:02:11', 'Caption written in the file (IPTC:Caption-Abstract): Templo romano, Évora', 'does not have the image\'s framing (960×715)', 'No C2PA manifest in E01-street-2019.jpg']) assert.ok(text.includes(want), want)
  assert.ok(clues.filter(c => /Camera|Taken|GPS in|Saved again|Caption|thumbnail/.test(c.body)).every(c => c.props.status === 'inferred'))
  assert.equal(clues.find(c => /No C2PA manifest/.test(c.body)).props.status, 'read')
  const c = json(dir, '.osint/case.json'), st = c.state['verify-media']
  assert.deepEqual(c.evidence.map(e => [e.id, e.kind, e.of]), [['E01', 'original', null], ['E02', 'derived', 'E01']])
  assert.deepEqual([st.meta['Evidence/E01-street-2019.jpg'].thumbnail, st.c2pa_valid], ['Evidence/E02-street-2019-thumbnail.jpg', false])
  assert.deepEqual(json(dir, '.osint/views/evidence.json').items.filter(i => i.group === 'meta').map(i => [i.file, i.kind]), [['Evidence/E02-street-2019-thumbnail.jpg', 'thumbnail']])
  assert.equal(entityOf(dir, 'place', 'GPS of E01-street-2019.jpg').lat, 38.572792)
  assert.deepEqual(json(dir, '.osint/views/timeline.json').filter(i => i.kind === 'taken').map(i => i.date), ['2021-11-12'])
  assert.equal((await run(home, ['verify-media', 'meta', ...P], env)).status, 0)
  assert.equal(json(dir, '.osint/case.json').evidence.length, 2)
})

test('meta: zero dates, a (0, 0) position, a blank software and the file\'s own dates never reach the case; a preview stands for a missing thumbnail', { skip }, async () => {
  const { home, dir, env, P } = await vmCase('zero-dates.jpg', { env: PATHX })
  await run(home, ['verify-media', 'intake', ...P], env)
  assert.equal((await run(home, ['verify-media', 'meta', ...P], env)).status, 0)
  const tl = json(dir, '.osint/views/timeline.json')
  assert.deepEqual(tl.filter(i => i.kind === 'taken').map(i => i.date), ['2019-05-01'])
  assert.ok(!tl.some(i => String(i.date).startsWith('0000')))
  assert.ok(!cluesOf(dir).some(c => /Software named|GPS in the metadata|Caption written/.test(c.body)))
  assert.ok(!fs.readdirSync(path.join(dir, 'Entities')).some(f => readNote(path.join(dir, 'Entities', f)).props.kind === 'place'))
  assert.ok(cluesOf(dir).some(c => /Embedded thumbnail of E01-zero-dates\.jpg kept as E02-zero-dates-thumbnail\.jpg \(320×238\)/.test(c.body)))
  assert.equal((await run(home, ['verify-media', 'meta', ...P], env)).status, 0)
  assert.deepEqual(json(dir, '.osint/case.json').evidence.map(e => e.file), ['Evidence/E01-zero-dates.jpg', 'Evidence/E02-zero-dates-thumbnail.jpg'])
})

test('meta: C2PA — a signed and valid manifest of the original sets c2pa_valid; an invalid one or one on a derived file does not; without the tools, exit code 3 and the rest done', { skip }, async () => {
  const fire = await vmCase('firefly-cat.jpg', { env: PATHX })
  await run(fire.home, ['verify-media', 'intake', ...fire.P], fire.env)
  assert.equal((await run(fire.home, ['verify-media', 'meta', ...fire.P], fire.env)).status, 0)
  const fs1 = json(fire.dir, '.osint/case.json').state['verify-media'], m1 = fs1.meta['Evidence/E01-firefly-cat.jpg'].c2pa
  assert.deepEqual([fs1.c2pa_valid, m1.state, m1.valid, m1.ai], [true, 'Valid', true, true])
  const t1 = cluesOf(fire.dir).map(c => c.body).join('\n')
  assert.match(t1, /signed by Adobe Inc\. \(Adobe Firefly C2PA\), Valid, made with Adobe Firefly/)
  assert.match(t1, /declares content generated by AI \(trainedAlgorithmicMedia, Adobe Firefly\)/)
  const gpt = await vmCase('chatgpt-image.png', { env: PATHX })
  await run(gpt.home, ['verify-media', 'intake', ...gpt.P], gpt.env)
  assert.equal((await run(gpt.home, ['verify-media', 'meta', ...gpt.P], gpt.env)).status, 0)
  assert.equal(json(gpt.dir, '.osint/case.json').state['verify-media'].c2pa_valid, false)
  assert.ok(cluesOf(gpt.dir).some(c => /is not valid \(signingCredential\.untrusted\): it proves nothing/.test(c.body) && c.props.status === 'read'))
  // a valid manifest on a derived file does not lift the original's cap
  const der = await vmCase('evora-temple.jpg', { env: PATHX }), cat = path.join(der.home, 'firefly-cat.jpg')
  fs.copyFileSync(TEMPLE, cat)
  await run(der.home, ['verify-media', 'intake', ...der.P], der.env)
  assert.equal((await run(der.home, ['evidence', cat, '--of', 'E01', ...der.P], der.env)).status, 0)
  assert.equal((await run(der.home, ['verify-media', 'meta', '--files', 'E01,E02', ...der.P], der.env)).status, 0)
  const ds = json(der.dir, '.osint/case.json').state['verify-media']
  assert.deepEqual([ds.meta['Evidence/E02-firefly-cat.jpg'].c2pa.valid, ds.c2pa_valid], [true, false])
  // neither exiftool nor c2patool: a manifest seen in the bytes stays unchecked; exit code 3 names what is missing
  const home = casesFolder(), hinted = path.join(home, 'hinted.jpg')
  fs.writeFileSync(hinted, Buffer.concat([fs.readFileSync(TEMPLE), Buffer.from('jumb\0\0\0\x10jumdc2pa', 'latin1')]))
  const bare = { ...fakeEnv(fake.url), ...nodeOnlyPath() }
  assert.equal((await run(home, [...VM(true), '--file', hinted], bare)).status, 0)
  await run(home, ['verify-media', 'intake', '-p', 'hinted'], bare)
  const r = await run(home, ['verify-media', 'meta', '-p', 'hinted'], bare)
  assert.equal(r.status, 3)
  assert.match(r.err, /meta ran without exiftool .*EXIF, XMP, IPTC and the embedded thumbnail unread; without c2patool .*no C2PA manifest check/)
  const hd = path.join(home, 'hinted')
  assert.ok(cluesOf(hd).some(c => /seems to carry a C2PA manifest, unchecked/.test(c.body) && c.props.status === 'inferred'))
  assert.equal(json(hd, '.osint/case.json').state['verify-media'].c2pa_valid, undefined)
})

test('conclude holds integrity at medium without a valid C2PA manifest of the original, and lets it go higher with one', { skip }, async () => {
  for (const [name, lifted] of [['evora-temple.jpg', false], ['firefly-cat.jpg', true]]) {
    const { home, dir, env, P } = await vmCase(name, { env: PATHX })
    await run(home, ['verify-media', 'intake', ...P], env)
    await run(home, ['verify-media', 'meta', ...P], env)
    const C = cluesOf(dir).find(c => /C2PA/.test(c.body)).props.id
    await run(home, ['hyp', 'add', 'Generated by an AI', '--level', 'integrity', '--refute-if', 'a camera original with its metadata', ...P], env)
    await run(home, ['hyp', 'add', 'A camera photograph', '--level', 'integrity', '--refute-if', 'an AI marker in the file', ...P], env)
    assert.equal((await run(home, ['hyp', 'lr', 'H01', '--clue', C, '--lr', '2', '--why', 'what the C2PA check says', ...P], env)).status, 0)
    await run(home, ['redteam', '--file', write(home, 'rt.json', { target: 'H01', refutations: [{ test: 'Is the manifest the original\'s?', result: 'checked on E01' }], outcome: 'survives' }), ...P], env)
    const c = { answer: 'H01', confidence: { integrity: 'high' }, criteria: { integrity: 'what the C2PA check says' }, alternatives: [{ hyp: 'H02', test: 'a camera original with its metadata' }], unresolved: [] }
    const r = await run(home, ['conclude', '--file', write(home, 'c.json', c), ...P], env)
    if (lifted) { assert.equal(r.status, 0, r.err); continue }
    assert.equal(r.status, 1)
    assert.match(r.err, /confidence integrity: at most medium — signs of editing or generation are clues, never a verdict/)
    assert.equal((await run(home, ['conclude', '--file', write(home, 'c2.json', { ...c, confidence: { integrity: 'medium' } }), ...P], env)).status, 0, 'medium is allowed')
  }
})

const LVYOU = 'https://lvyou.example/evora/temple.html'
async function directCase(opts = {}) {
  const c = await vmCase('evora-temple.jpg', opts), env = { ...c.env, ...PATHX, ...geoEnvFor(c.home) }
  assert.equal((await run(c.home, ['verify-media', 'intake', ...c.P], env)).status, 0)
  return { ...c, env }
}
const revimgCalls = env => uvCalls(env).filter(x => x.argv.some(a => a.endsWith('revimg.py')))

test('direct: refused when the frame keeps the image, for a file people may show on, or without the pack; --unmasked sends it to Yandex and Baidu, says so in the Journal and imports the results', { skip }, async () => {
  const closed = await directCase({ leave: false })
  const c1 = await run(closed.home, ['verify-media', 'direct', '--unmasked', '--yes', ...closed.P], closed.env)
  assert.equal(c1.status, 1)
  assert.match(c1.err, /the frame keeps the image on this machine/)
  const { home, dir, env, P } = await directCase()
  const people = await run(home, ['verify-media', 'direct', ...P], env)
  assert.equal(people.status, 1)
  assert.match(people.err, /people may show/)
  const nopack = await run(home, ['verify-media', 'direct', '--unmasked', '--yes', ...P], { ...env, OSINT_DATA: path.join(home, 'empty') })
  assert.equal(nopack.status, 3)
  assert.match(nopack.err, /setup geoint/)
  assert.equal(revimgCalls(env).length, 0)
  const noYes = await run(home, ['verify-media', 'direct', '--unmasked', ...P], env)   // the user's yes comes first
  assert.equal(noYes.status, 2)
  assert.match(noYes.err, /the user's yes/)
  assert.equal(revimgCalls(env).length, 0)
  const r = await run(home, ['verify-media', 'direct', '--unmasked', '--yes', ...P], env)
  assert.equal(r.status, 0, r.err)
  assert.match(read(dir, 'Journal.md'), /Sent unmasked to Yandex, Baidu by direct upload \(revimg\.py\): E01-evora-temple\.jpg; people visible in them left unmasked \(verify-media looks for exact copies\)/)
  const [call] = revimgCalls(env)
  assert.deepEqual(call.argv.slice(-4), ['--out-dir', path.join(dir, '.osint', 'geoint', 'direct'), '--engines', 'yandex,baidu'])
  assert.deepEqual(json(dir, '.osint/collect/direct/1.json').items.map(i => i.key).sort(), [BLOG, COMMONS, LVYOU, NEWS].sort())
  assert.equal(entityOf(dir, 'url', COMMONS).engine, 'yandex')
  const view = json(dir, '.osint/views/evidence.json').items.filter(i => i.group === 'direct')
  assert.deepEqual(view.map(i => i.kind), ['sheet', 'sheet', 'sheet'])
  assert.ok(view.some(i => /^Evidence\/crops\/direct\/E01-evora-temple_baidu_similar\.jpg$/.test(i.file)))
  assert.ok(view.filter(i => /^Evidence\/captures\/S\d+\.png$/.test(i.file)).length === 2)
  assert.deepEqual(json(dir, '.osint/case.json').state['verify-media'].direct.files, ['Evidence/E01-evora-temple.jpg'])
})

test('direct --no-people: the files the agent looked at go out as clear, without the unmasked entry', { skip }, async () => {
  const { home, dir, env, P } = await directCase()
  assert.equal((await run(home, ['verify-media', 'direct', '--files', 'E01', '--no-people', ...P], env)).status, 0)
  const j = read(dir, 'Journal.md')
  assert.match(j, /looked at by the agent, no person: Evidence\/E01-evora-temple\.jpg/)
  assert.match(j, /Sent to Yandex, Baidu by direct upload \(revimg\.py\): E01-evora-temple\.jpg/)
  assert.doesNotMatch(j, /Sent unmasked/)
  assert.equal(json(dir, '.osint/case.json').state['verify-media'].direct.unmasked, false)
})

test('reverse --unmasked: allowed for a verify-media case (it stops only for want of cloudflared), refused for any other type', { skip }, async () => {
  const { home, env, P } = await directCase()
  const t = await run(home, ['reverse', '--files', 'E01', '--unmasked', '--yes', ...P], { ...env, ...nodeOnlyPath() })
  assert.equal(t.status, 3)
  assert.match(t.err, /needs cloudflared/)
  const other = casesFolder(), MEDIA = { OSINT_TYPES: path.join(FIXTURES, 'types-files') }
  await run(other, ['new', 'media', '--question', 'Where?', '--frame', 'image_may_leave=true', '--frame', 'noisy=never', '--file', TEMPLE], MEDIA)
  const o = await run(other, ['reverse', '--files', 'E01', '--unmasked', '--yes', '-p', 'evora-temple'], { ...MEDIA, ...nodeOnlyPath() })
  assert.equal(o.status, 1)
  assert.match(o.err, /--unmasked is for verify-media cases only/)
  const noYes = await run(home, ['reverse', '--files', 'E01', '--unmasked', ...P], { ...env, ...nodeOnlyPath() })
  assert.equal(noYes.status, 2)
  assert.match(noYes.err, /the user's yes/)
})

test('refresh: the direct search again with what was sent last, the Wayback captures of the known pages again; the tunnel\'s engines left to the agent', { skip }, async () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'osint-fx-'))
  fs.cpSync(FIXTURES, copy, { recursive: true })
  const f2 = await startFake({ fixtures: copy })
  try {
    const { home, dir, env: base, P } = await directCase({ fx: f2.url }), env = { ...base, ...fakeEnv(f2.url, copy) }
    assert.equal((await run(home, ['verify-media', 'direct', '--unmasked', '--yes', ...P], env)).status, 0)
    assert.equal((await run(home, ['verify-media', 'first-seen', '--file', write(home, 'pages.json', PAGES(home)), ...P], env)).status, 0)
    fs.writeFileSync(path.join(copy, 'cdx', 'pages', 'social.example_newsdesk_example_posts_1123-first.json'), JSON.stringify([['timestamp', 'original', 'statuscode'], ['20250305080000', SOCIAL, '200']]))
    const r = await run(home, ['refresh', ...P, '--json'], env)
    assert.equal(r.status, 0, r.err)
    const out = JSON.parse(r.out)
    // what went out unmasked is not sent again without the user's yes: only masked or declared-clear files are
    assert.deepEqual(out.diffs.map(d => d.name).sort(), ['cdx'])
    assert.deepEqual(out.diffs.find(d => d.name === 'cdx').changed.map(c => c.key), [SOCIAL])
    assert.equal(out.agent.length, 1)
    assert.match(out.agent[0].prompt, /^\[verify-media:refresh-engines\] /)
    assert.equal(revimgCalls(env).length, 1)
    assert.match(read(dir, 'Journal.md'), /Sent again without E01-evora-temple\.jpg: they went out unmasked/)
    assert.equal(read(dir, 'Journal.md').match(/Sent unmasked to Yandex, Baidu/g).length, 1)
    // with the yes, the replay sends it again
    assert.equal((await run(home, ['verify-media', 'direct', '--yes', ...P], env)).status, 0)
    assert.equal(revimgCalls(env).length, 2)
    assert.match(read(dir, 'Case.md'), /cdx: ~1 \(https:\/\/social\.example\/@newsdesk_example\/posts\/1123: first_capture\)/)
  } finally { f2.close() }
})

test('first-seen: the Wayback query keeps status 200 only; a first capture dates the page, it counts for the earliest only with in_capture: true', async () => {
  const { home, dir, env, P } = await vmCase()
  const pages = [{ url: 'https://home.example/', posted: '2025-01-01' }, { url: 'https://gone.example/p', posted: '2025-02-01' }]
  assert.equal((await run(home, ['verify-media', 'first-seen', '--file', write(home, 'p.json', pages), ...P], env)).status, 0)
  assert.match(read(dir, 'Journal.md'), /cdx\/search\/cdx\?url=https%3A%2F%2Fhome\.example%2F&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&limit=1/)
  const h = entityOf(dir, 'url', 'https://home.example/')
  assert.deepEqual([h.first_capture, h.earliest, h.how], ['2019-01-01', '2025-01-01', 'posted'])
  assert.equal(entityOf(dir, 'url', 'https://gone.example/p').first_capture, null) // a 404 first row dates nothing
  const tl = json(dir, '.osint/views/timeline.json')
  assert.ok(tl.some(i => i.kind === 'wayback' && i.date === '2019-01-01' && /Page archived since/.test(i.label)))
  assert.ok(!tl.some(i => i.kind === 'earliest' && i.date === '2019-01-01'))
  pages[0].in_capture = true
  assert.equal((await run(home, ['verify-media', 'first-seen', '--file', write(home, 'p.json', pages), ...P], env)).status, 0)
  const h2 = entityOf(dir, 'url', 'https://home.example/')
  assert.deepEqual([h2.earliest, h2.how], ['2019-01-01', 'archived'])
  assert.match(read(dir, 'Clues/' + fs.readdirSync(path.join(dir, 'Clues')).find(f => /archived|2019/.test(read(dir, 'Clues/' + f)))), /the image was online by then/)
})
