export interface ModelTraceOutput {
  index: number
  text: string
  expected_count: number
}

export interface FingerprintDiagnostic {
  index: number
  parsed_numbers: number
  minimum_numbers: number
  accepted: boolean
}

export interface FingerprintResult {
  model: string
  display_name: string
  probability: number
  profile_similarity: number
  score: number
  nuisance_score: number
  family: string
  family_name: string
  conditional_probability: number
}

export interface FingerprintReport {
  prediction: string
  prediction_name: string
  probability: number
  used_outputs: number
  results: FingerprintResult[]
  diagnostics: FingerprintDiagnostic[]
  calibration: { queries: string; beta: number; cv_accuracy: number }
  family_prediction: string
  family_prediction_name: string
  family_probability: number
  family_probabilities: Array<{ family: string; display_name: string; probability: number }>
  method: string
}

export function parseNumbers(text: string): number[]
export function countNumbers(numbers: number[]): number[]
export function analyzeGlobalOutputs(outputs: ModelTraceOutput[], bank: unknown): FingerprintReport