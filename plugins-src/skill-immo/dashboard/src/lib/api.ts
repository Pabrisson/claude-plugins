// The engine's local API (immo.mjs serve) and the shapes of a search's files (references/listing-format.md).

export type Point = [number, number]
export type Geometry = { type: "Polygon" | "MultiPolygon"; coordinates: unknown }
export type Status = "to_visit" | "visited" | "offer" | "dropped" | null

export type Listing = {
  id: string
  se_id: string | null
  source: "stream-estate" | "websearch" | "pasted"
  urls: { url: string | null; source: string | null; published_at: string | null; favorites: number | null; urgent: boolean }[]
  title: string | null
  description: string | null
  price: number | null
  net_price: number | null
  area: number | null
  price_per_m2: number | null
  rooms: number | null
  bedrooms: number | null
  floor: number | null
  floors: number | null
  last_floor: boolean | null
  dpe: { energy: string | null; energy_value: number | null; ghg: string | null }
  construction_year: number | null
  lots: number | null
  condition: string | null
  new_build: boolean | null
  features: Record<string, boolean | null | string | string[]>
  outdoor_area: number | null
  location: { point: Point | null; accuracy: string | null; address: string | null; city: string | null; neighborhood: string | null; iris: string | null }
  fees: { agency: { amount: number | null; percentage: number | null; included: boolean | null; paid_by: string | null } | null; condo_yearly: number | null; property_tax: number | null }
  status: string
  publishers: { type: string | null; name: string | null; card: string | null; phone: string | null; email: string | null; website: string | null }[]
  pictures: string[]
  published_at: string | null
  urgent: boolean
  favorites: number | null
  price_changes: { date: string; from: number; to: number; pct: number | null }[]
  first_seen: string
  price_history: { date: string; price: number }[]
  changes: { date: string; kind: "new" | "price_drop" | "price_rise" | "status" | "expired"; from: number | string | null; to: number | string | null }[]
  my_status: Status
  notes: string
  building?: {
    address?: { confidence: string; label: string | null; shown: "address" | "probable" | null }
    ban: string | null
    dpe: { number: string; date: string; energy: string; ghg: string; area: number; floor: number | null; kwh: number; cost: number; heating: string; year: number | null }[]
    dpe_match: string | null
    dpe_cost_yearly: number | null
    construction_year: number | null
    copro: { number: string; name: string; address: string; lots: number; dwellings: number; parking: number; period: string; syndic: string | null; syndic_name: string | null } | null
    risks: { natural: { key: string; label: string }[]; technological: { key: string; label: string }[]; url: string | null } | null
    sales: { id: string; date: string; price: number; area: number; ppm2: number; rooms: number | null }[]
  }
}

