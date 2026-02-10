import { useEffect, useMemo, useState } from 'react'
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
    name: `Долг ${index}`,
    type: 'loan',
    principal: 500000,
    apr: 12,
    termMonths: 60,
    payment: 15000,
    extraPayment: 3000,
    includeInPlan: true,
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

function App() {
  const [activeView, setActiveView] = useState<'single' | 'portfolio'>('portfolio')
  const [loans, setLoans] = useState<Loan[]>([])
  const [settings, setSettings] = useState<PlanSettings>(defaultSettings())
  const [errors, setErrors] = useState<string[]>([])
  const [selectedStrategy, setSelectedStrategy] = useState<'avalanche' | 'snowball'>('avalanche')
  const [portfolioResult, setPortfolioResult] = useState<PortfolioPlanResult | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [detailMode, setDetailMode] = useState<Record<string, 'portfolio' | 'single'>>({})

  const [singleInput, setSingleInput] = useState({
    principal: '500000',
    apr: '12.5',
    termMonths: '60',
    payment: '15000',
    extraPayment: '5000',
    startDate: '',
    prepaymentMode: 'reduce_term' as PrepaymentMode,
  })
  const [singleResult, setSingleResult] = useState<ReturnType<typeof calculateDebtPlan> | null>(null)

  const singleCanCalculate =
    singleInput.principal.trim() !== '' &&
    singleInput.apr.trim() !== '' &&
    singleInput.payment.trim() !== '' &&
    Number(singleInput.principal) >= 0 &&
    Number(singleInput.apr) >= 0 &&
    Number(singleInput.payment) >= 0

  useEffect(() => {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return
    }
    try {
      const parsed = JSON.parse(raw) as { loans?: Loan[]; settings?: PlanSettings }
      if (Array.isArray(parsed.loans)) {
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
      planStartDate: settings.planStartDate || undefined,
    }
    const validationErrors = validatePlanInputs(loans, planSettings)
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
                Остаток долга (₽) <span className="required">*</span>
                <input
                  type="number"
                  min="0"
                  value={singleInput.principal}
                  onChange={(e) => setSingleInput((p) => ({ ...p, principal: e.target.value }))}
                />
              </label>
              <label>
                Процентная ставка (% годовых) <span className="required">*</span>
                <input
                  type="number"
                  min="0"
                  value={singleInput.apr}
                  onChange={(e) => setSingleInput((p) => ({ ...p, apr: e.target.value }))}
                />
              </label>
              <label>
                Ежемесячный платёж (₽) <span className="required">*</span>
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
                Дата начала (опционально)
                <input
                  type="date"
                  value={singleInput.startDate}
                  onChange={(e) => setSingleInput((p) => ({ ...p, startDate: e.target.value }))}
                />
              </label>
              <label>
                Режим досрочного погашения
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
                Срок (месяцев)
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
                const showPortfolio = detailMode[loan.id] !== 'single'
                const detailRows: ScheduleRow[] =
                  showPortfolio && portfolioLoan
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
                          <span className="apr-badge">{loan.apr}%</span>
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
                            Остаток
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
                            Платёж
                            <input
                              type="number"
                              min="0"
                              value={numericInputValue(loan.payment)}
                              onChange={(e) => updateLoan(loan.id, { payment: parseNonNegativeInput(e.target.value) })}
                            />
                          </label>
                          <label>
                            Срок (месяцы)
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
                            Дата начала
                            <input
                              type="date"
                              value={loan.startDate ?? ''}
                              onChange={(e) => updateLoan(loan.id, { startDate: e.target.value || undefined })}
                            />
                          </label>
                          <label>
                            Режим
                            <select
                              value={loan.prepaymentMode}
                              onChange={(e) => updateLoan(loan.id, { prepaymentMode: e.target.value as PrepaymentMode })}
                            >
                              <option value="reduce_term">Уменьшать срок</option>
                              <option value="reduce_payment">Уменьшать платёж</option>
                            </select>
                          </label>
                        </div>

                        <div className="detail-switch">
                          <label>
                            <input
                              type="radio"
                              checked={detailMode[loan.id] !== 'single'}
                              onChange={() => setDetailMode((prev) => ({ ...prev, [loan.id]: 'portfolio' }))}
                            />
                            Расчёт по портфелю
                          </label>
                          <label>
                            <input
                              type="radio"
                              checked={detailMode[loan.id] === 'single'}
                              onChange={() => setDetailMode((prev) => ({ ...prev, [loan.id]: 'single' }))}
                            />
                            Расчёт одного долга
                          </label>
                        </div>

                        {singleCalc && (
                          <p className="mini-summary">
                            Отдельно долг закроется за {singleCalc.withExtra.monthsToClose} мес.,
                            проценты {formatRub(singleCalc.withExtra.totalInterest)}.
                          </p>
                        )}
                        {portfolioLoan && (
                          <p className="mini-summary">
                            В портфеле долг закроется за {portfolioLoan.monthsToClose} мес.,
                            проценты {formatRub(portfolioLoan.totalInterest)}.
                          </p>
                        )}

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
                <p>Настройте бюджет досрочки и дату старта для персонального плана.</p>
              </article>
            </section>
          )}

          {loans.length > 0 && (
            <section className="panel">
              <h2>Стратегия погашения</h2>
              <div className="plan-grid">
                <label>
                  Стратегия
                  <select
                    data-testid="strategy-select"
                    value={selectedStrategy}
                    onChange={(e) => setSelectedStrategy(e.target.value as 'avalanche' | 'snowball')}
                  >
                    <option value="avalanche">Avalanche (высокие % первыми)</option>
                    <option value="snowball">Snowball (малые балансы первыми)</option>
                  </select>
                </label>
                <label>
                  Дополнительный бюджет в месяц (₽)
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
                  Дата начала плана
                  <input
                    data-testid="plan-start-date"
                    type="date"
                    value={settings.planStartDate ?? ''}
                    onChange={(e) =>
                      setSettings((prev) => ({ ...prev, planStartDate: e.target.value || '' }))
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

              <button data-testid="calculate-plan" type="button" onClick={calculatePlan}>
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
        <p>© 2024 Debt Planner. Все права защищены.</p>
        <div className="footer-links">
          <a href="#">О сервисе</a>
          <a href="#">Помощь</a>
          <a href="#">Конфиденциальность</a>
        </div>
      </footer>
    </main>
  )
}

export default App
