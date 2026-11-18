import { createParser } from 'eventsource-parser'
import type { Response as UndiciResponse } from 'undici'
import type { ApiType, Effort } from '../../shared/types'
import { redactUpstreamText, sanitizeError } from '../services/mask'
import { undiciFetch } from './security'

export interface UpstreamProbeInput {
  url: string
  apiKey: string
  apiType: ApiType
  model: string
  effort: Effort
  prompt?: string
  imageDataUrl?: string
  maxAnswerBytes: number
  signal: AbortSignal
  dispatcher: unknown
}

export interface UpstreamProbeOutput {
  status: 'completed' | 'failed'
  answer: string
  error: string
  statusCode: number | null
  startedAt: number
  finishedAt: number
  durationMs: number
  firstTokenMs: number | null
}

interface StreamState {
  answer: string
  firstTokenAt: number | null
  fatalError: string | null
  finalText: string
  sawDone: boolean
  answerBytes: number
  maxAnswerBytes: number
}

function appendText(state: StreamState, text: string): void {
  const bytes = Buffer.byteLength(text)
  if (state.answerBytes + bytes > state.maxAnswerBytes) throw new Error(`回答超过 ${state.maxAnswerBytes} 字节上限`)
  if (text && state.firstTokenAt == null) state.firstTokenAt = Date.now()
  state.answer += text
  state.answerBytes += bytes
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object') {
        const record = part as Record<string, unknown>
        if (typeof record.text === 'string') return record.text
        if (typeof record.content === 'string') return record.content
      }
      return ''
    })
    .join('')
}

function errorMessageFromObject(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const nested = record.error
    if (nested && typeof nested === 'object') {
      const message = (nested as Record<string, unknown>).message
      if (typeof message === 'string') return message
    }
    if (typeof record.message === 'string') return record.message
    if (typeof record.detail === 'string') return record.detail
  }
  return ''
}

function responseFailure(record: Record<string, unknown>): string | null {
  if (record.error) return `HTTP 200 · 接口返回错误\n${errorMessageFromObject(record.error) || '上游返回错误'}`
  if (record.status != null && record.status !== 'completed') return `上游响应未完成：${String(record.status)}`
  return null
}

function extractStreamEvent(object: unknown, state: StreamState): void {
  if (!object || typeof object !== 'object') return
  const event = object as Record<string, unknown>
  const type = typeof event.type === 'string' ? event.type : ''

  if (type === 'response.output_text.delta' && typeof event.delta === 'string') {
    appendText(state, event.delta)
    return
  }
  if (type === 'response.output_text.done' && typeof event.text === 'string') {
    state.finalText = event.text
    return
  }
  if (type === 'response.completed' && event.response && typeof event.response === 'object') {
    const response = event.response as Record<string, unknown>
    state.fatalError = responseFailure(response)
    state.finalText = extractFinalText(response)
    state.sawDone = true
    return
  }
  if (type === 'response.failed' || type === 'response.incomplete' || type === 'error') {
    const response = event.response && typeof event.response === 'object' ? event.response as Record<string, unknown> : null
    const detail = errorMessageFromObject(event) || errorMessageFromObject(response?.error) || errorMessageFromObject(response) || (type === 'response.incomplete' ? '上游响应不完整' : '上游返回错误事件')
    state.fatalError = `HTTP 200 · 接口返回错误\n${detail}`
    if (response) state.finalText = extractFinalText(response)
    return
  }
  if (event.error) {
    const detail = errorMessageFromObject(event.error) || '上游返回错误'
    state.fatalError = `HTTP 200 · 接口返回错误\n${detail}`
    return
  }
  if (Array.isArray(event.choices)) {
    const choice = event.choices[0] as Record<string, unknown> | undefined
    if (!choice) return
    const delta = choice.delta as Record<string, unknown> | undefined
    const message = choice.message as Record<string, unknown> | undefined
    const text = contentToText(delta?.content) || contentToText(message?.content)
    if (text) {
      appendText(state, text)
    }
    if (choice.finish_reason != null) {
      if (choice.finish_reason === 'stop') state.sawDone = true
      else state.fatalError = `上游响应未正常完成：${String(choice.finish_reason)}`
    }
    return
  }
  if (typeof event.delta === 'string') {
    appendText(state, event.delta)
    return
  }
  if (typeof event.output_text === 'string') {
    state.finalText = event.output_text
  }
}

