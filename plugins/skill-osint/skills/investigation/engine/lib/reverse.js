// Reverse image search, the parts the engine and the dashboard share: each engine's link for a public image URL,
// which files of a case may leave this machine (a masked copy, or a file the agent looked at and declared free of
// people), and which engine a fetch through the tunnel came from (by its user agent). Pure: the dashboard imports it.
const enc = encodeURIComponent
// verified: the date a link was checked in a browser with a neutral test image (stage 2, task 17); null: not yet
export const ENGINES = [
  { id: 'lens', label: 'Google Lens', link: u => `https://lens.google.com/uploadbyurl?url=${enc(u)}`, verified: '2026-11-04' },
  { id: 'yandex', label: 'Yandex', link: u => `https://yandex.com/images/search?rpt=imageview&url=${enc(u)}`, verified: null },
  { id: 'bing', label: 'Bing', link: u => `https://www.bing.com/images/search?view=detailv2&iss=sbi&form=SBIVSP&sbisrc=UrlPaste&q=imgurl:${enc(u)}`, verified: '2026-11-04' },
  { id: 'tineye', label: 'TinEye', link: u => `https://tineye.com/search?url=${enc(u)}`, verified: '2026-11-04' },
  { id: 'baidu', label: 'Baidu', link: u => `https://image.baidu.com/n/pc_search?queryImageUrl=${enc(u)}`, verified: null },
]
export const reverseLinks = url => ENGINES.map(e => ({ engine: e.id, label: e.label, url: e.link(url), verified: e.verified }))
const PICTURE = /\.(jpe?g|png|webp|gif)$/i
export function sendable(rel, { evidence = [], clear = {} } = {}) {
  const r = String(rel ?? '').replace(/\\/g, '/')
  if (!r.startsWith('Evidence/') || r.split('/').includes('..')) return { ok: false, why: "only a file of the case's Evidence folder" }
  if (r.startsWith('Evidence/captures/')) return { ok: false, why: 'a capture of results, not the picture under study' }
  if (!PICTURE.test(r)) return { ok: false, why: 'the engines take a JPEG, PNG, WebP or GIF' }
  const e = evidence.find(x => x.file === r)
  if (e?.kind === 'masked') return { ok: true, why: `a masked copy of ${e.of}` }
  if (clear[r]) return { ok: true, why: 'looked at by the agent: no person' }
  return { ok: false, why: 'people may show: mask them (evidence mask) or, having looked and seen none, declare it clear (--no-people)' }
}
const BOTS = [['lens', /google/i], ['yandex', /yandex/i], ['bing', /bing|msnbot/i], ['tineye', /tineye/i], ['baidu', /baidu/i]]
export const engineOf = (ua = '') => BOTS.find(([, re]) => re.test(String(ua)))?.[0] ?? 'other'
