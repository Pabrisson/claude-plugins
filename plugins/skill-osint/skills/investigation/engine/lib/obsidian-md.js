// lib/obsidian-md.js — Obsidian's Markdown as Markdown react-markdown draws: a wikilink becomes a link to
// `obsidian:<target>[#anchor]`, an embed an image of `embed:<target>`, the %%comments%% (the engine's block markers
// too) go, a ^block id becomes an anchor `#^id`; code spans and fences are left as they are. Pure.
export function preprocess(md) {
  return String(md).split(/(```[\s\S]*?```|`[^`\n]*`)/g).map((part, i) => (i % 2 ? part : part
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/!\[\[([^\]|#]+)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, t, a, alias) => `![${alias ?? t.trim()}](embed:${encodeURIComponent(t.trim() + (a ?? ''))})`)
    .replace(/\[\[([^\]|#]*)(#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, t, a, alias) => {
      const text = alias ?? (t && a ? `${t.trim()} › ${a.replace(/^#\^?/, '')}` : t.trim() || (a ?? '').replace(/^#\^?/, ''))
      return `[${text}](obsidian:${encodeURIComponent(t.trim() + (a ?? ''))})`
    })
    .replace(/[ \t]\^([\w-]+)[ \t]*$/gm, (_, id) => ` [](#^${id})`))).join('').replace(/\n{3,}/g, '\n\n')
}
export function calloutOf(text) {
  const m = /^\[!(\w+)\]([+-]?)[ \t]*(.*)$/.exec(String(text).trim().split('\n')[0])
  return m ? { type: m[1].toLowerCase(), fold: m[2] || null, title: m[3] || m[1] } : null
}
export function parseTarget(href) {
  const m = /^(obsidian|embed):(.*)$/.exec(href ?? '')
  if (!m) return null
  const s = decodeURIComponent(m[2]), i = s.indexOf('#')
  return { kind: m[1], target: i < 0 ? s : s.slice(0, i), anchor: i < 0 ? null : s.slice(i + 1) }
}
