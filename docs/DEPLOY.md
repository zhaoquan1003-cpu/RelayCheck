# 生产运行与维护

项目按单实例 Node.js 24 + SQLite 运行。下面的命令均在项目根目录执行。配置模板在 `.env.example`，实际 `.env` 不应提交到仓库。

## 本地验证生产构建

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
node scripts/smoke-production.mjs
pnpm exec playwright install chromium
# Windows 默认使用 Edge；Linux 使用已安装的 Chromium。
pnpm exec playwright test
pnpm audit --prod
```

生产冒烟测试直接运行 `dist/server/index.js`，使用临时数据目录和本机随机端口，验证首页、资源、API、安全响应头、SSE、私网拒绝、重启恢复、在线备份和恢复。它不调用真实上游、不读取现有测试历史，也不改动现有 `.env`。测试结束后清理自己的子进程和数据。

生产入口要求 `dist/client/index.html` 已存在；缺少前端构建时启动会失败，避免 API 看似正常但首页不可用。构建产物之外还需要 `package.json`、生产依赖、`vendor/modeltrace/`、`migrations/`、`config/`；进程工作目录必须是项目目录。

## 单机 Docker Compose + Caddy

准备 Linux 主机、Docker Engine + Compose、解析到主机的域名，以及开放的 TCP 80/443 和 UDP 443。配置并启动：

```bash
cp .env.example .env
# 编辑 SITE_ADDRESS、APP_NAME、限制参数及可选 ADMIN_TOKEN_HASH。
docker compose --env-file .env -f deploy/docker-compose.yml config --quiet
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
docker compose --env-file .env -f deploy/docker-compose.yml ps
curl -fsS https://YOUR_DOMAIN/api/v1/health
docker compose --env-file .env -f deploy/docker-compose.yml logs --tail=100 app
```

`SITE_ADDRESS` 填域名，例如 `check.example.com`。Caddy 自动签发和续期证书，SSE 使用 `flush_interval -1` 禁用代理缓冲。仅 Caddy 发布端口；应用的 3000 端口只对容器网络开放。

应用容器以非 root 用户运行，根文件系统只读，`/tmp` 使用 tmpfs，禁用额外 Linux capabilities。`/data` 是可写的命名卷。Compose 将单容器日志限制为 3 个 10 MB 文件，并给关闭过程 15 秒退出时间。应用会取消运行中请求、将排队任务标为中断并释放 SSE 连接；任务不会在重启后自动重试，因为原始 Key 不持久化。

`relaycheck-data` 卷保存测试数据库，`caddy-data` 卷保存证书，`caddy-config` 卷保存 Caddy 状态。实际卷名带有 Compose 项目前缀，通常为 `deploy_`；可用 `docker volume ls` 确认。更新时保持原来的项目名及卷挂载。不要执行 `docker compose down -v`，除非明确需要删除这些数据。

本地容器预览可设 `SITE_ADDRESS=http://localhost` 使用 HTTP；`SITE_ADDRESS=localhost` 使用 Caddy 的本地 CA。正式域名应使用 HTTPS。

## 代理与访问边界

### 部署在已有网站的子路径

例如访问地址为 `https://aloneapi.top/zhishang/`，构建时设置 `VITE_BASE_PATH=/zhishang/`。此变量会写入前端构建，改变后必须重新构建。不设置时保持根路径 `/` 部署。

```bash
VITE_BASE_PATH=/zhishang/ pnpm build
# 或构建容器镜像：
docker build --build-arg VITE_BASE_PATH=/zhishang/ -t relaycheck:zhishang .
```

在已有反向代理后运行单个应用实例，不要再启动占用 80/443 的第二个 Caddy。应用仍使用内部根路径，代理负责移除 `/zhishang` 前缀。API、SSE、题图、动画预览和分享链接使用同一个公开前缀。

使用仓库提供的覆盖配置可将应用仅发布到本机 `3101` 端口。在 `.env` 中设置 `VITE_BASE_PATH=/zhishang/`，然后执行以下命令；末尾的 `app` 用于只启动应用服务：

```bash
docker compose -p relaycheck --env-file .env \
  -f deploy/docker-compose.yml -f deploy/docker-compose.existing-proxy.yml \
  up -d --build app
curl -fsS http://127.0.0.1:3101/api/v1/health
```

`RELAYCHECK_PORT` 可覆盖本机端口，`RELAYCHECK_TAG` 可指定发布镜像标签。默认持久化卷为 `relaycheck_relaycheck-data`，更新时保持项目名 `relaycheck`。

将以下配置合并进已有 Caddy 站点块，并将原站的处理规则放进最后的 `handle`。示例中的 `127.0.0.1:3101` 要替换为 Caddy 实际可访问的应用地址；如果 Caddy 和应用都是容器，应使用共同 Docker 网络中的服务名和容器端口。

```caddyfile
redir /zhishang /zhishang/?{http.request.uri.query} 308
handle_path /zhishang/* {
    reverse_proxy 127.0.0.1:3101 {
        flush_interval -1
    }
}
handle {
    # 保留原站的处理规则，例如 reverse_proxy 原站地址。
}
```

先备份代理配置，验证新配置后再平滑重载。验证 `/zhishang` 重定向、`/zhishang/api/v1/health`、首页资源、题图与原站首页均正常。使用现有受信任的单层代理时设置 `TRUST_PROXY=1`，并确保应用端口仅供代理访问。

