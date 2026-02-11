import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  calculateDebtPlan,
  type LoanInput,
  type PrepaymentMode,
  type ScheduleRow,
} from './lib/debtPlanner'
import {
  type Loan,
  type PlanSettings,
  type PortfolioPlanResult,
  simulatePortfolioPlan,
  validatePlanInputs,
} from './lib/portfolioPlanner'

const STORAGE_KEY = 'debt-planner-v03'

type PersistedState = {
  loans?: Loan[]
  settings?: PlanSettings
  selectedStrategy?: 'avalanche' | 'snowball'
  activeView?: 'single' | 'portfolio'
  singleInput?: {
    principal: string
    apr: string
    termMonths: string
    payment: string
    extraPayment: string
    startDate: string
    prepaymentMode: PrepaymentMode
  }
}

const currency = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
})

function formatRub(value: number): string {
  return currency.format(Number.isFinite(value) ? value : 0)
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `loan-${Date.now()}-${Math.random()}`
}

function parseNonNegativeInput(value: string): number {
  if (value.trim() === '') {
    return Number.NaN
  }
  const parsed = Number(value.replace(',', '.').trim())
  if (!Number.isFinite(parsed)) {
    return Number.NaN
  }
  return Math.max(0, parsed)
}

function hasNonNegativeNumber(value: string): boolean {
  const parsed = parseNonNegativeInput(value)
  return Number.isFinite(parsed) && parsed >= 0
}

function numericInputValue(value: number): number | string {
  return Number.isNaN(value) ? '' : value
}

function createDefaultLoan(index: number): Loan {
  return {
    id: createId(),
    name: `Долг ${index}`,
    type: 'loan',
    principal: Number.NaN,
    apr: Number.NaN,
    termMonths: Number.NaN,
    payment: Number.NaN,
    extraPayment: 0,
    includeInPlan: true,
    startDate: '',
    prepaymentMode: 'reduce_term',
  }
}

function defaultSettings(): PlanSettings {
  return {
    strategy: 'avalanche',
    extraBudget: 10000,
    allocation: 'single_target',
    extraApplicationTiming: 'after_payment',
    stopWhen: 'all_paid',
    planStartDate: '',
  }
}

type DateFieldProps = {
  value: string
  required?: boolean
  onChange: (value: string) => void
}

