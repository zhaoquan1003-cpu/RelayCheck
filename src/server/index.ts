import { loadEnvFile } from 'node:process'
import { createApp } from './app'
import { loadConfig } from './config'

try {
  loadEnvFile('.env')
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
}

const config = loadConfig()
const { app, runner } = await createApp(config)
runner.startMaintenance()

let closing = false
const close = async (signal: string) => {
  if (closing) return
  closing = true
  app.log.info({ signal }, 'shutting down')
  const deadline = setTimeout(() => {
    app.log.error('shutdown deadline exceeded')
    process.exit(1)
  }, 15_000)
  deadline.unref()
  try {
    await app.close()
    process.exit(0)
  } catch {
    app.log.error('shutdown failed')
    process.exit(1)
  }
}

process.once('SIGINT', () => void close('SIGINT'))
process.once('SIGTERM', () => void close('SIGTERM'))

try {
  await app.listen({ host: config.HOST, port: config.PORT })
  console.log(`[relaycheck] listening on http://${config.HOST}:${config.PORT}`)
} catch (error) {
  app.log.error(error)
  await app.close().catch(() => {})
  process.exit(1)
}
