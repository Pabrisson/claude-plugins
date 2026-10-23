// Demo scene without a source video (edit.json: { "duration": 12 }): pure motion design, recomposed per format.
export default async function scene({ stage, tl, W, H, pick, tick, cue, num, rng }) {
  const el = (html, css) => {
    const d = document.createElement('div')
    d.innerHTML = html
    d.style.cssText = `position:absolute;${css}`
    stage.append(d)
    return d
  }
  stage.style.background = 'var(--ink)'

  // a living hexagon field (canvas at 0,0, full stage), each cell a parcel on the move
  const cv = document.createElement('canvas')
  ;[cv.width, cv.height] = [W, H]
  cv.style.cssText = 'position:absolute;left:0;top:0'
  stage.append(cv)
  const g = cv.getContext('2d'), R = 22, HW = Math.sqrt(3) * R, field = { a: 0 }, seed = rng(7), lit = Array.from({ length: 4000 }, () => seed())
  tick(t => {
    g.clearRect(0, 0, W, H)
    if (!field.a) return
    for (let r = 0, i = 0; r < H / (1.5 * R) + 1; r++) {
      for (let c = -1; c < W / HW + 1; c++, i++) {
        const x = c * HW + (r % 2 ? HW / 2 : 0) - ((t * 40) % HW), y = r * 1.5 * R
        const v = Math.sin(x * 0.004 + t * 1.6) * Math.cos(y * 0.006 - t), s = field.a * (v > 0.2 ? 0.8 : 0.3) * R
        g.fillStyle = lit[i % lit.length] > 0.985 ? '#c73a36' : v > 0.2 ? 'rgba(245,240,230,.9)' : 'rgba(245,240,230,.18)'
        g.beginPath()
        for (let k = 0; k < 6; k++) g[k ? 'lineTo' : 'moveTo'](x + s * Math.cos((k * Math.PI) / 3 + Math.PI / 6), y + s * Math.sin((k * Math.PI) / 3 + Math.PI / 6))
        g.fill()
      }
    }
  })
  tl.to(field, { a: 1, duration: 1.2, ease: 'power2.out' }, 0.2).to(field, { a: 0, duration: 0.5 }, 5.8)

  // headline in a pill that grows out of a dot
  const pill = el('<span>Rendu en <b style="color:var(--accent)">8,5 s</b></span>',
    `left:50%;top:50%;transform:translate(-50%,-50%);padding:${pick(28, 24)}px 56px;border-radius:999px;background:var(--paper);color:var(--ink);font:800 ${pick(96, 80, 88)}px var(--font);white-space:nowrap;letter-spacing:-.03em`)
  tl.from(pill, { scale: 0, duration: 0.6, ease: 'back.out(1.8)' }, 0.6)
  tl.from(pill.firstChild, { opacity: 0, y: 30, duration: 0.5, ease: 'expo.out' }, 0.9)
  cue('pop', 0.6)
  tl.to(pill, { scale: 0, duration: 0.4, ease: 'power3.in' }, 5.6)

  // giant marquee rows crossing the frame
  const rows = pick(2, 3, 4)
  for (let i = 0; i < rows; i++) {
    const m = el(`${'REMOTION · HYPERFRAMES · MOTEUR · '.repeat(3)}`, `left:0;top:${((i + 0.5) * H) / rows - 140}px;white-space:nowrap;font:900 260px var(--font);letter-spacing:-.04em;color:${i % 2 ? 'transparent' : 'var(--paper)'};-webkit-text-stroke:${i % 2 ? '3px var(--paper)' : '0'}`)
    tl.fromTo(m, { x: i % 2 ? -2600 : 0, opacity: 0 }, { x: i % 2 ? -800 : -1800, opacity: 1, duration: 3.6, ease: 'none' }, 6)
    tl.to(m, { opacity: 0, duration: 0.3 }, 9.3)
  }
  cue('whoosh', 6)

  // ×12,5 counter on red
  const red = el('', `left:0;top:0;width:${W}px;height:${H}px;background:#c73a36`)
  const n = el('', `left:0;width:${W}px;top:${H / 2 - 130}px;text-align:center;font:900 ${pick(260, 230)}px var(--font);color:#fff;letter-spacing:-.05em;font-variant-numeric:tabular-nums`)
  const c = { v: 0 }
  tick(() => (n.textContent = `×${num(c.v, 1)}`))
  tl.fromTo(red, { clipPath: `circle(0px at ${W / 2}px ${H / 2}px)` }, { clipPath: `circle(${Math.hypot(W, H)}px at ${W / 2}px ${H / 2}px)`, duration: 0.7, ease: 'expo.inOut' }, 9.4)
  tl.fromTo(n, { opacity: 0 }, { opacity: 1, duration: 0.2 }, 9.7).fromTo(c, { v: 0 }, { v: 12.5, duration: 1.4, ease: 'power3.out' }, 9.7)
  cue('hit', 9.4)
}
