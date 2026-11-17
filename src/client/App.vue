<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CreateTestInput, PublicConfig, TestDetail, TestSummary } from '../shared/types'
import { ApiError, api } from './lib/api'
import { addMyTest, loadMyTests, removeMyTest } from './lib/my-tests'
import TestForm from './components/TestForm.vue'
import RecordTable from './components/RecordTable.vue'
import TestDetailDialog from './components/TestDetailDialog.vue'

const ID_RE = /^[a-f0-9]{16}$/
const config = ref<PublicConfig | null>(null)
const records = ref<TestSummary[]>([])
const total = ref(0)
const publicTotal = ref(0)
const page = ref(1)
const pageSize = ref(30)
const tab = ref<'all' | 'mine'>('all')
const loading = ref(false)
const submitting = ref(false)
const appError = ref('')
const listError = ref('')
const message = ref('')
const myIds = ref<string[]>([])
const detail = ref<TestDetail | null>(null)
const detailOpen = ref(false)
const detailError = ref('')
const detailId = ref('')
const formRef = ref<{ clearKey: () => void } | null>(null)

let detailStream: EventSource | null = null
let listTimer: ReturnType<typeof setInterval> | null = null
let detailTimer: ReturnType<typeof setInterval> | null = null

const myCount = computed(() => myIds.value.length)
const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value)))
const shareUrl = computed(() => {
  if (!detail.value) return ''
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = ''
  url.searchParams.set('id', detail.value.id)
  return url.toString()
})


function setUrlId(id: string | null) {
  const url = new URL(window.location.href)
  if (id) url.searchParams.set('id', id)
  else url.searchParams.delete('id')
  window.history.replaceState(null, '', url)
}

async function loadConfig() {
  const response = await api.getConfig()
  config.value = response.config
}

function selectionBusy(): boolean {
  const selection = window.getSelection()
  return Boolean(selection && !selection.isCollapsed && selection.toString())
}

async function loadList(silent = false): Promise<void> {
  if (loading.value) return
  if (silent && selectionBusy()) return
  loading.value = true
  if (!silent) listError.value = ''
  try {
    if (tab.value === 'mine') {
      myIds.value = loadMyTests()
      const ids = [...myIds.value].reverse()
      total.value = ids.length
      const start = (page.value - 1) * pageSize.value
      const pageIds = ids.slice(start, start + pageSize.value)
      const fetched = await Promise.all(
        pageIds.map(async (id) => {
          try {
            return (await api.getTest(id)).test
          } catch (error) {
            if (error instanceof ApiError && error.status === 404) {
              myIds.value = removeMyTest(id)
            }
            return null
          }
        }),
      )
      records.value = fetched.filter((item): item is TestDetail => item !== null)
      total.value = myIds.value.length
      if (total.value > 0 && page.value > Math.max(1, Math.ceil(total.value / pageSize.value))) {
        page.value = Math.max(1, Math.ceil(total.value / pageSize.value))
      }
    } else {
      const response = await api.listTests(page.value)
      records.value = response.records
      total.value = response.total
      publicTotal.value = response.total
      pageSize.value = response.pageSize
    }
  } catch (error) {
    listError.value = error instanceof Error ? error.message : '加载记录失败'
  } finally {
    loading.value = false
  }
}

async function refreshAll() {
  myIds.value = loadMyTests()
  await loadList()
}

function switchTab(next: 'all' | 'mine') {
  if (tab.value === next) return
  tab.value = next
  page.value = 1
  void loadList()
}

function changePage(next: number) {
  if (next < 1 || next > pageCount.value) return
  page.value = next
  void loadList()
}

async function submit(input: CreateTestInput) {
  submitting.value = true
  message.value = ''
  appError.value = ''
  try {
    const response = await api.createTest(input)
    myIds.value = addMyTest(response.test.id)
    formRef.value?.clearKey()
    message.value = `已提交后台测试，可关闭页面。任务：${response.test.id}`
    tab.value = 'all'
    page.value = 1
    await loadList()
    await openDetail(response.test.id)
  } catch (error) {
    if (error instanceof ApiError && error.fields) {
      message.value = Object.values(error.fields).join('；')
    } else {
      message.value = error instanceof Error ? error.message : '提交失败'
    }
  } finally {
    submitting.value = false
  }
}

function stopDetailStream() {
  if (detailStream) {
    detailStream.close()
    detailStream = null
  }
}

function stopDetailPoll() {
  if (detailTimer) {
    clearInterval(detailTimer)
    detailTimer = null
  }
}

function isTerminal(test: TestDetail | null | undefined): boolean {
  return test?.status === 'completed' || test?.status === 'failed'
}

