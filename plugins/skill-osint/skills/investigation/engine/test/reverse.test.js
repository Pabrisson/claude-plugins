import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { declareClear, evidenceFile } from '../lib/records.js'
import { engineOf, ENGINES, reverseLinks, sendable } from '../lib/reverse.js'
import { sha256File } from '../lib/util.js'
import { readNote } from '../lib/vault.js'
import { casesFolder, FIXTURES, geoEnvFor, hasFfmpeg, json, nodeOnlyPath, read, run, uvCalls } from './helpers.js'

const MEDIA = { OSINT_TYPES: path.join(FIXTURES, 'types-files') }
const NEWM = ['new', 'media', '--question', 'Where is it?', '--frame', 'image_may_leave=true', '--frame', 'noisy=never']
const TEMPLE = path.join(FIXTURES, 'images', 'evora-temple.jpg'), P = ['-p', 'evora-temple']
async function temple(env = MEDIA) { const home = casesFolder(); await run(home, [...NEWM, '--file', TEMPLE], env); return { home, dir: path.join(home, 'evora-temple') } }

test('reverseLinks: one link per engine, the image URL encoded, Bing in its long form', () => {
  const u = 'https://osint-fake-tunnel.trycloudflare.com/0123456789abcdef0123456789abcdef/1.jpg', e = encodeURIComponent(u)
  assert.deepEqual(reverseLinks(u).map(l => [l.engine, l.url]), [
    ['lens', `https://lens.google.com/uploadbyurl?url=${e}`],
    ['yandex', `https://yandex.com/images/search?rpt=imageview&url=${e}`],
    ['bing', `https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIVSP&sbisrc=UrlPaste&q=imgurl:${e}`],
    ['tineye', `https://tineye.com/search?url=${e}`],
    ['baidu', `https://image.baidu.com/n/pc_search?queryImageUrl=${e}`],
  ])
  assert.deepEqual(ENGINES.map(x => x.verified), ['2026-11-04', null, '2026-11-04', '2026-11-04', null])
})

test('sendable: a masked copy, or a file the agent declared clear; never the original as it is, a capture, a HEIC, a file outside Evidence', () => {
  const evidence = [{ id: 'E01', file: 'Evidence/E01-photo.jpg', kind: 'original' }, { id: 'E02', file: 'Evidence/E02-E01-masked.jpg', of: 'E01', kind: 'masked' }]
  const clear = { 'Evidence/crops/01_sign.jpg': { at: '2026-11-03T10:00:00Z' } }, ok = rel => sendable(rel, { evidence, clear }).ok
  assert.deepEqual(['Evidence/E02-E01-masked.jpg', 'Evidence/crops/01_sign.jpg', 'Evidence/E01-photo.jpg', 'Evidence/captures/S03.png', 'Evidence/E03-x.heic', '.osint/geoint/recon/intake/variants/full_crop.jpg', 'Evidence/../Case.md'].map(ok),
    [true, true, false, false, false, false, false])
  assert.match(sendable('Evidence/E01-photo.jpg', { evidence, clear }).why, /mask/)
})

test('engineOf tells the engines\' fetchers apart by their user agent', () => {
  assert.deepEqual(['Mozilla/5.0 (compatible; Googlebot-Image/1.0)', 'Mozilla/5.0 (compatible; YandexImages/3.0)', 'Mozilla/5.0 (compatible; bingbot/2.0)', 'TinEye/1.1', 'Baiduspider-image+(+http://www.baidu.com/search/spider.htm)', 'curl/8.7'].map(engineOf),
    ['lens', 'yandex', 'bing', 'tineye', 'baidu', 'other'])
})

test('evidenceFile finds a file by its id, name or path; declareClear records what the agent looked at', async () => {
  const { dir } = await temple()
  for (const ref of ['E01', 'e01', 'E01-evora-temple', 'E01-evora-temple.jpg', 'Evidence/E01-evora-temple.jpg', path.join(dir, 'Evidence', 'E01-evora-temple.jpg')]) assert.equal(evidenceFile(dir, ref), 'Evidence/E01-evora-temple.jpg', ref)
  assert.throws(() => evidenceFile(dir, 'nope'), /no file nope in Evidence/)
  declareClear(dir, ['E01'])
  assert.match(json(dir, '.osint/case.json').reverse.clear['Evidence/E01-evora-temple.jpg'].journal, /^j\d{3}$/)
  assert.match(read(dir, 'Journal.md'), /· people · looked at by the agent, no person: Evidence\/E01-evora-temple\.jpg/)
})

