// (importable from node too: the lib checks run without a page, in English)
import FR from "./fr.json" with { type: "json" }

// The dashboard's language (Settings › Language): English by default, French on demand, kept in this browser like the
// theme; a change reloads the page. Its own words come from fr.json, keyed by the English text, which shows wherever a
// key is missing. The words of the engine's catalogs (tools, styles, models' options and why) come from the engine's
// tools/fr.json, read before the first render. What the engine and the APIs say, the model and lab names, the prompts
// sent to the models and the ones copied for the agent stay as they are.
export type Lang = "en" | "fr"
const KEY = "media-generator:ui-lang"
const lang: Lang = (() => {
  try {
    return localStorage.getItem(KEY) === "fr" ? "fr" : "en"
  } catch {
    return "en"
  }
})()
if (typeof document !== "undefined") document.documentElement.lang = lang

export const getLang = () => lang
export function setLang(l: Lang) {
  try {
    localStorage.setItem(KEY, l)
  } catch {
    /* a private window keeps the page as it is */
  }
  window.location.reload()
}
// the locale of dates and numbers
export const locale = () => (lang === "fr" ? "fr-FR" : "en-US")

const fill = (s: string, vars?: Record<string, string | number>) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s)
// a text of the dashboard in its language, its {placeholders} filled
export const t = (en: string, vars?: Record<string, string | number>) => fill(lang === "fr" ? ((FR as Record<string, string>)[en] ?? en) : en, vars)
// the same words kept in English, for a text copied for the agent
export const english = (en: string, vars?: Record<string, string | number>) => fill(en, vars)

// a word of the engine's catalogs as shown (a tool's label, a field's note, a style's group, a model's why): only at
// display, the value kept and sent stays the English one
let catalog: Record<string, string> = {}
export async function loadCatalog() {
  if (lang !== "fr") return
  try {
    catalog = await (await fetch("/api/fr")).json()
  } catch {
    /* the English words then */
  }
}
export const own = <T extends string | undefined | null>(en: T): T => (lang === "fr" && en ? ((catalog[en] as T) ?? en) : en)
