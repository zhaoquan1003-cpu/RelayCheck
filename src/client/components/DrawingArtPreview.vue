<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { TestStatus } from '../../shared/types'
import { extractDrawingArtifact, MAX_DRAWING_BYTES } from '../../shared/drawing-art'
import { appPath } from '../lib/paths'

const props = defineProps<{
  testId: string
  status: TestStatus
  source: string | null | undefined
}>()

const artifact = computed(() => extractDrawingArtifact(props.source))
const stopped = ref(false)
const playback = ref(0)
const loadFailed = ref(false)
const previewUrl = computed(() => appPath(`api/v1/tests/${encodeURIComponent(props.testId)}/preview`))
const ready = computed(() => props.status === 'completed')

// A fresh snapshot with the same answer must not restart the animation.
watch([() => props.testId, () => artifact.value.source], () => {
  stopped.value = false
  loadFailed.value = false
  playback.value += 1
})

const note = computed(() => {
  if (props.status === 'queued') return '检测已排队，完成后会在这里展示生成结果。'
  if (props.status === 'running') return '正在生成骑行动画，完整回答返回后自动打开预览…'
  if (props.status === 'failed') return '本次请求未完成，请查看下方失败原因与已返回的源码。'
  if (artifact.value.error === 'too_large') return `产物超过 ${Math.round(MAX_DRAWING_BYTES / 1024)} KB，未运行预览；可展开源码查看原始回答。`
  if (artifact.value.error === 'incomplete') return '返回的 HTML 或 SVG 不完整，暂时无法预览；可展开源码查看原始回答。'
  if (!artifact.value.kind) return '回答中没有找到可预览的 HTML 或 SVG；可展开源码查看原始回答。'
  if (loadFailed.value) return '预览加载失败，请重新播放，或展开源码查看生成结果。'
  return '预览已停止。点击“重新播放”可从头查看动画。'
})

function replay() {
  loadFailed.value = false
  stopped.value = false
  playback.value += 1
}
</script>

<template>
  <div class="drawing-preview-panel">
    <div class="drawing-preview-heading">
      <div>
        <p class="eyebrow">模型生成结果</p>
        <h3>看看部件，是否一起运动。</h3>
      </div>
      <span v-if="ready && artifact.kind" class="mono-chip">{{ artifact.kind === 'html' ? 'HTML 动画' : 'SVG 动画' }}</span>
    </div>

    <template v-if="ready && artifact.kind">
      <iframe
        v-if="!stopped && !loadFailed"
        :key="`${testId}:${playback}`"
        :src="previewUrl"
        class="drawing-preview-frame"
        title="模型生成的鹈鹕骑行动画"
        sandbox="allow-scripts"
        referrerpolicy="no-referrer"
        data-testid="drawing-preview"
        @error="loadFailed = true"
      />
      <p v-else class="drawing-preview-note" role="status">{{ note }}</p>
      <div class="drawing-preview-controls">
        <button class="secondary small" type="button" @click="replay">重新播放</button>
        <button class="secondary small" type="button" :disabled="stopped || loadFailed" @click="stopped = true">停止预览</button>
      </div>
      <p class="fine-print">观察完整的踩踏过程。若画面空白或动作异常，可查看源码；预览不会替模型修正结果。</p>
    </template>
    <p v-else class="drawing-preview-note" role="status">{{ note }}</p>
  </div>
</template>
