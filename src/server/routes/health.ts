import type { FastifyInstance } from 'fastify'
import type { TestRepository } from '../db/repository'
import type { TestJobRunner } from '../services/job-runner'
import type { TestEventHub } from '../services/sse-hub'

export const APP_VERSION = '0.1.0'

export function registerHealthRoute(
  app: FastifyInstance,
  deps: { repository: TestRepository; runner: TestJobRunner; hub: TestEventHub },
): void {
  app.get('/api/v1/health', async (_request, reply) => {
    try {
      deps.repository.ping()
      return {
        ok: true,
        status: 'ok',
        version: APP_VERSION,
        queue: { depth: deps.runner.queueDepth, active: deps.runner.activeCount },
        sseListeners: deps.hub.listenerCount,
        uptimeSeconds: Math.round(process.uptime()),
        timestamp: new Date().toISOString(),
      }
    } catch {
      reply.code(503)
      return { ok: false, status: 'unhealthy', version: APP_VERSION }
    }
  })
}