test('evidence mask paints the boxes over a copy (masked, of E01, its boxes kept), the original untouched; a box outside is refused', { skip: !hasFfmpeg }, async () => {
  const { home, dir } = await temple()
  const r = await run(home, ['evidence', 'mask', 'E01', '--box', '10,20,100,50', '--box', '900,700,200,200', ...P, '--json'], MEDIA)
  assert.equal(r.status, 0, r.err)
  const o = JSON.parse(r.out), c = json(dir, '.osint/case.json')
  assert.deepEqual([o.id, o.file, o.of, o.tool], ['E02', 'Evidence/E02-E01-masked.jpg', 'E01', 'ffmpeg'])
  assert.deepEqual([c.evidence[1].kind, c.evidence[1].boxes], ['masked', [[10, 20, 100, 50], [900, 700, 60, 15]]])
  assert.equal(c.evidence[0].sha256, sha256File(TEMPLE))
  assert.equal(sha256File(path.join(dir, c.evidence[0].file)), sha256File(TEMPLE))
  assert.equal((await run(home, ['evidence', 'mask', 'E01', '--box', '2000,10,5,5', ...P], MEDIA)).status, 1)
  assert.match((await run(home, ['evidence', 'mask', 'E01', ...P], MEDIA)).err, /no box/)
})

test('evidence mask --people adds the persons the pack\'s detector finds, and does not count as the first tool', { skip: process.platform === 'win32' || !hasFfmpeg }, async () => {
  const home = casesFolder(), env = { ...MEDIA, ...geoEnvFor(home) }, dir = path.join(home, 'evora-temple')
  await run(home, [...NEWM, '--file', TEMPLE], env)
  const r = await run(home, ['evidence', 'mask', 'E01', '--people', ...P, '--json'], env)
  assert.equal(r.status, 0, r.err)
  assert.deepEqual(json(dir, '.osint/case.json').evidence[1].boxes, [[115, 286, 70, 198]])
  assert.ok(!json(dir, '.osint/case.json').python_at)
  assert.ok(uvCalls(env).find(c => c.argv.some(a => a.endsWith('detect.py'))).argv.includes('a person,a face'))
})

test('without ffmpeg the mask falls back on the pack\'s Pillow; without either it is exit code 3', { skip: process.platform === 'win32' }, async () => {
  const home = casesFolder(), env = { ...MEDIA, ...geoEnvFor(home), ...nodeOnlyPath() }
  await run(home, [...NEWM, '--file', TEMPLE], env)
  const r = await run(home, ['evidence', 'mask', 'E01', '--box', '10,20,100,50', ...P, '--json'], env)
  assert.equal(r.status, 0, r.err)
  assert.equal(JSON.parse(r.out).tool, 'pillow')
  const none = await run(home, ['evidence', 'mask', 'E01', '--box', '10,20,100,50', ...P], { ...env, OSINT_DATA: path.join(home, 'empty') })
  assert.equal(none.status, 3)
  assert.match(none.err, /ffmpeg/)
})

