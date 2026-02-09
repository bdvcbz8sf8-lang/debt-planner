export type DebtInput = {
  principal: number
  apr: number
  termMonths: number
  payment: number
  extraPayment: number
}

export type ScheduleRow = {
  month: number
  payment: number
  interest: number
  principalPaid: number
  extraPaid: number
  balanceAfter: number
}

export type ScenarioResult = {
  months: number
  totalInterest: number
  totalPaid: number
  schedule: ScheduleRow[]
}

export type DebtComparison = {
  withoutExtra: ScenarioResult
  withExtra: ScenarioResult
  interestSavings: number
  monthSavings: number
  warnings: string[]
}

const MAX_MONTHS = 1200

function roundRub(value: number): number {
  return Math.round(value)
}

export function validateDebtInput(input: DebtInput): string[] {
  const errors: string[] = []

  if (!Number.isFinite(input.principal) || input.principal <= 0) {
    errors.push('Сумма кредита должна быть больше 0.')
  }
  if (!Number.isFinite(input.apr) || input.apr < 0 || input.apr > 200) {
    errors.push('APR должен быть в диапазоне от 0 до 200.')
  }
  if (!Number.isFinite(input.termMonths) || input.termMonths <= 0) {
    errors.push('Срок в месяцах должен быть больше 0.')
  }
  if (!Number.isFinite(input.payment) || input.payment <= 0) {
    errors.push('Ежемесячный платеж должен быть больше 0.')
  }
  if (!Number.isFinite(input.extraPayment) || input.extraPayment < 0) {
    errors.push('Досрочный платеж не может быть отрицательным.')
  }

  const monthlyRate = input.apr / 100 / 12
  const firstMonthInterest = roundRub(input.principal * monthlyRate)
  if (input.payment <= firstMonthInterest && input.extraPayment <= 0) {
    errors.push(
      'Кредит не погасится: платеж меньше или равен процентам за месяц.',
    )
  }

  return errors
}

function buildScenario(
  input: DebtInput,
  extraPaymentOverride: number,
): ScenarioResult {
  let balance = roundRub(input.principal)
  const payment = roundRub(input.payment)
  const extraPayment = roundRub(extraPaymentOverride)
  const monthlyRate = input.apr / 100 / 12

  let month = 0
  let totalInterest = 0
  let totalPaid = 0
  const schedule: ScheduleRow[] = []

  while (balance > 0 && month < MAX_MONTHS) {
    month += 1
    const interest = roundRub(balance * monthlyRate)
    const plannedPrincipal = Math.max(payment - interest, 0)
    const principalPaid = Math.min(plannedPrincipal, balance)
    const balanceAfterMainPayment = balance - principalPaid
    const extraPaid = Math.min(extraPayment, balanceAfterMainPayment)
    const balanceAfter = balanceAfterMainPayment - extraPaid

    const actualPayment = interest + principalPaid + extraPaid
    totalInterest += interest
    totalPaid += actualPayment
    balance = balanceAfter

    schedule.push({
      month,
      payment: actualPayment,
      interest,
      principalPaid,
      extraPaid,
      balanceAfter,
    })

    if (principalPaid === 0 && extraPaid === 0) {
      throw new Error('Кредит не закрывается при заданных параметрах.')
    }
  }

  if (balance > 0) {
    throw new Error('Расчет остановлен: срок слишком большой, проверь платеж.')
  }

  return {
    months: month,
    totalInterest: roundRub(totalInterest),
    totalPaid: roundRub(totalPaid),
    schedule,
  }
}

export function calculateDebtPlan(input: DebtInput): DebtComparison {
  const errors = validateDebtInput(input)
  if (errors.length > 0) {
    throw new Error(errors.join(' '))
  }

  const withoutExtra = buildScenario(input, 0)
  const withExtra = buildScenario(input, input.extraPayment)

  const warnings: string[] = []
  if (withoutExtra.months > input.termMonths) {
    warnings.push(
      `При текущем платеже долг закроется за ${withoutExtra.months} мес., это больше введенного срока ${input.termMonths} мес.`,
    )
  }
  if (withoutExtra.months > input.termMonths * 2) {
    warnings.push('Платеж выглядит слишком низким: срок заметно увеличивается.')
  }

  return {
    withoutExtra,
    withExtra,
    interestSavings: withoutExtra.totalInterest - withExtra.totalInterest,
    monthSavings: withoutExtra.months - withExtra.months,
    warnings,
  }
}
