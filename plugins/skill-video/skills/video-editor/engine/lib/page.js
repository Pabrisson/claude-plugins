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

// texts a viewer can read right now: blocks with their own text, visible, inside the stage
function visibleTexts(stage) {
  const out = new Set(), sr = stage.getBoundingClientRect(), inline = el => getComputedStyle(el).display.startsWith('inline')
  for (const el of stage.querySelectorAll('*')) {
    if (inline(el) || el.closest('.ve-captions')) continue
    const own = [...el.childNodes].some(n => (n.nodeType === 3 ? n.textContent.trim() : n.nodeType === 1 && inline(n) && n.textContent.trim()))
    if (!own || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height || r.right < sr.left || r.left > sr.right || r.bottom < sr.top || r.top > sr.bottom) continue
    const t = (el.innerText ?? el.textContent).replace(/\s+/g, ' ').trim()
    if (t) out.add(t)
  }
  return [...out]
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
  const tl = gsap.timeline({ paused: true }), ticks = [], cues = [], live = []

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
    format: job.format, formats: job.formats, fps: job.fps, duration: job.duration, style: job.style, variant: +query.variant || 0,
    at: s => time.toVideo(s),
    source: v => time.toSource(v),
    pick: picker(job.logical),
    asset: p => `project/assets/${p}`,
    num, rng,
    frame: t => Math.round(t * job.fps) / job.fps,
    tick: f => ticks.push(f),
    cue: (kind, t, o = {}) => cues.push({ kind, t: Math.round(t * 1000) / 1000, ...o }),
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
    tl.seek(v, true)
    for (const a of document.getAnimations()) {
      a.pause()
      a.currentTime = v * 1000
    }
    for (const f of ticks) f(v)
    await Promise.all([...live.map(x => x.update(v)), actors?.frame(actorsEl.getContext('2d'), v)])
  }
  await seek(0)

  return {
    job, api, stage, tl, seek,
    cues: () => cues.toSorted((a, b) => a.t - b.t),
    texts: () => visibleTexts(stage),
    actors: v => actors?.live(v) ?? [],
    // one image per beat: where tweens start, once they have played a little
    beats() {
      const at = c => c.startTime() + (c.parent && c.parent !== tl ? at(c.parent) : 0)
      const starts = tl.getChildren(true, true, true).map(at)
      const vs = [...new Set(starts.map(s => Math.min(job.duration - 0.05, s + 0.4)))].sort((a, b) => a - b)
      const kept = vs.filter((v, i) => i === 0 || v - vs[i - 1] >= 0.6)
      const step = Math.ceil(kept.length / 30)
      return (kept.length ? kept : [0.5]).filter((_, i) => i % step === 0)
    },
  }
}
