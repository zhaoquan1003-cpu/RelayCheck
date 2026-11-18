import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig, loadModelTiers } from '../../src/server/config'
import { advancedVerdict } from '../../src/shared/verdict'
import type { Fingerprint } from '../../src/shared/types'

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }))
vi.mock('node:dns/promises', () => ({ lookup: lookupMock }))
import { createUpstreamDispatcher, undiciFetch, UpstreamSecurityError, validateUpstream } from '../../src/server/upstream/security'

const denyPrivate = { allowPrivateUpstreams: false, upstreamAllowlist: [] }

beforeEach(() => {
  lookupMock.mockReset().mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
})

describe('production configuration boundaries', () => {
  it('rejects misspelled security booleans instead of silently disabling protection', () => {
    expect(() => loadConfig({ PUBLIC_LIST_ENABLED: 'flase' })).toThrow()
    expect(() => loadConfig({ ALLOW_PRIVATE_UPSTREAMS: 'treu' })).toThrow()
    expect(loadConfig({ PUBLIC_LIST_ENABLED: ' FALSE ' }).PUBLIC_LIST_ENABLED).toBe(false)
  })

  it('rejects private upstream access in production regardless of boolean spelling', () => {
    for (const value of ['true', 'TRUE', '1', 'on', 'yes']) {
      expect(() => loadConfig({ NODE_ENV: 'production', ALLOW_PRIVATE_UPSTREAMS: value })).toThrow(/ALLOW_PRIVATE_UPSTREAMS/)
    }
    expect(loadConfig({ NODE_ENV: 'test', ALLOW_PRIVATE_UPSTREAMS: 'true' }).allowPrivateUpstreams).toBe(true)
  })

  it('does not trust proxy headers by default and accepts an explicit bounded hop count', () => {
    expect(loadConfig({}).TRUST_PROXY).toBe(false)
    expect(loadConfig({ TRUST_PROXY: 'false' }).TRUST_PROXY).toBe(false)
    expect(loadConfig({ TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1)
    expect(loadConfig({ TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2)
    for (const value of ['true', '-1', '1.5', '100', 'NaN']) {
      expect(() => loadConfig({ TRUST_PROXY: value })).toThrow()
    }
  })

  it('requires a SHA-256 digest when administrator access is enabled', () => {
    expect(loadConfig({ ADMIN_TOKEN_HASH: '' }).adminTokenHash).toBe('')
    expect(loadConfig({ ADMIN_TOKEN_HASH: 'A'.repeat(64) }).adminTokenHash).toBe('a'.repeat(64))
    for (const value of ['plain-admin-token', 'a'.repeat(63), 'g'.repeat(64)]) {
      expect(() => loadConfig({ ADMIN_TOKEN_HASH: value })).toThrow()
    }
  })

  it('bounds answer memory and timeout values before a server can start', () => {
    expect(() => loadConfig({ MAX_ANSWER_BYTES: String(1024 * 1024 * 1024) })).toThrow()
    expect(() => loadConfig({ TEST_TIMEOUT_MS: String(2 ** 32) })).toThrow()
    expect(() => loadConfig({ PORT: '65536' })).toThrow()
  })

  it('loads model tiers without inherited object properties and rejects non-object JSON', () => {
    const directory = mkdtempSync(join(tmpdir(), 'relaycheck-tiers-'))
    const file = join(directory, 'tiers.json')
    try {
      writeFileSync(file, '{"example":100}')
      const tiers = loadModelTiers(file)
      expect(tiers.example).toBe(100)
      expect(Object.getPrototypeOf(tiers)).toBeNull()
      expect(Object.hasOwn(tiers, 'constructor')).toBe(false)
      for (const invalid of ['null', '[]', '"not a table"']) {
        writeFileSync(file, invalid)
        expect(() => loadModelTiers(file)).toThrow()
      }
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('upstream URL and DNS security boundaries', () => {
  it('supports public IPv6 literals without passing bracketed addresses to DNS', async () => {
    const result = await validateUpstream('https://[2606:4700:4700::1111]/v1', denyPrivate)
    expect(result.hostname).toBe('2606:4700:4700::1111')
    expect(result.addresses).toEqual(['2606:4700:4700::1111'])
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it.each([
    'http://[::1]', 'http://[fc00::1]', 'http://[fe80::1]', 'http://[::ffff:127.0.0.1]',
    'http://[2001:db8::1]', 'http://2130706433', 'http://0x7f000001', 'http://0177.0.0.1',
    'http://169.254.169.254', 'http://100.64.0.1', 'http://0.0.0.0', 'http://localhost.',
  ])('rejects private or reserved address forms: %s', async (url) => {
    await expect(validateUpstream(url, denyPrivate)).rejects.toBeInstanceOf(UpstreamSecurityError)
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it.each(['/a/../v1', '/a/./v1', '/a/%2e%2e/v1', '/a/.%2E/v1', '/a/%2e./v1'])('rejects dot segments before URL normalization: %s', async (path) => {
    await expect(validateUpstream(`https://relay.example${path}`, denyPrivate)).rejects.toThrow(/相对路径/)
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('rejects URL whitespace and backslash normalization tricks', async () => {
    for (const url of ['https://relay.example\\v1', 'https://relay.exam\nple/v1']) {
      await expect(validateUpstream(url, denyPrivate)).rejects.toBeInstanceOf(UpstreamSecurityError)
    }
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('rejects an entire DNS result if any address is private', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }])
    await expect(validateUpstream('https://relay.example/v1', denyPrivate)).rejects.toThrow(/私网/)
  })

  it('returns a sanitized validation error when DNS fails', async () => {
    lookupMock.mockRejectedValue(new Error('getaddrinfo ENOTFOUND secret-relay.example'))
    const error = await validateUpstream('https://secret-relay.example/v1', denyPrivate).catch((error: unknown) => error)
    expect(error).toBeInstanceOf(UpstreamSecurityError)
    expect(String(error)).toContain('无法解析')
    expect(String(error)).not.toContain('secret-relay.example')
  })

  it('matches allowlisted domains at label boundaries', async () => {
    const config = { ...denyPrivate, upstreamAllowlist: ['*.relay.example'] }
    await expect(validateUpstream('https://api.relay.example', config)).resolves.toMatchObject({ hostname: 'api.relay.example' })
    await expect(validateUpstream('https://notrelay.example', config)).rejects.toThrow(/允许列表/)
    await expect(validateUpstream('https://api.relay.example.evil.example', config)).rejects.toThrow(/允许列表/)
  })

  it('rechecks DNS at connection time to reject rebinding after validation', async () => {
    await expect(validateUpstream('http://relay.invalid', denyPrivate)).resolves.toBeTruthy()
    lookupMock.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    const dispatcher = createUpstreamDispatcher(denyPrivate)
    try {
      const result = await undiciFetch('http://relay.invalid', { dispatcher, signal: AbortSignal.timeout(1000) }).catch((error: unknown) => error)
      expect(result).toBeInstanceOf(Error)
      expect((result as Error).cause).toBeInstanceOf(UpstreamSecurityError)
    } finally {
      await dispatcher.destroy()
    }
  })
})

function fingerprint(overrides: Partial<Fingerprint> = {}): Fingerprint {
  return {
    prediction: 'canonical-model', prediction_name: 'Friendly Display Name', probability: 0.9, used_outputs: 3,
    results: [], diagnostics: [], calibration: { queries: '3', beta: 1, cv_accuracy: 0.9 },
    family_prediction: 'family', family_prediction_name: 'Family', family_probability: 0.9,
    family_probabilities: [], method: 'test', ...overrides,
  }
}

describe('fingerprint model identity boundaries', () => {
  it('recognizes the canonical model ID when the display name is different', () => {
    expect(advancedVerdict('canonical-model', fingerprint(), {}).verdict).toBe('pass')
  })

  it('uses configured canonical IDs for tier comparisons', () => {
    expect(advancedVerdict('target', fingerprint(), { target: 100, 'canonical-model': 50 }).verdict).toBe('fail')
  })

  it('does not treat prototype properties as configured tier values', () => {
    expect(advancedVerdict('constructor', fingerprint({ prediction: 'toString', prediction_name: 'Another Model' }), {}).verdict).toBe('unknown')
  })

  it('does not pass an exact model match without accepted fingerprint outputs', () => {
    expect(advancedVerdict('canonical-model', fingerprint({ used_outputs: 0 }), {}).verdict).toBe('unknown')
    expect(advancedVerdict('canonical-model', fingerprint({ probability: Number.NaN }), {}).verdict).toBe('unknown')
  })
})
