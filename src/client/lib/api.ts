import type {
  ApiErrorBody,
  ConfigResponse,
  CreateTestInput,
  CreateTestResponse,
  GetTestResponse,
  ListTestsResponse,
  ListModelsInput,
  ListModelsResponse,
  TestDetail,
  TestSummary,
} from '../../shared/types'
import { appPath } from './paths'

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly fields?: Record<string, string>

  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fields = fields
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(appPath(`api/v1${path}`), {
    ...init,
    signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  })
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok || !body || (body as { ok?: boolean }).ok !== true) {
    const errorBody = body as ApiErrorBody | null
    throw new ApiError(
      response.status,
      errorBody?.error?.code || `HTTP_${response.status}`,
      errorBody?.error?.message || `请求失败（HTTP ${response.status}）`,
      errorBody?.error?.fields,
    )
  }
  return body as T
}

export const api = {
  getConfig: () => request<ConfigResponse>('/config'),
  listModels: (input: ListModelsInput, signal?: AbortSignal) =>
    request<ListModelsResponse>('/models', {
      method: 'POST',
      body: JSON.stringify(input),
      signal,
    }),
  listTests: (page: number, signal?: AbortSignal) => request<ListTestsResponse>(`/tests?page=${Math.max(1, page)}`, { signal }),
  getSummaries: (ids: string[], signal?: AbortSignal) => request<{ ok: true; records: TestSummary[]; missingIds: string[] }>(
    `/tests/summaries?ids=${encodeURIComponent(ids.join(','))}`, { signal },
  ),
  createTest: (input: CreateTestInput) =>
    request<CreateTestResponse>('/tests', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getTest: (id: string, signal?: AbortSignal) => request<GetTestResponse>(`/tests/${encodeURIComponent(id)}`, { signal }),
}

export type { TestDetail, TestSummary }
