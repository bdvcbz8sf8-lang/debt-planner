import { expect, test } from '@playwright/test'

test('avalanche puts higher APR debt first in payoff order', async ({ page }) => {
  await page.goto('/')
  const cards = page.locator('.loan-card')
  const first = cards.nth(0)
  const second = cards.nth(1)

  await first.locator('.name-input').fill('Debt A')
  await second.locator('.name-input').fill('Debt B')
  await first.getByLabel('APR').fill('10')
  await second.getByLabel('APR').fill('30')
  await first.getByLabel('Balance').fill('500000')
  await second.getByLabel('Balance').fill('100000')
  await page.getByTestId('strategy-avalanche').check()
  await page.getByTestId('calculate-plan').click()

  await expect(page.getByTestId('payoff-order').locator('li').first()).toContainText('Debt B')
})

test('snowball puts lower balance debt first in payoff order', async ({ page }) => {
  await page.goto('/')
  const cards = page.locator('.loan-card')
  const first = cards.nth(0)
  const second = cards.nth(1)

  await first.locator('.name-input').fill('Big Debt')
  await second.locator('.name-input').fill('Small Debt')
  await first.getByLabel('Balance').fill('800000')
  await second.getByLabel('Balance').fill('120000')
  await first.getByLabel('APR').fill('12')
  await second.getByLabel('APR').fill('5')
  await first.getByLabel('Payment', { exact: true }).fill('20000')
  await second.getByLabel('Payment', { exact: true }).fill('5000')
  await page.getByTestId('strategy-snowball').check()
  await page.getByTestId('calculate-plan').click()

  await expect(page.getByTestId('payoff-order').locator('li').first()).toContainText('Small Debt')
})

test('includeInPlan=false keeps loan in list but removes it from strategy focus', async ({ page }) => {
  await page.goto('/')
  const cards = page.locator('.loan-card')
  const first = cards.nth(0)
  const second = cards.nth(1)

  await first.locator('.name-input').fill('Excluded High APR')
  await second.locator('.name-input').fill('Included Loan')
  await first.getByLabel('APR').fill('60')
  await first.getByLabel('Balance').fill('100000')
  await second.getByLabel('APR').fill('10')
  await first.locator('input[type="checkbox"]').uncheck()
  await page.getByTestId('strategy-avalanche').check()
  await page.getByTestId('calculate-plan').click()

  await expect(page.getByTestId('focus-badge')).toContainText('Included Loan')
  await expect(cards).toHaveCount(2)
})

test('loan details show portfolio plan schedule after calculation', async ({ page }) => {
  await page.goto('/')
  const firstCard = page.locator('.loan-card').nth(0)

  await firstCard.locator('.name-input').fill('Detail Loan')
  await page.getByTestId('extra-budget').fill('9000')
  await page.getByTestId('calculate-plan').click()

  await firstCard.getByRole('button', { name: 'Show details' }).click()
  const table = firstCard.locator('table')
  await expect(table).toBeVisible()
  await expect(firstCard.locator('text=Portfolio plan calc')).toBeVisible()
})
