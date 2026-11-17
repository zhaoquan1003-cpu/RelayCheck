import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { analyzeGlobalOutputs } from '../../../vendor/modeltrace/fingerprint-core.js'
import { generateChallenges } from '../../../vendor/modeltrace/challenge-browser.js'
import type { Fingerprint } from '../../shared/types'

interface Bank {
  models: Array<{ id: string; display_name: string }>
  [key: string]: unknown
}

let bank: Bank | null = null

export function loadModelTraceBank(): Bank {
  if (bank) return bank
  const path = resolve(process.cwd(), 'vendor', 'modeltrace', 'unified_bank.json')
  bank = JSON.parse(readFileSync(path, 'utf8')) as Bank
  return bank
}

export interface AdvancedChallenge {
  id: string
  expectedCount: number
  prompt: string
}

export function createAdvancedChallenges(count = 3): AdvancedChallenge[] {
  return generateChallenges(count).map((challenge) => ({
    id: challenge.id,
    expectedCount: challenge.expected_count,
    prompt: challenge.prompt,
  }))
}

export function analyzeFingerprint(
  outputs: Array<{ text: string; expectedCount: number }>,
): Fingerprint {
  const bankData = loadModelTraceBank()
  return analyzeGlobalOutputs(
    outputs.map((output, index) => ({
      index,
      text: output.text,
      expected_count: output.expectedCount,
    })),
    bankData,
  ) as Fingerprint
}