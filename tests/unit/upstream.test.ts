import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Agent } from 'undici'
import { describe, expect, it } from 'vitest'
import { runUpstreamProbe, type UpstreamProbeInput } from '../../src/server/upstream/client'

type Handler = (response: ServerResponse, request: IncomingMessage, body: Record<string, any>) => void
const KEY = 'test-secret-1234567890'
const sse = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`
const delta = (text: string) => sse({ type: 'response.output_text.delta', delta: text })
const completed = (text: string) => sse({ type: 'response.completed', response: { status: 'completed', output_text: text } })

async function withUpstream<T>(handler: Handler, test: (probe: (overrides?: Partial<UpstreamProbeInput>) => ReturnType<typeof runUpstreamProbe>, url: string) => Promise<T>): Promise<T> {
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += String(chunk)
    handler(response, request, JSON.parse(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  const url = `http://127.0.0.1:${address.port}/v1/responses`
  const dispatcher = new Agent()
  try {
    return await test((overrides = {}) => runUpstreamProbe({
      url, apiKey: KEY, apiType: 'responses', model: 'mock', effort: 'low', prompt: 'answer',
      maxAnswerBytes: 1024, signal: AbortSignal.timeout(3000), dispatcher, ...overrides,
    }), url)
  } finally {
    await dispatcher.destroy()
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

function stream(response: ServerResponse, payload: string, end = true): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  if (end) response.end(payload)
  else response.write(payload)
}

