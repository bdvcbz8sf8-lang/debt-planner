export type PrepaymentMode = 'reduce_term' | 'reduce_payment'

export type LoanInput = {
  principal: number
  apr: number
  termMonths: number
  payment: number
  extraPayment: number
  startDate?: string
  prepaymentMode: PrepaymentMode
}

export type ScheduleRow = {
  monthIndex: number
  date?: string
  paymentPlanned: number
  interest: number
  principalPaid: number
  extraPaid: number
  balanceAfter: number
  monthsLeftAfter?: number
}

export type ScenarioResult = {
  schedule: ScheduleRow[]
  totalInterest: number
  totalPaid: number
  monthsToClose: number
  closeDate?: string
  paymentSeries?: number[]
  finalPayment?: number
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

function parseDate(dateIso: string): Date {
  return new Date(`${dateIso}T12:00:00`)
}

function addMonths(date: Date, monthShift: number): Date {
  const next = new Date(date.getTime())
  next.setMonth(next.getMonth() + monthShift)
  return next
}

function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function annuityPayment(balance: number, monthlyRate: number, monthsLeft: number): number {
  if (monthsLeft <= 0) {
    return 0
  }
  if (monthlyRate === 0) {
    return roundRub(balance / monthsLeft)
  }
  const payment =
    balance * monthlyRate / (1 - Math.pow(1 + monthlyRate, -monthsLeft))
  return roundRub(payment)
}

export function validateLoanInput(input: LoanInput): string[] {
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
  if (input.startDate && Number.isNaN(parseDate(input.startDate).getTime())) {
    errors.push('Некорректная дата начала.')
  }
  if (!['reduce_term', 'reduce_payment'].includes(input.prepaymentMode)) {
    errors.push('Некорректный режим досрочного погашения.')
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

function buildScenario(input: LoanInput, includeExtra: boolean): ScenarioResult {
  let balance = roundRub(input.principal)
  const monthlyRate = input.apr / 100 / 12
  let currentPayment = roundRub(input.payment)
  const extraPayment = includeExtra ? roundRub(input.extraPayment) : 0
  const startDate = input.startDate ? parseDate(input.startDate) : undefined
  const paymentSeries: number[] = []

  let month = 0
  let totalInterest = 0
  let totalPaid = 0
  const schedule: ScheduleRow[] = []

  while (balance > 0 && month < MAX_MONTHS) {
    month += 1
    const interest = roundRub(balance * monthlyRate)
    const plannedPrincipal = Math.max(currentPayment - interest, 0)
    const principalPaid = Math.min(plannedPrincipal, balance)
    const balanceAfterMainPayment = balance - principalPaid
    const extraPaid = Math.min(extraPayment, balanceAfterMainPayment)
    const balanceAfter = balanceAfterMainPayment - extraPaid
    const actualPayment = interest + principalPaid + extraPaid
    const monthsLeftAfter = input.termMonths - month

    totalInterest += interest
    totalPaid += actualPayment
    balance = balanceAfter

    let paymentDate: string | undefined
    if (startDate) {
      paymentDate = formatDate(addMonths(startDate, month - 1))
    }

    schedule.push({
      monthIndex: month,
      date: paymentDate,
      paymentPlanned: currentPayment,
      interest,
      principalPaid,
      extraPaid,
      balanceAfter,
      monthsLeftAfter,
    })
    paymentSeries.push(currentPayment)

    if (principalPaid === 0 && extraPaid === 0) {
      throw new Error('Кредит не закрывается при заданных параметрах.')
    }

    if (
      input.prepaymentMode === 'reduce_payment' &&
      balance > 0 &&
      monthsLeftAfter > 0
    ) {
      currentPayment = annuityPayment(balance, monthlyRate, monthsLeftAfter)
    }
  }

  if (balance > 0) {
    throw new Error('Расчет остановлен: срок слишком большой, проверь платеж.')
  }

  return {
    schedule,
    totalInterest: roundRub(totalInterest),
    totalPaid: roundRub(totalPaid),
    monthsToClose: month,
    closeDate: schedule.at(-1)?.date,
    paymentSeries,
    finalPayment: paymentSeries.at(-1),
  }
}

export function calculateDebtPlan(input: LoanInput): DebtComparison {
  const errors = validateLoanInput(input)
  if (errors.length > 0) {
    throw new Error(errors.join(' '))
  }

  const withoutExtra = buildScenario(input, false)
  const withExtra = buildScenario(input, true)
  const warnings: string[] = []

  if (withoutExtra.monthsToClose > input.termMonths) {
    warnings.push(
      `Без досрочки долг закроется за ${withoutExtra.monthsToClose} мес., это больше введенного срока ${input.termMonths} мес.`,
    )
  }

  if (
    input.prepaymentMode === 'reduce_payment' &&
    withExtra.monthsToClose < input.termMonths
  ) {
    warnings.push('Даже в режиме "уменьшать платеж" кредит закрыт досрочно.')
  }

  return {
    withoutExtra,
    withExtra,
    interestSavings: withoutExtra.totalInterest - withExtra.totalInterest,
    monthSavings: withoutExtra.monthsToClose - withExtra.monthsToClose,
    warnings,
  }
}
