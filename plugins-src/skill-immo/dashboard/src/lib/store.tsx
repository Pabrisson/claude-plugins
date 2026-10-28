import { reference, typeOf } from "@engine/market.js"
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import { api, type Listing, type Poi, type Profile, type PropertyType, type SearchData, type State, type Stats } from "@/lib/api"

// what the user asks Claude, collected across the dashboard and copied as one prompt
export type FeedbackKind = "affiner" | "élargir" | "analyser" | "comparer" | "ajouter" | "chercher" | "message" | "question"
export type Feedback = { kind: FeedbackKind; text: string }
// the sold unit price a type is weighed against, and the stats of its scope
export type Ref = { ppm2: number; scope: string; count: number; type: PropertyType }
export type Market = { ref: Ref | null; stats: Stats | null }

type Ctx = {
  slug: string
  data: SearchData
  state: State
  profile: Profile
  reload: () => Promise<void>
  setProfile: (p: Profile) => void
  types: PropertyType[]
  // the market of a type, of a listing's type
  marketOf: (type: PropertyType) => Market
  marketFor: (l: Listing) => Market
  // what the decision aids of a listing read (lib/decide.js)
  aidsFor: (l: Listing) => { ref: Ref | null; pois: Poi[]; isochrones: NonNullable<SearchData["area"]["isochrones"]>; profile: Profile; criteria: SearchData["search"]["criteria"] }
  lastVisit: string | null
  // the search changed on disk since the page loaded it (Claude or the server's watch at work): reloading the page
  // takes the change
  stale: boolean
  // the news not read yet, as of the last check (every few seconds)
  unread: number
  // the news the follow-up scrolls to and lights up (components/news newsKey), "all" for the list's top
  newsFocus: string | null
  focusNews: (key: string | null) => void
  selected: string | null
  select: (id: string | null) => void
  compare: string[]
  toggleCompare: (id: string) => void
  clearCompare: () => void
  feedback: Feedback[]
  addFeedback: (f: Feedback) => void
  removeFeedback: (i: number) => void
  clearFeedback: () => void
}

const SearchContext = createContext<Ctx | null>(null)
export const useSearch = () => useContext(SearchContext)!

// the prompt's items stay in this browser per search, across reloads
const load = (key: string) => { try { return JSON.parse(localStorage.getItem(key) ?? "[]") } catch { return [] } }
const save = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* private window */ } }
// what this tab shows (its view, the dossier open) survives a reload of the page, in this tab only
export function useTabState<T>(key: string, initial: T) {
  const [v, setV] = useState<T>(() => { try { const x = sessionStorage.getItem(key); return x == null ? initial : JSON.parse(x) } catch { return initial } })
  useEffect(() => { try { sessionStorage.setItem(key, JSON.stringify(v)) } catch { /* private window */ } }, [key, v])
  return [v, setV] as const
}

export function SearchProvider({ slug, initial, state: initialState, profile: initialProfile, lastVisit, children }: { slug: string; initial: SearchData; state: State; profile: Profile; lastVisit: string | null; children: ReactNode }) {
  const [data, setData] = useState(initial)
  const [state, setState] = useState(initialState)
  const [profile, setProfile] = useState(initialProfile)
  const [selected, select] = useTabState<string | null>(`immo:${slug}:selected`, null)
  const [compare, setCompare] = useState<string[]>(() => load(`immo:${slug}:compare`))
  const [feedback, setFeedback] = useState<Feedback[]>(() => load(`immo:${slug}:feedback`))
  useEffect(() => save(`immo:${slug}:compare`, compare), [slug, compare])
  useEffect(() => save(`immo:${slug}:feedback`, feedback), [slug, feedback])

  const [stale, setStale] = useState(false)
  const [unread, setUnread] = useState(initial.unread)
  const [newsFocus, focusNews] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [d, s] = await Promise.all([api.search(slug), api.state()])
    setData(d)
    setState(s)
    setUnread(d.unread)
    setStale(false)
  }, [slug])
  // every few seconds, while the page is shown: a newer version than the data's is a change made elsewhere. The
  // page's own changes reload the data, which moves its version along.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.visibilityState === "visible") api.version(slug).then(v => { if (v.version > data.version) setStale(true); setUnread(v.unread) }, () => {})
    }, 4000)
    return () => clearInterval(t)
  }, [slug, data.version])
  const types = useMemo<PropertyType[]>(() => data.search.types ?? ["flat"], [data.search.types])
  const markets = useMemo(() => {
    const out: Partial<Record<PropertyType, Market>> = {}
    for (const t of ["flat", "house", "land", "parking", "premises"] as PropertyType[]) {
      const ref = reference(data.market, t) as Ref | null, d = data.market.dvf?.[t]
      out[t] = { ref, stats: ref && d && ref.scope !== "transactions" ? d[ref.scope as "recent" | "zone" | "commune"] : null }
    }
    return out as Record<PropertyType, Market>
  }, [data.market])
  const pois = useMemo(() => (Array.isArray(data.area.pois) ? data.area.pois : []), [data.area.pois])

  const value: Ctx = {
    slug, data, state, profile, reload, setProfile, types,
    marketOf: t => markets[t],
    marketFor: l => markets[typeOf(l) as PropertyType],
    aidsFor: l => ({ ref: markets[typeOf(l) as PropertyType].ref, pois, isochrones: data.area.isochrones ?? [], profile, criteria: data.search.criteria }),
    lastVisit, stale, unread, newsFocus, focusNews, selected, select, compare,
    toggleCompare: id => setCompare(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id].slice(-4))),
    clearCompare: () => setCompare([]),
    feedback,
    addFeedback: f => setFeedback(fs => [...fs, f]),
    removeFeedback: i => setFeedback(fs => fs.filter((_, k) => k !== i)),
    clearFeedback: () => setFeedback([]),
  }
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
}
