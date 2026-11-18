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

  it('preserves a fenced HTML fragment and its animation script', () => {
    const fragment = '<style>svg{color:blue}</style><div><svg><circle r="5"/></svg></div><script>const example = "<html>";</script>'
    expect(extractDrawingArtifact(`\`\`\`html\n${fragment}\n\`\`\``)).toEqual({ kind: 'html', source: fragment, error: null })
  })

  it('does not mistake HTML closing tags inside scripts, styles or comments for the document end', () => {
    const source = '<html><head><style>body::before{content:"</html>"}</style></head><body><!-- </html> --><script>const label = "</html>";</script><svg><path d="M0 0"/></svg></body></html>'
    expect(extractDrawingArtifact(source).source).toBe(source)
  })

  it('rejects incomplete HTML instead of extracting its otherwise complete SVG', () => {
    for (const source of [HTML_TRUNCATED, '<html><body><svg></svg>', '```html\n<div><svg></svg>\n```', '<html><body><div></body></html>']) {
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

  it('keeps explicit legacy SVG on the image path and missing answers neutral', () => {
    const svg = '<svg><script>const html = "<html></html>";</script><path d="M0 0"/></svg>'
    expect(extractDrawingArtifact(`\`\`\`svg\n${svg}\n\`\`\``)).toEqual({ kind: 'svg', source: svg, error: null })
    expect(extractDrawingArtifact(svg).kind).toBe('svg')
    expect(extractDrawingArtifact('')).toEqual({ kind: null, source: null, error: 'missing' })
    expect(pelicanVerdict('只有文字').verdict).toBe('unknown')
  })
})
