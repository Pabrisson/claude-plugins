// Media helpers the case types share: a picture's size, its metadata stripped (the bench's photos), a video's key
// frames (ffmpeg), a video fetched from its page (yt-dlp), boxes painted over (people, before a picture leaves).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { journal, readCase } from './case.js'
import { emit } from './events.js'
import { casePython, packReady } from './python.js'
import { evidence, evidenceFile } from './records.js'
import { fail, hasBin, INSTALL, sha256File } from './util.js'

// EXIF Orientation (tag 0x0112) of a TIFF block at buf[at..]: 1 when the tag is absent, null when the block cannot be read
function tiffOrientation(buf, at) {
  try {
    const le = buf.toString('latin1', at, at + 2) === 'II'
    if (!le && buf.toString('latin1', at, at + 2) !== 'MM') return null
    const u16 = o => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o)), u32 = o => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o))
    const ifd = at + u32(at + 4), n = u16(ifd)
    for (let k = 0; k < n; k++) if (u16(ifd + 2 + k * 12) === 0x0112) { const v = u16(ifd + 2 + k * 12 + 8); return v >= 1 && v <= 8 ? v : null }
    return 1
  } catch { return null }
}

// width and height as DISPLAYED (ffmpeg, detect.py and imgprep.py all turn the picture by its EXIF Orientation: 5 to 8
// swap the sides); null when the format is not read here or the orientation is unreadable (the caller refuses: a mask
// computed on the wrong sides would leave people visible)
function parseImage(buf) {
  let w, h, o = 1
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    w = buf.readUInt32BE(16); h = buf.readUInt32BE(20)
    for (let i = 8; i + 12 <= buf.length;) { // an eXIf chunk may carry an orientation too
      const len = buf.readUInt32BE(i), type = buf.toString('latin1', i + 4, i + 8)
      if (type === 'eXIf') { o = tiffOrientation(buf, i + 8); break }
      if (type === 'IDAT' || type === 'IEND') break
      i += 12 + len
    }
  } else {
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return null
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) return null
      const m = buf[i + 1]
      if (m === 0xff) { i++; continue }
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { i += 2; continue }
      if (m === 0xe1 && buf.toString('latin1', i + 4, i + 10) === 'Exif\0\0') o = tiffOrientation(buf, i + 10)
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) { w = buf.readUInt16BE(i + 7); h = buf.readUInt16BE(i + 5); break }
      i += 2 + buf.readUInt16BE(i + 2)
    }
    if (w === undefined) return null
  }
  return { w, h, o }
}
export function imageSize(buf) {
  const p = parseImage(buf)
  if (!p || p.o === null) return null
  return p.o >= 5 ? { width: p.h, height: p.w } : { width: p.w, height: p.h }
}

// APP1 (EXIF, XMP), APP13 (IPTC, Photoshop) and comments go; JFIF, the colour profile and the image data stay as they were
const DROP = new Set([0xe1, 0xed, 0xfe])
export function stripJpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) fail('not a JPEG: its metadata cannot be stripped here')
  const out = [buf.subarray(0, 2)]
  for (let i = 2; i + 4 <= buf.length;) {
    if (buf[i] !== 0xff) fail('a broken JPEG: a segment does not start with 0xFF')
    const m = buf[i + 1]
    if (m === 0xff) { i++; continue }
    if (m === 0xda || m === 0xd9) { out.push(buf.subarray(i)); return Buffer.concat(out) }
    const end = i + 2 + buf.readUInt16BE(i + 2)
    if (!DROP.has(m)) out.push(buf.subarray(i, end))
    i = end
  }
  fail('a broken JPEG: no image data')
}

