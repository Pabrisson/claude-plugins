// Actor drawers. Each one draws in its own space, centered on (0, 0), in logical pixels; the runtime has already
// applied the position, scale, rotation and opacity. g carries the context: ctx, k (device px per logical px),
// colors, fonts, images and the actor's age (video seconds since it entered).

export const clamp = (x, a = 0, b = 1) => Math.min(Math.max(x, a), b)
export const easeOut = p => 1 - (1 - p) ** 3
export const easeInOut = p => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2)
export const easeBack = p => 1 + 2.4 * (p - 1) ** 3 + 1.4 * (p - 1) ** 2

// how each type comes in when the actor sets no `enter`
export const ENTER = { text: 'rise', card: 'pop', counter: 'rise', logo: 'pop', image: 'pop', media: 'pop', arrow: 'none', chip: 'pop', bar: 'rise', stamp: 'slam', cta: 'rise' }

export function entrance(kind, p) {
  const e = easeOut(p)
  if (kind === 'pop') return { s: 0.6 + 0.4 * easeBack(p), o: clamp(p * 2.5) }
  if (kind === 'rise') return { dy: 70 * (1 - e), s: 0.97 + 0.03 * e, o: e }
  if (kind === 'fade') return { o: p }
  if (kind === 'slam') return { s: 1 + 0.9 * (1 - e), r: -6 * (1 - e), o: clamp(p * 3) }
  if (kind === 'left' || kind === 'right') return { dx: (kind === 'left' ? -260 : 260) * (1 - e), o: e }
  return {}
}

export const exit = p => ({ o: 1 - p, s: 1 - 0.04 * p, dy: -24 * easeInOut(p) })

const font = (g, size, weight) => `${weight} ${size}px "${g.font}", Inter, system-ui, sans-serif`

// `*word*` marks the accent; a newline breaks the line; spaces decide where words join
function tokens(text) {
  const out = []
  let gap = false
  String(text ?? '').split('*').forEach((part, i) => {
    for (const [, br, sp, w] of part.matchAll(/(\n)|( +)|([^ \n]+)/g)) {
      if (br) out.push({ br: true })
      else if (sp) gap = true
      else {
        out.push({ w, accent: i % 2 === 1, gap: gap && out.length > 0 && !out.at(-1).br })
        gap = false
      }
    }
  })
  return out
}

function wrap(ctx, toks, maxW) {
  const space = ctx.measureText(' ').width, lines = [{ runs: [], width: 0 }]
  for (const t of toks) {
    if (t.br) {
      lines.push({ runs: [], width: 0 })
      continue
    }
    const l = lines.at(-1), w = ctx.measureText(t.w).width, x = l.runs.length ? l.width + (t.gap ? space : 0) : 0
    if (l.runs.length && x + w > maxW) lines.push({ runs: [{ ...t, x: 0, width: w }], width: w })
    else {
      l.runs.push({ ...t, x, width: w })
      l.width = x + w
    }
  }
  return lines
}

// rich text centered on y; align moves the anchor (center: middle, left: x = 0 is the left edge)
export function text(g, str, { size = 64, weight = 800, color = 'ink', accent = 'accent', align = 'center', maxW = 1e9, line = 1.14, y = 0, x = 0 } = {}) {
  const { ctx } = g
  ctx.font = font(g, size, weight)
  ctx.letterSpacing = size >= 60 ? `${-size * 0.025}px` : '0px'
  ctx.textBaseline = 'middle'
  const lines = wrap(ctx, tokens(str), maxW), lh = size * line, top = y - ((lines.length - 1) * lh) / 2
  lines.forEach((l, i) => {
    const x0 = x + (align === 'center' ? -l.width / 2 : align === 'right' ? -l.width : 0)
    for (const r of l.runs) {
      ctx.fillStyle = g.color(r.accent ? accent : color)
      ctx.fillText(r.w, x0 + r.x, top + i * lh)
    }
  })
  ctx.letterSpacing = '0px'
  return { width: Math.max(0, ...lines.map(l => l.width)), height: lines.length * lh }
}

export function measure(g, str, { size = 64, weight = 800, maxW = 1e9, line = 1.14 } = {}) {
  g.ctx.font = font(g, size, weight)
  g.ctx.letterSpacing = size >= 60 ? `${-size * 0.025}px` : '0px'
  const lines = wrap(g.ctx, tokens(str), maxW)
  g.ctx.letterSpacing = '0px'
  return { width: Math.max(0, ...lines.map(l => l.width)), height: lines.length * size * line }
}

