/** Shared parsers for model-produced SVG answers (drawing test mode). */

export const MAX_SVG_BYTES = 512 * 1024

const DRAWING_TAGS = ['path', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'rect'] as const

export interface SvgExtraction {
  markup: string | null
  tooLarge: boolean
}

export interface SvgInspection {
  complete: boolean
  elements: number
  paths: number
  circles: number
  risky: string[]
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength
}

function firstSvgElement(text: string): string | null {
  const start = text.search(/<svg[\s>]/i)
  if (start < 0) return null
  const end = text.toLowerCase().indexOf('</svg>', start)
  if (end < 0) return null
  return text.slice(start, end + '</svg>'.length)
}

/**
 * Pulls the first complete `<svg>…</svg>` out of a model answer.
 * Fenced code blocks are searched before the raw text so that prose around the
 * drawing does not become part of the markup.
 */
export function extractSvgMarkup(answer: string | null | undefined): SvgExtraction {
  const source = String(answer ?? '')
  if (!source) return { markup: null, tooLarge: false }

  const candidates: string[] = []
  for (const match of source.matchAll(/```[a-zA-Z0-9_-]*[ \t]*\r?\n?([\s\S]*?)```/g)) {
    candidates.push(match[1])
  }
  candidates.push(source)

  for (const candidate of candidates) {
    const markup = firstSvgElement(candidate)
    if (!markup) continue
    if (byteLength(markup) > MAX_SVG_BYTES) return { markup: null, tooLarge: true }
    return { markup, tooLarge: false }
  }
  return { markup: null, tooLarge: false }
}

/** Structural inspection used for the automatic (non-aesthetic) verdict. */
export function inspectSvg(markup: string | null | undefined): SvgInspection {
  const source = String(markup ?? '')
  const counts = DRAWING_TAGS.map((tag) => {
    const matches = source.match(new RegExp(`<\\s*${tag}[\\s>/]`, 'gi'))
    return matches ? matches.length : 0
  })
  const elements = counts.reduce((total, value) => total + value, 0)
  const risky: string[] = []
  if (/<\s*script[\s>]/i.test(source)) risky.push('脚本')
  if (/\son[a-z]+\s*=/i.test(source)) risky.push('事件属性')
  if (/<\s*foreignobject[\s>]/i.test(source)) risky.push('foreignObject')
  if (/\b(?:xlink:href|href|src)\s*=\s*["']?\s*(?:https?:|\/\/)/i.test(source)) risky.push('外部引用')

  const trimmed = source.trim().toLowerCase()
  const complete = trimmed.startsWith('<svg') && trimmed.endsWith('</svg>')
  return {
    complete,
    elements,
    paths: counts[0],
    circles: counts[1],
    risky,
  }
}