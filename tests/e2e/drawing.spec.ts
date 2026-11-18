import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

async function createDrawing(request: APIRequestContext, model = 'mock-html-animation') {
  const response = await request.post('/api/v1/tests', { data: {
    address: 'http://127.0.0.1:3199', key: 'drawing-browser-test-key',
    apiType: 'responses', model, effort: 'low', testMode: 'pelican',
  } })
  expect(response.status()).toBe(202)
  const id = (await response.json()).test.id as string
  await expect.poll(async () => (await (await request.get(`/api/v1/tests/${id}`)).json()).test.status).toBe('completed')
  return id
}

async function openPreview(page: Page, id: string) {
  await page.goto(`/?id=${id}`)
  const preview = page.getByTestId('drawing-preview')
  await expect(preview).toBeVisible()
  await expect(preview).toHaveAttribute('sandbox', 'allow-scripts')
  await expect(preview).toHaveAttribute('referrerpolicy', 'no-referrer')
  return page.frameLocator('[data-testid="drawing-preview"]')
}

async function positionBelowHeader(locator: Locator) {
  await locator.evaluate((element) => {
    const dialog = element.closest('dialog')!
    const header = dialog.querySelector('.dialog-header')!
    dialog.scrollTop += element.getBoundingClientRect().top - header.getBoundingClientRect().bottom - 16
  })
}

test('HTML animation runs, keeps its state on refresh, and unloads on stop and close', async ({ page, request }) => {
  const id = await createDrawing(request)
  const previewResponses: string[] = []
  page.on('response', (response) => {
    if (response.url().endsWith(`/tests/${id}/preview`)) previewResponses.push(response.url())
  })
  const frame = await openPreview(page, id)
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('.badge').first()).toContainText('待人工判读')
  await expect(frame.locator('#scene')).toBeVisible()
  const crank = frame.locator('#crank')
  const firstTransform = await crank.getAttribute('transform')
  await expect.poll(() => crank.getAttribute('transform')).not.toBe(firstTransform)
  const started = await frame.locator('html').getAttribute('data-started')
  expect(started).toBeTruthy()

  // Inline event handlers are part of a generated HTML artifact, just like scripts.
  await frame.getByRole('button', { name: '暂停 / 继续' }).click()
  const pausedTick = await frame.locator('html').getAttribute('data-tick')
  await page.waitForTimeout(100)
  expect(await frame.locator('html').getAttribute('data-tick')).toBe(pausedTick)
  await frame.getByRole('button', { name: '暂停 / 继续' }).click()
  await expect.poll(() => frame.locator('html').getAttribute('data-tick')).not.toBe(pausedTick)

  const detailResponse = page.waitForResponse((response) => response.url().endsWith(`/tests/${id}`))
  await dialog.getByRole('button', { name: '刷新快照' }).click()
  await detailResponse
  expect(await frame.locator('html').getAttribute('data-started')).toBe(started)
  expect(previewResponses).toHaveLength(1)

  const runningFrame = await (await page.getByTestId('drawing-preview').elementHandle())!.contentFrame()
  await dialog.getByRole('button', { name: '停止预览' }).click()
  await expect(page.getByTestId('drawing-preview')).toHaveCount(0)
  expect(runningFrame!.isDetached()).toBe(true)
  await dialog.getByRole('button', { name: '重新播放' }).click()
  await expect(frame.locator('#scene')).toBeVisible()
  await expect.poll(() => frame.locator('html').getAttribute('data-started')).not.toBe(started)

  const shareUrl = await dialog.locator('#share-url').inputValue()
  const resumedFrame = await (await page.getByTestId('drawing-preview').elementHandle())!.contentFrame()
  await dialog.getByRole('button', { name: '关闭详情' }).click()
  await expect(page.getByTestId('drawing-preview')).toHaveCount(0)
  expect(resumedFrame!.isDetached()).toBe(true)
  await page.goto(shareUrl)
  await expect(frame.locator('#scene')).toBeVisible()
  await expect(page.getByRole('dialog').locator('.badge').first()).toContainText('待人工判读')
})

