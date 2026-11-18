# API

Base: `/api/v1`. Responses are JSON unless noted. No cookies/CORS; all endpoints are same-origin.

## Config

```http
GET /api/v1/config
```

Returns public branding, modes, questions, model presets, limits, `publicListEnabled`, and disclaimers. No secrets, no key.

## List tests

```http
GET /api/v1/tests?page=1
```

- 30 records/page.
- Records are summaries: no `question`, no `answer`, no full fingerprint.
- `PUBLIC_LIST_ENABLED=false` returns 403.

```json
{
  "ok": true,
  "records": [
    {
      "id": "0123456789abcdef",
      "addressMasked": "https://r****.com",
      "keyMasked": "sk-3****7890",
      "model": "gpt-6-astra",
      "apiType": "responses",
      "testMode": "dual",
      "status": "completed",
      "verdict": "pass",
      "progress": { "current": 2, "completed": 2, "total": 2, "stage": "completed" },
      "fingerprintSummary": null,
      "createdAt": "2026-11-17T08:00:00.000Z"
    }
  ],
  "total": 200,
  "page": 1,
  "pageSize": 30
}
```

## Summaries by ID

`GET /api/v1/tests/summaries?ids=0123456789abcdef,...` returns `{ ok, records, missingIds }` for up to 30 unique IDs. Used by My tests so polling never downloads full answers. Like detail/share URLs, this remains available when the public index is disabled. It is not an authorization mechanism.

## Create test

```http
POST /api/v1/tests
Content-Type: application/json
```

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

- `apiType`: `responses` | `chat_completions`
- `effort`: `low` | `medium` | `high` | `xhigh` | `minimal` | `none`
- `testMode`: `quick` | `strict` | `dual` | `cup` | `pelican` | `advanced`
- Success: `202` with `{ "ok": true, "test": { summary } }`
- Validation: `400` `VALIDATION_ERROR` with `fields`
- Invalid target URL/SSRF: `400` `UPSTREAM_URL_REJECTED`
- Queue/active limits: `429` `QUEUE_LIMIT` or `RATE_LIMITED`
- Body limit: `413` `BODY_TOO_LARGE`
- Shutdown: `503` `SHUTTING_DOWN`

Pending DNS validation, queued jobs and running jobs all count toward `ACTIVE_PER_IP`. Capacity is reserved before DNS lookup. `TEST_TIMEOUT_MS` starts when a job leaves the queue, including time waiting for an upstream concurrency slot.

The key is used in memory and is never persisted. It is not returned in any response.

## Get detail

```http
GET /api/v1/tests/:id
```

`id` is 16 lowercase hex characters. Detail adds:

- `question`, `answer`
- `probes[]` (prompt, answer, status, timing, error)
- `fingerprint` (full ModelTrace report)
- `comparison[]` for dual mode

A 404/400-style body is returned for unknown ids.

## Drawing preview

`GET /api/v1/tests/:id/preview` returns `text/html; charset=utf-8` for a completed `pelican` record containing a complete HTML document or fenced HTML fragment, capped at 512 KiB. It preserves the extracted HTML, styles and scripts. Script-created SVG is supported. Records and their original answers are never rewritten.

- `404 NOT_FOUND`: malformed/missing ID or a different test mode.
- `409 PREVIEW_NOT_READY`: queued, running or failed drawing request.
- `422 PREVIEW_UNAVAILABLE`: missing/incomplete/oversized HTML, or a standalone SVG (use the sanitized image preview).
- Same per-IP rate limit as detail queries; available through the record ID even when the public index is disabled.
- `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Frame-Options: SAMEORIGIN`.
- Dedicated CSP uses `sandbox allow-scripts`, allows inline scripts/styles and data images/fonts, blocks resource/API connections, workers, nested frames and forms, and limits framing to the app origin. The main app's CSP is not relaxed.

The client also uses `iframe sandbox="allow-scripts"` without `allow-same-origin`, only while a completed detail is open. Successful drawing requests return `verdict: unknown` regardless of artifact validity; `verdictReason` explains preview availability. These are human review results, not automatic visual grades. Legacy drawing records and verdicts remain stored as originally recorded.

## SSE stream

```http
GET /api/v1/tests/:id/events
Accept: text/event-stream
```

Each event:

```text
data: {"ok":true,"test":{...full detail...}}\n\n
```

- Initial snapshot is sent immediately.
- Updates are sent until `status` is `completed` or `failed`, then the server closes.
- Heartbeat comment every 15 s.
- `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no`.
- Limit: `SSE_MAX_PER_IP` concurrent streams per IP (default 3).
- Global stream limit: `SSE_MAX_CONNECTIONS` (default 200). Slow consumers are disconnected; snapshot polling can recover.
- List, summary, detail and stream-creation routes are rate limited. `LIST_PER_MINUTE` defaults to 120 per route/IP.

Detail pages also poll every 1.5 s, so a dropped SSE connection still converges.

## Health

```http
GET /api/v1/health
```

Includes DB check, queue depth, active jobs, SSE listeners, uptime, version.

## Admin

Requires `Authorization: Bearer <token>` where SHA-256(token) is `ADMIN_TOKEN_HASH`. If the env var is empty, these routes are 404.

```http
GET    /api/v1/admin/stats
GET    /api/v1/admin/tests?page=1
DELETE /api/v1/admin/tests/:id
```

Deleting queued or running records returns `409 TEST_ACTIVE`; terminal records can be deleted.

## Errors

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数无效",
    "fields": { "key": "请填写 API Key" }
  }
}
```

Known Key and upstream URL/host values are redacted from both answers and errors before storage or delivery. Truncated/incomplete responses are failed requests with partial evidence, never successful verdicts. `MAX_ANSWER_BYTES` bounds UTF-8 answer bytes; the transport also has a separate finite bound for framing and repeated snapshots.
