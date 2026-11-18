<script setup lang="ts">
import { computed } from 'vue'
import type { Fingerprint } from '../../shared/types'
import { formatPercent } from '../lib/format'

const props = defineProps<{ fingerprint: Fingerprint | null }>()
const top = computed(() => props.fingerprint?.results.slice(0, 5) ?? [])
const used = computed(() => props.fingerprint?.used_outputs ?? 0)
</script>

<template>
  <section v-if="fingerprint" class="fingerprint-panel">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">模型指纹</p>
        <h3>指纹最接近</h3>
      </div>
      <span class="fingerprint-method">{{ fingerprint.method }}</span>
    </div>
    <div class="fingerprint-hero">
      <div>
        <div class="fingerprint-name">{{ fingerprint.prediction_name }}</div>
        <p class="muted">
          匹配概率 <strong>{{ formatPercent(fingerprint.probability) }}</strong> ·
          有效回答 {{ used }}/3 · 家族 {{ fingerprint.family_prediction_name }}
        </p>
      </div>
      <div class="fingerprint-score"><strong>{{ formatPercent(fingerprint.probability) }}</strong><span>匹配概率</span></div>
    </div>
    <div class="fingerprint-bars">
      <div v-for="item in top" :key="item.model" class="fingerprint-row">
        <div class="fingerprint-row-head">
          <span>{{ item.display_name }}</span>
          <span class="mono">{{ formatPercent(item.probability) }}</span>
        </div>
        <div class="bar" aria-hidden="true"><span :style="{ width: `${Math.max(0.4, item.probability * 100)}%` }" /></div>
      </div>
    </div>
    <p class="fine-print">
      这是候选指纹库内的闭集概率，不是模型身份证明；未收录模型也会被归到最相似的候选。
      校准查询数 {{ fingerprint.calibration.queries }}，CV 准确率
      {{ formatPercent(fingerprint.calibration.cv_accuracy) }}。
    </p>
  </section>
</template>
