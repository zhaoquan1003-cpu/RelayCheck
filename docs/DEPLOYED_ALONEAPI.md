# aloneapi.top 部署记录

部署日期：2026-11-18（北京时间）。

- 公开地址：<https://aloneapi.top/zhishang>
- 服务器：`43.110.48.124`，Debian 12，使用 SSH 私钥登录。
- 应用目录：`/opt/relaycheck`。
- Compose 项目：`relaycheck`；容器：`relaycheck-app-1`。
- 镜像：`relaycheck:zhishang`。
- 本次镜像 ID：`sha256:0e75a4189eeec25a03b8ec3f06c092a727ca28e877d0c6a8ce92215022063d12`。
- 监听：`127.0.0.1:3101` → 容器 `3000`，由主机 Caddy 转发。
- 数据卷：`relaycheck_relaycheck-data`，挂载到容器 `/data`。
- 自动重启：`unless-stopped`，Docker 与 Caddy 均已启用开机启动。
- 前端构建参数：`VITE_BASE_PATH=/zhishang/`；代理信任：`TRUST_PROXY=1`。

私钥仅在本地用于 SSH 认证，未放入应用目录、部署包或容器。

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

已通过本地 160 项单元与集成测试、类型检查、根路径浏览器回归和子路径反向代理浏览器验证。服务器已通过镜像构建、生产容器启动、应用重启、健康检查、数据库备份、公开 HTTPS 和页面加载验证。浏览器成功显示题图，未发现脚本错误；原站健康接口正常。

上线验收没有使用真实上游 API Key 发起收费模型调用。
