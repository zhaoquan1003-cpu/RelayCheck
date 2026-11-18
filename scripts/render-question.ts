import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import MarkdownIt from 'markdown-it'
import { CANDY_QUESTION_TEXT, questionForDisplay } from '../src/shared/questions'

// 图片内容必须与模型收到的题目一致，只额外补上 Markdown 表头分隔行用于排版。
// 不要在图片里添加“可以自行分配形状数量”“请给出证明”之类的额外提示：
// 那会把弱模型问成 21，导致本站在外部判定为“降智”的中转上误报“不降智”。
const md = new MarkdownIt({ html: false, breaks: true })
const body = md.render(questionForDisplay(CANDY_QUESTION_TEXT))

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #07101d; }
  body {
    width: 880px;
    padding: 46px 52px 42px;
    color: #f4f7fb;
    font-family: "Microsoft YaHei", "Noto Sans SC", "PingFang SC", sans-serif;
    font-size: 21px;
    line-height: 1.7;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    padding: 34px 38px;
    border: 1px solid rgba(160, 190, 230, 0.22);
    border-radius: 18px;
    background: linear-gradient(145deg, #0d1929, #091320);
  }
  p { margin: 0 0 18px; }
  strong { color: #ffffff; }
  table {
    width: 100%;
    margin: 22px 0 20px;
    border-collapse: collapse;
    font-size: 19px;
  }
  th, td {
    padding: 9px 14px;
    border: 1px solid rgba(160, 190, 230, 0.24);
    text-align: left;
  }
  th { color: #a7c7e0; background: rgba(84, 137, 180, 0.12); }
  td { color: #f4f7fb; }
  code { color: #9fe8d2; font-family: Consolas, monospace; }
</style>
</head>
<body>
  <main class="card">
    ${body}
  </main>
</body>
</html>`

const version = 'v2'
const output = resolve(process.cwd(), 'public', 'questions', `candy-strict.${version}.png`)
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const browser = await chromium.launch(
  existsSync(edge)
    ? { headless: true, executablePath: edge }
    : { headless: true },
)
try {
  const page = await browser.newPage({ viewport: { width: 880, height: 600 }, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'load' })
  await page.screenshot({ path: output, fullPage: true, type: 'png' })
  console.log(`wrote ${output}`)
} finally {
  await browser.close()
}