import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { normalizeModelName } from '../shared/verdict'

const booleanish = z
  .union([z.boolean(), z.string().trim().toLowerCase().pipe(z.enum(['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off']))])
  .transform((value) => {
    if (typeof value === 'boolean') return value
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
  })

// Trust only explicitly configured proxy hops. A public direct connection must
// never be able to select its own rate-limit identity using X-Forwarded-For.
const trustProxy = z.union([
  z.literal(false),
  z.string().trim().toLowerCase().pipe(z.enum(['false', '0'])).transform(() => false as const),
  z.string().regex(/^[1-9]\d?$/).transform(Number),
]).default(false)

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  APP_NAME: z.string().default('RelayCheck'),
  APP_TAGLINE: z.string().default('模型测智站'),
  DEFAULT_UPSTREAM_URL: z.string().default(''),
  TEST_TIMEOUT_MS: z.coerce.number().int().positive().max(3_600_000).default(300_000),
  MAX_ANSWER_BYTES: z.coerce.number().int().positive().max(16 * 1024 * 1024).default(2 * 1024 * 1024),
  MAX_ACTIVE_JOBS: z.coerce.number().int().positive().max(64).default(4),
  MAX_QUEUE: z.coerce.number().int().positive().max(500).default(20),
  UPSTREAM_MAX_CONCURRENCY: z.coerce.number().int().positive().max(64).default(8),
  CREATE_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(30),
  ACTIVE_PER_IP: z.coerce.number().int().positive().default(2),
  LIST_PER_MINUTE: z.coerce.number().int().positive().default(120),
  SSE_MAX_PER_IP: z.coerce.number().int().positive().default(3),
  SSE_MAX_CONNECTIONS: z.coerce.number().int().positive().max(10000).default(200),
  PUBLIC_LIST_ENABLED: booleanish.default(true),
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  MAX_RECORDS: z.coerce.number().int().positive().default(500),
  ALLOW_PRIVATE_UPSTREAMS: booleanish.default(false),
  UPSTREAM_ALLOWLIST: z.string().default(''),
  ADMIN_TOKEN_HASH: z.string().trim().regex(/^(?:[a-fA-F0-9]{64})?$/).default(''),
  TRUST_PROXY: trustProxy,
  MODEL_TIERS_FILE: z.string().default('./config/model-tiers.json'),
})

export type AppConfig = ReturnType<typeof loadConfig>

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env)
  if (parsed.NODE_ENV === 'production' && parsed.ALLOW_PRIVATE_UPSTREAMS) {
    throw new Error('生产环境禁止启用 ALLOW_PRIVATE_UPSTREAMS')
  }
  const dataDir = resolve(parsed.DATA_DIR)
  const modelTiersFile = resolve(parsed.MODEL_TIERS_FILE)
  return {
    ...parsed,
    dataDir,
    modelTiersFile,
    isProduction: parsed.NODE_ENV === 'production',
    isTest: parsed.NODE_ENV === 'test',
    allowPrivateUpstreams: parsed.ALLOW_PRIVATE_UPSTREAMS,
    upstreamAllowlist: parsed.UPSTREAM_ALLOWLIST
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
    adminTokenHash: parsed.ADMIN_TOKEN_HASH.trim().toLowerCase(),
  }
}

export function loadModelTiers(file: string): Record<string, number> {
  if (!existsSync(file)) return {}
  const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) as Record<string, unknown>
  const output: Record<string, number> = Object.create(null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('模型等级表必须是 JSON 对象')
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      output[normalizeModelName(key)] = value
    }
  }
  return output
}
