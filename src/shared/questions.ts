import type { QuestionPack } from './types'

/**
 * 题目措辞必须与公开基准原题逐字一致，不要“顺手把题目解释清楚”。
 *
 * 糖果题原题只说“参赛者需要在活动前决定摸出的糖果数目”，由模型自行推断：
 * 形状可以凭手感分辨，因此能自行分配圆形/五角星形各取多少颗。若额外写明
 * “可以自行决定取多少颗圆形、多少颗五角星形”，弱模型也能直接沿这条提示
 * 得到 21，会把外部判定为“降智”的中转误判成“不降智”（2026-11 实测对比）。
 * 同理，严格模式只发送题目图片，图片里也不能带额外汇总或提示。
 */
export const CANDY_QUESTION_TEXT = `在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状（圆形和五角星形，不同的形状靠手感可以分辨）。现已知不同口味的糖和不同形状的数量统计如下表。参赛者需要在活动前决定摸出的糖果数目，那么，最少取出多少个糖果才能保证手中同时拥有不同形状的苹果味和桃子味的糖？（同时手中有圆形苹果味匹配五角星桃子味糖果，或者有圆形桃子味匹配五角星苹果味糖果都满足要求）

| 形状 | 苹果味 | 桃子味 | 西瓜味 |
| 圆形 | 7 | 9 | 8 |
| 五角星形 | 7 | 6 | 4 |`

export const CUP_QUESTION_TEXT = `有一个水杯配对游戏。共有 4 种不同颜色的水杯，每种颜色各有两个。将同色的两个水杯分别放在上下两层，因此
上下两层各有 4 个水杯。下层 4 个水杯按某个未知顺序排列，挑战者无法看到它们；上层水杯的颜色和位置则完
全可见。游戏开始后，挑战者可以反复进行以下操作：
1. 向裁判询问当前有多少个位置满足“上下两个水杯颜色相同”。裁判只回答匹配位置的总数，不透露具体是哪些位置；
2. 根据目前获得的所有信息，挑战者可以选择交换上层任意两个相邻位置的水杯，注意只能是相邻，不能是任意两个。
当 4 个位置全部匹配时，游戏结束。问题：
挑战者应采用何种策略，才能保证对于下层水杯的任意排列都能完成配对？
所有能保证成功的策略中，最坏情况所需的交换次数最少是多少？
回答时请不要进行联网搜索，也不要写代码来辅助计算(包括思考过程中)。
假设答案是 x ，你需要给出严格的证明，为什么 x 可行，为什么小于 x 不可行。`

// Keep the reference prompt verbatim; explaining the four checks would change the test.
// https://www.getplus.ai/codex/gpt6-astra-jiangzhi
export const PELICAN_QUESTION_TEXT = '创建一个HTML，内容是SVG绘制一个鹈鹕骑自行车的2D动画，你不需要任何测试，只靠你自己完成，不要使用任何skill，不要依赖我本地的AGENTS.md'

/**
 * 基准原题的表格缺少 Markdown 表头分隔行；模型请求保持原样，
 * 只在界面预览/图片渲染时补上分隔行。参考实现同样如此。
 */
export function questionForDisplay(text: string | null | undefined): string {
  return String(text ?? '').replace(
    /(\| 形状 \| 苹果味 \| 桃子味 \| 西瓜味 \|\r?\n)(?=\| 圆形)/,
    '$1| --- | --- | --- | --- |\n',
  )
}

export const QUESTION_PACK: QuestionPack = {
  id: 'relaycheck-core',
  version: '2026-11-v3',
  question: CANDY_QUESTION_TEXT,
  cupQuestion: CUP_QUESTION_TEXT,
  pelicanQuestion: PELICAN_QUESTION_TEXT,
  strictQuestionLabel: '糖果题（严格）：仅向模型发送原图，不附加文字题或提示词。',
  questionImage: '/questions/candy-strict.v2.png',
  candyAnswer: 21,
  cupAnswer: 8,
}
