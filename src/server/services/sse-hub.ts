import type { ServerResponse } from 'node:http'
import type { TestDetail } from '../../shared/types'

type Listener = (test: TestDetail) => void

export class TestEventHub {
  private readonly listeners = new Map<string, Set<Listener>>()

  subscribe(testId: string, listener: Listener): () => void {
    let set = this.listeners.get(testId)
    if (!set) {
      set = new Set()
      this.listeners.set(testId, set)
    }
    set.add(listener)
    return () => {
      set?.delete(listener)
      if (set && set.size === 0) this.listeners.delete(testId)
    }
  }

  publish(testId: string, test: TestDetail): void {
    const set = this.listeners.get(testId)
    if (!set) return
    for (const listener of [...set]) {
      try {
        listener(test)
      } catch {
        set.delete(listener)
      }
    }
  }

  get listenerCount(): number {
    let total = 0
    for (const set of this.listeners.values()) total += set.size
    return total
  }
}

export interface SseConnection {
  close: () => void
}

export function openSse(
  reply: { raw: ServerResponse; hijack: () => void },
  test: TestDetail,
  hub: TestEventHub,
  onClose: () => void,
): SseConnection {
  const raw = reply.raw
  reply.hijack()
  raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'Content-Encoding': 'identity',
    'X-Accel-Buffering': 'no',
  })
  raw.write('retry: 3000\n\n')
  let closed = false
  const send = (value: TestDetail) => {
    if (closed) return
    raw.write(`data: ${JSON.stringify({ ok: true, test: value })}\n\n`)
    if (value.status === 'completed' || value.status === 'failed') {
      cleanup()
      raw.end()
    }
  }
  const heartbeat = setInterval(() => {
    if (!closed) raw.write(': heartbeat\n\n')
  }, 15_000)
  const unsubscribe = hub.subscribe(test.id, send)
  const cleanup = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    unsubscribe()
    onClose()
  }
  raw.on('close', cleanup)
  raw.on('error', cleanup)
  send(test)
  if (test.status === 'completed' || test.status === 'failed') {
    // send() has already called cleanup/end.
    cleanup()
  }
  return { close: cleanup }
}