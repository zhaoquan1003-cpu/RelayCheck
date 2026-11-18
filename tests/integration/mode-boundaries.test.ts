import { describe, expect, it } from 'vitest'
import { createTestContext, waitForTerminal } from '../test-helpers'

describe('mode completeness and protocol boundaries', () => {
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
