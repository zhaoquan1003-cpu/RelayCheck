import type {
  ApiErrorBody,
  ConfigResponse,
  CreateTestInput,
  CreateTestResponse,
  GetTestResponse,
  ListTestsResponse,
  TestDetail,
  TestSummary,
} from '../../shared/types'

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
  const response = await fetch(`/api/v1${path}`, {
    ...init,
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
  listTests: (page: number) => request<ListTestsResponse>(`/tests?page=${Math.max(1, page)}`),
  createTest: (input: CreateTestInput) =>
    request<CreateTestResponse>('/tests', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  getTest: (id: string) => request<GetTestResponse>(`/tests/${encodeURIComponent(id)}`),
}

export type { TestDetail, TestSummary }