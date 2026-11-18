import { test, expect, type APIRequestContext } from '@playwright/test'

async function createRecord(request: APIRequestContext, model = 'mock-pass') {
  const response = await request.post('/api/v1/tests', { data: {
    address: 'http://127.0.0.1:3199', key: 'browser-regression-key-123456',
    apiType: 'responses', model, effort: 'low', testMode: 'quick',
  } })
  expect(response.status()).toBe(202)
  const { test: record } = await response.json()
  await expect.poll(async () => (await (await request.get(`/api/v1/tests/${record.id}`)).json()).test.status).toBe('completed')
  return (await (await request.get(`/api/v1/tests/${record.id}`)).json()).test
}

test('private-list configuration opens My tests and fetches summaries without answer payloads', async ({ page, request }) => {
  const record = await createRecord(request)
  await page.addInitScript((id) => localStorage.setItem('relaycheck-my-tests', JSON.stringify([id])), record.id)
  await page.route('**/api/v1/config', async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    body.config.publicListEnabled = false
    await route.fulfill({ json: body })
  })
  const fullDetailCalls: string[] = []
  const listCalls: string[] = []
  page.on('request', (req) => {
    if (/\/tests\/[a-f0-9]{16}$/.test(req.url())) fullDetailCalls.push(req.url())
    if (/\/tests\?page=/.test(req.url())) listCalls.push(req.url())
  })
  await page.goto('/')
  await expect(page.getByRole('tab', { name: /我的/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tab', { name: '全部', exact: true })).toHaveCount(0)
  await expect(page.locator('.records-panel tbody')).toContainText(record.model)
  expect(fullDetailCalls).toEqual([])
  expect(listCalls).toEqual([])
  await page.getByRole('button', { name: '查看回答' }).click()
  await expect(page.getByRole('dialog')).toContainText('21')
})

test('switching tabs discards a delayed response from the previous tab', async ({ page, request }) => {
  const record = await createRecord(request)
  await page.addInitScript((id) => localStorage.setItem('relaycheck-my-tests', JSON.stringify([id])), record.id)
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/api/v1/tests?page=*', async (route) => {
    await pending
    await route.fulfill({ json: { ok: true, records: [{ ...record, model: 'stale-public-record' }], total: 1, page: 1, pageSize: 30 } }).catch(() => {})
  })
  await page.goto('/')
  await page.getByRole('tab', { name: /我的/ }).click()
  await expect(page.locator('.records-panel tbody')).toContainText(record.model)
  release()
  await expect(page.getByRole('tab', { name: /我的/ })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.records-panel tbody')).not.toContainText('stale-public-record')
})

test('missing shared records stop polling and can be dismissed', async ({ page }) => {
  let detailRequests = 0
  page.on('request', (req) => { if (req.url().endsWith('/tests/0000000000000000')) detailRequests += 1 })
  await page.goto('/?id=0000000000000000')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('not found')
  await page.waitForTimeout(3200)
  expect(detailRequests).toBe(1)
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(dialog).not.toBeVisible()
  expect(new URL(page.url()).searchParams.has('id')).toBe(false)
})

test('long and hostile answers stay readable without executing HTML', async ({ page, request }) => {
  const record = await createRecord(request)
  const longAnswer = '<img src=x onerror="window.__injected=true">\n' + '$'.repeat(70_000) + '\n答案是 21。'
  await page.route(`**/api/v1/tests/${record.id}`, (route) => route.fulfill({ json: { ok: true, test: { ...record, answer: longAnswer } } }))
  await page.goto(`/?id=${record.id}`)
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('.answer-section')).toContainText('按纯文本显示完整内容')
  await expect(dialog.locator('.answer-section pre')).toHaveText(longAnswer)
  await expect(dialog.locator('.answer-section img')).toHaveCount(0)
})

test('mobile layout fits the viewport and preserves modal controls', async ({ page, request }) => {
  const record = await createRecord(request)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/?id=${record.id}`)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const bounds = await dialog.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391)
  await dialog.getByRole('button', { name: '关闭详情' }).click()
  await expect(page.getByRole('heading', { name: /让模型表现/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '开始检测' })).toBeVisible()
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true })
})
