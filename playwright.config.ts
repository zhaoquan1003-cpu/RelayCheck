import { defineConfig } from '@playwright/test'

const isWindows = process.platform === 'win32'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3100',
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || (isWindows ? 'msedge' : undefined),
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `"${process.execPath}" node_modules/tsx/dist/cli.mjs tests/e2e/server.ts`,
    url: 'http://127.0.0.1:3100/api/v1/health',
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})