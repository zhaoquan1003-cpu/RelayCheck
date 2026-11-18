import type { ApiType, Effort, ModelPreset, TestModeMeta } from './types'

export const APP_DEFAULTS = {
  appName: 'RelayCheck',
  tagline: '模型测智站',
  defaultTestMode: 'dual' as const,
  defaultEffort: 'low' as const,
  defaultApiType: 'responses' as const,
}

export const TEST_MODE_META: TestModeMeta[] = [
  {
    id: 'dual',
    label: '快速测试 · 糖果题（双测）',
    short: '双测',
    help: '并发发送旧文字题与严格原图题。两项都通过为“不降智”；旧题通过而严格题不通过为“掺水/残血”；两项都不通过为“降智”；任一请求失败则不判定。',
  },
  {
    id: 'strict',
    label: '快速测试 · 糖果题（严格原图）',
    short: '严格原图',
    help: '只发送糖果题原图，不附加文字题面或提示词。回答正文包含 21 即通过，适合检查视觉通路是否被替换。目标模型必须支持图片输入。',
  },
  {
    id: 'quick',
    label: '快速测试 · 糖果题（旧文字）',
    short: '旧文字',
    help: '发送文字版糖果题，回答正文包含 21 即通过。它只能作为基础信号，建议和严格原图一起使用。',
  },
  {
    id: 'cup',
    label: '快速测试 · 水杯题',
    short: '水杯题',
    help: '发送水杯相邻交换题，回答正文出现独立数字 8 即通过。自动判定不校验证明，请以完整回答人工核验。',
  },
  {
    id: 'pelican',
    label: '画图检测 · 鹈鹕骑自行车动画',
    short: '画图',
    help: '使用 Cockpit Tools 的固定题目和交付指令生成骑行动画，HTML 与 SVG 均可运行。打开结果人工判读；四项观察提示仅供参考，不自动评分。',
  },
  {
    id: 'advanced',
    label: '高级测试 · ModelTrace 指纹',
    short: 'ModelTrace',
    help: '并发发送 3 条长数字题，与公开模型指纹库比对。指纹是闭集概率，不是身份证明；只有配置了模型等级时才自动判定“降智/不降智”。',
  },
]

export const API_TYPE_META: Array<{ id: ApiType; label: string; help: string }> = [
  { id: 'responses', label: 'Responses（默认）', help: '调用 /v1/responses 流式接口。' },
  { id: 'chat_completions', label: 'Chat Completions', help: '调用 /v1/chat/completions 流式接口。' },
]

export const EFFORT_META: Array<{ id: Effort; label: string }> = [
  { id: 'low', label: 'low · 低（默认）' },
  { id: 'medium', label: 'medium · 中等' },
  { id: 'high', label: 'high · 高' },
  { id: 'xhigh', label: 'xhigh · 极高' },
  { id: 'minimal', label: 'minimal · 最低' },
  { id: 'none', label: 'none · 不启用思考' },
]

export const MODEL_PRESETS: ModelPreset[] = [
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', hint: '推理旗舰示例' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', hint: '高性价比示例' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', hint: '上一代示例' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', hint: 'Claude 示例' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', hint: 'Claude 示例' },
  { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', hint: '国产 · DeepSeek' },
  { id: 'glm-5.3', label: 'GLM-5.3', hint: '国产 · 智谱' },
  { id: 'kimi-k3', label: 'Kimi K3', hint: '国产 · 月之暗面' },
  { id: 'custom', label: '自定义模型', hint: '填写上游支持的模型 ID' },
]

export const PAGE_SIZE = 30

export const DISCLAIMERS = [
  '测试结果仅供参考，不是官方结论或完整能力评测。',
  'API Key 会经过本站服务器并转发给目标中转；请使用低额度、可随时撤销的 Key。',
  '公开记录默认对所有人可见；不要提交敏感内容。',
  '自动判定依赖关键词或闭集指纹，可能出现误判；请结合完整回答和上游账单核验。',
]
