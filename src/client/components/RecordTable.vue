<script setup lang="ts">
import { computed } from 'vue'
import type { TestSummary } from '../../shared/types'
import {
  formatDate,
  formatDuration,
  formatFirstToken,
  modeLabel,
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
  publicListEnabled: boolean
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
        <h2>检测记录</h2>
        <p class="muted">{{ subtitle }} · 自动更新</p>
      </div>
      <div class="record-actions">
        <button class="secondary small" type="button" :disabled="loading" @click="emit('refresh')">
          <svg class="refresh-icon" :class="{ refreshing: loading }" viewBox="0 0 20 20" aria-hidden="true"><path d="M16.7 8A7 7 0 1 0 17 12M17 3v5h-5" /></svg>
          {{ loading ? '刷新中…' : '刷新' }}
        </button>
      </div>
    </div>

    <div class="records-toolbar">
      <div class="tabs" role="tablist" aria-label="测试记录范围">
        <button
          v-if="publicListEnabled"
          type="button"
          role="tab"
          :aria-selected="tab === 'all'"
          aria-controls="records-content"
          :class="['tab', { active: tab === 'all' }]"
          @click="emit('tab', 'all')"
        >
          全部
        </button>
        <button
          type="button"
          role="tab"
          :aria-selected="tab === 'mine'"
          aria-controls="records-content"
          :class="['tab', { active: tab === 'mine' }]"
          @click="emit('tab', 'mine')"
        >
          我的 <span class="tab-count">{{ myCount }}</span>
        </button>
      </div>
      <span class="record-retention-note">记录可通过链接分享</span>
    </div>

    <div class="table-wrap" id="records-content" :aria-busy="loading">
      <table role="table" aria-label="检测记录">
        <thead>
          <tr>
            <th>开始时间</th>
            <th>地址 / Key</th>
            <th>模型与检测方式</th>
            <th>状态 / 结果</th>
            <th>耗时</th>
            <th><span class="visually-hidden">操作</span></th>
          </tr>
        </thead>
        <tbody>
          <template v-if="records.length">
            <tr v-for="record in records" :key="record.id" class="record-row">
              <td class="record-date" data-label="开始时间">
                <span class="cell-strong">{{ formatDate(record.createdAt) }}</span>
                <small class="cell-sub mono">{{ shortId(record.id) }}</small>
              </td>
              <td class="record-address" data-label="地址 / Key">
                <span class="cell-strong mono">{{ record.addressMasked }}</span>
                <small class="cell-sub mono">{{ record.keyMasked }}</small>
              </td>
              <td class="record-model" data-label="模型">
                <span class="cell-strong">{{ record.model }}</span>
                <small class="cell-sub">
                  {{ modeLabel(record.testMode) }} · {{ record.effort }} · {{ record.apiType === 'responses' ? 'Responses' : 'Chat' }}
                </small>
              </td>
              <td class="record-status" data-label="状态">
                <StatusBadge :status="record.status" :verdict="record.verdict" :test-mode="record.testMode" />
                <small class="cell-sub">
                  {{ record.progress.stage === 'analyzing' ? '指纹分析中' : `${record.progress.completed}/${record.progress.total} 项完成` }}
                  <template v-if="record.fingerprintSummary">
                    · {{ record.fingerprintSummary.predictionName }}
                    {{ (record.fingerprintSummary.probability * 100).toFixed(1) }}%
                  </template>
                </small>
              </td>
              <td class="record-duration" data-label="耗时">
                <span class="cell-strong">{{ formatDuration(record.durationMs) }}</span>
                <small class="cell-sub">首字 {{ formatFirstToken(record.firstTokenMs) }}</small>
              </td>
              <td class="record-open">
                <button class="record-detail-button" type="button" @click="emit('open', record.id)">查看回答<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg></button>
              </td>
            </tr>
          </template>
          <tr v-else>
            <td colspan="6" class="empty-cell">
              <div class="records-empty">
                <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="6" width="28" height="36" rx="5" /><path d="M18 17h12M18 24h12M18 31h7" /></svg>
                <strong>{{ loading ? '正在加载记录…' : '还没有检测记录' }}</strong>
                <p>{{ tab === 'mine' ? '你在此浏览器发起的检测，会显示在这里。' : '完成第一次检测，结果就会出现在这里。' }}</p>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="pagination">
      <button class="secondary small" type="button" :disabled="page <= 1 || loading" @click="emit('page', page - 1)">
        上一页
      </button>
      <span>第 {{ page }} 页，共 {{ pageCount }} 页</span>
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
