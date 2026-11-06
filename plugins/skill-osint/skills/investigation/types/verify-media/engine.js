// The verify-media type: an image or a video (a file or a link) and what is said about it, checked three ways —
// where it first appeared (origin), whether the caption fits the evidence (claim), the signs of editing or generation
// (integrity). The engine reads what tools can read and records it as sources, entities, clues and dates on the
// timeline: the pages it appears on (their own date, the post's date the agent read, their first Wayback capture),
// the file (exiftool, its embedded thumbnail, its C2PA manifest by c2patool), the direct reverse search of the GeoINT
// pack (Yandex, Baidu). Signs are clues, never a verdict: the manifest caps integrity at medium unless a signed and
// valid C2PA manifest of the original lifts it (state.c2pa_valid).
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { packReady } from '../../engine/lib/python.js'
import { sendList } from '../../engine/lib/tunnel.js'
import { hasBin, INSTALL, isUrl } from '../../engine/lib/util.js'

// ---------------------------------------------------------------- pages: where the image appears, and since when

const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|msclkid|igshid|igsh|mc_cid|mc_eid|ref_src|ref_url|_ga|si|feature)$/i
// one address per page: no fragment, no tracking parameter, no trailing slash, the host in lower case
export function canonicalUrl(u) {
  const x = new URL(String(u).trim())
  x.hash = ''
  for (const k of [...new Set(x.searchParams.keys())]) if (TRACKING.test(k)) x.searchParams.delete(k)
  if (x.pathname.length > 1) x.pathname = x.pathname.replace(/\/+$/, '')
  return x.href.replace(/\?$/, '')
}
export const siteOf = u => new URL(u).hostname.replace(/^www\./, '')

// a day as the page or the agent wrote it: an ISO (or EXIF) date keeps its own day, never shifted through UTC; an
// English date ("March 4, 2025", "4 Mar 2025") by its month's name — not the JS parser, which reads "sometime in 2023"
// as 1 January and "4 mars" as March; nothing before 1990 (no web page; `min` for a camera's date) nor after tomorrow
// (a page one time zone ahead)
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const monthOf = w => (w.length >= 3 ? MONTHS.findIndex(m => m.startsWith(w.toLowerCase())) + 1 : 0)
export function dayOf(s, today = new Date(), min = 1990) {
  const t = String(s ?? '').trim()
  const iso = /^(\d{4})[-:](\d{2})[-:](\d{2})/.exec(t)
  const en = /^(?:([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})|(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4}))\b/i.exec(t)
  const [y, m, d] = iso ? iso.slice(1).map(Number) : en?.[1] ? [+en[3], monthOf(en[1]), +en[2]] : en ? [+en[6], monthOf(en[5]), +en[4]] : []
  if (!y || !(m >= 1)) return null
  const check = new Date(Date.UTC(y, m - 1, d))
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null
  const day = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return y >= min && day <= new Date(today.getTime() + 864e5).toISOString().slice(0, 10) ? day : null
}

// the date a page gives itself: its published-time meta, its JSON-LD datePublished, its uploadDate (Wikimedia
// Commons, YouTube), its itemprop or Dublin Core date; a <time datetime> last, for it may be another date
const META_DATES = ['article:published_time', 'og:published_time', 'datepublished', 'date', 'dc.date', 'dc.date.issued', 'pubdate']
const metaTags = html => [...html.matchAll(/<meta\b[^>]*>/gi)].map(m => Object.fromEntries([...m[0].matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(a => [a[1].toLowerCase(), a[2] ?? a[3]])))
export function pageDate(html, today) {
  const tags = metaTags(html), name = m => String(m.property ?? m.name ?? m.itemprop ?? '').toLowerCase()
  const found = [
    ...META_DATES.map(k => [k, tags.find(m => name(m) === k)?.content]),
    ['datePublished', /"datePublished"\s*:\s*"([^"]+)"/.exec(html)?.[1]],
    ['uploadDate', /"uploadDate"\s*:\s*"([^"]+)"/.exec(html)?.[1]],
    ['time', /<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)/i.exec(html)?.[1]],
  ]
  for (const [how, raw] of found) { const date = raw ? dayOf(raw, today) : null; if (date) return { date, how, raw } }
  return null
}

// the first capture the Wayback Machine holds of a page ({ date: null } when it never archived it), or undefined
// when it cannot be known now (the failure is noted, the page keeps what it had)
async function firstCapture(ctx, url) {
  try {
    const r = await ctx.fetch('cdx', `/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&fl=timestamp,original,statuscode&filter=statuscode:200&limit=1`, { retries: 2, timeout: 60000 })
    if (r.status !== 200) throw new Error(`the Wayback Machine answered ${r.status}`)
    const row = JSON.parse(r.body.toString('utf8') || '[]').slice(1).find(x => !x[2] || x[2] === '200') // a 404 or a redirect dates nothing
    return { date: row ? `${row[0].slice(0, 4)}-${row[0].slice(4, 6)}-${row[0].slice(6, 8)}` : null, url: row ? `https://web.archive.org/web/${row[0]}/${row[1]}` : null, journal: r.journal }
  } catch (e) { ctx.fail(ctx.t('cdx_failed', { url, error: e.message })); return undefined }
}

