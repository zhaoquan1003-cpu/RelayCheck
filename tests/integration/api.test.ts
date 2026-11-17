import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { maskKey } from '../../src/server/services/mask'
import { createTestContext, waitForTerminal, type TestContext } from '../test-helpers'

const KEY = 'test-key-1234567890'

async function postTest(
  base: string,
  body: Record<string, unknown>,
): Promise<{ status: number; json: any }> {
  const response = await fetch(`${base}/api/v1/tests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, json: await response.json() }
}

describe('RelayCheck API integration', () => {
  let context: TestContext

  beforeAll(async () => {
    context = await createTestContext()
  })

  afterAll(async () => {
    await context.close()
  })

  it('serves health and config', async () => {
    const health = await fetch(`${context.base}/api/v1/health`)
    expect(health.status).toBe(200)
    const healthJson = (await health.json()) as any
    expect(healthJson.ok).toBe(true)
    expect(healthJson.version).toBe('0.1.0')

    const config = await fetch(`${context.base}/api/v1/config`)
    const configJson = (await config.json()) as any
    expect(configJson.ok).toBe(true)
    expect(configJson.config.modes).toHaveLength(5)
    expect(configJson.config.questions.candyAnswer).toBe(21)
  })

  it('runs a quick test in the background and masks secrets', async () => {
    context.mock.reset()
    const created = await postTest(context.base, {
      address: context.mock.url,
      key: KEY,
      apiType: 'responses',
      model: 'mock-pass',
      effort: 'low',
      testMode: 'quick',
    })
    expect(created.status).toBe(202)
    expect(created.json.ok).toBe(true)
    const id = created.json.test.id as string
    expect(created.json.test.keyMasked).not.toContain(KEY)

    const test = await waitForTerminal(context.base, id)
    expect(test.status).toBe('completed')
    expect(test.verdict).toBe('pass')
    expect(test.answer).toContain('21')
    expect(test.probes).toHaveLength(1)
    expect(test.keyMasked).toBe(maskKey(KEY))
    expect(JSON.stringify(test)).not.toContain(KEY)
    expect(JSON.stringify(test)).not.toContain(context.mock.url)

    const list = await fetch(`${context.base}/api/v1/tests?page=1`)
    const listJson = (await list.json()) as any
    expect(listJson.ok).toBe(true)
    expect(listJson.records.some((record: any) => record.id === id)).toBe(true)
  })

  it('sends strictly the image for strict mode', async () => {
    context.mock.reset()
    const created = await postTest(context.base, {
      address: context.mock.url,
      key: KEY,
      apiType: 'responses',
      model: 'mock-pass',
      effort: 'low',
      testMode: 'strict',
    })
    expect(created.status).toBe(202)
    const test = await waitForTerminal(context.base, created.json.test.id)
    expect(test.status).toBe('completed')
    expect(test.verdict).toBe('pass')
    const request = context.mock.requests.find((item) => item.path === '/v1/responses')
    expect(request).toBeTruthy()
    const serialized = JSON.stringify(request?.body)
    expect(serialized).toContain('input_image')
    expect(serialized).not.toContain('input_text')
    expect(serialized).not.toContain('袋子里有三种口味')
  })

  it('runs dual probes concurrently and applies the strict verdict', async () => {
    context.mock.reset()
    const created = await postTest(context.base, {
      address: context.mock.url,
      key: KEY,
      apiType: 'responses',
      model: 'mock-pass',
      effort: 'low',
      testMode: 'dual',
    })
    const test = await waitForTerminal(context.base, created.json.test.id)
    expect(test.status).toBe('completed')
    expect(test.verdict).toBe('pass')
    expect(test.probes).toHaveLength(2)
    expect(test.comparison).toHaveLength(2)
    expect(test.comparison.every((item: any) => item.status === 'completed')).toBe(true)
  })

  it('records a wrong answer as a completed fail', async () => {
    const created = await postTest(context.base, {
      address: context.mock.url,
      key: KEY,
      apiType: 'responses',
      model: 'mock-fail',
      effort: 'low',
      testMode: 'quick',
    })
    const test = await waitForTerminal(context.base, created.json.test.id)
    expect(test.status).toBe('completed')
    expect(test.verdict).toBe('fail')
    expect(test.verdictReason).toContain('没有出现')
  })

  it('supports Chat Completions as well as Responses', async () => {
    context.mock.reset()
    const created = await postTest(context.base, {
      address: context.mock.url,
      key: KEY,
      apiType: 'chat_completions',
      model: 'mock-pass',
      effort: 'medium',
      testMode: 'quick',
    })
    expect(created.status).toBe(202)
    const test = await waitForTerminal(context.base, created.json.test.id)
    expect(test.status).toBe('completed')
    expect(test.verdict).toBe('pass')
    expect(context.mock.requests[0].path).toBe('/v1/chat/completions')
    expect(String(context.mock.requests[0].body.reasoning_effort)).toBe('medium')
  })

  it('records an upstream authorization failure without inventing a verdict', async () => {
    const created = await postTest(context.base, {
      address: context.mock.url,
      key: KEY,
      apiType: 'responses',
      model: 'mock-error-401',
      effort: 'low',
      testMode: 'quick',
    })
    const test = await waitForTerminal(context.base, created.json.test.id)
    expect(test.status).toBe('failed')
    expect(test.verdict).toBeNull()
    expect(test.error).toContain('HTTP 401')
  })

  it('validates malformed input', async () => {
    const response = await fetch(`${context.base}/api/v1/tests`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: '', key: '', apiType: 'responses' }),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as any
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.fields).toBeTruthy()
  })

  it('serves an SSE snapshot for a running test', async () => {
    const created = await postTest(context.base, {
      address: context.mock.url,
      key: KEY,
      apiType: 'responses',
      model: 'mock-slow',
      effort: 'low',
      testMode: 'quick',
    })
    const id = created.json.test.id as string
    const controller = new AbortController()
    const response = await fetch(`${context.base}/api/v1/tests/${id}/events`, {
      signal: controller.signal,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')
    const reader = response.body?.getReader()
    expect(reader).toBeTruthy()
    const chunk = await Promise.race([
      reader!.read(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('SSE timeout')), 3000)),
    ])
    const text = new TextDecoder().decode(chunk.value)
    expect(text).toContain('data:')
    expect(text).toContain(id)
    controller.abort()
    await reader!.cancel().catch(() => {})
    await waitForTerminal(context.base, id)
  })

  it('computes a ModelTrace fingerprint for advanced mode', async () => {
    const created = await postTest(context.base, {
      address: context.mock.url,
      key: KEY,
      apiType: 'responses',
      model: 'mock-advanced',
      effort: 'low',
      testMode: 'advanced',
    })
    const test = await waitForTerminal(context.base, created.json.test.id, 20_000)
    expect(test.status).toBe('completed')
    expect(test.fingerprint).toBeTruthy()
    expect(test.fingerprint.used_outputs).toBe(3)
    expect(test.fingerprint.results.length).toBeGreaterThan(5)
    expect(test.probes).toHaveLength(3)
    expect(test.probes.every((probe: any) => probe.status === 'completed')).toBe(true)
  })

  it('enforces the per-IP creation rate limit', async () => {
    const limited = await createTestContext({ CREATE_PER_IP_PER_HOUR: '1' })
    try {
      const first = await postTest(limited.base, {
        address: limited.mock.url,
        key: KEY,
        apiType: 'responses',
        model: 'mock-pass',
        effort: 'low',
        testMode: 'quick',
      })
      expect(first.status).toBe(202)
      const second = await postTest(limited.base, {
        address: limited.mock.url,
        key: KEY,
        apiType: 'responses',
        model: 'mock-pass',
        effort: 'low',
        testMode: 'quick',
      })
      expect(second.status).toBe(429)
      expect(second.json.ok).toBe(false)
      expect(second.json.error.code).toBe('RATE_LIMITED')
    } finally {
      await limited.close()
    }
  })

  it('times out a hanging upstream', async () => {
    const short = await createTestContext({ TEST_TIMEOUT_MS: '350', CREATE_PER_IP_PER_HOUR: '100' })
    try {
      const created = await postTest(short.base, {
        address: short.mock.url,
        key: KEY,
        apiType: 'responses',
        model: 'mock-timeout',
        effort: 'low',
        testMode: 'quick',
      })
      const test = await waitForTerminal(short.base, created.json.test.id, 10_000)
      expect(test.status).toBe('failed')
      expect(test.error).toContain('超时')
    } finally {
      await short.close()
    }
  })

  it('protects admin endpoints with a hashed bearer token', async () => {
    const token = 'admin-test-token-1234567890'
    const admin = await createTestContext({
      ADMIN_TOKEN_HASH: createHash('sha256').update(token).digest('hex'),
    })
    try {
      const unauthorized = await fetch(`${admin.base}/api/v1/admin/stats`)
      expect(unauthorized.status).toBe(401)
      const authorized = await fetch(`${admin.base}/api/v1/admin/stats`, {
        headers: { authorization: `Bearer ${token}` },
      })
      expect(authorized.status).toBe(200)
      const body = (await authorized.json()) as any
      expect(body.ok).toBe(true)
      expect(body.stats.totalTests).toBeGreaterThanOrEqual(0)
    } finally {
      await admin.close()
    }
  })
})