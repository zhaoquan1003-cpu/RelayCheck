import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import { normalizeModelName } from '../shared/verdict'

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) => {
    if (typeof value === 'boolean') return value
    return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
  })

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  APP_NAME: z.string().default('RelayCheck'),
  APP_TAGLINE: z.string().default('模型测智站'),
  DEFAULT_UPSTREAM_URL: z.string().default(''),
  PUBLIC_BASE_URL: z.string().default(''),
  TEST_TIMEOUT_MS: z.coerce.number().int().positive().default(300_000),
  MAX_ANSWER_BYTES: z.coerce.number().int().positive().default(2 * 1024 * 1024),
  MAX_ACTIVE_JOBS: z.coerce.number().int().positive().max(64).default(4),
  MAX_QUEUE: z.coerce.number().int().positive().max(500).default(20),
  UPSTREAM_MAX_CONCURRENCY: z.coerce.number().int().positive().max(64).default(8),
  CREATE_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(6),
  ACTIVE_PER_IP: z.coerce.number().int().positive().default(2),
  LIST_PER_MINUTE: z.coerce.number().int().positive().default(120),
  SSE_MAX_PER_IP: z.coerce.number().int().positive().default(3),
  PUBLIC_LIST_ENABLED: booleanish.default(true),
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  MAX_RECORDS: z.coerce.number().int().positive().default(500),
  ALLOW_PRIVATE_UPSTREAMS: booleanish.default(false),
  UPSTREAM_ALLOWLIST: z.string().default(''),
  ADMIN_TOKEN_HASH: z.string().default(''),
  TRUST_PROXY: booleanish.default(true),
  MODEL_TIERS_FILE: z.string().default('./config/model-tiers.json'),
})

export type AppConfig = ReturnType<typeof loadConfig>

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.parse(env)
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
  const output: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      output[normalizeModelName(key)] = value
    }
  }
  return output
}