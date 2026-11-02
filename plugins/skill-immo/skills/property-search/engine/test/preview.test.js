import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import test from 'node:test'
import { circle } from '../lib/geo.js'
import { decodePng, draw, encodePng, frame, km2, SIZE } from '../lib/preview.js'

const point = [4.8455, 45.756], zone = { kind: 'radius', center: point, radius_m: 500, geometry: circle(point, 500) }

test("a zone's frame keeps the picture's proportions around it, and its surface", () => {
  const [x0, y0, x1, y1] = frame(zone)
  assert.ok(Math.abs((x1 - x0) / (y1 - y0) - SIZE[0] / SIZE[1]) < 0.01)
  // a 500 m circle: π × 0.25 km² (its 64 corners a hair less)
  assert.ok(Math.abs(km2(zone) - Math.PI * 0.25) < 0.01, `${km2(zone)}`)
})

test('the zone is drawn on its basemap: a light fill inside, the outline, the place, the rest untouched', () => {
  const blank = { width: SIZE[0], height: SIZE[1], rgb: Buffer.alloc(SIZE[0] * SIZE[1] * 3, 200) }
  const png = encodePng(draw(blank, zone, point, frame(zone))), img = decodePng(png)
  const px = (x, y) => [...img.rgb.subarray((y * img.width + x) * 3, (y * img.width + x) * 3 + 3)]
  assert.deepEqual([img.width, img.height], SIZE)
  assert.deepEqual(px(5, 5), [200, 200, 200], 'a corner, outside')
  assert.deepEqual(px(500, 350), [37, 99, 235], 'the place, in the middle')
  const inside = px(500, 250)
  assert.ok(inside[2] > inside[0] && inside[0] < 200, `filled: ${inside}`)
  // the outline crosses the middle row once on each side
  const row = Array.from({ length: SIZE[0] }, (_, x) => px(x, 350)[0] === 37)
  assert.ok(row.slice(0, 500).some(Boolean) && row.slice(501).some(Boolean))
})

test('a palette PNG decodes to RGB, its filters undone', () => {
  // 2×2, palette of red and white, rows filtered None then Up
  const head = Buffer.alloc(13)
  head.writeUInt32BE(2, 0); head.writeUInt32BE(2, 4); head[8] = 8; head[9] = 3
  const chunk = (k, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length); b.write(k, 4); d.copy(b, 8); b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + d.length)), 8 + d.length); return b }
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('PLTE', Buffer.from([255, 0, 0, 255, 255, 255])),
    chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0, 1, 2, 1, 255]))), chunk('IEND', Buffer.alloc(0))])
  assert.deepEqual([...decodePng(png).rgb], [255, 0, 0, 255, 255, 255, 255, 255, 255, 255, 0, 0])
})