export type Stats = { count: number; median_ppm2: number | null; q1: number | null; q3: number | null; median_price: number | null; by_quarter: { quarter: string; count: number; median_ppm2: number }[] }
export type Market = {
  updated?: string
  alsace_moselle?: boolean
  dvf?: { commune: Stats; zone: Stats; street: Stats | null; recent: Stats; years: string[]; points: { id: string; date: string; price: number; area: number; rooms: number | null; ppm2: number; point: Point; address: string }[] } | null
  stream?: {
    updated: string
    trend?: { data?: { group: Record<string, string>; metrics: Record<string, number> }[] }
    dpe?: { data?: { group: Record<string, string>; metrics: Record<string, number> }[] }
    publishers?: { data?: { group: Record<string, string>; metrics: Record<string, number> }[] }
    online?: { data?: { metrics: Record<string, number> }[] }
    transactions?: { count: number; median_ppm2: number | null; by_source: Record<string, number> }
  }
}
export type Poi = { cat: string; kind: string; name: string | null; point: Point }
export type Area = {
  center?: Point
  pois?: Poi[] | { error: string }
  risks?: { natural: { key: string; label: string }[]; technological: { key: string; label: string }[] } | { error: string } | null
  crime?: { commune: { year: number; rows: { indicator: string; count: number | null; rate: number | null }[] } | null; department: { year: number; rows: { indicator: string; count: number | null; rate: number | null }[] } | null } | { error: string }
  income?: Record<"local" | "department" | "france", { geo: string; year: string; median: number | null; poverty: number | null } | null>
  iris?: { code: string; name: string } | null
  isochrones?: { place: string; profile: "pedestrian" | "car"; minutes: number; geometry: Geometry | null }[]
  places?: { label: string; address: string; point: Point }[]
}
export type Search = {
  slug: string
  query: string
  label: string
  mode: "stream-estate" | "classic"
  type: string
  point: Point
  insee: string
  city: string
  district: string | null
  street: { name: string; code_voie: string } | null
  zone: { how: string; kind: "radius" | "polygon"; center?: Point; radius_m?: number; geometry: Geometry; label: string }
  criteria: Criteria
  max: number
  stream: { total: number; counted_at: string } | null
  last_fetch: string | null
  last_refresh: string | null
  last_visit: string | null
  alert: { id: string; topic: string | null; drop: number; enabled?: boolean } | null
}
export type Criteria = Partial<Record<"budget_min" | "budget_max" | "area_min" | "area_max" | "rooms_min" | "rooms_max" | "floor_min", number>> & { dpe_max?: string; elevator?: boolean; outdoor?: boolean }
export type SearchData = { search: Search; listings: Listing[]; market: Market; area: Area; events: { id: string; type: string; property: string; at: string }[] }
export type Profile = { down_payment: number; net_income_monthly: number; other_loans_monthly: number; rate: number; years: number; insurance_rate: number; notary_old: number; notary_new: number; eur_per_credit: number; monthly_credit_cap: number; places: { label: string; address: string; point: Point }[] }
export type UsageEntry = { date: string; route: string; credits: number | null; results: number; search: string | null }
export type State = {
  home: string
  stream_estate: boolean
  costs: Record<string, { credits: number | null; per?: string; note?: string }>
  usage: { month: number; last30: number; unknown: number; cap: number; eur_per_credit: number; by_search: Record<string, { calls: number; credits: number }>; by_route: Record<string, { calls: number; credits: number }>; by_month: Record<string, number> }
  log: UsageEntry[]
}
export type SearchSummary = { slug: string; label: string; mode: "stream-estate" | "classic"; zone: string; created: string; listings: number; online: number }
export type Estimate = { what: string; route: string; credits: number | null; eur: number | null; unknown: boolean; spent: number; cap: number; remaining: number }
export type RunResult = { code: number; out: string; err: string; estimate?: Estimate }

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `${res.status}`)
  return res.json()
}
const post = <T>(url: string, body: unknown) => json<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

export const api = {
  state: () => json<State>("/api/state"),
  searches: () => json<SearchSummary[]>("/api/searches"),
  search: (slug: string) => json<SearchData>(`/api/s/${slug}`),
  visit: (slug: string) => post<{ last_visit: string | null }>(`/api/s/${slug}/visit`, {}),
  listing: (slug: string, id: string, body: { my_status?: Status; notes?: string }) => post<Listing>(`/api/s/${slug}/listings/${id}`, body),
  profile: () => json<Profile>("/api/profile"),
  saveProfile: (p: Partial<Profile>) => post<Profile>("/api/profile", p),
  autocomplete: (q: string) => json<{ fulltext: string; kind: string; city: string; zipcode: string }[]>(`/api/autocomplete?q=${encodeURIComponent(q)}`),
  run: (body: { cmd: string; slug?: string; args?: Record<string, string | number | boolean>; estimate?: boolean; accept_unknown?: boolean }) => post<RunResult>("/api/run", body),
}

// the search a URL is about: /<slug>/
export const slugOfUrl = () => location.pathname.split("/").filter(Boolean)[0] ?? null
