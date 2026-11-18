import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { TestMode, TestStatus } from '../../src/shared/types'
import { MAX_DRAWING_BYTES } from '../../src/shared/drawing-art'
import { createTestContext, waitForTerminal, type TestContext } from '../test-helpers'

const ORIGINAL_PROMPT = '创建一个HTML，内容是SVG绘制一个鹈鹕骑自行车的2D动画，你不需要任何测试，只靠你自己完成，不要使用任何skill，不要依赖我本地的AGENTS.md'
const HTML = '<!doctype html><html><head><meta charset="utf-8"><style>@keyframes turn{to{transform:rotate(360deg)}}svg{animation:turn 4s linear infinite}</style></head><body><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="30"/></svg><button onclick="document.body.dataset.paused=\'yes\'">暂停</button><script>document.body.dataset.started = "yes"</script></body></html>'

describe('isolated drawing preview', () => {
  let context: TestContext

  beforeAll(async () => { context = await createTestContext() })
  afterAll(async () => { await context.close() })

  function savedTest(answer: string, status: TestStatus = 'completed', testMode: TestMode = 'pelican'): string {
    const id = randomBytes(8).toString('hex')
    context.repository.insertTest({
      id, source: 'manual', poolId: null, groupName: '', addressMasked: 'https://relay.example',
      keyMasked: 'key****', model: 'saved-drawing', effort: 'low', apiType: 'responses', testMode,
      questionVersion: '2026-11-v3', question: ORIGINAL_PROMPT, questionImage: null, clientIpHash: null,
      progress: { current: 1, completed: 1, total: 1, stage: 'completed' },
    })
    context.repository.updateTest(id, { answer, status, verdict: 'unknown' })
    return id
  }

  it('returns the complete stored HTML without stripping styles, scripts or controls', async () => {
    const id = savedTest(`以下是代码：\n\n\`\`\`html\n${HTML}\n\`\`\`\n完成。`)
    const response = await fetch(`${context.base}/api/v1/tests/${id}/preview`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-frame-options')).toBe('SAMEORIGIN')
    expect(await response.text()).toBe(HTML)
    expect(context.repository.getDetail(id)?.answer).toContain(`\`\`\`html\n${HTML}`)
  })

  it('applies an opaque-origin sandbox and a standalone CSP without weakening the app policy', async () => {
    const id = savedTest(HTML)
    const response = await fetch(`${context.base}/api/v1/tests/${id}/preview`)
    const policy = response.headers.get('content-security-policy') || ''
    const directives = new Map(policy.split(';').map((directive) => {
      const [name, ...values] = directive.trim().split(/\s+/)
      return [name, values.join(' ')]
    }))
    expect(directives.get('sandbox')).toBe('allow-scripts')
    expect(directives.get('script-src')).toBe("'unsafe-inline'")
    expect(directives.get('style-src')).toBe("'unsafe-inline'")
    expect(directives.get('img-src')).toBe('data:')
    expect(directives.get('font-src')).toBe('data:')
    expect(directives.get('frame-ancestors')).toBe("'self'")
    for (const name of ['default-src', 'connect-src', 'object-src', 'frame-src', 'worker-src', 'base-uri', 'form-action']) {
      expect(directives.get(name), name).toBe("'none'")
    }
    expect(directives.has('script-src-attr')).toBe(false)
    expect(policy).not.toContain('allow-same-origin')
    expect(policy.match(/script-src /g)).toHaveLength(1)

    const appResponse = await fetch(`${context.base}/api/v1/config`)
    const appPolicy = appResponse.headers.get('content-security-policy') || ''
    expect(appPolicy).toContain("script-src 'self'")
    expect(appPolicy).toContain("frame-ancestors 'none'")
    expect(appPolicy).not.toContain('sandbox allow-scripts')
    expect(appPolicy).not.toContain("script-src 'unsafe-inline'")
  })

  it('allows HTML that creates its SVG dynamically', async () => {
    const source = '<html><body><script>document.body.append(document.createElementNS("http://www.w3.org/2000/svg", "svg"))</script></body></html>'
    const id = savedTest(source)
    const response = await context.app.inject(`/api/v1/tests/${id}/preview`)
    expect(response.statusCode).toBe(200)
    expect(response.body).toBe(source)
  })

  it('returns 404 for malformed IDs, missing records and other modes', async () => {
    const otherMode = savedTest(HTML, 'completed', 'quick')
    for (const id of ['not-a-record', 'ffffffffffffffff', otherMode]) {
      const response = await context.app.inject(`/api/v1/tests/${id}/preview`)
      expect(response.statusCode).toBe(404)
      expect(response.json().error.code).toBe('NOT_FOUND')
    }
  })

  it.each(['queued', 'running', 'failed'] as const)('does not execute a %s record even when it contains HTML', async (status) => {
    const id = savedTest(HTML, status)
    const response = await context.app.inject(`/api/v1/tests/${id}/preview`)
    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('PREVIEW_NOT_READY')
    expect(response.body).not.toContain('<script>')
  })

  it.each([
    { name: 'plain text', answer: '抱歉，我无法画图。', message: '没有可预览' },
    { name: 'truncated HTML', answer: '<html><body><svg></svg>', message: '不完整' },
    { name: 'oversized HTML', answer: `<html><body>${'a'.repeat(MAX_DRAWING_BYTES)}</body></html>`, message: '512 KiB' },
    { name: 'legacy SVG', answer: '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="1" cy="1" r="1"/></svg>', message: '图片预览' },
  ])('returns a clear 422 for $name', async ({ answer, message }) => {
    const id = savedTest(answer)
    const response = await context.app.inject(`/api/v1/tests/${id}/preview`)
    expect(response.statusCode).toBe(422)
    expect(response.json().error.code).toBe('PREVIEW_UNAVAILABLE')
    expect(response.json().error.message).toContain(message)
    expect(response.json().error.message).not.toContain('降智')
  })

  it.each(['responses', 'chat_completions'] as const)('sends the exact single-message benchmark through %s', async (apiType) => {
    context.mock.reset()
    const created = await context.app.inject({ method: 'POST', url: '/api/v1/tests', payload: {
      address: context.mock.url, key: 'drawing-prompt-test-key', apiType,
      model: 'mock-svg', effort: 'high', testMode: 'pelican',
    } })
    expect(created.statusCode).toBe(202)
    const test = await waitForTerminal(context.base, created.json().test.id)
    expect(test.status).toBe('completed')
    expect(test.question).toBe(ORIGINAL_PROMPT)
    expect(test.probes).toHaveLength(1)
    expect(test.probes[0].prompt).toBe(ORIGINAL_PROMPT)
    expect(context.mock.requests).toHaveLength(1)
    const body = context.mock.requests[0].body
    expect(body.model).toBe('mock-svg')
    if (apiType === 'responses') {
      expect(body.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: ORIGINAL_PROMPT }] }])
      expect(body.reasoning).toEqual({ effort: 'high' })
    } else {
      expect(body.messages).toEqual([{ role: 'user', content: ORIGINAL_PROMPT }])
      expect(body.reasoning_effort).toBe('high')
    }
  })
})
