import { expect, test } from '@playwright/test'

test('shows summary and table after entering params', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('principal').fill('1000000')
  await page.getByTestId('apr').fill('33')
  await page.getByTestId('termMonths').fill('60')
  await page.getByTestId('payment').fill('37000')
  await page.getByTestId('extraPayment').fill('0')
  await page.getByTestId('calculate').click()

  await expect(page.getByTestId('months-base')).toBeVisible()
  await expect(page.getByTestId('schedule-table')).toBeVisible()
})

test('extra payment reduces term and gives positive savings', async ({ page }) => {
  await page.goto('/')

  await page.getByTestId('principal').fill('1000000')
  await page.getByTestId('apr').fill('33')
  await page.getByTestId('termMonths').fill('60')
  await page.getByTestId('payment').fill('37000')

  await page.getByTestId('extraPayment').fill('0')
  await page.getByTestId('calculate').click()
  const monthsBase = Number(
    (await page.getByTestId('months-base').innerText()).replace(/\D/g, ''),
  )

  await page.getByTestId('extraPayment').fill('5000')
  await page.getByTestId('calculate').click()
  const monthsExtra = Number(
    (await page.getByTestId('months-extra').innerText()).replace(/\D/g, ''),
  )
  const savingsText = await page.getByTestId('interest-savings').innerText()

  expect(monthsExtra).toBeLessThan(monthsBase)
  expect(savingsText).not.toContain('0 мес.')
})
