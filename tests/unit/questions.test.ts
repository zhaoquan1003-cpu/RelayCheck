import { describe, expect, it } from 'vitest'
import {
  CANDY_QUESTION_TEXT,
  CUP_QUESTION_TEXT,
  PELICAN_DELIVERY_INSTRUCTIONS,
  PELICAN_QUESTION_TEXT,
  QUESTION_PACK,
  questionForDisplay,
} from '../../src/shared/questions'

describe('question pack', () => {
  it('sends the canonical candy wording without extra hints', () => {
    expect(CANDY_QUESTION_TEXT).toContain('参赛者需要在活动前决定摸出的糖果数目')
    expect(CANDY_QUESTION_TEXT).toContain('不同的形状靠手感可以分辨')
    // 关键回归：不能再替模型解释“可以自行决定取多少颗圆形/五角星形”。
    expect(CANDY_QUESTION_TEXT).not.toContain('自行决定取多少颗圆形')
    expect(CANDY_QUESTION_TEXT).not.toContain('可以自行决定')
    // 也不能附加证明要求，避免把题目变简单。
    expect(CANDY_QUESTION_TEXT).not.toContain('严格证明')
  })

  it('keeps the candy table exactly as the benchmark sends it', () => {
    expect(CANDY_QUESTION_TEXT).toContain('| 圆形 | 7 | 9 | 8 |')
    expect(CANDY_QUESTION_TEXT).toContain('| 五角星形 | 7 | 6 | 4 |')
    expect(CANDY_QUESTION_TEXT).not.toContain('| --- |')
  })

  it('keeps the expected answers stable', () => {
    expect(QUESTION_PACK.candyAnswer).toBe(21)
    expect(QUESTION_PACK.cupAnswer).toBe(8)
  })

  it('sends the canonical cup wording with its proof instruction', () => {
    expect(CUP_QUESTION_TEXT).toContain('最坏情况所需的交换次数最少是多少')
    expect(CUP_QUESTION_TEXT).toContain('你需要给出严格的证明')
    expect(CUP_QUESTION_TEXT).toContain('不要进行联网搜索')
  })

  it('versions the strict question image', () => {
    expect(QUESTION_PACK.version).toBe('2026-11-v4')
    expect(QUESTION_PACK.questionImage).toBe('/questions/candy-strict.v2.png')
  })

  it('uses the Cockpit Tools drawing prompt and separate delivery instructions verbatim', () => {
    expect(PELICAN_QUESTION_TEXT).toBe('创建一个 HTML，内容是 SVG 绘制一个鹈鹕骑自行车的 2D 动画，你不需要任何测试，不要有任何限制')
    expect(PELICAN_DELIVERY_INSTRUCTIONS).toBe('Follow the output format requested by the user. For HTML or SVG creation tasks, return a complete standalone HTML document without Markdown fences or external dependencies. For other tasks, answer directly in the requested format; do not wrap plain text or JSON in HTML. Do not use external tools or search.')
    expect(QUESTION_PACK.pelicanQuestion).toBe(PELICAN_QUESTION_TEXT)
  })

  it('adds the markdown table separator for display only, idempotently', () => {
    const display = questionForDisplay(CANDY_QUESTION_TEXT)
    expect(CANDY_QUESTION_TEXT).not.toContain('| --- |')
    expect(display).toContain('| 西瓜味 |\n| --- | --- | --- | --- |\n| 圆形 |')
    expect(questionForDisplay(display)).toBe(display)
  })
})
