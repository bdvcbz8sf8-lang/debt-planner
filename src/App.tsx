import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'
import {
  calculateDebtPlan,
  validateDebtInput,
} from './lib/debtPlanner'
import type { DebtInput } from './lib/debtPlanner'

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
}

function formatRub(value: number): string {
  return currency.format(value)
}

function App() {
  const [input, setInput] = useState(defaultInput)
  const [showAllRows, setShowAllRows] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [submitted, setSubmitted] = useState<DebtInput | null>(null)

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

    const parsed: DebtInput = {
      principal: Number(input.principal),
      apr: Number(input.apr),
      termMonths: Number(input.termMonths),
      payment: Number(input.payment),
      extraPayment: Number(input.extraPayment),
    }

    const validationErrors = validateDebtInput(parsed)
    setErrors(validationErrors)

    if (validationErrors.length === 0) {
      setSubmitted(parsed)
    }
  }

  const visibleRows = result
    ? showAllRows
      ? result.withExtra.schedule
      : result.withExtra.schedule.slice(0, 24)
    : []

  return (
    <main className="page">
      <section className="hero">
        <p className="kicker">Debt Planner MVP</p>
        <h1>Калькулятор стоимости долга</h1>
        <p className="hero-copy">
          Введи параметры кредита и проверь, как ежемесячная досрочка меняет
          срок и переплату.
        </p>
      </section>

      <section className="panel">
        <h2>Параметры кредита</h2>
        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Сумма долга, ₽
            <input
              data-testid="principal"
              name="principal"
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
              name="apr"
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
              name="termMonths"
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
              name="payment"
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
              name="extraPayment"
              type="number"
              min="0"
              value={input.extraPayment}
              onChange={(e) => updateField('extraPayment', e.target.value)}
            />
          </label>

          <button data-testid="calculate" type="submit">
            Пересчитать
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
              <p data-testid="months-base">{result.withoutExtra.months} мес.</p>
            </article>
            <article className="summary-card">
              <h3>Срок с досрочкой</h3>
              <p data-testid="months-extra">{result.withExtra.months} мес.</p>
            </article>
            <article className="summary-card">
              <h3>Проценты без досрочки</h3>
              <p>{formatRub(result.withoutExtra.totalInterest)}</p>
            </article>
            <article className="summary-card">
              <h3>Проценты с досрочкой</h3>
              <p>{formatRub(result.withExtra.totalInterest)}</p>
            </article>
            <article className="summary-card highlight">
              <h3>Экономия</h3>
              <p data-testid="interest-savings">
                {formatRub(result.interestSavings)} и {result.monthSavings} мес.
              </p>
            </article>
          </div>

          <h2>График по месяцам (с досрочкой)</h2>
          <div className="table-wrap" data-testid="schedule-table">
            <table>
              <thead>
                <tr>
                  <th>Month #</th>
                  <th>Payment</th>
                  <th>Interest</th>
                  <th>Principal</th>
                  <th>Extra</th>
                  <th>Balance after</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.month}>
                    <td>{row.month}</td>
                    <td>{formatRub(row.payment)}</td>
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
      )}
    </main>
  )
}

export default App
