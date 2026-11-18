import { test, expect, type Page } from '@playwright/test'

const testKey = 'model-list-browser-test-key'
const fetchModelsButton = (page: Page) => page.getByRole('button', { name: /获取模型|正在获取/ })

test('connection fields precede model selection and fetching requires both credentials', async ({ page }) => {
  await page.goto('/')
  const address = page.locator('#upstream-address')
  const key = page.locator('#api-key')
  const model = page.locator('#test-model')
  await expect(model).toBeVisible()

  const addressBounds = await address.boundingBox()
  const keyBounds = await key.boundingBox()
  const modelBounds = await model.boundingBox()
  expect(addressBounds!.y + addressBounds!.height).toBeLessThan(keyBounds!.y)
  expect(keyBounds!.y + keyBounds!.height).toBeLessThan(modelBounds!.y)

  await expect(fetchModelsButton(page)).toBeDisabled()
  await key.fill(testKey)
  await expect(fetchModelsButton(page)).toBeEnabled()
  await address.fill('')
  await expect(fetchModelsButton(page)).toBeDisabled()
  await address.fill('http://127.0.0.1:3199')
  await expect(fetchModelsButton(page)).toBeEnabled()
})

test('fetched model IDs can be selected and submitted to the relay', async ({ page }) => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  const requests: unknown[] = []
  await page.route('**/api/v1/models', async (route) => {
    expect(route.request().method()).toBe('POST')
    requests.push(route.request().postDataJSON())
    await pending
    await route.fulfill({ json: { ok: true, models: [{ id: 'mock-pass' }, { id: 'mock-math' }] } })
  })
  await page.goto('/')
  await page.locator('#upstream-address').fill(' http://127.0.0.1:3199 ')
  await page.locator('#api-key').fill(` ${testKey} `)
  await fetchModelsButton(page).click()
  await expect(fetchModelsButton(page)).toBeDisabled()
  await expect(fetchModelsButton(page)).toContainText('正在获取')
  expect(requests).toEqual([{ address: 'http://127.0.0.1:3199', key: testKey }])
  release()

  const model = page.locator('#test-model')
  await expect(model.locator('option')).toContainText(['mock-pass', 'mock-math'])
  await model.selectOption({ label: 'mock-math' })
  await page.getByRole('button', { name: '旧文字' }).click()
  const submission = page.waitForRequest((request) => request.method() === 'POST' && request.url().endsWith('/api/v1/tests'))
  await page.getByRole('button', { name: '开始检测' }).click()
  expect((await submission).postDataJSON()).toMatchObject({ model: 'mock-math', key: testKey, address: 'http://127.0.0.1:3199' })
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.badge').first()).toContainText('不降智')
  await expect(dialog.locator('.katex').first()).toBeVisible()
  await expect(page.locator('#api-key')).toHaveValue('')
})

test('model lookup errors preserve manual selection and can be retried', async ({ page }) => {
  let requests = 0
  await page.route('**/api/v1/models', async (route) => {
    requests += 1
    if (requests === 1) {
      await route.fulfill({ status: 401, json: { ok: false, error: { code: 'UPSTREAM_AUTH', message: '测试密钥无权读取模型列表' } } })
      return
    }
    await route.fulfill({ json: { ok: true, models: [{ id: 'mock-retry-model' }] } })
  })
  await page.goto('/')
  await page.locator('#api-key').fill(testKey)
  await fetchModelsButton(page).click()
  await expect(page.getByText('测试密钥无权读取模型列表', { exact: false })).toBeVisible()
  await expect(page.locator('#api-key')).toHaveValue(testKey)
  await expect(fetchModelsButton(page)).toBeEnabled()
  await page.locator('#test-model').selectOption('custom')
  await page.getByPlaceholder('例如 gpt-6-astra').fill('manual-model')
  await expect(page.getByRole('button', { name: '开始检测' })).toBeEnabled()

  await fetchModelsButton(page).click()
  await expect(page.locator('#test-model option')).toContainText(['mock-retry-model'])
  await expect(page.getByText('测试密钥无权读取模型列表', { exact: false })).toHaveCount(0)
  expect(requests).toBe(2)
})

test('an empty model list explains the result and leaves custom models available', async ({ page }) => {
  await page.route('**/api/v1/models', (route) => route.fulfill({ json: { ok: true, models: [] } }))
  await page.goto('/')
  await page.locator('#api-key').fill(testKey)
  await fetchModelsButton(page).click()
  await expect(page.locator('#new-test')).toContainText(/未返回.*模型|没有.*模型|暂无.*模型/)
  await expect(fetchModelsButton(page)).toBeEnabled()
  await page.locator('#test-model').selectOption('custom')
  await page.getByPlaceholder('例如 gpt-6-astra').fill('manual-after-empty')
  await expect(page.getByRole('button', { name: '开始检测' })).toBeEnabled()
})

for (const credential of ['address', 'key'] as const) {
  test(`changing the ${credential} invalidates loaded models and ignores an old lookup`, async ({ page }) => {
    let requests = 0
    let release!: () => void
    let complete!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    const completed = new Promise<void>((resolve) => { complete = resolve })
    await page.route('**/api/v1/models', async (route) => {
      requests += 1
      if (requests === 2) {
        await pending
        await route.fulfill({ json: { ok: true, models: [{ id: 'stale-delayed-model' }] } }).catch(() => {})
        complete()
        return
      }
      const id = requests === 1 ? 'old-connection-model' : 'new-connection-model'
      await route.fulfill({ json: { ok: true, models: [{ id }] } })
    })
    await page.goto('/')
    await page.locator('#api-key').fill(testKey)
    await fetchModelsButton(page).click()
    const model = page.locator('#test-model')
    await expect(model.locator('option')).toContainText(['old-connection-model'])
    await fetchModelsButton(page).click()
    await expect(fetchModelsButton(page)).toBeDisabled()
    await expect.poll(() => requests).toBe(2)

    if (credential === 'address') await page.locator('#upstream-address').fill('http://127.0.0.1:3199/v1')
    else await page.locator('#api-key').fill('replacement-model-list-key')
    await expect(model.locator('option')).not.toContainText(['old-connection-model'])
    await expect(fetchModelsButton(page)).toBeEnabled()
    await fetchModelsButton(page).click()
    await expect(model.locator('option')).toContainText(['new-connection-model'])
    release()
    await completed
    await expect(model.locator('option')).not.toContainText(['stale-delayed-model'])
    await expect(model.locator('option')).toContainText(['new-connection-model'])
    expect(requests).toBe(3)
  })
}
