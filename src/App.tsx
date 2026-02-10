import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import {
  calculateDebtPlan,
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

const currency = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
})

function formatRub(value: number): string {
  return currency.format(value)
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `loan-${Date.now()}-${Math.random()}`
}

function parseNonNegativeInput(value: string): number {
  if (value === '') {
    return Number.NaN
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return Number.NaN
  }
  return Math.max(0, parsed)
}

function numericInputValue(value: number): number | string {
  return Number.isNaN(value) ? '' : value
}

function createDefaultLoan(index: number): Loan {
  return {
    id: createId(),
    name: `Debt #${index}`,
    type: 'loan',
    principal: 500000,
    apr: 18,
    termMonths: 60,
    payment: 13000,
    extraPayment: 0,
    includeInPlan: true,
    prepaymentMode: 'reduce_term',
  }
}

function defaultSettings(): PlanSettings {
  return {
    strategy: 'avalanche',
    extraBudget: 5000,
    allocation: 'single_target',
    extraApplicationTiming: 'after_payment',
    stopWhen: 'all_paid',
    planStartDate: '',
  }
}

function downloadJson(payload: object, filename: string) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function downloadCsv(rows: string[][], filename: string) {
  const csv = rows.map((line) => line.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function BalanceChart({ rows }: { rows: Array<{ balance: number }> }) {
  if (rows.length === 0) {
    return null
  }
  const width = 700
  const height = 220
  const padding = 24
  const maxBalance = Math.max(...rows.map((row) => row.balance), 1)
  const points = rows.map((row, index) => {
    const x = padding + (index / Math.max(rows.length - 1, 1)) * (width - padding * 2)
    const y = height - padding - (row.balance / maxBalance) * (height - padding * 2)
    return `${x},${y}`
  })
  return (
    <article className="chart-card">
      <h3>Total balance over time</h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="axis-line" />
        <polyline points={points.join(' ')} fill="none" className="line-balance" />
      </svg>
    </article>
  )
}

function InterestPrincipalChart({
  rows,
}: {
  rows: Array<{ interest: number; principal: number }>
}) {
  const points = rows.slice(0, 24)
  if (points.length === 0) {
    return null
  }
  const width = 700
  const height = 220
  const padding = 24
  const maxValue = Math.max(...points.map((row) => row.interest + row.principal), 1)
  const barWidth = (width - padding * 2) / points.length

  return (
    <article className="chart-card">
      <h3>Portfolio interest vs principal (first 24 months)</h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} className="axis-line" />
        {points.map((row, index) => {
          const interestHeight = (row.interest / maxValue) * (height - padding * 2)
          const principalHeight = (row.principal / maxValue) * (height - padding * 2)
          const x = padding + index * barWidth
          const yInterest = height - padding - interestHeight
          const yPrincipal = yInterest - principalHeight
          return (
            <g key={index}>
              <rect x={x + 1} y={yInterest} width={Math.max(barWidth - 2, 1)} height={interestHeight} className="bar-interest" />
              <rect x={x + 1} y={yPrincipal} width={Math.max(barWidth - 2, 1)} height={principalHeight} className="bar-principal" />
            </g>
          )
        })}
      </svg>
    </article>
  )
}

function buildLoanScheduleCsv(rows: ScheduleRow[]): string[][] {
  const header = ['monthIndex', 'date', 'paymentPlanned', 'interest', 'principalPaid', 'extraPaid', 'balanceAfter']
  const body = rows.map((row) => [
    String(row.monthIndex),
    row.date ?? '',
    String(row.paymentPlanned),
    String(row.interest),
    String(row.principalPaid),
    String(row.extraPaid),
    String(row.balanceAfter),
  ])
  return [header, ...body]
}

function App() {
  const [loans, setLoans] = useState<Loan[]>([createDefaultLoan(1), createDefaultLoan(2)])
  const [settings, setSettings] = useState<PlanSettings>(defaultSettings())
  const [errors, setErrors] = useState<string[]>([])
  const [selectedStrategy, setSelectedStrategy] = useState<'avalanche' | 'snowball'>('avalanche')
  const [portfolioResult, setPortfolioResult] = useState<PortfolioPlanResult | null>(null)
  const [whatIfResult, setWhatIfResult] = useState<PortfolioPlanResult | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [detailMode, setDetailMode] = useState<Record<string, 'portfolio' | 'single'>>({})
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return
    }
    try {
      const parsed = JSON.parse(raw) as { loans?: Loan[]; settings?: PlanSettings }
      if (Array.isArray(parsed.loans) && parsed.loans.length > 0) {
        setLoans(parsed.loans)
      }
      if (parsed.settings) {
        setSettings(parsed.settings)
        setSelectedStrategy(parsed.settings.strategy)
      }
    } catch {
      // ignore broken local storage data
    }
  }, [])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ loans, settings }))
  }, [loans, settings])

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
        name: `${source.name} copy`,
      },
    ])
  }

  function deleteLoan(id: string) {
    setLoans((prev) => prev.filter((loan) => loan.id !== id))
  }

  function calculatePlan() {
    const mainSettings = { ...settings, strategy: selectedStrategy, planStartDate: settings.planStartDate || undefined }
    const validationErrors = validatePlanInputs(loans, mainSettings)
    setErrors(validationErrors)
    if (validationErrors.length > 0) {
      return
    }
    const main = simulatePortfolioPlan(loans, mainSettings)
    const otherStrategy = selectedStrategy === 'avalanche' ? 'snowball' : 'avalanche'
    const compare = simulatePortfolioPlan(loans, {
      ...mainSettings,
      strategy: otherStrategy,
    })
    setPortfolioResult(main)
    setWhatIfResult(compare)
    setErrors([])
  }

  const includedLoans = useMemo(
    () => loans.filter((loan) => loan.includeInPlan),
    [loans],
  )

  const currentFocusLoanName = useMemo(() => {
    const firstFocus = portfolioResult?.focusByMonth[0]?.loanId
    return loans.find((loan) => loan.id === firstFocus)?.name
  }, [portfolioResult, loans])

  return (
    <main className="page">
      <section className="hero">
        <p className="kicker">Debt Planner v0.3</p>
        <h1>Multi-Debt + Strategy Plan</h1>
        <p className="hero-copy">
          Управляй несколькими долгами, выбирай стратегию avalanche/snowball и смотри портфельный план закрытия.
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Секция A: Долги</h2>
          <button data-testid="add-debt" type="button" onClick={addLoan}>
            + Добавить долг
          </button>
        </div>

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
            const showPortfolio = detailMode[loan.id] !== 'single'
            const detailRows = showPortfolio && portfolioLoan
              ? portfolioLoan.schedule
              : singleCalc?.withExtra.schedule ?? []

            return (
              <article key={loan.id} className={`loan-card ${currentFocusLoanName === loan.name ? 'focus-card' : ''}`}>
                <div className="card-top">
                  <input
                    data-testid={`loan-name-${loan.id}`}
                    className="name-input"
                    value={loan.name}
                    onChange={(e) => updateLoan(loan.id, { name: e.target.value })}
                  />
                  <span className="apr-badge">{loan.apr}% APR</span>
                </div>

                <div className="loan-grid">
                  <label>
                    Type
                    <select
                      value={loan.type ?? 'other'}
                      onChange={(e) => updateLoan(loan.id, { type: e.target.value as Loan['type'] })}
                    >
                      <option value="mortgage">mortgage</option>
                      <option value="loan">loan</option>
                      <option value="credit_card">credit card</option>
                      <option value="other">other</option>
                    </select>
                  </label>
                  <label>
                    Balance
                    <input
                      type="number"
                      min="0"
                      value={numericInputValue(loan.principal)}
                      onChange={(e) => updateLoan(loan.id, { principal: parseNonNegativeInput(e.target.value) })}
                    />
                  </label>
                  <label>
                    APR
                    <input
                      type="number"
                      min="0"
                      value={numericInputValue(loan.apr)}
                      onChange={(e) => updateLoan(loan.id, { apr: parseNonNegativeInput(e.target.value) })}
                    />
                  </label>
                  <label>
                    Payment
                    <input
                      type="number"
                      min="0"
                      value={numericInputValue(loan.payment)}
                      onChange={(e) => updateLoan(loan.id, { payment: parseNonNegativeInput(e.target.value) })}
                    />
                  </label>
                  <label>
                    Term (months)
                    <input
                      type="number"
                      min="0"
                      value={numericInputValue(loan.termMonths)}
                      onChange={(e) => updateLoan(loan.id, { termMonths: parseNonNegativeInput(e.target.value) })}
                    />
                  </label>
                  <label>
                    Extra
                    <input
                      type="number"
                      min="0"
                      value={numericInputValue(loan.extraPayment ?? 0)}
                      onChange={(e) => updateLoan(loan.id, { extraPayment: parseNonNegativeInput(e.target.value) })}
                    />
                  </label>
                  <label>
                    Start date
                    <input
                      type="date"
                      value={loan.startDate ?? ''}
                      onChange={(e) => updateLoan(loan.id, { startDate: e.target.value || undefined })}
                    />
                  </label>
                  <label>
                    Mode
                    <select
                      value={loan.prepaymentMode}
                      onChange={(e) => updateLoan(loan.id, { prepaymentMode: e.target.value as PrepaymentMode })}
                    >
                      <option value="reduce_term">reduce_term</option>
                      <option value="reduce_payment">reduce_payment</option>
                    </select>
                  </label>
                </div>

                <div className="card-actions">
                  <label className="include-toggle">
                    <input
                      data-testid={`include-${loan.id}`}
                      type="checkbox"
                      checked={loan.includeInPlan}
                      onChange={(e) => updateLoan(loan.id, { includeInPlan: e.target.checked })}
                    />
                    Include in plan
                  </label>
                  <button type="button" onClick={() => duplicateLoan(loan.id)}>Duplicate</button>
                  <button type="button" onClick={() => deleteLoan(loan.id)}>Delete</button>
                  <button
                    data-testid={`details-${loan.id}`}
                    type="button"
                    onClick={() => setExpanded((prev) => ({ ...prev, [loan.id]: !prev[loan.id] }))}
                  >
                    {expanded[loan.id] ? 'Hide details' : 'Show details'}
                  </button>
                </div>

                {expanded[loan.id] && (
                  <div className="details">
                    <div className="detail-switch">
                      <label>
                        <input
                          type="radio"
                          checked={detailMode[loan.id] !== 'single'}
                          onChange={() => setDetailMode((prev) => ({ ...prev, [loan.id]: 'portfolio' }))}
                        />
                        Portfolio plan calc
                      </label>
                      <label>
                        <input
                          type="radio"
                          checked={detailMode[loan.id] === 'single'}
                          onChange={() => setDetailMode((prev) => ({ ...prev, [loan.id]: 'single' }))}
                        />
                        Single loan calc
                      </label>
                    </div>
                    {singleCalc && (
                      <p className="mini-summary">
                        Single loan closes in {singleCalc.withExtra.monthsToClose} months,
                        interest {formatRub(singleCalc.withExtra.totalInterest)}
                      </p>
                    )}
                    {portfolioLoan && (
                      <p className="mini-summary">
                        Portfolio closes in {portfolioLoan.monthsToClose} months,
                        interest {formatRub(portfolioLoan.totalInterest)}
                      </p>
                    )}
                    <div className="table-wrap">
                      <table data-testid={`detail-table-${loan.id}`}>
                        <thead>
                          <tr>
                            <th>Month</th>
                            <th>Date</th>
                            <th>Payment</th>
                            <th>Interest</th>
                            <th>Principal</th>
                            <th>Extra</th>
                            <th>Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detailRows.slice(0, 24).map((row) => (
                            <tr key={`${loan.id}-${row.monthIndex}`}>
                              <td>{row.monthIndex}</td>
                              <td>{row.date ?? '—'}</td>
                              <td>{formatRub(row.paymentPlanned)}</td>
                              <td>{formatRub(row.interest)}</td>
                              <td>{formatRub(row.principalPaid)}</td>
                              <td>{formatRub(row.extraPaid)}</td>
                              <td>{formatRub(row.balanceAfter)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <button type="button" onClick={() => downloadCsv(buildLoanScheduleCsv(detailRows), `${loan.name}-schedule.csv`)}>
                      Export loan CSV
                    </button>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      </section>

      <section className="panel">
        <h2>Секция B: План</h2>
        <div className="plan-grid">
          <fieldset className="mode-toggle">
            <legend>Strategy</legend>
            <label>
              <input
                data-testid="strategy-avalanche"
                type="radio"
                checked={selectedStrategy === 'avalanche'}
                onChange={() => setSelectedStrategy('avalanche')}
              />
              Avalanche (max APR first)
            </label>
            <label>
              <input
                data-testid="strategy-snowball"
                type="radio"
                checked={selectedStrategy === 'snowball'}
                onChange={() => setSelectedStrategy('snowball')}
              />
              Snowball (min balance first)
            </label>
          </fieldset>
          <label>
            Extra budget per month
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
          <label>
            Plan start date
            <input
              data-testid="plan-start-date"
              type="date"
              value={settings.planStartDate ?? ''}
              onChange={(e) => setSettings((prev) => ({ ...prev, planStartDate: e.target.value || '' }))}
            />
          </label>
        </div>
        <p>
          Включено в стратегию: {includedLoans.length} из {loans.length}
        </p>
        <button data-testid="calculate-plan" type="button" onClick={calculatePlan}>
          Calculate plan
        </button>
        <button type="button" className="secondary-button" onClick={() => downloadJson({ loans, settings }, 'debt-planner-v03.json')}>
          Export JSON
        </button>
        <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()}>
          Import JSON
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden-input"
          onChange={async (e) => {
            const file = e.target.files?.[0]
            if (!file) {
              return
            }
            const text = await file.text()
            const parsed = JSON.parse(text) as { loans?: Loan[]; settings?: PlanSettings }
            if (Array.isArray(parsed.loans) && parsed.loans.length > 0) {
              setLoans(parsed.loans)
            }
            if (parsed.settings) {
              setSettings(parsed.settings)
              setSelectedStrategy(parsed.settings.strategy)
            }
          }}
        />

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

      {portfolioResult && (
        <section className="panel" data-testid="portfolio-results">
          <h2>Секция C: Результаты портфеля</h2>

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
              <h3>Фокус этого месяца</h3>
              <p data-testid="focus-badge">{currentFocusLoanName ?? '—'}</p>
            </article>
          </div>

          {whatIfResult && (
            <div className="compare-grid">
              <article className="summary-card">
                <h3>What-if: avalanche</h3>
                <p data-testid="compare-months-avalanche">
                  {portfolioResult.settings.strategy === 'avalanche'
                    ? portfolioResult.monthsSimulated
                    : whatIfResult.monthsSimulated}{' '}
                  мес.
                </p>
              </article>
              <article className="summary-card">
                <h3>What-if: snowball</h3>
                <p data-testid="compare-months-snowball">
                  {portfolioResult.settings.strategy === 'snowball'
                    ? portfolioResult.monthsSimulated
                    : whatIfResult.monthsSimulated}{' '}
                  мес.
                </p>
              </article>
            </div>
          )}

          <h3>Payoff order</h3>
          <ol data-testid="payoff-order">
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

          <h3>Event log</h3>
          <ul>
            {portfolioResult.events.map((event) => {
              const loan = loans.find((x) => x.id === event.loanId)
              return (
                <li key={`${event.month}-${event.loanId}`}>
                  Месяц {event.month}: закрыт долг {loan?.name ?? event.loanId}
                </li>
              )
            })}
          </ul>

          <h3>Portfolio timeline (first 24 months)</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Date</th>
                  <th>Total Payment</th>
                  <th>Total Extra</th>
                  <th>Total Interest</th>
                  <th>Total Balance</th>
                </tr>
              </thead>
              <tbody>
                {portfolioResult.portfolioSchedule.slice(0, 24).map((row) => (
                  <tr key={row.monthIndex}>
                    <td>{row.monthIndex}</td>
                    <td>{row.date ?? '—'}</td>
                    <td>{formatRub(row.totalPayment)}</td>
                    <td>{formatRub(row.totalExtra)}</td>
                    <td>{formatRub(row.totalInterest)}</td>
                    <td>{formatRub(row.totalBalance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="charts-grid">
            <BalanceChart
              rows={portfolioResult.portfolioSchedule.map((row) => ({
                balance: row.totalBalance,
              }))}
            />
            <InterestPrincipalChart
              rows={portfolioResult.portfolioSchedule.map((row) => ({
                interest: row.totalInterest,
                principal: row.totalPrincipal,
              }))}
            />
          </div>
        </section>
      )}
    </main>
  )
}

export default App
