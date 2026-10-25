// Boots a project's scene in a page (render, stills, preview): the job, GSAP, the fonts, the stage, source/scene.js,
// and the actors layer when the project has an actors/ folder. seek(t) puts the page exactly at a video time;
// the render page then captures the stage, the preview just shows it.
import { camera, captions, clip, paper, picker, rng } from './kit.js'
import { createActors, resolveActors } from './runtime.js'
import { makeTimeline } from './timeline.js'

const GSAP = ['gsap', 'CustomEase', 'CustomWiggle', 'SplitText', 'DrawSVGPlugin', 'MotionPathPlugin', 'MorphSVGPlugin', 'ScrambleTextPlugin', 'TextPlugin']
const pad = n => String(n).padStart(5, '0')
const ms = x => Math.round(x * 1000) / 1000

const script = src => new Promise((ok, ko) => {
  const s = document.createElement('script')
  s.src = src
  s.onload = ok
  s.onerror = () => ko(new Error(`cannot load ${src}`))
  document.head.append(s)
})
const stylesheet = href => new Promise(ok => {
  const l = document.createElement('link')
  l.rel = 'stylesheet'
  l.href = href
  l.onload = l.onerror = ok
  document.head.append(l)
})
const fontsLoaded = () => Promise.all([...document.fonts].filter(f => f.status === 'unloaded').map(f => f.load().catch(() => {})))
const bitmap = async url => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return createImageBitmap(await r.blob())
}

// Every block of text on the stage now: its own text (its text and inline children, not its child blocks), or a
// data-say="…" group's; data-say="" is decoration and never counts. Its glyphs' box clipped by its masks and windows
// (sliding panels), then by the stage, in stage pixels; `shown`, the share of its glyphs left visible; `inFrame`, the
// share of what its masks show that the stage shows too (under 1: the frame cuts it); its size as seen (times every
// scale up the tree; null for a group); its opacity; `caption` for the captions().
// ponytail: no occlusion test (opacity 0 layers catch the hit test), a text under an opaque card still counts
function textBoxes(stage) {
  const sr = stage.getBoundingClientRect(), k = sr.width / stage.offsetWidth || 1
  const block = el => !getComputedStyle(el).display.startsWith('inline')
  const own = el => [...el.childNodes].flatMap(n => (n.nodeType === 3 ? [n] : n.nodeType === 1 && !block(n) && !n.hasAttribute('data-say') ? own(n) : []))
  const rects = n => { const r = document.createRange(); r.selectNodeContents(n); return [...r.getClientRects()] }
  const seen = el => {
    let size = parseFloat(getComputedStyle(el).fontSize)
    for (let p = el; p && p !== stage; p = p.parentElement) {
      const t = getComputedStyle(p).transform
      if (t !== 'none') { const m = new DOMMatrix(t); size *= Math.hypot(m.a, m.b) }
    }
    return size
  }
  const area = ([l, t, r, b]) => Math.max(0, r - l) * Math.max(0, b - t)
  const found = []
  for (const el of stage.querySelectorAll('*')) {
    const group = el.closest('[data-say]'), say = el.getAttribute('data-say')
    if ((group && group !== el) || say === '' || (say == null && !block(el))) continue
    const nodes = say == null ? own(el) : null, inked = nodes?.filter(n => n.textContent.trim())
    if (inked && !inked.length) continue
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
    const boxes = inked ? inked.flatMap(rects) : [el.getBoundingClientRect()]
    if (!boxes.length) continue
    const glyphs = [Math.min(...boxes.map(x => x.left)), Math.min(...boxes.map(x => x.top)), Math.max(...boxes.map(x => x.right)), Math.max(...boxes.map(x => x.bottom))]
    if (!area(glyphs)) continue
    let o = 1, [l, t, r, b] = glyphs
    for (let p = el; p && p !== stage; p = p.parentElement) {
      const cs = getComputedStyle(p)
      o *= +cs.opacity
      if (p !== el && (cs.overflow !== 'visible' || cs.clipPath !== 'none')) {
        const q = p.getBoundingClientRect()
        ;[l, t, r, b] = [Math.max(l, q.left), Math.max(t, q.top), Math.min(r, q.right), Math.min(b, q.bottom)]
      }
    }
    const masked = [l, t, r, b], framed = [Math.max(l, sr.left), Math.max(t, sr.top), Math.min(r, sr.right), Math.min(b, sr.bottom)]
    // a wall of the same words is one text
    const text = (say ?? nodes.map(n => n.textContent).join('')).replace(/\s+/g, ' ').trim().replace(/^(.{4,}?)(?:\s*\1)+$/, '$1')
    if (!text) continue
    found.push({
      text, o, caption: !!el.closest('.ve-captions'), size: inked ? Math.max(...new Set(inked.map(n => n.parentElement)).values().map(seen)) : null,
      shown: area(framed) / area(glyphs), inFrame: area(masked) ? area(framed) / area(masked) : 1,
      box: framed.map((x, i) => (x - (i % 2 ? sr.top : sr.left)) / k),
    })
  }
  return found
}

