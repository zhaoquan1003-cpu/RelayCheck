import type { Fingerprint, TestMode, Verdict } from './types'
import { MAX_SVG_BYTES, extractSvgMarkup, inspectSvg } from './svg-art'

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
  const pattern = new RegExp(`(?<![\\p{N}.+\\-A-Za-z_])${escaped}(?![\\p{N}A-Za-z_]|[.,]\\p{N})`, 'u')
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
  if (quick.status !== 'completed' || strict.status !== 'completed') {
    return { verdict: 'unknown', reason: '至少一项请求未成功完成，无法判定。' }
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
  if (!fingerprint || fingerprint.used_outputs < 1 || !Number.isFinite(fingerprint.probability)) {
    return { verdict: 'unknown', reason: '没有可用的指纹结果。' }
  }
  const target = normalizeModelName(targetModel)
  const predicted = normalizeModelName(fingerprint.prediction)
  const predictedName = normalizeModelName(fingerprint.prediction_name)
  if (target === predicted || target === predictedName) {
    return {
      verdict: 'pass',
      reason: `指纹最接近被测模型 ${fingerprint.prediction_name}（概率 ${(fingerprint.probability * 100).toFixed(1)}%）。`,
    }
  }
  const targetTier = Object.hasOwn(tiers, target) ? tiers[target] : undefined
  const predictedTier = Object.hasOwn(tiers, predicted) ? tiers[predicted] : Object.hasOwn(tiers, predictedName) ? tiers[predictedName] : undefined
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
    case 'pelican':
      return 'SVG 画图题（鹈鹕骑自行车）'
    case 'advanced':
      return 'ModelTrace 指纹'
  }
}

export function pelicanVerdict(answer: string): VerdictDecision {
  const extraction = extractSvgMarkup(answer)
  if (extraction.tooLarge) {
    return {
      verdict: 'fail',
      reason: `返回的 SVG 超过 ${Math.round(MAX_SVG_BYTES / 1024)} KB，无法安全渲染，画图题未通过。`,
    }
  }
  if (!extraction.markup) {
    return {
      verdict: 'fail',
      reason: '回答里没有找到完整的 <svg> 代码，画图题未通过。',
    }
  }
  const inspection = inspectSvg(extraction.markup)
  if (!inspection.complete) {
    return {
      verdict: 'fail',
      reason: '返回的 <svg> 缺少根元素或闭合标签，画图题未通过。',
    }
  }
  if (inspection.elements < 2) {
    return {
      verdict: 'fail',
      reason: `返回的 SVG 只有 ${inspection.elements} 个图形元素，几乎没有可判读的内容，画图题未通过。`,
    }
  }
  const filtered = inspection.risky.length
    ? `；已过滤 ${inspection.risky.join('、')}`
    : ''
  return {
    verdict: 'unknown',
    reason: `已返回 SVG（${inspection.elements} 个图形元素、${inspection.paths} 条路径），渲染效果需要人工判读画功${filtered}。`,
  }
}
