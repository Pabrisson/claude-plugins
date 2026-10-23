// Boots a project's scene in a page (render, stills, preview): the job, GSAP, the fonts, the stage, source/scene.js,
// and the actors layer when the project has an actors/ folder. seek(t) puts the page exactly at a video time;
// the render page then captures the stage, the preview just shows it.
import { camera, captions, clip, paper, picker, rng } from './kit.js'
import { createActors } from './runtime.js'
import { makeTimeline } from './timeline.js'

const GSAP = ['gsap', 'CustomEase', 'CustomWiggle', 'SplitText', 'DrawSVGPlugin', 'MotionPathPlugin', 'MorphSVGPlugin', 'ScrambleTextPlugin', 'TextPlugin']
const pad = n => String(n).padStart(5, '0')

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

// What a viewer reads right now, in reading order, when the scene declares nothing with say(). A block's own text
// (its text and inline children, not its child blocks), measured on the glyphs: visible, at least 60 % inside the
// stage and its clipping ancestors (masks, windows, sliding panels), not faint (opacity under 0.4), not tiny (under
// ~24 px on 1080 once scaled: labels, metadata). data-say="…" gives a group's text, data-say="" leaves decoration out.
// ponytail: no occlusion test (opacity 0 layers catch the hit test), a text under an opaque card still counts
function visibleTexts(stage) {
  const sr = stage.getBoundingClientRect(), k = sr.width / stage.offsetWidth || 1, short = Math.min(stage.offsetWidth, stage.offsetHeight)
  const block = el => !getComputedStyle(el).display.startsWith('inline')
  const own = el => [...el.childNodes].flatMap(n => (n.nodeType === 3 ? [n] : n.nodeType === 1 && !block(n) && !n.hasAttribute('data-say') ? own(n) : []))
  const rects = n => { const r = document.createRange(); r.selectNodeContents(n); return [...r.getClientRects()] }
  // the font size as seen: times every scale up the tree (rotations do not count)
  const seen = el => {
    let size = parseFloat(getComputedStyle(el).fontSize)
    for (let p = el; p && p !== stage; p = p.parentElement) {
      const t = getComputedStyle(p).transform
      if (t !== 'none') { const m = new DOMMatrix(t); size *= Math.hypot(m.a, m.b) }
    }
    return size
  }
  const found = []
  for (const el of stage.querySelectorAll('*')) {
    const group = el.closest('[data-say]'), say = el.getAttribute('data-say')
    if ((group && group !== el) || say === '' || el.closest('.ve-captions') || (say == null && !block(el))) continue
    const nodes = say == null ? own(el) : null, inked = nodes?.filter(n => n.textContent.trim())
    if (inked && !inked.length) continue
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
    if (inked && Math.max(...new Set(inked.map(n => n.parentElement)).values().map(seen)) < 0.022 * short) continue
    const boxes = inked ? inked.flatMap(rects) : [el.getBoundingClientRect()]
    if (!boxes.length) continue
    let [l, t, r, b] = [Math.min(...boxes.map(x => x.left)), Math.min(...boxes.map(x => x.top)), Math.max(...boxes.map(x => x.right)), Math.max(...boxes.map(x => x.bottom))]
    const area = (r - l) * (b - t)
    if (!area) continue
    let o = 1
    for (let p = el; p && p !== stage; p = p.parentElement) {
      const cs = getComputedStyle(p)
      o *= +cs.opacity
      if (p !== el && (cs.overflow !== 'visible' || cs.clipPath !== 'none')) {
        const q = p.getBoundingClientRect()
        ;[l, t, r, b] = [Math.max(l, q.left), Math.max(t, q.top), Math.min(r, q.right), Math.min(b, q.bottom)]
      }
    }
    ;[l, t, r, b] = [Math.max(l, sr.left), Math.max(t, sr.top), Math.min(r, sr.right), Math.min(b, sr.bottom)]
    if (o < 0.4 || Math.max(0, r - l) * Math.max(0, b - t) < 0.6 * area) continue
    // a wall of the same words is one text
    const text = (say ?? nodes.map(n => n.textContent).join('')).replace(/\s+/g, ' ').trim().replace(/^(.{4,}?)(?:\s*\1)+$/, '$1')
    if (text) found.push([Math.round((t - sr.top) / k / (0.03 * short)), l, text])
  }
  return [...new Set(found.sort((x, y) => x[0] - y[0] || x[1] - y[1]).map(x => x[2]))]
}

export async function boot(host, query) {
  const r = await fetch(`api/job?${new URLSearchParams({ format: query.format, type: query.type })}`), job = await r.json()
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
  const tl = gsap.timeline({ paused: true }), ticks = [], cues = [], says = [], live = []
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
    at: s => (noSource ? s : time.toVideo(s)),
    source: v => time.toSource(v),
    pick: picker(job.logical),
    asset: p => `project/assets/${p}`,
    num, rng,
    frame: t => Math.round(t * job.fps) / job.fps,
    tick: f => ticks.push(f),
    cue: (kind, t, o = {}) => cues.push({ kind, t: Math.round(t * 1000) / 1000, ...o }),
    say: (text, t0, t1) => says.push({ w: String(text).replace(/\s+/g, ' ').trim(), v0: Math.round(t0 * 1000) / 1000, v1: Math.round(t1 * 1000) / 1000 }),
    camera: () => { const c = camera(job, time); if (c) live.push(c); return c },
    clip: (id, start) => { const c = clip(job, id, start); live.push(c); return c },
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
    says: () => says.map(x => ({ ...x, v0: onVideo(x.v0), v1: onVideo(x.v1) })).filter(x => x.v1 > x.v0).toSorted((a, b) => a.v0 - b.v0),
    texts: () => visibleTexts(stage),
    actors: v => actors?.live(v) ?? [],
    // one image per beat: where tweens start, once they have played a little
    beats() {
      const at = c => c.startTime() + (c.parent && c.parent !== tl ? at(c.parent) : 0)
      const starts = tl.getChildren(true, true, true).map(at)
      const vs = [...new Set(starts.filter(kept).map(s => Math.min(job.duration - 0.05, onVideo(s) + 0.4)))].sort((a, b) => a - b)
      const kept = vs.filter((v, i) => i === 0 || v - vs[i - 1] >= 0.6)
      const step = Math.ceil(kept.length / 30)
      return (kept.length ? kept : [0.5]).filter((_, i) => i % step === 0)
    },
  }
}
