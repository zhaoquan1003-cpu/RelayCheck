import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import MarkdownIt from 'markdown-it'
import { CANDY_QUESTION_TEXT } from '../src/shared/questions'

const md = new MarkdownIt({ html: false, breaks: true })
const body = md.render(CANDY_QUESTION_TEXT)

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
  .tag {
    margin-bottom: 22px;
    color: #8fb7d8;
    font-family: Consolas, monospace;
    font-size: 14px;
    letter-spacing: .16em;
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
  .rule { height: 1px; margin: 26px 0; background: rgba(160, 190, 230, 0.16); }
  .foot { color: #7f9bb5; font-size: 14px; line-height: 1.6; }
</style>
</head>
<body>
  <main class="card">
    <div class="tag">REASONING CHECK / CANDY TABLE</div>
    ${body}
    <div class="rule"></div>
    <p class="foot">请直接回答，并给出严格证明。不要调用搜索、代码执行器或其他工具。</p>
  </main>
</body>
</html>`

const output = resolve(process.cwd(), 'public', 'questions', 'candy-strict.v1.png')
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const browser = await chromium.launch({
  headless: true,
  executablePath: existsSync(edge) ? edge : undefined,
  channel: existsSync(edge) ? undefined : 'msedge',
})
try {
  const page = await browser.newPage({ viewport: { width: 880, height: 1200 }, deviceScaleFactor: 2 })
  await page.setContent(html, { waitUntil: 'load' })
  await page.screenshot({ path: output, fullPage: true, type: 'png' })
  console.log(`wrote ${output}`)
} finally {
  await browser.close()
}