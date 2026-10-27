// The decision aids of a listing, shared by Node and the dashboard: its strong points, the points to watch and the
// questions to ask, each from a named source, and a score out of 100 weighted by the buyer's priorities. Plain rules
// on the data the search holds, never a guess; the texts are the dashboard's (French).
import { budget, RENT_BAN, works } from './budget.js'
import { around, inGeometry } from './geo.js'
import { badge, daysOnline, dropped, isHome, typeOf, unitPrice } from './market.js'

const LETTERS = 'ABCDEFG'
const SCOPE = { recent: 'dans la zone (2 ans)', zone: 'dans la zone (5 ans)', commune: 'dans la commune', transactions: 'dans la zone' }
const pct = x => `${Math.round(Math.abs(x) * 100)} %`
const eur = n => `${Math.round(n).toLocaleString('fr-FR')} €`
const cap = s => s[0].toUpperCase() + s.slice(1)
// the places the listing is within reach of: { place: best isochrone }
function reach(l, isochrones = []) {
  const p = l.location?.point, best = {}
  if (!p) return best
  for (const i of isochrones) if (i.geometry && inGeometry(p, i.geometry)) {
    const b = best[i.place]
    if (!b || (i.profile === 'pedestrian' && (b.profile !== 'pedestrian' || i.minutes < b.minutes))) best[i.place] = i
  }
  return best
}

// { pros, cons, questions }: pros and cons are { text, source }
/** @param {any} l @param {{ ref?: any, pois?: any[], isochrones?: any[], profile?: any }} [ctx] */
export function review(l, { ref, pois = [], isochrones = [], profile = {} } = {}) {
  const pros = [], cons = [], questions = [], t = typeOf(l), home = isHome(t), f = l.features ?? {}, b = l.building
  const pro = (text, source) => pros.push({ text, source }), con = (text, source) => cons.push({ text, source }), ask = text => questions.push(text)

  const g = badge(unitPrice(l), ref?.ppm2)
  if (g?.level === 'below') pro(`${pct(g.gap)} sous le prix vendu ${SCOPE[ref.scope]}`, 'DVF')
  if (g?.level === 'above') con(`${pct(g.gap)} au-dessus du prix vendu ${SCOPE[ref.scope]}`, 'DVF')
  const days = daysOnline(l), drop = dropped(l)
  if (l.status === 'UNDER_OFFER') con('Déjà sous offre', 'annonce')
  const lever = [days > 90 && `${days} jours en ligne`, drop > 0 && `déjà baissé de ${pct(drop)}`, l.urgent && 'mention urgent'].filter(Boolean)
  if (lever.length && l.status === 'AVAILABLE') pro(`${cap(lever.join(', '))} : un levier pour négocier`, 'annonce')
  if (days > 90) ask(`Pourquoi le bien est-il en vente depuis ${days} jours ?`)
  if ((l.changes ?? []).some(c => c.kind === 'price_rise')) ask('Pourquoi le prix a-t-il augmenté ?')

  if (home) {
    const e = l.dpe?.energy, reg = b?.dpe?.find(d => d.number === b.dpe_match)
    if (e && 'ABC'.includes(e)) pro(`DPE ${e} : peu d'énergie à payer`, 'annonce')
    if (RENT_BAN[e]) {
      const w = works(l)
      con(`DPE ${e} : location interdite dès ${RENT_BAN[e].slice(0, 4)}${w ? `, travaux estimés de ${eur(w.low)} à ${eur(w.high)}` : ''}`, 'annonce')
      ask('Existe-t-il un audit ou un devis de rénovation énergétique ?')
    }
    if (reg && e && reg.energy !== e) con(`DPE de l'annonce (${e}) différent du registre (${reg.energy}, ${reg.date.slice(0, 4)})`, 'ADEME')
    if (!e && !reg) ask('Quel est le DPE ?')
    const outdoor = [f.balcony && 'balcon', f.terrace && 'terrasse', f.garden && 'jardin'].filter(Boolean)
    if (outdoor.length) pro(cap(outdoor.join(', ')), 'annonce')
    const year = b?.construction_year ?? l.construction_year
    if (year && year < 1997) ask(`Construit en ${year} : que disent les diagnostics plomb et amiante ?`)
  }
  if (t === 'flat') {
    if (l.floor >= 3 && f.elevator === false) con(`${l.floor}ᵉ étage sans ascenseur`, 'annonce')
    if (l.floor === 0) con('Rez-de-chaussée : vis-à-vis et sécurité à voir', 'annonce')
    if (l.last_floor) pro('Dernier étage', 'annonce')
    if (l.legal_proceedings) con('Copropriété en procédure', 'annonce')
    const perM2 = l.fees?.condo_yearly && l.area ? l.fees.condo_yearly / l.area : null
    if (perM2 > 45) con(`Charges élevées : ${Math.round(perM2)} € par m² et par an`, 'annonce')
    ask(`Fonds de travaux, travaux votés et procès-verbaux des 3 dernières assemblées générales${b?.copro ? ` (${b.copro.lots} lots)` : ''} ?`)
  }
  if (t === 'house') {
    if (l.land_area) pro(`Terrain de ${l.land_area} m²`, 'annonce')
    ask("Assainissement (tout-à-l'égout ?), état de la toiture et de la charpente ?")
  }
  if (t === 'land') ask('Zonage du PLU, viabilisation (eau, électricité, égout) et étude de sol ?')
  if (t === 'parking') ask("Dimensions de la place, accès et charges de l'année ?")
  if (t === 'premises') ask('Bail en cours, et activité autorisée par le règlement de copropriété ?')

  const risks = b?.risks?.natural ?? []
  if (risks.some(r => r.key === 'inondation')) con('Zone inondable : voir le plan de prévention', 'Géorisques')
  if (t === 'house' && risks.some(r => r.key === 'retraitGonflementArgile')) con('Sol argileux : risque de fissures pour une maison', 'Géorisques')

  const p = l.location?.point
  if (p && pois.length) {
    const tr = around(p, pois, 800).transport
    if (tr?.nearest <= 300) pro(`Métro, tram ou gare à ${tr.nearest} m${tr.name ? ` (${tr.name})` : ''}`, 'OpenStreetMap')
    if (!tr) con('Ni métro, ni tram, ni gare à moins de 800 m', 'OpenStreetMap')
  }
  const best = reach(l, isochrones)
  for (const place of new Set(isochrones.map(i => i.place))) {
    const i = best[place]
    if (i) pro(`${place} à moins de ${i.minutes} min ${i.profile === 'car' ? 'en voiture' : 'à pied'}`, 'profil')
    else if (p) con(`${place} à plus de 30 min à pied et 20 min en voiture`, 'profil')
  }
  const debt = budget(l, profile).debt_ratio
  if (debt > 0.35) con(`Endettement de ${pct(debt)} : au-dessus du plafond de 35 %`, 'profil')
  return { pros, cons, questions }
}

