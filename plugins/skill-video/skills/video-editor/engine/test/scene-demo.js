// Demo scene for test/speech.mp4 (copy test/assets/a.png and b.png to the project's assets/logos/).
// Times are anchored on the transcript with at(source seconds); layouts are chosen per format with pick().
export default async function scene({ stage, tl, gsap, W, H, at, pick, camera, captions, paper, tick, cue, num, asset, style }) {
  const el = (html, css = '') => {
    const d = document.createElement('div')
    d.innerHTML = html
    d.style.cssText = `position:absolute;${css}`
    stage.append(d)
    return d
  }
  stage.style.background = await paper()
  const seam = pick(H * 0.42, H * 0.55, H * 0.6) // camera below the seam (portrait), on the right (landscape)

  // camera window: a band under the paper, or a panel on the right in landscape
  const cam = camera()
  const camBox = el('', pick(`left:${W * 0.52}px;top:80px;width:${W * 0.44}px;height:${H - 160}px;border-radius:36px;overflow:hidden;box-shadow:0 30px 80px rgba(40,30,15,.25)`,
    `left:0;top:${seam}px;width:${W}px;height:${H - seam}px`))
  camBox.append(cam)
  const edge = el('', `left:0;top:${seam}px;width:${W}px;height:40px;background:linear-gradient(rgba(30,20,10,.3),transparent)`)
  if (W > H) edge.remove()
  // the camera leaves for the numbers, then comes back with a punch-in
  tl.to([camBox, edge], { yPercent: pick(0, 100), xPercent: pick(110, 0), duration: 0.6, ease: 'expo.inOut' }, at(32.6))
  tl.to([camBox, edge], { yPercent: 0, xPercent: 0, duration: 0.6, ease: 'expo.inOut' }, at(39.4))
  tl.fromTo(cam.view, { zoom: 1 }, { zoom: 1.25, duration: 0.25, ease: 'power3.out' }, at(41.5))
  tl.to(cam.view, { zoom: 1, duration: 0.8, ease: 'power2.inOut' }, at(44))

  const area = pick({ w: W * 0.48, x: 0, h: H }, { w: W, x: 0, h: seam }) // where the paper motion lives
  const center = `left:${area.x}px;width:${area.w}px;text-align:center`

  // 1 · hook: letters rise, the accent word lands with a stamp
  const hook = el(`<div class="hook">Un moteur <b>maison</b></div>`, `${center};top:${area.h * 0.3}px;font:800 ${pick(120, 128, 132)}px var(--font);letter-spacing:-.04em;line-height:1`)
  hook.querySelector('b').style.color = 'var(--accent)'
  const { chars } = SplitText.create(hook.firstChild, { type: 'chars', mask: 'chars' })
  tl.from(chars, { yPercent: 115, duration: 0.7, ease: 'expo.out', stagger: 0.03 }, at(0.7))
  cue('whoosh', at(0.7))
  const badge = el(`<svg viewBox="-60 -60 120 120" width="120"><path d="M0-52L45-26V26L0 52L-45 26V-26Z" fill="var(--accent)"/><text y="12" text-anchor="middle" font-size="34" font-weight="800" fill="#fff">JS</text></svg>`,
    `left:${area.x + area.w / 2 - 60}px;top:${area.h * 0.3 - 170}px`)
  tl.from(badge, { scale: 0, rotation: -120, duration: 0.6, ease: 'back.out(2.4)' }, at(1.6))
  cue('pop', at(1.6))
  tl.to([hook, badge], { yPercent: -40, opacity: 0, duration: 0.35, ease: 'power3.in' }, at(4.2))

  // 2 · cuts: a waveform whose silences shrink, the scissors line drawn on
  const wave = document.createElement('canvas')
  ;[wave.width, wave.height] = [W, H]
  wave.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%'
  stage.append(wave)
  const g = wave.getContext('2d'), wv = { on: 0, cut: 0 }
  tick(() => {
    g.clearRect(0, 0, W, H)
    if (!wv.on) return
    const y0 = area.h * 0.45, n = 64, bw = (area.w * 0.8) / n
    for (let i = 0; i < n; i++) {
      const quiet = i % 16 > 11, h = quiet ? 6 : 30 + 90 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6))
      g.globalAlpha = wv.on * (quiet ? 1 - wv.cut : 1)
      g.fillStyle = quiet ? style.look.palette.muted : style.look.palette.ink
      g.beginPath()
      g.roundRect(area.x + area.w * 0.1 + i * bw * (quiet ? 1 - 0.5 * wv.cut : 1), y0 - h / 2, bw * 0.6, h, 4)
      g.fill()
    }
  })
  tl.to(wv, { on: 1, duration: 0.5 }, at(4.5)).to(wv, { cut: 1, duration: 0.8, ease: 'expo.inOut' }, at(6.2)).to(wv, { on: 0, duration: 0.3 }, at(8.2))
  const t2 = el('Coupes <b>automatiques</b>', `${center};top:${area.h * 0.62}px;font:700 64px var(--font)`)
  tl.from(t2, { y: 40, opacity: 0, duration: 0.6, ease: 'expo.out' }, at(4.7)).to(t2, { opacity: 0, duration: 0.3 }, at(8.2))
  cue('click', at(6.2))

  // 3 · a word roller: silences → respirations
  const roll = el(`<span style="color:var(--muted)">les</span> <span class="r" style="display:inline-block;position:relative;overflow:hidden;height:1.15em;vertical-align:top"><span>silences</span><span style="position:absolute;left:0;top:0;color:var(--accent)">respirations</span></span>`,
    `${center};top:${area.h * 0.42}px;font:800 ${pick(96, 100)}px var(--font);letter-spacing:-.03em`)
  const [w1, w2] = roll.querySelectorAll('.r > span')
  tl.from(roll, { opacity: 0, y: 30, duration: 0.5 }, at(8.5))
  tl.fromTo(w2, { yPercent: 110 }, { yPercent: 0, duration: 0.55, ease: 'expo.out' }, at(10.4)).to(w1, { yPercent: -110, duration: 0.55, ease: 'expo.out' }, at(10.4))
  tl.to(roll, { opacity: 0, duration: 0.3 }, at(12.8))
  cue('tick', at(10.4))

  // 4 · two logos and an arrow drawn on between them
  const logos = el(`<img src="${asset('logos/a.png')}" width="170"><svg width="260" height="80" viewBox="0 0 260 80"><path d="M10 60Q130-20 240 50M220 30l22 22-30 6" fill="none" stroke="var(--accent)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg><img src="${asset('logos/b.png')}" width="170">`,
    `${center};top:${area.h * 0.36}px;display:flex;align-items:center;justify-content:center;gap:20px`)
  const [la, arrow, lb] = logos.children
  tl.from(la, { scale: 0, duration: 0.5, ease: 'back.out(2)' }, at(13)).from(lb, { scale: 0, duration: 0.5, ease: 'back.out(2)' }, at(13.4))
  tl.from(arrow.querySelector('path'), { drawSVG: '0%', duration: 0.7, ease: 'power2.inOut' }, at(13.8))
  tl.to(logos, { opacity: 0, duration: 0.3 }, at(18))
  cue('pop', at(13))
  cue('pop', at(13.4))

  // 5 · the numbers take the whole frame: a counter
  const total = el('', `left:0;width:${W}px;text-align:center;top:${H * 0.38}px;font:900 ${pick(220, 240)}px var(--font);letter-spacing:-.05em;font-variant-numeric:tabular-nums`)
  const c = { v: 0 }
  tick(() => (total.innerHTML = `${num(c.v)} <span style="color:var(--accent)">€</span>`))
  tl.fromTo(total, { opacity: 0 }, { opacity: 1, duration: 0.3 }, at(33)).fromTo(c, { v: 0 }, { v: 1200, duration: 1.6, ease: 'power3.out' }, at(33)).to(total, { opacity: 0, duration: 0.3 }, at(39.2))
  cue('riser', at(33))

  // 6 · CTA from the style
  const cta = style.creator.cta
  const card = el(`<b style="font-size:46px">${style.creator.name || 'Pab'}</b><div style="color:var(--muted);font:500 30px var(--font)">${cta.sub || "L'IA pour les devs"}</div><div class="btn" style="margin-top:22px;display:inline-block;padding:16px 34px;border-radius:40px;background:var(--accent);color:#fff;font:800 34px var(--font)">${cta.button}</div>`,
    `left:${area.x + area.w / 2 - 330}px;top:${area.h * 0.4}px;width:660px;padding:40px;border-radius:44px;background:var(--card);text-align:center;box-shadow:0 30px 80px rgba(40,30,15,.18)`)
  tl.from(card, { y: 80, opacity: 0, scale: 0.9, duration: 0.6, ease: 'back.out(1.6)' }, at(61.5))
  tl.to(card.querySelector('.btn'), { scale: 0.92, duration: 0.1, yoyo: true, repeat: 1 }, at(63)).set(card.querySelector('.btn'), { text: `✓ ${cta.done}`, background: 'var(--ink)' }, at(63.1))
  cue('ok', at(63.1))

  // captions near the seam (above the camera)
  const caps = captions()
  caps.style.top = `${pick(H * 0.82, seam - 120)}px`
  if (W > H) Object.assign(caps.style, { left: '0px', right: 'auto', width: `${W * 0.5}px` })
  stage.append(caps)
}
