import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import {
  calculateDebtPlan,
  type LoanInput,
  type PrepaymentMode,
  type ScheduleRow,
  validateLoanInput,
} from './lib/debtPlanner'

const currency = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
})

const defaultInput = {
  principal: '1000000',
  apr: '33',
  termMonths: '60',
  payment: '37000',
  extraPayment: '0',
  startDate: '',
  prepaymentMode: 'reduce_term' as PrepaymentMode,
}

function formatRub(value: number): string {
  return currency.format(value)
}

function buildSummaryText(input: LoanInput, result: ReturnType<typeof calculateDebtPlan>): string {
  const modeText =
    input.prepaymentMode === 'reduce_term'
      ? 'Сокращать срок'
      : 'Уменьшать платёж'
  const lines = [
    `Режим досрочки: ${modeText}`,
    `Срок без досрочки: ${result.withoutExtra.monthsToClose} мес.`,
    `Срок с досрочкой: ${result.withExtra.monthsToClose} мес.`,
    `Проценты без досрочки: ${formatRub(result.withoutExtra.totalInterest)}`,
    `Проценты с досрочкой: ${formatRub(result.withExtra.totalInterest)}`,
    `Экономия: ${formatRub(result.interestSavings)} и ${result.monthSavings} мес.`,
  ]
  if (result.withoutExtra.closeDate) {
    lines.push(`Дата закрытия без досрочки: ${result.withoutExtra.closeDate}`)
  }
  if (result.withExtra.closeDate) {
    lines.push(`Дата закрытия с досрочкой: ${result.withExtra.closeDate}`)
  }
  if (input.prepaymentMode === 'reduce_payment') {
    const secondPayment = result.withExtra.paymentSeries?.[1]
    if (secondPayment) {
      lines.push(`Новый ежемесячный платеж: ${formatRub(secondPayment)}`)
    }
  }
  return lines.join('\n')
}

function exportScheduleCsv(rows: ScheduleRow[]) {
  const header =
    'monthIndex,date,paymentPlanned,interest,principalPaid,extraPaid,balanceAfter,monthsLeftAfter'
  const lines = rows.map((row) =>
    [
      row.monthIndex,
      row.date ?? '',
      row.paymentPlanned,
      row.interest,
      row.principalPaid,
      row.extraPaid,
      row.balanceAfter,
      row.monthsLeftAfter ?? '',
    ].join(','),
  )
  const csv = [header, ...lines].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'debt-plan.csv'
  link.click()
  URL.revokeObjectURL(url)
}

function BalanceChart({ rows }: { rows: ScheduleRow[] }) {
  if (rows.length === 0) {
    return null
  }
  const width = 700
  const height = 220
  const padding = 24
  const maxBalance = Math.max(...rows.map((row) => row.balanceAfter), 1)
  const points = rows.map((row, index) => {
    const x =
      padding +
      (index / Math.max(rows.length - 1, 1)) * (width - padding * 2)
    const y =
      height -
      padding -
      (row.balanceAfter / maxBalance) * (height - padding * 2)
    return `${x},${y}`
  })

  return (
    <article className="chart-card">
      <h3>Balance over time</h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          className="axis-line"
        />
        <polyline points={points.join(' ')} fill="none" className="line-balance" />
      </svg>
    </article>
  )
}

function InterestPrincipalChart({ rows }: { rows: ScheduleRow[] }) {
  const points = rows.slice(0, 24)
  if (points.length === 0) {
    return null
  }
  const width = 700
  const height = 220
  const padding = 24
  const maxValue = Math.max(...points.map((row) => row.paymentPlanned), 1)
  const barWidth = (width - padding * 2) / points.length

  return (
    <article className="chart-card">
      <h3>Interest vs Principal (first 24 months)</h3>
      <svg viewBox={`0 0 ${width} ${height}`} className="chart-svg">
        <line
          x1={padding}
          y1={height - padding}
          x2={width - padding}
          y2={height - padding}
          className="axis-line"
        />
        {points.map((row, index) => {
          const interestHeight =
            (row.interest / maxValue) * (height - padding * 2)
          const principalHeight =
            (row.principalPaid / maxValue) * (height - padding * 2)
          const x = padding + index * barWidth
          const yInterest = height - padding - interestHeight
          const yPrincipal = yInterest - principalHeight
          return (
            <g key={row.monthIndex}>
              <rect
                x={x + 1}
                y={yInterest}
                width={Math.max(barWidth - 2, 1)}
                height={interestHeight}
                className="bar-interest"
              />
              <rect
                x={x + 1}
                y={yPrincipal}
                width={Math.max(barWidth - 2, 1)}
                height={principalHeight}
                className="bar-principal"
              />
            </g>
          )
        })}
      </svg>
    </article>
  )
}