describe('upstream response integrity', () => {
  it('rejects a truncated stream even when its partial answer contains the expected number', async () => {
    await withUpstream((response) => stream(response, delta('答案是 21')), async (probe) => {
      const result = await probe()
      expect(result.status).toBe('failed')
      expect(result.answer).toBe('答案是 21')
      expect(result.error).toContain('不完整')
      expect(result.firstTokenMs).not.toBeNull()
    })
  })

  it('extracts Responses output from a completion event without requiring deltas', async () => {
    await withUpstream((response) => stream(response, sse({
      type: 'response.completed', response: { status: 'completed', output: [{
        type: 'message', content: [{ type: 'output_text', text: '答案是 21' }],
      }] },
    })), async (probe) => {
      const result = await probe()
      expect(result.status).toBe('completed')
      expect(result.answer).toBe('答案是 21')
      expect(result.firstTokenMs).not.toBeNull()
    })
  })

  it('finishes and cancels the response body after completion even if the upstream keeps it open', async () => {
    let closed = false
    await withUpstream((response) => {
      response.on('close', () => { closed = true })
      stream(response, delta('21') + completed('21'), false)
    }, async (probe) => {
      const result = await probe()
      expect(result.status).toBe('completed')
      expect(result.answer).toBe('21')
      await expect.poll(() => closed).toBe(true)
    })
  })

  it.each(['response.failed', 'response.incomplete', 'error'])('retains partial evidence and cancels on %s', async (type) => {
    let closed = false
    await withUpstream((response) => {
      response.on('close', () => { closed = true })
      stream(response, delta('partial 21') + sse({ type, response: { error: { message: 'test upstream failure' } } }), false)
    }, async (probe) => {
      const result = await probe()
      expect(result.status).toBe('failed')
      expect(result.answer).toBe('partial 21')
      expect(result.error).toContain('test upstream failure')
      await expect.poll(() => closed).toBe(true)
    })
  })

  it('rejects malformed SSE rather than silently omitting corrupted content', async () => {
    await withUpstream((response) => stream(response, delta('21') + 'data: {broken json}\n\n' + completed('21')), async (probe) => {
      const result = await probe()
      expect(result.status).toBe('failed')
      expect(result.answer).toBe('21')
      expect(result.error).toContain('JSON')
    })
  })

  it('honors a failed response object inside a response.completed event', async () => {
    await withUpstream((response) => stream(response, sse({
      type: 'response.completed', response: { status: 'failed', error: { message: 'inference failed' }, output_text: '21' },
    })), async (probe) => {
      const result = await probe()
      expect(result.status).toBe('failed')
      expect(result.error).toMatch(/failed|inference failed/)
    })
  })

  it.each(['failed', 'incomplete'])('does not turn a wrapped %s JSON response into a successful answer', async (status) => {
    await withUpstream((response) => response.end(JSON.stringify({ response: { status, output_text: '21' } })), async (probe) => {
      const result = await probe()
      expect(result.status).toBe('failed')
      expect(result.error).toContain(status)
    })
  })

  it('handles UTF-8 characters split across network chunks', async () => {
    await withUpstream((response) => {
      const bytes = Buffer.from(delta('答案 21') + completed('答案 21'))
      const split = bytes.indexOf(Buffer.from('答')) + 1
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write(bytes.subarray(0, split))
      setImmediate(() => response.end(bytes.subarray(split)))
    }, async (probe) => {
      const result = await probe()
      expect(result.status).toBe('completed')
      expect(result.answer).toBe('答案 21')
    })
  })

  it.each(['length', 'content_filter', 'tool_calls'])('rejects a Chat stream ending with %s', async (finishReason) => {
    await withUpstream((response) => stream(response,
      sse({ choices: [{ delta: { content: '21' }, finish_reason: null }] }) +
      sse({ choices: [{ delta: {}, finish_reason: finishReason }] }) + 'data: [DONE]\n\n',
    ), async (probe) => {
      const result = await probe({ apiType: 'chat_completions' })
      expect(result.status).toBe('failed')
      expect(result.answer).toBe('21')
      expect(result.error).toContain(finishReason)
    })
  })

  it('accepts Chat stop completion without waiting for EOF or DONE', async () => {
    await withUpstream((response) => stream(response,
      sse({ choices: [{ delta: { content: '21' }, finish_reason: 'stop' }] }), false,
    ), async (probe) => {
      const result = await probe({ apiType: 'chat_completions' })
      expect(result.status).toBe('completed')
      expect(result.answer).toBe('21')
    })
  })

  it.each([
    { error: { message: 'upstream failed' } },
    { status: 'incomplete', output_text: '21' },
    { choices: [{ message: { content: '21' }, finish_reason: 'length' }] },
    { message: 'HTTP 200 does not imply successful inference' },
  ])('rejects an unsuccessful HTTP 200 JSON response: %j', async (body) => {
    await withUpstream((response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(body))
    }, async (probe) => {
      const result = await probe()
      expect(result.status).toBe('failed')
      expect(result.statusCode).toBe(200)
    })
  })

  it('rejects plain text and HTML error pages that happen to contain 21', async () => {
    await withUpstream((response) => response.end('<html>Error 21</html>'), async (probe) => {
      const result = await probe()
      expect(result.status).toBe('failed')
      expect(result.answer).toBe('')
    })
  })

  it('serializes text and image content as objects for Chat multimodal requests', async () => {
    let sent: Record<string, any> = {}
    await withUpstream((response, _request, body) => {
      sent = body
      response.end(JSON.stringify({ choices: [{ message: { content: '21' }, finish_reason: 'stop' }] }))
    }, async (probe) => {
      expect((await probe({ apiType: 'chat_completions', prompt: 'look', imageDataUrl: 'data:image/png;base64,AA==' })).status).toBe('completed')
      expect(sent.messages[0].content).toEqual([
        { type: 'text', text: 'look' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AA==', detail: 'high' } },
      ])
    })
  })

  it('does not follow redirects or forward credentials to the redirect destination', async () => {
    const paths: string[] = []
    await withUpstream((response, request) => {
      paths.push(request.url || '')
      if (request.url === '/v1/responses') {
        response.writeHead(302, { location: '/redirected' })
        response.end()
      } else response.end(JSON.stringify({ output_text: '21' }))
    }, async (probe) => {
      expect((await probe()).status).toBe('failed')
      expect(paths).toEqual(['/v1/responses'])
    })
  })
})

