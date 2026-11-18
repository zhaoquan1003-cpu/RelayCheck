import { test, expect } from '@playwright/test'

test('quick test completes in the background and is shareable', async ({ page }) => {
  const consoleErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  await page.goto('/')
  await expect(page.getByRole('heading', { name: /让模型表现/ })).toBeVisible()
  await expect(page.locator('.hero-stats')).toContainText('6')
  await expect(page.getByTestId('pelican-bike')).toBeVisible()
  await expect(page.getByText('不参与判定')).toBeVisible()
  await page.screenshot({ path: 'test-results/home.png', fullPage: true })

  await page.getByRole('button', { name: '旧文字' }).click()
  await page.locator('.key-input input').fill('local-test-key-1234567890')
  await expect(page.getByRole('button', { name: '开始检测' })).toBeEnabled()
  await page.getByRole('button', { name: '开始检测' }).click()

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
  await page.getByRole('button', { name: '开始检测' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.badge').first()).toContainText('不降智')
  await expect(dialog.locator('.katex').first()).toBeVisible()
  await expect(dialog.locator('.answer-section .markdown-body table')).toBeVisible()
})
  test('strict and dual controls are visible and mode help updates', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('select').first()).toContainText('DeepSeek V4.1 Flash')
  await expect(page.locator('select').first()).toContainText('GLM-5.3')
  await expect(page.locator('select').first()).toContainText('Kimi K3')
  await page.getByRole('button', { name: '严格原图' }).click()
  await expect(page.getByText('只发送糖果题原图')).toBeVisible()
  await expect(page.locator('.strict-image-wrap img')).toHaveAttribute('src', '/questions/candy-strict.v2.png')
  await page.locator('.question-preview summary').click()
  await expect(page.locator('.question-preview')).toContainText('仅向模型发送原图')
  await page.getByRole('button', { name: '双测' }).click()
  await expect(page.getByText('并发发送旧文字题与严格原图题')).toBeVisible()
  await expect(page.locator('.question-preview')).toContainText('在活动前决定摸出的糖果数目')
  await expect(page.locator('.question-preview')).not.toContainText('自行决定取多少颗圆形')
  await expect(page.locator('.question-preview table')).toBeVisible()
  await page.getByRole('button', { name: 'ModelTrace' }).click()
  await expect(page.locator('.field-help')).toContainText('3 条长数字题')
})

test('degraded candy answer shows 降智 instead of a false pass', async ({ page }) => {
  await page.goto('/')
  await page.locator('select').first().selectOption('custom')
  await page.getByPlaceholder('例如 gpt-6-astra').fill('mock-degraded')
  await page.getByRole('button', { name: '双测' }).click()
  await page.locator('.key-input input').fill('local-test-key-1234567890')
  await page.getByRole('button', { name: '开始检测' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.badge').first()).toContainText('降智')
  await expect(dialog).toContainText('均未通过')
})

test('pelican mode renders the model SVG in an isolated preview', async ({ page }) => {
  await page.goto('/')
  await page.locator('select').first().selectOption('custom')
  await page.getByPlaceholder('例如 gpt-6-astra').fill('mock-svg')
  await page.getByRole('button', { name: '画图' }).click()
  await page.locator('.key-input input').fill('local-test-key-1234567890')
  await page.getByRole('button', { name: '开始检测' }).click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.badge').first()).toContainText('无法判定')
  await expect(dialog).toContainText('渲染结果（人工判读）')
  const preview = dialog.getByTestId('svg-preview')
  await expect(preview).toBeVisible()
  await expect(preview).toHaveAttribute('src', /^data:image\/svg\+xml/)
  const decoded = decodeURIComponent(
    ((await preview.getAttribute('src')) || '').replace(/^data:image\/svg\+xml;charset=utf-8,/, ''),
  )
  expect(decoded).toContain('<circle cx="60"')
  expect(decoded).toContain('<path d="M60 80')
})

test('hostile SVG output stays isolated inside the preview image', async ({ page }) => {
  const dialogs: string[] = []
  page.on('dialog', async (modal) => {
    dialogs.push(modal.message())
    await modal.dismiss()
  })
  await page.goto('/')
  await page.locator('select').first().selectOption('custom')
  await page.getByPlaceholder('例如 gpt-6-astra').fill('mock-svg-hostile')
  await page.getByRole('button', { name: '画图' }).click()
  await page.locator('.key-input input').fill('local-test-key-1234567890')
  await page.getByRole('button', { name: '开始检测' }).click()

  const dialog = page.getByRole('dialog')
  const preview = dialog.getByTestId('svg-preview')
  await expect(preview).toBeVisible()
  const decoded = decodeURIComponent(
    ((await preview.getAttribute('src')) || '').replace(/^data:image\/svg\+xml;charset=utf-8,/, ''),
  )
  expect(decoded).not.toContain('script')
  expect(decoded).not.toContain('example.com')
  expect(decoded).not.toContain('onload')
  await page.waitForTimeout(600)
  expect(dialogs).toEqual([])
})