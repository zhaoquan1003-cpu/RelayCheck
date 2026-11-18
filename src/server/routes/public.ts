import type { FastifyInstance } from 'fastify'
import { HttpError } from '../errors'
import type { AppConfig } from '../config'
import type { TestRepository } from '../db/repository'
import type { TestJobRunner } from '../services/job-runner'
import type { TestEventHub } from '../services/sse-hub'
import type { SseConnectionLimiter } from '../services/rate-limit'
import { openSse } from '../services/sse-hub'
import { PAGE_SIZE, API_TYPE_META, DISCLAIMERS, EFFORT_META, MODEL_PRESETS, TEST_MODE_META } from '../../shared/constants'
import { QUESTION_PACK } from '../../shared/questions'
import { extractDrawingArtifact, MAX_DRAWING_BYTES } from '../../shared/drawing-art'
import { createTestSchema } from './schemas'

const ID_RE = /^[a-f0-9]{16}$/

export function parsePage(value: unknown): number {
  const page = Math.floor(Number(value ?? 1))
  return Number.isFinite(page) && page > 0 ? Math.min(page, 1_000_000) : 1
}

export function registerPublicRoutes(
  app: FastifyInstance,
  deps: {
    config: AppConfig
    repository: TestRepository
    runner: TestJobRunner
    hub: TestEventHub
    sseLimiter: SseConnectionLimiter
  },
): void {
  const { config, repository, runner, hub, sseLimiter } = deps

  app.get('/api/v1/config', async () => ({
    ok: true,
    config: {
      appName: config.APP_NAME,
      tagline: config.APP_TAGLINE,
      defaultTestMode: 'dual',
      defaultEffort: 'low',
      defaultApiType: 'responses',
      defaultUpstreamUrl: config.DEFAULT_UPSTREAM_URL,
      publicListEnabled: config.PUBLIC_LIST_ENABLED,
      modes: TEST_MODE_META,
      apiTypes: API_TYPE_META,
      efforts: EFFORT_META,
      models: MODEL_PRESETS,
      questions: QUESTION_PACK,
      limits: {
        testsPerHourPerIp: config.CREATE_PER_IP_PER_HOUR,
        activeTestsPerIp: config.ACTIVE_PER_IP,
        maxQueue: config.MAX_QUEUE,
        maxActiveJobs: config.MAX_ACTIVE_JOBS,
        timeoutMs: config.TEST_TIMEOUT_MS,
        maxAnswerBytes: config.MAX_ANSWER_BYTES,
        retentionDays: config.RETENTION_DAYS,
        maxRecords: config.MAX_RECORDS,
      },
      disclaimers: DISCLAIMERS,
    },
  }))

  app.get('/api/v1/tests', {
    config: {
      rateLimit: { max: config.LIST_PER_MINUTE, timeWindow: '1 minute' },
    },
  }, async (request) => {
    if (!config.PUBLIC_LIST_ENABLED) {
      throw new HttpError(403, 'LIST_DISABLED', '公开列表已关闭')
    }
    const page = parsePage((request.query as Record<string, unknown> | undefined)?.page)
    const result = repository.list(page, PAGE_SIZE)
    return { ok: true, records: result.records, total: result.total, page, pageSize: PAGE_SIZE }
  })

  app.get('/api/v1/tests/summaries', {
    config: { rateLimit: { max: config.LIST_PER_MINUTE, timeWindow: '1 minute' } },
  }, async (request) => {
    const idsValue = (request.query as Record<string, unknown>)?.ids
    if (typeof idsValue !== 'string') throw new HttpError(400, 'VALIDATION_ERROR', '请提供记录 ID')
    const ids = [...new Set(idsValue.split(',').filter(Boolean))]
    if (ids.length > PAGE_SIZE || ids.some((id) => !ID_RE.test(id))) {
      throw new HttpError(400, 'VALIDATION_ERROR', `每次最多查询 ${PAGE_SIZE} 个有效 ID`)
    }
    const records = ids.map((id) => repository.getSummary(id)).filter((record) => record !== null)
    return { ok: true, records, missingIds: ids.filter((id) => !records.some((record) => record.id === id)) }
  })

  app.get('/api/v1/tests/:id', {
    config: { rateLimit: { max: config.LIST_PER_MINUTE, timeWindow: '1 minute' } },
  }, async (request) => {
    const { id } = request.params as { id: string }
    if (!ID_RE.test(id)) throw new HttpError(404, 'NOT_FOUND', 'not found')
    const test = repository.getDetail(id)
    if (!test) throw new HttpError(404, 'NOT_FOUND', 'not found')
    return { ok: true, test }
  })

  app.get('/api/v1/tests/:id/preview', {
    config: { rateLimit: { max: config.LIST_PER_MINUTE, timeWindow: '1 minute' } },
    // Replace the main page's policy only for the isolated generated document.
    // The HTTP sandbox also applies when this URL is opened outside an iframe.
    helmet: {
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          sandbox: ['allow-scripts'],
          defaultSrc: ["'none'"],
          scriptSrc: ["'unsafe-inline'"],
          styleSrc: ["'unsafe-inline'"],
          imgSrc: ['data:'],
          fontSrc: ['data:'],
          connectSrc: ["'none'"],
          objectSrc: ["'none'"],
          frameSrc: ["'none'"],
          workerSrc: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
          frameAncestors: ["'self'"],
        },
      },
      xFrameOptions: { action: 'sameorigin' },
      referrerPolicy: { policy: 'no-referrer' },
    },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!ID_RE.test(id)) throw new HttpError(404, 'NOT_FOUND', 'not found')
    const test = repository.getDetail(id)
    if (!test || test.testMode !== 'pelican') throw new HttpError(404, 'NOT_FOUND', 'not found')
    if (test.status !== 'completed') {
      throw new HttpError(409, 'PREVIEW_NOT_READY', '画图检测尚未成功完成，暂不能预览。')
    }
    const artifact = extractDrawingArtifact(test.answer)
    if (artifact.kind !== 'html' || !artifact.source) {
      const message = artifact.error === 'too_large'
        ? `预览产物超过 ${MAX_DRAWING_BYTES / 1024} KiB，请查看原始回答。`
        : artifact.error === 'incomplete'
          ? 'HTML 产物不完整，请查看原始回答。'
          : artifact.kind === 'svg'
            ? '此记录为独立 SVG，请使用图片预览。'
            : '回答中没有可预览的 HTML，请查看原始回答。'
      throw new HttpError(422, 'PREVIEW_UNAVAILABLE', message)
    }
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(artifact.source)
  })

  app.get('/api/v1/tests/:id/events', {
    config: { rateLimit: { max: config.LIST_PER_MINUTE, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!ID_RE.test(id)) throw new HttpError(404, 'NOT_FOUND', 'not found')
    const test = repository.getDetail(id)
    if (!test) throw new HttpError(404, 'NOT_FOUND', 'not found')
    if (!sseLimiter.acquire(request.ip)) {
      throw new HttpError(429, 'SSE_LIMIT', '当前 IP 的实时连接数已达上限')
    }
    try {
      openSse(reply, test, hub, () => sseLimiter.release(request.ip))
    } catch (error) {
      sseLimiter.release(request.ip)
      throw error
    }
    return reply
  })

  app.post('/api/v1/tests', {
    config: {
      rateLimit: { max: config.CREATE_PER_IP_PER_HOUR, timeWindow: '1 hour' },
    },
  }, async (request, reply) => {
    const parsed = createTestSchema.safeParse(request.body)
    if (!parsed.success) {
      const fields: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'body'
        if (!fields[key]) fields[key] = issue.message
      }
      throw new HttpError(400, 'VALIDATION_ERROR', '请求参数无效', fields)
    }
    const test = await runner.create(parsed.data, request.ip)
    reply.code(202)
    return { ok: true, test }
  })
}
