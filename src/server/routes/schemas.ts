import { z } from 'zod'
import { API_TYPES, EFFORTS, TEST_MODES } from '../../shared/types'

export const createTestSchema = z.object({
  address: z.string().trim().min(1, '请填写上游地址').max(2048, '上游地址过长'),
  key: z.string().trim().min(1, '请填写 API Key').max(4096, 'API Key 过长'),
  apiType: z.enum(API_TYPES),
  model: z.string().trim().min(1, '请填写模型名称').max(200, '模型名称过长'),
  effort: z.enum(EFFORTS),
  testMode: z.enum(TEST_MODES),
})

export type CreateTestBody = z.infer<typeof createTestSchema>