function App() {
  const [input, setInput] = useState(defaultInput)
  const [showAllRows, setShowAllRows] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [submitted, setSubmitted] = useState<LoanInput | null>(null)
  const [copyStatus, setCopyStatus] = useState('')

  const result = useMemo(() => {
    if (!submitted) {
      return null
    }
    return calculateDebtPlan(submitted)
  }, [submitted])

  function updateField(name: keyof typeof defaultInput, value: string) {
    setInput((prev) => ({ ...prev, [name]: value }))
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed: LoanInput = {
      principal: Number(input.principal),
      apr: Number(input.apr),
      termMonths: Number(input.termMonths),
      payment: Number(input.payment),
      extraPayment: Number(input.extraPayment),
      startDate: input.startDate || undefined,
      prepaymentMode: input.prepaymentMode,
    }

    const validationErrors = validateLoanInput(parsed)
    setErrors(validationErrors)
    if (validationErrors.length === 0) {
      setSubmitted(parsed)
      setCopyStatus('')
    }
  }

  async function copySummary() {
    if (!result || !submitted) {
      return
    }
    await navigator.clipboard.writeText(buildSummaryText(submitted, result))
    setCopyStatus('Скопировано')
  }

  const visibleRows = result
    ? showAllRows
      ? result.withExtra.schedule
      : result.withExtra.schedule.slice(0, 24)
    : []

  const modeLabel =
    input.prepaymentMode === 'reduce_term' ? 'Сокращать срок' : 'Уменьшать платёж'
  const newPayment = result?.withExtra.paymentSeries?.[1]
  const showDateColumn = Boolean(submitted?.startDate)

  return (
    <main className="page">
      <section className="hero">
        <p className="kicker">Debt Planner v0.2</p>
        <h1>Калькулятор стоимости долга</h1>
        <p className="hero-copy">
          Сравни варианты погашения и посмотри, как досрочка влияет на срок,
          платёж и переплату.
        </p>
      </section>

      <section className="panel">
        <h2>Параметры кредита</h2>
        <p className="mode-badge">Режим досрочки: {modeLabel}</p>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Сумма долга, ₽
            <input
              data-testid="principal"
              type="number"
              min="1"
              value={input.principal}
              onChange={(e) => updateField('principal', e.target.value)}
            />
          </label>
          <label>
            APR, %
            <input
              data-testid="apr"
              type="number"
              min="0"
              max="200"
              value={input.apr}
              onChange={(e) => updateField('apr', e.target.value)}
            />
          </label>
          <label>
            Срок, месяцев
            <input
              data-testid="termMonths"
              type="number"
              min="1"
              value={input.termMonths}
              onChange={(e) => updateField('termMonths', e.target.value)}
            />
          </label>
          <label>
            Ежемесячный платёж, ₽
            <input
              data-testid="payment"
              type="number"
              min="1"
              value={input.payment}
              onChange={(e) => updateField('payment', e.target.value)}
            />
          </label>
          <label>
            Досрочка в месяц, ₽
            <input
              data-testid="extraPayment"
              type="number"
              min="0"
              value={input.extraPayment}
              onChange={(e) => updateField('extraPayment', e.target.value)}
            />
          </label>
          <label>
            Start date
            <input
              data-testid="startDate"
              type="date"
              value={input.startDate}
              onChange={(e) => updateField('startDate', e.target.value)}
            />
          </label>

          <fieldset className="mode-toggle">
            <legend>Prepayment mode</legend>
            <label>
              <input
                data-testid="mode-reduce-term"
                type="radio"
                checked={input.prepaymentMode === 'reduce_term'}
                onChange={() => updateField('prepaymentMode', 'reduce_term')}
              />
              Сокращать срок
            </label>
            <label>
              <input
                data-testid="mode-reduce-payment"
                type="radio"
                checked={input.prepaymentMode === 'reduce_payment'}
                onChange={() => updateField('prepaymentMode', 'reduce_payment')}
              />
              Уменьшать платёж
            </label>
          </fieldset>
          <button data-testid="calculate" type="submit">
            Рассчитать
          </button>
        </form>

        {errors.length > 0 && (
          <div className="errors" data-testid="errors">
            <p>Нужно поправить:</p>
            <ul>
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {result && (
        <>
          <section className="panel">
            <h2>Итоги</h2>
            {result.warnings.length > 0 && (
              <div className="warnings" data-testid="warnings">
                {result.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            )}

            <div className="summary-grid">
              <article className="summary-card">
                <h3>Срок без досрочки</h3>
                <p data-testid="months-base">{result.withoutExtra.monthsToClose} мес.</p>
              </article>
              <article className="summary-card">
                <h3>Срок с досрочкой</h3>
                <p data-testid="months-extra">{result.withExtra.monthsToClose} мес.</p>
              </article>
              <article className="summary-card">
                <h3>Проценты без досрочки</h3>
                <p>{formatRub(result.withoutExtra.totalInterest)}</p>
              </article>
              <article className="summary-card">
                <h3>Проценты с досрочкой</h3>
                <p>{formatRub(result.withExtra.totalInterest)}</p>
              </article>
              <article className="summary-card">
                <h3>Дата закрытия без досрочки</h3>
                <p data-testid="close-date-base">{result.withoutExtra.closeDate ?? '—'}</p>
              </article>
              <article className="summary-card">
                <h3>Дата закрытия с досрочкой</h3>
                <p data-testid="close-date-extra">{result.withExtra.closeDate ?? '—'}</p>
              </article>
              {submitted?.prepaymentMode === 'reduce_payment' && (
                <article className="summary-card">
                  <h3>Новый ежемесячный платёж</h3>
                  <p data-testid="new-payment">{newPayment ? formatRub(newPayment) : '—'}</p>
                </article>
              )}
              <article className="summary-card highlight">
                <h3>Экономия</h3>
                <p data-testid="interest-savings">
                  {formatRub(result.interestSavings)} и {result.monthSavings} мес.
                </p>
              </article>
            </div>

            <div className="actions-row">
              <button
                type="button"
                className="secondary-button"
                onClick={() => exportScheduleCsv(result.withExtra.schedule)}
              >
                Экспорт CSV
              </button>
              <button type="button" className="secondary-button" onClick={copySummary}>
                Скопировать summary
              </button>
              {copyStatus && <span className="copy-status">{copyStatus}</span>}
            </div>
          </section>

          <section className="panel">
            <h2>Графики</h2>
            <div className="charts-grid">
              <BalanceChart rows={result.withExtra.schedule} />
              <InterestPrincipalChart rows={result.withExtra.schedule} />
            </div>
          </section>

          <section className="panel">
            <h2>График по месяцам (с досрочкой)</h2>
            <div className="table-wrap" data-testid="schedule-table">
              <table>
                <thead>
                  <tr>
                    <th>Month #</th>
                    {showDateColumn && <th>Date</th>}
                    <th>Payment</th>
                    <th>Interest</th>
                    <th>Principal</th>
                    <th>Extra</th>
                    <th>Balance after</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row, index) => (
                    <tr key={row.monthIndex}>
                      <td>{row.monthIndex}</td>
                      {showDateColumn && <td>{row.date ?? '—'}</td>}
                      <td data-testid={index < 2 ? `payment-row-${index + 1}` : undefined}>
                        {formatRub(row.paymentPlanned)}
                      </td>
                      <td>{formatRub(row.interest)}</td>
                      <td>{formatRub(row.principalPaid)}</td>
                      <td>{formatRub(row.extraPaid)}</td>
                      <td>{formatRub(row.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {result.withExtra.schedule.length > 24 && (
              <button
                type="button"
                className="toggle-all"
                onClick={() => setShowAllRows((prev) => !prev)}
              >
                {showAllRows ? 'Показать первые 24' : 'Показать весь график'}
              </button>
            )}
          </section>
        </>
      )}
    </main>
  )
}

export default App
