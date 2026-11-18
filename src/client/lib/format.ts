import type { TestDetail, TestMode, TestSummary, Verdict } from '../../shared/types'

export function modeLabel(mode: TestMode): string {
  switch (mode) {
    case 'quick':
      return '旧文字糖果题'
    case 'strict':
      return '严格原图糖果题'
    case 'dual':
      return '双测糖果题'
    case 'cup':
      return '水杯题'
    case 'pelican':
      return 'SVG 画图题（鹈鹕骑自行车）'
    case 'advanced':
      return 'ModelTrace 指纹'
  }
}

export function modeShort(mode: TestMode): string {
  switch (mode) {
    case 'quick':
      return 'QUICK'
    case 'strict':
      return 'STRICT'
    case 'dual':
      return 'DUAL'
    case 'cup':
      return 'CUP'
    case 'pelican':
      return 'PELICAN'
    case 'advanced':
      return 'TRACE'
  }
}

export function verdictLabel(test: Pick<TestSummary, 'status' | 'verdict'>): string {
  if (test.status === 'queued') return '排队中'
  if (test.status === 'running') return '测试中'
  if (test.status === 'failed') return '测试失败'
  switch (test.verdict) {
    case 'pass':
      return '不降智'
    case 'watered':
      return '掺水 / 残血'
    case 'fail':
      return '降智'
    default:
      return '无法判定'
  }
}

export function statusTone(test: Pick<TestSummary, 'status' | 'verdict'>): string {
  if (test.status === 'queued') return 'queued'
  if (test.status === 'running') return 'running'
  if (test.status === 'failed') return 'failed'
  switch (test.verdict) {
    case 'pass':
      return 'pass'
    case 'watered':
      return 'watered'
    case 'fail':
      return 'fail'
    default:
      return 'unknown'
  }
}

export function verdictTone(verdict: Verdict | null): string {
  switch (verdict) {
    case 'pass':
      return 'pass'
    case 'watered':
      return 'watered'
    case 'fail':
      return 'fail'
    default:
      return 'unknown'
  }
}

export function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function formatDuration(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

export function formatFirstToken(ms: number | null): string {
  if (ms == null) return '—'
  return `${(ms / 1000).toFixed(2)} s`
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function progressLabel(test: TestDetail | TestSummary): string {
  const progress = test.progress
  if (test.status === 'queued') return '等待执行'
  if (test.status === 'running') {
    if (progress.stage === 'analyzing') return '指纹分析中'
    return `${progress.completed}/${progress.total} 项完成`
  }
  if (test.status === 'failed') return '已失败'
  return '已完成'
}

export function shortId(id: string): string {
  return `#${id.slice(0, 8)}`
}