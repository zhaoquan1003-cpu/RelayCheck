import { describe, expect, it } from 'vitest'
import { buildUpstreamUrl, validateUpstream, UpstreamSecurityError } from '../../src/server/upstream/security'

const denyPrivate = { allowPrivateUpstreams: false, upstreamAllowlist: [] }
const allowPrivate = { allowPrivateUpstreams: true, upstreamAllowlist: [] }

describe('upstream URL security', () => {
  it('rejects credentials, non-http schemes, query strings and unusual ports', async () => {
    await expect(validateUpstream('ftp://example.com', denyPrivate)).rejects.toBeInstanceOf(UpstreamSecurityError)
    await expect(validateUpstream('https://user@example.com', denyPrivate)).rejects.toBeInstanceOf(UpstreamSecurityError)
    await expect(validateUpstream('https://example.com/?a=1', denyPrivate)).rejects.toBeInstanceOf(UpstreamSecurityError)
    await expect(validateUpstream('https://example.com:8443', denyPrivate)).rejects.toBeInstanceOf(UpstreamSecurityError)
  })

  it('rejects private and loopback literals in production mode', async () => {
    await expect(validateUpstream('http://127.0.0.1:3000', denyPrivate)).rejects.toBeInstanceOf(UpstreamSecurityError)
    await expect(validateUpstream('http://10.0.0.1', denyPrivate)).rejects.toBeInstanceOf(UpstreamSecurityError)
    await expect(validateUpstream('http://[::1]', denyPrivate)).rejects.toBeInstanceOf(UpstreamSecurityError)
  })

  it('allows private upstreams only when explicitly enabled', async () => {
    const result = await validateUpstream('http://127.0.0.1:3000', allowPrivate)
    expect(result.baseUrl).toBe('http://127.0.0.1:3000')
  })

  it('builds the correct OpenAI-compatible path', () => {
    expect(buildUpstreamUrl('https://relay.example.com', 'responses')).toBe('https://relay.example.com/v1/responses')
    expect(buildUpstreamUrl('https://relay.example.com/v1', 'chat_completions')).toBe(
      'https://relay.example.com/v1/chat/completions',
    )
    expect(buildUpstreamUrl('https://relay.example.com/v1/responses', 'responses')).toBe(
      'https://relay.example.com/v1/responses',
    )
    expect(() => buildUpstreamUrl('https://relay.example.com/v1/responses', 'chat_completions')).toThrow()
  })
})