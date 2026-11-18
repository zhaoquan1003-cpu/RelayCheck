import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/server/db/database'
import { TestRepository, type NewTestRecord } from '../../src/server/db/repository'

function record(id: string): NewTestRecord {
  return {
    id, source: 'manual', poolId: null, groupName: '', addressMasked: 'https://e****.com', keyMasked: '****',
    model: 'mock', effort: 'low', apiType: 'responses', testMode: 'quick',
    questionVersion: 'test', question: 'question', questionImage: null,
    progress: { current: 0, completed: 0, total: 1, stage: 'queued' }, clientIpHash: null,
  }
}

describe('persistent record lifecycle', () => {
  it('retains active jobs even when older than retention or beyond the record limit', () => {
    const db = openDatabase(':memory:')
    const repository = new TestRepository(db)
    try {
      for (const id of ['old-running', 'old-queued', 'old-finished', 'recent-finished-1', 'recent-finished-2']) {
        repository.insertTest(record(id))
      }
      const old = Date.now() - 40 * 86400_000
      db.prepare("UPDATE tests SET created_at = ? WHERE id LIKE 'old-%'").run(old)
      repository.updateTest('old-running', { status: 'running' })
      repository.updateTest('old-finished', { status: 'completed' })
      repository.updateTest('recent-finished-1', { status: 'completed' })
      repository.updateTest('recent-finished-2', { status: 'failed' })
      db.prepare('UPDATE tests SET created_at = ? WHERE id = ?').run(Date.now() + 1, 'recent-finished-2')
      expect(repository.cleanup(30, 1)).toBe(2)
      expect(repository.list(1, 30).records.map((item) => item.id).sort()).toEqual(['old-queued', 'old-running', 'recent-finished-2'])
      expect(repository.getSummary('old-running')?.status).toBe('running')
      expect(repository.getSummary('old-queued')?.status).toBe('queued')
    } finally { repository.close() }
  })

  it('recovers interrupted jobs with terminal probes, timestamps, and matching progress', () => {
    const db = openDatabase(':memory:')
    const repository = new TestRepository(db)
    try {
      const startedAt = Date.now() - 3000
      repository.insertTest({ ...record('interrupted'), testMode: 'dual', progress: { current: 1, completed: 1, total: 2, stage: 'testing' } })
      repository.updateTest('interrupted', { status: 'running', startedAt })
      repository.createProbe({ id: 'completed-probe', testId: 'interrupted', ordinal: 0, kind: 'quick', expectedCount: null, prompt: 'quick' })
      repository.createProbe({ id: 'running-probe', testId: 'interrupted', ordinal: 1, kind: 'strict', expectedCount: null, prompt: 'strict' })
      repository.updateProbe('completed-probe', 'interrupted', { status: 'completed', answer: '21', startedAt, finishedAt: startedAt + 100, verdict: 'pass' })
      repository.updateProbe('running-probe', 'interrupted', { status: 'running', startedAt })
      repository.insertTest(record('queued'))
      repository.createProbe({ id: 'queued-probe', testId: 'queued', ordinal: 0, kind: 'quick', expectedCount: null, prompt: 'quick' })

      repository.markInterrupted()
      const interrupted = repository.getDetail('interrupted')!
      expect(interrupted.status).toBe('failed')
      expect(interrupted.error).toContain('服务重启')
      expect(interrupted.verdict).toBeNull()
      expect(interrupted.progress).toEqual({ current: 2, completed: 1, total: 2, stage: 'failed' })
      expect(interrupted.durationMs).toBeGreaterThanOrEqual(3000)
      expect(interrupted.finishedAt).not.toBeNull()
      expect(interrupted.probes[0]).toMatchObject({ status: 'completed', answer: '21', verdict: 'pass' })
      expect(interrupted.probes[1]).toMatchObject({ status: 'failed', error: '服务重启，任务中断' })
      expect(interrupted.probes[1].finishedAt).not.toBeNull()
      expect(interrupted.probes[1].durationMs).toBeGreaterThanOrEqual(3000)
      const queued = repository.getDetail('queued')!
      expect(queued.status).toBe('failed')
      expect(queued.progress).toEqual({ current: 1, completed: 0, total: 1, stage: 'failed' })
      expect(queued.probes[0].finishedAt).not.toBeNull()
      const recoveredVersion = interrupted.streamVersion
      repository.markInterrupted()
      expect(repository.getDetail('interrupted')!.streamVersion).toBe(recoveredVersion)
    } finally { repository.close() }
  })
})
