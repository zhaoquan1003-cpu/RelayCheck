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
  const db = openDatabase(databasePath(config.dataDir))
  const repository = new TestRepository(db)
  repository.markInterrupted()
  repository.cleanup(config.RETENTION_DAYS, config.MAX_RECORDS)
  const dispatcher = createUpstreamDispatcher(config)
  const hub = new TestEventHub()
  const sseLimiter = new SseConnectionLimiter(config.SSE_MAX_PER_IP)
  const tiers = loadModelTiers(config.modelTiersFile)

  const app = Fastify({
    logger: {
      level: config.isProduction ? 'info' : 'warn',
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        censor: '[redacted]',
      },
    },
    trustProxy: config.TRUST_PROXY,
    bodyLimit: 32 * 1024,
    genReqId: () => randomUUID(),
  })

  const runner = new TestJobRunner(config, repository, hub, dispatcher, tiers, app.log)

  await app.register(helmet, {
    global: true,
    hsts: config.isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
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
      },
    },
    crossOriginEmbedderPolicy: false,
  })

  await app.register(rateLimit, {
    global: false,
    errorResponseBuilder: (_request, context) => ({
      statusCode: context.statusCode,
      ok: false,
      error: {
        code: 'RATE_LIMITED',
        message: '请求过于频繁，请稍后再试',
      },
    }),
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
    const clientDir = resolve(process.cwd(), 'dist', 'client')
    if (request.method === 'GET' && existsSync(resolve(clientDir, 'index.html'))) {
      return reply.sendFile('index.html')
    }
    return reply.code(404).send({ ok: false, error: { code: 'NOT_FOUND', message: 'not found' } })
  })

  registerHealthRoute(app, { repository, runner, hub })
  registerPublicRoutes(app, { config, repository, runner, hub, sseLimiter })
  registerAdminRoutes(app, { config, repository, runner, hub })

  const clientDir = resolve(process.cwd(), 'dist', 'client')
  if (existsSync(clientDir)) {
    await app.register(fastifyStatic, {
      root: clientDir,
      prefix: '/',
      cacheControl: false,
      setHeaders: (response, path) => {
        for (const [key, value] of Object.entries(staticHeaders(path))) response.setHeader(key, value)
      },
    })
  }

  app.addHook('onClose', async () => {
    await runner.shutdown()
    await dispatcher.close()
    repository.close()
  })

  return { app, repository, runner, hub, dispatcher }
}