<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CreateTestInput, PublicConfig, TestDetail, TestSummary } from '../shared/types'
import { ApiError, api } from './lib/api'
import { addMyTest, loadMyTests, removeMyTest } from './lib/my-tests'
import TestForm from './components/TestForm.vue'
import RecordTable from './components/RecordTable.vue'
import TestDetailDialog from './components/TestDetailDialog.vue'
import PelicanBike from './components/PelicanBike.vue'

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
const submitError = ref('')
const myIds = ref<string[]>([])
const detail = ref<TestDetail | null>(null)
const detailOpen = ref(false)
const detailError = ref('')
const detailId = ref('')
const formRef = ref<{ clearKey: () => void } | null>(null)

let detailStream: EventSource | null = null
let listTimer: ReturnType<typeof setInterval> | null = null
let detailTimer: ReturnType<typeof setInterval> | null = null
let listRequest: AbortController | null = null
let detailRequest: AbortController | null = null
let disposed = false

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
  if (!response.config.publicListEnabled) tab.value = 'mine'
}

function selectionBusy(): boolean {
  const selection = window.getSelection()
  return Boolean(selection && !selection.isCollapsed && selection.toString())
}

async function loadList(silent = false): Promise<void> {
  if (disposed || (silent && (loading.value || selectionBusy()))) return
  listRequest?.abort()
  const controller = new AbortController()
  listRequest = controller
  const selectedTab = tab.value
  const selectedPage = page.value
  let reload = false
  loading.value = true
  if (!silent) listError.value = ''
  try {
    if (selectedTab === 'mine') {
      myIds.value = loadMyTests()
      const ids = [...myIds.value].reverse()
      const start = (selectedPage - 1) * pageSize.value
      const pageIds = ids.slice(start, start + pageSize.value)
      const response = await api.getSummaries(pageIds, controller.signal)
      if (controller.signal.aborted || disposed) return
      for (const id of response.missingIds) myIds.value = removeMyTest(id)
      records.value = response.records
      total.value = myIds.value.length
      reload = response.missingIds.length > 0
    } else {
      const response = await api.listTests(selectedPage, controller.signal)
      if (controller.signal.aborted || disposed) return
      records.value = response.records
      total.value = response.total
      publicTotal.value = response.total
      pageSize.value = response.pageSize
    }
    if (page.value > pageCount.value) { page.value = pageCount.value; reload = true }
    listError.value = ''
  } catch (error) {
    if (!controller.signal.aborted && !disposed) listError.value = error instanceof Error ? error.message : '加载记录失败'
  } finally {
    if (listRequest === controller) {
      loading.value = false
      listRequest = null
      if (reload && !disposed) void loadList(silent)
    }
  }
}

async function refreshAll() {
  myIds.value = loadMyTests()
  await loadList()
}

async function switchTab(next: 'all' | 'mine') {
  if (tab.value === next) return
  tab.value = next
  page.value = 1
  void loadList()
}

async function changePage(next: number) {
  if (next < 1 || next > pageCount.value) return
  page.value = next
  void loadList()
}

