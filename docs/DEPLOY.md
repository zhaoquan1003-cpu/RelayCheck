# Deployment

## Docker Compose + Caddy (recommended)

Prerequisites: Linux host, Docker Engine + Compose, a domain pointing at the host, ports 80/443 open.

```bash
cp .env.example .env
# edit SITE_ADDRESS, ADMIN_TOKEN_HASH, APP_NAME, limits...
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
```

- Caddy obtains/renews TLS certificates automatically.
- `flush_interval -1` disables response buffering for SSE.
- App is not published directly; Caddy reaches `app:3000` on the internal network.
- `relaycheck-data` volume holds SQLite; `caddy-data` holds certificates.
- Container: non-root, read-only root, `/tmp` tmpfs, `no-new-privileges`.

Check:

```bash
docker compose -f deploy/docker-compose.yml ps
curl -fsS https://YOUR_DOMAIN/api/v1/health
```

## Local Docker

Set `SITE_ADDRESS=localhost` and open the address Caddy prints. Caddy may use a local CA; for plain HTTP local use `http://localhost` with Caddy's local config or run `pnpm dev` instead.

## Systemd / bare Node

```bash
pnpm install
pnpm build
node --env-file=.env dist/server/index.js
```

Use a process manager (systemd) and a reverse proxy. Requirements:

- Node.js 24+, `node:sqlite` built-in.
- Working directory must contain `dist/`, `vendor/modeltrace/`, `migrations/`, `config/`.
- `DATA_DIR` must be writable by the process user.
- Reverse proxy must forward `Host`, `X-Forwarded-For`, `X-Forwarded-Proto`, and must disable buffering/cache for `/api/v1/tests/*/events`.
- `TRUST_PROXY=true` only when the proxy is trusted; otherwise clients can spoof `X-Forwarded-For` and bypass per-IP limits.

See `deploy/nginx.conf.example`.

## Backups

SQLite WAL: use the online backup command, do not copy the `.db` file alone while the app is running.

```bash
sqlite3 /data/relay-check.db ".backup '/backup/relay-check-$(date +%F).db'"
```

Retain 7–30 daily backups. The entire record set is in one file; restoring replaces history. Test restore on a throwaway instance.

## Upgrade

1. Back up the DB.
2. Pull/build the new image.
3. `docker compose up -d`.
4. Hit `/api/v1/health`; check logs for migration errors.
5. Old public records remain compatible (schema changes should be additive).

## Scaling limits

This MVP is single-instance:

- SQLite writer + in-process queue.
- SSE listeners live in process memory.
- Rate limits are per process.

To scale horizontally, replace SQLite with Postgres, move the queue to a durable worker, and publish SSE through Redis/pub-sub. Do not run multiple instances against the same SQLite file over a network filesystem.

## Retention

Hourly cleanup:

- delete tests older than `RETENTION_DAYS` (default 30);
- keep at most `MAX_RECORDS` (default 500).

Admin can delete a single record. There is no automatic archive; add export/backup if records are business-critical.

## Environment gotchas

- `ALLOW_PRIVATE_UPSTREAMS=true` is for test infrastructure only. Never expose it publicly.
- `ADMIN_TOKEN_HASH` must be a SHA-256 hex digest, not the plain token.
- If `PUBLIC_LIST_ENABLED=false`, the app still serves detail/share links by ID.
- Behind a CDN, ensure SSE is not buffered by the CDN; Caddy is the tested path.