// The score: each part from 0 to 1 (null when the search does not know), their mean weighted by the buyer's
// priorities (profile.weights, 0 to 3), out of 100.
// ponytail: linear parts on fixed bounds (±15 % around the market, 800 m to transport); fit them on the user's
// statuses if the score and their choices drift apart
export const WEIGHTS = { price: 3, budget: 2, energy: 2, transport: 2, travel: 2, outdoor: 1 }
/** @param {any} l @param {{ ref?: any, pois?: any[], isochrones?: any[], profile?: any, criteria?: any }} [ctx] */
export function score(l, { ref, pois = [], isochrones = [], profile = {}, criteria = {} } = {}) {
  const clamp = x => Math.max(0, Math.min(1, x)), home = isHome(typeOf(l)), f = l.features ?? {}, p = l.location?.point
  const g = badge(unitPrice(l), ref?.ppm2), debt = budget(l, profile).debt_ratio, outdoor = [f.balcony, f.terrace, f.garden]
  const tr = p && pois.length ? around(p, pois, 800).transport : undefined
  const places = [...new Set(isochrones.map(i => i.place))], best = reach(l, isochrones)
  const parts = {
    price: g ? clamp(0.5 - g.gap / 0.3) : null,
    budget: debt != null ? clamp((0.4 - debt) / 0.15) : criteria.budget_max && l.price ? clamp(0.5 + (criteria.budget_max - l.price) / (0.15 * criteria.budget_max)) : null,
    energy: home && l.dpe?.energy ? (6 - LETTERS.indexOf(l.dpe.energy)) / 6 : null,
    transport: p && pois.length ? (tr ? clamp((800 - tr.nearest) / 600) : 0) : null,
    travel: p && places.length ? places.reduce((a, x) => a + (!best[x] ? 0 : best[x].profile === 'car' ? 0.3 : best[x].minutes <= 15 ? 1 : 0.6), 0) / places.length : null,
    outdoor: home ? (outdoor.some(Boolean) ? 1 : outdoor.every(x => x === false) ? 0 : null) : null,
  }
  const w = { ...WEIGHTS, ...profile.weights }, on = Object.keys(parts).filter(k => parts[k] != null && w[k] > 0)
  const total = on.reduce((a, k) => a + w[k], 0)
  return {
    value: total ? Math.round((100 * on.reduce((a, k) => a + w[k] * parts[k], 0)) / total) : null,
    parts: Object.entries(parts).map(([key, v]) => ({ key, value: v == null ? null : Math.round(v * 100) / 100, weight: w[key] })),
  }
}
