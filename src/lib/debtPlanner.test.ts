import { describe, expect, it } from 'vitest'
import { calculateDebtPlan, validateLoanInput } from './debtPlanner'

describe('debtPlanner v0.2', () => {
  it('reduce payment lowers monthly payment after recalculation and closes on time', () => {
    const result = calculateDebtPlan({
      principal: 1_000_000,
      apr: 18,
      termMonths: 60,
      payment: 25_000,
      extraPayment: 4000,
      prepaymentMode: 'reduce_payment',
    })

    const firstPayment = result.withExtra.paymentSeries?.[0] ?? 0
    const minAfterRecalc = Math.min(...(result.withExtra.paymentSeries?.slice(1) ?? [firstPayment]))
    expect(minAfterRecalc).toBeLessThan(firstPayment)
    expect(result.withExtra.monthsToClose).toBeLessThanOrEqual(60)
  })

  it('reduce payment with r=0 recalculates as balance/monthsLeft', () => {
    const result = calculateDebtPlan({
      principal: 120_000,
      apr: 0,
      termMonths: 12,
      payment: 10_000,
      extraPayment: 2000,
      prepaymentMode: 'reduce_payment',
    })

    const month1 = result.withExtra.schedule[0]
    const month2 = result.withExtra.schedule[1]
    const expectedPayment = Math.round(month1.balanceAfter / (12 - 1))
    expect(month2.paymentPlanned).toBe(expectedPayment)
  })

  it('reduce term keeps v0.1 behavior: extra payment shortens term', () => {
    const result = calculateDebtPlan({
      principal: 700_000,
      apr: 18,
      termMonths: 60,
      payment: 17_783,
      extraPayment: 3000,
      prepaymentMode: 'reduce_term',
    })

    expect(result.withExtra.monthsToClose).toBeLessThan(
      result.withoutExtra.monthsToClose,
    )
  })

  it('invariant: principalPaid + extraPaid does not exceed starting balance', () => {
    const result = calculateDebtPlan({
      principal: 250_000,
      apr: 16,
      termMonths: 24,
      payment: 12_000,
      extraPayment: 3500,
      prepaymentMode: 'reduce_payment',
    })

    let monthStartBalance = 250_000
    for (const row of result.withExtra.schedule) {
      expect(row.principalPaid + row.extraPaid).toBeLessThanOrEqual(
        monthStartBalance,
      )
      monthStartBalance = row.balanceAfter
    }
  })

  it('closeDate matches month where balance reaches zero', () => {
    const result = calculateDebtPlan({
      principal: 500_000,
      apr: 12,
      termMonths: 60,
      payment: 12_000,
      extraPayment: 3000,
      startDate: '2026-01-15',
      prepaymentMode: 'reduce_term',
    })

    const last = result.withExtra.schedule.at(-1)
    expect(last?.balanceAfter).toBe(0)
    expect(result.withExtra.closeDate).toBe(last?.date)
  })

  it('unpayable case is flagged for both modes', () => {
    const input = {
      principal: 1_000_000,
      apr: 120,
      termMonths: 24,
      payment: 50_000,
      extraPayment: 0,
      prepaymentMode: 'reduce_term' as const,
    }

    const errorsTerm = validateLoanInput(input)
    const errorsPayment = validateLoanInput({
      ...input,
      prepaymentMode: 'reduce_payment',
    })

    expect(errorsTerm.join(' ')).toContain('Кредит не погасится')
    expect(errorsPayment.join(' ')).toContain('Кредит не погасится')
  })
})