// a page's dates, its entity, its lines on the timeline and its place in state.pages; the earliest of its dates and
// which one it is (page, posted, archived)
function settle(ctx, url, x) {
  // the first capture dates the PAGE, not the image: it counts for the earliest appearance only when the agent saw the
  // image in that capture (in_capture: true); otherwise it is a line of the timeline, "page archived since"
  const dated = [[x.page_date, 'page'], [x.posted, 'posted'], [x.in_capture === true && x.first_capture, 'archived']].filter(([d]) => d).sort((a, b) => a[0].localeCompare(b[0]))
  const [earliest = null, how = null] = dated[0] ?? []
  const site = siteOf(url), ref = x.source ?? undefined
  const page = { source: x.source ?? null, title: x.title ?? null, author: x.author ?? null, author_url: x.author_url ?? null, engine: x.engine ?? null, match: x.match ?? null,
    posted: x.posted ?? null, page_date: x.page_date ?? null, first_capture: x.first_capture ?? null, first_url: x.first_url ?? null, in_capture: x.in_capture === true, journal: x.journal ?? null, earliest, how }
  const name = (page.title ?? site).slice(0, 60)
  // the dates are this page's own (null included); a title, an engine, a match or an author only when known, for the
  // direct search may have set them on the same page's entity already
  const known = Object.fromEntries(['title', 'engine', 'match', 'author'].filter(k => page[k]).map(k => [k, page[k]]))
  ctx.entity('url', url, { sources: page.source ? [page.source] : [], props: { site, posted: page.posted, page_date: page.page_date, first_capture: page.first_capture, earliest, how, ...known } })
  ctx.timeline([
    page.posted && { date: page.posted, label: ctx.t('tl_posted', { site, author: page.author ?? '?' }), ref, kind: 'posted', url },
    page.page_date && { date: page.page_date, label: ctx.t('tl_page', { name }), ref, kind: 'page', url },
    page.first_capture && { date: page.first_capture, label: ctx.t(page.in_capture ? 'tl_archived' : 'tl_page_archived', { name }), ref, kind: 'wayback', url: page.first_url ?? url },
  ].filter(Boolean))
  ctx.state({ pages: { ...(ctx.state().pages ?? {}), [url]: page } })
  return page
}

// one page where the image appears: its capture (the agent's, or one read of the page by the engine), its own date,
// the date of the post the agent read, its first Wayback capture; its site and its author become entities too
export async function recordPage(ctx, p, given = null) {
  const url = canonicalUrl(p.url), site = siteOf(url)
  let src = given
  if (!src) {
    try { src = await ctx.source({ url, ...(p.capture && { file: p.capture }), ...(p.title && { title: p.title }), reliability: p.capture ? 'B' : 'C' }) }
    catch (e) { if (e.userError) throw e; ctx.fail(ctx.t('page_unread', { url, error: e.message })) }
  }
  const html = src && !(src.status >= 400) && /html/i.test(src.contentType ?? '') ? src.body.toString('utf8') : null
  const pd = html ? pageDate(html) : null, posted = p.posted ? dayOf(p.posted) : null
  if (p.posted && !posted) ctx.fail(ctx.t('bad_date', { url, date: p.posted }))
  const first = await firstCapture(ctx, url)
  const title = p.title ?? (html && /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1].replace(/\s+/g, ' ').trim()) ?? null
  ctx.entity('domain', site, { sources: src ? [src.id] : [], props: { role: 'site' } })
  const page = settle(ctx, url, { ...p, source: src?.id, title: title || null, posted, page_date: pd?.date, first_capture: first?.date, first_url: first?.url, in_capture: p.in_capture === true, journal: first?.journal })
  ctx.relate(['url', url], ['domain', site], 'on', src?.id)
  if (p.author) {
    const account = p.author_url ? canonicalUrl(p.author_url) : `${site}/${String(p.author).replace(/^@/, '')}`
    ctx.entity('account', account, { sources: src ? [src.id] : [], props: { site, handle: String(p.author) } })
    ctx.relate(['url', url], ['account', account], 'posted by', src?.id)
  }
  return page
}

// the earliest dated page is the candidate for the first appearance: a read clue citing its source and the Wayback
// query, a flag on the timeline, state.first; nothing new when the candidate has not changed
export function updateFirst(ctx) {
  const st = ctx.state(), dated = Object.entries(st.pages ?? {}).filter(([, x]) => x.earliest).sort((a, b) => a[1].earliest.localeCompare(b[1].earliest))
  if (!dated.length) return null
  const [url, x] = dated[0]
  if (st.first?.url === url && st.first?.date === x.earliest) return st.first
  const site = siteOf(url)
  const c = ctx.clue(ctx.t('first_seen', { site, date: x.earliest, how: ctx.t(`how_${x.how}`), url }), { status: 'read', sources: x.source ? [x.source] : [], ...(x.journal && { journal: x.journal }), title: ctx.t('first_title', { site, date: x.earliest }) })
  ctx.timeline([{ date: x.earliest, label: ctx.t('tl_first', { name: (x.title ?? site).slice(0, 60) }), ref: c.id, kind: 'earliest', url }])
  const first = { url, date: x.earliest, how: x.how, clue: c.id }
  ctx.state({ first })
  return first
}

