export class SseConnectionLimiter {
  private readonly counts = new Map<string, number>()
  private total = 0

  constructor(private readonly maxPerIp: number, private readonly maxTotal = 200) {}

  acquire(ip: string): boolean {
    const current = this.counts.get(ip) ?? 0
    if (current >= this.maxPerIp || this.total >= this.maxTotal) return false
    this.total += 1
    this.counts.set(ip, current + 1)
    return true
  }

  release(ip: string): void {
    const current = this.counts.get(ip) ?? 0
    if (current === 0) return
    this.total -= 1
    if (current <= 1) this.counts.delete(ip)
    else this.counts.set(ip, current - 1)
  }
}