test('CSS animation and script-created SVG survive the production preview policy', async ({ page, request }) => {
  const cssId = await createDrawing(request, 'mock-html-css')
  let frame = await openPreview(page, cssId)
  const wheel = frame.locator('#wheel')
  const transform = await wheel.evaluate((element) => getComputedStyle(element).transform)
  await expect.poll(() => wheel.evaluate((element) => getComputedStyle(element).transform)).not.toBe(transform)

  const dynamicId = await createDrawing(request, 'mock-html-dynamic')
  frame = await openPreview(page, dynamicId)
  await expect(frame.locator('#dynamic-scene')).toBeVisible()
  await expect(frame.locator('#dynamic-scene circle')).toHaveCount(1)
})

test('generated HTML cannot reach the parent, storage, APIs, external resources, or top-level navigation', async ({ page, request, context }) => {
  const id = await createDrawing(request, 'mock-html-hostile')
  const escapedRequests: string[] = []
  await context.route('**/*drawing-security*', (route) => {
    escapedRequests.push(route.request().url())
    return route.abort()
  })
  await page.addInitScript(() => localStorage.setItem('drawing-sentinel', 'parent-only-value'))
  let popups = 0
  page.on('popup', async (popup) => { popups += 1; await popup.close() })
  const frame = await openPreview(page, id)
  const report = frame.locator('#security-report')
  await expect(report).not.toHaveText('running')
  expect(JSON.parse((await report.textContent())!)).toEqual({
    parentDom: true, parentStorage: true, ownStorage: true, popup: true,
    topNavigation: true, api: true, external: true, externalImage: true,
  })
  expect(escapedRequests).toEqual([])
  expect(popups).toBe(0)
  expect(new URL(page.url()).pathname).toBe('/')
  expect(new URL(page.url()).searchParams.get('id')).toBe(id)
  expect(await page.evaluate(() => localStorage.getItem('drawing-sentinel'))).toBe('parent-only-value')
  await expect(page.locator('body')).not.toHaveAttribute('data-escaped')
  await page.getByRole('button', { name: '关闭详情' }).click()
  await expect(page.getByRole('button', { name: '开始检测', exact: true })).toBeVisible()
})

test('missing and truncated drawing outputs stay neutral with a useful explanation', async ({ page, request }) => {
  for (const model of ['mock-no-svg', 'mock-html-truncated']) {
    const id = await createDrawing(request, model)
    await page.goto(`/?id=${id}`)
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('.badge').first()).toContainText('待人工判读')
    await expect(dialog.getByTestId('drawing-preview')).toHaveCount(0)
    await expect(dialog.getByTestId('svg-preview')).toHaveCount(0)
    await expect(dialog.locator('.verdict-reason')).toContainText(model === 'mock-no-svg' ? /没有|未找到/ : /完整|截断/)
  }
})

test('animation, four checks, and reference diagrams fit desktop and mobile', async ({ page, request }) => {
  const id = await createDrawing(request)
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: width >= 768 ? 1000 : 844 })
    const frame = await openPreview(page, id)
    await expect(frame.locator('#scene')).toBeVisible()
    const sceneBounds = (await frame.locator('#scene').boundingBox())!
    const frameBounds = (await page.getByTestId('drawing-preview').boundingBox())!
    expect(sceneBounds.y + sceneBounds.height).toBeLessThanOrEqual(frameBounds.y + frameBounds.height + 1)
    const dialog = page.getByRole('dialog')
    const guide = dialog.locator('.drawing-checks')
    await expect(guide).toBeVisible()
    for (const check of ['车轮', '脚踏', '视角', '喉囊']) await expect(guide).toContainText(check)
    await expect(dialog.locator('.drawing-reference-card')).toHaveCount(4)
    const dimensions = await dialog.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }))
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1)
    const sourceDetails = dialog.locator('details').filter({ has: page.locator('summary', { hasText: /源码/ }) }).first()
    await expect(sourceDetails).not.toHaveAttribute('open')
    if (width <= 390) {
      for (const name of ['停止预览', '重新播放']) {
        expect((await dialog.getByRole('button', { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
      }
    }
    await positionBelowHeader(dialog.locator('.drawing-preview-panel'))
    await page.screenshot({ path: `test-results/drawing-preview-${width}.png` })
    await positionBelowHeader(guide)
    await page.screenshot({ path: `test-results/drawing-guide-${width}.png` })
    await positionBelowHeader(dialog.locator('.drawing-reference'))
    await page.screenshot({ path: `test-results/drawing-reference-${width}.png` })
  }
})
