// A picture of a search's zone, for the user to agree on before the search runs: the zone over IGN's Plan IGN (the
// Géoplateforme's WMS, free and keyless), its outline and a light fill, the searched place marked. A PNG made with
// zlib alone, no dependency.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { ringsOf } from './geo.js'

const WMS = 'https://data.geopf.fr/wms-r/wms'
const UA = 'skill-immo/1.0 (+https://github.com/Pabrisson/claude-plugins)'
export const SIZE = [1000, 700]
const BLUE = [37, 99, 235], WHITE = [255, 255, 255]
const merc = ([lon, lat]) => [6378137 * lon * Math.PI / 180, 6378137 * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))]

// the map's frame in Web Mercator meters: the zone's box, a margin of 15 % of its larger side, grown to the picture's
// proportions
export function frame(zone) {
  const pts = ringsOf(zone.geometry).flat().map(merc), xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
  let [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
  const pad = Math.max(x1 - x0, y1 - y0, 200) * 0.15, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2
  let w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad
  if (w / h > SIZE[0] / SIZE[1]) h = w * SIZE[1] / SIZE[0]
  else w = h * SIZE[0] / SIZE[1]
  return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2].map(Math.round)
}

// the zone's surface in km² (its outer rings, Mercator shrunk back at its latitude)
export function km2(zone) {
  return ringsOf(zone.geometry).reduce((sum, ring) => {
    const k = Math.cos(ring[0][1] * Math.PI / 180) ** 2, p = ring.map(merc)
    return sum + Math.abs(p.reduce((a, [x, y], i) => { const [u, v] = p[(i + 1) % p.length]; return a + x * v - u * y }, 0) / 2) * k
  }, 0) / 1e6
}

// PNG, 8 bits a channel, not interlaced: any color type in, RGB out
const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
export function decodePng(buf) {
  let width, height, type, palette
  const idat = []
  for (let i = 8; i < buf.length;) {
    const len = buf.readUInt32BE(i), kind = buf.toString('ascii', i + 4, i + 8), data = buf.subarray(i + 8, i + 8 + len)
    if (kind === 'IHDR') {
      if (data[8] !== 8 || data[12]) throw new Error('a PNG of 8 bits a channel, not interlaced')
      ;[width, height, type] = [data.readUInt32BE(0), data.readUInt32BE(4), data[9]]
    } else if (kind === 'PLTE') palette = data
    else if (kind === 'IDAT') idat.push(data)
    i += 12 + len
  }
  const n = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type], stride = width * n, raw = zlib.inflateSync(Buffer.concat(idat)), px = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], o = y * stride, r = o + y + 1
    for (let x = 0; x < stride; x++) {
      const a = x >= n ? px[o + x - n] : 0, b = y ? px[o - stride + x] : 0, c = y && x >= n ? px[o - stride + x - n] : 0
      px[o + x] = raw[r + x] + (f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? paeth(a, b, c) : 0)
    }
  }
  // ponytail: transparency ignored (the WMS answers RGB); blend over white if a basemap ever comes with alpha
  const rgb = Buffer.alloc(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    if (type === 3) palette.copy(rgb, i * 3, px[i] * 3, px[i] * 3 + 3)
    else if (n < 3) rgb.fill(px[i * n], i * 3, i * 3 + 3)
    else px.copy(rgb, i * 3, i * n, i * n + 3)
  }
  return { width, height, rgb }
}
const chunk = (kind, data) => {
  const b = Buffer.alloc(12 + data.length)
  b.writeUInt32BE(data.length, 0)
  b.write(kind, 4, 'ascii')
  data.copy(b, 8)
  b.writeUInt32BE(zlib.crc32(b.subarray(4, 8 + data.length)), 8 + data.length)
  return b
}
export function encodePng({ width, height, rgb }) {
  const raw = Buffer.alloc((width * 3 + 1) * height), head = Buffer.alloc(13)
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3)
  head.writeUInt32BE(width, 0)
  head.writeUInt32BE(height, 4)
  head[8] = 8
  head[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

// The zone drawn on a picture of its frame: a light fill (even-odd, row by row), a 4 px outline, the place's dot
export function draw(img, zone, point, box) {
  const { width: w, height: h, rgb } = img
  const at = p => { const [x, y] = merc(p); return [(x - box[0]) / (box[2] - box[0]) * w, (box[3] - y) / (box[3] - box[1]) * h] }
  const blend = (x, y, color, alpha) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = (y * w + x) * 3
    for (let k = 0; k < 3; k++) rgb[i + k] = Math.round(rgb[i + k] * (1 - alpha) + color[k] * alpha)
  }
  const dot = (cx, cy, r, color) => {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) blend(x, y, color, 1)
  }
  const rings = ringsOf(zone.geometry).map(r => r.map(at))
  for (let y = 0; y < h; y++) {
    const xs = []
    for (const r of rings) for (let i = 0; i < r.length - 1; i++) {
      const [[ax, ay], [bx, by]] = [r[i], r[i + 1]]
      if ((ay <= y + 0.5) !== (by <= y + 0.5)) xs.push(ax + (y + 0.5 - ay) / (by - ay) * (bx - ax))
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x < Math.min(w, xs[k + 1] - 0.5); x++) blend(x, y, BLUE, 0.16)
  }
  for (const r of rings) for (let i = 0; i < r.length - 1; i++) {
    const [[ax, ay], [bx, by]] = [r[i], r[i + 1]], steps = Math.ceil(Math.hypot(bx - ax, by - ay) * 2) || 1
    for (let s = 0; s <= steps; s++) dot(ax + (bx - ax) * s / steps, ay + (by - ay) * s / steps, 2, BLUE)
  }
  if (point) {
    const [x, y] = at(point)
    dot(x, y, 10, WHITE)
    dot(x, y, 7, BLUE)
  }
  return img
}

// the Plan IGN of a frame, kept 30 days under .cache/plan/ (a grey page when the WMS fails, with its error)
async function basemap(box, cacheDir) {
  const file = path.join(cacheDir, 'plan', `${box.join(',')}-${SIZE.join('x')}.png`), st = fs.statSync(file, { throwIfNoEntry: false })
  if (st && Date.now() - st.mtimeMs < 30 * 86400000) return { img: decodePng(fs.readFileSync(file)) }
  try {
    const q = new URLSearchParams({ SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap', LAYERS: 'GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', STYLES: '', CRS: 'EPSG:3857', BBOX: box.join(','), WIDTH: SIZE[0], HEIGHT: SIZE[1], FORMAT: 'image/png' })
    const res = await fetch(`${WMS}?${q}`, { headers: { 'User-Agent': UA } })
    const buf = Buffer.from(await res.arrayBuffer())
    if (!res.ok || !res.headers.get('content-type')?.startsWith('image/png')) throw new Error(`${res.status}: ${buf.toString('utf8', 0, 200)}`)
    const img = decodePng(buf)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, buf)
    return { img }
  } catch (e) {
    return { img: { width: SIZE[0], height: SIZE[1], rgb: Buffer.alloc(SIZE[0] * SIZE[1] * 3, 236) }, error: e.message }
  }
}

// the zone's picture written to `file`: its surface in km², and the basemap's error if it had to do without
export async function preview(zone, point, file, cacheDir) {
  const box = frame(zone), { img, error } = await basemap(box, cacheDir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, encodePng(draw(img, zone, point, box)))
  return { km2: km2(zone), error }
}
