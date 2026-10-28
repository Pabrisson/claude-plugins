// French formats: 289 000 €, 4 661 €/m², −13 %, 12 j, 27 oct.
import type { Criteria, DpeRow, Listing } from "@/lib/api"

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

export const TYPE_LABEL = { flat: "Appartement", house: "Maison", land: "Terrain", parking: "Parking", premises: "Local" } as const
export const TYPE_PLURAL = { flat: "Appartements", house: "Maisons", land: "Terrains", parking: "Parkings", premises: "Locaux" } as const
// the unit a type is priced in: €/m², €/m² of land for a plot, € for a parking
export const UNIT = { flat: "€/m²", house: "€/m²", land: "€/m² de terrain", parking: "€ la place", premises: "€/m²" } as const
export const perUnit = (n: number | null | undefined, type: keyof typeof UNIT = "flat") => (n == null ? "—" : `${nf.format(n)} ${UNIT[type]}`)
export const MESSAGE_LABEL = { offer: "Offre", question: "Questions", visit: "Demande de visite", reply: "Réponse", follow_up: "Relance", documents: "Demande de documents", other: "Message" } as const
export const CHANNEL_LABEL = { email: "E-mail", sms: "SMS", phone: "Téléphone", visit: "Sur place" } as const
const dtf = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
// "27 oct., 18:30"
export const dateTime = (d: string) => dtf.format(new Date(d))
export const SCORE_LABEL = { price: "Prix", budget: "Budget", energy: "Énergie", transport: "Transports", travel: "Trajets", outdoor: "Extérieur" } as const
export const LEVEL_LABEL = { below: "sous le marché", at: "au prix du marché", above: "au-dessus du marché" } as const
export const STATUS_LABEL = { to_visit: "À visiter", visited: "Visité", offer: "Offre faite", dropped: "Écarté" } as const
export const SALE_STATUS = { AVAILABLE: "Disponible", UNDER_OFFER: "Sous offre", SOLD: "Vendu", WITHDRAWN: "Retiré", EXPIRED: "Expiré" } as Record<string, string>
export const SOURCE_LABEL = { "stream-estate": "API payante", websearch: "Recherche web", pasted: "Collée" } as const
export const POI_LABEL: Record<string, string> = { transport: "Métro, tram, gare", bus: "Bus", shops: "Commerces", food: "Cafés et restaurants", schools: "Écoles et crèches", health: "Santé", parks: "Parcs" }
export const ACCURACY_LABEL: Record<string, string> = { PRECISE: "adresse précise", STREET: "rue", NEIGHBORHOOD: "quartier", DISTRICT: "arrondissement", CITY: "ville", UNKNOWN: "inconnue" }

// a listing's name: its title, else its type, rooms and surface
export const titleOf = (l: Listing) => l.title ?? [TYPE_LABEL[l.property_type ?? "flat"], l.rooms && `${l.rooms} p.`, l.area && `${l.area} m²`].filter(Boolean).join(" · ")

// the criteria as short labels: "≤ 340 000 €", "3+ pièces"…
export const criteriaLabels = (c: Criteria) => [
  c.budget_max && `≤ ${eur(c.budget_max)}`, c.budget_min && `≥ ${eur(c.budget_min)}`, c.rooms_min && `${c.rooms_min}+ pièces`, c.rooms_max && `≤ ${c.rooms_max} pièces`,
  c.area_min && `≥ ${c.area_min} m²`, c.land_min && `terrain ≥ ${c.land_min} m²`, c.floor_min != null && `étage ≥ ${c.floor_min}`, c.dpe_max && `DPE ≤ ${c.dpe_max}`, c.elevator && "ascenseur", c.outdoor && "extérieur",
].filter(Boolean) as string[]

// DVF's capitals as a name: "78 RUE DES RANCY" → "78 Rue des Rancy", "AV D'ITALIE" → "Av d'Italie", "4T" stays
const SMALL = new Set(["de", "des", "du", "la", "le", "les", "et", "au", "aux", "en", "sur", "sous"])
export const titleCase = (s: string) => s.toLowerCase().split(" ").map((w, i) => (/^\d/.test(w) ? w.toUpperCase() : i && SMALL.has(w) ? w : w.replace(/^([dl]')?(\p{L})/u, (_, p = "", c: string) => p + c.toUpperCase()))).join(" ")
// "oct. 2025"
export const month = (d: string) => new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric" }).format(new Date(d))
// what the prompt asks Claude to look for: the listing of a recent DPE
export const dpeAsk = (d: DpeRow) => `l'annonce du DPE ${d.number} : ${TYPE_LABEL[d.type].toLowerCase()}${d.area ? ` ${num(d.area)} m²` : ""}, DPE ${d.energy} du ${date(d.date)}, ${d.address ?? `près de ${d.point[1].toFixed(5)}, ${d.point[0].toFixed(5)}`}`
