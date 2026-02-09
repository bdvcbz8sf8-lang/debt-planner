import { describe, expect, it } from 'vitest'
import { calculateDebtPlan, validateDebtInput } from './debtPlanner'

describe('debtPlanner calculations', () => {
  it('closes debt for a known realistic case', () => {
    const result = calculateDebtPlan({
      principal: 1_000_000,
      apr: 12,
      termMonths: 60,
      payment: 22_245,
      extraPayment: 0,
    })

    expect(result.withoutExtra.months).toBeGreaterThan(0)
    expect(result.withoutExtra.schedule.at(-1)?.balanceAfter).toBe(0)
  })

  it('reduces term when extra payment is added', () => {
    const result = calculateDebtPlan({
      principal: 700_000,
      apr: 18,
      termMonths: 60,
      payment: 17_783,
      extraPayment: 3000,
    })

    expect(result.withExtra.months).toBeLessThan(result.withoutExtra.months)
    expect(result.monthSavings).toBeGreaterThan(0)
  })

  it('keeps interest at zero when APR is zero', () => {
    const result = calculateDebtPlan({
      principal: 300_000,
      apr: 0,
      termMonths: 30,
      payment: 10_000,
      extraPayment: 0,
    })

    expect(result.withoutExtra.totalInterest).toBe(0)
    expect(result.withExtra.totalInterest).toBe(0)
  })

  it('flags unpayable debt when payment does not cover interest', () => {
    const errors = validateDebtInput({
      principal: 1_000_000,
      apr: 120,
      termMonths: 12,
      payment: 50_000,
      extraPayment: 0,
    })

    expect(errors.join(' ')).toContain('Кредит не погасится')
  })

  it('never pays principal+extra above month starting balance', () => {
    const result = calculateDebtPlan({
      principal: 250_000,
      apr: 16,
      termMonths: 24,
      payment: 12_000,
      extraPayment: 3500,
    })

    let monthStartBalance = 250_000
    for (const row of result.withExtra.schedule) {
      expect(row.principalPaid + row.extraPaid).toBeLessThanOrEqual(
        monthStartBalance,
      )
      monthStartBalance = row.balanceAfter
    }
  })
})