function extractFinalText(object: unknown): string {
  if (!object || typeof object !== 'object') return ''
  const record = object as Record<string, unknown>
  if (typeof record.output_text === 'string') return record.output_text
  const response = record.response && typeof record.response === 'object' ? record.response as Record<string, unknown> : null
  if (response) return extractFinalText(response)
  if (Array.isArray(record.output)) {
    return record.output
      .map((item) => {
        if (!item || typeof item !== 'object') return ''
        const content = (item as Record<string, unknown>).content
        return contentToText(content)
      })
      .join('')
  }
  if (Array.isArray(record.choices)) {
    const first = record.choices[0] as Record<string, unknown> | undefined
    const message = first?.message as Record<string, unknown> | undefined
    return contentToText(message?.content) || contentToText(first?.text)
  }
  return ''
}

function buildRequest(input: UpstreamProbeInput): Record<string, unknown> {
  if (!input.prompt && !input.imageDataUrl) throw new Error('内部错误：请求缺少内容')
  const imagePart = input.imageDataUrl
    ? input.apiType === 'responses'
      ? { type: 'input_image', image_url: input.imageDataUrl, detail: 'high' }
      : { type: 'image_url', image_url: { url: input.imageDataUrl, detail: 'high' } }
    : null
  const textPart = input.prompt
    ? input.apiType === 'responses'
      ? { type: 'input_text', text: input.prompt }
      : input.prompt
    : null

  if (input.apiType === 'responses') {
    const content = imagePart ? (textPart ? [textPart, imagePart] : [imagePart]) : [textPart]
    return {
      model: input.model,
      stream: true,
      store: false,
      reasoning: { effort: input.effort },
      input: [{ role: 'user', content }],
    }
  }

  const content = imagePart ? (input.prompt ? [{ type: 'text', text: input.prompt }, imagePart] : [imagePart]) : textPart
  return {
    model: input.model,
    stream: true,
    reasoning_effort: input.effort,
    messages: [{ role: 'user', content }],
  }
}

async function readTextResponse(response: UndiciResponse, maxBytes: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw new Error('上游响应体超过传输大小上限')
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

async function readErrorResponse(response: UndiciResponse): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > 8192) {
        text += decoder.decode(value.slice(0, Math.max(0, 8192 - (total - value.byteLength))), { stream: false })
        await reader.cancel().catch(() => {})
        break
      }
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return text
  } finally {
    reader.releaseLock()
  }
}

