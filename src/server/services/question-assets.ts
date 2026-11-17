import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { QUESTION_PACK } from '../../shared/questions'

let cached: string | null = null

export function getQuestionImageDataUrl(): string {
  if (cached) return cached
  const relative = QUESTION_PACK.questionImage.replace(/^\//, '')
  const candidates = [
    resolve(process.cwd(), 'public', relative),
    resolve(process.cwd(), 'dist', 'client', relative),
  ]
  const path = candidates.find((candidate) => existsSync(candidate))
  if (!path) throw new Error('严格模式问题图片缺失')
  cached = `data:image/png;base64,${readFileSync(path).toString('base64')}`
  return cached
}

export function getQuestionImagePath(): string {
  return QUESTION_PACK.questionImage
}