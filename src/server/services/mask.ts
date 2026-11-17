import { createHash } from 'node:crypto'

export function maskKey(key: string): string {
  const value = String(key || '')
  if (value.length <= 4) return '****'
  if (value.length <= 11) return `${value.slice(0, 2)}****`
  return `${value.slice(0, 3)}****${value.slice(-4)}`
}

export function maskAddress(baseUrl: string): string {
  try {
    const url = new URL(baseUrl)
    const host = url.hostname
    if (!host) return '****'
    if (host.includes(':')) {
      return `${url.protocol}//[****]`
    }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
      const parts = host.split('.')
      return `${url.protocol}//${parts[0]}.***.***.${parts[3]}`
    }
    const labels = host.split('.').filter(Boolean)
    if (labels.length === 1) return `${url.protocol}//${labels[0].slice(0, 1)}****`
    const tld = labels[labels.length - 1]
    const first = labels[0]
    return `${url.protocol}//${first.slice(0, 1)}****.${tld}`
  } catch {
    return '****'
  }
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(String(ip || 'unknown')).digest('hex').slice(0, 32)
}

export function sanitizeError(error: unknown, rawKey?: string, maxLength = 8000): string {
  let text = error instanceof Error ? error.message : String(error ?? '未知错误')
  if (rawKey) text = text.split(rawKey).join('[key]')
  text = text
    .replace(/sk-[A-Za-z0-9._-]{8,}/g, 'sk-[redacted]')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,}"']+/gi, '$1[redacted]')
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s,}"']+/gi, '$1[redacted]')
    .replace(/\u0000/g, '')
  if (text.length > maxLength) text = `${text.slice(0, maxLength)}\n…（错误信息已截断）`
  return text
}