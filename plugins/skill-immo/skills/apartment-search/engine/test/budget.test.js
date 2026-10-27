import assert from 'node:assert/strict'
import test from 'node:test'
import { budget, energyYearly, maxLoan, monthlyPayment } from '../lib/budget.js'

const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`)

test('loan payment and its inverse', () => {
  near(monthlyPayment(200000, 0, 25), 666.67, 0.01)
  near(monthlyPayment(200000, 3.4, 25), 990.6, 0.5)
  near(maxLoan(monthlyPayment(250000, 3.8, 20), 3.8, 20), 250000, 0.01)
  assert.equal(monthlyPayment(0, 3, 25), 0)
})

const flat = { price: 300000, area: 60, dpe: { energy: 'E' }, fees: { agency: { amount: 15000, included: true, paid_by: 'BUYER' }, condo_yearly: 1800, property_tax: 1200 } }
const profile = { down_payment: 60000, net_income_monthly: 5000, rate: 3.4, years: 25, insurance_rate: 0.3 }

test('total cost: notary on the price without the agency fee, which is already in the price', () => {
  const b = budget(flat, profile)
  assert.equal(b.notary, Math.round(285000 * 0.075))
  assert.equal(b.agency_extra, 0)
  assert.equal(b.total, 300000 + 21375)
  assert.equal(b.loan, 321375 - 60000)
})

test('an agency fee outside the price is added', () => {
  const b = budget({ ...flat, fees: { ...flat.fees, agency: { amount: 12000, included: false, paid_by: 'BUYER' } } }, profile)
  assert.equal(b.agency_extra, 12000)
  assert.equal(b.notary, 22500)
})

test('debt ratio against the HCSF 35 %, and the down payment it needs', () => {
  const b = budget(flat, profile)
  near(b.debt_ratio, (b.payment + b.insurance) / 5000, 0.001)
  assert.equal(b.hcsf_ok, b.debt_ratio <= 0.35)
  const poor = budget(flat, { ...profile, net_income_monthly: 2500 })
  assert.equal(poor.hcsf_ok, false)
  // with that down payment, the payment is exactly 35 % of the income
  const fixed = budget(flat, { ...profile, net_income_monthly: 2500, down_payment: poor.down_needed })
  near(fixed.debt_ratio, 0.35, 0.002)
  assert.equal(budget(flat, { ...profile, years: 27 }).hcsf_ok, false)
})

test('owning costs and the rent ban of an E', () => {
  const b = budget(flat, profile)
  assert.equal(energyYearly(flat), Math.round(290 * 60 * 0.11))
  assert.equal(energyYearly({ ...flat, building: { dpe_cost_yearly: 900 } }), 900)
  assert.equal(b.owning.monthly, Math.round((1200 + 1800 + energyYearly(flat)) / 12))
  assert.equal(b.rent_ban, '2034-01-01')
  assert.equal(budget({ price: 1 }, {}).debt_ratio, null)
})