// depth: soft shadows, scaled to the device (canvas shadows ignore the transform)
function lift(g, level = 1) {
  const s = g.k * g.depth * level
  g.ctx.shadowColor = 'rgba(45, 32, 15, 0.2)'
  g.ctx.shadowBlur = 30 * s
  g.ctx.shadowOffsetY = 12 * s
}

// a raised card: shadow, fill, a highlight from the top light and a hairline edge
export function panel(g, x, y, w, h, r, fill, level = 1) {
  const { ctx } = g
  ctx.save()
  lift(g, level)
  ctx.fillStyle = g.color(fill)
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fill()
  ctx.restore()
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.clip()
  const light = ctx.createLinearGradient(0, y, 0, y + h)
  light.addColorStop(0, 'rgba(255, 255, 255, 0.5)')
  light.addColorStop(0.3, 'rgba(255, 255, 255, 0)')
  light.addColorStop(1, 'rgba(60, 40, 20, 0.05)')
  ctx.fillStyle = light
  ctx.fillRect(x, y, w, h)
  ctx.restore()
  ctx.strokeStyle = 'rgba(40, 30, 20, 0.09)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.stroke()
}

// an image covering a rounded box
function cover(g, img, x, y, w, h, r) {
  const { ctx } = g, s = Math.max(w / img.width, h / img.height), sw = w / s, sh = h / s
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.clip()
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h)
  ctx.restore()
}

function contain(g, img, x, y, w, h) {
  const s = Math.min(w / img.width, h / img.height), dw = img.width * s, dh = img.height * s
  g.ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh)
}

function dot(g, x, y, r, color) {
  g.ctx.fillStyle = g.color(color)
  g.ctx.beginPath()
  g.ctx.arc(x, y, r, 0, Math.PI * 2)
  g.ctx.fill()
}

function chipAt(g, label, x, y, { size = 30, fill = 'card', color = 'ink', mark } = {}) {
  const t = measure(g, label, { size, weight: 700 }), h = size * 1.9, pad = size * 0.8, d = mark ? size * 0.75 : 0
  const w = t.width + pad * 2 + d
  panel(g, x - w / 2, y - h / 2, w, h, h / 2, fill, 0.5)
  if (mark) dot(g, x - w / 2 + pad + size * 0.2, y, size * 0.22, mark)
  text(g, label, { size, weight: 700, color, x: x - w / 2 + pad + d, align: 'left', y })
  return w
}

const count = (a, g, n) => {
  const d = a.decimals ?? (Number.isInteger(Array.isArray(a.value) ? a.value[1] : a.value ?? 0) ? 0 : 1)
  return g.num(n, d)
}

