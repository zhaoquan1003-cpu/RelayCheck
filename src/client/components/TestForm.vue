<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ApiType, CreateTestInput, Effort, PublicConfig, TestMode } from '../../shared/types'
import MarkdownContent from './MarkdownContent.vue'

const props = defineProps<{
  config: PublicConfig
  busy: boolean
}>()

const emit = defineEmits<{ submit: [input: CreateTestInput] }>()

const mode = ref<TestMode>(props.config.defaultTestMode)
const apiType = ref<ApiType>(props.config.defaultApiType)
const effort = ref<Effort>(props.config.defaultEffort)
const address = ref(props.config.defaultUpstreamUrl || '')
const apiKey = ref('')
const showKey = ref(false)
const modelChoice = ref(props.config.models[0]?.id || 'gpt-6-astra')
const customModel = ref('')

watch(
  () => props.config,
  (next) => {
    if (!address.value) address.value = next.defaultUpstreamUrl || ''
  },
  { deep: false },
)

const custom = computed(() => modelChoice.value === 'custom')
const model = computed(() => (custom.value ? customModel.value.trim() : modelChoice.value))
const modeMeta = computed(() => props.config.modes.find((item) => item.id === mode.value) || props.config.modes[0])
const apiMeta = computed(() => props.config.apiTypes.find((item) => item.id === apiType.value))
const strictImage = computed(() => mode.value === 'strict' || mode.value === 'dual')
const questionPreview = computed(() => {
  if (mode.value === 'cup') return props.config.questions.cupQuestion
  if (mode.value === 'strict') return props.config.questions.strictQuestionLabel
  if (mode.value === 'dual') {
    return `${props.config.questions.question}\n\n---\n\n${props.config.questions.strictQuestionLabel}`
  }
  if (mode.value === 'advanced') {
    return '每轮会随机生成 3 条长数字题，并发调用目标模型。题目由 ModelTrace 官方挑战生成器产生，实际 prompt 会在详情中展示。'
  }
  return props.config.questions.question
})
const canSubmit = computed(
  () => !props.busy && Boolean(address.value.trim()) && Boolean(apiKey.value.trim()) && Boolean(model.value),
)

function setMode(next: TestMode) {
  mode.value = next
}

function submit() {
  if (!canSubmit.value) return
  emit('submit', {
    address: address.value.trim(),
    key: apiKey.value.trim(),
    apiType: apiType.value,
    model: model.value,
    effort: effort.value,
    testMode: mode.value,
  })
}

function clearKey() {
  apiKey.value = ''
}

defineExpose({ clearKey })
</script>

<template>
  <section class="panel test-form-panel" id="new-test">
    <div class="panel-heading">
      <div>
        <p class="eyebrow">NEW CHECK / 后台执行</p>
        <h2>发起一次检测</h2>
      </div>
      <span class="mono-chip">NO LOGIN REQUIRED</span>
    </div>

    <form class="form-grid" @submit.prevent="submit">
      <fieldset class="mode-fieldset">
        <legend>测试方式</legend>
        <div class="mode-grid">
          <button
            v-for="item in config.modes"
            :key="item.id"
            type="button"
            class="mode-button"
            :class="{ active: mode === item.id }"
            :aria-pressed="mode === item.id"
            @click="setMode(item.id)"
          >
            <span>{{ item.short }}</span>
            <small>{{ item.label.replace('快速测试 · ', '').replace('高级测试 · ', '') }}</small>
          </button>
        </div>
        <p class="field-help">{{ modeMeta?.help }}</p>
      </fieldset>

      <div class="form-row two">
        <label class="field">
          <span>测试模型</span>
          <select v-model="modelChoice">
            <option v-for="preset in config.models" :key="preset.id" :value="preset.id">
              {{ preset.label }}
            </option>
          </select>
        </label>
        <label class="field">
          <span>接口类型</span>
          <select v-model="apiType">
            <option v-for="item in config.apiTypes" :key="item.id" :value="item.id">{{ item.label }}</option>
          </select>
        </label>
      </div>

      <label v-if="custom" class="field">
        <span>自定义模型 ID</span>
        <input v-model="customModel" type="text" maxlength="200" placeholder="例如 gpt-6-astra" autocomplete="off" />
      </label>

      <div class="form-row two">
        <label class="field">
          <span>思考强度</span>
          <select v-model="effort">
            <option v-for="item in config.efforts" :key="item.id" :value="item.id">{{ item.label }}</option>
          </select>
        </label>
        <div class="field static-field">
          <span>接口说明</span>
          <p>{{ apiMeta?.help }}</p>
        </div>
      </div>

      <label class="field">
        <span>中转地址 <small>目标中转的 OpenAI 兼容 base URL；若站点配置了默认地址可留空。</small></span>
        <input v-model="address" type="url" placeholder="https://your-relay.example.com" autocomplete="off" required />
      </label>

      <label class="field">
        <span>API Key <small>只用于本次服务端请求，不会写入记录或日志</small></span>
        <div class="key-input">
          <input
            v-model="apiKey"
            :type="showKey ? 'text' : 'password'"
            placeholder="sk-…"
            autocomplete="off"
            spellcheck="false"
            required
          />
          <button type="button" class="secondary small" @click="showKey = !showKey">
            {{ showKey ? '隐藏' : '显示' }}
          </button>
        </div>
      </label>

      <details class="question-preview">
        <summary>查看本次发送的题目</summary>
        <div v-if="strictImage" class="strict-image-wrap">
          <img :src="config.questions.questionImage" alt="严格模式发送给模型的糖果题原图" />
          <p class="fine-print">严格模式只发送图片，不附加文字题面或提示词。</p>
        </div>
        <MarkdownContent :source="questionPreview" />
      </details>

      <div class="form-footer">
        <p class="fine-print">
          API Key 会经过本站服务器并转发给目标中转。请使用低额度、可随时撤销的 Key。
          提交即表示你理解测试记录默认公开。
        </p>
        <button class="primary" type="submit" :disabled="!canSubmit">
          {{ busy ? '正在提交…' : '开始测降智' }}
        </button>
      </div>
    </form>
  </section>
</template>