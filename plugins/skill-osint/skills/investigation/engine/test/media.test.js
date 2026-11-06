import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { frames, imageSize, paint, stripJpeg, ytdlp } from '../lib/media.js'
import { FIXTURES, hasFfmpeg, PATHX } from './helpers.js'

const seg = (m, payload) => Buffer.concat([Buffer.from([0xff, m, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload])
const L = s => Buffer.from(s, 'latin1')
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8]), seg(0xe0, L('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')), seg(0xe1, L('Exif\0\0MM\0*GPS 38.57')),
  seg(0xe1, L('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>38.57</x:xmpmeta>')), seg(0xed, L('Photoshop 3.0\0IPTC Evora')), seg(0xfe, L('a comment')),
  seg(0xe2, L('ICC_PROFILE\0\x01\x01')), seg(0xc0, Buffer.from([8, 0x01, 0x2c, 0x01, 0x90, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1])),
  Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0xff, 0xd9]),
])
const TEMPLE = path.join(FIXTURES, 'images', 'evora-temple.jpg')
const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), `osint-${p}-`))

test('stripJpeg drops EXIF, XMP, IPTC and comments, keeps JFIF, the colour profile and the image data byte for byte', () => {
  const out = stripJpeg(JPEG), text = out.toString('latin1')
  for (const gone of ['Exif', 'xmpmeta', 'IPTC', 'a comment']) assert.ok(!text.includes(gone), gone)
  for (const kept of ['JFIF', 'ICC_PROFILE']) assert.ok(text.includes(kept), kept)
  assert.deepEqual(out.subarray(-14), JPEG.subarray(-14))
  assert.deepEqual(imageSize(out), { width: 400, height: 300 })
  assert.throws(() => stripJpeg(Buffer.from('GIF89a')), /not a JPEG/)
  const real = fs.readFileSync(TEMPLE)
  assert.equal(imageSize(real).width, 960)
  assert.deepEqual(imageSize(stripJpeg(real)), imageSize(real))
})

test('imageSize reads a PNG header and refuses what it does not know', () => {
  const png = Buffer.alloc(33)
  png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(0x0d0a1a0a, 4); png.write('IHDR', 12); png.writeUInt32BE(640, 16); png.writeUInt32BE(480, 20)
  assert.deepEqual(imageSize(png), { width: 640, height: 480 })
  assert.equal(imageSize(Buffer.from('nope')), null)
})

const clip = (dir, colors, each) => {
  const f = path.join(dir, `${colors.join('-')}.mp4`)
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...colors.flatMap(c => ['-f', 'lavfi', '-i', `color=c=${c}:s=160x120:d=${each}:r=10`]),
    '-filter_complex', `${colors.map((_, i) => `[${i}:v]`).join('')}concat=n=${colors.length}:v=1:a=0`, '-pix_fmt', 'yuv420p', f])
  assert.equal(r.status, 0, String(r.stderr))
  return f
}
test('frames: one per scene change; a video without cuts gets frames evenly spaced', { skip: !hasFfmpeg }, async () => {
  const d = tmp('frames')
  const cuts = await frames(clip(d, ['red', 'blue', 'white', 'black', 'green'], 1), path.join(d, 'f1'), { max: 16 })
  assert.equal(cuts.how, 'scene changes')
  assert.equal(cuts.frames.length, 4)
  assert.ok(cuts.frames.every(f => fs.existsSync(f.file) && f.t > 0))
  const flat = await frames(clip(d, ['gray'], 6), path.join(d, 'f2'), { max: 16 })
  assert.equal(flat.how, 'evenly spaced')
  assert.equal(flat.frames.length, 3)
})

test('ytdlp downloads a video by its page and keeps the page\'s facts', { skip: process.platform === 'win32' }, async () => {
  const old = process.env.PATH
  process.env.PATH = PATHX.PATH
  try {
    const r = await ytdlp('https://video.example/watch?v=abc', tmp('ytdlp'))
    assert.ok(fs.existsSync(r.file) && r.file.endsWith('.mp4'))
    assert.deepEqual([r.info.title, r.info.upload_date, r.info.webpage_url], ['A walk around the Roman temple', '20240716', 'https://video.example/watch?v=abc'])
  } finally { process.env.PATH = old }
})

