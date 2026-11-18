<script setup lang="ts">
import { computed } from 'vue'
import type { TestMode, TestStatus, Verdict } from '../../shared/types'
import { verdictLabel, verdictTone } from '../lib/format'

const props = defineProps<{
  status: TestStatus
  verdict: Verdict | null
  testMode?: TestMode
}>()

const tone = computed(() => {
  if (props.status === 'failed') return 'failed'
  if (props.status === 'running') return 'running'
  if (props.status === 'queued') return 'queued'
  if (props.testMode === 'pelican') return 'unknown'
  return verdictTone(props.verdict)
})
</script>

<template>
  <span class="badge" :class="`badge-${tone}`">
    <span class="badge-dot" />
    {{ verdictLabel(props) }}
  </span>
</template>
