# aloneapi.top 部署记录

最近更新：2026-11-18 22:49（北京时间）。已在主站完成 Sub2API 0.2.23 升级并验证健康后更新 RelayCheck。

- 公开地址：<https://aloneapi.top/zhishang>
- 服务器：`43.110.48.124`，Debian 12，使用 SSH 私钥登录。
- 应用目录：`/opt/relaycheck`。
- Compose 项目：`relaycheck`；容器：`relaycheck-app-1`。
- 应用源码提交：[`1f13bf3`](https://github.com/zhaoquan1003-cpu/RelayCheck/commit/1f13bf38c1d6bf2a8054faed588a6d18bce7995d)。本页的部署记录随后更新，不改变应用构建内容。
- 镜像：`relaycheck:release-1f13bf3`；`.env` 中的 `RELAYCHECK_TAG=release-1f13bf3` 已同步。
- 本次镜像 ID：`sha256:ff3b3eaf8cff81586df91f1502bea8de18b4662fed8a5a0bb843468ee6280ee0`。
- 镜像 OCI `org.opencontainers.image.revision` 标识为上述完整源码提交。
- 监听：`127.0.0.1:3101` → 容器 `3000`，由主机 Caddy 转发。
- 数据卷：`relaycheck_relaycheck-data`，挂载到容器 `/data`。
- 自动重启：`unless-stopped`，Docker 与 Caddy 均已启用开机启动。
- 前端构建参数：`VITE_BASE_PATH=/zhishang/`；代理信任：`TRUST_PROXY=1`。

私钥仅在本地用于 SSH 认证，未放入应用目录、部署包或容器。

## 本次更新与备份

- 新增中转模型列表获取，画图请求与 Cockpit Tools 对齐，题目版本为 `2026-11-v4`；独立 SVG 与 HTML 均使用可执行沙箱预览。
- 源码归档和部署报告：`/opt/relaycheck/releases/release-1f13bf3/`；报告为 `release-report.json`。
- 切换前备份：`/opt/relaycheck/backups/before-1f13bf3-20261118T144903Z/`，包含在线 SQLite 备份 `relay-check.db`、原配置 `.env` 和原源码 `source-before.tar.gz`。
- 数据库备份 SHA-256：`e72f93278b80a042102c413fa78e0b93d8cc98e71eff2846cdb54df264a6b0bb`；复制摘要和 `PRAGMA quick_check` 均通过。
- 回滚镜像：`relaycheck:rollback-1f13bf3-1795013345`。如需回滚，将 `.env` 的 `RELAYCHECK_TAG` 改为此镜像的标签部分，再仅执行 `app` 的 `up -d --no-build --no-deps`；数据库卷保持原位，不恢复旧数据覆盖后续记录。
- 本次仅重建 RelayCheck 应用容器，主站容器未重启，Caddy 配置未修改；切换前确认队列为空。

## 日常维护

在服务器执行：

```bash
cd /opt/relaycheck
docker compose -p relaycheck --env-file .env \
  -f deploy/docker-compose.yml -f deploy/docker-compose.existing-proxy.yml ps
docker logs --tail 100 relaycheck-app-1
curl -fsS https://aloneapi.top/zhishang/api/v1/health
```

修改源码后，备份数据库，再构建并更新应用。始终保留项目名、数据卷和末尾的 `app` 参数，避免额外启动 Compose 中的 Caddy 服务：

```bash
docker compose -p relaycheck --env-file .env \
  -f deploy/docker-compose.yml -f deploy/docker-compose.existing-proxy.yml \
  up -d --build app
```

重启会中断当时尚未完成的检测。数据库备份方法见 [部署文档](DEPLOY.md#备份与恢复)。

## 代理配置与恢复

生产代理配置为 `/etc/caddy/Caddyfile`。添加了 `/zhishang` 重定向和 `/zhishang/*` 前缀剥离转发，保留原站的其他配置。

- 原始代理配置：`/opt/relaycheck/backups/Caddyfile.before-zhishang`。
- 原始配置 SHA-256：`961a2ff713571622ee4be0a4d9b135f929f0a289f5a8b165b61809f5d56ff724`。
- 部署后的候选配置：`/opt/relaycheck/Caddyfile.candidate`。
- 初始数据库备份：`/opt/relaycheck/backups/relay-check-initial-20261118.db`，仅包含部署时的空数据库。

需要撤销本次代理改动时，先确认此后没有其他代理配置变更，再恢复原始配置，执行 `caddy validate --config /etc/caddy/Caddyfile` 和 `systemctl reload caddy`。应用数据卷可保留；不要执行 `docker compose down -v`。

## 验证范围

应用源码的 [GitHub CI](https://github.com/zhaoquan1003-cpu/RelayCheck/actions/runs/44323673670) 全部通过：200 项单元与集成测试、30 项浏览器测试、类型检查、依赖审计、生产冒烟及 Docker/Compose/Caddy 验证。

服务器的 159 个源码文件在部署时与 GitHub 提交归档逐一核对一致。生产容器健康、数据库完整性、公开页面资源、v4 题目和模型列表接口校验正常；公开页面通过桌面及 390px 手机浏览器验证，无脚本错误或资源加载失败，原站健康接口正常。

上线验收没有使用真实上游 API Key 发起收费模型调用。
