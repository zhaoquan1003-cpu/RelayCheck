# RelayCheck · 模型测智站

一个可自托管的 OpenAI 兼容中转检测站，通过推理题、图片题、动画生成和模型指纹，辅助检查中转的回答表现与模型路由是否符合预期。测试在服务端后台执行，结果自动保存并支持链接分享；默认保留 30 天、最多 500 条已结束记录，可按需调整或备份。

支持 **Responses / Chat Completions**，采用 **Vue 3 + TypeScript + Fastify + SQLite**，提供桌面与手机自适应界面。

[GitHub 仓库](https://github.com/zhaoquan1003-cpu/RelayCheck) · [API 文档](docs/API.md) · [部署与备份](docs/DEPLOY.md) · [安全模型](docs/THREAT_MODEL.md)

![RelayCheck 首页](docs/screenshots/home.png)

截图来自本地模拟测试环境；图中的地址、模型回答和检测限额用于演示，实际默认配置见下文。

## 功能

- **六种测试模式**
  - `quick`：文字版糖果题，检查回答中的独立数字 `21`
  - `strict`：只发糖果题原图，检查视觉通路是否被隐藏/替换
  - `dual`：文字题与图片题并发；严格项优先，旧题过而严格题不过判为“掺水/残血”
  - `cup`：水杯相邻交换题，检查独立数字 `8`（不校验证明）
  - `pelican`：使用固定原题生成鹈鹕骑自行车的 HTML + SVG 动画，按四项结构人工对照判读
  - `advanced`：3 条 ModelTrace 长数字题，做闭集模型指纹归因
- **模型预设**：GPT / Claude 示例，以及 DeepSeek、GLM、Kimi 等国产模型；中转命名不一致时选“自定义模型”填实际 ID。
- **接口与推理强度**：支持 Responses、Chat Completions，以及 `none` / `minimal` / `low` / `medium` / `high` / `xhigh`；需与上游实际支持的参数一致。
- **后台任务**：关闭/刷新页面不中断；默认单测试 300 秒超时、每个子请求 2 MB 回答上限、失败留证。
- **实时与回退**：详情 SSE + 3 秒列表轮询 + 1.5 秒快照回退。
- **公开记录**：按页公开，详情含完整问题、回答、probes、错误和指纹；支持 `?id=` 分享。
- **我的测试**：当前浏览器 `localStorage` 保存最近 100 个记录 ID，无需登录；问题、回答与结果保存在服务端。
- **画图预览**：HTML + SVG 动画支持停止、重新播放和查看回答源码，附四项人工对照说明与四档自绘参考示意。
- **隐私设计**：原始 Key/地址只在任务内存中存在，数据库和公开 API 只保存脱敏值。
- **安全**：SSRF 校验、禁止重定向、端口限制、限流、并发上限、CSP、错误脱敏；画图 HTML 在沙箱中运行，旧 SVG 以隔离图片方式渲染。
- **可部署**：Node 24 + Fastify + SQLite；Docker 多阶段构建 + Caddy（或自带 nginx 示例）。

![测试详情](docs/screenshots/detail.png)

## 页面使用

1. 选择检测方式，默认是“糖果题（双测）”；严格原图与双测需要目标模型支持图片输入。
2. 选择接口类型、模型和思考强度，默认使用 `responses`、`gpt-6-astra`、`low`。预设是模型 ID 示例，实际可用性由中转决定。
3. 填入中转地址与 API Key，可展开题目预览后提交。任务进入后台执行，提交成功后输入框会清空 Key。
4. 在详情中查看完整回答、子测试、错误和 ModelTrace 指纹，或复制分享链接。画图题需要结合动画与四项结构说明人工判读。
5. 从“全部”或“我的”查看历史记录；清除浏览器数据会丢失“我的”记录索引，服务端记录仍按保留策略清理。

首页侧栏提供标注为“不降智中转”的 [aloneapi.top](https://aloneapi.top/) 外部入口，在新标签页打开。

![画图检测：动画预览与人工判读](docs/screenshots/drawing-ui/drawing-preview-1440.png)

上图使用本地模拟上游的演示动画，展示预览与判读界面。

## 快速开始

要求 **Node.js 24+**，建议使用项目锁定的 **pnpm 11.28.5**。

```bash
git clone https://github.com/zhaoquan1003-cpu/RelayCheck.git
cd RelayCheck
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Windows PowerShell 可将复制命令替换为 `Copy-Item .env.example .env`。已有本地配置时，保留现有 `.env`。

- 前端：<http://127.0.0.1:5173>
- API：<http://127.0.0.1:3000>
- 生产构建并启动：

```bash
pnpm build
pnpm start
```

`pnpm start` 自动启用生产模式并读取 `.env`。直接运行 `node dist/server/index.js` 时，应在环境中设置 `NODE_ENV=production`。

本地完整验收：`pnpm check`（类型检查、单元/集成测试、生产构建、浏览器测试、生产冒烟）。依赖安全检查：`pnpm audit --prod`。

升级旧配置时，将 `TRUST_PROXY=true` 改为直连时的 `false`；只经过一个受控反向代理时使用 `1`，且禁止外部直接访问后端端口。生产模式会拒绝私网上游开关、无效布尔值和错误的管理员令牌摘要。

`pnpm dev` 同时启动 Vite 与 Fastify；生产由 Fastify 直接服务 `dist/client`。

### 生成 admin token（可选）

```bash
# 生成随机 token 并保存好；只把 SHA-256 摘要写入 .env
node -e "const c=require('node:crypto');const t=c.randomBytes(32).toString('hex');console.log('Token: '+t);console.log('ADMIN_TOKEN_HASH='+c.createHash('sha256').update(t).digest('hex'))"
```

保存输出中的 `Token`，只将摘要填入 `.env` 的 `ADMIN_TOKEN_HASH`，然后用 `Authorization: Bearer <Token>` 访问：

- `GET /api/v1/admin/stats`
- `GET /api/v1/admin/tests?page=1`
- `DELETE /api/v1/admin/tests/:id`

未配置时 admin 路由为 404。

## 架构

```text
浏览器 ── HTTPS ──► Caddy / nginx
                       ├─ /             Fastify 托管 Vue 构建产物
                       └─ /api/v1/...   JSON API + SSE
                                            │
                                            ├─ SQLite（tests / probes，WAL）
                                            ├─ 内存队列 + worker
                                            ├─ SSE hub
                                            └─ undici → 目标中转
                                                         Responses / Chat
```

- 单进程、单实例；SQLite 足够支撑公开小站。
- 任务只存在内存队列 + 数据库状态；正常关闭会取消排队与运行中的请求并保存失败状态，异常退出后的未完成任务在重启时标为失败（因为 Key 不会被持久化）。
- SSRF 防护在 DNS 解析和连接 lookup 两处校验；只允许 http/https 和 80/443，且拒绝私网/保留地址。
- `ALLOW_PRIVATE_UPSTREAMS=true` 仅供测试使用，生产不要开启。

## 测试与判定

| 模式 | 发送 | 自动判定 |
|---|---|---|
| quick | 糖果文字题 | 独立数字 `21` → pass |
| strict | 仅糖果题图片 | 独立数字 `21` → pass |
| dual | quick + strict 并发 | 任一请求 failed → 无法判定；strict 通过 → pass；否则 quick 通过 → watered；否则 fail |
| cup | 水杯题 | 独立数字 `8` → pass（不校验证明） |
| pelican | 固定原题：创建包含鹈鹕骑自行车 SVG 2D 动画的 HTML | 请求成功 → unknown（待人工判读）；格式缺失、截断、超过 512 KiB 分别提示，不自动推断降智 |
| advanced | 3 条 ModelTrace 数字题 | 任一请求失败 → failed；有效指纹回答不足 3 条 → unknown；完整指纹匹配模型 ID 或预测等级不低于目标 → pass；预测等级低于目标 → fail；等级缺失 → unknown |

“独立数字”用 Unicode 边界判断，`210`、`21.5` 不会误算成 `21`。

画图题逐字采用 [GetPlus 的固定原题](https://www.getplus.ai/codex/gpt6-astra-jiangzhi)，不附加结构提示。HTML 的 CSS 和 JavaScript 在独立预览路由与不具同源权限的 iframe 沙箱中运行；预览禁用外部资源、接口请求、弹窗及顶层跳转，关闭详情会卸载动画。独立 SVG 则继续经 DOMPurify 清洗后以 `data:` 图片展示。格式识别不等于画面质量检查，四项（车轮、腿与脚踏、视角、鹈鹕喙）由用户结合动画判读；四档自绘示意是教学参考，不是模型实测。一次生成不能证明模型降智。

当前题目版本为 `2026-11-v3`（更新画图题，原记录保留自己的题目）。糖果题/水杯题措辞仍与公开基准原题逐字一致：原题只要求“在活动前决定摸出的糖果数目”，不额外解释可以自行分配两种形状的数量。若在题面或严格模式图片里补上这类提示，会把外部判定为“降智”的中转误判成“不降智”。严格模式图片为本站自绘，但文字内容与原题一致。

> 这些判定是启发式的路由一致性检查，不是完整能力评测。请结合完整回答、上游账单和人工核验。

## API

详见 [docs/API.md](docs/API.md)。核心端点：

```text
GET  /api/v1/config
GET  /api/v1/tests?page=1
GET  /api/v1/tests/summaries?ids=...
POST /api/v1/tests                202
GET  /api/v1/tests/:id
GET  /api/v1/tests/:id/events     SSE
GET  /api/v1/tests/:id/preview    沙箱动画预览
GET  /api/v1/health
```

创建请求：

```json
{
  "address": "https://relay.example.com",
  "key": "sk-...",
  "apiType": "responses",
  "model": "gpt-6-astra",
  "effort": "low",
  "testMode": "dual"
}
```

## 安全模型

- **原始 Key 不写入数据库、公开 API、SSE 或日志**；只在 worker 内存中存活到任务结束。
- **回显脱敏**：上游答案与错误中的已知 Key、地址/主机及常见编码形式在保存前被替换；无效/不完整响应保留已接收证据并记为失败。
- **地址和 Key 只公开脱敏值**，例如 `https://r****.com`、`sk-3****7890`。
- **SSRF 防护**：仅 http/https；生产端口 80/443；禁止用户名密码、query/hash、相对路径、重定向；DNS 解析结果和实际连接 lookup 都会拒绝私网/loopback/link-local/保留地址。
- **限流/容量**：每 IP 每小时创建次数、每 IP 活跃测试数、全局活跃任务数、队列上限、SSE 每 IP 连接数。
- **CSP/Helmet**：静态 SPA 与 API 都经过 Fastify；HSTS 由 Caddy/nginx 在 TLS 层添加。
- **答案渲染**：markdown-it `html:false`、禁用图片、链接 `noopener`、DOMPurify、KaTeX `trust:false`。

完整威胁模型：[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md)。

### 你必须知道的边界

1. **Key 必然经过本站服务器**；请求期间内存中存在原文。不要提交高价值/不可撤销的 Key。
2. **公开记录默认包含问题、回答、脱敏地址/Key**；关闭公开列表只隐藏索引，持有记录 ID 或分享链接的人仍可访问详情、SSE 和动画预览。私密实例需要额外的访问控制。
3. **任意中转地址**会带来 SSRF/出站流量风险；测试环境才可开 `ALLOW_PRIVATE_UPSTREAMS`。
4. **指纹是闭集概率**，不是模型身份或能力证明；未收录模型会归到最相似的候选。
5. 自动判定只看答案数字，水杯题不证明验证；可能出现误判。

## ModelTrace

高级模式使用 [ModelTrace](https://github.com/xqy2006/ModelTrace) 的挑战生成器与指纹库，固定 commit：

```text
6cd4a8ff0f3f4e49d6d6969dd2fbadfa1569fde2
```

代码在 `vendor/modeltrace/`，带 MIT `LICENSE` 与 `NOTICE`。说明见 [docs/MODELTRACE.md](docs/MODELTRACE.md)。

## 配置

主要环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `APP_NAME` / `APP_TAGLINE` | RelayCheck / 模型测智站 | 品牌 |
| `PORT` | 3000 | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址；裸 Node 配合本机代理时可设为 `127.0.0.1` |
| `DATA_DIR` | `./data` | SQLite 目录 |
| `DEFAULT_UPSTREAM_URL` | 空 | 表单默认地址 |
| `TEST_TIMEOUT_MS` | 300000 | 单测试超时 |
| `MAX_ANSWER_BYTES` | 2097152 | 每个子请求的回答字节上限 |
| `MAX_ACTIVE_JOBS` / `MAX_QUEUE` | 4 / 20 | 全局容量 |
| `UPSTREAM_MAX_CONCURRENCY` | 8 | 上游子请求并发上限 |
| `CREATE_PER_IP_PER_HOUR` | 30 | 创建限流（自托管单用户可调高） |
| `ACTIVE_PER_IP` | 2 | 每 IP 活跃测试 |
| `LIST_PER_MINUTE` | 120 | 列表、摘要、详情、预览及 SSE 建连接口的每 IP 每分钟请求上限 |
| `PUBLIC_LIST_ENABLED` | true | 仅控制公开列表，详情与分享链接仍可按 ID 访问 |
| `TRUST_PROXY` | false | 直连关闭；受控单代理设置 1，并隔离后端端口 |
| `SSE_MAX_PER_IP` / `SSE_MAX_CONNECTIONS` | 3 / 200 | 每 IP / 全站实时连接上限 |
| `RETENTION_DAYS` / `MAX_RECORDS` | 30 / 500 | 已结束记录的保留天数 / 数量上限；排队和运行中的记录不参与清理 |
| `ALLOW_PRIVATE_UPSTREAMS` | false | **仅测试** |
| `UPSTREAM_ALLOWLIST` | 空 | 可选域名白名单，逗号分隔，支持精确域名和 `*.suffix` |
| `ADMIN_TOKEN_HASH` | 空 | admin token 的 SHA-256 |
| `MODEL_TIERS_FILE` | `./config/model-tiers.json` | 可选等级表 |

完整示例见 [.env.example](.env.example)。

### 模型等级

默认 `config/model-tiers.json` 为空：高级模式会展示指纹，但只有“预测模型 == 被测模型”时自动 pass，否则 `unknown`。若要按等级判定，复制示例：

```bash
cp config/model-tiers.example.json config/model-tiers.json
```

示例等级只是演示，不代表真实模型能力排序；请按你自己的模型目录维护。

## 部署

### Docker Compose + Caddy（推荐）

```bash
cp .env.example .env
# 编辑 SITE_ADDRESS、ADMIN_TOKEN_HASH 等
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
```

- 首次启动 Caddy 自动申请 TLS 证书；域名需解析到服务器。
- 数据在 `relaycheck-data` 命名卷，实际卷名带 Compose 项目前缀；容器在线备份命令见 [部署文档](docs/DEPLOY.md#备份与恢复)。
- 本地 HTTP 预览设置 `SITE_ADDRESS=http://localhost`；`SITE_ADDRESS=localhost` 使用 Caddy 的本地 CA 提供 HTTPS。

### 非 Docker

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

前置 nginx 时必须为 SSE 关闭 buffering，并传递 `X-Forwarded-For`；示例见 [deploy/nginx.conf.example](deploy/nginx.conf.example)。

详细部署、备份、升级说明：[docs/DEPLOY.md](docs/DEPLOY.md)。

### 本地数据备份与恢复

```bash
pnpm db:backup ./data/relay-check.db ./backups/relay-check-2026-11-18.db
pnpm db:restore ./backups/relay-check-2026-11-18.db ./data-restored
```

备份使用 SQLite 在线备份 API，包含已提交的 WAL 数据，并拒绝覆盖已有备份。每次使用新的备份文件名；恢复到新目录后，停止旧实例，将 `DATA_DIR` 指向恢复目录，再启动单个实例。

## 开发与测试

```bash
pnpm typecheck
pnpm test          # unit + integration，不访问真实外网
pnpm e2e           # 构建后跑 Playwright（本地 Windows 默认使用 Edge）
pnpm question:render  # 重新生成严格模式图片
pnpm smoke:prod       # 验证构建产物、重启与备份恢复
pnpm check            # 依次执行类型检查、单元/集成、构建与浏览器测试、生产冒烟
pnpm audit --prod     # 生产依赖安全检查
```

- `tests/mock-upstream.ts` 模拟 Responses/Chat SSE、401、200+error、超时、图片和大回答。
- 所有集成测试使用临时 SQLite 目录与随机端口。
- `playwright.config.ts` 的 E2E webServer 会启动 `tests/e2e/server.ts`（mock 3199、app 3100）。
- Linux CI 若没有 Edge，设置 `PLAYWRIGHT_CHANNEL=` 并安装 Chromium：

```bash
pnpm exec playwright install chromium
PLAYWRIGHT_CHANNEL= pnpm e2e
```

GitHub Actions 同时验证应用测试、生产依赖，以及 Docker 镜像、Compose 与 Caddy 配置。

## 目录

```text
src/client/              Vue 3 页面、组件、Markdown/KaTeX
src/server/              Fastify、SQLite、队列、上游适配、SSRF 防护
src/shared/              类型、问题包、判定
vendor/modeltrace/       MIT 指纹代码与 bank（固定 commit）
public/questions/        问题图片源/产物
migrations/              SQLite schema
tests/                   unit / integration / e2e
scripts/                 生产环境入口、冒烟、数据库备份/恢复、题图生成
Dockerfile               多阶段生产镜像
deploy/                  Compose、Caddy、nginx、systemd 示例
.github/workflows/       GitHub Actions 应用与容器检查
docs/                    API、威胁模型、部署、指纹说明与界面截图
```

## 已知未做 / 后续方向

登录/付费、号池批量巡检 UI、多实例 Postgres/Redis、Anthropic/Gemini 原生协议、模型库在线训练/更新、排行榜。

## 许可与归属

- 本项目尚未声明开源许可证（`package.json` 未设置 `license`，仓库根目录没有 `LICENSE`）。
- `vendor/modeltrace/` 为 MIT，版权归 xqy2006，详见其 `LICENSE`/`NOTICE`。
- 未复制 yyt.im 的页面、CSS 或题目图片；糖果题/水杯题采用公开基准题面，严格模式图片为本站绘制。
