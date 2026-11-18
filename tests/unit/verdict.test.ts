import { describe, expect, it } from 'vitest'
import {
  advancedVerdict,
  containsStandaloneNumber,
  dualVerdict,
  normalizeModelName,
  singleProbeVerdict,
} from '../../src/shared/verdict'
import type { Fingerprint } from '../../src/shared/types'

function fingerprint(overrides: Partial<Fingerprint> = {}): Fingerprint {
  return {
    prediction: 'gpt-6-astra',
    prediction_name: 'gpt-6-astra',
    probability: 0.99,
    used_outputs: 3,
    results: [],
    diagnostics: [],
    calibration: { queries: '3', beta: 1, cv_accuracy: 0.99 },
    family_prediction: 'gpt',
    family_prediction_name: 'GPT',
    family_probability: 0.99,
    family_probabilities: [],
    method: 'test',
    ...overrides,
  }
}

describe('number detection', () => {
  it('accepts an independent number', () => {
    expect(containsStandaloneNumber('答案是 21 颗。', 21)).toBe(true)
    expect(containsStandaloneNumber('\\(21\\)', 21)).toBe(true)
    expect(containsStandaloneNumber('**8** 次', 8)).toBe(true)
  })

  it('rejects numbers embedded in larger or decimal numbers', () => {
    expect(containsStandaloneNumber('答案是 210 颗。', 21)).toBe(false)
    expect(containsStandaloneNumber('21.5 次', 21)).toBe(false)
    expect(containsStandaloneNumber('1.21', 21)).toBe(false)
    expect(containsStandaloneNumber('没有提到答案', 21)).toBe(false)
    expect(containsStandaloneNumber('-21', 21)).toBe(false)
    expect(containsStandaloneNumber('21e4', 21)).toBe(false)
    expect(containsStandaloneNumber('21０', 21)).toBe(false)
    expect(containsStandaloneNumber('model21', 21)).toBe(false)
    expect(containsStandaloneNumber('21,000', 21)).toBe(false)
    expect(containsStandaloneNumber('The answer is 21.', 21)).toBe(true)
  })
})

describe('mode verdicts', () => {
  it('marks a single keyword match as pass and a miss as fail', () => {
    expect(singleProbeVerdict('quick', '答案是 21', 21).verdict).toBe('pass')
    expect(singleProbeVerdict('cup', '最少 8 次', 8).verdict).toBe('pass')
    expect(singleProbeVerdict('quick', '答案是 22', 21).verdict).toBe('fail')
  })

  it('fails the degraded 29 answer observed on an external checker', () => {
    const degraded =
      '总糖果数为 41。要避免满足条件，最多可以取出 28 个（全部西瓜味 12 个，圆形苹果 7 个，圆形桃子 9 个），所以答案是 29 个。'
    expect(singleProbeVerdict('quick', degraded, 21).verdict).toBe('fail')
    expect(singleProbeVerdict('strict', degraded, 21).verdict).toBe('fail')
    const correct = '取 9 颗圆形和 12 颗五角星形，答案是 21 颗。'
    expect(singleProbeVerdict('quick', correct, 21).verdict).toBe('pass')
    expect(singleProbeVerdict('strict', correct, 21).verdict).toBe('pass')
  })

  it('uses strict as authoritative in dual mode', () => {
    expect(
      dualVerdict([
        { testMode: 'quick', status: 'completed', verdict: 'pass' },
        { testMode: 'strict', status: 'completed', verdict: 'pass' },
      ]).verdict,
    ).toBe('pass')
    expect(
      dualVerdict([
        { testMode: 'quick', status: 'completed', verdict: 'pass' },
        { testMode: 'strict', status: 'completed', verdict: 'fail' },
      ]).verdict,
    ).toBe('watered')
    expect(
      dualVerdict([
        { testMode: 'quick', status: 'completed', verdict: 'fail' },
        { testMode: 'strict', status: 'completed', verdict: 'fail' },
      ]).verdict,
    ).toBe('fail')
    expect(
      dualVerdict([
        { testMode: 'quick', status: 'failed', verdict: null },
        { testMode: 'strict', status: 'completed', verdict: 'pass' },
      ]).verdict,
    ).toBe('unknown')
  })

  it('matches normalized model names exactly', () => {
    expect(normalizeModelName('GPT-6.1-Sol')).toBe('gpt-6-1-sol')
    expect(advancedVerdict('gpt-6-astra', fingerprint(), {}).verdict).toBe('pass')
    expect(advancedVerdict('gpt-6.1-sol', fingerprint(), {}).verdict).toBe('unknown')
    expect(advancedVerdict('gpt-6-astra', fingerprint(), { 'gpt-6-astra': 100 }).verdict).toBe('pass')
  })

  it('compares configured tiers when both sides are known', () => {
    const decision = advancedVerdict(
      'gpt-6-astra',
      fingerprint({ prediction: 'gpt-5.6-luna', prediction_name: 'gpt-5.6-luna' }),
      { 'gpt-6-astra': 100, 'gpt-5-6-luna': 60 },
    )
    expect(decision.verdict).toBe('fail')
    expect(decision.reason).toContain('低于')
  })
})