export async function runUpstreamProbe(input: UpstreamProbeInput): Promise<UpstreamProbeOutput> {
  const startedAt = Date.now()
  let statusCode: number | null = null
  let firstTokenAt: number | null = null
  let answer = ''
  const state: StreamState = {
    answer: '', firstTokenAt: null, fatalError: null, finalText: '', sawDone: false,
    answerBytes: 0, maxAnswerBytes: input.maxAnswerBytes,
  }
  // Count the answer separately from JSON framing, reasoning events and the
  // repeated final snapshot, while still bounding the total bytes received.
  const maxWireBytes = Math.max(1024 * 1024, input.maxAnswerBytes * 16)
  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${input.apiKey}`,
      'user-agent': 'RelayCheck/0.1 (+https://github.com/relaycheck)',
    }
    const response = await undiciFetch(input.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildRequest(input)),
      dispatcher: input.dispatcher as never,
      signal: input.signal,
      redirect: 'error',
    })
    statusCode = response.status
    if (!response.ok) {
      const detail = await readErrorResponse(response)
      throw new Error(`HTTP ${response.status}${detail ? `\n${detail}` : ''}`)
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase()
    if (contentType.includes('text/event-stream')) {
      const parser = createParser({
        maxBufferSize: maxWireBytes,
        onEvent(event) {
          if (state.sawDone || state.fatalError) return
          const data = event.data.trim()
          if (!data) return
          if (data === '[DONE]') {
            state.sawDone = true
            return
          }
          let parsed: unknown
          try { parsed = JSON.parse(data) }
          catch { state.fatalError = '上游 SSE 包含无效 JSON'; return }
          extractStreamEvent(parsed, state)
          if (Buffer.byteLength(state.finalText) > input.maxAnswerBytes) throw new Error(`回答超过 ${input.maxAnswerBytes} 字节上限`)
        },
        onError() {
          state.fatalError = state.fatalError || '上游 SSE 解析失败'
        },
      })
      const reader = response.body?.getReader()
      if (!reader) throw new Error('接口没有返回响应体')
      const decoder = new TextDecoder()
      let total = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.byteLength
          if (total > maxWireBytes) throw new Error('上游响应体超过传输大小上限')
          parser.feed(decoder.decode(value, { stream: true }))
          if (state.sawDone || state.fatalError) break
        }
        if (!state.fatalError) parser.feed(decoder.decode())
      } finally {
        answer = (state.answer || (Buffer.byteLength(state.finalText) <= input.maxAnswerBytes ? state.finalText : '')).trim()
        firstTokenAt = state.firstTokenAt
        await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      if (state.fatalError) throw new Error(state.fatalError)
      if (!state.sawDone) throw new Error('上游流提前结束，响应不完整')
      if (state.finalText) answer = state.finalText.trim()
      if (answer && firstTokenAt == null) firstTokenAt = Date.now()
    } else {
      const text = await readTextResponse(response, maxWireBytes)
      let parsed: unknown = null
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = null
      }
      if (!parsed || typeof parsed !== 'object') throw new Error('上游未返回有效的 JSON 或 SSE 响应')
      const record = parsed as Record<string, any>
      answer = extractFinalText(parsed).trim()
      if (Buffer.byteLength(answer) > input.maxAnswerBytes) { answer = ''; throw new Error(`回答超过 ${input.maxAnswerBytes} 字节上限`) }
      const failure = responseFailure(record) || (record.response && typeof record.response === 'object' ? responseFailure(record.response) : null)
      if (failure) throw new Error(failure)
      const finishReason = record.choices?.[0]?.finish_reason
      if (finishReason != null && finishReason !== 'stop') throw new Error(`上游响应未正常完成：${String(finishReason)}`)
      if (answer) firstTokenAt = Date.now()
    }

    if (!answer) throw new Error('接口未返回回答正文')
    if (Buffer.byteLength(answer) > input.maxAnswerBytes) {
      answer = ''
      throw new Error(`回答超过 ${input.maxAnswerBytes} 字节上限`)
    }
    const finishedAt = Date.now()
    return {
      status: 'completed',
      answer: redactUpstreamText(answer, input.apiKey, input.url),
      error: '',
      statusCode,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      firstTokenMs: firstTokenAt ? Math.max(0, firstTokenAt - startedAt) : null,
    }
  } catch (error) {
    const finishedAt = Date.now()
    const message = error instanceof Error ? error.message : String(error)
    const isAbort = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
    return {
      status: 'failed',
      answer: redactUpstreamText(answer, input.apiKey, input.url),
      error: sanitizeError(redactUpstreamText(isAbort ? '请求被中止或超时' : message, input.apiKey, input.url), input.apiKey),
      statusCode,
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      firstTokenMs: firstTokenAt ? Math.max(0, firstTokenAt - startedAt) : null,
    }
  }
}
