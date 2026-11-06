// shop-audit — a private case type, the demo's example of .osint-types/: an online shop before an order. It reads the
// shop's home page once, then the legal notice the home page links to, and checks what a buyer needs: who sells (a
// SIREN that passes its check), how to reach them, the terms of sale, the consumer mediator. Made from a copy of the
// plugin's domain type, as references/types.md says: node built-ins only (none needed here), everything through ctx.
export const domainOf = input => {
  let s = String(input).trim().toLowerCase()
  if (/^https?:\/\//.test(s)) s = new URL(s).hostname
  return s.replace(/^www\./, '').replace(/\.$/, '')
}
const strip = html => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ')
const linksOf = (html, base) => [...html.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m => {
  let href = m[1]
  try { href = new URL(m[1], base).href } catch {}
  return { href, label: strip(m[2]).trim() }
})
export function luhn(d) {
  let s = 0
  for (let i = 0; i < d.length; i++) { let n = +d[d.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9 } s += n }
  return s % 10 === 0
}
const sirensIn = text => [...new Set([...text.matchAll(/(?:SIREN|SIRET|RCS)[^0-9]{0,40}((?:\d[\s.]?){9})/gi).map(m => m[1].replace(/\D/g, '')).filter(luhn)])]
const spaced = s => `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6, 9)}`
const LEGAL = /mentions[\s-]+l[ée]gales|legal[\s-]+notice|impressum/i
const TERMS = /conditions[\s-]+g[ée]n[ée]rales|\bcgv\b|terms[\s-]+(of[\s-]+sale|and[\s-]+conditions)/i
const MEDIATOR = /m[ée]diat(eur|ion)\s+(de\s+la\s+)?consommation|consumer\s+mediat/i
const mailto = links => [...new Set(links.filter(l => /^mailto:/i.test(l.href)).map(l => decodeURIComponent(l.href.slice(7).split('?')[0]).toLowerCase()))]

// what a buyer needs, from the pages read (the home page, then the legal notice when there is one); pure
export function checks(home, legal) {
  const pages = [home, legal].filter(Boolean)
  const link = (re, ps) => ps.flatMap(p => p.links.map(l => ({ ...l, page: p }))).find(l => re.test(`${l.label} ${l.href}`)) ?? null
  const legalLink = link(LEGAL, [home]), terms = link(TERMS, pages)
  const sirenPage = [legal, home].find(p => p && sirensIn(p.text).length) ?? null
  const contactPage = pages.find(p => p.links.some(l => /^(mailto|tel):/i.test(l.href))) ?? null
  const mediatorPage = pages.find(p => MEDIATOR.test(p.text)) ?? null
  return [
    { id: 'legal', page: legalLink ? home : null, where: legalLink?.href ?? null },
    { id: 'siren', page: sirenPage, where: sirenPage?.url ?? null, siren: sirenPage ? sirensIn(sirenPage.text)[0] : null },
    { id: 'contact', page: contactPage, where: contactPage?.url ?? null, emails: mailto(pages.flatMap(p => p.links)) },
    { id: 'terms', page: terms?.page ?? null, where: terms?.href ?? null },
    { id: 'mediator', page: mediatorPage, where: mediatorPage?.url ?? null },
  ].map(c => ({ ...c, found: !!c.page }))
}

// one page of the shop, read once and recorded as a source; null when it does not answer (noted, the audit goes on)
async function readPage(ctx, url, title) {
  const r = await ctx.fetch('web', url, { max: 5e6, timeout: 20000 })
  const src = await ctx.source({ url, body: r.body, contentType: r.headers['content-type'], title, reliability: 'B' })
  if (r.status >= 400) { ctx.fail(`${url} answered ${r.status}`); return null }
  const html = r.body.toString('utf8')
  return { url, src: src.id, text: strip(html), links: linksOf(html, url) }
}

async function collect(ctx) {
  const d = domainOf(ctx.input.shop)
  ctx.progress(1, 2, 'home page')
  const home = await readPage(ctx, `https://${d}/`, ctx.t('home_page', { d }))
  if (!home) ctx.refuse(`the home page of ${d} does not answer: nothing to audit`)
  ctx.entity('domain', d, { sources: [home.src], props: { role: 'shop' } })
  const href = home.links.find(l => LEGAL.test(`${l.label} ${l.href}`))?.href
  ctx.progress(2, 2, 'legal notice')
  const legal = href ? await readPage(ctx, href, ctx.t('legal_page', { d })) : null
  const read = [home, legal].filter(Boolean), on = p => ctx.t(p === legal ? 'on_legal' : 'on_home')
  const rows = checks(home, legal)
  for (const c of rows) {
    const check = ctx.t(`c_${c.id}`), sources = c.found ? [c.page.src] : read.map(p => p.src)
    if (c.id === 'siren' && c.found) {
      const org = `SIREN ${spaced(c.siren)}`
      ctx.entity('organization', org, { sources, props: { siren: c.siren, role: 'seller' } })
      ctx.relate(['domain', d], ['organization', org], 'sold by', c.page.src)
      ctx.clue(ctx.t('siren', { siren: spaced(c.siren), where: on(c.page) }), { status: 'read', sources })
    } else {
      const where = c.found ? on(c.page) : ctx.t(legal ? 'on_pages' : 'on_home')
      ctx.clue(ctx.t(c.found ? 'clue_found' : 'clue_missing', { check, where }), { status: 'read', sources })
    }
    for (const e of c.emails ?? []) { ctx.entity('email', e, { sources: [home.src] }); ctx.relate(['domain', d], ['email', e], 'publishes', home.src) }
  }
  ctx.view('checks', rows.map(c => ({ check: ctx.t(`c_${c.id}`), status: ctx.t(c.found ? 'found' : 'missing'), where: c.where ?? '—' })))
  ctx.snapshot('checks', rows.map(c => ({ key: c.id, found: c.found, where: c.where })))
}

export const commands = {
  collect: { help: 'the home page, then the legal notice it links to: the checks a buyer needs', flags: {}, run: collect },
}
