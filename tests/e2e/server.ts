import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../../src/server/app'
import { loadConfig } from '../../src/server/config'
import { startMockUpstream } from '../mock-upstream'

const dataDir = mkdtempSync(join(tmpdir(), 'relaycheck-e2e-'))
const mock = await startMockUpstream(3199)
const config = loadConfig({
  NODE_ENV: 'test',
  PORT: '3100',
  HOST: '127.0.0.1',
  DATA_DIR: dataDir,
  DEFAULT_UPSTREAM_URL: mock.url,
  ALLOW_PRIVATE_UPSTREAMS: 'true',
  TEST_TIMEOUT_MS: '8000',
  CREATE_PER_IP_PER_HOUR: '100',
  ACTIVE_PER_IP: '20',
  MAX_ACTIVE_JOBS: '8',
  MAX_QUEUE: '40',
})
const { app } = await createApp(config)
await app.listen({ host: '127.0.0.1', port: 3100 })
console.log(`e2e app ready on http://127.0.0.1:3100 (mock ${mock.url})`)

async function shutdown() {
  await app.close()
  await mock.close()
  rmSync(dataDir, { recursive: true, force: true })
  process.exit(0)
}

process.once('SIGTERM', () => void shutdown())
process.once('SIGINT', () => void shutdown())