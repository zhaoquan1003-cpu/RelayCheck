import type { FastifyInstance } from 'fastify'
import type { Dispatcher } from 'undici'
import type { AppConfig } from '../config'
import { HttpError } from '../errors'
import { SseConnectionLimiter } from '../services/rate-limit'
import { fetchUpstreamModels } from '../upstream/models'
import { listModelsSchema } from './schemas'

export function registerModelRoutes(app: FastifyInstance, config: AppConfig, dispatcher: Dispatcher): void {
  const limiter = new SseConnectionLimiter(2, config.UPSTREAM_MAX_CONCURRENCY)
  app.post('/api/v1/models', {
    config: { rateLimit: { max: Math.min(20, config.LIST_PER_MINUTE), timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const parsed = listModelsSchema.safeParse(request.body)
    if (!parsed.success) {
      const fields: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'body'
        if (!fields[key]) fields[key] = issue.message
      }
      throw new HttpError(400, 'VALIDATION_ERROR', '请填写有效的中转地址和 API Key', fields)
    }
    if (!limiter.acquire(request.ip)) throw new HttpError(429, 'MODEL_LIST_BUSY', '正在获取模型的请求较多，请稍后重试。')
    const controller = new AbortController()
    const onClose = () => {
      if (!reply.raw.writableEnded) controller.abort()
    }
    reply.raw.once('close', onClose)
    try {
      const models = await fetchUpstreamModels(parsed.data, config, dispatcher, controller.signal)
      return { ok: true, models }
    } finally {
      reply.raw.off('close', onClose)
      limiter.release(request.ip)
    }
  })
}
