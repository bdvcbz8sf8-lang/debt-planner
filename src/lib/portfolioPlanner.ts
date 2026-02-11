import {
  type PrepaymentMode,
  type ScheduleRow,
} from './debtPlanner'

export type Loan = {
  id: string
  name: string
  type?: 'mortgage' | 'loan' | 'credit_card' | 'other'
  principal: number
  apr: number
  termMonths: number
  payment: number
  extraPayment?: number
  includeInPlan: boolean
  startDate?: string
  prepaymentMode: PrepaymentMode
}

export type PlanSettings = {
  strategy: 'avalanche' | 'snowball'
  extraBudget: number
  planStartDate?: string
  allocation: 'single_target' | 'proportional'
  extraApplicationTiming: 'after_payment'
  stopWhen: 'all_paid'
}

export type PortfolioRow = {
  monthIndex: number
  date?: string
  totalPayment: number
  totalExtra: number
  totalInterest: number
  totalPrincipal: number
  totalBalance: number
  targetLoanId?: string
}

type PerLoanResult = {
  monthsToClose: number
  closeDate?: string
  totalInterest: number
  totalPaid: number
  schedule: ScheduleRow[]
}

export type PortfolioPlanResult = {
  settings: PlanSettings
  monthsSimulated: number
  totalInterest: number
  totalPaid: number
  closeDate?: string
  perLoan: Record<string, PerLoanResult>
  portfolioSchedule: PortfolioRow[]
  payoffOrder: Array<{ loanId: string; rank: number; closeMonth: number }>
  events: Array<{ month: number; type: 'loan_closed'; loanId: string }>
  focusByMonth: Array<{ month: number; loanId?: string }>
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
  return roundRub(
    balance * monthlyRate / (1 - Math.pow(1 + monthlyRate, -monthsLeft)),
  )
}

export function validateLoan(loan: Loan): string[] {
  const errors: string[] = []
  if (!loan.name.trim()) {
    errors.push('Название долга обязательно.')
  }
  if (!Number.isFinite(loan.principal) || loan.principal <= 0) {
    errors.push(`"${loan.name}": principal должен быть больше 0.`)
  }
  if (!Number.isFinite(loan.apr) || loan.apr < 0 || loan.apr > 200) {
    errors.push(`"${loan.name}": APR должен быть в диапазоне 0..200.`)
  }
  if (!Number.isFinite(loan.termMonths) || loan.termMonths <= 0) {
    errors.push(`"${loan.name}": срок должен быть больше 0.`)
  }
  if (!Number.isFinite(loan.payment) || loan.payment <= 0) {
    errors.push(`"${loan.name}": payment должен быть больше 0.`)
  }
  if (loan.extraPayment !== undefined && loan.extraPayment < 0) {
    errors.push(`"${loan.name}": extraPayment не может быть отрицательным.`)
  }
  const firstMonthInterest = roundRub(loan.principal * (loan.apr / 100 / 12))
  const fixedExtra = roundRub(loan.extraPayment ?? 0)
  if (loan.payment <= firstMonthInterest && fixedExtra <= 0) {
    errors.push(`"${loan.name}": платеж не покрывает проценты.`)
  }
  return errors
}

export function validatePlanInputs(loans: Loan[], settings: PlanSettings): string[] {
  const errors = loans.flatMap(validateLoan)
  const included = loans.filter((loan) => loan.includeInPlan)
  if (included.length === 0) {
    errors.push('Нужно включить в план хотя бы один долг.')
  }
  if (!Number.isFinite(settings.extraBudget) || settings.extraBudget < 0) {
    errors.push('extraBudget должен быть >= 0.')
  }
  if (!['avalanche', 'snowball'].includes(settings.strategy)) {
    errors.push('Некорректная стратегия.')
  }
  return errors
}

type LoanState = {
  loan: Loan
  balance: number
  currentPayment: number
  monthlyRate: number
  totalInterest: number
  totalPaid: number
  schedule: ScheduleRow[]
  closedMonth?: number
  closeDate?: string
}

