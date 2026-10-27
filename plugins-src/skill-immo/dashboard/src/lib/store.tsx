import { reference } from "@engine/market.js"
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import { api, type Profile, type SearchData, type State, type Stats } from "@/lib/api"

// what the user asks Claude, collected across the dashboard and copied as one prompt
export type FeedbackKind = "affiner" | "analyser" | "comparer" | "ajouter" | "question"
export type Feedback = { kind: FeedbackKind; text: string }

type Ctx = {
  slug: string
  data: SearchData
  state: State
  profile: Profile
  reload: () => Promise<void>
  setProfile: (p: Profile) => void
  // the sold price per m² every listing is weighed against, and the stats of its scope
  ref: { ppm2: number; scope: string; count: number } | null
  refStats: Stats | null
  lastVisit: string | null
  selected: string | null
  select: (id: string | null) => void
  compare: string[]
  toggleCompare: (id: string) => void
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

export function SearchProvider({ slug, initial, state: initialState, profile: initialProfile, lastVisit, children }: { slug: string; initial: SearchData; state: State; profile: Profile; lastVisit: string | null; children: ReactNode }) {
  const [data, setData] = useState(initial)
  const [state, setState] = useState(initialState)
  const [profile, setProfile] = useState(initialProfile)
  const [selected, select] = useState<string | null>(null)
  const [compare, setCompare] = useState<string[]>(() => load(`immo:${slug}:compare`))
  const [feedback, setFeedback] = useState<Feedback[]>(() => load(`immo:${slug}:feedback`))
  useEffect(() => save(`immo:${slug}:compare`, compare), [slug, compare])
  useEffect(() => save(`immo:${slug}:feedback`, feedback), [slug, feedback])

  const reload = useCallback(async () => {
    const [d, s] = await Promise.all([api.search(slug), api.state()])
    setData(d)
    setState(s)
  }, [slug])
  const ref = useMemo(() => reference(data.market) as Ctx["ref"], [data.market])
  const refStats = ref && data.market.dvf ? (data.market.dvf[ref.scope as "recent" | "zone" | "commune"] ?? null) : null

  const value: Ctx = {
    slug, data, state, profile, reload, setProfile, ref, refStats, lastVisit, selected, select, compare,
    toggleCompare: id => setCompare(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id].slice(-4))),
    feedback,
    addFeedback: f => setFeedback(fs => [...fs, f]),
    removeFeedback: i => setFeedback(fs => fs.filter((_, k) => k !== i)),
    clearFeedback: () => setFeedback([]),
  }
  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>
}