const run = (bin, args) => new Promise((ok, ko) => {
  const p = spawn(bin, args, { windowsHide: true })
  let out = '', err = ''
  p.stdout.on('data', d => (out += d))
  p.stderr.on('data', d => (err += d))
  p.on('error', ko)
  p.on('close', code => (code === 0 ? ok({ out, err }) : ko(new Error(`${bin} exited ${code}: ${err.trim().split('\n').slice(-3).join(' ')}`))))
})
// What leaves this machine is never the file as it is: EXIF (GPS, device, time), XMP and IPTC go with it. The clean copy
// is made once under .osint/cache/send/ (JPEG without a turned orientation: its segments cut, pixels untouched; any other
// picture: ffmpeg re-encodes it, applying the orientation in the pixels, no metadata), then checked for what must be
// gone; if it cannot be cleaned (no ffmpeg), exit code 3, never the raw file.
const LEFT = { jpg: [/Exif\0\0/, /ns\.adobe\.com\/xap/], png: [/eXIf/], webp: [/EXIF/, /XMP /] }
export async function cleanCopy(dir, rel) {
  const src = path.join(dir, rel), buf = fs.readFileSync(src), ext = path.extname(rel).toLowerCase()
  const kind = buf[0] === 0xff && buf[1] === 0xd8 ? 'jpg' : buf.readUInt32BE(0) === 0x89504e47 ? 'png' : buf.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : 'other'
  const out = path.join(dir, '.osint', 'cache', 'send', sha256File(src).slice(0, 12), path.basename(rel))
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const o = kind === 'jpg' ? parseImage(buf)?.o : 1
  let how = 'segments cut'
  if (kind === 'jpg' && o === 1) fs.writeFileSync(out, stripJpeg(buf))
  else {
    if (!hasBin('ffmpeg')) fail(`${rel} cannot leave with its metadata (EXIF, GPS) and ffmpeg is missing to clean it: ${INSTALL.ffmpeg}`, 3)
    await run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-map_metadata', '-1', '-fflags', '+bitexact', ...(kind === 'jpg' || ext.startsWith('.jp') ? ['-q:v', '2'] : []), '-frames:v', '1', out]).catch(e => fail(`${rel} cannot leave with its metadata and ffmpeg could not clean it: ${e.message}`, 3))
    how = 'ffmpeg, orientation applied in the pixels'
  }
  const text = fs.readFileSync(out).toString('latin1')
  if ((LEFT[kind] ?? []).some(re => re.test(text))) { fs.rmSync(out, { force: true }); fail(`${rel}: metadata still in the cleaned copy, nothing is sent`, 3) }
  const j = journal(dir, 'send', `${rel} sent as a copy without its metadata (EXIF, GPS, XMP; ${how}): ${path.relative(dir, out).split(path.sep).join('/')}`)
  return { rel: path.relative(dir, out).split(path.sep).join('/'), abs: out, journal: j }
}
const clear = (dir, stem) => { for (const f of fs.readdirSync(dir).filter(n => n.startsWith(`${stem}-`))) fs.rmSync(path.join(dir, f)) }

// key frames of a video: one at each scene change (at most max); a video without cuts (a walk, a pan) gets frames
// evenly spaced, about one every two seconds
export async function frames(video, outDir, { max = 16, scene = 0.3 } = {}) {
  if (!hasBin('ffmpeg')) fail(`key frames need ffmpeg: ${INSTALL.ffmpeg}`, 3)
  fs.mkdirSync(outDir, { recursive: true })
  const stem = path.parse(video).name.replace(/[^\w-]+/g, '-').slice(0, 40) || 'video', pattern = path.join(outDir, `${stem}-%03d.jpg`)
  const pts = err => [...err.matchAll(/pts_time:([\d.]+)/g)].map(m => Number(m[1]))
  clear(outDir, stem)
  // a video without a single cut writes nothing: ffmpeg then exits 234, which only means "no scene change"
  let { err } = await run('ffmpeg', ['-v', 'info', '-y', '-i', video, '-vf', `select='gt(scene,${scene})',showinfo`, '-fps_mode', 'vfr', '-frames:v', String(max), '-q:v', '2', pattern]).catch(e => (/Nothing was written/.test(e.message) ? { err: '' } : Promise.reject(e)))
  let times = pts(err), how = 'scene changes'
  if (times.length < 3) {
    clear(outDir, stem)
    const { out } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video])
    const duration = Number(out.trim()) || max, n = Math.min(max, Math.max(3, Math.round(duration / 2)))
    ;({ err } = await run('ffmpeg', ['-v', 'info', '-y', '-i', video, '-vf', `fps=${n}/${duration},showinfo`, '-frames:v', String(n), '-q:v', '2', pattern]))
    times = pts(err)
    how = 'evenly spaced'
  }
  const files = fs.readdirSync(outDir).filter(f => f.startsWith(`${stem}-`) && f.endsWith('.jpg')).sort()
  return { how, frames: files.map((f, i) => ({ file: path.join(outDir, f), t: times[i] ?? null })) }
}

// a video given by its page (YouTube, X, TikTok…), at most 1080p, with what the page says (title, uploader, date)
export async function ytdlp(url, outDir) {
  if (!hasBin('yt-dlp')) fail(`a video by link needs yt-dlp: ${INSTALL['yt-dlp']} (or download it by hand and give the file)`, 3)
  fs.mkdirSync(outDir, { recursive: true })
  const d = fs.mkdtempSync(path.join(outDir, 'dl-'))
  let made, file
  try {
    await run('yt-dlp', ['--no-playlist', '--no-progress', '--restrict-filenames', '--write-info-json', '-f', 'bv*[height<=1080]+ba/b[height<=1080]/b', '-o', path.join(d, '%(id)s.%(ext)s'), url])
    made = fs.readdirSync(d)
    file = made.find(f => !f.endsWith('.json') && !f.endsWith('.part')) ?? fail(`yt-dlp wrote no video for ${url}`)
  } catch (e) { fs.rmSync(d, { recursive: true, force: true }); throw e } // partials of a failed download do not stay
  const info = made.find(f => f.endsWith('.info.json'))
  return { file: path.join(d, file), info: info ? JSON.parse(fs.readFileSync(path.join(d, info), 'utf8')) : {} }
}

// the download folder (video, info, partials) once Evidence holds its own copy
export const dropDownload = file => { const d = path.dirname(file); if (path.basename(d).startsWith('dl-')) fs.rmSync(d, { recursive: true, force: true }) }

