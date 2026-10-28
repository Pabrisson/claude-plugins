// The engine's local API (immo.mjs serve) and the shapes of a search's files (references/listing-format.md).

export type Point = [number, number]
export type Geometry = { type: "Polygon" | "MultiPolygon"; coordinates: unknown }
export type Status = "to_visit" | "visited" | "offer" | "dropped" | null
export type PropertyType = "flat" | "house" | "land" | "parking" | "premises"
// a message of a listing's conversation: the user's (from: me, a draft until sent_at) or the agent's or seller's
// (from: them, received); `to` is the one on the other side
export type Channel = "email" | "sms" | "phone" | "visit"
export type Message = { id: string; date: string; from?: "me" | "them"; kind: "offer" | "question" | "visit" | "reply" | "follow_up" | "documents" | "other"; channel?: Channel | null; amount: number | null; to: string | null; text: string; sent_at: string | null }
export type NewMessage = { from: "me" | "them"; channel: Channel; date: string; text: string; amount?: number; sent?: boolean }

export type Listing = {
  id: string
  se_id: string | null
  source: "stream-estate" | "websearch" | "pasted" | "manual"
  property_type?: PropertyType
  urls: { url: string | null; source: string | null; published_at: string | null; expired_at: string | null; favorites: number | null; urgent: boolean }[]
  title: string | null
  description: string | null
  price: number | null
  net_price: number | null
  area: number | null
  land_area?: number | null
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
  legal_proceedings?: boolean | null
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
  // the user's star, apart from the status
  favorite?: boolean
  notes: string
  messages?: Message[]
  building?: {
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
export type Sale = { id: string; type?: PropertyType; date: string; price: number; area: number | null; rooms: number | null; ppm2: number; point: Point; address: string }
// how the median moved: its last 12 months against the 12 months one and three years before
export type Trend = { to: string; median_ppm2: number | null; y1: number | null; y3: number | null }
export type Street = { code_voie: string; name: string; count: number; median_ppm2: number; point: Point; change: number | null; distance: number | null }
export type Dvf = {
  commune: Stats; zone: Stats; street: Stats | null; recent: Stats; years: string[]; points: Sale[]
  trend?: { zone: Trend | null; commune: Trend | null }
  by_rooms?: { scope: "recent" | "zone"; rows: { rooms: number; count: number; median_price: number; median_area: number; median_ppm2: number }[] }
  streets?: Street[]
}
// the commune's context: the DPE of the zone per class, the property tax rates (%), the homes authorised each year
export type DpeClasses = { scope: "zone" | "commune"; flat: Record<string, number>; house: Record<string, number> }
export type Tax = { year: number; city: string; commune: number; epci: number; epci_name: string; total: number; waste: number; france: number | null }
export type Housing = { release: string | null; years: { year: number; authorised: number | null; started: number | null }[] }
type Failed = { error: string }
// the carte des loyers of the commune: € per m² a month, charges included
export type Rent = { per_m2: number; low: number; high: number; scope: string; observations: number } | null
export type Market = {
  updated?: string
  alsace_moselle?: boolean
  dvf?: Partial<Record<PropertyType, Dvf>> | null
  rent?: { year: number; flat: Rent; flat_small: Rent; flat_large: Rent; house: Rent } | { error: string }
  context?: { dpe: DpeClasses | Failed; tax: Tax | Failed | null; housing: Housing | Failed }
  // the zone's asking €/m² (market -p, the paid API): over two years, and month by month
  stream?: { updated: string; type?: PropertyType; median: number | null; average: number | null; series: Record<string, number> }
}
export type Poi = { cat: string; kind: string; name: string | null; point: Point }
// a DPE of the last 12 months in the zone (ADEME)
export type DpeRow = { number: string; date: string; energy: string; type: "flat" | "house"; area: number | null; address: string | null; ban: string | null; point: Point }
// a box of the map's odds (GET /api/odds, references/data-sources.md): its IRIS with their census, DVF sales and odds,
// its communes, its DPE of the last 12 months, and the sources that failed
export type Census = { year: number; homes: number | null; main: number | null; owners: number | null; owner_years: number | null; married: number | null; pacsed: number | null; cohabiting: number | null; widowed: number | null; divorced: number | null; alone_55_79: number | null; alone_80: number | null }
export type IrisOdds = { code: string; name: string; insee: string; commune: string; kind: string; geometry: Geometry; census: Census | null; sold: number | null; odds: number | null; successions: number | null; separations: number | null }
export type Odds = { bbox: number[]; years: string[]; failed: string[]; iris: IrisOdds[]; communes: { insee: string; name: string; alsace_moselle: boolean }[]; dpe: DpeRow[] }
export type Area = {
  center?: Point
  pois?: Poi[] | { error: string }
  risks?: { natural: { key: string; label: string }[]; technological: { key: string; label: string }[] } | { error: string } | null
  crime?: { commune: { year: number; rows: { indicator: string; count: number | null; rate: number | null }[] } | null; department: { year: number; rows: { indicator: string; count: number | null; rate: number | null }[] } | null } | { error: string }
  income?: Record<"local" | "department" | "france", { geo: string; year: string; median: number | null; poverty: number | null } | null>
  iris?: { code: string; name: string } | null
  isochrones?: { place: string; profile: "pedestrian" | "car"; minutes: number; geometry: Geometry | null }[]
  places?: { label: string; address: string; point: Point }[]
  dpe_recent?: DpeRow[] | { error: string }
}
export type Search = {
  slug: string
  query: string
  label: string
  mode: "stream-estate" | "classic"
  types?: PropertyType[]
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
  alert: { searches: { id: string; type: PropertyType }[]; topic: string | null; enabled?: boolean } | null
}
export type Criteria = Partial<Record<"budget_min" | "budget_max" | "area_min" | "area_max" | "rooms_min" | "rooms_max" | "floor_min" | "land_min", number>> & { dpe_max?: string; elevator?: boolean; outdoor?: boolean }
// the search's news (feed.json), newest first: a recent DPE no listing matches, Stream Estate listings to fetch
export type News = { date: string } & ({ kind: "dpe"; dpe: DpeRow } | { kind: "listings"; count: number; added: number })
export type Feed = { read_at: string | null; stream: { total: number; counted_at: string } | null; items: News[] }
export type SearchData = { search: Search; listings: Listing[]; market: Market; area: Area; feed: Feed; unread: number; version: number }
export type Profile = { down_payment: number; net_income_monthly: number; other_loans_monthly: number; rate: number; years: number; insurance_rate: number; notary_old: number; notary_new: number; eur_per_credit: number; monthly_credit_cap: number; weights?: Partial<Record<ScoreKey, number>>; places: { label: string; address: string; point: Point }[] }
export type ScoreKey = "price" | "budget" | "energy" | "transport" | "travel" | "outdoor"
export type UsageEntry = { date: string; route: string; credits: number | null; results: number; search: string | null }
export type State = {
  home: string
  stream_estate: boolean
  // the dashboard server's watch: every so many hours, 0 when off
  watch_hours: number
  costs: Record<string, { credits: number | null; per?: string; note?: string }>
  usage: { month: number; last30: number; unknown: number; cap: number; eur_per_credit: number; by_search: Record<string, { calls: number; credits: number }>; by_route: Record<string, { calls: number; credits: number }>; by_month: Record<string, number> }
  log: UsageEntry[]
}
export type SearchSummary = { slug: string; label: string; mode: "stream-estate" | "classic"; types?: PropertyType[]; zone: string; created: string; listings: number; online: number }
export type Estimate = { what: string; route: string; credits: number | null; eur: number | null; unknown: boolean; spent: number; cap: number; remaining: number }
// a place of Géoplateforme's autocomplete, at its point x (lon), y (lat)
export type Hit = { fulltext: string; kind: string; city: string; zipcode: string; x: number; y: number }
export type RunResult = { code: number; out: string; err: string; estimate?: Estimate }

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  // the server's error, with what it adds (a 409's id)
  if (!res.ok) { const b = await res.json().catch(() => null); throw Object.assign(new Error(b?.error ?? `${res.status}`), b) }
  return res.json()
}
const post = <T>(url: string, body: unknown) => json<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })

