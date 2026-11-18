import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance } from 'fastify'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import { ZodError } from 'zod'
import type { AppConfig } from './config'
import { loadModelTiers } from './config'
import { openDatabase, databasePath } from './db/database'
import { TestRepository } from './db/repository'
import { HttpError } from './errors'
import { createUpstreamDispatcher, UpstreamSecurityError } from './upstream/security'
import { ActiveLimitError, QueueCapacityError, TestJobRunner } from './services/job-runner'
import { TestEventHub } from './services/sse-hub'
import { SseConnectionLimiter } from './services/rate-limit'
import { sanitizeError } from './services/mask'
import { registerPublicRoutes } from './routes/public'
import { registerAdminRoutes } from './routes/admin'
import { registerHealthRoute } from './routes/health'

export interface AppBundle {
  app: FastifyInstance
  repository: TestRepository
  runner: TestJobRunner
  hub: TestEventHub
  dispatcher: ReturnType<typeof createUpstreamDispatcher>
}

function staticHeaders(path: string): Record<string, string> {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.endsWith('/index.html') || normalized.endsWith('/')) {
    return { 'Cache-Control': 'no-cache, must-revalidate' }
  }
  if (/\/(assets|questions)\//.test(normalized)) {
    return { 'Cache-Control': 'public, max-age=31536000, immutable' }
  }
  return { 'Cache-Control': 'no-cache, must-revalidate' }
}

export async function createApp(config: AppConfig): Promise<AppBundle> {
  const clientDir = resolve(process.cwd(), 'dist', 'client')
  if (config.isProduction && !existsSync(resolve(clientDir, 'index.html'))) {
    throw new Error('缺少前端构建产物，请先运行 pnpm build')
  }
  const tiers = loadModelTiers(config.modelTiersFile)
  const db = openDatabase(databasePath(config.dataDir))
  const repository = new TestRepository(db)
  const dispatcher = createUpstreamDispatcher(config)
  const hub = new TestEventHub()
  const sseLimiter = new SseConnectionLimiter(config.SSE_MAX_PER_IP, config.SSE_MAX_CONNECTIONS)

  const app = Fastify({
    logger: {
      level: config.isProduction ? 'info' : 'warn',
      serializers: {
        req: (request) => ({ method: request.method, url: request.url?.split('?')[0], remoteAddress: request.ip }),
      },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        censor: '[redacted]',
      },
    },
    trustProxy: config.TRUST_PROXY === false ? false : (_address, hop) => hop < Number(config.TRUST_PROXY),
    bodyLimit: 32 * 1024,
    requestTimeout: 30_000,
    connectionTimeout: 30_000,
    genReqId: () => randomUUID(),
  })

  const runner = new TestJobRunner(config, repository, hub, dispatcher, tiers, app.log)

  app.addHook('preClose', async () => {
    try { await runner.shutdown() }
    finally { hub.closeAll() }
  })
  app.addHook('onClose', async () => {
    try { await dispatcher.destroy() }
    finally { if (db.isOpen) repository.close() }
  })

  try {
    repository.markInterrupted()
    repository.cleanup(config.RETENTION_DAYS, config.MAX_RECORDS)
    await app.register(helmet, {
      global: true,
      hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: false } : false,
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: null,
        },
      },
      crossOriginEmbedderPolicy: false,
    })

    await app.register(rateLimit, {
      global: false,
      errorResponseBuilder: (request, context) => {
        const remainingSeconds = Math.max(1, Math.ceil(Number(context.ttl || 0) / 1000))
        const waitText =
          remainingSeconds >= 120
            ? `${Math.ceil(remainingSeconds / 60)} 分钟`
            : `${remainingSeconds} 秒`
        const path = request.url.split('?')[0]
        const scope =
          request.method === 'POST' && path === '/api/v1/tests'
            ? `创建检测每 IP 每小时最多 ${config.CREATE_PER_IP_PER_HOUR} 次`
            : path.startsWith('/api/v1/tests')
              ? `列表请求每 IP 每分钟最多 ${config.LIST_PER_MINUTE} 次`
              : `每 IP 最多 ${Number(context.max) || 0} 次`
        const error = new Error(`请求过于频繁：${scope}，约 ${waitText}后可重试。`) as Error & {
          statusCode: number
          code: string
        }
        error.statusCode = context.statusCode
        error.code = 'RATE_LIMITED'
        return error
      },
    })

    app.addHook('onSend', async (request, reply, payload) => {
      if (request.url.startsWith('/api/')) {
        reply.header('Cache-Control', 'no-store')
      }
      return payload
    })

    app.setErrorHandler((error, request, reply) => {
      if (error instanceof HttpError) {
        return reply.code(error.statusCode).send({
          ok: false,
          error: { code: error.code, message: error.message, fields: error.fields },
        })
      }
      if (error instanceof UpstreamSecurityError) {
        return reply.code(400).send({
          ok: false,
          error: { code: error.code, message: error.message },
        })
      }
      if (error instanceof QueueCapacityError || error instanceof ActiveLimitError) {
        return reply.code(429).send({
          ok: false,
          error: { code: 'QUEUE_LIMIT', message: error.message },
        })
      }
      if (error instanceof ZodError) {
        return reply.code(400).send({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: '请求参数无效' },
        })
      }
      const fastifyError = error as { statusCode?: number; code?: string; message?: string }
      if (fastifyError.statusCode === 400) {
        // JSON parser diagnostics can contain fragments of the submitted API key.
        return reply.code(400).send({ ok: false, error: { code: 'BAD_REQUEST', message: '请求格式无效' } })
      }
      if (fastifyError.statusCode === 413) {
        return reply.code(413).send({ ok: false, error: { code: 'BODY_TOO_LARGE', message: '请求体过大' } })
      }
      const statusCode = Number(fastifyError.statusCode) >= 400 ? Number(fastifyError.statusCode) : 500
      if (statusCode >= 500) {
        request.log.error({ requestId: request.id, message: sanitizeError(error) }, 'request failed')
      }
      return reply.code(statusCode).send({
        ok: false,
        error: {
          code: statusCode === 500 ? 'INTERNAL_ERROR' : String(fastifyError.code || 'HTTP_ERROR'),
          message: statusCode === 500 ? '服务器内部错误' : fastifyError.message,
        },
      })
    })

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) {
        return reply.code(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'not found' } })
      }
      if (request.method === 'GET' && !/\.[^/]+$/.test(request.url.split('?')[0]) && existsSync(resolve(clientDir, 'index.html'))) {
        reply.header('Cache-Control', 'no-cache, must-revalidate')
        return reply.sendFile('index.html')
      }
      return reply.code(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'not found' } })
    })

    registerHealthRoute(app, { repository, runner, hub })
    registerPublicRoutes(app, { config, repository, runner, hub, sseLimiter })
    registerAdminRoutes(app, { config, repository, runner, hub })

    if (existsSync(clientDir)) {
      await app.register(fastifyStatic, {
        root: clientDir,
        prefix: '/',
        cacheControl: false,
        setHeaders: (response, path) => {
          for (const [key, value] of Object.entries(staticHeaders(path))) response.header(key, value)
        },
      })
    }

    return { app, repository, runner, hub, dispatcher }
  } catch (error) {
    await app.close().catch(() => {})
    await dispatcher.destroy().catch(() => {})
    if (db.isOpen) repository.close()
    throw error
  }
}