function applyDetail(next: TestDetail) {
  if (detail.value && next.streamVersion < detail.value.streamVersion) return
  detail.value = next
  if (isTerminal(next)) {
    stopDetailStream()
    stopDetailPoll()
    void loadList(true)
  }
}

async function fetchDetail(id: string): Promise<boolean> {
  try {
    const response = await api.getTest(id)
    if (detailId.value !== id || !detailOpen.value) return false
    detailError.value = ''
    applyDetail(response.test)
    return true
  } catch (error) {
    if (detailId.value !== id || !detailOpen.value) return false
    detailError.value = error instanceof Error ? error.message : '加载详情失败'
    return false
  }
}

function startDetailPoll(id: string) {
  stopDetailPoll()
  detailTimer = setInterval(() => {
    if (!detailOpen.value || detailId.value !== id) return
    if (isTerminal(detail.value)) return
    void fetchDetail(id)
  }, 1500)
}

function startDetailStream(id: string) {
  stopDetailStream()
  detailStream = new EventSource(`/api/v1/tests/${id}/events`)
  detailStream.onmessage = (event) => {
    if (detailId.value !== id || !detailOpen.value) return
    try {
      const payload = JSON.parse(event.data) as { test?: TestDetail }
      if (payload.test) applyDetail(payload.test)
    } catch {
      // Ignore malformed keepalive events.
    }
  }
  detailStream.onerror = () => {
    // EventSource reconnects automatically; the 1.5s snapshot poll is the fallback.
  }
}

async function openDetail(id: string) {
  if (!ID_RE.test(id)) return
  detailId.value = id
  detailOpen.value = true
  detail.value = null
  detailError.value = ''
  setUrlId(id)
  stopDetailStream()
  startDetailPoll(id)
  const ok = await fetchDetail(id)
  if (!ok) return
  if (!isTerminal(detail.value)) startDetailStream(id)
}

function closeDetail() {
  stopDetailStream()
  stopDetailPoll()
  detailOpen.value = false
  detail.value = null
  detailError.value = ''
  detailId.value = ''
  setUrlId(null)
}

function refreshDetail() {
  if (detailId.value) void fetchDetail(detailId.value)
}

onMounted(async () => {
  myIds.value = loadMyTests()
  try {
    await loadConfig()
    await loadList()
    const initialId = new URLSearchParams(window.location.search).get('id') || ''
    if (initialId && ID_RE.test(initialId)) await openDetail(initialId)
  } catch (error) {
    appError.value = error instanceof Error ? error.message : '初始化失败'
  }
  listTimer = setInterval(() => {
    if (!document.hidden && !selectionBusy()) void loadList(true)
  }, 3000)
})

onBeforeUnmount(() => {
  if (listTimer) clearInterval(listTimer)
  stopDetailStream()
  stopDetailPoll()
})
</script>

