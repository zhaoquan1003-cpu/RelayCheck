export const TEST_MODES = ['quick', 'strict', 'dual', 'cup', 'advanced'] as const
export type TestMode = (typeof TEST_MODES)[number]

export const API_TYPES = ['responses', 'chat_completions'] as const
export type ApiType = (typeof API_TYPES)[number]

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'minimal', 'none'] as const
export type Effort = (typeof EFFORTS)[number]

export const TEST_STATUSES = ['queued', 'running', 'completed', 'failed'] as const
export type TestStatus = (typeof TEST_STATUSES)[number]

export const VERDICTS = ['pass', 'watered', 'fail', 'unknown'] as const
export type Verdict = (typeof VERDICTS)[number]

export const TEST_SOURCES = ['manual', 'pool'] as const
export type TestSource = (typeof TEST_SOURCES)[number]

export type ProgressStage = 'queued' | 'testing' | 'analyzing' | 'completed' | 'failed'

export interface TestProgress {
  current: number
  completed: number
  total: number
  stage: ProgressStage
}

export interface ProbeResultView {
  id: string
  ordinal: number
  kind: 'quick' | 'strict' | 'cup' | 'advanced'
  expectedCount: number | null
  prompt: string
  answer: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  verdict: Verdict | null
  error: string
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  firstTokenMs: number | null
}

export interface ComparisonEntry {
  testMode: 'quick' | 'strict'
  status: 'queued' | 'running' | 'completed' | 'failed'
  verdict: Verdict | null
  startedAt: string | null
  finishedAt: string | null
  firstTokenMs: number | null
  durationMs: number | null
  error: string
}

export interface FingerprintModelResult {
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

export interface Fingerprint {
  prediction: string
  prediction_name: string
  probability: number
  used_outputs: number
  results: FingerprintModelResult[]
  diagnostics: Array<{
    index: number
    parsed_numbers: number
    minimum_numbers: number
    accepted: boolean
  }>
  calibration: { queries: string; beta: number; cv_accuracy: number }
  family_prediction: string
  family_prediction_name: string
  family_probability: number
  family_probabilities: Array<{ family: string; display_name: string; probability: number }>
  method: string
}

export interface FingerprintSummary {
  prediction: string
  predictionName: string
  probability: number
  usedOutputs: number
}

export interface TestSummary {
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
  status: TestStatus
  verdict: Verdict | null
  verdictReason: string
  progress: TestProgress
  questionImage: string | null
  comparison: ComparisonEntry[] | null
  fingerprintSummary: FingerprintSummary | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  durationMs: number | null
  firstTokenMs: number | null
  streamVersion: number
  error: string
}

export interface TestDetail extends TestSummary {
  question: string | null
  answer: string | null
  probes: ProbeResultView[]
  fingerprint: Fingerprint | null
}

export interface ModelPreset {
  id: string
  label: string
  hint?: string
}

export interface TestModeMeta {
  id: TestMode
  label: string
  short: string
  help: string
}

export interface QuestionPack {
  id: string
  version: string
  question: string
  cupQuestion: string
  strictQuestionLabel: string
  questionImage: string
  candyAnswer: number
  cupAnswer: number
}

export interface PublicConfig {
  appName: string
  tagline: string
  defaultTestMode: TestMode
  defaultEffort: Effort
  defaultApiType: ApiType
  defaultUpstreamUrl: string
  modes: TestModeMeta[]
  apiTypes: Array<{ id: ApiType; label: string; help: string }>
  efforts: Array<{ id: Effort; label: string }>
  models: ModelPreset[]
  questions: QuestionPack
  limits: {
    testsPerHourPerIp: number
    activeTestsPerIp: number
    maxQueue: number
    maxActiveJobs: number
    timeoutMs: number
    maxAnswerBytes: number
    retentionDays: number
    maxRecords: number
  }
  disclaimers: string[]
}

export interface CreateTestInput {
  address: string
  key: string
  apiType: ApiType
  model: string
  effort: Effort
  testMode: TestMode
}

export interface ConfigResponse {
  ok: true
  config: PublicConfig
}

export interface ListTestsResponse {
  ok: true
  records: TestSummary[]
  total: number
  page: number
  pageSize: number
}

export interface GetTestResponse {
  ok: true
  test: TestDetail
}

export interface CreateTestResponse {
  ok: true
  test: TestSummary
}

export interface ApiErrorBody {
  ok: false
  error: {
    code: string
    message: string
    fields?: Record<string, string>
  }
}

export interface StreamEvent {
  ok: true
  test: TestDetail
}