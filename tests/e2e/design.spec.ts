import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

test.use({ reducedMotion: 'reduce' })

async function createRecord(request: APIRequestContext) {
  const response = await request.post('/api/v1/tests', { data: {
    address: 'http://127.0.0.1:3199', key: 'apple-interface-test-key',
    apiType: 'responses', model: 'mock-math', effort: 'low', testMode: 'quick',
  } })
  expect(response.status()).toBe(202)
  const id = (await response.json()).test.id as string
  await expect.poll(async () => (await (await request.get(`/api/v1/tests/${id}`)).json()).test.status).toBe('completed')
  return (await (await request.get(`/api/v1/tests/${id}`)).json()).test
}

async function expectNoHorizontalOverflow(page: Page) {
  const size = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }))
  expect(size.content).toBeLessThanOrEqual(size.viewport + 1)
  for (const selector of ['.test-form-panel', '.records-panel', '.mode-grid', '.key-input']) {
    const bounds = await page.locator(selector).boundingBox()
    expect(bounds, selector).not.toBeNull()
    expect(bounds!.x, selector).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width, selector).toBeLessThanOrEqual(size.viewport + 1)
  }
}

for (const width of [1440, 768, 390, 320]) {
  test(`light interface and empty state remain usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/v1/tests?page=*', (route) => route.fulfill({ json: {
      ok: true, records: [], total: 0, page: 1, pageSize: 30,
    } }))
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /让模型表现/ })).toBeVisible()
    await expect(page.locator('.records-panel')).toContainText('还没有')
    await expectNoHorizontalOverflow(page)
    const colorScheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)
    expect(colorScheme).toContain('light')

    const submit = page.getByRole('button', { name: '开始检测', exact: true })
    await expect(submit).toBeDisabled()
    await page.locator('.key-input input').fill('ui-local-test-key')
    await expect(submit).toBeEnabled()
    if (width <= 390) {
      for (const control of [submit, page.locator('.key-input input'), page.locator('.mode-button').first()]) {
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      }
    }
    await page.locator('.key-input input').fill('')
    await page.evaluate(() => window.scrollTo(0, 0))
    if (width === 1440) {
      await page.screenshot({ path: 'test-results/apple-desktop.png' })
      await page.screenshot({ path: 'test-results/apple-desktop-full.png', fullPage: true })
    } else {
      await page.screenshot({ path: `test-results/apple-${width}.png`, fullPage: true })
    }
  })
}

test('records and detail sheet support mobile navigation and keyboard dismissal', async ({ page, request }) => {
  const record = await createRecord(request)
  await page.route('**/api/v1/tests?page=*', (route) => route.fulfill({ json: {
    ok: true, records: [record], total: 1, page: 1, pageSize: 30,
  } }))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.locator('.records-panel')).toContainText(record.model)
  await expectNoHorizontalOverflow(page)
  const openButton = page.getByRole('button', { name: '查看回答', exact: true })
  await openButton.scrollIntoViewIfNeeded()
  const openBounds = await openButton.boundingBox()
  expect(openBounds!.x).toBeGreaterThanOrEqual(0)
  expect(openBounds!.x + openBounds!.width).toBeLessThanOrEqual(391)
  expect(openBounds!.height).toBeGreaterThanOrEqual(44)
  await page.screenshot({ path: 'test-results/apple-mobile-records.png' })
  await openButton.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('21')
  const sheet = await dialog.boundingBox()
  expect(sheet!.x).toBeGreaterThanOrEqual(0)
  expect(sheet!.x + sheet!.width).toBeLessThanOrEqual(391)
  expect(sheet!.height).toBeLessThanOrEqual(844)
  await dialog.getByRole('button', { name: '关闭详情' }).focus()
  for (let count = 0; count < 12; count += 1) {
    await page.keyboard.press('Tab')
    // Native modal dialogs may briefly yield to browser chrome. Background
    // page controls must remain inert, but browser UI remains keyboard reachable.
    const focusAllowed = await dialog.evaluate((element) =>
      element.contains(document.activeElement) || (!document.hasFocus() && document.activeElement === document.body),
    )
    expect(focusAllowed).toBe(true)
  }
  await dialog.getByRole('button', { name: '关闭详情' }).focus()
  await page.screenshot({ path: 'test-results/apple-mobile-detail.png' })
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(openButton).toBeFocused()

  await page.setViewportSize({ width: 1440, height: 1000 })
  await openButton.click()
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.katex').first()).toBeVisible()
  await page.screenshot({ path: 'test-results/apple-desktop-detail.png' })
})

test('all rich detail layouts remain readable on desktop and mobile', async ({ page, request }) => {
  for (const mode of [
    { id: 'dual', model: 'mock-pass', content: '.dual-grid' },
    { id: 'advanced', model: 'mock-advanced', content: '.fingerprint-panel' },
    { id: 'pelican', model: 'mock-svg', content: '[data-testid="svg-preview"]' },
  ]) {
    const response = await request.post('/api/v1/tests', { data: {
      address: 'http://127.0.0.1:3199', key: 'apple-rich-detail-test-key',
      apiType: 'responses', model: mode.model, effort: 'low', testMode: mode.id,
    } })
    expect(response.status()).toBe(202)
    const id = (await response.json()).test.id as string
    await expect.poll(async () => (await (await request.get(`/api/v1/tests/${id}`)).json()).test.status).toBe('completed')
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 })
      await page.goto(`/?id=${id}`)
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.locator(mode.content)).toBeVisible()
      const dimensions = await dialog.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }))
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1)
      await page.screenshot({ path: `test-results/apple-${mode.id}-${width}.png` })
      await dialog.getByRole('button', { name: '关闭详情' }).click()
      await expect(dialog).not.toBeVisible()
    }
  }
})