test('reverse verdict: each verdict to the Journal; a match on three features or more becomes an observed constraint that cites it; a match without the features is refused', async () => {
  const { home, dir } = await temple()
  fs.mkdirSync(path.join(dir, '.osint', 'views'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.osint', 'views', 'evidence.json'), JSON.stringify({ items: [{ group: 'candidates', kind: 'candidate', rank: 1, page: 'https://pt.wikipedia.org/wiki/Templo_romano_de_%C3%89vora', label: '#1' }] }))
  const f = path.join(home, 'v.json')
  fs.writeFileSync(f, JSON.stringify([
    { candidate: '#1', page: 'https://pt.wikipedia.org/wiki/Templo_romano_de_%C3%89vora', verdict: 'match', reason: 'the same temple from the same corner', compared: ['granite columns', 'Corinthian capitals', 'podium', 'cathedral tower behind'] },
    { candidate: '#2', verdict: 'unsure', reason: 'too small to judge' },
  ]))
  const r = await run(home, ['reverse', 'verdict', '--file', f, ...P], MEDIA)
  assert.equal(r.status, 0, r.err)
  const clues = fs.readdirSync(path.join(dir, 'Clues')), p = readNote(path.join(dir, 'Clues', clues[0])).props
  assert.equal(clues.length, 1)
  assert.deepEqual([p.status, p.constraint, /^j\d{3}$/.test(p.journal)], ['observed', true, true])
  assert.match(read(dir, 'Journal.md'), /· verdict · #1 — match: the same temple[\s\S]*· verdict · #2 — unsure: too small to judge/)
  assert.deepEqual(json(dir, '.osint/case.json').reverse.verdicts.map(x => x.verdict), ['match', 'unsure'])
  assert.equal(json(dir, '.osint/views/evidence.json').items[0].verdict, 'match')
  fs.writeFileSync(f, JSON.stringify([{ candidate: '#3', verdict: 'match', reason: 'looks alike' }]))
  const bad = await run(home, ['reverse', 'verdict', '--file', f, ...P], MEDIA)
  assert.equal(bad.status, 1)
  assert.match(bad.err, /lists the features "compared"/)
})

// a 200×100 stored JPEG, white, with EXIF Orientation: ffmpeg, detect.py and imgprep.py all show it turned
const withOrientation = (jpg, o) => {
  const tiff = Buffer.concat([Buffer.from('MM\0*\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01', 'latin1'), Buffer.from([0, o, 0, 0]), Buffer.alloc(4)])
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  return Buffer.concat([jpg.subarray(0, 2), Buffer.from([0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 255]), app1, jpg.subarray(2)])
}
test('evidence mask works in the DISPLAYED orientation: a 200×100 JPEG with Orientation=6 is 100×200, the box is painted whole', { skip: !hasFfmpeg }, async () => {
  const { spawnSync } = await import('node:child_process')
  const home = casesFolder(), src = path.join(home, 'rot.jpg')
  const w = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=200x100', '-frames:v', '1', path.join(home, 'plain.jpg')])
  assert.equal(w.status, 0, String(w.stderr))
  fs.writeFileSync(src, withOrientation(fs.readFileSync(path.join(home, 'plain.jpg')), 6))
  const { imageSize } = await import('../lib/media.js')
  assert.deepEqual(imageSize(fs.readFileSync(src)), { width: 100, height: 200 })
  await run(home, [...NEWM, '--file', src], MEDIA)
  const r = await run(home, ['evidence', 'mask', 'E01', '--box', '10,60,80,120', '-p', 'rot', '--json'], MEDIA)
  assert.equal(r.status, 0, r.err)
  const o = JSON.parse(r.out)
  assert.deepEqual(o.boxes, [[10, 60, 80, 120]])
  const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(home, 'rot', o.file), '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1e7 }).stdout
  assert.equal(raw.length, 100 * 200)
  for (const y of [60, 100, 179]) assert.ok(raw[y * 100 + 50] < 30, `row ${y} is painted`)
  assert.ok(raw[30 * 100 + 50] > 200)
  // an orientation that cannot be read: refused, not guessed
  const bad = Buffer.from(withOrientation(fs.readFileSync(path.join(home, 'plain.jpg')), 9))
  assert.equal(imageSize(bad), null)
})
test('imageSize: PNG with an eXIf Orientation, WebP and HEIC refused (null), never a silent stored-size guess', async () => {
  const { imageSize } = await import('../lib/media.js')
  const png = (o) => {
    const ihdr = Buffer.alloc(25); ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4); ihdr.writeUInt32BE(200, 8); ihdr.writeUInt32BE(100, 12)
    const tiff = Buffer.concat([Buffer.from('MM\0*\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01', 'latin1'), Buffer.from([0, o, 0, 0]), Buffer.alloc(4)])
    const ex = Buffer.concat([Buffer.alloc(4), Buffer.from('eXIf'), tiff, Buffer.alloc(4)]); ex.writeUInt32BE(tiff.length, 0)
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr, ex, Buffer.alloc(12)])
  }
  assert.deepEqual(imageSize(png(6)), { width: 100, height: 200 })
  assert.deepEqual(imageSize(png(1)), { width: 200, height: 100 })
  assert.equal(imageSize(Buffer.concat([Buffer.from('RIFF\0\0\0\0WEBPVP8 '), Buffer.alloc(30)])), null)
  assert.equal(imageSize(Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic'), Buffer.alloc(30)])), null)
})
