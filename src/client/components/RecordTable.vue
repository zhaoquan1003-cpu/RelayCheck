<script setup lang="ts">
import { computed } from 'vue'
import type { TestSummary } from '../../shared/types'
import {
  formatDate,
  formatDuration,
  formatFirstToken,
  modeLabel,
  modeShort,
  shortId,
} from '../lib/format'
import StatusBadge from './StatusBadge.vue'

const props = defineProps<{
  records: TestSummary[]
  total: number
  page: number
  pageSize: number
  loading: boolean
  tab: 'all' | 'mine'
  myCount: number
}>()

const emit = defineEmits<{
  open: [id: string]
  page: [page: number]
  tab: [tab: 'all' | 'mine']
  refresh: []
}>()

const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const subtitle = computed(() =>
  props.tab === 'mine' ? `本浏览器保存了 ${props.myCount} 条测试` : `共 ${props.total} 条公开记录`,
)
</script>

<template>
  <section class="panel records-panel" id="records">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">PUBLIC FEED / 3S REFRESH</p>
        <h2>检测记录</h2>
        <p class="muted">{{ subtitle }} · 关闭页面不会中断测试</p>
      </div>
      <div class="record-actions">
        <button class="secondary small" type="button" :disabled="loading" @click="emit('refresh')">
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </div>

    <div class="tabs" role="tablist" aria-label="测试记录范围">
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'all'"
        :class="['tab', { active: tab === 'all' }]"
        @click="emit('tab', 'all')"
      >
        全部
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'mine'"
        :class="['tab', { active: tab === 'mine' }]"
        @click="emit('tab', 'mine')"
      >
        我的 <span class="tab-count">{{ myCount }}</span>
      </button>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>开始时间</th>
            <th>地址 / Key</th>
            <th>模型 / 模式</th>
            <th>状态 / 结果</th>
            <th>耗时</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <template v-if="records.length">
            <tr v-for="record in records" :key="record.id">
              <td class="nowrap">
                <span class="cell-strong">{{ formatDate(record.createdAt) }}</span>
                <small class="cell-sub mono">{{ shortId(record.id) }}</small>
              </td>
              <td>
                <span class="cell-strong mono">{{ record.addressMasked }}</span>
                <small class="cell-sub mono">{{ record.keyMasked }}</small>
              </td>
              <td>
                <span class="cell-strong">{{ record.model }}</span>
                <small class="cell-sub">
                  <span class="mode-chip">{{ modeShort(record.testMode) }}</span>
                  {{ modeLabel(record.testMode) }} · {{ record.effort }} · {{ record.apiType === 'responses' ? 'Responses' : 'Chat' }}
                </small>
              </td>
              <td>
                <StatusBadge :status="record.status" :verdict="record.verdict" />
                <small class="cell-sub">
                  {{ record.progress.stage === 'analyzing' ? '指纹分析中' : `${record.progress.completed}/${record.progress.total}` }}
                  <template v-if="record.fingerprintSummary">
                    · {{ record.fingerprintSummary.predictionName }}
                    {{ (record.fingerprintSummary.probability * 100).toFixed(1) }}%
                  </template>
                </small>
              </td>
              <td class="nowrap">
                <span class="cell-strong">{{ formatDuration(record.durationMs) }}</span>
                <small class="cell-sub">首字 {{ formatFirstToken(record.firstTokenMs) }}</small>
              </td>
              <td class="right">
                <button class="secondary small" type="button" @click="emit('open', record.id)">查看回答</button>
              </td>
            </tr>
          </template>
          <tr v-else>
            <td colspan="6" class="empty-cell">
              {{ loading ? '正在加载…' : tab === 'mine' ? '当前浏览器还没有保存过测试。' : '还没有公开记录。' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="pagination">
      <button class="secondary small" type="button" :disabled="page <= 1 || loading" @click="emit('page', page - 1)">
        上一页
      </button>
      <span class="mono">{{ page }} / {{ pageCount }}</span>
      <button
        class="secondary small"
        type="button"
        :disabled="page >= pageCount || loading"
        @click="emit('page', page + 1)"
      >
        下一页
      </button>
    </div>
  </section>
</template>