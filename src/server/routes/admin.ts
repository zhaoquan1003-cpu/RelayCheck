import type { FastifyInstance } from 'fastify'
import type { AppConfig } from '../config'
import type { TestRepository } from '../db/repository'
import type { TestJobRunner } from '../services/job-runner'
import type { TestEventHub } from '../services/sse-hub'
import { HttpError } from '../errors'
import { parsePage } from './public'
import { adminTokenMatches } from './admin-auth'

function requireAdmin(request: Parameters<typeof adminTokenMatches>[0], config: AppConfig): void {
  if (!config.adminTokenHash) throw new HttpError(404, 'NOT_FOUND', 'not found')
  if (!adminTokenMatches(request, config.adminTokenHash)) {
    throw new HttpError(401, 'UNAUTHORIZED', '需要管理员令牌')
  }
}

export function registerAdminRoutes(
  app: FastifyInstance,
  deps: { config: AppConfig; repository: TestRepository; runner: TestJobRunner; hub: TestEventHub },
): void {
  const { config, repository, runner, hub } = deps

  app.get('/api/v1/admin/stats', async (request) => {
    requireAdmin(request, config)
    const total = repository.list(1, 1).total
    return {
      ok: true,
      stats: {
        totalTests: total,
        queueDepth: runner.queueDepth,
        activeTests: runner.activeCount,
        sseListeners: hub.listenerCount,
      },
    }
  })

  app.get('/api/v1/admin/tests', async (request) => {
    requireAdmin(request, config)
    const page = parsePage((request.query as Record<string, unknown> | undefined)?.page)
    const result = repository.list(page, 30)
    return { ok: true, records: result.records, total: result.total, page, pageSize: 30 }
  })

  app.delete('/api/v1/admin/tests/:id', async (request) => {
    requireAdmin(request, config)
    const { id } = request.params as { id: string }
    if (!/^[a-f0-9]{16}$/.test(id)) throw new HttpError(404, 'NOT_FOUND', 'not found')
    const existing = repository.getSummary(id)
    if (!existing) throw new HttpError(404, 'NOT_FOUND', 'not found')
    repository.delete(id)
    return { ok: true }
  })
}