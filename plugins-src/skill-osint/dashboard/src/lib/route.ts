import { useEffect, useState } from "react"

// the dashboard's pages live in the URL's hash: #/, #/new[/<type>], #/c/<slug>[/<tab>][?note=<path>], #/settings
export type Route =
  | { page: "home" }
  | { page: "new"; type: string | null }
  | { page: "case"; slug: string; tab: string; note: string | null }
  | { page: "settings" }
export function parse(hash: string): Route {
  const [p, query = ""] = hash.replace(/^#/, "").split("?")
  const parts = p.split("/").filter(Boolean), q = new URLSearchParams(query)
  if (parts[0] === "new") return { page: "new", type: parts[1] ?? null }
  if (parts[0] === "c" && parts[1]) return { page: "case", slug: parts[1], tab: parts[2] ?? "brain", note: q.get("note") }
  if (parts[0] === "settings") return { page: "settings" }
  return { page: "home" }
}
export function useRoute(): Route {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const f = () => setHash(location.hash)
    addEventListener("hashchange", f)
    return () => removeEventListener("hashchange", f)
  }, [])
  return parse(hash)
}
export const go = (to: string) => { location.hash = to }
export const caseHref = (slug: string, tab = "brain", note?: string) => `#/c/${slug}/${tab}${note ? `?note=${encodeURIComponent(note)}` : ""}`
// an investigation's page shows its sub-cases too: a sub-case's note is « @<sub-case>/<path> », its view tab
// « <view>~<sub-case> »; a sub-case's own address opens its investigation's page there
export const subNote = (slug: string, path: string) => `@${slug}/${path}`
export function splitNote(note: string): { slug: string | null; path: string } {
  const m = /^@([a-z0-9][a-z0-9-]*)\/(.*)$/.exec(note)
  return m ? { slug: m[1], path: m[2] } : { slug: null, path: note }
}
export const subTab = (slug: string, tab: string) => `${tab}~${slug}`
export function splitTab(tab: string): { slug: string | null; tab: string } {
  const i = tab.lastIndexOf("~")
  return i < 0 ? { slug: null, tab } : { slug: tab.slice(i + 1), tab: tab.slice(0, i) }
}
