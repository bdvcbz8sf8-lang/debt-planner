import { expect, test } from '@playwright/test'

async function disableAnimations(page: import('@playwright/test').Page) {
  await page.addStyleTag({
    content: `
      *,
      *::before,
      *::after {
        transition: none !important;
        animation: none !important;
      }
    `,
  })
}

test.describe('visual regression', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1728, height: 1117 })
    await page.goto('/')
    await disableAnimations(page)
  })

  test('single debt screen matches baseline', async ({ page }) => {
    await page.getByRole('button', { name: 'Один долг' }).click()
    await expect(page).toHaveScreenshot('single-debt-screen.png', {
      fullPage: true,
      maxDiffPixels: 120,
    })
  })

  test('portfolio empty state matches baseline', async ({ page }) => {
    await expect(page).toHaveScreenshot('portfolio-empty-screen.png', {
      fullPage: true,
      maxDiffPixels: 120,
    })
  })

  test('portfolio with one debt and strategy block matches baseline', async ({ page }) => {
    await page.getByTestId('add-debt').click()
    const card = page.locator('.loan-card').first()
    await card.locator('[data-testid^="details-"]').click()
    await card.locator('.name-input').fill('Тестовый долг')
    await card.locator('label:has-text("Остаток") input').fill('500000')
    await card.locator('label:has-text("%") input').fill('12.5')
    await card.locator('label:has-text("Срок (месяцы)") input').fill('60')
    await card.locator('label:has-text("Платёж") input').fill('15000')
    await card.locator('label:has-text("Дата платежа") input').fill('2026-02-10')

    await expect(page).toHaveScreenshot('portfolio-with-debt-screen.png', {
      fullPage: true,
      maxDiffPixels: 160,
    })
  })
})