export const api = {
  state: () => json<State>("/api/state"),
  searches: () => json<SearchSummary[]>("/api/searches"),
  search: (slug: string) => json<SearchData>(`/api/s/${slug}`),
  version: (slug: string) => json<{ version: number; unread: number }>(`/api/s/${slug}/version`),
  readFeed: (slug: string) => post<object>(`/api/s/${slug}/feed/read`, {}),
  deleteSearch: (slug: string) => json<object>(`/api/s/${slug}`, { method: "DELETE" }),
  visit: (slug: string) => post<{ last_visit: string | null }>(`/api/s/${slug}/visit`, {}),
  listing: (slug: string, id: string, body: { my_status?: Status; favorite?: boolean; notes?: string; message?: { id: string; sent?: boolean; delete?: boolean } | { add: NewMessage } }) => post<Listing>(`/api/s/${slug}/listings/${id}`, body),
  profile: () => json<Profile>("/api/profile"),
  saveProfile: (p: Partial<Profile>) => post<Profile>("/api/profile", p),
  addListing: (slug: string, body: Record<string, unknown>) => post<Listing>(`/api/s/${slug}/listings`, body),
  autocomplete: (q: string) => json<Hit[]>(`/api/autocomplete?q=${encodeURIComponent(q)}`),
  odds: (bbox: number[], signal?: AbortSignal) => json<Odds>(`/api/odds?bbox=${bbox.join(",")}`, { signal }),
  run: (body: { cmd: string; slug?: string; args?: Record<string, string | number | boolean>; estimate?: boolean; accept_unknown?: boolean }) => post<RunResult>("/api/run", body),
}

// the search a URL is about: /<slug>/
export const slugOfUrl = () => location.pathname.split("/").filter(Boolean)[0] ?? null