describe('upstream size and privacy boundaries', () => {
  it('limits answer bytes separately from SSE framing and the repeated final answer', async () => {
    const answer = '答案 21'
    await withUpstream((response) => stream(response,
      [...answer].map((character) => delta(character)).join('') + completed(answer),
    ), async (probe) => {
      const result = await probe({ maxAnswerBytes: Buffer.byteLength(answer) })
      expect(result.status).toBe('completed')
      expect(result.answer).toBe(answer)
    })
  })

  it('enforces UTF-8 bytes rather than JavaScript string length and retains the bounded prefix', async () => {
    await withUpstream((response) => stream(response, delta('21') + delta('答'.repeat(8)) + completed('21' + '答'.repeat(8))), async (probe) => {
      const result = await probe({ maxAnswerBytes: 12 })
      expect(result.status).toBe('failed')
      expect(result.error).toContain('12')
      expect(result.answer).toBe('21')
    })
  })

  it('enforces the answer limit on JSON responses too', async () => {
    await withUpstream((response) => response.end(JSON.stringify({ output_text: '答'.repeat(8) })), async (probe) => {
      const result = await probe({ maxAnswerBytes: 12 })
      expect(result.status).toBe('failed')
      expect(result.error).toContain('12')
      expect(result.answer).toBe('')
    })
  })

  it('bounds oversized SSE events that do not contain answer text', async () => {
    await withUpstream((response) => stream(response, sse({ type: 'response.reasoning.delta', delta: 'x'.repeat(1024 * 1024 + 1) })), async (probe) => {
      const result = await probe({ maxAnswerBytes: 12 })
      expect(result.status).toBe('failed')
      expect(result.error).toMatch(/大小上限|解析失败/)
    })
  })

  it('cancels an oversized non-SSE response that keeps its connection open', async () => {
    let closed = false
    await withUpstream((response) => {
      response.on('close', () => { closed = true })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.write('x'.repeat(1024 * 1024 + 1))
    }, async (probe) => {
      const result = await probe({ maxAnswerBytes: 12 })
      expect(result.status).toBe('failed')
      expect(result.error).toContain('传输大小上限')
      await expect.poll(() => closed).toBe(true)
    })
  })

  it('does not publish a secret-bearing oversized final snapshot as a successful answer', async () => {
    await withUpstream((response) => stream(response, delta(`21 ${KEY}`) + completed(`${KEY} ${'x'.repeat(128)}`)), async (probe) => {
      const result = await probe({ maxAnswerBytes: 64 })
      expect(result.status).toBe('failed')
      expect(result.answer).toBe('21 [key]')
      expect(result.error).toContain('64')
      expect(JSON.stringify(result)).not.toContain(KEY)
      expect(result.answer).not.toContain('x'.repeat(128))
    })
  })

  it.each(['json', 'sse', 'http-error'])('redacts raw and URL-encoded keys and addresses from %s', async (format) => {
    let echo = ''
    const secret = 'private-key+/1234567890'
    await withUpstream((response) => {
      if (format === 'sse') {
        const middle = Math.floor(echo.length / 2)
        stream(response, delta(echo.slice(0, middle)) + delta(echo.slice(middle)) + completed(echo))
      } else {
        response.writeHead(format === 'http-error' ? 401 : 200, { 'content-type': 'application/json' })
        response.end(JSON.stringify(format === 'http-error' ? { error: { message: echo } } : { output_text: echo }))
      }
    }, async (probe, url) => {
      echo = `${secret} ${encodeURIComponent(secret)} ${url} ${encodeURIComponent(url)} host=${new URL(url).hostname}`
      const result = await probe({ apiKey: secret, maxAnswerBytes: 4096 })
      expect(result.status).toBe(format === 'http-error' ? 'failed' : 'completed')
      const serialized = JSON.stringify(result)
      for (const value of [secret, encodeURIComponent(secret), url, encodeURIComponent(url), new URL(url).hostname]) {
        expect(serialized).not.toContain(value)
      }
      expect(serialized).toContain('[key]')
      expect(serialized).toContain('[upstream]')
    })
  })

  it('redacts partial evidence when the stream fails after echoing credentials', async () => {
    await withUpstream((response) => stream(response, delta(`partial ${KEY}`) + sse({ type: 'error', error: { message: `bad ${KEY}` } })), async (probe) => {
      const result = await probe()
      expect(result.status).toBe('failed')
      expect(result.answer).toContain('[key]')
      expect(JSON.stringify(result)).not.toContain(KEY)
    })
  })
})
