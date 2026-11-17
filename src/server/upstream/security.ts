import { lookup } from 'node:dns/promises'
import type { LookupAddress } from 'node:dns'
import ipaddr from 'ipaddr.js'
import { Agent, fetch as undiciFetch } from 'undici'
import type { ApiType } from '../../shared/types'
import type { AppConfig } from '../config'
import { maskAddress } from '../services/mask'

export interface ValidatedUpstream {
  baseUrl: string
  hostname: string
  addresses: string[]
}

export class UpstreamSecurityError extends Error {
  readonly code = 'UPSTREAM_URL_REJECTED'
}

function isPublicIp(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address)
    if (parsed.kind() === 'ipv6') {
      const range = parsed.range()
      return range === 'unicast'
    }
    return parsed.range() === 'unicast'
  } catch {
    return false
  }
}

function hostMatchesAllowlist(hostname: string, allowlist: string[]): boolean {
  if (!allowlist.length) return true
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return allowlist.some((entry) => {
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(2)
      return host.endsWith(`.${suffix}`) || host === suffix
    }
    return host === entry
  })
}

function normalizeInput(input: string, allowPrivate: boolean): URL {
  const raw = input.trim()
  if (!raw) throw new UpstreamSecurityError('请填写上游地址')
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new UpstreamSecurityError('上游地址格式无效')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new UpstreamSecurityError('只支持 http/https 上游')
  }
  if (url.username || url.password) {
    throw new UpstreamSecurityError('上游地址不能包含用户名或密码')
  }
  if (url.port && url.port !== '80' && url.port !== '443' && !allowPrivate) {
    throw new UpstreamSecurityError('上游端口只允许 80 或 443')
  }
  if (url.search || url.hash) {
    throw new UpstreamSecurityError('上游地址不能包含查询参数或锚点')
  }
  if (url.pathname.includes('/../') || url.pathname.includes('/./')) {
    throw new UpstreamSecurityError('上游路径不能包含相对路径片段')
  }
  return url
}

export async function validateUpstream(
  input: string,
  config: Pick<AppConfig, 'allowPrivateUpstreams' | 'upstreamAllowlist'>,
): Promise<ValidatedUpstream> {
  const url = normalizeInput(input, config.allowPrivateUpstreams)
  const hostname = url.hostname.toLowerCase()
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new UpstreamSecurityError('不允许访问本机地址')
  }
  if (!hostMatchesAllowlist(hostname, config.upstreamAllowlist)) {
    throw new UpstreamSecurityError('上游域名不在允许列表中')
  }
  const literal = ipaddr.isValid(hostname)
  const addresses = literal ? [{ address: hostname }] : await lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length) throw new UpstreamSecurityError('上游域名无法解析')
  if (!config.allowPrivateUpstreams) {
    for (const item of addresses) {
      if (!isPublicIp(item.address)) {
        throw new UpstreamSecurityError('上游解析到私网或保留地址，已拒绝')
      }
    }
  }
  return {
    baseUrl: url.toString().replace(/\/+$/, ''),
    hostname,
    addresses: addresses.map((item) => item.address),
  }
}

export function buildUpstreamUrl(baseUrl: string, apiType: ApiType): string {
  const url = new URL(baseUrl)
  const path = url.pathname.replace(/\/+$/, '')
  const suffix = apiType === 'responses' ? '/responses' : '/chat/completions'
  if (path.endsWith('/v1/responses') || path.endsWith('/v1/chat/completions')) {
    const expected = `/v1${suffix}`
    if (!path.endsWith(expected)) {
      throw new UpstreamSecurityError('地址路径与所选接口类型不匹配')
    }
    url.pathname = path
    return url.toString()
  }
  if (path.endsWith('/v1')) {
    url.pathname = `${path}${suffix}`
  } else {
    url.pathname = `${path}/v1${suffix}`
  }
  return url.toString()
}

export async function resolveAndValidateTarget(
  input: string,
  apiType: ApiType,
  config: Pick<AppConfig, 'allowPrivateUpstreams' | 'upstreamAllowlist'>,
): Promise<{ url: string; masked: string; validated: ValidatedUpstream }> {
  const validated = await validateUpstream(input, config)
  const url = buildUpstreamUrl(validated.baseUrl, apiType)
  const parsed = new URL(url)
  if (!config.upstreamAllowlist.length) {
    // Re-check the literal host (including the path builder result).
    if (!config.allowPrivateUpstreams && ipaddr.isValid(parsed.hostname) && !isPublicIp(parsed.hostname)) {
      throw new UpstreamSecurityError('上游地址解析到私网或保留地址，已拒绝')
    }
  }
  return { url, masked: maskAddress(validated.baseUrl), validated }
}

export function createUpstreamDispatcher(config: Pick<AppConfig, 'allowPrivateUpstreams'>): Agent {
  return new Agent({
    connect: {
      timeout: 30_000,
      lookup: (hostname: string, options: any, callback: (...args: any[]) => void) => {
        lookup(hostname, { all: true, verbatim: true })
          .then((resolved: LookupAddress[]) => {
            const allowed = resolved.filter((item) => config.allowPrivateUpstreams || isPublicIp(item.address))
            if (!allowed.length || allowed.length !== resolved.length) {
              callback(new UpstreamSecurityError('上游解析到私网或保留地址，已拒绝'))
              return
            }
            const first = allowed[0]
            if (options?.all) callback(null, allowed)
            else callback(null, first.address, first.family)
          })
          .catch((error: Error) => callback(error))
      },
    },
    headersTimeout: 30_000,
    bodyTimeout: 300_000,
    connections: 32,
    pipelining: 1,
  })
}

export { undiciFetch }