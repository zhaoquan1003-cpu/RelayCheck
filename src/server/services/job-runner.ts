import { randomBytes } from 'node:crypto'
import type { FastifyBaseLogger } from 'fastify'
import type { Agent } from 'undici'
import type {
  ApiType,
  ComparisonEntry,
  CreateTestInput,
  Effort,
  TestMode,
  TestSummary,
  Verdict,
} from '../../shared/types'
import { QUESTION_PACK } from '../../shared/questions'
import { advancedVerdict, dualVerdict, singleProbeVerdict } from '../../shared/verdict'
import type { AppConfig } from '../config'
import type { TestRepository } from '../db/repository'
import type { TestEventHub } from './sse-hub'
import { hashIp, maskKey, sanitizeError } from './mask'
import { getQuestionImageDataUrl, getQuestionImagePath } from './question-assets'
import { analyzeFingerprint, createAdvancedChallenges, type AdvancedChallenge } from '../modeltrace'
import { resolveAndValidateTarget } from '../upstream/security'
import { runUpstreamProbe } from '../upstream/client'

class Semaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(private readonly max: number) {}

  acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const grant = () => {
        this.active += 1
        let released = false
        resolve(() => {
          if (released) return
          released = true
          this.active -= 1
          const next = this.waiters.shift()
          if (next) next()
        })
      }
      if (this.active < this.max) grant()
      else this.waiters.push(grant)
    })
  }
}

interface JobProbe {
  dbId: string
  kind: 'quick' | 'strict' | 'cup' | 'advanced'
  expectedCount: number | null
  prompt: string
  imageOnly: boolean
  expectedAnswer: number | null
}

interface QueuedJob {
  id: string
  ip: string
  url: string
  apiKey: string
  apiType: ApiType
  model: string
  effort: Effort
  testMode: TestMode
  createdAt: number
  probes: JobProbe[]
  timedOut: boolean
}

export class QueueCapacityError extends Error {
  readonly statusCode = 429
  constructor(message: string) {
    super(message)
    this.name = 'QueueCapacityError'
  }
}

export class ActiveLimitError extends Error {
  readonly statusCode = 429
  constructor(message: string) {
    super(message)
    this.name = 'ActiveLimitError'
  }
}