function pickTargetLoan(states: LoanState[], strategy: PlanSettings['strategy']): LoanState | undefined {
  const candidates = states.filter((state) => state.balance > 0 && state.loan.includeInPlan)
  if (candidates.length === 0) {
    return undefined
  }

  const sorted = [...candidates].sort((a, b) => {
    if (strategy === 'avalanche') {
      if (b.loan.apr !== a.loan.apr) {
        return b.loan.apr - a.loan.apr
      }
      if (a.balance !== b.balance) {
        return a.balance - b.balance
      }
      return a.loan.id.localeCompare(b.loan.id)
    }
    if (a.balance !== b.balance) {
      return a.balance - b.balance
    }
    if (b.loan.apr !== a.loan.apr) {
      return b.loan.apr - a.loan.apr
    }
    return a.loan.id.localeCompare(b.loan.id)
  })

  return sorted[0]
}

export function simulatePortfolioPlan(
  loans: Loan[],
  settings: PlanSettings,
): PortfolioPlanResult {
  const errors = validatePlanInputs(loans, settings)
  if (errors.length > 0) {
    throw new Error(errors.join(' '))
  }

  const baseDate = settings.planStartDate
    ? parseDate(settings.planStartDate)
    : undefined

  const states: LoanState[] = loans.map((loan) => ({
    loan,
    balance: roundRub(loan.principal),
    currentPayment: roundRub(loan.payment),
    monthlyRate: loan.apr / 100 / 12,
    totalInterest: 0,
    totalPaid: 0,
    schedule: [],
  }))

  const portfolioSchedule: PortfolioRow[] = []
  const events: PortfolioPlanResult['events'] = []
  const focusByMonth: PortfolioPlanResult['focusByMonth'] = []

  let month = 0
  while (states.some((state) => state.balance > 0) && month < MAX_MONTHS) {
    month += 1
    const targetAtStart = pickTargetLoan(states, settings.strategy)
    focusByMonth.push({ month, loanId: targetAtStart?.loan.id })

    let monthTotalPayment = 0
    let monthTotalExtra = 0
    let monthTotalInterest = 0
    let monthTotalPrincipal = 0

    const rowByLoan = new Map<string, ScheduleRow>()
    const activeAtStart = states.filter((state) => state.balance > 0)

    for (const state of activeAtStart) {
      const interest = roundRub(state.balance * state.monthlyRate)
      const plannedPrincipal = Math.max(state.currentPayment - interest, 0)
      const principalPaid = Math.min(plannedPrincipal, state.balance)
      const balanceAfterMain = state.balance - principalPaid
      const safeExtra = Number.isFinite(state.loan.extraPayment ?? 0)
        ? roundRub(state.loan.extraPayment ?? 0)
        : 0
      const perLoanExtra = Math.min(safeExtra, balanceAfterMain)
      const balanceAfter = balanceAfterMain - perLoanExtra
      const mandatoryPaid = interest + principalPaid
      const monthsLeftAfter = state.loan.termMonths - month

      let paymentDate: string | undefined
      const loanBaseDate = state.loan.startDate
        ? parseDate(state.loan.startDate)
        : baseDate
      if (loanBaseDate) {
        paymentDate = formatDate(addMonths(loanBaseDate, month - 1))
      }

      rowByLoan.set(state.loan.id, {
        monthIndex: month,
        date: paymentDate,
        paymentPlanned: state.currentPayment,
        interest,
        principalPaid,
        extraPaid: perLoanExtra,
        balanceAfter,
        monthsLeftAfter,
      })

      state.balance = balanceAfter
      state.totalInterest += interest
      state.totalPaid += mandatoryPaid + perLoanExtra
      monthTotalPayment += mandatoryPaid
      monthTotalExtra += perLoanExtra
      monthTotalInterest += interest
      monthTotalPrincipal += principalPaid + perLoanExtra
    }

    let budgetLeft = roundRub(settings.extraBudget)
    while (budgetLeft > 0) {
      const target = pickTargetLoan(states, settings.strategy)
      if (!target || target.balance <= 0) {
        break
      }
      const addExtra = Math.min(budgetLeft, target.balance)
      budgetLeft -= addExtra
      target.balance -= addExtra

      const row = rowByLoan.get(target.loan.id)
      if (row) {
        row.extraPaid += addExtra
        row.balanceAfter = target.balance
      }
      target.totalPaid += addExtra
      monthTotalExtra += addExtra
      monthTotalPrincipal += addExtra
    }

    let hadReductionThisMonth = false
    for (const state of activeAtStart) {
      const row = rowByLoan.get(state.loan.id)
      if (!row) {
        continue
      }
      state.schedule.push(row)
      if (row.principalPaid + row.extraPaid > 0) {
        hadReductionThisMonth = true
      }
      if (state.balance <= 0 && state.closedMonth === undefined) {
        state.closedMonth = month
        state.closeDate = row.date
        events.push({ month, type: 'loan_closed', loanId: state.loan.id })
      }
      if (
        state.loan.prepaymentMode === 'reduce_payment' &&
        state.balance > 0 &&
        row.monthsLeftAfter !== undefined &&
        row.monthsLeftAfter > 0
      ) {
        state.currentPayment = Math.max(
          annuityPayment(state.balance, state.monthlyRate, row.monthsLeftAfter),
          1,
        )
      }
    }

    if (!hadReductionThisMonth) {
      throw new Error('План не сходится: долги не уменьшаются по месяцам.')
    }

    let rowDate: string | undefined
    if (baseDate) {
      rowDate = formatDate(addMonths(baseDate, month - 1))
    }
    portfolioSchedule.push({
      monthIndex: month,
      date: rowDate,
      totalPayment: roundRub(monthTotalPayment),
      totalExtra: roundRub(monthTotalExtra),
      totalInterest: roundRub(monthTotalInterest),
      totalPrincipal: roundRub(monthTotalPrincipal),
      totalBalance: roundRub(states.reduce((sum, state) => sum + state.balance, 0)),
      targetLoanId: targetAtStart?.loan.id,
    })
  }

  if (states.some((state) => state.balance > 0)) {
    throw new Error('План не сходится в пределах 1200 месяцев.')
  }

  const perLoan: PortfolioPlanResult['perLoan'] = {}
  for (const state of states) {
    perLoan[state.loan.id] = {
      monthsToClose: state.closedMonth ?? portfolioSchedule.length,
      closeDate: state.closeDate,
      totalInterest: roundRub(state.totalInterest),
      totalPaid: roundRub(state.totalPaid),
      schedule: state.schedule,
    }
  }

  const payoffOrder = [...states]
    .sort((a, b) => {
      const monthA = a.closedMonth ?? Number.MAX_SAFE_INTEGER
      const monthB = b.closedMonth ?? Number.MAX_SAFE_INTEGER
      if (monthA !== monthB) {
        return monthA - monthB
      }
      return a.loan.id.localeCompare(b.loan.id)
    })
    .map((state, index) => ({
      loanId: state.loan.id,
      rank: index + 1,
      closeMonth: state.closedMonth ?? portfolioSchedule.length,
    }))

  const totalInterest = roundRub(
    Object.values(perLoan).reduce((sum, loanResult) => sum + loanResult.totalInterest, 0),
  )
  const totalPaid = roundRub(
    Object.values(perLoan).reduce((sum, loanResult) => sum + loanResult.totalPaid, 0),
  )

  return {
    settings,
    monthsSimulated: portfolioSchedule.length,
    totalInterest,
    totalPaid,
    closeDate: portfolioSchedule.at(-1)?.date,
    perLoan,
    portfolioSchedule,
    payoffOrder,
    events,
    focusByMonth,
  }
}