const earlier = (a, b) => (!a ? b : !b ? a : (dayOf(b) ?? '9') < (dayOf(a) ?? '9') ? b : a)
const cdxItems = ctx => Object.entries(ctx.state().pages ?? {}).map(([key, x]) => ({ key, first_capture: x.first_capture }))
async function firstSeen(ctx, args, flags) {
  if (flags.cdx) return refreshCdx(ctx)
  if (!flags.file) ctx.refuse('first-seen --file pages.json — [{ "url", "posted"?, "capture"?, "title"?, "author"?, "author_url"?, "engine"?, "match"?, "in_capture"? }] — or first-seen --cdx')
  let list
  try { list = JSON.parse(fs.readFileSync(flags.file, 'utf8')) } catch (e) { ctx.refuse(`first-seen --file: ${e.message}`) }
  if (!Array.isArray(list) || !list.length || list.some(p => !isUrl(p?.url))) ctx.refuse('first-seen --file: a JSON list of pages, each with its "url" (http or https)')
  for (const p of list) if (p.capture && !fs.statSync(p.capture, { throwIfNoEntry: false })?.isFile()) ctx.refuse(`first-seen: no capture file ${p.capture} (page ${p.url})`)
  // the same page under several addresses is one page: the first mention's fields, the earliest post date
  const pages = new Map()
  for (const p of list) {
    const url = canonicalUrl(p.url), had = pages.get(url)
    pages.set(url, had ? { ...p, ...had, posted: earlier(had.posted, p.posted) } : { ...p, url })
  }
  let n = 0
  for (const p of pages.values()) { ctx.progress(++n, pages.size, siteOf(p.url)); await recordPage(ctx, p) }
  const first = updateFirst(ctx)
  ctx.snapshot('cdx', cdxItems(ctx))
  ctx.log(first ? ctx.t('pages_recorded', { n: pages.size, dated: Object.values(ctx.state().pages).filter(x => x.earliest).length, date: first.date, site: siteOf(first.url) }) : ctx.t('no_dated'))
}
// Refresh: the first Wayback capture of every known page, again
async function refreshCdx(ctx) {
  const pages = Object.entries(ctx.state().pages ?? {})
  if (!pages.length) ctx.refuse('no page recorded yet: first-seen --file pages.json first')
  let n = 0
  for (const [url, x] of pages) {
    ctx.progress(++n, pages.length, siteOf(url))
    const first = await firstCapture(ctx, url)
    if (first !== undefined) settle(ctx, url, { ...x, first_capture: first.date, first_url: first.url, journal: first.journal })
  }
  updateFirst(ctx)
  ctx.snapshot('cdx', cdxItems(ctx))
}

// ---------------------------------------------------------------- intake: the original, its frames

const base = f => String(f).split('/').pop()
const relOf = (ctx, abs) => path.relative(ctx.dir, abs).split(path.sep).join('/')
const lastLine = s => String(s ?? '').trim().split('\n').filter(Boolean).pop() ?? ''
const evidenceOf = (ctx, rel) => ctx.case().evidence.find(e => e.file === rel)
// each command rewrites its own group of views/evidence.json (intake, meta, direct); the other groups stay
export function evidenceGroup(ctx, group, rows) {
  let v = { items: [] }
  try { v = JSON.parse(fs.readFileSync(ctx.file('.osint/views/evidence.json'), 'utf8')) } catch {}
  ctx.view('evidence', { items: [...(v.items ?? []).filter(i => i.group !== group), ...rows.map(i => ({ ...i, group }))] })
}

