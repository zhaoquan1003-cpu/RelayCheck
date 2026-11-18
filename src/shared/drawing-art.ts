export const MAX_DRAWING_BYTES = 512 * 1024

export interface DrawingArtifact {
  kind: 'html' | 'svg' | null
  source: string | null
  error: 'missing' | 'incomplete' | 'too_large' | null
}

function failure(error: NonNullable<DrawingArtifact['error']>): DrawingArtifact {
  return { kind: null, source: null, error }
}

/** Recognize complete roots without repairing the model's markup or animation. */
function extractDocument(text: string, svgFence = false): DrawingArtifact {
  const html = /<html(?=[\s>])/i.exec(text)
  const svg = /<svg(?=[\s>])/i.exec(text)
  // An explicit SVG can contain HTML-looking strings in its animation script.
  // Keep that script inside its original SVG rather than extracting the string.
  const explicitSvg = svgFence || /^(?:\s|<!--[\s\S]*?-->|<\?xml[\s\S]*?\?>)*<svg(?=[\s>])/i.test(text)
  const kind = html && !explicitSvg ? 'html' : svg ? 'svg' : null
  if (!kind) return failure('missing')
  // ASCII folding preserves source offsets even around characters such as İ.
  const lower = text.replace(/[A-Z]/g, (character) => character.toLowerCase())
  let start = (kind === 'html' ? html : svg)!.index
  const closingTag = `</${kind}>`
  const end = lower.lastIndexOf(closingTag)
  if (end <= start) return failure('incomplete')
  if (kind === 'html') {
    const doctype = lower.lastIndexOf('<!doctype html', start)
    if (doctype >= 0) start = doctype
  }
  const source = text.slice(start, end + closingTag.length)
  if (new TextEncoder().encode(source).byteLength > MAX_DRAWING_BYTES) return failure('too_large')
  return { kind, source, error: null }
}

/**
 * Cockpit Tools' drawing flow: first complete HTML/SVG in an eligible code fence,
 * otherwise a complete document in the reply. Never salvage an unfinished fence.
 * Executable markup must only be served by the isolated preview route.
 */
export function extractDrawingArtifact(answer: string | null | undefined): DrawingArtifact {
  const source = String(answer ?? '').trim()
  if (!source) return failure('missing')
  let fenced = false
  let eligible = false
  let language = ''
  let block: string[] = []
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith('```')) {
      if (fenced) {
        if (eligible) {
          const artifact = extractDocument(block.join('\n').trim(), language === 'svg')
          if (artifact.kind || artifact.error === 'too_large') return artifact
        }
        block = []
      } else {
        language = trimmed.replace(/^`+/, '').trim().toLowerCase()
        eligible = ['', 'html', 'svg', 'xml'].includes(language)
      }
      fenced = !fenced
    } else if (fenced) {
      block.push(line)
    }
  }
  if (fenced) return failure('incomplete')
  return extractDocument(source)
}

export function drawingArtifactMessage(artifact: DrawingArtifact): string {
  if (artifact.error === 'too_large') return '生成内容超过 512 KiB 预览上限，请查看原始回答。此限制不代表模型能力结论。'
  if (artifact.error === 'incomplete') return '生成的 HTML / SVG 不完整，暂不运行预览，请查看原始回答。'
  if (artifact.error === 'missing') return '回答里没有找到完整的 HTML 或 SVG 文档，请查看原始回答。'
  return `已生成 ${artifact.kind === 'svg' ? 'SVG' : 'HTML'}，可在沙箱中查看动画，待人工判读。`
}
