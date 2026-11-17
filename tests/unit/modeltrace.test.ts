import { describe, expect, it } from 'vitest'
import { analyzeFingerprint, createAdvancedChallenges } from '../../src/server/modeltrace'

describe('ModelTrace adapter', () => {
  it('generates three challenges with unique lengths in the official range', () => {
    const challenges = createAdvancedChallenges(3)
    expect(challenges).toHaveLength(3)
    expect(new Set(challenges.map((item) => item.expectedCount)).size).toBe(3)
    for (const challenge of challenges) {
      expect(challenge.expectedCount).toBeGreaterThanOrEqual(292)
      expect(challenge.expectedCount).toBeLessThanOrEqual(332)
      expect(challenge.prompt).toContain(String(challenge.expectedCount))
      expect(challenge.prompt).toContain('355')
    }
  })

  it('runs the official fingerprint core on valid number sequences', () => {
    const outputs = [0, 1, 2].map((index) => ({
      expectedCount: 300,
      text: Array.from({ length: 300 }, (_, position) => ((position * (37 + index) + 11) % 355) + 1).join(', '),
    }))
    const result = analyzeFingerprint(outputs)
    expect(result.prediction_name).toBeTruthy()
    expect(result.probability).toBeGreaterThan(0)
    expect(result.probability).toBeLessThanOrEqual(1)
    expect(result.used_outputs).toBe(3)
    expect(result.results.length).toBeGreaterThan(5)
    expect(result.method).toBe('统一全局稳健数字指纹')
  })
})