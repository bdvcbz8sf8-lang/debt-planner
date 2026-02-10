import { expect, test } from '@playwright/test'

test('reduce payment mode shows new payment and dynamic payment values in table', async ({
  page,
}) => {
  await page.goto('/')

  await page.getByTestId('principal').fill('1000000')
  await page.getByTestId('apr').fill('18')
  await page.getByTestId('termMonths').fill('60')
  await page.getByTestId('payment').fill('25000')
  await page.getByTestId('extraPayment').fill('4000')
  await page.getByTestId('mode-reduce-payment').check()
  await page.getByTestId('calculate').click()

  await expect(page.getByTestId('new-payment')).toBeVisible()
  const paymentRow1 = await page.getByTestId('payment-row-1').innerText()
  const paymentRow2 = await page.getByTestId('payment-row-2').innerText()
  expect(paymentRow2).not.toEqual(paymentRow1)
})

test('start date shows payment dates in table and close date in summary', async ({
  page,
}) => {
  await page.goto('/')

  await page.getByTestId('principal').fill('500000')
  await page.getByTestId('apr').fill('12')
  await page.getByTestId('termMonths').fill('60')
  await page.getByTestId('payment').fill('12000')
  await page.getByTestId('extraPayment').fill('3000')
  await page.getByTestId('startDate').fill('2026-01-15')
  await page.getByTestId('calculate').click()

  await expect(page.getByTestId('close-date-extra')).toHaveText(/\d{4}-\d{2}-\d{2}/)
  await expect(page.locator('th', { hasText: 'Date' })).toBeVisible()
  await expect(page.locator('tbody tr').first()).toContainText('2026-01-15')
})
