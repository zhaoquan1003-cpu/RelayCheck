import { loadEnvFile } from 'node:process'
import { createApp } from './app'
import { loadConfig } from './config'

try {
  loadEnvFile('.env')
} catch {
  // .env is optional; docker-compose and the shell can provide env vars.
}

const config = loadConfig()
const { app, runner } = await createApp(config)
runner.startMaintenance()

const close = async (signal: string) => {
  app.log.info({ signal }, 'shutting down')
  try {
    await app.close()
  } finally {
    process.exit(0)
  }
}

process.once('SIGINT', () => void close('SIGINT'))
process.once('SIGTERM', () => void close('SIGTERM'))

try {
  await app.listen({ host: config.HOST, port: config.PORT })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}