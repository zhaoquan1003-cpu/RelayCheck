export class Semaphore {
  private active = 0
  private readonly waiters = new Set<() => void>()

  constructor(private readonly max: number) {}

  acquire(signal: AbortSignal): Promise<() => void> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.waiters.delete(grant)
        reject(signal.reason ?? new Error('请求已取消'))
      }
      const grant = () => {
        this.waiters.delete(grant)
        signal.removeEventListener('abort', abort)
        if (signal.aborted) return abort()
        this.active += 1
        let released = false
        resolve(() => {
          if (released) return
          released = true
          this.active -= 1
          this.waiters.values().next().value?.()
        })
      }
      if (signal.aborted) return abort()
      if (this.active < this.max) grant()
      else {
        this.waiters.add(grant)
        signal.addEventListener('abort', abort, { once: true })
      }
    })
  }
}
