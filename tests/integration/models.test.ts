import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildModelsUrl } from '../../src/server/upstream/models'
import { createTestContext, type TestContext } from '../test-helpers'

const KEY = 'model-list-test-key-12345'

describe('model discovery', () => {
  let context: TestContext
  let upstream: FastifyInstance
  let upstreamUrl: string
  const requests: Array<{ url: string; authorization?: string }> = []
  const cancelledRequests: string[] = []

  beforeAll(async () => {
    context = await createTestContext()
    upstream = Fastify({ logger: false })
    upstream.get('/*', async (request, reply) => {
      requests.push({ url: request.url, authorization: request.headers.authorization })
      if (request.url.startsWith('/unauthorized/')) return reply.code(401).send({ error: { message: KEY } })
      if (request.url.startsWith('/redirect/')) return reply.redirect(`${upstreamUrl}/v1/models`)
      if (request.url.startsWith('/empty/')) return { data: [] }
      if (request.url.startsWith('/invalid/')) return { error: { message: KEY } }
      if (request.url.startsWith('/html/')) return reply.type('text/html').send(`<html>${KEY}</html>`)
      if (request.url.startsWith('/large/')) return { data: [], padding: 'x'.repeat(1024 * 1024) }
      if (request.url.startsWith('/timeout/')) {
        reply.hijack()
        await new Promise<void>((resolve) => reply.raw.once('close', resolve))
        return
      }
      if (request.url.startsWith('/cancel/')) {
        reply.hijack()
        await new Promise<void>((resolve) => reply.raw.once('close', () => {
          cancelledRequests.push(request.url)
          resolve()
        }))
        return
      }
      return {
        object: 'list',
        data: [{ id: 'gpt-6-astra' }, { id: 'custom-model' }, { id: 'custom-model' }, null, {}, { id: '' }, { id: 'x'.repeat(201) }],
      }
    })
    await upstream.listen({ host: '127.0.0.1', port: 0 })
    const address = upstream.server.address()
    upstreamUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })

  afterAll(async () => {
    await context.close()
    await upstream.close()
  })

  async function discover(address: string, base = context.base, key = KEY) {
    const response = await fetch(`${base}/api/v1/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address, key }),
    })
    return { status: response.status, headers: response.headers, body: await response.json() as any }
  }

  it.each(['', '/v1', '/v1/', '/v1/responses', '/v1/chat/completions', '/v1/models'])('fetches a deduplicated list from address suffix %s', async (suffix) => {
    const result = await discover(`${upstreamUrl}${suffix}`)
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true, models: [{ id: 'gpt-6-astra' }, { id: 'custom-model' }] })
    expect(result.headers.get('cache-control')).toBe('no-store')
    expect(requests.at(-1)).toEqual({ url: '/v1/models', authorization: `Bearer ${KEY}` })
  })

  it('preserves a reverse proxy prefix', async () => {
    const result = await discover(`${upstreamUrl}/proxy/v1/chat/completions`)
    expect(result.status).toBe(200)
    expect(requests.at(-1)?.url).toBe('/proxy/v1/models')
    expect(buildModelsUrl('https://relay.example.com/proxy')).toBe('https://relay.example.com/proxy/v1/models')
  })

  it('returns an empty list without creating a test record', async () => {
    const result = await discover(`${upstreamUrl}/empty`)
    expect(result.body).toEqual({ ok: true, models: [] })
    expect(context.repository.list(1, 10).total).toBe(0)
  })

  it.each([
    ['unauthorized', 'UPSTREAM_MODELS_FAILED'],
    ['invalid', 'INVALID_MODEL_LIST'],
    ['html', 'INVALID_MODEL_LIST'],
    ['large', 'MODEL_LIST_TOO_LARGE'],
  ])('handles %s upstream responses without exposing secrets', async (prefix, code) => {
    const result = await discover(`${upstreamUrl}/${prefix}`)
    expect(result.status).toBe(502)
    expect(result.body.error.code).toBe(code)
    expect(JSON.stringify(result.body)).not.toContain(KEY)
  })

  it('does not follow redirects', async () => {
    const before = requests.length
    const result = await discover(`${upstreamUrl}/redirect`)
    expect(result.status).toBe(502)
    expect(requests.length).toBe(before + 1)
  })

  it('rejects missing credentials and control characters before fetching', async () => {
    const before = requests.length
    for (const key of ['', 'bad\r\nkey']) {
      const result = await discover(upstreamUrl, context.base, key)
      expect(result.status).toBe(400)
      expect(result.body.error.code).toBe('VALIDATION_ERROR')
      expect(result.body.error.fields.key).toBeTruthy()
    }
    expect(requests.length).toBe(before)
  })

  it('applies the existing private-address protection', async () => {
    const restricted = await createTestContext({ ALLOW_PRIVATE_UPSTREAMS: 'false' })
    try {
      const result = await discover('http://127.0.0.1', restricted.base)
      expect(result.status).toBe(400)
      expect(result.body.error.code).toBe('UPSTREAM_URL_REJECTED')
    } finally {
      await restricted.close()
    }
  })

  it('rate limits discovery independently of test creation', async () => {
    const limited = await createTestContext({ LIST_PER_MINUTE: '1' })
    try {
      expect((await discover(upstreamUrl, limited.base)).status).toBe(200)
      const result = await discover(upstreamUrl, limited.base)
      expect(result.status).toBe(429)
      expect(result.body.error.code).toBe('RATE_LIMITED')
    } finally {
      await limited.close()
    }
  })

  it('times out a hanging model list', async () => {
    const result = await discover(`${upstreamUrl}/timeout`)
    expect(result.status).toBe(504)
    expect(result.body.error.code).toBe('MODEL_LIST_TIMEOUT')
  })

  it('cancels disconnected requests and immediately frees their concurrency slots', async () => {
    const isolated = await createTestContext()
    const controllers = [new AbortController(), new AbortController()]
    const pending = controllers.map((controller, index) => fetch(`${isolated.base}/api/v1/models`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: `${upstreamUrl}/cancel/${index}`, key: KEY }),
      signal: controller.signal,
    }).catch((error: Error) => error))
    try {
      await expect.poll(() => requests.filter(({ url }) => url.startsWith('/cancel/')).length).toBe(2)
      const busy = await discover(upstreamUrl, isolated.base)
      expect(busy.status).toBe(429)
      expect(busy.body.error.code).toBe('MODEL_LIST_BUSY')

      controllers.forEach((controller) => controller.abort())
      await Promise.all(pending)
      // Observing the upstream socket close proves cancellation propagated
      // beyond the browser instead of just discarding its response.
      await expect.poll(() => cancelledRequests.length, { timeout: 2000 }).toBe(2)
      const results = await Promise.all([discover(upstreamUrl, isolated.base), discover(upstreamUrl, isolated.base)])
      for (const result of results) {
        expect(result.status).toBe(200)
        expect(result.body.models).toEqual([{ id: 'gpt-6-astra' }, { id: 'custom-model' }])
      }
    } finally {
      controllers.forEach((controller) => controller.abort())
      await Promise.all(pending)
      await isolated.close()
    }
  })
})
