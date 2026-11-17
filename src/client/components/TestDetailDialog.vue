<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { TestDetail } from '../../shared/types'
import {
  formatDate,
  formatDuration,
  formatFirstToken,
  modeLabel,
  progressLabel,
} from '../lib/format'
import FingerprintPanel from './FingerprintPanel.vue'
import MarkdownContent from './MarkdownContent.vue'
import StatusBadge from './StatusBadge.vue'

const props = defineProps<{
  open: boolean
  test: TestDetail | null
  shareUrl: string
  error: string
}>()

const emit = defineEmits<{ close: []; refresh: [] }>()

const dialogEl = ref<HTMLDialogElement | null>(null)
const copyStatus = ref('')

const dualProbes = computed(() => props.test?.probes.filter((probe) => probe.kind === 'quick' || probe.kind === 'strict') ?? [])
const advancedProbes = computed(() => props.test?.probes.filter((probe) => probe.kind === 'advanced') ?? [])
const isDual = computed(() => props.test?.testMode === 'dual')
const isAdvanced = computed(() => props.test?.testMode === 'advanced')
const isSingle = computed(() => Boolean(props.test && !isDual.value && !isAdvanced.value))
const rawAnswer = computed(() => {
  if (!props.test) return ''
  if (isSingle.value) return props.test.answer || ''
  return props.test.probes.map((probe) => `## ${probe.kind}\n\n${probe.answer || '（无回答）'}`).join('\n\n')
})

watch(
  () => props.open,
  (open) => {
    const dialog = dialogEl.value
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  },
)

watch(
  () => props.test?.id,
  () => {
    copyStatus.value = ''
  },
)

onMounted(() => {
  if (props.open && dialogEl.value && !dialogEl.value.open) dialogEl.value.showModal()
})

function close() {
  emit('close')
}

function onDialogClose() {
  if (props.open) emit('close')
}

function onCancel(event: Event) {
  event.preventDefault()
  close()
}

function onBackdrop(event: MouseEvent) {
  if (event.target === dialogEl.value) close()
}

async function copyShare() {
  try {
    await navigator.clipboard.writeText(props.shareUrl)
    copyStatus.value = '分享链接已复制'
  } catch {
    copyStatus.value = '请手动复制上方链接'
  }
}

function probeLabel(kind: string) {
  if (kind === 'quick') return '旧文字题'
  if (kind === 'strict') return '严格原图题'
  if (kind === 'cup') return '水杯题'
  return '指纹题'
}
</script>

<template>
  <dialog ref="dialogEl" class="detail-dialog" @close="onDialogClose" @cancel="onCancel" @click="onBackdrop">
    <div v-if="test" class="dialog-card" @click.stop>
      <header class="dialog-header">
        <div>
          <p class="eyebrow">TEST DETAIL / {{ test.id }}</p>
          <h2>{{ modeLabel(test.testMode) }}</h2>
          <p class="muted">
            {{ test.model }} · {{ test.effort }} · {{ test.apiType }} ·
            {{ formatDate(test.createdAt) }}
          </p>
        </div>
        <div class="dialog-header-actions">
          <StatusBadge :status="test.status" :verdict="test.verdict" />
          <button class="icon-button" type="button" aria-label="关闭详情" @click="close">✕</button>
        </div>
      </header>

      <div class="detail-meta">
        <div>
          <span class="meta-label">地址 / KEY</span>
          <span class="mono">{{ test.addressMasked }}</span>
          <span class="mono muted">{{ test.keyMasked }}</span>
        </div>
        <div>
          <span class="meta-label">进度</span>
          <span>{{ progressLabel(test) }}</span>
        </div>
        <div>
          <span class="meta-label">首字 / 总耗时</span>
          <span>{{ formatFirstToken(test.firstTokenMs) }} / {{ formatDuration(test.durationMs) }}</span>
        </div>
        <div>
          <span class="meta-label">操作</span>
          <button class="secondary small" type="button" @click="emit('refresh')">刷新快照</button>
        </div>
      </div>

      <p v-if="test.verdictReason" class="verdict-reason">{{ test.verdictReason }}</p>
      <p v-if="error" class="error-box">{{ error }}</p>

      <div class="share-row">
        <label for="share-url">分享链接</label>
        <input id="share-url" :value="shareUrl" type="text" readonly />
        <button class="secondary small" type="button" @click="copyShare">复制</button>
        <span class="fine-print">{{ copyStatus }}</span>
      </div>

      <section v-if="isDual" class="dual-grid">
        <article v-for="probe in dualProbes" :key="probe.id" class="probe-card">
          <div class="probe-head">
            <h3>{{ probeLabel(probe.kind) }}</h3>
            <StatusBadge :status="probe.status" :verdict="probe.verdict" />
          </div>
          <p class="fine-print">
            首字 {{ formatFirstToken(probe.firstTokenMs) }} ·
            耗时 {{ formatDuration(probe.durationMs) }}
          </p>
          <p v-if="probe.error" class="error-box">{{ probe.error }}</p>
          <MarkdownContent :source="probe.answer || (probe.status === 'running' ? '请求已发起，等待输出…' : '没有回答正文')" />
        </article>
      </section>

      <section v-else-if="isSingle" class="answer-section">
        <h3>回答正文</h3>
        <MarkdownContent :source="test.answer || (test.status === 'running' ? '后台测试进行中…' : '没有回答正文')" />
      </section>

      <template v-else-if="isAdvanced">
        <FingerprintPanel :fingerprint="test.fingerprint" />
        <section class="probe-list">
          <h3>三次指纹题</h3>
          <article v-for="probe in advancedProbes" :key="probe.id" class="probe-card">
            <div class="probe-head">
              <h4>第 {{ probe.ordinal + 1 }} 轮 · {{ probe.expectedCount }} 个数</h4>
              <StatusBadge :status="probe.status" :verdict="probe.verdict" />
            </div>
            <p class="fine-print">
              首字 {{ formatFirstToken(probe.firstTokenMs) }} ·
              耗时 {{ formatDuration(probe.durationMs) }}
            </p>
            <details>
              <summary>查看 prompt</summary>
              <pre class="raw-pre">{{ probe.prompt }}</pre>
            </details>
            <p v-if="probe.error" class="error-box">{{ probe.error }}</p>
            <MarkdownContent :source="probe.answer || (probe.status === 'running' ? '等待输出…' : '没有回答正文')" />
          </article>
        </section>
      </template>

      <details class="question-section">
        <summary>查看问题</summary>
        <img
          v-if="test.questionImage && (test.testMode === 'strict' || test.testMode === 'dual')"
          class="strict-image"
          :src="test.questionImage"
          alt="严格模式发送给模型的糖果题原图"
        />
        <MarkdownContent :source="test.question" />
      </details>

      <details class="raw-section">
        <summary>查看原始 Markdown</summary>
        <pre class="raw-pre">{{ rawAnswer }}</pre>
      </details>

      <p v-if="test.error" class="error-box">{{ test.error }}</p>
      <p v-if="test.fingerprint" class="fine-print">
        指纹候选库为闭集；概率不是模型身份或能力的决定性证据。
      </p>
    </div>
    <div v-else class="dialog-card dialog-loading">
      <div class="spinner" />
      <p>正在加载测试详情…</p>
      <button class="secondary" type="button" @click="close">关闭</button>
    </div>
  </dialog>
</template>