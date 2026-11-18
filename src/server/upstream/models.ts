import type { Dispatcher } from 'undici'
import type { AppConfig } from '../config'
import { HttpError } from '../errors'
import { undiciFetch, validateUpstream, UpstreamSecurityError } from './security'

const MAX_MODELS_BYTES = 1024 * 1024
const MODELS_TIMEOUT_MS = 10_000

export function buildModelsUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  const path = url.pathname.replace(/\/+$/, '').replace(/\/v1\/(?:responses|chat\/completions|models)$/, '/v1')
  url.pathname = `${path.endsWith('/v1') ? path : `${path}/v1`}/models`
  return url.toString()
}

export async function fetchUpstreamModels(
  input: { address: string; key: string },
  config: Pick<AppConfig, 'allowPrivateUpstreams' | 'upstreamAllowlist'>,
  dispatcher: Dispatcher,
  clientSignal?: AbortSignal,
): Promise<Array<{ id: string }>> {
  const timeoutSignal = AbortSignal.timeout(MODELS_TIMEOUT_MS)
  const signal = clientSignal ? AbortSignal.any([clientSignal, timeoutSignal]) : timeoutSignal
  let onAbort: (() => void) | undefined
  try {
    signal.throwIfAborted()
    // DNS lookup itself is not abortable, but cancellation must release the
    // request's concurrency slot without waiting for it to finish.
    const cancelled = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
    })
    const target = await Promise.race([validateUpstream(input.address, config), cancelled])
    signal.throwIfAborted()
    const response = await undiciFetch(buildModelsUrl(target.baseUrl), {
      method: 'GET',
      headers: { authorization: `Bearer ${input.key}`, accept: 'application/json' },
      redirect: 'manual',
      signal,
      dispatcher,
    })
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      const hint = response.status === 401 || response.status === 403
        ? '，请检查 API Key 和模型列表访问权限'
        : response.status === 404 ? '，请检查中转地址是否支持模型列表' : ''
      throw new HttpError(502, 'UPSTREAM_MODELS_FAILED', `获取模型失败（HTTP ${response.status}）${hint}。`)
    }
    if (!response.body) throw new HttpError(502, 'INVALID_MODEL_LIST', '中转返回的模型列表格式无效。')

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let bytes = 0
    let text = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        bytes += value.byteLength
        if (bytes > MAX_MODELS_BYTES) {
          throw new HttpError(502, 'MODEL_LIST_TOO_LARGE', '中转返回的模型列表过大。')
        }
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }

    let payload: unknown
    try { payload = JSON.parse(text) }
    catch { throw new HttpError(502, 'INVALID_MODEL_LIST', '中转返回的模型列表格式无效。') }
    const data = payload && typeof payload === 'object' ? (payload as { data?: unknown }).data : null
    if (!Array.isArray(data)) throw new HttpError(502, 'INVALID_MODEL_LIST', '中转返回的模型列表格式无效。')
    const ids = new Set<string>()
    for (const item of data) {
      const id = item && typeof item === 'object' && typeof item.id === 'string' ? item.id.trim() : ''
      if (id && id.length <= 200 && !/[\u0000-\u001f\u007f]/.test(id)) ids.add(id)
    }
    if (data.length && !ids.size) throw new HttpError(502, 'INVALID_MODEL_LIST', '中转没有返回有效的模型 ID。')
    return [...ids].map((id) => ({ id }))
  } catch (error) {
    if (error instanceof HttpError || error instanceof UpstreamSecurityError) throw error
    if (signal.aborted && signal.reason === timeoutSignal.reason) {
      throw new HttpError(504, 'MODEL_LIST_TIMEOUT', '获取模型超时，请稍后重试。')
    }
    if (clientSignal?.aborted) throw new HttpError(499, 'MODEL_LIST_CANCELLED', '已取消获取模型。')
    throw new HttpError(502, 'UPSTREAM_MODELS_FAILED', '无法获取模型，请检查中转地址和网络后重试。')
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
}
