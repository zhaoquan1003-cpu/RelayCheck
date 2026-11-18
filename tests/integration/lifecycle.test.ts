import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { Agent as HttpAgent, get as httpGet } from 'node:http'
import type { Socket } from 'node:net'
import { describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../../src/server/db/database'
import { TestRepository } from '../../src/server/db/repository'
import type { CreateTestInput } from '../../src/shared/types'
import { createTestContext, waitForTerminal, type TestContext } from '../test-helpers'

const key = 'lifecycle-test-key-1234567890'

function input(context: TestContext, overrides: Partial<CreateTestInput> = {}): CreateTestInput {
  return {
    address: context.mock.url, key, apiType: 'responses', model: 'mock-timeout',
    effort: 'low', testMode: 'quick', ...overrides,
  }
}

async function submit(context: TestContext, overrides: Partial<CreateTestInput> = {}, headers: Record<string, string> = {}) {
  const response = await fetch(`${context.base}/api/v1/tests`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(input(context, overrides)),
  })
  return { status: response.status, body: await response.json() as any }
}

async function within<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('operation did not finish promptly')), milliseconds) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

describe('admission and shutdown regressions', () => {
  it('reserves per-IP capacity across concurrent submissions and queued jobs', async () => {
    const context = await createTestContext({ ACTIVE_PER_IP: '2', MAX_ACTIVE_JOBS: '1', MAX_QUEUE: '10' })
    try {
      const responses = await Promise.all(Array.from({ length: 12 }, () => submit(context)))
      expect(responses.filter((response) => response.status === 202)).toHaveLength(2)
      expect(responses.filter((response) => response.status === 429)).toHaveLength(10)
      const records = context.repository.list(1, 30).records
      expect(records.map((record) => record.status).sort()).toEqual(['queued', 'running'])
    } finally { await context.close() }
  })

  it('reserves global capacity before asynchronous target validation completes', async () => {
    const context = await createTestContext({ ACTIVE_PER_IP: '50', MAX_ACTIVE_JOBS: '1', MAX_QUEUE: '2' })
    try {
      const responses = await Promise.all(Array.from({ length: 15 }, () => submit(context)))
      expect(responses.filter((response) => response.status === 202)).toHaveLength(3)
      expect(responses.filter((response) => response.status === 429)).toHaveLength(12)
      expect(context.repository.list(1, 30).total).toBe(3)
    } finally { await context.close() }
  })

  it('releases admission reservations after invalid targets', async () => {
    const context = await createTestContext({ ACTIVE_PER_IP: '1', MAX_ACTIVE_JOBS: '1', MAX_QUEUE: '1' })
    try {
      expect((await submit(context, { address: 'https://user:password@example.com' })).status).toBe(400)
      const accepted = await submit(context, { model: 'mock-pass' })
      expect(accepted.status).toBe(202)
      await waitForTerminal(context.base, accepted.body.test.id)
      expect((await submit(context)).status).toBe(202)
    } finally { await context.close() }
  })

  it('cancels active probes, semaphore waiters, queued jobs and SSE before closing SQLite', async () => {
    const context = await createTestContext({
      MAX_ACTIVE_JOBS: '2', MAX_QUEUE: '2', UPSTREAM_MAX_CONCURRENCY: '1', TEST_TIMEOUT_MS: '60000',
    })
    const streamAbort = new AbortController()
    try {
      const first = await submit(context, { testMode: 'dual' })
      const second = await submit(context, { testMode: 'dual' })
      const third = await submit(context)
      expect([first.status, second.status, third.status]).toEqual([202, 202, 202])
      const ids = [first, second, third].map((response) => response.body.test.id as string)
      expect(context.repository.getSummary(ids[2])?.status).toBe('queued')
      const stream = await fetch(`${context.base}/api/v1/tests/${ids[0]}/events`, { signal: streamAbort.signal })
      expect(stream.status).toBe(200)
      expect(stream.headers.get('x-content-type-options')).toBe('nosniff')
      const drained = stream.text().catch(() => '')
      await within(context.app.close(), 3000)
      await within(drained, 1000)

      const repository = new TestRepository(openDatabase(join(context.dataDir, 'relay-check.db')))
      try {
        for (const id of ids) {
          const test = repository.getDetail(id)!
          expect(test.status).toBe('failed')
          expect(test.verdict).toBeNull()
          expect(test.error).toContain('服务关闭')
          expect(test.progress.stage).toBe('failed')
          expect(test.finishedAt).not.toBeNull()
          expect(test.probes.every((probe) => probe.status === 'failed' && probe.finishedAt !== null)).toBe(true)
          expect(JSON.stringify(test)).not.toContain(key)
        }
      } finally { repository.close() }
      // Only the single granted probe may have reached the mock upstream.
      expect(context.mock.requests.length).toBeLessThanOrEqual(1)
    } finally {
      streamAbort.abort()
      await context.close()
    }
  })

  it('reports configured timeouts rather than a hardcoded 300 seconds', async () => {
    const context = await createTestContext({ TEST_TIMEOUT_MS: '150', UPSTREAM_MAX_CONCURRENCY: '1' })
    try {
      const response = await submit(context, { testMode: 'dual' })
      const test = await waitForTerminal(context.base, response.body.test.id)
      expect(test.status).toBe('failed')
      expect(test.error).toContain('0.15 秒')
      expect(test.probes.every((probe: any) => probe.status === 'failed')).toBe(true)
    } finally { await context.close() }
  })

  it('still cancels active requests and SSE when saving a queued cancellation fails', async () => {
    const context = await createTestContext({ MAX_ACTIVE_JOBS: '1', TEST_TIMEOUT_MS: '5000' })
    const abort = new AbortController()
    let writeFailure: ReturnType<typeof vi.spyOn> | undefined
    try {
      const active = await submit(context)
      expect((await submit(context)).status).toBe(202)
      await expect.poll(() => context.mock.requests.length).toBe(1)
      const stream = await fetch(`${context.base}/api/v1/tests/${active.body.test.id}/events`, { signal: abort.signal })
      const drained = stream.text().catch(() => '')
      writeFailure = vi.spyOn(context.repository, 'failUnfinishedProbes').mockImplementationOnce(() => {
        throw new Error('simulated SQLITE_FULL while recording queued cancellation')
      })
      await within(context.app.close(), 1000)
      await within(drained, 1000)
    } finally {
      abort.abort()
      writeFailure?.mockRestore()
      await context.close()
    }
  })
})