// What a viewer reads right now, in reading order, when the scene declares nothing with say(): visible, at least
// 60 % shown, not faint (opacity under 0.4), not tiny (under ~24 px on 1080 once scaled: labels, metadata), not the
// captions.
function visibleTexts(stage) {
  const short = Math.min(stage.offsetWidth, stage.offsetHeight)
  const found = textBoxes(stage).filter(x => !x.caption && x.o >= 0.4 && x.shown >= 0.6 && !(x.size !== null && x.size < 0.022 * short))
  return [...new Set(found.map(x => [Math.round(x.box[1] / (0.03 * short)), x.box[0], x.text]).sort((x, y) => x[0] - y[0] || x[1] - y[1]).map(x => x[2]))]
}

// What check flags at this instant, as [kind, what]: 'zone', a text in the platforms' interface (9:16: 14 % at the
// top, 22 % at the bottom, 13 % on the right, 6 % on the left); 'small', a text under ~24 px at 1080 once scaled;
// 'cut', a text the frame cuts (display type, 130 px and more, may cross it); 'face', a text over a face the camera
// shows. Only texts a viewer reads count: opacity 0.4 and more, 60 % shown.
function layoutIssues(stage, faces) {
  const W = stage.offsetWidth, H = stage.offsetHeight, short = Math.min(W, H), out = []
  const zones = H > 1.6 * W ? [[0, 0, W, 0.14 * H], [0, 0.78 * H, W, H], [0.87 * W, 0, W, H], [0, 0, 0.06 * W, H]] : []
  const inter = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const area = a => inter(a, a)
  for (const x of textBoxes(stage)) {
    if (x.o < 0.4) continue
    const what = x.caption ? 'the captions' : `"${x.text.length > 60 ? `${x.text.slice(0, 57)}…` : x.text}"`, display = x.size >= 0.12 * short
    if (!display && x.inFrame > 0.05 && x.inFrame < 0.97) out.push(['cut', what])
    if (x.shown < 0.6) continue
    if (x.size !== null && x.size < 0.022 * short) out.push(['small', what])
    if (!(display && x.inFrame < 0.97) && zones.some(z => inter(x.box, z) > 0.1 * area(x.box))) out.push(['zone', what])
    if (faces.some(f => inter(x.box, f) > 0.15 * area(f))) out.push(['face', what])
  }
  return out
}