async function submit(input: CreateTestInput) {
  submitting.value = true
  message.value = ''
  submitError.value = ''
  appError.value = ''
  try {
    const response = await api.createTest(input)
    myIds.value = addMyTest(response.test.id)
    formRef.value?.clearKey()
    message.value = `已提交后台测试，可关闭页面。任务：${response.test.id}`
    tab.value = config.value?.publicListEnabled ? 'all' : 'mine'
    page.value = 1
    await loadList()
    await openDetail(response.test.id)
  } catch (error) {
    if (error instanceof ApiError && error.fields) {
      submitError.value = Object.values(error.fields).join('；')
    } else {
      submitError.value = error instanceof Error ? error.message : '提交失败'
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
  if (next.id !== detailId.value || !detailOpen.value) return
  if (detail.value && next.streamVersion <= detail.value.streamVersion) return
  detail.value = next
  if (isTerminal(next)) {
    stopDetailStream()
    stopDetailPoll()
    void loadList(true)
  }
}

async function fetchDetail(id: string): Promise<boolean> {
  if (detailRequest || disposed) return false
  const controller = new AbortController()
  detailRequest = controller
  try {
    const response = await api.getTest(id, controller.signal)
    if (controller.signal.aborted || detailId.value !== id || !detailOpen.value) return false
    detailError.value = ''
    applyDetail(response.test)
    return true
  } catch (error) {
    if (controller.signal.aborted || detailId.value !== id || !detailOpen.value) return false
    detailError.value = error instanceof Error ? error.message : '加载详情失败'
    if (error instanceof ApiError && error.status === 404) {
      stopDetailPoll()
      stopDetailStream()
    }
    return false
  } finally {
    if (detailRequest === controller) detailRequest = null
  }
}

function startDetailPoll(id: string) {
  stopDetailPoll()
  detailTimer = setInterval(() => {
    if (!detailOpen.value || detailId.value !== id || document.hidden) return
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
  detailRequest?.abort()
  detailRequest = null
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
  detailRequest?.abort()
  detailRequest = null
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
  disposed = true
  listRequest?.abort()
  detailRequest?.abort()
  if (listTimer) clearInterval(listTimer)
  stopDetailStream()
  stopDetailPoll()
})
</script>

<template>
  <div class="app-shell">
    <a class="skip-link" href="#new-test">跳转到新建检测</a>
    <header class="site-header">
      <div class="header-inner">
        <a class="brand" href="/" aria-label="RelayCheck 首页">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none"><rect x="7" y="6" width="13" height="17" rx="4" stroke="currentColor" stroke-width="1.7" opacity=".55"/><rect x="12" y="10" width="13" height="17" rx="4" fill="currentColor"/><path d="m16 18 2 2 3.5-4" stroke="#0875df" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </span>
          <strong>{{ config?.appName || 'RelayCheck' }}</strong>
        </a>
        <nav class="site-nav" aria-label="主导航">
          <a href="#new-test">新建检测</a>
          <a href="#records">检测记录</a>
          <a href="#how-it-works">使用指南</a>
        </nav>
        <span class="header-note">模型测智站</span>
      </div>
    </header>

    <main v-if="config" class="site-main">
      <section class="hero" aria-labelledby="hero-title">
        <p class="eyebrow">让每次检测，都有据可循</p>
        <h1 id="hero-title">让模型表现，<br /><span>一目了然。</span></h1>
        <p class="hero-copy">用六种检测方式，了解你的 AI 中转。<br class="desktop-break" />从推理到视觉，结果自动保存，随时查看与分享。</p>
        <div class="hero-actions">
          <a class="primary" href="#new-test">开始检测 <span aria-hidden="true">↗</span></a>
          <a class="text-link" href="#how-it-works">了解检测方式 <span aria-hidden="true">›</span></a>
        </div>
      </section>

      <div class="hero-stats" aria-label="服务概览">
        <div class="stat-card"><strong>{{ config.modes.length }} <small>种</small></strong><span>检测方式</span></div>
        <div class="stat-card"><strong>{{ config.publicListEnabled ? publicTotal : '未公开' }}</strong><span>{{ config.publicListEnabled ? '公开检测记录' : '通过链接查看详情' }}</span></div>
        <div class="stat-card"><strong>{{ Math.round(config.limits.timeoutMs / 1000) }} <small>秒</small></strong><span>单次检测上限</span></div>
        <div class="stat-card"><strong>脱敏存储</strong><span>不保存原始 Key</span></div>
      </div>

      <div class="notification-stack" aria-live="polite">
        <div v-if="appError" class="error-banner" role="alert">{{ appError }}</div>
        <div v-if="message" class="status-banner" role="status">{{ message }}</div>
        <div v-if="submitError" class="error-banner" role="alert">{{ submitError }}</div>
        <div v-if="listError" class="error-banner" role="alert">{{ listError }}</div>
      </div>

      <div class="content-grid">
        <div class="main-column">
          <TestForm ref="formRef" :config="config" :busy="submitting" @submit="submit" />
        </div>
        <RecordTable
          :records="records" :total="total" :page="page" :page-size="pageSize"
          :loading="loading" :tab="tab" :my-count="myCount" :public-list-enabled="config.publicListEnabled"
          @open="openDetail" @page="changePage" @tab="switchTab" @refresh="refreshAll"
        />
        <aside class="side-column" id="how-it-works" aria-label="检测指南">
          <a class="relay-link" href="https://aloneapi.top/" target="_blank" rel="noopener noreferrer">
            <span class="relay-link-copy"><strong>不降智中转</strong><span>aloneapi.top</span></span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10" /></svg>
          </a>
          <section class="sidebar-card guide-card">
            <div class="sidebar-heading">
              <span class="section-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 5.5c3-1.5 5-1.5 8 0 3-1.5 5-1.5 8 0v14c-3-1.5-5-1.5-8 0-3-1.5-5-1.5-8 0z"/><path d="M12 5.5v14"/></svg></span>
              <h2>读懂你的检测结果</h2>
            </div>
            <p class="sidebar-intro">多一点证据，少一点猜测。</p>
            <div class="rule-list">
              <div class="rule"><span class="rule-index">1</span><div><strong>优先看严格项</strong><p>双测以原图题为准。文字题通过、原图题未通过，说明可能存在掺水。</p></div></div>
              <div class="rule"><span class="rule-index">2</span><div><strong>请求失败，单独记录</strong><p>授权错误、超时或余额不足不代表降智，结果中会保留失败原因。</p></div></div>
              <div class="rule"><span class="rule-index">3</span><div><strong>指纹提供参考</strong><p>ModelTrace 显示与已收录模型的相似度，不能作为模型身份证明。</p></div></div>
              <div class="rule"><span class="rule-index">4</span><div><strong>也看看完整回答</strong><p>数字判定不校验证明，画图题需要人工看图。结合回答和上游账单判断。</p></div></div>
            </div>
          </section>

          <section class="sidebar-card safety-card">
            <div class="sidebar-heading">
              <span class="section-icon neutral" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4.5 6v5.5c0 4.5 3.2 7.7 7.5 9.5 4.3-1.8 7.5-5 7.5-9.5V6z"/><path d="m8.5 12 2.3 2.3 4.7-5"/></svg></span>
              <h2>为隐私多想一步</h2>
            </div>
            <p>原始 Key 仅在请求期间使用，记录只保存脱敏值。建议使用低额度、可撤销的 Key。</p>
            <details class="privacy-details"><summary>了解记录的可见范围</summary><p>Key 会经过本站服务器并转发给目标中转。记录包含问题、回答及脱敏信息。关闭公开列表仅隐藏索引，持有分享链接的人仍可访问详情。私密测试请使用受访问控制的私有实例。</p></details>
          </section>

          <div class="mascot-card">
            <PelicanBike />
            <p class="mascot-caption">一点好奇，不参与判定。</p>
          </div>
        </aside>
      </div>


      <section class="service-notes" aria-label="服务说明">
        <details class="service-disclosure">
          <summary><span>使用限额与记录保留</span><span class="disclosure-hint">服务说明</span></summary>
          <dl class="service-limits">
            <div><dt>同时检测</dt><dd>{{ config.limits.maxActiveJobs }} 个任务，最多 {{ config.limits.maxQueue }} 个排队</dd></div>
            <div><dt>每个 IP</dt><dd>{{ config.limits.testsPerHourPerIp }} 次 / 小时</dd></div>
            <div><dt>回答大小</dt><dd>最多 {{ (config.limits.maxAnswerBytes / 1024 / 1024).toFixed(0) }} MB</dd></div>
            <div><dt>记录保留</dt><dd>{{ config.limits.retentionDays }} 天，最多 {{ config.limits.maxRecords }} 条已结束记录</dd></div>
          </dl>
        </details>
        <p class="service-footnote">检测结果仅供参考，不是官方结论或完整能力评测。测试在后台继续，关闭页面也不会中断。</p>
      </section>
    </main>

    <main v-else class="loading-shell">
      <div v-if="!appError" class="spinner" aria-label="正在加载" />
      <h1>{{ appError ? '暂时无法连接' : '正在准备你的检测空间' }}</h1>
      <p v-if="appError" class="error-box" role="alert">{{ appError }}</p>
      <a v-if="appError" class="secondary" href="/">重新加载</a>
      <p v-else>马上就好。</p>
    </main>

    <footer class="site-footer">
      <span>{{ config?.appName || 'RelayCheck' }} <span class="footer-separator">·</span> {{ config?.tagline || '模型测智站' }}</span>
      <span>保持好奇，认真判断。</span>
      <a href="#new-test">回到检测 <span aria-hidden="true">↑</span></a>
    </footer>

    <TestDetailDialog :open="detailOpen" :test="detail" :share-url="shareUrl" :error="detailError" @close="closeDetail" @refresh="refreshDetail" />
  </div>
</template>
