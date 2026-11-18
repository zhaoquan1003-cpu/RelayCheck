import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { openSse, TestEventHub } from '../../src/server/services/sse-hub'
import type { TestDetail } from '../../src/shared/types'

class TestSocket extends EventEmitter {
  setTimeout(_milliseconds: number, listener: () => void) { this.on('timeout', listener); return this }
}

class SlowResponse extends EventEmitter {
  socket = new TestSocket()
  writeHead = vi.fn()
  write = vi.fn(() => false)
  end = vi.fn()
  destroy = vi.fn(() => { this.emit('close'); return this })
}

describe('SSE backpressure lifecycle', () => {
  it('keeps a response that is draining counted and tracked until its socket closes', () => {
    const raw = new SlowResponse()
    const hub = new TestEventHub()
    const released = vi.fn()
    const connection = openSse({
      raw: raw as unknown as ServerResponse, hijack: vi.fn(), getHeaders: () => ({}),
    }, { id: '0000000000000001', status: 'running' } as TestDetail, hub, released)
    expect(raw.end).toHaveBeenCalledOnce()
    expect(hub.listenerCount).toBe(0)
    expect(released).not.toHaveBeenCalled()
    // An end() with buffered bytes is not a completed connection. Shutdown must
    // still be able to destroy it even after we stop publishing snapshots.
    hub.closeAll()
    expect(raw.destroy).toHaveBeenCalledOnce()
    expect(released).toHaveBeenCalledOnce()
    expect(raw.socket.listenerCount('timeout')).toBe(0)
    connection.close()
    expect(released).toHaveBeenCalledOnce()
  })

  it('releases capacity and timeout listeners after the final bytes finish flushing', () => {
    const raw = new SlowResponse()
    const hub = new TestEventHub()
    const released = vi.fn()
    openSse({
      raw: raw as unknown as ServerResponse, hijack: vi.fn(), getHeaders: () => ({}),
    }, { id: '0000000000000001', status: 'completed' } as TestDetail, hub, released)
    expect(released).not.toHaveBeenCalled()
    raw.emit('finish')
    expect(released).toHaveBeenCalledOnce()
    expect(raw.socket.listenerCount('timeout')).toBe(0)
    hub.closeAll()
    expect(raw.destroy).not.toHaveBeenCalled()
  })
})