// boxes [x, y, w, h] in the picture's pixels: flat black over each (ffmpeg), else the GeoINT pack's Pillow (imgprep.py
// mask paints with the colours around), else exit code 3
export async function paint(input, output, boxes, { python } = {}) {
  if (hasBin('ffmpeg')) {
    const vf = boxes.map(([x, y, w, h]) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=black:t=fill`).join(',')
    await run('ffmpeg', ['-v', 'error', '-y', '-i', input, '-vf', vf, '-map_metadata', '-1', ...(/\.png$/i.test(output) ? [] : ['-q:v', '2']), output])
    return 'ffmpeg'
  }
  if (python) {
    const r = await python('imgprep.py', ['mask', input, ...boxes.flatMap(([x, y, w, h]) => ['--box', `${x},${y},${x + w},${y + h}`]), '--out', output], { tool: false, label: 'mask' })
    if (r.code !== 0 || !fs.existsSync(output)) fail(`imgprep.py mask failed: ${r.err.trim().split('\n').pop()}`)
    return 'pillow'
  }
  fail(`masking needs ffmpeg (${INSTALL.ffmpeg}) or the GeoINT pack (osint.mjs setup geoint)`, 3)
}

// evidence mask E01 --box x,y,w,h… [--people]: a copy of the picture with the boxes painted out, recorded as evidence of
// its original (kind masked, its boxes kept): the file reverse may send. --people adds the persons and faces the GeoINT
// pack's detector finds (detect.py with OWLv2); the agent still looks, a detector misses people
export async function maskEvidence(dir, ref, { boxes = [], people = false } = {}) {
  const rel = evidenceFile(dir, ref), abs = path.join(dir, rel), entry = readCase(dir).evidence.find(e => e.file === rel)
  const id = entry?.id ?? path.posix.basename(rel).replace(/\.[^.]+$/, '')
  const size = imageSize(fs.readFileSync(abs)) ?? fail(`${rel}: a JPEG or a PNG with a readable orientation (convert it first, or give the boxes after a look: nothing is masked on a guess)`)
  const own = boxes.map(b => {
    const v = String(b).split(',').map(Number)
    if (v.length !== 4 || v.some(n => !Number.isFinite(n) || n < 0)) fail(`--box ${b}: x,y,w,h in pixels`)
    if (v[0] >= size.width || v[1] >= size.height) fail(`--box ${b} is outside the ${size.width}×${size.height} picture`)
    return v.map(Math.round)
  })
  let found = []
  if (people) {
    const r = await casePython(dir, 'detect.py', [abs, '--out-dir', `people/${id}`, '--classes', 'a person,a face', '--threshold', '0.15'], { tool: false, label: 'people' })
    if (r.code !== 0) fail(`detect.py did not run (exit ${r.code}): give --box x,y,w,h yourself`)
    const dets = JSON.parse(fs.readFileSync(path.join(dir, '.osint', 'geoint', 'people', id, 'detect.json'), 'utf8')).detections ?? []
    found = dets.map(d => { const [x0, y0, x1, y1] = d.box, pw = Math.round((x1 - x0) * 0.08), ph = Math.round((y1 - y0) * 0.08); return [x0 - pw, y0 - ph, x1 - x0 + 2 * pw, y1 - y0 + 2 * ph] })
  }
  const all0 = [...own, ...found].map(([x, y, w, h]) => { const x0 = Math.max(0, x), y0 = Math.max(0, y); return [x0, y0, Math.min(size.width, x + w) - x0, Math.min(size.height, y + h) - y0] })
  const all = all0.filter(([, , w, h]) => w > 0 && h > 0), dropped = all0.length - all.length // a box wholly outside the picture: said, never silent
  if (!all.length) fail(people ? 'the detector found nobody: look yourself; with no one there, declare it clear (reverse --no-people or recon --no-people), else --box x,y,w,h' : "no box: --box x,y,w,h (your read of the picture), or --people (the GeoINT pack's detector)")
  const ext = /\.png$/i.test(rel) ? '.png' : '.jpg', tmp = path.join(dir, '.osint', 'cache', `mask-${id}${ext}`)
  fs.mkdirSync(path.dirname(tmp), { recursive: true })
  const tool = await paint(abs, tmp, all, { python: packReady() ? (s, a, o) => casePython(dir, s, a, o) : null })
  const e = await evidence(dir, tmp, { of: id, kind: 'masked', name: `${id}-masked${ext}`, boxes: all })
  fs.rmSync(tmp, { force: true })
  const j = journal(dir, 'mask', `${e.id} = ${id} with ${all.length} box${all.length > 1 ? 'es' : ''} painted out (${tool}${people ? `; ${found.length} found by detect.py` : ''}${dropped ? `; ${dropped} box${dropped > 1 ? 'es' : ''} outside the ${size.width}×${size.height} picture left out` : ''})`)
  emit(dir, { kind: 'log', text: `${e.id}: ${id} masked`, journal: j })
  return { ...e, of: id, boxes: all, tool, detected: found.length, dropped }
}