describe('public and administration boundary regressions', () => {
  it('does not let direct clients reset their creation limit with X-Forwarded-For', async () => {
    const context = await createTestContext({ CREATE_PER_IP_PER_HOUR: '1' })
    try {
      expect((await submit(context, {}, { 'x-forwarded-for': '198.51.100.1' })).status).toBe(202)
      const second = await submit(context, {}, { 'x-forwarded-for': '198.51.100.2' })
      expect(second.status).toBe(429)
      expect(second.body.error.code).toBe('RATE_LIMITED')
    } finally { await context.close() }
  })

  it('trusts only the configured proxy hop, ignoring prepended spoofed addresses', async () => {
    const context = await createTestContext({ CREATE_PER_IP_PER_HOUR: '1', TRUST_PROXY: '1' })
    try {
      expect((await submit(context, {}, { 'x-forwarded-for': '198.51.100.1, 203.0.113.20' })).status).toBe(202)
      expect((await submit(context, {}, { 'x-forwarded-for': '198.51.100.2, 203.0.113.20' })).status).toBe(429)
      expect((await submit(context, {}, { 'x-forwarded-for': '198.51.100.2, 203.0.113.21' })).status).toBe(202)
    } finally { await context.close() }
  })

  it('returns a generic malformed-JSON error without reflecting submitted credentials', async () => {
    const context = await createTestContext()
    try {
      const response = await fetch(`${context.base}/api/v1/tests`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: `{"key":"${key}" oops}`,
      })
      expect(response.status).toBe(400)
      const text = await response.text()
      expect(text).not.toContain(key)
      expect(JSON.parse(text).error.message).toBe('请求格式无效')
      expect(context.repository.list(1, 30).total).toBe(0)
    } finally { await context.close() }
  })

  it('keeps shareable summaries available when the public index is disabled', async () => {
    const context = await createTestContext({ PUBLIC_LIST_ENABLED: 'false' })
    try {
      const response = await submit(context, { model: 'mock-pass' })
      const id = response.body.test.id as string
      await waitForTerminal(context.base, id)
      const config = await (await fetch(`${context.base}/api/v1/config`)).json() as any
      expect(config.config.publicListEnabled).toBe(false)
      expect((await fetch(`${context.base}/api/v1/tests`)).status).toBe(403)
      const summaries = await fetch(`${context.base}/api/v1/tests/summaries?ids=${id},0000000000000000,${id}`)
      expect(summaries.status).toBe(200)
      const body = await summaries.json() as any
      expect(body.records).toHaveLength(1)
      expect(body.records[0].id).toBe(id)
      expect(body.records[0]).not.toHaveProperty('answer')
      expect(body.records[0]).not.toHaveProperty('question')
      expect(body.records[0]).not.toHaveProperty('probes')
      expect(body.missingIds).toEqual(['0000000000000000'])
      expect(summaries.headers.get('cache-control')).toBe('no-store')
      expect((await fetch(`${context.base}/api/v1/tests/summaries?ids=invalid`)).status).toBe(400)
      const tooMany = Array.from({ length: 31 }, (_, index) => index.toString(16).padStart(16, '0')).join(',')
      expect((await fetch(`${context.base}/api/v1/tests/summaries?ids=${tooMany}`)).status).toBe(400)
    } finally { await context.close() }
  })

  it('prevents deleting queued or running work but allows completed records to be deleted', async () => {
    const token = 'lifecycle-admin-token'
    const context = await createTestContext({
      ADMIN_TOKEN_HASH: createHash('sha256').update(token).digest('hex'),
      MAX_ACTIVE_JOBS: '1', TEST_TIMEOUT_MS: '250',
    })
    const headers = { authorization: `Bearer ${token}` }
    try {
      const first = await submit(context)
      const second = await submit(context, { model: 'mock-pass' })
      for (const response of [first, second]) {
        const deleted = await fetch(`${context.base}/api/v1/admin/tests/${response.body.test.id}`, { method: 'DELETE', headers })
        expect(deleted.status).toBe(409)
        expect((await deleted.json() as any).error.code).toBe('TEST_ACTIVE')
      }
      const completed = await waitForTerminal(context.base, second.body.test.id)
      expect(completed.status).toBe('completed')
      expect((await fetch(`${context.base}/api/v1/admin/tests/${second.body.test.id}`, { method: 'DELETE', headers })).status).toBe(200)
      expect((await fetch(`${context.base}/api/v1/tests/${second.body.test.id}`)).status).toBe(404)
    } finally { await context.close() }
  })

  it('bounds live SSE connections across IPs and releases capacity when clients disconnect', async () => {
    const context = await createTestContext({ TRUST_PROXY: '1', SSE_MAX_PER_IP: '1', SSE_MAX_CONNECTIONS: '2' })
    const aborts = [new AbortController(), new AbortController(), new AbortController()]
    try {
      const created = await submit(context)
      const url = `${context.base}/api/v1/tests/${created.body.test.id}/events`
      const first = await fetch(url, { signal: aborts[0].signal, headers: { 'x-forwarded-for': '203.0.113.1' } })
      expect(first.status).toBe(200)
      expect((await fetch(url, { headers: { 'x-forwarded-for': '203.0.113.1' } })).status).toBe(429)
      const second = await fetch(url, { signal: aborts[1].signal, headers: { 'x-forwarded-for': '203.0.113.2' } })
      expect(second.status).toBe(200)
      expect((await fetch(url, { headers: { 'x-forwarded-for': '203.0.113.3' } })).status).toBe(429)
      await first.body!.cancel()
      await expect.poll(async () => (await (await fetch(`${context.base}/api/v1/health`)).json() as any).sseListeners).toBe(1)
      const third = await fetch(url, { signal: aborts[2].signal, headers: { 'x-forwarded-for': '203.0.113.3' } })
      expect(third.status).toBe(200)
      await Promise.all([second.body!.cancel(), third.body!.cancel()])
    } finally {
      for (const controller of aborts) controller.abort()
      await context.close()
    }
  })

  it('does not accumulate socket timeout handlers across terminal SSE requests', async () => {
    const context = await createTestContext()
    const agent = new HttpAgent({ keepAlive: true, maxSockets: 1 })
    let socket: Socket | undefined
    let initialListeners = 0
    try {
      const created = await submit(context, { model: 'mock-pass' })
      await waitForTerminal(context.base, created.body.test.id)
      context.app.server.once('connection', (connected) => {
        socket = connected
        initialListeners = connected.listenerCount('timeout')
      })
      for (let index = 0; index < 12; index += 1) {
        await new Promise<void>((resolve, reject) => {
          httpGet(`${context.base}/api/v1/tests/${created.body.test.id}/events`, { agent }, (response) => {
            response.resume()
            response.once('end', resolve)
            response.once('error', reject)
          }).once('error', reject)
        })
      }
      expect(socket).toBeDefined()
      expect(socket!.listenerCount('timeout')).toBe(initialListeners)
    } finally {
      agent.destroy()
      await context.close()
    }
  })
})
