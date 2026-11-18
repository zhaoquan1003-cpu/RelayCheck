import type { ServerResponse } from 'node:http'
import type { TestDetail } from '../../shared/types'

type Listener = (test: TestDetail) => void

export class TestEventHub {
  private readonly listeners = new Map<string, Set<Listener>>()
  private readonly connections = new Set<() => void>()

  track(close: () => void): () => void {
    this.connections.add(close)
    return () => this.connections.delete(close)
  }

  closeAll(): void {
    for (const close of [...this.connections]) close()
  }

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
  reply: { raw: ServerResponse; hijack: () => void; getHeaders: () => Record<string, unknown> },
  test: TestDetail,
  hub: TestEventHub,
  onClose: () => void,
): SseConnection {
  const raw = reply.raw
  reply.hijack()
  raw.writeHead(200, {
    ...reply.getHeaders() as Record<string, string>,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-transform',
    Connection: 'keep-alive',
    'Content-Encoding': 'identity',
    'X-Accel-Buffering': 'no',
  })
  raw.write('retry: 3000\n\n')
  let closed = false
  let sending = true
  const socket = raw.socket
  const send = (value: TestDetail) => {
    if (closed || !sending) return
    const writable = raw.write(`data: ${JSON.stringify({ ok: true, test: value })}\n\n`)
    // Never accumulate snapshots behind a slow reader. It can reconnect or poll.
    if (!writable || value.status === 'completed' || value.status === 'failed') {
      stopSending()
      raw.end()
    }
  }
  const heartbeat = setInterval(() => {
    if (!closed && sending && !raw.write(': heartbeat\n\n')) close()
  }, 15_000)
  heartbeat.unref()
  const unsubscribe = hub.subscribe(test.id, send)
  const stopSending = () => {
    sending = false
    clearInterval(heartbeat)
    unsubscribe()
  }
  const cleanup = () => {
    if (closed) return
    closed = true
    stopSending()
    socket?.removeListener('timeout', close)
    untrack()
    onClose()
  }
  const close = () => { cleanup(); raw.destroy() }
  const untrack = hub.track(close)
  socket?.setTimeout(30_000, close)
  // Keep a buffered response counted and tracked until it drains or closes.
  raw.on('finish', cleanup)
  raw.on('close', cleanup)
  raw.on('error', cleanup)
  send(test)
  return { close }
}
