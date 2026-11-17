import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../src/server/app'
import { loadConfig } from '../src/server/config'
import type { TestRepository } from '../src/server/db/repository'
import { startMockUpstream, type MockUpstream } from './mock-upstream'

export interface TestContext {
  app: FastifyInstance
  base: string
  dataDir: string
  repository: TestRepository
  mock: MockUpstream
  close: () => Promise<void>
}

export async function createTestContext(env: Record<string, string> = {}): Promise<TestContext> {
  const dataDir = mkdtempSync(join(tmpdir(), 'relaycheck-'))
  const mock = await startMockUpstream()
  const config = loadConfig({
    NODE_ENV: 'test',
    DATA_DIR: dataDir,
    ALLOW_PRIVATE_UPSTREAMS: 'true',
    CREATE_PER_IP_PER_HOUR: '100',
    ACTIVE_PER_IP: '20',
    MAX_ACTIVE_JOBS: '8',
    MAX_QUEUE: '40',
    TEST_TIMEOUT_MS: '10000',
    MODEL_TIERS_FILE: join(process.cwd(), 'config', 'model-tiers.json'),
    ...env,
  })
  const { app, repository } = await createApp(config)
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    app,
    base: `http://127.0.0.1:${port}`,
    dataDir,
    repository,
    mock,
    close: async () => {
      await app.close()
      await mock.close()
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

export async function waitForTerminal(
  base: string,
  id: string,
  timeoutMs = 15_000,
): Promise<Record<string, any>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const response = await fetch(`${base}/api/v1/tests/${id}`)
    const data = (await response.json()) as Record<string, any>
    if (data.ok && ['completed', 'failed'].includes(data.test?.status)) return data.test
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`test ${id} did not reach a terminal state`)
}