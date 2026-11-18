import type { DatabaseSync } from 'node:sqlite'
import type {
  ApiType,
  ComparisonEntry,
  Effort,
  Fingerprint,
  ProbeResultView,
  TestDetail,
  TestMode,
  TestSource,
  TestStatus,
  TestSummary,
  Verdict,
} from '../../shared/types'

interface TestRow {
  id: string
  source: string
  pool_id: string | null
  group_name: string
  address_masked: string
  key_masked: string
  model: string
  effort: string
  api_type: string
  test_mode: string
  status: string
  verdict: string | null
  verdict_reason: string
  question_version: string | null
  question: string | null
  answer: string | null
  error: string
  progress_json: string | null
  comparison_json: string | null
  fingerprint_json: string | null
  question_image: string | null
  created_at: number
  started_at: number | null
  finished_at: number | null
  duration_ms: number | null
  first_token_ms: number | null
  stream_version: number
}

interface ProbeRow {
  id: string
  test_id: string
  ordinal: number
  kind: string
  expected_count: number | null
  prompt: string
  answer: string
  status: string
  verdict: string | null
  error: string
  started_at: number | null
  finished_at: number | null
  duration_ms: number | null
  first_token_ms: number | null
}

export interface NewTestRecord {
  id: string
  source: TestSource
  poolId: string | null
  groupName: string
  addressMasked: string
  keyMasked: string
  model: string
  effort: Effort
  apiType: ApiType
  testMode: TestMode
  questionVersion: string
  question: string
  questionImage: string | null
  progress: TestDetail['progress']
  clientIpHash: string | null
}

export interface NewProbeRecord {
  id: string
  testId: string
  ordinal: number
  kind: 'quick' | 'strict' | 'cup' | 'pelican' | 'advanced'
  expectedCount: number | null
  prompt: string
}

export interface TestPatch {
  status?: TestStatus
  verdict?: Verdict | null
  verdictReason?: string
  answer?: string | null
  error?: string
  progress?: TestDetail['progress']
  comparison?: ComparisonEntry[] | null
  fingerprint?: Fingerprint | null
  startedAt?: number | null
  finishedAt?: number | null
  durationMs?: number | null
  firstTokenMs?: number | null
}

export interface ProbePatch {
  answer?: string
  status?: 'queued' | 'running' | 'completed' | 'failed'
  verdict?: Verdict | null
  error?: string
  startedAt?: number | null
  finishedAt?: number | null
  durationMs?: number | null
  firstTokenMs?: number | null
}