function DateField({ value, required, onChange }: DateFieldProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [draftValue, setDraftValue] = useState('')
  const [visibleMonth, setVisibleMonth] = useState<Date>(() => {
    const source = value ? new Date(`${value}T12:00:00`) : new Date()
    return new Date(source.getFullYear(), source.getMonth(), 1)
  })

  useEffect(() => {
    if (!value) {
      setDraftValue('')
      return
    }
    const parsed = new Date(`${value}T12:00:00`)
    if (Number.isNaN(parsed.getTime())) {
      return
    }
    setVisibleMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1))
    setDraftValue(formatDisplayDate(value))
  }, [value])

  useEffect(() => {
    function onClickOutside(event: MouseEvent) {
      if (!rootRef.current) {
        return
      }
      const target = event.target
      if (target instanceof Node && !rootRef.current.contains(target)) {
        setOpen(false)
      }
    }

    if (open) {
      document.addEventListener('mousedown', onClickOutside)
    }
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  function formatDisplayDate(dateIso: string): string {
    if (!dateIso) {
      return ''
    }
    const parsed = new Date(`${dateIso}T12:00:00`)
    if (Number.isNaN(parsed.getTime())) {
      return ''
    }
    const day = String(parsed.getDate()).padStart(2, '0')
    const month = String(parsed.getMonth() + 1).padStart(2, '0')
    const year = parsed.getFullYear()
    return `${day}.${month}.${year}`
  }

  function toIsoDate(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  function parseInputToIso(input: string): string | null {
    const trimmed = input.trim()
    if (trimmed === '') {
      return ''
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed
    }
    const dotted = trimmed.match(/^(\d{2})\.(\d{2})\.(\d{4})$/)
    if (!dotted) {
      return null
    }
    const day = dotted[1]
    const month = dotted[2]
    const year = dotted[3]
    return `${year}-${month}-${day}`
  }

  function sameDay(left: Date, right: Date): boolean {
    return (
      left.getFullYear() === right.getFullYear() &&
      left.getMonth() === right.getMonth() &&
      left.getDate() === right.getDate()
    )
  }

  const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' }).format(visibleMonth)
  const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

  const firstDay = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1)
  const startShift = (firstDay.getDay() + 6) % 7
  const gridStart = new Date(firstDay)
  gridStart.setDate(firstDay.getDate() - startShift)

  const selectedDate = value ? new Date(`${value}T12:00:00`) : null
  const today = new Date()
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)
    const currentMonth = date.getMonth() === visibleMonth.getMonth()
    const selected = selectedDate ? sameDay(date, selectedDate) : false
    const isToday = sameDay(date, today)
    return { date, currentMonth, selected, isToday }
  })

  return (
    <div className="date-field" ref={rootRef}>
      <input
        type="text"
        required={required}
        value={draftValue}
        placeholder="дд.мм.гггг"
        onClick={() => setOpen(true)}
        onChange={(e) => {
          const next = e.target.value
          setDraftValue(next)
          const parsed = parseInputToIso(next)
          if (parsed !== null) {
            onChange(parsed)
          }
        }}
      />
      <button className="calendar-btn" type="button" onClick={() => setOpen((v) => !v)} aria-label="Открыть календарь">
        📅
      </button>
      {open && (
        <div className="calendar-popover">
          <div className="calendar-header">
            <button
              type="button"
              className="calendar-nav"
              onClick={() =>
                setVisibleMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
              }
              aria-label="Предыдущий месяц"
            >
              ‹
            </button>
            <p>{monthLabel}</p>
            <button
              type="button"
              className="calendar-nav"
              onClick={() =>
                setVisibleMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
              }
              aria-label="Следующий месяц"
            >
              ›
            </button>
          </div>
          <div className="calendar-grid weekdays">
            {weekdays.map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="calendar-grid days">
            {days.map((day) => (
              <button
                key={toIsoDate(day.date)}
                type="button"
                className={[
                  'calendar-day',
                  !day.currentMonth ? 'muted' : '',
                  day.selected ? 'selected' : '',
                  day.isToday ? 'today' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => {
                  const iso = toIsoDate(day.date)
                  onChange(iso)
                  setDraftValue(formatDisplayDate(iso))
                  setOpen(false)
                }}
              >
                {day.date.getDate()}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function App() {
  const [storageHydrated, setStorageHydrated] = useState(false)
  const [activeView, setActiveView] = useState<'single' | 'portfolio'>('portfolio')
  const [loans, setLoans] = useState<Loan[]>([])
  const [settings, setSettings] = useState<PlanSettings>(defaultSettings())
  const [errors, setErrors] = useState<string[]>([])
  const [selectedStrategy, setSelectedStrategy] = useState<'avalanche' | 'snowball'>('avalanche')
  const [portfolioResult, setPortfolioResult] = useState<PortfolioPlanResult | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const [singleInput, setSingleInput] = useState({
    principal: '500000',
    apr: '12.5',
    termMonths: '60',
    payment: '15000',
    extraPayment: '0',
    startDate: '',
    prepaymentMode: 'reduce_term' as PrepaymentMode,
  })
  const [singleResult, setSingleResult] = useState<ReturnType<typeof calculateDebtPlan> | null>(null)

  const singleCanCalculate =
    singleInput.principal.trim() !== '' &&
    singleInput.apr.trim() !== '' &&
    singleInput.termMonths.trim() !== '' &&
    singleInput.payment.trim() !== '' &&
    singleInput.startDate.trim() !== '' &&
    hasNonNegativeNumber(singleInput.principal) &&
    hasNonNegativeNumber(singleInput.apr) &&
    hasNonNegativeNumber(singleInput.termMonths) &&
    hasNonNegativeNumber(singleInput.payment)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) {
        setStorageHydrated(true)
        return
      }
      const parsed = JSON.parse(raw) as PersistedState
      if (Array.isArray(parsed.loans)) {
        setLoans(parsed.loans)
      }
      if (parsed.settings) {
        setSettings(parsed.settings)
      }
      if (parsed.selectedStrategy) {
        setSelectedStrategy(parsed.selectedStrategy)
      } else if (parsed.settings?.strategy) {
        setSelectedStrategy(parsed.settings.strategy)
      }
      if (parsed.activeView) {
        setActiveView(parsed.activeView)
      }
      if (parsed.singleInput) {
        setSingleInput(parsed.singleInput)
      }
    } catch {
      // ignore broken local storage data
    } finally {
      setStorageHydrated(true)
    }
  }, [])

  useEffect(() => {
    if (!storageHydrated) {
      return
    }
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ loans, settings, selectedStrategy, activeView, singleInput } satisfies PersistedState),
      )
    } catch {
      // localStorage may be unavailable due to browser privacy policies
    }
  }, [loans, settings, selectedStrategy, activeView, singleInput, storageHydrated])

  function updateLoan(id: string, patch: Partial<Loan>) {
    setLoans((prev) => prev.map((loan) => (loan.id === id ? { ...loan, ...patch } : loan)))
  }

  function addLoan() {
    setLoans((prev) => [...prev, createDefaultLoan(prev.length + 1)])
  }

  function duplicateLoan(id: string) {
    const source = loans.find((loan) => loan.id === id)
    if (!source) {
      return
    }
    setLoans((prev) => [
      ...prev,
      {
        ...source,
        id: createId(),
        name: `${source.name} (копия)`,
      },
    ])
  }

  function deleteLoan(id: string) {
    setLoans((prev) => prev.filter((loan) => loan.id !== id))
  }

  function calculatePlan() {
    const planSettings = {
      ...settings,
      strategy: selectedStrategy,
    }
    const dateErrors = loans
      .filter((loan) => loan.includeInPlan)
      .filter((loan) => !loan.startDate)
      .map((loan) => `"${loan.name}": укажите дату платежа.`)
    const validationErrors = [...validatePlanInputs(loans, planSettings), ...dateErrors]
    setErrors(validationErrors)
    if (validationErrors.length > 0) {
      setPortfolioResult(null)
      return
    }
    const result = simulatePortfolioPlan(loans, planSettings)
    setPortfolioResult(result)
    setErrors([])
  }

  function calculateSingleLoan() {
    const parsed: LoanInput = {
      principal: parseNonNegativeInput(singleInput.principal),
      apr: parseNonNegativeInput(singleInput.apr),
      termMonths: parseNonNegativeInput(singleInput.termMonths),
      payment: parseNonNegativeInput(singleInput.payment),
      extraPayment: parseNonNegativeInput(singleInput.extraPayment),
      startDate: singleInput.startDate || undefined,
      prepaymentMode: singleInput.prepaymentMode,
    }
    try {
      const result = calculateDebtPlan(parsed)
      setSingleResult(result)
    } catch {
      setSingleResult(null)
    }
  }

  const includedLoans = useMemo(() => loans.filter((loan) => loan.includeInPlan), [loans])
  const planCanCalculate =
    includedLoans.length > 0 &&
    includedLoans.every(
      (loan) =>
        loan.name.trim() !== '' &&
        Number.isFinite(loan.principal) &&
        loan.principal >= 0 &&
        Number.isFinite(loan.apr) &&
        loan.apr >= 0 &&
        Number.isFinite(loan.payment) &&
        loan.payment >= 0 &&
        Number.isFinite(loan.termMonths) &&
        loan.termMonths > 0 &&
        Boolean(loan.startDate),
    ) &&
    Number.isFinite(settings.extraBudget) &&
    settings.extraBudget >= 0

  const currentFocusLoanName = useMemo(() => {
    const firstFocus = portfolioResult?.focusByMonth[0]?.loanId
    return loans.find((loan) => loan.id === firstFocus)?.name
  }, [portfolioResult, loans])

  return (
    <main className="page">
      <header className="topbar">
        <p className="brand">Debt Planner</p>
        <div className="view-switch">
          <button
            type="button"
            className={`tab ${activeView === 'single' ? 'active' : ''}`}
            onClick={() => setActiveView('single')}
          >
            Один долг
          </button>
          <button
            type="button"
            className={`tab ${activeView === 'portfolio' ? 'active' : ''}`}
            onClick={() => setActiveView('portfolio')}
          >
            Портфель
          </button>
        </div>
      </header>

      {activeView === 'single' && (
        <>
          <section className="hero">
            <h1>Калькулятор одного долга</h1>
            <p className="hero-copy">Рассчитайте стоимость кредита и эффект досрочных платежей</p>
          </section>

          <section className="panel single-panel">
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault()
                calculateSingleLoan()
              }}
            >
              <label>
                <span className="label-title">Остаток долга (₽) <span className="required">*</span></span>
                <input
                  type="number"
                  min="0"
                  value={singleInput.principal}
                  onChange={(e) => setSingleInput((p) => ({ ...p, principal: e.target.value }))}
                />
              </label>
              <label>
                <span className="label-title">Процентная ставка (% годовых) <span className="required">*</span></span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={singleInput.apr}
                  onChange={(e) => setSingleInput((p) => ({ ...p, apr: e.target.value }))}
                />
              </label>
              <label>
                <span className="label-title">Ежемесячный платёж (₽) <span className="required">*</span></span>
                <input
                  type="number"
                  min="0"
                  value={singleInput.payment}
                  onChange={(e) => setSingleInput((p) => ({ ...p, payment: e.target.value }))}
                />
              </label>
              <label>
                Досрочный платёж в месяц (₽)
                <input
                  type="number"
                  min="0"
                  value={singleInput.extraPayment}
                  onChange={(e) => setSingleInput((p) => ({ ...p, extraPayment: e.target.value }))}
                />
              </label>
              <label>
                <span className="label-title">Дата платежа <span className="required">*</span></span>
                <DateField
                  required
                  value={singleInput.startDate}
                  onChange={(value) => setSingleInput((p) => ({ ...p, startDate: value }))}
                />
              </label>
              <label>
                <span className="label-title">Режим досрочного погашения <span className="required">*</span></span>
                <select
                  value={singleInput.prepaymentMode}
                  onChange={(e) =>
                    setSingleInput((p) => ({ ...p, prepaymentMode: e.target.value as PrepaymentMode }))
                  }
                >
                  <option value="reduce_term">Уменьшать срок</option>
                  <option value="reduce_payment">Уменьшать платёж</option>
                </select>
              </label>
              <label>
                <span className="label-title">Срок (месяцев) <span className="required">*</span></span>
                <input
                  type="number"
                  min="0"
                  value={singleInput.termMonths}
                  onChange={(e) => setSingleInput((p) => ({ ...p, termMonths: e.target.value }))}
                />
              </label>
              <div className="single-action">
                <button type="submit" disabled={!singleCanCalculate} className={!singleCanCalculate ? 'button-disabled' : ''}>
                  Рассчитать
                </button>
              </div>
            </form>

            {singleResult && (
              <>
                <div className="summary-grid">
                  <article className="summary-card">
                    <h3>Срок без досрочки</h3>
                    <p>{singleResult.withoutExtra.monthsToClose} мес.</p>
                  </article>
                  <article className="summary-card">
                    <h3>Срок с досрочкой</h3>
                    <p>{singleResult.withExtra.monthsToClose} мес.</p>
                  </article>
                  <article className="summary-card">
                    <h3>Проценты без досрочки</h3>
                    <p>{formatRub(singleResult.withoutExtra.totalInterest)}</p>
                  </article>
                  <article className="summary-card">
                    <h3>Проценты с досрочкой</h3>
                    <p>{formatRub(singleResult.withExtra.totalInterest)}</p>
                  </article>
                </div>

                <h3 className="section-subtitle">График платежей</h3>
                <div className="schedule-table-wrap">
                  <table className="schedule-table">
                    <thead>
                      <tr>
                        <th>Месяц</th>
                        <th>Дата</th>
                        <th>Платёж</th>
                        <th>Проценты</th>
                        <th>Тело</th>
                        <th>Досрочка</th>
                        <th className="align-right">Остаток</th>
                      </tr>
                    </thead>
                    <tbody>
                      {singleResult.withExtra.schedule.slice(0, 24).map((row) => (
                        <tr key={row.monthIndex}>
                          <td>{row.monthIndex}</td>
                          <td>{row.date ?? '—'}</td>
                          <td className="strong-cell">{formatRub(row.paymentPlanned)}</td>
                          <td className="accent-orange">{formatRub(row.interest)}</td>
                          <td>{formatRub(row.principalPaid)}</td>
                          <td className="accent-green">{formatRub(row.extraPaid)}</td>
                          <td className="strong-cell align-right">{formatRub(row.balanceAfter)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section className="single-hints">
            <article className="hint-card hint-primary">
              <h3>Совет по планированию</h3>
              <p>
                Даже небольшой ежемесячный досрочный платеж может сократить общую
                сумму переплаты по процентам и приблизить дату закрытия долга.
              </p>
            </article>
            <article className="hint-card">
              <h3>Визуализация плана</h3>
              <p>
                После расчета можно увидеть детальный график платежей и сравнить
                эффект досрочных погашений.
              </p>
            </article>
          </section>
        </>
      )}

      {activeView === 'portfolio' && (
        <>
          <section className="hero">
            <h1>Планировщик портфеля долгов</h1>
            <p className="hero-copy">Постройте стратегический план выхода из нескольких долгов</p>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Мои долги ({loans.length})</h2>
              <button data-testid="add-debt" type="button" onClick={addLoan}>
                + Добавить долг
              </button>
            </div>

            {loans.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">↘</div>
                <p className="empty-title">Нет долгов</p>
                <p className="empty-copy">Добавьте первый долг, чтобы начать планирование и увидеть стратегию погашения</p>
                <button type="button" onClick={addLoan}>+ Добавить долг</button>
              </div>
            )}

            <div className="loan-cards">
              {loans.map((loan) => {
                let singleCalc: ReturnType<typeof calculateDebtPlan> | null = null
                try {
                  singleCalc = calculateDebtPlan({
                    principal: loan.principal,
                    apr: loan.apr,
                    termMonths: loan.termMonths,
                    payment: loan.payment,
                    extraPayment: loan.extraPayment ?? 0,
                    prepaymentMode: loan.prepaymentMode,
                    startDate: loan.startDate,
                  })
                } catch {
                  singleCalc = null
                }

                const portfolioLoan = portfolioResult?.perLoan[loan.id]
                const detailRows: ScheduleRow[] =
                  portfolioLoan
                    ? portfolioLoan.schedule
                    : singleCalc?.withExtra.schedule ?? []

                return (
                  <article key={loan.id} className={`loan-card ${currentFocusLoanName === loan.name ? 'focus-card' : ''}`}>
                    <div className="loan-row">
                      <div>
                        <div className="loan-title-row">
                          <input
                            data-testid={`loan-name-${loan.id}`}
                            className="name-input compact-name"
                            value={loan.name}
                            onChange={(e) => updateLoan(loan.id, { name: e.target.value })}
                          />
                          <span className="apr-badge">{Number.isNaN(loan.apr) ? '—' : `${loan.apr}%`}</span>
                        </div>
                        <div className="loan-mini-metrics">
                          <span>Остаток: <b>{formatRub(loan.principal)}</b></span>
                          <span>Платёж: <b>{formatRub(loan.payment)}</b></span>
                        </div>
                      </div>

                      <div className="loan-row-actions">
                        <label className={`include-pill ${loan.includeInPlan ? 'on' : 'off'}`}>
                          <input
                            data-testid={`include-${loan.id}`}
                            type="checkbox"
                            checked={loan.includeInPlan}
                            onChange={(e) => updateLoan(loan.id, { includeInPlan: e.target.checked })}
                          />
                          {loan.includeInPlan ? 'В плане' : 'Не в плане'}
                        </label>
                        <button type="button" className="icon-btn" onClick={() => duplicateLoan(loan.id)} title="Дублировать">
                          ⧉
                        </button>
                        <button type="button" className="icon-btn" onClick={() => deleteLoan(loan.id)} title="Удалить">
                          🗑
                        </button>
                        <button
                          data-testid={`details-${loan.id}`}
                          type="button"
                          className="icon-btn"
                          onClick={() => setExpanded((prev) => ({ ...prev, [loan.id]: !prev[loan.id] }))}
                        >
                          {expanded[loan.id] ? '⌃' : '⌄'}
                        </button>
                      </div>
                    </div>

                    {expanded[loan.id] && (
                      <div className="details">
                        <div className="loan-grid">
                          <label>
                            Тип
                            <select
                              value={loan.type ?? 'other'}
                              onChange={(e) => updateLoan(loan.id, { type: e.target.value as Loan['type'] })}
                            >
                              <option value="mortgage">Ипотека</option>
                              <option value="loan">Кредит</option>
                              <option value="credit_card">Кредитная карта</option>
                              <option value="other">Другое</option>
                            </select>
                          </label>
                          <label>
                            <span className="label-title">Остаток <span className="required">*</span></span>
                            <input
                              type="number"
                              min="0"
                              value={numericInputValue(loan.principal)}
                              onChange={(e) => updateLoan(loan.id, { principal: parseNonNegativeInput(e.target.value) })}
                            />
                          </label>
                          <label>
                            <span className="label-title">% <span className="required">*</span></span>
                            <input
                              type="number"
                              min="0"
                              step="0.1"
                              value={numericInputValue(loan.apr)}
                              onChange={(e) => updateLoan(loan.id, { apr: parseNonNegativeInput(e.target.value) })}
                            />
                          </label>
                          <label>
                            <span className="label-title">Платёж <span className="required">*</span></span>
                            <input
                              type="number"
                              min="0"
                              value={numericInputValue(loan.payment)}
                              onChange={(e) => updateLoan(loan.id, { payment: parseNonNegativeInput(e.target.value) })}
                            />
                          </label>
                          <label>
                            <span className="label-title">Срок (месяцы) <span className="required">*</span></span>
                            <input
                              type="number"
                              min="0"
                              value={numericInputValue(loan.termMonths)}
                              onChange={(e) => updateLoan(loan.id, { termMonths: parseNonNegativeInput(e.target.value) })}
                            />
                          </label>
                          <label>
                            Досрочка
                            <input
                              type="number"
                              min="0"
                              value={numericInputValue(loan.extraPayment ?? 0)}
                              onChange={(e) => updateLoan(loan.id, { extraPayment: parseNonNegativeInput(e.target.value) })}
                            />
                          </label>
                          <label>
                            <span className="label-title">Дата платежа <span className="required">*</span></span>
                            <DateField
                              required
                              value={loan.startDate ?? ''}
                              onChange={(value) => updateLoan(loan.id, { startDate: value || undefined })}
                            />
                          </label>
                          <label>
                            <span className="label-title">Режим <span className="required">*</span></span>
                            <select
                              value={loan.prepaymentMode}
                              onChange={(e) => updateLoan(loan.id, { prepaymentMode: e.target.value as PrepaymentMode })}
                            >
                              <option value="reduce_term">Уменьшать срок</option>
                              <option value="reduce_payment">Уменьшать платёж</option>
                            </select>
                          </label>
                        </div>

                        <div className="schedule-table-wrap">
                          <table data-testid={`detail-table-${loan.id}`} className="schedule-table">
                            <thead>
                              <tr>
                                <th>Месяц</th>
                                <th>Дата</th>
                                <th>Платёж</th>
                                <th>Проценты</th>
                                <th>Тело</th>
                                <th>Досрочка</th>
                                <th className="align-right">Остаток</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detailRows.slice(0, 24).map((row) => (
                                <tr key={`${loan.id}-${row.monthIndex}`}>
                                  <td>{row.monthIndex}</td>
                                  <td>{row.date ?? '—'}</td>
                                  <td className="strong-cell">{formatRub(row.paymentPlanned)}</td>
                                  <td className="accent-orange">{formatRub(row.interest)}</td>
                                  <td>{formatRub(row.principalPaid)}</td>
                                  <td className="accent-green">{formatRub(row.extraPaid)}</td>
                                  <td className="strong-cell align-right">{formatRub(row.balanceAfter)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          </section>

          {loans.length === 0 && (
            <section className="empty-methods">
              <article className="method-card">
                <div className="method-icon method-blue">⚡</div>
                <h3>Метод снежного кома</h3>
                <p>Погашение от самого маленького долга к самому большому.</p>
              </article>
              <article className="method-card">
                <div className="method-icon method-amber">↗</div>
                <h3>Метод лавины</h3>
                <p>Погашение долга с самым высоким процентом в первую очередь.</p>
              </article>
              <article className="method-card">
                <div className="method-icon method-green">🗓</div>
                <h3>Индивидуальный план</h3>
                <p>Настройте бюджет досрочки для персонального плана.</p>
              </article>
            </section>
          )}

          {loans.length > 0 && (
            <section className="panel">
              <h2>Стратегия погашения</h2>
              <div className="plan-grid">
                <label>
                  <span className="label-title">Стратегия <span className="required">*</span></span>
                  <select
                    data-testid="strategy-select"
                    value={selectedStrategy}
                    onChange={(e) => setSelectedStrategy(e.target.value as 'avalanche' | 'snowball')}
                  >
                    <option value="avalanche">Лавина (по макс. %)</option>
                    <option value="snowball">Снежный ком (по мин. сумме долга)</option>
                  </select>
                </label>
                <label>
                  <span className="label-title">Дополнительный бюджет в месяц (₽) <span className="required">*</span></span>
                  <input
                    data-testid="extra-budget"
                    type="number"
                    min="0"
                    value={numericInputValue(settings.extraBudget)}
                    onChange={(e) =>
                      setSettings((prev) => ({
                        ...prev,
                        extraBudget: parseNonNegativeInput(e.target.value),
                      }))
                    }
                  />
                </label>
              </div>

              <div className="info-note">
                <p className="note-title">Порядок погашения долгов:</p>
                <p>
                  {portfolioResult?.payoffOrder
                    .map((item) => loans.find((loan) => loan.id === item.loanId)?.name ?? item.loanId)
                    .join(' → ') || 'Нажмите "Рассчитать план", чтобы увидеть порядок.'}
                </p>
              </div>

              <p className="minor-text">
                Включено в стратегию: {includedLoans.length} из {loans.length}
              </p>

              <button
                data-testid="calculate-plan"
                type="button"
                onClick={calculatePlan}
                disabled={!planCanCalculate}
                className={!planCanCalculate ? 'button-disabled' : ''}
              >
                Рассчитать план
              </button>

              {errors.length > 0 && (
                <div className="errors">
                  <p>Нужно поправить:</p>
                  <ul>
                    {errors.map((error) => (
                      <li key={error}>{error}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          {portfolioResult && (
            <section className="panel" data-testid="portfolio-results">
              <h2>Результаты портфеля</h2>

              <div className="summary-grid">
                <article className="summary-card">
                  <h3>Выбранная стратегия</h3>
                  <p>{portfolioResult.settings.strategy}</p>
                </article>
                <article className="summary-card">
                  <h3>Все долги закрыты через</h3>
                  <p>{portfolioResult.monthsSimulated} мес.</p>
                </article>
                <article className="summary-card">
                  <h3>Дата закрытия портфеля</h3>
                  <p>{portfolioResult.closeDate ?? '—'}</p>
                </article>
                <article className="summary-card">
                  <h3>Проценты всего</h3>
                  <p>{formatRub(portfolioResult.totalInterest)}</p>
                </article>
                <article className="summary-card">
                  <h3>Платежей всего</h3>
                  <p>{formatRub(portfolioResult.totalPaid)}</p>
                </article>
                <article className="summary-card highlight">
                  <h3>Фокус стратегии в этом месяце</h3>
                  <p data-testid="focus-badge">{currentFocusLoanName ?? '—'}</p>
                </article>
              </div>

              <h3 className="section-subtitle">Очередь погашения</h3>
              <ol data-testid="payoff-order" className="payoff-list">
                {portfolioResult.payoffOrder.map((item) => {
                  const loan = loans.find((x) => x.id === item.loanId)
                  const closeDate = portfolioResult.perLoan[item.loanId]?.closeDate
                  return (
                    <li key={item.loanId}>
                      {loan?.name ?? item.loanId} — месяц {item.closeMonth}
                      {closeDate ? ` (${closeDate})` : ''}
                    </li>
                  )
                })}
              </ol>

              <h3 className="section-subtitle">События</h3>
              <ul className="events-list">
                {portfolioResult.events.map((event) => {
                  const loan = loans.find((x) => x.id === event.loanId)
                  return (
                    <li key={`${event.month}-${event.loanId}`}>
                      Месяц {event.month}: закрыт долг {loan?.name ?? event.loanId}
                    </li>
                  )
                })}
              </ul>

              <h3 className="section-subtitle">Портфельный график (первые 24 месяца)</h3>
              <div className="schedule-table-wrap">
                <table className="schedule-table">
                  <thead>
                    <tr>
                      <th>Месяц</th>
                      <th>Дата</th>
                      <th>Обязательные платежи</th>
                      <th>Досрочка</th>
                      <th>Проценты</th>
                      <th className="align-right">Общий остаток</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolioResult.portfolioSchedule.slice(0, 24).map((row) => (
                      <tr key={row.monthIndex}>
                        <td>{row.monthIndex}</td>
                        <td>{row.date ?? '—'}</td>
                        <td className="strong-cell">{formatRub(row.totalPayment)}</td>
                        <td className="accent-green">{formatRub(row.totalExtra)}</td>
                        <td className="accent-orange">{formatRub(row.totalInterest)}</td>
                        <td className="strong-cell align-right">{formatRub(row.totalBalance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      <footer className="app-footer">
        <p>Все расчёты выполняются в браузере. Данные не отправляются на сервер.</p>
      </footer>
    </main>
  )
}

export default App
