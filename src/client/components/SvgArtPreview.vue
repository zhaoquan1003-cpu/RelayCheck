<script setup lang="ts">
import { computed } from 'vue'
import DOMPurify from 'dompurify'
import { MAX_SVG_BYTES, extractSvgMarkup } from '../../shared/svg-art'

const props = defineProps<{ source: string | null | undefined }>()

const extraction = computed(() => extractSvgMarkup(props.source))

function sanitizeForPreview(markup: string): string {
  const cleaned = DOMPurify.sanitize(markup, {
    USE_PROFILES: { svg: true, svgFilters: true },
    FORBID_TAGS: ['script', 'foreignObject', 'style'],
  })
  if (!/<svg[\s>]/i.test(cleaned)) throw new Error('empty-svg')
  // A standalone data-URI SVG needs its own namespace to render as an image.
  const namespaced = /<svg[^>]*\sxmlns\s*=/i.test(cleaned)
    ? cleaned
    : cleaned.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"')

  const document = new DOMParser().parseFromString(namespaced, 'image/svg+xml')
  if (document.querySelector('parsererror')) throw new Error('parse-error')
  const root = document.documentElement
  if (!root || root.tagName.toLowerCase() !== 'svg') throw new Error('not-svg')

  // Image-context SVG cannot fetch resources anyway; drop them for defense in depth.
  for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase()
      const value = (attribute.value || '').trim()
      if (name === 'href' || name === 'xlink:href' || name === 'src') {
        if (!value.startsWith('#')) element.removeAttribute(attribute.name)
      } else if (name.startsWith('on')) {
        element.removeAttribute(attribute.name)
      } else if (/url\(/i.test(value)) {
        element.setAttribute(attribute.name, value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi,
          (match, _quote: string, target: string) => target.startsWith('#') ? match : 'none'))
      }
    }
  }
  return new XMLSerializer().serializeToString(root)
}

const rendered = computed(() => {
  const markup = extraction.value.markup
  if (!markup) return { dataUrl: '', error: '' }
  try {
    const safe = sanitizeForPreview(markup)
    return {
      dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(safe)}`,
      error: '',
    }
  } catch {
    return { dataUrl: '', error: 'SVG 无法安全渲染，请查看源码。' }
  }
})

const note = computed(() => {
  if (rendered.value.error) return rendered.value.error
  if (!String(props.source ?? '').trim()) return '等待回答…'
  if (extraction.value.tooLarge) {
    return `返回的 SVG 超过 ${Math.round(MAX_SVG_BYTES / 1024)} KB，未渲染。`
  }
  return '回答里没有可渲染的 SVG。'
})
</script>

<template>
  <div class="svg-art">
    <div v-if="rendered.dataUrl" class="svg-art-frame">
      <img
        class="svg-art-img"
        :src="rendered.dataUrl"
        alt="模型输出的 SVG 渲染结果"
        loading="lazy"
        data-testid="svg-preview"
      />
    </div>
    <p v-else class="svg-art-note">{{ note }}</p>
    <details v-if="extraction.markup" class="svg-art-source">
      <summary>查看 SVG 源码</summary>
      <pre class="raw-pre">{{ extraction.markup }}</pre>
    </details>
  </div>
</template>