直接运行时默认 `TRUST_PROXY=false`，客户端无法用 `X-Forwarded-For` 伪造限流身份。Compose 固定为 `TRUST_PROXY=1`，表示只有 Caddy 这一跳受信任，且应用端口不发布。旧值 `TRUST_PROXY=true` 不再接受。

使用示例 nginx 时，配置 `HOST=127.0.0.1`、`TRUST_PROXY=1`，并确保外部无法直接访问 Node 端口。示例会重写 `X-Forwarded-For` 为真实连接来源。多层代理需按实际拓扑配置跳数并在最外层清洗转发头；不要靠增加跳数修复看似相同的用户 IP。TLS 代理应禁用 SSE 缓冲并允许持续连接。

`ALLOW_PRIVATE_UPSTREAMS=true` 只允许在测试/开发环境使用；生产启动会直接拒绝该设置。`UPSTREAM_ALLOWLIST` 可限制允许请求的目标域名，Compose 会转发这一配置。空值允许符合 SSRF 校验的公网目标。HTTP 上游仍受支持，但凭据通过公网时应使用 HTTPS。

`PUBLIC_LIST_ENABLED=false` 仅隐藏公开列表。持有记录 ID 或分享链接的人仍可访问详情和 SSE；它不是用户认证。私密实例需要额外的网络访问控制或反向代理认证。

## 裸 Node / systemd

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

`pnpm start` 自动设置生产环境。直接运行构建文件时必须显式设置：

```bash
NODE_ENV=production node --env-file=.env dist/server/index.js
```

PowerShell：

```powershell
$env:NODE_ENV = 'production'
node --env-file=.env dist/server/index.js
```

使用进程管理器并设置正确工作目录、可写 `DATA_DIR`、`NODE_ENV=production`。给进程发送 SIGTERM/SIGINT 可执行关闭流程；不要用强制终止作为正常停止方式。可以参照 `deploy/relaycheck.service.example` 和 `deploy/nginx.conf.example`。

## 管理令牌

`ADMIN_TOKEN_HASH` 必须是 64 位 SHA-256 十六进制摘要。没有配置时管理路由返回 404。生成随机令牌与摘要后，仅把摘要写入配置，将令牌保存在自己的密码管理器中：

```bash
node -e "const c=require('node:crypto');const t=c.randomBytes(32).toString('hex');console.log('Token: '+t);console.log('ADMIN_TOKEN_HASH='+c.createHash('sha256').update(t).digest('hex'))"
```

使用 `Authorization: Bearer <Token>` 调用 `/api/v1/admin/stats`、`/api/v1/admin/tests` 或 `DELETE /api/v1/admin/tests/:id`。运行中或排队的任务不能删除，返回 409；完成后可删除。

## 备份与恢复

SQLite 使用 WAL，运行时不能只复制 `.db` 文件。提供的脚本使用 Node 自带 SQLite 在线备份 API，包含已提交的 WAL 数据，先做完整性检查，并拒绝覆盖已有备份：

```bash
node scripts/backup-db.mjs ./data/relay-check.db ./backups/relay-check-2026-11-18.db
node scripts/restore-db.mjs ./backups/relay-check-2026-11-18.db ./data-restored
```

恢复脚本只写入一个没有数据库及 WAL 文件的新数据目录。先停止旧实例，再将 `DATA_DIR` 切换到新目录、启动单个实例，检查健康状态和历史记录。保留旧目录直到确认恢复成功。恢复文件继承原备份中的任务状态；服务启动时会把未完成记录标为中断。

容器在线备份示例：

```bash
mkdir -p backups
docker compose --env-file .env -f deploy/docker-compose.yml exec -T app node scripts/backup-db.mjs /data/relay-check.db /data/relay-check-backup.db
docker compose --env-file .env -f deploy/docker-compose.yml cp app:/data/relay-check-backup.db ./backups/relay-check-backup.db
```

每次换新的备份文件名，确认外部副本可读取后再自行清理卷中的备份。容器内的 SQLite 脚本不需要安装 sqlite3 CLI。建议将备份另存到主机以外的位置，按业务需要保留 7–30 天，并定期恢复到临时实例验证。

Docker 恢复应使用新的数据卷：通过一次性容器运行恢复脚本，再配置应用挂载该卷。不要直接覆盖仍由应用打开的数据库；也不要把历史 WAL 文件和新恢复的 `.db` 混在一起。

## 更新、回滚与容量

更新前完成上述验证并备份数据库；构建新镜像后执行相同的 `compose up -d --build`，检查健康状态、首页和日志。保留上一版镜像标签。回滚时停止新版本，使用旧镜像及与其兼容的数据库备份；如果后续增加不向后兼容的迁移，应先恢复备份到新数据目录。

实例启动、任务完成和每小时维护时会清理已结束的记录：过期记录按 `RETENTION_DAYS` 删除，最多保留 `MAX_RECORDS` 条已结束记录。正在运行和排队的记录不会被清理，因此总数可暂时大于该上限。默认回答上限为每个子请求 2 MB；双测和三次指纹题会存储多份回答，请监控数据卷剩余空间。清理记录不等于立即缩小 SQLite 文件，已释放页会供后续写入复用。

队列、限流计数和 SSE 监听器都在单个进程内。不要启动多个实例共享一个 SQLite 文件，也不要放在网络文件系统上。需要横向扩展时，应先改为共享数据库、持久任务队列和跨实例事件通知。

GitHub CI 会执行类型检查、回归测试、生产冒烟、浏览器端到端测试、生产依赖审计，以及 Docker/Compose/Caddy 配置与容器运行验证。容器验证必须有可用 Docker daemon；单纯 `compose config` 通过不代表镜像能够启动。
