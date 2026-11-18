import { describe, expect, it } from 'vitest'
import { extractDrawingArtifact, MAX_DRAWING_BYTES } from '../../src/shared/drawing-art'
import { pelicanVerdict } from '../../src/shared/verdict'
import { HTML_ANIMATION, HTML_DYNAMIC_SVG, HTML_TRUNCATED } from '../fixtures/drawing-answers'

describe('drawing artifact extraction', () => {
  it('keeps the complete HTML, including styles, scripts and controls, byte for byte', () => {
    expect(extractDrawingArtifact(`说明\n\n\`\`\`html\n${HTML_ANIMATION}\n\`\`\`\n后文`)).toEqual({ kind: 'html', source: HTML_ANIMATION, error: null })
    expect(extractDrawingArtifact(`说明：${HTML_ANIMATION}\n后文`).source).toBe(HTML_ANIMATION)
  })

  it('accepts scripts that create the SVG at runtime without counting elements', () => {
    expect(HTML_DYNAMIC_SVG).not.toMatch(/<svg[\s>]/i)
    expect(extractDrawingArtifact(HTML_DYNAMIC_SVG).source).toBe(HTML_DYNAMIC_SVG)
    expect(pelicanVerdict(HTML_DYNAMIC_SVG).verdict).toBe('unknown')
  })

  it('requires an HTML or SVG root rather than treating arbitrary fragments as documents', () => {
    const fragment = '<style>div{color:blue}</style><div>animation</div><script>requestAnimationFrame(() => {})</script>'
    expect(extractDrawingArtifact(`\`\`\`html\n${fragment}\n\`\`\``)).toEqual({ kind: null, source: null, error: 'missing' })
  })

  it('previews a complete root unchanged without imposing extra child-tag validation', () => {
    const source = '<html><body><div><svg><circle r="5"/></svg></body></html>'
    expect(extractDrawingArtifact(source)).toEqual({ kind: 'html', source, error: null })
  })

  it.each(['html', 'svg', 'xml', ''])('accepts a complete SVG in a %s fence', (language) => {
    const source = '<svg viewBox="0 0 10 10"><circle r="5"/></svg>'
    expect(extractDrawingArtifact(`\`\`\`${language}\n${source}\n\`\`\``)).toEqual({ kind: 'svg', source, error: null })
  })

  it('uses the first complete eligible block, skipping an earlier incomplete candidate', () => {
    const source = '```html\n<html><body>unfinished\n```\n```xml\n<svg></svg>\n```'
    expect(extractDrawingArtifact(source)).toEqual({ kind: 'svg', source: '<svg></svg>', error: null })
  })

  it('does not preview a complete root inside an unclosed code fence', () => {
    for (const language of ['html', 'svg', 'xml', '']) {
      expect(extractDrawingArtifact(`\`\`\`${language}\n<svg></svg>`).error).toBe('incomplete')
    }
  })

  it('keeps non-ASCII text and uppercase roots intact', () => {
    const source = '<!DOCTYPE html><HTML><BODY>İ 鹈鹕</BODY></HTML>'
    expect(extractDrawingArtifact(`İ 说明：${source}\n完成`).source).toBe(source)
  })

  it('does not mistake HTML closing tags inside scripts, styles or comments for the document end', () => {
    const source = '<html><head><style>body::before{content:"</html>"}</style></head><body><!-- </html> --><script>const label = "</html>";</script><svg><path d="M0 0"/></svg></body></html>'
    expect(extractDrawingArtifact(source).source).toBe(source)
  })

  it('prefers a complete HTML document over an SVG tag mentioned in the explanation', () => {
    expect(extractDrawingArtifact(`这里用 <svg> 绘图：\n${HTML_ANIMATION}`).source).toBe(HTML_ANIMATION)
  })

  it('rejects incomplete HTML instead of extracting its otherwise complete SVG', () => {
    for (const source of [HTML_TRUNCATED, '<html><body><svg></svg>', '```html\n<html><body><svg></svg>\n```']) {
      expect(extractDrawingArtifact(source)).toEqual({ kind: null, source: null, error: 'incomplete' })
      expect(pelicanVerdict(source).verdict).toBe('unknown')
    }
  })

  it('measures UTF-8 bytes and accepts exactly the preview limit', () => {
    const wrap = '<html><body></body></html>'
    const exact = `<html><body>${'x'.repeat(MAX_DRAWING_BYTES - wrap.length)}</body></html>`
    expect(extractDrawingArtifact(exact).kind).toBe('html')
    expect(extractDrawingArtifact(exact.replace('x', '鸟')).error).toBe('too_large')
    expect(pelicanVerdict(exact.replace('x', '鸟')).verdict).toBe('unknown')
  })

  it('handles deeply nested generated markup without overflowing the call stack', () => {
    const source = `<html><body>${'<div>'.repeat(6000)}<svg></svg>${'</div>'.repeat(6000)}</body></html>`
    expect(extractDrawingArtifact(source).source).toBe(source)
  })

  it('preserves explicit SVG animation scripts and keeps missing answers neutral', () => {
    const svg = '<svg><script>const html = "<html></html>";</script><path d="M0 0"/></svg>'
    expect(extractDrawingArtifact(`\`\`\`svg\n${svg}\n\`\`\``)).toEqual({ kind: 'svg', source: svg, error: null })
    expect(extractDrawingArtifact(svg).kind).toBe('svg')
    expect(extractDrawingArtifact('')).toEqual({ kind: null, source: null, error: 'missing' })
    expect(pelicanVerdict('只有文字').verdict).toBe('unknown')
  })
})
