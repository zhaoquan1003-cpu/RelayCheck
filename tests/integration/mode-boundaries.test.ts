import { describe, expect, it } from 'vitest'
import { createTestContext, waitForTerminal } from '../test-helpers'

describe('mode completeness and protocol boundaries', () => {
  it.each((['quick', 'strict', 'dual', 'cup', 'advanced'] as const).flatMap((testMode) =>
    (['responses', 'chat_completions'] as const).map((apiType) => ({ testMode, apiType })),
  ))('keeps drawing-only instructions out of $testMode over $apiType', async ({ testMode, apiType }) => {
    const context = await createTestContext()
    try {
      const response = await context.app.inject({ method: 'POST', url: '/api/v1/tests', payload: {
        address: context.mock.url, key: 'mode-test-key', apiType,
        model: testMode === 'advanced' ? 'mock-advanced' : 'mock-pass', effort: 'high', testMode,
      } })
      expect(response.statusCode).toBe(202)
      const test = await waitForTerminal(context.base, response.json().test.id)
      expect(test.status).toBe('completed')
      expect(context.mock.requests).toHaveLength(testMode === 'dual' ? 2 : testMode === 'advanced' ? 3 : 1)
      for (const { body } of context.mock.requests) {
        expect(body).not.toHaveProperty('instructions')
        expect(body).not.toHaveProperty('tools')
        if (apiType === 'responses') {
          expect(body.reasoning).toEqual({ effort: 'high' })
          expect(body.input).toEqual([expect.objectContaining({ role: 'user' })])
          expect((body.input as object[])[0]).not.toHaveProperty('type')
        } else {
          expect(body.reasoning_effort).toBe('high')
          expect(body.messages).toEqual([expect.objectContaining({ role: 'user' })])
        }
      }
    } finally { await context.close() }
  })

  it('runs the cup question through Chat Completions and sends the correct prompt', async () => {
    const context = await createTestContext()
    try {
      const response = await context.app.inject({ method: 'POST', url: '/api/v1/tests', payload: {
        address: context.mock.url, key: 'mode-test-key', apiType: 'chat_completions',
        model: 'mock-pass', effort: 'low', testMode: 'cup',
      } })
      expect(response.statusCode).toBe(202)
      const test = await waitForTerminal(context.base, response.json().test.id)
      expect(test.verdict).toBe('pass')
      expect(test.answer).toContain('8')
      expect(test.verdictReason).toContain('未校验')
      expect(JSON.stringify(context.mock.requests[0].body)).toContain('水杯')
    } finally { await context.close() }
  })

  it('keeps strict Chat Completions image-only', async () => {
    const context = await createTestContext()
    try {
      const response = await context.app.inject({ method: 'POST', url: '/api/v1/tests', payload: {
        address: context.mock.url, key: 'mode-test-key', apiType: 'chat_completions',
        model: 'mock-pass', effort: 'low', testMode: 'strict',
      } })
      const test = await waitForTerminal(context.base, response.json().test.id)
      expect(test.verdict).toBe('pass')
      const messages = context.mock.requests[0].body.messages as Array<{ content: unknown[] }>
      expect(messages[0].content).toEqual([expect.objectContaining({ type: 'image_url' })])
    } finally { await context.close() }
  })

  it('does not mark an incomplete fingerprint run successful', async () => {
    const context = await createTestContext()
    try {
      const response = await context.app.inject({ method: 'POST', url: '/api/v1/tests', payload: {
        address: context.mock.url, key: 'mode-test-key', apiType: 'responses',
        model: 'mock-partial-advanced', effort: 'low', testMode: 'advanced',
      } })
      const test = await waitForTerminal(context.base, response.json().test.id)
      expect(test.status).toBe('failed')
      expect(test.verdict).toBeNull()
      expect(test.probes.filter((probe: { status: string }) => probe.status === 'completed')).toHaveLength(2)
      expect(test.error).toContain('503')
      expect(test.progress).toMatchObject({ current: 3, completed: 2, stage: 'failed' })
    } finally { await context.close() }
  })
})
