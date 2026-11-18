<script setup lang="ts">
const checks = [
  { title: '两个车轮', detail: '前后轮是否完整，是否与车架连接。' },
  { title: '腿与脚踏', detail: '脚是否落在脚踏上，运动时仍能保持连接。' },
  { title: '视角统一', detail: '鸟与自行车是否处于一致的视角。' },
  { title: '鹈鹕的喙', detail: '长喙下是否有明显喉囊，而非普通尖嘴。' },
]

const examples = [
  { id: 'baseline', title: '基准完整', tag: '第 1 档', detail: '车轮完整，脚接脚踏，鸟与车同侧视，喉囊清晰。', marks: ['通过', '通过', '通过', '通过'] },
  { id: 'mild', title: '腿脚脱离', tag: '第 2 档', detail: '车和鸟仍完整，但腿或脚踏飞离原位，接触关系断开。', marks: ['通过', '未通过', '通过', '通过'] },
  { id: 'moderate', title: '视角冲突', tag: '第 3 档', detail: '腿像直棍，鸟头正面配侧面的车，喉囊也不清晰。', marks: ['通过', '未通过', '未通过', '勉强'] },
  { id: 'severe', title: '结构破坏', tag: '第 4 档', detail: '车轮缺失，腿与车架混在一起，“骑”的关系不成立。', marks: ['未通过', '未通过', '未通过', '勉强'] },
]
</script>

