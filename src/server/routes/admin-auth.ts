import { createHash, timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'

export function adminTokenMatches(request: FastifyRequest, tokenHash: string): boolean {
  if (!tokenHash) return false
  const header = request.headers.authorization || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  if (!match) return false
  const digest = createHash('sha256').update(match[1]).digest('hex')
  const left = Buffer.from(digest, 'utf8')
  const right = Buffer.from(tokenHash, 'utf8')
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

export function hashAdminToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}