export async function boot(host, query) {
  const r = await fetch(`api/job?${new URLSearchParams({ format: query.format, type: query.type, thumbnail: query.thumbnail ?? '' })}`), job = await r.json()
  if (!r.ok) throw new Error(job.error)
  for (const s of GSAP) await script(`engine/node_modules/gsap/dist/${s}.min.js`)
  const { gsap } = window
  gsap.registerPlugin(...GSAP.slice(1).map(n => window[n]))

  // fonts: the engine's Inter, the style's files (look.fonts: { family: file }), then what scene.css declares
  const look = job.style.look
  for (const [family, url] of [['Inter', 'engine/fonts/inter-latin.woff2'], ['Inter', 'engine/fonts/inter-latin-ext.woff2'],
    ...Object.entries(look.fonts ?? {}).map(([f, file]) => [f, `project/source/${file}`])]) document.fonts.add(new FontFace(family, `url(${url})`, { weight: '100 900' }))
  if (job.scene.css) await stylesheet(`project/source/scene.css?t=${job.scene.mtime}`)
  await fontsLoaded()

  const [W, H] = job.logical, time = makeTimeline(job.timeline), segs = job.timeline?.segments
  const stage = document.createElement('div')
  stage.id = 'stage'
  stage.dataset.format = job.format
  stage.className = H > 1.6 * W ? 'portrait tall' : H > W ? 'portrait' : H === W ? 'square' : 'landscape'
  // the style as CSS variables: var(--accent), var(--font)…
  const vars = Object.entries(look.palette).map(([k, v]) => `--${k}:${v};`).join('') + `--font:"${look.font}",Inter,system-ui,sans-serif;`
  stage.style.cssText = `${vars}position:relative;overflow:hidden;width:${W}px;height:${H}px;font-family:var(--font);color:var(--ink);background:var(--paper)`
  host.replaceChildren(stage)

  const fmt = {}, num = (n, d = 0) => (fmt[d] ??= new Intl.NumberFormat(job.style.creator.lang, { minimumFractionDigits: d, maximumFractionDigits: d })).format(n)
  const words = job.words.filter(w => !w.screen && (!segs || segs.some(([a, b]) => w.t1 > a && w.t0 < b))).map(w => ({ ...w, v0: time.toVideo(w.t0), v1: time.toVideo(w.t1) }))
  const tl = gsap.timeline({ paused: true }), ticks = [], cues = [], says = [], parts = [], live = [], clips = []
  // Without a source the scene runs on its own time and a cut (edit.json) removes ranges of it: the frame at video
  // time v shows the scene at toSource(v), and its cues, lines and beats come back on video time
  const noSource = !job.source, sceneAt = v => (noSource ? time.toSource(v) : v), onVideo = t => Math.round((noSource ? time.toVideo(t) : t) * 1000) / 1000
  const kept = t => !noSource || !segs || segs.some(([a, b]) => t >= a && t < b)

  // the optional actors: a full-stage canvas at (0, 0), drawn at the output resolution
  let actors = null, actorsEl = null
  if (job.actors) {
    actorsEl = document.createElement('canvas')
    ;[actorsEl.width, actorsEl.height] = job.size
    actorsEl.className = 've-actors'
    actorsEl.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;pointer-events:none`
    actors = await createActors(job.actors, job, time, {
      image: src => bitmap(`project/${src}`),
      media: (id, n) => bitmap(`project/.cache/media/${id}/${pad(n)}.jpg`),
    })
  }

  const api = {
    stage, W, H, gsap, tl, words,
    format: job.format, formats: job.formats, fps: job.fps, duration: noSource ? job.scene.duration : job.duration, style: job.style, variant: +query.variant || 0,
    // true when drawing the YouTube thumbnail (video.mjs thumbnail): one composed frame in 16:9
    thumbnail: !!job.thumbnail,
    at: s => (noSource ? s : time.toVideo(s)),
    source: v => time.toSource(v),
    pick: picker(job.logical),
    asset: p => `project/assets/${p}`,
    num, rng,
    frame: t => Math.round(t * job.fps) / job.fps,
    tick: f => ticks.push(f),
    cue: (kind, t, o = {}) => cues.push({ kind, t: Math.round(t * 1000) / 1000, ...o }),
    // what the studio's Clip tab shows: a sequence, a title, a counter… on the palette color `field` when given
    part: (kind, t0, t1, o = {}) => parts.push({ kind, t0: Math.round(t0 * 1000) / 1000, t1: Math.round(t1 * 1000) / 1000, ...o, ...(look.palette[o.field] ? { color: look.palette[o.field] } : {}) }),
    say: (text, t0, t1) => says.push({ w: String(text).replace(/\s+/g, ' ').trim(), v0: Math.round(t0 * 1000) / 1000, v1: Math.round(t1 * 1000) / 1000 }),
    camera: () => { const c = camera(job, time); if (c) live.push(c); return c },
    // a synced media plays along the source to the end, silent: the source carries its sound
    clip: (id, start = 0) => {
      const c = clip(job, id, start, time), m = job.media[id], synced = m.sync != null && !noSource
      live.push(c)
      parts.push({ kind: 'clip', t0: start, t1: synced ? job.duration : start + m.count / m.fps, id })
      if (!synced) clips.push({ id, start })
      return c
    },
    captions: o => { const c = captions(job, words, o); live.push(c); return c },
    paper: () => paper(job),
    actors: () => actorsEl,
  }
  const mod = await import(`${new URL('project/source/scene.js', location.href)}?t=${job.scene.mtime}`)
  await mod.default(api)
  if (actorsEl && !actorsEl.isConnected) stage.append(actorsEl)
  await fontsLoaded()
  // only the timeline moves things, at the frame's time: nothing runs on the wall clock
  gsap.ticker.sleep()
  for (const c of stage.querySelectorAll('canvas')) {
    if (c.offsetLeft || c.offsetTop) console.warn(`canvas ${c.id || c.className || ''} is placed by layout (${c.offsetLeft}, ${c.offsetTop}): it renders blank. Put it at left:0;top:0 and move it with transforms`)
  }

  async function seek(v) {
    const s = sceneAt(v)
    tl.seek(s, true)
    for (const a of document.getAnimations()) {
      a.pause()
      a.currentTime = s * 1000
    }
    for (const f of ticks) f(s)
    await Promise.all([...live.map(x => x.update(s)), actors?.frame(actorsEl.getContext('2d'), v)])
  }
  await seek(0)

  return {
    job, api, stage, tl, seek,
    cues: () => cues.filter(c => kept(c.t)).map(c => ({ ...c, t: onVideo(c.t) })).toSorted((a, b) => a.t - b.t),
    parts: () => parts.map(x => ({ ...x, t0: onVideo(x.t0), t1: onVideo(x.t1) })).filter(x => x.t1 > x.t0).toSorted((a, b) => a.t0 - b.t0),
    says: () => says.map(x => ({ ...x, v0: onVideo(x.v0), v1: onVideo(x.v1) })).filter(x => x.v1 > x.v0).toSorted((a, b) => a.v0 - b.v0),
    // what the media make heard, in video seconds: { id, t, from (seconds into the clip), dur }. A clip() plays from
    // its start (without a source, a cut inside it skips that part of its sound as of its picture), a media actor
    // from its entrance through its exit
    clips() {
      const len = id => job.media[id].count / job.media[id].fps, spans = noSource && segs ? segs : [[0, Infinity]]
      const scene = clips.flatMap(({ id, start }) => spans.map(([a, b]) => [Math.max(a, start), Math.min(b, start + len(id))]).filter(([a, b]) => b > a)
        .map(([a, b]) => ({ id, t: onVideo(a), from: ms(a - start), dur: ms(b - a) })))
      const acted = resolveActors(job.actors ?? [], job.format).filter(a => a.type === 'media' && job.media?.[a.media]).map(a => {
        const t = time.toVideo(a.from ?? 0), from = a.offset ?? 0, end = a.to === undefined ? job.duration : time.toVideo(a.to) + (a.post ?? 0.3)
        return { id: a.media, t: ms(t), from, dur: ms(Math.min(len(a.media) - from, end - t)) }
      })
      return [...scene, ...acted].filter(x => x.dur > 0).toSorted((a, b) => a.t - b.t)
    },
    texts: () => visibleTexts(stage),
    // the faces the cameras show now, in stage pixels, then what check flags
    layout() {
      const sr = stage.getBoundingClientRect(), k = sr.width / stage.offsetWidth || 1
      // a face counts when nothing opaque covers its center: the first thing there is the camera, not a card over it
      // (a layer at opacity 0 takes the hit test too: only a solid one hides)
      const solid = e => {
        let o = 1
        for (let p = e; p && p !== stage; p = p.parentElement) o *= +getComputedStyle(p).opacity
        const bg = getComputedStyle(e).backgroundColor
        return o >= 0.9 && (/^(IMG|VIDEO|CANVAS)$/.test(e.tagName) || (bg !== 'rgba(0, 0, 0, 0)' && +(bg.match(/[\d.]+/g)?.[3] ?? 1) >= 0.9))
      }
      const seen = (cam, x, y) => {
        for (const e of document.elementsFromPoint(x, y)) {
          if (cam.contains(e)) return true
          if (!e.contains(cam) && stage.contains(e) && solid(e)) return false
        }
        return false
      }
      const faces = live.filter(c => c.face).map(c => [c, c.face()]).filter(([c, f]) => f && seen(c, (f[0] + f[2]) / 2, (f[1] + f[3]) / 2))
        .map(([, f]) => [f[0] - sr.left, f[1] - sr.top, f[2] - sr.left, f[3] - sr.top].map(x => x / k))
      return layoutIssues(stage, faces)
    },
    actors: v => actors?.live(v) ?? [],
    // one image per beat: where tweens start, once they have played a little
    beats() {
      const at = c => c.startTime() + (c.parent && c.parent !== tl ? at(c.parent) : 0)
      const starts = tl.getChildren(true, true, true).map(at)
      const vs = [...new Set(starts.filter(kept).map(s => Math.min(job.duration - 0.05, onVideo(s) + 0.4)))].sort((a, b) => a - b)
      const spaced = vs.filter((v, i) => i === 0 || v - vs[i - 1] >= 0.6)
      const step = Math.max(1, Math.ceil(spaced.length / 30))
      return (spaced.length ? spaced : [0.5]).filter((_, i) => i % step === 0)
    },
  }
}