<template>
  <section class="drawing-review" aria-label="画图结果与人工判读">
    <div class="drawing-review-grid">
      <slot />
      <aside class="drawing-checks" aria-labelledby="drawing-checks-title">
        <p class="eyebrow">人工对照</p>
        <h3 id="drawing-checks-title">可以从这四项观察。</h3>
        <p class="drawing-guide-intro">与 Cockpit Tools 一样，画图结果由你人工判断。以下是本站补充的观察提示，不计分。</p>
        <ol>
          <li v-for="(check, index) in checks" :key="check.title">
            <span class="drawing-check-number">{{ index + 1 }}</span>
            <div><h4>{{ check.title }}</h4><p>{{ check.detail }}</p></div>
          </li>
        </ol>
      </aside>
    </div>

    <section class="drawing-reference" aria-labelledby="drawing-reference-title">
      <div class="drawing-reference-heading">
        <div><p class="eyebrow">判读示意</p><h3 id="drawing-reference-title">四种结构，对照着看。</h3></div>
        <a href="https://www.getplus.ai/codex/gpt6-astra-jiangzhi" target="_blank" rel="noopener noreferrer" class="text-link">查看原文实测 <span aria-hidden="true">↗</span></a>
      </div>
      <p class="drawing-reference-intro">以下是本站绘制的教学示意，并非模型实测图片，也不是 Cockpit Tools 的评分标准。可结合实际动画观察结构问题。</p>
      <div class="drawing-reference-grid">
        <article v-for="example in examples" :key="example.id" class="drawing-reference-card" :data-example="example.id">
          <svg viewBox="0 0 260 170" role="img" :aria-label="`${example.title}：${example.detail}`" class="drawing-reference-art">
            <path d="M16 148H244" stroke="#dbe3e8" stroke-width="2" stroke-linecap="round" />
            <g v-if="example.id !== 'severe'" fill="#fff" stroke="#687989" stroke-width="3">
              <circle cx="66" cy="119" r="27" /><circle cx="194" cy="119" r="27" />
              <path d="m66 92 0 54m-27-27h54m101-27v54m-27-27h54" stroke="#c8d2d9" stroke-width="1.5" />
            </g>
            <g fill="none" stroke="#508eac" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
              <path v-if="example.id !== 'severe'" d="m66 119 39-47 21 47H66m39-47h69l-48 47m48-47 20 47m-22-54 2 7m-72-6 3 6m-12-7h22m57-1 6-12h14" />
              <path v-else d="m59 142 43-32 28 32H59m43-32h69l-41 32m41-32 32 32m-103-41 2 9m62-11 7 11m-1-8 8-10h14" />
              <circle v-if="example.id === 'baseline' || example.id === 'moderate'" cx="126" cy="119" r="8" stroke-width="2" />
              <path v-if="example.id === 'baseline'" d="m126 119 13 10h11M126 119l-9-9m-8 0h16" stroke="#687989" stroke-width="2" />
            </g>
            <g v-if="example.id === 'baseline' || example.id === 'mild'">
              <path d="M85 64c-19-6-27-16-33-10 6 20 26 31 44 29 19-2 34-12 33-30l-1-11c-1-13 5-24 17-24 11 0 16 8 15 17-12-2-17 3-15 13 3 22-11 40-35 41" fill="#fff" stroke="#8798a5" stroke-width="2" />
              <path d="M150 32 215 40l-62 7Z" fill="#efbd64" stroke="#b58b48" stroke-width="1.5" />
              <path d="M153 45q28 29 59-4" fill="#f8d891" stroke="#b58b48" stroke-width="1.5" />
              <circle cx="148" cy="28" r="2.3" fill="#344650" />
              <path d="M88 65q10 18 29 10l57-18" fill="none" stroke="#8798a5" stroke-width="3" stroke-linecap="round" />
            </g>
            <g v-else>
              <ellipse cx="117" cy="62" rx="24" ry="32" fill="#fff" stroke="#8798a5" stroke-width="2" />
              <ellipse cx="120" cy="30" rx="18" ry="21" fill="#fff" stroke="#8798a5" stroke-width="2" />
              <circle cx="112" cy="26" r="2.3" fill="#344650" /><circle cx="127" cy="26" r="2.3" fill="#344650" />
              <path :d="example.id === 'severe' ? 'm127 32 47 2-42 10Z' : 'm119 33 14 15-25-2Z'" fill="#efbd64" stroke="#b58b48" stroke-width="1.5" />
              <path d="m100 54 9 24m25-23-5 22" stroke="#c7d1d8" stroke-width="5" stroke-linecap="round" />
            </g>
            <g fill="none" stroke="#d49e50" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
              <path v-if="example.id === 'baseline'" d="m107 83 10 22 22 24h11m-50-45-9 20 22 6h8" />
              <path v-else-if="example.id === 'mild'" d="m28 25 12 16-13 17h12" />
              <path v-else-if="example.id === 'moderate'" d="m107 87 4 28m15-28 8 27" />
              <path v-else d="m105 90-9 39m31-39 17 32m-21-23 4 36" />
            </g>
            <g v-if="example.id === 'mild'" fill="none" stroke="#687989" stroke-width="2">
              <circle cx="57" cy="42" r="8" /><path d="m57 42 12 7h11" />
            </g>
            <g v-if="example.id !== 'baseline'" fill="none" stroke="#d09b69" stroke-width="1.5" stroke-dasharray="4 4">
              <ellipse v-if="example.id === 'mild'" cx="117" cy="106" rx="23" ry="20" />
              <ellipse v-else-if="example.id === 'moderate'" cx="120" cy="32" rx="24" ry="25" />
              <g v-else><circle cx="66" cy="121" r="25" /><circle cx="194" cy="121" r="25" /></g>
            </g>
          </svg>
          <div class="drawing-reference-copy">
            <p class="eyebrow">{{ example.tag }}</p><h4>{{ example.title }}</h4><p>{{ example.detail }}</p>
            <dl class="drawing-reference-marks">
              <div v-for="(check, index) in checks" :key="check.title">
                <dt>{{ check.title }}</dt><dd :class="{ 'is-passing': example.marks[index] === '通过' }">{{ example.marks[index] }}</dd>
              </div>
            </dl>
          </div>
        </article>
      </div>
      <p class="drawing-guide-footnote">单次生成有随机性，不足以证明模型降智。比较时保持提示词、模型和思考强度一致，并关注多次出现的结构问题。</p>
    </section>
  </section>
</template>
