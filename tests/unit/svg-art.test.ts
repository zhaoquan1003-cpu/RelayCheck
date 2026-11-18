import { describe, expect, it } from 'vitest'
import { MAX_SVG_BYTES, extractSvgMarkup, inspectSvg } from '../../src/shared/svg-art'
import { pelicanVerdict } from '../../src/shared/verdict'

const GOOD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 120">' +
  '<circle cx="60" cy="80" r="22"/><circle cx="140" cy="80" r="22"/>' +
  '<path d="M60 80 L100 45 L140 80"/></svg>'

describe('extractSvgMarkup', () => {
  it('extracts an SVG from a fenced code block', () => {
    const answer = "好的，下面是代码：\n\n```svg\n" + GOOD_SVG + '\n```\n\n希望你喜欢。'
    expect(extractSvgMarkup(answer)).toEqual({ markup: GOOD_SVG, tooLarge: false })
  })

  it('extracts an inline SVG from surrounding prose', () => {
    const answer = `这是结果：${GOOD_SVG} 以上。`
    expect(extractSvgMarkup(answer).markup).toBe(GOOD_SVG)
  })

  it('handles uppercase tags', () => {
    expect(extractSvgMarkup('<SVG VIEWBOX="0 0 1 1"></SVG>').markup).toBe('<SVG VIEWBOX="0 0 1 1"></SVG>')
  })

  it('returns null when no SVG is present', () => {
    expect(extractSvgMarkup('我画不出来。')).toEqual({ markup: null, tooLarge: false })
    expect(extractSvgMarkup('')).toEqual({ markup: null, tooLarge: false })
  })

  it('flags oversized drawings', () => {
    const huge = `<svg>${'<path d="M0 0"/>'.repeat(Math.ceil(MAX_SVG_BYTES / 15) + 100)}</svg>`
    expect(extractSvgMarkup(huge)).toEqual({ markup: null, tooLarge: true })
  })
})

describe('inspectSvg', () => {
  it('counts drawing elements', () => {
    const inspection = inspectSvg(GOOD_SVG)
    expect(inspection.complete).toBe(true)
    expect(inspection.elements).toBe(3)
    expect(inspection.circles).toBe(2)
    expect(inspection.paths).toBe(1)
    expect(inspection.risky).toEqual([])
  })

  it('flags scripts, event handlers and external references', () => {
    const hostile =
      '<svg onload="alert(1)"><script>alert(1)</script><foreignObject></foreignObject>' +
      '<image href="https://example.com/x.png"/></svg>'
    const inspection = inspectSvg(hostile)
    expect(inspection.risky).toContain('脚本')
    expect(inspection.risky).toContain('事件属性')
    expect(inspection.risky).toContain('foreignObject')
    expect(inspection.risky).toContain('外部引用')
  })

  it('marks incomplete markup', () => {
    expect(inspectSvg('<svg><circle cx="1" cy="1" r="1"/>').complete).toBe(false)
  })
})

describe('pelicanVerdict', () => {
  it('accepts a structurally valid drawing as manual review', () => {
    const decision = pelicanVerdict('```svg\n' + GOOD_SVG + '\n```')
    expect(decision.verdict).toBe('unknown')
    expect(decision.reason).toContain('沙箱中查看动画')
    expect(decision.reason).toContain('人工判读')
  })

  it('keeps missing drawings neutral rather than inferring model quality', () => {
    const decision = pelicanVerdict('抱歉，我只能输出文字。')
    expect(decision.verdict).toBe('unknown')
    expect(decision.reason).toContain('没有找到')
  })

  it('does not infer model quality from SVG element counts', () => {
    const decision = pelicanVerdict('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    expect(decision.verdict).toBe('unknown')
    expect(decision.reason).toContain('人工判读')
  })

  it('leaves SVG script isolation to the sandboxed preview', () => {
    const decision = pelicanVerdict(
      '<svg><script>alert(1)</script><circle cx="1" cy="1" r="1"/><path d="M0 0 L1 1"/></svg>',
    )
    expect(decision.verdict).toBe('unknown')
    expect(decision.reason).toContain('沙箱中查看动画')
  })
})
