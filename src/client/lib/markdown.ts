import MarkdownIt from 'markdown-it'
import katex from 'katex'
import DOMPurify from 'dompurify'

const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true,
})

md.disable('image')

md.inline.ruler.before('escape', 'relaycheck_math', (state: any, silent: boolean) => {
  const start = state.pos
  const source = state.src as string
  const delimiter = ['\\[', '\\(', '$$', '$'].find((item) => source.startsWith(item, start))
  if (!delimiter) return false
  const closing = delimiter === '\\[' ? '\\]' : delimiter === '\\(' ? '\\)' : delimiter
  const contentStart = start + delimiter.length
  if (delimiter === '$' && /\s/.test(source[contentStart] || ' ')) return false
  let end = contentStart
  while ((end = source.indexOf(closing, end)) !== -1) {
    let escapes = 0
    for (let index = end - 1; index >= contentStart && source[index] === '\\'; index -= 1) escapes += 1
    if (escapes % 2 === 0) break
    end += closing.length
  }
  if (end < 0 || end === contentStart) return false
  if (
    delimiter === '$' &&
    (/\s/.test(source[end - 1]) ||
      /\d/.test(source[end + 1] || '') ||
      source.slice(contentStart, end).includes('\n'))
  ) {
    return false
  }
  if (!silent) {
    const token = state.push('relaycheck_math', '', 0)
    token.content = source.slice(contentStart, end)
    token.meta = { display: delimiter === '\\[' || delimiter === '$$' }
  }
  state.pos = end + closing.length
  return true
})

md.renderer.rules.relaycheck_math = (tokens, index) => {
  const token = tokens[index]
  try {
    return katex.renderToString(token.content, {
      displayMode: Boolean((token.meta as { display?: boolean } | undefined)?.display),
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      maxExpand: 1000,
      maxSize: 20,
    })
  } catch {
    return md.utils.escapeHtml(token.content)
  }
}

const defaultLinkOpen = md.renderer.rules.link_open
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noopener noreferrer')
  if (defaultLinkOpen) return defaultLinkOpen(tokens, index, options, env, self)
  return self.renderToken(tokens, index, options)
}

export function renderMarkdown(source: string | null | undefined): string {
  if (!source) return ''
  const html = md.render(String(source))
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, mathMl: true },
    ADD_ATTR: ['target', 'rel'],
  })
}