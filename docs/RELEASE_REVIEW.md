# 本地生产版本检查记录

日期：2026-11-18。范围：当前工作区全部前后端、共享判定逻辑、SQLite、ModelTrace 接入、生产入口、依赖与部署配置。保留原有未提交修改；本次未进行远程发布、真实上游付费调用或线上环境操作。

## 已修复的问题

| 范围 | 修复结果 | 验证依据 |
| --- | --- | --- |
| 并发准入 | 在异步 DNS 前预留容量；同 IP 的待校验、排队和运行任务都计入限制，失败校验归还额度 | lifecycle.test.ts 并发 HTTP 提交与容量恢复 |
| 任务结束与关闭 | 取消上游请求和信号量等待者；排队任务写入中断状态；即使取消状态写入失败，也清除凭据并等待活动任务结束 | lifecycle.test.ts、semaphore、故障注入 |
| SSE | 限制全站和每 IP 连接；处理慢读者；缓冲未排空时保留额度；清除复用连接的监听器；关闭服务释放连接 | lifecycle.test.ts、sse-lifecycle.test.ts |
| 上游协议 | 流提前终止、无效 JSON、响应未完成、嵌套失败和 Chat 截断均不再判成功；完成事件无需等待上游关闭连接；保留部分证据 | upstream.test.ts 32 项 |
| 回答上限 | 按实际 UTF-8 答案字节计算，另外限制传输体，避免 SSE 包装和重复最终快照错误占用答案额度 | upstream.test.ts |
| 隐私 | 答案与错误均清洗已知 Key 和上游地址/主机；解析错误不回显请求体；请求日志不记录查询参数和凭据 | upstream.test.ts、lifecycle.test.ts |
| 配置与 SSRF | 默认不信任转发头；显式代理跳数；严格布尔值、端口与摘要校验；生产禁用私网开关；修复 IPv6 和规范化前路径检查 | production-boundaries.test.ts 33 项 |
| 判定 | 排除负数、较长数字与标识符内匹配；英文句末标点正常识别；指纹优先使用模型 ID；不完整指纹运行不判成功 | verdict.test.ts、mode-boundaries.test.ts |
| SQLite | 清理只删除终态记录；运行任务禁止删除；重启恢复进度与时间；迁移和启动失败后释放数据库 | repository-lifecycle.test.ts、startup-cleanup.test.ts |
| 前端 | “我的”批量读取摘要；防止旧请求覆盖新列表；请求超时与取消；404 停止轮询；关闭公开列表自动选择“我的” | reliability.spec.ts |
| 展示安全 | 长答案转为完整纯文本，避免昂贵 Markdown/公式解析；SVG 继续隔离显示并清除外部资源引用 | app.spec.ts、reliability.spec.ts |
| 生产维护 | 生产启动入口、构建缺失检查、完整验收命令、在线备份与不覆盖恢复、Compose/systemd/CI 与维护文档 | 生产冒烟、Compose 配置验证 |
| 依赖 | 升级 @fastify/static、KaTeX、Zod 及相关锁定依赖，适配静态服务 API 变化 | 类型检查、浏览器测试、生产依赖审计 |

## 当前验收证据

- `pnpm install --frozen-lockfile`：通过。
- `pnpm check`：通过，包含类型检查、14 个测试文件的 138 项单元/集成测试、生产构建、11 项 Edge 浏览器测试、生产冒烟。
- `pnpm audit --prod`：无已知漏洞。
- `docker compose --env-file .env.example -f deploy/docker-compose.yml config --quiet`：通过。
- `git diff --check`：通过。
- 本机 `pnpm start`：首页 HTTP 200；健康接口 `ok: true`；提供编译后的前端与安全响应头。
- 浏览器截图已检查：桌面首页、详情和 390px 手机页面。

生产冒烟使用独立临时数据库，直接运行编译产物，验证静态资源、缓存策略、安全响应头、健康与配置接口、摘要、详情、SSE、私网拒绝、未完成任务恢复、跨进程重启持久化、在线备份、恢复、拒绝覆盖、正常退出。测试不会把模拟记录写入本机正式数据目录。

## 适用边界

当前可验证的运行方式是单实例 Node.js 24 + SQLite；已在本机启动生产构建。Docker daemon 本机不可用，因此这里只验证了 Compose 配置，未声称镜像/Caddy 已实际运行。CI 已加入镜像构建、非 root 启动、健康、关闭重启和 Caddy 配置检查；选择容器上线时应先让该检查通过。

上游协议测试使用受控模拟服务，不代表所有第三方中转都遵守同一协议。测试判定仍是题面规定的启发式规则，SVG 画功需要人工看图，ModelTrace 为闭集概率。关闭公开列表不等于私有认证；已知凭据清洗无法识别上游对凭据做任意变换后的内容。

旧 `.env` 的 `TRUST_PROXY=true` 必须迁移为直连的 `false` 或受控代理拓扑的跳数。当前本机配置已改为 `false`。运行、备份、恢复及将来部署步骤见 [DEPLOY.md](DEPLOY.md)。