export const DRAW = {
  text(g, a) {
    text(g, a.text, { size: a.size ?? 72, weight: a.weight ?? 800, color: a.color ?? 'ink', accent: a.accent ?? 'accent', align: a.align ?? 'center', maxW: a.w ?? 920, line: a.line })
  },

  card(g, a) {
    const w = a.w ?? 640, h = a.h ?? 380, r = a.radius ?? 36, pad = a.pad ?? 44, align = a.align ?? 'left'
    panel(g, -w / 2, -h / 2, w, h, r, a.fill ?? 'card')
    const img = a.image && g.img(a.image), hasText = a.title || a.body
    let top = -h / 2 + pad
    if (img) {
      const ih = hasText ? h * 0.58 : h
      cover(g, img, -w / 2, -h / 2, w, ih, hasText ? [r, r, 0, 0] : r)
      top = -h / 2 + ih + pad * 0.6
    }
    const x = align === 'center' ? 0 : -w / 2 + pad, maxW = w - pad * 2, ts = a.titleSize ?? 52, bs = a.bodySize ?? 32
    if (a.title) {
      const m = measure(g, a.title, { size: ts, maxW })
      text(g, a.title, { size: ts, color: a.color ?? 'ink', align, maxW, x, y: top + m.height / 2 })
      top += m.height + bs * 0.5
    }
    if (a.body) {
      const m = measure(g, a.body, { size: bs, weight: 500, maxW, line: 1.3 })
      text(g, a.body, { size: bs, weight: 500, color: a.bodyColor ?? 'muted', align, maxW, x, y: top + m.height / 2, line: 1.3 })
    }
  },

  counter(g, a) {
    const [v0, v1] = Array.isArray(a.value) ? a.value : [0, a.value ?? 0]
    const n = v0 + (v1 - v0) * easeOut(clamp(g.age / (a.dur ?? 1.2)))
    const suffix = a.suffix ? `*${a.suffix}*` : ''
    text(g, `${a.prefix ?? ''}${count(a, g, n)}${suffix}`, { size: a.size ?? 170, weight: a.weight ?? 900, color: a.color ?? 'ink', accent: a.accent ?? 'accent' })
    if (a.label) text(g, a.label, { size: a.labelSize ?? 36, weight: 600, color: 'muted', y: (a.size ?? 170) * 0.62 + 30 })
  },

  logo(g, a) {
    const w = a.w ?? 180, img = g.img(a.src), boxed = a.card !== false
    if (boxed) panel(g, -w / 2, -w / 2, w, w, w * 0.24, a.fill ?? 'card')
    const m = boxed ? w * 0.18 : 0
    if (img) contain(g, img, -w / 2 + m, -w / 2 + m, w - 2 * m, w - 2 * m)
    if (a.label) text(g, a.label, { size: a.labelSize ?? 30, weight: 700, color: a.color ?? 'ink', y: w / 2 + 40 })
  },

  image(g, a) {
    const img = g.img(a.src)
    if (!img) return
    const w = a.w ?? 600, h = a.h ?? (w * img.height) / img.width, r = a.radius ?? 28
    if (a.shadow !== false) panel(g, -w / 2, -h / 2, w, h, r, 'card')
    cover(g, img, -w / 2, -h / 2, w, h, r)
  },

  // a clip from SPEC.media, playing at its own pace from the actor's entrance
  media(g, a) {
    const m = g.mediaInfo(a.media)
    if (!m) return
    const w = a.w ?? 600, h = w / (a.ar ?? m.ar), r = a.radius ?? 28
    const n = clamp(Math.floor((g.age + (a.offset ?? 0)) * m.fps), 0, m.count - 1) + 1
    panel(g, -w / 2, -h / 2, w, h, r, 'ink')
    const img = g.media(a.media, n)
    if (img) cover(g, img, -w / 2, -h / 2, w, h, r)
    if (a.label) chipAt(g, a.label, 0, -h / 2 - 44, { size: 30, mark: a.dot })
  },

  arrow(g, a) {
    const { ctx } = g, [ax, ay] = a.a ?? [0, 0], [bx, by] = a.b ?? [240, 0], bend = a.bend ?? 0.25
    const cx = (ax + bx) / 2 - (by - ay) * bend, cy = (ay + by) / 2 + (bx - ax) * bend
    const len = Math.hypot(bx - ax, by - ay) * (1 + bend * bend * 1.4), p = easeOut(clamp(g.age / (a.draw ?? 0.6)))
    ctx.strokeStyle = g.color(a.color ?? 'accent')
    ctx.lineWidth = a.width ?? 10
    ctx.lineCap = ctx.lineJoin = 'round'
    ctx.setLineDash([len * p, len])
    ctx.beginPath()
    ctx.moveTo(ax, ay)
    ctx.quadraticCurveTo(cx, cy, bx, by)
    ctx.stroke()
    ctx.setLineDash([])
    if (a.head !== false && p > 0.85) {
      const t = Math.atan2(by - cy, bx - cx), l = (a.width ?? 10) * 3.6
      ctx.globalAlpha *= clamp((p - 0.85) / 0.15)
      ctx.beginPath()
      for (const side of [-1, 1]) {
        ctx.moveTo(bx, by)
        ctx.lineTo(bx - l * Math.cos(t + side * 0.5), by - l * Math.sin(t + side * 0.5))
      }
      ctx.stroke()
    }
  },

  chip(g, a) {
    chipAt(g, a.text ?? '', 0, 0, { size: a.size ?? 34, fill: a.fill ?? 'card', color: a.color ?? 'ink', mark: a.dot })
  },

  bar(g, a) {
    const { ctx } = g, w = a.w ?? 720, h = a.h ?? 34, [v0, v1] = Array.isArray(a.value) ? a.value : [0, a.value ?? 1]
    const v = v0 + (v1 - v0) * easeOut(clamp(g.age / (a.dur ?? 1.2)))
    ctx.fillStyle = 'rgba(40, 30, 20, 0.09)'
    ctx.beginPath()
    ctx.roundRect(-w / 2, -h / 2, w, h, h / 2)
    ctx.fill()
    if (v > 0) {
      ctx.save()
      lift(g, 0.35)
      ctx.fillStyle = g.color(a.color ?? 'accent')
      ctx.beginPath()
      ctx.roundRect(-w / 2, -h / 2, Math.max(h, w * clamp(v)), h, h / 2)
      ctx.fill()
      ctx.restore()
    }
    const ls = a.labelSize ?? 34
    if (a.label) text(g, a.label, { size: ls, weight: 700, align: 'left', x: -w / 2, y: -h / 2 - ls * 0.9 })
    if (a.percent !== false) text(g, `${g.num(v * 100, 0)} %`, { size: ls, weight: 800, color: a.color ?? 'accent', align: 'right', x: w / 2, y: -h / 2 - ls * 0.9 })
  },

  stamp(g, a) {
    const { ctx } = g, size = a.size ?? 72, color = a.color ?? 'red', label = String(a.text ?? 'SECRET').toUpperCase()
    const m = measure(g, label, { size, weight: 900 }), w = m.width + size * 0.9, h = size * 1.5
    ctx.globalAlpha *= 0.92
    ctx.strokeStyle = g.color(color)
    ctx.lineWidth = size * 0.09
    ctx.beginPath()
    ctx.roundRect(-w / 2, -h / 2, w, h, size * 0.2)
    ctx.stroke()
    text(g, label, { size, weight: 900, color })
  },

  // subscribe card: avatar, name, tagline, then the button turns into its done state with a press
  cta(g, a) {
    const { ctx } = g, c = g.creator, w = a.w ?? 860, h = a.h ?? 200, r = 44
    const name = a.name ?? c.name, sub = a.sub ?? c.cta.sub, label = a.button ?? c.cta.button, done = a.done ?? c.cta.done
    panel(g, -w / 2, -h / 2, w, h, r, 'card')
    const ar = h * 0.32, ax = -w / 2 + 40 + ar, avatar = g.img(a.avatar ?? (c.avatar && `source/${c.avatar}`))
    if (avatar) {
      ctx.save()
      ctx.beginPath()
      ctx.arc(ax, 0, ar, 0, Math.PI * 2)
      ctx.clip()
      contain(g, avatar, ax - ar, -ar, ar * 2, ar * 2)
      ctx.restore()
    } else {
      dot(g, ax, 0, ar, 'accent')
      text(g, (name || '?').slice(0, 1).toUpperCase(), { size: ar, weight: 800, color: 'white', x: ax })
    }
    const tx = ax + ar + 32
    text(g, name, { size: 44, weight: 800, align: 'left', x: tx, y: sub ? -24 : 0 })
    if (sub) text(g, sub, { size: 30, weight: 500, color: 'muted', align: 'left', x: tx, y: 26 })
    const press = a.press ?? 1.1, on = g.age >= press, dip = 1 - 0.08 * Math.sin(Math.PI * clamp((g.age - press + 0.1) / 0.2))
    const bl = on ? `✓ ${done}` : label, bm = measure(g, bl, { size: 34, weight: 800 }), bw = bm.width + 64, bh = 76
    ctx.save()
    ctx.translate(w / 2 - 40 - bw / 2, 0)
    ctx.scale(dip, dip)
    ctx.fillStyle = on ? 'rgba(40, 30, 20, 0.1)' : g.color('accent')
    ctx.beginPath()
    ctx.roundRect(-bw / 2, -bh / 2, bw, bh, bh / 2)
    ctx.fill()
    text(g, bl, { size: 34, weight: 800, color: on ? 'ink' : 'white' })
    ctx.restore()
  },
}

// texts an actor shows, for the transcript of a video without speech
export function shownTexts(a, creator, num) {
  const strip = s => String(s).replace(/\*/g, '').replace(/\s+/g, ' ').trim()
  const own = [a.text, a.title, a.body, a.label]
  if (a.type === 'counter') own.push(`${a.prefix ?? ''}${count(a, { num }, Array.isArray(a.value) ? a.value[1] : a.value ?? 0)}${a.suffix ?? ''}`)
  if (a.type === 'cta') own.push(a.name ?? creator.name, a.button ?? creator.cta.button)
  for (const [, v] of a.keys ?? []) if (v && typeof v === 'object') own.push(v.text, v.label, v.title)
  return [...new Set(own.filter(s => s != null && s !== '').map(strip))]
}
