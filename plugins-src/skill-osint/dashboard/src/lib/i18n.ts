import { useSyncExternalStore } from "react"

import FR from "./fr.json"

// The dashboard's language (Settings › Appearance): English by default, French on demand, kept in this browser like the
// theme. The French dictionary is keyed by the English text, which shows wherever a key is missing. The engine's own
// words (activity lines, doctor, errors) and the notes keep the language they were written in.
export type Lang = "en" | "fr"
const KEY = "osint-ui-lang"
let lang: Lang = (() => { try { return localStorage.getItem(KEY) === "fr" ? "fr" : "en" } catch { return "en" } })()
const subs = new Set<() => void>()
document.documentElement.lang = lang

export const getLang = () => lang
export function setLang(l: Lang) {
  lang = l
  try { localStorage.setItem(KEY, l) } catch { /* this visit only */ }
  document.documentElement.lang = l
  subs.forEach(f => f())
}
export const useLang = () => useSyncExternalStore(f => { subs.add(f); return () => { subs.delete(f) } }, getLang)
// the locale of dates and numbers
export const locale = () => (lang === "fr" ? "fr-FR" : "en-GB")

const fill = (s: string, vars?: Record<string, string | number>) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s)
// a text in the dashboard's language, its {placeholders} filled
export const t = (en: string, vars?: Record<string, string | number>) => fill(lang === "fr" ? (FR as Record<string, string>)[en] ?? en : en, vars)

// a type's words in the dashboard's language: its type.json's own "fr" block, keyed by the English text; only the
// fields a person reads (an id, a value, a prompt for the agent never change). The views keep their English label,
// which makes their tab's id: viewTabs shows it through own()
export const own = (m: { fr?: Record<string, string> } | undefined, en: string) => (lang === "fr" ? m?.fr?.[en] ?? en : en)
const SHOWN = new Set(["label", "description", "placeholder", "help", "why", "legal_basis", "high", "medium", "low"])
export function localize<T extends { fr?: Record<string, string> }>(m: T): T {
  const d = lang === "fr" ? m.fr : undefined
  if (!d) return m
  const walk = (v: unknown, k: string): unknown =>
    typeof v === "string" ? (SHOWN.has(k) ? d[v] ?? v : v)
      : k === "views" ? v
        : Array.isArray(v) ? v.map(x => walk(x, k))
        : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([kk, x]) => [kk, walk(x, kk)])) : v
  return walk(m, "") as T
}