export class TestJobRunner {
  private readonly queue: QueuedJob[] = []
  private readonly active = new Map<string, QueuedJob>()
  private readonly activeByIp = new Map<string, number>()
  private readonly semaphore: Semaphore
  private cleanupTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly config: AppConfig,
    private readonly repository: TestRepository,
    private readonly hub: TestEventHub,
    private readonly dispatcher: Agent,
    private readonly tiers: Record<string, number>,
    private readonly log: FastifyBaseLogger,
  ) {
    this.semaphore = new Semaphore(config.UPSTREAM_MAX_CONCURRENCY)
  }

  async create(input: CreateTestInput, ip: string): Promise<TestSummary> {
    if (this.queue.length >= this.config.MAX_QUEUE) {
      throw new QueueCapacityError('任务队列已满，请稍后再试')
    }
    if ((this.activeByIp.get(ip) ?? 0) >= this.config.ACTIVE_PER_IP) {
      throw new ActiveLimitError('当前 IP 的活跃测试数已达上限')
    }
    const target = await resolveAndValidateTarget(input.address, input.apiType, this.config)
    const id = randomBytes(8).toString('hex')
    const createdAt = Date.now()
    const probes = this.buildProbes(input.testMode)
    const question = this.buildQuestion(input.testMode, probes)
    const questionImage = ['strict', 'dual'].includes(input.testMode) ? getQuestionImagePath() : null
    const progress = {
      current: 0,
      completed: 0,
      total: probes.length,
      stage: 'queued' as const,
    }
    this.repository.insertTest({
      id,
      source: 'manual',
      poolId: null,
      groupName: '',
      addressMasked: target.masked,
      keyMasked: maskKey(input.key),
      model: input.model,
      effort: input.effort,
      apiType: input.apiType,
      testMode: input.testMode,
      questionVersion: QUESTION_PACK.version,
      question,
      questionImage,
      progress,
      clientIpHash: hashIp(ip),
    })
    try {
      for (const [index, probe] of probes.entries()) {
        this.repository.createProbe({
          id: probe.dbId,
          testId: id,
          ordinal: index,
          kind: probe.kind,
          expectedCount: probe.expectedCount,
          prompt: probe.prompt,
        })
      }
    } catch (error) {
      this.repository.delete(id)
      throw error
    }
    const job: QueuedJob = {
      id,
      ip,
      url: target.url,
      apiKey: input.key,
      apiType: input.apiType,
      model: input.model,
      effort: input.effort,
      testMode: input.testMode,
      createdAt,
      probes,
      timedOut: false,
    }
    this.queue.push(job)
    this.pump()
    const summary = this.repository.getSummary(id)
    if (!summary) throw new Error('创建记录失败')
    return summary
  }

  private buildProbes(testMode: TestMode): JobProbe[] {
    const make = (kind: JobProbe['kind'], prompt: string, expectedCount: number | null, expectedAnswer: number | null, imageOnly = false): JobProbe => ({
      dbId: randomBytes(8).toString('hex'),
      kind,
      expectedCount,
      prompt,
      expectedAnswer,
      imageOnly,
    })
    switch (testMode) {
      case 'quick':
        return [make('quick', QUESTION_PACK.question, null, QUESTION_PACK.candyAnswer)]
      case 'cup':
        return [make('cup', QUESTION_PACK.cupQuestion, null, QUESTION_PACK.cupAnswer)]
      case 'strict':
        return [make('strict', QUESTION_PACK.strictQuestionLabel, null, QUESTION_PACK.candyAnswer, true)]
      case 'dual':
        return [
          make('quick', QUESTION_PACK.question, null, QUESTION_PACK.candyAnswer),
          make('strict', QUESTION_PACK.strictQuestionLabel, null, QUESTION_PACK.candyAnswer, true),
        ]
      case 'advanced':
        return createAdvancedChallenges(3).map((challenge: AdvancedChallenge, index: number) =>
          make('advanced', challenge.prompt, challenge.expectedCount, null),
        )
      default:
        return []
    }
  }

  private buildQuestion(testMode: TestMode, probes: JobProbe[]): string {
    switch (testMode) {
      case 'quick':
        return QUESTION_PACK.question
      case 'cup':
        return QUESTION_PACK.cupQuestion
      case 'strict':
        return QUESTION_PACK.strictQuestionLabel
      case 'dual':
        return `${QUESTION_PACK.question}\n\n---\n\n${QUESTION_PACK.strictQuestionLabel}`
      case 'advanced':
        return probes
          .map((probe, index) => `第 ${index + 1} 轮\n${probe.prompt}`)
          .join('\n\n')
      default:
        return ''
    }
  }

  private pump(): void {
    let index = 0
    while (this.active.size < this.config.MAX_ACTIVE_JOBS && index < this.queue.length) {
      const job = this.queue[index]
      if (!job) break
      const ipActive = this.activeByIp.get(job.ip) ?? 0
      if (ipActive >= this.config.ACTIVE_PER_IP) {
        index += 1
        continue
      }
      this.queue.splice(index, 1)
      this.active.set(job.id, job)
      this.activeByIp.set(job.ip, ipActive + 1)
      void this.run(job).catch((error) => {
        this.log.error({ err: error, testId: job.id }, 'unhandled job error')
      })
    }
  }

  private publish(id: string): void {
    const detail = this.repository.getDetail(id)
    if (detail) this.hub.publish(id, detail)
  }

  private async run(job: QueuedJob): Promise<void> {
    const startedAt = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => {
      job.timedOut = true
      controller.abort(new Error('timeout'))
    }, this.config.TEST_TIMEOUT_MS)
    try {
      this.repository.updateTest(job.id, {
        status: 'running',
        startedAt,
        progress: { current: 0, completed: 0, total: job.probes.length, stage: 'testing' },
      })
      this.publish(job.id)

      const results = await Promise.all(
        job.probes.map(async (probe, index) => {
          this.repository.updateProbe(probe.dbId, job.id, {
            status: 'running',
            startedAt: Date.now(),
          })
          this.publish(job.id)
          const release = await this.semaphore.acquire()
          let output: Awaited<ReturnType<typeof runUpstreamProbe>>
          try {
            output = await runUpstreamProbe({
              url: job.url,
              apiKey: job.apiKey,
              apiType: job.apiType,
              model: job.model,
              effort: job.effort,
              prompt: probe.imageOnly ? undefined : probe.prompt,
              imageDataUrl: probe.imageOnly ? getQuestionImageDataUrl() : undefined,
              maxAnswerBytes: this.config.MAX_ANSWER_BYTES,
              signal: controller.signal,
              dispatcher: this.dispatcher,
            })
          } catch (error) {
            const now = Date.now()
            output = {
              status: 'failed',
              answer: '',
              error: sanitizeError(error, job.apiKey),
              statusCode: null,
              startedAt: now,
              finishedAt: now,
              durationMs: 0,
              firstTokenMs: null,
            }
          } finally {
            release()
          }
          let verdict: Verdict | null = null
          if (output.status === 'completed' && probe.expectedAnswer != null) {
            verdict = singleProbeVerdict(probe.kind as 'quick' | 'strict' | 'cup', output.answer, probe.expectedAnswer).verdict
          }
          this.repository.updateProbe(probe.dbId, job.id, {
            answer: output.answer,
            status: output.status,
            verdict,
            error: output.error,
            finishedAt: output.finishedAt,
            durationMs: output.durationMs,
            firstTokenMs: output.firstTokenMs,
          })
          this.publish(job.id)
          return { probe, output, verdict, index }
        }),
      )

      const completed = results.filter((item) => item.output.status === 'completed')
      const failed = results.filter((item) => item.output.status === 'failed')
      const firstTokenMs = results
        .map((item) => item.output.firstTokenMs)
        .filter((value): value is number => value != null)
        .sort((left, right) => left - right)[0] ?? null
      const durationMs = Date.now() - startedAt
      const progressBase = {
        current: results.length,
        completed: completed.length,
        total: job.probes.length,
        stage: 'testing' as const,
      }

      if (job.timedOut) {
        this.finishFailure(job, '测试超时（300 秒）', startedAt, durationMs, firstTokenMs, results)
        return
      }

      if (job.testMode === 'advanced') {
        this.repository.updateTest(job.id, {
          progress: { ...progressBase, stage: 'analyzing' },
        })
        this.publish(job.id)
        if (!completed.length) {
          this.finishFailure(job, failed[0]?.output.error || '所有指纹题目均未返回有效回答', startedAt, durationMs, firstTokenMs, results)
          return
        }
        try {
          const fingerprint = analyzeFingerprint(
            completed.map((item) => ({
              text: item.output.answer,
              expectedCount: item.probe.expectedCount ?? 0,
            })),
          )
          const decision = advancedVerdict(job.model, fingerprint, this.tiers)
          this.repository.updateTest(job.id, {
            status: 'completed',
            verdict: decision.verdict,
            verdictReason: decision.reason,
            fingerprint,
            answer: null,
            comparison: null,
            error: '',
            progress: { ...progressBase, current: job.probes.length, stage: 'completed' },
            finishedAt: Date.now(),
            durationMs,
            firstTokenMs,
          })
          this.publish(job.id)
        } catch (error) {
          this.finishFailure(job, sanitizeError(error, job.apiKey), startedAt, durationMs, firstTokenMs, results)
        }
        return
      }

      if (job.testMode === 'dual') {
        const comparison = results.map(({ probe, output, verdict }) => this.toComparison(probe, output, verdict))
        if (failed.length) {
          this.repository.updateTest(job.id, {
            status: 'failed',
            verdict: null,
            verdictReason: '至少一项请求失败，无法判定',
            answer: null,
            comparison,
            error: sanitizeError(failed[0].output.error, job.apiKey),
            progress: { ...progressBase, stage: 'failed' },
            finishedAt: Date.now(),
            durationMs,
            firstTokenMs,
          })
          this.publish(job.id)
          return
        }
        const decision = dualVerdict(
          results.map(({ probe, output, verdict }) => ({
            testMode: probe.kind as 'quick' | 'strict',
            status: output.status,
            verdict,
          })),
        )
        this.repository.updateTest(job.id, {
          status: 'completed',
          verdict: decision.verdict,
          verdictReason: decision.reason,
          answer: null,
          comparison,
          error: '',
          progress: { ...progressBase, current: job.probes.length, stage: 'completed' },
          finishedAt: Date.now(),
          durationMs,
          firstTokenMs,
        })
        this.publish(job.id)
        return
      }

      // quick / strict / cup
      const only = results[0]
      if (!only || only.output.status === 'failed') {
        this.finishFailure(job, only?.output.error || '测试失败', startedAt, durationMs, firstTokenMs, results)
        return
      }
      const kind = only.probe.kind as 'quick' | 'strict' | 'cup'
      const decision = singleProbeVerdict(kind, only.output.answer, only.probe.expectedAnswer ?? 0)
      this.repository.updateTest(job.id, {
        status: 'completed',
        verdict: decision.verdict,
        verdictReason: decision.reason,
        answer: only.output.answer,
        comparison: null,
        error: '',
        progress: { ...progressBase, current: job.probes.length, stage: 'completed' },
        finishedAt: Date.now(),
        durationMs,
        firstTokenMs,
      })
      this.publish(job.id)
    } catch (error) {
      this.finishFailure(job, sanitizeError(error, job.apiKey), startedAt, Date.now() - startedAt, null, [])
    } finally {
      clearTimeout(timer)
      job.apiKey = ''
      this.active.delete(job.id)
      const ipActive = (this.activeByIp.get(job.ip) ?? 1) - 1
      if (ipActive <= 0) this.activeByIp.delete(job.ip)
      else this.activeByIp.set(job.ip, ipActive)
      this.pump()
    }
  }

  private finishFailure(
    job: QueuedJob,
    error: string,
    startedAt: number,
    durationMs: number,
    firstTokenMs: number | null,
    results: Array<{ probe: JobProbe; output: { status: string; error: string; firstTokenMs: number | null }; verdict: Verdict | null }>,
  ): void {
    const comparison = job.testMode === 'dual'
      ? results.map(({ probe, output, verdict }) => this.toComparison(probe, output as never, verdict))
      : null
    this.repository.updateTest(job.id, {
      status: 'failed',
      verdict: null,
      verdictReason: '测试失败',
      answer: null,
      comparison,
      error: sanitizeError(error, job.apiKey),
      progress: {
        current: results.length,
        completed: results.filter((item) => item.output.status === 'completed').length,
        total: job.probes.length,
        stage: 'failed',
      },
      finishedAt: Date.now(),
      durationMs: Date.now() - startedAt,
      firstTokenMs,
    })
    this.publish(job.id)
  }

  private toComparison(
    probe: JobProbe,
    output: { status: string; error: string; firstTokenMs: number | null; durationMs: number; startedAt: number; finishedAt: number },
    verdict: Verdict | null,
  ): ComparisonEntry {
    return {
      testMode: probe.kind as 'quick' | 'strict',
      status: output.status as ComparisonEntry['status'],
      verdict,
      startedAt: new Date(output.startedAt).toISOString(),
      finishedAt: new Date(output.finishedAt).toISOString(),
      firstTokenMs: output.firstTokenMs,
      durationMs: output.durationMs,
      error: output.error,
    }
  }

  startMaintenance(): void {
    this.cleanupTimer = setInterval(() => {
      try {
        const removed = this.repository.cleanup(this.config.RETENTION_DAYS, this.config.MAX_RECORDS)
        if (removed) this.log.info({ removed }, 'retention cleanup')
      } catch (error) {
        this.log.error({ err: error }, 'retention cleanup failed')
      }
    }, 60 * 60 * 1000)
    this.cleanupTimer.unref()
  }

  async shutdown(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
    for (const job of this.active.values()) {
      job.timedOut = true
    }
    this.active.clear()
    this.queue.length = 0
  }

  get queueDepth(): number {
    return this.queue.length
  }

  get activeCount(): number {
    return this.active.size
  }
}