import { describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/server/config'
import { MODEL_PRESETS } from '../../src/shared/constants'

describe('server defaults', () => {
  it('allows a full multi-mode testing session per hour', () => {
    const config = loadConfig({})
    expect(config.CREATE_PER_IP_PER_HOUR).toBe(30)
  })
})

describe('model presets', () => {
  it('offers domestic model presets for DeepSeek, GLM and Kimi', () => {
    const presets = MODEL_PRESETS.map((preset) => preset.id)
    expect(presets).toContain('deepseek-v4.1-flash')
    expect(presets).toContain('glm-5.3')
    expect(presets).toContain('kimi-k3')
    const labels = MODEL_PRESETS.map((preset) => preset.label)
    expect(labels).toContain('DeepSeek V4.1 Flash')
    expect(labels).toContain('GLM-5.3')
    expect(labels).toContain('Kimi K3')
  })
})