<template>
  <div class="app-shell">
    <div class="ambient-grid" aria-hidden="true" />
    <header class="site-header">
      <a class="brand" href="/" aria-label="RelayCheck 首页">
        <span class="brand-mark">RC</span>
        <span>
          <strong>{{ config?.appName || 'RelayCheck' }}</strong>
          <small>{{ config?.tagline || '模型测智站' }}</small>
        </span>
      </a>
      <nav class="site-nav" aria-label="主导航">
        <a href="#new-test">发起检测</a>
        <a href="#records">公开记录</a>
        <a href="#how-it-works">判读逻辑</a>
      </nav>
      <div class="header-status">
        <span class="pulse-dot" />
        <span>ANONYMOUS · RATE LIMITED</span>
      </div>
    </header>

    <main v-if="config" class="site-main">
      <section class="hero">
        <div>
          <p class="eyebrow">REASONING CHECK / ROUTING FORENSICS</p>
          <h1>别猜了。<br /><span>让模型自己露馅。</span></h1>
          <p class="hero-copy">
            输入一个 OpenAI 兼容中转，检查它是否降智、掺水，或悄悄换成了别的模型。
            测试在服务端后台执行，关闭页面也不会中断。
          </p>
          <div class="hero-actions">
            <a class="primary" href="#new-test">开始检测</a>
            <a class="secondary" href="#how-it-works">先看判读逻辑</a>
          </div>
        </div>
        <div class="hero-stats">
          <div class="stat-card">
            <span class="stat-label">MODES</span>
            <strong>5</strong>
            <span>文字 / 图片 / 双测 / 水杯 / 指纹</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">PUBLIC RECORDS</span>
            <strong>{{ publicTotal }}</strong>
            <span>服务端持久化，按页公开</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">TIMEOUT</span>
            <strong>{{ Math.round(config.limits.timeoutMs / 1000) }}s</strong>
            <span>单次测试上限，失败也留证</span>
          </div>
          <div class="stat-card accent">
            <span class="stat-label">KEY POLICY</span>
            <strong>NO RAW KEY</strong>
            <span>记录只保存脱敏值</span>
          </div>
        </div>
      </section>

      <div v-if="appError" class="error-banner" role="alert">{{ appError }}</div>
      <div v-if="message" class="status-banner" role="status">{{ message }}</div>
      <div v-if="listError" class="error-banner" role="alert">{{ listError }}</div>

      <div class="content-grid">
        <div class="main-column">
          <TestForm ref="formRef" :config="config" :busy="submitting" @submit="submit" />
          <RecordTable
            :records="records"
            :total="total"
            :page="page"
            :page-size="pageSize"
            :loading="loading"
            :tab="tab"
            :my-count="myCount"
            @open="openDetail"
            @page="changePage"
            @tab="switchTab"
            @refresh="refreshAll"
          />
        </div>

        <aside class="side-column" id="how-it-works">
          <section class="sidebar-card">
            <p class="eyebrow">READ THE VERDICT</p>
            <h2>怎么看结果</h2>
            <div class="rule-list">
              <div class="rule">
                <span class="rule-index">01</span>
                <div>
                  <strong>严格项优先</strong>
                  <p>双测里，严格原图题通过就判不降智；旧题过、严格题不过，才是掺水/残血。</p>
                </div>
              </div>
              <div class="rule">
                <span class="rule-index">02</span>
                <div>
                  <strong>失败不等于降智</strong>
                  <p>401、超时、余额不足只是请求失败，会单独记录，不强行给出结论。</p>
                </div>
              </div>
              <div class="rule">
                <span class="rule-index">03</span>
                <div>
                  <strong>指纹是闭集概率</strong>
                  <p>ModelTrace 只能说明“更像库里的谁”，不是模型身份证明，也不是完整能力评分。</p>
                </div>
              </div>
              <div class="rule">
                <span class="rule-index">04</span>
                <div>
                  <strong>答案要人工看</strong>
                  <p>自动判定只检查答案数字，水杯题不校验证明；结论必须结合完整回答与上游账单。</p>
                </div>
              </div>
            </div>
          </section>

          <section class="sidebar-card protocol-card">
            <p class="eyebrow">PROTOCOL / LIMITS</p>
            <h2>服务端行为</h2>
            <dl>
              <div><dt>并发</dt><dd>{{ config.limits.maxActiveJobs }} 个任务 / {{ config.limits.maxQueue }} 排队</dd></div>
              <div><dt>单 IP</dt><dd>{{ config.limits.testsPerHourPerIp }} 次/小时</dd></div>
              <div><dt>回答上限</dt><dd>{{ (config.limits.maxAnswerBytes / 1024 / 1024).toFixed(0) }} MB</dd></div>
              <div><dt>记录保留</dt><dd>{{ config.limits.retentionDays }} 天 / {{ config.limits.maxRecords }} 条</dd></div>
              <div><dt>上游协议</dt><dd>Responses / Chat Completions</dd></div>
            </dl>
          </section>

          <section class="sidebar-card safety-card">
            <p class="eyebrow">BEFORE YOU PASTE</p>
            <h2>Key 安全</h2>
            <p>
              本站会把 Key 转发给目标中转，测试完成后不写入数据库；但请求期间服务端内存中必然存在原文。
              请使用低额度、可随时撤销的 Key，不要在公开网络提交高价值凭据。
            </p>
            <p class="fine-print">
              记录默认公开，包括问题、回答、脱敏地址与脱敏 Key。需要私密测试时请先部署私有实例并关闭公开列表。
            </p>
          </section>

          <section class="sidebar-card protocol-card">
            <p class="eyebrow">DISCLAIMER</p>
            <ul class="disclaimer-list">
              <li v-for="item in config.disclaimers" :key="item">{{ item }}</li>
            </ul>
          </section>
        </aside>
      </div>
    </main>

    <main v-else class="loading-shell">
      <div class="spinner" />
      <p>正在加载 {{ appError ? '失败' : '配置…' }}</p>
      <p v-if="appError" class="error-box">{{ appError }}</p>
    </main>

    <footer class="site-footer">
      <span>{{ config?.appName || 'RelayCheck' }} · 部署在自己的域名上</span>
      <span class="fine-print">Powered by ModelTrace fingerprinting. Results are not proof of identity or capability.</span>
    </footer>

    <TestDetailDialog
      :open="detailOpen"
      :test="detail"
      :share-url="shareUrl"
      :error="detailError"
      @close="closeDetail"
      @refresh="refreshDetail"
    />
  </div>
</template>