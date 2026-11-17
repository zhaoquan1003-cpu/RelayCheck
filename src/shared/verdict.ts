import type { Fingerprint, TestMode, Verdict } from './types'

export interface VerdictDecision {
  verdict: Verdict
  reason: string
}

export function normalizeModelName(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/[._\s]+/g, '-')
    .replace(/-+/g, '-')
}

export function containsStandaloneNumber(text: string, expected: number): boolean {
  if (!Number.isFinite(expected)) return false
  const source = String(text || '')
  const escaped = String(expected).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Reject matches inside a longer number or a decimal such as 210 / 21.5.
  const pattern = new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`, 'u')
  return pattern.test(source)
}

export function singleProbeVerdict(kind: 'quick' | 'strict' | 'cup', answer: string, expected: number): VerdictDecision {
  const ok = containsStandaloneNumber(answer, expected)
  if (ok) {
    if (kind === 'cup') {
      return { verdict: 'pass', reason: `回答正文出现独立数字 ${expected}；未校验证明过程。` }
    }
    return { verdict: 'pass', reason: `回答正文出现独立数字 ${expected}。` }
  }
  return {
    verdict: 'fail',
    reason: `回答正文没有出现独立数字 ${expected}，判定未通过。`,
  }
}

export interface DualProbeView {
  testMode: 'quick' | 'strict'
  status: 'queued' | 'running' | 'completed' | 'failed'
  verdict: Verdict | null
}

export function dualVerdict(probes: DualProbeView[]): VerdictDecision {
  const quick = probes.find((probe) => probe.testMode === 'quick')
  const strict = probes.find((probe) => probe.testMode === 'strict')
  if (!quick || !strict) {
    return { verdict: 'unknown', reason: '双测子结果不完整，无法判定。' }
  }
  if (quick.status === 'failed' || strict.status === 'failed') {
    return { verdict: 'unknown', reason: '至少一项请求失败，记录失败原因而不强行判定。' }
  }
  if (strict.verdict === 'pass') {
    return { verdict: 'pass', reason: '严格原图题通过，按严格项判定为不降智。' }
  }
  if (quick.verdict === 'pass') {
    return { verdict: 'watered', reason: '旧文字题通过，但严格原图题未通过：疑似掺水/残血。' }
  }
  return { verdict: 'fail', reason: '旧文字题与严格原图题均未通过，判定为降智。' }
}

export function advancedVerdict(
  targetModel: string,
  fingerprint: Fingerprint | null,
  tiers: Record<string, number>,
): VerdictDecision {
  if (!fingerprint) {
    return { verdict: 'unknown', reason: '没有可用的指纹结果。' }
  }
  const target = normalizeModelName(targetModel)
  const predicted = normalizeModelName(fingerprint.prediction_name)
  if (target === predicted) {
    return {
      verdict: 'pass',
      reason: `指纹最接近被测模型 ${fingerprint.prediction_name}（概率 ${(fingerprint.probability * 100).toFixed(1)}%）。`,
    }
  }
  const targetTier = tiers[target]
  const predictedTier = tiers[predicted]
  if (targetTier == null || predictedTier == null) {
    return {
      verdict: 'unknown',
      reason: `指纹最接近 ${fingerprint.prediction_name}，但等级表缺少目标模型或预测模型的等级，无法自动判定。`,
    }
  }
  if (predictedTier >= targetTier) {
    return {
      verdict: 'pass',
      reason: `指纹预测 ${fingerprint.prediction_name}，等级达到或高于被测模型。`,
    }
  }
  return {
    verdict: 'fail',
    reason: `指纹预测 ${fingerprint.prediction_name}（概率 ${(fingerprint.probability * 100).toFixed(1)}%），等级低于被测模型。`,
  }
}

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
    case 'advanced':
      return 'ModelTrace 指纹'
  }
}