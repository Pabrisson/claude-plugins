// What the engine gives a scene besides GSAP: the camera, word-by-word captions, the paper, sound cues and small
// helpers. Everything here is driven by the frame time, never by the wall clock.
import { paperTexture, rng } from './paper.js'

const clamp = (x, a = 0, b = 1) => Math.min(Math.max(x, a), b)
const pad = n => String(n).padStart(5, '0')

// The camera as an <img> in a clipping box (a canvas inside the captured DOM would not render): each frame shows
// the source frame of that instant, covering the box, its focus (the face with face_framing) at 42 % of the height.
// box.view = { zoom, x, y } can be tweened: zoom > 1 tightens, x/y force a focus in source pixels.
export function camera(job, tl) {
  const S = job.source, faces = job.faces ?? []
  if (!S) return null
  const box = document.createElement('div'), img = new Image(), warm = new Map()
  box.className = 've-camera'
  box.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#000'
  img.style.cssText = 'position:absolute;left:0;top:0;max-width:none;transform-origin:0 0'
  box.append(img)
  box.view = { zoom: 1, x: null, y: null }
  const url = n => `project/frames/cam/${pad(n)}.jpg`
  const frameAt = v => clamp(Math.round(tl.toSource(v) * S.fps) + 1, 1, S.frames)
  const decode = n => {
    if (!warm.has(n)) {
      const i = new Image()
      i.src = url(n)
      warm.set(n, i.decode().catch(() => {}))
      if (warm.size > 24) warm.delete(warm.keys().next().value)
    }
    return warm.get(n)
  }
  // the face at source time s: [x, y of the eyes, its height] in source pixels
  function focusAt(s) {
    if (!faces.length) return [S.width / 2, S.height * 0.42, 0]
    const i = faces.findLastIndex(f => f[0] <= s), a = faces[Math.max(i, 0)], b = faces[Math.min(i + 1, faces.length - 1)]
    const p = b[0] > a[0] ? clamp((s - a[0]) / (b[0] - a[0])) : 0
    return [1, 2, 3].map(k => a[k] + (b[k] - a[k]) * p)
  }
  // the crop of the last update (source pixels at the box's left and top, box pixels per source pixel)
  let crop = null
  box.update = async v => {
    const n = frameAt(v)
    for (let j = 1; j <= 4; j++) decode(frameAt(v + j / job.fps))
    if (img.dataset.n !== String(n)) {
      await decode(n)
      img.src = url(n)
      img.dataset.n = n
      await img.decode().catch(() => {})
    }
    const w = box.clientWidth, h = box.clientHeight
    if (!w || !h) return
    const [fx, fy] = [box.view.x ?? focusAt(tl.toSource(v))[0], box.view.y ?? focusAt(tl.toSource(v))[1]]
    let rw = S.width, rh = S.height
    if (rw / rh > w / h) rw = (rh * w) / h
    else rh = (rw * h) / w
    rw /= box.view.zoom
    rh /= box.view.zoom
    const rx = clamp(fx - rw / 2, 0, S.width - rw), ry = clamp(fy - rh * 0.42, 0, S.height - rh), s = w / rw
    crop = { v, rx, ry, s }
    img.style.width = `${S.width * s}px`
    img.style.height = `${S.height * s}px`
    img.style.transform = `translate(${-rx * s}px, ${-ry * s}px)`
  }
  // the face on screen now, in page pixels (its part inside the box), or null: no face found, not in the box, hidden
  box.face = () => {
    if (!faces.length || !crop || !box.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return null
    const [x, y, fh] = focusAt(tl.toSource(crop.v)), r = box.getBoundingClientRect(), z = (r.width / box.clientWidth) * crop.s
    const cx = r.left + (x - crop.rx) * z, cy = r.top + (y - crop.ry) * z, f = [cx - 0.4 * fh * z, cy - 0.4 * fh * z, cx + 0.4 * fh * z, cy + 0.6 * fh * z]
    const c = [Math.max(f[0], r.left), Math.max(f[1], r.top), Math.min(f[2], r.right), Math.min(f[3], r.bottom)]
    return c[2] > c[0] && c[3] > c[1] && (c[2] - c[0]) * (c[3] - c[1]) >= 0.5 * (f[2] - f[0]) * (f[3] - f[1]) ? c : null
  }
  return box
}

// A clip of edit.json's media (B-roll, screen recording) as frames, playing from `start` (video seconds) at its own
// pace, covering its box; its last frame holds. A synced media (`video.mjs sync`: a second camera) shows instead the
// frame of the source's instant, like the camera, cuts and speed included.
export function clip(job, id, start = 0, tl) {
  const m = job.media?.[id]
  if (!m) throw new Error(`no media ${id} in source/edit.json`)
  const at = m.sync == null || !tl ? v => (v - start) * m.fps : v => (tl.toSource(v) + m.sync - m.from) * m.fps
  const box = document.createElement('div'), img = new Image()
  box.className = 've-clip'
  box.style.cssText = 'position:absolute;inset:0;overflow:hidden;background:#000'
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block'
  box.append(img)
  box.update = async v => {
    const n = clamp(Math.floor(at(v)), 0, m.count - 1) + 1
    if (img.dataset.n === String(n)) return
    img.src = `project/.cache/media/${id}/${pad(n)}.jpg`
    img.dataset.n = n
    await img.decode().catch(() => {})
  }
  return box
}

// Sticker captions of the speech: groups of a few words ending on punctuation or a pause; each word pops in as it
// is said. Style it with CSS on .ve-captions (and .ve-captions span for a word).
export function captions(job, words, { words: per = 3, size = job.style.look.captions.size } = {}) {
  const el = document.createElement('div')
  el.className = 've-captions'
  el.style.cssText = `position:absolute;left:0;right:0;text-align:center;font:900 ${size}px var(--font);color:#fff;line-height:1.1;` +
    `-webkit-text-stroke:${size * 0.2}px var(--ink);paint-order:stroke fill;letter-spacing:-0.01em;filter:drop-shadow(0 6px 10px rgba(20,15,10,.3))`
  const groups = []
  for (const w of words) {
    const g = groups.at(-1), last = g?.at(-1)
    if (!g || g.length >= per || /[.!?,;:…]$/.test(last.w) || w.v0 - last.v1 > 0.35) groups.push([w])
    else g.push(w)
  }
  const ends = groups.map((g, i) => Math.min(g.at(-1).v1 + 0.3, groups[i + 1]?.[0].v0 ?? Infinity))
  let shown = null
  el.update = v => {
    // the line and its words are the frame's: the sub-frames of a motion blur show one line, never two
    const f = Math.round(v * job.fps) / job.fps
    const i = groups.findIndex((g, j) => f >= g[0].v0 && f < ends[j]), g = groups[i]
    if (g !== shown) {
      shown = g
      el.replaceChildren(...(g ?? []).map(w => {
        const s = document.createElement('span')
        s.textContent = w.w
        s.style.cssText = 'display:inline-block;margin:0 .14em'
        return s
      }))
      el.style.transform = g ? `rotate(${((i % 3) - 1) * 1.4}deg)` : ''
    }
    // the word being said pops (×1.18 down to ×1 in 0.12 s): the other words of its line move aside by what it grows
    const spans = [...el.children], on = (g ?? []).map(w => w.v0 <= f + 0.02), grow = (g ?? []).map((w, j) => (on[j] ? 0.18 * (1 - clamp((v - w.v0) / 0.12)) : 0))
    spans.forEach((s, j) => {
      const dx = spans.reduce((a, o, k) => a + (o.offsetTop === s.offsetTop ? Math.sign(j - k) * grow[k] * o.offsetWidth / 2 : 0), 0)
      s.style.visibility = on[j] ? 'visible' : 'hidden'
      s.style.transform = `translateX(${dx}px) scale(${1 + grow[j]})`
    })
  }
  return el
}

// the paper of the style, as a CSS background (url of a texture rendered once)
export async function paper(job) {
  const [w, h] = job.logical, look = job.style.look
  const blob = await paperTexture(w, h, look.palette.paper, look.paper).convertToBlob({ type: 'image/jpeg', quality: 0.92 })
  return `url(${URL.createObjectURL(blob)}) center / cover, ${look.palette.paper}`
}

// pick(landscape, portrait, tall): the value for this format (portrait = 4:5 and up, tall = 9:16)
export const picker = ([w, h]) => (land, port = land, tall = port) => (h <= w ? land : h > 1.6 * w ? tall : port)

export { rng }
