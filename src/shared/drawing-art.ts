import { parse, parseFragment, type DefaultTreeAdapterTypes } from 'parse5'
import { extractSvgMarkup } from './svg-art'

export const MAX_DRAWING_BYTES = 512 * 1024

export interface DrawingArtifact {
  kind: 'html' | 'svg' | null
  source: string | null
  error: 'missing' | 'incomplete' | 'too_large' | null
}

const HTML_START = /<!doctype\s+html\b[^>]*>|<html(?:\s[^>]*)?>/i
const OPTIONAL_END_TAGS = new Set(['html', 'head', 'body', 'p', 'li', 'dt', 'dd', 'rt', 'rp', 'optgroup', 'option', 'colgroup', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th'])
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

function failure(error: NonNullable<DrawingArtifact['error']>): DrawingArtifact {
  return { kind: null, source: null, error }
}

function hasUnclosedElement(node: DefaultTreeAdapterTypes.Node, source: string): boolean {
  const pending = [node]
  while (pending.length) {
    const current = pending.pop()!
    if ('tagName' in current) {
      const location = current.sourceCodeLocation
      const isHtml = current.namespaceURI === 'http://www.w3.org/1999/xhtml'
      const optional = isHtml && (OPTIONAL_END_TAGS.has(current.tagName) || VOID_TAGS.has(current.tagName))
      const selfClosed = !isHtml && location?.startTag && /\/\s*>$/.test(source.slice(location.startTag.startOffset, location.startTag.endOffset))
      if (location?.startTag && !location.endTag && !optional && !selfClosed) return true
    }
    if ('childNodes' in current) {
      for (const child of current.childNodes) pending.push(child)
    }
  }
  return false
}

/** Format recognition only. HTML must run under the preview route's CSP and sandbox. */
function htmlArtifact(candidate: string): DrawingArtifact {
  const source = candidate.trim()
  const fullDocument = /^(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+html\b|<html[\s>])/i.test(source)
  if (new TextEncoder().encode(source).byteLength > MAX_DRAWING_BYTES) return failure('too_large')

  let truncated = false
  const options = {
    sourceCodeLocationInfo: true as const,
    onParseError: (error: { code: string }) => { if (error.code.startsWith('eof-')) truncated = true },
  }
  if (fullDocument) {
    const document = parse(source, options)
    const root = document.childNodes.find((node): node is DefaultTreeAdapterTypes.Element => 'tagName' in node && node.tagName === 'html')
    const end = root?.sourceCodeLocation?.endTag?.endOffset
    // Do not silently salvage an SVG from a truncated HTML document. Its styles
    // or animation script may be outside the SVG and essential to the drawing.
    if (!end || truncated || hasUnclosedElement(document, source)) return failure('incomplete')
    return { kind: 'html', source: source.slice(0, end), error: null }
  }

  const fragment = parseFragment(source, options)
  if (!fragment.childNodes.some((node) => 'tagName' in node)) return failure('missing')
  if (truncated || hasUnclosedElement(fragment, source)) return failure('incomplete')
  return { kind: 'html', source, error: null }
}

export function extractDrawingArtifact(answer: string | null | undefined): DrawingArtifact {
  const source = String(answer ?? '').trim()
  if (!source) return failure('missing')
  const fences = Array.from(source.matchAll(/^[ \t]*(`{3,}|~{3,})([\w-]*)[^\S\r\n]*\r?\n([\s\S]*?)^[ \t]*\1[ \t]*$/gm))
  const html = fences.find((match) => /^(?:html?|html5)$/i.test(match[2]))
  if (html) return htmlArtifact(html[3])
  const document = fences.find((match) => match[2].toLowerCase() !== 'svg' && HTML_START.test(match[3]))
  if (document) return htmlArtifact(document[3].slice(document[3].search(HTML_START)))

  // Explicit SVG responses remain on the existing sanitized image path, even
  // when their script text contains strings that resemble an HTML document.
  const svgFence = fences.find((match) => match[2].toLowerCase() === 'svg')
  if (!svgFence && !/^<svg[\s>]/i.test(source) && HTML_START.test(source)) return htmlArtifact(source.slice(source.search(HTML_START)))
  if (/^[ \t]*(`{3,}|~{3,})html?[^\S\r\n]*\r?\n/im.test(source)) return failure('incomplete')
  const svg = extractSvgMarkup(svgFence ? svgFence[3] : source)
  if (svg.tooLarge) return failure('too_large')
  if (svg.markup) return { kind: 'svg', source: svg.markup, error: null }
  return failure(/<svg[\s>]/i.test(source) ? 'incomplete' : 'missing')
}

export function drawingArtifactMessage(artifact: DrawingArtifact): string {
  if (artifact.error === 'too_large') return '生成内容超过 512 KiB 预览上限，请查看原始回答。此限制不代表模型能力结论。'
  if (artifact.error === 'incomplete') return '生成的 HTML / SVG 不完整，暂不运行预览，请查看原始回答。'
  if (artifact.error === 'missing') return '回答里没有找到可预览的 HTML 或 SVG，请查看原始回答。'
  if (artifact.kind === 'svg') return '已返回 SVG，使用兼容图片预览；请按车轮、腿与脚踏、视角、鹈鹕喙四项人工判读。'
  return '已生成 HTML 动画，待人工判读：请检查车轮、腿与脚踏的连接、视角和鹈鹕喙。'
}