test('paint covers each box with flat black (ffmpeg); without ffmpeg nor the pack it is exit code 3', { skip: !hasFfmpeg }, async () => {
  const d = tmp('paint'), out = path.join(d, 'masked.jpg')
  assert.equal(await paint(TEMPLE, out, [[10, 20, 100, 50]]), 'ffmpeg')
  assert.deepEqual(imageSize(fs.readFileSync(out)), imageSize(fs.readFileSync(TEMPLE)))
  const px = spawnSync('ffmpeg', ['-v', 'error', '-i', out, '-vf', 'crop=1:1:50:40', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  assert.ok([...px.stdout].every(v => v < 16), [...px.stdout].join(','))
  const old = process.env.PATH
  process.env.PATH = tmp('nopath')   // an empty folder: no ffmpeg on it
  try { await assert.rejects(paint(TEMPLE, path.join(d, 'x.jpg'), [[0, 0, 5, 5]]), e => e.code === 3 && /ffmpeg/.test(e.message)) } finally { process.env.PATH = old }
})

// what leaves this machine is a copy without its metadata, never the file as it is
test('cleanCopy: EXIF, GPS and XMP gone (JPEG cut, other formats and turned JPEGs by ffmpeg with the orientation applied), the original untouched; no ffmpeg for a turned one → code 3', { skip: !hasFfmpeg }, async () => {
  const { cleanCopy } = await import('../lib/media.js')
  const { crc32 } = await import('node:zlib')
  const { casesFolder, run } = await import('./helpers.js'), home = casesFolder()
  const made = await run(home, ['new', 'media', '--question', 'Where?', '--frame', 'image_may_leave=true', '--frame', 'noisy=never', '--file', TEMPLE], { OSINT_TYPES: path.join(FIXTURES, 'types-files') }); assert.equal(made.status, 0, made.err)
  const dir = path.join(home, 'evora-temple'), ev = path.join(dir, 'Evidence'), mk = (name, buf) => { fs.mkdirSync(ev, { recursive: true }); fs.writeFileSync(path.join(ev, name), buf); return `Evidence/${name}` }
  const lavfi = (name, ...extra) => { const f = path.join(home, name); const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=200x100', '-frames:v', '1', ...extra, f]); assert.equal(r.status, 0, String(r.stderr)); return fs.readFileSync(f) }
  const tiff = o => Buffer.concat([Buffer.from('MM\0*\0\0\0\x08\0\x01\x01\x12\0\x03\0\0\0\x01', 'latin1'), Buffer.from([0, o, 0, 0]), Buffer.alloc(4)])
  const withExif = (jpg, o) => { const a = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff(o), Buffer.from('GPS 38.57 -7.90')]); return Buffer.concat([jpg.subarray(0, 2), Buffer.from([0xff, 0xe1, (a.length + 2) >> 8, (a.length + 2) & 255]), a, jpg.subarray(2)]) }
  const plain = lavfi('p.jpg'), flat = mk('flat.jpg', withExif(plain, 1)), turned = mk('turned.jpg', withExif(plain, 6))
  const before = fs.readFileSync(path.join(dir, flat))
  const a = await cleanCopy(dir, flat), b = await cleanCopy(dir, turned)
  for (const x of [a, b]) { const t = fs.readFileSync(x.abs).toString('latin1'); assert.ok(!/Exif|GPS 38/.test(t), x.rel); assert.ok(x.rel.startsWith('.osint/cache/send/')) }
  assert.deepEqual(imageSize(fs.readFileSync(a.abs)), { width: 200, height: 100 })
  assert.deepEqual(imageSize(fs.readFileSync(b.abs)), { width: 100, height: 200 }, 'orientation applied in the pixels')
  assert.deepEqual(fs.readFileSync(path.join(dir, flat)), before)
  const chunk = (type, data) => { const h = Buffer.concat([Buffer.from(type, 'latin1'), data]), n = Buffer.alloc(4), c = Buffer.alloc(4); n.writeUInt32BE(data.length); c.writeUInt32BE(crc32(h)); return Buffer.concat([n, h, c]) }
  const png = lavfi('p.png'), at = 8 + 25, pngx = mk('x.png', Buffer.concat([png.subarray(0, at), chunk('eXIf', Buffer.concat([tiff(1), Buffer.from('GPS 38.57')])), png.subarray(at)]))
  const c = await cleanCopy(dir, pngx)
  assert.ok(!fs.readFileSync(c.abs).includes('eXIf') && !fs.readFileSync(c.abs).includes('GPS 38'))
  assert.match(fs.readFileSync(path.join(dir, 'Journal.md'), 'utf8'), /· send · Evidence\/turned\.jpg sent as a copy without its metadata/)
  const old = process.env.PATH
  process.env.PATH = path.dirname(process.execPath)
  try {
    fs.rmSync(path.join(dir, '.osint', 'cache', 'send'), { recursive: true })
    await assert.rejects(cleanCopy(dir, turned), e => e.code === 3 && /ffmpeg is missing/.test(e.message))
    assert.ok(!fs.existsSync(path.join(dir, '.osint', 'cache', 'send')) || !fs.readdirSync(path.join(dir, '.osint', 'cache', 'send'), { recursive: true }).some(f => String(f).endsWith('turned.jpg')))
  } finally { process.env.PATH = old }
})
