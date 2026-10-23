// The paper the motion design sits on: a warm sheet with soft waves (relief) and a fine grain (tooth),
// drawn once per page at the output size. Seeded, so every render and every worker gets the same sheet.

export function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function paperTexture(w, h, color, { grain = 1, relief = 1 } = {}, seed = 7) {
  const c = new OffscreenCanvas(w, h), ctx = c.getContext('2d'), rand = rng(seed), k = Math.min(w, h) / 1080
  ctx.fillStyle = color
  ctx.fillRect(0, 0, w, h)
  // soft waves: large light and shade blobs, as if the sheet were not quite flat
  for (let i = 0; i < 8; i++) {
    const x = rand() * w, y = rand() * h, r = (0.3 + rand() * 0.5) * Math.max(w, h)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, i % 2 ? `rgba(110, 85, 50, ${0.05 * relief})` : `rgba(255, 255, 255, ${0.14 * relief})`)
    g.addColorStop(1, 'rgba(0, 0, 0, 0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }
  // tooth: per-pixel grain
  if (grain > 0) {
    const img = ctx.getImageData(0, 0, w, h), d = img.data, amp = 9 * grain
    for (let i = 0; i < d.length; i += 4) {
      const n = (rand() - 0.5) * amp
      d[i] += n
      d[i + 1] += n
      d[i + 2] += n
    }
    ctx.putImageData(img, 0, 0)
  }
  // fibers: short faint strokes
  ctx.lineCap = 'round'
  for (let i = 0, n = 420 * grain * (w * h) / (1080 * 1920); i < n; i++) {
    const x = rand() * w, y = rand() * h, a = rand() * Math.PI, l = (6 + rand() * 22) * k
    ctx.strokeStyle = rand() < 0.5 ? 'rgba(120, 95, 60, 0.07)' : 'rgba(255, 255, 255, 0.18)'
    ctx.lineWidth = (0.6 + rand()) * k
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.quadraticCurveTo(x + Math.cos(a + 0.6) * l / 2, y + Math.sin(a + 0.6) * l / 2, x + Math.cos(a) * l, y + Math.sin(a) * l)
    ctx.stroke()
  }
  return c
}
