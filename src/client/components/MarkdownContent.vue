<script setup lang="ts">
import { computed } from 'vue'
import { renderMarkdown } from '../lib/markdown'

const props = defineProps<{ source: string | null | undefined }>()
const large = computed(() => (props.source?.length ?? 0) > 64_000)
const html = computed(() => large.value ? '' : renderMarkdown(props.source))
</script>

<template>
  <div v-if="large" class="markdown-body">
    <p class="fine-print">回答较长，以下按纯文本显示完整内容。</p>
    <pre class="raw-pre">{{ source }}</pre>
  </div>
  <div v-else class="markdown-body" v-html="html" />
</template>
