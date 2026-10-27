// French formats: 289 000 €, 4 661 €/m², −13 %, 12 j, 27 oct.

const nf = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 })
const df = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" })

export const num = (n: number | null | undefined) => (n == null ? "—" : nf.format(n))
export const eur = (n: number | null | undefined) => (n == null ? "—" : `${nf.format(n)} €`)
export const m2 = (n: number | null | undefined) => (n == null ? "—" : `${nf.format(n)} €/m²`)
export const keur = (n: number | null | undefined) => (n == null ? "—" : `${nf.format(Math.round(n / 1000))} k€`)
// a signed share, with the typographic minus: −13 %
export const pct = (x: number | null | undefined, digits = 0) =>
  x == null ? "—" : `${x > 0 ? "+" : x < 0 ? "−" : ""}${Math.abs(x * 100).toFixed(digits).replace(".", ",")} %`
export const share = (x: number | null | undefined, digits = 0) => (x == null ? "—" : `${(x * 100).toFixed(digits).replace(".", ",")} %`)
export const date = (d: string | null | undefined) => (d ? df.format(new Date(d)) : "—")
export const credits = (n: number, eurPerCredit: number) => `${nf.format(n)} crédit${n > 1 ? "s" : ""} (${(n * eurPerCredit).toFixed(2).replace(".", ",")} €)`

export const LEVEL_LABEL = { below: "sous le marché", at: "au prix du marché", above: "au-dessus du marché" } as const
export const STATUS_LABEL = { to_visit: "À visiter", visited: "Visité", offer: "Offre faite", dropped: "Écarté" } as const
export const SALE_STATUS = { AVAILABLE: "Disponible", UNDER_OFFER: "Sous offre", SOLD: "Vendu", WITHDRAWN: "Retiré", EXPIRED: "Expiré" } as Record<string, string>
export const SOURCE_LABEL = { "stream-estate": "Stream Estate", websearch: "Recherche web", pasted: "Collée" } as const
export const POI_LABEL: Record<string, string> = { transport: "Métro, tram, gare", bus: "Bus", shops: "Commerces", food: "Cafés et restaurants", schools: "Écoles et crèches", health: "Santé", parks: "Parcs" }
export const ACCURACY_LABEL: Record<string, string> = { PRECISE: "adresse précise", STREET: "rue", NEIGHBORHOOD: "quartier", DISTRICT: "arrondissement", CITY: "ville", UNKNOWN: "inconnue" }
