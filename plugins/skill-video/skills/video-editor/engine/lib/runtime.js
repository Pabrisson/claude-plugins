// Formats, style defaults, and the optional actors layer: when the project has an actors/ folder, its declarative
// actors (actors/*.json) are drawn on a full-stage canvas over the scene. Node imports the pure parts from here.
// Actor times are SOURCE seconds; drawing runs on VIDEO seconds through the timeline.
import { DRAW, ENTER, clamp, easeInOut, entrance, exit } from './actors.js'

export const FORMATS = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] }

// logical canvas: the short side is always 1080; `source` takes the source's ratio
export function logical(format, source) {
  if (format !== 'source') return FORMATS[format]
  const k = 1080 / Math.min(source.width, source.height)
  return [Math.floor((source.width * k) / 2) * 2, Math.floor((source.height * k) / 2) * 2]
}

// the engine's look when style.json leaves a field out
export const STYLE = {
  creator: { name: '', handle: '', lang: 'fr', avatar: null, cta: { sub: '', button: "S'abonner", done: 'Abonné' } },
  look: {
    palette: { paper: '#f2ede3', ink: '#171512', accent: '#2563eb', muted: '#857e72', card: '#fffdf8' },
    font: 'Inter',
    fonts: {},
    // the brand's recurring graphic devices, in words: material for each video's motif
    symbols: [],
    paper: { grain: 1.2, relief: 1, depth: 1.7 },
    captions: { size: 84 },
  },
  // audio.py, under a voice: the loudness of the music bed and of the effects (LUFS), the music's gain while it
  // speaks (1 - duck). The music itself is written per video (source/sound.py)
  sound: { music: -21, sfx: -28.5, duck: 0.5 },
  notes: [],
}
const isObj = x => x && typeof x === 'object' && !Array.isArray(x)
const merge = (a, b) => (b === undefined ? a : isObj(a) && isObj(b) ? Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(k => [k, merge(a[k], b[k])])) : b)
export const styleOf = style => merge(STYLE, style ?? {})

// an actor's own override for this format: formats: { '1:1': { … } }; fit: false places it in that format's canvas
export const resolveActors = (actors, format) =>
  actors.map(a => (a.formats?.[format] ? { ...a, ...a.formats[format] } : a)).filter(a => !a.hidden)

// video seconds an actor is on screen, its exit included
export const actorSpan = (a, toVideo, duration) => [toVideo(a.from ?? 0), a.to === undefined ? duration : toVideo(a.to) + (a.post ?? 0.3)]

const lerp = (a, b, p) =>
  typeof a === 'number' && typeof b === 'number' ? a + (b - a) * p : Array.isArray(a) && Array.isArray(b) ? b.map((x, i) => lerp(a[i], x, p)) : p > 0 ? b : a
const mix = (a, b, p) => {
  if (!isObj(b)) return lerp(a, b, p)
  const o = { ...a }
  for (const k in b) o[k] = a?.[k] === undefined ? b[k] : lerp(a[k], b[k], p)
  return o
}

// keys: [[video time, value, transition s]]: from its time, each key moves the value to its own over the transition;
// a key at (or before) the start applies at once
function keyed(base, keys, v, start) {
  let cur = base
  for (const [t, val, d] of keys) {
    if (v < t) break
    cur = mix(cur, val, d > 0 && t > start ? easeInOut(clamp((v - t) / d)) : 1)
  }
  return cur
}

// load: { image(src), media(id, n) } → Promise<ImageBitmap>; tl: { toVideo }
export async function createActors(list, job, tl, load) {
  const style = job.style, pal = { white: '#ffffff', red: '#d6402b', ...style.look.palette }, color = c => pal[c] ?? c
  const [lw, lh] = job.logical, [pw, ph] = job.primaryLogical, k = job.size[0] / lw, toV = tl.toVideo
  // without an override, an actor keeps its place in the primary format, scaled and centered in this one
  const fs = Math.min(lw / pw, lh / ph), fit = job.format === job.primary ? { s: 1, x: 0, y: 0 } : { s: fs, x: (lw - pw * fs) / 2, y: (lh - ph * fs) / 2 }
  const fmt = {}, num = (n, d) => (fmt[d] ??= new Intl.NumberFormat(style.creator.lang, { minimumFractionDigits: d, maximumFractionDigits: d })).format(n)
  const all = resolveActors(list, job.format)
  const srcs = new Set([style.creator.avatar, ...all.flatMap(a => [a.src, a.image, a.avatar])].filter(Boolean))
  const imgs = new Map(await Promise.all([...srcs].map(async s => [s, await load.image(s).catch(e => (console.warn(`asset ${s}: ${e.message}`), null))])))

  const actors = all.filter(a => DRAW[a.type] || console.warn(`unknown actor type ${a.type} (${a.id})`)).map(a0 => {
    const native = a0.fit === false, [cw, ch] = native ? [lw, lh] : [pw, ph]
    const a = { x: cw / 2, y: ch / 2, s: 1, r: a0.type === 'stamp' ? -8 : 0, o: 1, ...a0 }
    return {
      a, native, v0: toV(a.from ?? 0), v1: a.to === undefined ? Infinity : toV(a.to),
      pre: a.pre ?? 0.45, post: a.post ?? 0.3, enter: a.enter ?? ENTER[a.type] ?? 'fade',
      keys: (a.keys ?? []).map(([t, val, d = 0.5]) => [toV(t), val, d]),
    }
  })
  const live = (x, v) => v >= x.v0 && v <= x.v1 + x.post
  const mediaN = (x, v) => clamp(Math.floor((v - x.v0 + (x.a.offset ?? 0)) * job.media[x.a.media].fps), 0, job.media[x.a.media].count - 1) + 1
  const frames = new Map()

  function draw(ctx, x, v) {
    const age = v - x.v0, st = keyed(x.a, x.keys, v, x.v0)
    const en = x.pre > 0 ? entrance(x.enter, clamp(age / x.pre)) : {}, ex = v > x.v1 ? exit(clamp((v - x.v1) / x.post)) : {}
    const sc = (x.native ? 1 : fit.s) * k
    ctx.save()
    ctx.setTransform(sc, 0, 0, sc, x.native ? 0 : fit.x * k, x.native ? 0 : fit.y * k)
    ctx.translate(st.x + (en.dx ?? 0), st.y + (en.dy ?? 0) + (ex.dy ?? 0))
    ctx.rotate((((st.r ?? 0) + (en.r ?? 0)) * Math.PI) / 180)
    const s = (st.s ?? 1) * (en.s ?? 1) * (ex.s ?? 1)
    ctx.scale(s, s)
    ctx.globalAlpha = clamp((st.o ?? 1) * (en.o ?? 1) * (ex.o ?? 1))
    DRAW[st.type]({
      ctx, k: sc, age, color, num, font: style.look.font, depth: style.look.paper.depth, creator: style.creator,
      img: s => imgs.get(s), mediaInfo: id => job.media?.[id], media: (id, n) => frames.get(`${id}/${n}`),
    }, st)
    ctx.restore()
  }

  return {
    count: actors.length,
    // the clip frames a time needs, then every live actor
    async frame(ctx, v) {
      frames.clear()
      await Promise.all(actors.filter(x => x.a.type === 'media' && live(x, v) && job.media?.[x.a.media]).map(async x => {
        const n = mediaN(x, v)
        frames.set(`${x.a.media}/${n}`, await load.media(x.a.media, n))
      }))
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      for (const x of actors) if (live(x, v)) draw(ctx, x, v)
    },
    live: v => actors.filter(x => live(x, v)).map(x => x.a),
  }
}
