import { describe, expect, it } from 'vitest'
import {
  simulatePortfolioPlan,
  type Loan,
  type PlanSettings,
} from './portfolioPlanner'

function baseSettings(strategy: PlanSettings['strategy']): PlanSettings {
  return {
    strategy,
    extraBudget: 500,
    allocation: 'single_target',
    extraApplicationTiming: 'after_payment',
    stopWhen: 'all_paid',
  }
}

function loan(patch: Partial<Loan>): Loan {
  return {
    id: patch.id ?? `id-${Math.random()}`,
    name: patch.name ?? 'Loan',
    type: patch.type ?? 'loan',
    principal: patch.principal ?? 10000,
    apr: patch.apr ?? 10,
    termMonths: patch.termMonths ?? 24,
    payment: patch.payment ?? 600,
    extraPayment: patch.extraPayment ?? 0,
    includeInPlan: patch.includeInPlan ?? true,
    prepaymentMode: patch.prepaymentMode ?? 'reduce_term',
    startDate: patch.startDate,
  }
}

describe('portfolioPlanner', () => {
  it('avalanche picks highest APR as first target', () => {
    const loans = [
      loan({ id: 'a', name: 'A', apr: 10 }),
      loan({ id: 'b', name: 'B', apr: 30 }),
    ]
    const result = simulatePortfolioPlan(loans, baseSettings('avalanche'))
    expect(result.focusByMonth[0]?.loanId).toBe('b')
  })

  it('snowball picks smallest balance as first target', () => {
    const loans = [
      loan({ id: 'a', name: 'A', principal: 20000 }),
      loan({ id: 'b', name: 'B', principal: 5000 }),
    ]
    const result = simulatePortfolioPlan(loans, baseSettings('snowball'))
    expect(result.focusByMonth[0]?.loanId).toBe('b')
  })

  it('leftover extraBudget goes to next target in same month', () => {
    const loans = [
      loan({ id: 'a', name: 'A', principal: 1000, apr: 0, payment: 300 }),
      loan({ id: 'b', name: 'B', principal: 10000, apr: 0, payment: 300 }),
    ]
    const result = simulatePortfolioPlan(
      loans,
      { ...baseSettings('snowball'), extraBudget: 1200 },
    )
    const rowA = result.perLoan.a.schedule[0]
    const rowB = result.perLoan.b.schedule[0]
    expect(rowA.extraPaid).toBeGreaterThan(0)
    expect(rowB.extraPaid).toBeGreaterThan(0)
  })

  it('distributed extra equals extraBudget when balances are enough', () => {
    const loans = [
      loan({ id: 'a', principal: 100000, apr: 0, payment: 1000 }),
      loan({ id: 'b', principal: 120000, apr: 0, payment: 1000 }),
    ]
    const settings = { ...baseSettings('avalanche'), extraBudget: 777 }
    const result = simulatePortfolioPlan(loans, settings)
    expect(result.portfolioSchedule[0].totalExtra).toBe(777)
  })

  it('loan with includeInPlan=false does not receive extraBudget', () => {
    const loans = [
      loan({ id: 'a', includeInPlan: false, principal: 10000, apr: 0 }),
      loan({ id: 'b', includeInPlan: true, principal: 10000, apr: 0 }),
    ]
    const result = simulatePortfolioPlan(
      loans,
      { ...baseSettings('avalanche'), extraBudget: 600 },
    )
    expect(result.perLoan.a.schedule[0].extraPaid).toBe(0)
    expect(result.perLoan.b.schedule[0].extraPaid).toBeGreaterThan(0)
  })

  it('reduce_payment recalculates payment and stays valid', () => {
    const loans = [
      loan({
        id: 'a',
        prepaymentMode: 'reduce_payment',
        principal: 100000,
        apr: 18,
        payment: 4000,
        termMonths: 60,
      }),
    ]
    const result = simulatePortfolioPlan(
      loans,
      { ...baseSettings('avalanche'), extraBudget: 1000 },
    )
    const second = result.perLoan.a.schedule[1]
    expect(Number.isFinite(second.paymentPlanned)).toBe(true)
    expect(second.paymentPlanned).toBeGreaterThan(0)
  })

  it('invariant: principal+extra never exceeds balanceBefore', () => {
    const loans = [loan({ id: 'a', principal: 50000, apr: 14, payment: 1800 })]
    const result = simulatePortfolioPlan(loans, baseSettings('avalanche'))
    let balanceBefore = loans[0].principal
    for (const row of result.perLoan.a.schedule) {
      expect(row.principalPaid + row.extraPaid).toBeLessThanOrEqual(balanceBefore)
      balanceBefore = row.balanceAfter
    }
  })

  it('portfolio totalInterest equals sum of perLoan interests', () => {
    const loans = [
      loan({ id: 'a', principal: 60000, apr: 9, payment: 1400 }),
      loan({ id: 'b', principal: 40000, apr: 19, payment: 1400 }),
    ]
    const result = simulatePortfolioPlan(loans, baseSettings('avalanche'))
    const byLoans = Object.values(result.perLoan).reduce(
      (sum, item) => sum + item.totalInterest,
      0,
    )
    expect(Math.abs(result.totalInterest - byLoans)).toBeLessThanOrEqual(1)
  })

  it('maxMonthsSimulated protection triggers when plan does not converge in 1200 months', () => {
    const loans = [loan({ id: 'a', principal: 2000000, apr: 0, payment: 1, termMonths: 5000 })]
    expect(() => simulatePortfolioPlan(loans, { ...baseSettings('avalanche'), extraBudget: 0 }))
      .toThrow('1200')
  })

  it('tie-breaker remains stable by id for equal values', () => {
    const loans = [
      loan({ id: 'a', name: 'A', principal: 10000, apr: 10 }),
      loan({ id: 'b', name: 'B', principal: 10000, apr: 10 }),
    ]
    const result = simulatePortfolioPlan(
      loans,
      { ...baseSettings('avalanche'), extraBudget: 50 },
    )
    expect(result.focusByMonth[0].loanId).toBe('a')
    expect(result.focusByMonth[1].loanId).toBe('a')
  })
})
