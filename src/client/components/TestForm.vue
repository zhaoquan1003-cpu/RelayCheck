<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ApiType, CreateTestInput, Effort, PublicConfig, TestMode } from '../../shared/types'
import { questionForDisplay } from '../../shared/questions'
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

const modeIcons: Record<TestMode, string> = {
  dual: 'M8 4H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3M16 4h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3M10 7l-3 4 3 4m4-8 3 4-3 4',
  strict: 'M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM3 16l5-5 4 4 3-3 6 6M16 8h.01',
  quick: 'M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM7 9h10M7 13h7',
  cup: 'M5 5h11v10a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4V5ZM16 7h2a3 3 0 0 1 0 6h-2M3 22h15',
  pelican: 'm15 4 5 5M4 20l4-1 12-12a2 2 0 0 0-5-3L3 16l-1 6 6-1M6 16l3 3',
  advanced: 'M12 3a7 7 0 0 1 7 7v3m-14 0v-3a7 7 0 0 1 3-6M8 20c1-3 1-5 1-9a3 3 0 0 1 6 0v4c0 3-1 5-2 7M5 17v-1m14 0c0 3-1 5-2 6M12 10v5c0 3-1 5-2 7',
}
const modeDescriptions: Record<TestMode, string> = {
  dual: '文字与图片对照', strict: '检查视觉理解', quick: '基础推理检测',
  cup: '检验逻辑推理', pelican: '观察骑行动画结构', advanced: '比对模型指纹',
}

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
  let text = ''
  if (mode.value === 'cup') text = props.config.questions.cupQuestion
  else if (mode.value === 'pelican') text = props.config.questions.pelicanQuestion
  else if (mode.value === 'strict') text = props.config.questions.strictQuestionLabel
  else if (mode.value === 'dual') {
    text = `${props.config.questions.question}\n\n---\n\n${props.config.questions.strictQuestionLabel}`
  } else if (mode.value === 'advanced') {
    text = '每轮会随机生成 3 条长数字题，并发调用目标模型。题目由 ModelTrace 官方挑战生成器产生，实际 prompt 会在详情中展示。'
  } else {
    text = props.config.questions.question
  }
  return questionForDisplay(text)
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
        <h2>新建检测</h2>
        <p class="muted">选一种方式，了解模型的真实表现。</p>
      </div>
      <span class="form-access-note">无需登录</span>
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
            <svg class="mode-icon" viewBox="0 0 24 24" aria-hidden="true"><path :d="modeIcons[item.id]" /></svg>
            <span class="mode-name">{{ item.short }}</span>
            <small>{{ modeDescriptions[item.id] }}</small>
            <svg v-if="mode === item.id" class="mode-selected" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" /><path d="m4.5 8 2.3 2.3 4.7-4.7" /></svg>
          </button>
        </div>
        <p class="field-help">{{ modeMeta?.help }}</p>
      </fieldset>

      <div class="settings-group">
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
      </div>

      <label class="field address-field">
        <span>中转地址</span>
        <input v-model="address" type="text" inputmode="url" maxlength="2048" placeholder="https://your-relay.example.com" autocomplete="off" required />
        <small class="field-description">填写目标中转的 OpenAI 兼容地址。</small>
      </label>

      <div class="field">
        <label for="api-key">API Key</label>
        <div class="key-input">
          <input
            id="api-key"
            v-model="apiKey"
            :type="showKey ? 'text' : 'password'"
            placeholder="sk-…"
            autocomplete="off"
            spellcheck="false"
            maxlength="4096"
            required
          />
          <button type="button" class="key-visibility" :aria-pressed="showKey" @click="showKey = !showKey">
            {{ showKey ? '隐藏' : '显示' }}
          </button>
        </div>
        <small class="field-description">仅用于本次请求，记录中只保存脱敏信息。</small>
      </div>

      <details class="question-preview">
        <summary><span>查看本次发送的题目</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5" /></svg></summary>
        <div v-if="strictImage" class="strict-image-wrap">
          <img :src="config.questions.questionImage" alt="严格模式发送给模型的糖果题原图" />
          <p class="fine-print">严格模式只发送图片，不附加文字题面或提示词。</p>
        </div>
        <MarkdownContent :source="questionPreview" />
      </details>

      <div class="form-footer">
        <p class="fine-print">
          Key 会转发至目标中转，建议使用低额度 Key。提交的检测记录默认公开。
        </p>
        <button class="primary" type="submit" :disabled="!canSubmit">
          <span v-if="busy" class="button-spinner" aria-hidden="true" />
          {{ busy ? '正在提交…' : '开始检测' }}
        </button>
      </div>
    </form>
  </section>
</template>
