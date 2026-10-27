// What a property costs the buyer, shared by Node and the dashboard: the total (price, notary, agency), the loan and
// its monthly payment, the debt ratio against the HCSF rule (35 % of net income, insurance included, 25 years at
// most), the down payment it needs, what owning it costs each month, the work its DPE calls for, and renting the same.
import { isHome, typeOf } from './market.js'

export const HCSF = { ratio: 0.35, years: 25 }
// the dates a DPE class can no longer be let (loi Climat et résilience)
export const RENT_BAN = { G: '2025-01-01', F: '2028-01-01', E: '2034-01-01' }
// the middle of each DPE class, in kWh of primary energy per m² and year (2021 scale)
const DPE_MID = { A: 50, B: 90, C: 145, D: 215, E: 290, F: 375, G: 470 }
// a renovation that brings a home to class D, € per m² by its class: orders of magnitude of a full renovation
// ponytail: one range per class; an audit énergétique gives the real figure for the building
const WORKS = { E: [100, 200], F: [200, 350], G: [300, 500] }

export const PROFILE = {
  down_payment: 0, net_income_monthly: 0, other_loans_monthly: 0, rate: 3.4, years: 25, insurance_rate: 0.3,
  notary_old: 0.075, notary_new: 0.025, places: [], eur_per_credit: 0.01, monthly_credit_cap: 500,
}

// the monthly payment of a loan (annual rate in %)
export function monthlyPayment(principal, rate, years) {
  if (principal <= 0) return 0
  const r = rate / 100 / 12, n = years * 12
  return r ? (principal * r) / (1 - (1 + r) ** -n) : principal / n
}

// the loan a monthly payment repays
export function maxLoan(monthly, rate, years) {
  if (monthly <= 0) return 0
  const r = rate / 100 / 12, n = years * 12
  return r ? (monthly * (1 - (1 + r) ** -n)) / r : monthly * n
}

// energy per year in € from the DPE: the ADEME figure for this flat when it was found, else the class's middle at
// 0.11 € per kWh of primary energy
// ponytail: one price for every energy, the carrier's own (gas, electricity, heat network) when the DPE gives it
export function energyYearly(l) {
  if (l.building?.dpe_cost_yearly) return l.building.dpe_cost_yearly
  const kwh = l.dpe?.energy_value ?? DPE_MID[l.dpe?.energy]
  return kwh && l.area ? Math.round(kwh * l.area * 0.11) : null
}

// Everything the buyer pays for a listing with this profile. The agency fee is added when the price does not include
// it; the notary's (droits de mutation, ~7.5 % old, ~2.5 % new) is on the price without the agency fee.
export function budget(l, profile = {}) {
  const p = { ...PROFILE, ...profile }, price = l.price ?? 0
  const ag = l.fees?.agency, agencyAmount = ag?.amount ?? (ag?.percentage ? (price * ag.percentage) / 100 : 0)
  const agencyExtra = ag && ag.included === false && ag.paid_by !== 'SELLER' ? agencyAmount : 0
  const base = l.net_price ?? (ag?.included && agencyAmount ? price - agencyAmount : price)
  const notary = Math.round(base * (l.new_build ? p.notary_new : p.notary_old))
  const total = Math.round(price + agencyExtra + notary)
  const loan = Math.max(0, total - p.down_payment)
  const payment = monthlyPayment(loan, p.rate, p.years), insurance = (loan * p.insurance_rate) / 100 / 12
  const monthly = payment + insurance
  const debt = p.net_income_monthly > 0 ? (monthly + p.other_loans_monthly) / p.net_income_monthly : null
  // the loan the HCSF ceiling allows, insurance included: monthly = loan × (annuity factor + insurance / 12)
  const room = HCSF.ratio * p.net_income_monthly - p.other_loans_monthly, years = Math.min(p.years, HCSF.years)
  const perEuro = monthlyPayment(1, p.rate, years) + p.insurance_rate / 100 / 12
  const loanMax = room > 0 ? room / perEuro : 0
  const tax = l.fees?.property_tax ?? null, condo = l.fees?.condo_yearly ?? null, energy = energyYearly(l)
  const owning = [tax, condo, energy].reduce((a, x) => a + (x ?? 0), 0) / 12
  const round = x => (x == null ? null : Math.round(x))
  return {
    price, agency_extra: round(agencyExtra), notary, total, down_payment: p.down_payment, loan,
    payment: round(payment), insurance: round(insurance), monthly: round(monthly),
    debt_ratio: debt == null ? null : Math.round(debt * 1000) / 1000, hcsf_ok: debt == null ? null : debt <= HCSF.ratio && p.years <= HCSF.years,
    loan_max: round(loanMax), down_needed: p.net_income_monthly > 0 ? Math.max(0, round(total - loanMax)) : null,
    owning: { property_tax: tax, condo, energy, monthly: round(owning) },
    monthly_total: round(monthly + owning),
    rent_ban: isHome(typeOf(l)) ? RENT_BAN[l.dpe?.energy] ?? null : null,
    works: works(l),
  }
}

// the work to bring a home of class E, F or G to D: { low, high } in €
export function works(l) {
  const w = WORKS[l.dpe?.energy]
  return w && l.area && isHome(typeOf(l)) ? { low: Math.round(w[0] * l.area), high: Math.round(w[1] * l.area) } : null
}

// the carte des loyers row of a home: a house's, a flat's by its size (1–2 rooms, 3 and more)
export const rentOf = (l, rent) => !rent ? null : typeOf(l) === 'house' ? rent.house : (l.rooms ? rent[l.rooms <= 2 ? 'flat_small' : 'flat_large'] : null) ?? rent.flat

// Renting the same home (carte des loyers: € per m² a month, charges included) against owning it, and the years after
// which buying costs less: the purchase costs (notary, agency) paid back by the rent saved over what owning loses
// each year (the loan's interest, insurance, property tax, condominium charges, 1 % of the price in upkeep).
// ponytail: the first year's interest and no return on the down payment, an amortization table if it matters
export function rentVsBuy(l, rent, profile = {}) {
  if (!rent?.per_m2 || !l.area || !isHome(typeOf(l))) return null
  const p = { ...PROFILE, ...profile }, b = budget(l, p)
  const monthly = Math.round(rent.per_m2 * l.area)
  const lost = (b.loan * p.rate) / 100 + (b.insurance ?? 0) * 12 + (b.owning.property_tax ?? 0) + (b.owning.condo ?? 0) + b.price * 0.01
  // past the loan's length, a break-even means nothing: renting stays cheaper
  const saved = monthly * 12 - lost, costs = b.notary + (b.agency_extra ?? 0), years = saved > 0 ? Math.ceil(costs / saved) : null
  return {
    rent: monthly, low: Math.round(rent.low * l.area), high: Math.round(rent.high * l.area),
    owning: Math.round(b.monthly + ((b.owning.property_tax ?? 0) + (b.owning.condo ?? 0)) / 12),
    capital: Math.round(b.payment - (b.loan * p.rate) / 100 / 12),
    break_even_years: years != null && years <= p.years ? years : null,
  }
}