function iso(value: number | null | undefined): string | null {
  return value == null ? null : new Date(value).toISOString()
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function defaultProgress(testMode: string): TestDetail['progress'] {
  const total = testMode === 'dual' ? 2 : testMode === 'advanced' ? 3 : 1
  return { current: 0, completed: 0, total, stage: 'queued' }
}

// Listing must not load megabytes of answers and prompts for every row.
const SUMMARY_COLUMNS = `id, source, pool_id, group_name, address_masked, key_masked,
  model, effort, api_type, test_mode, status, verdict, verdict_reason, progress_json,
  comparison_json, fingerprint_json, question_image, created_at, started_at,
  finished_at, duration_ms, first_token_ms, stream_version, error`

export class TestRepository {
  constructor(private readonly db: DatabaseSync) {}

  insertTest(record: NewTestRecord): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO tests (
          id, source, pool_id, group_name, address_masked, key_masked,
          model, effort, api_type, test_mode, status, verdict, verdict_reason,
          question_version, question, question_image, progress_json,
          created_at, stream_version, client_ip_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', NULL, '', ?, ?, ?, ?, ?, 0, ?)`,
      )
      .run(
        record.id,
        record.source,
        record.poolId,
        record.groupName,
        record.addressMasked,
        record.keyMasked,
        record.model,
        record.effort,
        record.apiType,
        record.testMode,
        record.questionVersion,
        record.question,
        record.questionImage,
        JSON.stringify(record.progress),
        now,
        record.clientIpHash,
      )
  }

  createProbe(probe: NewProbeRecord): void {
    this.db
      .prepare(
        `INSERT INTO probes (
          id, test_id, ordinal, kind, expected_count, prompt, answer,
          status, verdict, error
        ) VALUES (?, ?, ?, ?, ?, ?, '', 'queued', NULL, '')`,
      )
      .run(probe.id, probe.testId, probe.ordinal, probe.kind, probe.expectedCount, probe.prompt)
  }

  updateTest(id: string, patch: TestPatch): void {
    const assignments: string[] = []
    const values: Array<string | number | null> = []
    const push = (column: string, value: string | number | null) => {
      assignments.push(`${column} = ?`)
      values.push(value)
    }
    if (patch.status !== undefined) push('status', patch.status)
    if (patch.verdict !== undefined) push('verdict', patch.verdict)
    if (patch.verdictReason !== undefined) push('verdict_reason', patch.verdictReason)
    if (patch.answer !== undefined) push('answer', patch.answer)
    if (patch.error !== undefined) push('error', patch.error)
    if (patch.progress !== undefined) push('progress_json', JSON.stringify(patch.progress))
    if (patch.comparison !== undefined) {
      push('comparison_json', patch.comparison === null ? null : JSON.stringify(patch.comparison))
    }
    if (patch.fingerprint !== undefined) {
      push('fingerprint_json', patch.fingerprint === null ? null : JSON.stringify(patch.fingerprint))
    }
    if (patch.startedAt !== undefined) push('started_at', patch.startedAt)
    if (patch.finishedAt !== undefined) push('finished_at', patch.finishedAt)
    if (patch.durationMs !== undefined) push('duration_ms', patch.durationMs)
    if (patch.firstTokenMs !== undefined) push('first_token_ms', patch.firstTokenMs)
    if (!assignments.length) return
    assignments.push('stream_version = stream_version + 1')
    values.push(id)
    this.db.prepare(`UPDATE tests SET ${assignments.join(', ')} WHERE id = ?`).run(...values)
  }

  updateProbe(id: string, testId: string, patch: ProbePatch): void {
    const assignments: string[] = []
    const values: Array<string | number | null> = []
    const push = (column: string, value: string | number | null) => {
      assignments.push(`${column} = ?`)
      values.push(value)
    }
    if (patch.answer !== undefined) push('answer', patch.answer)
    if (patch.status !== undefined) push('status', patch.status)
    if (patch.verdict !== undefined) push('verdict', patch.verdict)
    if (patch.error !== undefined) push('error', patch.error)
    if (patch.startedAt !== undefined) push('started_at', patch.startedAt)
    if (patch.finishedAt !== undefined) push('finished_at', patch.finishedAt)
    if (patch.durationMs !== undefined) push('duration_ms', patch.durationMs)
    if (patch.firstTokenMs !== undefined) push('first_token_ms', patch.firstTokenMs)
    if (assignments.length) {
      values.push(id)
      this.db.prepare(`UPDATE probes SET ${assignments.join(', ')} WHERE id = ?`).run(...values)
      this.touchTest(testId)
    }
  }

  touchTest(id: string): void {
    this.db.prepare('UPDATE tests SET stream_version = stream_version + 1 WHERE id = ?').run(id)
  }

  getSummary(id: string): TestSummary | null {
    const row = this.db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM tests WHERE id = ?`).get(id) as TestRow | undefined
    return row ? this.toSummary(row) : null
  }

  getDetail(id: string): TestDetail | null {
    const row = this.db.prepare('SELECT * FROM tests WHERE id = ?').get(id) as TestRow | undefined
    if (!row) return null
    const summary = this.toSummary(row)
    const probeRows = this.db
      .prepare('SELECT * FROM probes WHERE test_id = ? ORDER BY ordinal ASC')
      .all(id) as unknown as ProbeRow[]
    return {
      ...summary,
      question: row.question,
      answer: row.answer,
      probes: probeRows.map((probe) => this.toProbe(probe)),
      fingerprint: parseJson<Fingerprint>(row.fingerprint_json),
    }
  }

  list(page: number, pageSize: number): { records: TestSummary[]; total: number } {
    const safePage = Math.max(1, Math.floor(page) || 1)
    const totalRow = this.db.prepare('SELECT COUNT(*) AS count FROM tests').get() as { count: number }
    const rows = this.db
      .prepare(`SELECT ${SUMMARY_COLUMNS} FROM tests ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
      .all(pageSize, (safePage - 1) * pageSize) as unknown as TestRow[]
    return { records: rows.map((row) => this.toSummary(row)), total: Number(totalRow.count) }
  }

  listAll(limit = 200): TestSummary[] {
    const rows = this.db
      .prepare(`SELECT ${SUMMARY_COLUMNS} FROM tests ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(limit) as unknown as TestRow[]
    return rows.map((row) => this.toSummary(row))
  }

  ping(): void {
    this.db.prepare('SELECT 1 AS ok').get()
  }

  getRawStatus(id: string): { status: string; streamVersion: number } | null {
    const row = this.db
      .prepare('SELECT status, stream_version FROM tests WHERE id = ?')
      .get(id) as { status: string; stream_version: number } | undefined
    return row ? { status: row.status, streamVersion: Number(row.stream_version) } : null
  }

  markInterrupted(): void {
    const now = Date.now()
    this.db
      .prepare(
        `UPDATE probes SET status = 'failed', error = '服务重启，任务中断', finished_at = ?,
            duration_ms = CASE WHEN started_at IS NULL THEN NULL ELSE ? - started_at END
         WHERE status IN ('queued', 'running')`,
      )
      .run(now, now)
    this.db
      .prepare(
        `UPDATE tests
         SET status = 'failed', verdict = NULL, error = '服务重启，任务中断',
             verdict_reason = '服务重启，任务中断', finished_at = ?,
             duration_ms = ? - COALESCE(started_at, created_at),
             progress_json = json_set(COALESCE(progress_json, '{}'), '$.stage', 'failed',
               '$.current', (SELECT COUNT(*) FROM probes WHERE test_id = tests.id),
               '$.completed', (SELECT COUNT(*) FROM probes WHERE test_id = tests.id AND status = 'completed'),
               '$.total', (SELECT COUNT(*) FROM probes WHERE test_id = tests.id)),
             stream_version = stream_version + 1
         WHERE status IN ('queued', 'running')`,
      )
      .run(now, now)
  }

  failUnfinishedProbes(testId: string, error: string): void {
    const now = Date.now()
    this.db.prepare(`UPDATE probes SET status = 'failed', error = ?, finished_at = ?,
      duration_ms = CASE WHEN started_at IS NULL THEN NULL ELSE ? - started_at END
      WHERE test_id = ? AND status IN ('queued', 'running')`).run(error, now, now, testId)
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM tests WHERE id = ?').run(id)
  }

  cleanup(retentionDays: number, maxRecords: number): number {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
    const old = this.db.prepare("DELETE FROM tests WHERE status IN ('completed', 'failed') AND created_at < ?").run(cutoff)
    const extra = this.db
      .prepare(
        `DELETE FROM tests WHERE id IN (
          SELECT id FROM tests WHERE status IN ('completed', 'failed') ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?
        )`,
      )
      .run(maxRecords)
    return Number(old.changes) + Number(extra.changes)
  }

  close(): void {
    this.db.close()
  }

  private toSummary(row: TestRow): TestSummary {
    const fingerprint = parseJson<Fingerprint>(row.fingerprint_json)
    return {
      id: row.id,
      source: row.source as TestSource,
      poolId: row.pool_id,
      groupName: row.group_name,
      addressMasked: row.address_masked,
      keyMasked: row.key_masked,
      model: row.model,
      effort: row.effort as Effort,
      apiType: row.api_type as ApiType,
      testMode: row.test_mode as TestMode,
      status: row.status as TestStatus,
      verdict: row.verdict as Verdict | null,
      verdictReason: row.verdict_reason,
      progress: parseJson<TestSummary['progress']>(row.progress_json) ?? defaultProgress(row.test_mode),
      questionImage: row.question_image,
      comparison: parseJson<ComparisonEntry[]>(row.comparison_json),
      fingerprintSummary: fingerprint
        ? {
            prediction: fingerprint.prediction,
            predictionName: fingerprint.prediction_name,
            probability: fingerprint.probability,
            usedOutputs: fingerprint.used_outputs,
          }
        : null,
      createdAt: iso(row.created_at) as string,
      startedAt: iso(row.started_at),
      finishedAt: iso(row.finished_at),
      durationMs: row.duration_ms,
      firstTokenMs: row.first_token_ms,
      streamVersion: Number(row.stream_version),
      error: row.error,
    }
  }

  private toProbe(row: ProbeRow): ProbeResultView {
    return {
      id: row.id,
      ordinal: Number(row.ordinal),
      kind: row.kind as ProbeResultView['kind'],
      expectedCount: row.expected_count,
      prompt: row.prompt,
      answer: row.answer,
      status: row.status as ProbeResultView['status'],
      verdict: row.verdict as Verdict | null,
      error: row.error,
      startedAt: iso(row.started_at),
      finishedAt: iso(row.finished_at),
      durationMs: row.duration_ms,
      firstTokenMs: row.first_token_ms,
    }
  }
}
