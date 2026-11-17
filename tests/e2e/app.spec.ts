import { test, expect } from '@playwright/test'

test('quick test completes in the background and is shareable', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: /别猜了/ })).toBeVisible()
  await expect(page.locator('.hero-stats')).toContainText('5')
  await page.screenshot({ path: 'test-results/home.png', fullPage: true })

  await page.getByRole('button', { name: '旧文字' }).click()
  await page.locator('.key-input input').fill('local-test-key-1234567890')
  await expect(page.getByRole('button', { name: '开始测降智' })).toBeEnabled()
  await page.getByRole('button', { name: '开始测降智' }).click()

  await expect(page.getByRole('status')).toContainText('已提交后台测试')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.badge').first()).toContainText('不降智')

  const shareUrl = await dialog.locator('#share-url').inputValue()
  expect(shareUrl).toContain('?id=')
  await expect(dialog).toContainText('回答正文')
  await expect(dialog).toContainText('21')

  await dialog.getByRole('button', { name: '关闭详情' }).click()
  await expect(dialog).not.toBeVisible()

  await page.goto(shareUrl)
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').locator('.badge').first()).toContainText('不降智')
  await page.screenshot({ path: 'test-results/e2e-detail.png', fullPage: true })

  expect(consoleErrors).toEqual([])
})

test('renders KaTeX and Markdown tables from model output', async ({ page }) => {
  await page.goto('/')
  await page.locator('select').first().selectOption('custom')
  await page.getByPlaceholder('例如 gpt-6-astra').fill('mock-math')
  await page.getByRole('button', { name: '旧文字' }).click()
  await page.locator('.key-input input').fill('{{SECRET_i4p2p2fg}}')
  await page.getByRole('button', { name: '开始测降智' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.badge').first()).toContainText('不降智')
  await expect(dialog.locator('.katex').first()).toBeVisible()
  await expect(dialog.locator('.answer-section .markdown-body table')).toBeVisible()
})
  test('strict and dual controls are visible and mode help updates', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '严格原图' }).click()
  await expect(page.getByText('只发送糖果题原图')).toBeVisible()
  await page.getByRole('button', { name: '双测' }).click()
  await expect(page.getByText('并发发送旧文字题与严格原图题')).toBeVisible()
  await page.getByRole('button', { name: 'ModelTrace' }).click()
  await expect(page.locator('.field-help')).toContainText('3 条长数字题')
})