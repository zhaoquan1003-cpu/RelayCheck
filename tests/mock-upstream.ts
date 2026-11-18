import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'

export interface MockRequest {
  path: string
  body: Record<string, unknown>
  authorization: string
}

export interface MockUpstream {
  app: FastifyInstance
  url: string
  requests: MockRequest[]
  reset: () => void
  close: () => Promise<void>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isImageRequest(body: Record<string, unknown>): boolean {
  return JSON.stringify(body).includes('input_image') || JSON.stringify(body).includes('image_url')
}

function textFromRequest(body: Record<string, unknown>): string {
  return JSON.stringify(body)
}

function mockAnswer(body: Record<string, unknown>, model: string): string {
  if (model === 'mock-fail') return '0'
  if (model === 'mock-degraded') {
    // Reproduces the answer a weaker backend gave through the user's relay:
    // it never discovers that the shape split can be chosen, so it answers 29.
    return '总糖果数为 41。要避免满足条件，最多可以取出 28 个（全部西瓜味 12 个，圆形苹果 7 个，圆形桃子 9 个），所以答案是 29 个。'
  }
  if (model === 'mock-svg') {
    return '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120"><circle cx="60" cy="80" r="22"/><circle cx="140" cy="80" r="22"/><path d="M60 80 L100 45 L140 80"/></svg>\n```'
  }
  if (model === 'mock-svg-empty') {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>'
  }
  if (model === 'mock-svg-hostile') {
    return '```svg\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120" onload="alert(1)"><script>alert(1)</script><circle cx="60" cy="80" r="22"/><circle cx="140" cy="80" r="22"/><image href="https://example.com/x.png" width="10" height="10"/><path d="M60 80 L100 45 L140 80"/></svg>\n```'
  }
  if (model === 'mock-no-svg') return '抱歉，我无法画图，只能给出文字说明。'
  if (model === 'mock-math') {
    return '答案是 \\(21\\) 颗。\n\n| 项目 | 值 |\n| --- | --- |\n| 圆形 | 9 |\n| 星形 | 12 |\n\n因此总数为 \\(9+12=21\\)。'
  }
  if (model === 'mock-advanced' || model === 'mock-partial-advanced') {
    // A long, deterministic but irregular sequence is enough to exercise the
    // fingerprint pipeline. It is not a calibrated model sample.
    return Array.from({ length: 320 }, (_, index) => ((index * 73 + 41) % 355) + 1).join(', ')
  }
  if (isImageRequest(body)) return '答案是 21 颗。'
  if (textFromRequest(body).includes('水杯')) return '最少需要 8 次交换。'
  return '答案是 21 颗。'
}

function sendSse(reply: any, event: unknown, done = false): void {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
  if (done) reply.raw.write('data: [DONE]\n\n')
}

async function streamAnswer(
  request: FastifyRequest,
  reply: any,
  body: Record<string, unknown>,
  mode: 'responses' | 'chat',
): Promise<void> {
  const model = String(body.model || '')
  const answer = mockAnswer(body, model)
  const chunks = answer.match(/.{1,18}/gs) ?? [answer]
  reply.hijack()
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
  if (model === 'mock-timeout') {
    // Leave the connection and the Fastify handler open until the caller aborts.
    await new Promise<void>((resolve) => {
      request.raw.once('close', () => resolve())
      reply.raw.once('close', () => resolve())
    })
    return
  }
  if (model === 'mock-http-200-error') {
    reply.raw.write('data: {"type":"error","error":{"message":"mock upstream error"}}\n\n')
    reply.raw.end()
    return
  }
  for (const chunk of chunks) {
    if (mode === 'responses') {
      sendSse(reply, { type: 'response.output_text.delta', delta: chunk })
    } else {
      sendSse(reply, { choices: [{ delta: { content: chunk } }] })
    }
    if (model === 'mock-slow') await sleep(180)
    else await sleep(3)
  }
  if (mode === 'responses') {
    sendSse(reply, { type: 'response.completed', response: { output_text: answer } })
  }
  reply.raw.write('data: [DONE]\n\n')
  reply.raw.end()
}

export async function startMockUpstream(port = 0): Promise<MockUpstream> {
  const app = Fastify({ logger: false })
  const requests: MockRequest[] = []

  app.post('/v1/responses', async (request, reply) => {
    const body = (request.body || {}) as Record<string, unknown>
    requests.push({
      path: request.url,
      body,
      authorization: String(request.headers.authorization || ''),
    })
    const model = String(body.model || '')
    if (model === 'mock-partial-advanced' && requests.filter((item) => item.body.model === model).length === 2) {
      return reply.code(503).send({ error: { message: 'second fingerprint probe unavailable' } })
    }
    if (model === 'mock-error-401') {
      return reply.code(401).send({ error: { message: 'mock invalid key', type: 'authentication_error' } })
    }
    if (model === 'mock-error-503') {
      return reply.code(503).send({ error: { message: 'mock unavailable', type: 'api_error' } })
    }
    if (model === 'mock-http-200-error') {
      return reply.code(200).send({ error: { message: 'mock 200 error', type: 'upstream_error' } })
    }
    return streamAnswer(request, reply, body, 'responses')
  })

  app.post('/v1/chat/completions', async (request, reply) => {
    const body = (request.body || {}) as Record<string, unknown>
    requests.push({
      path: request.url,
      body,
      authorization: String(request.headers.authorization || ''),
    })
    const model = String(body.model || '')
    if (model === 'mock-error-401') {
      return reply.code(401).send({ error: { message: 'mock invalid key', type: 'authentication_error' } })
    }
    if (model === 'mock-http-200-error') {
      return reply.code(200).send({ error: { message: 'mock 200 error', type: 'upstream_error' } })
    }
    return streamAnswer(request, reply, body, 'chat')
  })

  await app.listen({ host: '127.0.0.1', port })
  const address = app.server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  return {
    app,
    url: `http://127.0.0.1:${actualPort}`,
    requests,
    reset: () => {
      requests.length = 0
    },
    close: async () => {
      await app.close()
    },
  }
}