async function intake(ctx, args, flags) {
  const i = ctx.input, st = ctx.state()
  if (i.media !== 'video') {
    let file = st.original ?? i.image
    // an image given by its link: downloaded once into Evidence, its URL kept (case.json), or nothing at all
    if (isUrl(file)) {
      try { file = (await ctx.evidence(file, { kind: 'original', input: 'image' })).file } catch (err) {
        ctx.fail(ctx.t('image_unread', { url: file, error: lastLine(err.message) }))
        ctx.refuse(`${file}: the image could not be downloaded (${lastLine(err.message)}); nothing was added to Evidence. Download it by hand and give the file (new verify-media --file …)`)
      }
    }
    const e = evidenceOf(ctx, file), size = ctx.media.imageSize(file)
    ctx.entity('image', e.url ?? base(file), { props: { sha256: e.sha256, file: base(file), url: e.url ?? null, width: size?.width ?? null, height: size?.height ?? null } })
    ctx.state({ media: 'image', original: file })
    return ctx.log(ctx.t('intake_image', { file: base(file), size: size ? `${size.width}×${size.height}` : '?' }))
  }
  let video = st.original ?? i.video
  if (isUrl(video)) {
    ctx.progress(1, 3, 'yt-dlp')
    let got
    // a page without a video: no half-evidence, the page stays as an entity, the agent is told what to give instead
    try { got = await ctx.media.download(video) } catch (err) {
      if (err.userError && err.code === 3) throw err
      const why = lastLine(err.message)
      ctx.entity('url', canonicalUrl(video), { props: { site: siteOf(video), video: 'none found' } })
      ctx.fail(ctx.t('no_video', { url: video, error: why }))
      ctx.refuse(`${video}: no video could be downloaded (${why}); nothing was added to Evidence. Give the image by its URL (new verify-media <image URL>) or the video as a file (--file)`)
    }
    const info = got.info ?? {}, e = await ctx.evidence(got.file, { kind: 'original', input: 'video' })
    ctx.media.dropDownload(got.file)
    const src = await ctx.source({ url: canonicalUrl(info.webpage_url ?? video), body: JSON.stringify(info, null, 2), contentType: 'application/json', title: ctx.t('video_page', { title: info.title ?? video }), reliability: 'C' })
    ctx.entity('video', video, { sources: [src.id], props: { sha256: e.sha256, file: base(e.file), url: video, duration_s: info.duration ?? null } })
    // the page the video was posted on is a dated page like the others (first-seen): its post date, its author
    const day = /^\d{8}$/.test(info.upload_date ?? '') ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6)}` : null
    await recordPage(ctx, { url: info.webpage_url ?? video, posted: day, title: info.title ?? null, author: info.uploader ?? null, author_url: info.uploader_url ?? info.channel_url ?? null, engine: 'web' }, src)
    updateFirst(ctx)
    ctx.state({ media: 'video', original: e.file, video_page: src.id })
    video = e.file
  } else {
    const e = evidenceOf(ctx, video)
    ctx.entity('video', base(video), { props: { sha256: e.sha256, file: base(video) } })
    ctx.state({ media: 'video', original: video })
  }
  ctx.progress(2, 3, 'key frames')
  let r
  try { r = await ctx.media.frames(video, { max: Number(flags.max ?? 16), scene: Number(flags.scene ?? 0.3) }) } catch (err) {
    if (err.userError) throw err
    ctx.fail(`key frames of ${base(video)}: ${lastLine(err.message)}`)
    ctx.refuse(`ffmpeg could not read ${base(video)} (${lastLine(err.message)}): check the file, or give the clearest frame as an image`)
  }
  evidenceGroup(ctx, 'intake', r.frames.map((f, k) => ({ file: relOf(ctx, f.file), kind: 'frame', t: f.t, label: f.t == null ? `frame ${k + 1}` : `${f.t.toFixed(1)} s` })))
  ctx.log(ctx.t('frames', { n: r.frames.length, file: base(video), how: r.how }))
  ctx.progress(3, 3, 'key frames')
}

// ---------------------------------------------------------------- meta: the file's metadata, its thumbnail, its C2PA

// a program's whole output (exiftool -b writes binary): never throws, an exit code of -1 when it could not start
const spawnOut = (bin, args) => new Promise(ok => {
  const p = spawn(bin, args, { windowsHide: true }), out = [], err = []
  p.stdout.on('data', d => out.push(d))
  p.stderr.on('data', d => err.push(d))
  p.on('error', e => ok({ code: -1, out: Buffer.alloc(0), err: e.message }))
  p.on('close', code => ok({ code, out: Buffer.concat(out), err: Buffer.concat(err).toString('utf8') }))
})

// what exiftool -j -G1 -a -n says, as clues: tags read like GeoINT's meta.py (the pinned pack, MIT). Metadata is
// evidence about the file, not about the scene; file-system dates (System:*) are this copy's, never the image's
const TAKEN = ['ExifIFD:DateTimeOriginal', 'ExifIFD:CreateDate', 'XMP-exif:DateTimeOriginal', 'XMP-photoshop:DateCreated', 'XMP-xmp:CreateDate', 'IPTC:DateCreated', 'Keys:CreationDate', 'QuickTime:CreateDate']
const MODIFIED = ['IFD0:ModifyDate', 'XMP-xmp:ModifyDate', 'XMP-xmp:MetadataDate']
const OFFSET_OF = { 'ExifIFD:DateTimeOriginal': 'ExifIFD:OffsetTimeOriginal', 'ExifIFD:CreateDate': 'ExifIFD:OffsetTimeDigitized', 'IFD0:ModifyDate': 'ExifIFD:OffsetTime' }
const SOFTWARE = ['IFD0:Software', 'XMP-xmp:CreatorTool', 'Keys:Software']
const CAPTION = ['IPTC:Caption-Abstract', 'XMP-dc:Description', 'IFD0:ImageDescription']
const GENERATION = ['PNG:Parameters', 'PNG:Prompt', 'PNG:Workflow', 'PNG:Dream']
const META = /^(IFD\d|ExifIFD|GPS|InteropIFD|SubIFD\d*|XMP-|IPTC|Photoshop|MakerNotes|Keys|ItemList|UserData)/
const AI_SOURCE = /(trainedAlgorithmicMedia|compositeWithTrainedAlgorithmicMedia)$/
const GENERATORS = /midjourney|dall[·.\s-]?e|stable[\s-]?diffusion|firefly|imagen|gpt-4o|chatgpt|flux|ideogram|leonardo\.ai|novelai|comfyui|automatic1111|invokeai/i
const JUNK = /^(SONY DSC|OLYMPUS DIGITAL CAMERA|DIGITAL CAMERA|default|Exif_JPEG_PICTURE)$/i
// a metadata date as exiftool writes it (2021:11:12 14:06:13[.sss][+01:00|Z], or a day): the local time as written,
// its offset when the file gives one; a zero or impossible date is no date
function exifTime(v) {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(String(v ?? '').trim())
  if (!m || !dayOf(`${m[1]}-${m[2]}-${m[3]}`, undefined, 1900)) return null
  return { local: `${m[1]}-${m[2]}-${m[3]}${m[4] ? `T${m[4]}:${m[5]}:${m[6] ?? '00'}` : ''}`, offset: !m[7] ? null : m[7] === 'Z' ? '+00:00' : m[7].replace(/^([+-]\d{2}):?(\d{2})$/, '$1:$2') }
}
export function readExif(raw = {}) {
  const get = k => { const v = raw[k]; return v == null || (typeof v === 'string' && !v.trim()) ? null : v }
  const first = (keys, ok = () => true) => { for (const tag of keys) { const v = get(tag); if (v != null && ok(String(v).trim())) return { tag, value: String(v).trim() } } return null }
  const time = keys => { for (const tag of keys) { const t = exifTime(get(tag)); if (t) return { ...t, offset: t.offset ?? (/^[+-]\d{2}:\d{2}$/.test(get(OFFSET_OF[tag]) ?? '') ? get(OFFSET_OF[tag]) : null), tag } } return null }
  const taken = time(TAKEN)
  let modified = time(MODIFIED)
  if (modified && taken && modified.local.slice(0, 16) === taken.local.slice(0, 16)) modified = null
  // the signed composite position; (0, 0) is a blank field, not a place off Africa
  const lat = Number(get('Composite:GPSLatitude')), lon = Number(get('Composite:GPSLongitude'))
  const gps = get('Composite:GPSLatitude') != null && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0) ? { lat, lon, tag: 'Composite:GPSLatitude' } : null
  const make = get('IFD0:Make') ?? get('Keys:Make'), model = get('IFD0:Model') ?? get('Keys:Model'), lens = get('ExifIFD:LensModel')
  const camera = [make && model && String(model).startsWith(make) ? null : make, model, lens && `(${lens})`].filter(Boolean).join(' ') || null
  const software = first(SOFTWARE), caption = first(CAPTION, v => !JUNK.test(v)), gen = first(GENERATION)
  const ai = Object.entries(raw).filter(([k, v]) => /DigitalSourceType$/.test(k) && AI_SOURCE.test(String(v))).map(([tag, value]) => ({ tag, value: String(value) }))
  const generator = gen ? { tag: gen.tag, value: gen.value.replace(/\s+/g, ' ').slice(0, 160) } : software && GENERATORS.test(software.value) ? software : null
  return { empty: !Object.keys(raw).some(k => META.test(k)) && !gen, camera, software: software?.value ?? null, taken, modified, gps, caption: caption && { ...caption, value: caption.value.slice(0, 300) }, ai, generator }
}

// what c2patool reports: the active manifest's signer, generator and actions; an AI source type anywhere in the
// store (an ingredient's own manifest counts: an image opened and re-saved keeps its origin); valid only when signed,
// Valid or Trusted, without a failure, and with its signer's trust established (an unrecognised signer stays capped)
export function readC2pa(j) {
  const all = Object.values(j.manifests ?? {}), m = j.manifests?.[j.active_manifest] ?? all[0] ?? {}
  const agentOf = a => (typeof a?.softwareAgent === 'string' ? a.softwareAgent : a?.softwareAgent?.name) ?? null
  const actionsOf = x => (x.assertions ?? []).filter(a => /^c2pa\.actions/.test(a.label)).flatMap(a => a.data?.actions ?? [])
  const aiAction = [m, ...all.filter(x => x !== m)].flatMap(actionsOf).find(a => AI_SOURCE.test(a.digitalSourceType ?? ''))
  const failures = [...new Set([...(j.validation_results?.activeManifest?.failure ?? []), ...(j.validation_status ?? [])].map(f => f.code))]
  const state = j.validation_state ?? (failures.length ? 'Invalid' : null)
  // a self-signed manifest can be "Valid" (well-formed, signature checks out) without anyone vouching for its signer:
  // the cap lifts only when the signer's trust is established — "Trusted", an explicit signingCredential.trusted, or a
  // chain checked up to a revocation answer (signingCredential.ocsp.notRevoked, which c2patool gives for Adobe's)
  const ok = new Set((j.validation_results?.activeManifest?.success ?? []).map(f => f.code))
  const untrusted = [...(j.validation_results?.activeManifest?.informational ?? []), ...(j.validation_results?.activeManifest?.failure ?? [])].some(f => f.code === 'signingCredential.untrusted')
  const trusted = !untrusted && (state === 'Trusted' || ok.has('signingCredential.trusted') || ok.has('signingCredential.ocsp.notRevoked'))
  const signer = m.signature_info ? { issuer: m.signature_info.issuer ?? null, common_name: m.signature_info.common_name ?? null, time: m.signature_info.time ?? null } : null
  return {
    state, signer, failures, trusted,
    generator: (m.claim_generator_info?.[0]?.name ?? m.claim_generator ?? null)?.replace(/_/g, ' ') ?? null,
    actions: actionsOf(m).map(a => ({ action: a.action, type: a.digitalSourceType ?? null, agent: agentOf(a) })),
    ai: aiAction ? { type: aiAction.digitalSourceType.split('/').pop(), agent: agentOf(aiAction) } : null,
    ingredients: (m.ingredients ?? []).map(i => ({ title: i.title ?? '?', relationship: i.relationship ?? '?' })),
    valid: !!signer && ['Valid', 'Trusted'].includes(state) && !failures.length && trusted,
  }
}
// without c2patool: does the file seem to carry a manifest (a JUMBF box labelled c2pa in a JPEG, a caBX chunk in a PNG)?
export const c2paHint = buf => { const s = buf.toString('latin1'); return (s.includes('jumb') && s.includes('c2pa')) || s.includes('caBX') }
// the first 64 MB of a file (a video can weigh gigabytes; a manifest sits near the start)
function head(abs, max = 64e6) {
  const fd = fs.openSync(abs, 'r')
  try { const b = Buffer.alloc(Math.min(max, fs.fstatSync(fd).size)); fs.readSync(fd, b, 0, b.length, 0); return b } finally { fs.closeSync(fd) }
}

async function exifClues(ctx, file, raw) {
  const x = readExif(raw), name = base(file)
  const src = await ctx.source({ url: `exiftool:${file}`, body: JSON.stringify(raw, null, 2), contentType: 'application/json', title: ctx.t('exif_source', { file: name }), reliability: 'B' })
  const I = { status: 'inferred', sources: [src.id] }, R = { status: 'read', sources: [src.id] }
  if (x.empty) { ctx.clue(ctx.t('exif_none', { file: name }), I); return src.id }
  if (x.camera) ctx.clue(ctx.t('exif_camera', { camera: x.camera }), I)
  if (x.software && x.software !== x.generator?.value) ctx.clue(ctx.t('exif_software', { file: name, software: x.software }), I)
  if (x.taken) {
    ctx.clue(ctx.t('exif_taken', { time: x.taken.local.replace('T', ' '), offset: x.taken.offset ? ctx.t('exif_offset', { offset: x.taken.offset }) : '', tag: x.taken.tag }), I)
    ctx.timeline([{ date: x.taken.local.slice(0, 10), label: ctx.t('tl_taken', { file: name }), ref: src.id, kind: 'taken' }])
  }
  if (x.modified) ctx.clue(ctx.t('exif_modified', { modified: x.modified.local.replace('T', ' '), tag: x.modified.tag, taken: x.taken?.local.replace('T', ' ') ?? '?' }), I)
  if (x.gps) {
    ctx.entity('place', ctx.t('exif_place', { file: name }), { sources: [src.id], props: { lat: x.gps.lat, lon: x.gps.lon } })
    ctx.clue(ctx.t('exif_gps', { lat: x.gps.lat, lon: x.gps.lon, tag: x.gps.tag }), I)
  }
  if (x.caption) ctx.clue(ctx.t('exif_caption', { tag: x.caption.tag, text: x.caption.value }), I)
  for (const a of x.ai) ctx.clue(ctx.t('exif_ai', a), R)
  if (x.generator) ctx.clue(ctx.t('exif_generator', x.generator), R)
  return src.id
}

// the embedded thumbnail (or preview) kept as derived evidence; a framing that differs from the image's says it was
// cropped or edited after the thumbnail was made (the 3 % rule of meta.py)
async function thumbnail(ctx, file, srcId) {
  for (const tag of ['ThumbnailImage', 'PreviewImage']) {
    const r = await spawnOut('exiftool', ['-b', `-${tag}`, ctx.file(file)])
    if (r.out.length < 500) continue
    const stem = base(file).replace(/^E\d{2,}-/, '').replace(/\.[^.]+$/, ''), tmp = ctx.file(`.osint/cache/${stem}-${tag}.jpg`)
    fs.mkdirSync(path.dirname(tmp), { recursive: true })
    fs.writeFileSync(tmp, r.out)
    const e = await ctx.evidence(tmp, { of: evidenceOf(ctx, file)?.id ?? null, kind: 'derived', name: `${stem}-thumbnail.jpg` })
    const t = ctx.media.imageSize(e.file), m = ctx.media.imageSize(file)
    const differs = !!(t && m) && Math.abs(t.width / t.height - m.width / m.height) > 0.03 && Math.abs(t.width / t.height - m.height / m.width) > 0.03
    ctx.clue(ctx.t(differs ? 'thumb_differs' : 'thumb_kept', { file: base(file), thumb: base(e.file), w: (differs ? m : t)?.width ?? '?', h: (differs ? m : t)?.height ?? '?', tw: t?.width ?? '?', th: t?.height ?? '?' }), { status: 'inferred', where: base(e.file), sources: [srcId] })
    return e.file
  }
  return null
}

async function c2paClues(ctx, file) {
  const r = await spawnOut('c2patool', [ctx.file(file)]), name = base(file), title = ctx.t('c2pa_source', { file: name })
  if (r.code !== 0) {
    if (!/no claim found/i.test(r.err)) { ctx.fail(`c2patool on ${name}: ${lastLine(r.err) || `exit ${r.code}`}`); return { found: false, error: lastLine(r.err) } }
    const src = await ctx.source({ url: `c2pa:${file}`, body: r.err, contentType: 'text/plain', title, reliability: 'A' })
    ctx.clue(ctx.t('c2pa_none', { file: name }), { status: 'read', sources: [src.id] })
    return { found: false }
  }
  let report
  try { report = JSON.parse(r.out.toString('utf8')) } catch { ctx.fail(`c2patool on ${name}: its report is not JSON`); return { found: false } }
  const c = readC2pa(report)
  const src = await ctx.source({ url: `c2pa:${file}`, body: JSON.stringify(report, null, 2), contentType: 'application/json', title, reliability: c.valid ? 'A' : 'C' })
  const R = { status: 'read', sources: [src.id] }
  ctx.clue(ctx.t('c2pa_signed', { file: name, issuer: c.signer?.issuer ?? '?', name: c.signer?.common_name ?? '?', state: c.state ?? '?', generator: c.generator ? ctx.t('c2pa_generator', { generator: c.generator }) : '' }), R)
  const actions = [...new Set(c.actions.map(a => [a.action.replace(/^c2pa\./, ''), a.type?.split('/').pop(), a.agent].filter(Boolean).join(' · ')))]
  if (actions.length) ctx.clue(ctx.t('c2pa_actions', { file: name, actions: actions.join(', ') }), R)
  if (c.ai) ctx.clue(ctx.t('c2pa_ai', { file: name, type: c.ai.type, agent: c.ai.agent ? `, ${c.ai.agent}` : '' }), R)
  if (!c.valid) ctx.clue(ctx.t('c2pa_invalid', { file: name, codes: c.failures.join(', ') || (c.state === 'Valid' && !c.trusted ? 'signer not trusted' : c.state) || 'unsigned' }), R)
  if (c.ingredients.length) ctx.clue(ctx.t('c2pa_ingredients', { file: name, list: c.ingredients.map(i => `${i.title} (${i.relationship})`).join(', ') }), R)
  return { found: true, state: c.state, valid: c.valid, signer: c.signer?.issuer ?? null, ai: !!c.ai }
}

async function meta(ctx, args, flags) {
  const st = ctx.state()
  if (!st.original) ctx.refuse('verify-media intake first: it sets the original the case studies')
  const files = flags.files ? flags.files.split(',').map(s => ctx.evidenceFile(s.trim())) : [st.original]
  const exif = hasBin('exiftool'), c2pa = hasBin('c2patool'), all = { ...(st.meta ?? {}) }
  let n = 0
  for (const file of files) {
    ctx.progress(++n, files.length, base(file))
    const had = all[file] ?? {}, m = { exiftool: exif || !!had.exiftool, thumbnail: had.thumbnail ?? null, c2pa: had.c2pa ?? { checked: false, found: false } }
    if (exif) {
      const r = await spawnOut('exiftool', ['-j', '-G1', '-a', '-n', '-ee', '-api', 'LargeFileSupport=1', ctx.file(file)])
      let raw = null
      try { raw = JSON.parse(r.out.toString('utf8'))[0] } catch { ctx.fail(`exiftool on ${base(file)}: ${lastLine(r.err) || `exit ${r.code}`}`) }
      if (raw) { const srcId = await exifClues(ctx, file, raw); m.thumbnail ??= await thumbnail(ctx, file, srcId) }
    }
    if (c2pa) m.c2pa = { checked: true, ...(await c2paClues(ctx, file)) }
    else if (c2paHint(head(ctx.file(file)))) ctx.clue(ctx.t('c2pa_unchecked', { file: base(file) }), { status: 'inferred' })
    all[file] = m
  }
  // only a manifest of the original itself lifts the cap on integrity (a thumbnail's or a derived file's never does)
  const orig = all[st.original]?.c2pa
  ctx.state({ meta: all, ...(orig?.checked && { c2pa_valid: !!orig.valid }) })
  evidenceGroup(ctx, 'meta', Object.entries(all).filter(([, x]) => x.thumbnail).map(([f, x]) => ({ file: x.thumbnail, kind: 'thumbnail', label: `thumbnail of ${base(f)}` })))
  const missing = [!exif && `exiftool (${INSTALL.exiftool}): EXIF, XMP, IPTC and the embedded thumbnail unread`, !c2pa && `c2patool (${INSTALL.c2patool}): no C2PA manifest check`].filter(Boolean)
  if (missing.length) ctx.refuse(`meta ran without ${missing.join('; without ')}`, 3)
}

// ---------------------------------------------------------------- direct: Yandex and Baidu without the tunnel

const ENGINES = { yandex: 'Yandex', baidu: 'Baidu' }
const UNMASKED = 'sent unmasked (verify-media)'
// revimg.py of the GeoINT pack uploads the files to Yandex and Baidu from a headless Chromium (§ 8.3): the same frame
// as the tunnel (sendList), and verify-media's exception — --unmasked sends a picture people show on, for exact copies,
// and the Journal says which files left unmasked and to which engines. Without --files: what the last run sent
async function direct(ctx, args, flags) {
  const st = ctx.state()
  if (!st.original) ctx.refuse('verify-media intake first: it sets the original the case studies')
  const replay = !flags.files && !!st.direct?.files?.length
  if (st.media === 'video' && !flags.files && !replay) ctx.refuse('a video: send its key frames (direct --files Evidence/frames/<frame>.jpg,…), see frames-reverse in method.md')
  const refs = flags.files ? flags.files.split(',').map(s => s.trim()) : replay ? st.direct.files : [st.original]
  let unmasked = !!flags.unmasked || (replay && !!st.direct.unmasked), replayed = refs
  // an unmasked send is the user's yes each time; a replay (refresh) without it sends again only what is masked or declared clear
  if (replay && !flags.unmasked && unmasked && !flags.yes) {
    const ok = ctx.sendable()
    replayed = refs.filter(r => ok(ctx.evidenceFile(r)).ok)
    unmasked = false
    if (replayed.length < refs.length) ctx.log(ctx.t('direct_replay_skipped', { files: refs.filter(r => !replayed.includes(r)).map(base).join(', ') }))
    if (!replayed.length) return
  }
  if (unmasked && !flags.yes) ctx.refuse("--unmasked sends the picture with the people visible in it to Yandex and Baidu: the user's yes (the dashboard's « Open unmasked » dialog says it), then --yes", 2)
  if (flags['no-people']) ctx.declareClear(refs)
  const list = sendList(ctx.dir, replayed, { unmasked, yes: !!flags.yes })
  if (!packReady()) ctx.refuse('the direct upload to Yandex and Baidu needs the GeoINT pack (osint.mjs setup geoint); the tunnel\'s links work without it (reverse --files …)', 3)
  const engines = Object.keys(ENGINES), names = Object.values(ENGINES).join(', ')
  const bare = list.filter(x => x.why === UNMASKED), clear = list.filter(x => x.why !== UNMASKED)
  if (bare.length) ctx.log(ctx.t('direct_unmasked', { engines: names, files: bare.map(x => base(x.rel)).join(', ') }))
  if (clear.length) ctx.log(ctx.t('direct_sent', { engines: names, files: clear.map(x => base(x.rel)).join(', ') }))
  const out = ctx.file('.osint/geoint/direct')
  fs.rmSync(out, { recursive: true, force: true })
  ctx.progress(1, 2, 'Yandex, Baidu')
  const copies = []
  for (const x of list) copies.push(await ctx.sendCopy(x.rel)) // never the file as it is: no EXIF, no GPS
  const r = await ctx.python('revimg.py', [...copies.map(x => x.abs), '--out-dir', out, '--engines', engines.join(',')], { label: 'direct reverse search' })
  if (r.code !== 0) ctx.fail(`revimg.py: ${lastLine(r.err) || `exit ${r.code}`}`)
  ctx.progress(2, 2, 'results')
  const items = [], sheets = []
  for (const f of fs.existsSync(out) ? fs.readdirSync(out).filter(n => /_(yandex|baidu)\.json$/.test(n)).sort() : []) {
    let d
    try { d = JSON.parse(fs.readFileSync(path.join(out, f), 'utf8')) } catch { continue }
    const engine = /_(yandex|baidu)\.json$/.exec(f)[1], E = ENGINES[engine], file = path.basename(String(d.image ?? f))
    let src = null
    if (d.screenshot && fs.existsSync(d.screenshot)) {
      src = await ctx.source({ url: d.url || `${engine}:${file}`, file: d.screenshot, title: ctx.t('direct_results', { engine: E, file }), reliability: 'C' })
      sheets.push({ file: src.capture, kind: 'sheet', label: ctx.t('direct_results', { engine: E, file }), page: d.url || null })
    }
    // Baidu "refused this image" is no answer, not "no result": said as such
    if (d.error) ctx.fail(ctx.t('direct_error', { engine: E, file, error: d.error }))
    if (d.guess?.length) ctx.log(ctx.t('direct_guess', { engine: E, file, guess: d.guess.join(' / ').slice(0, 200) }))
    const found = [...(d.links ?? []).map(l => ({ url: l.url, title: l.title ?? null })), ...(d.similar ?? []).map(s => ({ url: s.from, title: null, similar: true }))]
    for (const l of found.filter(x => isUrl(x.url)).slice(0, 25)) {
      const url = canonicalUrl(l.url)
      ctx.entity('url', url, { sources: src ? [src.id] : [], props: { site: siteOf(url), engine, ...(l.title && { title: l.title }), ...(l.similar && { match: 'similar' }) } })
      items.push({ key: url, engine, title: l.title })
    }
    if (d.similar_sheet && fs.existsSync(d.similar_sheet)) sheets.push({ file: ctx.crop(d.similar_sheet, `direct/${path.basename(d.similar_sheet)}`), kind: 'sheet', label: `${E}: similar images of ${file}` })
  }
  const pages = [...new Map(items.map(i => [i.key, i])).values()]
  ctx.snapshot('direct', pages)
  evidenceGroup(ctx, 'direct', sheets)
  ctx.state({ direct: { files: list.map(x => x.rel), unmasked, at: new Date().toISOString() } })
  ctx.log(ctx.t('direct_done', { n: pages.length, engines: names }))
}

export const commands = {
  direct: { help: 'Yandex and Baidu by direct upload (the GeoINT pack\'s revimg.py), within the frame: --files E01,… [--no-people | --unmasked]; without --files, what was sent last', flags: { files: 'string', 'no-people': 'boolean', unmasked: 'boolean' }, run: direct },
  meta: { help: 'the file\'s metadata (exiftool), its embedded thumbnail, its C2PA manifest (c2patool); --files E01,E02 (default: the original)', flags: { files: 'string' }, run: meta },
  intake: { help: 'the original: an image measured (downloaded once when given by link); a video\'s key frames (ffmpeg), by link through yt-dlp with its page dated', flags: { max: 'string', scene: 'string' }, run: intake },
  'first-seen': { help: 'each page where the image appears, dated (its own date, the post date the agent read, its first Wayback capture): --file pages.json; --cdx asks the Wayback Machine again', flags: { file: 'string', cdx: 'boolean' }, run: firstSeen },
}
